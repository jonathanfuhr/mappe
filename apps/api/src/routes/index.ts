import { Router } from 'express'
import { kiRouter } from '../ai/routes'
import { requireAuth } from '../auth/middleware'
import { applicationScope } from '../auth/access'
import { currentUser } from '../auth/middleware'
import { prisma } from '../db'
import { wrap } from '../lib/errors'
import { mailRouter } from '../mail/routes'
import { aufbewahrungRouter } from '../retention/routes'
import { bewerberRouter } from './bewerber'
import { bewerbungenRouter } from './bewerbungen'
import { bewertungenRouter, kommentareRouter, notizenRouter } from './bewertungen'
import { dokumenteRouter } from './dokumente'
import { stellenRouter } from './stellen'
import { usersRouter } from './users'
import { gespraecheRouter } from './gespraeche'
import { freifelderRouter, vorlagenRouter } from './vorlagen'

export const apiRouter = Router()

apiRouter.use('/nutzer', usersRouter)
apiRouter.use('/stellen', stellenRouter)
apiRouter.use('/bewerbungen', bewerbungenRouter)
apiRouter.use('/bewerber', bewerberRouter)
apiRouter.use('/dokumente', dokumenteRouter)
apiRouter.use('/bewertungen', bewertungenRouter)
apiRouter.use('/notizen', notizenRouter)
apiRouter.use('/kommentare', kommentareRouter)
apiRouter.use('/vorlagen', vorlagenRouter)
apiRouter.use('/freifelder', freifelderRouter)
apiRouter.use('/gespraeche', gespraecheRouter)
apiRouter.use('/aufbewahrung', aufbewahrungRouter)
apiRouter.use('/ki', kiRouter)
apiRouter.use('/mail', mailRouter)

/** Zahlen für die Startseite. */
apiRouter.get(
  '/uebersicht',
  requireAuth,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const sichtbar = applicationScope(me)

    const [nachPhase, zuPruefen, offeneStellen, letzte] = await Promise.all([
      prisma.application.groupBy({ by: ['stage'], where: sichtbar, _count: true }),
      prisma.application.count({ where: { ...sichtbar, needsReview: true } }),
      prisma.job.count({ where: { status: 'OFFEN', speculative: false } }),
      prisma.application.findMany({
        where: sichtbar,
        orderBy: { appliedAt: 'desc' },
        take: 8,
        select: {
          id: true,
          stage: true,
          appliedAt: true,
          needsReview: true,
          source: true,
          candidate: { select: { firstName: true, lastName: true, email: true } },
          job: { select: { title: true } },
        },
      }),
    ])

    const phasen = Object.fromEntries(nachPhase.map((p) => [p.stage, p._count]))
    const gesamt = nachPhase.reduce((summe, p) => summe + p._count, 0)
    const laufend = nachPhase
      .filter((p) => !['ZUSAGE', 'ABSAGE', 'ARCHIV'].includes(p.stage))
      .reduce((summe, p) => summe + p._count, 0)

    res.json({ phasen, gesamt, laufend, zuPruefen, offeneStellen, letzte })
  }),
)
