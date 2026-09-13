# Moduly V1

Dein Studium, in deinem Plan. Ein persönlicher Studienplaner für eine kleine Nutzergruppe, ohne Analyse- oder Werbedienste.

**Die [GitHub-Pages-Seite](https://muhammedbdc.github.io/Moduly/) ist die vollständig nutzbare lokale V1.** Konten und Studienpläne werden getrennt im lokalen Speicher des jeweiligen Browsers abgelegt. Es gibt keine Synchronisierung zwischen Browsern oder Geräten. Werden Browserdaten gelöscht, gehen die Daten verloren; deshalb erinnert die Anwendung dauerhaft an JSON-Sicherungen.

## Was V1 enthält

- Eindeutige, auch bei anderer Groß-/Kleinschreibung geschützte Benutzernamen; Registrierung ohne Pflicht-E-Mail, Anmeldung und einmalige Wiederherstellungscodes.
- Private Studienprofile, Wechsel und Archivierung ohne Verlust des bisherigen Plans.
- Module mit ECTS, Semester, Status, Note, Versuchen, Quellen, Notizen, Hilfsmitteln und Prüfungsdauer. Eigene Einträge sind als **„Von dir bearbeitet“** markiert.
- Prüfungsbestandteile mit Gewichtung, Pflichtbestandteilen und Ergebnis; Abhängigkeiten zwischen Modulen mit Kreisprüfung.
- Berechneter Studienfortschritt und ECTS-gewichteter Notenschnitt. Persönlicher Voraussetzungencheck für die Abschlussarbeit.
- Prüfungen, Abgaben und weitere Fristen mit IANA-Zeitzonen, Bearbeitung, Löschung, Monatskalender und ICS-Export. Pro Termin sind Erinnerungen eine Woche, einen Tag und zwei Stunden vorher frei wählbar.
- Lernaufgaben mit Frist, Aufwand, Notizen und Abschlussstatus.
- Anpassbare Dashboard-Reihenfolge, ausblendbare Bereiche, kompakte Darstellung, Hell-/Dunkelmodus und abschaltbare Animationen. Anmelden, Erstellen, Abmelden und Löschen besitzen eigene Tastatur-, Maus- und Touch-Reaktionen.
- JSON-Vollsicherung und Import mit Vorschau; gefilterte PDF-, CSV-, Markdown-, TXT- und Kalenderexporte.
- Versionskonfliktschutz bei mehreren Tabs und Wiederherstellung von bis zu 20 früheren Planständen innerhalb von 30 Tagen.
- Lokale, innerhalb eines Browsers eindeutige Benutzernamen, gehashte Passwörter, Wiederherstellungscode und Konto mit Passwortbestätigung löschen. Der Code hilft nicht nach dem Löschen der Browserdaten; dafür ist ein JSON-Backup nötig.
- Lokale Fehlermeldungen und ein Adminbereich mit Nutzerrollen, Sperren, Löschung, Meldungsbearbeitung, Backup-Status und Änderungsprotokoll. Er verwaltet nur Konten desselben Browsers.
- Ein manuell geprüfter Hochschulkatalog für Hochschule Bremen, Jade Hochschule am Campus Oldenburg und Universität Bremen. Enthalten ist die vollständige persönliche Vorlage für ISWI B.Eng. nach der HSB-BPO vom 22. April 2025 mit 32 Modulen und 210 ECTS.
- Zusätzliche versionierte Vorlagen können vom Betreiber über die Konsole eingespielt werden. Eine persönliche Kopie wird nie durch eine neue Vorlagenversion überschrieben.
- Zusätzlich bleibt ein optionaler Docker-Betrieb mit Gunicorn, SQLite und Caddy für eine spätere zentrale Serverinstanz vorbereitet.

Offizielle Angaben werden nur mit verlinkter Primärquelle aufgenommen. Unbekannte Prüfungsdauern, Hilfsmittel, individuelle Zulassungsvoraussetzungen und konkrete Wahlpflichtentscheidungen bleiben offen. Die HSB-Vorlage ist eine bearbeitbare persönliche Kopie und keine amtliche Leistungs- oder Zulassungsauskunft. Für Jade Hochschule und Universität Bremen ist noch kein konkreter Studiengang hinterlegt, weil bisher keiner benannt wurde. Details und Quellen stehen im [Studienkatalog](docs/STUDY-CATALOG.md).

Große Community-Funktionen, Rankings, Discord, KI-Importe, Werbung und öffentliche Profile gehören nicht zu V1.

## GitHub Pages

Für die aktuelle Nutzung muss nichts gekauft werden. Nach jedem Push auf `main` prüft GitHub Actions die Browser-App und veröffentlicht das freigegebene statische Paket. Persönliche Daten werden nie in das Repository oder das Pages-Artefakt geschrieben.

Wichtige Grenze: Ein Konto auf Handy A ist auf Laptop B nicht vorhanden. Auch der lokale Adminbereich kann nur Konten verwalten, die im selben Browser angelegt wurden. Jeder Nutzer sollte nach wichtigen Änderungen unter **Export → JSON-Backup** eine Sicherung herunterladen.

## Optional: eigener Server

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

GitHub Actions prüft Berechnungen, lokale Kontotrennung, Adminrechte, Backups und die Bedienabläufe, bevor die GitHub-Pages-App veröffentlicht wird. In das Pages-Artefakt gelangen ausschließlich erlaubte statische Dateien, niemals Nutzerdaten.

## Aufbau

| Pfad | Aufgabe |
| --- | --- |
| `index.html` | Zugänglicher Rahmen und Anmeldung |
| `assets/app.js` | Seiten, Dialoge und Nutzerabläufe |
| `assets/api.js` | Lokale Konten/Datenbank sowie optionaler Servertransport |
| `assets/domain.js` | Berechnung, Kalender und Importprüfung |
| `assets/styles.css`, `assets/v1.css` | Gestaltung, Layout und reduzierte Bewegung |
| `catalog/v1.json` | Geprüfte Hochschulliste und mit Quellen belegte Studienvorlagen |
| `server/catalog.py` | Prüfung und sichere Bereitstellung des eingebauten Katalogs |
| `server/app.py` | Konten, Sitzungen, persönliche API und Verwaltung |
| `server/model.py` | Serverseitige Validierung und Berechnung |
| `server/exports.py` | Private Downloads einschließlich PDF und ICS |
| `server/manage.py` | Betreiberkonsole, Vorlagen, Backup und Restore |
| `server/migrations/` | Versioniertes Datenbankschema |
| `deploy/`, `compose.yml` | Containerstart, HTTPS und dauerhafte Volumes |
| `tests/` | API-, Berechnungs- und Bedienablauftests |
| `docs/` | Hosting, Datenschutzbetrieb und V1-Grenzen |

Weitere Details: [Architektur](docs/ARCHITECTURE.md), [Studienkatalog](docs/STUDY-CATALOG.md), [Betrieb und Datenschutz](docs/OPERATIONS.md), [Designquellen](ATTRIBUTION.md).

## Vor einer öffentlichen oder geschäftlichen Nutzung

Der Code liefert Funktionen und technische Schutzmaßnahmen. Die tatsächlichen Anbieterangaben, der gebuchte Hostingvertrag, Standort/AV-Vertrag, externe Backups und die konkreten Datenschutzhinweise müssen zur betriebenen Instanz passen. Es wird keine pauschale Rechtskonformität oder ungeprüfte Produktionsfreigabe behauptet. Die verbleibenden konkreten Schritte stehen in der Hostinganleitung.
