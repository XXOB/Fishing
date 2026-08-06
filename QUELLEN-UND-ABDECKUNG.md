# DeepFish – Wasserwerte und Abdeckung (v41)

DeepFish übernimmt **aktuelle automatische Messwerte**, sofern ein amtlicher,
ohne Anmeldung abrufbarer Datenweg vorhanden ist. Periodische WRRL-Laborproben
(oft nur einige Male pro Jahr) werden nicht als Live-Sensoren dargestellt.

## Eingebundene Netze

| Gebiet | Amtliche Quelle | Abdeckung in DeepFish |
|---|---|---|
| Deutschland | PEGELONLINE/WSV | Pegel/Abfluss und – wo die Station es liefert – Temperatur, Sauerstoff, Leitfähigkeit, pH |
| große Bundeswasserstraßen | BfG Undine | Temperatur und Sauerstoff an Rhein, Ems, Weser, Elbe, Oder und Donau; damit auch Stationen in mehreren Ländern |
| Baden-Württemberg | LUBW/NIZ | alle vom NIZ gelieferten Oberflächengewässer-Stationen; Temperatur, Sauerstoff, Trübung, pH, Leitfähigkeit soweit vorhanden |
| Bayern | LfU/GKD + NID | alle GKD-Temperaturstationen an Flüssen und Seen; alle GKD-Schwebstoffstationen; automatische NID-Sauerstoffstationen |
| Berlin | Wasserportal Berlin | alle aktuellen Oberflächen-Wassertemperaturstationen |
| Brandenburg | LfU Brandenburg | alle zehn automatischen Gütestationen; Temperatur sowie bei Vollstationen Sauerstoff und Trübung |
| Hessen | HLNUG-Datenportal | alle online gelieferten kontinuierlichen „Messstationen“; Temperatur, Sauerstoff und Trübung soweit vorhanden |
| Niedersachsen | NLWKN Gewässergüte Online | alle aktuell aufgelisteten automatischen Gütestationen; Temperatur, Sauerstoff und Trübung soweit vorhanden |
| Nordrhein-Westfalen | LANUK/HYWIS | alle aktuellen Wassertemperaturstationen; zusätzliche Bundeswasserstraßen über PEGELONLINE/Undine |
| Rheinland-Pfalz | Landesportal GuS | alle sieben kontinuierlichen Untersuchungsstationen; zusätzliche Bundeswasserstraßen über PEGELONLINE/Undine |
| Sachsen | BfUL/LfULG | fünf aktive automatische Gütestationen Schmilka, Zehren, Dommitzsch, Bad Düben und Görlitz; Temperatur, Sauerstoff, Trübung |
| Sachsen-Anhalt | LHW/BfG Undine | automatische Stationen Wittenberg (Elbe), Groß Rosenburg (Saale) und Dessau (Mulde) über Undine |
| Nord- und Ostsee | BSH MARNET | zwölf Hauptstationen als Messpunkte; Temperatur-/Sauerstoff-Segmente und amtliche Messreihen. Das BSH bietet aktuelle Werte dort überwiegend nur als Diagramm, nicht als offene Zahlen-API. |
| Schweiz | BAFU Datenplattform | alle aktiven Stationen des offenen Live-Feeds; Pegel/Abfluss und Wassertemperatur sowie weitere Güteparameter, sobald sie im Feed geliefert werden |
| Niederlande, Nordsee und Wattenmeer | Rijkswaterstaat DDAPI20/WFS | alle Standorte mit letzter Beobachtung für Pegel, Temperatur, Sauerstoff und Trübung/Schwebstoff |

## Österreich

Das nationale eHYD-Portal untersagt in seinen Hinweisen ausdrücklich das
Herunterladen der Inhalte und dahinterstehenden Datenquellen, soweit ein Inhalt
nicht ausdrücklich als Download angeboten wird. Deshalb wird eHYD **nicht**
automatisiert ausgelesen. Eine kommerzielle App braucht für eine österreichweite
Live-Abdeckung eine schriftliche Freigabe oder frei lizenzierte Landes-Feeds.

## Länder ohne zusätzliches offenes Live-Gütenetz

Für Bremen, Hamburg, Mecklenburg-Vorpommern, Saarland, Schleswig-Holstein und
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
- https://www2.bsh.de/daten/MARNET/Uebersichtskarte/Uebersichtskarte.html
- https://data.bafu.admin.ch/api
- https://geo.rijkswaterstaat.nl/services/ogc/hws/DDAPI20/ows
