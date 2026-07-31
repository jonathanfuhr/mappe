import type { NextFunction, Request, Response } from 'express'
import { z, ZodTypeAny } from 'zod'

/** Prüft req.body gegen ein Schema und ersetzt es durch das geparste Ergebnis. */
export function body<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body)
    if (!result.success) return next(result.error)
    req.body = result.data
    next()
  }
}

/** Prüft req.query. Express 4 erlaubt das Überschreiben von req.query. */
export function query<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query)
    if (!result.success) return next(result.error)
    ;(req as unknown as { validatedQuery: unknown }).validatedQuery = result.data
    next()
  }
}

export function getQuery<T>(req: Request): T {
  return (req as unknown as { validatedQuery: T }).validatedQuery
}

/** Leerer String aus einem Formular soll als "nicht gesetzt" gelten. */
export const emptyToNull = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()

export const optionalString = z.string().trim().max(2000).optional()

export const idParam = z.string().uuid('Ungültige Kennung.')

export const paginationSchema = z.object({
  seite: z.coerce.number().int().min(1).default(1),
  proSeite: z.coerce.number().int().min(1).max(200).default(50),
})

export type Pagination = z.infer<typeof paginationSchema>

export function skipTake(p: Pagination): { skip: number; take: number } {
  return { skip: (p.seite - 1) * p.proSeite, take: p.proSeite }
}
