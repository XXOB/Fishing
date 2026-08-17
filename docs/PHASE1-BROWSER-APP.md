# Phase 1 – PetriKlar als Browser-App/PWA

## Bereits im Code umgesetzt

- Anmeldung und persönliche Daten ausschließlich über Supabase `app_state` mit RLS
- Sperre der persönlichen App-Oberfläche, solange Cloud-Daten nicht sicher geladen sind
- installierbare PWA für Android, iPhone/iPad und Desktop
- Service Worker für App-Hülle und statische Dateien; persönliche Supabase-Daten werden nicht offline gecacht
- Online-/Offline- und Updatehinweise
- Impressum, Datenschutz, Support und öffentliche Anleitung zur Kontolöschung
- Kontolöschung direkt im angemeldeten Konto

## Einmalige Schritte vor Veröffentlichung

1. SQL aus `supabase/migrations/20260816_phase1_cloud.sql` im Supabase SQL Editor ausführen.
2. In `legal/legal-config.js` Betreibername und vollständige ladungsfähige Anschrift ersetzen.
3. Im Supabase-Dashboard unter **Project Settings → Infrastructure** die Projektregion prüfen und in `legal/legal-config.js` eintragen.
4. Supabase Auth Site URL und Redirect URLs auf `https://petriklar.com` setzen.
5. Cloudflare Pages mit dem GitHub-Repository verbinden: kein Build-Befehl, Ausgabeordner `/`.
6. `petriklar.com` und `www.petriklar.com` als Custom Domains verbinden; eine Variante dauerhaft auf die andere weiterleiten.
7. `info@petriklar.com` und `datenschutz@petriklar.com` über Cloudflare Email Routing an ein vorhandenes Postfach weiterleiten.
8. Für produktive Auth-E-Mails später einen eigenen SMTP-Anbieter in Supabase einrichten.

## Offline-Grenze

Die Oberfläche, Hilfeseiten und statischen Ressourcen können aus dem PWA-Cache starten. Fangbuch- und Angelplatzdaten werden bewusst **nicht** im Offline-Cache gespeichert. Ohne Verbindung bleibt der persönliche Bereich gesperrt, statt möglicherweise veraltete oder fremde Daten anzuzeigen.

## Rechtlicher Hinweis

Die Rechtstexte sind technische Arbeitsentwürfe. Vor dem öffentlichen kommerziellen Start müssen Betreiberangaben, Dienstkonfigurationen und tatsächliche Datenflüsse vervollständigt und fachkundig geprüft werden.

