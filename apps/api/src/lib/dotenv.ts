import fs from 'node:fs'
import path from 'node:path'

/**
 * Lädt eine .env, falls vorhanden. Im Container kommt die Konfiguration über
 * echte Umgebungsvariablen, lokal aus der Datei – bereits gesetzte Werte haben
 * immer Vorrang.
 *
 * Steht bewusst in einem eigenen Modul: Der Testvorlauf braucht dieselbe
 * Logik, muss sie aber ausführen, *bevor* env.ts geladen wird.
 */
export function ladeDotEnv(): void {
  const kandidaten = [
    process.env.ENV_FILE,
    path.join(process.cwd(), '.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../../.env'),
  ].filter((p): p is string => Boolean(p))

  for (const datei of kandidaten) {
    if (!fs.existsSync(datei)) continue
    for (const zeile of fs.readFileSync(datei, 'utf8').split('\n')) {
      const treffer = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(zeile)
      if (!treffer) continue
      const schluessel = treffer[1]
      if (process.env[schluessel] !== undefined) continue
      let wert = treffer[2].trim()
      if (
        (wert.startsWith('"') && wert.endsWith('"')) ||
        (wert.startsWith("'") && wert.endsWith("'"))
      ) {
        wert = wert.slice(1, -1)
      }
      process.env[schluessel] = wert
    }
    break
  }
}
