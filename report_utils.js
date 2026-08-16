(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports) module.exports=api;
  else root.PetriKlarReport=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  function normalizeWaterSectionName(value){
    const clean=String(value==null?"":value).trim();
    if(!clean) return {valid:false,value:"",message:"Bitte Gewässer, Abschnitt oder Los eingeben."};
    if(clean.length<2) return {valid:false,value:clean,message:"Die Bezeichnung muss mindestens 2 Zeichen lang sein."};
    if(clean.length>120) return {valid:false,value:clean,message:"Die Bezeichnung darf höchstens 120 Zeichen lang sein."};
    return {valid:true,value:clean,message:""};
  }

  function filterCatches(catches,selectedSpots,year){
    const names=new Set((selectedSpots||[]).map(String));
    return (catches||[]).filter(c=>names.has(String(c&&c.angelplatz||""))&&
      (!year||String(c&&c.datum||"").slice(0,4)===String(year)))
      .slice().sort((a,b)=>((a.datum||"")+(a.uhrzeit||"")).localeCompare((b.datum||"")+(b.uhrzeit||"")));
  }

  function buildRows(catches,reportDateDE,catchStatus){
    return (catches||[]).map(c=>[
      reportDateDE(c.datum),c.uhrzeit||"",
      c.kein_fang?"Angeltag ohne Fang":((c.fischart||"Fang")+(catchStatus(c)?" ("+catchStatus(c).charAt(0).toUpperCase()+catchStatus(c).slice(1)+")":"")),
      c.kein_fang?"0":"1",
      c.groesse_cm!=null?String(c.groesse_cm):"",
      c.gewicht_kg!=null?String(c.gewicht_kg).replace(".",","):"",
      c.kein_fang?"":(c.koeder||"")
    ]);
  }

  return {normalizeWaterSectionName,filterCatches,buildRows};
});
