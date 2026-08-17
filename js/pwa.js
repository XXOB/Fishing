"use strict";

/**
 * PetriKlar · pwa.js
 * Installation, Service Worker, Updatehinweise und Online-Status.
 * Lade-Reihenfolge und Abhängigkeiten: docs/ARCHITEKTUR.md
 */
let PWA_INSTALL_PROMPT=null;

function isStandaloneApp(){
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone===true;
}
function isIOSDevice(){ return /iphone|ipad|ipod/i.test(navigator.userAgent||""); }
function setNetworkStatus(){
  const offline=!navigator.onLine, banner=$("networkBanner"), auth=$("authNetworkStatus");
  document.body.classList.toggle("is-offline",offline);
  if(banner){
    banner.style.display=offline?"flex":"none";
    banner.textContent=offline?"Keine Internetverbindung – persönliche Cloud-Daten bleiben geschützt und werden nicht offline geöffnet.":"";
  }
  if(auth){
    auth.style.display=offline?"block":"none";
    auth.textContent=offline?"Du bist offline. PetriKlar öffnet dein Cloud-Fangbuch automatisch, sobald die Verbindung wiederhergestellt ist.":"";
  }
  if(typeof setCloudStatus==="function"&&typeof CLOUD_USER!=="undefined"&&CLOUD_USER){
    if(offline) setCloudStatus("Keine Internetverbindung – Cloud-Daten sind derzeit nicht verfügbar.","error");
    else if(typeof CLOUD_DATA_LOADED!=="undefined"&&CLOUD_DATA_LOADED) setCloudStatus("In der Cloud gespeichert","ok");
  }
  if(!offline && typeof resumeCloudAfterReconnect==="function") resumeCloudAfterReconnect();
}
function renderInstallHelp(){
  const text=$("installHelpText"), action=$("installNowBtn");
  if(!text||!action) return;
  if(isStandaloneApp()){
    text.innerHTML="PetriKlar ist bereits als App auf diesem Gerät installiert.";
    action.style.display="none";
  }else if(PWA_INSTALL_PROMPT){
    text.innerHTML="Installiere PetriKlar direkt auf deinem Startbildschirm. Deine Fangdaten bleiben dabei weiterhin in deinem geschützten Cloud-Konto.";
    action.style.display="inline-flex";
  }else if(isIOSDevice()){
    text.innerHTML="<strong>Auf iPhone oder iPad:</strong><ol><li>Öffne PetriKlar in Safari.</li><li>Tippe auf <em>Teilen</em>.</li><li>Wähle <em>Zum Home-Bildschirm</em> und bestätige mit <em>Hinzufügen</em>.</li></ol>";
    action.style.display="none";
  }else{
    text.innerHTML="<strong>In Chrome oder Edge:</strong> Öffne das Browsermenü und wähle <em>App installieren</em> oder <em>Zum Startbildschirm hinzufügen</em>.";
    action.style.display="none";
  }
}
function openInstallHelp(){
  renderInstallHelp(); const modal=$("installHelpModal"); if(modal) modal.style.display="flex";
}
function closeInstallHelp(){ const modal=$("installHelpModal"); if(modal) modal.style.display="none"; }
async function installPetriKlar(){
  if(!PWA_INSTALL_PROMPT){ renderInstallHelp(); return; }
  PWA_INSTALL_PROMPT.prompt();
  try{ await PWA_INSTALL_PROMPT.userChoice; }catch(e){}
  PWA_INSTALL_PROMPT=null; renderInstallHelp();
}
function showAppUpdate(registration){
  const banner=$("appUpdateBanner"); if(!banner||!registration) return;
  banner.style.display="flex";
  banner.querySelector("button").onclick=()=>{
    if(registration.waiting) registration.waiting.postMessage({type:"SKIP_WAITING"});
  };
}
async function registerPetriKlarServiceWorker(){
  if(!("serviceWorker" in navigator) || !(location.protocol==="https:"||location.hostname==="localhost"||location.hostname==="127.0.0.1")) return;
  try{
    const registration=await navigator.serviceWorker.register("./service-worker.js",{scope:"./"});
    if(registration.waiting) showAppUpdate(registration);
    registration.addEventListener("updatefound",()=>{
      const worker=registration.installing; if(!worker) return;
      worker.addEventListener("statechange",()=>{
        if(worker.state==="installed"&&navigator.serviceWorker.controller) showAppUpdate(registration);
      });
    });
    let refreshing=false;
    navigator.serviceWorker.addEventListener("controllerchange",()=>{ if(!refreshing){ refreshing=true; location.reload(); } });
  }catch(e){ /* App bleibt ohne Offline-Hülle vollständig nutzbar. */ }
}
function initPWA(){
  window.addEventListener("beforeinstallprompt",event=>{ event.preventDefault(); PWA_INSTALL_PROMPT=event; });
  window.addEventListener("appinstalled",()=>{ PWA_INSTALL_PROMPT=null; closeInstallHelp(); });
  window.addEventListener("online",setNetworkStatus);
  window.addEventListener("offline",setNetworkStatus);
  setNetworkStatus();
  registerPetriKlarServiceWorker();
}
