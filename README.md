# Moduly V1

Dein Studium, in deinem Plan. Ein persönlicher Studienplaner für eine kleine Nutzergruppe, mit eigener Datenbank und ohne Analyse- oder Werbedienste.

**Die vollständige Anwendung wird auf einem eigenen Server betrieben.** Die [GitHub-Pages-Seite](https://muhammedbdc.github.io/Moduly/) ist eine ausdrücklich gekennzeichnete Gerätevorschau. Sie besitzt keine Serverkonten und synchronisiert keine Daten.

## Was V1 enthält

- Eindeutige, auch bei anderer Groß-/Kleinschreibung geschützte Benutzernamen; Registrierung ohne Pflicht-E-Mail, Anmeldung und einmalige Wiederherstellungscodes.
- Private Studienprofile, Wechsel und Archivierung ohne Verlust des bisherigen Plans.
- Module mit ECTS, Semester, Status, Note, Versuchen, Quellen, Notizen, Hilfsmitteln und Prüfungsdauer. Eigene Einträge sind als **„Von dir bearbeitet“** markiert.
- Prüfungsbestandteile mit Gewichtung, Pflichtbestandteilen und Ergebnis; Abhängigkeiten zwischen Modulen mit Kreisprüfung.
- Berechneter Studienfortschritt und ECTS-gewichteter Notenschnitt. Persönlicher Voraussetzungencheck für die Abschlussarbeit.
- Prüfungen, Abgaben und weitere Fristen mit IANA-Zeitzonen, Bearbeitung, Löschung, Monatskalender und ICS-Export mit Erinnerungen.
- Lernaufgaben mit Frist, Aufwand, Notizen und Abschlussstatus.
- Anpassbare Dashboard-Reihenfolge, ausblendbare Bereiche, kompakte Darstellung, Hell-/Dunkelmodus und abschaltbare Animationen.
- JSON-Vollsicherung und Import mit Vorschau; gefilterte PDF-, CSV-, Markdown-, TXT- und Kalenderexporte.
- Versionskonfliktschutz bei mehreren Geräten und Wiederherstellung von bis zu 20 früheren Planständen innerhalb von 30 Tagen.
- Kontoname/Passwort ändern, Wiederherstellungscode erneuern, andere Sitzungen abmelden und Konto mit Passwortbestätigung löschen.
- Private Fehlermeldungen und eine kleine Verwaltungsansicht, die keine privaten Studienpläne ausliest.
- Versionierte, vom Betreiber über die Konsole eingespielte Vorlagen. Eine persönliche Kopie wird nie durch eine neue Vorlagenversion überschrieben.
- Docker-Betrieb mit Gunicorn, SQLite und Caddy; verschlüsselte tägliche Backups mit Prüfung und Löschjournal beim Restore.

Es werden **keine erfundenen offiziellen Hochschuldaten** ausgeliefert. Die optionale Vorschau enthält frei erfundene Beispiele. Produktive Nutzer starten mit einem leeren Plan oder einer vom Betreiber eingespielten Vorlage. Eine neue Prüfungsordnung sollte als neue Vorlage mit eigener Kennung angelegt werden.

Große Community-Funktionen, Rankings, Discord, KI-Importe, Werbung und öffentliche Profile gehören nicht zu V1.

## Auf ZAP-Hosting starten

Die vorbereitete Installation benötigt einen **Linux-VPS oder Root-/Dedicated-Server mit Docker Compose und SSH-Zugang**. Bei einem Webspace-Tarif muss zuerst geprüft werden, ob dauerhafte Python-Prozesse bzw. Docker erlaubt sind. Die Domain allein führt die Anwendung nicht aus.

Die vollständige Anleitung steht in **[docs/ZAP-HOSTING.md](docs/ZAP-HOSTING.md)**. Dort sind Domain, HTTPS, Betreiberangaben, Einladungscode, Backups und Updates beschrieben.

```bash
git clone https://github.com/muhammedbdc/Moduly.git
cd Moduly
python3 scripts/setup_env.py
nano .env
docker compose up -d --build
```

Die leeren Pflichtwerte in `.env` müssen zuerst ergänzt werden. Das Setup erzeugt Backupschlüssel und Einladungscode lokal und überschreibt keine bestehende Konfiguration. Die Produktionsinstanz startet ohne Domain und Anbieter-/Hostingangaben nicht. `.env` gehört niemals in GitHub.

## Lokal entwickeln

Python 3.12, keine Node-Abhängigkeiten für den laufenden Dienst:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.lock
flask --app server.app:create_app run --port 8000
```

Unter `http://localhost:8000` öffnen. Das ist nur der Entwicklungsserver; auf dem Server wird Gunicorn verwendet. Die SQLite-Datei liegt lokal unter `data/`. Für abweichende URLs muss `MODULY_ORIGIN` exakt passen. Docker nutzt `MODULY_ORIGIN=https://DEINE_DOMAIN`.

## Prüfungen

```bash
python -m unittest discover -s tests -v
npm ci --ignore-scripts
npm run check
npm test
```

Node 24.15+ wird ausschließlich für Entwicklungstests benötigt. Die Tests prüfen Berechtigungen, Kontotrennung, Recovery, CSRF, Exporte, Berechnungen, Kalender-Zeitumstellungen, Backup/Restore und die Bedienabläufe im DOM. DOM-Tests ersetzen keine visuelle Prüfung in Safari oder Chrome.

GitHub Actions prüft diese Abläufe und den Start des Produktionscontainers, bevor eine neue Gerätevorschau veröffentlicht wird. In das Pages-Artefakt gelangen ausschließlich die erlaubten HTML-/CSS-/JavaScript-/SVG-Dateien.

## Aufbau

| Pfad | Aufgabe |
| --- | --- |
| `index.html` | Zugänglicher Rahmen und Anmeldung |
| `assets/app.js` | Seiten, Dialoge und Nutzerabläufe |
| `assets/api.js` | Servertransport und explizite Gerätevorschau |
| `assets/domain.js` | Berechnung, Kalender und Importprüfung |
| `assets/styles.css`, `assets/v1.css` | Gestaltung, Layout und reduzierte Bewegung |
| `server/app.py` | Konten, Sitzungen, persönliche API und Verwaltung |
| `server/model.py` | Serverseitige Validierung und Berechnung |
| `server/exports.py` | Private Downloads einschließlich PDF und ICS |
| `server/manage.py` | Betreiberkonsole, Vorlagen, Backup und Restore |
| `server/migrations/` | Versioniertes Datenbankschema |
| `deploy/`, `compose.yml` | Containerstart, HTTPS und dauerhafte Volumes |
| `tests/` | API-, Berechnungs- und Bedienablauftests |
| `docs/` | Hosting, Datenschutzbetrieb und V1-Grenzen |

Weitere Details: [Architektur](docs/ARCHITECTURE.md), [Betrieb und Datenschutz](docs/OPERATIONS.md), [Designquellen](ATTRIBUTION.md).

## Vor dem echten Betrieb

Der Code liefert Funktionen und technische Schutzmaßnahmen. Die tatsächlichen Anbieterangaben, der gebuchte Hostingvertrag, Standort/AV-Vertrag, externe Backups und die konkreten Datenschutzhinweise müssen zur betriebenen Instanz passen. Es wird keine pauschale Rechtskonformität oder ungeprüfte Produktionsfreigabe behauptet. Die verbleibenden konkreten Schritte stehen in der Hostinganleitung.
