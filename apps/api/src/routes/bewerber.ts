import type { Prisma } from '@prisma/client'
import { Router } from 'express'
import { z } from 'zod'
import { applicationScope, assertCanViewCandidate, canSeeAllCandidates } from '../auth/access'
import { currentUser, requireAdmin, requireAuth, requireRecruiter } from '../auth/middleware'
import { prisma } from '../db'
import { audit } from '../lib/audit'
import { notFound, wrap } from '../lib/errors'
import { deleteFile } from '../lib/storage'
import { body, getQuery, paginationSchema, query, skipTake } from '../lib/validate'

export const bewerberRouter = Router()

const filterSchema = paginationSchema.extend({
  suche: z.string().trim().max(120).optional(),
  nurMitEinwilligung: z.coerce.boolean().optional(),
})

bewerberRouter.get(
  '/',
  requireRecruiter,
  query(filterSchema),
  wrap(async (req, res) => {
    const f = getQuery<z.infer<typeof filterSchema>>(req)

    const where: Prisma.CandidateWhereInput = {
      ...(f.nurMitEinwilligung ? { storageConsent: true } : {}),
      ...(f.suche
        ? {
            OR: [
              { firstName: { contains: f.suche, mode: 'insensitive' } },
              { lastName: { contains: f.suche, mode: 'insensitive' } },
              { email: { contains: f.suche, mode: 'insensitive' } },
              { city: { contains: f.suche, mode: 'insensitive' } },
              { phone: { contains: f.suche } },
            ],
          }
        : {}),
    }

    const [eintraege, gesamt] = await Promise.all([
      prisma.candidate.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        include: {
          _count: { select: { applications: true } },
          applications: {
            select: { id: true, stage: true, appliedAt: true, job: { select: { title: true } } },
            orderBy: { appliedAt: 'desc' },
            take: 3,
          },
        },
        ...skipTake(f),
      }),
      prisma.candidate.count({ where }),
    ])

    res.json({ eintraege, gesamt, seite: f.seite, proSeite: f.proSeite })
  }),
)

bewerberRouter.get(
  '/:id',
  requireAuth,
  wrap(async (req, res) => {
    const me = currentUser(req)
    await assertCanViewCandidate(me, req.params.id)

    const bewerber = await prisma.candidate.findUnique({
      where: { id: req.params.id },
      include: {
        // Interviewer sehen auf der Kontaktseite nur die Verfahren, für die
        // sie überhaupt zuständig sind.
        applications: {
          where: canSeeAllCandidates(me) ? {} : applicationScope(me),
          orderBy: { appliedAt: 'desc' },
          include: { job: { select: { id: true, title: true } } },
        },
        notes: {
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { id: true, name: true } } },
        },
        fieldValues: { include: { field: true } },
      },
    })
    if (!bewerber) throw notFound('Diesen Bewerber gibt es nicht.')

    res.json(bewerber)
  }),
)

const aenderungsSchema = z.object({
  anrede: z.enum(['KEINE', 'FRAU', 'HERR', 'DIVERS']).optional(),
  titel: z.string().trim().max(40).nullable().optional(),
  vorname: z.string().trim().max(100).optional(),
  nachname: z.string().trim().max(100).optional(),
  email: z.string().trim().toLowerCase().email().nullable().optional().or(z.literal('')),
  telefon: z.string().trim().max(50).nullable().optional(),
  strasse: z.string().trim().max(200).nullable().optional(),
  plz: z.string().trim().max(12).nullable().optional(),
  ort: z.string().trim().max(120).nullable().optional(),
  land: z.string().trim().max(80).nullable().optional(),
  links: z.array(z.object({ label: z.string().max(60), url: z.string().url().max(500) })).max(20).optional(),
  einwilligung: z.boolean().optional(),
})

bewerberRouter.patch(
  '/:id',
  requireRecruiter,
  body(aenderungsSchema),
  wrap(async (req, res) => {
    const me = currentUser(req)
    const d = req.body as z.infer<typeof aenderungsSchema>

    const bewerber = await prisma.candidate.update({
      where: { id: req.params.id },
      data: {
        ...(d.anrede !== undefined ? { salutation: d.anrede } : {}),
        ...(d.titel !== undefined ? { title: d.titel } : {}),
        ...(d.vorname !== undefined ? { firstName: d.vorname } : {}),
        ...(d.nachname !== undefined ? { lastName: d.nachname } : {}),
        ...(d.email !== undefined ? { email: d.email || null } : {}),
        ...(d.telefon !== undefined ? { phone: d.telefon } : {}),
        ...(d.strasse !== undefined ? { street: d.strasse } : {}),
        ...(d.plz !== undefined ? { postalCode: d.plz } : {}),
        ...(d.ort !== undefined ? { city: d.ort } : {}),
        ...(d.land !== undefined ? { country: d.land } : {}),
        ...(d.links !== undefined ? { links: d.links as object } : {}),
        // Einwilligung nimmt den Bewerber aus der automatischen Löschung.
        // Das Datum gehört dazu – sonst ist später nicht belegbar, wann sie
        // erteilt wurde.
        ...(d.einwilligung !== undefined
          ? {
              storageConsent: d.einwilligung,
              storageConsentDate: d.einwilligung ? new Date() : null,
              ...(d.einwilligung ? { purgeDueAt: null } : {}),
            }
          : {}),
      },
    })

    if (d.einwilligung !== undefined) {
      await audit(me.id, 'einwilligung-geaendert', 'candidate', bewerber.id, { wert: d.einwilligung })
    }
    res.json(bewerber)
  }),
)

/**
 * Vollständige Löschung einer Person – der Weg, den die DSGVO für ein
 * Auskunfts- und Löschersuchen verlangt.
 *
 * Die Datenbank räumt über Cascade alles Abhängige weg; die Dateien auf der
 * Platte müssen wir selbst entfernen. Deshalb erst die Pfade sammeln, dann
 * löschen, dann die Dateien – bricht es dazwischen ab, bleiben höchstens
 * verwaiste Dateien zurück, nie ein Datensatz ohne Datei.
 */
bewerberRouter.delete(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const me = currentUser(req)

    const bewerber = await prisma.candidate.findUnique({
      where: { id: req.params.id },
      select: { id: true, firstName: true, lastName: true, email: true },
    })
    if (!bewerber) throw notFound('Diesen Bewerber gibt es nicht.')

    const [dokumente, anhaenge, mails] = await Promise.all([
      prisma.document.findMany({
        where: { application: { candidateId: req.params.id } },
        select: { storagePath: true },
      }),
      prisma.mailAttachment.findMany({
        where: { mailMessage: { application: { candidateId: req.params.id } } },
        select: { storagePath: true },
      }),
      prisma.mailMessage.findMany({
        where: {
          OR: [{ candidateId: req.params.id }, { application: { candidateId: req.params.id } }],
          emlPath: { not: null },
        },
        select: { emlPath: true },
      }),
    ])

    await prisma.candidate.delete({ where: { id: req.params.id } })

    const pfade = [
      ...dokumente.map((d) => d.storagePath),
      ...anhaenge.map((a) => a.storagePath),
      ...mails.map((m) => m.emlPath!).filter(Boolean),
    ]
    for (const pfad of new Set(pfade)) await deleteFile(pfad)

    await audit(me.id, 'bewerber-geloescht', 'candidate', req.params.id, {
      name: `${bewerber.firstName} ${bewerber.lastName}`.trim(),
      email: bewerber.email,
      dateien: pfade.length,
    })

    res.json({ ok: true, dateienEntfernt: pfade.length })
  }),
)

export { aenderungsSchema as bewerberAenderungsSchema }
