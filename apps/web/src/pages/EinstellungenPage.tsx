import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Seite, SeitenKopf } from '../components/Layout'
import { useToast } from '../components/Toast'
import { Button, Checkbox, Hinweis, Input, Karte, LadeZustand, Select, Textarea } from '../components/ui'
import { t } from '../i18n'
import { api, ApiError } from '../lib/api'

type Bereich = 'allgemein' | 'mail' | 'ki' | 'fristen' | 'anmeldung'

interface GesetztKennzeichen {
  _gesetzt: Record<string, boolean>
}

const BEREICHE: { schluessel: Bereich; label: string }[] = [
  { schluessel: 'allgemein', label: t('einstellungen.allgemein') },
  { schluessel: 'mail', label: t('einstellungen.mail') },
  { schluessel: 'ki', label: t('einstellungen.ki') },
  { schluessel: 'anmeldung', label: t('einstellungen.anmeldungBereich') },
]

/** Vorlagen für die gängigen Anbieter – erspart das Nachschlagen der URLs. */
const KI_VORLAGEN = [
  {
    name: 'OpenAI',
    basisUrl: 'https://api.openai.com/v1',
    modell: 'gpt-4o-mini',
    hinweis: 'Günstig, Kosten pro Bewerbung im Cent-Bereich.',
  },
  {
    name: 'Anthropic (Claude)',
    basisUrl: 'https://api.anthropic.com/v1',
    modell: 'claude-haiku-4-5-20251001',
    hinweis: 'OpenAI-kompatible Schnittstelle von Anthropic.',
  },
  {
    name: 'Azure OpenAI',
    basisUrl: 'https://IHRE-RESSOURCE.openai.azure.com/openai/deployments/IHR-DEPLOYMENT',
    modell: 'gpt-4o-mini',
    hinweis: 'Ressourcenname und Deployment in der URL ersetzen.',
  },
  {
    name: 'Ollama (lokal)',
    basisUrl: 'http://host.docker.internal:11434/v1',
    modell: 'qwen2.5:3b',
    hinweis:
      'Läuft ohne API-Schlüssel auf eigener Hardware. Auf einem Mac mini M1 mit 8 GB laufen 3B-Modelle entspannt; rechnen Sie mit ein bis zwei Minuten je Bewerbung und setzen Sie das Zeitlimit entsprechend hoch.',
  },
]

export function EinstellungenPage() {
  const [bereich, setBereich] = useState<Bereich>('allgemein')

  return (
    <Seite>
      <SeitenKopf titel={t('einstellungen.titel')} />

      <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
        {BEREICHE.map((b) => (
          <button
            key={b.schluessel}
            type="button"
            onClick={() => setBereich(b.schluessel)}
            className={clsx(
              '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              bereich === b.schluessel
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
            )}
          >
            {b.label}
          </button>
        ))}
      </div>

      {bereich === 'allgemein' && <AllgemeinBereich />}
      {bereich === 'mail' && <MailBereich />}
      {bereich === 'ki' && <KiBereich />}
      {bereich === 'anmeldung' && <AnmeldungBereich />}
    </Seite>
  )
}

/** Gemeinsames Gerüst: laden, ändern, speichern. */
function useBereich<T>(schluessel: Bereich) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [entwurf, setEntwurf] = useState<Partial<T>>({})

  const abfrage = useQuery({
    queryKey: ['einstellungen', schluessel],
    queryFn: () => api.get<T & GesetztKennzeichen>(`/einstellungen/${schluessel}`),
  })

  const speichern = useMutation({
    mutationFn: () => api.put(`/einstellungen/${schluessel}`, entwurf),
    onSuccess: async () => {
      setEntwurf({})
      await queryClient.invalidateQueries({ queryKey: ['einstellungen'] })
      await queryClient.invalidateQueries({ queryKey: ['mail-status'] })
      toast.erfolg(t('app.gespeichert'))
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const wert = { ...(abfrage.data as T), ...entwurf } as T & GesetztKennzeichen
  const geaendert = Object.keys(entwurf).length > 0
  const setze = <K extends keyof T>(feld: K, neu: T[K]) =>
    setEntwurf((e) => ({ ...e, [feld]: neu }) as Partial<T>)

  return { abfrage, wert, setze, setEntwurf, geaendert, speichern }
}

function SpeichernLeiste({ geaendert, laedt, onSpeichern }: { geaendert: boolean; laedt: boolean; onSpeichern: () => void }) {
  return (
    <div className="mt-6 flex items-center gap-3">
      <Button onClick={onSpeichern} laedt={laedt} disabled={!geaendert}>
        {t('app.speichern')}
      </Button>
      {geaendert && <span className="text-sm text-slate-500">Es liegen ungespeicherte Änderungen vor.</span>}
    </div>
  )
}

// --- Allgemein --------------------------------------------------------------

interface Allgemein {
  organisation: string
  absenderName: string
  signatur: string
}

function AllgemeinBereich() {
  const { abfrage, wert, setze, geaendert, speichern } = useBereich<Allgemein>('allgemein')
  if (abfrage.isLoading) return <LadeZustand />

  return (
    <Karte titel={t('einstellungen.allgemein')}>
      <div className="max-w-xl space-y-4">
        <Input
          label={t('einstellungen.organisation')}
          value={wert.organisation ?? ''}
          onChange={(e) => setze('organisation', e.target.value)}
        />
        <Input
          label={t('einstellungen.absenderName')}
          value={wert.absenderName ?? ''}
          onChange={(e) => setze('absenderName', e.target.value)}
        />
        <Textarea
          label={t('einstellungen.signatur')}
          hilfe={t('einstellungen.signaturHilfe')}
          rows={6}
          value={wert.signatur ?? ''}
          onChange={(e) => setze('signatur', e.target.value)}
        />
      </div>
      <SpeichernLeiste geaendert={geaendert} laedt={speichern.isPending} onSpeichern={() => speichern.mutate()} />
    </Karte>
  )
}

// --- Mail -------------------------------------------------------------------

interface MailEinstellungen {
  adapter: 'aus' | 'graph' | 'imap' | 'gmail'
  graph: { tenantId: string; clientId: string; clientSecret: string; postfach: string }
  imap: {
    host: string
    port: number
    secure: boolean
    benutzer: string
    passwort: string
    ordner: string
    smtpHost: string
    smtpPort: number
    smtpSecure: boolean
    smtpBenutzer: string
    smtpPasswort: string
    absender: string
  }
  gmail: { clientId: string; clientSecret: string; refreshToken: string; postfach: string }
  regeln: { alsGelesenMarkieren: boolean; inOrdnerVerschieben: boolean; ordnerName: string }
  weiterleitungsAdressen: string[]
  automatischAbrufen: boolean
  abrufIntervallSekunden: number
}

function MailBereich() {
  const toast = useToast()
  const { abfrage, wert, setze, geaendert, speichern } = useBereich<MailEinstellungen>('mail')
  const [pruefErgebnis, setPruefErgebnis] = useState<{ ok: boolean; meldung: string } | null>(null)

  const { data: status } = useQuery({
    queryKey: ['mail-status'],
    queryFn: () => api.get<{ verfuegbareAdapter: { schluessel: string; name: string; verfuegbar: boolean }[] }>('/mail/status'),
  })

  const pruefen = useMutation({
    mutationFn: () => api.post<{ ok: boolean; meldung: string }>('/mail/pruefen'),
    onSuccess: (ergebnis) => setPruefErgebnis(ergebnis),
    onError: (err: unknown) =>
      toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  if (abfrage.isLoading) return <LadeZustand />

  const graph = wert.graph ?? { tenantId: '', clientId: '', clientSecret: '', postfach: '' }
  const setzeGraph = (feld: keyof MailEinstellungen['graph'], neu: string) =>
    setze('graph', { ...graph, [feld]: neu })

  const regeln = wert.regeln ?? { alsGelesenMarkieren: false, inOrdnerVerschieben: false, ordnerName: 'Importiert' }
  const secretGesetzt = wert._gesetzt?.['graph.clientSecret']

  return (
    <div className="space-y-6">
      <Karte titel={t('mail.anbindung')}>
        <div className="max-w-xl space-y-4">
          <Select
            label={t('mail.anbieter')}
            value={wert.adapter ?? 'aus'}
            onChange={(e) => setze('adapter', e.target.value as MailEinstellungen['adapter'])}
          >
            {(status?.verfuegbareAdapter ?? []).map((a) => (
              <option key={a.schluessel} value={a.schluessel} disabled={!a.verfuegbar}>
                {a.name}
                {!a.verfuegbar ? ` (${t('mail.nochNichtVerfuegbar')})` : ''}
              </option>
            ))}
          </Select>

          {wert.adapter === 'graph' && (
            <>
              <Hinweis ton="info">{t('mail.berechtigungen')}</Hinweis>
              <Input
                label={t('mail.postfach')}
                hilfe={t('mail.postfachHilfe')}
                value={graph.postfach}
                onChange={(e) => setzeGraph('postfach', e.target.value)}
                placeholder="bewerbung@firma.de"
              />
              <Input
                label={t('mail.tenantId')}
                value={graph.tenantId}
                onChange={(e) => setzeGraph('tenantId', e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
              <Input
                label={t('mail.clientId')}
                value={graph.clientId}
                onChange={(e) => setzeGraph('clientId', e.target.value)}
              />
              <Input
                label={t('mail.clientSecret')}
                type="password"
                value={graph.clientSecret}
                onChange={(e) => setzeGraph('clientSecret', e.target.value)}
                placeholder={secretGesetzt ? '••••••••' : ''}
                hilfe={secretGesetzt ? t('einstellungen.geheimnisGesetzt') : undefined}
              />

              <div className="flex flex-wrap items-center gap-3">
                <Button variante="umriss" onClick={() => pruefen.mutate()} laedt={pruefen.isPending}>
                  {t('mail.verbindungPruefen')}
                </Button>
                {pruefErgebnis && (
                  <span
                    className={clsx(
                      'inline-flex items-center gap-1.5 text-sm',
                      pruefErgebnis.ok ? 'text-emerald-700' : 'text-red-700',
                    )}
                  >
                    {pruefErgebnis.ok ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
                    {pruefErgebnis.meldung}
                  </span>
                )}
              </div>
              {geaendert && (
                <p className="text-xs text-slate-500">
                  Die Prüfung nutzt die gespeicherten Werte – bitte zuerst speichern.
                </p>
              )}
            </>
          )}

          {wert.adapter === 'imap' && (
            <ImapFelder
              wert={wert}
              setze={setze}
              pruefen={pruefen}
              pruefErgebnis={pruefErgebnis}
              geaendert={geaendert}
            />
          )}

          {wert.adapter === 'gmail' && (
            <GmailFelder
              wert={wert}
              setze={setze}
              pruefen={pruefen}
              pruefErgebnis={pruefErgebnis}
              geaendert={geaendert}
            />
          )}
        </div>
        <SpeichernLeiste geaendert={geaendert} laedt={speichern.isPending} onSpeichern={() => speichern.mutate()} />
      </Karte>

      {wert.adapter !== 'aus' && (
        <Karte titel={t('posteingang.regeln')}>
          <div className="max-w-xl space-y-4">
            <Checkbox
              label={t('mail.alsGelesen')}
              checked={regeln.alsGelesenMarkieren}
              onChange={(e) => setze('regeln', { ...regeln, alsGelesenMarkieren: e.target.checked })}
            />
            <Checkbox
              label={t('mail.verschieben')}
              checked={regeln.inOrdnerVerschieben}
              onChange={(e) => setze('regeln', { ...regeln, inOrdnerVerschieben: e.target.checked })}
            />
            {regeln.inOrdnerVerschieben && (
              <Input
                label={t('mail.ordnerName')}
                value={regeln.ordnerName}
                onChange={(e) => setze('regeln', { ...regeln, ordnerName: e.target.value })}
              />
            )}

            <Textarea
              label={t('mail.weiterleitungsAdressen')}
              hilfe={
                <>
                  {t('mail.weiterleitungsHilfe')}
                  <br />
                  <span className="text-slate-600">{t('mail.tippUmleiten')}</span>
                </>
              }
              rows={2}
              value={(wert.weiterleitungsAdressen ?? []).join(', ')}
              onChange={(e) =>
                setze(
                  'weiterleitungsAdressen',
                  e.target.value
                    .split(',')
                    .map((a) => a.trim().toLowerCase())
                    .filter(Boolean),
                )
              }
              placeholder="info@firma.de, kontakt@firma.de"
            />

            <Checkbox
              label={t('mail.automatischAbrufen')}
              checked={wert.automatischAbrufen ?? true}
              onChange={(e) => setze('automatischAbrufen', e.target.checked)}
            />
            <Input
              type="number"
              min={30}
              max={86400}
              label={t('mail.intervall')}
              value={wert.abrufIntervallSekunden ?? 120}
              onChange={(e) => setze('abrufIntervallSekunden', Number(e.target.value))}
              className="max-w-[12rem]"
            />
          </div>
          <SpeichernLeiste geaendert={geaendert} laedt={speichern.isPending} onSpeichern={() => speichern.mutate()} />
        </Karte>
      )}
    </div>
  )
}

interface MailBereichsProps {
  wert: MailEinstellungen & GesetztKennzeichen
  setze: <K extends keyof MailEinstellungen>(feld: K, neu: MailEinstellungen[K]) => void
  pruefen: { mutate: () => void; isPending: boolean }
  pruefErgebnis: { ok: boolean; meldung: string } | null
  geaendert: boolean
}

function PruefLeiste({
  pruefen,
  pruefErgebnis,
  geaendert,
}: Pick<MailBereichsProps, 'pruefen' | 'pruefErgebnis' | 'geaendert'>) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button variante="umriss" onClick={() => pruefen.mutate()} laedt={pruefen.isPending}>
          {t('mail.verbindungPruefen')}
        </Button>
        {pruefErgebnis && (
          <span
            className={clsx(
              'inline-flex items-center gap-1.5 text-sm',
              pruefErgebnis.ok ? 'text-emerald-700' : 'text-red-700',
            )}
          >
            {pruefErgebnis.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {pruefErgebnis.meldung}
          </span>
        )}
      </div>
      {geaendert && (
        <p className="text-xs text-slate-500">
          Die Prüfung nutzt die gespeicherten Werte – bitte zuerst speichern.
        </p>
      )}
    </>
  )
}

function ImapFelder({ wert, setze, ...rest }: MailBereichsProps) {
  const imap = wert.imap ?? {
    host: '',
    port: 993,
    secure: true,
    benutzer: '',
    passwort: '',
    ordner: 'INBOX',
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
    smtpBenutzer: '',
    smtpPasswort: '',
    absender: '',
  }
  const setzeImap = <K extends keyof typeof imap>(feld: K, neu: (typeof imap)[K]) =>
    setze('imap', { ...imap, [feld]: neu })

  return (
    <>
      <Hinweis ton="info">{t('mail.imapHinweis')}</Hinweis>

      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Input
          label={t('mail.imapHost')}
          value={imap.host}
          onChange={(e) => setzeImap('host', e.target.value)}
          placeholder="imap.mail.me.com"
        />
        <Input
          type="number"
          label={t('mail.port')}
          value={imap.port}
          onChange={(e) => setzeImap('port', Number(e.target.value))}
        />
      </div>
      <Checkbox
        label={t('mail.tls')}
        checked={imap.secure}
        onChange={(e) => setzeImap('secure', e.target.checked)}
      />
      <Input
        label={t('mail.benutzer')}
        value={imap.benutzer}
        onChange={(e) => setzeImap('benutzer', e.target.value)}
      />
      <Input
        label={t('mail.passwort')}
        type="password"
        value={imap.passwort}
        onChange={(e) => setzeImap('passwort', e.target.value)}
        placeholder={wert._gesetzt?.['imap.passwort'] ? '••••••••' : ''}
        hilfe={t('mail.appPasswortHilfe')}
      />
      <Input
        label={t('mail.ordner')}
        value={imap.ordner}
        onChange={(e) => setzeImap('ordner', e.target.value)}
      />

      <div className="border-t border-slate-100 pt-4">
        <h4 className="mb-3 text-sm font-semibold text-slate-900">{t('mail.smtpTitel')}</h4>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Input
              label={t('mail.smtpHost')}
              value={imap.smtpHost}
              onChange={(e) => setzeImap('smtpHost', e.target.value)}
              placeholder="smtp.mail.me.com"
            />
            <Input
              type="number"
              label={t('mail.port')}
              value={imap.smtpPort}
              onChange={(e) => setzeImap('smtpPort', Number(e.target.value))}
            />
          </div>
          <Checkbox
            label={t('mail.tlsDirekt')}
            hilfe={t('mail.tlsDirektHilfe')}
            checked={imap.smtpSecure}
            onChange={(e) => setzeImap('smtpSecure', e.target.checked)}
          />
          <Input
            label={t('mail.absender')}
            hilfe={t('mail.absenderHilfe')}
            value={imap.absender}
            onChange={(e) => setzeImap('absender', e.target.value)}
          />
        </div>
      </div>

      <PruefLeiste {...rest} />
    </>
  )
}

function GmailFelder({ wert, setze, ...rest }: MailBereichsProps) {
  const gmail = wert.gmail ?? { clientId: '', clientSecret: '', refreshToken: '', postfach: '' }
  const setzeGmail = <K extends keyof typeof gmail>(feld: K, neu: (typeof gmail)[K]) =>
    setze('gmail', { ...gmail, [feld]: neu })

  return (
    <>
      <Hinweis ton="info">{t('mail.gmailHinweis')}</Hinweis>

      <Input
        label={t('mail.postfach')}
        hilfe={t('mail.postfachHilfe')}
        value={gmail.postfach}
        onChange={(e) => setzeGmail('postfach', e.target.value)}
        placeholder="bewerbung@firma.de"
      />
      <Input
        label={t('mail.clientId')}
        value={gmail.clientId}
        onChange={(e) => setzeGmail('clientId', e.target.value)}
      />
      <Input
        label={t('mail.clientSecret')}
        type="password"
        value={gmail.clientSecret}
        onChange={(e) => setzeGmail('clientSecret', e.target.value)}
        placeholder={wert._gesetzt?.['gmail.clientSecret'] ? '••••••••' : ''}
      />
      <Input
        label={t('mail.refreshToken')}
        type="password"
        hilfe={t('mail.refreshTokenHilfe')}
        value={gmail.refreshToken}
        onChange={(e) => setzeGmail('refreshToken', e.target.value)}
        placeholder={wert._gesetzt?.['gmail.refreshToken'] ? '••••••••' : ''}
      />

      <PruefLeiste {...rest} />
    </>
  )
}

// --- KI ---------------------------------------------------------------------

interface KiEinstellungen {
  aktiv: boolean
  basisUrl: string
  apiKey: string
  modell: string
  timeoutSekunden: number
  maxZeichen: number
  aufgaben: { erkennung: boolean; extraktion: boolean; zusammenfassung: boolean; pdfSplit: boolean }
}

function KiBereich() {
  const toast = useToast()
  const { abfrage, wert, setze, geaendert, speichern } = useBereich<KiEinstellungen>('ki')
  const [pruefErgebnis, setPruefErgebnis] = useState<{ ok: boolean; meldung: string; modus?: string } | null>(
    null,
  )

  const pruefen = useMutation({
    mutationFn: () => api.post<{ ok: boolean; meldung: string; modus?: string }>('/ki/pruefen'),
    onSuccess: (ergebnis) => setPruefErgebnis(ergebnis),
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  if (abfrage.isLoading) return <LadeZustand />

  const aufgaben = wert.aufgaben ?? {
    erkennung: true,
    extraktion: true,
    zusammenfassung: true,
    pdfSplit: true,
  }
  const schluesselGesetzt = wert._gesetzt?.apiKey

  return (
    <div className="space-y-6">
      <Karte titel={t('einstellungen.ki')} beschreibung={t('ki.beschreibung')}>
        <div className="max-w-2xl space-y-4">
          <Hinweis ton="warnung" titel={t('ki.transparenzTitel')}>
            {t('ki.transparenz')}
          </Hinweis>

          <Checkbox
            label={t('ki.aktiv')}
            hilfe={t('ki.aktivHilfe')}
            checked={wert.aktiv ?? false}
            onChange={(e) => setze('aktiv', e.target.checked)}
          />

          {wert.aktiv && (
            <>
              <div>
                <span className="feld-label">{t('ki.vorlagen')}</span>
                <div className="flex flex-wrap gap-2">
                  {KI_VORLAGEN.map((v) => (
                    <button
                      key={v.name}
                      type="button"
                      title={v.hinweis}
                      onClick={() => {
                        setze('basisUrl', v.basisUrl)
                        setze('modell', v.modell)
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:border-brand-300 hover:bg-brand-50"
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
                <p className="feld-hilfe">{t('ki.vorlagenHilfe')}</p>
              </div>

              <Input
                label={t('ki.basisUrl')}
                hilfe={t('ki.basisUrlHilfe')}
                value={wert.basisUrl ?? ''}
                onChange={(e) => setze('basisUrl', e.target.value)}
              />
              <Input
                label={t('ki.modell')}
                value={wert.modell ?? ''}
                onChange={(e) => setze('modell', e.target.value)}
              />
              <Input
                label={t('ki.apiKey')}
                type="password"
                value={wert.apiKey ?? ''}
                onChange={(e) => setze('apiKey', e.target.value)}
                placeholder={schluesselGesetzt ? '••••••••' : ''}
                hilfe={schluesselGesetzt ? t('einstellungen.geheimnisGesetzt') : t('ki.apiKeyHilfe')}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  type="number"
                  min={10}
                  max={1800}
                  label={t('ki.timeout')}
                  hilfe={t('ki.timeoutHilfe')}
                  value={wert.timeoutSekunden ?? 120}
                  onChange={(e) => setze('timeoutSekunden', Number(e.target.value))}
                />
                <Input
                  type="number"
                  min={1000}
                  max={200000}
                  step={1000}
                  label={t('ki.maxZeichen')}
                  hilfe={t('ki.maxZeichenHilfe')}
                  value={wert.maxZeichen ?? 24000}
                  onChange={(e) => setze('maxZeichen', Number(e.target.value))}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button variante="umriss" onClick={() => pruefen.mutate()} laedt={pruefen.isPending}>
                  {t('ki.pruefen')}
                </Button>
                {pruefErgebnis && (
                  <span
                    className={clsx(
                      'inline-flex items-center gap-1.5 text-sm',
                      pruefErgebnis.ok ? 'text-emerald-700' : 'text-red-700',
                    )}
                  >
                    {pruefErgebnis.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    {pruefErgebnis.meldung}
                  </span>
                )}
              </div>
              {pruefErgebnis?.modus && (
                <p className="text-xs text-slate-500">{pruefErgebnis.modus}</p>
              )}
              {geaendert && (
                <p className="text-xs text-slate-500">
                  Die Prüfung nutzt die gespeicherten Werte – bitte zuerst speichern.
                </p>
              )}
            </>
          )}
        </div>
        <SpeichernLeiste geaendert={geaendert} laedt={speichern.isPending} onSpeichern={() => speichern.mutate()} />
      </Karte>

      {wert.aktiv && (
        <Karte titel={t('ki.aufgaben')} beschreibung={t('ki.aufgabenHilfe')}>
          <div className="max-w-2xl space-y-3">
            <Checkbox
              label={t('ki.aufgabeErkennung')}
              hilfe={t('ki.aufgabeErkennungHilfe')}
              checked={aufgaben.erkennung}
              onChange={(e) => setze('aufgaben', { ...aufgaben, erkennung: e.target.checked })}
            />
            <Checkbox
              label={t('ki.aufgabeExtraktion')}
              hilfe={t('ki.aufgabeExtraktionHilfe')}
              checked={aufgaben.extraktion}
              onChange={(e) => setze('aufgaben', { ...aufgaben, extraktion: e.target.checked })}
            />
            <Checkbox
              label={t('ki.aufgabeZusammenfassung')}
              hilfe={t('ki.aufgabeZusammenfassungHilfe')}
              checked={aufgaben.zusammenfassung}
              onChange={(e) => setze('aufgaben', { ...aufgaben, zusammenfassung: e.target.checked })}
            />
            <Checkbox
              label={t('ki.aufgabePdfSplit')}
              hilfe={t('ki.aufgabePdfSplitHilfe')}
              checked={aufgaben.pdfSplit}
              onChange={(e) => setze('aufgaben', { ...aufgaben, pdfSplit: e.target.checked })}
            />
          </div>
          <SpeichernLeiste geaendert={geaendert} laedt={speichern.isPending} onSpeichern={() => speichern.mutate()} />
        </Karte>
      )}
    </div>
  )
}

// --- Anmeldung --------------------------------------------------------------

interface AnmeldungEinstellungen {
  lokalAktiv: boolean
  entraAktiv: boolean
  entra: { tenantId: string; clientId: string; clientSecret: string }
  erlaubteDomaenen: string[]
  kontenAutomatischAnlegen: boolean
}

function AnmeldungBereich() {
  const toast = useToast()
  const { abfrage, wert, setze, geaendert, speichern } = useBereich<AnmeldungEinstellungen>('anmeldung')

  if (abfrage.isLoading) return <LadeZustand />

  const entra = wert.entra ?? { tenantId: '', clientId: '', clientSecret: '' }
  const setzeEntra = (feld: keyof AnmeldungEinstellungen['entra'], neu: string) =>
    setze('entra', { ...entra, [feld]: neu })

  const secretGesetzt = wert._gesetzt?.['entra.clientSecret']
  // Aussperrschutz: Die lokale Anmeldung darf erst weg, wenn der
  // Microsoft-Login wirklich steht. Sonst kommt niemand mehr hinein.
  const entraVollstaendig =
    wert.entraAktiv && Boolean(entra.tenantId && entra.clientId && (entra.clientSecret || secretGesetzt))

  const redirect = `${window.location.origin}/api/auth/entra/callback`

  return (
    <Karte titel={t('einstellungen.anmeldungBereich')}>
      <div className="max-w-2xl space-y-4">
        <Checkbox
          label={t('anmeldungBereich.lokalAktiv')}
          checked={wert.lokalAktiv ?? true}
          disabled={!entraVollstaendig}
          hilfe={!entraVollstaendig ? t('anmeldungBereich.aussperrschutz') : undefined}
          onChange={(e) => setze('lokalAktiv', e.target.checked)}
        />

        <div className="border-t border-slate-100 pt-4">
          <Checkbox
            label={t('anmeldungBereich.entraAktiv')}
            hilfe={t('anmeldungBereich.entraHilfe')}
            checked={wert.entraAktiv ?? false}
            onChange={(e) => setze('entraAktiv', e.target.checked)}
          />
        </div>

        {wert.entraAktiv && (
          <>
            <div>
              <span className="feld-label">{t('anmeldungBereich.redirectUri')}</span>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={redirect}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 font-mono text-xs text-slate-700"
                />
                <Button
                  variante="umriss"
                  onClick={() => {
                    void navigator.clipboard.writeText(redirect)
                    toast.erfolg(t('anmeldungBereich.kopiert'))
                  }}
                >
                  Kopieren
                </Button>
              </div>
              <p className="feld-hilfe">{t('anmeldungBereich.redirectUriHilfe')}</p>
            </div>

            <Input
              label={t('mail.tenantId')}
              value={entra.tenantId}
              onChange={(e) => setzeEntra('tenantId', e.target.value)}
            />
            <Input
              label={t('mail.clientId')}
              value={entra.clientId}
              onChange={(e) => setzeEntra('clientId', e.target.value)}
            />
            <Input
              label={t('mail.clientSecret')}
              type="password"
              value={entra.clientSecret}
              onChange={(e) => setzeEntra('clientSecret', e.target.value)}
              placeholder={secretGesetzt ? '••••••••' : ''}
              hilfe={secretGesetzt ? t('einstellungen.geheimnisGesetzt') : undefined}
            />

            <Input
              label={t('anmeldungBereich.erlaubteDomaenen')}
              hilfe={t('anmeldungBereich.erlaubteDomaenenHilfe')}
              value={(wert.erlaubteDomaenen ?? []).join(', ')}
              onChange={(e) =>
                setze(
                  'erlaubteDomaenen',
                  e.target.value
                    .split(',')
                    .map((d) => d.trim().toLowerCase())
                    .filter(Boolean),
                )
              }
              placeholder="firma.de"
            />

            <Checkbox
              label={t('anmeldungBereich.kontenAnlegen')}
              hilfe={t('anmeldungBereich.kontenAnlegenHilfe')}
              checked={wert.kontenAutomatischAnlegen ?? false}
              onChange={(e) => setze('kontenAutomatischAnlegen', e.target.checked)}
            />
          </>
        )}
      </div>
      <SpeichernLeiste geaendert={geaendert} laedt={speichern.isPending} onSpeichern={() => speichern.mutate()} />
    </Karte>
  )
}

export function EinstellungsAbschnitt({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-slate-900">{titel}</h3>
      {children}
    </div>
  )
}
