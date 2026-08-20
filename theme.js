"use strict";

(function(){
  const STORAGE_KEY="petriklar_theme_v1";
  const systemTheme=window.matchMedia("(prefers-color-scheme: light)");

  function storedTheme(){
    try{
      const value=localStorage.getItem(STORAGE_KEY);
      return value==="light"||value==="dark"?value:null;
    }catch(e){ return null; }
  }

  function preferredTheme(){ return storedTheme()||(systemTheme.matches?"light":"dark"); }

  function updateThemeControls(theme){
    document.querySelectorAll("[data-theme-toggle]").forEach(button=>{
      const dark=theme==="dark";
      button.setAttribute("aria-pressed",dark?"true":"false");
      button.setAttribute("aria-label",dark?"Light Mode aktivieren":"Dark Mode aktivieren");
      button.setAttribute("title",dark?"Light Mode aktivieren":"Dark Mode aktivieren");
    });
  }

  function applyTheme(theme){
    document.documentElement.dataset.theme=theme;
    const color=theme==="light"?"#f5f7fb":"#05080d";
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute("content",color);
    updateThemeControls(theme);
  }

  window.toggleTheme=function(){
    const next=document.documentElement.dataset.theme==="dark"?"light":"dark";
    try{ localStorage.setItem(STORAGE_KEY,next); }catch(e){}
    applyTheme(next);
  };

  systemTheme.addEventListener?.("change",()=>{ if(!storedTheme()) applyTheme(preferredTheme()); });
  applyTheme(preferredTheme());
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",()=>updateThemeControls(preferredTheme()),{once:true});
})();
