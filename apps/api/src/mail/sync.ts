import { prisma } from '../db'
import type { Settings } from '../settings/schema'
import { getSetting } from '../settings/service'
import { importiereMails, type ImportBericht } from './ingest'
import { holeAdapter } from './registry'
import { MailFehler, type Bereich, type MailAdapter, type SyncZustand } from './types'

/**
 * Ein Abruf-Lauf. Läuft alle paar Minuten im Hintergrund und lässt sich in
 * der Oberfläche von Hand auslösen.
 *
 * Es kann immer nur ein Lauf gleichzeitig aktiv sein – sonst würden Timer und
 * Handstart dieselbe Nachricht doppelt verarbeiten.
 */

let laeuftGerade = false

export function syncLaeuft(): boolean {
  return laeuftGerade
}

export interface SyncErgebnis extends ImportBericht {
  adapter: string
  abgebrochen?: string
}

/** Wie viele Delta-Seiten ein Lauf höchstens abarbeitet. */
const MAX_SEITEN = 20

export async function fuehreSyncAus(): Promise<SyncErgebnis> {
  if (laeuftGerade) {
    throw new MailFehler('Es läuft bereits ein Abruf. Bitte einen Moment warten.')
  }
  laeuftGerade = true

  try {
    const einstellungen = await getSetting('mail')
    const adapter = await holeAdapter()

    if (!adapter) {
      return {
        adapter: 'aus',
        gepruefte: 0,
        neueBewerbungen: 0,
        angehaengteAntworten: 0,
        uebersprungen: 0,
        fehler: [],
        abgebrochen: 'Es ist kein Postfach angebunden.',
      }
    }

    const gesamt: SyncErgebnis = {
      adapter: adapter.name,
      gepruefte: 0,
      neueBewerbungen: 0,
      angehaengteAntworten: 0,
      uebersprungen: 0,
      fehler: [],
    }

    await laufeUeberOrdner('posteingang', 'inbox', adapter, einstellungen, gesamt)

    // Der Gesendet-Ordner bringt die Antworten in den Verlauf, die jemand
    // direkt im Postfach geschrieben hat. Ein Fehlschlag dort darf den
    // Posteingang nicht entwerten – der ist die wichtigere Hälfte.
    if (einstellungen.gesendetAbrufen) {
      try {
        await laufeUeberOrdner('gesendet', 'sent', adapter, einstellungen, gesamt)
      } catch (err) {
        const meldung = err instanceof Error ? err.message : String(err)
        console.error('[mappe] Abruf des Gesendet-Ordners fehlgeschlagen:', err)
        gesamt.fehler.push({ nachricht: 'Gesendet-Ordner', grund: meldung })
      }
    }

    return gesamt
  } catch (err) {
    const meldung = err instanceof Error ? err.message : String(err)
    // Den Fehler am Zustand vermerken, damit die Oberfläche ihn zeigen kann,
    // ohne im Serverprotokoll suchen zu müssen.
    const adapterName = (await getSetting('mail')).adapter
    if (adapterName !== 'aus') {
      await speichereZustand(adapterName, {}, meldung).catch(() => undefined)
    }
    throw err
  } finally {
    laeuftGerade = false
  }
}

/**
 * Ein Ordner, seitenweise abgeholt.
 *
 * Jeder Ordner führt seinen eigenen Fortschritt (`folderId`): Der Delta-Link
 * von Graph und die UID-Zählung bei IMAP gelten immer nur für einen Ordner –
 * mit einem gemeinsamen Zustand würde jeder Lauf den jeweils anderen Ordner
 * von vorn einlesen.
 */
async function laufeUeberOrdner(
  bereich: Bereich,
  folderId: string,
  adapter: MailAdapter,
  einstellungen: Settings['mail'],
  gesamt: SyncErgebnis,
): Promise<void> {
  const datensatz = await prisma.mailSyncState.findUnique({
    where: { adapter_folderId: { adapter: adapter.name, folderId } },
  })

  let zustand: SyncZustand = {
    deltaLink: datensatz?.deltaLink ?? null,
    uidValidity: datensatz?.uidValidity ?? null,
    lastUid: datensatz?.lastUid ?? null,
  }

  for (let seite = 0; seite < MAX_SEITEN; seite++) {
    const abruf = await adapter.holeNeue(zustand, bereich)
    zustand = abruf.neuerZustand

    if (abruf.mails.length > 0) {
      const bericht = await importiereMails(abruf.mails, einstellungen, adapter, bereich)
      gesamt.gepruefte += bericht.gepruefte
      gesamt.neueBewerbungen += bericht.neueBewerbungen
      gesamt.angehaengteAntworten += bericht.angehaengteAntworten
      gesamt.uebersprungen += bericht.uebersprungen
      gesamt.fehler.push(...bericht.fehler)
    }

    // Zustand nach jeder Seite sichern: bricht der Lauf ab, geht nur die
    // angefangene Seite verloren, nicht der ganze Fortschritt.
    await speichereZustand(adapter.name, zustand, null, folderId)

    if (!abruf.weitere) break
    if (seite === MAX_SEITEN - 1) {
      gesamt.abgebrochen =
        'Es lagen mehr Nachrichten vor, als ein Lauf verarbeitet. Der nächste Abruf macht weiter.'
    }
  }
}

async function speichereZustand(
  adapter: string,
  zustand: SyncZustand,
  fehler: string | null,
  folderId = 'inbox',
): Promise<void> {
  await prisma.mailSyncState.upsert({
    where: { adapter_folderId: { adapter, folderId } },
    create: {
      adapter,
      folderId,
      deltaLink: zustand.deltaLink ?? null,
      uidValidity: zustand.uidValidity ?? null,
      lastUid: zustand.lastUid ?? null,
      lastSyncAt: new Date(),
      lastError: fehler,
    },
    update: {
      // Bei einem Fehlschlag den bisherigen Delta-Link behalten – sonst würde
      // der nächste Lauf das ganze Postfach neu einlesen.
      ...(zustand.deltaLink !== undefined && zustand.deltaLink !== null
        ? { deltaLink: zustand.deltaLink }
        : {}),
      ...(zustand.uidValidity !== undefined ? { uidValidity: zustand.uidValidity } : {}),
      ...(zustand.lastUid !== undefined ? { lastUid: zustand.lastUid } : {}),
      lastSyncAt: new Date(),
      lastError: fehler,
    },
  })
}

/** Setzt den Delta-Stand zurück – der nächste Lauf liest das Postfach neu ein. */
export async function setzeSyncZurueck(adapter: string): Promise<void> {
  await prisma.mailSyncState.deleteMany({ where: { adapter } })
}
