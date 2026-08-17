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

