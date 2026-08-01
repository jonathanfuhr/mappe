import { Router } from 'express'
import { z } from 'zod'
import { currentUser, requireAuth } from '../auth/middleware'
import { wrap } from '../lib/errors'
import { body } from '../lib/validate'
import { holeFuer, markiereGelesen } from './service'

export const benachrichtigungenRouter = Router()

benachrichtigungenRouter.get(
  '/',
  requireAuth,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const eintraege = await holeFuer(me.id, req.query.ungelesen === 'true')
    res.json(eintraege)
  }),
)

const gelesenSchema = z.object({
  /** Ohne Liste gilt alles als gelesen. */
  ids: z.array(z.string().uuid()).max(200).nullable().optional(),
})

benachrichtigungenRouter.post(
  '/gelesen',
  requireAuth,
  body(gelesenSchema),
  wrap(async (req, res) => {
    const me = currentUser(req)
    const d = req.body as z.infer<typeof gelesenSchema>
    const anzahl = await markiereGelesen(me.id, d.ids ?? null)
    res.json({ anzahl })
  }),
)
