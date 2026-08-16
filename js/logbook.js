"use strict";

/**
 * PetriKlar · logbook.js
 * Trips, Fangbuch, Bearbeitung, Export/Import und Fangmelde-PDF.
 * Lade-Reihenfolge und Abhängigkeiten: docs/ARCHITEKTUR.md
 */
/* ===================== Fangbuch ===================== */
function loadCatches(){ return Array.isArray(APP_STATE.catches)?APP_STATE.catches:[]; }
function saveCatches(a){ APP_STATE.catches=Array.isArray(a)?a:[]; markCloudDirty(); }
function loadTrips(){ return Array.isArray(APP_STATE.trips)?APP_STATE.trips:[]; }
function saveTrips(a){ APP_STATE.trips=Array.isArray(a)?a:[]; markCloudDirty(); }
function activeTrip(){ return APP_STATE.active_trip||null; }
function saveActiveTrip(t){ APP_STATE.active_trip=t||null; markCloudDirty(); renderActiveTrip(); }
function tripDuration(start,end){
  const s=new Date(start).getTime(), e=end?new Date(end).getTime():Date.now();
  if(!isFinite(s)) return "00:00:00";
  let n=Math.max(0,Math.floor((e-s)/1000)), h=Math.floor(n/3600); n%=3600;
  const m=Math.floor(n/60), sec=n%60, p=x=>String(x).padStart(2,"0"); return p(h)+":"+p(m)+":"+p(sec);
}
function tripCatchRecords(id){ return loadCatches().filter(c=>String(c.trip_id||"")===String(id)); }
function renderActiveTrip(){
  const box=$("activeTripBanner"); if(!box) return; const t=activeTrip();
  if(!t){ box.style.display="none"; box.innerHTML=""; return; }
  box.style.display="flex";
  box.innerHTML='<div class="active-trip-info"><span>Aktiver Trip</span><b>'+esc(t.spotName||"Angelplatz")+'</b><strong>'+tripDuration(t.start_iso)+'</strong></div>'+
    '<div class="active-trip-actions"><button onclick="tripAddCatch()">'+uiIcon('fish')+' Fang eintragen</button>'+
    '<button class="trip-stop" onclick="openTripEnd()">'+uiIcon('circle-check')+' Trip beenden</button></div>';
}
function renderFavorites(){
  const box=$("favoriteList"); if(!box) return; const spots=loadSpots();
  if(!spots.length){
    box.innerHTML='<button class="emptycard empty-spot-cta" onclick="openNewSpotMap()">'+
      '<div class="emptyicon">'+PIN_SVG+'</div><div class="emptytitle">Lege einen Angelplatz an</div>'+
      '<div class="emptydesc">Öffnet „Angelplätze verwalten“ direkt auf der Karte.</div></button>';
    return;
  }
  const ranked=sortSpotsByDays(spots).slice(0,3);
  box.innerHTML=ranked.map(s=>spotRowHtml(s,"fav_",true)).join("");
  loadSpotConditions(ranked,"fav_");
}
function showStart(){ hideAllViews(); const v=$("startView"); if(v) v.style.display="block"; renderFavorites(); renderActiveTrip(); setActiveTab("start"); window.scrollTo({top:0,behavior:"smooth"}); }
function openTripStart(){
  if(activeTrip()){ alert("Es läuft bereits ein Trip."); return; }
  const spots=loadSpots(); if(!spots.length){ alert("Lege zuerst einen Angelplatz an."); showHome(); return; }
  const sel=$("tripSpotSelect"); if(sel) sel.innerHTML=spots.map(s=>'<option value="'+s.id+'">'+esc(s.name)+'</option>').join("");
  const a=activeSpot(); if(sel&&a) sel.value=String(a.id);
  const m=$("tripStartModal"); if(m) m.style.display="flex";
}
function closeTripStart(){ const m=$("tripStartModal"); if(m) m.style.display="none"; }
function confirmTripStart(){
  const id=$("tripSpotSelect")?$("tripSpotSelect").value:"", sp=loadSpots().find(s=>String(s.id)===String(id)); if(!sp) return;
  const t={id:Date.now(),spotId:sp.id,spotName:sp.name,gewaesser:sp.gewaesser||sp.river||"",start_iso:new Date().toISOString(),end_iso:null,duration_s:null,rating:"",pending_end:false};
  const all=loadTrips(); all.push(t); saveTrips(all); saveActiveTrip(t); closeTripStart(); openSpot(sp.id);
}
function tripAddCatch(){ const t=activeTrip(); if(!t) return; openSpot(t.spotId); openFangbuchForm(); }
function openTripEnd(){
  const t=activeTrip(); if(!t) return;
  const m=$("tripEndModal"); if(m) m.style.display="flex";
}
function closeTripEnd(){ const m=$("tripEndModal"); if(m) m.style.display="none"; }
let ENDING_TRIP=false;
async function rateAndEndTrip(rating){
  const t=activeTrip(); if(!t||!rating||ENDING_TRIP) return; ENDING_TRIP=true;
  try{
    if(!tripCatchRecords(t.id).length){
      activateSpotById(t.spotId); await loadAll(); const now=new Date(), p=n=>String(n).padStart(2,"0");
      if($("f_datum")) $("f_datum").value=now.getFullYear()+"-"+p(now.getMonth()+1)+"-"+p(now.getDate());
      if($("f_zeit")) $("f_zeit").value=p(now.getHours())+":"+p(now.getMinutes());
      const rec=buildRecord(true); rec.trip_id=t.id; rec.trip_bewertung=rating; const arr=loadCatches(); arr.push(rec); saveCatches(arr);
    }
    closeTripEnd(); finalizeTrip(rating);
  } finally { ENDING_TRIP=false; }
}
function finalizeTrip(rating){
  const t=activeTrip(); if(!t) return; const end=new Date(); t.rating=rating||t.rating||"mittel"; t.end_iso=end.toISOString();
  t.duration_s=Math.max(0,Math.round((end.getTime()-new Date(t.start_iso).getTime())/1000)); t.pending_end=false;
  const all=loadTrips(), i=all.findIndex(x=>String(x.id)===String(t.id)); if(i>=0) all[i]=t; else all.push(t); saveTrips(all);
  const catches=loadCatches(); catches.forEach(c=>{ if(String(c.trip_id||"")===String(t.id)) c.trip_bewertung=t.rating; }); saveCatches(catches);
  saveActiveTrip(null); refreshFangbuch(); showStart();
}
function catchesForView(){
  const all=loadCatches();
  const n=activeSpotName();
  return n ? all.filter(c=>c.angelplatz===n) : [];
}
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function deNum(s){ if(s==null) return null; const n=parseFloat(String(s).replace(/\./g,'').replace(',','.')); return isNaN(n)? String(s) : n; }

function moonPhase(date){
  const syn=29.530588853, ref=Date.UTC(2000,0,6,18,14,0);
  let age=(((date.getTime()-ref)/86400000) % syn + syn) % syn;
  const illum=Math.round((1-Math.cos(2*Math.PI*age/syn))/2*100);
  const N=[[1.85,"Neumond"],[5.54,"zunehmende Sichel"],[9.23,"zunehmender Halbmond"],
    [12.91,"zunehmender Mond"],[16.61,"Vollmond"],[20.30,"abnehmender Mond"],
    [23.99,"abnehmender Halbmond"],[27.68,"abnehmende Sichel"]];
  let name="Neumond"; for(const [lim,nm] of N){ if(age<lim){ name=nm; break; } }
  return { name, age:Math.round(age*10)/10, illum };
}

function waterQualitySnap(){
  const M={ "Wassertemperatur":"wassertemperatur_c","Sauerstoff":"sauerstoff_mgl",
    "O₂-Sättigung":"o2_saettigung_pct","Trübung":"truebung","Schwebstoff":"schwebstoff_gm3",
    "pH-Wert":"ph","Leitfähigkeit":"leitfaehigkeit_uScm" };
  const cur=wqCurrent(); const items=cur?cur.items:[];
  const out={ stand:(cur&&cur.updated)||"", station:(cur&&cur.name)||"", quelle:(cur&&cur.source)||"",
    entfernung_km:(cur? Math.round(cur.dist*10)/10 : null) };
  items.forEach(it=>{ const k=M[it.label],v=deNum(it.value); if(k&&typeof v==="number"&&!isNaN(v)) out[k]=v; });
  return out;
}

function captureGps(){
  if(!navigator.geolocation){ $("gpsInfo").textContent="Ortung auf diesem Gerät nicht verfügbar."; return; }
  setIconLabel($("gpsBtn"),"pin","wird geortet …");
  navigator.geolocation.getCurrentPosition(p=>{
    setSelectedLocation(p.coords.latitude, p.coords.longitude, p.coords.accuracy, true);
    setIconLabel($("gpsBtn"),"pin","Standort aktualisieren");
  }, ()=>{
    $("gpsInfo").textContent="Ortung abgelehnt/fehlgeschlagen – Fang wird ohne Standort gespeichert.";
    setIconLabel($("gpsBtn"),"pin","Handy-Standort");
  }, {enableHighAccuracy:true, timeout:10000, maximumAge:0});
}

function readKoeder(){
  const base=($("f_koeder_base")?$("f_koeder_base").value:"").trim();
  const varLabel=($("f_koeder_var")?$("f_koeder_var").value:"").trim();
  const label = varLabel || base;
  let variante="";
  if(varLabel && base && varLabel.toLowerCase().indexOf(base.toLowerCase())===0)
    variante = varLabel.slice(base.length).replace(/^[\s,]+/,"").trim();
  return { label, base, variante };
}
function buildRecord(blank){
  const datum=$("f_datum").value, zeit=$("f_zeit").value;
  const dObj = datum ? new Date(datum+"T"+(zeit||"12:00")) : new Date();
  const mp=moonPhase(dObj);
  const sp=activeSpot();
  const k=readKoeder();
  const tr=activeTrip();
  return {
    id: Date.now(),
    erfasst_iso: new Date().toISOString(),
    kein_fang: !!blank,
    gewaesser: sp ? (sp.gewaesser||sp.river||"") : "",
    gewaessertyp: spotType(sp),
    angelplatz: sp ? sp.name : "",
    datum, uhrzeit: zeit,
    fischart: blank ? "" : $("f_art").value.trim(),
    groesse_cm: (!blank && $("f_groesse").value) ? +$("f_groesse").value : null,
    gewicht_kg: (!blank && $("f_gewicht").value) ? +$("f_gewicht").value : null,
    fangstatus: blank ? "" : ($("f_fangstatus")?$("f_fangstatus").value:""),
    koeder: k.label,
    koeder_basis: k.base,
    koeder_variante: k.variante,
    trip_id: tr?tr.id:null,
    trip_bewertung: tr?(tr.rating||""):"",
    methode: ($("f_methode") ? $("f_methode").value.trim() : ""),
    notiz: $("f_notiz").value.trim(),
    gps: CURRENT_GPS,
    mondphase: { name:mp.name, alter_tage:mp.age, illumination_pct:mp.illum },
    wetter: snap.weather,
    wasser: Object.assign({
      pegelstand_cm: snap.pegel? snap.pegel.pegelstand_cm : null,
      pegel_stufe: snap.pegel? snap.pegel.stufe : null,
      durchfluss_m3s: snap.q,
      wassertemperatur_modell_c: (snap.marineTemp!=null ? snap.marineTemp : null)
    }, waterQualitySnap()),
    station: { pegel: CUR?CUR.name:"", pegel_uuid: CUR?CUR.uuid:"", km: CUR?CUR.km:null }
  };
}
let EDIT_CATCH_ID=null;
function resetCatchEdit(){
  EDIT_CATCH_ID=null;
  const b=$("fbSaveBtn"), c=$("fbEditCancel");
  setIconLabel(b,"fish","Fang speichern");
  if(c) c.style.display="none";
}
function clearFishRules(){ const box=$("fishRules"); if(box){ box.style.display="none"; box.innerHTML=""; } }
function saveCatch(opts){
  opts=opts||{};
  const blank = opts.blank || !$("f_art").value.trim();   // ohne Fischart => Leereintrag (Angeltag)
  const rec=buildRecord(blank);
  if(opts.rating) rec.trip_bewertung=opts.rating;
  const arr=loadCatches();
  if(EDIT_CATCH_ID!=null){
    const i=arr.findIndex(c=>String(c.id)===String(EDIT_CATCH_ID));
    if(i>=0){
      const old=arr[i];
      // Beim Bearbeiten bleiben die damals gespeicherten Bedingungen erhalten.
      rec.id=old.id; rec.erfasst_iso=old.erfasst_iso;
      rec.wetter=old.wetter; rec.wasser=old.wasser; rec.mondphase=old.mondphase;
      rec.trip_id=old.trip_id||rec.trip_id; rec.trip_bewertung=old.trip_bewertung||rec.trip_bewertung;
      arr[i]=rec;
    } else arr.push(rec);
  } else arr.push(rec);
  saveCatches(arr);
  $("f_art").value=""; $("f_groesse").value=""; $("f_gewicht").value=""; $("f_notiz").value="";
  if($("f_fangstatus")) $("f_fangstatus").value="";
  if($("f_koeder_base")) $("f_koeder_base").value=""; onKoederBaseChange();
  if($("f_methode")) $("f_methode").value="";
  const now=new Date(), pad=n=>String(n).padStart(2,'0');
  $("f_zeit").value=pad(now.getHours())+':'+pad(now.getMinutes());
  clearSelectedLocation();
  const wasEdit=EDIT_CATCH_ID!=null; resetCatchEdit();
  clearFishRules();
  populateCatchSpots();
  refreshFangbuch();
  const bt=$(blank?"fbBlankBtn":"fbSaveBtn");
  if(bt){ const o=bt.innerHTML; setIconLabel(bt,"check",wasEdit?"Änderungen gespeichert":(blank?"Angeltag gespeichert":"Fang gespeichert")); setTimeout(()=>{ if(EDIT_CATCH_ID==null) setIconLabel(bt,"fish","Fang speichern"); else bt.innerHTML=o; }, 1500); }
  const tr=activeTrip(); if(tr&&tr.pending_end&&!wasEdit) finalizeTrip(tr.rating);
  const form=$("catchFormPanel"); if(form) form.style.display="none";
  const add=$("catchFormToggle"); if(add) setIconLabel(add,"fish","Fang eintragen");
  const blankPanel=$("blankRatingPanel"); if(blankPanel) blankPanel.style.display="none";
}
function saveBlank(){ showBlankRating(); }
function showBlankRating(){
  const panel=$("blankRatingPanel"), form=$("catchFormPanel"); if(!panel) return;
  if(form) form.style.display="none";
  panel.style.display=(panel.style.display==="none"||!panel.style.display)?"block":"none";
  const add=$("catchFormToggle"); if(add) setIconLabel(add,"fish","Fang eintragen");
}
function saveBlankWithRating(rating){ saveCatch({blank:true,rating:rating}); }

function editCatch(id){
  const c=loadCatches().find(x=>String(x.id)===String(id)); if(!c) return;
  const sp=loadSpots().find(s=>s.name===c.angelplatz);
  if(sp) activateSpotById(sp.id);
  openSpot(sp?sp.id:null); openFangbuchForm();
  EDIT_CATCH_ID=c.id;
  $("f_art").value=c.fischart||""; $("f_groesse").value=c.groesse_cm==null?"":c.groesse_cm;
  $("f_gewicht").value=c.gewicht_kg==null?"":c.gewicht_kg;
  if($("f_fangstatus")) $("f_fangstatus").value=catchStatus(c);
  $("f_datum").value=c.datum||""; $("f_zeit").value=c.uhrzeit||""; $("f_notiz").value=c.notiz||"";
  populateKoeder();
  if($("f_koeder_base")) $("f_koeder_base").value=c.koeder_basis||c.koeder||"";
  onKoederBaseChange();
  if($("f_koeder_var") && c.koeder) $("f_koeder_var").value=c.koeder||"";
  CURRENT_GPS=c.gps||null;
  const gi=$("gpsInfo"); if(gi) gi.innerHTML=CURRENT_GPS?iconLabel("pin","Fangort: "+CURRENT_GPS.lat+", "+CURRENT_GPS.lon):"Kein eigener Fangort gespeichert.";
  const b=$("fbSaveBtn"), x=$("fbEditCancel"); setIconLabel(b,"check","Änderungen speichern"); if(x) x.style.display="";
  showFishRules();
  setTimeout(()=>$("fangbuchBox")&&$("fangbuchBox").scrollIntoView({behavior:"smooth",block:"start"}),120);
}
function cancelCatchEdit(){ resetCatchEdit(); $("f_art").value=""; $("f_groesse").value=""; $("f_gewicht").value=""; $("f_notiz").value=""; if($("f_fangstatus")) $("f_fangstatus").value=""; showFishRules(); }

function deleteCatch(id){
  if(!confirm("Diesen Fang löschen?")) return;
  saveCatches(loadCatches().filter(c=>String(c.id)!==String(id)));
  refreshFangbuch();
}

function weightStr(c){
  if(c.gewicht_kg!=null) return ' · '+String(c.gewicht_kg).replace('.',',')+' kg';
  if(c.gewicht_g!=null) return ' · '+c.gewicht_g+' g';   // Altdaten
  return '';
}
function catchStatus(c){
  const s=String((c&&(c.fangstatus||c.verwertung))||"").toLowerCase(); return /^(entnommen|abgegangen)$/.test(s)?s:"";
}
function catchCard(c){
  const w=c.wetter||{}, wa=c.wasser||{}, water=[], weather=[], context=[], extra=[];
  if(wa.wassertemperatur_c!=null) water.push("Wassertemperatur "+wa.wassertemperatur_c+" °C");
  if(wa.wassertemperatur_modell_c!=null) water.push("Wassertemperatur Modell "+wa.wassertemperatur_modell_c+" °C");
  if(wa.pegelstand_cm!=null) water.push("Pegel "+wa.pegelstand_cm+" cm"+(wa.pegel_stufe?" ("+wa.pegel_stufe+")":""));
  if(wa.durchfluss_m3s!=null) water.push("Durchfluss "+wa.durchfluss_m3s+" m³/s");
  if(wa.sauerstoff_mgl!=null) water.push("Sauerstoff "+wa.sauerstoff_mgl+" mg/l");
  if(wa.o2_saettigung_pct!=null) water.push("O₂-Sättigung "+wa.o2_saettigung_pct+" %");
  if(wa.truebung!=null) water.push("Trübung "+wa.truebung);
  if(wa.schwebstoff_gm3!=null) water.push("Schwebstoff "+wa.schwebstoff_gm3+" g/m³");
  if(wa.ph!=null) water.push("pH "+wa.ph);
  if(wa.leitfaehigkeit_uScm!=null) water.push("Leitfähigkeit "+wa.leitfaehigkeit_uScm+" µS/cm");
  if(w.lufttemperatur_c!=null) weather.push("Lufttemperatur "+w.lufttemperatur_c+" °C");
  if(w.luftdruck_hpa!=null) weather.push("Luftdruck "+Math.round(w.luftdruck_hpa)+" hPa");
  if(w.wind_kmh!=null) weather.push("Wind "+w.wind_kmh+" km/h"+(w.windrichtung?" "+w.windrichtung:""));
  if(w.boen_kmh!=null) weather.push("Böen "+w.boen_kmh+" km/h");
  if(w.niederschlag_mm_h!=null) weather.push("Niederschlag "+w.niederschlag_mm_h+" mm/h");
  if(w.wetterlage) weather.push(w.wetterlage);
  if(c.angelplatz) context.push("Angelplatz: "+c.angelplatz);
  if(c.gewaesser) context.push("Gewässer: "+c.gewaesser);
  if(c.gps&&c.gps.lat!=null) context.push("Fangort: "+c.gps.lat+", "+c.gps.lon);
  if(c.methode) extra.push("Methode: "+c.methode);
  const status=catchStatus(c); if(status) extra.push("Fangstatus: "+status.charAt(0).toUpperCase()+status.slice(1));
  if(c.trip_bewertung) extra.push("Tripbewertung: "+c.trip_bewertung);
  if(c.mondphase&&c.mondphase.name) extra.push("Mondphase: "+c.mondphase.name);
  if(c.notiz) extra.push("Notiz: „"+c.notiz+"“");
  const title = c.kein_fang
    ? uiIcon('ban')+' Kein Fang'
    : uiIcon('fish')+' '+esc(c.fischart)+(c.groesse_cm?' · '+c.groesse_cm+' cm':'')+weightStr(c);
  const short=c.kein_fang ? (esc(c.datum||"")+' '+esc(c.uhrzeit||"")) :
    (esc(c.datum||"")+' '+esc(c.uhrzeit||"")+(c.koeder?' · Köder: '+esc(c.koeder):''));
  const group=(label,arr)=>arr.length?'<div class="catchdetailgroup"><b>'+label+'</b><span>'+esc(arr.join(" · "))+'</span></div>':'';
  const details=group("Ort",context)+group("Wasserdaten",water)+group("Wetter",weather)+group("Weitere Angaben",extra);
  const actionId=esc(String(c.id));
  return '<div class="fbitem'+(c.kein_fang?' blank':'')+'"><div class="catchrow"><div class="catchmain"><div class="fish">'+title+'</div>'+
    '<div class="when">'+short+'</div></div><div class="catchside"><span class="catchacts">'+
    '<button type="button" class="catchicon editmini" data-catch-id="'+actionId+'" title="Bearbeiten" aria-label="Fang bearbeiten" onclick="editCatch(this.dataset.catchId)">'+uiIcon('edit')+'</button>'+
    '<button type="button" class="catchicon del" data-catch-id="'+actionId+'" title="Löschen" aria-label="Fang löschen" onclick="deleteCatch(this.dataset.catchId)">'+uiIcon('close')+'</button></span>'+
    '<button class="catchdetailtoggle" type="button" aria-expanded="false" onclick="toggleCatchDetails(this)">Details</button></div></div>'+
    '<div class="catchdetailbody" style="display:none">'+(details||'<span class="fbnote">Keine weiteren Angaben.</span>')+'</div></div>';
}
function toggleCatchDetails(btn){
  const card=btn.closest(".fbitem"), body=card?card.querySelector(".catchdetailbody"):null; if(!body) return;
  const show=body.style.display==="none"||!body.style.display; body.style.display=show?"flex":"none";
  btn.setAttribute("aria-expanded",show?"true":"false");
}
let CATCH_SORT_MODE="chrono";
function catchTimeKey(c){ return String(c.datum||"")+" "+String(c.uhrzeit||""); }
function sortedCatchEntries(arr){ return (arr||[]).slice().sort((a,b)=>catchTimeKey(b).localeCompare(catchTimeKey(a))); }
function blankGroupCard(items,key,force){
  if(items.length===1&&!force) return catchCard(items[0]);
  const days=countFishingDays(items), label=days+" "+(days===1?"Tag":"Tage")+" ohne Fang";
  return '<div class="blankgroup"><button type="button" class="blankgrouphead" aria-expanded="false" onclick="toggleBlankGroup(this)">'+
    '<span>'+uiIcon('ban')+' '+label+'</span>'+uiIcon('chevron-down')+'</button><div class="blankgroupbody" style="display:none">'+
    items.map(catchCard).join("")+'</div></div>';
}
function toggleBlankGroup(btn){
  const body=btn.nextElementSibling, show=body&&(body.style.display==="none"||!body.style.display); if(!body) return;
  body.style.display=show?"block":"none"; btn.setAttribute("aria-expanded",show?"true":"false");
}
function renderCatchEntries(arr,mode){
  arr=sortedCatchEntries(arr); mode=mode||CATCH_SORT_MODE;
  const fish=arr.filter(isFish), blank=arr.filter(c=>!isFish(c));
  if(mode==="fish-only") return fish.map(catchCard).join("");
  if(mode==="fish-first") return fish.map(catchCard).join("")+(blank.length?blankGroupCard(blank,"all",true):"");
  let html="", pending=[], n=0;
  const flush=()=>{ if(pending.length){ html+=blankGroupCard(pending,"g"+(n++),false); pending=[]; } };
  arr.forEach(c=>{ if(isFish(c)){ flush(); html+=catchCard(c); } else pending.push(c); }); flush(); return html;
}
function setCatchSortMode(mode){
  CATCH_SORT_MODE=["chrono","fish-first","fish-only"].includes(mode)?mode:"chrono";
  const sel=$("catchSortMode"); if(sel&&sel.value!==CATCH_SORT_MODE) sel.value=CATCH_SORT_MODE;
  renderCatchList(); renderCatches();
}
function renderCatches(){
  const arr=sortedCatchEntries(catchesForView());
  const cnt=$("fbCount"); if(cnt){ const f=arr.filter(isFish).length, d=countFishingDays(arr); cnt.textContent = f+(f===1?" Fang":" Fänge")+" · "+d+" Angeltag"+(d===1?"":"e"); }
  const box=$("fbList"); if(!box) return;
  if(!arr.length){ box.innerHTML='<div class="fbnote" style="padding:8px 4px">Noch keine Fänge – trag deinen ersten Fang oben ein.</div>'; return; }
  box.innerHTML = renderCatchEntries(arr,CATCH_SORT_MODE);
}
let CATCH_VIEW_SPOT = null;   // Name des Angelplatzes, oder null = Gesamtfangbuch
function isFish(c){ return !c.kein_fang && !!c.fischart; }
function countFishingDays(arr){ return new Set((arr||[]).map(c=>c.datum).filter(Boolean)).size; }
function fishCountForSpot(name){ return loadCatches().filter(c=>c.angelplatz===name && isFish(c)).length; }
function localDateKey(iso){
  const d=new Date(iso); if(!isFinite(d.getTime())) return "";
  const p=n=>String(n).padStart(2,"0"); return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());
}
function dayCountForSpot(name){
  const days=new Set(loadCatches().filter(c=>c.angelplatz===name).map(c=>c.datum).filter(Boolean));
  loadTrips().filter(t=>t.end_iso&&t.spotName===name).forEach(t=>{ const d=localDateKey(t.start_iso); if(d) days.add(d); });
  return days.size;
}
function sortSpotsByDays(spots){
  return (spots||[]).slice().sort((a,b)=>dayCountForSpot(b.name)-dayCountForSpot(a.name)||fishCountForSpot(b.name)-fishCountForSpot(a.name)||String(a.name).localeCompare(String(b.name),"de"));
}
function totalFish(){ return loadCatches().filter(isFish).length; }
function totalDays(){
  const days=new Set(loadCatches().map(c=>c.datum).filter(Boolean));
  loadTrips().filter(t=>t.end_iso).forEach(t=>{ const d=localDateKey(t.start_iso); if(d) days.add(d); });
  return days.size;
}
function countBadge(fish, days){
  return '<span class="countbadge" title="Fänge · Angeltage"><span class="fishico">'+uiIcon('fish')+'</span>'+fish+
    ' <span class="dayico">'+uiIcon('calendar')+'</span>'+days+'</span>';
}
function renderCatchList(){
  const box=$("catchList"); if(!box) return;
  const all=loadCatches();
  let arr = CATCH_VIEW_SPOT ? all.filter(c=>c.angelplatz===CATCH_VIEW_SPOT) : all;
  arr=sortedCatchEntries(arr);
  const t=$("catchListTitle");
  if(t) t.textContent = CATCH_VIEW_SPOT ? (CATCH_VIEW_SPOT+" Fangbuch") : "Gesamtfangbuch · alle Fänge";
  if(!arr.length){ box.innerHTML='<div class="fbnote" style="padding:10px 4px">Noch keine Fänge'+(CATCH_VIEW_SPOT?' hier':' erfasst')+'.</div>'; return; }
  const sel=$("catchSortMode"); if(sel) sel.value=CATCH_SORT_MODE;
  box.innerHTML = renderCatchEntries(arr,CATCH_SORT_MODE);
}

/* ---- Export / Import ---- */
function download(name,text,type){
  const b=new Blob([text],{type:type||"text/plain;charset=utf-8"}), u=URL.createObjectURL(b);
  const a=document.createElement("a"); a.href=u; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(u),1500);
}
function W_(c,k){ return c.wetter&&c.wetter[k]!=null? c.wetter[k] : ""; }
function A_(c,k){ return c.wasser&&c.wasser[k]!=null? c.wasser[k] : ""; }
function catchesForExport(scope){
  if(scope==="all") return loadCatches();
  if(scope==="view") return CATCH_VIEW_SPOT ? loadCatches().filter(c=>c.angelplatz===CATCH_VIEW_SPOT) : loadCatches();
  return catchesForView();
}
function exportCSV(scope){
  const arr=catchesForExport(scope||"spot");
  const cols=[
    ["id",c=>c.id],["datum",c=>c.datum],["uhrzeit",c=>c.uhrzeit],["kein_fang",c=>c.kein_fang?1:0],
    ["gewaesser",c=>c.gewaesser],["gewaessertyp",c=>c.gewaessertyp||""],["fischart",c=>c.fischart],
    ["angelplatz",c=>c.angelplatz],["groesse_cm",c=>c.groesse_cm],["gewicht_kg",c=>c.gewicht_kg],["gewicht_g",c=>c.gewicht_g],["fangstatus",c=>catchStatus(c)],["koeder",c=>c.koeder],["koeder_basis",c=>c.koeder_basis||""],["koeder_variante",c=>c.koeder_variante||""],["trip_id",c=>c.trip_id||""],["trip_bewertung",c=>c.trip_bewertung||""],["methode",c=>c.methode],["notiz",c=>c.notiz],
    ["gps_lat",c=>c.gps?c.gps.lat:""],["gps_lon",c=>c.gps?c.gps.lon:""],["gps_genauigkeit_m",c=>c.gps?c.gps.genauigkeit_m:""],
    ["mondphase",c=>c.mondphase?c.mondphase.name:""],["mond_illum_pct",c=>c.mondphase?c.mondphase.illumination_pct:""],
    ["lufttemp_c",c=>W_(c,"lufttemperatur_c")],["gefuehlt_c",c=>W_(c,"gefuehlt_c")],["wind_kmh",c=>W_(c,"wind_kmh")],
    ["windrichtung",c=>W_(c,"windrichtung")],["boen_kmh",c=>W_(c,"boen_kmh")],["luftdruck_hpa",c=>W_(c,"luftdruck_hpa")],
    ["luftdruck_tendenz_3h_hpa",c=>W_(c,"luftdruck_tendenz_3h_hpa")],["bewoelkung_pct",c=>W_(c,"bewoelkung_pct")],
    ["luftfeuchte_pct",c=>W_(c,"luftfeuchte_pct")],["niederschlag_mm_h",c=>W_(c,"niederschlag_mm_h")],["wetterlage",c=>W_(c,"wetterlage")],
    ["pegel_cm",c=>A_(c,"pegelstand_cm")],["pegel_stufe",c=>A_(c,"pegel_stufe")],["durchfluss_m3s",c=>A_(c,"durchfluss_m3s")],
    ["wassertemp_c",c=>A_(c,"wassertemperatur_c")],["wassertemp_modell_c",c=>A_(c,"wassertemperatur_modell_c")],["sauerstoff_mgl",c=>A_(c,"sauerstoff_mgl")],["o2_saettigung_pct",c=>A_(c,"o2_saettigung_pct")],
    ["truebung",c=>A_(c,"truebung")],["ph",c=>A_(c,"ph")],["leitfaehigkeit_uScm",c=>A_(c,"leitfaehigkeit_uScm")]
  ];
  const cell=v=>{ if(v==null)v=""; v=String(v).replace(/"/g,'""'); return /[";\n]/.test(v)?'"'+v+'"':v; };
  const head=cols.map(c=>c[0]).join(";");
  const body=arr.map(c=>cols.map(col=>cell(col[1](c))).join(";")).join("\n");
  const label=scope==="all" ? "alle_fangbuecher" : (scope==="view" ? (CATCH_VIEW_SPOT||"alle_fangbuecher") : (activeSpotName()||"angelplatz"));
  const safe=label.replace(/[^a-z0-9äöüß_-]+/gi,"_").replace(/^_+|_+$/g,"");
  download("fangbuch_"+(safe||"angelplatz")+".csv", "﻿"+head+"\n"+body, "text/csv;charset=utf-8");
}

/* ---- Fangmeldung als PDF zur manuellen Übermittlung ---- */
function reportDateDE(value){
  if(!value) return ""; const p=String(value).split("-"); return p.length===3?p[2]+"."+p[1]+"."+p[0]:String(value);
}
function reportSafeName(value){ return String(value||"Fangmeldung").replace(/[^a-z0-9äöüß_-]+/gi,"_").replace(/^_+|_+$/g,"")||"Fangmeldung"; }
function reportSelectedSpots(){
  return [...document.querySelectorAll('#reportSpotChoices input[type="checkbox"]:checked')].map(x=>x.value);
}
function reportFilteredCatches(){
  const year=$("reportYear")?$("reportYear").value:"";
  return window.PetriKlarReport.filterCatches(loadCatches(),reportSelectedSpots(),year);
}
function validateReportWaterName(showError){
  const field=$("reportWaterName"), error=$("reportWaterError");
  const result=window.PetriKlarReport.normalizeWaterSectionName(field?field.value:"");
  if(field){
    field.classList.toggle("field-invalid",!!showError&&!result.valid);
    field.setAttribute("aria-invalid",showError&&!result.valid?"true":"false");
    if(result.valid) field.value=result.value;
  }
  if(error){ error.textContent=showError&&!result.valid?result.message:""; error.style.display=showError&&!result.valid?"block":"none"; }
  return result;
}
function updateCatchReportInfo(){
  const arr=reportFilteredCatches(), fish=arr.filter(isFish).length, days=countFishingDays(arr), info=$("reportInfo");
  const places=reportSelectedSpots().length;
  if(info) info.textContent=places+(places===1?" Angelplatz":" Angelplätze")+" · "+days+" Angeltag"+(days===1?"":"e")+" · "+fish+" Fang"+(fish===1?"":"e")+" · "+arr.length+" Eintrag"+(arr.length===1?"":"e");
}
function setAllReportSpots(checked){
  document.querySelectorAll('#reportSpotChoices input[type="checkbox"]').forEach(x=>x.checked=!!checked); updateCatchReportInfo();
}
function openCatchReportModal(scope){
  const spots=sortSpotsByDays(loadSpots()), choices=$("reportSpotChoices"), yearSel=$("reportYear");
  const initial=scope==="view"&&CATCH_VIEW_SPOT?[CATCH_VIEW_SPOT]:(scope==="all"?spots.map(s=>s.name):[activeSpotName()].filter(Boolean));
  if(choices) choices.innerHTML=spots.map((s,i)=>'<label><input type="checkbox" value="'+hesc(s.name)+'" '+(initial.includes(s.name)?'checked':'')+' onchange="updateCatchReportInfo()"><span><b>'+hesc(s.name)+'</b><small>'+hesc(spotWaterLabel(s))+'</small></span></label>').join("")||'<div class="fbnote">Noch keine Angelplätze vorhanden.</div>';
  const water=$("reportWaterName");
  if(water) water.value=String(APP_STATE.report_prefs&&APP_STATE.report_prefs.last_water_name||"");
  validateReportWaterName(false);
  const years=[...new Set(loadCatches().map(c=>String(c.datum||"").slice(0,4)).filter(y=>/^\d{4}$/.test(y)))].sort().reverse();
  if(!years.length) years.push(String(new Date().getFullYear()));
  if(yearSel){ yearSel.innerHTML=years.map(y=>'<option value="'+y+'">'+y+'</option>').join(""); yearSel.onchange=updateCatchReportInfo; }
  const name=$("reportAnglerName"); if(name&&!name.value&&CLOUD_USER&&CLOUD_USER.user_metadata) name.value=CLOUD_USER.user_metadata.full_name||"";
  updateCatchReportInfo(); const m=$("catchReportModal"); if(m) m.style.display="flex";
}
function closeCatchReportModal(){ const m=$("catchReportModal"); if(m) m.style.display="none"; }
function pdfPageFooter(doc){
  const pages=doc.getNumberOfPages();
  for(let i=1;i<=pages;i++){
    doc.setPage(i); doc.setDrawColor(210); doc.line(14,287,196,287); doc.setFontSize(8); doc.setTextColor(110);
    doc.text("Erstellt mit PetriKlar · Manuelle Übermittlung · Seite "+i+"/"+pages,14,292);
  }
}
function generateCatchReportPDF(){
  if(!window.jspdf||!window.jspdf.jsPDF){ alert("Das PDF-Modul konnte nicht geladen werden. Bitte prüfe die Internetverbindung und lade die Seite neu."); return; }
  const selectedSpots=reportSelectedSpots(), arr=reportFilteredCatches(), waterResult=validateReportWaterName(true), year=$("reportYear")?$("reportYear").value:"";
  if(!selectedSpots.length){ alert("Bitte mindestens einen Angelplatz auswählen."); return; }
  if(!waterResult.valid){ const f=$("reportWaterName"); if(f){ f.focus(); f.scrollIntoView({block:"center",behavior:"smooth"}); } return; }
  const waterName=waterResult.value;
  const angler=($("reportAnglerName")?$("reportAnglerName").value:"").trim(), permit=($("reportPermitNumber")?$("reportPermitNumber").value:"").trim();
  const recipient=($("reportRecipient")?$("reportRecipient").value:"").trim();
  const {jsPDF}=window.jspdf, doc=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});
  doc.setFillColor(38,84,220); doc.roundedRect(14,12,182,23,3,3,"F");
  doc.setTextColor(255); doc.setFont("helvetica","bold"); doc.setFontSize(20); doc.text("PetriKlar",20,23);
  doc.setFontSize(10); doc.setFont("helvetica","normal"); doc.text("Fangmeldung / Fangstatistik",20,29);
  doc.setTextColor(35); doc.setFontSize(10); let y=43;
  const line=(label,value)=>{ doc.setFont("helvetica","bold"); doc.text(label,14,y); doc.setFont("helvetica","normal"); const lines=doc.splitTextToSize(String(value||"–"),112); doc.text(lines,82,y); y+=Math.max(6,lines.length*4.5); };
  line("Empfänger:",recipient); line("Angler:",angler||(CLOUD_USER?CLOUD_USER.email:"")); line("Erlaubnis-/Mitgliedsnummer:",permit);
  line("Gewässer / Abschnitt / Los:",waterName); line("Meldejahr:",year||"Alle");
  const rows=window.PetriKlarReport.buildRows(arr,reportDateDE,catchStatus);
  if(!rows.length) rows.push(["","","Keine Einträge vorhanden","0","","",""]);
  if(typeof doc.autoTable!=="function"){ alert("Die PDF-Tabellenfunktion konnte nicht geladen werden. Bitte Seite neu laden."); return; }
  doc.autoTable({startY:y+2,head:[["Datum","Zeit","Fischart / Angeltag","Anz.","cm","kg","Köder"]],body:rows,
    theme:"grid",styles:{font:"helvetica",fontSize:7.5,cellPadding:1.8,overflow:"linebreak"},
    headStyles:{fillColor:[38,84,220],textColor:255,fontStyle:"bold"},alternateRowStyles:{fillColor:[246,248,252]},
    columnStyles:{0:{cellWidth:20},1:{cellWidth:15},2:{cellWidth:52},3:{cellWidth:12},4:{cellWidth:14},5:{cellWidth:16},6:{cellWidth:53}}});
  y=doc.lastAutoTable.finalY+9;
  const species={}; arr.filter(isFish).forEach(c=>{ const k=c.fischart||"Unbekannt"; species[k]=(species[k]||0)+1; });
  const summary=Object.keys(species).sort().map(k=>k+": "+species[k]).join(" · ")||"Keine Fänge";
  if(y>255){ doc.addPage(); y=20; }
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(35); doc.text("Zusammenfassung",14,y); y+=6;
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.text("Angeltage: "+countFishingDays(arr)+" · Fänge: "+arr.filter(isFish).length,14,y); y+=5;
  doc.text(doc.splitTextToSize(summary,182),14,y); y+=12;
  if(y>270){ doc.addPage(); y=24; }
  doc.setFontSize(8.5); doc.setTextColor(70); doc.text("Die Angaben wurden aus dem persönlichen PetriKlar-Fangbuch übernommen. Das PDF wird nicht automatisch versendet.",14,y); y+=15;
  doc.setDrawColor(130); doc.line(14,y,82,y); doc.line(112,y,196,y); doc.setFontSize(8); doc.text("Ort, Datum",14,y+4); doc.text("Unterschrift",112,y+4);
  pdfPageFooter(doc);
  APP_STATE.report_prefs={...(APP_STATE.report_prefs||{}),last_water_name:waterName};
  markCloudDirty();
  doc.save("PetriKlar_Fangmeldung_"+reportSafeName(waterName)+"_"+(year||"gesamt")+".pdf");
  closeCatchReportModal();
}
function openCatchUpload(){ const f=$("importFile"); if(f) f.click(); }
function parseCatchCSV(text){
  text=String(text||"").replace(/^﻿/,"");
  const rows=[]; let row=[], cell="", quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"' && text[i+1]==='"'){ cell+='"'; i++; }
      else if(ch==='"') quoted=false;
      else cell+=ch;
    } else if(ch==='"') quoted=true;
    else if(ch===';'){ row.push(cell); cell=""; }
    else if(ch==='\n'){ row.push(cell); rows.push(row); row=[]; cell=""; }
    else if(ch!=='\r') cell+=ch;
  }
  if(cell!==""||row.length){ row.push(cell); rows.push(row); }
  if(rows.length<2) return [];
  const head=rows.shift().map(x=>x.trim());
  return rows.filter(r=>r.some(x=>String(x).trim()!=="")).map((r,i)=>{
    const o={}; head.forEach((h,j)=>o[h]=r[j]==null?"":r[j]); return catchFromCSV(o,i);
  });
}
function catchFromCSV(o,i){
  const val=k=>o[k]==null?"":String(o[k]).trim();
  const num=k=>{ const s=val(k).replace(",","."); return s===""?null:(isNaN(+s)?null:+s); };
  const put=(obj,key,value)=>{ if(value!==""&&value!=null) obj[key]=value; };
  const c={
    id:val("id")||Date.now()+i, erfasst_iso:"", datum:val("datum"), uhrzeit:val("uhrzeit"),
    kein_fang:/^(1|true|ja)$/i.test(val("kein_fang")), gewaesser:val("gewaesser"),
    gewaessertyp:val("gewaessertyp"), fischart:val("fischart"), angelplatz:val("angelplatz"),
    groesse_cm:num("groesse_cm"), gewicht_kg:num("gewicht_kg"), gewicht_g:num("gewicht_g"),
    koeder:val("koeder"), koeder_basis:val("koeder_basis"), koeder_variante:val("koeder_variante"),
    trip_id:val("trip_id")||null, trip_bewertung:val("trip_bewertung"),
    fangstatus:val("fangstatus")||val("verwertung"), methode:val("methode"), notiz:val("notiz"), wetter:{}, wasser:{}
  };
  const lat=num("gps_lat"), lon=num("gps_lon"), acc=num("gps_genauigkeit_m");
  if(lat!=null&&lon!=null) c.gps={lat,lon,genauigkeit_m:acc}; else c.gps=null;
  const moon=val("mondphase"), illum=num("mond_illum_pct");
  c.mondphase=(moon||illum!=null)?{name:moon,illumination_pct:illum}:null;
  [["lufttemperatur_c","lufttemp_c"],["gefuehlt_c","gefuehlt_c"],["wind_kmh","wind_kmh"],
   ["windrichtung","windrichtung"],["boen_kmh","boen_kmh"],["luftdruck_hpa","luftdruck_hpa"],
   ["luftdruck_tendenz_3h_hpa","luftdruck_tendenz_3h_hpa"],["bewoelkung_pct","bewoelkung_pct"],
   ["luftfeuchte_pct","luftfeuchte_pct"],["niederschlag_mm_h","niederschlag_mm_h"]].forEach(x=>put(c.wetter,x[0],num(x[1])));
  put(c.wetter,"wetterlage",val("wetterlage"));
  [["pegelstand_cm","pegel_cm"],["durchfluss_m3s","durchfluss_m3s"],["wassertemperatur_c","wassertemp_c"],
   ["wassertemperatur_modell_c","wassertemp_modell_c"],["sauerstoff_mgl","sauerstoff_mgl"],
   ["o2_saettigung_pct","o2_saettigung_pct"],["truebung","truebung"],["ph","ph"],
   ["leitfaehigkeit_uScm","leitfaehigkeit_uScm"]].forEach(x=>put(c.wasser,x[0],num(x[1])));
  put(c.wasser,"pegel_stufe",val("pegel_stufe"));
  return c;
}
function importCatchFile(ev){
  const f=ev.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const raw=String(rd.result||""), isJson=/\.json$/i.test(f.name)||/^\s*\[/.test(raw);
      const data=isJson?JSON.parse(raw):parseCatchCSV(raw); if(!Array.isArray(data)) throw 0;
      const cur=loadCatches(), ids=new Set(cur.map(x=>String(x.id))); let added=0;
      data.forEach((r,i)=>{
        if(!r) return; if(!r.fangstatus&&/^(entnommen|abgegangen)$/i.test(String(r.verwertung||""))) r.fangstatus=String(r.verwertung).toLowerCase(); delete r.verwertung;
        if(r.id==null||r.id==="") r.id=Date.now()+i;
        if(ids.has(String(r.id))) return;
        cur.push(r); ids.add(String(r.id)); added++;
      });
      saveCatches(cur); refreshFangbuch();
      alert(added+(added===1?" Fang":" Fänge")+" hochgeladen.");
    }catch(e){ alert("Upload fehlgeschlagen: Bitte eine gültige Fangbuch-CSV- oder JSON-Datei wählen."); }
    ev.target.value="";
  };
  rd.readAsText(f);
}
