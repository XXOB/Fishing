"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const R=require("../report_utils.js");

const catches=[
  {id:1,angelplatz:"Nordufer",gewaesser:"Donau",datum:"2026-06-01",uhrzeit:"07:10",fischart:"Hecht",groesse_cm:82,gewicht_kg:4.2,koeder:"Gummifisch"},
  {id:2,angelplatz:"Brücke",gewaesser:"Altmühl",datum:"2026-06-02",uhrzeit:"18:30",fischart:"Zander",groesse_cm:61,gewicht_kg:2.1,koeder:"Wobbler"},
  {id:3,angelplatz:"Waldweg",gewaesser:"Baggersee",datum:"2025-08-03",uhrzeit:"06:00",kein_fang:true}
];

test("ein Angelplatz",()=>{
  assert.deepEqual(R.filterCatches(catches,["Nordufer"],"2026").map(c=>c.id),[1]);
});

test("mehrere Angelplätze werden zusammengeführt",()=>{
  assert.deepEqual(R.filterCatches(catches,["Nordufer","Brücke"],"2026").map(c=>c.id),[1,2]);
});

test("unterschiedliche interne Gewässernamen erscheinen nicht in PDF-Zeilen",()=>{
  const selected=R.filterCatches(catches,["Nordufer","Brücke"],"2026");
  const rows=R.buildRows(selected,x=>x,()=>"");
  const text=JSON.stringify(rows);
  assert.equal(text.includes("Nordufer"),false);
  assert.equal(text.includes("Brücke"),false);
  assert.equal(text.includes("Donau"),false);
  assert.equal(text.includes("Altmühl"),false);
});

test("Sonderzeichen und Umlaute bleiben exakt erhalten",()=>{
  const value="  Donau, Los 3 – Vereinsstrecke München (e. V.) / Süd  ";
  assert.deepEqual(R.normalizeWaterSectionName(value),{
    valid:true,value:"Donau, Los 3 – Vereinsstrecke München (e. V.) / Süd",message:""
  });
});

test("leere Eingabe wird blockiert",()=>{
  assert.equal(R.normalizeWaterSectionName("   ").valid,false);
});

test("zu kurze und zu lange Eingabe werden blockiert",()=>{
  assert.equal(R.normalizeWaterSectionName("A").valid,false);
  assert.equal(R.normalizeWaterSectionName("x".repeat(121)).valid,false);
  assert.equal(R.normalizeWaterSectionName("x".repeat(120)).valid,true);
});
