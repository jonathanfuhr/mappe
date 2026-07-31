import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Mail, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Seite, SeitenKopf } from '../components/Layout'
import { useToast } from '../components/Toast'
import {
  Badge,
  BestaetigenDialog,
  Button,
  Checkbox,
  Dialog,
  Hinweis,
  Input,
  Karte,
  LadeZustand,
  LeerZustand,
  Select,
  Textarea,
} from '../components/ui'
import { t } from '../i18n'
import { api, ApiError } from '../lib/api'

type VorlagenArt =
  | 'EINGANGSBESTAETIGUNG'
  | 'EINLADUNG'
  | 'ZUSAGE'
  | 'ABSAGE'
  | 'INITIATIV_ABSAGE'
  | 'NACHFRAGE'
  | 'SONSTIGE'

const ARTEN: VorlagenArt[] = [
  'EINGANGSBESTAETIGUNG',
  'EINLADUNG',
  'ZUSAGE',
  'ABSAGE',
  'INITIATIV_ABSAGE',
  'NACHFRAGE',
  'SONSTIGE',
]

export interface Vorlage {
  id: string
  name: string
  type: VorlagenArt
  tone: 'DU' | 'SIE'
  subject: string
  body: string
  seeded: boolean
  active: boolean
  sortOrder: number
}

interface PlatzhalterListe {
  standard: { name: string; beschreibung: string; beispiel: string }[]
  frei: { name: string; beschreibung: string; beispiel: string }[]
}

export function VorlagenPage() {
  const queryClient = useQueryClient()
  const [bearbeitet, setBearbeitet] = useState<Vorlage | null>(null)
  const [dialogOffen, setDialogOffen] = useState(false)
  const [zuLoeschen, setZuLoeschen] = useState<Vorlage | null>(null)
  const toast = useToast()

  const { data, isLoading } = useQuery({
    queryKey: ['vorlagen'],
    queryFn: () => api.get<Vorlage[]>('/vorlagen'),
  })

  const aktualisieren = () => queryClient.invalidateQueries({ queryKey: ['vorlagen'] })

  const loeschen = useMutation({
    mutationFn: (id: string) => api.delete(`/vorlagen/${id}`),
    onSuccess: async () => {
      setZuLoeschen(null)
      await aktualisieren()
      toast.erfolg('Die Vorlage wurde gelöscht.')
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const nachArt = ARTEN.map((art) => ({
    art,
    vorlagen: (data ?? []).filter((v) => v.type === art),
  })).filter((g) => g.vorlagen.length > 0)

  return (
    <Seite>
      <SeitenKopf
        titel={t('vorlagen.titel')}
        beschreibung={t('vorlagen.beschreibung')}
        aktion={
          <Button
            onClick={() => {
              setBearbeitet(null)
              setDialogOffen(true)
            }}
          >
            <Plus className="h-4 w-4" />
            {t('vorlagen.neu')}
          </Button>
        }
      />

      <div className="mb-5">
        <Hinweis ton="info">{t('vorlagen.hinweisAbsage')}</Hinweis>
      </div>

      {isLoading ? (
        <LadeZustand />
      ) : nachArt.length === 0 ? (
        <Karte>
          <LeerZustand icon={<Mail className="h-10 w-10" />} titel={t('vorlagen.keine')} />
        </Karte>
      ) : (
        <div className="space-y-6">
          {nachArt.map((gruppe) => (
            <Karte key={gruppe.art} titel={t(`vorlagenArten.${gruppe.art}`)}>
              <ul className="divide-y divide-slate-100">
                {gruppe.vorlagen.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <Badge ton={v.tone === 'DU' ? 'gelb' : 'blau'}>
                      {v.tone === 'DU' ? t('vorlagen.du') : t('vorlagen.sie')}
                    </Badge>
                    <button
                      type="button"
                      onClick={() => {
                        setBearbeitet(v)
                        setDialogOffen(true)
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm font-medium text-slate-900">{v.name}</span>
                      <span className="block truncate text-xs text-slate-500">{v.subject}</span>
                    </button>
                    {v.seeded && <Badge ton="grau">{t('vorlagen.mitgeliefert')}</Badge>}
                    {!v.active && <Badge ton="rot">inaktiv</Badge>}
                    <button
                      type="button"
                      onClick={() => setZuLoeschen(v)}
                      className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-600"
                      aria-label={t('app.loeschen')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </Karte>
          ))}
        </div>
      )}

      <VorlagenDialog
        offen={dialogOffen}
        vorlage={bearbeitet}
        onSchliessen={() => setDialogOffen(false)}
        onGespeichert={async () => {
          setDialogOffen(false)
          await aktualisieren()
        }}
      />

      <BestaetigenDialog
        offen={Boolean(zuLoeschen)}
        onSchliessen={() => setZuLoeschen(null)}
        onBestaetigen={() => zuLoeschen && loeschen.mutate(zuLoeschen.id)}
        laedt={loeschen.isPending}
        titel={t('vorlagen.loeschenFrage')}
        text={
          <>
            <strong>{zuLoeschen?.name}</strong> wird entfernt.{' '}
            {zuLoeschen?.seeded
              ? 'Die Vorlage kommt auch nach einem Neustart nicht zurück.'
              : t('app.nichtRueckgaengig')}
          </>
        }
      />
    </Seite>
  )
}

function VorlagenDialog({
  offen,
  vorlage,
  onSchliessen,
  onGespeichert,
}: {
  offen: boolean
  vorlage: Vorlage | null
  onSchliessen: () => void
  onGespeichert: () => void
}) {
  const toast = useToast()
  const [f, setF] = useState<Partial<Vorlage>>({})
  const [initialisiertFuer, setInitialisiertFuer] = useState<string | null>(null)
  const textFeld = useRef<HTMLTextAreaElement>(null)
  const betreffFeld = useRef<HTMLInputElement>(null)
  const [letztesFeld, setLetztesFeld] = useState<'betreff' | 'text'>('text')

  const { data: platzhalter } = useQuery({
    queryKey: ['platzhalter'],
    queryFn: () => api.get<PlatzhalterListe>('/vorlagen/platzhalter'),
    enabled: offen,
  })

  const schluessel = offen ? (vorlage?.id ?? 'neu') : null
  if (schluessel !== initialisiertFuer) {
    setInitialisiertFuer(schluessel)
    setF(
      vorlage ?? {
        name: '',
        type: 'SONSTIGE',
        tone: 'SIE',
        subject: '',
        body: '',
        active: true,
        sortOrder: 90,
      },
    )
  }

  const setze = <K extends keyof Vorlage>(feld: K, wert: Vorlage[K]) =>
    setF((alt) => ({ ...alt, [feld]: wert }))

  /** Fügt einen Platzhalter an der Schreibmarke ein statt am Ende. */
  function fuegeEin(name: string) {
    const einfuegung = `$${name}`
    if (letztesFeld === 'betreff') {
      const feld = betreffFeld.current
      if (!feld) return
      const start = feld.selectionStart ?? feld.value.length
      const ende = feld.selectionEnd ?? start
      const neu = feld.value.slice(0, start) + einfuegung + feld.value.slice(ende)
      setze('subject', neu)
      queueMicrotask(() => {
        feld.focus()
        feld.setSelectionRange(start + einfuegung.length, start + einfuegung.length)
      })
      return
    }
    const feld = textFeld.current
    if (!feld) return
    const start = feld.selectionStart ?? feld.value.length
    const ende = feld.selectionEnd ?? start
    const neu = feld.value.slice(0, start) + einfuegung + feld.value.slice(ende)
    setze('body', neu)
    queueMicrotask(() => {
      feld.focus()
      feld.setSelectionRange(start + einfuegung.length, start + einfuegung.length)
    })
  }

  const speichern = useMutation({
    mutationFn: () => {
      const nutzlast = {
        name: f.name,
        type: f.type,
        tone: f.tone,
        subject: f.subject,
        body: f.body,
        active: f.active ?? true,
        sortOrder: f.sortOrder ?? 90,
      }
      return vorlage ? api.patch(`/vorlagen/${vorlage.id}`, nutzlast) : api.post('/vorlagen', nutzlast)
    },
    onSuccess: () => {
      toast.erfolg(t('app.gespeichert'))
      onGespeichert()
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const zuruecksetzen = useMutation({
    mutationFn: () => api.post<Vorlage>(`/vorlagen/${vorlage!.id}/zuruecksetzen`),
    onSuccess: (zurueck) => {
      setF(zurueck)
      toast.erfolg('Der Auslieferungsstand ist wiederhergestellt.')
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  return (
    <Dialog
      offen={offen}
      onSchliessen={onSchliessen}
      titel={vorlage ? vorlage.name : t('vorlagen.neu')}
      breite="voll"
      fusszeile={
        <>
          {vorlage?.seeded && (
            <Button
              variante="still"
              className="mr-auto"
              onClick={() => zuruecksetzen.mutate()}
              laedt={zuruecksetzen.isPending}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t('vorlagen.zuruecksetzen')}
            </Button>
          )}
          <Button variante="umriss" onClick={onSchliessen}>
            {t('app.abbrechen')}
          </Button>
          <Button onClick={() => speichern.mutate()} laedt={speichern.isPending}>
            {t('app.speichern')}
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label={t('nutzer.name')}
              value={f.name ?? ''}
              onChange={(e) => setze('name', e.target.value)}
              pflicht
            />
            <Select
              label={t('vorlagen.art')}
              value={f.type ?? 'SONSTIGE'}
              onChange={(e) => setze('type', e.target.value as VorlagenArt)}
            >
              {ARTEN.map((a) => (
                <option key={a} value={a}>
                  {t(`vorlagenArten.${a}`)}
                </option>
              ))}
            </Select>
            <Select
              label={t('vorlagen.ton')}
              value={f.tone ?? 'SIE'}
              onChange={(e) => setze('tone', e.target.value as 'DU' | 'SIE')}
            >
              <option value="SIE">{t('vorlagen.sie')}</option>
              <option value="DU">{t('vorlagen.du')}</option>
            </Select>
          </div>

          <Input
            ref={betreffFeld}
            label={t('vorlagen.betreff')}
            value={f.subject ?? ''}
            onFocus={() => setLetztesFeld('betreff')}
            onChange={(e) => setze('subject', e.target.value)}
            pflicht
          />

          <Textarea
            ref={textFeld}
            label={t('vorlagen.text')}
            rows={18}
            className="font-mono text-[13px]"
            value={f.body ?? ''}
            onFocus={() => setLetztesFeld('text')}
            onChange={(e) => setze('body', e.target.value)}
            pflicht
          />

          <Checkbox
            label={t('vorlagen.aktiv')}
            checked={f.active ?? true}
            onChange={(e) => setze('active', e.target.checked)}
          />
        </div>

        <aside>
          <h3 className="mb-1.5 text-sm font-semibold text-slate-900">{t('vorlagen.platzhalter')}</h3>
          <p className="mb-3 text-xs leading-relaxed text-slate-500">{t('vorlagen.platzhalterHilfe')}</p>

          <ul className="max-h-[24rem] space-y-1 overflow-y-auto duenner-scroll">
            {platzhalter?.standard.map((p) => (
              <PlatzhalterKnopf key={p.name} platzhalter={p} onKlick={() => fuegeEin(p.name)} />
            ))}
          </ul>

          {platzhalter && platzhalter.frei.length > 0 && (
            <>
              <h3 className="mb-1.5 mt-4 text-sm font-semibold text-slate-900">
                {t('vorlagen.freifelder')}
              </h3>
              <ul className="space-y-1">
                {platzhalter.frei.map((p) => (
                  <PlatzhalterKnopf key={p.name} platzhalter={p} onKlick={() => fuegeEin(p.name)} />
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </Dialog>
  )
}

function PlatzhalterKnopf({
  platzhalter,
  onKlick,
}: {
  platzhalter: { name: string; beschreibung: string; beispiel: string }
  onKlick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onKlick}
        title={platzhalter.beispiel ? `Beispiel: ${platzhalter.beispiel}` : undefined}
        className={clsx(
          'w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-left transition-colors',
          'hover:border-brand-300 hover:bg-brand-50',
        )}
      >
        <span className="block font-mono text-xs font-medium text-brand-700">${platzhalter.name}</span>
        <span className="block text-[11px] leading-snug text-slate-500">{platzhalter.beschreibung}</span>
      </button>
    </li>
  )
}
