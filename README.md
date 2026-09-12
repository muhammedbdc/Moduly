# Moduly

Moduly ist ein persönlicher Studienplaner. Diese erste Version zeigt die spätere Arbeitsoberfläche und speichert Änderungen lokal im Browser.

## Enthalten

- Dashboard mit ECTS, Terminen, Prüfungen und persönlichen Notizen
- Studienplan für mehrere Semester
- Module hinzufügen, bearbeiten, abschließen und entfernen
- Persönliche Änderungen mit „Von dir bearbeitet“
- Prüfungen eintragen und als ICS exportieren
- Datenexport als JSON
- Anpassbare Dashboard-Bereiche
- Responsive Bedienung für Smartphone, Tablet und Desktop
- Tastaturbedienung und reduzierte Bewegung

## Lokal öffnen

Die Anwendung hat keine Abhängigkeiten. `index.html` kann direkt geöffnet oder mit einem beliebigen statischen Webserver ausgeliefert werden.

```bash
python3 -m http.server 8080
```

Danach `http://localhost:8080` aufrufen.

## Kostenlos über GitHub Pages veröffentlichen

1. Unter **Settings → Pages** als Quelle **GitHub Actions** auswählen.
2. Den Workflow `Deploy Moduly to GitHub Pages` starten oder einen Commit auf `main` übertragen.
3. Die öffentliche Adresse erscheint nach dem Lauf unter **Settings → Pages**.

## Technischer Stand

Diese Version ist ein funktionsfähiger Frontend-Draft. Daten liegen nur im Browser des jeweiligen Geräts. Für echte Konten, eindeutige Benutzernamen und geräteübergreifende Synchronisierung werden später ein Backend, eine Datenbank und serverseitige Berechtigungen ergänzt.

## Designquellen

Die Interaktionsideen orientieren sich an den vom Auftraggeber ausgewählten Open-Source-Beispielen auf Uiverse.io. Die konkrete Umsetzung und das Erscheinungsbild wurden für Moduly neu aufgebaut. Siehe [ATTRIBUTION.md](ATTRIBUTION.md).
