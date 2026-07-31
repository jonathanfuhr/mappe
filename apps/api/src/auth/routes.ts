import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { prisma } from '../db'
import { audit } from '../lib/audit'
import { badRequest, conflict, unauthorized, wrap } from '../lib/errors'
import { body } from '../lib/validate'
import { getSetting } from '../settings/service'
import { currentUser, requireAuth } from './middleware'
import { checkPasswordStrength, hashPassword, verifyPassword } from './password'
import { clearSessionCookie, setSessionCookie, signSession } from './tokens'

export const authRouter = Router()

/**
 * Anmeldeversuche werden gebremst. Der Zähler läuft über die IP – bei einem
 * Tool mit einer Handvoll Konten reicht das völlig.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.' },
})

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Bitte eine gültige E-Mail-Adresse angeben.'),
  passwort: z.string().min(1, 'Bitte das Passwort eingeben.'),
})

const setupSchema = z.object({
  name: z.string().trim().min(2, 'Bitte einen Namen angeben.').max(120),
  email: z.string().trim().toLowerCase().email('Bitte eine gültige E-Mail-Adresse angeben.'),
  passwort: z.string(),
})

/**
 * Zustand der Instanz. Die Anmeldeseite fragt das ab, um zwischen
 * Ersteinrichtung und normalem Login zu unterscheiden.
 */
authRouter.get(
  '/status',
  wrap(async (_req, res) => {
    const userCount = await prisma.user.count()
    const anmeldung = await getSetting('anmeldung')
    res.json({
      eingerichtet: userCount > 0,
      lokalAktiv: anmeldung.lokalAktiv || userCount === 0,
      entraAktiv:
        anmeldung.entraAktiv &&
        Boolean(anmeldung.entra.tenantId && anmeldung.entra.clientId && anmeldung.entra.clientSecret),
    })
  }),
)

/** Ersteinrichtung: Der erste angelegte Nutzer wird automatisch Admin. */
authRouter.post(
  '/setup',
  loginLimiter,
  body(setupSchema),
  wrap(async (req, res) => {
    const { name, email, passwort } = req.body as z.infer<typeof setupSchema>

    const existing = await prisma.user.count()
    if (existing > 0) {
      throw conflict('Diese Instanz ist bereits eingerichtet. Bitte normal anmelden.')
    }

    const weak = checkPasswordStrength(passwort)
    if (weak) throw badRequest(weak)

    const user = await prisma.user.create({
      data: { name, email, passwordHash: await hashPassword(passwort), role: 'ADMIN' },
    })

    await audit(user.id, 'ersteinrichtung', 'user', user.id, { email })
    setSessionCookie(res, signSession(user.id, user.tokenVersion))
    res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role })
  }),
)

authRouter.post(
  '/login',
  loginLimiter,
  body(loginSchema),
  wrap(async (req, res) => {
    const { email, passwort } = req.body as z.infer<typeof loginSchema>

    const anmeldung = await getSetting('anmeldung')
    const userCount = await prisma.user.count()
    if (!anmeldung.lokalAktiv && userCount > 0) {
      throw unauthorized('Die lokale Anmeldung ist abgeschaltet. Bitte über Microsoft anmelden.')
    }

    const user = await prisma.user.findUnique({ where: { email } })
    const ok = user ? await verifyPassword(passwort, user.passwordHash) : await verifyPassword(passwort, null)

    // Bewusst dieselbe Meldung für "kein Konto", "falsches Passwort" und
    // "gesperrt" – sonst wird die Anmeldeseite zum Konto-Verzeichnis.
    if (!ok || !user || !user.active) {
      throw unauthorized('E-Mail oder Passwort stimmt nicht.')
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    setSessionCookie(res, signSession(user.id, user.tokenVersion))
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role })
  }),
)

authRouter.post('/logout', (req, res) => {
  clearSessionCookie(res)
  res.json({ ok: true })
})

authRouter.get('/me', requireAuth, (req, res) => {
  res.json(currentUser(req))
})

const passwordChangeSchema = z.object({
  aktuellesPasswort: z.string().min(1),
  neuesPasswort: z.string(),
})

authRouter.post(
  '/passwort',
  requireAuth,
  body(passwordChangeSchema),
  wrap(async (req, res) => {
    const me = currentUser(req)
    const { aktuellesPasswort, neuesPasswort } = req.body as z.infer<typeof passwordChangeSchema>

    const user = await prisma.user.findUniqueOrThrow({ where: { id: me.id } })
    if (!(await verifyPassword(aktuellesPasswort, user.passwordHash))) {
      throw badRequest('Das aktuelle Passwort stimmt nicht.')
    }

    const weak = checkPasswordStrength(neuesPasswort)
    if (weak) throw badRequest(weak)

    // tokenVersion hochzählen wirft alle anderen Sitzungen raus …
    const updated = await prisma.user.update({
      where: { id: me.id },
      data: { passwordHash: await hashPassword(neuesPasswort), tokenVersion: { increment: 1 } },
    })
    // … und die eigene bekommt sofort ein frisches Cookie.
    setSessionCookie(res, signSession(updated.id, updated.tokenVersion))

    await audit(me.id, 'passwort-geaendert', 'user', me.id)
    res.json({ ok: true })
  }),
)
