import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Seite, SeitenKopf } from '../components/Layout'
import { useToast } from '../components/Toast'
import { Badge, Button, Input, Karte } from '../components/ui'
import { t } from '../i18n'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'

export function ProfilPage() {
  const { nutzer } = useAuth()
  const toast = useToast()

  const [aktuell, setAktuell] = useState('')
  const [neu, setNeu] = useState('')
  const [wiederholung, setWiederholung] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)

  const aendern = useMutation({
    mutationFn: () => api.post('/auth/passwort', { aktuellesPasswort: aktuell, neuesPasswort: neu }),
    onSuccess: () => {
      setAktuell('')
      setNeu('')
      setWiederholung('')
      setFehler(null)
      toast.erfolg(t('anmeldung.passwortGeaendert'))
    },
    onError: (err: unknown) => setFehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  function absenden(e: FormEvent) {
    e.preventDefault()
    if (neu !== wiederholung) {
      setFehler(t('anmeldung.passwoerterUngleich'))
      return
    }
    setFehler(null)
    aendern.mutate()
  }

  if (!nutzer) return null

  return (
    <Seite>
      <SeitenKopf titel={t('navigation.profil')} />

      <div className="space-y-6">
        <Karte titel={nutzer.name} beschreibung={nutzer.email}>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">{t('nutzer.rolle')}:</span>
            <Badge ton={nutzer.role === 'ADMIN' ? 'lila' : nutzer.role === 'RECRUITER' ? 'blau' : 'grau'}>
              {t(`rollen.${nutzer.role}`)}
            </Badge>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">{t(`rollen.${nutzer.role}_hilfe`)}</p>
        </Karte>

        <Karte titel={t('anmeldung.passwortAendern')}>
          <form onSubmit={absenden} className="max-w-sm space-y-4">
            <Input
              type="password"
              label={t('anmeldung.aktuellesPasswort')}
              value={aktuell}
              onChange={(e) => setAktuell(e.target.value)}
              autoComplete="current-password"
              required
            />
            <Input
              type="password"
              label={t('anmeldung.neuesPasswort')}
              value={neu}
              onChange={(e) => setNeu(e.target.value)}
              autoComplete="new-password"
              hilfe={t('einrichtung.hinweisPasswort')}
              required
            />
            <Input
              type="password"
              label={t('anmeldung.neuesPasswortWiederholen')}
              value={wiederholung}
              onChange={(e) => setWiederholung(e.target.value)}
              autoComplete="new-password"
              fehler={fehler}
              required
            />
            <Button type="submit" laedt={aendern.isPending}>
              {t('app.speichern')}
            </Button>
          </form>
        </Karte>
      </div>
    </Seite>
  )
}
