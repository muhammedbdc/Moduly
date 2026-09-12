# Moduly auf ZAP-Hosting

Diese Anleitung ist für einen Linux-Server mit Docker Compose vorgesehen. Die Website, Benutzerkonten und SQLite-Datenbank laufen gemeinsam auf deinem Server; Caddy stellt HTTPS bereit. Ein reiner statischer Webspace kann diese Installation nicht ausführen.

## 1. Server und Domain vorbereiten

Du brauchst Linux mit SSH-Zugang und Docker Compose, eine Domain und Zugriff auf deren DNS. Die Installation belegt die Ports 80 und 443. Dort darf kein zweiter Webserver laufen. Port 8000 wird in der mitgelieferten Compose-Datei ausschließlich innerhalb des Docker-Netzwerks verwendet.

Offizielle Anleitungen:

- [ZAP: Docker auf Linux installieren](https://zap-hosting.com/guides/docs/dedicated-linux-docker/)
- [ZAP: Erster SSH-Zugang](https://zap-hosting.com/guides/docs/vserver-linux-ssh/)
- [ZAP: Domain-Verwaltung](https://zap-hosting.com/guides/docs/domain-introduction/)
- [Caddy: Automatisches HTTPS](https://caddyserver.com/docs/automatic-https)

Setze einen **A-Eintrag** für die gewünschte Domain oder Subdomain auf die IPv4-Adresse deines Servers. Setze einen **AAAA-Eintrag** nur dann, wenn dieselbe Anwendung über diese IPv6-Adresse erreichbar ist. Erlaube TCP 80/443 für HTTPS und die Zertifikatsprüfung; UDP 443 ist optional für HTTP/3. Erhalte deinen SSH-Zugang, bevor du Firewallregeln änderst.

Am Handy kannst du die ZAP-Verwaltung im Browser öffnen und dich mit einem SSH-Client auf deinen Server verbinden. Danach genügen die folgenden Befehle. Die spätere Website öffnest du ganz normal in Safari oder Chrome unter deiner Domain.

## 2. Dateien holen

```bash
git clone https://github.com/muhammedbdc/Moduly.git
cd Moduly
python3 scripts/setup_env.py
nano .env
```

Trage die tatsächlichen Werte ein:

| Variable | Eintrag |
| --- | --- |
| `MODULY_DOMAIN` | Vollständiger Hostname, z. B. `studium.deine-domain.de`, ohne `https://` oder Pfad |
| `MODULY_OPERATOR_NAME` | Tatsächlicher Anbietername |
| `MODULY_OPERATOR_ADDRESS` | Tatsächliche Anbieteranschrift, einzeilig |
| `MODULY_OPERATOR_EMAIL` | Erreichbare elektronische Kontaktadresse |
| `MODULY_HOST_DESCRIPTION` | Tatsächlicher Hoster, gebuchter Standort, relevante Empfänger/Verarbeitungen laut Vertrag |
| `MODULY_PRIVACY_EXTRA` | Ergänzungen passend zu deiner Instanz und ihren Speicherfristen |
| `MODULY_REGISTRATION` | `true` erlaubt Registrierung, `false` schließt sie |
| `MODULY_INVITE_CODE` | Bereits zufällig erzeugter Code für dich und deine Freunde; leer wäre offene Registrierung |
| `MODULY_BACKUP_KEY` | Bereits erzeugter Verschlüsselungsschlüssel, nicht neu erzeugen, solange alte Backups benötigt werden |

Werte mit Sonderzeichen oder `#` in einfache Anführungszeichen setzen. Keine Platzhalter mit fremden Anbieterangaben veröffentlichen. Sende `.env`, Passwörter oder den Backupschlüssel nicht in einen Chat oder nach GitHub. Sichere den Schlüssel getrennt vom Server, beispielsweise in deinem Passwortmanager. Ohne ihn lassen sich Backups nicht entschlüsseln.

Die E-Mail-Adresse hier ist die öffentliche Kontaktadresse des Betreibers und die Kontaktadresse für TLS-Zertifikate. Moduly versendet in V1 keine E-Mails und verifiziert keine Adressen.

## 3. Starten

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Mit `docker compose config --quiet` werden keine aufgelösten Geheimnisse ausgegeben. Verwende nicht unbedacht `docker compose config` ohne `--quiet`, wenn du die Ausgabe weitergibst.

Öffne anschließend `https://DEINE_DOMAIN`. Caddy fordert das Zertifikat automatisch an und erneuert es, sofern DNS und Erreichbarkeit stimmen. Beim ersten Start kann das einen Moment dauern. Bei Problemen:

```bash
docker compose logs --tail=80 web caddy
```

Erstelle dein Konto im Browser mit dem Einladungscode. Sichere den Wiederherstellungscode sofort. Anschließend kannst du dein eigenes Studium anlegen. Es werden keine erfundenen Studiengänge als offiziell ausgegeben.

## 4. Verwaltung freischalten

Erstelle zuerst ein normales Konto. Die Betreiberkonsole kann danach die Rolle vergeben:

```bash
docker compose exec web python -m server.manage role DEIN_BENUTZERNAME owner
```

Bestehende Sitzungen werden dabei widerrufen. Nach erneuter Anmeldung erscheint „Verwaltung“. Dort kannst du Fehlermeldungen beantworten und den letzten Backupstatus ansehen. Die Verwaltungs-API liefert keine fremden Studienpläne. Die Befugnis zum Rollenwechsel und zum Restore bleibt bei der Serverkonsole.

## 5. Backup prüfen und außerhalb des Servers sichern

Der Dienst `backup` erstellt beim Start und anschließend ungefähr alle 24 Stunden ein verschlüsseltes Backup. Erfolgreiche Sicherungen werden entschlüsselt und in einer temporären Datenbank auf Integrität geprüft. Lokale Sicherungen werden 30 Tage aufbewahrt. Ein Fehler erscheint in den Dienstlogs und in der Verwaltung; es gibt keine automatische E-Mail-Benachrichtigung.

```bash
docker compose logs --tail=30 backup
docker compose exec backup python -m server.manage backup
docker compose exec backup ls /backups
```

Kopiere regelmäßig eine aktuelle `.mbackup`-Datei **und das aktuelle Löschjournal** aus den Containern an einen getrennten, verschlüsselten Speicherort:

```bash
mkdir -m 700 -p private-backups
docker compose cp backup:/backups/DATEINAME.mbackup private-backups/
docker compose cp web:/journal/deletions.jsonl private-backups/deletions.jsonl
chmod 600 private-backups/*
```

`private-backups` außerhalb des Git-Repositorys anlegen oder verschieben. Kopien auf derselben Serverplatte schützen nicht gegen den Verlust des Servers. Übertrage diese Dateien z. B. per SFTP auf einen getrennten, verschlüsselten Datenträger. Der Zielanbieter wird hier bewusst nicht ohne deine Wahl eingerichtet. Das Löschjournal enthält interne Kennungen gelöschter Konten und muss geschützt bleiben.

Die zugehörigen Docker-Volumes heißen `moduly_data`, `moduly_journal`, `moduly_backups`, `moduly_caddy-data` und `moduly_caddy-config`. **`docker compose down -v` würde diese Daten löschen und gehört nicht zu normalen Updates.**

## 6. Aktualisieren

Erzeuge vor dem Update ein geprüftes Backup und sichere Schlüssel/aktuelles Löschjournal. Danach:

```bash
docker compose exec backup python -m server.manage backup
git pull --ff-only
docker compose up -d --build
docker compose ps
```

Der Start führt noch nicht angewandte Datenbankmigrationen aus. Größere zukünftige Migrationen zuerst auf einer isolierten Kopie prüfen. Ein Release mit geändertem Schema darf nicht blind auf einen älteren Code zurückgesetzt werden. Persönliche Volumes bleiben bei normalen Containerupdates erhalten.

## 7. Restore in eine neue Datei

Die CLI überschreibt keine aktive Datenbank. Das **aktuelle** Löschjournal wird benötigt; ein Journal aus einem alten Backup allein reicht nicht aus. So bleiben zwischenzeitlich gelöschte Konten gelöscht.

```bash
docker compose stop web backup caddy
docker compose run --rm --no-deps backup python -m server.manage restore /backups/DATEINAME.mbackup /data/restored.sqlite3 --journal /journal/deletions.jsonl
```

Der Befehl entschlüsselt die Sicherung, prüft Integrität und Referenzen, wendet das Löschjournal an und widerruft alle Sitzungen. Er bricht ab, wenn `restored.sqlite3` bereits existiert.

Erst nach erfolgreicher Prüfung wird die Datei bei gestoppten Diensten aktiviert:

```bash
docker compose run --rm --no-deps --entrypoint python backup -c "from pathlib import Path; import sqlite3,os; p=Path('/data'); c=sqlite3.connect(p/'moduly.sqlite3'); c.execute('PRAGMA wal_checkpoint(TRUNCATE)'); c.close(); os.link(p/'moduly.sqlite3',p/'before-restore.sqlite3'); os.replace(p/'restored.sqlite3',p/'moduly.sqlite3')"
docker compose up -d
```

`before-restore.sqlite3` vorher prüfen: Existiert bereits eine Datei dieses Namens, wähle einen neuen Sicherungsnamen. Für das Wiederherstellen von Backups anderer Schemaversionen ist die dazugehörige Anwendungsversion erforderlich. Nach dem Restore Anmeldung, Studienplan und Export mit einem Testkonto prüfen. Die alte, unverschlüsselte Datenbank nach bestätigtem Erfolg gemäß deinem Löschkonzept entfernen.

## Vor Nutzung mit echten Daten

- Domain erreicht diese Instanz über HTTPS; normales Anmelden funktioniert.
- Anbieterangaben und Datenschutzhinweise beschreiben deinen tatsächlichen Betrieb; Hostingvertrag/AV-Vertrag und Standort sind geprüft.
- Einladungscode ist gesetzt, falls nur Freunde registrieren sollen.
- Backup läuft, der Schlüssel ist separat gesichert, eine Kopie liegt außerhalb des Servers und ein Restore wurde geprüft.
- Ein Testkonto lässt sich exportieren und löschen. Mit einem zweiten Konto sind dessen Daten nicht sichtbar.

Die technische Umsetzung ist keine Rechtsberatung und keine Zusage, dass eine beliebige Hostingkonfiguration automatisch rechtskonform ist.
