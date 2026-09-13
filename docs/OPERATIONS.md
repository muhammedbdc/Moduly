# Betrieb, Daten und Quellen

## Betreiberaufgaben

Die mitgelieferten Datenschutzhinweise beschreiben die tatsächlich implementierten Funktionen. Vor einem öffentlichen Betrieb müssen Anbietername, Anschrift, erreichbare Kontaktadresse und die konkreten Hostingangaben eingetragen sein. Zusätzliche Vertragspartner, andere Serverlogs, externe Sicherungen oder spätere Erweiterungen müssen in den Hinweisen korrekt ergänzt werden. Der Betreiber legt Rechtsgrundlagen und Löschfristen anhand des tatsächlichen Dienstes fest.

Relevante Primärquellen für diese Prüfung sind die [DSGVO](https://eur-lex.europa.eu/eli/reg/2016/679/oj?locale=de), insbesondere Informationspflichten und Betroffenenrechte, und die [Anbieterinformationen nach § 5 DDG](https://www.gesetze-im-internet.de/ddg/__5.html). Diese Links sind keine Zusage, dass alle Fragen des konkreten Betriebs mit einem Formular erledigt sind.

Die V1 setzt keine optionalen Werbe-/Trackingcookies. Der Servermodus setzt ein notwendiges Sitzungscookie. Die ausdrücklich gestartete Gerätevorschau speichert den Plan in Local Storage. Externe Quellen werden als Links geöffnet; Inhalte werden nicht serverseitig heruntergeladen. Der Betreiber muss die tatsächlich verwendeten Hostingdienste in seine Datenschutzhinweise aufnehmen.

## Dateninventar

| Daten | Speicherort | Zweck / Bereinigung |
| --- | --- | --- |
| Benutzername, Passwort- und Recoveryhash, Konto-Rolle, Erstellungszeit | SQLite `users` | Konto; Löschung auf bestätigte Kontoanfrage |
| Studienprofile und persönliche Einträge | SQLite `workspaces` | Studienorganisation; private Exporte; Kontolöschung |
| Frühere Planstände | SQLite `history` | Maximal 20, höchstens 30 Tage zugänglich; tägliche Bereinigung |
| Sitzungs-Tokenhash, CSRF, Ablaufzeit | SQLite `sessions` | Sieben Tage; Widerruf bei Recovery, Kontolöschung oder entsprechender Kontoaktion |
| Pseudonyme Rate-Limit-Kennungen | SQLite `rate_limits` | Kurze Schutzfenster, maximal eine Stunde; Bereinigung bei Folgeanfrage/Backup |
| Vom Nutzer eingegebene Meldungen und Antworten | SQLite `reports` | Fehler-/Datenschutzbearbeitung; Kontolöschung |
| Verwaltungsaktionen mit internen Kennungen | SQLite `audit` | Nachvollziehbarkeit; Zugriff nur Verwaltung und Serverbetrieb |
| Gelöschte Konto-IDs | Getrenntes Journal-Volume | Nachvollzug der Löschung bei jedem Restore |
| Verschlüsselte Sicherungen | Backup-Volume, Betreiberkopien | Automatisch 30 Tage lokal; externe Kopien nach dokumentierter Frist |

Auditkennungen und Löschjournal sind ebenfalls zu schützen. Für V1 werden sie nicht automatisch zeitbasiert entfernt, weil unbekannte externe Backupkopien existieren können. Betreiber müssen alle Sicherungskopien und ihre Fristen dokumentieren. Eine Journal-Kennung darf erst bereinigt werden, wenn keine wiederherstellbare Sicherung mit diesem Konto mehr vorhanden ist. Alte personenbezogene Daten dürfen nicht durch ein manuelles Wiederherstellen ohne Journal erneut aktiv werden.

Die Runtime führt keine HTTP-Zugriffslogs mit IP-Adressen oder Anfrageinhalten. Gunicorn/Caddy und Docker können Betriebs-/Fehlerlogs schreiben; Docker-Logs sind größenbegrenzt. Logs nicht ungeprüft veröffentlichen. Die Bedingungen und Logs des Hostinganbieters müssen separat betrachtet werden.

## Vorlagen veröffentlichen

Der mit der Version ausgelieferte, manuell geprüfte Katalog liegt in `catalog/v1.json`. Änderungen daran gehören in einen geprüften Release und müssen Quellenstand, Vorlagenversion sowie Tests für Modulzahl und ECTS-Summe aktualisieren. Der aktuelle Umfang steht in [STUDY-CATALOG.md](STUDY-CATALOG.md).

Zusätzliche Betreiber-Vorlagen sind JSON-Studienstrukturen entsprechend `server/model.py`, mit genau einem Profil, offenen Modulen, Quellenlinks und ohne private Noten, Versuche, Notizen, Aufgaben oder Termine. Es gibt keinen automatischen Import fremder Webseiten.

1. Aktuelle Prüfungsordnung und Modulhandbuch persönlich prüfen.
2. Profil, PO-Version, Module, ECTS, Prüfungsumfang und Quellenlinks erfassen. Unbekanntes offenlassen.
3. Die reine `state`-Struktur ohne äußere Exportmetadaten in einer JSON-Datei bereitstellen.
4. Auf dem Server importieren:

```bash
docker compose cp vorlage.json web:/tmp/vorlage.json
docker compose exec web python -m server.manage template-import hochschule-studiengang-po2025 /tmp/vorlage.json
```

Die CLI legt eine neue Version an; die alte bleibt in `template_versions` erhalten. Eine neue PO bekommt eine neue Vorlagenkennung. Nutzer entscheiden selbst, wann sie eine persönliche Kopie anlegen. V1 hat keine Veröffentlichung durch normale Nutzer und kein Reputationssystem.

## Bei einem Vorfall

Zuerst den Zugriff begrenzen, beispielsweise `docker compose stop caddy` für eine sofortige Unterbrechung der öffentlichen Erreichbarkeit. Erforderliche Belege geschützt sichern, Ursache und betroffene Daten prüfen, Zugangsschlüssel bzw. Sitzungen widerrufen und erst nach einer geprüften Reparatur neu starten. Rechtliche Melde-/Informationspflichten richten sich nach dem konkreten Vorfall; eine automatische Meldung ist nicht implementiert.

## Wartung

Dependencies sind in `requirements.lock` und `package-lock.json` festgehalten. Aktualisierungen bewusst vornehmen und API-/DOM-Tests sowie den Containerstart prüfen. Die Docker-Basisimages sollten regelmäßig neu gebaut und aktualisiert werden. SQLite-Dateien nicht über Netzwerkdateisysteme mit ungeprüftem Locking teilen.

Backups auf demselben Server sind nur die erste Ebene. Regelmäßige getrennte Kopien und ein dokumentierter Wiederherstellungstest gehören zum tatsächlichen Betrieb. Die Anwendungsanzeige bestätigt die lokale Entschlüsselungs- und Integritätsprüfung, nicht den erfolgreichen Zugriff auf einen externen Sicherungsanbieter.
