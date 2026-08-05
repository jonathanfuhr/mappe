import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Forward,
  Mail,
  MapPin,
  Paperclip,
  Phone,
  Scissors,
  Send,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { KategorieBadge, PhasenBadge, QuellenBadge } from '../components/Anzeigen'
import { BewertungsKarte, NotizenKarte } from '../components/BewertungUndNotizen'
import { GespraecheKarte } from '../components/GespraecheKarte'
import { HistorieKarte } from '../components/HistorieKarte'
import { MailSendenDialog } from '../components/MailSendenDialog'
import { Seite } from '../components/Layout'
import { PdfBetrachter } from '../components/PdfBetrachter'
import { SplitAnsicht } from '../components/SplitAnsicht'
import { VorschlagsKarte } from '../components/VorschlagsKarte'
import { useToast } from '../components/Toast'
import {
  Badge,
  BestaetigenDialog,
  Button,
  Dialog,
  Hinweis,
  Karte,
  LadeZustand,
  Select,
} from '../components/ui'
import { formatBytes, formatDatum, formatDatumZeit, t } from '../i18n'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { PHASEN, vollerName, type Bewerbung, type Phase, type Stelle, type Dokument } from '../lib/typen'

export function BewerbungPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { darfBearbeiten } = useAuth()
  const [loeschenOffen, setLoeschenOffen] = useState(false)
  const [mailOffen, setMailOffen] = useState(false)

  const { data: bewerbung, isLoading } = useQuery({
    queryKey: ['bewerbung', id],
    queryFn: () => api.get<Bewerbung>(`/bewerbungen/${id}`),
    enabled: Boolean(id),
  })

  const { data: einstellungen } = useQuery({
    queryKey: ['einstellungen-oeffentlich'],
    queryFn: () => api.get<{ mailAktiv: boolean; kiAktiv: boolean }>('/einstellungen/oeffentlich'),
  })

  const { data: stellen } = useQuery({
    queryKey: ['stellen'],
    queryFn: () => api.get<Stelle[]>('/stellen'),
    enabled: darfBearbeiten,
  })

  const aktualisiere = async () => {
    await queryClient.invalidateQueries({ queryKey: ['bewerbung', id] })
    await queryClient.invalidateQueries({ queryKey: ['bewerbungen'] })
  }

  const phaseAendern = useMutation({
    mutationFn: (phase: Phase) => api.patch(`/bewerbungen/${id}/phase`, { phase }),
    onSuccess: aktualisiere,
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const stelleAendern = useMutation({
    mutationFn: (stelleId: string) =>
      api.patch(`/bewerbungen/${id}`, {
        stelleId: stelleId || null,
        initiativ: stelleId === '__initiativ__',
        ...(stelleId === '__initiativ__' ? { stelleId: null } : {}),
      }),
    onSuccess: aktualisiere,
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const bestaetigen = useMutation({
    mutationFn: () => api.post(`/bewerbungen/${id}/geprueft`),
    onSuccess: async () => {
      await aktualisiere()
      toast.erfolg('Die Angaben sind bestätigt.')
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const analysieren = useMutation({
    mutationFn: () => api.post<{ modell: string; aufgaben: string[] }>(`/ki/analysieren/${id}`),
    onSuccess: async (bericht) => {
      await aktualisiere()
      toast.erfolg(`${t('ki.analysiert')} (${bericht.aufgaben.join(', ')} · ${bericht.modell})`)
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const loeschen = useMutation({
    mutationFn: () => api.delete(`/bewerbungen/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bewerbungen'] })
      toast.erfolg('Die Bewerbung wurde gelöscht.')
      navigate('/bewerbungen')
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  if (isLoading) return <Seite><LadeZustand /></Seite>
  if (!bewerbung) return <Seite><Hinweis ton="fehler">{t('app.fehler')}</Hinweis></Seite>

  const bewerber = bewerbung.candidate

  return (
    <Seite breit>
      <Link
        to="/bewerbungen"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('bewerbungen.titel')}
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            {vollerName(bewerber)}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <PhasenBadge phase={bewerbung.stage} />
            <QuellenBadge quelle={bewerbung.source} />
            {bewerbung.speculative ? (
              <Badge ton="lila">{t('bewerbungen.initiativ')}</Badge>
            ) : bewerbung.job ? (
              <span>{bewerbung.job.title}</span>
            ) : (
              <span className="text-slate-400">{t('bewerbungen.ohneStelle')}</span>
            )}
            <span>·</span>
            <span>{formatDatum(bewerbung.appliedAt)}</span>
          </div>
        </div>

        {darfBearbeiten && (
          <div className="flex flex-wrap items-center gap-2">
            {einstellungen?.kiAktiv && (
              <Button
                variante="umriss"
                onClick={() => analysieren.mutate()}
                laedt={analysieren.isPending}
              >
                <Sparkles className="h-4 w-4" />
                {t('ki.analyse')}
              </Button>
            )}
            <Button variante="umriss" onClick={() => setMailOffen(true)}>
              <Send className="h-4 w-4" />
              {t('senden.titel')}
            </Button>
            <Select
              value={bewerbung.stage}
              onChange={(e) => phaseAendern.mutate(e.target.value as Phase)}
              className="w-[13rem]"
              aria-label={t('bewerbungen.phase')}
            >
              {PHASEN.map((p) => (
                <option key={p} value={p}>
                  {t(`phasen.${p}`)}
                </option>
              ))}
            </Select>
            <Button variante="still" onClick={() => setLoeschenOffen(true)} aria-label={t('app.loeschen')}>
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        )}
      </header>

      {bewerbung.needsReview && darfBearbeiten && (
        <VorschlagsKarte
          bewerbung={bewerbung}
          stellen={stellen ?? []}
          onBestaetigen={() => bestaetigen.mutate()}
          onGeaendert={aktualisiere}
          laedtBestaetigen={bestaetigen.isPending}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="space-y-6">
          <Karte titel={t('bewerber.kontakt')}>
            <dl className="space-y-3 text-sm">
              {bewerber.email && (
                <div className="flex items-start gap-2.5">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <a href={`mailto:${bewerber.email}`} className="min-w-0 break-all text-brand-700 hover:underline">
                    {bewerber.email}
                  </a>
                </div>
              )}
              {bewerber.phone && (
                <div className="flex items-start gap-2.5">
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <a href={`tel:${bewerber.phone}`} className="text-slate-700 hover:underline">
                    {bewerber.phone}
                  </a>
                </div>
              )}
              {(bewerber.street || bewerber.postalCode || bewerber.city) && (
                <div className="flex items-start gap-2.5">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <span className="text-slate-700">
                    {bewerber.street && <>{bewerber.street}<br /></>}
                    {[bewerber.postalCode, bewerber.city].filter(Boolean).join(' ')}
                  </span>
                </div>
              )}
              {(bewerber.links ?? []).length > 0 && (
                <div className="border-t border-slate-100 pt-3">
                  <dt className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t('bewerber.links')}
                  </dt>
                  <dd className="space-y-1">
                    {bewerber.links.map((l) => (
                      <a
                        key={l.url}
                        href={l.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="block truncate text-brand-700 hover:underline"
                      >
                        {l.label}
                      </a>
                    ))}
                  </dd>
                </div>
              )}
            </dl>

            <Link
              to={`/bewerber/${bewerber.id}`}
              className="mt-4 block text-sm font-medium text-brand-700 hover:underline"
            >
              Kontaktseite öffnen
            </Link>
          </Karte>

          {darfBearbeiten && (
            <Karte titel={t('bewerbungen.zuordnung')}>
              <Select
                value={bewerbung.speculative ? '__initiativ__' : (bewerbung.job?.id ?? '')}
                onChange={(e) => stelleAendern.mutate(e.target.value)}
              >
                <option value="">{t('bewerbungen.ohneStelle')}</option>
                <option value="__initiativ__">{t('bewerbungen.initiativ')}</option>
                {(stellen ?? [])
                  .filter((s) => !s.speculative)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
              </Select>
            </Karte>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          {bewerbung.summary && (
            <Karte titel="Kurzzusammenfassung">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {bewerbung.summary}
              </p>
            </Karte>
          )}

          <DokumenteKarte bewerbung={bewerbung} onGeaendert={aktualisiere} />

          <BewertungsKarte
            bewerbungId={bewerbung.id}
            bewertungen={bewerbung.ratings}
            schnitt={bewerbung.bewertung}
            onGeaendert={aktualisiere}
          />

          <GespraecheKarte
            bewerbungId={bewerbung.id}
            phase={bewerbung.stage}
            gespraeche={bewerbung.interviews}
            onGeaendert={aktualisiere}
          />

          <NotizenKarte
            bewerbungId={bewerbung.id}
            notizen={bewerbung.notes}
            onGeaendert={aktualisiere}
          />

          {bewerbung.mails.length > 0 && <MailVerlauf bewerbung={bewerbung} />}

          <HistorieKarte bewerbungId={bewerbung.id} />
        </div>
      </div>

      <MailSendenDialog
        offen={mailOffen}
        onSchliessen={() => setMailOffen(false)}
        bewerbung={bewerbung}
        mailAktiv={einstellungen?.mailAktiv ?? false}
        onGesendet={aktualisiere}
      />

      <BestaetigenDialog
        offen={loeschenOffen}
        onSchliessen={() => setLoeschenOffen(false)}
        onBestaetigen={() => loeschen.mutate()}
        laedt={loeschen.isPending}
        titel={t('app.wirklichLoeschen')}
        text={t('bewerbungen.loeschenFrage')}
      />
    </Seite>
  )
}

function DokumenteKarte({ bewerbung, onGeaendert }: { bewerbung: Bewerbung; onGeaendert: () => Promise<void> }) {
  const toast = useToast()
  const { darfBearbeiten } = useAuth()
  const dateiFeld = useRef<HTMLInputElement>(null)
  const [betrachtet, setBetrachtet] = useState<{ id: string; name: string } | null>(null)
  const [gesplittet, setGesplittet] = useState<{ id: string; name: string } | null>(null)
  const [zeigeOriginale, setZeigeOriginale] = useState(false)

  const hochladen = useMutation({
    mutationFn: (dateien: FileList) => {
      const formular = new FormData()
      for (const datei of Array.from(dateien)) formular.append('dateien', datei)
      return api.upload(`/dokumente/bewerbung/${bewerbung.id}`, formular)
    },
    onSuccess: async () => {
      await onGeaendert()
      toast.erfolg('Die Dateien wurden hinzugefügt.')
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  /**
   * Ein Original gilt als erledigt, sobald seine Seiten vollständig in
   * Teildokumenten stecken. Dann ist es nur noch Beleg – sichtbar bleiben
   * soll, womit gearbeitet wird.
   *
   * Maßstab sind die tatsächlich zugeordneten Seiten, nicht die bloße Anzahl
   * der Teile: Wer nur das Anschreiben herauslöst, hat den Rest noch vor sich
   * und braucht das Original weiter im Blick.
   */
  const vollstaendigAufgetrennt = (dok: Dokument): boolean => {
    if (dok.parentId !== null || !dok.pageCount) return false
    const teile = bewerbung.documents.filter((d) => d.parentId === dok.id)
    if (teile.length === 0) return false
    const abgedeckt = new Set(teile.flatMap((d) => d.sourcePages))
    return Array.from({ length: dok.pageCount }, (_, i) => i + 1).every((s) => abgedeckt.has(s))
  }

  const verborgene = bewerbung.documents.filter(vollstaendigAufgetrennt)
  const sichtbare = zeigeOriginale
    ? bewerbung.documents
    : bewerbung.documents.filter((d) => !verborgene.some((v) => v.id === d.id))

  return (
    <Karte
      titel={t('bewerbungen.dokumente')}
      aktion={
        darfBearbeiten ? (
          <>
            <input
              ref={dateiFeld}
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.odt,.txt"
              onChange={(e) => {
                if (e.target.files?.length) hochladen.mutate(e.target.files)
                e.target.value = ''
              }}
            />
            <Button
              variante="umriss"
              groesse="sm"
              onClick={() => dateiFeld.current?.click()}
              laedt={hochladen.isPending}
            >
              <Upload className="h-3.5 w-3.5" />
              {t('bewerbungen.hochladen')}
            </Button>
            {verborgene.length > 0 && (
              <Button variante="still" groesse="sm" onClick={() => setZeigeOriginale((z) => !z)}>
                {zeigeOriginale ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {zeigeOriginale ? t('bewerbungen.originaleAusblenden') : t('bewerbungen.originaleZeigen')}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {verborgene.length > 0 && !zeigeOriginale && (
        <p className="mb-2 text-xs text-slate-400">
          {t(
            verborgene.length === 1
              ? 'bewerbungen.originaleVerborgen'
              : 'bewerbungen.originaleVerborgenMehrzahl',
            { n: verborgene.length },
          )}
        </p>
      )}
      {sichtbare.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">{t('bewerbungen.keineDokumente')}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {sichtbare.map((dok) => {
            const istPdf = dok.mimeType === 'application/pdf'
            const teilVon = dok.parentId !== null
            return (
              <li key={dok.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <KategorieBadge kategorie={dok.category} />
                <button
                  type="button"
                  onClick={() =>
                    istPdf
                      ? setBetrachtet({ id: dok.id, name: dok.filename })
                      : window.open(`/api/dokumente/${dok.id}/datei`, '_blank')
                  }
                  className={clsx(
                    'min-w-0 flex-1 truncate text-left text-sm font-medium text-slate-900 hover:text-brand-700 hover:underline',
                    teilVon && 'pl-3',
                  )}
                >
                  {dok.filename}
                </button>
                <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">
                  {dok.pageCount ? `${dok.pageCount} S. · ` : ''}
                  {formatBytes(dok.size)}
                </span>
                {istPdf && darfBearbeiten && (dok.pageCount ?? 0) > 1 && !teilVon && (
                  <button
                    type="button"
                    onClick={() => setGesplittet({ id: dok.id, name: dok.filename })}
                    className="shrink-0 rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    aria-label={`${dok.filename} auftrennen`}
                    title="In Anschreiben, Lebenslauf und Zeugnisse auftrennen"
                  >
                    <Scissors className="h-4 w-4" />
                  </button>
                )}
                <a
                  href={`/api/dokumente/${dok.id}/datei`}
                  download
                  className="shrink-0 rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  aria-label={`${dok.filename} herunterladen`}
                >
                  <Download className="h-4 w-4" />
                </a>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog
        offen={Boolean(betrachtet)}
        onSchliessen={() => setBetrachtet(null)}
        titel={betrachtet?.name ?? ''}
        beschreibung="Textstelle markieren, um sie zu kommentieren. Die PDF selbst bleibt unverändert."
        breite="voll"
      >
        {betrachtet && <PdfBetrachter dokumentId={betrachtet.id} dateiname={betrachtet.name} />}
      </Dialog>

      <Dialog
        offen={Boolean(gesplittet)}
        onSchliessen={() => setGesplittet(null)}
        titel={`Auftrennen: ${gesplittet?.name ?? ''}`}
        beschreibung="Seiten den Kategorien zuordnen. Zusammenhängende Seiten bleiben in einer Datei."
        breite="voll"
      >
        {gesplittet && (
          <SplitAnsicht
            dokumentId={gesplittet.id}
            onFertig={() => {
              setGesplittet(null)
              void onGeaendert()
            }}
          />
        )}
      </Dialog>
    </Karte>
  )
}

function MailVerlauf({ bewerbung }: { bewerbung: Bewerbung }) {
  const [offen, setOffen] = useState<string | null>(bewerbung.mails[0]?.id ?? null)

  return (
    <Karte titel={t('bewerbungen.verlauf')}>
      <ul className="space-y-3">
        {bewerbung.mails.map((mail) => {
          const ausgeklappt = offen === mail.id
          return (
            <li key={mail.id} className="rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => setOffen(ausgeklappt ? null : mail.id)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left"
              >
                <span
                  className={clsx(
                    'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                    mail.direction === 'EINGEHEND' ? 'bg-slate-100 text-slate-600' : 'bg-brand-50 text-brand-700',
                  )}
                >
                  <Mail className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">
                    {mail.subject || '(ohne Betreff)'}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span className="truncate">
                      {mail.direction === 'EINGEHEND'
                        ? `${mail.fromName || mail.fromEmail}`
                        : `an ${mail.toEmails.join(', ')}`}
                    </span>
                    <span>·</span>
                    <span>{formatDatumZeit(mail.receivedAt ?? mail.sentAt ?? mail.createdAt)}</span>
                    {mail.forwarded && (
                      <Badge ton="gelb">
                        <Forward className="h-3 w-3" />
                        weitergeleitet
                      </Badge>
                    )}
                    {mail.attachments.length > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <Paperclip className="h-3 w-3" />
                        {mail.attachments.length}
                      </span>
                    )}
                  </span>
                </span>
              </button>

              {ausgeklappt && (
                <div className="border-t border-slate-100 px-4 py-3">
                  {mail.forwarded && mail.originalFromEmail && (
                    <Hinweis ton="warnung">
                      Diese Nachricht kam über {mail.fromEmail}. Als Bewerberadresse wurde{' '}
                      <strong>{mail.originalFromEmail}</strong> übernommen.
                    </Hinweis>
                  )}

                  <pre className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-700 duenner-scroll">
                    {mail.bodyText || '(kein Text)'}
                  </pre>

                  {mail.attachments.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                      {mail.attachments.map((a) => (
                        <li key={a.id}>
                          <a
                            href={`/api/mail/anhang/${a.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 transition-colors hover:bg-slate-50"
                          >
                            <Paperclip className="h-3 w-3" />
                            {a.filename}
                            <span className="text-slate-400">{formatBytes(a.size)}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}

                  {mail.emlPath && (
                    <a
                      href={`/api/mail/${mail.id}/original`}
                      className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-900"
                    >
                      <Download className="h-3 w-3" />
                      {t('bewerbungen.originalMail')}
                    </a>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Karte>
  )
}
