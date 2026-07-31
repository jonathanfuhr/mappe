import { prisma } from '../db'

/**
 * Führt einen Seed-Schritt genau einmal aus – gesteuert über einen Merker in
 * der Setting-Tabelle, nicht über „ist die Tabelle leer?".
 *
 * Der Unterschied zählt: Wer eine mitgelieferte Vorlage löscht, will sie beim
 * nächsten Containerstart nicht zurückbekommen.
 */
export async function seedSchritt(name: string, aktion: () => Promise<void>): Promise<void> {
  const marker = await prisma.setting.findUnique({ where: { key: '_seed' } })
  const wert = (marker?.value as { erledigt?: string[] } | undefined) ?? {}
  const erledigt = new Set(Array.isArray(wert.erledigt) ? wert.erledigt : [])

  if (erledigt.has(name)) return

  await aktion()
  erledigt.add(name)

  await prisma.setting.upsert({
    where: { key: '_seed' },
    create: { key: '_seed', value: { erledigt: [...erledigt] } },
    update: { value: { erledigt: [...erledigt] } },
  })
  console.log(`[mappe] Seed-Schritt "${name}" eingespielt.`)
}
