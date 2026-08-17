# PetriKlar v60 – Cloud-Konto, PWA und Rechtstexte

## Enthalten

- Die App ist erst nach Registrierung bzw. Anmeldung nutzbar.
- Angelplätze, Fänge, Köder, Trips und die aktuelle Auswahl liegen ausschließlich im Supabase-Datensatz des angemeldeten Kontos.
- Im Browser wird nur die technisch notwendige Supabase-Anmeldesitzung im lokalen Browserspeicher gehalten; persönliche App-Daten werden nicht dauerhaft dort gespeichert.
- Beim ersten Login werden vorhandene Daten einer älteren lokalen Version einmalig in die Cloud übernommen und die alten lokalen Schlüssel erst nach erfolgreichem Upload gelöscht.
- Änderungen werden automatisch in die Tabelle `app_state` geschrieben. Der Status steht oben beim Kontobutton.
- CSV-Download und -Upload bleiben als benutzergesteuerte Sicherung verfügbar.
- Unter **Fangbücher → Meldeformular PDF** kann für Angelplatz und Jahr eine Fangmeldung erzeugt werden.
- Das PDF enthält Fangtabelle, Zusammenfassung, Empfänger- und Anglerdaten sowie Unterschriftsfelder. Es wird heruntergeladen, aber nicht automatisch versendet.
- Im Client ist ausschließlich der öffentliche Supabase Publishable Key enthalten.
- PetriKlar kann als PWA auf Android, iPhone/iPad und Desktop installiert werden.
- Der Offline-Cache enthält nur statische Programmdateien. Ohne Cloud-Verbindung bleibt der persönliche Bereich gesperrt.
- Impressum, Datenschutz, Support und Kontolöschung sind als Arbeitsentwürfe integriert.
- Nutzer können Konto und aktive App-Daten selbst löschen, sobald die mitgelieferte Supabase-Migration ausgeführt wurde.

## Test nach dem Veröffentlichen

1. Alle geänderten und neuen Dateien committen und zu GitHub pushen.
2. GitHub Pages öffnen und ein Konto erstellen.
3. Falls Supabase die E-Mail-Bestätigung verlangt, den Link in der Bestätigungs-E-Mail öffnen und anschließend anmelden.
4. Einen Test-Angelplatz und einen Testfang speichern.
5. In Supabase unter **Table Editor → app_state** kontrollieren, dass für den Benutzer genau eine Zeile existiert.
6. Die Seite in einem zweiten Browser öffnen, anmelden und prüfen, ob die Daten geladen werden.
7. Unter **Fangbücher → Meldeformular PDF** ein Test-PDF erzeugen.
8. Die App in Chrome/Edge installieren und auf iPhone/iPad in Safari zum Home-Bildschirm hinzufügen.
9. Offline starten: Die App-Hülle darf erscheinen, persönliche Cloud-Daten müssen gesperrt bleiben.

## Wichtig

- Die Migration `supabase/migrations/20260816_phase1_cloud.sql` muss einmal ausgeführt werden. Sie richtet `app_state`, Row Level Security und die eigene Kontolöschung ein.
- Niemals einen Secret- oder `service_role`-Key in `app.js` eintragen.
- Vor Veröffentlichung müssen Betreiberanschrift und Supabase-Projektregion in `legal/legal-config.js` eingetragen und die Rechtstexte fachkundig geprüft werden.
