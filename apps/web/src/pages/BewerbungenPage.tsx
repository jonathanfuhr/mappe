import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderOpen, Paperclip, Plus, Search, StickyNote } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BewertungAnzeige, PhasenBadge, QuellenBadge } from '../components/Anzeigen'
import { Seite, SeitenKopf } from '../components/Layout'
import { useToast } from '../components/Toast'
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  Input,
  Karte,
  LadeZustand,
  LeerZustand,
  Select,
} from '../components/ui'
import { formatDatum, t } from '../i18n'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { PHASEN, QUELLEN, vollerName, type BewerbungKurz, type Stelle } from '../lib/typen'

interface Listenantwort {
  eintraege: BewerbungKurz[]
  gesamt: number
  seite: number
  proSeite: number
}

export function BewerbungenPage() {
  const { darfBearbeiten } = useAuth()
  const [params, setParams] = useSearchParams()
  const [neuOffen, setNeuOffen] = useState(false)

  const setzeFilter = (schluessel: string, wert: string) => {
    const naechste = new URLSearchParams(params)
    if (wert) naechste.set(schluessel, wert)
    else naechste.delete(schluessel)
    naechste.delete('seite')
    setParams(naechste)
  }

  const abfrageParameter = new URLSearchParams()
  for (const [k, v] of params) if (v) abfrageParameter.set(k, v)

  const { data, isLoading } = useQuery({
    queryKey: ['bewerbungen', abfrageParameter.toString()],
    queryFn: () => api.get<Listenantwort>(`/bewerbungen?${abfrageParameter.toString()}`),
  })

  const { data: stellen } = useQuery({
    queryKey: ['stellen'],
    queryFn: () => api.get<Stelle[]>('/stellen'),
  })

  return (
    <Seite breit>
      <SeitenKopf
        titel={t('bewerbungen.titel')}
        beschreibung={data ? t('bewerbungen.treffer', { anzahl: data.gesamt }) : undefined}
        aktion={
          darfBearbeiten ? (
            <Button onClick={() => setNeuOffen(true)}>
              <Plus className="h-4 w-4" />
              {t('bewerbungen.neu')}
            </Button>
          ) : undefined
        }
      />

      <Karte className="mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <label className="feld-label" htmlFor="suche">
              {t('app.suchen')}
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="suche"
                className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                placeholder="Name, E-Mail, Betreff …"
                defaultValue={params.get('suche') ?? ''}
                onChange={(e) => {
                  const wert = e.target.value
                  window.clearTimeout((window as unknown as { _sucheTimer?: number })._sucheTimer)
                  ;(window as unknown as { _sucheTimer?: number })._sucheTimer = window.setTimeout(
                    () => setzeFilter('suche', wert),
                    300,
                  )
                }}
              />
            </div>
          </div>

          <Select
            label={t('bewerbungen.phase')}
            className="w-[11rem]"
            value={params.get('phase') ?? ''}
            onChange={(e) => setzeFilter('phase', e.target.value)}
          >
            <option value="">{t('bewerbungen.allePhasen')}</option>
            {PHASEN.map((p) => (
              <option key={p} value={p}>
                {t(`phasen.${p}`)}
              </option>
            ))}
          </Select>

          <Select
            label={t('bewerbungen.stelle')}
            className="w-[13rem]"
            value={params.get('stelle') ?? ''}
            onChange={(e) => setzeFilter('stelle', e.target.value)}
          >
            <option value="">{t('bewerbungen.alleStellen')}</option>
            {stellen?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </Select>

          <Select
            label={t('bewerbungen.quelle')}
            className="w-[11rem]"
            value={params.get('quelle') ?? ''}
            onChange={(e) => setzeFilter('quelle', e.target.value)}
          >
            <option value="">{t('bewerbungen.alleQuellen')}</option>
            {QUELLEN.map((q) => (
              <option key={q} value={q}>
                {t(`quellen.${q}`)}
              </option>
            ))}
          </Select>

          <Select
            label={t('bewerbungen.sortierung')}
            className="w-[11rem]"
            value={params.get('sortierung') ?? 'neueste'}
            onChange={(e) => setzeFilter('sortierung', e.target.value)}
          >
            <option value="neueste">{t('bewerbungen.sortNeueste')}</option>
            <option value="aelteste">{t('bewerbungen.sortAelteste')}</option>
            <option value="bewertung">{t('bewerbungen.sortBewertung')}</option>
            <option value="name">{t('bewerbungen.sortName')}</option>
          </Select>

          <div className="pb-2.5">
            <Checkbox
              label={t('bewerbungen.nurZuPruefen')}
              checked={params.get('nurZuPruefen') === 'true'}
              onChange={(e) => setzeFilter('nurZuPruefen', e.target.checked ? 'true' : '')}
            />
          </div>
        </div>
      </Karte>

      {isLoading ? (
        <LadeZustand />
      ) : !data || data.eintraege.length === 0 ? (
        <Karte>
          <LeerZustand
            icon={<FolderOpen className="h-10 w-10" />}
            titel={t('bewerbungen.keine')}
            beschreibung={t('bewerbungen.keineHinweis')}
          />
        </Karte>
      ) : (
        <Karte className="overflow-hidden">
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="tabelle">
              <thead>
                <tr>
                  <th>{t('nutzer.name')}</th>
                  <th>{t('bewerbungen.stelle')}</th>
                  <th>{t('bewerbungen.phase')}</th>
                  <th>{t('bewerbungen.bewertung')}</th>
                  <th>{t('bewerbungen.quelle')}</th>
                  <th>{t('bewerbungen.eingegangen')}</th>
                </tr>
              </thead>
              <tbody>
                {data.eintraege.map((b) => (
                  <tr key={b.id} className="cursor-pointer">
                    <td>
                      <Link to={`/bewerbungen/${b.id}`} className="block">
                        <div className="flex items-center gap-2 font-medium text-slate-900">
                          {vollerName(b.candidate)}
                          {b.needsReview && (
                            <Badge ton="gelb">{t('bewerbungen.zuPruefen')}</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          {b.candidate.email && <span>{b.candidate.email}</span>}
                          {(b._count?.documents ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-0.5">
                              <Paperclip className="h-3 w-3" />
                              {b._count?.documents}
                            </span>
                          )}
                          {(b._count?.notes ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-0.5">
                              <StickyNote className="h-3 w-3" />
                              {b._count?.notes}
                            </span>
                          )}
                        </div>
                      </Link>
                    </td>
                    <td>
                      <Link to={`/bewerbungen/${b.id}`} className="block">
                        {b.speculative ? (
                          <Badge ton="lila">{t('bewerbungen.initiativ')}</Badge>
                        ) : b.job ? (
                          b.job.title
                        ) : (
                          <span className="text-slate-400">{t('bewerbungen.ohneStelle')}</span>
                        )}
                      </Link>
                    </td>
                    <td>
                      <Link to={`/bewerbungen/${b.id}`} className="block">
                        <PhasenBadge phase={b.stage} />
                      </Link>
                    </td>
                    <td>
                      <Link to={`/bewerbungen/${b.id}`} className="block">
                        <BewertungAnzeige bewertung={b.bewertung} />
                      </Link>
                    </td>
                    <td>
                      <Link to={`/bewerbungen/${b.id}`} className="block">
                        <QuellenBadge quelle={b.source} />
                      </Link>
                    </td>
                    <td className="whitespace-nowrap text-slate-500">
                      <Link to={`/bewerbungen/${b.id}`} className="block">
                        {formatDatum(b.appliedAt)}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Karte>
      )}

      {data && data.gesamt > data.proSeite && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button
            variante="umriss"
            groesse="sm"
            disabled={data.seite <= 1}
            onClick={() => setzeFilter('seite', String(data.seite - 1))}
          >
            {t('app.zurueck')}
          </Button>
          <span className="text-sm text-slate-500">
            Seite {data.seite} von {Math.ceil(data.gesamt / data.proSeite)}
          </span>
          <Button
            variante="umriss"
            groesse="sm"
            disabled={data.seite * data.proSeite >= data.gesamt}
            onClick={() => setzeFilter('seite', String(data.seite + 1))}
          >
            {t('app.weiter')}
          </Button>
        </div>
      )}

      <NeueBewerbungDialog offen={neuOffen} onSchliessen={() => setNeuOffen(false)} stellen={stellen ?? []} />
    </Seite>
  )
}

function NeueBewerbungDialog({
  offen,
  onSchliessen,
  stellen,
}: {
  offen: boolean
  onSchliessen: () => void
  stellen: Stelle[]
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [f, setF] = useState({
    vorname: '',
    nachname: '',
    email: '',
    telefon: '',
    ort: '',
    stelleId: '',
    initiativ: false,
    quelle: 'MANUELL',
    notiz: '',
  })

  const setze = (feld: keyof typeof f, wert: string | boolean) => setF((alt) => ({ ...alt, [feld]: wert }))

  const anlegen = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/bewerbungen', {
        vorname: f.vorname,
        nachname: f.nachname,
        email: f.email || undefined,
        telefon: f.telefon || undefined,
        ort: f.ort || undefined,
        stelleId: f.initiativ || !f.stelleId ? null : f.stelleId,
        initiativ: f.initiativ,
        quelle: f.quelle,
        notiz: f.notiz || undefined,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bewerbungen'] })
      toast.erfolg('Die Bewerbung wurde angelegt. Dokumente lassen sich jetzt hinzufügen.')
      setF({
        vorname: '',
        nachname: '',
        email: '',
        telefon: '',
        ort: '',
        stelleId: '',
        initiativ: false,
        quelle: 'MANUELL',
        notiz: '',
      })
      onSchliessen()
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  return (
    <Dialog
      offen={offen}
      onSchliessen={onSchliessen}
      titel={t('bewerbungen.neu')}
      beschreibung={t('bewerbungen.neuHilfe')}
      fusszeile={
        <>
          <Button variante="umriss" onClick={onSchliessen}>
            {t('app.abbrechen')}
          </Button>
          <Button onClick={() => anlegen.mutate()} laedt={anlegen.isPending}>
            {t('app.anlegen')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Vorname" value={f.vorname} onChange={(e) => setze('vorname', e.target.value)} />
          <Input
            label="Nachname"
            value={f.nachname}
            onChange={(e) => setze('nachname', e.target.value)}
            pflicht
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="E-Mail"
            type="email"
            value={f.email}
            onChange={(e) => setze('email', e.target.value)}
          />
          <Input label="Telefon" value={f.telefon} onChange={(e) => setze('telefon', e.target.value)} />
        </div>
        <Input label="Ort" value={f.ort} onChange={(e) => setze('ort', e.target.value)} />

        <Checkbox
          label={t('stellen.initiativ')}
          checked={f.initiativ}
          onChange={(e) => setze('initiativ', e.target.checked)}
        />

        {!f.initiativ && (
          <Select
            label={t('bewerbungen.stelle')}
            value={f.stelleId}
            onChange={(e) => setze('stelleId', e.target.value)}
          >
            <option value="">{t('bewerbungen.ohneStelle')}</option>
            {stellen
              .filter((s) => !s.speculative)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
          </Select>
        )}

        <Select
          label={t('bewerbungen.quelle')}
          value={f.quelle}
          onChange={(e) => setze('quelle', e.target.value)}
        >
          {QUELLEN.map((q) => (
            <option key={q} value={q}>
              {t(`quellen.${q}`)}
            </option>
          ))}
        </Select>
      </div>
    </Dialog>
  )
}
