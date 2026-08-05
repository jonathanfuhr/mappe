import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import {
  erlaubnisStand,
  frageErlaubnis,
  istEingeschaltet,
  schalte,
  type ErlaubnisStand,
} from '../lib/desktopBenachrichtigung'
import { Button, Checkbox, Hinweis, Karte } from './ui'
import { useToast } from './Toast'

/**
 * Was jeder für sich selbst einstellt.
 *
 * Die Mail-Einstellung liegt am Konto und gilt überall; die Desktop-Meldungen
 * hängen am Browser und damit am Gerät – deshalb steht der eine Wert auf dem
 * Server, der andere lokal. Das ist kein Versehen, sondern die einzige Stelle,
 * an der beides zusammenpasst: Eine Erlaubnis, die im Firmenrechner erteilt
 * wurde, gilt am Telefon ohnehin nicht.
 */
export function MeineBenachrichtigungen() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { nutzer } = useAuth()
  const [desktopAn, setDesktopAn] = useState(false)
  const [stand, setStand] = useState<ErlaubnisStand>('offen')

  useEffect(() => {
    setDesktopAn(istEingeschaltet())
    setStand(erlaubnisStand())
  }, [])

  const perMail = useMutation({
    mutationFn: (an: boolean) => api.patch('/auth/benachrichtigungen', { perMail: an }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      toast.erfolg(t('app.gespeichert'))
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const schalteDesktop = async (an: boolean) => {
    if (an && erlaubnisStand() === 'offen') {
      const neu = await frageErlaubnis()
      setStand(neu)
      if (neu !== 'erlaubt') return
    }
    schalte(an)
    setDesktopAn(an)
  }

  return (
    <Karte titel={t('benachrichtigungen.eigene')}>
      <div className="max-w-xl space-y-5">
        <Checkbox
          label={t('benachrichtigungen.eigeneMail')}
          hilfe={t('benachrichtigungen.eigeneMailHilfe')}
          checked={nutzer?.notifyByMail ?? true}
          onChange={(e) => perMail.mutate(e.target.checked)}
        />

        <div className="space-y-2 border-t border-slate-100 pt-5">
          <Checkbox
            label={t('benachrichtigungen.desktop')}
            hilfe={t('benachrichtigungen.desktopHilfe')}
            checked={desktopAn && stand === 'erlaubt'}
            disabled={stand === 'nicht-unterstuetzt' || stand === 'blockiert'}
            onChange={(e) => void schalteDesktop(e.target.checked)}
          />

          {stand === 'blockiert' && <Hinweis ton="warnung">{t('benachrichtigungen.desktopBlockiert')}</Hinweis>}
          {stand === 'nicht-unterstuetzt' && (
            <Hinweis ton="info">{t('benachrichtigungen.desktopNichtUnterstuetzt')}</Hinweis>
          )}
          {stand === 'offen' && (
            <Button variante="umriss" groesse="sm" onClick={() => void schalteDesktop(true)}>
              {t('benachrichtigungen.desktopErlauben')}
            </Button>
          )}
        </div>
      </div>
    </Karte>
  )
}
