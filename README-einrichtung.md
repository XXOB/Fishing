# Rhein-Check Mainz/Wiesbaden – Einrichtung (GitHub Pages)

Ergebnis: eine normale Webseite, die in **jedem Browser ohne Erweiterung** läuft.
Pegel und Wetter kommen live direkt aus offenen APIs. Die Güte-Werte (Sauerstoff,
Trübung, Wassertemperatur, pH, Leitfähigkeit) werden **alle 3 Stunden** von einem
kostenlosen GitHub-Job geholt und in `wasserwerte.json` gespeichert; die Seite lädt
diese Datei von der eigenen Adresse.

## Dateien in diesem Paket

| Datei | Zweck | Ablageort im Repo |
|---|---|---|
| `rhein-check-mainz.html` | Das Dashboard | als **`index.html`** ins Wurzelverzeichnis |
| `wasserwerte.json` | Startwerte (wird vom Job überschrieben) | Wurzelverzeichnis |
| `fetch_wasserwerte.py` | holt die CSV & schreibt `wasserwerte.json` | Wurzelverzeichnis |
| `github-workflow-wasserwerte.yml` | der 6-Stunden-Job | nach **`.github/workflows/wasserwerte.yml`** |

## Schritt für Schritt

1. **GitHub-Konto anlegen** (falls nicht vorhanden) auf github.com – kostenlos.
2. **Neues Repository** erstellen, z. B. `rhein-check`, Sichtbarkeit **Public**.
3. **Dateien hochladen** (Repo-Seite → „Add file“ → „Upload files“):
   - `rhein-check-mainz.html` hochladen und dabei in **`index.html`** umbenennen.
   - `wasserwerte.json` und `fetch_wasserwerte.py` hochladen.
   - `github-workflow-wasserwerte.yml` hochladen und den Pfad auf
     **`.github/workflows/wasserwerte.yml`** setzen (beim Upload den Ordner mit
     eintippen: `.github/workflows/` vor den Dateinamen).
4. **GitHub Pages einschalten:** Repo → **Settings** → **Pages** →
   „Build and deployment“ → Source: **Deploy from a branch** → Branch: **main** /
   **/(root)** → Save. Nach ~1 Minute erscheint deine URL
   (`https://DEINNAME.github.io/rhein-check/`).
5. **Job einmal testen:** Repo → **Actions** → „Wasserwerte aktualisieren“ →
   **Run workflow**. Nach ~2 Minuten sollte `wasserwerte.json` aktualisiert sein.
   Danach läuft er automatisch alle 3 Stunden.

Fertig. Öffne die Pages-URL – auf jedem Gerät, in jedem Browser.

## Hinweise

- Der Job braucht Schreibrechte: Repo → **Settings** → **Actions** → **General** →
  „Workflow permissions“ → **Read and write permissions** aktivieren.
- Der Zeitplan läuft in **UTC**; `0 */3 * * *` = 00/03/06/09/12/15/18/21 Uhr UTC.
- Erkennt das Skript eine CSV-Spalte nicht, bricht der Job ab und zeigt im
  Actions-Log den Kopf der CSV. Schick mir diese Zeilen – dann passe ich die
  Zuordnung punktgenau an.
- Ganz ohne GitHub geht es auch: `fetch_wasserwerte.py` auf einem beliebigen
  Server per Cron alle 6 h laufen lassen; die Seite lädt `wasserwerte.json` aus
  demselben Ordner.
