import clsx from 'clsx'
import {
  Briefcase,
  FolderOpen,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  UserSquare2,
  X,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { t } from '../i18n'
import { api } from '../lib/api'
import { useAuth, type Rolle } from '../lib/auth'

interface NavEintrag {
  pfad: string
  label: string
  icon: ReactNode
  rollen?: Rolle[]
}

const hauptNavigation: NavEintrag[] = [
  { pfad: '/', label: t('navigation.uebersicht'), icon: <LayoutDashboard className="h-4 w-4" /> },
  { pfad: '/board', label: t('navigation.board'), icon: <KanbanSquare className="h-4 w-4" /> },
  { pfad: '/bewerbungen', label: t('navigation.bewerbungen'), icon: <FolderOpen className="h-4 w-4" /> },
  {
    pfad: '/bewerber',
    label: t('navigation.bewerber'),
    icon: <UserSquare2 className="h-4 w-4" />,
    rollen: ['ADMIN', 'RECRUITER'],
  },
  {
    pfad: '/stellen',
    label: t('navigation.stellen'),
    icon: <Briefcase className="h-4 w-4" />,
    rollen: ['ADMIN', 'RECRUITER'],
  },
  {
    pfad: '/posteingang',
    label: t('navigation.posteingang'),
    icon: <Inbox className="h-4 w-4" />,
    rollen: ['ADMIN', 'RECRUITER'],
  },
]

const verwaltungsNavigation: NavEintrag[] = [
  {
    pfad: '/vorlagen',
    label: t('navigation.vorlagen'),
    icon: <Mail className="h-4 w-4" />,
    rollen: ['ADMIN'],
  },
  {
    pfad: '/aufbewahrung',
    label: t('navigation.dsgvo'),
    icon: <ShieldCheck className="h-4 w-4" />,
    rollen: ['ADMIN'],
  },
  {
    pfad: '/nutzer',
    label: t('navigation.nutzer'),
    icon: <Users className="h-4 w-4" />,
    rollen: ['ADMIN'],
  },
  {
    pfad: '/einstellungen',
    label: t('navigation.einstellungen'),
    icon: <Settings className="h-4 w-4" />,
    rollen: ['ADMIN'],
  },
]

function NavListe({ eintraege, rolle, onKlick }: { eintraege: NavEintrag[]; rolle: Rolle; onKlick?: () => void }) {
  const sichtbar = eintraege.filter((e) => !e.rollen || e.rollen.includes(rolle))
  if (sichtbar.length === 0) return null

  return (
    <ul className="space-y-0.5">
      {sichtbar.map((eintrag) => (
        <li key={eintrag.pfad}>
          <NavLink
            to={eintrag.pfad}
            end={eintrag.pfad === '/'}
            onClick={onKlick}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )
            }
          >
            {eintrag.icon}
            {eintrag.label}
          </NavLink>
        </li>
      ))}
    </ul>
  )
}

export function Layout() {
  const { nutzer, abmelden } = useAuth()
  const navigate = useNavigate()
  const [mobilOffen, setMobilOffen] = useState(false)

  const { data: kiStatus } = useQuery({
    queryKey: ['einstellungen-oeffentlich'],
    queryFn: () => api.get<{ kiAktiv: boolean; kiModell: string | null }>('/einstellungen/oeffentlich'),
    staleTime: 5 * 60_000,
  })

  if (!nutzer) return null

  const seitenleiste = (onKlick?: () => void) => (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <FolderOpen className="h-4 w-4" />
        </div>
        <span className="text-lg font-semibold tracking-tight text-slate-900">{t('app.name')}</span>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4 duenner-scroll">
        <NavListe eintraege={hauptNavigation} rolle={nutzer.role} onKlick={onKlick} />
        {nutzer.role === 'ADMIN' && (
          <div>
            <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Verwaltung
            </p>
            <NavListe eintraege={verwaltungsNavigation} rolle={nutzer.role} onKlick={onKlick} />
          </div>
        )}
      </nav>

      {/* Dauerhaft sichtbar, solange die KI läuft – wer damit arbeitet, soll
          nicht erst in den Einstellungen nachsehen müssen, ob Auszüge aus
          Bewerbungen an einen Anbieter gehen. */}
      {kiStatus?.kiAktiv && (
        <Link
          to="/einstellungen"
          className="mx-3 mb-2 flex items-center gap-2 rounded-lg bg-violet-50 px-2.5 py-2 text-xs text-violet-800 transition-colors hover:bg-violet-100"
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            {t('ki.aktivHinweis', { modell: kiStatus.kiModell ?? '' })}
          </span>
        </Link>
      )}

      <div className="border-t border-slate-200 p-3">
        <NavLink
          to="/profil"
          onClick={onKlick}
          className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-slate-100"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
            {initialen(nutzer.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-slate-900">{nutzer.name}</span>
            <span className="block truncate text-xs text-slate-500">{t(`rollen.${nutzer.role}`)}</span>
          </span>
        </NavLink>
        <button
          type="button"
          onClick={async () => {
            await abmelden()
            navigate('/')
          }}
          className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <LogOut className="h-4 w-4" />
          {t('anmeldung.abmelden')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:block">
        {seitenleiste()}
      </aside>

      {mobilOffen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="fixed inset-0 bg-slate-900/40" onClick={() => setMobilOffen(false)} aria-hidden />
          <aside className="relative h-full w-64 bg-white shadow-xl">
            <button
              type="button"
              onClick={() => setMobilOffen(false)}
              className="absolute right-3 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              aria-label={t('app.schliessen')}
            >
              <X className="h-4 w-4" />
            </button>
            {seitenleiste(() => setMobilOffen(false))}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setMobilOffen(true)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            aria-label="Menü"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold text-slate-900">{t('app.name')}</span>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto duenner-scroll">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export function SeitenKopf({
  titel,
  beschreibung,
  aktion,
}: {
  titel: string
  beschreibung?: string
  aktion?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{titel}</h1>
        {beschreibung && <p className="mt-1 text-sm text-slate-500">{beschreibung}</p>}
      </div>
      {aktion && <div className="shrink-0">{aktion}</div>}
    </div>
  )
}

export function Seite({ children, breit }: { children: ReactNode; breit?: boolean }) {
  return <div className={clsx('mx-auto px-5 py-6 lg:px-8', breit ? 'max-w-[1600px]' : 'max-w-5xl')}>{children}</div>
}

function initialen(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((teil) => teil[0]?.toUpperCase() ?? '')
    .join('')
}
