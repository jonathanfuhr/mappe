import type { Prisma } from '@prisma/client'
import { Router } from 'express'
import { z } from 'zod'
import { applicationScope, assertCanEditApplication, assertCanViewApplication } from '../auth/access'
import { currentUser, requireAuth, requireRecruiter, type AuthUser } from '../auth/middleware'
import { prisma } from '../db'
import { audit } from '../lib/audit'
import { badRequest, notFound, wrap } from '../lib/errors'
import { body, getQuery, paginationSchema, query, skipTake } from '../lib/validate'

export const bewerbungenRouter = Router()

const PHASEN = [
  'NEU',
  'GESICHTET',
  'IN_PRUEFUNG',
  'EINGELADEN',
  'GESPRAECH_GEFUEHRT',
  'ENTSCHEIDUNG',
  'ZUSAGE',
  'ABSAGE',
  'ARCHIV',
] as const

/** Ab hier gilt die Bewerbung als abgeschlossen – das startet die Löschfrist. */
const ABGESCHLOSSEN = ['ZUSAGE', 'ABSAGE', 'ARCHIV'] as const

const filterSchema = paginationSchema.extend({
  phase: z.enum(PHASEN).optional(),
  stelle: z.string().uuid().optional(),
  quelle: z.enum(['EMAIL', 'WEBSITE_FORMULAR', 'LINKEDIN', 'INDEED', 'MANUELL', 'SONSTIGE']).optional(),
  suche: z.string().trim().max(120).optional(),
  nurZuPruefen: z.coerce.boolean().optional(),
  initiativ: z.coerce.boolean().optional(),
  sortierung: z.enum(['neueste', 'aelteste', 'bewertung', 'name']).default('neueste'),
})

/**
 * Baut die Filterbedingung für Liste und Board.
 *
 * Die Sichtbarkeitsprüfung steht als **eigener Eintrag in einem AND-Feld**,
 * nicht als Spread neben den Filtern. Der Grund ist eine Falle, die genau
 * einmal zugeschlagen hat: `applicationScope` liefert für Interviewer ein
 * `OR`, und die Volltextsuche liefert ebenfalls ein `OR`. Nebeneinander
 * gespreadet überschreibt das zweite das erste – ein Interviewer hätte beim
 * Tippen in die Suche jede Bewerbung im Haus gesehen.
 *
 * In dieser Form kann kein künftiger Filter die Prüfung mehr aushebeln.
 */
export function baueBewerbungsFilter(
  user: AuthUser,
  f: Partial<z.infer<typeof filterSchema>>,
): Prisma.ApplicationWhereInput {
  const bedingungen: Prisma.ApplicationWhereInput[] = [applicationScope(user)]

  if (f.phase) bedingungen.push({ stage: f.phase })
  if (f.stelle) bedingungen.push({ jobId: f.stelle })
  if (f.quelle) bedingungen.push({ source: f.quelle })
  if (f.nurZuPruefen) bedingungen.push({ needsReview: true })
  if (f.initiativ !== undefined) bedingungen.push({ speculative: f.initiativ })

  if (f.suche) {
    bedingungen.push({
      OR: [
        { subject: { contains: f.suche, mode: 'insensitive' } },
        { candidate: { firstName: { contains: f.suche, mode: 'insensitive' } } },
        { candidate: { lastName: { contains: f.suche, mode: 'insensitive' } } },
        { candidate: { email: { contains: f.suche, mode: 'insensitive' } } },
        { job: { title: { contains: f.suche, mode: 'insensitive' } } },
      ],
    })
  }

  return { AND: bedingungen }
}

const listenAuswahl = {
  id: true,
  stage: true,
  stageChangedAt: true,
  source: true,
  speculative: true,
  subject: true,
  summary: true,
  needsReview: true,
  appliedAt: true,
  boardOrder: true,
  createdAt: true,
  candidate: {
    select: { id: true, salutation: true, title: true, firstName: true, lastName: true, email: true, phone: true, city: true },
  },
  job: { select: { id: true, title: true, reference: true, speculative: true } },
  _count: { select: { documents: true, mails: true, notes: true } },
} satisfies Prisma.ApplicationSelect

bewerbungenRouter.get(
  '/',
  requireAuth,
  query(filterSchema),
  wrap(async (req, res) => {
    const me = currentUser(req)
    const f = getQuery<z.infer<typeof filterSchema>>(req)

    const where = baueBewerbungsFilter(me, f)

    const orderBy: Prisma.ApplicationOrderByWithRelationInput[] =
      f.sortierung === 'aelteste'
        ? [{ appliedAt: 'asc' }]
        : f.sortierung === 'name'
          ? [{ candidate: { lastName: 'asc' } }, { candidate: { firstName: 'asc' } }]
          : [{ appliedAt: 'desc' }]

    const [eintraege, gesamt] = await Promise.all([
      prisma.application.findMany({ where, select: listenAuswahl, orderBy, ...skipTake(f) }),
      prisma.application.count({ where }),
    ])

    const mitBewertung = await ergaenzeBewertungen(eintraege)

    // Nach Durchschnittsnote sortieren geht erst, wenn die Noten da sind –
    // die Aggregation lässt sich in Prisma nicht als orderBy ausdrücken.
    if (f.sortierung === 'bewertung') {
      mitBewertung.sort((a, b) => (b.bewertung.schnitt ?? -1) - (a.bewertung.schnitt ?? -1))
    }

    res.json({ eintraege: mitBewertung, gesamt, seite: f.seite, proSeite: f.proSeite })
  }),
)

/** Alle Bewerbungen nach Phasen gruppiert – die Vorlage für das Kanban-Board. */
bewerbungenRouter.get(
  '/board',
  requireAuth,
  query(filterSchema.partial()),
  wrap(async (req, res) => {
    const me = currentUser(req)
    const f = getQuery<Partial<z.infer<typeof filterSchema>>>(req)

    // Dieselbe Filterfunktion wie die Liste – damit lässt sich die
    // Sichtbarkeitsprüfung nicht an einer Stelle vergessen.
    const eintraege = await prisma.application.findMany({
      where: baueBewerbungsFilter(me, f),
      select: listenAuswahl,
      orderBy: [{ boardOrder: 'asc' }, { appliedAt: 'desc' }],
      // Ein Board mit tausend Karten hilft niemandem; das Archiv liegt in der
      // Listenansicht.
      take: 600,
    })

    const mitBewertung = await ergaenzeBewertungen(eintraege)
    const spalten = PHASEN.map((phase) => ({
      phase,
      eintraege: mitBewertung.filter((e) => e.stage === phase),
    }))

    res.json({ spalten })
  }),
)

bewerbungenRouter.get(
  '/:id',
  requireAuth,
  wrap(async (req, res) => {
    const me = currentUser(req)
    await assertCanViewApplication(me, req.params.id)

    const bewerbung = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: {
        candidate: { include: { fieldValues: { include: { field: true } } } },
        job: true,
        documents: { orderBy: [{ category: 'asc' }, { createdAt: 'asc' }] },
        mails: {
          orderBy: { createdAt: 'asc' },
          include: { attachments: true, sentBy: { select: { id: true, name: true } } },
        },
        ratings: { include: { user: { select: { id: true, name: true } } } },
        notes: {
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { id: true, name: true } } },
        },
        interviews: {
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { id: true, name: true } }, template: true },
        },
        assignments: { include: { user: { select: { id: true, name: true, email: true } } } },
        suggestions: { where: { dismissedAt: null }, orderBy: { createdAt: 'desc' } },
        fieldValues: { include: { field: true } },
      },
    })
    if (!bewerbung) throw notFound('Diese Bewerbung gibt es nicht.')

    // Interviewer sollen den Mailverlauf nicht sehen – dort stehen
    // Gehaltsverhandlungen und Absagen an andere Bewerber.
    const gefiltert =
      me.role === 'INTERVIEWER' ? { ...bewerbung, mails: [], suggestions: [] } : bewerbung

    res.json({ ...gefiltert, bewertung: rechneBewertung(bewerbung.ratings) })
  }),
)

const manuellSchema = z.object({
  bewerberId: z.string().uuid().optional(),
  anrede: z.enum(['KEINE', 'FRAU', 'HERR', 'DIVERS']).default('KEINE'),
  titel: z.string().trim().max(40).optional(),
  vorname: z.string().trim().max(100).default(''),
  nachname: z.string().trim().max(100).default(''),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  telefon: z.string().trim().max(50).optional(),
  strasse: z.string().trim().max(200).optional(),
  plz: z.string().trim().max(12).optional(),
  ort: z.string().trim().max(120).optional(),
  stelleId: z.string().uuid().optional().nullable(),
  initiativ: z.boolean().default(false),
  quelle: z.enum(['EMAIL', 'WEBSITE_FORMULAR', 'LINKEDIN', 'INDEED', 'MANUELL', 'SONSTIGE']).default('MANUELL'),
  betreff: z.string().trim().max(300).optional(),
  notiz: z.string().max(5000).optional(),
})

/**
 * Von Hand angelegte Bewerbung – für Papierbewerbungen und Portale, die nichts
 * per Mail weitergeben. Dateien werden anschließend über den Dokumenten-Upload
 * nachgereicht.
 */
bewerbungenRouter.post(
  '/',
  requireRecruiter,
  body(manuellSchema),
  wrap(async (req, res) => {
    const me = currentUser(req)
    const d = req.body as z.infer<typeof manuellSchema>

    if (!d.bewerberId && !d.nachname && !d.email) {
      throw badRequest('Bitte mindestens einen Nachnamen oder eine E-Mail-Adresse angeben.')
    }

    const bewerberId =
      d.bewerberId ??
      (
        await prisma.candidate.create({
          data: {
            salutation: d.anrede,
            title: d.titel || null,
            firstName: d.vorname,
            lastName: d.nachname,
            email: d.email || null,
            phone: d.telefon || null,
            street: d.strasse || null,
            postalCode: d.plz || null,
            city: d.ort || null,
          },
          select: { id: true },
        })
      ).id

    const bewerbung = await prisma.application.create({
      data: {
        candidateId: bewerberId,
        jobId: d.initiativ ? null : (d.stelleId ?? null),
        speculative: d.initiativ,
        source: d.quelle,
        subject: d.betreff || null,
        // Von Hand erfasste Daten sind bereits geprüft – kein Review nötig.
        needsReview: false,
        reviewedAt: new Date(),
      },
    })

    if (d.notiz) {
      await prisma.note.create({
        data: { applicationId: bewerbung.id, userId: me.id, body: d.notiz },
      })
    }

    await audit(me.id, 'bewerbung-manuell-angelegt', 'application', bewerbung.id)
    res.status(201).json(bewerbung)
  }),
)

const phaseSchema = z.object({
  phase: z.enum(PHASEN),
  /** Position innerhalb der Spalte beim Verschieben auf dem Board. */
  position: z.number().int().min(0).optional(),
})

bewerbungenRouter.patch(
  '/:id/phase',
  requireAuth,
  body(phaseSchema),
  wrap(async (req, res) => {
    const me = currentUser(req)
    await assertCanEditApplication(me, req.params.id)

    const { phase, position } = req.body as z.infer<typeof phaseSchema>
    const vorher = await prisma.application.findUniqueOrThrow({ where: { id: req.params.id } })

    const schliesstAb = (ABGESCHLOSSEN as readonly string[]).includes(phase)
    const warAbgeschlossen = (ABGESCHLOSSEN as readonly string[]).includes(vorher.stage)

    const bewerbung = await prisma.application.update({
      where: { id: req.params.id },
      data: {
        stage: phase,
        stageChangedAt: new Date(),
        ...(position !== undefined ? { boardOrder: position } : {}),
        // closedAt startet die Aufbewahrungsfrist. Wird die Bewerbung wieder
        // aufgenommen, läuft die Frist nicht weiter.
        ...(schliesstAb && !warAbgeschlossen ? { closedAt: new Date() } : {}),
        ...(!schliesstAb && warAbgeschlossen ? { closedAt: null, purgeDueAt: null } : {}),
      },
    })

    await audit(me.id, 'phase-geaendert', 'application', bewerbung.id, {
      von: vorher.stage,
      nach: phase,
    })
    res.json(bewerbung)
  }),
)

const aenderungsSchema = z.object({
  stelleId: z.string().uuid().nullable().optional(),
  initiativ: z.boolean().optional(),
  betreff: z.string().trim().max(300).nullable().optional(),
  summary: z.string().max(5000).nullable().optional(),
  quelle: z.enum(['EMAIL', 'WEBSITE_FORMULAR', 'LINKEDIN', 'INDEED', 'MANUELL', 'SONSTIGE']).optional(),
})

bewerbungenRouter.patch(
  '/:id',
  requireAuth,
  body(aenderungsSchema),
  wrap(async (req, res) => {
    const me = currentUser(req)
    await assertCanEditApplication(me, req.params.id)
    const d = req.body as z.infer<typeof aenderungsSchema>

    const bewerbung = await prisma.application.update({
      where: { id: req.params.id },
      data: {
        ...(d.stelleId !== undefined ? { jobId: d.stelleId } : {}),
        ...(d.initiativ !== undefined ? { speculative: d.initiativ } : {}),
        ...(d.betreff !== undefined ? { subject: d.betreff } : {}),
        ...(d.summary !== undefined ? { summary: d.summary } : {}),
        ...(d.quelle !== undefined ? { source: d.quelle } : {}),
      },
    })
    res.json(bewerbung)
  }),
)

/** Bestätigt die erkannten Vorschläge – die Bewerbung gilt danach als geprüft. */
bewerbungenRouter.post(
  '/:id/geprueft',
  requireAuth,
  wrap(async (req, res) => {
    const me = currentUser(req)
    await assertCanEditApplication(me, req.params.id)

    await prisma.$transaction([
      prisma.application.update({
        where: { id: req.params.id },
        data: { needsReview: false, reviewedAt: new Date() },
      }),
      prisma.extractionSuggestion.updateMany({
        where: { applicationId: req.params.id, appliedAt: null, dismissedAt: null },
        data: { appliedAt: new Date() },
      }),
    ])

    await audit(me.id, 'bewerbung-geprueft', 'application', req.params.id)
    res.json({ ok: true })
  }),
)

/** Zuweisung an Interviewer. */
bewerbungenRouter.put(
  '/:id/zuweisungen',
  requireRecruiter,
  body(z.object({ nutzerIds: z.array(z.string().uuid()).max(50) })),
  wrap(async (req, res) => {
    const me = currentUser(req)
    const { nutzerIds } = req.body as { nutzerIds: string[] }
    await assertCanEditApplication(me, req.params.id)

    await prisma.$transaction([
      prisma.applicationAssignment.deleteMany({ where: { applicationId: req.params.id } }),
      prisma.applicationAssignment.createMany({
        data: nutzerIds.map((userId) => ({ applicationId: req.params.id, userId })),
        skipDuplicates: true,
      }),
    ])

    await audit(me.id, 'zuweisung-geaendert', 'application', req.params.id, { anzahl: nutzerIds.length })
    res.json({ ok: true })
  }),
)

bewerbungenRouter.delete(
  '/:id',
  requireRecruiter,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const bewerbung = await prisma.application.findUnique({
      where: { id: req.params.id },
      select: { id: true, candidateId: true },
    })
    if (!bewerbung) throw notFound('Diese Bewerbung gibt es nicht.')

    // Dateien werden vom Aufräumlauf entfernt; hier zählt, dass der
    // Datensatz sofort verschwindet.
    await prisma.application.delete({ where: { id: req.params.id } })
    await audit(me.id, 'bewerbung-geloescht', 'application', req.params.id, {
      bewerberId: bewerbung.candidateId,
    })
    res.json({ ok: true })
  }),
)

// --- Hilfsfunktionen --------------------------------------------------------

interface BewertungsWert {
  schnitt: number | null
  anzahl: number
  ja: number
  vielleicht: number
  nein: number
}

function rechneBewertung(bewertungen: { stars: number; verdict: string | null }[]): BewertungsWert {
  if (bewertungen.length === 0) {
    return { schnitt: null, anzahl: 0, ja: 0, vielleicht: 0, nein: 0 }
  }
  const summe = bewertungen.reduce((s, b) => s + b.stars, 0)
  return {
    schnitt: Math.round((summe / bewertungen.length) * 10) / 10,
    anzahl: bewertungen.length,
    ja: bewertungen.filter((b) => b.verdict === 'JA').length,
    vielleicht: bewertungen.filter((b) => b.verdict === 'VIELLEICHT').length,
    nein: bewertungen.filter((b) => b.verdict === 'NEIN').length,
  }
}

type ListenEintrag = Prisma.ApplicationGetPayload<{ select: typeof listenAuswahl }>

/** Holt die Noten für eine ganze Liste in einer Abfrage statt je Zeile. */
async function ergaenzeBewertungen(
  eintraege: ListenEintrag[],
): Promise<(ListenEintrag & { bewertung: BewertungsWert })[]> {
  if (eintraege.length === 0) return []

  const bewertungen = await prisma.rating.findMany({
    where: { applicationId: { in: eintraege.map((e) => e.id) } },
    select: { applicationId: true, stars: true, verdict: true },
  })

  const nachBewerbung = new Map<string, { stars: number; verdict: string | null }[]>()
  for (const b of bewertungen) {
    const liste = nachBewerbung.get(b.applicationId) ?? []
    liste.push({ stars: b.stars, verdict: b.verdict })
    nachBewerbung.set(b.applicationId, liste)
  }

  return eintraege.map((e) => ({ ...e, bewertung: rechneBewertung(nachBewerbung.get(e.id) ?? []) }))
}
