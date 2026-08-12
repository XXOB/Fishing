DeepFish HMI v52 – Supabase-Konto und Cloud-Synchronisierung

Enthalten:
- Registrierung mit E-Mail und Passwort
- Anmeldung, Abmeldung und Passwort-Zurücksetzung
- Kontobutton und sichtbarer Synchronisierungsstatus
- automatische Erstmigration vorhandener LocalStorage-Daten
- automatische Synchronisierung von Angelplätzen, Fängen, Ködern und Trips
- Zusammenführen lokaler und bereits vorhandener Cloud-Daten beim ersten Login
- Offline-Weiterarbeit; Änderungen werden beim nächsten Login/Sync hochgeladen
- manueller Button „Jetzt synchronisieren“
- ausschließlich der öffentliche Publishable Key ist im Client enthalten

Erster Test:
1. Dateien app.js, index.html und styles.css in das Repository übernehmen.
2. Committen und pushen.
3. GitHub Pages öffnen und oben rechts „Anmelden“ wählen.
4. „Konto erstellen“ drücken und Bestätigungs-E-Mail öffnen.
5. Danach anmelden. Vorhandene lokale DeepFish-Daten werden automatisch in app_state gespeichert.
6. In Supabase unter Table Editor > app_state kontrollieren, ob eine Zeile angelegt wurde.

Wichtig:
- Die SQL-Tabelle app_state und die RLS-Regeln müssen zuvor angelegt sein.
- Niemals einen Secret Key oder service_role Key in app.js eintragen.
