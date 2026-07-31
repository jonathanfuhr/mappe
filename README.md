# Mappe

Selbst gehostetes Bewerbungsmanagement (ATS) in einem Docker-Container.
Bewerbungen laufen per Mail ein, werden automatisch erfasst und lassen sich
im Team sichten, bewerten und beantworten. KI ist optional und läuft über den
eigenen API-Schlüssel.

Alle Daten bleiben auf der eigenen Hardware. Keine Lizenzkosten, keine
Nutzerbegrenzung.

## Was Mappe kann

**Bewerbungen kommen von allein herein.** Ein Bewerbungspostfach wird
angebunden, Mails werden regelmäßig abgeholt, Anhänge gespeichert und zu
Bewerbungen gebündelt. Die Originalnachricht bleibt unverändert als `.eml`
erhalten.

**Weitergeleitete Bewerbungen behalten ihren Absender.** Kommt eine Bewerbung
über `info@`, steht in der Von-Zeile das Verteilerpostfach – wer darauf
antwortet, schreibt an sich selbst. Mappe liest den ursprünglichen Absender aus
der angehängten Originalnachricht, aus den Kopfzeilen oder aus dem
eingebetteten Vorspann.

**Erkennung ohne KI.** Name, E-Mail, Telefon, Anschrift und Links werden
regelbasiert aus Mailtext und PDF gelesen. Für das Website-Formular sowie für
LinkedIn und Indeed gibt es eigene Parser. Die Zuordnung zur Stelle läuft über
Referenznummer, Titel und Stichworte.

**Alles Erkannte ist ein Vorschlag.** Angezeigt wird, was gefunden wurde,
daneben der bisherige Wert. Übernommen wird nur, was bestätigt ist.

**Tägliches Arbeiten.** Kanban-Board über neun Phasen, Liste mit Filtern,
Bewertung mit Sternen und Kurzurteil, Notizen, PDF-Viewer mit Kommentaren an
der Textstelle, Auftrennen von Kombi-PDFs in Anschreiben, Lebenslauf und
Zeugnisse.

**Antworten aus Vorlagen.** Zwölf mitgelieferte Vorlagen in Du- und
Sie-Fassung, mit Platzhaltern und frei definierbaren Zusatzfeldern. Versendet
wird als das Bewerbungspostfach, die Antwort landet im richtigen Mailverlauf.

**KI, wenn gewünscht.** Über eine OpenAI-kompatible Schnittstelle: OpenAI,
Anthropic, Azure OpenAI oder lokal via Ollama. Erkennung, Extraktion,
Kurzzusammenfassung und Seitenklassifikation für den PDF-Split – jede Aufgabe
einzeln abschaltbar.

**DSGVO eingebaut.** Zwei getrennte Aufbewahrungsfristen, Einwilligung für den
Talent-Pool, vollständiges Löschen auf Knopfdruck, Protokoll über jede
Löschung.

## Schnellstart

Voraussetzung: Docker und Docker Compose.

```bash
git clone https://github.com/jonathanfuhr/mappe.git
cd mappe
cp .env.example .env

# Die drei Geheimnisse erzeugen und in die .env eintragen
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # ENCRYPTION_KEY
openssl rand -hex 16   # POSTGRES_PASSWORD

docker compose up -d
```

Danach `http://localhost:3000` aufrufen. Der erste angelegte Nutzer wird
automatisch Administrator.

> **`ENCRYPTION_KEY` niemals im laufenden Betrieb ändern.** Mit ihm sind alle
> hinterlegten Zugangsdaten verschlüsselt. Geht er verloren, müssen Mail- und
> KI-Zugänge neu eingetragen werden.

## Einrichtung

Die eigentliche Einrichtung passiert in der Oberfläche unter **Einstellungen**.
Ausführliche Anleitungen:

- [Mail-Anbindung](docs/mail-einrichten.md) – Microsoft 365, IMAP/SMTP, Gmail
- [KI-Anbindung](docs/ki-einrichten.md) – OpenAI, Anthropic, Azure, Ollama
- [Betrieb](docs/betrieb.md) – Sicherung, Aktualisierung, HTTPS, Fehlersuche

Kurz zusammengefasst:

1. **Stellen anlegen.** Ohne Stellen landet jede Bewerbung ohne Zuordnung.
   Referenznummer und Stichworte verbessern die automatische Zuordnung
   deutlich.
2. **Postfach anbinden** unter *Einstellungen → Mail-Anbindung*.
3. **Weiterleitungsadressen eintragen**, wenn Bewerbungen über `info@`
   hereinkommen.
4. **Nutzer anlegen** mit passender Rolle.
5. Optional: **KI einschalten** und **Aufbewahrungsfristen** prüfen.

## Rollen

| Rolle | Darf |
| --- | --- |
| **Admin** | Alles: Systemeinstellungen, Nutzerverwaltung, Vorlagen, Löschungen |
| **Recruiter** | Das Tagesgeschäft: Bewerbungen, Phasen, Bewertungen, Mailversand, Stellen |
| **Interviewer** | Nur zugewiesene Bewerbungen lesen, bewerten und Notizen schreiben |

Interviewer sehen weder den Mailverlauf noch Bewerbungen, die ihnen nicht
zugewiesen sind – Bewerberdaten bleiben auf Need-to-know-Basis.

## Technik

- **Backend:** Node.js 22, TypeScript, Express, Prisma
- **Frontend:** React, Vite, Tailwind CSS
- **Datenbank:** PostgreSQL 16
- **Ablage:** Dateien liegen im Volume, nicht in der Datenbank

Die Oberfläche ist auf Deutsch. Alle Texte liegen in einer einzigen Datei
(`apps/web/src/i18n/de.json`); eine weitere Sprache lässt sich ergänzen, ohne
Code anzufassen.

## Entwicklung

```bash
npm install
cp .env.example .env          # DATABASE_URL auf die lokale Postgres zeigen lassen
npm run prisma:migrate
npm run seed
npm run dev                   # API auf 3001, Oberfläche auf 5173
```

Tests:

```bash
# Eigene Testdatenbank anlegen und in die .env eintragen:
#   TEST_DATABASE_URL=postgresql://…/mappe_test
npm test
```

Die Tests brechen ab, wenn `TEST_DATABASE_URL` fehlt – sie leeren zwischen den
Läufen ganze Tabellen und dürfen die Arbeitsdatenbank nie anfassen.

## Lizenz

[AGPL-3.0-or-later](LICENSE).

Kurz: Mappe darf frei benutzt, geändert und weitergegeben werden. Wer eine
geänderte Fassung über ein Netzwerk anderen zugänglich macht, muss den
Quelltext dieser Fassung ebenfalls zugänglich machen. Deshalb verlinkt die
Oberfläche im Profil auf den Quelltext – für den eigenen Betrieb ist nichts
weiter zu tun.
