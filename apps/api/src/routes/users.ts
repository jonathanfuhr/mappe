import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { currentUser, requireAdmin, requireAuth } from '../auth/middleware'
import { checkPasswordStrength, hashPassword } from '../auth/password'
import { audit } from '../lib/audit'
import { badRequest, conflict, notFound, wrap } from '../lib/errors'
import { body } from '../lib/validate'

export const usersRouter = Router()

const roleSchema = z.enum(['ADMIN', 'RECRUITER', 'INTERVIEWER'])

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  passwort: z.string().optional(),
  role: roleSchema.default('RECRUITER'),
})

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  role: roleSchema.optional(),
  active: z.boolean().optional(),
  neuesPasswort: z.string().optional(),
})

const selectPublic = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
  entraOid: true,
} as const

/**
 * Die Liste sehen alle angemeldeten Nutzer – sie wird für Zuweisungen und
 * für die Anzeige von "wer hat bewertet" gebraucht. Ändern darf nur der Admin.
 */
usersRouter.get(
  '/',
  requireAuth,
  wrap(async (_req, res) => {
    const users = await prisma.user.findMany({
      select: selectPublic,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    })
    res.json(users.map((u) => ({ ...u, hatMicrosoftLogin: Boolean(u.entraOid), entraOid: undefined })))
  }),
)

usersRouter.post(
  '/',
  requireAdmin,
  body(createSchema),
  wrap(async (req, res) => {
    const me = currentUser(req)
    const { name, email, passwort, role } = req.body as z.infer<typeof createSchema>

    if (passwort) {
      const weak = checkPasswordStrength(passwort)
      if (weak) throw badRequest(weak)
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) throw conflict('Für diese E-Mail-Adresse gibt es schon ein Konto.')

    const user = await prisma.user.create({
      data: {
        name,
        email,
        role,
        // Ohne Passwort ist das Konto nur per Microsoft-Login nutzbar.
        passwordHash: passwort ? await hashPassword(passwort) : null,
      },
      select: selectPublic,
    })

    await audit(me.id, 'nutzer-angelegt', 'user', user.id, { email, role })
    res.status(201).json(user)
  }),
)

usersRouter.patch(
  '/:id',
  requireAdmin,
  body(updateSchema),
  wrap(async (req, res) => {
    const me = currentUser(req)
    const id = req.params.id
    const patch = req.body as z.infer<typeof updateSchema>

    const target = await prisma.user.findUnique({ where: { id } })
    if (!target) throw notFound('Dieses Konto gibt es nicht.')

    // Aussperrschutz: der letzte aktive Admin bleibt Admin und bleibt aktiv.
    const entziehtAdmin =
      target.role === 'ADMIN' && ((patch.role && patch.role !== 'ADMIN') || patch.active === false)
    if (entziehtAdmin) {
      const weitereAdmins = await prisma.user.count({
        where: { role: 'ADMIN', active: true, id: { not: id } },
      })
      if (weitereAdmins === 0) {
        throw badRequest(
          'Das ist der letzte aktive Admin. Bitte zuerst ein weiteres Admin-Konto anlegen.',
        )
      }
    }

    if (patch.neuesPasswort) {
      const weak = checkPasswordStrength(patch.neuesPasswort)
      if (weak) throw badRequest(weak)
    }

    // Rollenwechsel, Sperre und neues Passwort entwerten laufende Sitzungen.
    const entwertet =
      patch.neuesPasswort !== undefined ||
      (patch.role !== undefined && patch.role !== target.role) ||
      (patch.active !== undefined && patch.active !== target.active)

    const user = await prisma.user.update({
      where: { id },
      data: {
        name: patch.name,
        email: patch.email,
        role: patch.role,
        active: patch.active,
        ...(patch.neuesPasswort ? { passwordHash: await hashPassword(patch.neuesPasswort) } : {}),
        ...(entwertet ? { tokenVersion: { increment: 1 } } : {}),
      },
      select: selectPublic,
    })

    await audit(me.id, 'nutzer-geaendert', 'user', id, {
      rolle: patch.role,
      aktiv: patch.active,
      passwortGesetzt: Boolean(patch.neuesPasswort),
    })
    res.json(user)
  }),
)

usersRouter.delete(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const id = req.params.id

    if (id === me.id) throw badRequest('Das eigene Konto lässt sich nicht löschen.')

    const target = await prisma.user.findUnique({ where: { id } })
    if (!target) throw notFound('Dieses Konto gibt es nicht.')

    if (target.role === 'ADMIN') {
      const weitereAdmins = await prisma.user.count({
        where: { role: 'ADMIN', active: true, id: { not: id } },
      })
      if (weitereAdmins === 0) throw badRequest('Das ist der letzte aktive Admin.')
    }

    await prisma.user.delete({ where: { id } })
    await audit(me.id, 'nutzer-geloescht', 'user', id, { email: target.email })
    res.json({ ok: true })
  }),
)
