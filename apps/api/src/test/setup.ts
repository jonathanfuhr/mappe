/**
 * Testvorlauf.
 *
 * Wenn TEST_DATABASE_URL gesetzt ist, laufen die Tests dagegen statt gegen die
 * Arbeitsdatenbank. Das muss geschehen, *bevor* env.ts geladen wird – deshalb
 * steht es in einer Setup-Datei und nicht in den Tests selbst.
 */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
}
process.env.NODE_ENV = 'test'
process.env.SESSION_SECRET ??= 'testgeheimnis-nur-fuer-die-testlaeufe'
process.env.ENCRYPTION_KEY ??= 'testschluessel-nur-fuer-die-testlaeufe'
process.env.STORAGE_DIR ??= '/tmp/mappe-test-ablage'
// Kein Hintergrundabruf während der Tests.
process.env.MAIL_POLL_SECONDS ??= '0'
