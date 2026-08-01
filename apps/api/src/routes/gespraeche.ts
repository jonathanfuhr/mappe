import { Router } from 'express'
import { z } from 'zod'
import { assertCanCommentApplication, assertCanViewApplication } from '../auth/access'
import { currentUser, requireAdmin, requireAuth } from '../auth/middleware'
import { prisma } from '../db'
import { audit } from '../lib/audit'
import { ereignis } from '../lib/historie'
import { badRequest, forbidden, notFound, wrap } from '../lib/errors'
import { body } from '../lib/validate'

export const gespraecheRouter = Router()

const frageSchema = z.object({
  id: z.string().min(1).max(60),
  text: z.string().trim().min(1).max(500),
  hint: z.string().trim().max(500).optional(),
})

const abschnittSchema = z.object({
  title: z.string().trim().min(1).max(120),
  questions: z.array(frageSchema).max(40),
})

const vorlagenSchema = z.object({
  name: z.string().trim().min(2).max(120),
  jobId: z.string().uuid().nullable().optional(),
  sections: z.array(abschnittSchema).max(20).default([]),
  active: z.boolean().default(true),
})

// --- Gesprächsvorlagen ------------------------------------------------------

gespraecheRouter.get(
  '/vorlagen',
  requireAuth,
  wrap(async (req, res) => {
    // Die Verwaltung braucht auch die abgeschalteten – überall sonst stören
    // sie nur, deshalb bleibt „nur aktive" die Vorgabe.
    const auchInaktive = req.query.alle === 'true' && currentUser(req).role === 'ADMIN'
    const vorlagen = await prisma.interviewTemplate.findMany({
      where: auchInaktive ? {} : { active: true },
      orderBy: [{ jobId: 'asc' }, { name: 'asc' }],
      include: { job: { select: { id: true, title: true } } },
    })
    res.json(vorlagen)
  }),
)

gespraecheRouter.post(
  '/vorlagen',
  requireAdmin,
  body(vorlagenSchema),
  wrap(async (req, res) => {
    const d = req.body as z.infer<typeof vorlagenSchema>
    const vorlage = await prisma.interviewTemplate.create({
      data: { name: d.name, jobId: d.jobId ?? null, sections: d.sections as object, active: d.active },
    })
    await audit(currentUser(req).id, 'gespraechsvorlage-angelegt', 'interviewTemplate', vorlage.id)
    res.status(201).json(vorlage)
  }),
)

gespraecheRouter.patch(
  '/vorlagen/:id',
  requireAdmin,
  body(vorlagenSchema.partial()),
  wrap(async (req, res) => {
    const d = req.body as Partial<z.infer<typeof vorlagenSchema>>
    const vorlage = await prisma.interviewTemplate.update({
      where: { id: req.params.id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.jobId !== undefined ? { jobId: d.jobId } : {}),
        ...(d.sections !== undefined ? { sections: d.sections as object } : {}),
        ...(d.active !== undefined ? { active: d.active } : {}),
      },
    })
    res.json(vorlage)
  }),
)

gespraecheRouter.delete(
  '/vorlagen/:id',
  requireAdmin,
  wrap(async (req, res) => {
    await prisma.interviewTemplate.delete({ where: { id: req.params.id } })
    await audit(currentUser(req).id, 'gespraechsvorlage-geloescht', 'interviewTemplate', req.params.id)
    res.json({ ok: true })
  }),
)

// --- Gespräche --------------------------------------------------------------

const ARTEN = ['PERSOENLICH', 'TELEFON', 'VIDEO'] as const

const gespraechSchema = z.object({
  bewerbungId: z.string().uuid(),
  // Bewusst auch `null` erlaubt: ein Gespräch ohne Leitfaden ist der
  // Regelfall der zweiten und dritten Runde – dann zählt nur das Notizfeld.
  vorlageId: z.string().uuid().nullable().optional(),
  titel: z.string().trim().max(160).default('Gespräch'),
  art: z.enum(ARTEN).default('PERSOENLICH'),
})

/**
 * Ein Gespräch wird angelegt, sobald jemand die Vorlage aufruft. Es gehört
 * dem anlegenden Nutzer – Interviewer schreiben ihre eigenen Notizen, nicht
 * die der anderen.
 */
gespraecheRouter.post(
  '/',
  requireAuth,
  body(gespraechSchema),
  wrap(async (req, res) => {
    const me = currentUser(req)
    const d = req.body as z.infer<typeof gespraechSchema>
    await assertCanCommentApplication(me, d.bewerbungId)

    const bewerbung = await prisma.application.findUniqueOrThrow({
      where: { id: d.bewerbungId },
      select: { stage: true },
    })
    // Der Plan sieht die Vorlage ab „Eingeladen" vor. Früher ist sie selten
    // sinnvoll, deshalb der Hinweis – verboten wird es nicht.
    const zuFrueh = ['NEU', 'GESICHTET'].includes(bewerbung.stage)

    const gespraech = await prisma.interview.create({
      data: {
        applicationId: d.bewerbungId,
        templateId: d.vorlageId ?? null,
        userId: me.id,
        title: d.titel,
        kind: d.art,
      },
      include: { user: { select: { id: true, name: true } }, template: true },
    })

    await ereignis(d.bewerbungId, 'GESPRAECH_ANGELEGT', me, {
      art: d.art,
      leitfaden: gespraech.template?.name ?? null,
    })

    res.status(201).json({ ...gespraech, hinweis: zuFrueh ? 'Die Bewerbung ist noch nicht eingeladen.' : null })
  }),
)

/**
 * Ein einzelnes Gespräch – für die eigene Seite, die in einem zweiten Tab
 * geöffnet wird. Dort ist Platz für den ganzen Fragenkatalog, während im
 * ersten Tab der Lebenslauf offen bleibt.
 *
 * Mitgeliefert wird nur so viel Kontext, wie der Kopf der Seite braucht:
 * um wen es geht und auf welche Stelle. Der Mailverlauf hat hier nichts zu
 * suchen – die Seite steht auch Interviewern offen.
 */
gespraecheRouter.get(
  '/:id',
  requireAuth,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const gespraech = await prisma.interview.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true } },
        template: true,
        application: {
          select: {
            id: true,
            stage: true,
            candidate: { select: { firstName: true, lastName: true, email: true } },
            job: { select: { id: true, title: true } },
          },
        },
      },
    })
    if (!gespraech) throw notFound('Dieses Gespräch gibt es nicht.')
    await assertCanViewApplication(me, gespraech.applicationId)
    res.json(gespraech)
  }),
)

const antwortenSchema = z.object({
  antworten: z.record(z.string().max(8000)).optional(),
  notizen: z.string().max(20000).optional(),
  titel: z.string().trim().max(160).optional(),
  art: z.enum(ARTEN).optional(),
  gefuehrtAm: z.string().datetime().nullable().optional(),
  /** Mit dem Speichern abschließen. Danach ist der Bogen nur noch zu lesen. */
  abschliessen: z.boolean().optional(),
})

gespraecheRouter.patch(
  '/:id',
  requireAuth,
  body(antwortenSchema),
  wrap(async (req, res) => {
    const me = currentUser(req)
    const d = req.body as z.infer<typeof antwortenSchema>

    const gespraech = await prisma.interview.findUnique({ where: { id: req.params.id } })
    if (!gespraech) throw notFound('Dieses Gespräch gibt es nicht.')
    if (gespraech.userId !== me.id) {
      throw forbidden('Nur die eigenen Gesprächsnotizen lassen sich ändern.')
    }
    // Ein abgeschlossenes Gespräch ist zu. Sonst ließe sich Tage später
    // nachtragen, was angeblich im Gespräch gesagt wurde – und niemand sähe es
    // dem Bogen an. Wer wirklich ändern muss, öffnet ihn ausdrücklich wieder.
    if (gespraech.completedAt) {
      throw badRequest('Dieses Gespräch ist abgeschlossen. Zum Ändern bitte wieder öffnen.')
    }

    const aktualisiert = await prisma.interview.update({
      where: { id: req.params.id },
      data: {
        ...(d.antworten !== undefined ? { answers: d.antworten as object } : {}),
        ...(d.notizen !== undefined ? { notes: d.notizen } : {}),
        ...(d.titel !== undefined ? { title: d.titel } : {}),
        ...(d.art !== undefined ? { kind: d.art } : {}),
        ...(d.gefuehrtAm !== undefined
          ? { conductedAt: d.gefuehrtAm ? new Date(d.gefuehrtAm) : null }
          : {}),
        ...(d.abschliessen ? { completedAt: new Date() } : {}),
      },
      include: { user: { select: { id: true, name: true } }, template: true },
    })
    if (d.abschliessen) {
      await audit(me.id, 'gespraech-abgeschlossen', 'interview', aktualisiert.id, {
        bewerbungId: aktualisiert.applicationId,
      })
      await ereignis(aktualisiert.applicationId, 'GESPRAECH_ABGESCHLOSSEN', me, {
        art: aktualisiert.kind,
        leitfaden: aktualisiert.template?.name ?? null,
      })
    }
    res.json(aktualisiert)
  }),
)

/**
 * Ein abgeschlossenes Gespräch wieder öffnen.
 *
 * Bewusst ein eigener Schritt und nicht einfach ein `completedAt: null` im
 * PATCH: So steht im Protokoll, dass ein fertiger Bogen noch einmal angefasst
 * wurde – bei einer späteren Rückfrage ist das der Unterschied zwischen
 * „ergänzt" und „unbemerkt geändert".
 */
gespraecheRouter.post(
  '/:id/wieder-oeffnen',
  requireAuth,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const gespraech = await prisma.interview.findUnique({ where: { id: req.params.id } })
    if (!gespraech) throw notFound('Dieses Gespräch gibt es nicht.')
    if (gespraech.userId !== me.id) {
      throw forbidden('Nur die eigenen Gesprächsnotizen lassen sich ändern.')
    }
    if (!gespraech.completedAt) throw badRequest('Dieses Gespräch ist gar nicht abgeschlossen.')

    const aktualisiert = await prisma.interview.update({
      where: { id: req.params.id },
      data: { completedAt: null },
      include: { user: { select: { id: true, name: true } }, template: true },
    })
    await audit(me.id, 'gespraech-wieder-geoeffnet', 'interview', aktualisiert.id, {
      bewerbungId: aktualisiert.applicationId,
      warAbgeschlossenSeit: gespraech.completedAt,
    })
    await ereignis(aktualisiert.applicationId, 'GESPRAECH_WIEDER_GEOEFFNET', me, {
      warAbgeschlossenSeit: gespraech.completedAt,
    })
    res.json(aktualisiert)
  }),
)

gespraecheRouter.delete(
  '/:id',
  requireAuth,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const gespraech = await prisma.interview.findUnique({ where: { id: req.params.id } })
    if (!gespraech) throw notFound('Dieses Gespräch gibt es nicht.')
    if (gespraech.userId !== me.id && me.role !== 'ADMIN') {
      throw forbidden('Nur das eigene Gespräch lässt sich löschen.')
    }
    await prisma.interview.delete({ where: { id: req.params.id } })
    res.json({ ok: true })
  }),
)

/** Die für eine Bewerbung passenden Vorlagen: erst die der Stelle, dann allgemeine. */
gespraecheRouter.get(
  '/passende/:bewerbungId',
  requireAuth,
  wrap(async (req, res) => {
    const me = currentUser(req)
    await assertCanViewApplication(me, req.params.bewerbungId)

    const bewerbung = await prisma.application.findUniqueOrThrow({
      where: { id: req.params.bewerbungId },
      select: { jobId: true },
    })

    const vorlagen = await prisma.interviewTemplate.findMany({
      where: { active: true, OR: [{ jobId: bewerbung.jobId }, { jobId: null }] },
      orderBy: [{ jobId: 'desc' }, { name: 'asc' }],
    })
    // Eine leere Liste ist kein Fehler. Früher brach das hier ab und machte
    // damit auch das Gespräch *ohne* Leitfaden unmöglich – obwohl das Modell
    // es längst vorsah und die zweite Runde genau danach verlangt.
    res.json(vorlagen)
  }),
)
