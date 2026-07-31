import { Router } from 'express'
import { z } from 'zod'
import { currentUser, requireAuth, requireRecruiter } from '../auth/middleware'
import { prisma } from '../db'
import { audit } from '../lib/audit'
import { badRequest, notFound, wrap } from '../lib/errors'
import { body } from '../lib/validate'

export const stellenRouter = Router()

const stelleSchema = z.object({
  title: z.string().trim().min(2, 'Bitte einen Stellentitel angeben.').max(200),
  reference: z.string().trim().max(50).optional().nullable(),
  location: z.string().trim().max(120).optional().nullable(),
  department: z.string().trim().max(120).optional().nullable(),
  employment: z.string().trim().max(120).optional().nullable(),
  description: z.string().max(50000).default(''),
  keywords: z.array(z.string().trim().min(2).max(60)).max(30).default([]),
  status: z.enum(['ENTWURF', 'OFFEN', 'GESCHLOSSEN']).default('OFFEN'),
  speculative: z.boolean().default(false),
})

/**
 * Interviewer sehen nur die Stellen, für die sie im Gremium sitzen – die
 * Stellenliste ist sonst eine Landkarte aller laufenden Verfahren.
 */
stellenRouter.get(
  '/',
  requireAuth,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const stellen = await prisma.job.findMany({
      where: me.role === 'INTERVIEWER' ? { assignments: { some: { userId: me.id } } } : {},
      orderBy: [{ status: 'asc' }, { title: 'asc' }],
      include: { _count: { select: { applications: true } } },
    })

    // Wie viele Bewerbungen je Stelle noch nicht abgeschlossen sind – das ist
    // die Zahl, die im Alltag zählt.
    const offene = await prisma.application.groupBy({
      by: ['jobId'],
      where: { stage: { notIn: ['ZUSAGE', 'ABSAGE', 'ARCHIV'] } },
      _count: true,
    })
    const offenNach = new Map(offene.map((o) => [o.jobId, o._count]))

    res.json(
      stellen.map((s) => ({
        ...s,
        bewerbungenGesamt: s._count.applications,
        bewerbungenOffen: offenNach.get(s.id) ?? 0,
        _count: undefined,
      })),
    )
  }),
)

stellenRouter.get(
  '/:id',
  requireAuth,
  wrap(async (req, res) => {
    const stelle = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: {
        assignments: { include: { user: { select: { id: true, name: true, email: true } } } },
        _count: { select: { applications: true } },
      },
    })
    if (!stelle) throw notFound('Diese Stelle gibt es nicht.')

    const me = currentUser(req)
    if (me.role === 'INTERVIEWER' && !stelle.assignments.some((a) => a.userId === me.id)) {
      throw notFound('Diese Stelle gibt es nicht oder sie ist nicht freigegeben.')
    }

    res.json(stelle)
  }),
)

stellenRouter.post(
  '/',
  requireRecruiter,
  body(stelleSchema),
  wrap(async (req, res) => {
    const daten = req.body as z.infer<typeof stelleSchema>

    // Genau eine Initiativ-Stelle: sie steuert, welche Vorlagen greifen.
    if (daten.speculative) {
      const vorhanden = await prisma.job.findFirst({ where: { speculative: true } })
      if (vorhanden) {
        throw badRequest(
          `Es gibt bereits einen Eintrag für Initiativbewerbungen („${vorhanden.title}"). Bitte diesen verwenden.`,
        )
      }
    }

    const stelle = await prisma.job.create({ data: bereiteVor(daten) })
    await audit(currentUser(req).id, 'stelle-angelegt', 'job', stelle.id, { titel: stelle.title })
    res.status(201).json(stelle)
  }),
)

stellenRouter.patch(
  '/:id',
  requireRecruiter,
  body(stelleSchema.partial()),
  wrap(async (req, res) => {
    const daten = req.body as Partial<z.infer<typeof stelleSchema>>
    const vorher = await prisma.job.findUnique({ where: { id: req.params.id } })
    if (!vorher) throw notFound('Diese Stelle gibt es nicht.')

    const stelle = await prisma.job.update({
      where: { id: req.params.id },
      data: {
        ...bereiteVor(daten),
        // Schließen setzt das Datum, Wiedereröffnen räumt es weg.
        ...(daten.status === 'GESCHLOSSEN' && vorher.status !== 'GESCHLOSSEN'
          ? { closedAt: new Date() }
          : {}),
        ...(daten.status && daten.status !== 'GESCHLOSSEN' ? { closedAt: null } : {}),
      },
    })

    await audit(currentUser(req).id, 'stelle-geaendert', 'job', stelle.id)
    res.json(stelle)
  }),
)

stellenRouter.delete(
  '/:id',
  requireRecruiter,
  wrap(async (req, res) => {
    const anzahl = await prisma.application.count({ where: { jobId: req.params.id } })
    if (anzahl > 0) {
      throw badRequest(
        `An dieser Stelle hängen ${anzahl} Bewerbung(en). Bitte die Stelle schließen statt löschen – ` +
          `die Stellenbeschreibung bleibt so für eine erneute Ausschreibung erhalten.`,
      )
    }
    await prisma.job.delete({ where: { id: req.params.id } })
    await audit(currentUser(req).id, 'stelle-geloescht', 'job', req.params.id)
    res.json({ ok: true })
  }),
)

function bereiteVor<T extends Partial<z.infer<typeof stelleSchema>>>(daten: T) {
  return {
    ...daten,
    // Stichworte klein und ohne Dubletten – die Zuordnung vergleicht ohnehin
    // in Kleinschreibung.
    ...(daten.keywords
      ? { keywords: [...new Set(daten.keywords.map((k) => k.toLowerCase().trim()).filter(Boolean))] }
      : {}),
  }
}
