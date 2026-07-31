/** Datentypen, wie die API sie liefert. */

export type Phase =
  | 'NEU'
  | 'GESICHTET'
  | 'IN_PRUEFUNG'
  | 'EINGELADEN'
  | 'GESPRAECH_GEFUEHRT'
  | 'ENTSCHEIDUNG'
  | 'ZUSAGE'
  | 'ABSAGE'
  | 'ARCHIV'

export const PHASEN: Phase[] = [
  'NEU',
  'GESICHTET',
  'IN_PRUEFUNG',
  'EINGELADEN',
  'GESPRAECH_GEFUEHRT',
  'ENTSCHEIDUNG',
  'ZUSAGE',
  'ABSAGE',
  'ARCHIV',
]

export type Quelle = 'EMAIL' | 'WEBSITE_FORMULAR' | 'LINKEDIN' | 'INDEED' | 'MANUELL' | 'SONSTIGE'
export const QUELLEN: Quelle[] = ['EMAIL', 'WEBSITE_FORMULAR', 'LINKEDIN', 'INDEED', 'MANUELL', 'SONSTIGE']

export type Anrede = 'KEINE' | 'FRAU' | 'HERR' | 'DIVERS'
export type Kategorie = 'ANSCHREIBEN' | 'LEBENSLAUF' | 'ZEUGNISSE' | 'ANDERE' | 'ORIGINAL'
export const KATEGORIEN: Kategorie[] = ['ANSCHREIBEN', 'LEBENSLAUF', 'ZEUGNISSE', 'ANDERE']
export type Urteil = 'JA' | 'VIELLEICHT' | 'NEIN'
export type StellenStatus = 'ENTWURF' | 'OFFEN' | 'GESCHLOSSEN'

export interface Stelle {
  id: string
  title: string
  reference: string | null
  location: string | null
  department: string | null
  employment: string | null
  description: string
  keywords: string[]
  status: StellenStatus
  speculative: boolean
  openedAt: string
  closedAt: string | null
  bewerbungenGesamt?: number
  bewerbungenOffen?: number
  assignments?: { userId: string; user: { id: string; name: string; email: string } }[]
}

export interface BewerberKurz {
  id: string
  salutation: Anrede
  title: string | null
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  city?: string | null
}

export interface Bewerber extends BewerberKurz {
  street: string | null
  postalCode: string | null
  country: string | null
  links: { label: string; url: string }[]
  storageConsent: boolean
  storageConsentDate: string | null
  purgeDueAt: string | null
  createdAt: string
  applications?: BewerbungKurz[]
  notes?: Notiz[]
}

export interface Bewertung {
  schnitt: number | null
  anzahl: number
  ja: number
  vielleicht: number
  nein: number
}

export interface BewerbungKurz {
  id: string
  stage: Phase
  stageChangedAt: string
  source: Quelle
  speculative: boolean
  subject: string | null
  summary: string | null
  needsReview: boolean
  appliedAt: string
  boardOrder: number
  candidate: BewerberKurz
  job: { id: string; title: string; reference: string | null; speculative: boolean } | null
  bewertung: Bewertung
  _count?: { documents: number; mails: number; notes: number }
}

export interface Dokument {
  id: string
  category: Kategorie
  filename: string
  mimeType: string
  size: number
  pageCount: number | null
  parentId: string | null
  sourcePages: number[]
  extractedText: string | null
  createdAt: string
}

export interface MailAnhang {
  id: string
  filename: string
  mimeType: string
  size: number
  documentId: string | null
}

export interface MailNachricht {
  id: string
  direction: 'EINGEHEND' | 'AUSGEHEND'
  status: 'IMPORTIERT' | 'ENTWURF' | 'GESENDET' | 'FEHLGESCHLAGEN'
  subject: string
  fromName: string
  fromEmail: string
  toEmails: string[]
  ccEmails: string[]
  bodyText: string
  bodyHtml: string | null
  forwarded: boolean
  originalFromEmail: string | null
  originalFromName: string | null
  emlPath: string | null
  receivedAt: string | null
  sentAt: string | null
  error: string | null
  createdAt: string
  attachments: MailAnhang[]
  sentBy?: { id: string; name: string } | null
}

export interface Notiz {
  id: string
  kind: 'ALLGEMEIN' | 'GESPRAECH'
  body: string
  createdAt: string
  user: { id: string; name: string }
}

export interface EinzelBewertung {
  id: string
  stars: number
  verdict: Urteil | null
  comment: string | null
  createdAt: string
  user: { id: string; name: string }
}

export interface Vorschlag {
  id: string
  source: 'REGELN' | 'KI'
  model: string | null
  payload: {
    bewerber?: Record<string, unknown>
    stelle?: { jobId: string | null; sicherheit: number; begruendung: string; initiativ: boolean }
    weiterleitung?: {
      erkannt: boolean
      quelle?: string
      urspruenglicherAbsender?: { name: string; email: string } | null
      vonZeile?: { name: string; email: string }
    }
    quelle?: Quelle
  }
  appliedAt: string | null
  createdAt: string
}

export interface Gespraech {
  id: string
  title: string
  conductedAt: string | null
  answers: Record<string, string>
  notes: string
  createdAt: string
  user: { id: string; name: string }
  template: { id: string; name: string; sections: GespraechsAbschnitt[] } | null
}

export interface GespraechsAbschnitt {
  title: string
  questions: { id: string; text: string; hint?: string }[]
}

export interface Bewerbung extends BewerbungKurz {
  candidate: Bewerber & BewerberKurz
  job: (Stelle & { id: string; title: string; reference: string | null; speculative: boolean }) | null
  documents: Dokument[]
  mails: MailNachricht[]
  ratings: EinzelBewertung[]
  notes: Notiz[]
  interviews: Gespraech[]
  assignments: { userId: string; user: { id: string; name: string; email: string } }[]
  suggestions: Vorschlag[]
  closedAt: string | null
  purgeDueAt: string | null
  reviewedAt: string | null
}

export interface MailStatus {
  adapter: 'aus' | 'graph' | 'imap' | 'gmail'
  adapterName: string
  automatischAbrufen: boolean
  intervallSekunden: number
  laeuft: boolean
  letzterAbruf: string | null
  letzterFehler: string | null
  erstAbrufSteht: boolean
  regeln: { alsGelesenMarkieren: boolean; inOrdnerVerschieben: boolean; ordnerName: string }
  weiterleitungsAdressen: string[]
  verfuegbareAdapter: { schluessel: string; name: string; verfuegbar: boolean }[]
}

export interface SyncErgebnis {
  adapter: string
  gepruefte: number
  neueBewerbungen: number
  angehaengteAntworten: number
  uebersprungen: number
  fehler: { nachricht: string; grund: string }[]
  abgebrochen?: string
}

export interface NutzerKurz {
  id: string
  name: string
  email: string
  role: 'ADMIN' | 'RECRUITER' | 'INTERVIEWER'
  active: boolean
}

export interface Uebersicht {
  phasen: Partial<Record<Phase, number>>
  gesamt: number
  laufend: number
  zuPruefen: number
  offeneStellen: number
  letzte: {
    id: string
    stage: Phase
    appliedAt: string
    needsReview: boolean
    source: Quelle
    candidate: { firstName: string; lastName: string; email: string | null }
    job: { title: string } | null
  }[]
}

/** Vollständiger Name mit Rückfallebene, wenn die Erkennung nichts fand. */
export function vollerName(b: { firstName: string; lastName: string; email?: string | null }): string {
  const name = [b.firstName, b.lastName].filter(Boolean).join(' ').trim()
  return name || b.email || 'Ohne Namen'
}
