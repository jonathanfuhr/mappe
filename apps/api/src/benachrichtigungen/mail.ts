import { prisma } from '../db'
import { holeAdapter } from '../mail/registry'
import { getSetting } from '../settings/service'

/**
 * Benachrichtigungen als Mail – gebündelt, nicht einzeln.
 *
 * Drei Entscheidungen stecken hier drin:
 *
 *  - **Eine Mail je Lauf und Empfänger, nicht je Ereignis.** Gehen zehn
 *    Bewerbungen auf einmal ein, wäre alles andere eine Zumutung; nach der
 *    dritten Mail schaltet man die Benachrichtigungen ab, und dann fehlen auch
 *    die, auf die es ankam.
 *  - **Verschickt wird über das Bewerbungspostfach**, weil es das einzige
 *    hinterlegte ist. Die Mail geht an die eigene Belegschaft, nicht an
 *    Bewerber – sie landet deshalb bewusst *nicht* als `MailMessage` in einem
 *    Bewerbungsverlauf.
 *  - **Keine Bewerberdaten im Betreff.** Ein Betreff steht in Vorschauen auf
 *    Sperrbildschirmen; „3 neue Bewerbungen" reicht, der Name gehört ins
 *    Werkzeug.
 */

interface Sammlung {
  userId: string
  email: string
  name: string
  neue: number
  liegend: { name: string; tage: number }[]
  ids: string[]
}

export async function versendeBenachrichtigungsMails(): Promise<number> {
  const einstellungen = await getSetting('benachrichtigungen')
  if (!einstellungen.perMail) return 0

  const offene = await prisma.notification.findMany({
    // Gelesenes muss nicht mehr gemeldet werden: Wer es in der Oberfläche
    // schon gesehen hat, braucht dazu keine Mail.
    where: { mailedAt: null, readAt: null, user: { active: true, notifyByMail: true } },
    include: {
      user: { select: { id: true, email: true, name: true } },
      application: { select: { candidate: { select: { firstName: true, lastName: true, email: true } } } },
    },
    orderBy: { createdAt: 'asc' },
    take: 500,
  })
  if (offene.length === 0) return 0

  const nach = new Map<string, Sammlung>()
  for (const eintrag of offene) {
    const vorhanden = nach.get(eintrag.userId) ?? {
      userId: eintrag.userId,
      email: eintrag.user.email,
      name: eintrag.user.name,
      neue: 0,
      liegend: [],
      ids: [],
    }
    vorhanden.ids.push(eintrag.id)
    if (eintrag.type === 'NEUE_BEWERBUNG') {
      vorhanden.neue++
    } else {
      const daten = eintrag.data as { name?: string; tage?: number }
      const person =
        daten.name ??
        `${eintrag.application?.candidate.firstName ?? ''} ${eintrag.application?.candidate.lastName ?? ''}`.trim()
      vorhanden.liegend.push({ name: person || 'Ohne Namen', tage: daten.tage ?? 0 })
    }
    nach.set(eintrag.userId, vorhanden)
  }

  const adapter = await holeAdapter()
  if (!adapter) return 0

  const allgemein = await getSetting('allgemein')
  const appUrl = process.env.APP_URL ?? ''

  let verschickt = 0
  for (const sammlung of nach.values()) {
    if (!sammlung.email) continue

    const betreff = baueBetreff(sammlung)
    const text = baueText(sammlung, appUrl, allgemein.organisation)

    try {
      await adapter.sende({
        absenderName: allgemein.absenderName || allgemein.organisation || undefined,
        an: [sammlung.email],
        betreff,
        text,
      })
      // Erst nach erfolgreichem Versand vermerken. Bricht der Versand ab,
      // kommen dieselben Meldungen beim nächsten Lauf erneut dran – besser,
      // als sie stillschweigend zu verlieren.
      await prisma.notification.updateMany({
        where: { id: { in: sammlung.ids } },
        data: { mailedAt: new Date() },
      })
      verschickt++
    } catch (err) {
      console.error(
        `[mappe] Benachrichtigungsmail an ${sammlung.email} fehlgeschlagen:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  return verschickt
}

function baueBetreff(s: Sammlung): string {
  const teile: string[] = []
  if (s.neue > 0) teile.push(s.neue === 1 ? '1 neue Bewerbung' : `${s.neue} neue Bewerbungen`)
  if (s.liegend.length > 0) {
    teile.push(
      s.liegend.length === 1 ? '1 Bewerbung wartet' : `${s.liegend.length} Bewerbungen warten`,
    )
  }
  return `Mappe: ${teile.join(', ')}`
}

function baueText(s: Sammlung, appUrl: string, organisation: string): string {
  const zeilen: string[] = [`Hallo ${s.name},`, '']

  if (s.neue > 0) {
    zeilen.push(
      s.neue === 1
        ? 'es ist eine neue Bewerbung eingegangen.'
        : `es sind ${s.neue} neue Bewerbungen eingegangen.`,
      '',
    )
  }

  if (s.liegend.length > 0) {
    zeilen.push('Diese Bewerbungen warten seit längerem auf einen nächsten Schritt:', '')
    for (const eintrag of s.liegend.slice(0, 20)) {
      zeilen.push(`  · ${eintrag.name} – seit ${eintrag.tage} Tagen`)
    }
    if (s.liegend.length > 20) zeilen.push(`  · … und ${s.liegend.length - 20} weitere`)
    zeilen.push('')
  }

  if (appUrl) zeilen.push(`Zur Übersicht: ${appUrl}`, '')

  zeilen.push(
    '--',
    organisation ? `Diese Nachricht kommt von Mappe (${organisation}).` : 'Diese Nachricht kommt von Mappe.',
    'Benachrichtigungen lassen sich im eigenen Profil abschalten.',
  )

  return zeilen.join('\n')
}
