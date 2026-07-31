import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Briefcase, FolderOpen, Inbox } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PhasenBadge, QuellenBadge } from '../components/Anzeigen'
import { Seite, SeitenKopf } from '../components/Layout'
import { Badge, Karte, LadeZustand, LeerZustand } from '../components/ui'
import { formatRelativ, t } from '../i18n'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { PHASEN, vollerName, type Uebersicht } from '../lib/typen'

export function UebersichtPage() {
  const { nutzer, darfBearbeiten } = useAuth()

  const { data, isLoading } = useQuery({
    queryKey: ['uebersicht'],
    queryFn: () => api.get<Uebersicht>('/uebersicht'),
  })

  if (isLoading) return <Seite><LadeZustand /></Seite>

  const laufendePhasen = PHASEN.filter((p) => !['ZUSAGE', 'ABSAGE', 'ARCHIV'].includes(p))

  return (
    <Seite breit>
      <SeitenKopf titel={`Guten Tag, ${nutzer?.name.split(' ')[0] ?? ''}`} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kennzahl
          titel="Laufende Verfahren"
          wert={data?.laufend ?? 0}
          icon={<FolderOpen className="h-5 w-5" />}
          ziel="/bewerbungen"
        />
        <Kennzahl
          titel={t('bewerbungen.zuPruefen')}
          wert={data?.zuPruefen ?? 0}
          icon={<AlertCircle className="h-5 w-5" />}
          ziel="/bewerbungen?nurZuPruefen=true"
          hervorheben={(data?.zuPruefen ?? 0) > 0}
        />
        {darfBearbeiten && (
          <Kennzahl
            titel="Offene Stellen"
            wert={data?.offeneStellen ?? 0}
            icon={<Briefcase className="h-5 w-5" />}
            ziel="/stellen"
          />
        )}
        <Kennzahl
          titel="Bewerbungen gesamt"
          wert={data?.gesamt ?? 0}
          icon={<Inbox className="h-5 w-5" />}
          ziel="/bewerbungen"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Karte titel="Zuletzt eingegangen">
          {!data || data.letzte.length === 0 ? (
            <LeerZustand
              titel={t('bewerbungen.keine')}
              beschreibung={t('bewerbungen.keineHinweis')}
              icon={<Inbox className="h-9 w-9" />}
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.letzte.map((b) => (
                <li key={b.id}>
                  <Link
                    to={`/bewerbungen/${b.id}`}
                    className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-slate-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-900">
                          {vollerName(b.candidate)}
                        </span>
                        {b.needsReview && <Badge ton="gelb">{t('bewerbungen.zuPruefen')}</Badge>}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {b.job?.title ?? t('bewerbungen.ohneStelle')}
                      </span>
                    </span>
                    <QuellenBadge quelle={b.source} />
                    <PhasenBadge phase={b.stage} />
                    <span className="w-24 shrink-0 text-right text-xs text-slate-400">
                      {formatRelativ(b.appliedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Karte>

        <Karte titel="Verteilung">
          <ul className="space-y-2">
            {laufendePhasen.map((phase) => {
              const anzahl = data?.phasen[phase] ?? 0
              const anteil = data?.laufend ? Math.round((anzahl / data.laufend) * 100) : 0
              return (
                <li key={phase}>
                  <Link
                    to={`/bewerbungen?phase=${phase}`}
                    className="-mx-2 block rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-50"
                  >
                    <span className="flex items-baseline justify-between text-sm">
                      <span className="text-slate-700">{t(`phasen.${phase}`)}</span>
                      <span className="font-medium text-slate-900">{anzahl}</span>
                    </span>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <span
                        className="block h-full rounded-full bg-brand-500 transition-[width]"
                        style={{ width: `${anteil}%` }}
                      />
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </Karte>
      </div>
    </Seite>
  )
}

function Kennzahl({
  titel,
  wert,
  icon,
  ziel,
  hervorheben,
}: {
  titel: string
  wert: number
  icon: ReactNode
  ziel: string
  hervorheben?: boolean
}) {
  return (
    <Link
      to={ziel}
      className="karte flex items-center gap-4 p-5 transition-shadow hover:shadow-md"
    >
      <span
        className={
          hervorheben
            ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600'
            : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500'
        }
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-semibold tracking-tight text-slate-900">{wert}</span>
        <span className="block truncate text-sm text-slate-500">{titel}</span>
      </span>
    </Link>
  )
}
