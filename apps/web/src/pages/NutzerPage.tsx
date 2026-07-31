import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Seite, SeitenKopf } from '../components/Layout'
import { useToast } from '../components/Toast'
import {
  Badge,
  BestaetigenDialog,
  Button,
  Dialog,
  Input,
  Karte,
  LadeZustand,
  Select,
} from '../components/ui'
import { formatRelativ, t } from '../i18n'
import { api, ApiError } from '../lib/api'
import { useAuth, type Rolle } from '../lib/auth'

interface NutzerZeile {
  id: string
  name: string
  email: string
  role: Rolle
  active: boolean
  lastLoginAt: string | null
  createdAt: string
  hatMicrosoftLogin: boolean
}

const rollen: Rolle[] = ['ADMIN', 'RECRUITER', 'INTERVIEWER']

export function NutzerPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { nutzer: ich } = useAuth()

  const [dialogOffen, setDialogOffen] = useState(false)
  const [bearbeitet, setBearbeitet] = useState<NutzerZeile | null>(null)
  const [zuLoeschen, setZuLoeschen] = useState<NutzerZeile | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['nutzer'],
    queryFn: () => api.get<NutzerZeile[]>('/nutzer'),
  })

  const aktualisieren = () => queryClient.invalidateQueries({ queryKey: ['nutzer'] })

  const loeschen = useMutation({
    mutationFn: (id: string) => api.delete(`/nutzer/${id}`),
    onSuccess: async () => {
      setZuLoeschen(null)
      await aktualisieren()
      toast.erfolg('Das Konto wurde gelöscht.')
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const umschalten = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/nutzer/${id}`, { active }),
    onSuccess: async () => {
      await aktualisieren()
      toast.erfolg(t('app.gespeichert'))
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  return (
    <Seite>
      <SeitenKopf
        titel={t('nutzer.titel')}
        beschreibung={t('nutzer.beschreibung')}
        aktion={
          <Button
            onClick={() => {
              setBearbeitet(null)
              setDialogOffen(true)
            }}
          >
            <Plus className="h-4 w-4" />
            {t('nutzer.neu')}
          </Button>
        }
      />

      <Karte className="overflow-hidden" >
        {isLoading ? (
          <LadeZustand />
        ) : (
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="tabelle">
              <thead>
                <tr>
                  <th>{t('nutzer.name')}</th>
                  <th>{t('nutzer.rolle')}</th>
                  <th>{t('nutzer.status')}</th>
                  <th>{t('nutzer.letzteAnmeldung')}</th>
                  <th className="w-0" />
                </tr>
              </thead>
              <tbody>
                {data?.map((zeile) => (
                  <tr key={zeile.id}>
                    <td>
                      <div className="font-medium text-slate-900">{zeile.name}</div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        {zeile.email}
                        {zeile.hatMicrosoftLogin && (
                          <ShieldCheck
                            className="h-3.5 w-3.5 text-brand-500"
                            aria-label={t('nutzer.microsoftLogin')}
                          />
                        )}
                      </div>
                    </td>
                    <td>
                      <Badge ton={zeile.role === 'ADMIN' ? 'lila' : zeile.role === 'RECRUITER' ? 'blau' : 'grau'}>
                        {t(`rollen.${zeile.role}`)}
                      </Badge>
                    </td>
                    <td>
                      {zeile.active ? (
                        <Badge ton="gruen">{t('nutzer.aktiv')}</Badge>
                      ) : (
                        <Badge ton="rot">{t('nutzer.gesperrt')}</Badge>
                      )}
                    </td>
                    <td className="text-slate-500">
                      {zeile.lastLoginAt ? formatRelativ(zeile.lastLoginAt) : t('nutzer.nie')}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1 whitespace-nowrap">
                        <Button
                          variante="still"
                          groesse="sm"
                          onClick={() => {
                            setBearbeitet(zeile)
                            setDialogOffen(true)
                          }}
                        >
                          {t('app.bearbeiten')}
                        </Button>
                        <Button
                          variante="still"
                          groesse="sm"
                          onClick={() => umschalten.mutate({ id: zeile.id, active: !zeile.active })}
                        >
                          {zeile.active ? t('nutzer.sperren') : t('nutzer.entsperren')}
                        </Button>
                        {zeile.id !== ich?.id && (
                          <Button variante="still" groesse="sm" onClick={() => setZuLoeschen(zeile)}>
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Karte>

      <NutzerDialog
        offen={dialogOffen}
        nutzer={bearbeitet}
        onSchliessen={() => setDialogOffen(false)}
        onGespeichert={async () => {
          setDialogOffen(false)
          await aktualisieren()
          toast.erfolg(t('app.gespeichert'))
        }}
      />

      <BestaetigenDialog
        offen={Boolean(zuLoeschen)}
        onSchliessen={() => setZuLoeschen(null)}
        onBestaetigen={() => zuLoeschen && loeschen.mutate(zuLoeschen.id)}
        laedt={loeschen.isPending}
        titel={t('app.wirklichLoeschen')}
        text={
          <>
            Das Konto <strong>{zuLoeschen?.name}</strong> wird gelöscht. Bewertungen und Notizen
            dieses Kontos werden dabei mit entfernt. {t('app.nichtRueckgaengig')}
          </>
        }
      />
    </Seite>
  )
}

function NutzerDialog({
  offen,
  nutzer,
  onSchliessen,
  onGespeichert,
}: {
  offen: boolean
  nutzer: NutzerZeile | null
  onSchliessen: () => void
  onGespeichert: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [rolle, setRolle] = useState<Rolle>('RECRUITER')
  const [passwort, setPasswort] = useState('')
  const [initialisiertFuer, setInitialisiertFuer] = useState<string | null>(null)

  // Formular beim Öffnen mit den Werten des Datensatzes füllen.
  const schluessel = offen ? (nutzer?.id ?? 'neu') : null
  if (schluessel !== initialisiertFuer) {
    setInitialisiertFuer(schluessel)
    setName(nutzer?.name ?? '')
    setEmail(nutzer?.email ?? '')
    setRolle(nutzer?.role ?? 'RECRUITER')
    setPasswort('')
  }

  const speichern = useMutation({
    mutationFn: async () => {
      if (nutzer) {
        return api.patch(`/nutzer/${nutzer.id}`, {
          name,
          email,
          role: rolle,
          ...(passwort ? { neuesPasswort: passwort } : {}),
        })
      }
      return api.post('/nutzer', { name, email, role: rolle, ...(passwort ? { passwort } : {}) })
    },
    onSuccess: onGespeichert,
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  return (
    <Dialog
      offen={offen}
      onSchliessen={onSchliessen}
      titel={nutzer ? t('app.bearbeiten') : t('nutzer.neu')}
      fusszeile={
        <>
          <Button variante="umriss" onClick={onSchliessen}>
            {t('app.abbrechen')}
          </Button>
          <Button onClick={() => speichern.mutate()} laedt={speichern.isPending}>
            {t('app.speichern')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label={t('nutzer.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          pflicht
        />
        <Input
          label={t('nutzer.email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          pflicht
        />
        <Select
          label={t('nutzer.rolle')}
          value={rolle}
          onChange={(e) => setRolle(e.target.value as Rolle)}
          hilfe={t(`rollen.${rolle}_hilfe`)}
        >
          {rollen.map((r) => (
            <option key={r} value={r}>
              {t(`rollen.${r}`)}
            </option>
          ))}
        </Select>
        <Input
          label={nutzer ? t('anmeldung.neuesPasswort') : t('nutzer.passwortSetzen')}
          type="password"
          value={passwort}
          onChange={(e) => setPasswort(e.target.value)}
          autoComplete="new-password"
          hilfe={nutzer ? t('einstellungen.geheimnisLeerHinweis') : t('nutzer.passwortLeerHinweis')}
        />
      </div>
    </Dialog>
  )
}
