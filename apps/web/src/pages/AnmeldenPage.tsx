import { FolderOpen } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button, Hinweis, Input } from '../components/ui'
import { t } from '../i18n'
import { ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'

/**
 * Eine Seite für zwei Fälle: Ist noch niemand angelegt, zeigt sie die
 * Ersteinrichtung, sonst die normale Anmeldung. Das erspart einen zweiten
 * Screen und macht klar, dass der erste Nutzer der Admin wird.
 */
export function AnmeldenPage() {
  const { status, anmelden, einrichten } = useAuth()
  const einrichtungsModus = status ? !status.eingerichtet : false

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [passwort, setPasswort] = useState('')
  // Der Microsoft-Rücksprung hängt den Grund an die Adresse, wenn etwas
  // schiefging – sonst landet man wortlos wieder auf der Anmeldeseite.
  const [fehler, setFehler] = useState<string | null>(
    new URLSearchParams(window.location.search).get('anmeldefehler'),
  )
  const [laedt, setLaedt] = useState(false)

  async function absenden(e: FormEvent) {
    e.preventDefault()
    setFehler(null)
    setLaedt(true)
    try {
      if (einrichtungsModus) await einrichten(name, email, passwort)
      else await anmelden(email, passwort)
    } catch (err) {
      setFehler(err instanceof ApiError ? err.message : t('app.fehler'))
      setLaedt(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-100 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
            <FolderOpen className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{t('app.name')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('app.untertitel')}</p>
        </div>

        <form onSubmit={absenden} className="karte space-y-4 p-6">
          <h2 className="text-base font-semibold text-slate-900">
            {einrichtungsModus ? t('einrichtung.titel') : t('anmeldung.titel')}
          </h2>

          {einrichtungsModus && (
            <Hinweis ton="info">{t('einrichtung.beschreibung')}</Hinweis>
          )}

          {einrichtungsModus && (
            <Input
              id="name"
              label={t('einrichtung.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
              pflicht
            />
          )}

          <Input
            id="email"
            type="email"
            label={t('anmeldung.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            pflicht
          />

          <Input
            id="passwort"
            type="password"
            label={t('anmeldung.passwort')}
            value={passwort}
            onChange={(e) => setPasswort(e.target.value)}
            autoComplete={einrichtungsModus ? 'new-password' : 'current-password'}
            hilfe={einrichtungsModus ? t('einrichtung.hinweisPasswort') : undefined}
            required
            pflicht
          />

          {fehler && <Hinweis ton="fehler">{fehler}</Hinweis>}

          <Button type="submit" laedt={laedt} className="w-full" groesse="lg">
            {einrichtungsModus ? t('einrichtung.starten') : t('anmeldung.anmelden')}
          </Button>

          {!einrichtungsModus && status?.entraAktiv && (
            <>
              <div className="relative py-1 text-center">
                <span className="relative z-10 bg-white px-3 text-xs uppercase tracking-wide text-slate-400">
                  {t('anmeldung.oder')}
                </span>
                <span className="absolute inset-x-0 top-1/2 h-px bg-slate-200" aria-hidden />
              </div>
              <Button
                type="button"
                variante="umriss"
                className="w-full"
                groesse="lg"
                onClick={() => {
                  window.location.href = '/api/auth/entra/start'
                }}
              >
                {t('anmeldung.mitMicrosoft')}
              </Button>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
