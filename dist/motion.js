'use strict';
// Device-local app preference. Full animation is the product default; following
// the operating system is an explicit option, not a browser-wide override.
(() => {
  const key='pokesift.motion.v1',valid=new Set(['full','reduced','system']);
  const media=matchMedia('(prefers-reduced-motion: reduce)'),events=new EventTarget();
  const normalize=value=>valid.has(value)?value:'full';
  function stored(){try{return normalize(localStorage.getItem(key));}catch{return 'full';}}
  let preference=stored();
  try{if(window.parent!==window&&window.parent.PokeSiftMotion)preference=window.parent.PokeSiftMotion.preference;}catch{}
  function publish(){
    document.documentElement.dataset.motion=preference==='reduced'||preference==='system'&&media.matches?'reduced':'full';
    if(document.documentElement.dataset.motion==='reduced')for(const animation of document.getAnimations?.()||[])animation.cancel();
    document.querySelectorAll('[data-motion-choice]').forEach(select=>select.value=preference);
    // Also propagate in memory when browser storage is unavailable.
    for(const frame of document.querySelectorAll('iframe'))try{frame.contentWindow.PokeSiftMotion?.sync(preference);}catch{}
    events.dispatchEvent(new Event('change'));
  }
  function sync(value){const next=normalize(value);if(next!==preference){preference=next;publish();}}
  function set(value){const next=normalize(value);try{localStorage.setItem(key,next);}catch{}sync(next);}
  window.PokeSiftMotion={get preference(){return preference;},get matches(){return preference==='reduced'||preference==='system'&&media.matches;},set,sync,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)};
  media.addEventListener('change',()=>{if(preference==='system')publish();});
  window.addEventListener('storage',e=>{if(e.key===key)sync(e.newValue);else if(e.key===null)sync('full');});
  document.addEventListener('change',e=>{if(e.target.matches?.('[data-motion-choice]'))set(e.target.value);});
  publish();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',publish,{once:true});
})();
