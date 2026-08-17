"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const root=path.resolve(__dirname,"..");
const code=fs.readFileSync(path.join(root,"js/charts-bite.js"),"utf8");
const context={console};
vm.createContext(context);
vm.runInContext(code,context);

function ctx(overrides={}){
  return Object.assign({
    wt:18,turb:null,oxygen:8,oxygenSat:90,lowLight:"day",cloud:30,
    ptrend:null,wind:0,gust:0,wcode:0,pegelUp:0,pegelUpPct:0,
    moon:{illum:50}
  },overrides);
}
function species(name){ return vm.runInContext(`BITE.find(x=>x.name==="${name}")`,context); }

test("Fischprofile enthalten die evidenzbasiert erweiterten Temperaturbereiche",()=>{
  assert.deepEqual(Array.from(species("Zander").temp),[12,23]);
  assert.deepEqual(Array.from(species("Barsch").temp),[10,23]);
  assert.deepEqual(Array.from(species("Karpfen").temp),[18,28]);
});

test("Hecht profitiert von Dämmerung und Wind, nicht pauschal von der Nacht",()=>{
  const sp=species("Hecht");
  const dusk=context.evalBite(sp,ctx({wt:12,lowLight:"twilight",wind:18}));
  const night=context.evalBite(sp,ctx({wt:12,lowLight:"night",wind:0}));
  assert.equal(dusk.color,"green");
  assert.match(dusk.reason,/Dämmerung|Wassertemperatur/);
  assert.ok(dusk.score>night.score);
});

test("starke Trübung verschlechtert die Barschbewertung",()=>{
  const sp=species("Barsch");
  const clear=context.evalBite(sp,ctx({wt:15,turb:2,lowLight:"day"}));
  const turbid=context.evalBite(sp,ctx({wt:15,turb:25,lowLight:"day"}));
  assert.equal(clear.color,"green");
  assert.ok(clear.score>turbid.score);
});

test("kritischer Sauerstoff wirkt deutlich negativ",()=>{
  const sp=species("Zander");
  const normal=context.evalBite(sp,ctx({wt:18,turb:6,lowLight:"twilight",oxygenSat:90}));
  const low=context.evalBite(sp,ctx({wt:18,turb:6,lowLight:"twilight",oxygenSat:30}));
  assert.equal(normal.color,"green");
  assert.notEqual(low.color,normal.color);
});

test("Luftdruck bleibt nur ein schwacher Alt-Faktor",()=>{
  assert.match(code,/score\+=0\.25/);
  assert.doesNotMatch(code,/Luftdruck fällt \(kurbelt das Fressen an\)/);
});
