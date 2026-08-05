import { simpleParser, type Attachment, type ParsedMail } from 'mailparser'

/**
 * Eine Nachricht, wie der Rest des Tools sie sieht – unabhängig davon, ob sie
 * von Graph, IMAP oder Gmail kam.
 */
export interface GeparsteMail {
  internetMessageId: string | null
  conversationId: string | null
  betreff: string
  von: Adresse
  an: Adresse[]
  kopie: Adresse[]
  textInhalt: string
  htmlInhalt: string | null
  eingegangenAm: Date
  anhaenge: GeparsterAnhang[]
  /** Ergebnis der Weiterleitungs-Erkennung. */
  weiterleitung: WeiterleitungsBefund
  /** Rohe Kopfzeilen – für Parser einzelner Portale (Indeed, LinkedIn). */
  kopfzeilen: Record<string, string>
}

export interface Adresse {
  name: string
  email: string
}

export interface GeparsterAnhang {
  dateiname: string
  mimeTyp: string
  inhalt: Buffer
  groesse: number
  /** Inline eingebettete Bilder (Signaturlogos) sind meist kein Dokument. */
  inline: boolean
}

export interface WeiterleitungsBefund {
  erkannt: boolean
  /** Der ursprüngliche Absender, sofern ermittelbar. */
  urspruenglicherAbsender: Adresse | null
  /** Woran es erkannt wurde – wird in der Oberfläche als Begründung gezeigt. */
  quelle: 'kein' | 'angehaengte-nachricht' | 'kopfzeile' | 'inline-text'
}

export async function parseMime(mime: Buffer, weiterleitungsAdressen: string[] = []): Promise<GeparsteMail> {
  const geparst = await simpleParser(mime, {
    // Der Text wird sowieso weiterverarbeitet; HTML brauchen wir zur Anzeige.
    skipTextLinks: true,
    skipImageLinks: true,
  })

  const von = ersteAdresse(geparst.from?.value) ?? { name: '', email: '' }
  const anhaenge = geparst.attachments.map(zuAnhang)

  const kopfzeilen: Record<string, string> = {}
  for (const [schluessel, wert] of geparst.headers) {
    if (typeof wert === 'string') kopfzeilen[schluessel.toLowerCase()] = wert
  }

  return {
    internetMessageId: geparst.messageId ?? null,
    // Exchange liefert keine Conversation-ID im MIME; wir bilden sie später
    // aus Betreff und Absender.
    conversationId: null,
    betreff: (geparst.subject ?? '').trim(),
    von,
    an: adressListe(geparst.to),
    kopie: adressListe(geparst.cc),
    textInhalt: (geparst.text ?? '').trim(),
    htmlInhalt: typeof geparst.html === 'string' ? geparst.html : null,
    eingegangenAm: geparst.date ?? new Date(),
    anhaenge,
    weiterleitung: await erkenneWeiterleitung(geparst, von, weiterleitungsAdressen),
    kopfzeilen,
  }
}

/**
 * Weiterleitungs-Erkennung.
 *
 * Wird eine Bewerbung von info@ an das Bewerbungspostfach weitergeleitet,
 * steht in der Von-Zeile das Verteilerpostfach – nicht der Bewerber. Wer
 * darauf antwortet, schreibt an sich selbst. Deshalb suchen wir den echten
 * Absender in drei Stufen, von der zuverlässigsten zur schwächsten:
 *
 *   1. Ein angehängtes message/rfc822 (Outlook „als Anlage weiterleiten")
 *   2. Kopfzeilen, die Umleitungen hinterlassen (Resent-From, X-Forwarded-For)
 *   3. Der eingebettete Vorspann im Text („Von: … Gesendet: … An: …")
 *
 * Sauberer als jede Erkennung bleibt die Regel in Exchange als *Umleiten*
 * statt „Weiterleiten" anzulegen – dann steht der Bewerber ohnehin im From.
 */
async function erkenneWeiterleitung(
  geparst: ParsedMail,
  von: Adresse,
  weiterleitungsAdressen: string[],
): Promise<WeiterleitungsBefund> {
  const kein: WeiterleitungsBefund = {
    erkannt: false,
    urspruenglicherAbsender: null,
    quelle: 'kein',
  }

  const absender = von.email.toLowerCase()
  const listeGesetzt = weiterleitungsAdressen.length > 0
  const vonVerteiler = weiterleitungsAdressen.includes(absender)

  // Ist eine Verteilerliste gepflegt, greift die Erkennung nur für diese
  // Adressen. Ohne Liste prüfen wir jede Nachricht – das kostet nichts und
  // fängt den Fall ab, dass die Adresse noch nicht eingetragen wurde.
  if (listeGesetzt && !vonVerteiler) return kein

  // --- Stufe 1: angehängte Originalnachricht --------------------------------
  const angehaengt = geparst.attachments.find(
    (a) => a.contentType === 'message/rfc822' || /\.eml$/i.test(a.filename ?? ''),
  )
  if (angehaengt?.content) {
    try {
      const original = await simpleParser(angehaengt.content)
      const originalVon = ersteAdresse(original.from?.value)
      if (originalVon?.email && originalVon.email.toLowerCase() !== absender) {
        return { erkannt: true, urspruenglicherAbsender: originalVon, quelle: 'angehaengte-nachricht' }
      }
    } catch {
      // Kein lesbares RFC822 – weiter mit den anderen Stufen.
    }
  }

  // --- Stufe 2: Kopfzeilen --------------------------------------------------
  for (const name of ['resent-from', 'x-forwarded-for', 'x-original-from', 'x-original-sender']) {
    const wert = geparst.headers.get(name)
    const adresse = typeof wert === 'string' ? adresseAusText(wert) : null
    if (adresse && adresse.email.toLowerCase() !== absender) {
      return { erkannt: true, urspruenglicherAbsender: adresse, quelle: 'kopfzeile' }
    }
  }
  // Reply-To zählt nur, wenn die Nachricht wirklich über den Verteiler kam –
  // sonst wäre jede Mail mit abweichender Antwortadresse eine Weiterleitung.
  if (vonVerteiler) {
    const antwortAn = ersteAdresse(geparst.replyTo?.value)
    if (antwortAn?.email && antwortAn.email.toLowerCase() !== absender) {
      return { erkannt: true, urspruenglicherAbsender: antwortAn, quelle: 'kopfzeile' }
    }
  }

  // --- Stufe 3: eingebetteter Vorspann im Text ------------------------------
  const ausText = absenderAusInlineWeiterleitung(geparst.text ?? '')
  if (ausText && ausText.email.toLowerCase() !== absender) {
    return { erkannt: true, urspruenglicherAbsender: ausText, quelle: 'inline-text' }
  }

  return kein
}

/**
 * Liest den Absender aus einem eingebetteten Weiterleitungs-Vorspann.
 * Abgedeckt sind die Schreibweisen von Outlook (deutsch und englisch),
 * Gmail und Apple Mail.
 */
export function absenderAusInlineWeiterleitung(text: string): Adresse | null {
  if (!text) return null

  const marker =
    /(-{2,}\s*(Urspr[üu]ngliche Nachricht|Original Message|Weitergeleitete Nachricht|Forwarded message)\s*-{2,})|(^|\n)\s*Anfang der weitergeleiteten Nachricht/i
  const trefferMarker = marker.exec(text)
  // Ab dem Marker suchen; ohne Marker im ganzen Text, aber nur die ersten
  // Zeilen – weiter unten stehen oft Zitate anderer Beteiligter.
  const bereich = trefferMarker
    ? text.slice(trefferMarker.index, trefferMarker.index + 1500)
    : text.slice(0, 1200)

  const zeilenMuster = [
    /^\s*(?:Von|From|Absender)\s*:\s*(.+)$/im,
    /^\s*(?:Gesendet von|Sent by)\s*:\s*(.+)$/im,
  ]
  for (const muster of zeilenMuster) {
    const treffer = muster.exec(bereich)
    if (treffer?.[1]) {
      const adresse = adresseAusText(treffer[1])
      if (adresse) return adresse
    }
  }
  return null
}

/** Zieht "Name <mail@example.com>" oder eine nackte Adresse aus einem Text. */
export function adresseAusText(text: string): Adresse | null {
  const spitz = /<\s*([^<>\s@]+@[^<>\s@]+\.[a-z]{2,})\s*>/i.exec(text)
  if (spitz?.[1]) {
    const name = text.slice(0, spitz.index).replace(/["']/g, '').trim()
    return { name: name.replace(/[,;]$/, '').trim(), email: spitz[1].toLowerCase() }
  }
  const nackt = /([^\s<>@,;"']+@[^\s<>@,;"']+\.[a-z]{2,})/i.exec(text)
  if (nackt?.[1]) {
    const name = text.slice(0, nackt.index).replace(/["']/g, '').trim()
    return { name: name.replace(/[,;-]$/, '').trim(), email: nackt[1].toLowerCase() }
  }
  return null
}

// --- Hilfsfunktionen --------------------------------------------------------

type AdressWert = { address?: string; name?: string }

function ersteAdresse(werte: AdressWert[] | undefined): Adresse | null {
  const erster = werte?.find((w) => w.address)
  if (!erster?.address) return null
  return { name: (erster.name ?? '').trim(), email: erster.address.toLowerCase() }
}

function adressListe(feld: ParsedMail['to']): Adresse[] {
  if (!feld) return []
  const alle = Array.isArray(feld) ? feld : [feld]
  return alle
    .flatMap((eintrag) => eintrag.value)
    .filter((w) => w.address)
    .map((w) => ({ name: (w.name ?? '').trim(), email: w.address!.toLowerCase() }))
}

function zuAnhang(anhang: Attachment): GeparsterAnhang {
  const inhalt = Buffer.isBuffer(anhang.content) ? anhang.content : Buffer.from(anhang.content ?? '')
  return {
    dateiname: (anhang.filename ?? 'anhang').trim() || 'anhang',
    mimeTyp: anhang.contentType ?? 'application/octet-stream',
    inhalt,
    groesse: inhalt.byteLength,
    // Eine Content-ID allein macht einen Anhang **nicht** eingebettet: Outlook
    // und Gmail vergeben sie auch für ganz normale Dateianhänge. Genau daran
    // sind die ersten echten Bewerbungen gescheitert – die PDFs wurden
    // wortlos verworfen, weil Exchange ihnen eine cid mitgegeben hatte.
    //
    // Maßgeblich ist, ob der Anhang im HTML-Text auch wirklich benutzt wird.
    // Das beantwortet `related`: mailparser setzt es genau dann, wenn eine
    // Stelle im HTML per `cid:` darauf zeigt – der Fall des Signaturlogos.
    inline: anhang.contentDisposition === 'inline' || anhang.related === true,
  }
}

/**
 * Bildet eine Verlaufs-Kennung aus normalisiertem Betreff und Gegenstelle.
 * Graph liefert zwar eine conversationId, aber IMAP nicht – so verhalten sich
 * beide gleich und Antworten hängen sich zuverlässig an.
 */
export function bildeVerlaufsKennung(betreff: string, gegenstelle: string): string {
  const normalisiert = betreff
    .replace(/^(\s*(re|aw|antw|fwd|fw|wg|weiterleitung)\s*(\[\d+\])?\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  return `${gegenstelle.toLowerCase()}::${normalisiert}`
}
