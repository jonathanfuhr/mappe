import { prisma } from '../db'

/**
 * Wird bei jedem Containerstart ausgeführt und ist bewusst wiederholbar:
 * Was schon da ist, bleibt unangetastet. Ein Admin, der eine mitgelieferte
 * Vorlage gelöscht hat, bekommt sie nicht beim nächsten Neustart zurück –
 * deshalb entscheidet ein Merker in der Setting-Tabelle, nicht die Anzahl
 * vorhandener Vorlagen.
 */

export async function seedAll(): Promise<void> {
  // Wird in den folgenden Bauabschnitten gefüllt (Mail-Vorlagen,
  // Gesprächsvorlage). Der Einstiegspunkt existiert von Anfang an, damit das
  // Startskript des Containers sich nicht ändern muss.
  const marker = await prisma.setting.findUnique({ where: { key: '_seed' } })
  const erledigt = new Set<string>(
    Array.isArray((marker?.value as { erledigt?: string[] } | undefined)?.erledigt)
      ? ((marker!.value as { erledigt: string[] }).erledigt)
      : [],
  )

  await prisma.setting.upsert({
    where: { key: '_seed' },
    create: { key: '_seed', value: { erledigt: [...erledigt] } },
    update: { value: { erledigt: [...erledigt] } },
  })
}

/** Hilfsfunktion für die Seed-Schritte der folgenden Bauabschnitte. */
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
