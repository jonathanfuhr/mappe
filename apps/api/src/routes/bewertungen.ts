import { Router } from 'express'
import { z } from 'zod'
import { assertCanCommentApplication, assertCanViewCandidate } from '../auth/access'
import { currentUser, requireAuth } from '../auth/middleware'
import { prisma } from '../db'
import { ereignis } from '../lib/historie'
import { badRequest, forbidden, notFound, wrap } from '../lib/errors'
import { body } from '../lib/validate'

export const bewertungenRouter = Router()

const bewertungSchema = z.object({
  sterne: z.number().int().min(1, 'Bitte 1 bis 5 Sterne vergeben.').max(5),
  urteil: z.enum(['JA', 'VIELLEICHT', 'NEIN']).nullable().optional(),
  kommentar: z.string().max(4000).nullable().optional(),
})

/**
 * Jeder Nutzer hat genau eine Bewertung je Bewerbung. Ein erneutes Absenden
 * überschreibt die eigene – fremde bleiben unangetastet, auch für Admins.
 * Der Durchschnitt ergibt sich aus allen.
 */
bewertungenRouter.put(
  '/bewerbung/:id',
  requireAuth,
  body(bewertungSchema),
  wrap(async (req, res) => {
    const me = currentUser(req)
    await assertCanCommentApplication(me, req.params.id)
    const d = req.body as z.infer<typeof bewertungSchema>

    const bewertung = await prisma.rating.upsert({
      where: { applicationId_userId: { applicationId: req.params.id, userId: me.id } },
      create: {
        applicationId: req.params.id,
        userId: me.id,
        stars: d.sterne,
        verdict: d.urteil ?? null,
        comment: d.kommentar ?? null,
      },
      update: {
        stars: d.sterne,
        verdict: d.urteil ?? null,
        comment: d.kommentar ?? null,
      },
      include: { user: { select: { id: true, name: true } } },
    })

    await ereignis(req.params.id, 'BEWERTUNG', me, {
      sterne: d.sterne,
      urteil: d.urteil ?? null,
    })

    res.json(bewertung)
  }),
)

bewertungenRouter.delete(
  '/:id',
  requireAuth,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const bewertung = await prisma.rating.findUnique({ where: { id: req.params.id } })
    if (!bewertung) throw notFound('Diese Bewertung gibt es nicht.')
    // Auch ein Admin löscht keine fremde Bewertung – sonst ist der
    // Durchschnitt nicht mehr das, was das Gremium abgegeben hat.
    if (bewertung.userId !== me.id) throw forbidden('Nur die eigene Bewertung lässt sich löschen.')

    await prisma.rating.delete({ where: { id: req.params.id } })
    res.json({ ok: true })
  }),
)

// --- Notizen ----------------------------------------------------------------

export const notizenRouter = Router()

const notizSchema = z
  .object({
    bewerbungId: z.string().uuid().optional(),
    bewerberId: z.string().uuid().optional(),
    art: z.enum(['ALLGEMEIN', 'GESPRAECH']).default('ALLGEMEIN'),
    text: z.string().trim().min(1, 'Die Notiz ist leer.').max(20000),
  })
  .refine((d) => d.bewerbungId || d.bewerberId, {
    message: 'Eine Notiz gehört entweder zu einer Bewerbung oder zu einem Bewerber.',
  })

notizenRouter.post(
  '/',
  requireAuth,
  body(notizSchema),
  wrap(async (req, res) => {
    const me = currentUser(req)
    const d = req.body as z.infer<typeof notizSchema>

    if (d.bewerbungId) await assertCanCommentApplication(me, d.bewerbungId)
    if (d.bewerberId) await assertCanViewCandidate(me, d.bewerberId)

    const notiz = await prisma.note.create({
      data: {
        applicationId: d.bewerbungId ?? null,
        candidateId: d.bewerberId ?? null,
        userId: me.id,
        kind: d.art,
        body: d.text,
      },
      include: { user: { select: { id: true, name: true } } },
    })

    // Nur Notizen an einer Bewerbung gehören in deren Historie; eine reine
    // Personennotiz hat keine Bewerbung, an der sie hängen könnte.
    if (d.bewerbungId) await ereignis(d.bewerbungId, 'NOTIZ', me, { art: d.art })

    res.status(201).json(notiz)
  }),
)

notizenRouter.patch(
  '/:id',
  requireAuth,
  body(z.object({ text: z.string().trim().min(1).max(20000) })),
  wrap(async (req, res) => {
    const me = currentUser(req)
    const notiz = await prisma.note.findUnique({ where: { id: req.params.id } })
    if (!notiz) throw notFound('Diese Notiz gibt es nicht.')
    if (notiz.userId !== me.id) throw forbidden('Nur die eigene Notiz lässt sich ändern.')

    const aktualisiert = await prisma.note.update({
      where: { id: req.params.id },
      data: { body: (req.body as { text: string }).text },
      include: { user: { select: { id: true, name: true } } },
    })
    res.json(aktualisiert)
  }),
)

notizenRouter.delete(
  '/:id',
  requireAuth,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const notiz = await prisma.note.findUnique({ where: { id: req.params.id } })
    if (!notiz) throw notFound('Diese Notiz gibt es nicht.')
    // Der Admin darf aufräumen, alle anderen nur die eigene Notiz.
    if (notiz.userId !== me.id && me.role !== 'ADMIN') {
      throw forbidden('Nur die eigene Notiz lässt sich löschen.')
    }

    await prisma.note.delete({ where: { id: req.params.id } })
    res.json({ ok: true })
  }),
)
