import type { DocumentCategory } from '@prisma/client'
import { PDFDocument } from 'pdf-lib'
import { prisma } from '../db'
import { badRequest } from '../lib/errors'
import { deleteFile, readFileFrom, writeFileTo } from '../lib/storage'
import { fasseZuBereichen } from './heuristik'
import { extrahiereText } from './text'

/**
 * Trennt ein Kombi-PDF in Teildokumente auf.
 *
 * Zwei Zusagen, auf die man sich verlassen können muss:
 *   1. Das Original bleibt unangetastet erhalten.
 *   2. Zusammenhängende Seiten bleiben in einer Datei – ein dreiseitiges
 *      Zeugnis wird nicht zu drei Einzeldateien.
 *
 * Beim erneuten Auftrennen werden die zuvor erzeugten Teile ersetzt, nicht
 * ergänzt. Sonst sammelt sich bei jeder Korrektur ein weiterer Satz an.
 */

export interface SplitZuordnung {
  seite: number
  kategorie: DocumentCategory
}

export interface SplitErgebnis {
  erzeugt: { id: string; kategorie: DocumentCategory; seiten: number[]; dateiname: string }[]
  ersetzt: number
}

export async function trenneAuf(
  dokumentId: string,
  zuordnung: SplitZuordnung[],
): Promise<SplitErgebnis> {
  const original = await prisma.document.findUnique({
    where: { id: dokumentId },
    include: { children: { select: { id: true, storagePath: true } } },
  })
  if (!original) throw badRequest('Dieses Dokument gibt es nicht.')
  if (original.mimeType !== 'application/pdf') {
    throw badRequest('Nur PDF-Dateien lassen sich auftrennen.')
  }

  const daten = await readFileFrom(original.storagePath)
  const quelle = await PDFDocument.load(daten, { ignoreEncryption: true })
  const seitenAnzahl = quelle.getPageCount()

  const gueltig = zuordnung.filter((z) => z.seite >= 1 && z.seite <= seitenAnzahl)
  if (gueltig.length === 0) throw badRequest('Es wurde keine Seite zugeordnet.')

  const bereiche = fasseZuBereichen(gueltig)
  const basisName = original.filename.replace(/\.pdf$/i, '')

  // Frühere Teile derselben Datei entfernen – die neue Aufteilung ersetzt sie.
  const alteIds = original.children.map((k) => k.id)
  if (alteIds.length > 0) {
    await prisma.document.deleteMany({ where: { id: { in: alteIds } } })
    // Erst nach dem Löschen des Datensatzes die Datei entfernen: bricht der
    // Vorgang dazwischen ab, ist eine verwaiste Datei harmlos, ein
    // Datensatz ohne Datei dagegen nicht.
    for (const kind of original.children) await deleteFile(kind.storagePath)
  }

  const erzeugt: SplitErgebnis['erzeugt'] = []
  const zaehlerJeKategorie = new Map<DocumentCategory, number>()

  for (const bereich of bereiche) {
    const nummer = (zaehlerJeKategorie.get(bereich.kategorie) ?? 0) + 1
    zaehlerJeKategorie.set(bereich.kategorie, nummer)

    const ziel = await PDFDocument.create()
    // pdf-lib zählt ab 0, unsere Seitenzahlen ab 1.
    const kopiert = await ziel.copyPages(
      quelle,
      bereich.seiten.map((s) => s - 1),
    )
    for (const seite of kopiert) ziel.addPage(seite)

    const inhalt = Buffer.from(await ziel.save())
    const mehrfach = bereiche.filter((b) => b.kategorie === bereich.kategorie).length > 1
    const dateiname = `${basisName} – ${LESBAR[bereich.kategorie]}${mehrfach ? ` ${nummer}` : ''}.pdf`

    const ablage = await writeFileTo('dokumente', dateiname, inhalt)

    let text: string | null = null
    try {
      text = (await extrahiereText(inhalt)).gesamtText
    } catch {
      // Ohne Text bleibt das Teil trotzdem nutzbar.
    }

    const dokument = await prisma.document.create({
      data: {
        applicationId: original.applicationId,
        category: bereich.kategorie,
        filename: dateiname,
        storagePath: ablage.storagePath,
        mimeType: 'application/pdf',
        size: ablage.size,
        pageCount: bereich.seiten.length,
        parentId: original.id,
        sourcePages: bereich.seiten,
        extractedText: text,
        textExtractedAt: text ? new Date() : null,
      },
    })

    erzeugt.push({
      id: dokument.id,
      kategorie: bereich.kategorie,
      seiten: bereich.seiten,
      dateiname,
    })
  }

  // Das Original bleibt als solches gekennzeichnet erhalten.
  await prisma.document.update({
    where: { id: original.id },
    data: { category: 'ORIGINAL' },
  })

  return { erzeugt, ersetzt: alteIds.length }
}

const LESBAR: Record<DocumentCategory, string> = {
  ANSCHREIBEN: 'Anschreiben',
  LEBENSLAUF: 'Lebenslauf',
  ZEUGNISSE: 'Zeugnis',
  ANDERE: 'Weitere Unterlagen',
  ORIGINAL: 'Original',
}

/** Nimmt eine Auftrennung zurück und entfernt alle daraus entstandenen Teile. */
export async function nimmSplitZurueck(dokumentId: string): Promise<number> {
  const kinder = await prisma.document.findMany({
    where: { parentId: dokumentId },
    select: { id: true, storagePath: true },
  })
  if (kinder.length === 0) return 0
  await prisma.document.deleteMany({ where: { parentId: dokumentId } })
  for (const kind of kinder) await deleteFile(kind.storagePath)
  return kinder.length
}
