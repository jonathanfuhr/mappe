import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { t } from '../i18n'
import { api, ApiError } from '../lib/api'
import { Button, Checkbox, Input, Karte, LadeZustand, Select } from './ui'
import { useToast } from './Toast'

/**
 * Die beiden Aufbewahrungsfristen als Einstellung.
 *
 * Eigene Komponente, weil die Fristen in die Einstellungen gehören – dort
 * sucht man sie. Auf der Aufbewahrungsseite bleibt das Operative: was fällig
 * ist und der Löschlauf selbst.
 */

export interface Fristen {
  bewerbungAktiv: boolean
  bewerbungMonate: number
  personAktiv: boolean
  personMonate: number
  modus: 'erinnern' | 'loeschen'
}

export function FristenEinstellungen() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [entwurf, setEntwurf] = useState<Partial<Fristen>>({})

  const { data: fristen } = useQuery({
    queryKey: ['einstellungen', 'fristen'],
    queryFn: () => api.get<Fristen>('/einstellungen/fristen'),
  })

  const speichern = useMutation({
    mutationFn: () => api.put('/einstellungen/fristen', entwurf),
    onSuccess: async () => {
      setEntwurf({})
      await queryClient.invalidateQueries({ queryKey: ['einstellungen', 'fristen'] })
      await queryClient.invalidateQueries({ queryKey: ['aufbewahrung'] })
      toast.erfolg(t('app.gespeichert'))
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  if (!fristen) return <LadeZustand />

  const wert = { ...fristen, ...entwurf }
  const geaendert = Object.keys(entwurf).length > 0
  const setze = <K extends keyof Fristen>(feld: K, neu: Fristen[K]) =>
    setEntwurf((e) => ({ ...e, [feld]: neu }))

  return (
    <Karte titel={t('aufbewahrung.titel')} beschreibung={t('aufbewahrung.erklaerung')}>
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

        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
          {t('aufbewahrung.zusagenHinweis')}
        </p>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Button onClick={() => speichern.mutate()} laedt={speichern.isPending} disabled={!geaendert}>
          {t('app.speichern')}
        </Button>
        {geaendert && <span className="text-sm text-slate-500">{t('aufbewahrung.ungespeichert')}</span>}
      </div>
    </Karte>
  )
}
