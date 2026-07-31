import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { api, ApiError } from '../lib/api'
import { PHASEN, type Bewerbung, type Phase } from '../lib/typen'
import type { Vorlage } from '../pages/VorlagenPage'
import { Button, Checkbox, Dialog, Hinweis, Input, Select, Textarea } from './ui'
import { useToast } from './Toast'

interface Vorschau {
  betreff: string
  text: string
  fehlende: string[]
  unbekannte: string[]
  empfaenger: string[]
}

/**
 * Mail schreiben und aus dem Postfach versenden.
 *
 * Die Vorlage füllt Betreff und Text nur *vor* – gesendet wird immer genau
 * das, was hier im Fenster steht. Welche Platzhalter leer geblieben sind,
 * wird ausdrücklich gemeldet, damit keine Lücke ungesehen rausgeht.
 */
export function MailSendenDialog({
  offen,
  onSchliessen,
  bewerbung,
  mailAktiv,
  onGesendet,
}: {
  offen: boolean
  onSchliessen: () => void
  bewerbung: Bewerbung
  mailAktiv: boolean
  onGesendet: () => Promise<void>
}) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [vorlageId, setVorlageId] = useState('')
  const [an, setAn] = useState('')
  const [kopie, setKopie] = useState('')
  const [betreff, setBetreff] = useState('')
  const [text, setText] = useState('')
  const [neuePhase, setNeuePhase] = useState<Phase | ''>('')
  const [anhaenge, setAnhaenge] = useState<string[]>([])
  const [meldungen, setMeldungen] = useState<{ fehlende: string[]; unbekannte: string[] }>({
    fehlende: [],
    unbekannte: [],
  })

  const { data: vorlagen } = useQuery({
    queryKey: ['vorlagen'],
    queryFn: () => api.get<Vorlage[]>('/vorlagen'),
    enabled: offen,
  })

  // Beim Öffnen den Empfänger vorbelegen.
  useEffect(() => {
    if (!offen) return
    setAn(bewerbung.candidate.email ?? '')
    setVorlageId('')
    setBetreff('')
    setText('')
    setKopie('')
    setNeuePhase('')
    setAnhaenge([])
    setMeldungen({ fehlende: [], unbekannte: [] })
  }, [offen, bewerbung.candidate.email])

  const vorschau = useMutation({
    mutationFn: (id: string) =>
      api.post<Vorschau>(`/vorlagen/vorschau/${bewerbung.id}`, { vorlageId: id }),
    onSuccess: (ergebnis) => {
      setBetreff(ergebnis.betreff)
      setText(ergebnis.text)
      setMeldungen({ fehlende: ergebnis.fehlende, unbekannte: ergebnis.unbekannte })
      if (!an && ergebnis.empfaenger[0]) setAn(ergebnis.empfaenger[0])
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const senden = useMutation({
    mutationFn: () =>
      api.post(`/vorlagen/senden/${bewerbung.id}`, {
        an: an.split(',').map((a) => a.trim()).filter(Boolean),
        kopie: kopie.split(',').map((a) => a.trim()).filter(Boolean),
        betreff,
        text,
        dokumentIds: anhaenge,
        ...(neuePhase ? { neuePhase } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bewerbung', bewerbung.id] })
      await onGesendet()
      toast.erfolg(t('senden.gesendet'))
      onSchliessen()
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  /**
   * Passende Vorlagen zuerst: Bei einer Initiativbewerbung ist die
   * Initiativ-Absage die richtige, bei einer eingeladenen Bewerbung die
   * Einladung. Der Rest bleibt trotzdem wählbar.
   */
  const sortierteVorlagen = (vorlagen ?? [])
    .filter((v) => v.active)
    .sort((a, b) => passung(b) - passung(a) || a.sortOrder - b.sortOrder)

  function passung(v: Vorlage): number {
    if (bewerbung.speculative && v.type === 'INITIATIV_ABSAGE') return 3
    if (!bewerbung.speculative && v.type === 'ABSAGE' && bewerbung.stage === 'ENTSCHEIDUNG') return 3
    if (v.type === 'EINLADUNG' && bewerbung.stage === 'IN_PRUEFUNG') return 3
    if (v.type === 'EINGANGSBESTAETIGUNG' && bewerbung.stage === 'NEU') return 3
    // Die Initiativ-Absage passt nie zu einer Bewerbung auf eine Stelle.
    if (!bewerbung.speculative && v.type === 'INITIATIV_ABSAGE') return -1
    return 0
  }

  return (
    <Dialog
      offen={offen}
      onSchliessen={onSchliessen}
      titel={t('senden.titel')}
      beschreibung={t('senden.textAnpassbar')}
      breite="lg"
      fusszeile={
        <>
          <Button variante="umriss" onClick={onSchliessen}>
            {t('app.abbrechen')}
          </Button>
          <Button
            onClick={() => senden.mutate()}
            laedt={senden.isPending}
            disabled={!mailAktiv || !an.trim() || !betreff.trim() || !text.trim()}
          >
            <Send className="h-4 w-4" />
            {t('senden.senden')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!mailAktiv && <Hinweis ton="warnung">{t('senden.keinPostfach')}</Hinweis>}
        {!bewerbung.candidate.email && <Hinweis ton="warnung">{t('senden.keineAdresse')}</Hinweis>}

        <Select
          label={t('senden.vorlageWaehlen')}
          value={vorlageId}
          onChange={(e) => {
            setVorlageId(e.target.value)
            if (e.target.value) vorschau.mutate(e.target.value)
          }}
        >
          <option value="">{t('senden.keineVorlage')}</option>
          {sortierteVorlagen.map((v) => (
            <option key={v.id} value={v.id}>
              {t(`vorlagenArten.${v.type}`)} · {v.tone === 'DU' ? t('vorlagen.du') : t('vorlagen.sie')} –{' '}
              {v.name}
            </option>
          ))}
        </Select>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t('senden.an')} value={an} onChange={(e) => setAn(e.target.value)} pflicht />
          <Input
            label={t('senden.kopie')}
            value={kopie}
            onChange={(e) => setKopie(e.target.value)}
            placeholder={t('app.optional')}
          />
        </div>

        <Input label={t('vorlagen.betreff')} value={betreff} onChange={(e) => setBetreff(e.target.value)} pflicht />

        <Textarea
          label={t('vorlagen.text')}
          rows={16}
          value={text}
          onChange={(e) => setText(e.target.value)}
          pflicht
        />

        {meldungen.fehlende.length > 0 && (
          <Hinweis ton="warnung">
            {t('senden.fehlendeWerte', { liste: meldungen.fehlende.map((f) => `$${f}`).join(', ') })}
          </Hinweis>
        )}
        {meldungen.unbekannte.length > 0 && (
          <Hinweis ton="fehler">
            {t('senden.unbekannteWerte', { liste: meldungen.unbekannte.map((f) => `$${f}`).join(', ') })}
          </Hinweis>
        )}

        {bewerbung.documents.length > 0 && (
          <div>
            <span className="feld-label">{t('senden.anhaenge')}</span>
            <ul className="space-y-1.5">
              {bewerbung.documents.map((d) => (
                <li key={d.id}>
                  <Checkbox
                    label={d.filename}
                    checked={anhaenge.includes(d.id)}
                    onChange={(e) =>
                      setAnhaenge((alt) =>
                        e.target.checked ? [...alt, d.id] : alt.filter((id) => id !== d.id),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        <Select
          label={t('senden.phaseSetzen')}
          value={neuePhase}
          onChange={(e) => setNeuePhase(e.target.value as Phase | '')}
        >
          <option value="">{t('senden.phaseNichtAendern')}</option>
          {PHASEN.map((p) => (
            <option key={p} value={p}>
              {t(`phasen.${p}`)}
            </option>
          ))}
        </Select>
      </div>
    </Dialog>
  )
}
