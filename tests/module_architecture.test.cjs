"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const expected=[
  "js/core.js","js/cloud.js","js/onboarding.js","js/data-services.js",
  "js/logbook.js","js/map.js","js/charts-bite.js","js/places.js",
  "js/baits.js","js/stats.js","js/main.js"
];

test("index.html lädt alle App-Module in dokumentierter Reihenfolge",()=>{
  const sources=[...html.matchAll(/<script src="(js\/[^"]+?)\?v=\d+"><\/script>/g)].map(m=>m[1]);
  assert.deepEqual(sources,expected);
  assert.doesNotMatch(html,/<script src="app\.js/);
});

test("jedes Modul ist vorhanden, strikt und fachlich beschrieben",()=>{
  for(const relative of expected){
    const file=path.join(root,relative);
    assert.equal(fs.existsSync(file),true,relative+" fehlt");
    const code=fs.readFileSync(file,"utf8");
    assert.match(code,/^"use strict";/,relative+" nutzt keinen Strict Mode");
    assert.match(code,/PetriKlar · /,relative+" hat keinen Modulkopf");
  }
});

test("Bootstrapping liegt ausschließlich im Main-Modul",()=>{
  for(const relative of expected.slice(0,-1)){
    const code=fs.readFileSync(path.join(root,relative),"utf8");
    assert.doesNotMatch(code,/\bboot\(\);/);
  }
  const main=fs.readFileSync(path.join(root,"js/main.js"),"utf8");
  assert.match(main,/async function boot\(\)/);
  assert.match(main,/\bboot\(\);/);
});

test("Globale Funktionsnamen sind über Module hinweg eindeutig",()=>{
  const seen=new Map();
  for(const relative of expected){
    const code=fs.readFileSync(path.join(root,relative),"utf8");
    for(const match of code.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)){
      assert.equal(seen.has(match[1]),false,match[1]+" ist doppelt in "+seen.get(match[1])+" und "+relative);
      seen.set(match[1],relative);
    }
  }
  assert.ok(seen.size>250,"zu wenige App-Funktionen erkannt");
});
