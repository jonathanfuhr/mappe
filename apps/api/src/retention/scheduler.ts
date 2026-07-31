import { env } from '../env'
import { getSetting } from '../settings/service'
import { berechneFristen, loescheFaellige } from './service'

/**
 * Hintergrundlauf für die Aufbewahrungsfristen.
 *
 * Er rechnet die Fälligkeiten immer neu. Gelöscht wird nur im Modus
 * „loeschen" – im Modus „erinnern" sammelt sich die Liste an und der Admin
 * entscheidet. Das ist die Voreinstellung: Eine automatische Löschung, die
 * niemand angeordnet hat, wäre die unangenehmere Überraschung.
 */

let timer: NodeJS.Timeout | null = null
let gestoppt = false

export function startRetentionScheduler(): void {
  gestoppt = false
  // Erster Lauf kurz nach dem Start, danach im eingestellten Takt.
  plane(30_000)
  console.log('[mappe] Fristenprüfung im Hintergrund ist aktiv.')
}

export function stopRetentionScheduler(): void {
  gestoppt = true
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

function plane(verzoegerungMs: number): void {
  if (gestoppt) return
  timer = setTimeout(() => void lauf(), verzoegerungMs)
  timer.unref()
}

async function lauf(): Promise<void> {
  try {
    const fristen = await getSetting('fristen')
    await berechneFristen()

    if (fristen.modus === 'loeschen') {
      const bericht = await loescheFaellige(null)
      if (bericht.bewerbungen > 0 || bericht.personen > 0) {
        console.log(
          `[mappe] Fristenlauf: ${bericht.bewerbungen} Bewerbung(en) und ${bericht.personen} Person(en) gelöscht, ` +
            `${bericht.dateien} Datei(en) entfernt.`,
        )
      }
    }
  } catch (err) {
    console.error('[mappe] Fristenprüfung fehlgeschlagen:', err instanceof Error ? err.message : err)
  } finally {
    plane(Math.max(600, env.retentionIntervalSeconds) * 1000)
  }
}
