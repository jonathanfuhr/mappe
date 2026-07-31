import { prisma } from '../db'

/**
 * Protokolliert alles, was DSGVO-relevant ist: Löschungen, Rollenwechsel,
 * Mailversand, Änderungen an den Systemeinstellungen. Bewusst schlank – kein
 * Vollprotokoll jedes Lesezugriffs.
 */
export async function audit(
  userId: string | null,
  action: string,
  entity: string,
  entityId?: string | null,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId ?? null,
        action,
        entity,
        entityId: entityId ?? null,
        meta: meta as object,
      },
    })
  } catch (err) {
    // Ein fehlgeschlagener Protokolleintrag darf den eigentlichen Vorgang nie
    // scheitern lassen.
    console.error('[mappe] Protokolleintrag fehlgeschlagen:', err)
  }
}
