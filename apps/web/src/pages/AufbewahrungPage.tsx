import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Seite, SeitenKopf } from '../components/Layout'
import { useToast } from '../components/Toast'
import {
  Badge,
  BestaetigenDialog,
  Button,
  Checkbox,
  Hinweis,
  Input,
  Karte,
  LadeZustand,
  Select,
} from '../components/ui'
import { formatDatum, t } from '../i18n'
import { api, ApiError } from '../lib/api'

interface Stand {
  modus: 'erinnern' | 'loeschen'
  bewerbungen: { aktiv: boolean; monate: number; faellig: number; demnaechst: number }
  personen: { aktiv: boolean; monate: number; faellig: number; demnaechst: number }
  zurueckgestellt: number
}

interface Faellig {
  id: string
  art: 'bewerbung' | 'person'
  name: string
  zusatz: string
  faelligSeit: string
}

interface Fristen {
  bewerbungAktiv: boolean
  bewerbungMonate: number
  personAktiv: boolean
  personMonate: number
  modus: 'erinnern' | 'loeschen'
}

export function AufbewahrungPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [entwurf, setEntwurf] = useState<Partial<Fristen>>({})
  const [loeschenOffen, setLoeschenOffen] = useState(false)

  const { data: stand, isLoading } = useQuery({
    queryKey: ['aufbewahrung'],
    queryFn: () => api.get<Stand>('/aufbewahrung'),
  })

  const { data: fristen } = useQuery({
    queryKey: ['einstellungen', 'fristen'],
    queryFn: () => api.get<Fristen>('/einstellungen/fristen'),
  })

  const { data: faellige } = useQuery({
    queryKey: ['aufbewahrung', 'faellig'],
    queryFn: () => api.get<Faellig[]>('/aufbewahrung/faellig'),
  })

  const wert = { ...(fristen as Fristen), ...entwurf }
  const geaendert = Object.keys(entwurf).length > 0
  const setze = <K extends keyof Fristen>(feld: K, neu: Fristen[K]) =>
    setEntwurf((e) => ({ ...e, [feld]: neu }))

  const speichern = useMutation({
    mutationFn: () => api.put('/einstellungen/fristen', entwurf),
    onSuccess: async () => {
      setEntwurf({})
      await queryClient.invalidateQueries({ queryKey: ['aufbewahrung'] })
      await queryClient.invalidateQueries({ queryKey: ['einstellungen'] })
      toast.erfolg(t('app.gespeichert'))
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const loeschen = useMutation({
    mutationFn: () =>
      api.post<{ bewerbungen: number; personen: number; dateien: number }>('/aufbewahrung/loeschen'),
    onSuccess: async (bericht) => {
      setLoeschenOffen(false)
      await queryClient.invalidateQueries({ queryKey: ['aufbewahrung'] })
      await queryClient.invalidateQueries({ queryKey: ['bewerbungen'] })
      toast.erfolg(t('aufbewahrung.gelöscht', bericht))
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  if (isLoading || !fristen) return <Seite><LadeZustand /></Seite>

  const faelligGesamt = (stand?.bewerbungen.faellig ?? 0) + (stand?.personen.faellig ?? 0)

  return (
    <Seite>
      <SeitenKopf titel={t('aufbewahrung.titel')} beschreibung={t('aufbewahrung.beschreibung')} />

      <div className="space-y-6">
        <Hinweis ton="info">{t('aufbewahrung.erklaerung')}</Hinweis>

        <div className="grid gap-4 sm:grid-cols-3">
          <Kennzahl titel={t('aufbewahrung.faellig')} wert={faelligGesamt} hervorheben={faelligGesamt > 0} />
          <Kennzahl
            titel={t('aufbewahrung.demnaechst')}
            wert={(stand?.bewerbungen.demnaechst ?? 0) + (stand?.personen.demnaechst ?? 0)}
          />
          <Kennzahl titel={t('aufbewahrung.zurueckgestellt')} wert={stand?.zurueckgestellt ?? 0} />
        </div>

        <Karte titel="Fristen">
          <div className="max-w-xl space-y-5">
            <div className="space-y-3">
              <Checkbox
                label={t('aufbewahrung.bewerbungAktiv')}
                checked={wert.bewerbungAktiv}
                onChange={(e) => setze('bewerbungAktiv', e.target.checked)}
              />
              {wert.bewerbungAktiv && (
                <Input
                  type="number"
                  min={1}
                  max={120}
                  label={t('aufbewahrung.bewerbungMonate')}
                  hilfe={t('aufbewahrung.sechsMonateHinweis')}
                  value={wert.bewerbungMonate}
                  onChange={(e) => setze('bewerbungMonate', Number(e.target.value))}
                  className="max-w-[14rem]"
                />
              )}
            </div>

            <div className="space-y-3 border-t border-slate-100 pt-5">
              <Checkbox
                label={t('aufbewahrung.personAktiv')}
                checked={wert.personAktiv}
                onChange={(e) => setze('personAktiv', e.target.checked)}
              />
              {wert.personAktiv && (
                <Input
                  type="number"
                  min={1}
                  max={120}
                  label={t('aufbewahrung.personMonate')}
                  value={wert.personMonate}
                  onChange={(e) => setze('personMonate', Number(e.target.value))}
                  className="max-w-[14rem]"
                />
              )}
            </div>

            <div className="border-t border-slate-100 pt-5">
              <Select
                label={t('aufbewahrung.modus')}
                hilfe={t('aufbewahrung.modusHilfe')}
                value={wert.modus}
                onChange={(e) => setze('modus', e.target.value as 'erinnern' | 'loeschen')}
                className="max-w-sm"
              >
                <option value="erinnern">{t('aufbewahrung.modusErinnern')}</option>
                <option value="loeschen">{t('aufbewahrung.modusLoeschen')}</option>
              </Select>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Button onClick={() => speichern.mutate()} laedt={speichern.isPending} disabled={!geaendert}>
              {t('app.speichern')}
            </Button>
            {geaendert && (
              <span className="text-sm text-slate-500">Es liegen ungespeicherte Änderungen vor.</span>
            )}
          </div>
        </Karte>

        <Karte
          titel={t('aufbewahrung.faellig')}
          aktion={
            faelligGesamt > 0 ? (
              <Button variante="gefahr" onClick={() => setLoeschenOffen(true)}>
                <Trash2 className="h-4 w-4" />
                {t('aufbewahrung.jetztLoeschen')}
              </Button>
            ) : undefined
          }
        >
          {!faellige || faellige.length === 0 ? (
            <p className="flex items-center gap-2 py-2 text-sm text-slate-500">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              {t('aufbewahrung.nichtsFaellig')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {faellige.map((f) => (
                <li key={`${f.art}-${f.id}`} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <Badge ton={f.art === 'person' ? 'lila' : 'blau'}>
                    {f.art === 'person' ? 'Person' : 'Bewerbung'}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{f.name}</span>
                    {f.zusatz && <span className="block truncate text-xs text-slate-500">{f.zusatz}</span>}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">
                    {t('aufbewahrung.faelligSeit')} {formatDatum(f.faelligSeit)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Karte>
      </div>

      <BestaetigenDialog
        offen={loeschenOffen}
        onSchliessen={() => setLoeschenOffen(false)}
        onBestaetigen={() => loeschen.mutate()}
        laedt={loeschen.isPending}
        titel={t('aufbewahrung.loeschenFrage')}
        text={
          <>
            {t('aufbewahrung.loeschenText', {
              bewerbungen: stand?.bewerbungen.faellig ?? 0,
              personen: stand?.personen.faellig ?? 0,
            })}{' '}
            {t('app.nichtRueckgaengig')}
          </>
        }
      />
    </Seite>
  )
}

function Kennzahl({ titel, wert, hervorheben }: { titel: string; wert: number; hervorheben?: boolean }) {
  return (
    <div className="karte p-5">
      <span
        className={
          hervorheben
            ? 'block text-2xl font-semibold tracking-tight text-amber-600'
            : 'block text-2xl font-semibold tracking-tight text-slate-900'
        }
      >
        {wert}
      </span>
      <span className="mt-0.5 block text-sm text-slate-500">{titel}</span>
    </div>
  )
}
