import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatRelativ, t } from '../i18n'
import { api } from '../lib/api'
import { vollerName } from '../lib/typen'
import { Badge, Button } from './ui'

/**
 * Die Glocke in der Kopfzeile.
 *
 * Bewusst kein eigener Bereich mit eigener Seite: Benachrichtigungen sind ein
 * Hinweis auf dem Weg zur Arbeit, kein Arbeitsplatz. Ein Klick führt zur
 * Bewerbung, und damit hat sich die Meldung erledigt.
 */

interface Benachrichtigung {
  id: string
  type: 'NEUE_BEWERBUNG' | 'UNBEANTWORTET'
  data: { name?: string; tage?: number }
  readAt: string | null
  createdAt: string
  application: {
    id: string
    candidate: { firstName: string; lastName: string; email: string | null }
    job: { title: string } | null
  } | null
}

export function Benachrichtigungen() {
  const queryClient = useQueryClient()
  const [offen, setOffen] = useState(false)

  const { data } = useQuery({
    queryKey: ['benachrichtigungen'],
    queryFn: () => api.get<Benachrichtigung[]>('/benachrichtigungen'),
    // Der Hintergrundlauf legt sie an, ohne dass die Oberfläche davon weiß –
    // deshalb hier gelegentlich nachfragen.
    refetchInterval: 120_000,
  })

  const gelesen = useMutation({
    mutationFn: (ids: string[] | null) => api.post('/benachrichtigungen/gelesen', { ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['benachrichtigungen'] }),
  })

  const eintraege = data ?? []
  const ungelesen = eintraege.filter((e) => !e.readAt)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOffen((o) => !o)}
        className="relative rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
        aria-label={t('benachrichtigungen.titel')}
      >
        <Bell className="h-4 w-4" />
        {ungelesen.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
            {ungelesen.length > 9 ? '9+' : ungelesen.length}
          </span>
        )}
      </button>

      {offen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOffen(false)} aria-hidden />
          <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <span className="text-sm font-medium text-slate-800">{t('benachrichtigungen.titel')}</span>
              {ungelesen.length > 0 && (
                <Button variante="still" groesse="sm" onClick={() => gelesen.mutate(null)}>
                  {t('benachrichtigungen.allesGelesen')}
                </Button>
              )}
            </div>

            {eintraege.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">{t('benachrichtigungen.keine')}</p>
            ) : (
              <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                {eintraege.slice(0, 30).map((e) => (
                  <li key={e.id}>
                    <Link
                      to={e.application ? `/bewerbungen/${e.application.id}` : '/bewerbungen'}
                      onClick={() => {
                        setOffen(false)
                        if (!e.readAt) gelesen.mutate([e.id])
                      }}
                      className="block px-4 py-3 transition hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-2">
                        {!e.readAt && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />}
                        <span className="truncate text-sm text-slate-800">
                          {e.application ? vollerName(e.application.candidate) : (e.data.name ?? '')}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {e.type === 'UNBEANTWORTET'
                          ? t('benachrichtigungen.UNBEANTWORTET', { tage: e.data.tage ?? 0 })
                          : t('benachrichtigungen.NEUE_BEWERBUNG')}
                        {' · '}
                        {formatRelativ(e.createdAt)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
