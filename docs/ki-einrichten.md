# KI-Anbindung einrichten

Die KI ist **optional**. Ohne sie läuft der Import genauso: Mails werden
abgeholt, Anhänge gespeichert, Name, Adresse und Telefon regelbasiert gelesen,
die Stelle über Referenznummer und Stichworte zugeordnet. Die KI ist die
Veredelung, nicht die Grundlage.

## Was die KI zusätzlich kann

| Aufgabe | Was sie bringt |
| --- | --- |
| **Erkennung** | Ist das überhaupt eine Bewerbung? Auf welche Stelle? Auch bei unscharfer Formulierung |
| **Extraktion** | Kontaktdaten aus unstrukturiertem Fließtext, wo Muster nicht greifen |
| **Zusammenfassung** | Drei bis fünf Sätze zum Überfliegen |
| **PDF-Split** | Seitenklassifikation für die Auftrennung in Anschreiben, Lebenslauf, Zeugnisse |

Jede Aufgabe lässt sich einzeln abschalten.

## Was übertragen wird

Bei eingeschalteter KI gehen an den eingestellten Anbieter:

- der Text der Bewerbungsmail
- der aus den PDFs **gelesene Text**
- Titel und Beschreibung der offenen Stellen (für die Zuordnung)

Nicht übertragen werden die Dateien selbst. Die KI bekommt Text, keine
Rohdaten – das spart Tokens und hält Bilder aus der Übertragung heraus.

Wie viel Text höchstens geht, steht in den Einstellungen (Vorgabe: 24.000
Zeichen). Längere Bewerbungen werden gekürzt.

Solange die KI läuft, steht in der Seitenleiste dauerhaft ein Kennzeichen mit
dem aktiven Modell.

## Anbieter

In den Einstellungen setzt ein Klick auf eine Vorlage Basis-URL und Modell.

### OpenAI

| Feld | Wert |
| --- | --- |
| Basis-URL | `https://api.openai.com/v1` |
| Modell | `gpt-4o-mini` |
| API-Schlüssel | aus dem OpenAI-Dashboard |

Kosten liegen bei einem günstigen Modell im Cent-Bereich je Bewerbung.

### Anthropic (Claude)

| Feld | Wert |
| --- | --- |
| Basis-URL | `https://api.anthropic.com/v1` |
| Modell | `claude-haiku-4-5-20251001` |
| API-Schlüssel | aus der Anthropic-Konsole |

Anthropic bietet eine OpenAI-kompatible Schnittstelle an – derselbe Code
funktioniert unverändert.

### Azure OpenAI

| Feld | Wert |
| --- | --- |
| Basis-URL | `https://IHRE-RESSOURCE.openai.azure.com/openai/deployments/IHR-DEPLOYMENT` |
| Modell | Name des Deployments |
| API-Schlüssel | aus dem Azure-Portal |

### Ollama (lokal)

Der Weg, bei dem keine Daten das Haus verlassen.

| Feld | Wert |
| --- | --- |
| Basis-URL | `http://host.docker.internal:11434/v1` |
| Modell | `qwen2.5:3b` oder `llama3.2:3b` |
| API-Schlüssel | leer lassen |
| Zeitlimit | **300 Sekunden oder mehr** |

Läuft Ollama auf einem anderen Rechner, dort statt `host.docker.internal` die
IP eintragen.

**Was auf einem Mac mini M1 mit 8 GB zu erwarten ist:** 3B-Modelle laufen
entspannt, ein 7B in Q4 passt gerade so. Ollama lädt das Modell erst bei der
ersten Anfrage in den Arbeitsspeicher und entlädt es nach Leerlauf wieder – der
Kaltstart dauert ein paar Sekunden, eine Bewerbung dann grob ein bis zwei
Minuten. Für einen Hintergrundjob ist das völlig in Ordnung: Der Mail-Abruf
wartet nicht auf die KI, sondern läuft weiter.

Die inhaltliche Trefferquote bleibt unter dem, was eine API liefert. Weil alles
ohnehin als Vorschlag im Prüfschritt landet, ist das verkraftbar.

## Wie das JSON erzwungen wird

Die Anbieter unterscheiden sich darin, wie streng sie eine Antwortstruktur
erzwingen können. Mappe probiert der Reihe nach:

1. **JSON-Schema** – die Struktur wird erzwungen (OpenAI, Azure, neuere Ollama)
2. **JSON-Objekt** – wenigstens gültiges JSON wird erzwungen
3. **gar nichts** – das JSON wird aus dem Text herausgeschnitten

Welche Stufe ein Endpunkt beherrscht, merkt sich Mappe nach dem ersten Versuch.
Die Verbindungsprüfung zeigt an, welche greift.

Kleine Modelle rahmen ihre Antwort gern in einen Markdown-Block oder stellen
einen Satz voran. Beides wird abgeräumt. Lässt ein Modell eine Seite aus oder
erfindet eine Kategorie, wird das begradigt, bevor etwas in die Datenbank
kommt.

## Was die Zusammenfassung bewusst weglässt

Die Zusammenfassung bleibt sachlich, spricht keine Empfehlung aus und lässt
Angaben zu Alter, Herkunft, Geschlecht, Familienstand, Religion und Gesundheit
ausdrücklich außen vor. Solche Merkmale gehören nicht in die Vorauswahl.

## Fehlersuche

| Meldung | Ursache |
| --- | --- |
| „Der API-Schlüssel wurde abgelehnt" | Schlüssel falsch, abgelaufen oder ohne Guthaben |
| „Endpunkt oder Modell nicht gefunden" | Basis-URL oder Modellname stimmt nicht. Die URL endet **ohne** `/chat/completions` |
| „Die KI hat innerhalb von N Sekunden nicht geantwortet" | Bei Ollama das Zeitlimit erhöhen – der erste Aufruf lädt das Modell |
| „Zu dieser Bewerbung liegt kein auswertbarer Text vor" | Gescanntes PDF ohne Texterkennung. Ohne Text kann auch die KI nichts lesen |
