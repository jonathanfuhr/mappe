import { Router } from 'express'
import { assertCanViewApplication } from '../auth/access'
import { currentUser, requireAdmin, requireAuth, requireRecruiter } from '../auth/middleware'
import { prisma } from '../db'
import { audit } from '../lib/audit'
import { notFound, wrap } from '../lib/errors'
import { downloadName, readFileFrom } from '../lib/storage'
import { getSetting } from '../settings/service'
import { holeAdapter, VERFUEGBARE_ADAPTER } from './registry'
import { fuehreSyncAus, setzeSyncZurueck, syncLaeuft } from './sync'
import { MailFehler } from './types'

export const mailRouter = Router()

/** Zustand der Anbindung – die Einstellungsseite und der Posteingang zeigen ihn. */
mailRouter.get(
  '/status',
  requireRecruiter,
  wrap(async (_req, res) => {
    const einstellungen = await getSetting('mail')
    const zustand = await prisma.mailSyncState.findFirst({
      where: { adapter: einstellungen.adapter },
      orderBy: { updatedAt: 'desc' },
    })

    res.json({
      adapter: einstellungen.adapter,
      adapterName:
        VERFUEGBARE_ADAPTER.find((a) => a.schluessel === einstellungen.adapter)?.name ?? einstellungen.adapter,
      automatischAbrufen: einstellungen.automatischAbrufen,
      intervallSekunden: einstellungen.abrufIntervallSekunden,
      laeuft: syncLaeuft(),
      letzterAbruf: zustand?.lastSyncAt ?? null,
      letzterFehler: zustand?.lastError ?? null,
      erstAbrufSteht: !zustand?.deltaLink,
      regeln: einstellungen.regeln,
      weiterleitungsAdressen: einstellungen.weiterleitungsAdressen,
      verfuegbareAdapter: VERFUEGBARE_ADAPTER,
    })
  }),
)

/** Prüft die Zugangsdaten, ohne etwas zu importieren oder zu verändern. */
mailRouter.post(
  '/pruefen',
  requireAdmin,
  wrap(async (_req, res) => {
    try {
      const adapter = await holeAdapter()
      if (!adapter) {
        res.json({ ok: false, meldung: 'Es ist kein Postfach angebunden.' })
        return
      }
      res.json(await adapter.pruefeVerbindung())
    } catch (err) {
      res.json({
        ok: false,
        meldung: err instanceof MailFehler ? err.message : 'Die Verbindung konnte nicht geprüft werden.',
      })
    }
  }),
)

/** Abruf von Hand auslösen. */
mailRouter.post(
  '/abrufen',
  requireRecruiter,
  wrap(async (req, res) => {
    const ergebnis = await fuehreSyncAus()
    await audit(currentUser(req).id, 'mail-abruf-manuell', 'mail', null, {
      neue: ergebnis.neueBewerbungen,
      antworten: ergebnis.angehaengteAntworten,
    })
    res.json(ergebnis)
  }),
)

/**
 * Delta-Stand zurücksetzen. Danach liest der nächste Lauf das Postfach von
 * vorn – bereits importierte Nachrichten werden dabei erkannt und
 * übersprungen, es entstehen also keine Dubletten.
 */
mailRouter.post(
  '/zuruecksetzen',
  requireAdmin,
  wrap(async (req, res) => {
    const einstellungen = await getSetting('mail')
    await setzeSyncZurueck(einstellungen.adapter)
    await audit(currentUser(req).id, 'mail-sync-zurueckgesetzt', 'mail', null)
    res.json({ ok: true })
  }),
)

/** Die unveränderte Originalnachricht als .eml. */
mailRouter.get(
  '/:id/original',
  requireAuth,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const mail = await prisma.mailMessage.findUnique({ where: { id: req.params.id } })
    if (!mail?.emlPath) throw notFound('Zu dieser Nachricht liegt kein Original vor.')
    if (mail.applicationId) await assertCanViewApplication(me, mail.applicationId)

    const inhalt = await readFileFrom(mail.emlPath)
    const name = downloadName(`${mail.subject || 'nachricht'}.eml`)

    res.setHeader('Content-Type', 'message/rfc822')
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
    res.setHeader('Cache-Control', 'private, no-store')
    res.send(inhalt)
  }),
)

/** Anhang einer Mail herunterladen. */
mailRouter.get(
  '/anhang/:id',
  requireAuth,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const anhang = await prisma.mailAttachment.findUnique({
      where: { id: req.params.id },
      include: { mailMessage: { select: { applicationId: true } } },
    })
    if (!anhang) throw notFound('Diesen Anhang gibt es nicht.')
    if (anhang.mailMessage.applicationId) {
      await assertCanViewApplication(me, anhang.mailMessage.applicationId)
    }

    const inhalt = await readFileFrom(anhang.storagePath)
    const inline = anhang.mimeType === 'application/pdf' || anhang.mimeType.startsWith('image/')

    res.setHeader('Content-Type', anhang.mimeType)
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${downloadName(anhang.filename)}"`,
    )
    res.setHeader('Cache-Control', 'private, no-store')
    res.send(inhalt)
  }),
)
