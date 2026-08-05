# Zugriff von unterwegs über Tailscale

Mappe von unterwegs erreichen, ohne sie ins offene Netz zu stellen.

## Warum ein eigener Zugang für Mappe

Läuft Tailscale nur auf dem Server, ist über dessen Adresse **der ganze Server**
erreichbar – jeder Dienst, jeder Port. Wer jemandem den Zugang zu Mappe geben
will, gibt ihm den Zugang zu allem anderen gleich mit.

Mit der zusätzlichen Compose-Datei bekommt Mappe einen **eigenen Rechner im
Tailnet**. Der lässt sich in den Tailscale-ACLs einzeln freigeben: Ein Konto
darf Mappe erreichen und sonst nichts.

Der Zugang im lokalen Netz bleibt daneben bestehen – der Tailscale-Weg kommt
dazu, nicht an dessen Stelle.

## Einrichten

### 0. HTTPS im Tailnet einschalten

In der Tailscale-Verwaltung unter **DNS → HTTPS Certificates → Enable**.

Ohne das kann der Sidecar kein Zertifikat ausstellen. Die Serve-Konfiguration
wird dann **stillschweigend verworfen**: Mappe taucht als Rechner im Tailnet
auf, ist aber unter der Adresse nicht erreichbar – und in den Logs steht nur
eine Zeile dazu:

```
serve proxy: … it is not able to issue TLS certs, so this will likely not work.
```

Wer das nicht einschalten will oder kann, nimmt den Weg über HTTP. In die
`.env`:

```
TS_MODUS=http
TS_SERVE_CONFIG=
```

`TS_SERVE_CONFIG` bleibt dabei **leer**. Der Grund ist eine Eigenheit, die
sonst Stunden kostet: Ohne HTTPS wird der Platzhalter für den eigenen Namen zu
`no-https`, und eine Konfigurationsdatei hängt den Zugang dann an einen Namen,
den niemand aufruft – die Adresse antwortet mit **404**, obwohl alles zu
laufen scheint. Deshalb wird die Konfiguration einmalig per Befehl gesetzt; sie
bleibt im Zustandsverzeichnis erhalten:

```bash
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml \
  exec tailscale tailscale serve --bg --http=80 http://app:3000
```

Innerhalb des Tailnets ist der Verkehr ohnehin verschlüsselt. Das
Sitzungs-Cookie wird auf diesem Weg aber nicht als `secure` gesetzt, und
`APP_URL` muss mit `http://` beginnen.

### 1. Auth-Key erzeugen

In der Tailscale-Verwaltung unter **Settings → Keys → Generate auth key**:

- **Reusable** – sonst ist der Key nach dem ersten Start verbraucht und der
  Container meldet sich nach einem Neuaufbau nicht mehr an
- **Ephemeral: aus** – der Rechner soll bestehen bleiben, auch wenn der
  Container kurz steht
- **Tags**: `tag:mappe` empfiehlt sich, weil sich die ACLs damit an einem Namen
  festmachen lassen statt an einer Adresse

### 2. In die `.env` eintragen

```
TS_AUTHKEY=tskey-auth-…
TS_HOSTNAME=mappe
TS_STATE_DIR=/mnt/user/appdata/mappe/tailscale
TS_MODUS=https
```

`TS_STATE_DIR` ist auf Unraid wichtig: Der Anmeldezustand gehört dorthin, wo er
einen Neuaufbau des Docker-Abbilds übersteht. Sonst meldet sich der Container
danach neu an und taucht als **zweiter** Rechner im Tailnet auf – mit neuem
Namen (`mappe-1`), an dem keine ACL mehr greift.

### 3. Starten

```bash
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d
```

Danach ist Mappe erreichbar unter `https://mappe.<tailnet>.ts.net` – mit
gültigem Zertifikat, das Tailscale selbst ausstellt.

### 4. `APP_URL` nachziehen

```
APP_URL=https://mappe.<tailnet>.ts.net
```

Das ist kein Schönheitsfehler: Am `https://` hängt, ob das Sitzungs-Cookie als
`secure` gesetzt wird, und die Adresse ist zugleich die Redirect-URI des
Microsoft-Logins.

## Nur Mappe freigeben

Die eigentliche Absicht steckt in den ACLs. In der Tailscale-Verwaltung unter
**Access Controls**, sinngemäß:

```jsonc
{
  "tagOwners": {
    "tag:mappe": ["autogroup:admin"]
  },
  "acls": [
    // Die Personalabteilung erreicht Mappe – und nur Mappe.
    {
      "action": "accept",
      "src": ["group:personal"],
      "dst": ["tag:mappe:443"]
    }
  ],
  "groups": {
    "group:personal": ["anna@beispiel.de"]
  }
}
```

Entscheidend ist `dst`: Es nennt den Tag von Mappe, nicht den Server. Ein Konto
in `group:personal` sieht im Tailnet nichts weiter – weder die Unraid-Oberfläche
noch einen anderen Dienst darauf.

Ohne Tag ginge es auch über den Rechnernamen, aber ein Tag überlebt eine
Neuanmeldung; ein Name kann sich dabei ändern.

## Betrieb

**Der Zustand gehört gesichert.** `TS_STATE_DIR` enthält die Identität des
Rechners im Tailnet. Geht er verloren, meldet sich Mappe als neuer Rechner an –
die ACLs greifen dann nicht mehr, bis der Tag neu vergeben ist.

**Erreichbar, aber nichts lauscht?** Fast immer fehlt HTTPS im Tailnet
(Schritt 0). Der Beweis steht in einer Zeile:

```bash
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml \
  exec tailscale tailscale serve status
```

Kommt dort `No serve config`, wurde die Konfiguration verworfen – dann
entweder HTTPS einschalten oder `TS_MODUS=http` setzen und neu starten.

**Prüfen, ob der Rechner steht:**

```bash
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml \
  exec tailscale tailscale status
```

**Der Auth-Key wird nur beim ersten Anmelden gebraucht.** Danach zählt der
Zustand im Volume. Ein abgelaufener Key stört einen bereits angemeldeten
Rechner nicht – wohl aber einen, der sich neu anmelden muss.

## Was dieser Weg nicht ist

Kein Ersatz für eine Anmeldung: Tailscale entscheidet, wer das Netz erreicht,
Mappe entscheidet weiterhin, wer sich anmelden darf. Beides bleibt nötig.

Und keine Veröffentlichung: Wer Mappe wirklich öffentlich stellen will, nimmt
einen Reverse Proxy mit eigenem Zertifikat – siehe
[betrieb.md](betrieb.md#https).
