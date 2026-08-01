# Betrieb

## Was gesichert werden muss

Zwei Dinge – beide gehören in dieselbe Sicherung, weil sie zusammengehören:

1. **Die Datenbank** (Volume `db-daten` oder das Verzeichnis aus `DB_DIR`)
2. **Die Dateien** (Volume `dokumente` oder `DOKUMENTE_DIR`) – Dokumente,
   Anhänge, Original-Mails

Dazu die `.env`: Ohne `ENCRYPTION_KEY` lassen sich die hinterlegten
Zugangsdaten nicht mehr entschlüsseln.

### Wo die Daten liegen

Ohne Angabe in der `.env` verwaltet Docker zwei benannte Volumes. Das ist
bequem und funktioniert überall – die Daten liegen dann aber im Docker-Abbild.

Stehen in `DB_DIR` und `DOKUMENTE_DIR` Pfade, werden daraus Bind-Mounts auf
genau diese Verzeichnisse:

```
DB_DIR=/mnt/user/appdata/mappe/db
DOKUMENTE_DIR=/mnt/user/appdata/mappe/dokumente
```

**Das Verzeichnis muss dem Container gehören.** Mappe läuft aus gutem Grund
nicht als `root`, sondern als Benutzer 1000. Ein frisch angelegtes Verzeichnis
gehört aber `root` – der Start bricht dann mit „Die Ablage ist nicht
beschreibbar" ab:

```bash
mkdir -p /mnt/user/appdata/mappe/dokumente
chown -R 1000:1000 /mnt/user/appdata/mappe/dokumente
```

Für `DB_DIR` ist das nicht nötig: Das Postgres-Abbild startet als `root` und
richtet sein Verzeichnis selbst ein.

**Auf Unraid gehören dort Pfade hinein.** Ein benanntes Volume landet im
`docker.img`, und das hat drei unangenehme Folgen: Das appdata-Backup erfasst
die Daten nicht, das Abbild ist knapp bemessen, und läuft es voll, fallen alle
anderen Container auf demselben Host mit um.

### Nachträglich umstellen

Ein Wechsel bewegt vorhandene Daten **nicht** – Docker legt schlicht neue,
leere Verzeichnisse an. Der Weg dahin:

```bash
# 1. Sichern, solange die alte Ablage noch in Betrieb ist
docker compose exec -T db pg_dump -U mappe mappe > /pfad/sicherung.sql
docker run --rm -v mappe_dokumente:/daten -v /pfad:/ziel alpine \
  tar czf /ziel/dokumente.tar.gz -C /daten .

# 2. Anhalten, Pfade in die .env eintragen, Verzeichnisse anlegen
docker compose down
mkdir -p /mnt/user/appdata/mappe/db /mnt/user/appdata/mappe/dokumente

# 3. Nur die Datenbank starten – sie richtet sich im neuen Verzeichnis ein
docker compose up -d db

# 4. Sicherung einspielen, dann den Rest starten
cat /pfad/sicherung.sql | docker compose exec -T db psql -U mappe -d mappe
tar xzf /pfad/dokumente.tar.gz -C /mnt/user/appdata/mappe/dokumente
docker compose up -d
```

Die alten Volumes bleiben dabei unangetastet und lassen sich später mit
`docker volume rm mappe_db-daten mappe_dokumente` entfernen – erst, wenn der
neue Stand nachweislich läuft.

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

## Platz beim Bauen

Das Bauen braucht deutlich mehr Platz als der laufende Container – und zwar
auf der Platte des Docker-Hosts, die sich **alle** Container teilen. Läuft sie
voll, trifft das nicht nur Mappe: Jede andere Datenbank auf demselben Host kann
in dem Moment ebenfalls nichts mehr schreiben und meldet einen internen
Serverfehler. Vor dem Bauen deshalb kurz nachsehen:

```bash
docker system df          # was belegt ist
df -h /var/lib/docker     # wie viel noch frei ist
```

**Faustregel: 4 GB frei.** Zum Vergleich die Größen:

| | |
| --- | --- |
| Abhängigkeiten mit Werkzeugen (beim Bauen) | 390 MB |
| davon übrig für den Betrieb | 300 MB |
| fertiges Abbild | rund 500 MB |

Dazu kommt der Paket-Zwischenspeicher während der Installation und der
Bau-Cache von Docker, der zwischen zwei Bauläufen liegen bleibt.

Ist es eng geworden, schafft das hier Luft – nichts davon fasst laufende
Container oder Volumes an:

```bash
docker builder prune -af   # Bau-Cache, meist der größte Posten
docker image prune -af     # Abbilder, die kein Container mehr benutzt
```

Auf **Unraid** liegt alles in einer Datei fester Größe (`docker.img`, ab Werk
20 GB). Ist die voll, hilft Aufräumen oder *Einstellungen → Docker → Docker vDisk
size* vergrößern (Docker-Dienst dafür anhalten).

Wenn es dauerhaft eng bleibt: auf einem anderen Rechner bauen und nur das
fertige Abbild übertragen.

```bash
docker save mappe:latest | gzip > mappe.tar.gz     # auf dem Baurechner
gunzip -c mappe.tar.gz | docker load               # auf dem Server
```

## HTTPS

Der Container spricht HTTP auf Port 3000; nach außen ist er über `MAPPE_PORT`
erreichbar (Vorgabe 4300). Für HTTPS gehört ein Reverse Proxy davor. Zwei Wege,
die sich bewährt haben:

### Caddy

```
bewerbung.firma.de {
    reverse_proxy localhost:4300
}
```

Caddy holt das Zertifikat selbst.

### Cloudflare Tunnel

```bash
cloudflared tunnel --url http://localhost:4300
```

Ohne offenen Port nach außen – praktisch hinter einem Anschluss ohne feste IP.

**Wichtig:** In beiden Fällen `APP_URL` in der `.env` auf die öffentliche
Adresse mit `https://` setzen. Davon hängt ab, ob das Sitzungs-Cookie als
`secure` gesetzt wird und wie die Redirect-URI für den Microsoft-Login lautet.

## Betrieb ohne Internet

Mappe läuft vollständig in einem abgeschotteten Netz. Nach dem einmaligen
Bauen des Abbilds braucht es keinerlei Verbindung nach draußen:

- Die Oberfläche lädt **nichts** nach – keine Schriften, keine Symbole, kein
  CDN. Auch der PDF-Betrachter bringt seinen Worker als Teil des Abbilds mit.
- Die serverseitige PDF-Textextraktion holt weder Schriften noch
  Zeichentabellen aus dem Netz.
- Jede ausgehende Verbindung steckt in einem abschaltbaren Adapter: Mail
  (Graph, IMAP/SMTP, Gmail), KI und der Microsoft-Login. Sind sie aus – die
  Voreinstellung –, baut Mappe **keine einzige** Verbindung nach außen auf.
- Auch der Start kommt ohne aus: Die Migrationen spielt die Prisma-CLI aus dem
  Abbild ein, nicht ein `npx`, das sie sich erst holen müsste.

Nachgemessen: Mit abgeschalteten Adaptern öffnet der Server über die gesamte
Laufzeit inklusive beider Hintergrundläufe keine Verbindung außer der zur
Datenbank. Im Browser wurden alle elf Seiten samt PDF-Betrachter aufgerufen –
ohne eine einzige Anfrage an eine fremde Adresse.

Was in einem solchen Aufbau sinnvoll bleibt:

- **Mail über einen Server im eigenen Netz** (IMAP/SMTP-Adapter). Der Adapter
  fragt nicht, wo der Server steht.
- **KI lokal über Ollama** auf einem Rechner im selben Netz. Als Basis-URL
  dessen IP eintragen.

Was nicht geht: Microsoft 365, Gmail und die KI-Anbieter im Netz – die
brauchen naturgemäß eine Verbindung dorthin.

Zwei Kleinigkeiten für ein Netz ohne Internet:

- Beim Bauen des Abbilds werden Pakete geladen. Entweder auf einem Rechner mit
  Verbindung bauen und das Abbild übertragen (`docker save` / `docker load`),
  oder eine interne Registry benutzen.
- Die beiden Verweise im Profil (Lizenztext und Quelltext) lassen sich
  offline nicht öffnen. Sie stehen dort, weil § 13 der AGPL verlangt, den
  Quelltext zu benennen – für den Betrieb sind sie ohne Bedeutung.

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
| Platte beim Bauen | zusätzlich 4 GB frei (siehe oben) |

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
Zwei verschiedene Fälle, die sich leicht verwechseln lassen:

*Im laufenden Betrieb* wachsen die Dokumente langsam, aber stetig. Die
Aufbewahrungsfristen halten den Bestand klein – unter *Aufbewahrung* steht, was
fällig ist.

*Beim Bauen* (`no space left on device`, `ENOSPC`) ist die Platte des
Docker-Hosts voll, nicht die von Mappe. Der Baulauf bricht ab, und weil alle
Container sich diese Platte teilen, können auch die anderen in dem Moment nichts
mehr schreiben. Was hilft, steht unter [Platz beim
Bauen](#platz-beim-bauen).
