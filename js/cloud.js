"use strict";

/**
 * PetriKlar · cloud.js
 * Supabase-Anmeldung, Cloud-State, Migration und Synchronisation.
 * Lade-Reihenfolge und Abhängigkeiten: docs/ARCHITEKTUR.md
 */
/* ===================== Supabase-Konto & reine Cloud-Speicherung ===================== */
const SUPABASE_URL="https://mcekltbtndpzjahwypze.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_emw-cBuOXFMFgtpvKeqf9A_Rvko2T4P";
let SUPA=null, CLOUD_USER=null, CLOUD_READY=false, CLOUD_APPLYING=false, CLOUD_TIMER=null, AUTH_RECOVERY=false;
let CLOUD_DIRTY=false, CLOUD_LAST_REMOTE_AT="", CLOUD_DATA_LOADED=false, CLOUD_RECONNECTING=false, APP_STARTED=false;
let APP_STATE={version:4,spots:[],catches:[],baits:[],baits_initialized:false,trips:[],active_trip:null,active_spot_id:null,report_prefs:{last_water_name:""},ui_prefs:{onboarding_done:false}};

function emptyAppState(){
  return {version:4,spots:[],catches:[],baits:[],baits_initialized:false,trips:[],active_trip:null,active_spot_id:null,report_prefs:{last_water_name:""},ui_prefs:{onboarding_done:false}};
}
/* Einmalige Übernahme aus älteren App-Versionen. Nach erfolgreichem
   Cloud-Upload werden sämtliche alten LocalStorage-Schlüssel gelöscht. */
const LEGACY_STORAGE_KEYS=["rheincheck_spots_v1","rheincheck_activespot_v1","rheincheck_faenge_v1",
  "deepfish_koeder_v1","deepfish_koeder_init_v1","deepfish_trips_v2","deepfish_active_trip_v2",
  "deepfish_cloud_dirty_v1","deepfish_cloud_seen_v1"];
function legacyJSON(key,fallback){
  try{ const raw=localStorage.getItem(key); return raw==null?fallback:JSON.parse(raw); }catch(e){ return fallback; }
}
function readLegacyState(){
  try{
    const spots=legacyJSON("rheincheck_spots_v1",[]), catches=legacyJSON("rheincheck_faenge_v1",[]),
      baits=legacyJSON("deepfish_koeder_v1",[]), trips=legacyJSON("deepfish_trips_v2",[]),
      activeTripOld=legacyJSON("deepfish_active_trip_v2",null), activeSpotOld=localStorage.getItem("rheincheck_activespot_v1");
    const has=[spots,catches,baits,trips].some(a=>Array.isArray(a)&&a.length)||!!activeTripOld;
    if(!has) return null;
    return {version:2,spots:Array.isArray(spots)?spots:[],catches:Array.isArray(catches)?catches:[],
      baits:Array.isArray(baits)?baits:[],baits_initialized:localStorage.getItem("deepfish_koeder_init_v1")==="1"||Array.isArray(baits),
      trips:Array.isArray(trips)?trips:[],active_trip:activeTripOld||null,active_spot_id:activeSpotOld||null};
  }catch(e){ return null; }
}
function mergeLegacyRows(remote,legacy,keyFn){
  const out=[], pos=new Map();
  [...(remote||[]),...(legacy||[])].forEach(x=>{ if(!x) return; const k=String(keyFn(x)); if(pos.has(k)) out[pos.get(k)]=x; else { pos.set(k,out.length); out.push(x); } });
  return out;
}
function mergeLegacyBaits(remote,legacy){
  const out=[];
  [...(remote||[]),...(legacy||[])].forEach(cat=>{
    if(!cat) return; const base=typeof cat==="string"?cat:String(cat.base||""); if(!base) return;
    let hit=out.find(x=>x.base.toLowerCase()===base.toLowerCase());
    if(!hit){ hit={base,group:cat.group||baitGroup(base),variants:[]}; out.push(hit); }
    (cat.variants||[]).forEach(v=>{ const k=String(v.size||"")+"|"+String(v.color||""); if(!hit.variants.some(x=>String(x.size||"")+"|"+String(x.color||"")===k)) hit.variants.push(v); });
  });
  return out;
}
function mergeLegacyState(remote,legacy){
  if(!legacy) return remote||emptyAppState(); remote=remote||emptyAppState();
  return {version:4,
    spots:mergeLegacyRows(remote.spots,legacy.spots,x=>x.id!=null?x.id:x.name),
    catches:mergeLegacyRows(remote.catches,legacy.catches,x=>x.id),
    baits:mergeLegacyBaits(remote.baits,legacy.baits),baits_initialized:!!(remote.baits_initialized||legacy.baits_initialized),
    trips:mergeLegacyRows(remote.trips,legacy.trips,x=>x.id),
    active_trip:legacy.active_trip||remote.active_trip||null,
    active_spot_id:legacy.active_spot_id!=null?legacy.active_spot_id:(remote.active_spot_id!=null?remote.active_spot_id:null),
    report_prefs:remote.report_prefs&&typeof remote.report_prefs==="object"?remote.report_prefs:{last_water_name:""},
    ui_prefs:remote.ui_prefs&&typeof remote.ui_prefs==="object"?remote.ui_prefs:{onboarding_done:false}};
}
function clearLegacyState(){ try{ LEGACY_STORAGE_KEYS.forEach(k=>localStorage.removeItem(k)); }catch(e){} }
function setCloudStatus(text,state){
  const el=$("cloudStatus"); if(!el) return; el.textContent=text||""; el.className="cloud-status "+(state||"");
}
function authMessage(text,isError){
  const el=$("authMessage"); if(!el) return;
  el.textContent=text||""; el.style.display=text?"block":"none"; el.className="auth-message"+(isError?" error":"");
}
function renderAccountUI(){
  const b=$("accountBtn");
  if(b) b.innerHTML=CLOUD_USER?uiIcon("cloud-sync")+" "+hesc(CLOUD_USER.email||"Konto"):uiIcon("user")+" Anmelden";
  const out=$("authLoggedOut"), inn=$("authLoggedIn"), rec=$("authRecovery"), mail=$("authUserEmail");
  if(out) out.style.display=(!CLOUD_USER&&!AUTH_RECOVERY)?"block":"none";
  if(inn) inn.style.display=(CLOUD_USER&&!AUTH_RECOVERY)?"block":"none";
  if(rec) rec.style.display=AUTH_RECOVERY?"block":"none";
  if(mail) mail.textContent=CLOUD_USER?CLOUD_USER.email||"–":"–";
  const locked=!CLOUD_USER||AUTH_RECOVERY||!CLOUD_DATA_LOADED;
  document.body.classList.toggle("auth-locked",locked);
  const gate=$("authGate"); if(gate) gate.setAttribute("aria-hidden",locked?"false":"true");
  if(!CLOUD_USER) setCloudStatus("Anmeldung erforderlich","");
  else if(!CLOUD_DATA_LOADED) setCloudStatus(navigator.onLine?"Lade Cloud-Daten …":"Offline – Cloud-Daten gesperrt",navigator.onLine?"syncing":"error");
}
function openAuthModal(){
  authMessage(""); renderAccountUI();
  if(!CLOUD_USER){ const e=$("authEmail"); if(e) setTimeout(()=>e.focus(),30); return; }
  const m=$("authModal"); if(m) m.style.display="flex";
}
function closeAuthModal(){ const m=$("authModal"); if(m) m.style.display="none"; authMessage(""); }

function cloudPayload(){
  return {version:4,spots:loadSpots(),catches:loadCatches(),baits:loadBaits(),baits_initialized:!!APP_STATE.baits_initialized,
    trips:loadTrips(),active_trip:activeTrip(),active_spot_id:getActiveSpotId(),
    report_prefs:APP_STATE.report_prefs&&typeof APP_STATE.report_prefs==="object"?APP_STATE.report_prefs:{last_water_name:""},
    ui_prefs:APP_STATE.ui_prefs&&typeof APP_STATE.ui_prefs==="object"?APP_STATE.ui_prefs:{onboarding_done:false}};
}
function applyCloudPayload(p){
  p=p||{}; CLOUD_APPLYING=true;
  try{
    APP_STATE={version:4,
      spots:Array.isArray(p.spots)?p.spots:[], catches:Array.isArray(p.catches)?p.catches:[],
      baits:Array.isArray(p.baits)?p.baits:[], baits_initialized:p.baits_initialized!=null?!!p.baits_initialized:Array.isArray(p.baits),
      trips:Array.isArray(p.trips)?p.trips:[], active_trip:p.active_trip||null,
      active_spot_id:p.active_spot_id!=null?p.active_spot_id:null,
      report_prefs:p.report_prefs&&typeof p.report_prefs==="object"?p.report_prefs:{last_water_name:""},
      ui_prefs:p.ui_prefs&&typeof p.ui_prefs==="object"?p.ui_prefs:{onboarding_done:false}};
    const valid=APP_STATE.spots.some(s=>String(s.id)===String(APP_STATE.active_spot_id));
    if(!valid) APP_STATE.active_spot_id=APP_STATE.spots[0]?APP_STATE.spots[0].id:null;
  } finally { CLOUD_APPLYING=false; }
  try{ ensureBaitSeed(); renderSpots(); populateCatchSpots(); populateKoeder(); renderBaitList(); refreshFangbuch(); renderFavorites(); renderActiveTrip(); }catch(e){}
}
function markCloudDirty(){
  if(CLOUD_APPLYING) return;
  if(!CLOUD_DATA_LOADED){ setCloudStatus("Cloud-Daten sind noch nicht geladen","error"); return; }
  CLOUD_DIRTY=true;
  if(CLOUD_READY&&CLOUD_USER){ clearTimeout(CLOUD_TIMER); CLOUD_TIMER=setTimeout(()=>syncCloudNow(false),1200); }
  setCloudStatus("Speichert …","syncing");
}
async function syncCloudNow(force){
  if(!SUPA||!CLOUD_USER||!CLOUD_DATA_LOADED) return false;
  if(!force&&!CLOUD_DIRTY) return true;
  setCloudStatus("Speichert in der Cloud …","syncing");
  const now=new Date().toISOString(), payload=cloudPayload();
  const {data,error}=await SUPA.from("app_state").upsert({user_id:CLOUD_USER.id,data:payload,revision:Date.now(),updated_at:now},{onConflict:"user_id"}).select("updated_at").single();
  if(error){ setCloudStatus("Speichern fehlgeschlagen","error"); authMessage("Cloud-Speicherung fehlgeschlagen: "+error.message,true); return false; }
  CLOUD_DIRTY=false; CLOUD_LAST_REMOTE_AT=(data&&data.updated_at)||now;
  setCloudStatus("In der Cloud gespeichert","ok"); return true;
}
async function pullCloudState(){
  if(!SUPA||!CLOUD_USER) return false;
  setCloudStatus("Lade Cloud-Daten …","syncing");
  const {data:row,error}=await SUPA.from("app_state").select("data,updated_at,revision").eq("user_id",CLOUD_USER.id).maybeSingle();
  if(error){ CLOUD_DATA_LOADED=false; setCloudStatus("Cloud nicht erreichbar","error"); authMessage("Cloud-Daten konnten nicht geladen werden. Deine persönlichen Daten werden aus Sicherheitsgründen nicht offline geöffnet. Sobald du wieder online bist, versucht PetriKlar es erneut.",true); return false; }
  CLOUD_DIRTY=false; const legacy=readLegacyState();
  CLOUD_DATA_LOADED=true;
  if(legacy){
    applyCloudPayload(mergeLegacyState(row&&row.data,legacy)); CLOUD_DIRTY=true;
    if(await syncCloudNow(true)) clearLegacyState();
  } else if(!row){ applyCloudPayload(emptyAppState()); CLOUD_DIRTY=true; await syncCloudNow(true); }
  else { applyCloudPayload(row.data||emptyAppState()); CLOUD_LAST_REMOTE_AT=row.updated_at||""; setCloudStatus("In der Cloud gespeichert","ok"); }
  return true;
}
async function handleCloudSession(session){
  const nextUser=session&&session.user?session.user:null;
  const sameUser=!!(CLOUD_USER&&nextUser&&String(CLOUD_USER.id)===String(nextUser.id));
  if(sameUser&&CLOUD_DATA_LOADED&&!AUTH_RECOVERY){ CLOUD_USER=nextUser; CLOUD_READY=true; renderAccountUI(); return; }
  if(!sameUser) CLOUD_DATA_LOADED=false;
  CLOUD_USER=nextUser; CLOUD_READY=true; renderAccountUI();
  if(CLOUD_USER){
    const loaded=await pullCloudState(); renderAccountUI();
    if(loaded) await startAppAfterLogin();
  } else { APP_STATE=emptyAppState(); CLOUD_DIRTY=false; CLOUD_DATA_LOADED=false; ONBOARDING_OPENED=false; renderAccountUI(); }
}
async function resumeCloudAfterReconnect(){
  if(CLOUD_RECONNECTING||!SUPA||!CLOUD_USER||CLOUD_DATA_LOADED||!navigator.onLine) return;
  CLOUD_RECONNECTING=true;
  try{
    const loaded=await pullCloudState(); renderAccountUI();
    if(loaded) await startAppAfterLogin();
  } finally { CLOUD_RECONNECTING=false; }
}
async function initCloud(){
  if(!window.supabase||!window.supabase.createClient){ setCloudStatus("Cloud-Modul nicht geladen","error"); authMessage("Die Anmeldung konnte nicht geladen werden. Bitte Seite neu laden.",true); return; }
  try{
    /* Nur die Anmeldesitzung bleibt dauerhaft im Browser. Fangbuch- und Platzdaten
       liegen weiterhin ausschließlich in Supabase. Auto-Refresh hält die Sitzung
       aktiv, solange keine serverseitige Inaktivitäts- oder Zeitbegrenzung greift. */
    SUPA=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,storage:window.localStorage,autoRefreshToken:true,detectSessionInUrl:true}});
    const {data}=await SUPA.auth.getSession(); await handleCloudSession(data&&data.session);
    SUPA.auth.onAuthStateChange((event,session)=>{
      if(event==="PASSWORD_RECOVERY"){ AUTH_RECOVERY=true; setTimeout(()=>handleCloudSession(session),0); }
      else setTimeout(()=>handleCloudSession(session),0);
    });
  }catch(e){ CLOUD_READY=false; setCloudStatus("Cloud nicht verfügbar","error"); authMessage("Die Cloud-Verbindung ist nicht verfügbar.",true); }
}
function authCredentials(){ return {email:($("authEmail")?$("authEmail").value.trim():""),password:($("authPassword")?$("authPassword").value:"")}; }
async function authSignIn(){
  if(!SUPA){ authMessage("Cloud-Verbindung wird noch geladen. Bitte kurz warten.",true); return; }
  const c=authCredentials(); if(!c.email||!c.password){ authMessage("Bitte E-Mail-Adresse und Passwort eingeben.",true); return; }
  authMessage("Anmeldung läuft …"); const {error}=await SUPA.auth.signInWithPassword(c);
  if(error) authMessage(error.message,true); else authMessage("Angemeldet. Deine Daten werden geladen.");
}
async function authSignUp(){
  if(!SUPA){ authMessage("Cloud-Verbindung wird noch geladen. Bitte kurz warten.",true); return; }
  const c=authCredentials(); if(!c.email||c.password.length<8){ authMessage("Bitte eine gültige E-Mail-Adresse und mindestens 8 Zeichen als Passwort eingeben.",true); return; }
  authMessage("Konto wird erstellt …");
  const redirectTo=location.origin+location.pathname, {data,error}=await SUPA.auth.signUp({email:c.email,password:c.password,options:{emailRedirectTo:redirectTo}});
  if(error) authMessage(error.message,true); else if(data&&data.session) authMessage("Konto erstellt und angemeldet."); else authMessage("Konto erstellt. Bitte bestätige die E-Mail über den Link in deinem Postfach.");
}
async function authResetPassword(){
  if(!SUPA){ authMessage("Cloud-Verbindung wird noch geladen. Bitte kurz warten.",true); return; }
  const email=$("authEmail")?$("authEmail").value.trim():""; if(!email){ authMessage("Bitte zuerst deine E-Mail-Adresse eingeben.",true); return; }
  const {error}=await SUPA.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
  authMessage(error?error.message:"E-Mail zum Zurücksetzen des Passworts wurde versendet.",!!error);
}
async function authUpdatePassword(){
  if(!SUPA){ authMessage("Cloud-Verbindung ist nicht verfügbar.",true); return; }
  const password=$("authNewPassword")?$("authNewPassword").value:""; if(password.length<8){ authMessage("Das neue Passwort muss mindestens 8 Zeichen haben.",true); return; }
  const {error}=await SUPA.auth.updateUser({password}); if(error) authMessage(error.message,true); else { AUTH_RECOVERY=false; renderAccountUI(); authMessage("Passwort wurde geändert."); }
}
async function authSignOut(){
  if(!SUPA) return;
  if(CLOUD_DATA_LOADED&&CLOUD_DIRTY){ const ok=await syncCloudNow(true); if(!ok) return; }
  await SUPA.auth.signOut(); CLOUD_USER=null; APP_STATE=emptyAppState(); CLOUD_DIRTY=false; CLOUD_DATA_LOADED=false; ONBOARDING_OPENED=false; renderAccountUI(); closeAuthModal();
}
async function manualCloudSync(){ const ok=await syncCloudNow(true); if(ok) setCloudStatus("In der Cloud gespeichert","ok"); }

function openDeleteAccountModal(){
  const modal=$("deleteAccountModal"), input=$("deleteAccountConfirm"), message=$("deleteAccountMessage");
  if(input) input.value="";
  if(message){ message.style.display="none"; message.textContent=""; }
  if(modal) modal.style.display="flex";
  setTimeout(()=>{ if(input) input.focus(); },40);
}
function closeDeleteAccountModal(){ const modal=$("deleteAccountModal"); if(modal) modal.style.display="none"; }
function deleteAccountMessage(text,isError){
  const el=$("deleteAccountMessage"); if(!el) return;
  el.textContent=text||""; el.style.display=text?"block":"none"; el.className="auth-message"+(isError?" error":"");
}
async function confirmDeleteAccount(){
  const input=$("deleteAccountConfirm"), value=input?input.value.trim():"";
  if(value!=="LÖSCHEN"){ deleteAccountMessage("Bitte gib exakt LÖSCHEN ein.",true); if(input) input.focus(); return; }
  if(!SUPA||!CLOUD_USER){ deleteAccountMessage("Du bist nicht angemeldet.",true); return; }
  deleteAccountMessage("Konto und Daten werden gelöscht …",false);
  const {error}=await SUPA.rpc("delete_own_account");
  if(error){
    deleteAccountMessage("Automatische Löschung nicht möglich: "+error.message+" Bitte nutze alternativ datenschutz@petriklar.com.",true);
    return;
  }
  clearLegacyState(); CLOUD_USER=null; CLOUD_DATA_LOADED=false; CLOUD_DIRTY=false; APP_STATE=emptyAppState();
  try{ await SUPA.auth.signOut({scope:"local"}); }catch(e){}
  closeDeleteAccountModal(); location.reload();
}

window.addEventListener("beforeunload",event=>{ if(CLOUD_DIRTY){ event.preventDefault(); event.returnValue=""; } });
