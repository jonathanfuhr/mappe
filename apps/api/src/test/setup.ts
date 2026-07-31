import { ladeDotEnv } from '../lib/dotenv'

/**
 * Testvorlauf.
 *
 * Die Import- und Split-Tests räumen zwischen den Läufen ganze Tabellen leer.
 * Deshalb wird hier hart sichergestellt, dass sie niemals gegen die
 * Arbeitsdatenbank laufen: Ohne eigene Testdatenbank bricht der Lauf ab,
 * statt Daten zu löschen.
 *
 * Das muss geschehen, bevor env.ts geladen wird – daher der eigene .env-Leser.
 */
ladeDotEnv()

const testDatenbank = process.env.TEST_DATABASE_URL
const arbeitsDatenbank = process.env.DATABASE_URL

if (testDatenbank) {
  if (arbeitsDatenbank && testDatenbank === arbeitsDatenbank) {
    throw new Error(
      'TEST_DATABASE_URL zeigt auf dieselbe Datenbank wie DATABASE_URL. ' +
        'Die Tests würden die Arbeitsdaten löschen. Bitte eine eigene Testdatenbank anlegen.',
    )
  }
  process.env.DATABASE_URL = testDatenbank
} else if (!/test/i.test(arbeitsDatenbank ?? '')) {
  throw new Error(
    'Für die Tests fehlt TEST_DATABASE_URL. Sie muss auf eine eigene Datenbank zeigen – ' +
      'die Tests leeren zwischen den Läufen ganze Tabellen.\n' +
      'Beispiel:  TEST_DATABASE_URL=postgresql://mappe:…@localhost:5432/mappe_test',
  )
}

process.env.NODE_ENV = 'test'
process.env.SESSION_SECRET ??= 'testgeheimnis-nur-fuer-die-testlaeufe'
process.env.ENCRYPTION_KEY ??= 'testschluessel-nur-fuer-die-testlaeufe'
process.env.STORAGE_DIR ??= '/tmp/mappe-test-ablage'
// Kein Hintergrundabruf während der Tests.
process.env.MAIL_POLL_SECONDS ??= '0'
