'use strict';
// Only a public connection-help page is cached. Account/session responses,
// OAuth callbacks, app documents, scans and photos always use the network.
const CACHE='pokesift-install-v1';
const PUBLIC=['/offline.html','/offline.js','/pwa.css','/icons/app-192.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PUBLIC.map(path=>new Request(path,{credentials:'omit',cache:'reload'})))));
  // Updates wait for existing windows to close; never reload an active scan.
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith('pokesift-install-')&&name!==CACHE)await caches.delete(name);await self.clients.claim();})());
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  const home=request.mode==='navigate'&&(url.pathname==='/'||url.pathname==='/index.html');
  const publicAsset=!url.search&&PUBLIC.includes(url.pathname);
  if(!home&&!publicAsset)return;
  event.respondWith((async()=>{
    try{return await fetch(request);}
    catch{
      const cache=await caches.open(CACHE),saved=await cache.match(home?'/offline.html':url.pathname);
      return saved||new Response('PokéSift is offline. Reconnect and try again.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
    }
  })());
});
