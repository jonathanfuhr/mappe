import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout, Seite, SeitenKopf } from './components/Layout'
import { Hinweis, LadeZustand } from './components/ui'
import { t } from './i18n'
import { useAuth, type Rolle } from './lib/auth'
import { AnmeldenPage } from './pages/AnmeldenPage'
import { BewerberDetailPage, BewerberListePage } from './pages/BewerberPage'
import { BewerbungPage } from './pages/BewerbungPage'
import { BewerbungenPage } from './pages/BewerbungenPage'
import { BoardPage } from './pages/BoardPage'
import { EinstellungenPage } from './pages/EinstellungenPage'
import { NutzerPage } from './pages/NutzerPage'
import { PosteingangPage } from './pages/PosteingangPage'
import { ProfilPage } from './pages/ProfilPage'
import { StellenPage } from './pages/StellenPage'
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

const NUR_TEAM: Rolle[] = ['ADMIN', 'RECRUITER']
const NUR_ADMIN: Rolle[] = ['ADMIN']

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
        <Route path="/board" element={<BoardPage />} />
        <Route path="/bewerbungen" element={<BewerbungenPage />} />
        <Route path="/bewerbungen/:id" element={<BewerbungPage />} />
        <Route
          path="/bewerber"
          element={
            <NurFuer rollen={NUR_TEAM}>
              <BewerberListePage />
            </NurFuer>
          }
        />
        <Route path="/bewerber/:id" element={<BewerberDetailPage />} />
        <Route
          path="/stellen"
          element={
            <NurFuer rollen={NUR_TEAM}>
              <StellenPage />
            </NurFuer>
          }
        />
        <Route
          path="/posteingang"
          element={
            <NurFuer rollen={NUR_TEAM}>
              <PosteingangPage />
            </NurFuer>
          }
        />
        <Route path="/profil" element={<ProfilPage />} />
        <Route
          path="/nutzer"
          element={
            <NurFuer rollen={NUR_ADMIN}>
              <NutzerPage />
            </NurFuer>
          }
        />
        <Route
          path="/einstellungen"
          element={
            <NurFuer rollen={NUR_ADMIN}>
              <EinstellungenPage />
            </NurFuer>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
