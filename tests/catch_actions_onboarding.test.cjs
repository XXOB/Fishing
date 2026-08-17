"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const moduleFiles=["core.js","cloud.js","onboarding.js","data-services.js","logbook.js","map.js","charts-bite.js","places.js","baits.js","stats.js","main.js"];
const app=moduleFiles.map(name=>fs.readFileSync(path.join(root,"js",name),"utf8")).join("\n");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const css=fs.readFileSync(path.join(root,"styles.css"),"utf8");

test("Fangaktionen verwenden sichere data-Attribute",()=>{
  assert.doesNotMatch(app,/JSON\.stringify\(String\(c\.id\)\)/);
  assert.match(app,/data-catch-id="'\+actionId\+'"/);
  assert.match(app,/editCatch\(this\.dataset\.catchId\)/);
  assert.match(app,/deleteCatch\(this\.dataset\.catchId\)/);
});

test("Kurzanleitung ist kurz, überspringbar und erneut aufrufbar",()=>{
  assert.match(html,/id="onboardingModal"/);
  assert.match(html,/onclick="skipOnboarding\(\)"[^>]*>Überspringen</);
  assert.match(html,/onclick="openOnboarding\(true\)"/);
  const steps=(app.match(/\{kind:"(?:places|catch|conditions|report)"/g)||[]).length;
  assert.equal(steps,4);
});

test("Abschluss der Anleitung wird im Cloud-App-State gespeichert",()=>{
  assert.match(app,/ui_prefs:\{onboarding_done:false\}/);
  assert.match(app,/onboarding_done:true\}; markCloudDirty\(\)/);
});

test("Anleitungsanimationen respektieren reduzierte Bewegung",()=>{
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/\.onboarding-visual \*\{animation:none!important\}/);
});

test("Die Hauptnavigation priorisiert den schnellen Fangeintrag",()=>{
  assert.match(html,/id="quickCatchBtn"[^>]*onclick="quickAddCatch\(\)"/);
  assert.doesNotMatch(html,/id="tabBait"/);
  assert.match(html,/class="library-link"[^>]*onclick="showBaitList\(\)"/);
  assert.match(app,/function quickAddCatch\(\)/);
  assert.match(app,/if\(trip\)\{ tripAddCatch\(\); return; \}/);
});

test("Angelplatz-Aktionen verwenden Favorit, Bearbeiten und Papierkorb",()=>{
  assert.match(html,/id="i-star"/);
  assert.match(app,/uiIcon\('star'\)/);
  assert.match(app,/uiIcon\('edit'\)/);
  assert.match(app,/uiIcon\('trash'\)/);
  assert.match(app,/function toggleSpotFavorite\(id\)/);
  assert.match(app,/sp\.favorite=!sp\.favorite/);
  assert.match(css,/width:2\.75rem;height:2\.75rem/);
  assert.match(css,/align-items:center;justify-content:center/);
});
