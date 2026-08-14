# PetriKlar v54 – Anmeldung, reine Cloud-Speicherung und PDF-Fangmeldung

## Enthalten

- Die App ist erst nach Registrierung bzw. Anmeldung nutzbar.
- Angelplätze, Fänge, Köder, Trips und die aktuelle Auswahl liegen ausschließlich im Supabase-Datensatz des angemeldeten Kontos.
- Im Browser wird nur die Supabase-Anmeldesitzung im `sessionStorage` gehalten; persönliche App-Daten werden nicht dauerhaft in `localStorage` gespeichert.
- Beim ersten Login werden vorhandene Daten einer älteren lokalen Version einmalig in die Cloud übernommen und die alten lokalen Schlüssel erst nach erfolgreichem Upload gelöscht.
- Änderungen werden automatisch in die Tabelle `app_state` geschrieben. Der Status steht oben beim Kontobutton.
- CSV-Download und -Upload bleiben als benutzergesteuerte Sicherung verfügbar.
- Unter **Fangbücher → Meldeformular PDF** kann für Angelplatz und Jahr eine Fangmeldung erzeugt werden.
- Das PDF enthält Fangtabelle, Zusammenfassung, Empfänger- und Anglerdaten sowie Unterschriftsfelder. Es wird heruntergeladen, aber nicht automatisch versendet.
- Im Client ist ausschließlich der öffentliche Supabase Publishable Key enthalten.

## Test nach dem Veröffentlichen

1. `app.js`, `index.html`, `styles.css` und diese Datei committen und zu GitHub pushen.
2. GitHub Pages öffnen und ein Konto erstellen.
3. Falls Supabase die E-Mail-Bestätigung verlangt, den Link in der Bestätigungs-E-Mail öffnen und anschließend anmelden.
4. Einen Test-Angelplatz und einen Testfang speichern.
5. In Supabase unter **Table Editor → app_state** kontrollieren, dass für den Benutzer genau eine Zeile existiert.
6. Die Seite in einem zweiten Browser öffnen, anmelden und prüfen, ob die Daten geladen werden.
7. Unter **Fangbücher → Meldeformular PDF** ein Test-PDF erzeugen.

## Wichtig

- Die Tabelle `app_state` und die Row-Level-Security-Regeln müssen eingerichtet sein. Jeder Benutzer darf ausschließlich die Zeile mit seiner eigenen `user_id` lesen und ändern.
- Niemals einen Secret- oder `service_role`-Key in `app.js` eintragen.
- Ohne Internetverbindung ist die App in dieser Ausbaustufe nicht nutzbar. Für eine spätere native App empfiehlt sich eine verschlüsselte Offline-Warteschlange mit nachträglicher Synchronisierung.
