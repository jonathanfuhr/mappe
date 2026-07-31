import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, MessageSquarePlus, Minus, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatRelativ, t } from '../i18n'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import {
  auswahlZuRechtecken,
  ladeDokument,
  pdfjs,
  type PDFDocumentProxy,
  type RelativesRechteck,
} from '../lib/pdf'
import { Button, Spinner, Textarea } from './ui'
import { useToast } from './Toast'

export interface PdfKommentar {
  id: string
  page: number
  quotedText: string
  rects: RelativesRechteck[]
  body: string
  resolved: boolean
  createdAt: string
  user: { id: string; name: string }
}

interface NeuerKommentar {
  seite: number
  zitat: string
  rechtecke: RelativesRechteck[]
}

/**
 * PDF-Betrachter mit Kommentaren an der Textstelle.
 *
 * Die Kommentare liegen in der Datenbank, verankert an Seite und relativen
 * Koordinaten – die PDF selbst wird nie angefasst. Wer sie herunterlädt,
 * bekommt exakt die Datei, die der Bewerber geschickt hat.
 */
export function PdfBetrachter({ dokumentId, dateiname }: { dokumentId: string; dateiname: string }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { nutzer } = useAuth()

  const [dokument, setDokument] = useState<PDFDocumentProxy | null>(null)
  const [ladefehler, setLadefehler] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [zoomGesetzt, setZoomGesetzt] = useState(false)
  const seitenBereich = useRef<HTMLDivElement>(null)
  const [entwurf, setEntwurf] = useState<NeuerKommentar | null>(null)
  const [entwurfText, setEntwurfText] = useState('')
  const [hervorgehoben, setHervorgehoben] = useState<string | null>(null)

  const { data: kommentare = [] } = useQuery({
    queryKey: ['pdf-kommentare', dokumentId],
    queryFn: () => api.get<PdfKommentar[]>(`/kommentare/dokument/${dokumentId}`),
  })

  useEffect(() => {
    let abgebrochen = false
    setDokument(null)
    setLadefehler(null)
    ladeDokument(dokumentId)
      .then((d) => {
        if (!abgebrochen) setDokument(d)
      })
      .catch((err: Error) => {
        if (!abgebrochen) setLadefehler(err.message)
      })
    return () => {
      abgebrochen = true
    }
  }, [dokumentId])

  /**
   * Anfangszoom aus der verfügbaren Breite ableiten. Ein fester Wert würde die
   * Seite auf schmalen Fenstern abschneiden und auf breiten Platz verschenken.
   */
  useEffect(() => {
    if (!dokument || zoomGesetzt) return
    void dokument.getPage(1).then((seite) => {
      const breite = seitenBereich.current?.clientWidth
      if (!breite) return
      const seitenBreite = seite.getViewport({ scale: 1 }).width
      // 32 px Luft für Innenabstand und Bildlaufleiste.
      setZoom(Math.min(2, Math.max(0.4, (breite - 32) / seitenBreite)))
      setZoomGesetzt(true)
      seite.cleanup()
    })
  }, [dokument, zoomGesetzt])

  const anlegen = useMutation({
    mutationFn: () =>
      api.post(`/kommentare/dokument/${dokumentId}`, {
        seite: entwurf!.seite,
        zitat: entwurf!.zitat,
        rechtecke: entwurf!.rechtecke,
        text: entwurfText,
      }),
    onSuccess: async () => {
      setEntwurf(null)
      setEntwurfText('')
      await queryClient.invalidateQueries({ queryKey: ['pdf-kommentare', dokumentId] })
      toast.erfolg('Der Kommentar wurde gespeichert.')
    },
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const aendern = useMutation({
    mutationFn: ({ id, erledigt }: { id: string; erledigt: boolean }) =>
      api.patch(`/kommentare/${id}`, { erledigt }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pdf-kommentare', dokumentId] }),
  })

  const loeschen = useMutation({
    mutationFn: (id: string) => api.delete(`/kommentare/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pdf-kommentare', dokumentId] }),
    onError: (err: unknown) => toast.fehler(err instanceof ApiError ? err.message : t('app.fehler')),
  })

  const beiAuswahl = useCallback((seite: number, element: HTMLElement) => {
    const auswahl = window.getSelection()
    if (!auswahl || auswahl.isCollapsed || auswahl.rangeCount === 0) return
    const { rechtecke, zitat } = auswahlZuRechtecken(auswahl, element)
    if (rechtecke.length === 0 || !zitat) return
    setEntwurf({ seite, zitat, rechtecke })
    setEntwurfText('')
  }, [])

  if (ladefehler) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Die Datei konnte nicht geöffnet werden: {ladefehler}
      </div>
    )
  }

  if (!dokument) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500">
        <Spinner />
        {dateiname} wird geladen …
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <div className="mb-3 flex items-center gap-2">
          <Button variante="umriss" groesse="sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}>
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-14 text-center text-xs text-slate-500">{Math.round(zoom * 100)} %</span>
          <Button variante="umriss" groesse="sm" onClick={() => setZoom((z) => Math.min(3, z + 0.2))}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <span className="ml-2 text-xs text-slate-400">
            Text markieren, um eine Stelle zu kommentieren
          </span>
        </div>

        {/* min-w-fit auf der inneren Spalte: sonst schneidet ein zentriertes
            Flex-Kind, das breiter ist als der Behälter, links ab und wird
            unerreichbar. */}
        <div
          ref={seitenBereich}
          className="max-h-[72vh] overflow-auto rounded-lg bg-slate-200 p-4 duenner-scroll"
        >
          <div className="flex min-w-fit flex-col items-center gap-4">
            {Array.from({ length: dokument.numPages }, (_, i) => i + 1).map((nummer) => (
              <PdfSeite
                key={nummer}
                dokument={dokument}
                nummer={nummer}
                zoom={zoom}
                kommentare={kommentare.filter((k) => k.page === nummer)}
                hervorgehoben={hervorgehoben}
                entwurf={entwurf?.seite === nummer ? entwurf : null}
                onAuswahl={beiAuswahl}
                onMarkierungKlick={setHervorgehoben}
              />
            ))}
          </div>
        </div>
      </div>

      <aside className="min-w-0">
        {entwurf && (
          <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 p-3">
            <p className="mb-2 text-xs font-medium text-brand-900">
              Seite {entwurf.seite} · markierte Stelle
            </p>
            <blockquote className="mb-3 border-l-2 border-brand-300 pl-2 text-xs italic leading-relaxed text-slate-600">
              {entwurf.zitat.slice(0, 200)}
              {entwurf.zitat.length > 200 ? ' …' : ''}
            </blockquote>
            <Textarea
              rows={3}
              value={entwurfText}
              onChange={(e) => setEntwurfText(e.target.value)}
              placeholder="Kommentar …"
              autoFocus
            />
            <div className="mt-2 flex gap-2">
              <Button
                groesse="sm"
                onClick={() => anlegen.mutate()}
                laedt={anlegen.isPending}
                disabled={!entwurfText.trim()}
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
                {t('app.speichern')}
              </Button>
              <Button variante="still" groesse="sm" onClick={() => setEntwurf(null)}>
                {t('app.abbrechen')}
              </Button>
            </div>
          </div>
        )}

        <h3 className="mb-2 text-sm font-semibold text-slate-900">
          Kommentare {kommentare.length > 0 && <span className="text-slate-400">({kommentare.length})</span>}
        </h3>

        {kommentare.length === 0 && !entwurf && (
          <p className="text-sm leading-relaxed text-slate-500">
            Noch keine Kommentare. Markieren Sie eine Textstelle im Dokument.
          </p>
        )}

        <ul className="max-h-[68vh] space-y-2 overflow-y-auto duenner-scroll">
          {kommentare.map((k) => (
            <li
              key={k.id}
              onMouseEnter={() => setHervorgehoben(k.id)}
              onMouseLeave={() => setHervorgehoben(null)}
              className={clsx(
                'rounded-lg border p-3 transition-colors',
                k.resolved ? 'border-slate-200 bg-slate-50' : 'border-amber-200 bg-amber-50/60',
                hervorgehoben === k.id && 'ring-2 ring-brand-400',
              )}
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                <span className="truncate font-medium text-slate-700">{k.user.name}</span>
                <span className="shrink-0">S. {k.page}</span>
              </div>

              {k.quotedText && (
                <blockquote className="mb-1.5 border-l-2 border-slate-300 pl-2 text-xs italic leading-relaxed text-slate-500">
                  {k.quotedText.slice(0, 120)}
                  {k.quotedText.length > 120 ? ' …' : ''}
                </blockquote>
              )}

              <p className={clsx('text-sm leading-relaxed', k.resolved ? 'text-slate-500 line-through' : 'text-slate-800')}>
                {k.body}
              </p>

              <div className="mt-2 flex items-center gap-1 text-xs text-slate-400">
                <span>{formatRelativ(k.createdAt)}</span>
                <button
                  type="button"
                  onClick={() => aendern.mutate({ id: k.id, erledigt: !k.resolved })}
                  className="ml-auto rounded p-1 transition-colors hover:bg-white hover:text-emerald-600"
                  aria-label={k.resolved ? 'Wieder offen' : 'Erledigt'}
                  title={k.resolved ? 'Wieder öffnen' : 'Als erledigt markieren'}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                {(k.user.id === nutzer?.id || nutzer?.role === 'ADMIN') && (
                  <button
                    type="button"
                    onClick={() => loeschen.mutate(k.id)}
                    className="rounded p-1 transition-colors hover:bg-white hover:text-red-600"
                    aria-label={t('app.loeschen')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}

function PdfSeite({
  dokument,
  nummer,
  zoom,
  kommentare,
  hervorgehoben,
  entwurf,
  onAuswahl,
  onMarkierungKlick,
}: {
  dokument: PDFDocumentProxy
  nummer: number
  zoom: number
  kommentare: PdfKommentar[]
  hervorgehoben: string | null
  entwurf: NeuerKommentar | null
  onAuswahl: (seite: number, element: HTMLElement) => void
  onMarkierungKlick: (id: string | null) => void
}) {
  const huelle = useRef<HTMLDivElement>(null)
  const leinwand = useRef<HTMLCanvasElement>(null)
  const textEbene = useRef<HTMLDivElement>(null)
  const [groesse, setGroesse] = useState<{ breite: number; hoehe: number } | null>(null)

  useEffect(() => {
    let abgebrochen = false
    let renderAufgabe: { cancel: () => void } | null = null

    void (async () => {
      const seite = await dokument.getPage(nummer)
      if (abgebrochen) return

      const viewport = seite.getViewport({ scale: zoom })
      const canvas = leinwand.current
      const kontext = canvas?.getContext('2d')
      if (!canvas || !kontext) return

      // Auf hochauflösenden Bildschirmen sonst unscharf.
      const pixelVerhaeltnis = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(viewport.width * pixelVerhaeltnis)
      canvas.height = Math.floor(viewport.height * pixelVerhaeltnis)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      setGroesse({ breite: Math.floor(viewport.width), hoehe: Math.floor(viewport.height) })

      renderAufgabe = seite.render({
        canvasContext: kontext,
        viewport,
        transform: pixelVerhaeltnis !== 1 ? [pixelVerhaeltnis, 0, 0, pixelVerhaeltnis, 0, 0] : undefined,
      })
      await (renderAufgabe as unknown as { promise: Promise<void> }).promise.catch(() => undefined)
      if (abgebrochen) return

      // Die Textebene liegt unsichtbar über der Seite und macht den Text
      // auswählbar – erst dadurch lässt sich eine Passage kommentieren.
      const behaelter = textEbene.current
      if (behaelter) {
        behaelter.replaceChildren()
        behaelter.style.width = `${Math.floor(viewport.width)}px`
        behaelter.style.height = `${Math.floor(viewport.height)}px`
        const ebene = new pdfjs.TextLayer({
          textContentSource: await seite.getTextContent(),
          container: behaelter,
          viewport,
        })
        await ebene.render()
      }
      seite.cleanup()
    })()

    return () => {
      abgebrochen = true
      renderAufgabe?.cancel()
    }
  }, [dokument, nummer, zoom])

  const alleMarkierungen = [
    ...kommentare.map((k) => ({ id: k.id, rechtecke: k.rects, erledigt: k.resolved, entwurf: false })),
    ...(entwurf ? [{ id: '__entwurf__', rechtecke: entwurf.rechtecke, erledigt: false, entwurf: true }] : []),
  ]

  /**
   * Ein Klick ohne Textauswahl auf eine markierte Stelle hebt den zugehörigen
   * Kommentar in der Seitenleiste hervor. Getroffen wird über die Koordinaten,
   * weil die Markierungen selbst keine Zeigerereignisse annehmen dürfen.
   */
  function beiKlick(ereignis: React.MouseEvent<HTMLDivElement>) {
    const auswahl = window.getSelection()
    if (auswahl && !auswahl.isCollapsed) return
    const rahmen = ereignis.currentTarget.getBoundingClientRect()
    const x = (ereignis.clientX - rahmen.left) / rahmen.width
    const y = (ereignis.clientY - rahmen.top) / rahmen.height

    const treffer = kommentare.find((k) =>
      k.rects.some((r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height),
    )
    onMarkierungKlick(treffer?.id ?? null)
  }

  return (
    <div
      ref={huelle}
      className="relative shrink-0 bg-white shadow-md"
      style={groesse ? { width: groesse.breite, height: groesse.hoehe } : undefined}
      onMouseUp={() => huelle.current && onAuswahl(nummer, huelle.current)}
      onClick={beiKlick}
    >
      <canvas ref={leinwand} className="block" />

      {/* Die Markierungen liegen *unter* der Textebene und nehmen keine
          Zeigerereignisse an. Andernfalls ließe sich eine bereits markierte
          Stelle nie wieder mit der Maus auswählen – überlappende Passagen
          wären damit nicht ein zweites Mal kommentierbar. Welche Markierung
          angeklickt wurde, ermittelt beiKlick anhand der Koordinaten. */}
      {alleMarkierungen.map((markierung) =>
        markierung.rechtecke.map((r, i) => (
          <span
            key={`${markierung.id}-${i}`}
            className={clsx(
              'pointer-events-none absolute mix-blend-multiply transition-colors',
              markierung.entwurf
                ? 'bg-brand-300/70'
                : markierung.erledigt
                  ? 'bg-slate-300/60'
                  : 'bg-amber-300/60',
              hervorgehoben === markierung.id && 'bg-brand-400/70 ring-1 ring-brand-500',
            )}
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.width * 100}%`,
              height: `${r.height * 100}%`,
            }}
          />
        )),
      )}

      <div
        ref={textEbene}
        className="pointer-events-auto absolute inset-0 select-text opacity-25 [&>span]:absolute [&>span]:origin-top-left [&>span]:whitespace-pre [&>span]:text-transparent"
        style={{ lineHeight: 1 }}
      />

      <span className="pointer-events-none absolute -left-px bottom-1 rounded-r bg-slate-900/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
        {nummer}
      </span>
    </div>
  )
}
