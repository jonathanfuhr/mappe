/**
 * Serverseitige Textextraktion aus PDFs.
 *
 * Der Text ist die Grundlage für drei Dinge: die regelbasierte Erkennung, die
 * Stichwort-Heuristik der Split-Ansicht und – wenn eingeschaltet – die KI.
 * Letztere bekommt bewusst Text statt der Rohdatei: das spart Tokens und hält
 * Bilder aus der Übertragung heraus.
 */

export interface SeitenText {
  seite: number
  text: string
}

export interface PdfInhalt {
  seiten: SeitenText[]
  gesamtText: string
  seitenAnzahl: number
}

/**
 * pdfjs wird erst bei Bedarf geladen. Das Paket ist groß und wird nur
 * gebraucht, wenn tatsächlich ein PDF hereinkommt – der Serverstart bleibt so
 * schnell und schlank.
 */
// resolution-mode sagt TypeScript, dass dieses Paket als ESM aufzulösen ist –
// aus einer CommonJS-Datei heraus wäre das sonst mehrdeutig.
type PdfjsModul = typeof import('pdfjs-dist/legacy/build/pdf.mjs', {
  with: { 'resolution-mode': 'import' }
})
let pdfjsPromise: Promise<PdfjsModul> | null = null

async function ladePdfjs(): Promise<PdfjsModul> {
  if (!pdfjsPromise) {
    // Die Legacy-Variante läuft ohne Browser-APIs und ist die für Node
    // vorgesehene. pdfjs liefert nur noch ESM – das import() bleibt dank
    // "module": "node16" auch im erzeugten CommonJS stehen.
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs')
  }
  return pdfjsPromise
}

export async function extrahiereText(daten: Buffer): Promise<PdfInhalt> {
  const pdfjs = await ladePdfjs()

  const dokument = await pdfjs.getDocument({
    data: new Uint8Array(daten),
    // Keine externen Schriften oder Karten nachladen – der Server hat kein
    // Internet zu haben, um eine Bewerbung zu lesen.
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise

  try {
    const seiten: SeitenText[] = []
    for (let nummer = 1; nummer <= dokument.numPages; nummer++) {
      const seite = await dokument.getPage(nummer)
      const inhalt = await seite.getTextContent()

      // pdfjs liefert Textfragmente ohne Zeilenumbrüche. Der y-Wert verrät,
      // wann eine neue Zeile beginnt – ohne das klebt der ganze Lebenslauf
      // in einer einzigen Zeile und die Muster greifen nicht mehr.
      let text = ''
      let letztesY: number | null = null
      for (const eintrag of inhalt.items) {
        if (!('str' in eintrag)) continue
        const y = Math.round(eintrag.transform[5])
        if (letztesY !== null && Math.abs(y - letztesY) > 2) text += '\n'
        else if (text && !text.endsWith(' ') && !text.endsWith('\n')) text += ' '
        text += eintrag.str
        letztesY = y
      }

      seiten.push({ seite: nummer, text: text.replace(/[ \t]+/g, ' ').trim() })
      seite.cleanup()
    }

    return {
      seiten,
      gesamtText: seiten.map((s) => s.text).join('\n\n'),
      seitenAnzahl: dokument.numPages,
    }
  } finally {
    await dokument.destroy()
  }
}

/** Nur die Seitenzahl – deutlich billiger als die volle Extraktion. */
export async function zaehleSeiten(daten: Buffer): Promise<number> {
  const pdfjs = await ladePdfjs()
  const dokument = await pdfjs.getDocument({
    data: new Uint8Array(daten),
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise
  try {
    return dokument.numPages
  } finally {
    await dokument.destroy()
  }
}

export function istPdf(mimeTyp: string, dateiname: string): boolean {
  return mimeTyp === 'application/pdf' || /\.pdf$/i.test(dateiname)
}
