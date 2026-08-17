"use strict";

/**
 * PetriKlar · main.js
 * App-Komposition, Navigation, Laden eines Platzes und Bootstrapping.
 * Lade-Reihenfolge und Abhängigkeiten: docs/ARCHITEKTUR.md
 */
function openSpot(id){
  if(id) activateSpotById(id);
  hideAllViews();
  const sv=$("spotView"), mc=$("mapCard");
  mountMapCard("spotMapHost",false);
  if(sv) sv.style.display="block";
  if(mc) mc.style.display="block";
  const src=$("dataSourcesFooter"); if(src) src.style.display="block";
  initMap();
  setTimeout(()=>{ try{ if(MAP){ MAP.invalidateSize(); centerOnActiveSpot(); } }catch(e){} }, 90);
  setActiveTab("places");
  window.scrollTo({top:0, behavior:"smooth"});
}
function goHome(){ showHome(); }
function ensureMapVisible(){
  const m=$("mapCard"); if(m) m.style.display="block";
  if(!MAP) initMap();
  setTimeout(()=>{ try{ if(MAP) MAP.invalidateSize(); }catch(e){} }, 80);
}
function toggleHomeMap(){
  mountMapCard("homeMapHost",true);
  ensureMapVisible();
}
function fbTitle(){ const n=activeSpotName(); return (n? n+" " : "")+"Fangbuch"; }
function updateFangbuchBtn(){
  const b=$("fangbuchBtn"); if(!b) return;
  const box=$("fangbuchBox"); const shown = box && box.style.display && box.style.display!=="none";
  b.innerHTML=iconLabel("book",fbTitle()+(shown?" ausblenden":" anzeigen"));
}
function onSpotSelect(id){ if(id) loadSpot(id); }
function deleteActiveSpot(){
  const sel=$("spotSelect"); const id = sel ? sel.value : getActiveSpotId();
  if(!id){ alert("Kein Angelplatz zum Löschen gewählt."); return; }
  deleteSpot(id);
  const rest=loadSpots();
  if(rest.length) loadSpot(rest[0].id);
}
function currentSpotName(){
  const sp=loadSpots().find(x=>String(x.id)===String(getActiveSpotId()));
  return sp ? sp.name : "";
}
function populateCatchSpots(){                 // zeigt, für welchen Angelplatz der Fang gilt
  const sp=activeSpot(), l=$("f_ort_label");
  if(l) l.textContent = sp ? ("Fang für: "+sp.name+" · "+(sp.gewaesser||sp.river||"")) : "Kein Angelplatz gewählt.";
}
function onCatchSpotChange(id){ if(id) loadSpot(id); }

async function loadMarine(){
  const val=$("waterTempVal"), meta=$("waterTempMeta");
  try{
    const url="https://marine-api.open-meteo.com/v1/marine?latitude="+WXPOS.lat+"&longitude="+WXPOS.lon+
      "&current=sea_surface_temperature&timezone=Europe%2FBerlin";
    const d=await getJSON(url);
    const t=(d&&d.current)? d.current.sea_surface_temperature : null;
    if(t==null||isNaN(t)) throw 0;
    if(val) val.innerHTML=fmt(t,1)+' <small>°C</small>';
    if(meta) meta.textContent="Oberflächentemperatur (Open-Meteo Modell)";
    snap.marineTemp=t;
  }catch(e){
    if(val) val.innerHTML='<span class="err">n/v</span>';
    if(meta) meta.textContent="Modell liefert hier keine Wassertemperatur";
    snap.marineTemp=null;
  }
}
async function loadAll(){
  $("updated").textContent = "aktualisiere …";
  const sp=activeSpot(), typ=spotType(sp), hasStation=typ==="fluss"&&!!(sp&&sp.uuid&&STATIONS.some(s=>s.uuid===sp.uuid));
  if(typ==="fluss" && hasStation){
    snap.marineTemp=null;
    await Promise.allSettled([loadPegel(), loadWeather(), loadQuality(), loadLiveWQ()]);
    renderQuality();                    // Live-Pegelwerte bevorzugen, sonst Gütestation
    updateAmpel();
    if($("biteBox") && $("biteBox").style.display==="block") renderBite();
  } else if(typ==="fluss"){
    snap.pegel=null; snap.q=null; snap.marineTemp=null; window.LIVEWQ=null;
    await Promise.allSettled([loadWeather(),loadQuality()]);
    renderQuality(); updateAmpel();
  } else {
    snap.pegel=null; snap.q=null; window.LIVEWQ=null;
    await Promise.allSettled([loadWeather(), loadMarine(), loadQuality()]);  // Güte auch für Seen (z. B. Ammersee)
    renderQuality();
  }
  $("updated").textContent = "Stand: " + new Date().toLocaleString("de-DE",{dateStyle:"short",timeStyle:"short"}) + " Uhr";
}
async function startAppAfterLogin(){
  if(APP_STARTED){
    const sp=activeSpot(); if(sp) activateSpotById(sp.id); else { renderSpots(); renderFavorites(); showStart(); }
    maybeShowOnboarding();
    return;
  }
  APP_STARTED=true;
  await loadStations();                       // alle Rhein-Pegel laden
  const spots=loadSpots(), active=getActiveSpotId();
  const sp = spots.find(x=>String(x.id)===String(active)) || spots[0] || null;
  if(sp){
    const st=STATIONS.find(x=>x.uuid===sp.uuid) || STATIONS[0];
    CUR=st; APP_STATE.active_spot_id=sp.id;
    const ll=spotLatLon(sp); WXPOS={lat:ll[0], lon:ll[1]};
  } else {
    CUR = STATIONS.find(x=>x.uuid===MAINZ_UUID) || STATIONS[0];
    WXPOS={lat:CUR.lat, lon:CUR.lon};
  }
  reflectStation(); renderSpots();
  ensureBaitSeed();                           // Standardköder beim ersten Start anlegen
  loadNizBW().then(()=>{ renderQuality(); if(typeof addStationDots==="function") addStationDots(); });  // BW-Wassergüte (LUBW/NIZ)
  loadHessen().then(()=>{ renderQuality(); if(typeof addStationDots==="function") addStationDots(); }); // Hessen-Wassergüte (HLNUG)
  initFangbuch();                             // Formular, Karte (Stationen + Angelplätze)
  loadQuality();                             // Länder- und Nachbarland-Sensoren schon auf der Startkarte laden
  showStart();                                // Startbildschirm: Lieblingsplätze und Tripstart
  renderActiveTrip();
  maybeShowOnboarding();
  setInterval(renderActiveTrip,1000);
  setInterval(()=>{ if($("spotView") && $("spotView").style.display!=="none") loadAll(); }, 10*60*1000);
}
async function boot(){
  document.body.classList.add("auth-locked");
  if(typeof initPWA==="function") initPWA();
  renderAccountUI();
  await initCloud();
}
boot();
