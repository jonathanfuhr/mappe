import jwt from 'jsonwebtoken'
import type { Response } from 'express'
import { env } from '../env'

export const SESSION_COOKIE = 'mappe_session'

export interface SessionPayload {
  sub: string
  v: number
}

export function signSession(userId: string, tokenVersion: number): string {
  return jwt.sign({ sub: userId, v: tokenVersion } satisfies SessionPayload, env.sessionSecret, {
    expiresIn: Math.floor(env.sessionMaxAgeMs / 1000),
    issuer: 'mappe',
  })
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, env.sessionSecret, { issuer: 'mappe' })
    if (typeof decoded === 'string') return null
    const { sub, v } = decoded as jwt.JwtPayload & { v?: number }
    if (typeof sub !== 'string' || typeof v !== 'number') return null
    return { sub, v }
  } catch {
    return null
  }
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Hinter einem Reverse Proxy mit HTTPS greift secure; im lokalen Betrieb
    // über http würde das Cookie sonst nie gesetzt.
    secure: env.appUrl.startsWith('https://'),
    maxAge: env.sessionMaxAgeMs,
    path: '/',
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}
