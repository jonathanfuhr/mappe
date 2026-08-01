import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Lock, Phone, Users, Video } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { GespraechsBogen } from '../components/GespraechsBogen'
import { Seite, SeitenKopf } from '../components/Layout'
import { Badge, Hinweis, Karte, LadeZustand } from '../components/ui'
import { formatDatum, t } from '../i18n'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Gespraech, GespraechsArt } from '../lib/typen'

/**
 * Ein Gespräch auf einer eigenen Seite.
 *
 * Gedacht für den zweiten Tab: Hier ist Platz für den ganzen Fragenkatalog,
 * während im ersten Tab der Lebenslauf offen bleibt. Deshalb bewusst eine
 * echte Route und kein Dialog – nur so lässt sie sich in einem neuen Tab
 * öffnen und behält beim Hin- und Herwechseln ihren Stand.
 */

interface GespraechMitKontext extends Gespraech {
  application: {
    id: string
    stage: string
    candidate: { firstName: string; lastName: string; email: string | null }
    job: { id: string; title: string } | null
  }
}

function ArtSymbol({ art }: { art: GespraechsArt }) {
  const klasse = 'h-3.5 w-3.5'
  if (art === 'TELEFON') return <Phone className={klasse} />
  if (art === 'VIDEO') return <Video className={klasse} />
  return <Users className={klasse} />
}

export function GespraechPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const { nutzer } = useAuth()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['gespraech', id],
    queryFn: () => api.get<GespraechMitKontext>(`/gespraeche/${id}`),
    enabled: Boolean(id),
  })

  if (isLoading) return <LadeZustand />
  if (isError || !data) {
    return (
      <Seite>
        <Hinweis ton="fehler">{t('app.fehler')}</Hinweis>
      </Seite>
    )
  }

  const person = [data.application.candidate.firstName, data.application.candidate.lastName]
    .filter(Boolean)
    .join(' ')
    .trim()
  const abgeschlossen = Boolean(data.completedAt)

  return (
    <Seite>
      <Link
        to={`/bewerbungen/${data.application.id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" />
        {person || data.application.candidate.email || t('app.zurueck')}
      </Link>

      <SeitenKopf
        titel={data.template?.name ?? data.title}
        beschreibung={[data.application.job?.title, data.user.name, formatDatum(data.conductedAt ?? data.createdAt)]
          .filter(Boolean)
          .join(' · ')}
        aktion={
          <div className="flex items-center gap-2">
            <Badge ton="grau">
              <ArtSymbol art={data.kind} />
              {t(`gespraech.arten.${data.kind}`)}
            </Badge>
            {abgeschlossen && (
              <Badge ton="gruen">
                <Lock className="h-3 w-3" />
                {t('gespraech.abgeschlossen')}
              </Badge>
            )}
          </div>
        }
      />

      <Karte>
        <GespraechsBogen
          gespraech={data}
          eigenes={data.user.id === nutzer?.id}
          onGeaendert={async () => {
            await queryClient.invalidateQueries({ queryKey: ['gespraech', id] })
            await queryClient.invalidateQueries({ queryKey: ['bewerbung'] })
          }}
        />
      </Karte>
    </Seite>
  )
}
