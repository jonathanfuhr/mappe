import clsx from 'clsx'
import { Star } from 'lucide-react'
import { Badge } from './ui'
import { t } from '../i18n'
import type { Bewertung, Kategorie, Phase, Quelle } from '../lib/typen'

/** Farbton je Phase – von „frisch eingegangen" bis „abgeschlossen". */
const PHASEN_TON: Record<Phase, 'grau' | 'blau' | 'gruen' | 'gelb' | 'rot' | 'lila'> = {
  NEU: 'blau',
  GESICHTET: 'blau',
  IN_PRUEFUNG: 'gelb',
  EINGELADEN: 'lila',
  GESPRAECH_GEFUEHRT: 'lila',
  ENTSCHEIDUNG: 'gelb',
  ZUSAGE: 'gruen',
  ABSAGE: 'rot',
  ARCHIV: 'grau',
}

export function PhasenBadge({ phase }: { phase: Phase }) {
  return <Badge ton={PHASEN_TON[phase]}>{t(`phasen.${phase}`)}</Badge>
}

export function QuellenBadge({ quelle }: { quelle: Quelle }) {
  return <Badge ton="grau">{t(`quellen.${quelle}`)}</Badge>
}

const KATEGORIE_FARBE: Record<Kategorie, string> = {
  ANSCHREIBEN: 'bg-violet-500',
  LEBENSLAUF: 'bg-sky-500',
  ZEUGNISSE: 'bg-emerald-500',
  ANDERE: 'bg-slate-400',
  ORIGINAL: 'bg-slate-300',
}

export function KategoriePunkt({ kategorie, className }: { kategorie: Kategorie; className?: string }) {
  return (
    <span
      className={clsx('inline-block h-2.5 w-2.5 shrink-0 rounded-full', KATEGORIE_FARBE[kategorie], className)}
      aria-hidden
    />
  )
}

export function KategorieBadge({ kategorie }: { kategorie: Kategorie }) {
  const ton = { ANSCHREIBEN: 'lila', LEBENSLAUF: 'blau', ZEUGNISSE: 'gruen', ANDERE: 'grau', ORIGINAL: 'grau' } as const
  return (
    <Badge ton={ton[kategorie]}>
      <KategoriePunkt kategorie={kategorie} />
      {t(`kategorien.${kategorie}`)}
    </Badge>
  )
}

/** Durchschnitt aller Bewerter, kompakt als Sternreihe. */
export function BewertungAnzeige({
  bewertung,
  groesse = 'sm',
}: {
  bewertung: Bewertung
  groesse?: 'sm' | 'md'
}) {
  if (bewertung.anzahl === 0) {
    return <span className="text-xs text-slate-400">–</span>
  }

  const sternGroesse = groesse === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'
  const schnitt = bewertung.schnitt ?? 0

  return (
    <span className="inline-flex items-center gap-1.5" title={`${schnitt} von 5 · ${bewertung.anzahl} Bewertung(en)`}>
      <span className="flex">
        {[1, 2, 3, 4, 5].map((stufe) => (
          <Star
            key={stufe}
            className={clsx(
              sternGroesse,
              stufe <= Math.round(schnitt) ? 'fill-amber-400 text-amber-400' : 'text-slate-300',
            )}
          />
        ))}
      </span>
      <span className={clsx('font-medium text-slate-700', groesse === 'md' ? 'text-sm' : 'text-xs')}>
        {schnitt.toFixed(1)}
      </span>
      <span className="text-xs text-slate-400">({bewertung.anzahl})</span>
    </span>
  )
}

export function UrteilVerteilung({ bewertung }: { bewertung: Bewertung }) {
  if (bewertung.anzahl === 0) return null
  return (
    <span className="inline-flex gap-1 text-xs">
      {bewertung.ja > 0 && <Badge ton="gruen">{bewertung.ja}× Ja</Badge>}
      {bewertung.vielleicht > 0 && <Badge ton="gelb">{bewertung.vielleicht}× Vielleicht</Badge>}
      {bewertung.nein > 0 && <Badge ton="rot">{bewertung.nein}× Nein</Badge>}
    </span>
  )
}
