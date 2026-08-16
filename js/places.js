"use strict";

/**
 * PetriKlar · places.js
 * Messstationswahl, Angelplatzverwaltung und Ansichtssteuerung.
 * Lade-Reihenfolge und Abhängigkeiten: docs/ARCHITEKTUR.md
 */
/* ===================== Angelplatz / Stationswahl ===================== */
function tidy(s){ return String(s||"").toLowerCase().replace(/(^|[\s\-\/])([a-zäöü])/g,(m,a,b)=>a+b.toUpperCase()); }
function haversine(la1,lo1,la2,lo2){
  const R=6371, r=Math.PI/180, dLa=(la2-la1)*r, dLo=(lo2-lo1)*r,
    x=Math.sin(dLa/2)**2 + Math.cos(la1*r)*Math.cos(la2*r)*Math.sin(dLo/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
async function loadStations(){
  try{
    const arr=await getJSON(PO_BASE+"/stations.json");   // alle deutschen Pegel (alle Flüsse)
    const list=arr.filter(s=>s.latitude&&s.longitude)
      .map(s=>({uuid:s.uuid, name:tidy(s.shortname), km:s.km, lat:s.latitude, lon:s.longitude,
        river:(s.water&&s.water.shortname)? tidy(s.water.shortname) : ""}))
      .sort((a,b)=>a.name.localeCompare(b.name));
    if(list.length) STATIONS=list;
  }catch(e){}
}
function nearestList(lat, lon, n){
  return STATIONS.map(s=>({s, d:haversine(lat,lon,s.lat,s.lon)})).sort((a,b)=>a.d-b.d).slice(0, n||8);
}
function nearestStation(lat,lon,river){
  let pool=STATIONS;
  if(river){ const f=STATIONS.filter(s=>s.river===river); if(f.length) pool=f; }
  let best=pool[0], bd=1e9; for(const s of pool){ const d=haversine(lat,lon,s.lat,s.lon); if(d<bd){ bd=d; best=s; } } return best;
}
function getActiveSpotId(){ return APP_STATE.active_spot_id!=null?APP_STATE.active_spot_id:null; }
function setActiveSpotId(id){ APP_STATE.active_spot_id=id!=null?id:null; markCloudDirty(); }
function activeSpot(){ return loadSpots().find(x=>String(x.id)===String(getActiveSpotId())) || null; }
function activeSpotName(){ const s=activeSpot(); return s ? s.name : ""; }
function assignStationToSpot(spotId, uuid){
  const spots=loadSpots(), sp=spots.find(x=>String(x.id)===String(spotId)), st=STATIONS.find(x=>x.uuid===uuid);
  if(!sp || !st) return;
  sp.uuid=st.uuid; sp.station=st.name; sp.river=st.river; saveSpots(spots);
  activateStationFor(st.uuid);
  reflectStation(); updateStationMarker(); renderSpots(); populateCatchSpots(); loadAll();
}
/* Stations-Auswahl (nächste Stationen mit Fluss + Entfernung) */
function openStationPicker(lat, lon, onPick){
  const box=$("stPickList"); if(!box){ if(onPick) onPick(nearestStation(lat,lon).uuid); return; }
  const list=nearestList(lat, lon, 8);
  box.innerHTML='<button class="stpick stpick-none" onclick="__stPick(\'\')">'+uiIcon('ban')+' Keine Messstation</button>'+
    list.map(o=>'<button class="stpick" onclick="__stPick(\''+o.s.uuid+'\')">'+esc(o.s.name)+
    ' <small>· '+esc(o.s.river||"?")+' · '+o.d.toFixed(1)+' km</small></button>').join("");
  window.__stPickCb = onPick;
  const m=$("stationModal"); if(m) m.style.display="flex";
}
function __stPick(uuid){ const cb=window.__stPickCb; window.__stPickCb=null; const m=$("stationModal"); if(m) m.style.display="none"; if(cb) cb(uuid); }
function closeStationPicker(){ window.__stPickCb=null; const m=$("stationModal"); if(m) m.style.display="none"; }
function pegPickList(){
  hidePegEdit();
  const sp=activeSpot();
  const la = sp && sp.lat!=null ? sp.lat : (sp? CUR.lat : WXPOS.lat);
  const lo = sp && sp.lon!=null ? sp.lon : (sp? CUR.lon : WXPOS.lon);
  openStationPicker(la, lo, function(uuid){
    if(sp) assignStationToSpot(sp.id, uuid);
    else { activateStationFor(uuid); reflectStation(); updateStationMarker(); loadAll(); }
  });
}
/* Messstation eines Angelplatzes ändern */
function togglePegEdit(){ if(spotType(activeSpot())!=="fluss") return; const el=$("pegEdit"); if(!el) return; el.style.display=(el.style.display==="none"||!el.style.display)?"inline-flex":"none"; }
function hidePegEdit(){ const el=$("pegEdit"); if(el) el.style.display="none"; }
function pegAuto(){
  hidePegEdit();
  const sp=activeSpot();
  if(sp){ const st=nearestStation(sp.lat!=null?sp.lat:CUR.lat, sp.lon!=null?sp.lon:CUR.lon, sp.river||null); assignStationToSpot(sp.id, st.uuid); }
  else { const st=nearestStation(WXPOS.lat, WXPOS.lon); activateStationFor(st.uuid); reflectStation(); updateStationMarker(); loadAll(); }
}
function pegPickMap(){
  hidePegEdit(); STATION_PICK=true;
  ensureMapVisible();
  const hb=$("markHint"); if(hb){ hb.innerHTML=uiIcon('target')+" Tippe die gewünschte Messstation an (grauer Punkt)."; hb.style.display="block"; }
  setTimeout(()=>{ const m=document.getElementById("map"); if(m) m.scrollIntoView({behavior:"smooth", block:"center"}); }, 120);
}
function applyWaterType(sp){
  const isRiver = spotType(sp)==="fluss";
  const hasStation=isRiver && !!(sp&&sp.uuid&&STATIONS.some(s=>s.uuid===sp.uuid));
  ["pegelSect","pegelGrid"].forEach(id=>{ const e=$(id); if(e) e.style.display = hasStation ? "" : "none"; });
  const cond=$("cond"); if(cond) cond.style.display=isRiver?"":"none";
  ["qSect","quality","qStamp"].forEach(id=>{ const e=$(id); if(e) e.style.display=""; });  // Wasserqualität auch für Seen (z. B. Ammersee)
  const bt=$("biteBtn"); if(bt) bt.style.display = isRiver ? "" : "none";
  if(!isRiver){ const bb=$("biteBox"); if(bb) bb.style.display="none"; }
  const wt=$("waterTempTile"); if(wt) wt.style.display = isRiver ? "none" : "";
  const hint=$("pegEditHint"); if(hint) hint.style.display = isRiver ? "" : "none";
}
function reflectStation(){
  const sp=loadSpots().find(x=>String(x.id)===String(getActiveSpotId()));
  const title=$("spotTitle"); if(title) title.textContent=sp?sp.name:"–";
  const typ=spotType(sp);
  const pre=$("pegPrefix"), pn=$("staPegName");
  if(typ!=="fluss"){                                  // See / Meer: kein Pegel
    if(pre) pre.textContent="Gewässer:";
    if(pn) pn.textContent=(sp&&sp.gewaesser? sp.gewaesser : "")+(typ==="see"?" (See)":" (Meer)");
    applyWaterType(sp);
    return;
  }
  if(pre) pre.textContent="Messstation:";
  if(!sp || !sp.uuid || !STATIONS.some(s=>s.uuid===sp.uuid)){
    if(pn) pn.textContent="Keine Messstation";
    const ps=$("pegelSect"); if(ps) ps.textContent="Messstation · keine ausgewählt";
    applyWaterType(sp); return;
  }
  const ps=$("pegelSect"); if(ps) ps.textContent="Fluss · Messstation "+CUR.name+" (PEGELONLINE)";
  const cs=$("curStation"); if(cs) cs.textContent = (sp? "Angelplatz: "+sp.name+" · " : "")+"Messstation "+CUR.name+" · km "+CUR.km;
  if(pn) pn.textContent = CUR.name + (CUR.river? " ("+CUR.river+")" : "");
  const mc=$("mapCo"); if(mc) mc.innerHTML=iconLabel("pin","Pegel "+CUR.name+" · "+CUR.lat.toFixed(4)+"° N, "+CUR.lon.toFixed(4)+"° O");
  const mo=$("mapOsm"); if(mo) mo.href="https://www.openstreetmap.org/?mlat="+WXPOS.lat+"&mlon="+WXPOS.lon+"#map=14/"+WXPOS.lat+"/"+WXPOS.lon;
  const mg=$("mapGmaps"); if(mg) mg.href="https://www.google.com/maps/search/?api=1&query="+WXPOS.lat+","+WXPOS.lon;
  applyWaterType(sp);
}
function updateStationMarker(){
  // Der dauerhaft sichtbare blaue Pegelpunkt wurde entfernt. Zugeordnete
  // Stationen erscheinen nur noch in der einschaltbaren Sensor-Ebene.
}
function activateStationFor(uuid){ const s=STATIONS.find(x=>x.uuid===uuid); if(s){ CUR=s; delete HIST.pegel; delete HIST.durchfluss; delete HIST.wx; } }
/* gespeicherte Angelplätze */
function spotType(sp){ return (sp && sp.typ) ? sp.typ : "fluss"; }
function spotWaterLabel(s){
  const typ=spotType(s);
  if(typ==="see")  return "See · "+esc(s.gewaesser||s.river||"");
  if(typ==="meer") return "Meer · "+esc(s.gewaesser||s.river||"");
  return s.uuid ? ("Fluss · Messstation "+esc(s.station||"")+(s.river?" ("+esc(s.river)+")":"")) : "Fluss · keine Messstation";
}
function loadSpots(){ return Array.isArray(APP_STATE.spots)?APP_STATE.spots:[]; }
function saveSpots(a){ APP_STATE.spots=Array.isArray(a)?a:[]; markCloudDirty(); }
function setAddMapView(){                 // Startausschnitt beim Anlegen: nicht rauszoomen
  if(!MAP) return;
  const spots=loadSpots();
  if(spots.length){ const last=spots[spots.length-1]; const ll=spotLatLon(last); try{ MAP.setView(ll, 13); }catch(e){} }  // ~5×5 km
  else { try{ MAP.setView([51.3, 10.4], 6); }catch(e){} }                                                                // Deutschland
}
function newSpotOnMap(){
  SPOT_PICK=true;
  // Beim Anlegen keine bereits gespeicherten grünen Fangpunkte einblenden.
  clearCatchMarkers();
  ensureMapVisible();
  setAddMapView();
  const hb=$("markHint"); if(hb){ hb.innerHTML=uiIcon('target')+" Tippe auf deinen Angelplatz auf der Karte – danach kannst du ihn benennen."; hb.style.display="block"; }
  setTimeout(()=>{ setAddMapView(); const m=document.getElementById("map"); if(m) m.scrollIntoView({behavior:"smooth", block:"center"}); }, 120);
}
function pickAuto(){
  if(!navigator.geolocation){ alert("Ortung auf diesem Gerät nicht verfügbar."); return; }
  navigator.geolocation.getCurrentPosition(p=>{ createSpotAt(p.coords.latitude, p.coords.longitude); },
    ()=>alert("Ortung fehlgeschlagen."), {enableHighAccuracy:true, timeout:10000, maximumAge:0});
}
let PENDING_SPOT=null;
function createSpotAt(lat, lon){                 // öffnet den Dialog (Name + Typ-Dropdown)
  PENDING_SPOT={lat, lon};
  const head=$("addSpotModal")?.querySelector(".cmhead span"); if(head) head.textContent="Angelplatz hinzufügen";
  if($("as_name")) $("as_name").value="";
  if($("as_typ")) $("as_typ").value="fluss";
  if($("as_gw")) $("as_gw").value="";
  asTypeChange();
  const m=$("addSpotModal"); if(m) m.style.display="flex";
  setTimeout(()=>{ const n=$("as_name"); if(n) n.focus(); }, 60);
}
function asTypeChange(){
  const typ=$("as_typ")?$("as_typ").value:"fluss";
  const row=$("as_gwrow"), hint=$("as_hint");
  if(typ==="fluss"){ if(row) row.style.display="none"; if(hint) hint.textContent="Für Flüsse kannst du danach eine passende Messstation wählen – oder keine Messstation verwenden."; }
  else { if(row) row.style.display=""; if(hint) hint.textContent="See/Meer: kein Pegel – Wetter, Mond & Bedingungen werden gespeichert."; }
}
function closeAddSpot(){ const m=$("addSpotModal"); if(m) m.style.display="none"; PENDING_SPOT=null; }
function confirmAddSpot(){
  if(!PENDING_SPOT) return;
  const name=($("as_name")?$("as_name").value:"").trim();
  if(!name){ alert("Bitte einen Namen eingeben."); if($("as_name")) $("as_name").focus(); return; }
  const typ=$("as_typ")?$("as_typ").value:"fluss";
  const lat=PENDING_SPOT.lat, lon=PENDING_SPOT.lon;
  const editId=PENDING_SPOT.editId, oldName=PENDING_SPOT.oldName||"";
  const targetId=editId!=null?editId:Date.now();
  const upsert=(base)=>{
    const spots=loadSpots(); let sp=spots.find(x=>String(x.id)===String(targetId));
    if(sp) Object.assign(sp,base); else spots.push(base);
    saveSpots(spots);
    if(oldName && oldName!==name){
      const catches=loadCatches(); catches.forEach(c=>{ if(c.angelplatz===oldName) c.angelplatz=name; }); saveCatches(catches);
    }
    addSpotMarkers(); renderSpotList(); openSpot(targetId);
  };
  if(typ==="fluss"){
    const m=$("addSpotModal"); if(m) m.style.display="none";      // Stationswahl folgt
    openStationPicker(lat, lon, function(uuid){
      const st=uuid ? STATIONS.find(x=>x.uuid===uuid) : null;
      const river=st?st.river:(PENDING_SPOT.oldRiver||"");
      upsert({id:targetId, name, lat:+lat.toFixed(6), lon:+lon.toFixed(6), typ:"fluss",
        uuid:st?st.uuid:null, station:st?st.name:"", river, gewaesser:river||"Fluss"});
      PENDING_SPOT=null;
    });
  } else {
    const gw=($("as_gw")?$("as_gw").value:"").trim() || (typ==="see"?"See":"Meer");
    upsert({id:targetId, name, lat:+lat.toFixed(6), lon:+lon.toFixed(6), typ, uuid:null, station:"", river:gw, gewaesser:gw});
    closeAddSpot();
  }
}
function activateSpotById(id, latlon){
  const sp=loadSpots().find(x=>String(x.id)===String(id)); if(!sp) return;
  setActiveSpotId(sp.id);
  activateStationFor(sp.uuid);
  const ll = latlon || spotLatLon(sp);
  WXPOS={ lat:ll[0], lon:ll[1] };
  reflectStation(); updateStationMarker(); centerOnActiveSpot(); populateCatchSpots(); renderSpots();
  updateFangbuchBtn(); refreshFangbuch();
  loadAll();
}
function loadSpot(id){ activateSpotById(id); }
function deleteSpot(id){
  const sp=loadSpots().find(x=>String(x.id)===String(id)); if(!sp) return;
  if(!confirm('Angelplatz „'+sp.name+'" löschen?')) return;
  saveSpots(loadSpots().filter(x=>String(x.id)!==String(id)));
  if(String(getActiveSpotId())===String(id)) setActiveSpotId(null);
  const n=loadCatches().filter(c=>c.angelplatz===sp.name).length;
  if(n>0 && confirm("Auch die "+n+" Fangbuch-Einträge dieses Angelplatzes löschen?")){
    saveCatches(loadCatches().filter(c=>c.angelplatz!==sp.name));
  }
  addSpotMarkers(); renderSpots(); populateCatchSpots();
}
function renderSpots(){
  const sel=$("spotSelect");
  const spots=sortSpotsByDays(loadSpots()), active=getActiveSpotId();
  if(sel){
    if(!spots.length) sel.innerHTML='<option value="">— noch keiner —</option>';
    else { sel.innerHTML=spots.map(s=>'<option value="'+s.id+'">'+esc(s.name)+'</option>').join("");
      if(active && spots.some(s=>String(s.id)===String(active))) sel.value=active; }
  }
  const title=$("spotTitle"), current=spots.find(s=>String(s.id)===String(active));
  if(title) title.textContent=current?current.name:"–";
  renderSpotList();
}
const PIN_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
function spotRowHtml(s,prefix,withActions){
  prefix=prefix||"";
  return '<div class="spotrow"><button class="spotopen" onclick="openSpot('+s.id+')">'+uiIcon('pin')+' '+esc(s.name)+
    '<span class="spotsub">'+spotWaterLabel(s)+'</span><span class="spotcond" id="'+prefix+'cond_'+s.id+'">Bedingungen …</span></button>'+
    '<div class="spotbadges">'+countBadge(fishCountForSpot(s.name),dayCountForSpot(s.name))+
    '<span class="ampelbadge lg-amber" id="'+prefix+'amp_'+s.id+'">'+uiIcon('minus')+' …</span></div>'+
    (withActions?'<div class="spotactions"><button class="spotedit" title="Angelplatz bearbeiten" aria-label="Angelplatz bearbeiten" onclick="editSpot('+s.id+')">'+uiIcon('edit')+'</button>'+
    '<button class="spotdel" title="Löschen" aria-label="Angelplatz löschen" onclick="deleteSpotFromList('+s.id+')">'+uiIcon('close')+'</button></div>':'')+'</div>';
}
function renderSpotList(){
  const box=$("spotList"); if(!box) return;
  const spots=sortSpotsByDays(loadSpots());
  if(!spots.length){ box.innerHTML=
    '<div class="emptycard"><div class="emptyicon">'+PIN_SVG+'</div>'+
    '<div class="emptytitle">Lege einen Angelplatz an</div>'+
    '<div class="emptydesc">Wähle deinen Platz auf der Karte unten aus. Eine Standortfreigabe ist nicht nötig.</div></div>'; return; }
  box.innerHTML=spots.map(s=>spotRowHtml(s,"",true)).join("");
  loadSpotConditions(spots,"");
}
function deleteSpotFromList(id){ deleteSpot(id); renderSpotList(); renderFavorites(); }
function editSpot(id){
  const sp=loadSpots().find(x=>String(x.id)===String(id)); if(!sp) return;
  PENDING_SPOT={lat:+sp.lat,lon:+sp.lon,editId:sp.id,oldName:sp.name,oldRiver:sp.river||sp.gewaesser||""};
  if($("as_name")) $("as_name").value=sp.name||"";
  if($("as_typ")) $("as_typ").value=spotType(sp);
  if($("as_gw")) $("as_gw").value=sp.gewaesser||sp.river||"";
  asTypeChange();
  const head=$("addSpotModal")?.querySelector(".cmhead span"); if(head) head.textContent="Angelplatz bearbeiten";
  const m=$("addSpotModal"); if(m) m.style.display="flex";
  setTimeout(()=>{ const n=$("as_name"); if(n){ n.focus(); n.select(); } },60);
}
/* Live-Bedingungen je Angelplatz in der Übersicht (Wetter-Ampel, 30 min zwischengespeichert) */
const COND_CACHE={};
async function spotCondition(s){
  const key=String(s.id), cached=COND_CACHE[key];
  if(cached && (Date.now()-cached.ts)<30*60*1000) return cached;
  const url="https://api.open-meteo.com/v1/forecast?latitude="+s.lat+"&longitude="+s.lon+
    "&current=temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,pressure_msl"+
    "&hourly=pressure_msl&forecast_days=1&timezone=Europe%2FBerlin&wind_speed_unit=kmh";
  const d=await getJSON(url), cur=d.current;
  let pt=null;
  try{ const now=new Date(cur.time), times=d.hourly.time.map(t=>new Date(t));
    let i=times.findIndex(t=>t>=now); if(i<1) i=times.length-1;
    pt=d.hourly.pressure_msl[i]-d.hourly.pressure_msl[Math.max(0,i-3)]; }catch(_){}
  // gleiche Logik wie updateAmpel (Wetter-Anteil)
  let sc=0;
  if(pt!=null){ if(pt<-3) sc--; else if(pt<=0.8) sc++; else if(pt>3) sc--; }
  if(cur.wind_gusts_10m!=null){ if(cur.wind_gusts_10m>=45) sc--; else if(cur.wind_gusts_10m>=12 && cur.wind_gusts_10m<35) sc++; }
  if((cur.precipitation!=null && cur.precipitation>=2) || [82,95,96,99].includes(cur.weather_code)) sc--;
  const wc=WMO[cur.weather_code]||["",""];
  const text=Math.round(cur.temperature_2m)+"° "+(wc[0]||"")+" · Wind "+Math.round(cur.wind_speed_10m)+" km/h";
  const res={ts:Date.now(), lvl:ampelLevel(sc), text}; COND_CACHE[key]=res; return res;
}
async function loadSpotConditions(spots,prefix){
  spots=spots||loadSpots(); prefix=prefix||""; if(!spots.length) return;
  await Promise.allSettled(spots.map(async s=>{
    const el=$(prefix+"cond_"+s.id), amp=$(prefix+"amp_"+s.id);
    try{
      const c=await spotCondition(s);
      if(amp){ amp.className="ampelbadge "+c.lvl.cls; amp.innerHTML=uiIcon(c.lvl.icon)+" "+c.lvl.word; }
      if(el) el.textContent=c.text;
    }catch(e){ if(amp){ amp.className="ampelbadge lg-amber"; amp.innerHTML=uiIcon('minus')+' n/v'; } if(el) el.textContent="Bedingungen n/v"; }
  }));
}
/* Ansichten: Start · Angelplätze · Angelplatzdaten · Fangbücher · Köder · Statistik */
function hideAllViews(){
  ["startView","homeView","spotView","mapCard","fbIndexView","catchListView","baitView","statsView"].forEach(id=>{ const e=$(id); if(e) e.style.display="none"; });
  const src=$("dataSourcesFooter"); if(src) src.style.display="none";
}
function showHome(){
  hideAllViews();
  clearCatchMarkers();
  const h=$("homeView"); if(h) h.style.display="block";
  renderSpotList();
  mountMapCard("homeMapHost",true);
  ensureMapVisible();
  setTimeout(()=>{ try{ if(MAP){ MAP.invalidateSize(); centerHomeMap(); } }catch(e){} },100);
  setActiveTab("places");
}
function openNewSpotMap(){
  showHome();
  setTimeout(()=>newSpotOnMap(),180);
}
/* --- Tab 2: Fangbücher (Liste je Angelplatz + Gesamt) --- */
function showFangbuchList(){
  hideAllViews();
  const v=$("fbIndexView"); if(v) v.style.display="block";
  renderFbIndex();
  setActiveTab("fb");
  window.scrollTo({top:0, behavior:"smooth"});
}
function renderFbIndex(){
  const box=$("fbIndexList"); if(!box) return;
  const spots=sortSpotsByDays(loadSpots());
  let html='<div class="spotrow"><button class="spotopen" onclick="showCatchList(null)">'+uiIcon('book-open')+' Gesamtfangbuch'+
    '<span class="spotsub">alle Angelplätze</span></button>'+countBadge(totalFish(), totalDays())+'</div>';
  if(spots.length){
    html+=spots.map(s=>'<div class="spotrow"><button class="spotopen" onclick="showCatchListBySpot('+s.id+')">'+uiIcon('book')+' '+esc(s.name)+' Fangbuch'+
      '<span class="spotsub">'+spotWaterLabel(s)+'</span></button>'+
      countBadge(fishCountForSpot(s.name), dayCountForSpot(s.name))+'</div>').join("");
  } else {
    html+='<div class="fbnote" style="padding:10px 4px">Noch keine Angelplätze – lege zuerst einen an.</div>';
  }
  box.innerHTML=html;
}
function showCatchListBySpot(id){ const sp=loadSpots().find(x=>String(x.id)===String(id)); showCatchList(sp?sp.name:null); }
function showCatchList(spotName){
  CATCH_VIEW_SPOT = spotName || null;
  hideAllViews();
  const v=$("catchListView"); if(v) v.style.display="block";
  renderCatchList();
  setActiveTab("fb");
  window.scrollTo({top:0, behavior:"smooth"});
}
let FISHPIE=null;
function toggleFishPie(){ const b=$("fishPieBox"); if(!b) return;
  const show=(b.style.display==="none"||!b.style.display); b.style.display=show?"block":"none"; if(show) renderFishPie(); }
function renderFishPie(){
  const box=$("fishPieBox"); if(!box) return;
  const fish=loadCatches().filter(isFish);
  const by={}; fish.forEach(c=>{ const f=(c.fischart||"").trim()||"?"; by[f]=(by[f]||0)+1; });
  const entries=Object.entries(by).sort((a,b)=>b[1]-a[1]);
  if(!entries.length){ box.innerHTML='<div class="fbnote" style="padding:8px 4px">Noch keine Fänge.</div>'; return; }
  const total=fish.length;
  const colors=["#38bdf8","#4ade80","#fbbf24","#f87171","#a78bfa","#2dd4bf","#fb923c","#f472b6","#60a5fa","#a3e635","#e879f9","#facc15"];
  box.innerHTML='<div class="statcard"><div class="cmcanvas" style="height:260px;position:relative"><canvas id="fishPieCanvas"></canvas></div>'+
    '<div class="fbnote" style="margin-top:10px;line-height:1.7">'+entries.map((e,i)=>
      '<span class="statusdot" style="color:'+colors[i%colors.length]+'"></span> '+esc(e[0])+': '+e[1]+' ('+Math.round(e[1]/total*100)+' %)').join(' · ')+'</div></div>';
  const cv=$("fishPieCanvas"); if(!cv || !window.Chart) return;
  if(FISHPIE){ try{ FISHPIE.destroy(); }catch(e){} }
  FISHPIE=new Chart(cv.getContext("2d"),{ type:"pie",
    data:{ labels:entries.map(e=>e[0]), datasets:[{ data:entries.map(e=>e[1]), backgroundColor:entries.map((e,i)=>colors[i%colors.length]), borderColor:"#0a0e14", borderWidth:2 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:"#e8eef7" } } } } });
}
/* Fang direkt aus einem Fangbuch eintragen: passenden Angelplatz öffnen + Formular aufklappen */
function openFangbuchForm(){
  const box=$("fangbuchBox"), form=$("catchFormPanel"), blank=$("blankRatingPanel");
  if(box){ box.style.display="block"; updateFangbuchBtn(); }
  if(form) form.style.display="block";
  if(blank) blank.style.display="none";
  const add=$("catchFormToggle"); if(add) setIconLabel(add,"chevron-up","Fangformular schließen");
  setTimeout(()=>{ const el=$("f_art"); if(el){ el.scrollIntoView({behavior:"smooth", block:"center"}); try{ el.focus(); }catch(e){} } }, 160);
}
function toggleCatchForm(){
  const form=$("catchFormPanel"), blank=$("blankRatingPanel"), add=$("catchFormToggle"); if(!form) return;
  const show=form.style.display==="none"||!form.style.display;
  form.style.display=show?"block":"none";
  if(blank) blank.style.display="none";
  if(add) setIconLabel(add,show?"chevron-up":"fish",show?"Fangformular schließen":"Fang eintragen");
  if(show) setTimeout(()=>{ const el=$("f_art"); if(el){ el.scrollIntoView({behavior:"smooth",block:"center"}); try{el.focus();}catch(e){} } },120);
}
function addCatchFromList(){
  const spots=loadSpots();
  if(!spots.length){ alert("Lege zuerst einen Angelplatz an, dann kannst du Fänge eintragen."); showHome(); return; }
  let sp = CATCH_VIEW_SPOT ? spots.find(s=>s.name===CATCH_VIEW_SPOT) : (activeSpot()||spots[0]);
  if(!sp) sp=spots[0];
  openSpot(sp.id);        // Platz aktivieren, Live-Daten laden, Datenansicht zeigen
  openFangbuchForm();     // Fangbuch-Formular aufklappen + hinscrollen
}
