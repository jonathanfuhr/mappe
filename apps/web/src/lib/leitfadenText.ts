import type { GespraechsAbschnitt } from './typen'

/**
 * Gesprächsleitfäden als Text schreiben und lesen.
 *
 * Ein Fragenkatalog kommt fast nie leer auf die Welt – er liegt als Dokument
 * vor, in einer Mail oder in einer alten Vorlage. Ihn Feld für Feld
 * abzutippen ist die unangenehmste Art, ihn zu erfassen. Deshalb ist die
 * Textform hier gleichberechtigt: einfügen, kurz nachsehen, fertig.
 *
 * Das Format ist bewusst schlichtes Markdown, damit ein kopiertes Dokument oft
 * schon ohne Nacharbeit passt:
 *
 *     # Name des Leitfadens
 *
 *     ## Berufliche Erfahrung
 *
 *     Was hat Sie an dieser Stelle angesprochen?
 *     > Nachhaken, wenn die Antwort allgemein bleibt
 *
 *     - Auch ein Listenpunkt gilt als Frage
 *     1. Eine Nummerierung ebenso
 *
 * Hinweise stehen als Zitat (`>`) und nicht mit `*`, obwohl das naheliegt:
 * In Markdown ist `*` ein Listenzeichen. Wer eine Fragenliste einfügt, die mit
 * `* ` beginnt – und das ist der häufigste Fall überhaupt –, bekäme sonst
 * lauter Hinweise ohne eine einzige Frage.
 */

/** Fällt zurück, wenn Fragen ohne vorangestellte Überschrift stehen. */
export const STANDARD_ABSCHNITT = 'Fragen'

function neueFrageId(): string {
  return `f${Math.random().toString(36).slice(2, 10)}`
}

export interface GelesenerLeitfaden {
  name: string | null
  abschnitte: GespraechsAbschnitt[]
}

/**
 * Liest die Textform.
 *
 * `bisherige` sind die Abschnitte, wie sie vor dem Bearbeiten gespeichert
 * waren. Findet sich eine Frage mit **demselben Text** wieder, behält sie ihre
 * bisherige Kennung. Das ist keine Feinheit: An den Kennungen hängen die
 * Antworten bereits geführter Gespräche. Würde beim Speichern jede Frage eine
 * neue bekommen, stünden alle früheren Antworten auf einmal im Leeren.
 */
export function leseLeitfadenText(
  text: string,
  bisherige: GespraechsAbschnitt[] = [],
): GelesenerLeitfaden {
  // Frühere Kennungen nach Fragetext nachschlagen. Kommt derselbe Text
  // mehrfach vor, wird jede Kennung nur einmal vergeben – sonst trügen zwei
  // Fragen dieselbe, und die Antworten der einen landeten bei der anderen.
  const bekannt = new Map<string, string[]>()
  for (const abschnitt of bisherige) {
    for (const frage of abschnitt.questions) {
      const schluessel = frage.text.trim()
      if (!schluessel) continue
      bekannt.set(schluessel, [...(bekannt.get(schluessel) ?? []), frage.id])
    }
  }
  const holeId = (text: string): string => {
    const vorrat = bekannt.get(text.trim())
    return vorrat?.shift() ?? neueFrageId()
  }

  let name: string | null = null
  const abschnitte: GespraechsAbschnitt[] = []

  const neuerAbschnitt = (titel: string) => {
    abschnitte.push({ title: titel, questions: [] })
    return abschnitte[abschnitte.length - 1]
  }
  const aktueller = () => abschnitte[abschnitte.length - 1] ?? neuerAbschnitt(STANDARD_ABSCHNITT)

  for (const rohZeile of text.split(/\r?\n/)) {
    const zeile = rohZeile.trim()
    if (!zeile) continue

    // Überschrift erster Ebene: der Name des Leitfadens. Nur die erste zählt –
    // eine zweite wäre ein zweiter Leitfaden, und den gibt es hier nicht.
    const h1 = /^#\s+(.*)$/.exec(zeile)
    if (h1) {
      if (name === null) name = h1[1].trim()
      else neuerAbschnitt(h1[1].trim())
      continue
    }

    // Jede tiefere Überschrift ist ein Abschnitt. Auch ### und tiefer, damit
    // ein kopiertes Dokument mit eigener Gliederung nicht zerfällt.
    const hn = /^#{2,6}\s+(.*)$/.exec(zeile)
    if (hn) {
      const titel = hn[1].trim()
      if (titel) neuerAbschnitt(titel)
      continue
    }

    // Zitat: Hinweis zur zuletzt gelesenen Frage.
    const zitat = /^>\s?(.*)$/.exec(zeile)
    if (zitat) {
      const abschnitt = aktueller()
      const letzte = abschnitt.questions[abschnitt.questions.length - 1]
      const zusatz = zitat[1].trim()
      if (letzte && zusatz) {
        letzte.hint = letzte.hint ? `${letzte.hint} ${zusatz}` : zusatz
      }
      continue
    }

    // Alles Übrige ist eine Frage – ob als Aufzählung, Nummerierung oder
    // schlichter Absatz geschrieben.
    const ohneMarker = zeile.replace(/^([-*+]|\d+[.)])\s+/, '').trim()
    if (!ohneMarker) continue
    aktueller().questions.push({ id: holeId(ohneMarker), text: ohneMarker })
  }

  // Abschnitte ohne eine einzige Frage sind für das Gespräch wertlos: eine
  // Überschrift, unter der nichts steht.
  return { name, abschnitte: abschnitte.filter((a) => a.questions.length > 0) }
}

/**
 * Schreibt die Textform.
 *
 * Damit lässt sich ein bestehender Leitfaden im selben Feld weiterbearbeiten,
 * in dem er angelegt wurde – und nicht nur ein neuer einfügen.
 */
export function schreibeLeitfadenText(name: string, abschnitte: GespraechsAbschnitt[]): string {
  const zeilen: string[] = []
  if (name.trim()) zeilen.push(`# ${name.trim()}`, '')

  for (const abschnitt of abschnitte) {
    zeilen.push(`## ${abschnitt.title}`, '')
    for (const frage of abschnitt.questions) {
      zeilen.push(frage.text)
      if (frage.hint?.trim()) zeilen.push(`> ${frage.hint.trim()}`)
      zeilen.push('')
    }
  }

  return zeilen.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Grenzen, die der Server beim Speichern durchsetzt (siehe `vorlagenSchema`
 * in `routes/gespraeche.ts`). Sie stehen hier noch einmal, damit ein zu
 * langes Dokument schon in der Vorschau auffällt statt erst beim Speichern
 * mit einer Fehlermeldung, die niemand einem einzelnen Absatz zuordnen kann.
 */
export const GRENZEN = {
  abschnitte: 20,
  fragenJeAbschnitt: 40,
  fragenLaenge: 500,
  titelLaenge: 120,
  namensLaenge: 120,
} as const

/** Was am gelesenen Leitfaden zu lang oder zu viel ist – leer heißt: passt. */
export function pruefeGrenzen(name: string, abschnitte: GespraechsAbschnitt[]): string[] {
  const meldungen: string[] = []

  if (name.length > GRENZEN.namensLaenge) {
    meldungen.push(`Der Name ist länger als ${GRENZEN.namensLaenge} Zeichen.`)
  }
  if (abschnitte.length > GRENZEN.abschnitte) {
    meldungen.push(`Mehr als ${GRENZEN.abschnitte} Abschnitte (${abschnitte.length}).`)
  }

  for (const abschnitt of abschnitte) {
    if (abschnitt.title.length > GRENZEN.titelLaenge) {
      meldungen.push(`Überschrift „${abschnitt.title.slice(0, 30)}…" ist zu lang.`)
    }
    if (abschnitt.questions.length > GRENZEN.fragenJeAbschnitt) {
      meldungen.push(
        `„${abschnitt.title}" hat ${abschnitt.questions.length} Fragen – erlaubt sind ${GRENZEN.fragenJeAbschnitt}.`,
      )
    }
    for (const frage of abschnitt.questions) {
      if (frage.text.length > GRENZEN.fragenLaenge) {
        meldungen.push(`Eine Frage in „${abschnitt.title}" ist länger als ${GRENZEN.fragenLaenge} Zeichen.`)
        break
      }
    }
  }

  return meldungen
}
