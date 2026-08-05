import { Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ladeDokument, pdfjs, type PDFDocumentProxy } from '../lib/pdf'
import { Button, Spinner } from './ui'

/**
 * PDF-Betrachter: rendert die Datei im Browser, mehr nicht.
 *
 * Die PDF selbst wird nie angefasst. Wer sie herunterlädt, bekommt exakt die
 * Datei, die der Bewerber geschickt hat.
 */
export function PdfBetrachter({ dokumentId, dateiname }: { dokumentId: string; dateiname: string }) {
  const [dokument, setDokument] = useState<PDFDocumentProxy | null>(null)
  const [ladefehler, setLadefehler] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [zoomGesetzt, setZoomGesetzt] = useState(false)
  const seitenBereich = useRef<HTMLDivElement>(null)

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
    <div className="min-w-0">
      <div className="mb-3 flex items-center gap-2">
        <Button variante="umriss" groesse="sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}>
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="w-14 text-center text-xs text-slate-500">{Math.round(zoom * 100)} %</span>
        <Button variante="umriss" groesse="sm" onClick={() => setZoom((z) => Math.min(3, z + 0.2))}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
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
            <PdfSeite key={nummer} dokument={dokument} nummer={nummer} zoom={zoom} />
          ))}
        </div>
      </div>
    </div>
  )
}

function PdfSeite({
  dokument,
  nummer,
  zoom,
}: {
  dokument: PDFDocumentProxy
  nummer: number
  zoom: number
}) {
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

      // Die Textebene liegt unsichtbar über der Seite. Sie macht den Text
      // markierbar – ohne sie ließe sich aus einem Lebenslauf keine Adresse
      // und keine Telefonnummer herauskopieren.
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

  return (
    <div
      className="relative shrink-0 bg-white shadow-md"
      style={groesse ? { width: groesse.breite, height: groesse.hoehe } : undefined}
    >
      <canvas ref={leinwand} className="block" />

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
