import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Mail, MapPin, Phone, Search, ShieldCheck, UserSquare2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PhasenBadge } from '../components/Anzeigen'
import { NotizenKarte } from '../components/BewertungUndNotizen'
import { Seite, SeitenKopf } from '../components/Layout'
import { useToast } from '../components/Toast'
import {
  Badge,
  BestaetigenDialog,
  Button,
  Checkbox,
  Hinweis,
  Karte,
  LadeZustand,
  LeerZustand,
} from '../components/ui'
import { formatDatum, t } from '../i18n'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { vollerName, type Bewerber } from '../lib/typen'

interface Listenantwort {
  eintraege: (Bewerber & {
    _count: { applications: number }
    applications: { id: string; stage: string; appliedAt: string; job: { title: string } | null }[]
  })[]
  gesamt: number
  seite: number
  proSeite: number
}

export function BewerberListePage() {
  const [params, setParams] = useSearchParams()
  const suche = params.get('suche') ?? ''

  const { data, isLoading } = useQuery({
    queryKey: ['bewerber', suche],
    queryFn: () => api.get<Listenantwort>(`/bewerber?${suche ? `suche=${encodeURIComponent(suche)}` : ''}`),
  })

  return (
    <Seite breit>
      <SeitenKopf titel={t('bewerber.titel')} beschreibung={t('bewerber.beschreibung')} />

      <Karte className="mb-5">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="Name, E-Mail, Ort, Telefon …"
            defaultValue={suche}
            onChange={(e) => {
              const wert = e.target.value
              window.clearTimeout((window as unknown as { _bTimer?: number })._bTimer)
              ;(window as unknown as { _bTimer?: number })._bTimer = window.setTimeout(() => {
                const naechste = new URLSearchParams(params)
                if (wert) naechste.set('suche', wert)
                else naechste.delete('suche')
                setParams(naechste)
              }, 300)
            }}
          />
        </div>
      </Karte>

      {isLoading ? (
        <LadeZustand />
      ) : !data || data.eintraege.length === 0 ? (
        <Karte>
          <LeerZustand icon={<UserSquare2 className="h-10 w-10" />} titel={t('bewerber.keine')} />
        </Karte>
      ) : (
        <Karte className="overflow-hidden">
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="tabelle">
              <thead>
                <tr>
                  <th>{t('nutzer.name')}</th>
                  <th>{t('bewerber.kontakt')}</th>
                  <th>{t('bewerber.bewerbungenVon')}</th>
                  <th>{t('bewerber.einwilligung')}</th>
                </tr>
              </thead>
              <tbody>
                {data.eintraege.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link to={`/bewerber/${b.id}`} className="block font-medium text-slate-900">
                        {vollerName(b)}
                        {b.city && <span className="block text-xs font-normal text-slate-500">{b.city}</span>}
                      </Link>
                    </td>
                    <td className="text-slate-600">
                      {b.email && <div className="truncate text-xs">{b.email}</div>}
                      {b.phone && <div className="text-xs">{b.phone}</div>}
                    </td>
                    <td>
                      <span className="text-slate-700">{b._count.applications}</span>
                    </td>
                    <td>
                      {b.storageConsent ? (
                        <Badge ton="gruen">
                          <ShieldCheck className="h-3 w-3" />
                          liegt vor
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-400">–</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Karte>
      )}
    </Seite>
  )
}

export function BewerberDetailPage() {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { darfBearbeiten, istAdmin } = useAuth()
  const [loeschenOffen, setLoeschenOffen] = useState(false)

  const { data: bewerber, isLoading } = useQuery({
    queryKey: ['bewerber', id],
    queryFn: () => api.get<Bewerber>(`/bewerber/${id}`),
    enabled: Boolean(id),
  })

  const aktualisiere = async () => {
    await queryClient.invalidateQueries({ queryKey: ['bewerber', id] })
  }

  const einwilligung = useMutation({
    mutationFn: (wert: boolean) => api.patch(`/bewerber/${id}`, { einwilligung: wert }),
    onSuccess: async () => {
      await aktualisiere()
      toast.erfolg(t('app.gespeichert'))
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const loeschen = useMutation({
    mutationFn: () => api.delete(`/bewerber/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bewerber'] })
      toast.erfolg('Der Bewerber wurde mit allen Daten gelöscht.')
      navigate('/bewerber')
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  if (isLoading) return <Seite><LadeZustand /></Seite>
  if (!bewerber) return <Seite><Hinweis ton="fehler">{t('app.fehler')}</Hinweis></Seite>

  return (
    <Seite>
      <Link
        to="/bewerber"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('bewerber.titel')}
      </Link>

      <SeitenKopf
        titel={vollerName(bewerber)}
        beschreibung={
          [bewerber.title, t(`anreden.${bewerber.salutation}`)].filter(Boolean).join(' · ') || undefined
        }
      />

      <div className="space-y-6">
        <Karte titel={t('bewerber.kontakt')}>
          <dl className="grid gap-4 sm:grid-cols-2">
            {bewerber.email && (
              <div className="flex items-start gap-2.5 text-sm">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <a href={`mailto:${bewerber.email}`} className="break-all text-brand-700 hover:underline">
                  {bewerber.email}
                </a>
              </div>
            )}
            {bewerber.phone && (
              <div className="flex items-start gap-2.5 text-sm">
                <Phone className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <a href={`tel:${bewerber.phone}`} className="text-slate-700 hover:underline">
                  {bewerber.phone}
                </a>
              </div>
            )}
            {(bewerber.street || bewerber.city) && (
              <div className="flex items-start gap-2.5 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <span className="text-slate-700">
                  {bewerber.street && <>{bewerber.street}<br /></>}
                  {[bewerber.postalCode, bewerber.city].filter(Boolean).join(' ')}
                  {bewerber.country && <><br />{bewerber.country}</>}
                </span>
              </div>
            )}
          </dl>

          {(bewerber.links ?? []).length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('bewerber.links')}
              </h3>
              <ul className="flex flex-wrap gap-2">
                {bewerber.links.map((l) => (
                  <li key={l.url}>
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Karte>

        {darfBearbeiten && (
          <Karte titel="Aufbewahrung">
            <Checkbox
              label={t('bewerber.einwilligung')}
              hilfe={
                bewerber.storageConsent && bewerber.storageConsentDate
                  ? t('bewerber.einwilligungSeit', { datum: formatDatum(bewerber.storageConsentDate) })
                  : t('bewerber.einwilligungHilfe')
              }
              checked={bewerber.storageConsent}
              onChange={(e) => einwilligung.mutate(e.target.checked)}
            />
            {bewerber.purgeDueAt && !bewerber.storageConsent && (
              <div className="mt-3">
                <Hinweis ton="warnung">
                  Zur Löschung vorgemerkt ab {formatDatum(bewerber.purgeDueAt)}.
                </Hinweis>
              </div>
            )}
          </Karte>
        )}

        <Karte titel={t('bewerber.bewerbungenVon')}>
          {(bewerber.applications ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">{t('bewerbungen.keine')}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {bewerber.applications!.map((b) => (
                <li key={b.id}>
                  <Link
                    to={`/bewerbungen/${b.id}`}
                    className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-slate-50"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-900">
                      {b.job?.title ?? t('bewerbungen.ohneStelle')}
                    </span>
                    <PhasenBadge phase={b.stage} />
                    <span className="w-24 shrink-0 text-right text-xs text-slate-400">
                      {formatDatum(b.appliedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Karte>

        <NotizenKarte
          bewerberId={bewerber.id}
          notizen={bewerber.notes ?? []}
          onGeaendert={aktualisiere}
          titel="Notizen zur Person"
        />

        {istAdmin && (
          <Karte titel={t('bewerber.loeschen')} beschreibung={t('bewerber.loeschenHilfe')}>
            <Button variante="gefahr" onClick={() => setLoeschenOffen(true)}>
              {t('bewerber.loeschen')}
            </Button>
          </Karte>
        )}
      </div>

      <BestaetigenDialog
        offen={loeschenOffen}
        onSchliessen={() => setLoeschenOffen(false)}
        onBestaetigen={() => loeschen.mutate()}
        laedt={loeschen.isPending}
        titel={t('app.wirklichLoeschen')}
        text={
          <>
            <strong>{vollerName(bewerber)}</strong> wird mit allen Bewerbungen, Dokumenten, Mails und
            Notizen entfernt. {t('app.nichtRueckgaengig')}
          </>
        }
      />
    </Seite>
  )
}
