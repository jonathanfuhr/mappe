import { getSetting } from '../settings/service'
import { GraphAdapter } from './graph'
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
    case 'gmail':
      throw new MailFehler(
        `Der Adapter „${mail.adapter}" ist in dieser Fassung noch nicht enthalten. ` +
          `Zurzeit steht Microsoft 365 (Graph) bereit.`,
      )
    default:
      throw new MailFehler(`Unbekannter Mail-Adapter: ${String(mail.adapter)}`)
  }
}

export const VERFUEGBARE_ADAPTER = [
  { schluessel: 'aus', name: 'Kein Postfach angebunden', verfuegbar: true },
  { schluessel: 'graph', name: 'Microsoft 365 (Graph API)', verfuegbar: true },
  { schluessel: 'imap', name: 'IMAP/SMTP (iCloud, Hoster)', verfuegbar: false },
  { schluessel: 'gmail', name: 'Google Workspace (Gmail API)', verfuegbar: false },
] as const
