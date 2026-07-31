import type { NextFunction, Request, Response } from 'express'
import type { Role } from '@prisma/client'
import { prisma } from '../db'
import { forbidden, unauthorized } from '../lib/errors'
import { SESSION_COOKIE, verifySession } from './tokens'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: Role
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

/** Hängt req.user an, wenn ein gültiges Sitzungs-Cookie vorliegt. Wirft nie. */
export async function loadUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[SESSION_COOKIE]
    if (!token) return next()

    const payload = verifySession(token)
    if (!payload) return next()

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true, active: true, tokenVersion: true },
    })

    // tokenVersion entwertet alte Sitzungen nach Passwortwechsel oder Sperre.
    if (!user || !user.active || user.tokenVersion !== payload.v) return next()

    req.user = { id: user.id, email: user.email, name: user.name, role: user.role }
    next()
  } catch (err) {
    next(err)
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized())
  next()
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized())
    if (!roles.includes(req.user.role)) {
      return next(forbidden('Diese Aktion ist der Rolle ' + roles.join(' oder ') + ' vorbehalten.'))
    }
    next()
  }
}

export const requireAdmin = requireRole('ADMIN')
/** Tagesgeschäft: Admin und Recruiter. Interviewer bleiben außen vor. */
export const requireRecruiter = requireRole('ADMIN', 'RECRUITER')

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized()
  return req.user
}
