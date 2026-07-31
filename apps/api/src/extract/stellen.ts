import type { Job } from '@prisma/client'

/**
 * Ordnet eine Bewerbung einer Stelle zu – regelbasiert, ohne KI.
 *
 * Gewertet werden Referenznummer (eindeutig), Stichworte der Stelle und der
 * Stellentitel selbst. Bleibt der beste Treffer schwach oder liegen zwei
 * Stellen gleichauf, wird bewusst *nichts* zugeordnet: eine falsche Stelle
 * ist schlimmer als eine offene Frage im Review-Schritt.
 */

export interface StellenTreffer {
  jobId: string | null
  /** 0 bis 1 – wird in der Oberfläche als Verlässlichkeit angezeigt. */
  sicherheit: number
  begruendung: string
  initiativ: boolean
}

const INITIATIV_MUSTER =
  /\b(initiativbewerbung|initiativ-bewerbung|blindbewerbung|unaufgeforderte bewerbung|spekulative bewerbung|speculative application|initiative application)\b/i

export function ordneStelleZu(
  betreff: string,
  text: string,
  stellen: Job[],
  hinweisAusPortal?: string,
): StellenTreffer {
  const suchraum = `${hinweisAusPortal ?? ''} ${betreff} ${text.slice(0, 2000)}`.toLowerCase()

  if (INITIATIV_MUSTER.test(suchraum)) {
    return {
      jobId: stellen.find((s) => s.speculative)?.id ?? null,
      sicherheit: 0.9,
      begruendung: 'Der Text nennt ausdrücklich eine Initiativbewerbung.',
      initiativ: true,
    }
  }

  const offene = stellen.filter((s) => s.status === 'OFFEN' && !s.speculative)
  const kandidaten = offene.length > 0 ? offene : stellen.filter((s) => !s.speculative)

  const bewertungen = kandidaten.map((stelle) => bewerteStelle(stelle, suchraum))
  bewertungen.sort((a, b) => b.punkte - a.punkte)

  const bester = bewertungen[0]
  const zweiter = bewertungen[1]

  if (!bester || bester.punkte === 0) {
    return {
      jobId: null,
      sicherheit: 0,
      begruendung: 'Keine Stelle im Betreff oder Text erkannt.',
      initiativ: false,
    }
  }

  // Zwei fast gleich gute Treffer heißen: nicht raten.
  if (zweiter && bester.punkte - zweiter.punkte < 2) {
    return {
      jobId: null,
      sicherheit: 0.3,
      begruendung: `Mehrere Stellen passen ähnlich gut (${bester.stelle.title}, ${zweiter.stelle.title}).`,
      initiativ: false,
    }
  }

  return {
    jobId: bester.stelle.id,
    sicherheit: Math.min(1, bester.punkte / 10),
    begruendung: bester.begruendung,
    initiativ: false,
  }
}

function bewerteStelle(
  stelle: Job,
  suchraum: string,
): { stelle: Job; punkte: number; begruendung: string } {
  let punkte = 0
  const gruende: string[] = []

  // Die Referenznummer ist ein eindeutiger Schlüssel – sie wiegt am schwersten.
  if (stelle.reference && stelle.reference.length >= 3) {
    if (suchraum.includes(stelle.reference.toLowerCase())) {
      punkte += 10
      gruende.push(`Referenz ${stelle.reference} im Text`)
    }
  }

  const titel = stelle.title.toLowerCase().trim()
  if (titel.length >= 4 && suchraum.includes(titel)) {
    punkte += 6
    gruende.push(`Stellentitel „${stelle.title}" im Text`)
  } else {
    // Kein wörtlicher Treffer: einzelne aussagekräftige Wörter zählen.
    const woerter = titel.split(/[\s/(),-]+/).filter((w) => w.length >= 5 && !FUELLWOERTER.has(w))
    const treffer = woerter.filter((w) => suchraum.includes(w))
    if (woerter.length > 0 && treffer.length >= Math.ceil(woerter.length / 2)) {
      punkte += 3
      gruende.push(`Teile des Stellentitels (${treffer.join(', ')})`)
    }
  }

  for (const stichwort of stelle.keywords) {
    const wort = stichwort.toLowerCase().trim()
    if (wort.length >= 3 && suchraum.includes(wort)) {
      punkte += 4
      gruende.push(`Stichwort „${stichwort}"`)
    }
  }

  return {
    stelle,
    punkte,
    begruendung: gruende.length ? gruende.join('; ') : 'Kein Treffer',
  }
}

/** Wörter, die in fast jedem Stellentitel vorkommen und nichts unterscheiden. */
const FUELLWOERTER = new Set([
  'mitarbeiter',
  'mitarbeiterin',
  'vollzeit',
  'teilzeit',
  'gesucht',
  'stelle',
  'position',
  'bereich',
  'divers',
  'weiblich',
  'maennlich',
  'männlich',
])
