"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const css=fs.readFileSync(path.join(root,"styles.css"),"utf8");

test("PDF-Feld ist mobil nutzbar und begrenzt",()=>{
  assert.match(html,/name="viewport"[^>]*width=device-width/);
  assert.match(html,/id="reportWaterName"[^>]*minlength="2"[^>]*maxlength="120"/);
  assert.match(css,/\.report-box\{[^}]*max-height:calc\(100dvh - 32px\)[^}]*overflow-y:auto/);
});

test("PDF-Formular wird auf Smartphones einspaltig",()=>{
  assert.match(css,/@media\(max-width:620px\)\{[\s\S]*?\.report-grid\{grid-template-columns:1fr\}/);
  assert.match(css,/@media\(max-width:620px\)\{[\s\S]*?\.report-spot-choices\{grid-template-columns:1fr\}/);
});

test("PDF-Aktionen sind auf schmalen Smartphones untereinander",()=>{
  assert.match(css,/@media\(max-width:420px\)\{[\s\S]*?\.report-box \.fbactions\{flex-direction:column;align-items:stretch\}/);
  assert.match(css,/@media\(max-width:420px\)\{[\s\S]*?\.report-box \.fbactions button\{width:100%;justify-content:center\}/);
});
