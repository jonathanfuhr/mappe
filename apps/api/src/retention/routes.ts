import { Router } from 'express'
import { currentUser, requireAdmin } from '../auth/middleware'
import { audit } from '../lib/audit'
import { wrap } from '../lib/errors'
import { holeStand, listeFaellige, loescheFaellige } from './service'

export const aufbewahrungRouter = Router()

aufbewahrungRouter.get(
  '/',
  requireAdmin,
  wrap(async (_req, res) => {
    res.json(await holeStand())
  }),
)

aufbewahrungRouter.get(
  '/faellig',
  requireAdmin,
  wrap(async (_req, res) => {
    res.json(await listeFaellige())
  }),
)

/**
 * Löschlauf von Hand. Im Modus „erinnern" ist das der einzige Weg – dort
 * löscht das Tool nichts von selbst.
 */
aufbewahrungRouter.post(
  '/loeschen',
  requireAdmin,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const bericht = await loescheFaellige(me.id)
    await audit(me.id, 'fristenlauf-manuell', 'aufbewahrung', null, bericht as unknown as Record<string, unknown>)
    res.json(bericht)
  }),
)
