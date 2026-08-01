import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ClipboardList, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
import { leseLeitfadenText, pruefeGrenzen, schreibeLeitfadenText } from '../lib/leitfadenText'
import type { GespraechsAbschnitt, Stelle } from '../lib/typen'

/**
 * Verwaltung der Gesprächsleitfäden.
 *
 * Die API konnte das von Anfang an – anlegen, ändern, je Stelle zuordnen und
 * abschalten. Was fehlte, war die Oberfläche dazu: Nutzbar war deshalb nur der
 * eine mitgelieferte Leitfaden.
 */

interface Leitfaden {
  id: string
  name: string
  jobId: string | null
  job: { id: string; title: string } | null
  sections: GespraechsAbschnitt[]
  seeded: boolean
  active: boolean
}

/** Fragen brauchen eine stabile Kennung – daran hängen die Antworten. */
function neueFrageId(): string {
  return `f${Math.random().toString(36).slice(2, 10)}`
}

export function LeitfaedenPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [bearbeitet, setBearbeitet] = useState<Leitfaden | null>(null)
  const [dialogOffen, setDialogOffen] = useState(false)
  const [zuLoeschen, setZuLoeschen] = useState<Leitfaden | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['leitfaeden'],
    queryFn: () => api.get<Leitfaden[]>('/gespraeche/vorlagen?alle=true'),
  })

  const { data: stellen } = useQuery({
    queryKey: ['stellen-kurz'],
    queryFn: () => api.get<Stelle[]>('/stellen'),
  })

  const loeschen = useMutation({
    mutationFn: (id: string) => api.delete(`/gespraeche/vorlagen/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['leitfaeden'] })
      setZuLoeschen(null)
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const leitfaeden = data ?? []

  return (
    <Seite>
      <SeitenKopf
        titel={t('leitfaeden.titel')}
        beschreibung={t('leitfaeden.beschreibung')}
        aktion={
          <Button
            onClick={() => {
              setBearbeitet(null)
              setDialogOffen(true)
            }}
          >
            <Plus className="h-4 w-4" />
            {t('leitfaeden.neu')}
          </Button>
        }
      />

      <div className="mb-6">
        <Hinweis ton="info">{t('leitfaeden.hinweisUnzulaessig')}</Hinweis>
      </div>

      {isLoading ? (
        <LadeZustand />
      ) : leitfaeden.length === 0 ? (
        <LeerZustand
          titel={t('leitfaeden.keine')}
          beschreibung={t('leitfaeden.keineBeschreibung')}
          icon={<ClipboardList className="h-6 w-6" />}
        />
      ) : (
        <Karte>
          <ul className="divide-y divide-slate-100">
            {leitfaeden.map((l) => {
              const fragen = l.sections.reduce((summe, a) => summe + a.questions.length, 0)
              return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{l.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {l.job?.title ?? t('leitfaeden.alleStellen')} · {t('leitfaeden.fragenZahl', { n: fragen })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {l.seeded && <Badge ton="grau">{t('leitfaeden.geseedet')}</Badge>}
                    {!l.active && <Badge ton="gelb">{t('leitfaeden.inaktiv')}</Badge>}
                    <Button
                      variante="still"
                      groesse="sm"
                      onClick={() => {
                        setBearbeitet(l)
                        setDialogOffen(true)
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variante="still" groesse="sm" onClick={() => setZuLoeschen(l)}>
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </Karte>
      )}

      <LeitfadenDialog
        offen={dialogOffen}
        leitfaden={bearbeitet}
        stellen={stellen ?? []}
        onSchliessen={() => setDialogOffen(false)}
        onGespeichert={async () => {
          setDialogOffen(false)
          await queryClient.invalidateQueries({ queryKey: ['leitfaeden'] })
        }}
      />

      <BestaetigenDialog
        offen={zuLoeschen !== null}
        onSchliessen={() => setZuLoeschen(null)}
        onBestaetigen={() => zuLoeschen && loeschen.mutate(zuLoeschen.id)}
        titel={t('leitfaeden.loeschen')}
        text={t('leitfaeden.loeschenFrage')}
        laedt={loeschen.isPending}
      />
    </Seite>
  )
}

/**
 * Anlegen und Bearbeiten.
 *
 * Zwei Wege auf dieselben Daten: die Textform für den Regelfall – ein
 * Fragenkatalog liegt fast immer schon irgendwo und wird eingefügt – und die
 * Einzelfelder zum Nachbessern. Der Text ist die Vorgabe, weil Feld für Feld
 * abzutippen die unangenehmste Art ist, einen Katalog zu erfassen.
 */
function LeitfadenDialog({
  offen,
  leitfaden,
  stellen,
  onSchliessen,
  onGespeichert,
}: {
  offen: boolean
  leitfaden: Leitfaden | null
  stellen: Stelle[]
  onSchliessen: () => void
  onGespeichert: () => Promise<void>
}) {
  const toast = useToast()
  const [modus, setModus] = useState<'text' | 'felder'>('text')
  const [name, setName] = useState('')
  const [jobId, setJobId] = useState('')
  const [aktiv, setAktiv] = useState(true)
  const [abschnitte, setAbschnitte] = useState<GespraechsAbschnitt[]>([])
  const [text, setText] = useState('')

  // Der Stand beim Öffnen. Daran hängen die Kennungen, die eine unverändert
  // gebliebene Frage behalten soll.
  const [ausgangsAbschnitte, setAusgangsAbschnitte] = useState<GespraechsAbschnitt[]>([])

  useEffect(() => {
    if (!offen) return
    const geladen: GespraechsAbschnitt[] = leitfaden?.sections?.length
      ? JSON.parse(JSON.stringify(leitfaden.sections))
      : []
    setName(leitfaden?.name ?? '')
    setJobId(leitfaden?.jobId ?? '')
    setAktiv(leitfaden?.active ?? true)
    setAbschnitte(geladen.length ? geladen : [{ title: '', questions: [{ id: neueFrageId(), text: '' }] }])
    setAusgangsAbschnitte(geladen)
    setText(geladen.length ? schreibeLeitfadenText(leitfaden?.name ?? '', geladen) : '')
    setModus('text')
  }, [offen, leitfaden])

  // Im Textmodus wird bei jedem Tastendruck neu gelesen – das ist die
  // Vorschau rechts. Die Kennungen kommen dabei aus dem Ausgangsstand.
  const gelesen = useMemo(
    () => leseLeitfadenText(text, ausgangsAbschnitte),
    [text, ausgangsAbschnitte],
  )

  const wirksameAbschnitte = modus === 'text' ? gelesen.abschnitte : abschnitte
  const wirksamerName = (modus === 'text' && gelesen.name ? gelesen.name : name).trim()
  const fragenZahl = wirksameAbschnitte.reduce((summe, a) => summe + a.questions.length, 0)
  // Lieber hier auffallen als beim Speichern: Ein abgelehntes Dokument sagt
  // sonst nur „ungültig", ohne die Stelle zu nennen.
  const beanstandungen = pruefeGrenzen(wirksamerName, wirksameAbschnitte)

  const speichern = useMutation({
    mutationFn: () => {
      const nutzlast = {
        name: wirksamerName,
        jobId: jobId || null,
        active: aktiv,
        sections: wirksameAbschnitte
          .map((a) => ({
            title: a.title.trim(),
            questions: a.questions.filter((f) => f.text.trim()).map((f) => ({ ...f, text: f.text.trim() })),
          }))
          .filter((a) => a.title && a.questions.length > 0),
      }
      return leitfaden
        ? api.patch(`/gespraeche/vorlagen/${leitfaden.id}`, nutzlast)
        : api.post('/gespraeche/vorlagen', nutzlast)
    },
    onSuccess: async () => {
      await onGespeichert()
      toast.erfolg(t('app.gespeichert'))
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const setzeAbschnitt = (index: number, teil: Partial<GespraechsAbschnitt>) =>
    setAbschnitte((alt) => alt.map((a, i) => (i === index ? { ...a, ...teil } : a)))

  const leseDatei = async (datei: File) => {
    try {
      const inhalt = await datei.text()
      // Angehängt statt ersetzt: Wer schon etwas eingefügt hat, verliert es
      // nicht, weil er eine zweite Datei dazunimmt.
      setText((alt) => (alt.trim() ? `${alt.trim()}\n\n${inhalt}` : inhalt))
      setModus('text')
    } catch {
      toast.fehler(t('leitfaeden.dateiFehler'))
    }
  }

  return (
    <Dialog
      offen={offen}
      onSchliessen={onSchliessen}
      titel={leitfaden ? t('leitfaeden.bearbeiten') : t('leitfaeden.neu')}
      breite="voll"
      fusszeile={
        <>
          <span className="mr-auto text-xs text-slate-500">
            {fragenZahl > 0
              ? t('leitfaeden.fragenErkannt', {
                  fragen: fragenZahl,
                  abschnitte: wirksameAbschnitte.length,
                })
              : ''}
          </span>
          <Button variante="umriss" onClick={onSchliessen}>
            {t('app.abbrechen')}
          </Button>
          <Button
            onClick={() => speichern.mutate()}
            laedt={speichern.isPending}
            disabled={!wirksamerName || fragenZahl === 0 || beanstandungen.length > 0}
          >
            {t('app.speichern')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t('leitfaeden.name')}
            value={modus === 'text' && gelesen.name ? gelesen.name : name}
            hilfe={modus === 'text' && gelesen.name ? t('leitfaeden.nameAusText') : undefined}
            onChange={(e) => setName(e.target.value)}
            disabled={modus === 'text' && Boolean(gelesen.name)}
            pflicht
          />
          <Select
            label={t('leitfaeden.stelle')}
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
          >
            <option value="">{t('leitfaeden.alleStellen')}</option>
            {stellen.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </Select>
        </div>

        <Checkbox checked={aktiv} onChange={(e) => setAktiv(e.target.checked)} label={t('leitfaeden.aktiv')} />

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            {(['text', 'felder'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  // Beim Wechsel den jeweils anderen Stand nachziehen, damit
                  // nichts verlorengeht, was gerade eingegeben wurde.
                  if (m === 'felder') setAbschnitte(gelesen.abschnitte)
                  else setText(schreibeLeitfadenText(wirksamerName, abschnitte))
                  setModus(m)
                }}
                className={clsx(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  modus === m ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-700',
                )}
              >
                {m === 'text' ? t('leitfaeden.modusText') : t('leitfaeden.modusFelder')}
              </button>
            ))}
          </div>

          {modus === 'text' && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
              <Upload className="h-3.5 w-3.5" />
              {t('leitfaeden.datei')}
              <input
                type="file"
                accept=".md,.markdown,.txt,text/plain,text/markdown"
                className="hidden"
                onChange={(e) => {
                  const datei = e.target.files?.[0]
                  if (datei) void leseDatei(datei)
                  e.target.value = ''
                }}
              />
            </label>
          )}
        </div>

        {modus === 'text' ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <Textarea
                label={t('leitfaeden.textFeld')}
                rows={20}
                value={text}
                placeholder={t('leitfaeden.textPlatzhalter')}
                onChange={(e) => setText(e.target.value)}
                className="font-mono text-xs"
              />
              <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
                <p className="mb-1 font-semibold text-slate-700">{t('leitfaeden.formatTitel')}</p>
                <ul className="space-y-0.5">
                  <li><code>{t('leitfaeden.formatH1')}</code></li>
                  <li><code>{t('leitfaeden.formatH2')}</code></li>
                  <li>{t('leitfaeden.formatFrage')}</li>
                  <li><code>{t('leitfaeden.formatHinweis')}</code></li>
                </ul>
                <p className="mt-2 text-slate-500">{t('leitfaeden.formatWarumZitat')}</p>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-700">{t('leitfaeden.vorschau')}</p>
              {gelesen.abschnitte.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-400">
                  {t('leitfaeden.vorschauLeer')}
                </p>
              ) : (
                <>
                  <div className="max-h-[26rem] space-y-4 overflow-y-auto rounded-lg border border-slate-200 p-3">
                    {gelesen.abschnitte.map((abschnitt, ai) => (
                      <div key={`${abschnitt.title}-${ai}`}>
                        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {abschnitt.title}
                        </h4>
                        <ol className="space-y-1.5">
                          {abschnitt.questions.map((frage) => (
                            <li key={frage.id} className="text-sm text-slate-700">
                              {frage.text}
                              {frage.hint && (
                                <span className="block text-xs text-slate-400">{frage.hint}</span>
                              )}
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                  {beanstandungen.length > 0 && (
                    <Hinweis ton="warnung">
                      <ul className="space-y-0.5">
                        {beanstandungen.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    </Hinweis>
                  )}
                  {leitfaden && beanstandungen.length === 0 && (
                    <p className="text-xs text-slate-500">{t('leitfaeden.idsStabil')}</p>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('leitfaeden.abschnitte')}
              </h4>
              <Button
                variante="umriss"
                groesse="sm"
                onClick={() =>
                  setAbschnitte((alt) => [...alt, { title: '', questions: [{ id: neueFrageId(), text: '' }] }])
                }
              >
                <Plus className="h-3.5 w-3.5" />
                {t('leitfaeden.abschnittNeu')}
              </Button>
            </div>

            <div className="space-y-4">
              {abschnitte.map((abschnitt, ai) => (
                <div key={ai} className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-3 flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        label={t('leitfaeden.abschnittTitel')}
                        value={abschnitt.title}
                        onChange={(e) => setzeAbschnitt(ai, { title: e.target.value })}
                      />
                    </div>
                    <Button
                      variante="still"
                      groesse="sm"
                      onClick={() => setAbschnitte((alt) => alt.filter((_, i) => i !== ai))}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  </div>

                  {abschnitt.questions.length === 0 && (
                    <p className="mb-2 text-xs text-slate-400">{t('leitfaeden.leerAbschnitt')}</p>
                  )}

                  <ul className="space-y-2">
                    {abschnitt.questions.map((frage, fi) => (
                      <li key={frage.id} className="flex items-start gap-2">
                        <div className="flex-1 space-y-1">
                          <Input
                            value={frage.text}
                            placeholder={t('leitfaeden.frageText')}
                            onChange={(e) =>
                              setzeAbschnitt(ai, {
                                questions: abschnitt.questions.map((q, i) =>
                                  i === fi ? { ...q, text: e.target.value } : q,
                                ),
                              })
                            }
                          />
                          <Input
                            value={frage.hint ?? ''}
                            placeholder={t('leitfaeden.frageHinweis')}
                            onChange={(e) =>
                              setzeAbschnitt(ai, {
                                questions: abschnitt.questions.map((q, i) =>
                                  i === fi ? { ...q, hint: e.target.value } : q,
                                ),
                              })
                            }
                          />
                        </div>
                        <Button
                          variante="still"
                          groesse="sm"
                          onClick={() =>
                            setzeAbschnitt(ai, { questions: abschnitt.questions.filter((_, i) => i !== fi) })
                          }
                        >
                          <X className="h-3.5 w-3.5 text-slate-400" />
                        </Button>
                      </li>
                    ))}
                  </ul>

                  <Button
                    variante="still"
                    groesse="sm"
                    className="mt-2"
                    onClick={() =>
                      setzeAbschnitt(ai, {
                        questions: [...abschnitt.questions, { id: neueFrageId(), text: '' }],
                      })
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t('leitfaeden.frageNeu')}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
