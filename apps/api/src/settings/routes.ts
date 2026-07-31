import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin, requireAuth, currentUser } from '../auth/middleware'
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
