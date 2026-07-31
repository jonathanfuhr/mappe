import { prisma } from '../db'
import { seedSchritt } from './helfer'

/**
 * Eine mitgelieferte Gesprächsvorlage als Ausgangspunkt.
 *
 * Bewusst nur Fragen zur Sache. Fragen nach Familienplanung, Schwangerschaft,
 * Religion, Parteizugehörigkeit oder Gesundheit sind im Bewerbungsgespräch
 * unzulässig – sie stehen deshalb nicht drin, und die Vorlage sagt das auch.
 */
const ABSCHNITTE = [
  {
    title: 'Ankommen',
    questions: [
      { id: 'einstieg-1', text: 'Kurze Vorstellung der Gesprächsrunde und des Ablaufs', hint: 'Kein Frageteil – nur als Merkposten.' },
      { id: 'einstieg-2', text: 'Wie sind Sie auf uns aufmerksam geworden?' },
      { id: 'einstieg-3', text: 'Was hat Sie an der Ausschreibung angesprochen?' },
    ],
  },
  {
    title: 'Werdegang',
    questions: [
      { id: 'werdegang-1', text: 'Erzählen Sie von Ihrer aktuellen Tätigkeit.' },
      { id: 'werdegang-2', text: 'Welche Aufgabe aus den letzten Jahren hat Sie am meisten weitergebracht?' },
      { id: 'werdegang-3', text: 'Woran haben Sie zuletzt gearbeitet, worauf Sie stolz sind?' },
      { id: 'werdegang-4', text: 'Gibt es Lücken oder Wechsel im Lebenslauf, die Sie einordnen möchten?', hint: 'Offen fragen, nicht bohren.' },
    ],
  },
  {
    title: 'Fachliches',
    questions: [
      { id: 'fach-1', text: 'Welche Werkzeuge und Verfahren nutzen Sie im Alltag?' },
      { id: 'fach-2', text: 'Schildern Sie eine schwierige fachliche Situation und wie Sie sie gelöst haben.' },
      { id: 'fach-3', text: 'Wo sehen Sie bei sich fachlich noch Lücken?' },
    ],
  },
  {
    title: 'Zusammenarbeit',
    questions: [
      { id: 'team-1', text: 'Wie sieht für Sie gute Zusammenarbeit aus?' },
      { id: 'team-2', text: 'Wie gehen Sie mit widersprüchlichen Rückmeldungen um?' },
      { id: 'team-3', text: 'Was brauchen Sie von uns, um gut arbeiten zu können?' },
    ],
  },
  {
    title: 'Rahmen',
    questions: [
      { id: 'rahmen-1', text: 'Ab wann könnten Sie beginnen?' },
      { id: 'rahmen-2', text: 'Wie sind Ihre Gehaltsvorstellungen?' },
      { id: 'rahmen-3', text: 'Gibt es Fragen an uns?' },
    ],
  },
  {
    title: 'Gesamteindruck',
    questions: [
      { id: 'fazit-1', text: 'Was spricht dafür?' },
      { id: 'fazit-2', text: 'Was spricht dagegen?' },
      { id: 'fazit-3', text: 'Offene Punkte für eine zweite Runde' },
    ],
  },
]

export async function seedGespraechsvorlage(): Promise<void> {
  await seedSchritt('gespraechsvorlage', async () => {
    await prisma.interviewTemplate.create({
      data: {
        name: 'Standard-Gesprächsleitfaden',
        sections: ABSCHNITTE as object,
        seeded: true,
      },
    })
  })
}
