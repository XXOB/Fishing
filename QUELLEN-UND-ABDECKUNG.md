# DeepFish – Wasserwerte und Abdeckung (v43)

DeepFish übernimmt ausschließlich **aktuelle automatische Messwerte**, sofern ein
amtlicher beziehungsweise öffentlich bereitgestellter Datenweg vorhanden ist.
Periodische Probenahmen und Laboruntersuchungen werden nicht importiert.

## Eingebundene Netze

| Gebiet | Amtliche Quelle | Abdeckung in DeepFish |
|---|---|---|
| Deutschland | PEGELONLINE/WSV | Pegel/Abfluss und – wo die Station es liefert – Temperatur, Sauerstoff, Leitfähigkeit, pH |
| große Bundeswasserstraßen | BfG Undine | Temperatur und Sauerstoff an Rhein, Ems, Weser, Elbe, Oder und Donau; damit auch Stationen in mehreren Ländern |
| Baden-Württemberg | LUBW/NIZ | alle vom NIZ gelieferten Oberflächengewässer-Stationen; Temperatur, Sauerstoff, Trübung, pH, Leitfähigkeit soweit vorhanden |
| Bayern | LfU/GKD + NID | alle GKD-Temperaturstationen an Flüssen und Seen; alle GKD-Schwebstoffstationen; automatische NID-Sauerstoffstationen |
| Berlin | Wasserportal Berlin | alle aktuellen Online-Stationen; Temperatur, Sauerstoff, pH und Leitfähigkeit soweit vorhanden |
| Brandenburg | LfU Brandenburg | alle zehn automatischen Gütestationen; Temperatur sowie bei Vollstationen Sauerstoff und Trübung |
| Hessen | HLNUG-Datenportal | alle online gelieferten kontinuierlichen „Messstationen“; Temperatur, Sauerstoff und Trübung soweit vorhanden |
| Niedersachsen | NLWKN Gewässergüte Online | alle aktuell aufgelisteten automatischen Gütestationen; Temperatur, Sauerstoff und Trübung soweit vorhanden |
| Nordrhein-Westfalen | LANUK/HYWIS | alle aktuellen Wassertemperaturstationen; zusätzliche Bundeswasserstraßen über PEGELONLINE/Undine |
| Rheinland-Pfalz | Landesportal GuS | alle sieben kontinuierlichen Untersuchungsstationen; zusätzliche Bundeswasserstraßen über PEGELONLINE/Undine |
| Saarland | Gewässer-Monitoring/SEBA Hydrocenter | alle aktuell auf der öffentlichen Webmap betriebenen Online-Sonden; Temperatur und Sauerstoff sowie weitere kontinuierliche Parameter soweit vorhanden |
| Sachsen | BfUL/LfULG | fünf aktive automatische Gütestationen Schmilka, Zehren, Dommitzsch, Bad Düben und Görlitz; Temperatur, Sauerstoff, Trübung |
| Sachsen-Anhalt | LHW/BfG Undine | automatische Stationen Wittenberg (Elbe), Groß Rosenburg (Saale) und Dessau (Mulde) über Undine |
| Nord- und Ostsee | BSH MARNET | zwölf Hauptstationen als Messpunkte; Temperatur-/Sauerstoff-Segmente und amtliche Messreihen. Das BSH bietet aktuelle Werte dort überwiegend nur als Diagramm, nicht als offene Zahlen-API. |
| Schweiz | BAFU Datenplattform | alle aktiven Stationen des offenen Live-Feeds; Pegel/Abfluss und Wassertemperatur sowie weitere Güteparameter, sobald sie im Feed geliefert werden |
| Niederlande, Nordsee und Wattenmeer | Rijkswaterstaat DDAPI20/WFS | alle Standorte mit letzter Beobachtung für Pegel, Temperatur, Sauerstoff und Trübung/Schwebstoff |
| Österreich – bundesweit | BMLUK OGC Features | alle im offenen Feed veröffentlichten aktuellen Pegel- und Abflussstationen |
| Niederösterreich | Landes-Kartenfeed | Wasserstand, Durchfluss und Wassertemperatur aller darin veröffentlichten Stationen |
| Oberösterreich | Hydrographischer Dienst OGD | Wasserstand und Wassertemperatur aus den amtlichen ZRXP-Sammeldateien; Georeferenzierung über HZB-Nummer/Messstellenliste |
| Kärnten | Hydrographischer Dienst GeoJSON | Fluss- und Seepegel, Durchfluss und Wassertemperatur soweit je Station geliefert |
| Salzburg | Land Salzburg OGD | alle veröffentlichten Abfluss- und Seepegel; vorhandene aktuelle Werte werden übernommen |

## Österreich und Nutzungsstatus

Das nationale eHYD-Webportal und seine nicht ausdrücklich angebotenen internen
Downloads werden **nicht** automatisiert ausgelesen. Eingebunden sind stattdessen
separat veröffentlichte OGC-/OGD-/JSON-Angebote. BMLUK, Oberösterreich und
Kärnten weisen offene Lizenzen (CC BY 4.0) aus. Bei Niederösterreich und Salzburg
wird im exportierten Datensatz vermerkt, dass die
Bestätigung für die geplante kommerzielle Nutzung noch aussteht. Die Quellen-
und Zeitangabe bleibt an jeder Station erhalten.

## Länder ohne zusätzliches offenes Live-Gütenetz

Für Bremen, Hamburg, Mecklenburg-Vorpommern, Schleswig-Holstein und
Thüringen ist neben PEGELONLINE/Undine beziehungsweise BSH-MARNET derzeit kein
landesweites, aktuelles, ohne Anmeldung maschinenlesbares Netz für die drei
gewünschten Parameter eingebunden. Vorhandene WRRL-Messstellen sind dort häufig
periodische Probenstellen und daher keine aktuellen Sensorstationen.

## Darstellung

- grau: Pegel/Wasserstand oder Abfluss
- rot: Wassertemperatur
- blau: Sauerstoff
- braun: Trübung oder Schwebstoff

Ein Punkt wird in gleich große Kuchenstücke geteilt. Ko-lokalisierte Pegel- und
Gütestationen werden zusammengeführt. „≥2 Werte“ filtert Punkte mit nur einem
Segment aus. Werte älter als die jeweilige Frist werden nicht als aktuelle Zahl
angezeigt; der Messpunkt bleibt als Stations-/Parameter-Metadatum sichtbar.

## Quellseiten

- https://www.pegelonline.wsv.de/webservice/dokuRestapi
- https://undine.bafg.de/
- https://niz.baden-wuerttemberg.de/oberflaechengewaesser/gueteparameter
- https://www.gkd.bayern.de/de/fluesse/wassertemperatur/tabellen
- https://www.gkd.bayern.de/de/seen/wassertemperatur/tabellen
- https://www.gkd.bayern.de/de/fluesse/schwebstoff/tabellen
- https://www.nid.bayern.de/sauerstoff/bayern/tabellen
- https://www.hlnug.de/messwerte/datenportal
- https://www.gewaessergueteonline.nlwkn.niedersachsen.de/Messwerte
- https://lfu.brandenburg.de/lfu/de/aufgaben/wasser/fliessgewaesser-und-seen/gewaesserueberwachung/wasserguetemessnetz/
- https://www.wasser.sachsen.de/gewaesserguetemessnetz-18251.html
- https://wasserportal.berlin.de/messwerte.php?anzeige=tabelle&thema=owt
- https://www.gewaesser-monitoring.de/?Messdaten-Saar
- https://www2.bsh.de/daten/MARNET/Uebersichtskarte/Uebersichtskarte.html
- https://data.bafu.admin.ch/api
- https://geo.rijkswaterstaat.nl/services/ogc/hws/DDAPI20/ows
- https://gis.lfrz.gv.at/api/geodata/i000501/ogc/features/v1/collections/i000501%3Apegel_aktuell/items
- https://www.noe.gv.at/wasserstand/
- https://data.ooe.gv.at/files/hydro/HDOOE_Export_WT.zrxp
- https://data.ooe.gv.at/files/hydro/HDOOE_Export_OG.zrxp
- https://info.ktn.gv.at/asp/hydro/daten/json/
- https://www.salzburg.gv.at/ogd/943b7dda-5c3d-40d3-80de-f29a491a59fa/Abfluss_und_Seepegel.json
