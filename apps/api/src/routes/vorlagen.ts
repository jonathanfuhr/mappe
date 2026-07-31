import { Router } from 'express'
import { z } from 'zod'
import { assertCanEditApplication } from '../auth/access'
import { currentUser, requireAdmin, requireAuth, requireRecruiter } from '../auth/middleware'
import { prisma } from '../db'
import { audit } from '../lib/audit'
import { badRequest, notFound, wrap } from '../lib/errors'
import { body } from '../lib/validate'
import { baueWerte, rendereVorlage, STANDARD_PLATZHALTER } from '../mail/platzhalter'
import { sendeMail } from '../mail/senden'
import { findeAuslieferungsstand } from '../seed/vorlagen'
import { getSetting } from '../settings/service'

export const vorlagenRouter = Router()

const TYPEN = [
  'EINGANGSBESTAETIGUNG',
  'EINLADUNG',
  'ZUSAGE',
  'ABSAGE',
  'INITIATIV_ABSAGE',
  'NACHFRAGE',
  'SONSTIGE',
] as const

const vorlagenSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(TYPEN),
  tone: z.enum(['DU', 'SIE']),
  subject: z.string().trim().min(1, 'Der Betreff darf nicht leer sein.').max(300),
  body: z.string().min(1, 'Der Text darf nicht leer sein.').max(30000),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
})

/** Recruiter brauchen die Liste zum Versenden, ändern dürfen nur Admins. */
vorlagenRouter.get(
  '/',
  requireRecruiter,
  wrap(async (_req, res) => {
    const vorlagen = await prisma.mailTemplate.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })
    res.json(vorlagen)
  }),
)

/** Die Platzhalter-Hilfe für die Vorlagen-Verwaltung. */
vorlagenRouter.get(
  '/platzhalter',
  requireRecruiter,
  wrap(async (_req, res) => {
    const freifelder = await prisma.customField.findMany({ orderBy: { sortOrder: 'asc' } })
    res.json({
      standard: STANDARD_PLATZHALTER,
      frei: freifelder.map((f) => ({
        name: f.key.toUpperCase(),
        beschreibung: `${f.label} (${f.entity === 'BEWERBER' ? 'Bewerber' : 'Bewerbung'})`,
        beispiel: '',
      })),
    })
  }),
)

vorlagenRouter.post(
  '/',
  requireAdmin,
  body(vorlagenSchema),
  wrap(async (req, res) => {
    const vorlage = await prisma.mailTemplate.create({
      data: req.body as z.infer<typeof vorlagenSchema>,
    })
    await audit(currentUser(req).id, 'vorlage-angelegt', 'mailTemplate', vorlage.id)
    res.status(201).json(vorlage)
  }),
)

vorlagenRouter.patch(
  '/:id',
  requireAdmin,
  body(vorlagenSchema.partial()),
  wrap(async (req, res) => {
    const vorlage = await prisma.mailTemplate.update({
      where: { id: req.params.id },
      data: req.body as Partial<z.infer<typeof vorlagenSchema>>,
    })
    await audit(currentUser(req).id, 'vorlage-geaendert', 'mailTemplate', vorlage.id)
    res.json(vorlage)
  }),
)

/** Stellt den Auslieferungsstand einer mitgelieferten Vorlage wieder her. */
vorlagenRouter.post(
  '/:id/zuruecksetzen',
  requireAdmin,
  wrap(async (req, res) => {
    const vorlage = await prisma.mailTemplate.findUnique({ where: { id: req.params.id } })
    if (!vorlage) throw notFound('Diese Vorlage gibt es nicht.')
    if (!vorlage.seeded) {
      throw badRequest('Diese Vorlage wurde selbst angelegt – es gibt keinen Auslieferungsstand.')
    }

    const standard = findeAuslieferungsstand(vorlage.type, vorlage.tone)
    if (!standard) throw badRequest('Für diese Art gibt es keine mitgelieferte Fassung.')

    const zurueckgesetzt = await prisma.mailTemplate.update({
      where: { id: req.params.id },
      data: { name: standard.name, subject: standard.subject, body: standard.body },
    })
    await audit(currentUser(req).id, 'vorlage-zurueckgesetzt', 'mailTemplate', vorlage.id)
    res.json(zurueckgesetzt)
  }),
)

vorlagenRouter.delete(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    await prisma.mailTemplate.delete({ where: { id: req.params.id } })
    await audit(currentUser(req).id, 'vorlage-geloescht', 'mailTemplate', req.params.id)
    res.json({ ok: true })
  }),
)

// --- Vorschau und Versand ---------------------------------------------------

const vorschauSchema = z.object({
  vorlageId: z.string().uuid().optional(),
  /** Freier Text statt Vorlage – etwa beim Nachbearbeiten. */
  betreff: z.string().max(300).optional(),
  text: z.string().max(30000).optional(),
})

/**
 * Setzt eine Vorlage für eine konkrete Bewerbung ein und meldet zurück, welche
 * Platzhalter leer geblieben sind. Der Text ist danach frei bearbeitbar –
 * gesendet wird immer das, was in der Oberfläche steht.
 */
vorlagenRouter.post(
  '/vorschau/:bewerbungId',
  requireRecruiter,
  body(vorschauSchema),
  wrap(async (req, res) => {
    const me = currentUser(req)
    const d = req.body as z.infer<typeof vorschauSchema>
    await assertCanEditApplication(me, req.params.bewerbungId)

    const bewerbung = await prisma.application.findUniqueOrThrow({
      where: { id: req.params.bewerbungId },
      include: {
        candidate: { include: { fieldValues: { include: { field: true } } } },
        job: true,
        fieldValues: { include: { field: true } },
      },
    })

    let quelle = { subject: d.betreff ?? '', body: d.text ?? '' }
    if (d.vorlageId) {
      const vorlage = await prisma.mailTemplate.findUnique({ where: { id: d.vorlageId } })
      if (!vorlage) throw notFound('Diese Vorlage gibt es nicht.')
      quelle = { subject: vorlage.subject, body: vorlage.body }
    }

    const allgemein = await getSetting('allgemein')
    const werte = baueWerte({
      bewerbung,
      organisation: allgemein.organisation,
      absenderName: allgemein.absenderName,
      bearbeiterName: me.name,
    })

    const ergebnis = rendereVorlage(quelle, werte, allgemein.signatur)

    res.json({
      ...ergebnis,
      empfaenger: bewerbung.candidate.email ? [bewerbung.candidate.email] : [],
      werte,
    })
  }),
)

const versandSchema = z.object({
  an: z.array(z.string().trim().email('Ungültige Empfängeradresse.')).min(1).max(10),
  kopie: z.array(z.string().trim().email()).max(10).default([]),
  betreff: z.string().trim().min(1).max(300),
  text: z.string().min(1).max(50000),
  dokumentIds: z.array(z.string().uuid()).max(20).default([]),
  /** Phase nach dem Versand setzen – spart einen zweiten Handgriff. */
  neuePhase: z
    .enum([
      'NEU',
      'GESICHTET',
      'IN_PRUEFUNG',
      'EINGELADEN',
      'GESPRAECH_GEFUEHRT',
      'ENTSCHEIDUNG',
      'ZUSAGE',
      'ABSAGE',
      'ARCHIV',
    ])
    .optional(),
})

vorlagenRouter.post(
  '/senden/:bewerbungId',
  requireRecruiter,
  body(versandSchema),
  wrap(async (req, res) => {
    const me = currentUser(req)
    const d = req.body as z.infer<typeof versandSchema>
    await assertCanEditApplication(me, req.params.bewerbungId)

    const gesendet = await sendeMail(
      {
        applicationId: req.params.bewerbungId,
        an: d.an,
        kopie: d.kopie,
        betreff: d.betreff,
        text: d.text,
        dokumentIds: d.dokumentIds,
      },
      me.id,
    )

    if (d.neuePhase) {
      const abgeschlossen = ['ZUSAGE', 'ABSAGE', 'ARCHIV'].includes(d.neuePhase)
      await prisma.application.update({
        where: { id: req.params.bewerbungId },
        data: {
          stage: d.neuePhase,
          stageChangedAt: new Date(),
          ...(abgeschlossen ? { closedAt: new Date() } : {}),
        },
      })
    }

    res.json(gesendet)
  }),
)

// --- Freifelder -------------------------------------------------------------

export const freifelderRouter = Router()

const freifeldSchema = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'Nur Großbuchstaben, Ziffern und Unterstrich, Beginn mit einem Buchstaben.'),
  label: z.string().trim().min(2).max(80),
  entity: z.enum(['BEWERBER', 'BEWERBUNG']),
  type: z.enum(['TEXT', 'MEHRZEILIG', 'ZAHL', 'DATUM', 'AUSWAHL', 'JA_NEIN']).default('TEXT'),
  options: z.array(z.string().trim().max(80)).max(30).default([]),
  sortOrder: z.number().int().default(0),
})

freifelderRouter.get(
  '/',
  requireAuth,
  wrap(async (_req, res) => {
    res.json(await prisma.customField.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] }))
  }),
)

freifelderRouter.post(
  '/',
  requireAdmin,
  body(freifeldSchema),
  wrap(async (req, res) => {
    const d = req.body as z.infer<typeof freifeldSchema>

    // Ein Freifeld darf keinen Standard-Platzhalter überschreiben – sonst
    // stünde plötzlich etwas anderes in jeder Vorlage, die $STELLE benutzt.
    if (STANDARD_PLATZHALTER.some((p) => p.name === d.key)) {
      throw badRequest(`„${d.key}" ist bereits ein Standard-Platzhalter. Bitte einen anderen Namen wählen.`)
    }

    const feld = await prisma.customField.create({ data: d })
    await audit(currentUser(req).id, 'freifeld-angelegt', 'customField', feld.id, { key: d.key })
    res.status(201).json(feld)
  }),
)

freifelderRouter.patch(
  '/:id',
  requireAdmin,
  body(freifeldSchema.partial().omit({ key: true })),
  wrap(async (req, res) => {
    const feld = await prisma.customField.update({
      where: { id: req.params.id },
      data: req.body as Partial<z.infer<typeof freifeldSchema>>,
    })
    res.json(feld)
  }),
)

freifelderRouter.delete(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    await prisma.customField.delete({ where: { id: req.params.id } })
    await audit(currentUser(req).id, 'freifeld-geloescht', 'customField', req.params.id)
    res.json({ ok: true })
  }),
)

const wertSchema = z.object({
  feldId: z.string().uuid(),
  bewerberId: z.string().uuid().optional(),
  bewerbungId: z.string().uuid().optional(),
  wert: z.string().max(4000),
})

freifelderRouter.put(
  '/wert',
  requireRecruiter,
  body(wertSchema),
  wrap(async (req, res) => {
    const d = req.body as z.infer<typeof wertSchema>
    if (!d.bewerberId && !d.bewerbungId) {
      throw badRequest('Ein Wert gehört entweder zu einem Bewerber oder zu einer Bewerbung.')
    }

    const wo = d.bewerberId
      ? { fieldId_candidateId: { fieldId: d.feldId, candidateId: d.bewerberId } }
      : { fieldId_applicationId: { fieldId: d.feldId, applicationId: d.bewerbungId! } }

    const wert = await prisma.customFieldValue.upsert({
      where: wo,
      create: {
        fieldId: d.feldId,
        candidateId: d.bewerberId ?? null,
        applicationId: d.bewerbungId ?? null,
        value: d.wert,
      },
      update: { value: d.wert },
      include: { field: true },
    })
    res.json(wert)
  }),
)
