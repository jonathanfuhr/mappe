import { prisma } from '../db'
import { audit } from '../lib/audit'
import { badRequest } from '../lib/errors'
import { getSetting } from '../settings/service'
import { erkenneBewerbung, extrahiereDaten, fasseZusammen } from './aufgaben'

/**
 * Führt die eingeschalteten KI-Aufgaben für eine Bewerbung aus.
 *
 * Das Ergebnis landet als **Vorschlag** in der Datenbank, nicht als Datensatz.
 * Ausnahme ist die Kurzzusammenfassung: Sie ist eine Zusatzinformation und
 * überschreibt keine erfassten Daten, deshalb wird sie direkt gesetzt.
 */

export interface AnalyseBericht {
  modell: string
  aufgaben: string[]
  vorschlagId: string | null
  zusammenfassung: string | null
  hinweise: string[]
}

export async function analysiereBewerbung(
  applicationId: string,
  /** null, wenn der Hintergrundlauf nach dem Mail-Import analysiert. */
  userId: string | null,
): Promise<AnalyseBericht> {
  const ki = await getSetting('ki')
  if (!ki.aktiv) throw badRequest('Die KI ist ausgeschaltet.')

  const bewerbung = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      candidate: true,
      job: true,
      documents: { select: { extractedText: true, category: true } },
      mails: {
        where: { direction: 'EINGEHEND' },
        orderBy: { createdAt: 'asc' },
        select: { subject: true, bodyText: true },
      },
    },
  })
  if (!bewerbung) throw badRequest('Diese Bewerbung gibt es nicht.')

  // Mailtext und Dokumenttexte zusammenführen. Teil-PDFs würden denselben
  // Inhalt ein zweites Mal beisteuern – deshalb nur die Originale.
  const texte = [
    ...bewerbung.mails.map((m) => m.bodyText),
    ...bewerbung.documents.filter((d) => d.category === 'ORIGINAL').map((d) => d.extractedText ?? ''),
  ].filter((t) => t.trim().length > 0)

  if (texte.length === 0) {
    throw badRequest(
      'Zu dieser Bewerbung liegt kein auswertbarer Text vor. ' +
        'Bei gescannten PDFs ohne Texterkennung kann die KI nichts lesen.',
    )
  }

  const volltext = texte.join('\n\n---\n\n')
  const betreff = bewerbung.subject ?? bewerbung.mails[0]?.subject ?? ''
  const hinweise: string[] = []
  const aufgaben: string[] = []
  let modell = ki.modell

  const nutzlast: Record<string, unknown> = {}

  if (ki.aufgaben.erkennung) {
    const stellen = await prisma.job.findMany({ where: { status: { not: 'ENTWURF' } } })
    const { ergebnis, modell: m } = await erkenneBewerbung(betreff, volltext, stellen)
    modell = m
    aufgaben.push('Erkennung')
    nutzlast.stelle = {
      jobId: ergebnis.stellenId,
      sicherheit: ergebnis.sicherheit,
      begruendung: ergebnis.begruendung,
      initiativ: ergebnis.initiativ,
    }
    if (!ergebnis.istBewerbung) {
      hinweise.push('Die KI hält diesen Eintrag für keine Bewerbung. Bitte prüfen.')
    }
  }

  if (ki.aufgaben.extraktion) {
    const { ergebnis, modell: m } = await extrahiereDaten(volltext)
    modell = m
    aufgaben.push('Extraktion')
    nutzlast.bewerber = {
      anrede: ergebnis.anrede,
      titel: ergebnis.titel || undefined,
      vorname: ergebnis.vorname || undefined,
      nachname: ergebnis.nachname || undefined,
      email: ergebnis.email || undefined,
      telefon: ergebnis.telefon || undefined,
      strasse: ergebnis.strasse || undefined,
      plz: ergebnis.plz || undefined,
      ort: ergebnis.ort || undefined,
      links: ergebnis.links.filter(Boolean).map((url) => ({ label: kurzeUrl(url), url })),
    }
    nutzlast.schlagworte = ergebnis.schlagworte
  }

  let zusammenfassung: string | null = null
  if (ki.aufgaben.zusammenfassung) {
    const { zusammenfassung: z, modell: m } = await fasseZusammen(volltext, bewerbung.job)
    modell = m
    zusammenfassung = z
    aufgaben.push('Zusammenfassung')
    await prisma.application.update({
      where: { id: applicationId },
      data: { summary: z, summaryModel: m },
    })
  }

  let vorschlagId: string | null = null
  if (Object.keys(nutzlast).length > 0) {
    const vorschlag = await prisma.extractionSuggestion.create({
      data: {
        applicationId,
        source: 'KI',
        model: modell,
        payload: nutzlast as object,
      },
    })
    vorschlagId = vorschlag.id
    // Ein neuer Vorschlag heißt: es gibt wieder etwas zu prüfen.
    await prisma.application.update({
      where: { id: applicationId },
      data: { needsReview: true },
    })
  }

  await audit(userId, 'ki-analyse', 'application', applicationId, { modell, aufgaben })

  return { modell, aufgaben, vorschlagId, zusammenfassung, hinweise }
}

/**
 * Übernimmt ausgewählte Felder eines Vorschlags in die Datensätze.
 *
 * Die Oberfläche schickt genau die Felder mit, die bestätigt wurden – nie
 * den ganzen Vorschlag blind. So bleibt eine von Hand korrigierte Angabe
 * erhalten, auch wenn die KI etwas anderes gefunden hat.
 */
export async function uebernehmeVorschlag(
  vorschlagId: string,
  felder: string[],
  userId: string,
): Promise<{ uebernommen: string[] }> {
  const vorschlag = await prisma.extractionSuggestion.findUnique({
    where: { id: vorschlagId },
    include: { application: { include: { candidate: true } } },
  })
  if (!vorschlag) throw badRequest('Diesen Vorschlag gibt es nicht.')

  const nutzlast = vorschlag.payload as {
    bewerber?: Record<string, unknown>
    stelle?: { jobId: string | null; initiativ: boolean }
  }

  const bewerberDaten: Record<string, unknown> = {}
  const zuordnung: Record<string, unknown> = {}
  const uebernommen: string[] = []

  const abbildung: Record<string, string> = {
    anrede: 'salutation',
    titel: 'title',
    vorname: 'firstName',
    nachname: 'lastName',
    email: 'email',
    telefon: 'phone',
    strasse: 'street',
    plz: 'postalCode',
    ort: 'city',
    links: 'links',
  }

  for (const feld of felder) {
    if (feld === 'stelle') {
      if (nutzlast.stelle) {
        zuordnung.jobId = nutzlast.stelle.initiativ ? null : nutzlast.stelle.jobId
        zuordnung.speculative = nutzlast.stelle.initiativ
        uebernommen.push('stelle')
      }
      continue
    }
    const spalte = abbildung[feld]
    const wert = nutzlast.bewerber?.[feld]
    if (spalte && wert !== undefined && wert !== null && wert !== '') {
      bewerberDaten[spalte] = wert
      uebernommen.push(feld)
    }
  }

  if (Object.keys(bewerberDaten).length > 0) {
    await prisma.candidate.update({
      where: { id: vorschlag.application.candidateId },
      data: bewerberDaten,
    })
  }
  if (Object.keys(zuordnung).length > 0) {
    await prisma.application.update({ where: { id: vorschlag.applicationId }, data: zuordnung })
  }

  await prisma.extractionSuggestion.update({
    where: { id: vorschlagId },
    data: { appliedAt: new Date() },
  })

  await audit(userId, 'vorschlag-uebernommen', 'application', vorschlag.applicationId, {
    quelle: vorschlag.source,
    felder: uebernommen,
  })

  return { uebernommen }
}

function kurzeUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Link'
  }
}
