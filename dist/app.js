'use strict';
const $ = id => document.getElementById(id);
const STORAGE_KEY = 'pokesift.collection.v1';
const FX_KEY = 'pokesift.fx.v1';
let fx = null, fxLoading = false, fxFailed = false;
const busyStates = new Set(['preparing', 'queued', 'scanning']);
const reviewStates = new Set(['ambiguous', 'retake', 'not_found', 'unsupported', 'error', 'interrupted']);
let entries = [], filter = 'all', active = 0, stream = null, cameraGeneration = 0;
let latestTimer, showCapturedPhoto = false;
let focusedId = null, preparing = Promise.resolve(), readOnlyStorage = false, toastTimer;
const jobs = [], sessionIds = new Set();

function notify(message) {
  const toast = $('toast');
  // Native dialogs are in the top layer; put notifications in the active dialog.
  const host = $('detail-view').open ? $('detail-view') : $('camera-view').open ? $('camera-view') : document.body;
  host.append(toast); toast.textContent = message; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}
function storageWarning(message) { $('storage-warning').textContent = message; $('storage-warning').hidden = false; }
function save() {
  if (readOnlyStorage) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({version: 1, entries}));
    $('storage-warning').hidden = true;
    $('saved-note').textContent = 'Saved in this browser. No cloud sync.';
    return true;
  } catch {
    storageWarning('Your browser could not save the latest changes. Keep this page open and export your collection before leaving. Removing cards may free up space.');
    $('saved-note').textContent = 'Unsaved changes — export before leaving.';
    return false;
  }
}
function normalizeResult(result) {
  // Identification prices come from TCGPlayer, whose documented base currency is USD.
  for (const card of result?.data?.candidates || []) {
    if (!Array.isArray(card.prices)) continue;
    card.prices = card.prices.map(p => {
      const assumed = p.currency_assumed ?? (!p.currency || p.currency_source === 'TCGPlayer default');
      return {...p, provider_currency: p.provider_currency === undefined ? (assumed ? null : p.currency) : p.provider_currency,
        currency: p.currency || 'USD', currency_assumed: assumed,
        currency_source: p.currency_source || (assumed ? 'TCGPlayer default' : 'provider'),
        ...(assumed ? {currency_assumption_source:'https://help.tcgplayer.com/hc/en-us/articles/23375212682519-How-to-Buy-Internationally-on-TCGplayer'} : {})};
    });
  }
  return result;
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw);
    if (stored.version !== 1 || !Array.isArray(stored.entries) || stored.entries.some(e => !e || typeof e.id !== 'string' || typeof e.status !== 'string' || (!/^data:image\/(jpeg|png|webp);base64,/.test(e.thumbnail || '') || (e.canonicalImage && !/^data:image\/(jpeg|png|webp);base64,/.test(e.canonicalImage))))) throw new Error();
    entries = stored.entries.map(e => ({...e, result: normalizeResult(e.result)})).map(e => ({...e, currencyAssumed: Boolean(e.result?.data?.candidates?.some(c => c.prices?.some(p => p.currency_assumed)))})).map(e => busyStates.has(e.status) ? {...e, status: 'interrupted', message: 'The page closed before this result arrived. A scan may have been used. Check your provider balance before taking another photo.'} : e);
  } catch {
    readOnlyStorage = true;
    storageWarning('Saved collection could not be opened. Existing storage has been left untouched. New cards stay in memory; export them before leaving.');
  }
}
const cardOf = e => e.result?.data?.candidates?.[0];
const titleOf = e => cardOf(e)?.name || (busyStates.has(e.status) ? 'Finding your card…' : e.status === 'retake' ? 'A clearer photo needed' : 'Card to review');
const statusOf = e => ({preparing:'Preparing photo',queued:'In the queue',scanning:'Identifying…',matched:'Identified',ambiguous:'Check the match',retake:'Retake suggested',not_found:'No match found',unsupported:'Not supported',error:'Scan failed',interrupted:'Scan interrupted'}[e.status] || 'To review');
function element(tag, className, text) {
  const el = document.createElement(tag); if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function imageOf(e) {
  const image = document.createElement('img'); image.src = e.canonicalImage || e.thumbnail; image.alt = titleOf(e); image.loading = 'lazy'; return image;
}
function badge(e) { return element('span', 'status-badge' + (busyStates.has(e.status) ? ' processing' : e.status !== 'matched' ? ' review' : ''), statusOf(e)); }
const currencyOf = price => String(price?.currency || 'USD').toUpperCase();
function audAmount(price) {
  if (price?.market_price == null || !Number.isFinite(Number(price.market_price)) || Number(price.market_price) <= 0) return null;
  const currency = currencyOf(price);
  if (currency === 'AUD') return Number(price.market_price);
  const rate = fx?.rates?.[currency];
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? Number(price.market_price) / rate : null;
}
function priceText(price) {
  if (price?.market_price == null || !Number.isFinite(Number(price.market_price)) || Number(price.market_price) <= 0) return 'No market price';
  const amount = audAmount(price);
  return amount === null ? 'AUD unavailable' : 'A$' + amount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
}
function fxLabel() { return fx ? `AUD · ${fx.date}${fxFailed || fx.stale ? ' · cached' : ''}` : fxLoading ? 'AUD · loading rates' : 'AUD · rates unavailable'; }
function validFx(value) { return value?.base === 'AUD' && /^\d{4}-\d{2}-\d{2}$/.test(value.date || '') && value.rates && typeof value.rates === 'object' && Object.values(value.rates).every(n => typeof n === 'number' && Number.isFinite(n) && n > 0); }
async function refreshFx() {
  if (fxLoading) return;
  fxLoading = true; render();
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(),16000);
  try {
    const response = await fetch('/api/exchange-rates',{credentials:'same-origin',signal:controller.signal});
    if (!response.ok) throw new Error();
    const rates = await response.json(); if (!validFx(rates)) throw new Error();
    fx = rates; fxFailed = Boolean(rates.stale);
    try { localStorage.setItem(FX_KEY,JSON.stringify(fx)); } catch { /* Collection export is separate from optional rate caching. */ }
  } catch { fxFailed = true; }
  finally { clearTimeout(timeout); fxLoading = false; render(); }
}
function mainPrice(e) {
  if (e.status !== 'matched') return null;
  const card = cardOf(e), prices = card?.prices;
  if (!Array.isArray(prices)) return null;
  return prices.find(p => p.printing === card.suggested_printing) || (prices.length === 1 ? prices[0] : null);
}
function render() {
  const inProgress = entries.filter(e => busyStates.has(e.status)).length;
  $('fx-refresh').textContent = fxLabel() + ' ↻'; $('fx-refresh').disabled = fxLoading;
  $('all-count').textContent = entries.length;
  $('review-count').textContent = entries.filter(e => reviewStates.has(e.status)).length;
  $('activity').hidden = !inProgress;
  $('activity').textContent = `${inProgress} ${inProgress === 1 ? 'card is' : 'cards are'} coming into focus. You can keep adding or browse below.`;
  $('empty').hidden = entries.length > 0;
  $('export').hidden = entries.length === 0;
  const query = $('search').value.trim().toLowerCase();
  const shown = entries.filter(e => (filter !== 'review' || reviewStates.has(e.status)) && (!query || [titleOf(e),cardOf(e)?.number,cardOf(e)?.set?.name,cardOf(e)?.rarity].filter(Boolean).join(' ').toLowerCase().includes(query)));
  $('no-results').hidden = entries.length === 0 || shown.length !== 0;
  // Preserve keyboard focus when background results rebuild the grid/tray.
  const focus = document.activeElement?.dataset?.entry;
  const focusHost = document.activeElement?.parentElement?.id;
  const grid = $('card-grid'); grid.replaceChildren();
  for (const e of shown) {
    const button = element('button','card-tile'); button.dataset.entry = e.id; button.setAttribute('aria-label', `${titleOf(e)}, ${statusOf(e)}`);
    const photo = element('div','card-image'); photo.append(imageOf(e),badge(e)); button.append(photo);
    button.append(element('h3','',titleOf(e)),element('p','card-sub',cardOf(e)?.set?.name || statusOf(e)));
    const bottom = element('div','card-bottom'), price = mainPrice(e);
    const value = element('span','card-price',price ? priceText(price) : e.status === 'matched' ? 'View details' : '');
    bottom.append(value,element('span','card-number',cardOf(e)?.number || '')); button.append(bottom);
    button.addEventListener('click',() => openDetail(e.id)); grid.append(button);
  }
  const recent = entries.filter(e => sessionIds.has(e.id));
  $('session-count').textContent = recent.length;
  $('session-empty').hidden = recent.length > 0;
  $('queue-state').textContent = inProgress ? `${inProgress} in progress` : recent.length ? 'All caught up' : 'Ready when you are';
  const tray = $('result-tray'); const scroll = tray.scrollLeft; tray.replaceChildren();
  for (const e of recent) {
    const button = element('button','tray-card'); button.dataset.entry = e.id; button.setAttribute('aria-label', `${titleOf(e)}, ${statusOf(e)}`);
    button.append(imageOf(e),element('span','',titleOf(e)));
    const price = mainPrice(e);
    if (price && Number(price.market_price) > 0) {
      button.append(element('strong','tray-value',priceText(price)),element('small','',fxFailed || fx?.stale ? 'AUD · cached rate' : 'Est. market value'));
    } else { button.append(element('small','',statusOf(e))); }
    button.addEventListener('click',() => openDetail(e.id)); tray.append(button);
  }
  tray.scrollLeft = scroll;
  if (focus && focusHost) [...($(focusHost)?.children || [])].find(node => node.dataset.entry === focus)?.focus({preventScroll:true});
  if ($('detail-view').open && focusedId) renderDetail();
  const latest = entries.find(e => e.id === $('latest-find').dataset.entry);
  if (latest && !$('latest-find').hidden) { const p = mainPrice(latest); $('latest-price').textContent = p ? priceText(p) : 'Identified'; $('latest-currency').textContent = p ? fxLabel() : 'Tap below for details'; }
}
function renderDetail() {
  const e = entries.find(e => e.id === focusedId); if (!e) return;
  const card = cardOf(e), payload = e.result?.data;
  $('detail-photo').src = showCapturedPhoto ? e.thumbnail : e.canonicalImage || e.thumbnail;
  $('toggle-photo').hidden = !e.canonicalImage; $('toggle-photo').textContent = showCapturedPhoto ? 'View catalog image' : 'View your photo'; $('detail-photo').alt = titleOf(e);
  $('detail-badge').textContent = statusOf(e);
  $('detail-title').textContent = titleOf(e);
  $('detail-set').textContent = card?.set?.name || 'YOUR CAPTURE';
  $('detail-meta').textContent = [card?.number,card?.rarity,card?.suggested_printing,payload?.read?.language].filter(Boolean).join(' · ');
  const message = e.message || payload?.message || (busyStates.has(e.status) ? 'Your result will appear here. Feel free to keep adding cards.' : e.status !== 'matched' ? 'This identification is not confirmed. Review the candidates below before using a price.' : '');
  $('detail-message').textContent = message; $('detail-message').hidden = !message;
  const prices = $('detail-prices'); prices.replaceChildren();
  const rows = e.status === 'matched' && Array.isArray(card?.prices) ? card.prices : [];
  for (const p of rows) {
    const row = element('div','price-row'), top = element('div');
    top.append(element('span','',p.printing || 'Printing unspecified'),element('strong','',priceText(p)));
    const date = p.market_price_as_of || p.last_updated_at;
    row.append(top,element('small','',[`Original quote: ${p.market_price ?? '—'} ${currencyOf(p)}${p.currency_assumed ? ' (currency assumed)' : ''}`,`Condition: ${p.condition || 'unspecified'}`,`Source: ${p.source || 'TCGPlayer via TCG API'}`,date ? `Price updated ${new Date(date).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}` : 'Price date unspecified', currencyOf(p) === 'AUD' ? 'No conversion needed' : fx?.rates?.[currencyOf(p)] ? `1 ${currencyOf(p)} = A$${(1/fx.rates[currencyOf(p)]).toFixed(4)} · ${fx.source} · ${fx.date}${fxFailed || fx.stale ? ' (cached rate)' : ''}` : 'AUD conversion unavailable'].join(' · ')));
    prices.append(row);
  }
  if (e.status === 'matched' && !rows.length) prices.append(element('p','notice','No market price was returned for this card.'));
  $('valuation-note').hidden = !rows.length;
  $('detail-warnings').replaceChildren();
  for (const warning of Array.isArray(payload?.warnings) ? payload.warnings : []) $('detail-warnings').append(element('p','notice',String(warning)));
  $('detail-raw').textContent = JSON.stringify(e.result || {status:e.status,message:e.message},null,2);
  $('raw-details').hidden = busyStates.has(e.status);
  $('remove-card').disabled = busyStates.has(e.status);
}
function openDetail(id) { focusedId = id; showCapturedPhoto = false; $('raw-details').open = false; renderDetail(); if (!$('detail-view').open) $('detail-view').showModal(); }
$('toggle-photo').onclick = () => { showCapturedPhoto = !showCapturedPhoto; renderDetail(); };
$('close-detail').onclick = () => $('detail-view').close();
$('detail-view').addEventListener('close',() => { focusedId = null; });
$('remove-card').onclick = () => {
  const entry = entries.find(e => e.id === focusedId); if (!entry || busyStates.has(entry.status)) return;
  if (!confirm('Remove this card from this device’s collection?')) return;
  entries = entries.filter(e => e.id !== focusedId); $('detail-view').close(); save(); render(); notify('Card removed.');
};

async function preparePhoto(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose JPG, PNG or WebP photos. Export HEIC photos as JPG first.');
  if (file.size > 30 * 1024 * 1024) throw new Error('This photo is too large to prepare. Choose a photo under 30 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1,2048 / Math.max(bitmap.width,bitmap.height));
    canvas.width = Math.max(1,Math.round(bitmap.width*scale)); canvas.height = Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.92));
    if (!blob || blob.size > 8*1024*1024) throw new Error('Choose a smaller photo. The prepared image exceeds 8 MB.');
    const thumb = document.createElement('canvas'), ratio = Math.min(1,360/Math.max(bitmap.width,bitmap.height));
    thumb.width = Math.max(1,Math.round(bitmap.width*ratio)); thumb.height = Math.max(1,Math.round(bitmap.height*ratio));
    thumb.getContext('2d').drawImage(bitmap,0,0,thumb.width,thumb.height);
    return {blob,thumbnail:thumb.toDataURL('image/jpeg',.72)};
  } finally { bitmap.close(); }
}
let pendingPreparation = 0;
function addFiles(files) {
  let accepted = 0;
  for (const file of files) {
    if (pendingPreparation + jobs.length + active >= 20) { notify('The queue is full. Let a few cards finish before adding more.'); break; }
    pendingPreparation++; accepted++;
    preparing = preparing.then(async() => {
      try {
        const {blob,thumbnail} = await preparePhoto(file);
        const e = {id:crypto.randomUUID(),createdAt:new Date().toISOString(),status:'queued',thumbnail};
        entries.unshift(e); sessionIds.add(e.id); jobs.push({id:e.id,blob}); save(); render(); pump();
      } catch(error) { notify(error.message || 'That photo could not be opened. Try a different image.'); }
      finally { pendingPreparation--; }
    });
  }
  if (accepted) notify(`${accepted === 1 ? 'Photo added' : accepted+' photos added'}. Keep going — we’ll find the details.`);
}
function showLatestFind(e) {
  if (!$('camera-view').open || e.status !== 'matched') return;
  const price = mainPrice(e);
  $('latest-photo').src = e.canonicalImage || e.thumbnail;
  $('latest-name').textContent = titleOf(e);
  $('latest-printing').textContent = cardOf(e)?.suggested_printing || 'Card identified';
  $('latest-price').textContent = price ? priceText(price) : 'Identified';
  $('latest-currency').textContent = price ? fxLabel() : 'Tap below for details';
  const banner = $('latest-find'); banner.dataset.entry = e.id; banner.hidden = false;
  banner.classList.remove('arrived'); void banner.offsetWidth; banner.classList.add('arrived');
  clearTimeout(latestTimer); latestTimer = setTimeout(() => { banner.hidden = true; },7000);
}
function pump() {
  while (active < 2 && jobs.length) {
    const job = jobs.shift(); active++;
    runJob(job).finally(() => { active--; render(); pump(); });
  }
}
async function cacheCanonicalImage(e) {
  const id = cardOf(e)?.tcgplayer_id;
  // Only confirmed matches get a canonical image, never a misleading candidate.
  if (e.status !== 'matched' || !/^[1-9][0-9]{0,9}$/.test(String(id || ''))) return;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(),20000);
  try {
    const response = await fetch('/api/card-image?id='+encodeURIComponent(id),{credentials:'same-origin',signal:controller.signal});
    if (!response.ok) return;
    const {thumbnail} = await preparePhoto(await response.blob());
    if (!entries.some(item => item.id === e.id)) return;
    e.canonicalImage = thumbnail;
    save(); render();
    if ($('latest-name').textContent === titleOf(e)) $('latest-photo').src = thumbnail;
  } catch { /* Keep the captured photo; image failure never changes scan results. */ }
  finally { clearTimeout(timeout); }
}
async function runJob({id,blob}) {
  const e = entries.find(entry => entry.id === id); if (!e) return;
  e.status = 'scanning'; save(); render();
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(),60000);
  try {
    const response = await fetch('/api/identify',{method:'POST',headers:{'Content-Type':blob.type},body:blob,credentials:'same-origin',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
    let result;
    try { result = await response.json(); } catch { throw new Error('The server returned an unreadable response. A scan may have been used. No retry was made.'); }
    if (!response.ok) throw new Error(result?.error?.message || `The server returned HTTP ${response.status}. No retry was made.`);
    if (!['matched','ambiguous','retake','not_found','unsupported'].includes(result?.data?.status)) throw new Error('The provider returned an unexpected result. A scan may have been used. No retry was made.');
    e.result = normalizeResult(result); e.currencyAssumed = Boolean(e.result.data.candidates?.some(c => c.prices?.some(p => p.currency_assumed))); e.status = result.data.status;
    showLatestFind(e);
    cacheCanonicalImage(e);
  } catch(error) {
    e.status = error instanceof TypeError ? 'interrupted' : 'error';
    e.message = error.name === 'AbortError' ? 'This scan timed out. It may still have used a credit. Check your provider balance before scanning again.' : error instanceof TypeError ? 'Connection interrupted. A scan may have been used. No retry was made.' : error.message;
  } finally { clearTimeout(timeout); save(); render(); }
}
async function enableCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { $('camera-help').textContent = 'Live camera is unavailable in this browser. Choose photos from your library instead.'; return; }
  const generation = ++cameraGeneration;
  $('enable-camera').disabled = true;
  try {
    const next = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1440}},audio:false});
    if (!$('camera-view').open || generation !== cameraGeneration) { next.getTracks().forEach(track => track.stop()); return; }
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = next; $('camera-video').srcObject = next; await $('camera-video').play();
    $('camera-video').hidden = false; $('camera-placeholder').hidden = true; $('viewfinder').hidden = false; $('shutter').disabled = false;
  } catch {
    $('camera-help').textContent = 'Camera access wasn’t available. You can allow it in your browser settings, or choose photos below.';
  } finally { $('enable-camera').disabled = false; }
}
function openCamera() { if (!$('camera-view').open) $('camera-view').showModal(); }
function stopCamera() {
  clearTimeout(latestTimer); $('latest-find').hidden = true;
  cameraGeneration++; if (stream) stream.getTracks().forEach(track => track.stop()); stream = null;
  $('camera-video').srcObject = null; $('camera-video').hidden = true; $('viewfinder').hidden = true; $('camera-placeholder').hidden = false; $('shutter').disabled = true;
}
$('open-camera').onclick = openCamera; $('empty-add').onclick = openCamera;
$('enable-camera').onclick = enableCamera;
function closeCamera() { stopCamera(); $('camera-view').close(); }
$('close-camera').onclick = closeCamera; $('camera-done').onclick = closeCamera;
$('camera-view').addEventListener('close',stopCamera);
$('choose-photos').onclick = () => $('photo-input').click();
$('photo-input').onchange = event => { addFiles([...event.target.files]); event.target.value = ''; };
$('shutter').onclick = async() => {
  const video = $('camera-video'); if (!stream || !video.videoWidth || video.readyState < 2) return;
  $('shutter').disabled = true;
  try {
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video,0,0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.95));
    if (blob) addFiles([new File([blob],'card.jpg',{type:'image/jpeg'})]);
    $('capture-flash').hidden = false; setTimeout(() => { $('capture-flash').hidden = true; },120);
  } finally { $('shutter').disabled = !stream; }
};
$('search').oninput = render;
for (const tab of document.querySelectorAll('.tab')) tab.onclick = () => {
  filter = tab.dataset.filter;
  for (const item of document.querySelectorAll('.tab')) { item.classList.toggle('active',item === tab); item.setAttribute('aria-pressed',String(item === tab)); }
  render();
};
$('export').onclick = () => {
  const blob = new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),entries},null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'pokesift-collection.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
};
window.addEventListener('beforeunload',event => { if (active || jobs.length || pendingPreparation) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide',stopCamera);
window.addEventListener('storage',event => {
  if (event.key === STORAGE_KEY) { readOnlyStorage = true; storageWarning('Your collection changed in another tab. Export any new cards here, then reload to see that tab’s saved collection. This tab will not overwrite it.'); }
});
try { const stored = JSON.parse(localStorage.getItem(FX_KEY)); if (validFx(stored)) { fx = stored; fxFailed = true; } } catch {}
$('fx-refresh').onclick = refreshFx;
load(); render(); refreshFx();
setInterval(refreshFx,6*3600*1000);
document.addEventListener('visibilitychange',() => { if (!document.hidden && (!fx || Date.now()-Date.parse(fx.fetchedAt || 0)>6*3600*1000)) refreshFx(); });
