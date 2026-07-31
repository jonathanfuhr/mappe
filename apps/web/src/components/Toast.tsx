import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type Ton = 'erfolg' | 'fehler' | 'info' | 'warnung'

interface Meldung {
  id: number
  ton: Ton
  text: string
}

interface ToastKontext {
  zeige: (text: string, ton?: Ton) => void
  erfolg: (text: string) => void
  fehler: (text: string) => void
}

const Kontext = createContext<ToastKontext | null>(null)

let naechsteId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [meldungen, setMeldungen] = useState<Meldung[]>([])

  const entferne = useCallback((id: number) => {
    setMeldungen((liste) => liste.filter((m) => m.id !== id))
  }, [])

  const zeige = useCallback(
    (text: string, ton: Ton = 'info') => {
      const id = naechsteId++
      setMeldungen((liste) => [...liste, { id, ton, text }])
      // Fehler bleiben länger stehen – man will sie zu Ende lesen können.
      window.setTimeout(() => entferne(id), ton === 'fehler' ? 8000 : 4000)
    },
    [entferne],
  )

  const wert = useMemo<ToastKontext>(
    () => ({
      zeige,
      erfolg: (text: string) => zeige(text, 'erfolg'),
      fehler: (text: string) => zeige(text, 'fehler'),
    }),
    [zeige],
  )

  const icons: Record<Ton, ReactNode> = {
    erfolg: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
    fehler: <XCircle className="h-4 w-4 text-red-600" />,
    warnung: <AlertTriangle className="h-4 w-4 text-amber-600" />,
    info: <Info className="h-4 w-4 text-brand-600" />,
  }

  const rahmen: Record<Ton, string> = {
    erfolg: 'border-emerald-200',
    fehler: 'border-red-200',
    warnung: 'border-amber-200',
    info: 'border-slate-200',
  }

  return (
    <Kontext.Provider value={wert}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
        aria-live="polite"
      >
        {meldungen.map((m) => (
          <div
            key={m.id}
            className={clsx(
              'pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-white px-4 py-3 shadow-lg animate-slide-up',
              rahmen[m.ton],
            )}
          >
            <span className="mt-0.5 shrink-0">{icons[m.ton]}</span>
            <p className="min-w-0 flex-1 text-sm leading-relaxed text-slate-700">{m.text}</p>
            <button
              type="button"
              onClick={() => entferne(m.id)}
              className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              aria-label="Schließen"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Kontext.Provider>
  )
}

export function useToast(): ToastKontext {
  const kontext = useContext(Kontext)
  if (!kontext) throw new Error('useToast muss innerhalb von ToastProvider stehen.')
  return kontext
}
