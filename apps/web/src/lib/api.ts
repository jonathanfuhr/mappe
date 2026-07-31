/**
 * Ein schmaler Mantel um fetch. Alles läuft über Cookies, deshalb braucht es
 * kein Token-Handling im Frontend.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type Methode = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

async function request<T>(methode: Methode, pfad: string, daten?: unknown): Promise<T> {
  const antwort = await fetch(`/api${pfad}`, {
    method: methode,
    credentials: 'same-origin',
    headers: daten !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: daten !== undefined ? JSON.stringify(daten) : undefined,
  })

  if (antwort.status === 204) return undefined as T

  const typ = antwort.headers.get('content-type') ?? ''
  const koerper = typ.includes('application/json') ? await antwort.json() : await antwort.text()

  if (!antwort.ok) {
    const fehler = typeof koerper === 'object' && koerper !== null ? koerper : {}
    throw new ApiError(
      antwort.status,
      (fehler as { error?: string }).error ?? `Fehler ${antwort.status}`,
      (fehler as { code?: string }).code,
      (fehler as { details?: unknown }).details,
    )
  }
  return koerper as T
}

export const api = {
  get: <T>(pfad: string) => request<T>('GET', pfad),
  post: <T>(pfad: string, daten?: unknown) => request<T>('POST', pfad, daten),
  patch: <T>(pfad: string, daten?: unknown) => request<T>('PATCH', pfad, daten),
  put: <T>(pfad: string, daten?: unknown) => request<T>('PUT', pfad, daten),
  delete: <T>(pfad: string) => request<T>('DELETE', pfad),

  /** Datei-Upload über FormData – hier darf kein JSON-Header gesetzt werden. */
  async upload<T>(pfad: string, formular: FormData): Promise<T> {
    const antwort = await fetch(`/api${pfad}`, {
      method: 'POST',
      credentials: 'same-origin',
      body: formular,
    })
    const typ = antwort.headers.get('content-type') ?? ''
    const koerper = typ.includes('application/json') ? await antwort.json() : await antwort.text()
    if (!antwort.ok) {
      const fehler = typeof koerper === 'object' && koerper !== null ? koerper : {}
      throw new ApiError(
        antwort.status,
        (fehler as { error?: string }).error ?? `Fehler ${antwort.status}`,
        (fehler as { code?: string }).code,
      )
    }
    return koerper as T
  },
}
