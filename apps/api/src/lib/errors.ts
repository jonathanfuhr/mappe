import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const badRequest = (m: string, details?: unknown) => new HttpError(400, m, 'BAD_REQUEST', details)
export const unauthorized = (m = 'Nicht angemeldet.') => new HttpError(401, m, 'UNAUTHORIZED')
export const forbidden = (m = 'Dafür fehlt die Berechtigung.') => new HttpError(403, m, 'FORBIDDEN')
export const notFound = (m = 'Nicht gefunden.') => new HttpError(404, m, 'NOT_FOUND')
export const conflict = (m: string) => new HttpError(409, m, 'CONFLICT')

/** Hängt sich als letztes Glied in die Express-Kette. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // Express erkennt den Fehler-Handler an der Vierer-Signatur – der Parameter
  // muss stehen bleiben, auch wenn er nicht benutzt wird.
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Die Eingabe ist unvollständig oder hat das falsche Format.',
      code: 'VALIDATION',
      details: err.issues.map((i) => ({ pfad: i.path.join('.'), meldung: i.message })),
    })
    return
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code, details: err.details })
    return
  }

  // Prisma meldet eine verletzte Eindeutigkeit als P2002 – das ist ein
  // Nutzerfehler, kein Serverfehler.
  const anyErr = err as { code?: string; meta?: { target?: string[] } }
  if (anyErr?.code === 'P2002') {
    const feld = anyErr.meta?.target?.join(', ') ?? 'Wert'
    res.status(409).json({ error: `${feld} ist bereits vergeben.`, code: 'CONFLICT' })
    return
  }
  if (anyErr?.code === 'P2025') {
    res.status(404).json({ error: 'Nicht gefunden.', code: 'NOT_FOUND' })
    return
  }

  console.error('[mappe] Unbehandelter Fehler:', err)
  res.status(500).json({ error: 'Interner Fehler.', code: 'INTERNAL' })
}

/** Fängt abgelehnte Promises aus async-Handlern ein. */
export function wrap<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(
  handler: T,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next)
  }
}
