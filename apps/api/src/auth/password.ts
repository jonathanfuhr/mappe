import bcrypt from 'bcryptjs'

const ROUNDS = 12

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS)
}

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (!hash) {
    // Konto ohne Passwort (nur Microsoft-Login). Trotzdem einen Hash-Durchlauf
    // mitnehmen, damit die Antwortzeit nichts über die Kontoart verrät.
    await bcrypt.compare(plain, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin')
    return false
  }
  return bcrypt.compare(plain, hash)
}

/**
 * Mindestanforderung bewusst schlicht gehalten: Länge schlägt Sonderzeichen.
 * Ein selbst gehostetes Tool mit wenigen Konten braucht keine Passwortpolizei.
 */
export function checkPasswordStrength(plain: string): string | null {
  if (plain.length < 10) return 'Das Passwort muss mindestens 10 Zeichen haben.'
  if (plain.length > 200) return 'Das Passwort ist zu lang.'
  if (/^\s|\s$/.test(plain)) return 'Das Passwort darf nicht mit einem Leerzeichen beginnen oder enden.'
  return null
}
