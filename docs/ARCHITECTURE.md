# V1-Architektur

## Daten und Zugriffe

Die Anwendung wird unter einer einzigen Origin betrieben. Flask liefert eine enge Liste statischer Dateien und die JSON-API; Gunicorn bedient die HTTP-Anfragen hinter genau einem Caddy-Proxy. Der Browser erhält keine Datenbankzugangsdaten. Private Seiten nutzen Hash-Navigation und werden nicht indexiert.

Ein Konto besitzt einen `workspaces`-Datensatz mit einer streng validierten Struktur. Diese enthält bis zu 12 Studienprofile, 1.000 Module, 2.000 Termine und 2.000 Lernaufgaben. Ein serialisierter Plan ist auf 1,5 MB begrenzt, HTTP-Anfragen auf 2 MB. Jede Lese-, Schreib-, Export- und Versionsabfrage verwendet ausschließlich die aus der Sitzung ermittelte Nutzerkennung. Clientseitig eingesendete Rollen oder Nutzerkennungen ändern diesen Kontext nicht.

Benutzernamen bestehen aus 3–24 ASCII-Buchstaben, Ziffern oder Unterstrichen. SQLite verhindert mit `COLLATE NOCASE UNIQUE` doppelte Namen unabhängig von Groß-/Kleinschreibung, auch bei konkurrierender Registrierung.

`templates` und unveränderte `template_versions` sind zentrale Vorlagen. Persönliche Pläne sind Kopien mit neuen Kennungen und werden nie zurück in zentrale Vorlagen geschrieben. Module einer persönlichen Kopie werden als persönlich bearbeitbar markiert. V1 behauptet keine automatische Prüfung offizieller Quellen.

## Sitzungen und Schreibschutz

- Passwörter: PBKDF2-HMAC-SHA256 mit 600.000 Iterationen und zufälligem Salt pro Passwort.
- Zufällige Sitzungstokens liegen nur als SHA256-Hash in SQLite; Browsercookie `HttpOnly`, produktiv `Secure`, `SameSite=Lax`, sieben Tage feste Laufzeit.
- Mutationen benötigen passende `Origin`, JSON-Inhalt und bei authentifizierten Anfragen ein sitzungsgebundenes CSRF-Token.
- Recoverycodes sind zufällig, hochentropisch und gehasht. Erfolgreiches Recovery rotiert den Code und widerruft alle vorherigen Sitzungen.
- Anmelde-, Recovery-, Registrierungs-, Export- und Schreiblimits werden in der Datenbank geführt. Netzwerkkennungen werden mit einem installationsbezogenen HMAC pseudonymisiert.
- Der Proxy ist nur in der mitgelieferten Topologie vertrauenswürdig. Port 8000 nicht öffentlich freigeben und `MODULY_TRUST_PROXY` nicht beliebig aktivieren.

SQLite mit WAL und einer Transaktion pro Planänderung ist auf eine kleine Nutzergruppe auf einem einzelnen Server ausgelegt. Für mehrere Anwendungsserver ist zuerst eine Migration auf eine gemeinsame Datenbank erforderlich. Konten werden nicht allein anhand des Frontends voneinander getrennt.

## Änderungen und Wiederherstellung

Jeder Plan trägt eine Revision. `PUT /api/state` muss die aktuell bekannte Revision senden. Bei einer fremden neueren Revision antwortet die API mit 409 und überschreibt keine Daten. Der Dialog lässt Eingaben zur Sicherung geöffnet. Nach dem Neuladen muss die Änderung bewusst erneut angewandt werden.

Vor einer erfolgreichen Änderung wird der alte Stand in `history` übernommen; es bleiben maximal 20 frühere Versionen für höchstens 30 Tage zugänglich. Die tägliche Backupbereinigung entfernt auch abgelaufene Historien, Sitzungen und Rate-Limit-Zähler. Falls der Backupdienst ausfällt, kann physische Bereinigung verspätet erfolgen; Zugriffsprüfungen für abgelaufene Sitzungen und Historien bleiben aktiv.

Kontolöschungen werden vor dem Löschen als interne Kennung in ein getrenntes, synchron geschriebenes Löschjournal eingetragen. Die aktive Datenbank löscht Konto, Pläne, Versionen, Sitzungen und Meldungen per Fremdschlüssel-Kaskade. Ein Restore vereinigt das Journal der Sicherung mit dem aktuellen Journal und löscht diese Konten erneut. Auditlogs haben auf Datenbankebene Schreib-/Löschschutz; ein Serveradministrator könnte technisch dennoch die Datenbank verändern. V1 bietet keinen manipulationssicheren externen Auditdienst.

## Fachliche Regeln

ECTS zählen ausschließlich an bestandenen Modulen. Prüfungsbestandteile und mehrsemestrige Veranstaltungen erzeugen keine zusätzlichen ECTS. Ein Modul muss daher einmal im Plan angelegt werden; weitere Veranstaltungen können in Notizen bzw. Terminen verknüpft werden. Der Notenschnitt ist ECTS-gewichtet über bestandene, benotete Module mit positiven ECTS. Er ist kein verbindlicher hochschulspezifischer Gesamtnotenschnitt.

Noten von 1,0 bis 5,0, bestanden bis 4,0; abweichende Notensysteme sind in V1 nicht implementiert. Pflichtbestandteile eines bestandenen Moduls müssen als bestanden markiert sein. Bestandteilgewichte dürfen zusammen maximal 100 % betragen. Die Gesamtnote wird vom Nutzer entsprechend seiner Prüfungsordnung eingetragen und nicht aus unvollständigen Teilnoten geraten.

Voraussetzungen müssen andere Module desselben Profils sein und dürfen keinen Kreis bilden. Der Abschlussarbeitscheck vergleicht nur eingetragene Mindest-ECTS und markierte Pflichtmodule. Weitere formale Zulassungsbedingungen werden nicht automatisch beurteilt.

Termine speichern lokale Wandzeit plus IANA-Zeitzone. Nicht existierende Zeiten bei der Zeitumstellung werden abgelehnt; doppelte Zeiten verwenden das erste Vorkommen. ICS exportiert UTC-Start/Ende, stabile UIDs, korrekt gefaltete UTF-8-Zeilen und zwei Erinnerungen. Es handelt sich um einen Dateiimport, kein Kalenderabonnement.

## Grenzen und spätere Erweiterungen

V1 enthält keine E-Mail-Zustellung, verifizierten Administrator-E-Mails, MFA, automatischen Studienkatalog, Scraper, beliebigen Dokumentuploads, öffentlichen Community-Beiträge, Discord-Anbindung, Notenanerkennungsautomatik oder Werbung. Operatorrollen werden über die Serverkonsole vergeben. Schutz gegen einen kompromittierten Server, Ende-zu-Ende-Verschlüsselung und eine unabhängige Sicherheitsprüfung sind nicht enthalten.

Für einen späteren größeren Dienst: separate relationale Planentitäten, automatisierte externe Backups samt Alarmierung, MFA für Verwaltung, feinere Rollen, manuell geprüfte Datenquellen und eine rechtliche Prüfung der konkret aktivierten Community-Funktionen ergänzen. Diese Funktionen werden nicht als bereits verfügbar dargestellt.

Technische Referenz: [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Flask Deployment mit Gunicorn](https://flask.palletsprojects.com/en/stable/deploying/gunicorn/).
