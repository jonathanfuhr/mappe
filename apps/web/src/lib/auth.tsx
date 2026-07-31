import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError } from './api'

export type Rolle = 'ADMIN' | 'RECRUITER' | 'INTERVIEWER'

export interface AngemeldeterNutzer {
  id: string
  name: string
  email: string
  role: Rolle
}

export interface InstanzStatus {
  eingerichtet: boolean
  lokalAktiv: boolean
  entraAktiv: boolean
}

interface AuthKontext {
  nutzer: AngemeldeterNutzer | null
  status: InstanzStatus | null
  laedt: boolean
  anmelden: (email: string, passwort: string) => Promise<void>
  einrichten: (name: string, email: string, passwort: string) => Promise<void>
  abmelden: () => Promise<void>
  neuLaden: () => Promise<void>
  /** Kurzform für Rollenabfragen in Komponenten. */
  istAdmin: boolean
  darfBearbeiten: boolean
}

const Kontext = createContext<AuthKontext | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [nutzer, setNutzer] = useState<AngemeldeterNutzer | null>(null)
  const [status, setStatus] = useState<InstanzStatus | null>(null)
  const [laedt, setLaedt] = useState(true)

  async function laden(): Promise<void> {
    try {
      const [statusAntwort, nutzerAntwort] = await Promise.all([
        api.get<InstanzStatus>('/auth/status'),
        api.get<AngemeldeterNutzer>('/auth/me').catch((err: unknown) => {
          // 401 ist hier der Normalfall: niemand angemeldet.
          if (err instanceof ApiError && err.status === 401) return null
          throw err
        }),
      ])
      setStatus(statusAntwort)
      setNutzer(nutzerAntwort)
    } finally {
      setLaedt(false)
    }
  }

  useEffect(() => {
    void laden()
  }, [])

  const wert = useMemo<AuthKontext>(
    () => ({
      nutzer,
      status,
      laedt,
      istAdmin: nutzer?.role === 'ADMIN',
      darfBearbeiten: nutzer?.role === 'ADMIN' || nutzer?.role === 'RECRUITER',
      async anmelden(email, passwort) {
        const angemeldet = await api.post<AngemeldeterNutzer>('/auth/login', { email, passwort })
        setNutzer(angemeldet)
      },
      async einrichten(name, email, passwort) {
        const angemeldet = await api.post<AngemeldeterNutzer>('/auth/setup', {
          name,
          email,
          passwort,
        })
        setNutzer(angemeldet)
        setStatus((s) => (s ? { ...s, eingerichtet: true } : s))
      },
      async abmelden() {
        await api.post('/auth/logout')
        setNutzer(null)
      },
      neuLaden: laden,
    }),
    [nutzer, status, laedt],
  )

  return <Kontext.Provider value={wert}>{children}</Kontext.Provider>
}

export function useAuth(): AuthKontext {
  const kontext = useContext(Kontext)
  if (!kontext) throw new Error('useAuth muss innerhalb von AuthProvider stehen.')
  return kontext
}
