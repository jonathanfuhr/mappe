import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { t } from '../i18n'
import { api, ApiError } from '../lib/api'
import { Button, Checkbox, Hinweis, Input, Karte, LadeZustand } from './ui'
import { useToast } from './Toast'

interface Werte {
  neueBewerbung: boolean
  unbeantwortet: boolean
  tage: number
  perMail: boolean
}

export function BenachrichtigungsEinstellungen() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [entwurf, setEntwurf] = useState<Partial<Werte>>({})

  const { data } = useQuery({
    queryKey: ['einstellungen', 'benachrichtigungen'],
    queryFn: () => api.get<Werte>('/einstellungen/benachrichtigungen'),
  })

  // Ohne angebundenes Postfach kann Mappe nichts verschicken – das gehört
  // neben den Schalter, nicht in eine Fehlermeldung Tage später.
  const { data: mailStatus } = useQuery({
    queryKey: ['mail-status-kurz'],
    queryFn: () => api.get<{ adapter: string }>('/mail/status').catch(() => ({ adapter: 'aus' })),
  })
  const mailAngebunden = (mailStatus?.adapter ?? 'aus') !== 'aus'

  const speichern = useMutation({
    mutationFn: () => api.put('/einstellungen/benachrichtigungen', entwurf),
    onSuccess: async () => {
      setEntwurf({})
      await queryClient.invalidateQueries({ queryKey: ['einstellungen', 'benachrichtigungen'] })
      toast.erfolg(t('app.gespeichert'))
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  if (!data) return <LadeZustand />

  const wert = { ...data, ...entwurf }
  const geaendert = Object.keys(entwurf).length > 0
  const setze = <K extends keyof Werte>(feld: K, neu: Werte[K]) =>
    setEntwurf((e) => ({ ...e, [feld]: neu }))

  return (
    <Karte titel={t('benachrichtigungen.titel')}>
      <div className="max-w-xl space-y-5">
        <Hinweis ton="info">{t('benachrichtigungen.hinweis')}</Hinweis>

        <Checkbox
          label={t('benachrichtigungen.aktivNeue')}
          checked={wert.neueBewerbung}
          onChange={(e) => setze('neueBewerbung', e.target.checked)}
        />

        <div className="space-y-3 border-t border-slate-100 pt-5">
          <Checkbox
            label={t('benachrichtigungen.aktivUnbeantwortet')}
            checked={wert.unbeantwortet}
            onChange={(e) => setze('unbeantwortet', e.target.checked)}
          />
          {wert.unbeantwortet && (
            <Input
              type="number"
              min={1}
              max={365}
              label={t('benachrichtigungen.tage')}
              value={wert.tage}
              onChange={(e) => setze('tage', Number(e.target.value))}
              className="max-w-[14rem]"
            />
          )}
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-5">
          <Checkbox
            label={t('benachrichtigungen.perMail')}
            hilfe={t('benachrichtigungen.perMailHilfe')}
            checked={wert.perMail}
            onChange={(e) => setze('perMail', e.target.checked)}
          />
          {wert.perMail && !mailAngebunden && (
            <Hinweis ton="warnung">{t('benachrichtigungen.perMailOhnePostfach')}</Hinweis>
          )}
        </div>

        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
          {t('benachrichtigungen.empfaengerHinweis')}
        </p>
      </div>

      <div className="mt-6">
        <Button onClick={() => speichern.mutate()} laedt={speichern.isPending} disabled={!geaendert}>
          {t('app.speichern')}
        </Button>
      </div>
    </Karte>
  )
}
