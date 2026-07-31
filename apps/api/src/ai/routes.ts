import { Router } from 'express'
import { z } from 'zod'
import { assertCanEditApplication } from '../auth/access'
import { currentUser, requireAdmin, requireRecruiter } from '../auth/middleware'
import { prisma } from '../db'
import { notFound, wrap } from '../lib/errors'
import { body } from '../lib/validate'
import { readFileFrom } from '../lib/storage'
import { extrahiereText } from '../pdf/text'
import { getSetting } from '../settings/service'
import { analysiereBewerbung, uebernehmeVorschlag } from './analyse'
import { pruefeKiVerbindung } from './client'
import { klassifiziereSeiten } from './aufgaben'

export const kiRouter = Router()

/** Prüft die Anbindung mit einer winzigen Anfrage – ohne Bewerbungsdaten. */
kiRouter.post(
  '/pruefen',
  requireAdmin,
  wrap(async (_req, res) => {
    res.json(await pruefeKiVerbindung())
  }),
)

/** Startet die Analyse einer Bewerbung von Hand. */
kiRouter.post(
  '/analysieren/:bewerbungId',
  requireRecruiter,
  wrap(async (req, res) => {
    const me = currentUser(req)
    await assertCanEditApplication(me, req.params.bewerbungId)
    res.json(await analysiereBewerbung(req.params.bewerbungId, me.id))
  }),
)

const uebernahmeSchema = z.object({
  felder: z.array(z.string().max(40)).min(1, 'Es wurde kein Feld ausgewählt.').max(30),
})

kiRouter.post(
  '/vorschlag/:id/uebernehmen',
  requireRecruiter,
  body(uebernahmeSchema),
  wrap(async (req, res) => {
    const me = currentUser(req)
    const vorschlag = await prisma.extractionSuggestion.findUnique({
      where: { id: req.params.id },
      select: { applicationId: true },
    })
    if (!vorschlag) throw notFound('Diesen Vorschlag gibt es nicht.')
    await assertCanEditApplication(me, vorschlag.applicationId)

    const { felder } = req.body as z.infer<typeof uebernahmeSchema>
    res.json(await uebernehmeVorschlag(req.params.id, felder, me.id))
  }),
)

kiRouter.post(
  '/vorschlag/:id/verwerfen',
  requireRecruiter,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const vorschlag = await prisma.extractionSuggestion.findUnique({
      where: { id: req.params.id },
      select: { applicationId: true },
    })
    if (!vorschlag) throw notFound('Diesen Vorschlag gibt es nicht.')
    await assertCanEditApplication(me, vorschlag.applicationId)

    await prisma.extractionSuggestion.update({
      where: { id: req.params.id },
      data: { dismissedAt: new Date() },
    })
    res.json({ ok: true })
  }),
)

/**
 * Seitenvorschlag für die Split-Ansicht durch die KI.
 *
 * Sie füllt dieselbe Ansicht vor, die auch ohne KI benutzt wird – der
 * Prüfschritt bleibt derselbe, nur der Ausgangsvorschlag ist besser.
 */
kiRouter.post(
  '/seiten/:dokumentId',
  requireRecruiter,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const ki = await getSetting('ki')
    if (!ki.aktiv || !ki.aufgaben.pdfSplit) {
      throw notFound('Die KI-gestützte Seitenerkennung ist ausgeschaltet.')
    }

    const dokument = await prisma.document.findUnique({ where: { id: req.params.dokumentId } })
    if (!dokument) throw notFound('Dieses Dokument gibt es nicht.')
    await assertCanEditApplication(me, dokument.applicationId)

    const inhalt = await readFileFrom(dokument.storagePath)
    const text = await extrahiereText(inhalt)
    const { zuordnung, modell } = await klassifiziereSeiten(text.seiten)

    res.json({ zuordnung, modell })
  }),
)
