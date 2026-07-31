import { Seite, SeitenKopf } from '../components/Layout'
import { Hinweis, Karte } from '../components/ui'
import { t } from '../i18n'
import { useAuth } from '../lib/auth'

export function UebersichtPage() {
  const { nutzer } = useAuth()

  return (
    <Seite>
      <SeitenKopf
        titel={`Guten Tag, ${nutzer?.name.split(' ')[0] ?? ''}`}
        beschreibung={t('app.untertitel')}
      />
      <Karte titel="Mappe ist eingerichtet">
        <Hinweis ton="info">
          Das Fundament steht: Konten, Rollen und Einstellungen sind da. Die Bewerbungsverwaltung
          kommt mit den nächsten Bauabschnitten dazu.
        </Hinweis>
      </Karte>
    </Seite>
  )
}
