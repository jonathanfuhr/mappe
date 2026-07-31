import { getSetting } from '../settings/service'
import { fuehreSyncAus, syncLaeuft } from './sync'

/**
 * Hintergrundlauf für den Mail-Abruf.
 *
 * Bewusst ein einfacher Timer statt eines Cron-Pakets: das Tool läuft in einem
 * einzelnen Container, mehr Maschinerie bringt hier keinen Nutzen. Das
 * Intervall wird bei jedem Durchlauf frisch aus den Einstellungen gelesen –
 * eine Änderung greift damit ohne Neustart.
 */

let timer: NodeJS.Timeout | null = null
let gestoppt = false

export function startMailScheduler(): void {
  gestoppt = false
  plane(5_000)
  console.log('[mappe] Mail-Abruf im Hintergrund ist aktiv.')
}

export function stopMailScheduler(): void {
  gestoppt = true
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

function plane(verzoegerungMs: number): void {
  if (gestoppt) return
  timer = setTimeout(() => void lauf(), verzoegerungMs)
  // Ein wartender Timer soll den Prozess nicht am Beenden hindern.
  timer.unref()
}

async function lauf(): Promise<void> {
  let naechsteVerzoegerung = 120_000

  try {
    const einstellungen = await getSetting('mail')
    naechsteVerzoegerung = Math.max(30, einstellungen.abrufIntervallSekunden) * 1000

    if (einstellungen.adapter !== 'aus' && einstellungen.automatischAbrufen && !syncLaeuft()) {
      const ergebnis = await fuehreSyncAus()
      if (ergebnis.neueBewerbungen > 0 || ergebnis.angehaengteAntworten > 0) {
        console.log(
          `[mappe] Abruf: ${ergebnis.neueBewerbungen} neue Bewerbung(en), ` +
            `${ergebnis.angehaengteAntworten} Antwort(en) zugeordnet.`,
        )
      }
    }
  } catch (err) {
    console.error('[mappe] Mail-Abruf fehlgeschlagen:', err instanceof Error ? err.message : err)
    // Nach einem Fehler länger warten, damit ein kaputtes Postfach nicht im
    // Zweiminutentakt gegen die API läuft.
    naechsteVerzoegerung = Math.max(naechsteVerzoegerung, 300_000)
  } finally {
    plane(naechsteVerzoegerung)
  }
}
