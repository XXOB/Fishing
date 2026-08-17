"use strict";

/**
 * PetriKlar · map.js
 * Leaflet-Karte, Sensorcluster, Marker, Fangorte und Schonregeln.
 * Lade-Reihenfolge und Abhängigkeiten: docs/ARCHITEKTUR.md
 */
/* ---- Leaflet-Karte ---- */
let MAP=null, CATCH_LAYER=null, SELECT_MARKER=null;
let STATIONS_LAYER=null, SPOTS_LAYER=null, STATIONS_VISIBLE=false, SPOTS_VISIBLE=true, SPOT_PICK=false, STATION_PICK=false;
let STATION_MINWERTE=false;   // false = alle Stationen, true = nur mit >= 2 Werten
let PO_PARAMS=null, PO_LOADING=false;            // uuid -> {wt,o2,tr}
async function ensureStationParams(){
  if(PO_PARAMS || PO_LOADING) return;
  PO_LOADING=true;
  try{
    const arr=await getJSON(PO_BASE+"/stations.json?includeTimeseries=true");
    const m={};
    for(const s of arr){
      const sh=(s.timeseries||[]).map(t=>String(t.shortname||"").toUpperCase());
      const pegel=sh.includes("W")||sh.includes("Q");   // Wasserstand/Abfluss = Pegel (grau)
      const wt=sh.includes("WT");
      if(!pegel && !wt) continue;
      m[s.uuid]={ pegel, wt, o2:sh.includes("O2"), tr:sh.some(x=>x==="TR"||x.indexOf("TRUEB")===0||x==="TB") };
    }
    PO_PARAMS=m;
  }catch(e){ PO_PARAMS={}; }
  PO_LOADING=false;
}
/* Farblogik fuer einzelne Altanzeigen; die Karte selbst nutzt Kuchen-Segmente. */
function paramColor(p){ if(!p||!p.wt) return null; if(p.o2&&p.tr) return "#8a5a2b"; if(p.o2) return "#3b82f6"; return "#e0483b"; }
function guteParams(st){ const L=(st.items||[]).map(i=>String(i.label||"").toLowerCase()),p=st.params||{};
  return { pegel:!!p.pegel||L.some(l=>l.includes("pegel")||l.includes("wasserstand")||l.includes("durchfluss")),
    wt:!!p.wt||L.some(l=>l.includes("wassertemperatur")),
    o2:!!p.o2||L.some(l=>l.includes("sauerstoff")||l.includes("o₂")),
    tr:!!p.tr||L.some(l=>l.includes("trübung")||l.includes("truebung")||l.includes("schwebstoff")) }; }
function initMap(){
  if(MAP || !window.L || !document.getElementById("map")) return;
  MAP = L.map("map",{scrollWheelZoom:false}).setView([WXPOS.lat, WXPOS.lon], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(MAP);
  STATIONS_LAYER=L.layerGroup(); SPOTS_LAYER=L.layerGroup();
  addStationDots(); addSpotMarkers();
  if(STATIONS_VISIBLE) STATIONS_LAYER.addTo(MAP);
  if(SPOTS_VISIBLE) SPOTS_LAYER.addTo(MAP);
  MAP.createPane("selectionPane");
  MAP.getPane("selectionPane").style.zIndex="690";
  MAP.getPane("selectionPane").style.pointerEvents="none";
  CATCH_LAYER=L.layerGroup().addTo(MAP);
  let stationRedrawTimer=null;
  MAP.on("moveend", ()=>{
    clearTimeout(stationRedrawTimer);
    stationRedrawTimer=setTimeout(addStationDots,70);
  });
  MAP.on("click", e=>{
    if(STATION_PICK){
      STATION_PICK=false; const hb=$("markHint"); if(hb) hb.style.display="none";
      const st=nearestStation(e.latlng.lat, e.latlng.lng);
      const sp=activeSpot();
      if(sp){ assignStationToSpot(sp.id, st.uuid); }
      else { activateStationFor(st.uuid); reflectStation(); updateStationMarker(); loadAll(); }
      return;
    }
    if(SPOT_PICK){
      SPOT_PICK=false; const hb=$("markHint"); if(hb) hb.style.display="none";
      createSpotAt(e.latlng.lat, e.latlng.lng); return;
    }
    if(MARKING){ setProvFangort(e.latlng.lat, e.latlng.lng); }
  });
  updateLayerBtns();
  renderMarkers();
}
/* Kuchen-Symbol: gleich große Segmente je vorhandenem Parameter.
   Reihenfolge/Farben: grau=Pegel, rot=Temperatur, blau=Sauerstoff, braun=Trübung/Schwebstoff. */
const SEG_DEF=[["pegel","#9aa3ab","Pegel"],["wt","#e0483b","Temperatur"],["o2","#3b82f6","Sauerstoff"],["tr","#8a5a2b","Trübung/Schwebstoff"]];
function segList(p){ return SEG_DEF.filter(d=>p&&p[d[0]]); }
function pieIcon(segs, r){
  r=r||7; const pad=2, c=r+pad, size=c*2, n=segs.length;
  let inner="";
  if(n<=1){ const col=n?segs[0][1]:"#9aa3ab";
    inner='<circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="'+col+'" stroke="#fff" stroke-width="1"/>'; }
  else { for(let i=0;i<n;i++){
      const a0=(i/n)*2*Math.PI - Math.PI/2, a1=((i+1)/n)*2*Math.PI - Math.PI/2;
      const x0=(c+r*Math.cos(a0)).toFixed(2), y0=(c+r*Math.sin(a0)).toFixed(2);
      const x1=(c+r*Math.cos(a1)).toFixed(2), y1=(c+r*Math.sin(a1)).toFixed(2);
      const large=(a1-a0)>Math.PI?1:0;
      inner+='<path d="M'+c+','+c+' L'+x0+','+y0+' A'+r+','+r+' 0 '+large+' 1 '+x1+','+y1+' Z" fill="'+segs[i][1]+'" stroke="#fff" stroke-width="0.8"/>';
    }
    inner+='<circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="none" stroke="#fff" stroke-width="1"/>';
  }
  const svg='<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'" xmlns="http://www.w3.org/2000/svg">'+inner+'</svg>';
  return L.divIcon({className:"pie-ic", html:svg, iconSize:[size,size], iconAnchor:[c,c]});
}
function stationClusterIcon(count,segs){
  const size=count>=100?52:(count>=20?46:40), n=Math.max(1,segs.length);
  const stops=segs.length ? segs.map((d,i)=>d[1]+" "+((i/n)*360)+"deg "+(((i+1)/n)*360)+"deg").join(",") : "#9aa3ab 0deg 360deg";
  const html='<div class="sensor-cluster" style="--cluster-size:'+size+'px;--cluster-ring:conic-gradient('+stops+')"><span>'+count+'</span></div>';
  return L.divIcon({className:"sensor-cluster-wrap",html,iconSize:[size,size],iconAnchor:[size/2,size/2]});
}
function clusterStationList(list){
  if(!MAP) return list;
  const zoom=MAP.getZoom()||6;
  if(zoom>=11 || list.length<2) return list;
  const cell=zoom<=6?86:(zoom<=8?70:54), buckets=new Map();
  for(const o of list){
    const p=MAP.project([o.s.lat,o.s.lon],zoom);
    const key=Math.floor(p.x/cell)+":"+Math.floor(p.y/cell);
    if(!buckets.has(key)) buckets.set(key,[]);
    buckets.get(key).push(o);
  }
  const out=[];
  for(const group of buckets.values()){
    if(group.length===1){ out.push(group[0]); continue; }
    const keys=new Set(), segs=[];
    let lat=0,lon=0;
    for(const o of group){
      lat+=+o.s.lat; lon+=+o.s.lon;
      for(const seg of o.segs){ if(!keys.has(seg[0])){ keys.add(seg[0]); segs.push(seg); } }
    }
    segs.sort((a,b)=>SEG_DEF.findIndex(x=>x[0]===a[0])-SEG_DEF.findIndex(x=>x[0]===b[0]));
    out.push({cluster:true,count:group.length,lat:lat/group.length,lon:lon/group.length,segs});
  }
  return out;
}
function addStationDots(){
  if(!STATIONS_LAYER) return;
  STATIONS_LAYER.clearLayers();
  if(!STATIONS_VISIBLE) return;
  // Alle Punkte einsammeln: PEGELONLINE (mit grauem Pegel-Segment) + Güte/NIZ-Stationen
  const pts=[];
  for(const s of STATIONS){ const p=PO_PARAMS&&PO_PARAMS[s.uuid]; if(!p) continue;
    pts.push({lat:s.lat, lon:s.lon, name:s.name, river:s.river, r:5, p}); }
  const gu=(window.WQ&&window.WQ.stations)||[];
  for(const s of gu){ if(s.lat==null) continue; const g=guteParams(s);
    pts.push({lat:s.lat, lon:s.lon, name:s.name, river:s.river, id:s.id, source_url:s.source_url||"", r:6,
      p:{pegel:g.pegel,wt:g.wt,o2:g.o2,tr:g.tr}, guete:true}); }
  // Messnetze am selben Ort zusammenfassen. Andernfalls verdecken sich z. B.
  // in Ingolstadt der graue PEGELONLINE- und der GKD/NID-Gütepunkt.
  { const merged=[];
    const norm=x=>String(x||"").toLowerCase().replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss").replace(/[^a-z0-9]/g,"");
    for(const s of pts){
      const nr=norm(s.river);
      const hit=merged.find(x=>nr&&norm(x.river)===nr&&haversine(s.lat,s.lon,x.lat,x.lon)<2);
      if(!hit){ merged.push(s); continue; }
      hit.p={pegel:!!(hit.p.pegel||s.p.pegel),wt:!!(hit.p.wt||s.p.wt),o2:!!(hit.p.o2||s.p.o2),tr:!!(hit.p.tr||s.p.tr)};
      hit.guete=hit.guete||s.guete; hit.r=Math.max(hit.r||5,s.r||5);
      if(s.guete){ hit.name=s.name; hit.id=s.id; hit.lat=s.lat; hit.lon=s.lon; hit.source_url=s.source_url||hit.source_url||""; }
    }
    pts.length=0; pts.push(...merged);
  }
  let list=pts.map(s=>({s, segs:segList(s.p)})).filter(o=>o.segs.length>0);
  // Filter: sichtbarer Ausschnitt + optional nur Stationen mit >= 2 Werten
  try{ if(MAP){ const b=MAP.getBounds().pad(.15); list=list.filter(o=>b.contains([o.s.lat,o.s.lon])); } }catch(e){}
  if(STATION_MINWERTE) list=list.filter(o=>o.segs.length>=2);
  // Deutschlandweit sind inzwischen deutlich mehr als 500 Pegel- und Gütepunkte
  // vorhanden. Der alte 500er-Schnitt ließ vor allem später geladene Landesnetze weg.
  if(list.length>2500) list=list.slice(0,2500);
  list=clusterStationList(list);
  for(const o of list){
    if(o.cluster){
      const mk=L.marker([o.lat,o.lon],{icon:stationClusterIcon(o.count,o.segs),keyboard:true});
      mk.bindTooltip(o.count+" Messstationen · antippen zum Vergrößern");
      mk.on("click",()=>MAP.setView([o.lat,o.lon],Math.min((MAP.getZoom()||6)+2,12)));
      STATIONS_LAYER.addLayer(mk);
      continue;
    }
    const names=o.segs.map(d=>d[2]).join("+");
    const mk=L.marker([o.s.lat,o.s.lon],{icon:pieIcon(o.segs, o.s.r)});
    mk.bindTooltip((o.s.guete?"Gütestation ":"Pegel ")+o.s.name+" · "+(o.s.river||"")+" · "+names);
    if(o.s.source_url) mk.bindPopup('<b>'+esc(o.s.name)+'</b><br>'+esc(o.s.river||"")+'<br>'+esc(names)+
      '<br><a href="'+esc(o.s.source_url)+'" target="_blank" rel="noopener">Amtliche Messstation öffnen '+uiIcon('external')+'</a>');
    STATIONS_LAYER.addLayer(mk);
  }
}
function toggleStationMode(){
  STATION_MINWERTE=!STATION_MINWERTE; updateLayerBtns();
  if(STATIONS_VISIBLE) addStationDots();
}
function spotLatLon(sp){
  if(sp.lat!=null && sp.lon!=null) return [sp.lat, sp.lon];
  const st=STATIONS.find(x=>x.uuid===sp.uuid); return st?[st.lat,st.lon]:[CUR.lat,CUR.lon];
}
function spotMapColor(levelClass){
  if(levelClass==="lg-green") return "#30d158";
  if(levelClass==="lg-red") return "#f87171";
  return "#fbbf24";
}
function spotMapIcon(levelClass){
  const color=spotMapColor(levelClass);
  return L.divIcon({className:"spot-ic condition-"+(levelClass||"lg-amber"),
    html:'<svg width="30" height="34" viewBox="0 0 24 28" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 26S21 18.3 21 10.5a9 9 0 1 0-18 0C3 18.3 12 26 12 26Z" fill="'+color+'" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="10.5" r="3" fill="#071018" stroke="#fff" stroke-width="1.4"/></svg>',
    iconSize:[30,34], iconAnchor:[15,34]});
}
function addSpotMarkers(){
  if(!SPOTS_LAYER || !window.L) return;
  SPOTS_LAYER.clearLayers();
  for(const sp of loadSpots()){
    const ll=spotLatLon(sp);
    const mk=L.marker(ll,{icon:spotMapIcon("lg-amber")}).bindTooltip(uiIcon('pin')+' '+esc(sp.name));
    mk.on("click", ()=>openSpot(sp.id));
    SPOTS_LAYER.addLayer(mk);
    if(typeof spotCondition==="function") spotCondition(sp).then(c=>{
      if(SPOTS_LAYER&&SPOTS_LAYER.hasLayer(mk)){
        mk.setIcon(spotMapIcon(c.lvl.cls));
        mk.setTooltipContent(uiIcon('pin')+' '+esc(sp.name)+' · '+esc(c.lvl.word));
      }
    }).catch(()=>{});
  }
}
function toggleStationsLayer(){
  STATIONS_VISIBLE=!STATIONS_VISIBLE; updateLayerBtns();
  if(!MAP || !STATIONS_LAYER) return;
  if(STATIONS_VISIBLE){
    const a=$("layStations"); setIconLabel(a,"gauge","lädt …");
    ensureStationParams().then(()=>{
      // In der Länderübersicht Deutschland plus AT/CH/NL gemeinsam zeigen.
      try{
        const home=$("homeView");
        if(home && home.style.display!=="none" && (MAP.getZoom()||6)<=7)
          MAP.fitBounds([[45.6,3.0],[55.7,17.4]],{padding:[24,24],maxZoom:7});
      }catch(e){}
      addStationDots(); STATIONS_LAYER.addTo(MAP); updateLayerBtns();
    });
  } else { STATIONS_LAYER.remove(); }
}
function toggleSpotsLayer(){ SPOTS_VISIBLE=!SPOTS_VISIBLE; if(MAP&&SPOTS_LAYER){ if(SPOTS_VISIBLE) SPOTS_LAYER.addTo(MAP); else SPOTS_LAYER.remove(); } updateLayerBtns(); }
function updateLayerBtns(){ const a=$("layStations"), b=$("laySpots"), m=$("layMode");
  setIconLabel(a,"gauge","Stationen"); setIconLabel(b,"pin","Angelplätze");
  if(a) a.classList.toggle("active",STATIONS_VISIBLE); if(b) b.classList.toggle("active",SPOTS_VISIBLE);
  if(m){ m.textContent=STATION_MINWERTE?"≥2 Werte":"alle"; m.style.display=STATIONS_VISIBLE?"":"none"; } }
function setSelectedLocation(lat, lon, acc, pan){
  CURRENT_GPS={ lat:+(+lat).toFixed(6), lon:+(+lon).toFixed(6), genauigkeit_m: (acc==null? null : Math.round(acc)) };
  if(MAP && window.L){
    if(!SELECT_MARKER){
      SELECT_MARKER=L.circleMarker([lat,lon],{pane:"selectionPane",radius:10,color:"#fff",weight:3,fillColor:"#fbbf24",fillOpacity:.9}).addTo(MAP);
      SELECT_MARKER.bindPopup("Gewählter Fangort");
    } else SELECT_MARKER.setLatLng([lat,lon]);
    if(SELECT_MARKER.bringToFront) SELECT_MARKER.bringToFront();
    if(pan){ try{ MAP.setView([lat,lon], Math.max(MAP.getZoom()||13, 15)); }catch(e){} }
  }
  const extra = CURRENT_GPS.genauigkeit_m!=null ? " (Handy, ±"+CURRENT_GPS.genauigkeit_m+" m)" : " (auf Karte gewählt)";
  const gi=$("gpsInfo");
  if(gi) gi.innerHTML=uiIcon('pin')+' Fangort: '+CURRENT_GPS.lat+', '+CURRENT_GPS.lon+extra+
    ' · <a href="#" onclick="clearSelectedLocation();return false;">entfernen</a>';
}
function clearSelectedLocation(){
  CURRENT_GPS=null; MARKING=false; removeProv();
  if(SELECT_MARKER && MAP){ MAP.removeLayer(SELECT_MARKER); SELECT_MARKER=null; }
  const gi=$("gpsInfo"); if(gi) gi.textContent="Kein Standort gewählt – nutze die Handy-Ortung oder „Auf Karte markieren\".";
  setIconLabel($("gpsBtn"),"pin","Handy-Standort");
  const hb=$("markHint"); if(hb) hb.style.display="none";
}
function renderMarkers(){
  if(!CATCH_LAYER) return;
  CATCH_LAYER.clearLayers();
  const cs=catchesForView().filter(c=>c.gps&&c.gps.lat!=null);
  cs.forEach(c=>{
    const wa=c.wasser||{};
    const html='<b>'+esc(c.fischart||"Fang")+'</b>'+(c.groesse_cm?' · '+c.groesse_cm+' cm':'')+
      '<br>'+esc(c.datum||"")+' '+esc(c.uhrzeit||"")+(c.angelplatz?'<br>Platz: '+esc(c.angelplatz):'')+(c.koeder?'<br>Köder: '+esc(c.koeder):'')+
      (wa.pegelstand_cm!=null?'<br>Pegel: '+wa.pegelstand_cm+' cm':'')+
      (wa.wassertemperatur_c!=null?'<br>Wasser: '+wa.wassertemperatur_c+' °C':'');
    L.circleMarker([c.gps.lat,c.gps.lon],{radius:6,color:"#4ade80",weight:2,fillColor:"#4ade80",fillOpacity:.85})
      .bindPopup(html).addTo(CATCH_LAYER);
  });
  if(cs.length){ try{ MAP.fitBounds(L.featureGroup(CATCH_LAYER.getLayers()).getBounds().pad(0.3)); }catch(e){} }
}
function clearCatchMarkers(){ if(CATCH_LAYER) CATCH_LAYER.clearLayers(); }

let MARKING=false, PROV=null, PROV_MARKER=null;
function markOnMap(){
  MARKING=true; removeProv();
  if(!MAP) initMap();
  const hb=$("markHint"); if(hb){ hb.innerHTML=uiIcon('target')+" Tippe auf die Karte an die Stelle deines Fangs."; hb.style.display="block"; }
  const m=document.getElementById("map"); if(m) m.scrollIntoView({behavior:"smooth", block:"center"});
}
function setProvFangort(lat, lon){                 // erst provisorisch – muss bestätigt werden
  PROV={ lat:+(+lat).toFixed(6), lon:+(+lon).toFixed(6) };
  if(MAP && window.L){
    if(!PROV_MARKER){ PROV_MARKER=L.circleMarker([lat,lon],{pane:"selectionPane",radius:12,color:"#fff",weight:3,fillColor:"#fbbf24",fillOpacity:.82}).addTo(MAP); }
    else PROV_MARKER.setLatLng([lat,lon]);
    if(PROV_MARKER.bringToFront) PROV_MARKER.bringToFront();
  }
  const hb=$("markHint");
  if(hb){ hb.innerHTML=uiIcon('pin')+' Fangort hier setzen? <button class="mhbtn" onclick="confirmFangort()">'+uiIcon('check')+' Bestätigen</button><button class="mhbtn sec" onclick="cancelFangort()">'+uiIcon('close')+' Abbrechen</button>'; hb.style.display="block"; }
}
function removeProv(){ if(PROV_MARKER && MAP){ try{ MAP.removeLayer(PROV_MARKER); }catch(e){} } PROV_MARKER=null; PROV=null; }
function confirmFangort(){
  if(!PROV) return;
  setSelectedLocation(PROV.lat, PROV.lon, null, false);
  removeProv();
  const hb=$("markHint");
  if(hb){ hb.innerHTML=uiIcon('check')+' Fangort gesetzt · für einen weiteren Ort erneut tippen · <a href="#" onclick="scrollToSave();return false;">Fang speichern</a> · <a href="#" onclick="stopMarking();return false;">fertig</a>'; hb.style.display="block"; }
  // MARKING bleibt aktiv – der nächste Fangort kann direkt markiert werden
}
function cancelFangort(){ removeProv(); const hb=$("markHint"); if(hb){ hb.innerHTML=uiIcon('target')+' Tippe auf die Karte an die Stelle deines Fangs.'; hb.style.display="block"; } }
function stopMarking(){ MARKING=false; removeProv(); const hb=$("markHint"); if(hb) hb.style.display="none"; }
function scrollToSave(){ const b=document.getElementById("fbSaveBtn"); if(b) b.scrollIntoView({behavior:"smooth", block:"center"}); }
function centerOnActiveSpot(){
  if(!MAP) return;
  const sp=activeSpot(); const ll = sp ? spotLatLon(sp) : [WXPOS.lat, WXPOS.lon];
  try{ MAP.setView(ll, Math.max(MAP.getZoom()||13, 13)); }catch(e){}
}
function mountMapCard(hostId,isHome){
  const host=$(hostId), card=$("mapCard"), add=$("mapAddSpot");
  if(host&&card&&card.parentElement!==host) host.appendChild(card);
  if(card) card.classList.toggle("home-map-card",!!isHome);
  if(add) add.style.display=isHome?"inline-flex":"none";
}
function centerHomeMap(){
  if(!MAP) return;
  const points=loadSpots().map(spotLatLon).filter(x=>x&&isFinite(x[0])&&isFinite(x[1]));
  try{
    if(points.length>1) MAP.fitBounds(points,{padding:[34,34],maxZoom:13});
    else if(points.length===1) MAP.setView(points[0],13);
    else MAP.fitBounds([[45.6,3.0],[55.7,17.4]],{padding:[24,24],maxZoom:7});
  }catch(e){}
}
function renderTable(){
  const box=$("fbTable"); if(!box) return;
  const arr=catchesForView().sort((a,b)=>((b.datum||"")+(b.uhrzeit||"")).localeCompare((a.datum||"")+(a.uhrzeit||"")));
  if(!arr.length){ box.innerHTML='<div class="fbnote" style="padding:8px 4px">Noch keine Fänge.</div>'; return; }
  const rows=arr.map(c=>{
    const ort = c.gps ? (c.gps.lat+', '+c.gps.lon) : esc(c.gewaesser||"");
    return '<tr><td>'+esc(c.datum||"")+'</td><td>'+esc(c.uhrzeit||"")+'</td><td>'+(c.kein_fang?"— (kein Fang)":esc(c.fischart||""))+'</td>'+
      '<td>'+(c.groesse_cm!=null?c.groesse_cm:"")+'</td><td>'+(c.gewicht_kg!=null?c.gewicht_kg:(c.gewicht_g!=null?(c.gewicht_g/1000):""))+'</td>'+
      '<td>'+esc(c.koeder||"")+'</td><td>'+esc(c.angelplatz||"")+'</td><td>'+ort+'</td></tr>';
  }).join("");
  box.innerHTML='<div class="fbwrap"><table class="fbtable"><thead><tr>'+
    '<th>Datum</th><th>Zeit</th><th>Fischart</th><th>cm</th><th>kg</th><th>Köder</th><th>Angelplatz</th><th>Ort</th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table></div>';
}
function toggleTable(){
  const box=$("fbTable"), b=$("tblBtn"); if(!box) return;
  const show=(box.style.display==="none" || !box.style.display);
  if(show){ renderTable(); box.style.display="block"; setIconLabel(b,"table","Tabelle ausblenden"); }
  else { box.style.display="none"; setIconLabel(b,"table","Tabelle anzeigen"); }
}
function toggleList(){
  const box=$("fbList"), b=$("listBtn"); if(!box) return;
  const show=(box.style.display==="none" || !box.style.display);
  box.style.display = show ? "block" : "none";
  if(b) b.textContent = show ? "Fänge ausblenden" : "Fänge anzeigen";
}
function refreshFangbuch(){
  renderCatches(); renderMarkers();
  if($("fbTable") && $("fbTable").style.display==="block") renderTable();
  if($("catchListView") && $("catchListView").style.display!=="none") renderCatchList();
  if($("fbIndexView") && $("fbIndexView").style.display!=="none") renderFbIndex();
  if($("homeView") && $("homeView").style.display!=="none") renderSpotList();
  if($("statsView") && $("statsView").style.display!=="none") renderStats();
}

/* Gesetzliche Basiswerte. Gewässerordnungen/Erlaubnisscheine können strengere
   Regeln enthalten. Bayern und NRW sind aus den amtlichen Landesvorschriften
   hinterlegt; bei anderen Ländern wird bewusst keine Zahl geraten. */
const FISH_RULES=window.FISH_RULES||{};
function fishKey(s){
  const key=String(s||"").toLowerCase().trim().replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss").replace(/[^a-z]/g,"");
  const aliases={forelle:"bachforelle",flussforelle:"bachforelle",truesche:"quappe",rutte:"quappe",aalrutte:"quappe",
    aitel:"doebel",schied:"rapfen",blei:"brassen",brachse:"brassen",flussbarsch:"barsch",paling:"aal",
    snoek:"hecht",snoekbaars:"zander",baars:"barsch",alet:"doebel",felchen:"renke"};
  return aliases[key]||key;
}
function countryRuleKey(code){ return code==="ch"?"Schweiz":code==="nl"?"Niederlande":""; }
async function resolveSpotRegion(sp){
  if(!sp) return {key:"",label:"Standort nicht ermittelbar",country:""};
  if(sp.country_code){
    const ck=countryRuleKey(sp.country_code);
    return {key:FISH_RULES[sp.bundesland]?sp.bundesland:(ck||sp.bundesland||""),label:sp.bundesland||ck||sp.country_code,country:sp.country_code};
  }
  const ll=spotLatLon(sp);
  try{
    const u="https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=7&accept-language=de&lat="+encodeURIComponent(ll[0])+"&lon="+encodeURIComponent(ll[1]);
    const r=await fetch(u); if(!r.ok) throw new Error("Geokodierung"); const j=await r.json(), a=j.address||{};
    const state=a.state||a.region||a.province||"", code=String(a.country_code||"").toLowerCase(), ck=countryRuleKey(code);
    const list=loadSpots(), x=list.find(s=>String(s.id)===String(sp.id));
    if(x){ x.bundesland=state; x.country_code=code; x.land=a.country||""; saveSpots(list); }
    return {key:FISH_RULES[state]?state:(ck||state),label:state||ck||a.country||"Standort",country:code};
  }catch(e){
    const state=sp.bundesland||"", ck=countryRuleKey(sp.country_code||"");
    return {key:FISH_RULES[state]?state:(ck||state),label:state||ck||"Standort nicht ermittelbar",country:sp.country_code||""};
  }
}
let RULE_REQ=0;
async function showFishRules(){
  const box=$("fishRules"); if(!box) return; const art=$("f_art")?$("f_art").value.trim():"";
  if(!art){ box.style.display="none"; box.innerHTML=""; return; }
  const req=++RULE_REQ, sp=activeSpot(); box.style.display="block"; box.textContent="Bestimmungen am Angelplatz werden ermittelt …";
  const region=await resolveSpotRegion(sp); if(req!==RULE_REQ) return;
  const data=FISH_RULES[region.key], rule=data&&data.rules[fishKey(art)];
  const caution='<small> Erlaubnisschein, Gewässerordnung und örtliche Verfügungen können strengere oder abweichende Regeln enthalten.</small>';
  if(rule){
    const extra=rule[2]?'<br><small>'+esc(rule[2])+'</small>':'';
    box.innerHTML='<b>'+esc(region.label)+' · '+esc(art)+'</b><br>Mindestmaß: <b>'+esc(rule[0])+'</b> · Schonzeit: <b>'+esc(rule[1])+'</b>'+extra+(data.note?'<br><small>'+esc(data.note)+'</small>':'')+'<br>'+caution;
  } else if(data){
    box.innerHTML='<b>'+esc(region.label)+' · '+esc(art)+'</b><br>Diese Fischbezeichnung ist in der eingebetteten allgemeinen Tabelle nicht eindeutig aufgeführt.'+(data.note?'<br><small>'+esc(data.note)+'</small>':'')+'<br>'+caution;
  } else {
    box.innerHTML='<b>'+esc(region.label)+' · '+esc(art)+'</b><br>Für diesen Standort ist noch keine allgemeine Regel eindeutig hinterlegt.<br>'+caution;
  }
}

function initFangbuch(){
  const now=new Date(), pad=n=>String(n).padStart(2,'0');
  if($("f_datum")) $("f_datum").value = now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
  if($("f_zeit")) $("f_zeit").value = pad(now.getHours())+':'+pad(now.getMinutes());
  populateCatchSpots();
  updateFangbuchBtn();
  renderBaitList();
  refreshFangbuch();
  initMap();
}
