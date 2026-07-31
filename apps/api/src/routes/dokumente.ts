import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { assertCanEditApplication, assertCanViewApplication } from '../auth/access'
import { currentUser, requireAuth } from '../auth/middleware'
import { prisma } from '../db'
import { env } from '../env'
import { audit } from '../lib/audit'
import { badRequest, notFound, wrap } from '../lib/errors'
import { deleteFile, downloadName, readFileFrom, writeFileTo } from '../lib/storage'
import { body } from '../lib/validate'
import { schlageKategorienVor } from '../pdf/heuristik'
import { nimmSplitZurueck, trenneAuf } from '../pdf/split'
import { extrahiereText, istPdf } from '../pdf/text'

export const dokumenteRouter = Router()

/**
 * Uploads laufen über den Arbeitsspeicher, nicht über eine temporäre Datei:
 * Bewerbungsunterlagen sind klein, und so liegt nie eine ungeprüfte Datei im
 * Dateisystem herum.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 20 },
})

const ERLAUBTE_TYPEN = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'text/plain',
])

dokumenteRouter.post(
  '/bewerbung/:id',
  requireAuth,
  upload.array('dateien', 20),
  wrap(async (req, res) => {
    const me = currentUser(req)
    await assertCanEditApplication(me, req.params.id)

    const dateien = (req.files as Express.Multer.File[] | undefined) ?? []
    if (dateien.length === 0) throw badRequest('Es wurde keine Datei übertragen.')

    const kategorie = z
      .enum(['ANSCHREIBEN', 'LEBENSLAUF', 'ZEUGNISSE', 'ANDERE', 'ORIGINAL'])
      .default('ORIGINAL')
      .parse(req.body?.kategorie ?? 'ORIGINAL')

    const angelegt = []
    for (const datei of dateien) {
      if (!ERLAUBTE_TYPEN.has(datei.mimetype)) {
        throw badRequest(`Dateityp „${datei.mimetype}" wird nicht angenommen (${datei.originalname}).`)
      }

      const ablage = await writeFileTo('dokumente', datei.originalname, datei.buffer)

      let seitenAnzahl: number | null = null
      let text: string | null = null
      if (istPdf(datei.mimetype, datei.originalname)) {
        try {
          const inhalt = await extrahiereText(datei.buffer)
          seitenAnzahl = inhalt.seitenAnzahl
          text = inhalt.gesamtText
        } catch {
          // Gescannt oder geschützt – die Datei bleibt trotzdem nutzbar.
        }
      }

      angelegt.push(
        await prisma.document.create({
          data: {
            applicationId: req.params.id,
            category: kategorie,
            filename: datei.originalname,
            storagePath: ablage.storagePath,
            mimeType: datei.mimetype,
            size: ablage.size,
            pageCount: seitenAnzahl,
            extractedText: text,
            textExtractedAt: text ? new Date() : null,
          },
        }),
      )
    }

    await audit(me.id, 'dokumente-hochgeladen', 'application', req.params.id, {
      anzahl: angelegt.length,
    })
    res.status(201).json(angelegt)
  }),
)

dokumenteRouter.get(
  '/:id/datei',
  requireAuth,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const dokument = await prisma.document.findUnique({ where: { id: req.params.id } })
    if (!dokument) throw notFound('Dieses Dokument gibt es nicht.')
    await assertCanViewApplication(me, dokument.applicationId)

    const inhalt = await readFileFrom(dokument.storagePath)

    // PDFs sollen im eingebauten Betrachter aufgehen, alles andere im
    // Download landen.
    const inline = dokument.mimeType === 'application/pdf' || dokument.mimeType.startsWith('image/')
    res.setHeader('Content-Type', dokument.mimeType)
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${downloadName(dokument.filename)}"`,
    )
    res.setHeader('Content-Length', String(inhalt.byteLength))
    // Dokumente sind personenbezogen – nichts davon gehört in einen Cache.
    res.setHeader('Cache-Control', 'private, no-store')
    res.send(inhalt)
  }),
)

/**
 * Seitenweiser Text plus Vorvorschlag für die Split-Ansicht.
 *
 * Die Vorschaubilder rendert der Browser selbst aus der PDF – so muss der
 * Server keine Bildbibliothek mitschleppen und keine Seitenbilder ablegen.
 */
dokumenteRouter.get(
  '/:id/seiten',
  requireAuth,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const dokument = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: { children: { select: { id: true, category: true, sourcePages: true, filename: true } } },
    })
    if (!dokument) throw notFound('Dieses Dokument gibt es nicht.')
    await assertCanViewApplication(me, dokument.applicationId)

    if (dokument.mimeType !== 'application/pdf') {
      throw badRequest('Nur PDF-Dateien lassen sich auftrennen.')
    }

    const inhalt = await readFileFrom(dokument.storagePath)
    const text = await extrahiereText(inhalt)
    const vorschlaege = schlageKategorienVor(text.seiten)

    // Wurde schon einmal aufgetrennt, zeigt die Ansicht die bestehende
    // Aufteilung statt eines neuen Vorschlags – sonst wäre jede Korrektur
    // nach dem Neuladen wieder weg.
    const bestehend = new Map<number, string>()
    for (const kind of dokument.children) {
      for (const seite of kind.sourcePages) bestehend.set(seite, kind.category)
    }

    res.json({
      dokument: { id: dokument.id, filename: dokument.filename, seitenAnzahl: text.seitenAnzahl },
      bereitsAufgetrennt: dokument.children.length > 0,
      teile: dokument.children,
      seiten: vorschlaege.map((v) => ({
        ...v,
        kategorie: bestehend.get(v.seite) ?? v.kategorie,
        textAuszug: text.seiten.find((s) => s.seite === v.seite)?.text.slice(0, 300) ?? '',
      })),
    })
  }),
)

const splitSchema = z.object({
  zuordnung: z
    .array(
      z.object({
        seite: z.number().int().min(1),
        kategorie: z.enum(['ANSCHREIBEN', 'LEBENSLAUF', 'ZEUGNISSE', 'ANDERE']),
      }),
    )
    .min(1, 'Es wurde keine Seite zugeordnet.')
    .max(500),
})

dokumenteRouter.post(
  '/:id/auftrennen',
  requireAuth,
  body(splitSchema),
  wrap(async (req, res) => {
    const me = currentUser(req)
    const dokument = await prisma.document.findUnique({ where: { id: req.params.id } })
    if (!dokument) throw notFound('Dieses Dokument gibt es nicht.')
    await assertCanEditApplication(me, dokument.applicationId)

    const { zuordnung } = req.body as z.infer<typeof splitSchema>
    const ergebnis = await trenneAuf(req.params.id, zuordnung)

    await audit(me.id, 'pdf-aufgetrennt', 'document', req.params.id, {
      teile: ergebnis.erzeugt.length,
      ersetzt: ergebnis.ersetzt,
    })
    res.json(ergebnis)
  }),
)

dokumenteRouter.post(
  '/:id/split-zuruecknehmen',
  requireAuth,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const dokument = await prisma.document.findUnique({ where: { id: req.params.id } })
    if (!dokument) throw notFound('Dieses Dokument gibt es nicht.')
    await assertCanEditApplication(me, dokument.applicationId)

    const anzahl = await nimmSplitZurueck(req.params.id)
    await audit(me.id, 'pdf-split-zurueckgenommen', 'document', req.params.id, { entfernt: anzahl })
    res.json({ entfernt: anzahl })
  }),
)

const dokumentAenderungsSchema = z.object({
  kategorie: z.enum(['ANSCHREIBEN', 'LEBENSLAUF', 'ZEUGNISSE', 'ANDERE', 'ORIGINAL']).optional(),
  dateiname: z.string().trim().min(1).max(200).optional(),
})

dokumenteRouter.patch(
  '/:id',
  requireAuth,
  body(dokumentAenderungsSchema),
  wrap(async (req, res) => {
    const me = currentUser(req)
    const dokument = await prisma.document.findUnique({ where: { id: req.params.id } })
    if (!dokument) throw notFound('Dieses Dokument gibt es nicht.')
    await assertCanEditApplication(me, dokument.applicationId)

    const d = req.body as z.infer<typeof dokumentAenderungsSchema>
    const aktualisiert = await prisma.document.update({
      where: { id: req.params.id },
      data: {
        ...(d.kategorie ? { category: d.kategorie } : {}),
        ...(d.dateiname ? { filename: d.dateiname } : {}),
      },
    })
    res.json(aktualisiert)
  }),
)

dokumenteRouter.delete(
  '/:id',
  requireAuth,
  wrap(async (req, res) => {
    const me = currentUser(req)
    const dokument = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: { children: { select: { id: true } } },
    })
    if (!dokument) throw notFound('Dieses Dokument gibt es nicht.')
    await assertCanEditApplication(me, dokument.applicationId)

    if (dokument.children.length > 0) {
      throw badRequest(
        `Aus dieser Datei wurden ${dokument.children.length} Teil-PDF(s) erzeugt. ` +
          `Bitte zuerst die Teile löschen oder die Auftrennung zurücknehmen.`,
      )
    }

    await prisma.document.delete({ where: { id: req.params.id } })
    await deleteFile(dokument.storagePath)
    await audit(me.id, 'dokument-geloescht', 'document', req.params.id, {
      bewerbung: dokument.applicationId,
    })
    res.json({ ok: true })
  }),
)
