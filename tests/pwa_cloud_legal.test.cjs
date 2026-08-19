"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("Manifest und PWA-Dateien sind vollständig",()=>{
  const manifest=JSON.parse(read("manifest.webmanifest"));
  assert.equal(manifest.name,"PetriKlar");
  assert.equal(manifest.display,"standalone");
  assert.equal(manifest.start_url,"./app.html");
  assert.ok(manifest.icons.some(icon=>icon.sizes==="192x192"));
  assert.ok(manifest.icons.some(icon=>icon.sizes==="512x512"&&String(icon.purpose||"").includes("maskable")));
  ["service-worker.js","offline.html","installieren.html","js/pwa.js"].forEach(file=>assert.ok(fs.existsSync(path.join(root,file)),file));
});

test("Service Worker cached keine persönlichen Supabase-Antworten",()=>{
  const sw=read("service-worker.js");
  assert.match(sw,/supabase/i);
  assert.match(sw,/offline\.html/);
  assert.match(sw,/if\(isPrivateBackend\(url\)\) return/);
});

test("PWA-Aktualisierungen werden ohne alten Wartezustand aktiviert",()=>{
  const sw=read("service-worker.js"), pwa=read("js/pwa.js"), html=read("app.html");
  assert.match(sw,/petriklar-shell-v81/);
  assert.match(sw,/self\.skipWaiting\(\)/);
  assert.match(pwa,/service-worker\.js\?v=81/);
  assert.match(pwa,/updateViaCache:"none"/);
  assert.match(html,/styles\.css\?v=74/);
  assert.match(html,/js\/pwa\.js\?v=64/);
});

test("Öffentliche Startseite führt in die getrennte PetriKlar-App",()=>{
  const landing=read("index.html"), app=read("app.html"), sw=read("service-worker.js");
  assert.match(landing,/PetriKlar – Angelplätze, Fangbuch & Live-Wasserdaten/);
  assert.match(landing,/href="app\.html"/);
  assert.match(landing,/href="landing\.css\?v=2"/);
  assert.match(landing,/id="sensornetz"/);
  assert.match(landing,/Ein Sensornetzwerk/);
  assert.match(sw,/"\.\/app\.html"/);
  assert.match(sw,/"\.\/landing\.css\?v=2"/);
  assert.match(app,/name="robots" content="noindex,nofollow"/);
  assert.match(read("robots.txt"),/Sitemap: https:\/\/www\.petriklar\.com\/sitemap\.xml/);
  assert.match(read("sitemap.xml"),/<loc>https:\/\/www\.petriklar\.com\/<\/loc>/);
});

test("Kontoerstellung hat eine eigene Maske mit Passwortbestätigung",()=>{
  const html=read("app.html"), cloud=read("js/cloud.js");
  assert.match(html,/id="authSignUpPanel"/);
  assert.match(html,/id="signUpEmail"/);
  assert.match(html,/id="signUpPassword"/);
  assert.match(html,/id="signUpPasswordConfirm"/);
  assert.match(html,/togglePasswordVisibility\('signUpPasswordConfirm'/);
  assert.match(cloud,/function authCreateAccount\(\)/);
  assert.match(cloud,/password!==confirmation/);
});

test("App bindet PWA, Rechtstexte und Kontolöschung ein",()=>{
  const html=read("app.html");
  assert.match(html,/manifest\.webmanifest/);
  assert.ok(html.indexOf("js/pwa.js")<html.indexOf("js/cloud.js"));
  ["legal/impressum.html","legal/datenschutz.html","legal/support.html","legal/konto-loeschen.html"].forEach(link=>assert.match(html,new RegExp(link.replace(".","\\."))));
  assert.match(html,/confirmDeleteAccount\(\)/);
});

test("Anmeldung ist reduziert und Angelplatz-Pins übernehmen die Bedingungsfarbe",()=>{
  const css=read("styles.css"), places=read("js/places.js"), map=read("js/map.js");
  assert.match(css,/\.auth-locked #authModal \.cmhead\{display:none\}/);
  assert.match(places,/class="spotpin lg-amber"/);
  assert.match(places,/pin\.className="spotpin "\+c\.lvl\.cls/);
  assert.match(css,/\.spotpin\.lg-green\{color:var\(--green\)\}/);
  assert.match(css,/\.spotpin\.lg-red\{color:var\(--red\)\}/);
  assert.match(map,/function spotMapColor\(levelClass\)/);
  assert.match(map,/mk\.setIcon\(spotMapIcon\(c\.lvl\.cls\)\)/);
  assert.match(map,/#64d2ff/);
  assert.match(map,/#fbbf24/);
  assert.match(map,/#f87171/);
});

test("Cloud-State bleibt bis zum erfolgreichen Laden gesperrt",()=>{
  const cloud=read("js/cloud.js");
  assert.match(cloud,/CLOUD_DATA_LOADED=false/);
  assert.match(cloud,/if\(loaded\) await startAppAfterLogin\(\)/);
  assert.match(cloud,/rpc\("delete_own_account"\)/);
  assert.match(cloud,/functions\.invoke\("delete-account"/);
  const edge=read("supabase/functions/delete-account/index.ts");
  assert.match(edge,/auth\.admin\.deleteUser/);
  assert.match(edge,/Dein PetriKlar-Konto wurde gelöscht/);
  assert.match(edge,/SMTP_PASS/);
  const sql=read("supabase/migrations/20260816_phase1_cloud.sql");
  assert.match(sql,/enable row level security/i);
  assert.match(sql,/function public\.delete_own_account/i);
  assert.match(sql,/delete from auth\.users/i);
});
