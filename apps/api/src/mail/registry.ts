import { getSetting } from '../settings/service'
import { GmailAdapter } from './gmail'
import { GraphAdapter } from './graph'
import { ImapAdapter } from './imap'
import { MailFehler, type MailAdapter } from './types'

/**
 * Baut den aktiven Adapter aus den Einstellungen. Neue Anbieter werden hier
 * eingehängt – der Rest des Tools kennt nur die Schnittstelle.
 */
export async function holeAdapter(): Promise<MailAdapter | null> {
  const mail = await getSetting('mail')
  if (mail.adapter === 'aus') return null

  switch (mail.adapter) {
    case 'graph':
      return new GraphAdapter(mail.graph)
    case 'imap':
      return new ImapAdapter(mail.imap)
    case 'gmail':
      return new GmailAdapter(mail.gmail)
    default:
      throw new MailFehler(`Unbekannter Mail-Adapter: ${String(mail.adapter)}`)
  }
}

export const VERFUEGBARE_ADAPTER = [
  { schluessel: 'aus', name: 'Kein Postfach angebunden', verfuegbar: true },
  { schluessel: 'graph', name: 'Microsoft 365 (Graph API)', verfuegbar: true },
  { schluessel: 'imap', name: 'IMAP/SMTP (iCloud, Hoster)', verfuegbar: true },
  { schluessel: 'gmail', name: 'Google Workspace (Gmail API)', verfuegbar: true },
] as const
