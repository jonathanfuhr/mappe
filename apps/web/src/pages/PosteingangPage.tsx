import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Inbox, RefreshCw, RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Seite, SeitenKopf } from '../components/Layout'
import { useToast } from '../components/Toast'
import { Badge, Button, Hinweis, Karte, LadeZustand, LeerZustand } from '../components/ui'
import { formatDatumZeit, formatRelativ, t } from '../i18n'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { MailStatus, SyncErgebnis } from '../lib/typen'

export function PosteingangPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { istAdmin } = useAuth()

  const { data: status, isLoading } = useQuery({
    queryKey: ['mail-status'],
    queryFn: () => api.get<MailStatus>('/mail/status'),
    // Während ein Abruf läuft, öfter nachsehen, damit die Anzeige mitwandert.
    refetchInterval: (abfrage) => (abfrage.state.data?.laeuft ? 3000 : 30_000),
  })

  const abrufen = useMutation({
    mutationFn: () => api.post<SyncErgebnis>('/mail/abrufen'),
    onSuccess: async (ergebnis) => {
      await queryClient.invalidateQueries({ queryKey: ['mail-status'] })
      await queryClient.invalidateQueries({ queryKey: ['bewerbungen'] })
      await queryClient.invalidateQueries({ queryKey: ['uebersicht'] })
      toast.erfolg(
        t('posteingang.ergebnis', {
          neue: ergebnis.neueBewerbungen,
          antworten: ergebnis.angehaengteAntworten,
          uebersprungen: ergebnis.uebersprungen,
        }),
      )
      if (ergebnis.fehler.length > 0) {
        toast.fehler(`${ergebnis.fehler.length} Nachricht(en) konnten nicht verarbeitet werden.`)
      }
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const zuruecksetzen = useMutation({
    mutationFn: () => api.post('/mail/zuruecksetzen'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mail-status'] })
      toast.erfolg('Der Abruf-Stand wurde zurückgesetzt.')
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  if (isLoading) return <Seite><LadeZustand /></Seite>

  if (!status || status.adapter === 'aus') {
    return (
      <Seite>
        <SeitenKopf titel={t('posteingang.titel')} />
        <Karte>
          <LeerZustand
            icon={<Inbox className="h-10 w-10" />}
            titel={t('posteingang.keinPostfach')}
            beschreibung={t('posteingang.keinPostfachHilfe')}
            aktion={
              istAdmin ? (
                <Link to="/einstellungen">
                  <Button>{t('einstellungen.mail')}</Button>
                </Link>
              ) : undefined
            }
          />
        </Karte>
      </Seite>
    )
  }

  return (
    <Seite>
      <SeitenKopf
        titel={t('posteingang.titel')}
        beschreibung={t('posteingang.beschreibung')}
        aktion={
          <Button onClick={() => abrufen.mutate()} laedt={abrufen.isPending || status.laeuft}>
            <RefreshCw className="h-4 w-4" />
            {status.laeuft ? t('posteingang.laeuft') : t('posteingang.jetztAbrufen')}
          </Button>
        }
      />

      <div className="space-y-6">
        {status.letzterFehler && (
          <Hinweis ton="fehler" titel={t('posteingang.fehlerBeimAbruf')}>
            {status.letzterFehler}
          </Hinweis>
        )}

        {status.erstAbrufSteht && !status.letzterFehler && (
          <Hinweis ton="info">{t('posteingang.erstAbruf')}</Hinweis>
        )}

        <Karte titel={status.adapterName}>
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('posteingang.letzterAbruf')}
              </dt>
              <dd className="mt-1 text-sm text-slate-900">
                {status.letzterAbruf ? (
                  <>
                    {formatRelativ(status.letzterAbruf)}
                    <span className="ml-2 text-slate-400">{formatDatumZeit(status.letzterAbruf)}</span>
                  </>
                ) : (
                  t('posteingang.nochNie')
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('mail.automatischAbrufen')}
              </dt>
              <dd className="mt-1 text-sm">
                {status.automatischAbrufen ? (
                  <Badge ton="gruen">alle {status.intervallSekunden} Sekunden</Badge>
                ) : (
                  <Badge ton="grau">abgeschaltet</Badge>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('posteingang.regeln')}
              </dt>
              <dd className="mt-1 flex flex-wrap gap-1.5 text-sm">
                {status.regeln.alsGelesenMarkieren && <Badge ton="blau">als gelesen markieren</Badge>}
                {status.regeln.inOrdnerVerschieben && (
                  <Badge ton="blau">verschieben nach „{status.regeln.ordnerName}"</Badge>
                )}
                {!status.regeln.alsGelesenMarkieren && !status.regeln.inOrdnerVerschieben && (
                  <span className="text-slate-500">Nachrichten bleiben unangetastet.</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('mail.weiterleitungsAdressen')}
              </dt>
              <dd className="mt-1 text-sm text-slate-900">
                {status.weiterleitungsAdressen.length > 0 ? (
                  status.weiterleitungsAdressen.join(', ')
                ) : (
                  <span className="text-slate-500">{t('app.keine')}</span>
                )}
              </dd>
            </div>
          </dl>
        </Karte>

        {istAdmin && (
          <Karte titel={t('posteingang.zuruecksetzen')} beschreibung={t('posteingang.zuruecksetzenHilfe')}>
            <Button
              variante="umriss"
              onClick={() => zuruecksetzen.mutate()}
              laedt={zuruecksetzen.isPending}
            >
              <RotateCcw className="h-4 w-4" />
              {t('posteingang.zuruecksetzen')}
            </Button>
          </Karte>
        )}

        {abrufen.data && abrufen.data.fehler.length > 0 && (
          <Karte titel="Nicht verarbeitete Nachrichten">
            <ul className="space-y-2 text-sm">
              {abrufen.data.fehler.map((f) => (
                <li key={f.nachricht} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span className="text-slate-700">{f.grund}</span>
                </li>
              ))}
            </ul>
          </Karte>
        )}
      </div>
    </Seite>
  )
}
