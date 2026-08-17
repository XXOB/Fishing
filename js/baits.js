"use strict";

/**
 * PetriKlar · baits.js
 * Köderkategorien, Varianten und Fangformular-Auswahl.
 * Lade-Reihenfolge und Abhängigkeiten: docs/ARCHITEKTUR.md
 */
/* --- Tab 3: Köder-Liste --- */
/* Köder: Oberstruktur (Kunst/Natur) -> Kategorie -> Varianten [{size,color}] */
const BAIT_GROUPS=[{key:"kunst",name:"Kunstköder"},{key:"natur",name:"Naturköder"}];
function baitGroup(base){
  const s=String(base||"").toLowerCase();
  if(/gummi|shad|wobbler|crank|jerk|spinner|blinker|spoon|l(ö|oe)ffel|twister|fliege|streamer|nymphe|popper|jig|chatter|kunst/.test(s)) return "kunst";
  if(/wurm|made|mais|boilie|brot|teig|k(ä|ae)se|k(ö|oe)derfisch|k(ö|oe)fi|fischfetzen|pellet|dendro|garnele|bienenmade|leber|natur/.test(s)) return "natur";
  return "natur";
}
function loadBaits(){
  const raw=Array.isArray(APP_STATE.baits)?APP_STATE.baits:[];
  const cats=[], idx={};
  const cat=(base, group)=>{ base=String(base||"").trim(); if(!base) return null; const k=base.toLowerCase();
    group=(group==="kunst"||group==="natur")?group:baitGroup(base);
    if(!(k in idx)){ idx[k]=cats.length; cats.push({base, group, variants:[]}); }
    else cats[idx[k]].group=group; return cats[idx[k]]; };
  const addV=(c,size,color)=>{ if(!c) return; size=(size||"").trim(); color=(color||"").trim(); if(!size&&!color) return;
    const key=(size+"|"+color).toLowerCase(); if(!c.variants.some(v=>(v.size+"|"+v.color).toLowerCase()===key)) c.variants.push({size,color}); };
  raw.forEach(it=>{
    if(typeof it==="string"){ cat(it); }
    else if(it && Array.isArray(it.variants)){ const c=cat(it.base, it.group); if(c) it.variants.forEach(v=>addV(c, v.size, v.color)); }
    else if(it && it.base){ addV(cat(it.base, it.group), it.size, it.color); }   // altes Flachformat
  });
  return cats;
}
function saveBaits(cats){ APP_STATE.baits=Array.isArray(cats)?cats:[]; APP_STATE.baits_initialized=true; markCloudDirty(); }
const DEFAULT_BAITS=["Tauwurm","Rotwurm","Made","Mais","Boilie","Brot","Käse",
  "Köderfisch","Gummifisch","Wobbler","Spinner","Blinker","Twister","Fliege"].map(b=>({base:b, group:baitGroup(b), variants:[]}));
function ensureBaitSeed(){                         // Standardköder als Startpunkt (einmalig)
  if(APP_STATE.baits_initialized) return;
  if(!loadBaits().length) saveBaits(DEFAULT_BAITS.slice());
  APP_STATE.baits_initialized=true;
}
const BAIT_GROUP_OPEN={kunst:false, natur:false};
function toggleBaitGroup(k){ BAIT_GROUP_OPEN[k]=!(BAIT_GROUP_OPEN[k]!==false); renderBaitList(); }
function variantLabel(base, v){ return base + (v&&v.size?(" "+v.size):"") + (v&&v.color?(", "+v.color):""); }
/* Anzahl Fänge je Köder: Kategorie = alle Varianten (Präfix), Variante = exakt. Nur echte Fänge. */
function koederCatchCount(text, isCat){
  const t=String(text||"").toLowerCase().trim(); if(!t) return 0;
  return loadCatches().filter(c=>{ if(!isFish(c)) return false; const k=(c.koeder||"").toLowerCase().trim();
    return isCat ? (k===t || k.indexOf(t+" ")===0 || k.indexOf(t+",")===0) : k===t; }).length;
}
function countBadgeFish(n){ return '<span class="countbadge" title="Fänge mit diesem Köder"><span class="fishico">'+uiIcon('fish')+'</span>'+n+'</span>'; }
const BAIT_OPEN={};   // aufgeklappte Kategorien (Basename kleingeschrieben)
function showBaitList(){
  hideAllViews();
  const v=$("baitView"); if(v) v.style.display="block";
  renderBaitList();
  setActiveTab("bait");
  window.scrollTo({top:0, behavior:"smooth"});
}
function addCategory(){
  const inp=$("baitCatInput"); if(!inp) return; const base=(inp.value||"").trim(); if(!base){ inp.focus(); return; }
  const gsel=$("baitCatGroup"); const group=(gsel&&gsel.value)?gsel.value:baitGroup(base);
  const cats=loadBaits();
  let c=cats.find(x=>x.base.toLowerCase()===base.toLowerCase());
  if(!c) cats.push({base, group, variants:[]}); else c.group=group;
  saveBaits(cats); inp.value=""; BAIT_OPEN[base.toLowerCase()]=true; BAIT_GROUP_OPEN[group]=true; renderBaitList(); inp.focus();
}
function toggleBaitCat(i){ const c=loadBaits()[i]; if(!c) return; const k=c.base.toLowerCase(); BAIT_OPEN[k]=!BAIT_OPEN[k]; renderBaitList(); }
function deleteBaitCat(i){ const cats=loadBaits(); if(i<0||i>=cats.length) return;
  if(!confirm("Köder „"+cats[i].base+"“ mit allen Varianten löschen?")) return; cats.splice(i,1); saveBaits(cats); renderBaitList(); }
function addVariant(i){
  const cats=loadBaits(); const c=cats[i]; if(!c) return;
  const size=(($("var_size_"+i)||{}).value||"").trim();
  const color=(($("var_color_"+i)||{}).value||"").trim();
  if(!size && !color){ const e=$("var_size_"+i); if(e) e.focus(); return; }
  const key=(size+"|"+color).toLowerCase();
  if(!c.variants.some(v=>(v.size+"|"+v.color).toLowerCase()===key)) c.variants.push({size,color});
  saveBaits(cats); BAIT_OPEN[c.base.toLowerCase()]=true; renderBaitList();
}
function deleteBaitVar(i,j){ const cats=loadBaits(); if(!cats[i]) return; cats[i].variants.splice(j,1); saveBaits(cats); renderBaitList(); }
function renderBaitList(){
  const cats=loadBaits();
  const dl=$("koederliste");
  if(dl){ let opts=[]; cats.forEach(c=>{ opts.push(c.base); c.variants.forEach(v=>opts.push(variantLabel(c.base,v))); });
    dl.innerHTML=opts.map(o=>'<option>'+esc(o)+'</option>').join(""); }
  const box=$("baitList"); if(!box){ populateKoeder(); return; }
  if(!cats.length){ box.innerHTML='<div class="fbnote" style="padding:10px 4px">Noch keine Köder – lege oben einen an.</div>'; populateKoeder(); return; }
  const indexed=cats.map((c,i)=>({c,i}));
  const catHtml=(c,i)=>{
    const open=!!BAIT_OPEN[c.base.toLowerCase()];
    let h='<div class="baitcat"><div class="baitcatrow">'+
      '<button class="baitcathead" onclick="toggleBaitCat('+i+')"><span class="tw">'+uiIcon(open?'chevron-down':'chevron-right')+'</span> '+
        esc(c.base)+' <small>'+c.variants.length+' Variante'+(c.variants.length===1?'':'n')+'</small></button>'+
      countBadgeFish(koederCatchCount(c.base,true))+
      '<button class="spotdel" title="Köder löschen" onclick="deleteBaitCat('+i+')">'+uiIcon('close')+'</button></div>';
    if(open){
      h+='<div class="baitvars">';
      h+=c.variants.map((v,j)=>{ const lbl=variantLabel(c.base,v);
        return '<div class="baitvar"><span class="vlabel">'+esc(lbl)+'</span>'+countBadgeFish(koederCatchCount(lbl,false))+
          '<button class="spotdel" onclick="deleteBaitVar('+i+','+j+')">'+uiIcon('close')+'</button></div>'; }).join("");
      h+='<div class="baitvaradd">'+
         '<input id="var_size_'+i+'" placeholder="Größe, z. B. 5 cm">'+
         '<input id="var_color_'+i+'" placeholder="Farbe, z. B. braun" onkeydown="if(event.key===\'Enter\'){event.preventDefault();addVariant('+i+');}">'+
         '<button onclick="addVariant('+i+')">+ Variante</button></div>';
      h+='</div>';
    }
    return h+'</div>';
  };
  let html="";
  BAIT_GROUPS.forEach(gr=>{
    const items=indexed.filter(o=>(o.c.group||baitGroup(o.c.base))===gr.key);
    if(!items.length) return;
    const gopen=BAIT_GROUP_OPEN[gr.key]!==false;
    html+='<div class="baitgroup"><button class="baitgrouphead" onclick="toggleBaitGroup(\''+gr.key+'\')">'+
      '<span class="tw">'+uiIcon(gopen?'chevron-down':'chevron-right')+'</span> '+gr.name+' <small>'+items.length+'</small></button>';
    if(gopen) html+='<div class="baitgroupbody">'+items.map(o=>catHtml(o.c,o.i)).join("")+'</div>';
    html+='</div>';
  });
  box.innerHTML=html;
  populateKoeder();
}
/* Köder-Auswahl im Fangformular: Kategorie -> Varianten */
function populateKoeder(){
  const bsel=$("f_koeder_base"); if(!bsel) return;
  const cats=loadBaits(), cur=bsel.value;
  let html='<option value="">— Köder —</option>';
  BAIT_GROUPS.forEach(gr=>{
    const items=cats.filter(c=>(c.group||baitGroup(c.base))===gr.key);
    if(!items.length) return;
    html+='<optgroup label="'+gr.name+'">'+items.map(c=>'<option value="'+esc(c.base)+'">'+esc(c.base)+'</option>').join("")+'</optgroup>';
  });
  bsel.innerHTML=html;
  if(cur && cats.some(c=>c.base===cur)) bsel.value=cur;
  onKoederBaseChange();
}
function onKoederBaseChange(){
  const bsel=$("f_koeder_base"), vsel=$("f_koeder_var"), field=$("f_var_field"); if(!vsel) return;
  const base=bsel?bsel.value:"";
  const c=loadBaits().find(x=>x.base===base);
  if(!base || !c || !c.variants.length){          // ohne Köder oder ohne Varianten: Variante-Feld ausblenden
    vsel.innerHTML='<option value="">— ohne Variante —</option>'; vsel.disabled=!base;
    if(field) field.style.display="none"; return;
  }
  if(field) field.style.display="";                // erst nach Köderwahl (mit Varianten) einblenden
  vsel.disabled=false;
  vsel.innerHTML='<option value="">— ohne Variante —</option>'+c.variants.map(v=>{
    const det=(v.size||"")+((v.size&&v.color)?", ":"")+(v.color||"");
    return '<option value="'+esc(variantLabel(base,v))+'">'+esc(det||"(ohne Angabe)")+'</option>';
  }).join("");
}
/* --- Tab-Leiste (aktiver Reiter) --- */
function setActiveTab(which){
  const map={start:"tabStart", places:"tabPlaces", fb:"tabFb", bait:"tabBait", stats:"tabStats"};
  Object.values(map).forEach(id=>{ const e=$(id); if(e){ e.classList.remove("active"); e.removeAttribute("aria-current"); } });
  const el=$(map[which]); if(el){ el.classList.add("active"); el.setAttribute("aria-current","page"); }
}
