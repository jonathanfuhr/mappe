import { ConfidentialClientApplication } from '@azure/msal-node'
import crypto from 'node:crypto'
import { Router, type Response } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../db'
import { env } from '../env'
import { audit } from '../lib/audit'
import { badRequest, wrap } from '../lib/errors'
import { getSetting } from '../settings/service'
import { setSessionCookie, signSession } from './tokens'

/**
 * Anmeldung über Microsoft 365 (Entra ID) – das Bonus-Feature aus dem Plan.
 *
 * Es nutzt denselben Tenant wie die Mail-Anbindung; zusätzlich braucht die
 * App-Registrierung nur eine Redirect-URI und die delegierten Scopes
 * openid/profile/email.
 *
 * Der Ablauf ist der Authorization-Code-Fluss mit PKCE. state, nonce und
 * code_verifier liegen in einem kurzlebigen, signierten Cookie – nicht im
 * Serverspeicher, damit ein Neustart mitten im Anmeldevorgang nichts kaputt
 * macht.
 */

export const entraRouter = Router()

const VORGANGS_COOKIE = 'mappe_entra'
const VORGANG_GUELTIG_SEKUNDEN = 600

interface Vorgang {
  state: string
  nonce: string
  verifier: string
}

async function baueClient() {
  const anmeldung = await getSetting('anmeldung')
  const { tenantId, clientId, clientSecret } = anmeldung.entra

  if (!anmeldung.entraAktiv || !tenantId || !clientId || !clientSecret) {
    throw badRequest('Der Microsoft-Login ist nicht eingerichtet.')
  }

  return {
    anmeldung,
    client: new ConfidentialClientApplication({
      auth: {
        clientId,
        clientSecret,
        authority: `https://login.microsoftonline.com/${tenantId}`,
      },
    }),
  }
}

export function redirectUri(): string {
  return `${env.appUrl}/api/auth/entra/callback`
}

entraRouter.get(
  '/start',
  wrap(async (_req, res) => {
    const { client } = await baueClient()

    const state = crypto.randomBytes(24).toString('base64url')
    const nonce = crypto.randomBytes(24).toString('base64url')
    // PKCE: Der Verifier bleibt beim Client, nur sein Hash geht zu Microsoft.
    const verifier = crypto.randomBytes(48).toString('base64url')
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')

    const url = await client.getAuthCodeUrl({
      scopes: ['openid', 'profile', 'email'],
      redirectUri: redirectUri(),
      state,
      nonce,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      prompt: 'select_account',
    })

    setzeVorgang(res, { state, nonce, verifier })
    res.redirect(url)
  }),
)

entraRouter.get(
  '/callback',
  wrap(async (req, res) => {
    const fehlerVonMicrosoft = req.query.error_description ?? req.query.error
    if (typeof fehlerVonMicrosoft === 'string') {
      return zurueckMitFehler(res, fehlerVonMicrosoft)
    }

    const code = req.query.code
    const state = req.query.state
    if (typeof code !== 'string' || typeof state !== 'string') {
      return zurueckMitFehler(res, 'Die Antwort von Microsoft war unvollständig.')
    }

    const vorgang = leseVorgang(req.cookies?.[VORGANGS_COOKIE])
    res.clearCookie(VORGANGS_COOKIE, { path: '/api/auth/entra' })

    if (!vorgang) {
      return zurueckMitFehler(res, 'Der Anmeldevorgang ist abgelaufen. Bitte erneut versuchen.')
    }
    // Schutz gegen untergeschobene Anmeldungen (CSRF auf den Login).
    if (!zeitgleichGleich(vorgang.state, state)) {
      return zurueckMitFehler(res, 'Die Anmeldung konnte nicht zugeordnet werden.')
    }

    const { anmeldung, client } = await baueClient()

    let ergebnis
    try {
      ergebnis = await client.acquireTokenByCode({
        code,
        scopes: ['openid', 'profile', 'email'],
        redirectUri: redirectUri(),
        codeVerifier: vorgang.verifier,
        state,
      })
    } catch (err) {
      return zurueckMitFehler(
        res,
        `Microsoft hat den Anmeldecode abgelehnt: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`,
      )
    }

    const claims = ergebnis?.idTokenClaims as
      | { oid?: string; sub?: string; nonce?: string; name?: string; preferred_username?: string; email?: string }
      | undefined

    // MSAL prüft Signatur, Aussteller und Laufzeit des Tokens selbst. Den
    // nonce müssen wir gegenprüfen – er bindet das Token an genau diesen
    // Anmeldevorgang und verhindert das Wiedereinspielen eines alten Tokens.
    if (!claims?.nonce || !zeitgleichGleich(claims.nonce, vorgang.nonce)) {
      return zurueckMitFehler(res, 'Das Anmeldetoken gehört nicht zu diesem Vorgang.')
    }

    const objektId = claims.oid ?? claims.sub
    const email = (claims.preferred_username ?? claims.email ?? '').toLowerCase().trim()
    const name = claims.name?.trim() || email

    if (!objektId || !email) {
      return zurueckMitFehler(res, 'Microsoft hat keine E-Mail-Adresse übermittelt.')
    }

    const domaene = email.split('@')[1] ?? ''
    if (anmeldung.erlaubteDomaenen.length > 0 && !anmeldung.erlaubteDomaenen.includes(domaene)) {
      return zurueckMitFehler(res, `Anmeldungen von „${domaene}" sind nicht freigegeben.`)
    }

    // Erst über die Entra-Kennung suchen (überlebt eine Adressänderung),
    // dann über die Adresse – so wird ein bestehendes lokales Konto verknüpft
    // statt ein zweites anzulegen.
    let nutzer = await prisma.user.findUnique({ where: { entraOid: objektId } })
    if (!nutzer) {
      nutzer = await prisma.user.findUnique({ where: { email } })
      if (nutzer) {
        nutzer = await prisma.user.update({ where: { id: nutzer.id }, data: { entraOid: objektId } })
        await audit(nutzer.id, 'microsoft-konto-verknuepft', 'user', nutzer.id, { email })
      }
    }

    if (!nutzer) {
      if (!anmeldung.kontenAutomatischAnlegen) {
        return zurueckMitFehler(
          res,
          'Für diese Adresse gibt es kein Konto. Ein Admin muss es zuerst anlegen.',
        )
      }
      nutzer = await prisma.user.create({
        data: { email, name, entraOid: objektId, role: 'INTERVIEWER', passwordHash: null },
      })
      await audit(nutzer.id, 'nutzer-per-microsoft-angelegt', 'user', nutzer.id, { email })
    }

    if (!nutzer.active) {
      return zurueckMitFehler(res, 'Dieses Konto ist gesperrt.')
    }

    await prisma.user.update({ where: { id: nutzer.id }, data: { lastLoginAt: new Date() } })
    setSessionCookie(res, signSession(nutzer.id, nutzer.tokenVersion))
    res.redirect('/')
  }),
)

function setzeVorgang(res: Response, vorgang: Vorgang): void {
  const token = jwt.sign(vorgang, env.sessionSecret, {
    expiresIn: VORGANG_GUELTIG_SEKUNDEN,
    issuer: 'mappe-entra',
  })
  res.cookie(VORGANGS_COOKIE, token, {
    httpOnly: true,
    // Muss lax sein: Microsoft leitet per GET von einer fremden Seite zurück,
    // bei 'strict' käme das Cookie dabei nicht mit.
    sameSite: 'lax',
    secure: env.appUrl.startsWith('https://'),
    maxAge: VORGANG_GUELTIG_SEKUNDEN * 1000,
    path: '/api/auth/entra',
  })
}

function leseVorgang(token: unknown): Vorgang | null {
  if (typeof token !== 'string') return null
  try {
    const inhalt = jwt.verify(token, env.sessionSecret, { issuer: 'mappe-entra' })
    if (typeof inhalt === 'string') return null
    const { state, nonce, verifier } = inhalt as Partial<Vorgang>
    if (!state || !nonce || !verifier) return null
    return { state, nonce, verifier }
  } catch {
    return null
  }
}

/** Vergleich ohne Zeitunterschied – bei Sicherheitsmerkmalen die richtige Wahl. */
function zeitgleichGleich(a: string, b: string): boolean {
  const pufferA = Buffer.from(a)
  const pufferB = Buffer.from(b)
  if (pufferA.length !== pufferB.length) return false
  return crypto.timingSafeEqual(pufferA, pufferB)
}

/** Führt zur Anmeldeseite zurück und zeigt dort den Grund an. */
function zurueckMitFehler(res: Response, meldung: string): void {
  res.redirect(`/?anmeldefehler=${encodeURIComponent(meldung.slice(0, 300))}`)
}
