"use strict";

/**
 * PetriKlar · core.js
 * Gemeinsamer Laufzeitkern: globale Zustände, DOM- und Format-Helfer.
 * Lade-Reihenfolge und Abhängigkeiten: docs/ARCHITEKTUR.md
 */
/* Wasserqualität wird beim Laden aus wasserwerte.json geholt (mehrere Gütestationen).
   Die GitHub-Action aktualisiert die Datei stündlich. Nur Startwert: */
window.WQ = { "updated": "", "stations": [] };
const WQ_MAXKM = 60;   // Gütestation nur nutzen, wenn näher als … km und gleicher Fluss

const PO_BASE = "https://www.pegelonline.wsv.de/webservices/rest-api/v2";
const MAINZ_UUID = "a37a9aa3-45e9-4d90-9df6-109f3a28a5af";
let STATIONS = [{uuid:MAINZ_UUID, name:"Mainz", km:498.27, lat:50.003995, lon:8.275319, river:"Rhein"}];
let CUR = STATIONS[0];                 // aktuelle Messstation (für Pegel/Durchfluss)
let WXPOS = {lat:50.003995, lon:8.275319}; // Ort für Wetter (Angelplatz-Koordinaten)
const REF_CACHE = {};                  // Hauptwerte je Station-UUID
function poStation(){ return PO_BASE+"/stations/"+CUR.uuid; }

const $ = id => document.getElementById(id);
const fmt = (n,d=0) => (n==null||isNaN(n)) ? "–" : Number(n).toLocaleString("de-DE",{minimumFractionDigits:d,maximumFractionDigits:d});
const hesc = s => String(s==null?"":s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function uiIcon(name, extra){ return '<svg class="uiicon'+(extra?' '+extra:'')+'" aria-hidden="true"><use href="#i-'+name+'"></use></svg>'; }
function iconLabel(name,text){ return uiIcon(name)+' '+hesc(text); }
function setIconLabel(el,name,text){ if(el) el.innerHTML=iconLabel(name,text); }
