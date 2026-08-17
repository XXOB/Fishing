# PetriKlar

Angelplätze, Cloud-Fangbuch, Fangmeldungen und Live-Bedingungen an deinen Gewässern.

## Entwicklung

- [Architektur, Modulstruktur und Änderungsleitfaden](docs/ARCHITEKTUR.md)
- [Phase 1: Browser-App/PWA veröffentlichen](docs/PHASE1-BROWSER-APP.md)
- [Supabase-Migration und RLS](supabase/README.md)
- Die Browser-App benötigt weiterhin keinen Build-Schritt.

## Betrieb

PetriKlar ist als installierbare Progressive Web App vorbereitet. Persönliche Daten liegen pro Benutzer in Supabase; der Service Worker speichert nur die statische App-Hülle, keine persönlichen Fangbuchdaten. Rechtstexte befinden sich unter `legal/` und müssen vor Veröffentlichung über `legal/legal-config.js` vervollständigt werden.
