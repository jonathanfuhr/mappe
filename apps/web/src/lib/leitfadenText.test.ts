import { describe, expect, it } from 'vitest'
import {
  GRENZEN,
  leseLeitfadenText,
  pruefeGrenzen,
  schreibeLeitfadenText,
  STANDARD_ABSCHNITT,
} from './leitfadenText'
import type { GespraechsAbschnitt } from './typen'

/**
 * Der Parser bekommt Text, den jemand aus einem fremden Dokument einfügt.
 * Entsprechend nachsichtig muss er sein – und entsprechend genau geprüft.
 */

describe('Textform lesen', () => {
  it('liest Name, Abschnitte und Fragen', () => {
    const { name, abschnitte } = leseLeitfadenText(
      ['# Erstgespräch', '', '## Einstieg', '', 'Warum diese Stelle?', 'Was reizt Sie daran?'].join('\n'),
    )

    expect(name).toBe('Erstgespräch')
    expect(abschnitte).toHaveLength(1)
    expect(abschnitte[0].title).toBe('Einstieg')
    expect(abschnitte[0].questions.map((f) => f.text)).toEqual([
      'Warum diese Stelle?',
      'Was reizt Sie daran?',
    ])
  })

  it('nimmt Aufzählungen und Nummerierungen als Fragen', () => {
    const { abschnitte } = leseLeitfadenText(
      ['## Erfahrung', '- Erste Frage', '* Zweite Frage', '+ Dritte Frage', '1. Vierte Frage', '2) Fünfte Frage'].join(
        '\n',
      ),
    )

    expect(abschnitte[0].questions.map((f) => f.text)).toEqual([
      'Erste Frage',
      'Zweite Frage',
      'Dritte Frage',
      'Vierte Frage',
      'Fünfte Frage',
    ])
  })

  it('hängt ein Zitat als Hinweis an die Frage davor', () => {
    const { abschnitte } = leseLeitfadenText(
      ['## Einstieg', 'Warum diese Stelle?', '> Nachhaken, wenn es allgemein bleibt', 'Nächste Frage'].join('\n'),
    )

    expect(abschnitte[0].questions[0].hint).toBe('Nachhaken, wenn es allgemein bleibt')
    expect(abschnitte[0].questions[1].hint).toBeUndefined()
  })

  it('fasst mehrzeilige Hinweise zusammen', () => {
    const { abschnitte } = leseLeitfadenText(
      ['## A', 'Eine Frage?', '> Erster Teil', '> Zweiter Teil'].join('\n'),
    )

    expect(abschnitte[0].questions[0].hint).toBe('Erster Teil Zweiter Teil')
  })

  it('sammelt Fragen ohne Überschrift in einem Standardabschnitt', () => {
    const { abschnitte } = leseLeitfadenText(['Einfach nur eine Frage?', 'Und noch eine?'].join('\n'))

    expect(abschnitte).toHaveLength(1)
    expect(abschnitte[0].title).toBe(STANDARD_ABSCHNITT)
    expect(abschnitte[0].questions).toHaveLength(2)
  })

  it('wirft Abschnitte ohne Fragen weg', () => {
    const { abschnitte } = leseLeitfadenText(['## Leer', '', '## Voll', 'Eine Frage?'].join('\n'))

    expect(abschnitte.map((a) => a.title)).toEqual(['Voll'])
  })

  it('nimmt auch tiefere Überschriften als Abschnitt', () => {
    const { abschnitte } = leseLeitfadenText(['### Tief', 'Eine Frage?'].join('\n'))

    expect(abschnitte[0].title).toBe('Tief')
  })

  it('behandelt eine zweite Überschrift erster Ebene als Abschnitt', () => {
    // Sonst ginge beim Einfügen zweier Dokumente hintereinander alles
    // verloren, was unter der zweiten Überschrift steht.
    const { name, abschnitte } = leseLeitfadenText(
      ['# Erster', 'Frage A?', '# Zweiter', 'Frage B?'].join('\n'),
    )

    expect(name).toBe('Erster')
    expect(abschnitte.map((a) => a.title)).toEqual([STANDARD_ABSCHNITT, 'Zweiter'])
  })

  it('kommt mit Windows-Zeilenenden und Leerzeilen zurecht', () => {
    const { abschnitte } = leseLeitfadenText('## A\r\n\r\nFrage eins?\r\n\r\n\r\nFrage zwei?\r\n')

    expect(abschnitte[0].questions).toHaveLength(2)
  })

  it('liefert für leeren Text nichts', () => {
    const { name, abschnitte } = leseLeitfadenText('   \n\n  ')

    expect(name).toBeNull()
    expect(abschnitte).toEqual([])
  })
})

describe('Kennungen bleiben stabil', () => {
  const bisherige: GespraechsAbschnitt[] = [
    {
      title: 'Einstieg',
      questions: [
        { id: 'alt-1', text: 'Warum diese Stelle?' },
        { id: 'alt-2', text: 'Was reizt Sie daran?' },
      ],
    },
  ]

  it('behält die Kennung einer unveränderten Frage', () => {
    // Daran hängen die Antworten bereits geführter Gespräche.
    const { abschnitte } = leseLeitfadenText(
      ['## Einstieg', 'Warum diese Stelle?', 'Was reizt Sie daran?'].join('\n'),
      bisherige,
    )

    expect(abschnitte[0].questions.map((f) => f.id)).toEqual(['alt-1', 'alt-2'])
  })

  it('behält sie auch, wenn die Frage in einen anderen Abschnitt wandert', () => {
    const { abschnitte } = leseLeitfadenText(['## Ganz woanders', 'Warum diese Stelle?'].join('\n'), bisherige)

    expect(abschnitte[0].questions[0].id).toBe('alt-1')
  })

  it('vergibt für eine neu formulierte Frage eine neue Kennung', () => {
    const { abschnitte } = leseLeitfadenText(['## Einstieg', 'Warum gerade wir?'].join('\n'), bisherige)

    expect(abschnitte[0].questions[0].id).not.toBe('alt-1')
    expect(abschnitte[0].questions[0].id).not.toBe('alt-2')
  })

  it('vergibt dieselbe alte Kennung nicht zweimal', () => {
    // Zwei gleichlautende Fragen dürfen nicht dieselbe Kennung tragen – sonst
    // landete die Antwort der einen bei der anderen.
    const { abschnitte } = leseLeitfadenText(
      ['## Einstieg', 'Warum diese Stelle?', 'Warum diese Stelle?'].join('\n'),
      bisherige,
    )

    const [erste, zweite] = abschnitte[0].questions
    expect(erste.id).toBe('alt-1')
    expect(zweite.id).not.toBe('alt-1')
  })
})

describe('Hin und zurück', () => {
  it('überlebt den Weg durch Text und zurück unverändert', () => {
    const abschnitte: GespraechsAbschnitt[] = [
      {
        title: 'Einstieg',
        questions: [
          { id: 'a', text: 'Warum diese Stelle?', hint: 'Nachhaken' },
          { id: 'b', text: 'Was reizt Sie daran?' },
        ],
      },
      { title: 'Abschluss', questions: [{ id: 'c', text: 'Ihre Fragen an uns?' }] },
    ]

    const text = schreibeLeitfadenText('Erstgespräch', abschnitte)
    const zurueck = leseLeitfadenText(text, abschnitte)

    expect(zurueck.name).toBe('Erstgespräch')
    expect(zurueck.abschnitte).toEqual(abschnitte)
  })
})

describe('Ein echtes Dokument', () => {
  // Der eigentliche Zweck: Was jemand aus einer Datei kopiert, soll ohne
  // Nacharbeit passen – gemischte Schreibweisen inklusive.
  const dokument = `# Strukturiertes Interview – Projektmanagement

## Einstieg und Werdegang

Erzählen Sie kurz von Ihrem beruflichen Werdegang.
> Auf Brüche achten, aber nicht darauf herumreiten

Was hat Sie an unserer Ausschreibung angesprochen?

## Fachliche Eignung

1. Welche Projektmanagement-Methoden haben Sie eingesetzt?
2. Schildern Sie ein Projekt, das aus dem Ruder lief.
   > Interessant ist die Reaktion, nicht der Fehler
3. Wie priorisieren Sie bei knappen Ressourcen?

## Zusammenarbeit

- Wie gehen Sie mit Widerspruch im Team um?
- Was erwarten Sie von einer Führungskraft?

## Abschluss

Welche Fragen haben Sie an uns?
`

  it('schlüsselt gemischte Schreibweisen richtig auf', () => {
    const { name, abschnitte } = leseLeitfadenText(dokument)

    expect(name).toBe('Strukturiertes Interview – Projektmanagement')
    expect(abschnitte.map((a) => a.title)).toEqual([
      'Einstieg und Werdegang',
      'Fachliche Eignung',
      'Zusammenarbeit',
      'Abschluss',
    ])
    expect(abschnitte.map((a) => a.questions.length)).toEqual([2, 3, 2, 1])
  })

  it('ordnet eingerückte Hinweise der richtigen Frage zu', () => {
    const { abschnitte } = leseLeitfadenText(dokument)
    const fachlich = abschnitte[1]

    expect(fachlich.questions[1].text).toBe('Schildern Sie ein Projekt, das aus dem Ruder lief.')
    expect(fachlich.questions[1].hint).toBe('Interessant ist die Reaktion, nicht der Fehler')
    expect(fachlich.questions[0].hint).toBeUndefined()
    expect(fachlich.questions[2].hint).toBeUndefined()
  })

  it('bleibt in den Grenzen, die der Server annimmt', () => {
    // Der Server nimmt höchstens 20 Abschnitte, 40 Fragen je Abschnitt und
    // 500 Zeichen je Frage. Was hier durchrutscht, würde beim Speichern
    // abgelehnt.
    const { abschnitte } = leseLeitfadenText(dokument)

    expect(abschnitte.length).toBeLessThanOrEqual(20)
    for (const abschnitt of abschnitte) {
      expect(abschnitt.title.length).toBeLessThanOrEqual(120)
      expect(abschnitt.questions.length).toBeLessThanOrEqual(40)
      for (const frage of abschnitt.questions) {
        expect(frage.text.length).toBeLessThanOrEqual(500)
        expect(frage.id.length).toBeLessThanOrEqual(60)
      }
    }
  })
})

describe('Grenzen des Servers', () => {
  const frage = (i: number) => ({ id: `f${i}`, text: `Frage ${i}?` })

  it('meldet nichts bei einem gewöhnlichen Leitfaden', () => {
    expect(pruefeGrenzen('Erstgespräch', [{ title: 'A', questions: [frage(1)] }])).toEqual([])
  })

  it('meldet zu viele Fragen in einem Abschnitt', () => {
    const zuViele = Array.from({ length: GRENZEN.fragenJeAbschnitt + 1 }, (_, i) => frage(i))
    const meldungen = pruefeGrenzen('Name', [{ title: 'Voll', questions: zuViele }])

    expect(meldungen).toHaveLength(1)
    expect(meldungen[0]).toContain('Voll')
  })

  it('meldet zu viele Abschnitte', () => {
    const zuViele = Array.from({ length: GRENZEN.abschnitte + 1 }, (_, i) => ({
      title: `A${i}`,
      questions: [frage(i)],
    }))

    expect(pruefeGrenzen('Name', zuViele)[0]).toContain('Abschnitte')
  })

  it('meldet eine zu lange Frage nur einmal je Abschnitt', () => {
    const lang = { id: 'x', text: 'x'.repeat(GRENZEN.fragenLaenge + 1) }
    const meldungen = pruefeGrenzen('Name', [{ title: 'A', questions: [lang, { ...lang, id: 'y' }] }])

    expect(meldungen).toHaveLength(1)
  })
})
