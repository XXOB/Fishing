"use strict";
(function(){
  const cfg=window.PETRIKLAR_LEGAL||{};
  const values={
    operator:cfg.operatorName||"[BETREIBER EINTRAGEN]",
    legalForm:cfg.legalForm||"",
    street:cfg.addressStreet||"[ANSCHRIFT EINTRAGEN]",
    city:cfg.addressCity||"[PLZ UND ORT EINTRAGEN]",
    country:cfg.addressCountry||"Deutschland",
    phone:cfg.phone||"",
    infoEmail:cfg.infoEmail||"info@petriklar.com",
    privacyEmail:cfg.privacyEmail||"datenschutz@petriklar.com",
    domain:cfg.domain||"petriklar.com",
    region:cfg.supabaseRegion||"[REGION PRÜFEN]",
    activeDelete:cfg.activeDataDeletionDays||"30",
    backupDelete:cfg.backupDeletionDays||"90",
    supportRetention:cfg.supportRetention||"3 Jahre"
  };
  document.querySelectorAll("[data-legal]").forEach(el=>{
    const key=el.dataset.legal, value=values[key]||"";
    if(el.tagName==="A"&&key.toLowerCase().includes("email")){ el.href="mailto:"+value; }
    el.textContent=value;
  });
  document.querySelectorAll("[data-legal-optional]").forEach(el=>{
    const value=cfg[el.dataset.legalOptional]; if(!value) el.remove(); else el.querySelector("span").textContent=value;
  });
  const incomplete=Object.values(cfg).some(value=>String(value||"").includes("["));
  const warning=document.getElementById("legalDraftWarning"); if(warning) warning.hidden=!incomplete;
  document.querySelectorAll("[data-current-year]").forEach(el=>el.textContent=String(new Date().getFullYear()));
})();
