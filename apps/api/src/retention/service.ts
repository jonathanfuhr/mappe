import { prisma } from '../db'
import { audit } from '../lib/audit'
import { deleteFile } from '../lib/storage'
import { getSetting } from '../settings/service'

/**
 * Aufbewahrungsfristen.
 *
 * Zwei getrennte Fristen, weil sie unterschiedliche Dinge schützen:
 *
 *  - Die **Bewerbungsfrist** läuft ab Abschluss des Verfahrens (Zusage,
 *    Absage, Archiv). Sechs Monate sind üblich: Die Klagefrist nach § 15 Abs. 4
 *    AGG beträgt zwei Monate, dazu kommt Luft für die Zustellung.
 *  - Die **Personenfrist** greift erst, wenn zu dieser Person keine aktive
 *    Bewerbung mehr läuft. Sonst würde jemand mitten im Verfahren gelöscht,
 *    nur weil eine frühere Bewerbung alt genug ist.
 *
 * Ein gesetztes Einwilligungs-Flag nimmt eine Person vollständig aus – das
 * ist der Talent-Pool-Fall.
 */

/** Phasen, ab denen eine Bewerbung als abgeschlossen gilt. */
const ABGESCHLOSSEN = ['ZUSAGE', 'ABSAGE', 'ARCHIV'] as const

export interface FristenStand {
  modus: 'erinnern' | 'loeschen'
  bewerbungen: {
    aktiv: boolean
    monate: number
    faellig: number
    demnaechst: number
  }
  personen: {
    aktiv: boolean
    monate: number
    faellig: number
    demnaechst: number
  }
  zurueckgestellt: number
}

function plusMonate(datum: Date, monate: number): Date {
  const neu = new Date(datum)
  neu.setMonth(neu.getMonth() + monate)
  return neu
}

/**
 * Rechnet die Fälligkeiten neu aus und schreibt sie an die Datensätze.
 * Läuft vor jeder Anzeige und vor jedem Löschlauf, damit eine geänderte
 * Fristeinstellung sofort greift.
 */
export async function berechneFristen(): Promise<void> {
  const fristen = await getSetting('fristen')

  // --- Bewerbungen ----------------------------------------------------------
  if (fristen.bewerbungAktiv) {
    const abgeschlossene = await prisma.application.findMany({
      // Eine erteilte Einwilligung schützt die ganze Person – also auch ihre
      // Bewerbungen. Sonst wären die Unterlagen weg und der Talent-Pool
      // bestünde nur noch aus einem Namen.
      where: {
        stage: { in: [...ABGESCHLOSSEN] },
        closedAt: { not: null },
        candidate: { storageConsent: false },
      },
      select: { id: true, closedAt: true, purgeDueAt: true },
    })
    for (const bewerbung of abgeschlossene) {
      const faellig = plusMonate(bewerbung.closedAt!, fristen.bewerbungMonate)
      if (bewerbung.purgeDueAt?.getTime() === faellig.getTime()) continue
      await prisma.application.update({ where: { id: bewerbung.id }, data: { purgeDueAt: faellig } })
    }
  } else {
    await prisma.application.updateMany({
      where: { purgeDueAt: { not: null } },
      data: { purgeDueAt: null },
    })
  }

  // Laufende Verfahren dürfen keine Fälligkeit tragen – sonst würde eine
  // wieder aufgenommene Bewerbung stillschweigend gelöscht.
  await prisma.application.updateMany({
    where: { stage: { notIn: [...ABGESCHLOSSEN] }, purgeDueAt: { not: null } },
    data: { purgeDueAt: null },
  })

  // Dasselbe für Bewerbungen von Personen mit Einwilligung.
  await prisma.application.updateMany({
    where: { candidate: { storageConsent: true }, purgeDueAt: { not: null } },
    data: { purgeDueAt: null },
  })

  // --- Personen -------------------------------------------------------------
  if (fristen.personAktiv) {
    const personen = await prisma.candidate.findMany({
      where: { storageConsent: false },
      select: {
        id: true,
        updatedAt: true,
        purgeDueAt: true,
        applications: { select: { stage: true, closedAt: true } },
      },
    })

    for (const person of personen) {
      const hatLaufende = person.applications.some(
        (a) => !(ABGESCHLOSSEN as readonly string[]).includes(a.stage),
      )
      if (hatLaufende) {
        if (person.purgeDueAt) {
          await prisma.candidate.update({ where: { id: person.id }, data: { purgeDueAt: null } })
        }
        continue
      }

      // Startpunkt ist der jüngste Abschluss; ohne jede Bewerbung die letzte
      // Änderung am Datensatz.
      const abschluesse = person.applications
        .map((a) => a.closedAt)
        .filter((d): d is Date => d instanceof Date)
      const start =
        abschluesse.length > 0
          ? new Date(Math.max(...abschluesse.map((d) => d.getTime())))
          : person.updatedAt

      const faellig = plusMonate(start, fristen.personMonate)
      if (person.purgeDueAt?.getTime() === faellig.getTime()) continue
      await prisma.candidate.update({ where: { id: person.id }, data: { purgeDueAt: faellig } })
    }
  } else {
    await prisma.candidate.updateMany({
      where: { purgeDueAt: { not: null } },
      data: { purgeDueAt: null },
    })
  }

  // Eine erteilte Einwilligung räumt die Fälligkeit in jedem Fall weg.
  await prisma.candidate.updateMany({
    where: { storageConsent: true, purgeDueAt: { not: null } },
    data: { purgeDueAt: null },
  })
}

export async function holeStand(): Promise<FristenStand> {
  await berechneFristen()
  const fristen = await getSetting('fristen')
  const jetzt = new Date()
  const inVierWochen = new Date(jetzt.getTime() + 28 * 24 * 60 * 60 * 1000)

  const [bewerbungenFaellig, bewerbungenBald, personenFaellig, personenBald, zurueckgestellt] =
    await Promise.all([
      prisma.application.count({ where: { purgeDueAt: { lte: jetzt } } }),
      prisma.application.count({ where: { purgeDueAt: { gt: jetzt, lte: inVierWochen } } }),
      prisma.candidate.count({ where: { purgeDueAt: { lte: jetzt } } }),
      prisma.candidate.count({ where: { purgeDueAt: { gt: jetzt, lte: inVierWochen } } }),
      prisma.candidate.count({ where: { storageConsent: true } }),
    ])

  return {
    modus: fristen.modus,
    bewerbungen: {
      aktiv: fristen.bewerbungAktiv,
      monate: fristen.bewerbungMonate,
      faellig: bewerbungenFaellig,
      demnaechst: bewerbungenBald,
    },
    personen: {
      aktiv: fristen.personAktiv,
      monate: fristen.personMonate,
      faellig: personenFaellig,
      demnaechst: personenBald,
    },
    zurueckgestellt,
  }
}

export interface FaelligerEintrag {
  id: string
  art: 'bewerbung' | 'person'
  name: string
  zusatz: string
  faelligSeit: Date
}

export async function listeFaellige(): Promise<FaelligerEintrag[]> {
  await berechneFristen()
  const jetzt = new Date()

  const [bewerbungen, personen] = await Promise.all([
    prisma.application.findMany({
      where: { purgeDueAt: { lte: jetzt } },
      include: { candidate: true, job: { select: { title: true } } },
      orderBy: { purgeDueAt: 'asc' },
      take: 500,
    }),
    prisma.candidate.findMany({
      where: { purgeDueAt: { lte: jetzt } },
      orderBy: { purgeDueAt: 'asc' },
      take: 500,
    }),
  ])

  return [
    ...bewerbungen.map((b) => ({
      id: b.id,
      art: 'bewerbung' as const,
      name: `${b.candidate.firstName} ${b.candidate.lastName}`.trim() || (b.candidate.email ?? 'Ohne Namen'),
      zusatz: b.job?.title ?? 'Ohne Zuordnung',
      faelligSeit: b.purgeDueAt!,
    })),
    ...personen.map((p) => ({
      id: p.id,
      art: 'person' as const,
      name: `${p.firstName} ${p.lastName}`.trim() || (p.email ?? 'Ohne Namen'),
      zusatz: p.email ?? '',
      faelligSeit: p.purgeDueAt!,
    })),
  ].sort((a, b) => a.faelligSeit.getTime() - b.faelligSeit.getTime())
}

export interface LoeschBericht {
  bewerbungen: number
  personen: number
  dateien: number
}

/**
 * Löscht alles Fällige. Wird vom Hintergrundlauf nur im Modus „loeschen"
 * aufgerufen; im Modus „erinnern" muss der Admin den Lauf auslösen.
 */
export async function loescheFaellige(userId: string | null): Promise<LoeschBericht> {
  await berechneFristen()
  const jetzt = new Date()
  const bericht: LoeschBericht = { bewerbungen: 0, personen: 0, dateien: 0 }

  /*
   * Reihenfolge mit Bedacht: **erst die Personen, dann die übrigen
   * Bewerbungen.**
   *
   * Wäre es andersherum, ginge mit der letzten Bewerbung auch der einzige
   * Anhaltspunkt für die Personenfrist verloren – der Abschlusszeitpunkt.
   * Die Person bliebe dann als Karteileiche zurück. Eine fällige Person nimmt
   * ihre Bewerbungen per Cascade ohnehin mit; sie werden nur mitgezählt,
   * damit der Bericht stimmt.
   */
  const personen = await prisma.candidate.findMany({
    where: { purgeDueAt: { lte: jetzt }, storageConsent: false },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      _count: { select: { applications: true } },
    },
  })

  for (const person of personen) {
    bericht.dateien += await entferneDateien({ candidateId: person.id })
    await prisma.candidate.delete({ where: { id: person.id } })
    bericht.personen++
    bericht.bewerbungen += person._count.applications
    await audit(userId, 'frist-person-geloescht', 'candidate', person.id, {
      name: `${person.firstName} ${person.lastName}`.trim(),
      email: person.email,
      mitBewerbungen: person._count.applications,
    })
  }

  // Übrig bleiben Bewerbungen, deren Person noch nicht fällig ist – etwa,
  // weil daneben ein neues Verfahren läuft.
  const bewerbungen = await prisma.application.findMany({
    where: { purgeDueAt: { lte: jetzt }, candidate: { storageConsent: false } },
    select: { id: true, candidateId: true },
  })

  for (const bewerbung of bewerbungen) {
    bericht.dateien += await entferneDateien({ applicationId: bewerbung.id })
    await prisma.application.delete({ where: { id: bewerbung.id } })
    bericht.bewerbungen++
    await audit(userId, 'frist-bewerbung-geloescht', 'application', bewerbung.id, {
      bewerberId: bewerbung.candidateId,
    })
  }

  return bericht
}

/**
 * Sammelt die Dateipfade eines Datensatzes und entfernt sie von der Platte.
 * Muss vor dem Löschen des Datensatzes laufen – danach sind die Pfade weg.
 */
async function entferneDateien(bereich: { applicationId?: string; candidateId?: string }): Promise<number> {
  const wo = bereich.applicationId
    ? { applicationId: bereich.applicationId }
    : { application: { candidateId: bereich.candidateId } }

  const [dokumente, anhaenge, mails] = await Promise.all([
    prisma.document.findMany({ where: wo, select: { storagePath: true } }),
    prisma.mailAttachment.findMany({
      where: { mailMessage: wo },
      select: { storagePath: true },
    }),
    prisma.mailMessage.findMany({
      where: bereich.applicationId
        ? { applicationId: bereich.applicationId, emlPath: { not: null } }
        : {
            OR: [{ candidateId: bereich.candidateId }, { application: { candidateId: bereich.candidateId } }],
            emlPath: { not: null },
          },
      select: { emlPath: true },
    }),
  ])

  const pfade = new Set([
    ...dokumente.map((d) => d.storagePath),
    ...anhaenge.map((a) => a.storagePath),
    ...mails.map((m) => m.emlPath!),
  ])

  for (const pfad of pfade) await deleteFile(pfad)
  return pfade.size
}
