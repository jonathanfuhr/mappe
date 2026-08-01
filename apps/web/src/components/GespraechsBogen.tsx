import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { formatDatum, t } from '../i18n'
import { api, ApiError } from '../lib/api'
import type { Gespraech } from '../lib/typen'
import { Button, Textarea } from './ui'
import { useToast } from './Toast'

/**
 * Der Gesprächsbogen selbst – Fragen, Notizen und die Knöpfe darunter.
 *
 * Bewusst eine gemeinsame Komponente für die Karte auf der Bewerbungsseite und
 * für die eigene Seite im zweiten Tab. Die Regeln, wann etwas noch änderbar ist
 * und was ein abgeschlossener Bogen zeigt, dürfen nicht an zwei Stellen
 * gepflegt werden – sonst laufen sie irgendwann auseinander.
 */
export function GespraechsBogen({
  gespraech,
  eigenes,
  onGeaendert,
}: {
  gespraech: Gespraech
  eigenes: boolean
  onGeaendert: () => Promise<void>
}) {
  const toast = useToast()
  const [antworten, setAntworten] = useState<Record<string, string>>(gespraech.answers ?? {})
  const [notizen, setNotizen] = useState(gespraech.notes ?? '')

  const abgeschlossen = Boolean(gespraech.completedAt)
  const bearbeitbar = eigenes && !abgeschlossen

  const speichern = useMutation({
    mutationFn: (abschliessen: boolean) =>
      api.patch(`/gespraeche/${gespraech.id}`, { antworten, notizen, abschliessen }),
    onSuccess: async () => {
      await onGeaendert()
      toast.erfolg(t('app.gespeichert'))
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const wiederOeffnen = useMutation({
    mutationFn: () => api.post(`/gespraeche/${gespraech.id}/wieder-oeffnen`, {}),
    onSuccess: async () => {
      await onGeaendert()
      toast.erfolg(t('gespraech.wiederGeoeffnet'))
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const abschnitte = gespraech.template?.sections ?? []

  // Ist der Bogen zu, zählt nur noch, was tatsächlich beantwortet wurde. Leere
  // Felder sind dann kein Formular mehr, sondern Rauschen.
  const sichtbareAbschnitte = abgeschlossen
    ? abschnitte
        .map((a) => ({
          ...a,
          questions: a.questions.filter((f) => (gespraech.answers?.[f.id] ?? '').trim()),
        }))
        .filter((a) => a.questions.length > 0)
    : abschnitte

  const hatNotizen = Boolean((gespraech.notes ?? '').trim())
  const nichtsAusgefuellt = abgeschlossen && sichtbareAbschnitte.length === 0 && !hatNotizen

  return (
    <div className="space-y-4">
      {bearbeitbar && abschnitte.length > 0 && (
        <p className="text-xs leading-relaxed text-slate-500">{t('gespraech.unzulaessig')}</p>
      )}

      {abgeschlossen && (
        <p className="text-xs text-slate-500">
          {t('gespraech.abgeschlossenAm', { datum: formatDatum(gespraech.completedAt) })}
        </p>
      )}

      {nichtsAusgefuellt && <p className="text-sm text-slate-400">{t('gespraech.nichtsAusgefuellt')}</p>}

      {sichtbareAbschnitte.map((abschnitt) => (
        <div key={abschnitt.title}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {abschnitt.title}
          </h4>
          <ul className="space-y-3">
            {abschnitt.questions.map((frage) => (
              <li key={frage.id}>
                <p className="mb-1 text-sm text-slate-700">{frage.text}</p>
                {frage.hint && !abgeschlossen && (
                  <p className="mb-1 text-xs text-slate-400">{frage.hint}</p>
                )}
                {bearbeitbar ? (
                  <Textarea
                    rows={3}
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

      {(!abgeschlossen || hatNotizen) && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t('gespraech.notizen')}
          </h4>
          {bearbeitbar ? (
            <Textarea rows={6} value={notizen} onChange={(e) => setNotizen(e.target.value)} />
          ) : (
            <p className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {gespraech.notes || <span className="text-slate-400">–</span>}
            </p>
          )}
        </div>
      )}

      {bearbeitbar && (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              if (window.confirm(t('gespraech.abschliessenFrage'))) speichern.mutate(true)
            }}
            laedt={speichern.isPending}
          >
            {t('gespraech.abschliessen')}
          </Button>
          <Button variante="umriss" onClick={() => speichern.mutate(false)} laedt={speichern.isPending}>
            {t('gespraech.zwischenspeichern')}
          </Button>
        </div>
      )}

      {eigenes && abgeschlossen && (
        <Button variante="umriss" onClick={() => wiederOeffnen.mutate()} laedt={wiederOeffnen.isPending}>
          {t('gespraech.bearbeiten')}
        </Button>
      )}
    </div>
  )
}
