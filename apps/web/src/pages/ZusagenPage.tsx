import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Seite, SeitenKopf } from '../components/Layout'
import { Badge, Karte, LadeZustand, LeerZustand } from '../components/ui'
import { formatDatum, t } from '../i18n'
import { api } from '../lib/api'
import { vollerName, type BewerbungKurz } from '../lib/typen'

/**
 * Die Zusagen – wer aus dem Verfahren in die Belegschaft gewechselt ist.
 *
 * Eigene Seite statt eines Filters auf der Bewerbungsliste, weil hier etwas
 * anderes gilt als überall sonst: Diese Datensätze laufen nicht ab. Mit dem
 * Arbeitsvertrag wechselt der Zweck von der Bewerberauswahl zur Personalakte,
 * und die ist aufbewahrungspflichtig statt löschpflichtig (siehe
 * `retention/service.ts`). Das gehört sichtbar an eine eigene Stelle, sonst
 * verschwinden die Eingestellten zwischen den Absagen.
 */

interface Listenantwort {
  eintraege: BewerbungKurz[]
  gesamt: number
}

export function ZusagenPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['zusagen'],
    queryFn: () => api.get<Listenantwort>('/bewerbungen?phase=ZUSAGE&sortierung=neueste&proSeite=200'),
  })

  const eintraege = data?.eintraege ?? []

  return (
    <Seite>
      <SeitenKopf
        titel={t('zusagen.titel')}
        beschreibung={t('zusagen.beschreibung')}
        aktion={
          eintraege.length > 0 ? (
            <Badge ton="gruen">{t('zusagen.anzahl', { n: data?.gesamt ?? eintraege.length })}</Badge>
          ) : undefined
        }
      />

      <div className="mb-6 flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p>{t('zusagen.erklaerung')}</p>
      </div>

      {isLoading ? (
        <LadeZustand />
      ) : eintraege.length === 0 ? (
        <LeerZustand
          titel={t('zusagen.leerTitel')}
          beschreibung={t('zusagen.leerText')}
          icon={<BadgeCheck className="h-6 w-6" />}
        />
      ) : (
        <Karte>
          <ul className="divide-y divide-slate-100">
            {eintraege.map((eintrag) => (
              <li key={eintrag.id}>
                <Link
                  to={`/bewerbungen/${eintrag.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 transition hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {vollerName(eintrag.candidate)}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {eintrag.job?.title ?? t('zusagen.ohneStelle')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span>
                      {t('zusagen.seit')} {formatDatum(eintrag.stageChangedAt)}
                    </span>
                    <Badge ton="gruen">{t('zusagen.geschuetzt')}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Karte>
      )}
    </Seite>
  )
}
