import { getSetting } from '../settings/service'

/**
 * KI-Anbindung über eine OpenAI-kompatible Schnittstelle.
 *
 * Damit läuft dasselbe Stück Code gegen OpenAI, Anthropic, Azure OpenAI und
 * lokal gegen Ollama – der Betreiber wählt frei und bringt seinen eigenen
 * Schlüssel mit (BYOK).
 *
 * Die Anbieter unterscheiden sich darin, wie streng sie JSON erzwingen
 * können. Deshalb drei Stufen, absteigend:
 *   1. json_schema – erzwingt die Struktur (OpenAI, Azure, neuere Ollama)
 *   2. json_object – erzwingt wenigstens gültiges JSON
 *   3. gar nichts – JSON wird aus dem Text herausgeschnitten
 * Was ein Endpunkt kann, merkt sich der Client nach dem ersten Versuch.
 */

export class KiFehler extends Error {
  constructor(
    message: string,
    public ursache?: unknown,
  ) {
    super(message)
    this.name = 'KiFehler'
  }
}

type JsonModus = 'json_schema' | 'json_object' | 'keiner'

/** Je Endpunkt gemerkt, damit nicht jede Anfrage die Stufen durchprobiert. */
const koennenNach = new Map<string, JsonModus>()

export interface KiAnfrage {
  systemPrompt: string
  nutzerPrompt: string
  /** JSON-Schema für die erwartete Antwort. */
  schema: object
  schemaName: string
  /** Kürzere Antworten für kleine Aufgaben sparen Zeit und Kosten. */
  maxTokens?: number
}

export interface KiAntwort<T> {
  daten: T
  modell: string
  /** Wie streng das JSON erzwungen wurde – für die Anzeige im Protokoll. */
  modus: JsonModus
}

export async function frageKi<T>(anfrage: KiAnfrage): Promise<KiAntwort<T>> {
  const ki = await getSetting('ki')
  if (!ki.aktiv) throw new KiFehler('Die KI ist ausgeschaltet.')
  if (!ki.basisUrl) throw new KiFehler('Es ist kein KI-Endpunkt hinterlegt.')

  const endpunkt = `${ki.basisUrl.replace(/\/+$/, '')}/chat/completions`
  const stufen: JsonModus[] = ['json_schema', 'json_object', 'keiner']
  const gemerkt = koennenNach.get(endpunkt)
  const zuProbieren = gemerkt ? [gemerkt, ...stufen.filter((s) => s !== gemerkt)] : stufen

  let letzterFehler: unknown

  for (const modus of zuProbieren) {
    try {
      const roh = await sendeAnfrage(endpunkt, ki, anfrage, modus)
      const daten = parseJson<T>(roh)
      koennenNach.set(endpunkt, modus)
      return { daten, modell: ki.modell, modus }
    } catch (err) {
      letzterFehler = err
      // Ein Verbindungs- oder Schlüsselproblem löst sich nicht dadurch, dass
      // wir es mit einer schwächeren JSON-Stufe erneut versuchen.
      if (err instanceof KiFehler && !err.message.includes('response_format')) throw err
    }
  }

  throw new KiFehler(
    `Die KI-Antwort ließ sich nicht auswerten: ${
      letzterFehler instanceof Error ? letzterFehler.message : String(letzterFehler)
    }`,
    letzterFehler,
  )
}

async function sendeAnfrage(
  endpunkt: string,
  ki: Awaited<ReturnType<typeof getSetting<'ki'>>>,
  anfrage: KiAnfrage,
  modus: JsonModus,
): Promise<string> {
  const koerper: Record<string, unknown> = {
    model: ki.modell,
    // Wenig Streuung: Wir wollen eine Extraktion, keine Erfindung.
    temperature: 0,
    max_tokens: anfrage.maxTokens ?? 1500,
    messages: [
      { role: 'system', content: anfrage.systemPrompt },
      { role: 'user', content: anfrage.nutzerPrompt },
    ],
  }

  if (modus === 'json_schema') {
    koerper.response_format = {
      type: 'json_schema',
      json_schema: { name: anfrage.schemaName, strict: true, schema: anfrage.schema },
    }
  } else if (modus === 'json_object') {
    koerper.response_format = { type: 'json_object' }
  }

  const abbruch = AbortSignal.timeout(ki.timeoutSekunden * 1000)

  let antwort: Response
  try {
    antwort = await fetch(endpunkt, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Ollama braucht keinen Schlüssel; der Header stört dort aber nicht.
        ...(ki.apiKey ? { Authorization: `Bearer ${ki.apiKey}` } : {}),
      },
      body: JSON.stringify(koerper),
      signal: abbruch,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new KiFehler(
        `Die KI hat innerhalb von ${ki.timeoutSekunden} Sekunden nicht geantwortet. ` +
          `Bei einem lokalen Modell (Ollama) lohnt sich ein höherer Wert – der erste Aufruf lädt das Modell erst in den Arbeitsspeicher.`,
      )
    }
    throw new KiFehler(`Der KI-Endpunkt ist nicht erreichbar: ${(err as Error).message}`, err)
  }

  if (!antwort.ok) {
    const text = await antwort.text().catch(() => '')
    // Kennt der Endpunkt das Format nicht, meldet er meist 400 mit einem
    // Hinweis darauf – dann greift die nächstschwächere Stufe.
    if (antwort.status === 400 && /response_format|json_schema|schema/i.test(text)) {
      throw new KiFehler(`response_format wird nicht unterstützt: ${text.slice(0, 200)}`)
    }
    throw new KiFehler(uebersetzeFehler(antwort.status, text))
  }

  const ergebnis = (await antwort.json()) as {
    choices?: { message?: { content?: string } }[]
    error?: { message?: string }
  }
  if (ergebnis.error?.message) throw new KiFehler(ergebnis.error.message)

  const inhalt = ergebnis.choices?.[0]?.message?.content
  if (!inhalt) throw new KiFehler('Die KI hat eine leere Antwort geliefert.')
  return inhalt
}

/**
 * Holt das JSON aus der Antwort. Kleine Modelle rahmen es gern in
 * Markdown-Blöcke oder stellen einen Satz voran – beides wird abgeräumt.
 */
export function parseJson<T>(roh: string): T {
  const ohneRahmen = roh
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()

  try {
    return JSON.parse(ohneRahmen) as T
  } catch {
    // Zweiter Versuch: das äußerste Objekt aus dem Text schneiden.
    const start = ohneRahmen.indexOf('{')
    const ende = ohneRahmen.lastIndexOf('}')
    if (start >= 0 && ende > start) {
      try {
        return JSON.parse(ohneRahmen.slice(start, ende + 1)) as T
      } catch {
        // fällt durch
      }
    }
    throw new KiFehler(`Die Antwort war kein gültiges JSON: ${ohneRahmen.slice(0, 200)}`)
  }
}

function uebersetzeFehler(status: number, koerper: string): string {
  if (status === 401 || status === 403) {
    return 'Der API-Schlüssel wurde abgelehnt. Bitte unter Einstellungen → KI prüfen.'
  }
  if (status === 404) {
    return 'Endpunkt oder Modell nicht gefunden. Stimmen Basis-URL und Modellname?'
  }
  if (status === 429) {
    return 'Der Anbieter drosselt gerade die Anfragen. Bitte später erneut versuchen.'
  }
  if (status >= 500) {
    return `Der KI-Anbieter meldet einen Serverfehler (${status}).`
  }
  return `Die KI-Anfrage ist fehlgeschlagen (${status}): ${koerper.slice(0, 200)}`
}

/** Prüft die Anbindung mit einer winzigen Anfrage. */
export async function pruefeKiVerbindung(): Promise<{ ok: boolean; meldung: string; modus?: string }> {
  try {
    const ergebnis = await frageKi<{ antwort: string }>({
      systemPrompt: 'Du antwortest ausschließlich mit JSON.',
      nutzerPrompt: 'Antworte mit {"antwort":"bereit"}.',
      schemaName: 'pruefung',
      schema: {
        type: 'object',
        properties: { antwort: { type: 'string' } },
        required: ['antwort'],
        additionalProperties: false,
      },
      maxTokens: 50,
    })
    return {
      ok: true,
      meldung: `Verbunden mit ${ergebnis.modell}.`,
      modus:
        ergebnis.modus === 'json_schema'
          ? 'Antwortstruktur wird erzwungen (JSON-Schema)'
          : ergebnis.modus === 'json_object'
            ? 'Gültiges JSON wird erzwungen'
            : 'JSON wird aus dem Text gelesen – die Trefferquote ist etwas niedriger',
    }
  } catch (err) {
    return { ok: false, meldung: err instanceof Error ? err.message : 'Die Prüfung ist fehlgeschlagen.' }
  }
}

/** Nur für Tests: gemerkte Fähigkeiten vergessen. */
export function vergissKoennen(): void {
  koennenNach.clear()
}
