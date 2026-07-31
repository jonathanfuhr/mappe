import type { TemplateTone, TemplateType } from '@prisma/client'
import { prisma } from '../db'
import { seedSchritt } from './helfer'

/**
 * Mitgelieferte Standard-Vorlagen, jeweils in Du- und Sie-Fassung.
 *
 * Sie sind bewusst zurückhaltend formuliert. Zwei Punkte, die in Deutschland
 * zählen:
 *
 *  - **Keine Begründung in der Absage.** Wer schreibt, warum jemand nicht
 *    genommen wurde, liefert im Streitfall die Indizien nach § 22 AGG gleich
 *    mit. Üblich und rechtlich unbedenklich ist die knappe Form ohne Gründe.
 *  - **Hinweis auf die Speicherdauer.** Nach Abschluss des Verfahrens werden
 *    Bewerbungsunterlagen gelöscht; die Vorlagen sagen das ausdrücklich und
 *    bieten die Aufnahme in den Bewerberpool ausdrücklich als Wahl an.
 *
 * Jede dieser Vorlagen lässt sich vom Admin ändern, löschen und erweitern.
 * Sie werden nur beim allerersten Start eingespielt – eine gelöschte Vorlage
 * kommt nach einem Neustart nicht zurück.
 */

interface VorlagenEntwurf {
  name: string
  type: TemplateType
  tone: TemplateTone
  subject: string
  body: string
  sortOrder: number
}

const VORLAGEN: VorlagenEntwurf[] = [
  // --- Eingangsbestätigung --------------------------------------------------
  {
    name: 'Eingangsbestätigung',
    type: 'EINGANGSBESTAETIGUNG',
    tone: 'SIE',
    sortOrder: 10,
    subject: 'Ihre Bewerbung bei $ORGANISATION',
    body: `$ANREDE_FORMELL,

vielen Dank für Ihre Bewerbung als $STELLE. Wir haben Ihre Unterlagen am $EINGANGSDATUM erhalten.

Wir sichten alle Bewerbungen sorgfältig und melden uns, sobald wir Ihre Unterlagen geprüft haben. Bitte haben Sie etwas Geduld – das kann einige Tage dauern.

Ihre Daten verwenden wir ausschließlich für dieses Bewerbungsverfahren und löschen sie nach dessen Abschluss.

Mit freundlichen Grüßen
$BEARBEITER`,
  },
  {
    name: 'Eingangsbestätigung',
    type: 'EINGANGSBESTAETIGUNG',
    tone: 'DU',
    sortOrder: 11,
    subject: 'Deine Bewerbung bei $ORGANISATION',
    body: `$ANREDE_DU,

vielen Dank für deine Bewerbung als $STELLE. Deine Unterlagen sind am $EINGANGSDATUM bei uns angekommen.

Wir schauen sie uns in Ruhe an und melden uns, sobald wir durch sind. Das kann ein paar Tage dauern.

Deine Daten nutzen wir ausschließlich für dieses Bewerbungsverfahren und löschen sie danach.

Viele Grüße
$BEARBEITER`,
  },

  // --- Einladung ------------------------------------------------------------
  {
    name: 'Einladung zum Gespräch',
    type: 'EINLADUNG',
    tone: 'SIE',
    sortOrder: 20,
    subject: 'Einladung zum Gespräch – $STELLE',
    body: `$ANREDE_FORMELL,

vielen Dank für Ihre Bewerbung als $STELLE. Ihre Unterlagen haben uns überzeugt, und wir würden Sie gern persönlich kennenlernen.

Passt Ihnen einer der folgenden Termine?

  •
  •

Bitte geben Sie uns kurz Bescheid, welcher Termin Ihnen passt. Sollte keiner davon möglich sein, finden wir gemeinsam einen anderen.

Das Gespräch dauert etwa eine Stunde. Sie müssen nichts vorbereiten.

Mit freundlichen Grüßen
$BEARBEITER`,
  },
  {
    name: 'Einladung zum Gespräch',
    type: 'EINLADUNG',
    tone: 'DU',
    sortOrder: 21,
    subject: 'Einladung zum Gespräch – $STELLE',
    body: `$ANREDE_DU,

danke für deine Bewerbung als $STELLE. Deine Unterlagen haben uns überzeugt – wir würden dich gern kennenlernen.

Passt dir einer dieser Termine?

  •
  •

Sag uns kurz Bescheid, welcher passt. Wenn keiner geht, finden wir einen anderen.

Das Gespräch dauert etwa eine Stunde. Vorbereiten musst du nichts.

Viele Grüße
$BEARBEITER`,
  },

  // --- Zusage ---------------------------------------------------------------
  {
    name: 'Zusage',
    type: 'ZUSAGE',
    tone: 'SIE',
    sortOrder: 30,
    subject: 'Ihre Bewerbung als $STELLE – wir freuen uns auf Sie',
    body: `$ANREDE_FORMELL,

wir freuen uns sehr: Wir möchten Ihnen die Stelle als $STELLE anbieten.

Den Vertrag mit allen Einzelheiten schicken wir Ihnen in den nächsten Tagen zu. Wenn Sie vorab Fragen haben, melden Sie sich gern jederzeit.

Herzlichen Glückwunsch – wir freuen uns auf die Zusammenarbeit.

Mit freundlichen Grüßen
$BEARBEITER`,
  },
  {
    name: 'Zusage',
    type: 'ZUSAGE',
    tone: 'DU',
    sortOrder: 31,
    subject: 'Deine Bewerbung als $STELLE – wir freuen uns auf dich',
    body: `$ANREDE_DU,

wir freuen uns sehr: Wir möchten dir die Stelle als $STELLE anbieten.

Den Vertrag mit allen Einzelheiten schicken wir dir in den nächsten Tagen. Wenn du vorher Fragen hast, melde dich jederzeit.

Herzlichen Glückwunsch – wir freuen uns auf die Zusammenarbeit.

Viele Grüße
$BEARBEITER`,
  },

  // --- Absage ---------------------------------------------------------------
  {
    name: 'Absage',
    type: 'ABSAGE',
    tone: 'SIE',
    sortOrder: 40,
    subject: 'Ihre Bewerbung als $STELLE',
    body: `$ANREDE_FORMELL,

vielen Dank für Ihre Bewerbung als $STELLE und für das Interesse an unserem Haus.

Wir haben uns die Entscheidung nicht leicht gemacht. Leider können wir Ihnen keine Zusage geben – wir haben uns für eine andere Bewerberin oder einen anderen Bewerber entschieden.

Ihre Unterlagen löschen wir nach Abschluss des Verfahrens. Wenn Sie möchten, dass wir Ihre Bewerbung für künftige Stellen aufbewahren, schreiben Sie uns einfach kurz zurück.

Für Ihren weiteren Weg wünschen wir Ihnen alles Gute.

Mit freundlichen Grüßen
$BEARBEITER`,
  },
  {
    name: 'Absage',
    type: 'ABSAGE',
    tone: 'DU',
    sortOrder: 41,
    subject: 'Deine Bewerbung als $STELLE',
    body: `$ANREDE_DU,

danke für deine Bewerbung als $STELLE und für dein Interesse an uns.

Wir haben es uns nicht leicht gemacht. Leider können wir dir keine Zusage geben – wir haben uns für jemand anderen entschieden.

Deine Unterlagen löschen wir nach Abschluss des Verfahrens. Wenn wir deine Bewerbung für künftige Stellen behalten sollen, schreib uns einfach kurz zurück.

Für deinen weiteren Weg alles Gute.

Viele Grüße
$BEARBEITER`,
  },

  // --- Absage auf eine Initiativbewerbung -----------------------------------
  {
    name: 'Absage auf Initiativbewerbung',
    type: 'INITIATIV_ABSAGE',
    tone: 'SIE',
    sortOrder: 50,
    subject: 'Ihre Initiativbewerbung',
    body: `$ANREDE_FORMELL,

vielen Dank für Ihre Initiativbewerbung und für das Interesse an unserem Haus.

Zurzeit haben wir leider keine passende Stelle frei, die zu Ihrem Profil passt.

Wenn Sie einverstanden sind, behalten wir Ihre Unterlagen und melden uns, sobald etwas Passendes frei wird. Schreiben Sie uns dafür einfach kurz zurück. Andernfalls löschen wir Ihre Daten.

Für Ihren weiteren Weg wünschen wir Ihnen alles Gute.

Mit freundlichen Grüßen
$BEARBEITER`,
  },
  {
    name: 'Absage auf Initiativbewerbung',
    type: 'INITIATIV_ABSAGE',
    tone: 'DU',
    sortOrder: 51,
    subject: 'Deine Initiativbewerbung',
    body: `$ANREDE_DU,

danke für deine Initiativbewerbung und für dein Interesse an uns.

Zurzeit haben wir leider nichts frei, das zu deinem Profil passt.

Wenn du magst, behalten wir deine Unterlagen und melden uns, sobald etwas Passendes frei wird – schreib uns dafür einfach kurz zurück. Sonst löschen wir deine Daten.

Für deinen weiteren Weg alles Gute.

Viele Grüße
$BEARBEITER`,
  },

  // --- Nachfrage ------------------------------------------------------------
  {
    name: 'Nachfrage zu fehlenden Unterlagen',
    type: 'NACHFRAGE',
    tone: 'SIE',
    sortOrder: 60,
    subject: 'Rückfrage zu Ihrer Bewerbung als $STELLE',
    body: `$ANREDE_FORMELL,

vielen Dank für Ihre Bewerbung als $STELLE.

Für die weitere Prüfung fehlen uns noch folgende Unterlagen:

  •

Könnten Sie uns diese nachreichen? Eine Antwort auf diese Mail genügt.

Mit freundlichen Grüßen
$BEARBEITER`,
  },
  {
    name: 'Nachfrage zu fehlenden Unterlagen',
    type: 'NACHFRAGE',
    tone: 'DU',
    sortOrder: 61,
    subject: 'Rückfrage zu deiner Bewerbung als $STELLE',
    body: `$ANREDE_DU,

danke für deine Bewerbung als $STELLE.

Für die weitere Prüfung fehlen uns noch:

  •

Kannst du uns das nachreichen? Eine Antwort auf diese Mail reicht.

Viele Grüße
$BEARBEITER`,
  },
]

export async function seedVorlagen(): Promise<void> {
  await seedSchritt('mail-vorlagen', async () => {
    await prisma.mailTemplate.createMany({
      data: VORLAGEN.map((v) => ({ ...v, seeded: true })),
    })
  })
}

/** Setzt eine mitgelieferte Vorlage auf den Auslieferungsstand zurück. */
export function findeAuslieferungsstand(
  type: TemplateType,
  tone: TemplateTone,
): VorlagenEntwurf | undefined {
  return VORLAGEN.find((v) => v.type === type && v.tone === tone)
}
