DeepFish HMI v47
=================

Enthaltene Ersatzdateien:
- app.js
- index.html
- styles.css

Installation:
Diese drei Dateien im GitHub-Repository im Hauptverzeichnis ersetzen, committen und pushen.

Änderungen:
- Sauerstoff-Verlauf bis 7 Tage für Messstationen mit automatischer O2-Zeitreihe.
- PEGELONLINE-O2 wird für acht Tage abgerufen; vorhandene amtliche O2-Historien werden im Diagramm genutzt.
- Ein einziger Button „Download“ erzeugt eine CSV-Datei für den aktuell geöffneten Angelplatz.
- Umschalter „nur: Angelplatz / alle Plätze“ entfernt; in dieser Ansicht werden nur Daten des aktiven Angelplatzes gezeigt.
- Feld „Verwertung“ vollständig aus Eingabe, Detailansicht und CSV entfernt.
- Cache-Version 47.

Hinweis:
Ein Sauerstoff-Diagramm erscheint nur, wenn die jeweilige amtliche Quelle eine automatische Zeitreihe bereitstellt. Einzelne aktuelle O2-Messwerte ohne Verlauf bleiben als Zahlenwert sichtbar.
