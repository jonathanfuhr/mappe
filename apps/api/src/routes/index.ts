import { Router } from 'express'
import { requireAuth } from '../auth/middleware'
import { usersRouter } from './users'

export const apiRouter = Router()

apiRouter.use('/nutzer', usersRouter)

/** Kleiner Sammelpunkt für Zahlen, die das Dashboard braucht. */
apiRouter.get('/uebersicht', requireAuth, (_req, res) => {
  res.json({ hinweis: 'Wird mit der Bewerbungsverwaltung gefüllt.' })
})
