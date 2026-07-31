import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Scissors, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { api, ApiError } from '../lib/api'
import { ladeDokument, type PDFDocumentProxy } from '../lib/pdf'
import { KATEGORIEN, type Kategorie } from '../lib/typen'
import { KategoriePunkt } from './Anzeigen'
import { useToast } from './Toast'
import { Button, Hinweis, LadeZustand, Spinner } from './ui'

interface SeitenInfo {
  seite: number
  kategorie: Kategorie
  sicherheit: number
  begruendung: string
  beginntNeuesDokument: boolean
  textAuszug: string
}

interface SeitenAntwort {
  dokument: { id: string; filename: string; seitenAnzahl: number }
  bereitsAufgetrennt: boolean
  teile: { id: string; category: Kategorie; sourcePages: number[]; filename: string }[]
  seiten: SeitenInfo[]
}

/**
 * Manuelle Split-Ansicht – ein vollwertiges Werkzeug, keine Notlösung.
 *
 * Alle Seiten als Vorschaubild, Kategorien farbcodiert. Klick weist zu,
 * Umschalt-Klick markiert einen zusammenhängenden Bereich. Die
 * Stichwort-Heuristik füllt die Ansicht vor, damit man korrigiert statt bei
 * Null anzufangen. Läuft die KI mit, füllt sie dieselbe Ansicht – der
 * Prüfschritt bleibt derselbe.
 */
export function SplitAnsicht({
  dokumentId,
  onFertig,
}: {
  dokumentId: string
  onFertig: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [zuordnung, setZuordnung] = useState<Map<number, Kategorie>>(new Map())
  const [aktiveKategorie, setAktiveKategorie] = useState<Kategorie>('LEBENSLAUF')
  const [letzteSeite, setLetzteSeite] = useState<number | null>(null)
  const [uebernommen, setUebernommen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['seiten', dokumentId],
    queryFn: () => api.get<SeitenAntwort>(`/dokumente/${dokumentId}/seiten`),
  })

  // Vorschlag der Heuristik einmalig übernehmen; danach gewinnt immer, was
  // von Hand geklickt wurde.
  useEffect(() => {
    if (!data || uebernommen) return
    setZuordnung(new Map(data.seiten.map((s) => [s.seite, s.kategorie])))
    setUebernommen(true)
  }, [data, uebernommen])

  const auftrennen = useMutation({
    mutationFn: () =>
      api.post<{ erzeugt: unknown[]; ersetzt: number }>(`/dokumente/${dokumentId}/auftrennen`, {
        zuordnung: [...zuordnung.entries()].map(([seite, kategorie]) => ({ seite, kategorie })),
      }),
    onSuccess: async (ergebnis) => {
      await queryClient.invalidateQueries({ queryKey: ['bewerbung'] })
      await queryClient.invalidateQueries({ queryKey: ['seiten', dokumentId] })
      toast.erfolg(`${ergebnis.erzeugt.length} Teildokument(e) erzeugt. Das Original bleibt erhalten.`)
      onFertig()
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const zuruecknehmen = useMutation({
    mutationFn: () => api.post(`/dokumente/${dokumentId}/split-zuruecknehmen`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bewerbung'] })
      await queryClient.invalidateQueries({ queryKey: ['seiten', dokumentId] })
      toast.erfolg('Die Auftrennung wurde zurückgenommen.')
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  function weiseZu(seite: number, mitUmschalt: boolean) {
    setZuordnung((alt) => {
      const neu = new Map(alt)
      if (mitUmschalt && letzteSeite !== null) {
        // Zusammenhängenden Bereich zuweisen – der schnellste Weg bei einem
        // sechsseitigen Zeugnis.
        const [von, bis] = letzteSeite < seite ? [letzteSeite, seite] : [seite, letzteSeite]
        for (let s = von; s <= bis; s++) neu.set(s, aktiveKategorie)
      } else {
        neu.set(seite, aktiveKategorie)
      }
      return neu
    })
    setLetzteSeite(seite)
  }

  if (isLoading || !data) return <LadeZustand />

  const verteilung = KATEGORIEN.map((k) => ({
    kategorie: k,
    anzahl: [...zuordnung.values()].filter((v) => v === k).length,
  }))

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">Kategorie wählen, dann Seiten anklicken:</span>
        {KATEGORIEN.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setAktiveKategorie(k)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              aktiveKategorie === k
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
            )}
          >
            <KategoriePunkt kategorie={k} />
            {t(`kategorien.${k}`)}
            <span className={clsx('text-xs', aktiveKategorie === k ? 'text-slate-300' : 'text-slate-400')}>
              {verteilung.find((v) => v.kategorie === k)?.anzahl ?? 0}
            </span>
          </button>
        ))}
      </div>

      <p className="mb-4 text-xs text-slate-500">
        Umschalt-Klick weist alle Seiten zwischen der zuletzt geklickten und dieser zu.
        Zusammenhängende Seiten derselben Kategorie bleiben beim Auftrennen in einer Datei.
      </p>

      {data.bereitsAufgetrennt && (
        <div className="mb-4">
          <Hinweis ton="info">
            Diese Datei wurde bereits aufgetrennt ({data.teile.length} Teil(e)). Ein erneutes
            Auftrennen ersetzt die bestehenden Teile.
          </Hinweis>
        </div>
      )}

      <div className="mb-5 grid max-h-[55vh] grid-cols-2 gap-3 overflow-y-auto rounded-lg bg-slate-100 p-3 duenner-scroll sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {data.seiten.map((seite) => (
          <SeitenKachel
            key={seite.seite}
            dokumentId={dokumentId}
            info={seite}
            kategorie={zuordnung.get(seite.seite) ?? 'ANDERE'}
            onKlick={(mitUmschalt) => weiseZu(seite.seite, mitUmschalt)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => auftrennen.mutate()} laedt={auftrennen.isPending}>
          <Scissors className="h-4 w-4" />
          Auftrennen
        </Button>
        {data.bereitsAufgetrennt && (
          <Button variante="umriss" onClick={() => zuruecknehmen.mutate()} laedt={zuruecknehmen.isPending}>
            <Undo2 className="h-4 w-4" />
            Auftrennung zurücknehmen
          </Button>
        )}
        <span className="text-xs text-slate-500">Das Original bleibt in jedem Fall erhalten.</span>
      </div>
    </div>
  )
}

function SeitenKachel({
  dokumentId,
  info,
  kategorie,
  onKlick,
}: {
  dokumentId: string
  info: SeitenInfo
  kategorie: Kategorie
  onKlick: (mitUmschalt: boolean) => void
}) {
  const leinwand = useRef<HTMLCanvasElement>(null)
  const [gerendert, setGerendert] = useState(false)

  useEffect(() => {
    let abgebrochen = false
    void (async () => {
      let dokument: PDFDocumentProxy
      try {
        dokument = await ladeDokument(dokumentId)
      } catch {
        return
      }
      if (abgebrochen) return

      const seite = await dokument.getPage(info.seite)
      // Vorschaubilder klein halten: 20 Seiten in voller Auflösung würden den
      // Browser unnötig belasten.
      const roh = seite.getViewport({ scale: 1 })
      const viewport = seite.getViewport({ scale: 200 / roh.width })

      const canvas = leinwand.current
      const kontext = canvas?.getContext('2d')
      if (!canvas || !kontext || abgebrochen) return

      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      await seite.render({ canvasContext: kontext, viewport }).promise.catch(() => undefined)
      seite.cleanup()
      if (!abgebrochen) setGerendert(true)
    })()
    return () => {
      abgebrochen = true
    }
  }, [dokumentId, info.seite])

  const rahmenFarbe: Record<Kategorie, string> = {
    ANSCHREIBEN: 'border-violet-500 ring-violet-500',
    LEBENSLAUF: 'border-sky-500 ring-sky-500',
    ZEUGNISSE: 'border-emerald-500 ring-emerald-500',
    ANDERE: 'border-slate-400 ring-slate-400',
    ORIGINAL: 'border-slate-300 ring-slate-300',
  }

  return (
    <button
      type="button"
      onClick={(e) => onKlick(e.shiftKey)}
      title={info.begruendung}
      className={clsx(
        'group flex flex-col overflow-hidden rounded-lg border-2 bg-white text-left ring-1 ring-inset transition-all hover:shadow-md',
        rahmenFarbe[kategorie],
      )}
    >
      <span className="relative flex aspect-[1/1.414] items-center justify-center overflow-hidden bg-slate-50">
        {!gerendert && <Spinner className="h-4 w-4" />}
        <canvas ref={leinwand} className={clsx('h-full w-full object-contain', !gerendert && 'hidden')} />
        <span className="absolute left-1 top-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {info.seite}
        </span>
        {info.beginntNeuesDokument && (
          <span className="absolute right-1 top-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
            neu
          </span>
        )}
      </span>

      <span className="flex items-center gap-1.5 px-2 py-1.5">
        <KategoriePunkt kategorie={kategorie} />
        <span className="truncate text-xs font-medium text-slate-700">
          {t(`kategorien.${kategorie}`)}
        </span>
      </span>
    </button>
  )
}
