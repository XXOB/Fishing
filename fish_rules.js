"use strict";

/* Eingebettete gesetzliche Basiswerte (Stand 06.08.2026).
   Die Anzeige bleibt absichtlich offline und enthält keine externen Links.
   Format: Fisch: [Mindestmaß, Schonzeit, optionaler Hinweis]. */
(function(){
  const N="kein landesweit festgelegtes Mindestmaß", K="keine allgemeine Schonzeit", G="ganzjährig geschützt";
  const r=(min,closed,note)=>[min||N,closed||K,note||""];
  const P=(min=N)=>r(min,G,"Entnahme verboten");
  const commonProtected={
    bitterling:P(), bachneunauge:P(), flussneunauge:P(), meerneunauge:P(),
    schlammpeitzger:P(), steinbeisser:P(), stoer:P(), atlantischerstoer:P(), maifisch:P()
  };
  const D={};
  const add=(name,rules,note="")=>D[name]={rules:Object.assign({},commonProtected,rules),note};

  add("Baden-Württemberg",{
    aal:r("50 cm","15. September–1. März","nur Rhein und Rheinsystem"), aland:r("25 cm","1. April–31. Mai"),
    aesche:r("30 cm","1. Februar–30. April"), bachforelle:r("25 cm","1. Oktober–28. Februar","Hochrhein: 35 cm; Fließgewässer über 800 m: 20 cm"),
    barbe:r("40 cm","1. Mai–15. Juni"), hecht:r("50 cm","15. Februar–15. Mai","Main: 1. Februar–30. April"),
    huchen:r("70 cm","1. Februar–31. Mai","nur Donausystem"), karpfen:r("35 cm",K), nase:r("35 cm","15. März–31. Mai"),
    quappe:r("30 cm","1. November–28. Februar"), rapfen:r("40 cm","1. März–31. Mai","nur Donausystem"),
    regenbogenforelle:r(N,"1. Oktober–28. Februar"), schleie:r("25 cm","15. Mai–30. Juni"),
    seeforelle:r("50 cm","1. Oktober–28. Februar"), seesaibling:r("25 cm","1. Oktober–28. Februar"),
    zander:r("45 cm","1. April–15. Mai","Main: 50 cm und 1. Februar–30. April"),
    karausche:P(), groppe:P()
  },"Sonderregeln für Hochrhein, Main, Donaugebiet und Höhenlagen beachten.");

  add("Bayern",{
    aal:r("50 cm","1. Oktober–31. Dezember","nicht im Donaugebiet"), aesche:r("35 cm","1. Januar–30. April"),
    bachforelle:r("26 cm","1. Oktober–15. März"), barbe:r("40 cm","1. Mai–30. Juni"),
    hecht:r("50 cm","15. Februar–30. April"), huchen:r("90 cm","15. Februar–30. Juni","Donaugebiet"),
    karpfen:r("35 cm",K), nase:r("30 cm","1. März–30. April"), regenbogenforelle:r("26 cm","15. Dezember–15. März"),
    rapfen:r("40 cm","1. März–30. April"), schied:r("40 cm","1. März–30. April"),
    schleie:r("26 cm","1. Mai–30. Juni"), seeforelle:r("60 cm","1. Oktober–15. März"),
    seesaibling:r("30 cm","1. Oktober–31. Dezember"), zander:r("50 cm","15. Februar–30. April"),
    quappe:r("40 cm",K), rutte:r("40 cm",K), renke:r("30 cm","15. Oktober–31. Dezember"),
    felchen:r("30 cm","15. Oktober–31. Dezember"), barsch:r(N,K), flussbarsch:r(N,K), wels:r(N,K), doebel:r(N,K), aitel:r(N,K),
    karausche:P(), groppe:r(N,"1. Februar–30. April")
  },"Einzugsgebiete Donau (D), Elbe (E), Rhein (R) und Weser (W) unterscheiden.");

  add("Berlin",{
    aal:r("50 cm",K), aland:r("30 cm",K), aesche:r("30 cm","1. Dezember–31. Mai"),
    bachforelle:r("30 cm","1. Oktober–30. April"), bachsaibling:r("25 cm","1. Oktober–30. April"), barbe:P(),
    doebel:r("30 cm",K), hecht:r("45 cm","1. Januar–30. April"), karpfen:r("35 cm",K), karausche:P(),
    quappe:r("30 cm",K), rapfen:r("40 cm","1. April–30. Juni"), regenbogenforelle:r("25 cm","1. Oktober–30. April"),
    schleie:r("25 cm",K), seeforelle:r("60 cm","1. Oktober–31. Mai"), wels:r("75 cm",K),
    zander:r("45 cm","1. Januar–31. Mai"), zope:r("20 cm","1. März–31. Mai"), nase:P(), groppe:P()
  });

  add("Brandenburg",{
    aal:r("50 cm",K), aland:r("30 cm",K), aesche:r("30 cm","1. Dezember–31. Mai"),
    bachforelle:r("30 cm","16. Oktober–15. April"), barbe:r("40 cm","1. Mai–31. Juli"),
    hecht:r("45 cm","1. Februar–31. März"), karpfen:r("35 cm",K), karausche:P(),
    quappe:r("30 cm",K), rapfen:r("40 cm","1. April–30. Juni"), schleie:r("25 cm",K),
    zander:r("45 cm","1. April–31. Mai"), zope:r("20 cm","1. März–31. Mai"), nase:P(), groppe:P()
  });

  add("Bremen",{
    aal:r("45 cm",K), aesche:r("35 cm","1. März–15. Mai"), bachforelle:r("30 cm","15. Oktober–15. März","nur bei Besatz/Bestandsstützung"),
    barsch:r("15 cm","1. Februar–15. Mai","Raubfischschonzeit"), flussbarsch:r("15 cm","1. Februar–15. Mai","Raubfischschonzeit"),
    doebel:r("30 cm",K), flunder:r("25 cm",K), hecht:r("60 cm","1. Februar–15. Mai","Raubfischschonzeit"),
    lachs:r("60 cm","15. Oktober–15. März","nur bei Besatz/Bestandsstützung"), meerforelle:r("50 cm","15. Oktober–15. März","nur bei Besatz/Bestandsstützung"),
    quappe:r("35 cm",K), rapfen:r("40 cm",K), zander:r("40 cm","1. Februar–15. Mai","Raubfischschonzeit"), groppe:P()
  });

  add("Hamburg",{
    aal:r("45–75 cm",K,"Entnahmefenster"), aesche:r(N,"1. Januar–15. Mai"), bachforelle:r("20–40 cm","15. Oktober–15. Februar","Entnahmefenster"),
    hecht:r("45–75 cm","1. Februar–31. Mai","Entnahmefenster"), karpfen:r("35 cm",K),
    meerforelle:r("40–65 cm","15. Oktober–15. Februar","Entnahmefenster"), quappe:r("30–50 cm",K,"Entnahmefenster"),
    rapfen:r("50–70 cm",K,"Entnahmefenster"), schleie:r("25–45 cm",K,"Entnahmefenster"),
    zander:r("45–75 cm","1. Februar–31. Mai","Entnahmefenster"), groppe:P()
  });

  add("Hessen",{
    aal:r("50–70 cm","15. September–1. März","Entnahmefenster"), aesche:r("30–45 cm","1. März–15. Mai","Entnahmefenster"),
    bachforelle:r("25–60 cm","1. Oktober–31. März","Entnahmefenster"), barbe:r("40–60 cm","1. Mai–30. Juni","Entnahmefenster"),
    hecht:r("50–90 cm","1. Februar–15. April","Entnahmefenster"), wildkarpfen:r("45–60 cm","15. März–31. Mai","Entnahmefenster"),
    nase:r("25–40 cm","15. März–30. April","Entnahmefenster"), rotfeder:r("20–30 cm","15. März–31. Mai","Entnahmefenster"),
    schleie:r("25–45 cm","1. Mai–30. Juni","Entnahmefenster"), zander:r("50 cm",K),
    quappe:P(), karausche:P(), groppe:P()
  });

  add("Mecklenburg-Vorpommern",{
    aal:r("50 cm","1. Dezember–28. Februar","Binnengewässer"), aland:r("25 cm",K), aesche:r("30 cm",K),
    bachforelle:r("30 cm","1. Oktober–31. März"), barsch:r("17 cm",K), flussbarsch:r("17 cm",K),
    hecht:r("45 cm",K), karpfen:r("40 cm",K), lachs:r("60 cm","1. September–31. März"),
    meerforelle:r("45 cm","1. September–31. März"), quappe:r("30 cm","1. Januar–15. Februar"),
    rapfen:r("35 cm",K), schleie:r("25 cm",K), wels:r("70 cm","1. Mai–30. Juni"), zander:r("45 cm",K),
    barbe:P(), nase:P(), groppe:P()
  },"An der Küste gelten teilweise andere Maße und Schonzeiten.");

  add("Niedersachsen",{
    aal:r("35 cm",K,"in mehreren Küstenlandkreisen 28 cm"), aesche:r("30 cm","1. März–15. Mai"),
    bachforelle:r("25 cm","15. Oktober–15. Februar"), barbe:r("35 cm",K), hecht:r("40 cm","1. Februar–15. April"),
    quappe:r("35 cm",K), regenbogenforelle:r("25 cm",K), wels:r("50 cm",K), zander:r("35 cm","15. März–30. April"),
    lachs:P(), meerforelle:P(), nase:P(), rapfen:P(), groppe:P()
  },"Besatzfische können abweichend fangbar sein; Küstenrecht gesondert beachten.");

  add("Nordrhein-Westfalen",{
    aal:r("50 cm","1. Oktober–1. März","Schonzeit nur Rheinhauptstrom"), aland:r("25 cm",K), aesche:r("30 cm","1. März–30. April"),
    bachforelle:r("25 cm","20. Oktober–15. März"), barbe:r("35 cm","15. Mai–15. Juni"),
    hecht:r("45 cm","15. Februar–30. April"), karpfen:r("35 cm",K), nase:r("30 cm","1. März–30. April"),
    regenbogenforelle:r(N,K), schleie:r("25 cm",K), seeforelle:r("50 cm","20. Oktober–15. März"),
    seesaibling:r("30 cm","20. Oktober–15. März"), zander:r("40 cm","1. April–31. Mai"),
    quappe:P(), groppe:P(), karausche:P()
  });

  add("Rheinland-Pfalz",{
    aal:r("50 cm",K), aesche:r("30 cm","15. Februar–30. April"), bachforelle:r("25 cm","15. Oktober–15. März"),
    barbe:r("35 cm","1. Mai–15. Juni"), hecht:r("50 cm","1. Februar–31. Mai","Lahn: 1. April–31. Mai"),
    karpfen:r("35 cm",K), nase:r("20 cm","15. März–30. April","nicht in Mosel, Lahn und Rhein"),
    schleie:r("25 cm",K), seeforelle:r("60 cm",K), zander:r("45 cm","15. März–15. Mai"),
    aland:P(), quappe:P(), karausche:P(), groppe:P()
  });

  add("Saarland",{
    aal:r("50 cm",K), aesche:r("30 cm","1. März–30. April"), bachforelle:r("25 cm","1. Oktober–31. März"),
    barbe:r("40 cm","15. März–15. Juni"), hecht:r("50 cm","15. Februar–31. Mai"), karpfen:r("35 cm",K),
    nase:r("35 cm","15. März–15. Juni"), schleie:r("25 cm",K), zander:r("45 cm","15. Februar–31. Mai"),
    quappe:P(), groppe:P()
  });

  add("Sachsen",{
    aal:r("50 cm",K), aland:r("20 cm",K), aesche:r("35 cm","1. Januar–15. Juni"),
    lachs:r("60 cm","1. Oktober–30. April"), bachforelle:r("28 cm","1. Oktober–30. April"),
    bachsaibling:r("25 cm","1. Oktober–30. April"), barbe:r("50 cm","15. April–30. Juni"),
    hecht:r("50 cm","1. Februar–30. April"), karpfen:r("40 cm",K), rapfen:r("40 cm","1. Januar–31. Mai"),
    regenbogenforelle:r("25 cm","1. Oktober–30. April"), rotfeder:r("20 cm",K), schleie:r("25 cm",K),
    seeforelle:r("60 cm","1. Oktober–30. April"), seesaibling:r("28 cm","1. Oktober–30. April"),
    zander:r("50 cm","1. Februar–31. Mai"), nase:P(), quappe:P(), groppe:P()
  },"Für Nase und Quappe bestehen Ausnahmen in bestimmten Flüssen.");

  add("Sachsen-Anhalt",{
    aal:r("50 cm",K), aesche:r("30 cm","1. Dezember–15. Mai"), bachforelle:r("25 cm","15. September–31. März"),
    barbe:r("45 cm","1. April–30. Juni"), hecht:r("50 cm","15. Februar–30. April"), karpfen:r("35 cm",K),
    quappe:r("30 cm",K), rapfen:r("40 cm",K), regenbogenforelle:r("25 cm",K), schleie:r("25 cm",K),
    zander:r("50 cm","15. Februar–31. Mai"), nase:P(), groppe:P()
  });

  add("Schleswig-Holstein",{
    aal:r("50 cm",K,"Binnen; Küste ganzjähriges Fangverbot"), aesche:r("35 cm","1. Januar–30. April"),
    bachforelle:r("30 cm","1. Oktober–28. Februar"), barbe:P(), hecht:r("45 cm","15. Februar–30. April"),
    karpfen:r("35 cm",K), lachs:r("60 cm","1. Oktober–28. Februar"), meerforelle:r("40 cm","1. Oktober–28. Februar"),
    quappe:r("35 cm","1. Januar–28. Februar"), rapfen:r("50 cm",K), schleie:r("25 cm",K),
    wels:r(N,"1. Mai–30. Juni"), zander:r("45 cm","15. März–15. Mai"), groppe:P(),
    dorsch:r("35 cm",K,"Nordsee; Ostsee-Fangverbote gesondert beachten"), wolfsbarsch:r("42 cm",K)
  },"Binnen- und Küstenfischereirecht unterscheiden; örtliche Winterschongewässer beachten.");

  add("Thüringen",{
    aal:r("45 cm",K), aesche:r("30 cm","1. Februar–31. Mai"), bachforelle:r("25 cm","1. Oktober–31. März"),
    bachsaibling:r("25 cm","1. Oktober–31. März"), barbe:P(), doebel:r("25 cm",K), hecht:r("45 cm","15. Februar–30. April"),
    karpfen:r("35 cm",K), regenbogenforelle:r("25 cm",K,"bei gemeinsamem Vorkommen mit Bachforelle: 1. Oktober–31. März"),
    rotfeder:r("15 cm",K), schleie:r("25 cm",K), wels:r("50 cm",K), zander:r("45 cm","1. April–31. Mai"),
    nase:P(), quappe:P(), rapfen:P(), groppe:P()
  });

  /* Österreich: landesweite Grundwerte. Revierordnungen und Sondergewässer (z. B.
     Bodensee, Mondsee, Alpenrhein) können abweichen. */
  const at=(name,vals,note="")=>add(name,vals,"Österreich · "+note);
  at("Burgenland",{aesche:r("30 cm","1. Januar–30. April"),bachforelle:r("25 cm","16. September–15. März"),
    hecht:r("50 cm","1. Februar–30. April"),zander:r("40 cm","1. März–31. Mai"),karpfen:r("35 cm",K),
    schleie:r("25 cm","1. Mai–30. Juni"),wels:r("60 cm",K),huchen:r("75 cm","1. Februar–31. Mai")});
  at("Kärnten",{aesche:r("35 cm","1. Januar–30. April"),bachforelle:r("25 cm","1. Oktober–28. Februar"),
    hecht:r("55 cm","1. Januar–30. April"),zander:r("45 cm","1. März–31. Mai"),karpfen:r("35 cm",K),
    huchen:r("80 cm","1. Februar–31. Mai"),seeforelle:r("50 cm","1. Oktober–28. Februar"),seesaibling:r("25 cm","1. Oktober–28. Februar")});
  at("Niederösterreich",{aesche:r("30 cm","1. Januar–30. April"),bachforelle:r("25 cm","16. September–15. März"),
    hecht:r("50 cm","1. Februar–30. April"),zander:r("40 cm","1. März–31. Mai"),karpfen:r("35 cm",K),
    schleie:r("25 cm","1. Mai–30. Juni"),huchen:r("75 cm","1. Februar–31. Mai"),wels:r("60 cm",K)});
  at("Oberösterreich",{aesche:r("38 cm","1. Januar–31. Mai"),bachforelle:r("30 cm","16. September–15. März"),
    regenbogenforelle:r("28 cm","1. Dezember–15. März"),hecht:r("60 cm","1. Februar–30. April"),
    zander:r("50 cm","1. März–30. April"),huchen:r("85 cm","1. Februar–31. Mai"),wels:r("80 cm","1. Juni–30. Juni"),
    karpfen:r("35 cm","1. Mai–31. Mai"),schleie:r("25 cm","1. Juni–31. Juli"),barbe:r("40 cm","1. Mai–15. Juni")});
  at("Salzburg",{aesche:r("38 cm","1. Januar–31. Mai"),bachforelle:r("30 cm","1. Oktober–29. Februar"),
    regenbogenforelle:r("28 cm",K),hecht:r("60 cm","1. Februar–30. April"),zander:r("50 cm","16. März–31. Mai"),
    huchen:r("85 cm","1. Februar–31. Mai"),wels:r("80 cm",K),karpfen:r("35 cm",K),schleie:r("25 cm","1. Juni–31. Juli"),
    barbe:r("40 cm","1. Mai–15. Juni"),nase:P()});
  at("Steiermark",{aesche:r("35 cm","1. Januar–30. April"),bachforelle:r("26 cm","16. September–15. März"),
    regenbogenforelle:r("26 cm","16. Dezember–15. März"),hecht:r("50 cm","1. Februar–30. April"),
    zander:r("45 cm","1. März–31. Mai"),huchen:r("85 cm","1. Februar–31. Mai"),karpfen:r("35 cm",K),schleie:r("25 cm","1. Mai–30. Juni")});
  at("Tirol",{aesche:r("35 cm","1. Januar–15. Mai"),bachforelle:r("25 cm","1. Oktober–28. Februar"),
    regenbogenforelle:r("25 cm","1. Dezember–28. Februar"),hecht:r("50 cm","1. Februar–30. April"),
    zander:r("45 cm","1. März–31. Mai"),huchen:r("80 cm","1. Februar–31. Mai"),seeforelle:r("50 cm","1. Oktober–28. Februar"),
    seesaibling:r("25 cm","1. Oktober–28. Februar")});
  at("Vorarlberg",{aal:r("50 cm",K),bachforelle:r("22 cm","1. Oktober–28. Februar","stehende Gewässer meist 25 cm; Alpenrhein abweichend"),
    seeforelle:r("60 cm","1. Oktober–28. Februar","Alpenrhein: 15. Juli–31. Januar"),seesaibling:r("25 cm","1. Oktober–31. Januar"),
    aesche:r("30 cm","1. Februar–30. April"),nase:r("35 cm","15. März–31. Mai"),hecht:r("50 cm","1. Februar–30. April"),
    zander:r("40 cm","1. April–31. Mai"),karpfen:r("35 cm",K)},"Fließgewässer, stehende Gewässer und Alpenrhein unterscheiden.");
  at("Wien",{aalrutte:r("35 cm","1. Dezember–29. Februar"),quappe:r("35 cm","1. Dezember–29. Februar"),
    aesche:r("30 cm","1. Januar–30. April"),bachforelle:r("25 cm","1. Oktober–28. Februar"),
    hecht:r("50 cm","1. Februar–30. April"),zander:r("40 cm","1. März–31. Mai"),karpfen:r("35 cm",K),schleie:r("25 cm","1. Mai–30. Juni")});

  /* Schweiz: Bundesrechtliche Mindestvorgaben; Kantone und Patentgewässer dürfen
     strengere bzw. gewässerspezifische Regeln festlegen. */
  D["Schweiz"]={rules:{
    aesche:r("28 cm","1. Februar–30. April"), bachforelle:r("22 cm","1. Oktober–28. Februar"),
    seeforelle:r("35 cm","1. Oktober–31. Dezember"), regenbogenforelle:r("22 cm",K),
    seesaibling:r("22 cm","1. Oktober–31. Dezember"), hecht:r("45 cm","1. März–30. April"),
    zander:r("40 cm","1. April–31. Mai"), felchen:r("25 cm","15. November–31. Dezember"), renke:r("25 cm","15. November–31. Dezember"),
    alet:r(N,K),doebel:r(N,K),karpfen:r(N,K),schleie:r(N,K),barsch:r(N,K),flussbarsch:r(N,K)
  },note:"Bundesrechtliche Basis; kantonale und gewässerspezifische Vorschriften können strenger sein."};

  /* Niederlande: landesweite Binnenfischerei-Basis. */
  D["Niederlande"]={rules:{
    aal:P(), paling:P(), lachs:P(), zeeforel:P(), meerforelle:P(), stoer:P(), maifisch:P(), fint:P(),
    hecht:r("45 cm","1. März–letzter Samstag im Mai"), snoek:r("45 cm","1. März–letzter Samstag im Mai"),
    zander:r("42 cm","1. April–letzter Samstag im Mai"), snoekbaars:r("42 cm","1. April–letzter Samstag im Mai"),
    barsch:r("22 cm","1. April–letzter Samstag im Mai"), flussbarsch:r("22 cm","1. April–letzter Samstag im Mai"),
    baars:r("22 cm","1. April–letzter Samstag im Mai"), barbe:r("30 cm",K), karpfen:r(N,K), schleie:r(N,K)
  },note:"Nationale Basis; VISpas-/Gewässerliste kann zusätzliche Entnahmeverbote und strengere Regeln enthalten."};

  window.FISH_RULES=D;
})();
