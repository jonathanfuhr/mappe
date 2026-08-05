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
