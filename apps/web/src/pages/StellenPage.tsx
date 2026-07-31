import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Briefcase, Plus } from 'lucide-react'
import { useState } from 'react'
import { Seite, SeitenKopf } from '../components/Layout'
import { useToast } from '../components/Toast'
import {
  Badge,
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
import { formatDatum, t } from '../i18n'
import { api, ApiError } from '../lib/api'
import type { Stelle, StellenStatus } from '../lib/typen'

export function StellenPage() {
  const queryClient = useQueryClient()
  const [dialogOffen, setDialogOffen] = useState(false)
  const [bearbeitet, setBearbeitet] = useState<Stelle | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['stellen'],
    queryFn: () => api.get<Stelle[]>('/stellen'),
  })

  const oeffneNeu = () => {
    setBearbeitet(null)
    setDialogOffen(true)
  }

  return (
    <Seite>
      <SeitenKopf
        titel={t('stellen.titel')}
        beschreibung={t('stellen.beschreibung')}
        aktion={
          <Button onClick={oeffneNeu}>
            <Plus className="h-4 w-4" />
            {t('stellen.neu')}
          </Button>
        }
      />

      {isLoading ? (
        <LadeZustand />
      ) : !data || data.length === 0 ? (
        <Karte>
          <LeerZustand
            icon={<Briefcase className="h-10 w-10" />}
            titel={t('stellen.keine')}
            beschreibung={t('stellen.keineHinweis')}
            aktion={<Button onClick={oeffneNeu}>{t('stellen.neu')}</Button>}
          />
        </Karte>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((stelle) => (
            <button
              key={stelle.id}
              type="button"
              onClick={() => {
                setBearbeitet(stelle)
                setDialogOffen(true)
              }}
              className="karte flex flex-col p-5 text-left transition-shadow hover:shadow-md"
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <h3 className="min-w-0 font-semibold text-slate-900">{stelle.title}</h3>
                <StatusBadge status={stelle.status} initiativ={stelle.speculative} />
              </div>

              <div className="mb-3 space-y-0.5 text-sm text-slate-500">
                {stelle.reference && <div>{stelle.reference}</div>}
                {[stelle.department, stelle.location, stelle.employment].filter(Boolean).join(' · ') || null}
              </div>

              {stelle.keywords.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1">
                  {stelle.keywords.slice(0, 5).map((k) => (
                    <Badge key={k} ton="grau">
                      {k}
                    </Badge>
                  ))}
                  {stelle.keywords.length > 5 && (
                    <Badge ton="grau">+{stelle.keywords.length - 5}</Badge>
                  )}
                </div>
              )}

              <div className="mt-auto flex items-baseline gap-4 border-t border-slate-100 pt-3 text-sm">
                <span>
                  <strong className="text-slate-900">{stelle.bewerbungenOffen ?? 0}</strong>{' '}
                  <span className="text-slate-500">{t('stellen.offen')}</span>
                </span>
                <span className="text-slate-500">
                  {stelle.bewerbungenGesamt ?? 0} {t('stellen.bewerbungen')}
                </span>
                <span className="ml-auto text-xs text-slate-400">{formatDatum(stelle.openedAt)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <StellenDialog
        offen={dialogOffen}
        stelle={bearbeitet}
        onSchliessen={() => setDialogOffen(false)}
        onGespeichert={async () => {
          setDialogOffen(false)
          await queryClient.invalidateQueries({ queryKey: ['stellen'] })
        }}
      />
    </Seite>
  )
}

function StatusBadge({ status, initiativ }: { status: StellenStatus; initiativ: boolean }) {
  if (initiativ) return <Badge ton="lila">{t('bewerbungen.initiativ')}</Badge>
  const ton = status === 'OFFEN' ? 'gruen' : status === 'ENTWURF' ? 'gelb' : 'grau'
  return <Badge ton={ton}>{t(`stellenStatus.${status}`)}</Badge>
}

function StellenDialog({
  offen,
  stelle,
  onSchliessen,
  onGespeichert,
}: {
  offen: boolean
  stelle: Stelle | null
  onSchliessen: () => void
  onGespeichert: () => void
}) {
  const toast = useToast()
  const [formular, setFormular] = useState<Partial<Stelle>>({})
  const [initialisiertFuer, setInitialisiertFuer] = useState<string | null>(null)
  const [stichworteText, setStichworteText] = useState('')

  const schluessel = offen ? (stelle?.id ?? 'neu') : null
  if (schluessel !== initialisiertFuer) {
    setInitialisiertFuer(schluessel)
    setFormular(
      stelle ?? { title: '', description: '', status: 'OFFEN', speculative: false, keywords: [] },
    )
    setStichworteText((stelle?.keywords ?? []).join(', '))
  }

  const setze = <K extends keyof Stelle>(feld: K, wert: Stelle[K]) =>
    setFormular((f) => ({ ...f, [feld]: wert }))

  const speichern = useMutation({
    mutationFn: () => {
      const nutzlast = {
        title: formular.title,
        reference: formular.reference || null,
        location: formular.location || null,
        department: formular.department || null,
        employment: formular.employment || null,
        description: formular.description ?? '',
        status: formular.status,
        speculative: formular.speculative ?? false,
        keywords: stichworteText
          .split(',')
          .map((k) => k.trim())
          .filter((k) => k.length >= 2),
      }
      return stelle ? api.patch(`/stellen/${stelle.id}`, nutzlast) : api.post('/stellen', nutzlast)
    },
    onSuccess: () => {
      toast.erfolg(t('app.gespeichert'))
      onGespeichert()
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const loeschen = useMutation({
    mutationFn: () => api.delete(`/stellen/${stelle!.id}`),
    onSuccess: () => {
      toast.erfolg('Die Stelle wurde gelöscht.')
      onGespeichert()
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  return (
    <Dialog
      offen={offen}
      onSchliessen={onSchliessen}
      titel={stelle ? stelle.title : t('stellen.neu')}
      breite="lg"
      fusszeile={
        <>
          {stelle && (
            <Button
              variante="still"
              className="mr-auto text-red-600"
              onClick={() => loeschen.mutate()}
              laedt={loeschen.isPending}
            >
              {t('app.loeschen')}
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
      <div className="space-y-4">
        <Input
          label={t('stellen.stellentitel')}
          value={formular.title ?? ''}
          onChange={(e) => setze('title', e.target.value)}
          pflicht
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t('stellen.referenz')}
            hilfe={t('stellen.referenzHilfe')}
            value={formular.reference ?? ''}
            onChange={(e) => setze('reference', e.target.value)}
            placeholder="MG-2025-04"
          />
          <Select
            label={t('nutzer.status')}
            value={formular.status ?? 'OFFEN'}
            onChange={(e) => setze('status', e.target.value as StellenStatus)}
          >
            {(['ENTWURF', 'OFFEN', 'GESCHLOSSEN'] as StellenStatus[]).map((s) => (
              <option key={s} value={s}>
                {t(`stellenStatus.${s}`)}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label={t('stellen.abteilung')}
            value={formular.department ?? ''}
            onChange={(e) => setze('department', e.target.value)}
          />
          <Input
            label={t('stellen.ort')}
            value={formular.location ?? ''}
            onChange={(e) => setze('location', e.target.value)}
          />
          <Input
            label={t('stellen.umfang')}
            value={formular.employment ?? ''}
            onChange={(e) => setze('employment', e.target.value)}
            placeholder="Vollzeit"
          />
        </div>

        <Input
          label={t('stellen.stichworte')}
          hilfe={t('stellen.stichworteHilfe')}
          value={stichworteText}
          onChange={(e) => setStichworteText(e.target.value)}
          placeholder="gestaltung, indesign, mediengestalter"
        />

        <Textarea
          label={t('stellen.beschreibungFeld')}
          hilfe={t('stellen.beschreibungHilfe')}
          rows={10}
          value={formular.description ?? ''}
          onChange={(e) => setze('description', e.target.value)}
        />

        <Checkbox
          label={t('stellen.initiativ')}
          hilfe={t('stellen.initiativHilfe')}
          checked={formular.speculative ?? false}
          onChange={(e) => setze('speculative', e.target.checked)}
        />

        {stelle && (stelle.bewerbungenGesamt ?? 0) > 0 && (
          <Hinweis ton="info">
            An dieser Stelle hängen {stelle.bewerbungenGesamt} Bewerbung(en). Zum Beenden der
            Ausschreibung den Status auf „Geschlossen" setzen – die Beschreibung bleibt dann für eine
            erneute Ausschreibung erhalten.
          </Hinweis>
        )}
      </div>
    </Dialog>
  )
}
