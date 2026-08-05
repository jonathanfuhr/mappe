# Hinweise für die Arbeit an Mappe

Kurze Sammlung dessen, was sich beim Bauen als richtig herausgestellt hat.
Der Werdegang steht in der Notion-Seite „Baufortschritt"; hier stehen nur die
Regeln.

## Der Grundsatz, aus dem sich vieles ableitet

**Alles automatisch Erkannte ist ein Vorschlag.** Nichts wird still gesetzt –
weder eine erkannte Telefonnummer noch eine Stellenzuordnung noch ein
Statuswechsel, den die KI aus dem Mailverlauf ableitet. Vorschläge landen in
der Prüfansicht und werden durch Bestätigen wirksam.

Der Grund ist nicht Vorsicht um ihrer selbst willen: Ein Modell, das eine
höfliche Absage des Bewerbers für eine Zusage hält, würde sonst die Phase
umstellen, und niemand sähe, warum. Wer das an einer Stelle aufweicht, nimmt
dem Werkzeug seine Verlässlichkeit an allen.

## Commits und Zweige

Ein Zweig je Vorhaben, benannt nach dem Vorhaben (`claude/mappe-historie`).
Darauf ein Commit je abgeschlossenem Schritt – nicht je Datei und nicht je
Arbeitstag. Danach Pull Request, per **Rebase** auf `main` (die Historie ist
linear und soll es bleiben).

Commit-Nachrichten sind **deutsch** und erklären das **Warum**. Die erste Zeile
sagt, was sich für den Benutzer ändert („Zusagen bleiben dauerhaft"), nicht
welche Datei angefasst wurde. Darunter steht der Grund und was verworfen wurde.
Wer den Commit in einem Jahr liest, soll die Entscheidung verstehen, ohne den
Code danebenzulegen.

## Ausrollen passiert auf Ansage

Code wird gebaut, geprüft, committet und gepusht. **Ausgerollt wird nur, wenn
ausdrücklich darum gebeten wurde** – ein Push ist keine Freigabe.

Nach einem Ausrollen gehört ungefragt eine kurze Meldung dazu: ob gepullt wurde
(mit Commit-Kürzel), ob die Migrationen liefen und ob der Container gesund ist.
Dass ein Container läuft, heißt nicht, dass er den neuen Stand ausliefert – ein
Blick ins gebaute Bundle oder auf den Migrationsstand gehört dazu.

## Migrationen immer mitdenken

Beim Ausrollen **immer** prüfen, dass die Migrationen gelaufen sind. Das
Startskript ruft `prisma migrate deploy` bei jedem Start auf; in den Logs steht
entweder, was eingespielt wurde, oder „No pending migrations to apply".

Dazu die Kette **auf einer frischen Datenbank** durchspielen, nicht nur auf der
vorhandenen. Mappe ist zur Veröffentlichung gedacht – es gibt zwei Pfade, das
Upgrade einer bestehenden Installation und die Neuinstallation von null, und
beide müssen laufen. Ein Abgleich lohnt sich zusätzlich:

```bash
npx prisma migrate diff \
  --from-migrations apps/api/prisma/migrations \
  --to-schema-datamodel apps/api/prisma/schema.prisma \
  --shadow-database-url "$TEST_DATABASE_URL" --exit-code
```

Meldet er einen Unterschied, liegt eine Schemaänderung ohne zugehörige
Migration im Repo – bei uns unsichtbar, weil `migrate dev` lokal schon alles
angelegt hat, bei fremden Installationen ein Bruch.

Migrationen bekommen einen sprechenden deutschen Namen
(`20260801104706_historie`).

## Prüfen

```bash
npm run typecheck   # beide Workspaces
npm test            # Vitest über API und Web
npm run build       # findet Fehler, die der Typecheck nicht sieht
```

Die API-Tests laufen gegen **echtes Postgres**, nicht gegen Mocks – und sie
leeren zwischen den Läufen ganze Tabellen. Deshalb brechen sie ohne eigene
`TEST_DATABASE_URL` ab; das ist eine Sicherung, kein Hindernis:

```bash
TEST_DATABASE_URL=postgresql://mappe:…@host:5434/mappe_test npm test
```

Ist keine Postgres-Instanz zur Hand, tut es ein wegwerfbarer Container:

```bash
docker run -d --name mappe-test-db -e POSTGRES_USER=mappe \
  -e POSTGRES_PASSWORD=… -e POSTGRES_DB=mappe_test \
  -e POSTGRES_INITDB_ARGS='--encoding=UTF8 --locale=C' \
  -p 5434:5432 postgres:16-alpine
```

**Ein neuer Test muss gegen den alten Code umfallen.** Sonst prüft er nichts.
Bei einem Fehlerfund heißt das: erst den Test schreiben, gegen den unveränderten
Code laufen lassen, dann beheben.

## Sprache

Oberfläche, Kommentare, Commit-Nachrichten und Dokumentation sind **deutsch**.
Englisch bleibt, wo es hingehört: Prisma-Modelle und -Felder, API-Routen,
Typnamen. Innerhalb von Funktionen sind deutsche Bezeichner die Regel
(`bestehende`, `abschnitte`, `gefiltert`).

Alle sichtbaren Texte stehen in `apps/web/src/i18n/de.json`, keiner direkt im
Code – auch wenn es vorerst nur ein Wörterbuch gibt. So kommt Englisch später
ohne Codeänderung dazu.

## Kommentare

Kommentare erklären das **Warum**, nicht das Was. Besonders wertvoll sind die,
die festhalten, was schon einmal schiefging – davon steht viel im Code, und es
hat sich bewährt. Beispiel aus `routes/bewerbungen.ts`: warum die
Sichtbarkeitsprüfung ein eigener Eintrag im `AND`-Feld ist und nicht daneben
gespreadet – weil genau das einmal jedem Interviewer jede Bewerbung geöffnet
hat.

## Beispiele und Testdaten

In Platzhaltern, Testdaten, Kommentaren und Dokumentation stehen **keine echten
Firmen-, Kunden- oder Personennamen** – auch nicht die des Betreibers. Statt
dessen `Beispiel GmbH`, `beispiel.de`, `Anna Beispiel`.

Solche Namen wandern über Kopiervorlagen in fremde Installationen und stehen
dann in der Oberfläche von jemandem, der mit ihnen nichts zu tun hat.

## Größere Vorhaben zuerst planen

Was mehr ist als ein Fix, entsteht zuerst als **Notion-Seite** unter
„Baufortschritt": Bestandsaufnahme, Vorschlag, offene Entscheidungen als
Häkchen. Erst wenn die Entscheidungen getroffen sind, wird gebaut – und die
Seite danach auf den Stand gebracht, was tatsächlich umgesetzt wurde und was
bewusst anders.

Die Bestandsaufnahme lohnt sich: Bei den Gesprächen und beim Mail-Verlauf stand
das Datenmodell längst, es fehlte nur die Oberfläche.

## Was beim Betrieb schon schiefging

Vier Dinge, die alle Zeit gekostet haben und im Code oder in der Doku
festgehalten sind:

- **`openssl` gehört in beide Docker-Stufen.** Ohne das Programm errät Prisma
  auf Alpine die falsche Engine, will sie beim Start nachladen und scheitert –
  der Container kommt nie hoch. Nachzuladen wäre ohnehin falsch: Mappe soll
  ohne Internet starten.
- **Nichts gehört ins `docker.img`.** `DB_DIR` und `DOKUMENTE_DIR` zeigen auf
  Verzeichnisse des Servers. Sonst erfasst kein Backup die Daten, und läuft das
  Abbild voll, reißt es alle anderen Container mit.
- **Bind-Mounts brauchen die richtigen Rechte.** Mappe läuft im Container als
  Benutzer 1000, ein frisches Verzeichnis gehört `root`
  (`chown -R 1000:1000`). Postgres fällt das nicht auf, weil sein Abbild als
  `root` startet – der Unterschied kostet sonst eine Fehlersuche.
- **Der Bau darf die Platte des Hosts nicht füllen.** Deshalb genau ein
  `npm ci` und danach `npm prune`, statt zweimal zu installieren.

Einzelheiten in [docs/betrieb.md](docs/betrieb.md).

## Rollen und Sichtbarkeit

Drei Rollen, und die Grenze für **Interviewer** ist die empfindlichste: Sie
sehen nur zugewiesene Bewerbungen, keinen Mailverlauf, keine Mail-Ereignisse in
der Historie und keine Vorschläge.

Wer eine neue Liste, einen Filter oder eine Auswertung baut, prüft, ob diese
Grenze noch hält – und sichert sie mit einem Test gegen die echte Datenbank ab.
Ob eine Bedingung wirkt, entscheidet Prisma, nicht wie das Filterobjekt
aussieht; die erste Fassung sah richtig aus und ließ trotzdem alles durch.

## Recht und Datenschutz

Zwei Dinge stecken als Entscheidung im Code und sollten nicht beiläufig
geändert werden:

- **Absagen nennen keinen Grund.** Wer schreibt, warum jemand nicht genommen
  wurde, liefert im Streitfall die Indizien nach § 22 AGG gleich mit.
- **Zusagen laufen nicht ab.** Mit dem Arbeitsvertrag wechselt der Zweck von
  der Auswahl zur Personalakte – die Unterlagen sind dann aufbewahrungs-
  *pflichtig* statt löschpflichtig. Für Absagen bleiben sechs Monate richtig.

Beides ist fachliche Einordnung, kein Rechtsrat; die Ausgestaltung gehört vor
den Datenschutzbeauftragten des Betreibers.

## Ausrollen auf dem Unraid

```bash
ssh fuhrserver 'cd /mnt/user/github/mappe && git pull --ff-only && docker compose build && docker compose up -d'
```

Vor Schemaänderungen sichern – das Verzeichnis liegt im Array, nicht im
Abbild:

```bash
docker exec mappe-db-1 pg_dump -U mappe -d mappe > /mnt/user/appdata/mappe/sicherungen/vor-<vorhaben>.sql
```
