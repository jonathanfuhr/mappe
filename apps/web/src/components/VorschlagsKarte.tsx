import { useMutation } from '@tanstack/react-query'
import clsx from 'clsx'
import { CheckCircle2, Forward, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { t } from '../i18n'
import { api, ApiError } from '../lib/api'
import type { Bewerbung, Stelle, Vorschlag } from '../lib/typen'
import { Badge, Button, Checkbox } from './ui'
import { useToast } from './Toast'

/**
 * Zeigt, was automatisch erkannt wurde – und lässt es feldweise bestätigen.
 *
 * Bewusst nicht „alles übernehmen": Wer eine Angabe schon von Hand korrigiert
 * hat, soll sie nicht durch einen Klick wieder verlieren. Deshalb steht neben
 * jedem Vorschlag der bisherige Wert.
 */

const FELDER: { schluessel: string; label: string }[] = [
  { schluessel: 'anrede', label: 'Anrede' },
  { schluessel: 'titel', label: 'Titel' },
  { schluessel: 'vorname', label: 'Vorname' },
  { schluessel: 'nachname', label: 'Nachname' },
  { schluessel: 'email', label: 'E-Mail' },
  { schluessel: 'telefon', label: 'Telefon' },
  { schluessel: 'strasse', label: 'Straße' },
  { schluessel: 'plz', label: 'PLZ' },
  { schluessel: 'ort', label: 'Ort' },
]

export function VorschlagsKarte({
  bewerbung,
  stellen,
  onBestaetigen,
  onGeaendert,
  laedtBestaetigen,
}: {
  bewerbung: Bewerbung
  stellen: Stelle[]
  onBestaetigen: () => void
  onGeaendert: () => Promise<void>
  laedtBestaetigen: boolean
}) {
  const toast = useToast()
  const vorschlag: Vorschlag | undefined = bewerbung.suggestions[0]
  const [ausgewaehlt, setAusgewaehlt] = useState<string[]>([])

  const uebernehmen = useMutation({
    mutationFn: () => api.post(`/ki/vorschlag/${vorschlag!.id}/uebernehmen`, { felder: ausgewaehlt }),
    onSuccess: async () => {
      setAusgewaehlt([])
      await onGeaendert()
      toast.erfolg('Die ausgewählten Angaben wurden übernommen.')
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const verwerfen = useMutation({
    mutationFn: () => api.post(`/ki/vorschlag/${vorschlag!.id}/verwerfen`),
    onSuccess: onGeaendert,
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  if (!vorschlag) return null

  const daten = (vorschlag.payload.bewerber ?? {}) as Record<string, unknown>
  const weiterleitung = vorschlag.payload.weiterleitung
  const zuordnung = vorschlag.payload.stelle
  // Ein Phasenvorschlag zählt nur, solange er von der aktuellen Phase abweicht.
  const phasenVorschlag = vorschlag.payload.phase?.phase ?? null
  const phaseAbweichend = Boolean(phasenVorschlag && phasenVorschlag !== bewerbung.stage)
  const bewerber = bewerbung.candidate as unknown as Record<string, unknown>

  const abbildung: Record<string, keyof typeof bewerber> = {
    anrede: 'salutation',
    titel: 'title',
    vorname: 'firstName',
    nachname: 'lastName',
    email: 'email',
    telefon: 'phone',
    strasse: 'street',
    plz: 'postalCode',
    ort: 'city',
  }

  // Nur Felder anbieten, für die es einen Vorschlag gibt, der sich vom
  // bisherigen Wert unterscheidet – alles andere wäre Klickarbeit ohne Wirkung.
  const abweichende = FELDER.filter((f) => {
    const neu = daten[f.schluessel]
    if (neu === undefined || neu === null || neu === '') return false
    const alt = bewerber[abbildung[f.schluessel]]
    return String(neu) !== String(alt ?? '')
  })

  const stelleAbweichend =
    zuordnung &&
    (zuordnung.jobId !== (bewerbung.job?.id ?? null) || zuordnung.initiativ !== bewerbung.speculative)

  const vonKi = vorschlag.source === 'KI'

  return (
    <div
      className={clsx(
        'mb-6 rounded-xl border p-5',
        vonKi ? 'border-violet-200 bg-violet-50' : 'border-amber-200 bg-amber-50',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2
            className={clsx(
              'flex items-center gap-1.5 text-sm font-semibold',
              vonKi ? 'text-violet-900' : 'text-amber-900',
            )}
          >
            {vonKi && <Sparkles className="h-4 w-4" />}
            {t('bewerbungen.erkannteAngaben')}
          </h2>
          <p className={clsx('mt-0.5 text-sm', vonKi ? 'text-violet-800' : 'text-amber-800')}>
            {vonKi ? t('bewerbungen.erkanntDurchKi') : t('bewerbungen.erkanntDurchRegeln')}
            {vorschlag.model ? ` · ${vorschlag.model}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {vonKi && (
            <Button variante="still" onClick={() => verwerfen.mutate()} laedt={verwerfen.isPending}>
              <X className="h-4 w-4" />
              {t('ki.vorschlagVerwerfen')}
            </Button>
          )}
          <Button onClick={onBestaetigen} laedt={laedtBestaetigen}>
            <CheckCircle2 className="h-4 w-4" />
            {t('bewerbungen.geprueft')}
          </Button>
        </div>
      </div>

      <div className={clsx('mt-4 space-y-2 text-sm', vonKi ? 'text-violet-900' : 'text-amber-900')}>
        {weiterleitung?.erkannt && weiterleitung.urspruenglicherAbsender && (
          <div className="flex items-start gap-2">
            <Forward className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {t('bewerbungen.weitergeleitet', { adresse: weiterleitung.vonZeile?.email ?? '–' })} —{' '}
              {t('bewerbungen.urspruenglicherAbsender')}:{' '}
              <strong>{weiterleitung.urspruenglicherAbsender.email}</strong>
            </span>
          </div>
        )}
        {zuordnung && (
          <div>
            {t('bewerbungen.zuordnung')}: {zuordnung.begruendung} ({t('bewerbungen.sicherheit')}{' '}
            {Math.round(zuordnung.sicherheit * 100)} %)
          </div>
        )}
      </div>

      {(abweichende.length > 0 || stelleAbweichend || phaseAbweichend) && (
        <div className="mt-4 rounded-lg border border-white/70 bg-white/70 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Vorgeschlagene Änderungen
          </p>

          <ul className="space-y-2">
            {phaseAbweichend && phasenVorschlag && (
              <li>
                <Checkbox
                  label={`${t('bewerbungen.phase')}: ${t(`phasen.${phasenVorschlag}`)}`}
                  hilfe={
                    <>
                      {t('ki.aktuellerWert')}: {t(`phasen.${bewerbung.stage}`)}
                      {vorschlag.payload.phase?.begruendung
                        ? ` · ${vorschlag.payload.phase.begruendung}`
                        : ''}
                    </>
                  }
                  checked={ausgewaehlt.includes('phase')}
                  onChange={(e) =>
                    setAusgewaehlt((alt) =>
                      e.target.checked ? [...alt, 'phase'] : alt.filter((f) => f !== 'phase'),
                    )
                  }
                />
              </li>
            )}

            {stelleAbweichend && zuordnung && (
              <li>
                <Checkbox
                  label={`Stelle: ${
                    zuordnung.initiativ
                      ? t('bewerbungen.initiativ')
                      : (stellen.find((s) => s.id === zuordnung.jobId)?.title ??
                        t('bewerbungen.ohneStelle'))
                  }`}
                  hilfe={
                    <>
                      {t('ki.aktuellerWert')}:{' '}
                      {bewerbung.speculative
                        ? t('bewerbungen.initiativ')
                        : (bewerbung.job?.title ?? t('ki.keinWert'))}
                    </>
                  }
                  checked={ausgewaehlt.includes('stelle')}
                  onChange={(e) =>
                    setAusgewaehlt((alt) =>
                      e.target.checked ? [...alt, 'stelle'] : alt.filter((f) => f !== 'stelle'),
                    )
                  }
                />
              </li>
            )}

            {abweichende.map((feld) => (
              <li key={feld.schluessel}>
                <Checkbox
                  label={`${feld.label}: ${String(daten[feld.schluessel])}`}
                  hilfe={
                    <>
                      {t('ki.aktuellerWert')}:{' '}
                      {String(bewerber[abbildung[feld.schluessel]] ?? '') || t('ki.keinWert')}
                    </>
                  }
                  checked={ausgewaehlt.includes(feld.schluessel)}
                  onChange={(e) =>
                    setAusgewaehlt((alt) =>
                      e.target.checked
                        ? [...alt, feld.schluessel]
                        : alt.filter((f) => f !== feld.schluessel),
                    )
                  }
                />
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              groesse="sm"
              onClick={() => uebernehmen.mutate()}
              laedt={uebernehmen.isPending}
              disabled={ausgewaehlt.length === 0}
            >
              {t('ki.vorschlagUebernehmen')}
            </Button>
            <Button
              variante="still"
              groesse="sm"
              onClick={() =>
                setAusgewaehlt([
                  ...(stelleAbweichend ? ['stelle'] : []),
                  ...(phaseAbweichend ? ['phase'] : []),
                  ...abweichende.map((f) => f.schluessel),
                ])
              }
            >
              Alle auswählen
            </Button>
          </div>
        </div>
      )}

      {Array.isArray((vorschlag.payload as { schlagworte?: string[] }).schlagworte) &&
        (vorschlag.payload as { schlagworte: string[] }).schlagworte.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-slate-500">Profil:</span>
            {(vorschlag.payload as { schlagworte: string[] }).schlagworte.map((s) => (
              <Badge key={s} ton="lila">
                {s}
              </Badge>
            ))}
          </div>
        )}
    </div>
  )
}
