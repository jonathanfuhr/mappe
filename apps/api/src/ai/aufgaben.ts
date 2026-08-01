import type { DocumentCategory, Job } from '@prisma/client'
import { z } from 'zod'
import { getSetting } from '../settings/service'
import { frageKi } from './client'

/**
 * Jede Antwort wird nachträglich geprüft – auch dann, wenn sie über ein
 * JSON-Schema angefordert wurde.
 *
 * Der Grund: Ob das Schema wirklich erzwungen wurde, hängt vom Endpunkt ab.
 * Ein kleines Modell hinter Ollama liefert ohne Schemazwang gern „Frau" statt
 * „FRAU" oder einen String, wo eine Liste erwartet wird. Ungeprüft
 * weitergereicht bringt das erst viel später einen Datenbankfehler – an einer
 * Stelle, an der niemand die KI vermutet.
 *
 * Die Schemata sind bewusst nachsichtig: Sie räumen auf, was sich aufräumen
 * lässt, und setzen den Rest auf einen harmlosen Vorgabewert.
 */

/** Nimmt „frau", „Frau", „FRAU" – alles andere wird zu KEINE. */
const anredeSchema = z
  .unknown()
  .transform((wert) => (typeof wert === 'string' ? wert.trim().toUpperCase() : ''))
  .transform((wert) => (['KEINE', 'FRAU', 'HERR', 'DIVERS'].includes(wert) ? wert : 'KEINE'))
  .pipe(z.enum(['KEINE', 'FRAU', 'HERR', 'DIVERS']))

/** Alles, was kein String ist, wird zum leeren String statt zum Fehler. */
const textSchema = z
  .unknown()
  .transform((wert) => (typeof wert === 'string' ? wert.trim() : ''))

/** Auch ein einzelner String kommt als Liste zurück. */
const textListeSchema = z.unknown().transform((wert) => {
  if (Array.isArray(wert)) return wert.filter((e): e is string => typeof e === 'string' && e.trim() !== '')
  if (typeof wert === 'string' && wert.trim()) return [wert.trim()]
  return []
})

const zahlSchema = z.unknown().transform((wert) => {
  const zahl = typeof wert === 'number' ? wert : Number(wert)
  return Number.isFinite(zahl) ? Math.min(1, Math.max(0, zahl)) : 0
})

const jaNeinSchema = z.unknown().transform((wert) => wert === true || wert === 'true')

/**
 * Die vier KI-Aufgaben aus dem Plan. Jede liefert ausschließlich Vorschläge –
 * bestätigt wird immer von Hand.
 *
 * Die KI bekommt grundsätzlich **Text**, nie die Rohdatei: Der PDF-Inhalt wird
 * vorher serverseitig extrahiert. Das spart Tokens und hält Bilder aus der
 * Übertragung heraus.
 */

const SYSTEM =
  'Du unterstützt eine Personalabteilung beim Sichten von Bewerbungen. ' +
  'Du wertest ausschließlich aus, was im Text steht, und erfindest nichts. ' +
  'Bist du dir bei einer Angabe nicht sicher, lässt du sie leer. ' +
  'Du antwortest ausschließlich mit JSON nach dem vorgegebenen Schema.'

/** Kürzt den Text auf das eingestellte Maß und markiert die Kürzung. */
async function kuerze(text: string): Promise<string> {
  const ki = await getSetting('ki')
  if (text.length <= ki.maxZeichen) return text
  return text.slice(0, ki.maxZeichen) + '\n\n[… gekürzt, der Text war länger als eingestellt]'
}

// ---------------------------------------------------------------------------
// 1) Ist das eine Bewerbung? Und auf welche Stelle?
// ---------------------------------------------------------------------------

export interface ErkennungsErgebnis {
  istBewerbung: boolean
  initiativ: boolean
  stellenId: string | null
  sicherheit: number
  begruendung: string
}

export async function erkenneBewerbung(
  betreff: string,
  text: string,
  stellen: Job[],
): Promise<{ ergebnis: ErkennungsErgebnis; modell: string }> {
  const stellenListe = stellen
    .filter((s) => !s.speculative)
    .map((s) => `- id: ${s.id} | Titel: ${s.title}${s.reference ? ` | Referenz: ${s.reference}` : ''}`)
    .join('\n')

  const antwort = await frageKi<ErkennungsErgebnis>({
    systemPrompt: SYSTEM,
    nutzerPrompt: [
      'Prüfe, ob der folgende Text eine Bewerbung ist, und ordne ihn einer Stelle zu.',
      '',
      'Verfügbare Stellen:',
      stellenListe || '(keine)',
      '',
      'Regeln:',
      '- stellenId nur setzen, wenn die Zuordnung eindeutig ist. Im Zweifel null.',
      '- initiativ = true, wenn sich jemand ohne Bezug auf eine konkrete Stelle bewirbt.',
      '- sicherheit ist ein Wert zwischen 0 und 1.',
      '- begruendung in einem kurzen deutschen Satz.',
      '',
      `Betreff: ${betreff}`,
      '',
      'Text:',
      await kuerze(text),
    ].join('\n'),
    schemaName: 'bewerbungserkennung',
    schema: {
      type: 'object',
      properties: {
        istBewerbung: { type: 'boolean' },
        initiativ: { type: 'boolean' },
        stellenId: { type: ['string', 'null'] },
        sicherheit: { type: 'number' },
        begruendung: { type: 'string' },
      },
      required: ['istBewerbung', 'initiativ', 'stellenId', 'sicherheit', 'begruendung'],
      additionalProperties: false,
    },
    maxTokens: 400,
  })

  const geprueft = erkennungsSchema.parse(antwort.daten)

  // Eine erfundene Stellen-Kennung darf niemals in die Datenbank wandern.
  const gueltig = stellen.some((s) => s.id === geprueft.stellenId)
  return {
    ergebnis: { ...geprueft, stellenId: gueltig ? geprueft.stellenId : null },
    modell: antwort.modell,
  }
}

const erkennungsSchema = z.object({
  istBewerbung: jaNeinSchema,
  initiativ: jaNeinSchema,
  stellenId: z.unknown().transform((w) => (typeof w === 'string' && w.trim() ? w.trim() : null)),
  sicherheit: zahlSchema,
  begruendung: textSchema,
})

// ---------------------------------------------------------------------------
// 2) Kontakt- und Eckdaten als strukturiertes JSON
// ---------------------------------------------------------------------------

export interface ExtraktionsErgebnis {
  anrede: 'KEINE' | 'FRAU' | 'HERR' | 'DIVERS'
  titel: string
  vorname: string
  nachname: string
  email: string
  telefon: string
  strasse: string
  plz: string
  ort: string
  links: string[]
  /** Kurze Schlagworte zum Profil – hilft beim Sichten, ersetzt kein Lesen. */
  schlagworte: string[]
}

export async function extrahiereDaten(
  text: string,
): Promise<{ ergebnis: ExtraktionsErgebnis; modell: string }> {
  const antwort = await frageKi<ExtraktionsErgebnis>({
    systemPrompt: SYSTEM,
    nutzerPrompt: [
      'Lies die Kontakt- und Eckdaten der bewerbenden Person aus dem Text.',
      '',
      'Regeln:',
      '- Nicht gefundene Felder als leeren String zurückgeben, niemals raten.',
      '- Die Anrede nur setzen, wenn sie im Text steht. Nicht aus dem Vornamen ableiten.',
      '- Telefonnummern in der Schreibweise übernehmen, wie sie dastehen.',
      '- schlagworte: höchstens fünf kurze Stichworte zum fachlichen Profil.',
      '',
      'Text:',
      await kuerze(text),
    ].join('\n'),
    schemaName: 'bewerberdaten',
    schema: {
      type: 'object',
      properties: {
        anrede: { type: 'string', enum: ['KEINE', 'FRAU', 'HERR', 'DIVERS'] },
        titel: { type: 'string' },
        vorname: { type: 'string' },
        nachname: { type: 'string' },
        email: { type: 'string' },
        telefon: { type: 'string' },
        strasse: { type: 'string' },
        plz: { type: 'string' },
        ort: { type: 'string' },
        links: { type: 'array', items: { type: 'string' } },
        schlagworte: { type: 'array', items: { type: 'string' } },
      },
      required: [
        'anrede',
        'titel',
        'vorname',
        'nachname',
        'email',
        'telefon',
        'strasse',
        'plz',
        'ort',
        'links',
        'schlagworte',
      ],
      additionalProperties: false,
    },
    maxTokens: 800,
  })

  return { ergebnis: extraktionsSchema.parse(antwort.daten), modell: antwort.modell }
}

const extraktionsSchema = z.object({
  anrede: anredeSchema,
  titel: textSchema,
  vorname: textSchema,
  nachname: textSchema,
  email: textSchema,
  telefon: textSchema,
  strasse: textSchema,
  plz: textSchema,
  ort: textSchema,
  links: textListeSchema,
  // Fünf Stichworte genügen; mehr bläht die Anzeige nur auf.
  schlagworte: textListeSchema.transform((liste) => liste.slice(0, 5)),
})

// ---------------------------------------------------------------------------
// 3) Kurzzusammenfassung
// ---------------------------------------------------------------------------

export async function fasseZusammen(
  text: string,
  stelle?: { title: string; description: string } | null,
): Promise<{ zusammenfassung: string; modell: string }> {
  const antwort = await frageKi<{ zusammenfassung: string }>({
    systemPrompt: SYSTEM,
    nutzerPrompt: [
      'Fasse die Bewerbung in drei bis fünf Sätzen auf Deutsch zusammen.',
      '',
      'Regeln:',
      '- Sachlich bleiben, keine Bewertung und keine Empfehlung aussprechen.',
      '- Nur wiedergeben, was im Text steht.',
      '- Keine Angaben zu Alter, Herkunft, Geschlecht, Familienstand, Religion',
      '  oder Gesundheit aufnehmen – sie gehören nicht in die Vorauswahl.',
      ...(stelle
        ? ['', `Ausgeschriebene Stelle: ${stelle.title}`, stelle.description.slice(0, 1500)]
        : []),
      '',
      'Bewerbung:',
      await kuerze(text),
    ].join('\n'),
    schemaName: 'zusammenfassung',
    schema: {
      type: 'object',
      properties: { zusammenfassung: { type: 'string' } },
      required: ['zusammenfassung'],
      additionalProperties: false,
    },
    maxTokens: 600,
  })

  const gefasst = textSchema.parse((antwort.daten as { zusammenfassung?: unknown }).zusammenfassung)
  return { zusammenfassung: gefasst, modell: antwort.modell }
}

// ---------------------------------------------------------------------------
// 4) Seitenklassifikation für den PDF-Split
// ---------------------------------------------------------------------------

export interface SeitenZuordnung {
  seite: number
  kategorie: DocumentCategory
  begruendung: string
}

export async function klassifiziereSeiten(
  seiten: { seite: number; text: string }[],
): Promise<{ zuordnung: SeitenZuordnung[]; modell: string }> {
  // Je Seite nur der Anfang: Überschriften stehen oben, und der ganze Text
  // aller Seiten würde das Kontextfenster kleiner Modelle sprengen.
  const auszuege = seiten
    .map((s) => `--- Seite ${s.seite} ---\n${s.text.slice(0, 600) || '(kein Text erkannt)'}`)
    .join('\n\n')

  const antwort = await frageKi<{ zuordnung: SeitenZuordnung[] }>({
    systemPrompt: SYSTEM,
    nutzerPrompt: [
      'Ordne jede Seite eines Bewerbungs-PDFs einer Kategorie zu.',
      '',
      'Kategorien: ANSCHREIBEN, LEBENSLAUF, ZEUGNISSE, ANDERE',
      '',
      'Regeln:',
      '- Für jede Seite genau einen Eintrag zurückgeben, keine auslassen.',
      '- Eine Folgeseite ohne eigene Überschrift gehört zur Kategorie der Seite davor.',
      '- Seiten ohne erkennbaren Text (Scans) ebenfalls der Seite davor zuordnen.',
      '- begruendung: höchstens sechs Wörter.',
      '',
      `Das Dokument hat ${seiten.length} Seiten.`,
      '',
      auszuege,
    ].join('\n'),
    schemaName: 'seitenzuordnung',
    schema: {
      type: 'object',
      properties: {
        zuordnung: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              seite: { type: 'integer' },
              kategorie: { type: 'string', enum: ['ANSCHREIBEN', 'LEBENSLAUF', 'ZEUGNISSE', 'ANDERE'] },
              begruendung: { type: 'string' },
            },
            required: ['seite', 'kategorie', 'begruendung'],
            additionalProperties: false,
          },
        },
      },
      required: ['zuordnung'],
      additionalProperties: false,
    },
    maxTokens: 200 + seiten.length * 60,
  })

  // Was die KI ausgelassen oder erfunden hat, wird hier begradigt: Für jede
  // echte Seite muss genau ein Eintrag herauskommen.
  const roh = zuordnungsSchema.parse(antwort.daten)
  const nachSeite = new Map(roh.zuordnung.map((z) => [z.seite, z]))
  let laufend: DocumentCategory = 'ANDERE'
  const zuordnung: SeitenZuordnung[] = seiten.map((s) => {
    const treffer = nachSeite.get(s.seite)
    if (treffer && ['ANSCHREIBEN', 'LEBENSLAUF', 'ZEUGNISSE', 'ANDERE'].includes(treffer.kategorie)) {
      laufend = treffer.kategorie
      return { seite: s.seite, kategorie: treffer.kategorie, begruendung: treffer.begruendung }
    }
    return { seite: s.seite, kategorie: laufend, begruendung: 'Ohne Angabe – wie die Seite davor' }
  })

  return { zuordnung, modell: antwort.modell }
}

/**
 * Eine unbrauchbare Zuordnung wird zur leeren Liste, nicht zum Fehler – die
 * Schleife darunter füllt dann jede Seite mit der Kategorie der Seite davor.
 */
const zuordnungsSchema = z.object({
  zuordnung: z
    .unknown()
    .transform((wert) => (Array.isArray(wert) ? wert : []))
    .transform((liste) =>
      liste
        .map((eintrag) => {
          if (typeof eintrag !== 'object' || eintrag === null) return null
          const e = eintrag as Record<string, unknown>
          const seite = Number(e.seite)
          const kategorie = typeof e.kategorie === 'string' ? e.kategorie.trim().toUpperCase() : ''
          if (!Number.isInteger(seite) || seite < 1) return null
          return {
            seite,
            kategorie: kategorie as DocumentCategory,
            begruendung: typeof e.begruendung === 'string' ? e.begruendung : '',
          }
        })
        .filter((e): e is SeitenZuordnung => e !== null),
    ),
})

// ---------------------------------------------------------------------------
// Statusvorschlag
// ---------------------------------------------------------------------------

const PHASEN_FUER_KI = [
  'GESICHTET',
  'IN_PRUEFUNG',
  'EINGELADEN',
  'GESPRAECH_GEFUEHRT',
  'ENTSCHEIDUNG',
  'ZUSAGE',
  'ABSAGE',
] as const

export interface StatusErgebnis {
  phase: string | null
  sicherheit: number
  begruendung: string
}

/**
 * Liest den Mailverlauf und schlägt eine Phase vor.
 *
 * Ausdrücklich ein **Vorschlag**: Gesetzt wird nichts. Das ist keine
 * Zurückhaltung um ihrer selbst willen, sondern folgt dem Grundsatz des
 * Werkzeugs – alles Erkannte ist ein Vorschlag. Ein Modell, das eine höfliche
 * Absage des Bewerbers für eine Zusage hält, würde sonst still die Phase
 * umstellen, und niemand sähe, warum.
 *
 * Zwei Phasen fehlen in der Liste mit Absicht: `NEU` ist der Ausgangszustand
 * und nie ein Fortschritt, und `ARCHIV` ist eine Aufräumentscheidung, die
 * niemand aus einer Mail ableiten kann.
 */
export async function schlageStatusVor(
  verlauf: string,
  aktuellePhase: string,
): Promise<{ ergebnis: StatusErgebnis; modell: string }> {
  const antwort = await frageKi<StatusErgebnis>({
    systemPrompt: SYSTEM,
    nutzerPrompt: [
      'Unten steht der Mailverlauf einer Bewerbung. Schlage die passende Phase vor.',
      '',
      `Aktuelle Phase: ${aktuellePhase}`,
      '',
      'Mögliche Phasen:',
      ...PHASEN_FUER_KI.map((p) => `- ${p}`),
      '',
      'Regeln:',
      '- phase nur setzen, wenn der Verlauf sie eindeutig belegt. Im Zweifel null.',
      '- Bleibt die aktuelle Phase richtig, gib null zurück.',
      '- Niemals zurück in eine frühere Phase.',
      '- ZUSAGE oder ABSAGE nur, wenn sie im Verlauf ausgesprochen wurde.',
      '- sicherheit ist ein Wert zwischen 0 und 1.',
      '- begruendung in einem kurzen deutschen Satz.',
      '',
      'Mailverlauf:',
      await kuerze(verlauf),
    ].join('\n'),
    schemaName: 'statusvorschlag',
    schema: {
      type: 'object',
      properties: {
        phase: { type: ['string', 'null'] },
        sicherheit: { type: 'number' },
        begruendung: { type: 'string' },
      },
      required: ['phase', 'sicherheit', 'begruendung'],
      additionalProperties: false,
    },
    maxTokens: 300,
  })

  const geprueft = statusSchema.parse(antwort.daten)

  // Eine erfundene oder unbekannte Phase darf nicht durchkommen – ebenso wenig
  // ein Vorschlag, der nur die aktuelle Phase wiederholt.
  const gueltig =
    geprueft.phase !== null &&
    (PHASEN_FUER_KI as readonly string[]).includes(geprueft.phase) &&
    geprueft.phase !== aktuellePhase

  return {
    ergebnis: { ...geprueft, phase: gueltig ? geprueft.phase : null },
    modell: antwort.modell,
  }
}

const statusSchema = z.object({
  phase: z.unknown().transform((w) => (typeof w === 'string' && w.trim() ? w.trim().toUpperCase() : null)),
  sicherheit: zahlSchema,
  begruendung: textSchema,
})
