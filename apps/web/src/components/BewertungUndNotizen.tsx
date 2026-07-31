import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Star, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { formatRelativ, t } from '../i18n'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Bewertung, EinzelBewertung, Notiz, Urteil } from '../lib/typen'
import { UrteilVerteilung } from './Anzeigen'
import { useToast } from './Toast'
import { Badge, Button, Karte, Textarea } from './ui'

const URTEILE: { wert: Urteil; label: string; ton: 'gruen' | 'gelb' | 'rot' }[] = [
  { wert: 'JA', label: 'Ja', ton: 'gruen' },
  { wert: 'VIELLEICHT', label: 'Vielleicht', ton: 'gelb' },
  { wert: 'NEIN', label: 'Nein', ton: 'rot' },
]

/**
 * Bewertung: 1–5 Sterne, ein kurzes Urteil und ein Kommentar.
 * Jeder sieht die eigene Bewertung zum Ändern und die der anderen als Liste –
 * so bleibt nachvollziehbar, wer wie entschieden hat.
 */
export function BewertungsKarte({
  bewerbungId,
  bewertungen,
  schnitt,
  onGeaendert,
}: {
  bewerbungId: string
  bewertungen: EinzelBewertung[]
  schnitt: Bewertung
  onGeaendert: () => Promise<void>
}) {
  const toast = useToast()
  const { nutzer } = useAuth()

  const eigene = bewertungen.find((b) => b.user.id === nutzer?.id)
  const fremde = bewertungen.filter((b) => b.user.id !== nutzer?.id)

  const [sterne, setSterne] = useState(eigene?.stars ?? 0)
  const [urteil, setUrteil] = useState<Urteil | null>(eigene?.verdict ?? null)
  const [kommentar, setKommentar] = useState(eigene?.comment ?? '')
  const [bearbeitet, setBearbeitet] = useState(!eigene)

  const speichern = useMutation({
    mutationFn: () =>
      api.put(`/bewertungen/bewerbung/${bewerbungId}`, {
        sterne,
        urteil,
        kommentar: kommentar.trim() || null,
      }),
    onSuccess: async () => {
      await onGeaendert()
      setBearbeitet(false)
      toast.erfolg('Die Bewertung wurde gespeichert.')
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const loeschen = useMutation({
    mutationFn: (id: string) => api.delete(`/bewertungen/${id}`),
    onSuccess: async () => {
      setSterne(0)
      setUrteil(null)
      setKommentar('')
      setBearbeitet(true)
      await onGeaendert()
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  return (
    <Karte
      titel={t('bewerbungen.bewertung')}
      aktion={
        schnitt.anzahl > 0 ? (
          <span className="flex items-center gap-2">
            <span className="text-lg font-semibold text-slate-900">{schnitt.schnitt?.toFixed(1)}</span>
            <UrteilVerteilung bewertung={schnitt} />
          </span>
        ) : undefined
      }
    >
      {bearbeitet ? (
        <div className="space-y-3">
          <SterneWahl wert={sterne} onWahl={setSterne} />

          <div className="flex flex-wrap gap-2">
            {URTEILE.map((u) => (
              <button
                key={u.wert}
                type="button"
                onClick={() => setUrteil(urteil === u.wert ? null : u.wert)}
                className={clsx(
                  'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                  urteil === u.wert
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                )}
              >
                {u.label}
              </button>
            ))}
          </div>

          <Textarea
            rows={3}
            value={kommentar}
            onChange={(e) => setKommentar(e.target.value)}
            placeholder="Kurze Begründung (optional) …"
          />

          <div className="flex gap-2">
            <Button
              groesse="sm"
              onClick={() => speichern.mutate()}
              laedt={speichern.isPending}
              disabled={sterne < 1}
            >
              {t('app.speichern')}
            </Button>
            {eigene && (
              <Button variante="still" groesse="sm" onClick={() => setBearbeitet(false)}>
                {t('app.abbrechen')}
              </Button>
            )}
          </div>
          {sterne < 1 && <p className="text-xs text-slate-500">Bitte 1 bis 5 Sterne vergeben.</p>}
        </div>
      ) : (
        eigene && (
          <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-900">Ihre Bewertung</span>
              <span className="flex items-center gap-1">
                <Button variante="still" groesse="sm" onClick={() => setBearbeitet(true)}>
                  {t('app.bearbeiten')}
                </Button>
                <button
                  type="button"
                  onClick={() => loeschen.mutate(eigene.id)}
                  className="rounded p-1.5 text-slate-400 transition-colors hover:bg-white hover:text-red-600"
                  aria-label={t('app.loeschen')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
            <BewertungsZeile bewertung={eigene} />
          </div>
        )
      )}

      {fremde.length > 0 && (
        <ul className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          {fremde.map((b) => (
            <li key={b.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-700">{b.user.name}</span>
                <span className="text-xs text-slate-400">{formatRelativ(b.createdAt)}</span>
              </div>
              <BewertungsZeile bewertung={b} />
            </li>
          ))}
        </ul>
      )}
    </Karte>
  )
}

function BewertungsZeile({ bewertung }: { bewertung: EinzelBewertung }) {
  const urteil = URTEILE.find((u) => u.wert === bewertung.verdict)
  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-2">
        <span className="flex">
          {[1, 2, 3, 4, 5].map((s) => (
            <Star
              key={s}
              className={clsx('h-4 w-4', s <= bewertung.stars ? 'fill-amber-400 text-amber-400' : 'text-slate-300')}
            />
          ))}
        </span>
        {urteil && <Badge ton={urteil.ton}>{urteil.label}</Badge>}
      </div>
      {bewertung.comment && (
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{bewertung.comment}</p>
      )}
    </div>
  )
}

function SterneWahl({ wert, onWahl }: { wert: number; onWahl: (n: number) => void }) {
  const [schwebt, setSchwebt] = useState(0)
  const angezeigt = schwebt || wert

  return (
    <div className="flex items-center gap-1" onMouseLeave={() => setSchwebt(0)}>
      {[1, 2, 3, 4, 5].map((stufe) => (
        <button
          key={stufe}
          type="button"
          onMouseEnter={() => setSchwebt(stufe)}
          onClick={() => onWahl(stufe)}
          className="rounded p-0.5 transition-transform hover:scale-110"
          aria-label={`${stufe} von 5 Sternen`}
        >
          <Star
            className={clsx(
              'h-6 w-6 transition-colors',
              stufe <= angezeigt ? 'fill-amber-400 text-amber-400' : 'text-slate-300',
            )}
          />
        </button>
      ))}
      {wert > 0 && <span className="ml-2 text-sm text-slate-500">{wert} von 5</span>}
    </div>
  )
}

// --- Notizen ----------------------------------------------------------------

export function NotizenKarte({
  bewerbungId,
  bewerberId,
  notizen,
  onGeaendert,
  titel,
}: {
  bewerbungId?: string
  bewerberId?: string
  notizen: Notiz[]
  onGeaendert: () => Promise<void>
  titel?: string
}) {
  const toast = useToast()
  const { nutzer } = useAuth()
  const [text, setText] = useState('')

  const anlegen = useMutation({
    mutationFn: () => api.post('/notizen', { bewerbungId, bewerberId, text }),
    onSuccess: async () => {
      setText('')
      await onGeaendert()
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const loeschen = useMutation({
    mutationFn: (id: string) => api.delete(`/notizen/${id}`),
    onSuccess: onGeaendert,
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  return (
    <Karte titel={titel ?? t('bewerbungen.notizen')}>
      <div className="mb-4">
        <Textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('bewerbungen.notizSchreiben')}
        />
        <Button
          groesse="sm"
          className="mt-2"
          onClick={() => anlegen.mutate()}
          laedt={anlegen.isPending}
          disabled={!text.trim()}
        >
          {t('app.speichern')}
        </Button>
      </div>

      {notizen.length === 0 ? (
        <p className="text-sm text-slate-500">{t('bewerbungen.keineNotizen')}</p>
      ) : (
        <ul className="space-y-3 border-t border-slate-100 pt-4">
          {notizen.map((n) => (
            <li key={n.id} className="group">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-700">{n.user.name}</span>
                  {n.kind === 'GESPRAECH' && <Badge ton="lila">Gespräch</Badge>}
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-xs text-slate-400">{formatRelativ(n.createdAt)}</span>
                  {(n.user.id === nutzer?.id || nutzer?.role === 'ADMIN') && (
                    <button
                      type="button"
                      onClick={() => loeschen.mutate(n.id)}
                      className="rounded p-1 text-slate-300 opacity-0 transition-all hover:bg-slate-100 hover:text-red-600 group-hover:opacity-100"
                      aria-label={t('app.loeschen')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {n.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Karte>
  )
}
