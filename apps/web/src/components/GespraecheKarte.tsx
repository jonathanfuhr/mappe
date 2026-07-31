import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { formatDatum, t } from '../i18n'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Gespraech, GespraechsAbschnitt } from '../lib/typen'
import { Badge, Button, Hinweis, Karte, Select, Textarea } from './ui'
import { useToast } from './Toast'

interface Vorlage {
  id: string
  name: string
  sections: GespraechsAbschnitt[]
  jobId: string | null
}

/**
 * Gesprächsvorlage und Notizen.
 *
 * Jede Person schreibt ihre eigenen Notizen – auch Interviewer, die sonst
 * nichts ändern dürfen. Fremde Notizen bleiben lesbar, aber unangetastet.
 */
export function GespraecheKarte({
  bewerbungId,
  phase,
  gespraeche,
  onGeaendert,
}: {
  bewerbungId: string
  phase: string
  gespraeche: Gespraech[]
  onGeaendert: () => Promise<void>
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { nutzer } = useAuth()
  const [vorlageId, setVorlageId] = useState('')

  const { data: vorlagen } = useQuery({
    queryKey: ['gespraechsvorlagen', bewerbungId],
    queryFn: () => api.get<Vorlage[]>(`/gespraeche/passende/${bewerbungId}`).catch(() => []),
  })

  const anlegen = useMutation({
    mutationFn: () =>
      api.post<Gespraech & { hinweis: string | null }>('/gespraeche', {
        bewerbungId,
        vorlageId: vorlageId || (vorlagen?.[0]?.id ?? null),
        titel: 'Gespräch',
      }),
    onSuccess: async (neu) => {
      await onGeaendert()
      if (neu.hinweis) toast.zeige(neu.hinweis, 'warnung')
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const zuFrueh = ['NEU', 'GESICHTET'].includes(phase)

  return (
    <Karte
      titel={t('gespraech.titel')}
      aktion={
        <div className="flex items-center gap-2">
          {(vorlagen?.length ?? 0) > 1 && (
            <Select
              value={vorlageId}
              onChange={(e) => setVorlageId(e.target.value)}
              className="w-[14rem]"
              aria-label={t('gespraech.vorlage')}
            >
              {vorlagen?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          )}
          <Button
            variante="umriss"
            groesse="sm"
            onClick={() => anlegen.mutate()}
            laedt={anlegen.isPending}
            disabled={(vorlagen?.length ?? 0) === 0}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('gespraech.neu')}
          </Button>
        </div>
      }
    >
      {(vorlagen?.length ?? 0) === 0 && (
        <Hinweis ton="warnung">{t('gespraech.keineVorlage')}</Hinweis>
      )}

      {zuFrueh && gespraeche.length === 0 && (vorlagen?.length ?? 0) > 0 && (
        <p className="mb-3 text-sm text-slate-500">{t('gespraech.zuFrueh')}</p>
      )}

      {gespraeche.length === 0 ? (
        <p className="py-2 text-sm text-slate-500">{t('gespraech.keine')}</p>
      ) : (
        <ul className="space-y-4">
          {gespraeche.map((g) => (
            <GespraechsBlock
              key={g.id}
              gespraech={g}
              eigenes={g.user.id === nutzer?.id}
              istAdmin={nutzer?.role === 'ADMIN'}
              onGeaendert={async () => {
                await onGeaendert()
                await queryClient.invalidateQueries({ queryKey: ['bewerbung'] })
              }}
            />
          ))}
        </ul>
      )}
    </Karte>
  )
}

function GespraechsBlock({
  gespraech,
  eigenes,
  istAdmin,
  onGeaendert,
}: {
  gespraech: Gespraech
  eigenes: boolean
  istAdmin: boolean
  onGeaendert: () => Promise<void>
}) {
  const toast = useToast()
  const [antworten, setAntworten] = useState<Record<string, string>>(gespraech.answers ?? {})
  const [notizen, setNotizen] = useState(gespraech.notes ?? '')
  const [offen, setOffen] = useState(eigenes)

  const speichern = useMutation({
    mutationFn: () => api.patch(`/gespraeche/${gespraech.id}`, { antworten, notizen }),
    onSuccess: async () => {
      await onGeaendert()
      toast.erfolg(t('app.gespeichert'))
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const loeschen = useMutation({
    mutationFn: () => api.delete(`/gespraeche/${gespraech.id}`),
    onSuccess: onGeaendert,
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const abschnitte = gespraech.template?.sections ?? []

  return (
    <li className="rounded-lg border border-slate-200">
      <button
        type="button"
        onClick={() => setOffen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <MessageSquare className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-900">
            {gespraech.template?.name ?? gespraech.title}
          </span>
          <span className="block text-xs text-slate-500">
            {gespraech.user.name} · {formatDatum(gespraech.conductedAt ?? gespraech.createdAt)}
          </span>
        </span>
        {eigenes && <Badge ton="blau">eigenes</Badge>}
      </button>

      {offen && (
        <div className="space-y-4 border-t border-slate-100 px-4 py-4">
          {eigenes && abschnitte.length > 0 && (
            <p className="text-xs leading-relaxed text-slate-500">{t('gespraech.unzulaessig')}</p>
          )}

          {abschnitte.map((abschnitt) => (
            <div key={abschnitt.title}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {abschnitt.title}
              </h4>
              <ul className="space-y-3">
                {abschnitt.questions.map((frage) => (
                  <li key={frage.id}>
                    <p className="mb-1 text-sm text-slate-700">{frage.text}</p>
                    {frage.hint && <p className="mb-1 text-xs text-slate-400">{frage.hint}</p>}
                    {eigenes ? (
                      <Textarea
                        rows={2}
                        value={antworten[frage.id] ?? ''}
                        onChange={(e) => setAntworten((alt) => ({ ...alt, [frage.id]: e.target.value }))}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                        {gespraech.answers?.[frage.id] || <span className="text-slate-400">–</span>}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t('gespraech.notizen')}
            </h4>
            {eigenes ? (
              <Textarea rows={4} value={notizen} onChange={(e) => setNotizen(e.target.value)} />
            ) : (
              <p className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                {gespraech.notes || <span className="text-slate-400">–</span>}
              </p>
            )}
          </div>

          {(eigenes || istAdmin) && (
            <div className="flex gap-2">
              {eigenes && (
                <Button groesse="sm" onClick={() => speichern.mutate()} laedt={speichern.isPending}>
                  {t('gespraech.speichern')}
                </Button>
              )}
              <Button
                variante="still"
                groesse="sm"
                onClick={() => loeschen.mutate()}
                laedt={loeschen.isPending}
              >
                <Trash2 className="h-3.5 w-3.5 text-red-500" />
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}
