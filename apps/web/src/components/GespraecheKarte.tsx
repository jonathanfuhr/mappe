import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, MessageSquare, Phone, Plus, Trash2, Users, Video } from 'lucide-react'
import { useState } from 'react'
import { formatDatum, t } from '../i18n'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Gespraech, GespraechsAbschnitt, GespraechsArt } from '../lib/typen'
import { Badge, Button, Hinweis, Karte, Select, Textarea } from './ui'
import { useToast } from './Toast'

interface Vorlage {
  id: string
  name: string
  sections: GespraechsAbschnitt[]
  jobId: string | null
}

const ARTEN: GespraechsArt[] = ['PERSOENLICH', 'TELEFON', 'VIDEO']

/** Kennzeichen ohne Beschriftung wäre raten – deshalb Symbol *und* Text. */
function ArtSymbol({ art }: { art: GespraechsArt }) {
  const klasse = 'h-3.5 w-3.5'
  if (art === 'TELEFON') return <Phone className={klasse} />
  if (art === 'VIDEO') return <Video className={klasse} />
  return <Users className={klasse} />
}

/**
 * Gesprächsvorlage und Notizen.
 *
 * Jede Person schreibt ihre eigenen Notizen – auch Interviewer, die sonst
 * nichts ändern dürfen. Fremde Notizen bleiben lesbar, aber unangetastet.
 *
 * Zwei Dinge sind hier bewusst so gebaut:
 *
 *  - **Ein Leitfaden ist nicht nötig.** Zweite und dritte Runden laufen ohne
 *    Fragenkatalog; dann zählt allein das Notizfeld. Früher sperrte die
 *    Oberfläche das Anlegen, sobald keine Vorlage vorlag – obwohl das
 *    Datenmodell den Fall längst vorsah.
 *  - **Abgeschlossen ist abgeschlossen.** Nach dem Abschließen zeigt der Bogen
 *    nur noch, was ausgefüllt wurde. Wer später ändern will, öffnet ihn
 *    ausdrücklich wieder – das steht dann im Protokoll.
 */
export function GespraecheKarte({
  bewerbungId,
  phase,
  gespraeche,
  onGeaendert,
}: {
  bewerbungId: string
  phase: string
  gespraeche: Gespraech[]
  onGeaendert: () => Promise<void>
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { nutzer } = useAuth()
  const [vorlageId, setVorlageId] = useState('')
  const [art, setArt] = useState<GespraechsArt>('PERSOENLICH')

  const { data: vorlagen } = useQuery({
    queryKey: ['gespraechsvorlagen', bewerbungId],
    queryFn: () => api.get<Vorlage[]>(`/gespraeche/passende/${bewerbungId}`).catch(() => []),
  })

  const anlegen = useMutation({
    mutationFn: () =>
      api.post<Gespraech & { hinweis: string | null }>('/gespraeche', {
        bewerbungId,
        // Leerer Wert heißt hier ausdrücklich „ohne Leitfaden“ – nicht
        // „nimm die erste Vorlage“.
        vorlageId: vorlageId || null,
        titel: 'Gespräch',
        art,
      }),
    onSuccess: async (neu) => {
      await onGeaendert()
      if (neu.hinweis) toast.zeige(neu.hinweis, 'warnung')
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const zuFrueh = ['NEU', 'GESICHTET'].includes(phase)
  const hatVorlagen = (vorlagen?.length ?? 0) > 0

  return (
    <Karte
      titel={t('gespraech.titel')}
      aktion={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={art}
            onChange={(e) => setArt(e.target.value as GespraechsArt)}
            className="w-[9rem]"
            aria-label={t('gespraech.art')}
          >
            {ARTEN.map((a) => (
              <option key={a} value={a}>
                {t(`gespraech.arten.${a}`)}
              </option>
            ))}
          </Select>
          <Select
            value={vorlageId}
            onChange={(e) => setVorlageId(e.target.value)}
            className="w-[14rem]"
            aria-label={t('gespraech.vorlage')}
          >
            <option value="">{t('gespraech.ohneLeitfaden')}</option>
            {vorlagen?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
          <Button
            variante="umriss"
            groesse="sm"
            onClick={() => anlegen.mutate()}
            laedt={anlegen.isPending}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('gespraech.neu')}
          </Button>
        </div>
      }
    >
      {!hatVorlagen && <Hinweis ton="info">{t('gespraech.keineVorlageHinweis')}</Hinweis>}

      {zuFrueh && gespraeche.length === 0 && (
        <p className="mb-3 text-sm text-slate-500">{t('gespraech.zuFrueh')}</p>
      )}

      {gespraeche.length === 0 ? (
        <p className="py-2 text-sm text-slate-500">{t('gespraech.keine')}</p>
      ) : (
        <ul className="space-y-4">
          {gespraeche.map((g) => (
            <GespraechsBlock
              key={g.id}
              gespraech={g}
              eigenes={g.user.id === nutzer?.id}
              istAdmin={nutzer?.role === 'ADMIN'}
              onGeaendert={async () => {
                await onGeaendert()
                await queryClient.invalidateQueries({ queryKey: ['bewerbung'] })
              }}
            />
          ))}
        </ul>
      )}
    </Karte>
  )
}

function GespraechsBlock({
  gespraech,
  eigenes,
  istAdmin,
  onGeaendert,
}: {
  gespraech: Gespraech
  eigenes: boolean
  istAdmin: boolean
  onGeaendert: () => Promise<void>
}) {
  const toast = useToast()
  const [antworten, setAntworten] = useState<Record<string, string>>(gespraech.answers ?? {})
  const [notizen, setNotizen] = useState(gespraech.notes ?? '')
  const [offen, setOffen] = useState(eigenes && !gespraech.completedAt)

  const abgeschlossen = Boolean(gespraech.completedAt)
  // Schreiben darf nur, wem der Bogen gehört – und nur solange er offen ist.
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

  const loeschen = useMutation({
    mutationFn: () => api.delete(`/gespraeche/${gespraech.id}`),
    onSuccess: onGeaendert,
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const abschnitte = gespraech.template?.sections ?? []

  // Im abgeschlossenen Zustand zählt nur, was tatsächlich beantwortet wurde.
  // Leere Felder sind dann kein Formular mehr, sondern Rauschen.
  const sichtbareAbschnitte = abgeschlossen
    ? abschnitte
        .map((a) => ({ ...a, questions: a.questions.filter((f) => (gespraech.answers?.[f.id] ?? '').trim()) }))
        .filter((a) => a.questions.length > 0)
    : abschnitte

  const nichtsAusgefuellt =
    abgeschlossen && sichtbareAbschnitte.length === 0 && !(gespraech.notes ?? '').trim()

  return (
    <li className="rounded-lg border border-slate-200">
      <button
        type="button"
        onClick={() => setOffen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <MessageSquare className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-900">
            {gespraech.template?.name ?? gespraech.title}
          </span>
          <span className="block text-xs text-slate-500">
            {gespraech.user.name} · {formatDatum(gespraech.conductedAt ?? gespraech.createdAt)}
          </span>
        </span>
        <Badge ton="grau">
          <ArtSymbol art={gespraech.kind} />
          {t(`gespraech.arten.${gespraech.kind}`)}
        </Badge>
        {abgeschlossen && (
          <Badge ton="gruen">
            <Lock className="h-3 w-3" />
            {t('gespraech.abgeschlossen')}
          </Badge>
        )}
        {eigenes && !abgeschlossen && <Badge ton="blau">eigenes</Badge>}
      </button>

      {offen && (
        <div className="space-y-4 border-t border-slate-100 px-4 py-4">
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
                        rows={2}
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

          {(!abgeschlossen || (gespraech.notes ?? '').trim()) && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('gespraech.notizen')}
              </h4>
              {bearbeitbar ? (
                <Textarea rows={4} value={notizen} onChange={(e) => setNotizen(e.target.value)} />
              ) : (
                <p className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {gespraech.notes || <span className="text-slate-400">–</span>}
                </p>
              )}
            </div>
          )}

          {(eigenes || istAdmin) && (
            <div className="flex flex-wrap gap-2">
              {bearbeitbar && (
                <>
                  <Button
                    groesse="sm"
                    onClick={() => {
                      if (window.confirm(t('gespraech.abschliessenFrage'))) speichern.mutate(true)
                    }}
                    laedt={speichern.isPending}
                  >
                    {t('gespraech.abschliessen')}
                  </Button>
                  <Button
                    variante="umriss"
                    groesse="sm"
                    onClick={() => speichern.mutate(false)}
                    laedt={speichern.isPending}
                  >
                    {t('gespraech.zwischenspeichern')}
                  </Button>
                </>
              )}
              {eigenes && abgeschlossen && (
                <Button
                  variante="umriss"
                  groesse="sm"
                  onClick={() => wiederOeffnen.mutate()}
                  laedt={wiederOeffnen.isPending}
                >
                  {t('gespraech.bearbeiten')}
                </Button>
              )}
              <Button
                variante="still"
                groesse="sm"
                onClick={() => loeschen.mutate()}
                laedt={loeschen.isPending}
              >
                <Trash2 className="h-3.5 w-3.5 text-red-500" />
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}
