"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
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
