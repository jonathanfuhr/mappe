import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin, requireAuth, currentUser } from '../auth/middleware'
import { istTailscaleAdresse, passtZumAufruf } from '../lib/zugriff'
import { audit } from '../lib/audit'
import { notFound, wrap } from '../lib/errors'
import { getSettingForUi, updateSetting } from './service'
import { SettingsKey, settingsSchemas } from './schema'

export const settingsRouter = Router()

function isSettingsKey(value: string): value is SettingsKey {
  return Object.prototype.hasOwnProperty.call(settingsSchemas, value)
}

/**
 * Alle Bereiche auf einmal – die Einstellungsseite lädt damit in einem Zug.
 * Geheimnisse kommen nie mit, nur das Kennzeichen "ist gesetzt".
 */
/**
 * Wie diese Sitzung hereinkommt.
 *
 * Mappe kann Tailscale **nicht schalten** – der Dienst läuft in einem eigenen
 * Container, und um den zu starten oder zu konfigurieren, bräuchte die
 * Anwendung Zugriff auf den Docker-Socket. Wer Mappe dann kompromittiert,
 * hätte damit den ganzen Server. Diese Ansicht zeigt deshalb den Stand und
 * erklärt den Weg, statt einen Schalter vorzutäuschen, der Schaden anrichtet.
 *
 * Erkannt wird am Absender des Requests: Tailscale vergibt Adressen aus
 * 100.64.0.0/10, und `trust proxy` sorgt dafür, dass hier die echte Adresse
 * ankommt und nicht die des Sidecars. Der Bereich gehört eigentlich dem
 * Carrier-NAT der Mobilfunknetze – deshalb heißt es in der Oberfläche „sieht
 * nach Tailscale aus" und nicht „ist Tailscale".
 */
settingsRouter.get(
  '/zugriff',
  requireAdmin,
  wrap(async (req, res) => {
    const adresse = (req.ip ?? '').replace(/^::ffff:/, '')
    const appUrl = process.env.APP_URL ?? ''

    // Die Kopfzeilen setzt `tailscale serve`, wenn es die Identität
    // durchreicht – ein eindeutigeres Signal als die Adresse allein.
    const kopfzeile =
      req.get('Tailscale-User-Login') ?? req.get('Tailscale-User-Name') ?? null

    res.json({
      adresse,
      ueberTailscale: istTailscaleAdresse(adresse) || kopfzeile !== null,
      angemeldetAls: kopfzeile,
      appUrl,
      // Die Adresse im Browser und APP_URL sollten zusammenpassen: An APP_URL
      // hängen die Redirect-URI des Microsoft-Logins und das `secure`-Flag des
      // Sitzungs-Cookies.
      appUrlPasstZumAufruf: passtZumAufruf(appUrl, req.get('host') ?? ''),
      hostImAufruf: req.get('host') ?? '',
    })
  }),
)

settingsRouter.get(
  '/',
  requireAdmin,
  wrap(async (_req, res) => {
    const keys = Object.keys(settingsSchemas) as SettingsKey[]
    const entries = await Promise.all(keys.map(async (k) => [k, await getSettingForUi(k)] as const))
    res.json(Object.fromEntries(entries))
  }),
)

/**
 * Was auch Nicht-Admins wissen müssen: ob die KI läuft (Transparenzhinweis in
 * der Oberfläche) und ob überhaupt ein Postfach angebunden ist.
 */
settingsRouter.get(
  '/oeffentlich',
  requireAuth,
  wrap(async (_req, res) => {
    const [ki, mail, allgemein] = await Promise.all([
      getSettingForUi('ki'),
      getSettingForUi('mail'),
      getSettingForUi('allgemein'),
    ])
    res.json({
      kiAktiv: ki.aktiv,
      kiModell: ki.aktiv ? ki.modell : null,
      kiBasisUrl: ki.aktiv ? ki.basisUrl : null,
      mailAdapter: mail.adapter,
      mailAktiv: mail.adapter !== 'aus',
      organisation: allgemein.organisation,
    })
  }),
)

settingsRouter.get(
  '/:key',
  requireAdmin,
  wrap(async (req, res) => {
    const key = req.params.key
    if (!isSettingsKey(key)) throw notFound('Diesen Einstellungsbereich gibt es nicht.')
    res.json(await getSettingForUi(key))
  }),
)

settingsRouter.put(
  '/:key',
  requireAdmin,
  wrap(async (req, res) => {
    const key = req.params.key
    if (!isSettingsKey(key)) throw notFound('Diesen Einstellungsbereich gibt es nicht.')

    const patch = z.record(z.unknown()).parse(req.body)
    await updateSetting(key, patch)

    // Ins Protokoll gehen nur die Feldnamen – niemals die Werte, sonst
    // stünden Zugangsdaten im Klartext im Log.
    await audit(currentUser(req).id, 'einstellung-geaendert', 'setting', key, {
      felder: Object.keys(patch),
    })
    res.json(await getSettingForUi(key))
  }),
)
