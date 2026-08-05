import { useQuery } from '@tanstack/react-query'
import { Globe, Info, ShieldCheck } from 'lucide-react'
import { t } from '../i18n'
import { api } from '../lib/api'
import { Badge, Hinweis, Karte, LadeZustand } from './ui'

/**
 * Wie Mappe erreichbar ist – Anzeige und Anleitung, kein Schalter.
 *
 * Tailscale läuft in einem eigenen Container. Ihn von hier aus zu starten
 * hieße, Mappe Zugriff auf den Docker-Socket zu geben; wer die Anwendung dann
 * übernimmt, hätte den ganzen Server. Diese Seite zeigt deshalb den Stand und
 * den Weg, statt einen Schalter vorzutäuschen, der Schaden anrichtet.
 */

interface Zugriff {
  adresse: string
  ueberTailscale: boolean
  angemeldetAls: string | null
  appUrl: string
  appUrlPasstZumAufruf: boolean
  hostImAufruf: string
}

const BEFEHL = 'docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d'

export function ZugriffEinstellungen() {
  const { data, isLoading } = useQuery({
    queryKey: ['einstellungen', 'zugriff'],
    queryFn: () => api.get<Zugriff>('/einstellungen/zugriff'),
  })

  if (isLoading || !data) return <LadeZustand />

  return (
    <div className="space-y-6">
      <Karte titel={t('zugriff.aktuelleSitzung')}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {data.ueberTailscale ? (
              <Badge ton="gruen">
                <ShieldCheck className="h-3 w-3" />
                Tailscale
              </Badge>
            ) : (
              <Badge ton="grau">
                <Globe className="h-3 w-3" />
                {t('navigation.einstellungen')}
              </Badge>
            )}
            <span className="text-sm text-slate-700">
              {data.ueberTailscale
                ? t('zugriff.ueberTailscale', { adresse: data.adresse })
                : t('zugriff.ueberLokal', { adresse: data.adresse })}
            </span>
          </div>

          {data.angemeldetAls && (
            <p className="text-sm text-slate-500">
              {t('zugriff.angemeldetAls', { konto: data.angemeldetAls })}
            </p>
          )}

          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t('zugriff.appUrlTitel')}
            </p>
            <p className="mt-1 break-all font-mono text-sm text-slate-700">
              {data.appUrl || <span className="text-slate-400">{t('zugriff.appUrlLeer')}</span>}
            </p>
            {data.appUrl &&
              (data.appUrlPasstZumAufruf ? (
                <p className="mt-1 text-xs text-emerald-700">{t('zugriff.appUrlPasst')}</p>
              ) : (
                <div className="mt-2">
                  <Hinweis ton="warnung">
                    {t('zugriff.appUrlPasstNicht', { host: data.hostImAufruf })}
                  </Hinweis>
                </div>
              ))}
          </div>
        </div>
      </Karte>

      <Karte titel={t('zugriff.tailscaleTitel')} beschreibung={t('zugriff.tailscaleWarum')}>
        <div className="space-y-4">
          <Hinweis ton="info">{t('zugriff.tailscaleOptional')}</Hinweis>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t('zugriff.tailscaleSchritte')}
            </p>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
              <li>{t('zugriff.schritt1')}</li>
              <li>{t('zugriff.schritt2')}</li>
              <li>
                {t('zugriff.schritt3')}
                <pre className="mt-1.5 overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-100">
                  {BEFEHL}
                </pre>
              </li>
            </ol>
          </div>

          <div className="rounded-lg bg-slate-50 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <Info className="h-3.5 w-3.5" />
              {t('zugriff.warumKeinSchalter')}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              {t('zugriff.warumKeinSchalterText')}
            </p>
          </div>

          <p className="text-xs text-slate-500">{t('zugriff.doku')}</p>
        </div>
      </Karte>
    </div>
  )
}
