import type { DocumentCategory, Job } from '@prisma/client'
import { getSetting } from '../settings/service'
import { frageKi } from './client'

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

  // Eine erfundene Stellen-Kennung darf niemals in die Datenbank wandern.
  const gueltig = stellen.some((s) => s.id === antwort.daten.stellenId)
  return {
    ergebnis: {
      ...antwort.daten,
      stellenId: gueltig ? antwort.daten.stellenId : null,
      sicherheit: begrenze(antwort.daten.sicherheit),
    },
    modell: antwort.modell,
  }
}

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

  return { ergebnis: antwort.daten, modell: antwort.modell }
}

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

  return { zusammenfassung: antwort.daten.zusammenfassung.trim(), modell: antwort.modell }
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
  const nachSeite = new Map(antwort.daten.zuordnung.map((z) => [z.seite, z]))
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

function begrenze(wert: number): number {
  if (!Number.isFinite(wert)) return 0
  return Math.min(1, Math.max(0, wert))
}
