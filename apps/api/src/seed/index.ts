import { prisma } from '../db'
import { seedVorlagen } from './vorlagen'

/**
 * Wird bei jedem Containerstart ausgeführt und ist bewusst wiederholbar:
 * Jeder Schritt merkt sich, dass er gelaufen ist, und läuft kein zweites Mal.
 */
export async function seedAll(): Promise<void> {
  await seedVorlagen()
}

export { seedSchritt } from './helfer'

if (require.main === module) {
  seedAll()
    .then(() => prisma.$disconnect())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error('[mappe] Seed fehlgeschlagen:', err)
      await prisma.$disconnect()
      process.exit(1)
    })
}
