import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout, Seite, SeitenKopf } from './components/Layout'
import { Hinweis, LadeZustand } from './components/ui'
import { t } from './i18n'
import { useAuth, type Rolle } from './lib/auth'
import { AnmeldenPage } from './pages/AnmeldenPage'
import { NutzerPage } from './pages/NutzerPage'
import { ProfilPage } from './pages/ProfilPage'
import { UebersichtPage } from './pages/UebersichtPage'

/** Sperrt eine Route für Rollen, die dort nichts zu suchen haben. */
function NurFuer({ rollen, children }: { rollen: Rolle[]; children: JSX.Element }) {
  const { nutzer } = useAuth()
  if (!nutzer) return null
  if (!rollen.includes(nutzer.role)) {
    return (
      <Seite>
        <SeitenKopf titel="Kein Zugriff" />
        <Hinweis ton="warnung">
          Dieser Bereich ist der Rolle {rollen.map((r) => t(`rollen.${r}`)).join(' oder ')} vorbehalten.
        </Hinweis>
      </Seite>
    )
  }
  return children
}

export function App() {
  const { nutzer, laedt } = useAuth()

  if (laedt) {
    return (
      <div className="flex h-full items-center justify-center">
        <LadeZustand />
      </div>
    )
  }

  if (!nutzer) return <AnmeldenPage />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<UebersichtPage />} />
        <Route path="/profil" element={<ProfilPage />} />
        <Route
          path="/nutzer"
          element={
            <NurFuer rollen={['ADMIN']}>
              <NutzerPage />
            </NurFuer>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
