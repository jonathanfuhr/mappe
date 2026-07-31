import type { DocumentCategory } from '@prisma/client'
import type { SeitenText } from './text'

/**
 * Stichwort-Heuristik für die Split-Ansicht.
 *
 * Sie ersetzt keine KI – sie füllt die Ansicht nur vor, damit man korrigiert
 * statt von Null zu klicken. Deshalb ist sie bewusst vorsichtig: Sie erkennt,
 * wo ein neues Dokument *anfängt*, und schreibt die Kategorie bis zur nächsten
 * erkannten Grenze fort. Mehrseitige Zeugnisse bleiben dadurch zusammen.
 */

interface Regel {
  kategorie: DocumentCategory
  /** Wörter, die typischerweise auf der ersten Seite eines Teils stehen. */
  muster: RegExp
  gewicht: number
}

const REGELN: Regel[] = [
  {
    kategorie: 'LEBENSLAUF',
    muster: /\b(lebenslauf|curriculum vitae|resume|résumé|beruflicher werdegang|persönliche daten)\b/i,
    gewicht: 10,
  },
  {
    kategorie: 'LEBENSLAUF',
    muster: /\b(berufserfahrung|ausbildung|schulbildung|qualifikationen|kenntnisse und fähigkeiten)\b/i,
    gewicht: 4,
  },
  {
    kategorie: 'ANSCHREIBEN',
    muster: /\b(bewerbung (als|um|für)|anschreiben|motivationsschreiben|cover letter)\b/i,
    gewicht: 10,
  },
  {
    kategorie: 'ANSCHREIBEN',
    muster: /\b(sehr geehrte[rs]?\s+(damen|frau|herr)|mit freundlichen grüßen|hiermit bewerbe ich mich)\b/i,
    gewicht: 6,
  },
  {
    kategorie: 'ZEUGNISSE',
    muster: /\b(zeugnis|zertifikat|urkunde|bescheinigung|abschlusszeugnis|arbeitszeugnis|praktikumszeugnis|teilnahmebescheinigung|certificate)\b/i,
    gewicht: 10,
  },
  {
    kategorie: 'ZEUGNISSE',
    muster: /\b(gesamtnote|durchschnittsnote|note[n]?\s*:|prüfungsergebnis|zeugnisnote|hat die prüfung)\b/i,
    gewicht: 5,
  },
]

export interface SeitenVorschlag {
  seite: number
  kategorie: DocumentCategory
  /** 0 bis 1 – wie sicher der Vorschlag ist. */
  sicherheit: number
  /** Kurze Begründung für die Anzeige unter dem Vorschaubild. */
  begruendung: string
  /** Hier beginnt ein neues Teildokument. */
  beginntNeuesDokument: boolean
}

export function schlageKategorienVor(seiten: SeitenText[]): SeitenVorschlag[] {
  const vorschlaege: SeitenVorschlag[] = []
  let laufendeKategorie: DocumentCategory = 'ANDERE'
  let laufendeBegruendung = 'Ohne Treffer – der vorherigen Seite zugeordnet.'

  for (const seite of seiten) {
    // Nur den Anfang der Seite prüfen: Überschriften stehen oben, und
    // Fußzeilen mit „Anlagen: Zeugnisse" würden sonst jede Seite umwerfen.
    const kopf = seite.text.slice(0, 700)
    const punkte = new Map<DocumentCategory, number>()
    const gruende = new Map<DocumentCategory, string[]>()

    for (const regel of REGELN) {
      const treffer = regel.muster.exec(kopf)
      if (!treffer) continue
      punkte.set(regel.kategorie, (punkte.get(regel.kategorie) ?? 0) + regel.gewicht)
      const liste = gruende.get(regel.kategorie) ?? []
      liste.push(`„${treffer[0]}"`)
      gruende.set(regel.kategorie, liste)
    }

    const sortiert = [...punkte.entries()].sort((a, b) => b[1] - a[1])
    const bester = sortiert[0]

    // Ab 6 Punkten gilt eine Seite als Anfang eines neuen Teils. Darunter
    // wird sie der laufenden Kategorie zugeschlagen.
    if (bester && bester[1] >= 6) {
      laufendeKategorie = bester[0]
      laufendeBegruendung = (gruende.get(bester[0]) ?? []).slice(0, 3).join(', ')
      vorschlaege.push({
        seite: seite.seite,
        kategorie: bester[0],
        sicherheit: Math.min(1, bester[1] / 14),
        begruendung: laufendeBegruendung,
        beginntNeuesDokument: true,
      })
      continue
    }

    // Eine Seite ganz ohne Text ist meist ein Scan – die Fortschreibung ist
    // dort die einzig sinnvolle Annahme.
    const leer = seite.text.trim().length < 20
    vorschlaege.push({
      seite: seite.seite,
      kategorie: laufendeKategorie,
      sicherheit: leer ? 0.2 : 0.4,
      begruendung: leer
        ? 'Kein Text erkannt (vermutlich ein Scan) – wie die Seite davor.'
        : `Fortsetzung von ${laufendeBegruendung}`,
      beginntNeuesDokument: false,
    })
  }

  return vorschlaege
}

/**
 * Fasst Seitenvorschläge zu zusammenhängenden Bereichen zusammen.
 * Das ist genau die Aufteilung, die beim Auftrennen entsteht.
 */
export function fasseZuBereichen(
  zuordnung: { seite: number; kategorie: DocumentCategory }[],
): { kategorie: DocumentCategory; seiten: number[] }[] {
  const sortiert = [...zuordnung].sort((a, b) => a.seite - b.seite)
  const bereiche: { kategorie: DocumentCategory; seiten: number[] }[] = []

  for (const eintrag of sortiert) {
    const letzter = bereiche[bereiche.length - 1]
    // Nur fortsetzen, wenn Kategorie *und* Seitenfolge lückenlos passen –
    // sonst würden zwei getrennte Zeugnisse zu einer Datei verschmelzen.
    if (letzter && letzter.kategorie === eintrag.kategorie && letzter.seiten[letzter.seiten.length - 1] === eintrag.seite - 1) {
      letzter.seiten.push(eintrag.seite)
    } else {
      bereiche.push({ kategorie: eintrag.kategorie, seiten: [eintrag.seite] })
    }
  }

  return bereiche
}
