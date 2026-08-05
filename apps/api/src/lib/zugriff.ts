/**
 * Woher ein Aufruf kommt – kleine, für sich prüfbare Regeln.
 *
 * Bewusst hier und nicht in der Route: Beides sind Randfall-Fragen (Adressen
 * am Rand des Bereichs, Adressen mit Port, IPv6-gemappte IPv4), und die klärt
 * man einmal mit Tests statt jedes Mal von Hand.
 */

/**
 * Liegt die Adresse in 100.64.0.0/10 – dem Bereich, aus dem Tailscale seine
 * Adressen vergibt?
 *
 * Der Bereich gehört eigentlich dem Carrier-NAT der Mobilfunknetze. Für einen
 * Server im eigenen Netz ist er trotzdem ein verlässliches Zeichen; die
 * Oberfläche sagt deshalb „sieht nach Tailscale aus", nicht „ist Tailscale".
 */
export function istTailscaleAdresse(adresse: string): boolean {
  // Express liefert IPv4 hinter IPv6 gelegentlich als ::ffff:100.64.0.1
  const roh = adresse.trim().replace(/^::ffff:/i, '')
  const teile = roh.split('.')
  if (teile.length !== 4) return false

  const zahlen = teile.map((t) => (/^\d{1,3}$/.test(t) ? Number(t) : NaN))
  if (zahlen.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false

  return zahlen[0] === 100 && zahlen[1] >= 64 && zahlen[1] <= 127
}

/**
 * Zeigt `APP_URL` auf dieselbe Adresse, unter der Mappe gerade aufgerufen
 * wird? Verglichen wird der Host samt Port – `localhost:4300` und
 * `localhost:3000` sind eben nicht dasselbe.
 */
export function passtZumAufruf(appUrl: string, host: string): boolean {
  if (!appUrl.trim() || !host.trim()) return false
  try {
    return new URL(appUrl).host.toLowerCase() === host.trim().toLowerCase()
  } catch {
    return false
  }
}
