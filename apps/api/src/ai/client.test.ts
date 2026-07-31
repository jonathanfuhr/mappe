import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../db'
import { clearSettingsCache, updateSetting } from '../settings/service'
import { klassifiziereSeiten } from './aufgaben'
import { frageKi, KiFehler, parseJson, pruefeKiVerbindung, vergissKoennen } from './client'

/**
 * Geprüft wird gegen einen nachgebauten Endpunkt, nicht gegen einen echten
 * Anbieter. Interessant ist nämlich genau das, was zwischen den Anbietern
 * abweicht: wie streng sie JSON erzwingen können und wie sauber ihre Antwort
 * herauskommt.
 */

interface Verhalten {
  /** Formate, die der nachgebaute Endpunkt annimmt. */
  akzeptiert: ('json_schema' | 'json_object' | 'keiner')[]
  antwort: string
  status?: number
}

let server: http.Server
let basisUrl: string
let verhalten: Verhalten
let letzteAnfragen: Record<string, unknown>[] = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let koerper = ''
    req.on('data', (teil) => (koerper += teil))
    req.on('end', () => {
      const anfrage = JSON.parse(koerper || '{}') as Record<string, unknown>
      letzteAnfragen.push(anfrage)

      const format = anfrage.response_format as { type?: string } | undefined
      const modus = format?.type === 'json_schema' ? 'json_schema' : format?.type === 'json_object' ? 'json_object' : 'keiner'

      if (verhalten.status && verhalten.status !== 200) {
        res.writeHead(verhalten.status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Absichtlicher Fehler' } }))
        return
      }

      if (!verhalten.akzeptiert.includes(modus)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: `response_format ${modus} wird nicht unterstützt` } }))
        return
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: verhalten.antwort } }] }))
    })
  })

  await new Promise<void>((fertig) => server.listen(0, '127.0.0.1', fertig))
  basisUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
})

afterAll(async () => {
  await new Promise<void>((fertig) => server.close(() => fertig()))
  await prisma.setting.deleteMany({ where: { key: 'ki' } })
  await prisma.$disconnect()
})

afterEach(() => {
  letzteAnfragen = []
  vergissKoennen()
  clearSettingsCache()
})

async function stelleEin(teil: Record<string, unknown> = {}): Promise<void> {
  await updateSetting('ki', {
    aktiv: true,
    basisUrl,
    apiKey: 'test-schluessel',
    modell: 'test-modell',
    timeoutSekunden: 10,
    ...teil,
  })
  clearSettingsCache()
}

const EINFACHES_SCHEMA = {
  type: 'object',
  properties: { wert: { type: 'string' } },
  required: ['wert'],
  additionalProperties: false,
}

function anfrage() {
  return {
    systemPrompt: 'System',
    nutzerPrompt: 'Nutzer',
    schema: EINFACHES_SCHEMA,
    schemaName: 'test',
  }
}

describe('JSON aus der Antwort holen', () => {
  it('liest sauberes JSON', () => {
    expect(parseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 })
  })

  it('räumt einen Markdown-Block ab', () => {
    // Kleine Modelle rahmen ihre Antwort gern so ein.
    expect(parseJson<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('schneidet das Objekt aus vorangestelltem Geplauder', () => {
    expect(parseJson<{ a: number }>('Gern! Hier das Ergebnis: {"a":1} Viel Erfolg!')).toEqual({ a: 1 })
  })

  it('meldet unbrauchbare Antworten als Fehler', () => {
    expect(() => parseJson('Tut mir leid, das kann ich nicht.')).toThrow(KiFehler)
  })
})

describe('Rückfall über die Formatstufen', () => {
  it('nutzt json_schema, wenn der Endpunkt es kann', async () => {
    await stelleEin()
    verhalten = { akzeptiert: ['json_schema'], antwort: '{"wert":"ok"}' }

    const ergebnis = await frageKi<{ wert: string }>(anfrage())

    expect(ergebnis.daten.wert).toBe('ok')
    expect(ergebnis.modus).toBe('json_schema')
    expect(letzteAnfragen).toHaveLength(1)
  })

  it('fällt auf json_object zurück, wenn json_schema abgelehnt wird', async () => {
    await stelleEin()
    verhalten = { akzeptiert: ['json_object'], antwort: '{"wert":"ok"}' }

    const ergebnis = await frageKi<{ wert: string }>(anfrage())

    expect(ergebnis.modus).toBe('json_object')
    // Erst der Versuch mit Schema, dann der erfolgreiche.
    expect(letzteAnfragen).toHaveLength(2)
  })

  it('kommt auch ohne jede Formatvorgabe zurecht', async () => {
    // Das ist der Fall bei älteren Ollama-Fassungen.
    await stelleEin()
    verhalten = { akzeptiert: ['keiner'], antwort: '```json\n{"wert":"ok"}\n```' }

    const ergebnis = await frageKi<{ wert: string }>(anfrage())

    expect(ergebnis.daten.wert).toBe('ok')
    expect(ergebnis.modus).toBe('keiner')
    expect(letzteAnfragen).toHaveLength(3)
  })

  it('merkt sich die passende Stufe für die nächste Anfrage', async () => {
    await stelleEin()
    verhalten = { akzeptiert: ['json_object'], antwort: '{"wert":"ok"}' }

    await frageKi<{ wert: string }>(anfrage())
    const nachErstem = letzteAnfragen.length
    letzteAnfragen = []

    await frageKi<{ wert: string }>(anfrage())

    expect(nachErstem).toBe(2)
    // Beim zweiten Mal ohne Fehlversuch.
    expect(letzteAnfragen).toHaveLength(1)
  })

  it('probiert bei einem Schlüsselfehler keine weiteren Stufen', async () => {
    await stelleEin()
    verhalten = { akzeptiert: ['json_schema'], antwort: '', status: 401 }

    await expect(frageKi(anfrage())).rejects.toThrow(/Schlüssel/i)
    expect(letzteAnfragen).toHaveLength(1)
  })
})

describe('Verbindungsprüfung', () => {
  it('meldet Erfolg samt Fähigkeitsstufe', async () => {
    await stelleEin()
    verhalten = { akzeptiert: ['json_schema'], antwort: '{"antwort":"bereit"}' }

    const ergebnis = await pruefeKiVerbindung()

    expect(ergebnis.ok).toBe(true)
    expect(ergebnis.meldung).toContain('test-modell')
    expect(ergebnis.modus).toContain('erzwungen')
  })

  it('meldet einen Fehlschlag im Klartext statt zu werfen', async () => {
    await stelleEin()
    verhalten = { akzeptiert: [], antwort: '', status: 500 }

    const ergebnis = await pruefeKiVerbindung()

    expect(ergebnis.ok).toBe(false)
    expect(ergebnis.meldung).toMatch(/Serverfehler|fehlgeschlagen/i)
  })

  it('läuft gar nicht erst los, wenn die KI ausgeschaltet ist', async () => {
    await stelleEin({ aktiv: false })
    verhalten = { akzeptiert: ['json_schema'], antwort: '{"antwort":"bereit"}' }

    const ergebnis = await pruefeKiVerbindung()

    expect(ergebnis.ok).toBe(false)
    expect(letzteAnfragen).toHaveLength(0)
  })
})

describe('Seitenklassifikation', () => {
  const seiten = [
    { seite: 1, text: 'Bewerbung als Mediengestalter' },
    { seite: 2, text: 'Lebenslauf' },
    { seite: 3, text: 'Fortsetzung' },
  ]

  it('übernimmt eine vollständige Antwort', async () => {
    await stelleEin()
    verhalten = {
      akzeptiert: ['json_schema'],
      antwort: JSON.stringify({
        zuordnung: [
          { seite: 1, kategorie: 'ANSCHREIBEN', begruendung: 'Anschreiben' },
          { seite: 2, kategorie: 'LEBENSLAUF', begruendung: 'Lebenslauf' },
          { seite: 3, kategorie: 'LEBENSLAUF', begruendung: 'Fortsetzung' },
        ],
      }),
    }

    const { zuordnung } = await klassifiziereSeiten(seiten)
    expect(zuordnung.map((z) => z.kategorie)).toEqual(['ANSCHREIBEN', 'LEBENSLAUF', 'LEBENSLAUF'])
  })

  it('ergänzt ausgelassene Seiten mit der Kategorie der Seite davor', async () => {
    // Kleine Modelle lassen gern eine Seite weg – das darf die Split-Ansicht
    // nicht durcheinanderbringen.
    await stelleEin()
    verhalten = {
      akzeptiert: ['json_schema'],
      antwort: JSON.stringify({
        zuordnung: [
          { seite: 1, kategorie: 'ANSCHREIBEN', begruendung: '' },
          { seite: 2, kategorie: 'LEBENSLAUF', begruendung: '' },
        ],
      }),
    }

    const { zuordnung } = await klassifiziereSeiten(seiten)
    expect(zuordnung).toHaveLength(3)
    expect(zuordnung[2].kategorie).toBe('LEBENSLAUF')
    expect(zuordnung[2].begruendung).toContain('wie die Seite davor')
  })

  it('wirft erfundene Kategorien und Seitenzahlen heraus', async () => {
    await stelleEin()
    verhalten = {
      akzeptiert: ['json_schema'],
      antwort: JSON.stringify({
        zuordnung: [
          { seite: 1, kategorie: 'DECKBLATT', begruendung: 'erfunden' },
          { seite: 2, kategorie: 'LEBENSLAUF', begruendung: '' },
          { seite: 99, kategorie: 'ZEUGNISSE', begruendung: 'gibt es nicht' },
        ],
      }),
    }

    const { zuordnung } = await klassifiziereSeiten(seiten)
    expect(zuordnung).toHaveLength(3)
    expect(zuordnung.map((z) => z.seite)).toEqual([1, 2, 3])
    expect(zuordnung[0].kategorie).toBe('ANDERE')
  })
})
