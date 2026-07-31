# Betrieb

## Was gesichert werden muss

Zwei Dinge – beide gehören in dieselbe Sicherung, weil sie zusammengehören:

1. **Die Datenbank** (Volume `db-daten`)
2. **Die Dateien** (Volume `dokumente`) – Dokumente, Anhänge, Original-Mails

Dazu die `.env`: Ohne `ENCRYPTION_KEY` lassen sich die hinterlegten
Zugangsdaten nicht mehr entschlüsseln.

### Sicherung

```bash
# Datenbank
docker compose exec -T db pg_dump -U mappe mappe | gzip > mappe-$(date +%F).sql.gz

# Dateien
docker run --rm -v mappe_dokumente:/daten -v "$PWD":/sicherung alpine \
  tar czf /sicherung/dokumente-$(date +%F).tar.gz -C /daten .
```

### Rücksicherung

```bash
gunzip -c mappe-2026-07-31.sql.gz | docker compose exec -T db psql -U mappe mappe

docker run --rm -v mappe_dokumente:/daten -v "$PWD":/sicherung alpine \
  tar xzf /sicherung/dokumente-2026-07-31.tar.gz -C /daten
```

## Aktualisieren

```bash
git pull
docker compose build
docker compose up -d
```

Migrationen laufen beim Start automatisch. Vor einem Sprung über mehrere
Versionen lohnt sich eine Sicherung.

## HTTPS

Der Container spricht HTTP auf Port 3000. Für HTTPS gehört ein Reverse Proxy
davor. Zwei Wege, die sich bewährt haben:

### Caddy

```
bewerbung.firma.de {
    reverse_proxy localhost:3000
}
```

Caddy holt das Zertifikat selbst.

### Cloudflare Tunnel

```bash
cloudflared tunnel --url http://localhost:3000
```

Ohne offenen Port nach außen – praktisch hinter einem Anschluss ohne feste IP.

**Wichtig:** In beiden Fällen `APP_URL` in der `.env` auf die öffentliche
Adresse mit `https://` setzen. Davon hängt ab, ob das Sitzungs-Cookie als
`secure` gesetzt wird und wie die Redirect-URI für den Microsoft-Login lautet.

## Wo Mappe läuft

Getestet auf amd64 und arm64. Für ein Abbild, das auf beiden läuft:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t mappe:latest .
```

Auf Synology und Unraid lässt sich der Compose-Stack unverändert einspielen;
die Volumes sollten dabei auf ein Verzeichnis im Array zeigen, damit sie von
der Sicherung des NAS erfasst werden.

## Ressourcen

Mappe ist genügsam. Ein kleiner Server reicht:

| | Empfehlung |
| --- | --- |
| CPU | 2 Kerne |
| Arbeitsspeicher | 1 GB für App und Datenbank |
| Platte | 10 GB plus Platz für Dokumente |

Die Textextraktion aus PDFs ist der einzige rechenintensive Teil und läuft
selten. Wer die KI lokal betreibt, plant den Arbeitsspeicher dafür getrennt
ein – Ollama gehört nicht in denselben Container.

## Hintergrundläufe

Zwei Zeitgeber laufen mit:

- **Mail-Abruf** – Takt einstellbar, Vorgabe 120 Sekunden. Nach einem Fehler
  wartet er länger, damit ein kaputtes Postfach nicht im Zweiminutentakt gegen
  die API läuft.
- **Fristenprüfung** – alle sechs Stunden. Rechnet die Fälligkeiten neu;
  gelöscht wird nur im Modus *automatisch löschen*.

Beide lassen sich über Umgebungsvariablen steuern
(`MAIL_POLL_SECONDS=0` schaltet den Mail-Abruf ab).

## Protokolle

```bash
docker compose logs -f app
```

Was DSGVO-relevant ist – Löschungen, Rollenwechsel, Mailversand, Änderungen an
den Einstellungen – steht zusätzlich in der Tabelle `AuditLog` in der
Datenbank. Zugangsdaten stehen dort nie: protokolliert werden nur die
Feldnamen, nie die Werte.

## Fehlersuche

**Der Container startet nicht.**
`docker compose logs app` zeigt den Grund. Häufig fehlt ein Wert in der `.env`
– die Meldung nennt ihn beim Namen.

**„Die Datenbank ist nicht erreichbar."**
`docker compose ps` prüfen. Die App wartet auf den Healthcheck der Datenbank;
beim allerersten Start dauert das eine knappe Minute.

**Anmeldung schlägt nach einem Neustart fehl.**
Wurde `SESSION_SECRET` geändert? Damit werden alle Sitzungen ungültig. Einfach
neu anmelden.

**Zugangsdaten sind plötzlich leer.**
`ENCRYPTION_KEY` hat sich geändert. Die Werte lassen sich nicht wiederherstellen
und müssen neu eingetragen werden. Der alte Schlüssel bringt sie zurück.

**Kein Platz mehr.**
Dokumente wachsen langsam, aber stetig. Die Aufbewahrungsfristen halten den
Bestand klein – unter *Aufbewahrung* steht, was fällig ist.
