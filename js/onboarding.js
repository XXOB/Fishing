"use strict";

/**
 * PetriKlar · onboarding.js
 * Einmalige, überspringbare Kurzanleitung.
 * Lade-Reihenfolge und Abhängigkeiten: docs/ARCHITEKTUR.md
 */
/* ===================== Kurzanleitung beim ersten Login ===================== */
const ONBOARDING_STEPS=[
  {kind:"places",label:"Angelplätze & Bissanzeige",title:"Deine Gewässer auf einen Blick! Bissanzeige mit echten Wasserdaten!",text:"Lege Angelplätze an. Wähle eine Messstation und lass dir eine Bissprognose geben. Anhand echter Wasserdaten: Pegel, Temperatur, Sauerstoffsättigung."},
  {kind:"catch",label:"Fangbuch",title:"Dokumentiere alle Fänge! Lerne dein Gewässer kennen.",text:"Speichere deine Fänge an deinen Plätzen. Die Wetter- und Wasserbedingungen werden mitgespeichert. So lernst du und die App mit dir!"},
  {kind:"report",label:"Fangmeldung",title:"Vom Angeltag zur Fangmeldung.",text:"Erzeuge eine Fangmeldung aus deinen Fangbüchern!"},
  {kind:"conditions",label:"Statistik",title:"Analysiere deinen Erfolg!",text:"Schau dir deine besten Fänge und Orte an, welche Fische du am häufigsten geangelt hast und vieles mehr in der Statistik."}
];
let ONBOARDING_STEP=0, ONBOARDING_OPENED=false, ONBOARDING_TIMER=null;
function onboardingVisual(step){
  if(step.kind==="places") return '<span class="tour-map">'+uiIcon("map")+'</span><span class="tour-pin">'+uiIcon("pin")+'</span><span class="tour-pulse"></span>';
  if(step.kind==="catch") return '<span class="tour-fish">'+uiIcon("fish")+'</span><span class="tour-plus">'+uiIcon("plus")+'</span><span class="tour-line"></span>';
  if(step.kind==="conditions") return '<span class="tour-drop">'+uiIcon("droplet")+'</span><span class="tour-bars"><i></i><i></i><i></i></span>';
  return '<span class="tour-book">'+uiIcon("book-open")+'</span><span class="tour-download">'+uiIcon("download")+'</span>';
}
function renderOnboarding(){
  const step=ONBOARDING_STEPS[ONBOARDING_STEP]||ONBOARDING_STEPS[0];
  const visual=$("onboardingVisual"), label=$("onboardingLabel"), title=$("onboardingTitle"), text=$("onboardingText");
  if(visual){ visual.className="onboarding-visual tour-"+step.kind; visual.innerHTML=onboardingVisual(step); }
  if(label) label.textContent=step.label; if(title) title.textContent=step.title; if(text) text.textContent=step.text;
  const dots=$("onboardingDots"); if(dots) dots.innerHTML=ONBOARDING_STEPS.map((_,i)=>'<span class="'+(i===ONBOARDING_STEP?'active':'')+'" aria-hidden="true"></span>').join("");
  const back=$("onboardingBack"), next=$("onboardingNext");
  if(back) back.style.visibility=ONBOARDING_STEP?"visible":"hidden";
  if(next) setIconLabel(next,ONBOARDING_STEP===ONBOARDING_STEPS.length-1?"check":"chevron-right",ONBOARDING_STEP===ONBOARDING_STEPS.length-1?"Los geht’s":"Weiter");
  const count=$("onboardingCount"); if(count) count.textContent=(ONBOARDING_STEP+1)+" / "+ONBOARDING_STEPS.length;
}
function openOnboarding(force){
  if(!CLOUD_USER) return;
  const done=!!(APP_STATE.ui_prefs&&APP_STATE.ui_prefs.onboarding_done);
  if(!force&&done) return;
  clearTimeout(ONBOARDING_TIMER); ONBOARDING_OPENED=true; ONBOARDING_STEP=0; closeAuthModal(); renderOnboarding();
  const modal=$("onboardingModal"); if(modal) modal.style.display="flex";
}
function finishOnboarding(){
  const modal=$("onboardingModal"); if(modal) modal.style.display="none";
  if(!(APP_STATE.ui_prefs&&APP_STATE.ui_prefs.onboarding_done)){
    APP_STATE.ui_prefs={...(APP_STATE.ui_prefs||{}),onboarding_done:true}; markCloudDirty();
  }
}
function skipOnboarding(){ finishOnboarding(); }
function onboardingBack(){ if(ONBOARDING_STEP>0){ ONBOARDING_STEP--; renderOnboarding(); } }
function onboardingNext(){
  if(ONBOARDING_STEP>=ONBOARDING_STEPS.length-1){ finishOnboarding(); return; }
  ONBOARDING_STEP++; renderOnboarding();
}
function maybeShowOnboarding(){
  if(ONBOARDING_OPENED||!CLOUD_USER||(APP_STATE.ui_prefs&&APP_STATE.ui_prefs.onboarding_done)) return;
  clearTimeout(ONBOARDING_TIMER); ONBOARDING_TIMER=setTimeout(()=>openOnboarding(false),350);
}
