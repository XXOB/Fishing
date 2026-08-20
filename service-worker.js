"use strict";

const SHELL_CACHE="petriklar-shell-v87";
const RUNTIME_CACHE="petriklar-runtime-v87";
const APP_SHELL=[
  "./",
  "./index.html",
  "./landing.css?v=6",
  "./theme.js?v=1",
  "./app.html",
  "./robots.txt",
  "./sitemap.xml",
  "./styles.css?v=77",
  "./manifest.webmanifest",
  "./offline.html",
  "./fish_rules.js?v=41",
  "./report_utils.js?v=59",
  "./js/core.js?v=59",
  "./js/pwa.js?v=65",
  "./js/cloud.js?v=80",
  "./js/onboarding.js?v=60",
  "./js/data-services.js?v=61",
  "./js/logbook.js?v=60",
  "./js/map.js?v=63",
  "./js/charts-bite.js?v=61",
  "./js/places.js?v=66",
  "./js/baits.js?v=61",
  "./js/stats.js?v=59",
  "./js/main.js?v=60",
  "./assets/icons/petriklar-192.png",
  "./assets/icons/petriklar-512.png",
  "./assets/icons/petriklar-maskable-512.png",
  "./assets/icons/apple-touch-icon.png",
  "./installieren.html",
  "./legal/legal.css",
  "./legal/legal-config.js",
  "./legal/legal.js",
  "./legal/impressum.html",
  "./legal/datenschutz.html",
  "./legal/support.html",
  "./legal/konto-loeschen.html"
];

self.addEventListener("install",event=>{
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache=>Promise.allSettled(APP_SHELL.map(url=>cache.add(url))))
      .then(()=>self.skipWaiting())
  );
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("petriklar-")&&![SHELL_CACHE,RUNTIME_CACHE].includes(key)).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener("message",event=>{ if(event.data&&event.data.type==="SKIP_WAITING") self.skipWaiting(); });

function isPrivateBackend(url){
  return url.hostname.endsWith("supabase.co") || url.hostname.includes("open-meteo.com") || url.hostname.includes("nominatim.openstreetmap.org") || url.hostname.includes("pegelonline.wsv.de") || url.hostname.includes("hlnug.de") || url.hostname.includes("inovum-services.de");
}
async function networkFirst(request,fallback){
  try{
    const response=await fetch(request);
    if(response&&response.ok){ const cache=await caches.open(RUNTIME_CACHE); cache.put(request,response.clone()); }
    return response;
  }catch(e){ return (await caches.match(request)) || (fallback?await caches.match(fallback):Response.error()); }
}
async function staleWhileRevalidate(request){
  const cached=await caches.match(request);
  const network=fetch(request).then(async response=>{
    if(response&&(response.ok||response.type==="opaque")){ const cache=await caches.open(RUNTIME_CACHE); cache.put(request,response.clone()); }
    return response;
  }).catch(()=>null);
  return cached || (await network) || Response.error();
}
self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET") return;
  const url=new URL(request.url);
  if(isPrivateBackend(url)) return;
  if(request.mode==="navigate"){
    event.respondWith(networkFirst(request,"./offline.html"));
    return;
  }
  if(url.origin===self.location.origin && url.pathname.endsWith("/wasserwerte.json")){
    event.respondWith(networkFirst(request));
    return;
  }
  if(["script","style","image","font"].includes(request.destination)) event.respondWith(staleWhileRevalidate(request));
});
