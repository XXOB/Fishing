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
5. GitHub Pages für das Repository aktivieren und `www.petriklar.com` als Custom Domain hinterlegen; HTTPS erzwingen, sobald das Zertifikat bereitsteht.
6. Bei netcup die GitHub-Pages-DNS-Einträge für `petriklar.com` und `www.petriklar.com` pflegen.
7. Bei netcup getrennte Postfächer für `info@petriklar.com`, `datenschutz@petriklar.com` und `no-reply@petriklar.com` anlegen. Für Datenschutzanfragen möglichst keine Weiterleitung an einen zusätzlichen externen Mailanbieter verwenden.
8. Den netcup-SMTP-Zugang von `no-reply@petriklar.com` in Supabase für produktive Authentifizierungs-E-Mails einrichten.
9. Im netcup-CCP unter **Stammdaten → Auftragsverarbeitung** einen AV-Vertrag erstellen und ablegen.

## Offline-Grenze

Die Oberfläche, Hilfeseiten und statischen Ressourcen können aus dem PWA-Cache starten. Fangbuch- und Angelplatzdaten werden bewusst **nicht** im Offline-Cache gespeichert. Ohne Verbindung bleibt der persönliche Bereich gesperrt, statt möglicherweise veraltete oder fremde Daten anzuzeigen.

## Rechtlicher Hinweis

Die Rechtstexte sind technische Arbeitsentwürfe. Vor dem öffentlichen kommerziellen Start müssen Betreiberangaben, Dienstkonfigurationen und tatsächliche Datenflüsse vervollständigt und fachkundig geprüft werden.
