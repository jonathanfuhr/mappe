import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'

/**
 * PDFs werden im Browser gerendert, nicht auf dem Server.
 *
 * Das hat zwei Gründe: Der Server braucht dadurch keine Bildbibliothek
 * (node-canvas ist ein nativer Klotz im Container), und es entstehen keine
 * Seitenbilder, die neben der PDF liegen und mitgelöscht werden müssten.
 */

// Der Worker wird von Vite mitgebündelt – kein Zugriff auf ein fremdes CDN.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export { pdfjs }
export type { PDFDocumentProxy }

const zwischenlager = new Map<string, Promise<PDFDocumentProxy>>()

/** Lädt ein Dokument und merkt es sich, damit ein Wechsel der Ansicht nichts neu lädt. */
export function ladeDokument(dokumentId: string): Promise<PDFDocumentProxy> {
  const vorhanden = zwischenlager.get(dokumentId)
  if (vorhanden) return vorhanden

  const geladen = pdfjs
    .getDocument({
      url: `/api/dokumente/${dokumentId}/datei`,
      withCredentials: true,
      // Keine Standardschriften oder Karten nachladen: Die Anwendung soll
      // auch in einem Netz ohne Internetzugang vollständig funktionieren.
      disableFontFace: false,
      isEvalSupported: false,
    })
    .promise

  zwischenlager.set(dokumentId, geladen)
  // Fehlgeschlagene Ladevorgänge nicht dauerhaft merken.
  geladen.catch(() => zwischenlager.delete(dokumentId))
  return geladen
}

export function vergissDokument(dokumentId: string): void {
  const vorhanden = zwischenlager.get(dokumentId)
  if (vorhanden) {
    void vorhanden.then((d) => d.destroy()).catch(() => undefined)
    zwischenlager.delete(dokumentId)
  }
}

export interface RelativesRechteck {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Rechnet die Rechtecke einer Textauswahl in seitenrelative Koordinaten um.
 *
 * Relativ zu speichern ist wichtig: Die Markierung muss auch dann sitzen,
 * wenn dieselbe Seite später in einer anderen Größe angezeigt wird.
 */
export function auswahlZuRechtecken(
  auswahl: Selection,
  seitenElement: HTMLElement,
): { rechtecke: RelativesRechteck[]; zitat: string } {
  const seitenRahmen = seitenElement.getBoundingClientRect()
  const rechtecke: RelativesRechteck[] = []

  for (let i = 0; i < auswahl.rangeCount; i++) {
    for (const rahmen of Array.from(auswahl.getRangeAt(i).getClientRects())) {
      // Auswahlrechtecke ohne Fläche entstehen an Zeilenumbrüchen.
      if (rahmen.width < 1 || rahmen.height < 1) continue
      rechtecke.push({
        x: (rahmen.left - seitenRahmen.left) / seitenRahmen.width,
        y: (rahmen.top - seitenRahmen.top) / seitenRahmen.height,
        width: rahmen.width / seitenRahmen.width,
        height: rahmen.height / seitenRahmen.height,
      })
    }
  }

  return { rechtecke, zitat: auswahl.toString().replace(/\s+/g, ' ').trim().slice(0, 2000) }
}
