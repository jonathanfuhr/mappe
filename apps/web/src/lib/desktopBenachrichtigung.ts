/**
 * Desktop-Benachrichtigungen über die Notifications-API des Browsers.
 *
 * Zwei Grenzen, die die Oberfläche auch benennt, statt sie zu verschweigen:
 * Es braucht eine Erlaubnis, und es wirkt nur, solange Mappe in einem Tab
 * geöffnet ist. Für Meldungen bei geschlossenem Browser bräuchte es einen
 * Service Worker und einen Push-Dienst – also einen Server, an den Daten
 * gehen. Genau das will Mappe nicht.
 */

const SCHLUESSEL = 'mappe.desktopBenachrichtigungen'

export type ErlaubnisStand = 'nicht-unterstuetzt' | 'offen' | 'erlaubt' | 'blockiert'

export function erlaubnisStand(): ErlaubnisStand {
  if (typeof Notification === 'undefined') return 'nicht-unterstuetzt'
  if (Notification.permission === 'granted') return 'erlaubt'
  if (Notification.permission === 'denied') return 'blockiert'
  return 'offen'
}

/** Der eigene Schalter – unabhängig von der Erlaubnis des Browsers. */
export function istEingeschaltet(): boolean {
  return localStorage.getItem(SCHLUESSEL) === 'an'
}

export function schalte(an: boolean): void {
  localStorage.setItem(SCHLUESSEL, an ? 'an' : 'aus')
}

export async function frageErlaubnis(): Promise<ErlaubnisStand> {
  if (typeof Notification === 'undefined') return 'nicht-unterstuetzt'
  // Ein bereits blockiertes Recht lässt sich nicht erneut erfragen – der
  // Browser zeigt den Dialog dann gar nicht mehr.
  if (Notification.permission === 'denied') return 'blockiert'
  const antwort = await Notification.requestPermission()
  return antwort === 'granted' ? 'erlaubt' : antwort === 'denied' ? 'blockiert' : 'offen'
}

export function zeige(titel: string, text: string, aufKlick?: () => void): void {
  if (!istEingeschaltet() || erlaubnisStand() !== 'erlaubt') return
  try {
    const meldung = new Notification(titel, { body: text, icon: '/favicon.svg' })
    if (aufKlick) {
      meldung.onclick = () => {
        window.focus()
        aufKlick()
        meldung.close()
      }
    }
  } catch {
    // Manche Browser werfen in eingebetteten Ansichten – eine fehlgeschlagene
    // Meldung darf die Oberfläche nicht stören.
  }
}
