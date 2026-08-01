import { useQuery } from '@tanstack/react-query'
import {
  CheckCircle2,
  FileText,
  Inbox,
  LockOpen,
  MailCheck,
  MessageSquare,
  Star,
  StickyNote,
  UserPlus,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { formatDatumZeit, t } from '../i18n'
import { api } from '../lib/api'
import { Karte, LadeZustand } from './ui'

/**
 * Die Historie einer Bewerbung als Zeitachse.
 *
 * Bewusst getrennt vom Protokoll: Hier steht, was fachlich passiert ist, in der
 * Sprache der Sache – „Phase von Neu auf Gesichtet", nicht „PATCH
 * /bewerbungen/…". Der Zweck ist Nachvollziehbarkeit im Alltag und bei
 * Rückfragen: wer hat wann was getan.
 *
 * Die Mail-Ereignisse filtert bereits die API für Interviewer heraus – hier
 * wird nichts nachträglich ausgeblendet, was der Server geliefert hat.
 */

type EreignisArt =
  | 'ANGELEGT'
  | 'PHASE_GEAENDERT'
  | 'MAIL_EIN'
  | 'MAIL_AUS'
  | 'GESPRAECH_ANGELEGT'
  | 'GESPRAECH_ABGESCHLOSSEN'
  | 'GESPRAECH_WIEDER_GEOEFFNET'
  | 'BEWERTUNG'
  | 'NOTIZ'
  | 'DOKUMENT'
  | 'VORSCHLAG_UEBERNOMMEN'
  | 'ZUGEWIESEN'

interface Ereignis {
  id: string
  type: EreignisArt
  actorName: string
  data: Record<string, unknown>
  createdAt: string
}

const SYMBOLE: Record<EreignisArt, ReactNode> = {
  ANGELEGT: <UserPlus className="h-3.5 w-3.5" />,
  PHASE_GEAENDERT: <CheckCircle2 className="h-3.5 w-3.5" />,
  MAIL_EIN: <Inbox className="h-3.5 w-3.5" />,
  MAIL_AUS: <MailCheck className="h-3.5 w-3.5" />,
  GESPRAECH_ANGELEGT: <MessageSquare className="h-3.5 w-3.5" />,
  GESPRAECH_ABGESCHLOSSEN: <CheckCircle2 className="h-3.5 w-3.5" />,
  GESPRAECH_WIEDER_GEOEFFNET: <LockOpen className="h-3.5 w-3.5" />,
  BEWERTUNG: <Star className="h-3.5 w-3.5" />,
  NOTIZ: <StickyNote className="h-3.5 w-3.5" />,
  DOKUMENT: <FileText className="h-3.5 w-3.5" />,
  VORSCHLAG_UEBERNOMMEN: <CheckCircle2 className="h-3.5 w-3.5" />,
  ZUGEWIESEN: <Users className="h-3.5 w-3.5" />,
}

/** Die Zeile zum Ereignis – bei der Phase mit den übersetzten Phasennamen. */
function beschriftung(e: Ereignis): string {
  if (e.type === 'PHASE_GEAENDERT') {
    return t('historie.PHASE_GEAENDERT', {
      von: t(`phasen.${String(e.data.von)}`),
      nach: t(`phasen.${String(e.data.nach)}`),
    })
  }
  return t(`historie.${e.type}`)
}

/** Zusatz in der zweiten Zeile, wo einer weiterhilft. */
function einzelheit(e: Ereignis): string | null {
  const betreff = typeof e.data.betreff === 'string' ? e.data.betreff : null
  if ((e.type === 'MAIL_EIN' || e.type === 'MAIL_AUS') && betreff) return betreff
  if (e.type === 'DOKUMENT' && Array.isArray(e.data.dateien)) {
    return (e.data.dateien as string[]).join(', ')
  }
  if (e.type === 'BEWERTUNG' && typeof e.data.sterne === 'number') {
    return `${e.data.sterne} von 5`
  }
  if (e.type === 'GESPRAECH_ANGELEGT' || e.type === 'GESPRAECH_ABGESCHLOSSEN') {
    const art = typeof e.data.art === 'string' ? t(`gespraech.arten.${e.data.art}`) : null
    const leitfaden = typeof e.data.leitfaden === 'string' ? e.data.leitfaden : null
    return [art, leitfaden].filter(Boolean).join(' · ') || null
  }
  return null
}

export function HistorieKarte({ bewerbungId }: { bewerbungId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['historie', bewerbungId],
    queryFn: () => api.get<Ereignis[]>(`/bewerbungen/${bewerbungId}/historie`),
  })

  const ereignisse = data ?? []

  return (
    <Karte titel={t('historie.titel')}>
      {isLoading ? (
        <LadeZustand />
      ) : ereignisse.length === 0 ? (
        <p className="py-2 text-sm text-slate-500">{t('historie.keine')}</p>
      ) : (
        <ol className="relative space-y-4 border-l border-slate-200 pl-5">
          {ereignisse.map((e) => {
            const zusatz = einzelheit(e)
            return (
              <li key={e.id} className="relative">
                <span className="absolute -left-[1.72rem] flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-4 ring-white">
                  {SYMBOLE[e.type]}
                </span>
                <p className="text-sm text-slate-800">{beschriftung(e)}</p>
                {zusatz && <p className="truncate text-xs text-slate-500">{zusatz}</p>}
                <p className="text-xs text-slate-400">
                  {e.actorName || t('historie.system')} · {formatDatumZeit(e.createdAt)}
                </p>
              </li>
            )
          })}
        </ol>
      )}
    </Karte>
  )
}
