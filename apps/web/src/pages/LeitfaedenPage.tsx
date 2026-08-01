import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
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
} from '../components/ui'
import { t } from '../i18n'
import { api, ApiError } from '../lib/api'
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
  const [name, setName] = useState('')
  const [jobId, setJobId] = useState('')
  const [aktiv, setAktiv] = useState(true)
  const [abschnitte, setAbschnitte] = useState<GespraechsAbschnitt[]>([])

  // Beim Öffnen aus dem Datensatz füllen – sonst zeigt der Dialog beim zweiten
  // Aufruf noch die Eingaben des ersten.
  useEffect(() => {
    if (!offen) return
    setName(leitfaden?.name ?? '')
    setJobId(leitfaden?.jobId ?? '')
    setAktiv(leitfaden?.active ?? true)
    setAbschnitte(
      leitfaden?.sections?.length
        ? JSON.parse(JSON.stringify(leitfaden.sections))
        : [{ title: '', questions: [{ id: neueFrageId(), text: '' }] }],
    )
  }, [offen, leitfaden])

  const speichern = useMutation({
    mutationFn: () => {
      const nutzlast = {
        name: name.trim(),
        jobId: jobId || null,
        active: aktiv,
        // Leere Abschnitte und Fragen fliegen raus: Ein Katalog mit leeren
        // Zeilen ist im Gespräch nur störend.
        sections: abschnitte
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

  return (
    <Dialog
      offen={offen}
      onSchliessen={onSchliessen}
      titel={leitfaden ? t('leitfaeden.bearbeiten') : t('leitfaeden.neu')}
      breite="lg"
      fusszeile={
        <>
          <Button variante="umriss" onClick={onSchliessen}>
            {t('app.abbrechen')}
          </Button>
          <Button
            onClick={() => speichern.mutate()}
            laedt={speichern.isPending}
            disabled={!name.trim()}
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
            value={name}
            onChange={(e) => setName(e.target.value)}
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
      </div>
    </Dialog>
  )
}
