# Mail-Anbindung einrichten

Mappe holt Bewerbungen aus einem Postfach ab und antwortet aus demselben
Postfach. Dafür gibt es drei Adapter. Welcher passt, hängt vom Anbieter ab:

| Anbieter | Adapter | Warum |
| --- | --- | --- |
| Microsoft 365 / Exchange Online | **Graph API** | Basic Auth ist dort abgeschaltet, IMAP funktioniert nicht mehr |
| iCloud, Hoster-Postfächer, eigener Mailserver | **IMAP/SMTP** | Braucht kein OAuth |
| Google Workspace / Gmail | **Gmail API** oder IMAP | API ist stabiler, IMAP schneller eingerichtet |

---

## Microsoft 365 (Graph API)

### 1. App-Registrierung anlegen

Im [Entra-Portal](https://entra.microsoft.com) unter
**Identität → Anwendungen → App-Registrierungen → Neue Registrierung**:

- Name: `Mappe`
- Unterstützte Kontotypen: *Nur Konten in diesem Organisationsverzeichnis*
- Redirect-URI: vorerst leer lassen (wird nur für den Microsoft-Login gebraucht)

Nach dem Anlegen notieren:

- **Anwendungs-ID (Client)** → Feld *Anwendungs-ID*
- **Verzeichnis-ID (Mandant)** → Feld *Verzeichnis-ID*

### 2. Client-Secret erzeugen

Unter **Zertifikate & Geheimnisse → Neuer geheimer Clientschlüssel**.

> Der Wert wird nur **einmal** angezeigt. Sofort kopieren.
> Und die Laufzeit notieren – läuft das Secret ab, bleibt der Mail-Abruf
> stehen. Mappe zeigt den Fehler dann im Posteingang an.

### 3. Berechtigungen vergeben

Unter **API-Berechtigungen → Berechtigung hinzufügen → Microsoft Graph →
Anwendungsberechtigungen**:

- `Mail.ReadWrite`
- `Mail.Send`

Anschließend **Administratorzustimmung erteilen**.

> `Mail.ReadWrite` statt `Mail.Read`: Ohne Schreibrecht lassen sich Nachrichten
> weder als gelesen markieren noch verschieben – die Abhol-Regeln greifen dann
> nicht.

### 4. Zugriff auf ein Postfach begrenzen

Ohne diesen Schritt darf die App **jedes** Postfach im Tenant lesen. Mit einer
Application Access Policy wird sie auf das Bewerbungspostfach eingegrenzt.

In der Exchange Online PowerShell:

```powershell
New-ApplicationAccessPolicy `
  -AppId <Anwendungs-ID> `
  -PolicyScopeGroupId bewerbung@firma.de `
  -AccessRight RestrictAccess `
  -Description "Mappe darf nur das Bewerbungspostfach lesen"
```

Prüfen:

```powershell
Test-ApplicationAccessPolicy -Identity bewerbung@firma.de -AppId <Anwendungs-ID>
```

Die Richtlinie braucht bis zu einer Stunde, bis sie greift.

### 5. In Mappe eintragen

**Einstellungen → Mail-Anbindung**, Anbieter *Microsoft 365 (Graph API)*:
Postfach, Verzeichnis-ID, Anwendungs-ID und Secret. Speichern, dann
**Verbindung prüfen**.

---

## IMAP/SMTP

Geeignet für iCloud, klassische Hoster und eigene Mailserver.
**Nicht** für Microsoft 365 – dort ist Basic Auth abgeschaltet.

### iCloud

1. Auf [account.apple.com](https://account.apple.com) ein
   **app-spezifisches Passwort** erzeugen. Das normale Kennwort funktioniert
   nicht.
2. In Mappe eintragen:

| Feld | Wert |
| --- | --- |
| IMAP-Server | `imap.mail.me.com`, Port `993`, verschlüsselt |
| SMTP-Server | `smtp.mail.me.com`, Port `587`, *nicht* direkt verschlüsselt (STARTTLS) |
| Benutzername | Die vollständige iCloud-Adresse |
| Passwort | Das app-spezifische Passwort |

### Hoster-Postfächer

Die Zugangsdaten stehen beim Anbieter. Üblich sind Port `993` für IMAP
(verschlüsselt) und Port `587` für SMTP mit STARTTLS. Bei Port `465` gehört
*Direkt verschlüsselt* angehakt.

### Wie der Fortschritt gemerkt wird

IMAP kennt keinen Delta-Mechanismus. Mappe merkt sich die höchste gelesene UID
und die UIDVALIDITY des Ordners. Wechselt der Server die UIDVALIDITY, wird der
Ordner neu eingelesen – bereits importierte Nachrichten werden dabei erkannt
und übersprungen.

---

## Google Workspace / Gmail

### Über die Gmail-API

1. In der [Google Cloud Console](https://console.cloud.google.com) ein Projekt
   anlegen und die **Gmail API** aktivieren.
2. Unter **APIs & Dienste → OAuth-Zustimmungsbildschirm** eine interne App
   einrichten.
3. **Anmeldedaten → OAuth-Client-ID** (Typ: Webanwendung) erzeugen.
4. Einmalig ein **Refresh-Token** für das Bewerbungspostfach erteilen. Die
   nötigen Bereiche sind:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.send`
5. Client-ID, Secret und Refresh-Token in Mappe eintragen.

Das Refresh-Token bleibt gültig, bis es widerrufen wird. Wird es ungültig,
meldet Mappe das im Posteingang im Klartext.

### Über IMAP

Einfacher, aber die Zwei-Faktor-Anmeldung muss aktiv sein und es braucht ein
App-Passwort. Server: `imap.gmail.com` (993) und `smtp.gmail.com` (587).

---

## Weiterleitung von info@ einrichten

Kommen Bewerbungen zuerst bei `info@` an, gibt es zwei Wege:

### Empfohlen: Umleiten (Redirect)

In Exchange als **Umleiten** anlegen, nicht als „Weiterleiten". Dann bleibt der
Bewerber im `From` stehen und alles funktioniert ohne weitere Einstellung.

Exchange Admin Center → **E-Mail-Fluss → Regeln → Regel hinzufügen**:

- Wenn: Empfänger ist `info@firma.de`
- Dann: **Nachricht umleiten an** `bewerbung@firma.de`

### Sonst: Weiterleitungsadresse eintragen

Wird tatsächlich weitergeleitet, steht das Verteilerpostfach im `From`. Dann
unter **Einstellungen → Mail-Anbindung** die Adresse `info@firma.de` bei den
*Weiterleitungsadressen* eintragen. Mappe sucht den ursprünglichen Absender
dann in drei Stufen:

1. In einer angehängten Originalnachricht (`message/rfc822`)
2. In den Kopfzeilen `Resent-From`, `X-Forwarded-For` oder `Reply-To`
3. Im eingebetteten Vorspann des Textes („Von: … Gesendet: … An: …")

In der Bewerbung steht anschließend, worüber sie kam und welcher Absender
übernommen wurde.

---

## Abhol-Regeln

Nach dem Import kann Mappe die Nachricht im Postfach aufräumen:

- **als gelesen markieren** – zeigt im Postfach, was schon im Tool ist
- **in einen Ordner verschieben** – hält den Posteingang leer

Beide Regeln greifen erst **nach** erfolgreichem Import. Schlägt der Import
fehl, bleibt die Nachricht unangetastet im Posteingang liegen.

---

## Fehlersuche

| Meldung | Ursache |
| --- | --- |
| „Microsoft hat die Anmeldung abgelehnt" | Secret abgelaufen oder Tenant-/Client-ID falsch |
| „Microsoft verweigert den Zugriff" | Berechtigungen fehlen, Zustimmung nicht erteilt, oder die Access Policy schließt das Postfach aus |
| „Der Server hat die Anmeldung abgelehnt" (IMAP) | Bei iCloud/Google fehlt das app-spezifische Passwort |
| „Google hat das Refresh-Token abgelehnt" | Zugriff widerrufen – Token neu erteilen |
| Abruf läuft, aber nichts kommt an | Steht der richtige Ordner in den Einstellungen? Wurde der Abruf-Stand schon einmal gesetzt? Unter *Posteingang* lässt er sich zurücksetzen. |

Der letzte Fehler steht immer unter **Posteingang** – im Klartext, ohne Blick
ins Serverprotokoll.
