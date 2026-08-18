# Supabase für PetriKlar einrichten

1. Im Supabase-Dashboard das PetriKlar-Projekt öffnen.
2. **SQL Editor → New query** wählen.
3. Den gesamten Inhalt von `migrations/20260816_phase1_cloud.sql` einfügen und **Run** drücken.
4. Unter **Authentication → URL Configuration** eintragen:
   - Site URL: `https://petriklar.com`
   - Redirect URLs: `https://petriklar.com/**` und während der Umstellung zusätzlich die aktuelle GitHub-Pages-Adresse.
5. Unter **Authentication → Providers → Email** E-Mail/Passwort aktiviert lassen.
6. Unter **Table Editor → app_state** prüfen, dass Row Level Security aktiv ist.

Die SQL-Funktion `delete_own_account()` ermöglicht die Löschung direkt in der App. Der Publishable Key darf im Browser stehen; Secret- und `service_role`-Keys dürfen niemals in den Webcode.

## Kontolöschung mit Bestätigungs-E-Mail

Die Edge Function `functions/delete-account/index.ts` löscht das angemeldete Konto serverseitig und versendet anschließend eine Bestätigung über den netcup-SMTP-Zugang. SMTP-Passwort und Supabase-Server-Schlüssel dürfen niemals in GitHub oder im Browsercode gespeichert werden.

1. Supabase CLI installieren und einmal anmelden: `npx supabase login`.
2. Im Projektordner verknüpfen: `npx supabase link --project-ref mcekltbtndpzjahwypze`.
3. Die SMTP-Werte als geschützte Function-Secrets setzen:
   `npx supabase secrets set SMTP_HOST=DEIN_NETCUP_MAILSERVER SMTP_PORT=465 SMTP_USER=no-reply@petriklar.com SMTP_PASS=DEIN_PASSWORT SMTP_FROM=no-reply@petriklar.com SMTP_FROM_NAME=PetriKlar`
4. Function veröffentlichen: `npx supabase functions deploy delete-account`.
5. Mit einem Testkonto prüfen. Nach erfolgreicher Löschung muss die App eine Bestätigung zeigen und im ehemaligen Postfach des Nutzers muss die E-Mail mit dem Betreff „Dein PetriKlar-Konto wurde gelöscht“ eingehen.

Der genaue Wert für `SMTP_HOST` steht im netcup Webhosting Control Panel bei den E-Mail-Einstellungen unter Posteingangs-/Postausgangsserver. Üblicherweise wird Port 465 mit SSL/TLS verwendet. Das vorhandene Datenbank-RPC bleibt vorläufig als Fallback aktiv; wenn die Edge Function noch nicht bereitsteht, wird das Konto zwar gelöscht, die App weist dann aber transparent darauf hin, dass keine Bestätigungs-E-Mail versendet werden konnte.
