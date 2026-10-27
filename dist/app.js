'use strict';
const $ = id => document.getElementById(id);
const STORAGE_KEY = 'pokesift.collection.v1';
const FX_KEY = 'pokesift.fx.v1';
let fx = null, fxLoading = false, fxFailed = false;
const busyStates = new Set(['preparing', 'queued', 'scanning']);
const reviewStates = new Set(['ambiguous', 'retake', 'not_found', 'unsupported', 'error', 'interrupted']);
let collectionViews = null;
let entries = [], filter = 'all', active = 0, stream = null, cameraGeneration = 0;
let latestTimer, showCapturedPhoto = false;
let focusedId = null, preparing = Promise.resolve(), readOnlyStorage = false, toastTimer;
const jobs = [], sessionIds = new Set();
let priceBatch = {running:false,message:''};
let retakeId=null, retakePreparing=false, unsavedCollection=false;
let cameraZoom=1;
const CARD_ASPECT=63/88;
let pendingRemovalId=null;

function notify(message) {
  const toast = $('toast');
  // Native dialogs are in the top layer; put notifications in the active dialog.
  const host = $('detail-view').open ? $('detail-view') : $('camera-view').open ? $('camera-view') : document.body;
  host.append(toast); toast.textContent = message; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}
function storageWarning(message) { $('storage-warning').textContent = message; $('storage-warning').hidden = false; }
function save() {
  if (readOnlyStorage) {unsavedCollection=true;return false;}
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({version: 1, entries, collectionViews}));
    $('storage-warning').hidden = true;
    $('saved-note').textContent = 'Saved in this browser. No cloud sync.';
    unsavedCollection=false;
    return true;
  } catch {
    unsavedCollection=true;
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
function retainHistoricalEvidence(e) {
  if (e.result && !Array.isArray(e.providerObservations)) e.providerObservations=[{provider:'tcgapi',snapshotKind:'previously_saved_result',recordedAt:e.createdAt || null,response:structuredClone(e.result)}];
  return e;
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw);
    if (stored.version !== 1 || !Array.isArray(stored.entries) || stored.entries.some(e => !e || typeof e.id !== 'string' || typeof e.status !== 'string' || (!/^data:image\/(jpeg|png|webp);base64,/.test(e.thumbnail || '') || (e.canonicalImage && !/^data:image\/(jpeg|png|webp);base64,/.test(e.canonicalImage))))) throw new Error();
    collectionViews = stored.collectionViews || null;
    entries = stored.entries.map(retainHistoricalEvidence).map(e => ({...e, result: normalizeResult(e.result)})).map(e => ({...e, currencyAssumed: Boolean(e.result?.data?.candidates?.some(c => c.prices?.some(p => p.currency_assumed)))})).map(e => busyStates.has(e.status) ? {...e, status: 'interrupted', message: 'The page closed before this result arrived. A scan may have been used. Check your provider balance before taking another photo.'} : e);
  } catch {
    readOnlyStorage = true;
    storageWarning('Saved collection could not be opened. Existing storage has been left untouched. New cards stay in memory; export them before leaving.');
  }
}
const cardOf = e => e.catalogMatch?.card || e.result?.data?.candidates?.[0];
const readOf = e => e.result?.data?.read || {};
function identityOf(e) {
  const card = cardOf(e) || {}, read = readOf(e);
  return e.status === 'matched'
    ? {name:card.name || read.name, number:card.number || read.number, set:card.set?.name || read.set}
    : {name:read.name || card.name, number:read.number || card.number, set:read.set || card.set?.name};
}
const titleOf = e => identityOf(e).name || (busyStates.has(e.status) ? 'Finding your card…' : e.status === 'retake' ? 'A clearer photo needed' : 'Saved card');
const statusOf = e => ({preparing:'Preparing photo',queued:'In the queue',scanning:'Identifying…',matched:'Identified',ambiguous:'Check the match',retake:'Retake suggested',not_found:'Saved from photo',unsupported:'Saved from photo',error:'Scan failed',interrupted:'Scan interrupted'}[e.status] || 'To review');
function languageOf(e) {
  const language = readOf(e).language;
  if (!language) return '';
  if (language === 'other') return 'Language not identified';
  return language.replace(/_/g,' ').replace(/^./,letter=>letter.toUpperCase());
}
function valueLabel(e) {
  const price = mainPrice(e);
  if (price) return priceText(price);
  if (busyStates.has(e.status)) return '';
  return availablePrices(e).length ? 'AUD unavailable' : 'Value unknown';
}
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
  if (price?.market_price == null || !Number.isFinite(Number(price.market_price)) || Number(price.market_price) <= 0) return 'Value unknown';
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
function availablePrices(e) {
  return e.status === 'matched' && Array.isArray(cardOf(e)?.prices)
    ? cardOf(e).prices.filter(p => p.market_price != null && Number.isFinite(Number(p.market_price)) && Number(p.market_price) > 0) : [];
}
// Identify the quote by its printing/condition/source, not its changing amount or position.
const priceKey = p => JSON.stringify([p.printing || '',p.condition || '',currencyOf(p),p.source || '',p.variant || '',p.grading || null]);
function chosenPrice(e) { return availablePrices(e).find(p => priceKey(p) === e.selectedPriceKey); }
function mainPrice(e) {
  const prices = availablePrices(e), chosen = chosenPrice(e);
  if (chosen) return chosen;
  if (!prices.length) return null;
  // Same-currency quotes can still be ranked while exchange rates are unavailable.
  const sameCurrency = prices.every(p => currencyOf(p) === currencyOf(prices[0]));
  if (!sameCurrency && prices.some(p => audAmount(p) === null)) return null;
  const amount = p => sameCurrency ? Number(p.market_price) : audAmount(p);
  return prices.reduce((lowest,p) => amount(p) < amount(lowest) ? p : lowest);
}
function priceBasis(e) {
  if (availablePrices(e).length < 2) return '';
  return chosenPrice(e) ? 'Your selection' : mainPrice(e) ? 'Lowest estimate' : '';
}

function render() {
  window.PokeSiftViews?.refresh();
  renderBulkPrices();
  const inProgress = entries.filter(e => busyStates.has(e.status)).length;
  $('fx-refresh').textContent = fxLabel() + ' ↻'; $('fx-refresh').disabled = fxLoading;
  const transientPhotos = mediaRecords(entries).some(e => e.scanPhoto && !e.scanPhoto.persisted);
  $('photo-storage-warning').hidden = !transientPhotos;
  $('photo-storage-warning').textContent = 'Some scan-quality photos could not be saved on this device. Back up your collection before closing this page to keep them for future recognition services.';
  $('all-count').textContent = entries.length;
  $('review-count').textContent = entries.filter(e => reviewStates.has(e.status)).length;
  $('activity').hidden = !inProgress;
  $('activity').textContent = `${inProgress} ${inProgress === 1 ? 'card is' : 'cards are'} coming into focus. You can keep adding or browse below.`;
  $('empty').hidden = entries.length > 0;
  $('export').hidden = entries.length === 0;
  const query = $('search').value.trim().toLowerCase();
  const shown = entries.filter(e => (filter !== 'review' || reviewStates.has(e.status)) && (!query || [titleOf(e),identityOf(e).number,identityOf(e).set,cardOf(e)?.rarity,languageOf(e)].filter(Boolean).join(' ').toLowerCase().includes(query)));
  $('no-results').hidden = entries.length === 0 || shown.length !== 0;
  // Preserve keyboard focus when background results rebuild the grid/tray.
  const focus = document.activeElement?.dataset?.entry;
  const focusHost = document.activeElement?.closest('#card-grid,#result-tray')?.id;
  const grid = $('card-grid'); grid.replaceChildren();
  for (const e of shown) {
    const button = element('button','card-tile'); button.dataset.entry = e.id; button.setAttribute('aria-label', `${titleOf(e)}, ${valueLabel(e) || statusOf(e)}`);
    const photo = element('div','card-image'); photo.append(imageOf(e),badge(e)); button.append(photo);
    button.append(element('h3','',titleOf(e)),element('p','card-sub',identityOf(e).set || statusOf(e)));
    const bottom = element('div','card-bottom');
    const value = element('span','card-price',valueLabel(e));
    bottom.append(value,element('span','card-number',identityOf(e).number || '')); button.append(bottom);
    if (priceBasis(e)) button.append(element('small','price-basis',priceBasis(e)));
    button.addEventListener('click',() => openDetail(e.id));
    if(e.catalogMatch || e.status==='retake') {
      const wrapper=element('div','catalog-tile');wrapper.append(button);
      if(e.catalogMatch)wrapper.append(catalogLink(e));
      if(e.status==='retake') {const retake=element('button','text-button retake-button','Retake photo ↗');retake.disabled=readOnlyStorage;retake.onclick=()=>startRetake(e.id);wrapper.append(retake);}
      grid.append(wrapper);
    } else grid.append(button);
  }
  const recent = entries.filter(e => sessionIds.has(e.id));
  $('session-count').textContent = recent.length;
  $('session-empty').hidden = recent.length > 0;
  $('queue-state').textContent = inProgress ? `${inProgress} in progress` : recent.length ? 'All caught up' : 'Ready when you are';
  const tray = $('result-tray'); const scroll = tray.scrollLeft; tray.replaceChildren();
  for (const e of recent) {
    const button = element('button','tray-card'); button.dataset.entry = e.id; button.setAttribute('aria-label', `${titleOf(e)}, ${valueLabel(e) || statusOf(e)}`);
    button.append(imageOf(e),element('span','',titleOf(e)));
    const price = mainPrice(e);
    if (price && Number(price.market_price) > 0) {
      button.append(element('strong','tray-value',priceText(price)),element('small','',priceBasis(e) || (fxFailed || fx?.stale ? 'AUD · cached rate' : 'Est. market value')));
    } else { button.append(element('small','',valueLabel(e) || statusOf(e))); }
    button.addEventListener('click',() => openDetail(e.id));
    if(e.catalogMatch){const wrapper=element('div','catalog-tray-card');wrapper.append(button,catalogLink(e));tray.append(wrapper);}else tray.append(button);
  }
  tray.scrollLeft = scroll;
  if (focus && focusHost) [...($(focusHost)?.querySelectorAll('[data-entry]') || [])].find(node => node.dataset.entry === focus)?.focus({preventScroll:true});
  if ($('detail-view').open && focusedId) renderDetail();
  const latest = entries.find(e => e.id === $('latest-find').dataset.entry);
  if (latest && !$('latest-find').hidden) { const p = mainPrice(latest); $('latest-price').textContent = valueLabel(latest); $('latest-printing').textContent = p?.printing || identityOf(latest).number || statusOf(latest); $('latest-currency').textContent = p ? [priceBasis(latest),fxLabel()].filter(Boolean).join(' · ') : 'Tap below for details'; }
}
function renderDetail() {
  const e = entries.find(e => e.id === focusedId); if (!e) return;
  window.PokeSiftViews?.renderSpecies(e);
  const card = cardOf(e), payload = e.result?.data;
  $('detail-photo').src = showCapturedPhoto ? e.thumbnail : e.canonicalImage || e.thumbnail;
  $('toggle-photo').hidden = !e.canonicalImage; $('toggle-photo').textContent = showCapturedPhoto ? 'View catalog image' : 'View your photo'; $('detail-photo').alt = titleOf(e);
  $('detail-image-note').textContent = e.canonicalImage && !showCapturedPhoto ? `Catalog image · ${e.catalogMatch ? 'PikaQian' : 'TCGPlayer'}` : e.status === 'matched' ? 'Your photo' : 'Your photo · no verified catalog image';
  $('detail-badge').textContent = statusOf(e);
  $('retake-card').hidden=e.status!=='retake';$('retake-card').disabled=readOnlyStorage;
  $('detail-title').textContent = titleOf(e);
  $('detail-set').textContent = identityOf(e).set || 'YOUR CAPTURE';
  $('detail-meta').textContent = [identityOf(e).number,card?.rarity,card?.suggested_printing || readOf(e).finish,readOf(e).stamp,languageOf(e)].filter(Boolean).join(' · ');
  const message = e.status === 'unsupported' ? 'This printing is outside the current pricing catalog. Your photo and the details read from it are saved. Its value is unknown; we haven’t substituted a price from another language.' : e.message || (e.catalogMatch ? '' : payload?.message) || (busyStates.has(e.status) ? 'Your result will appear here. Feel free to keep adding cards.' : e.status !== 'matched' ? 'This identification is not confirmed. Review the candidates below before using a price.' : '');
  $('detail-message').textContent = message; $('detail-message').hidden = !message;
  const prices = $('detail-prices'); prices.replaceChildren();
  const rows = e.status === 'matched' && Array.isArray(card?.prices) ? card.prices : [];
  const choices = availablePrices(e), picker = $('valuation-choice');
  $('valuation-choice-group').hidden = choices.length < 2;
  picker.replaceChildren();
  const automatic = element('option','','Automatic · lowest available value'); automatic.value = ''; picker.append(automatic);
  for (const p of choices) {
    const option = element('option','',[p.printing || 'Printing unspecified',p.condition,priceText(p)].filter(Boolean).join(' · '));
    option.value = priceKey(p); picker.append(option);
  }
  picker.value = chosenPrice(e) ? e.selectedPriceKey : '';
  $('valuation-choice-note').textContent = chosenPrice(e) ? 'Your choice is used throughout your collection.' : 'Until you choose, we show the lowest available estimate. This does not confirm the printing.';
  for (const p of rows) {
    const row = element('div','price-row'), top = element('div');
    top.append(element('span','',p.printing || 'Printing unspecified'),element('strong','',priceText(p)));
    const date = p.market_price_as_of || p.last_updated_at;
    row.append(top,element('small','',[`Original quote: ${p.market_price ?? '—'} ${currencyOf(p)}${p.currency_assumed ? ' (currency assumed)' : ''}`,`Condition: ${p.condition || 'unspecified'}`,`Source: ${p.source || 'TCGPlayer via TCG API'}`,date ? `Price updated ${new Date(date).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}` : 'Price date unspecified', currencyOf(p) === 'AUD' ? 'No conversion needed' : fx?.rates?.[currencyOf(p)] ? `1 ${currencyOf(p)} = A$${(1/fx.rates[currencyOf(p)]).toFixed(4)} · ${fx.source} · ${fx.date}${fxFailed || fx.stale ? ' (cached rate)' : ''}` : 'AUD conversion unavailable'].join(' · ')));
    prices.append(row);
  }
  if (!rows.length && !busyStates.has(e.status)) {
    const row = element('div','price-row'), top = element('div');
    top.append(element('span','','Valuation'),element('strong','','Unknown'));
    row.append(top,element('small','',e.status === 'matched' ? 'No price was returned for this printing.' : 'No verified price for this exact printing. Unknown does not mean worthless.'));
    prices.append(row);
  }
  $('valuation-note').hidden = !rows.length;
  renderEnrichment(e);
  $('detail-warnings').replaceChildren();
  for (const warning of Array.isArray(payload?.warnings) ? payload.warnings : []) $('detail-warnings').append(element('p','notice',String(warning)));
  $('detail-raw').textContent = JSON.stringify({result:e.result || {status:e.status,message:e.message},providerObservations:e.providerObservations || [],catalogMatch:e.catalogMatch || null,scanHistory:e.scanHistory || [],scanPhoto:e.scanPhoto || {quality:'thumbnail_only',note:'Scan-quality photo was not retained for this older entry.'}},null,2);
  $('raw-details').hidden = busyStates.has(e.status);
  renderRemoval(e);
}
$('valuation-choice').onchange = event => {
  const e = entries.find(e => e.id === focusedId); if (!e) return;
  if (event.target.value) e.selectedPriceKey = event.target.value;
  else delete e.selectedPriceKey;
  save(); render();
};
function openDetail(id) { pendingRemovalId=null;focusedId = id; showCapturedPhoto = false; $('raw-details').open = false; renderDetail(); if (!$('detail-view').open) $('detail-view').showModal(); }
$('toggle-photo').onclick = () => { showCapturedPhoto = !showCapturedPhoto; renderDetail(); };
$('close-detail').onclick = () => $('detail-view').close();
$('detail-view').addEventListener('close',() => { focusedId = null;pendingRemovalId=null; });
function renderRemoval(entry) {
  const confirming=pendingRemovalId===entry.id;
  $('remove-card').hidden=confirming;
  $('remove-card').disabled=busyStates.has(entry.status) || readOnlyStorage;
  $('remove-card').setAttribute('aria-expanded',String(confirming));
  $('remove-confirmation').hidden=!confirming;
  $('remove-confirm-title').textContent='Remove '+titleOf(entry)+'?';
  $('confirm-remove-card').disabled=busyStates.has(entry.status) || readOnlyStorage;
}
function cancelRemoval() {
  pendingRemovalId=null;
  const entry=entries.find(e=>e.id===focusedId);if(entry)renderRemoval(entry);
  $('remove-card').focus();
}
$('keep-card').onclick=cancelRemoval;
$('detail-view').addEventListener('cancel',event=>{if(pendingRemovalId){event.preventDefault();cancelRemoval();}});
$('remove-card').onclick = () => {
  const entry=entries.find(e=>e.id===focusedId);if(!entry || busyStates.has(entry.status) || readOnlyStorage)return;
  pendingRemovalId=entry.id;$('remove-error').hidden=true;renderRemoval(entry);
  $('remove-confirmation').scrollIntoView({block:'nearest'});$('keep-card').focus({preventScroll:true});
};
$('confirm-remove-card').onclick=()=>{
  const entry=entries.find(e=>e.id===pendingRemovalId);
  if(!entry || entry.id!==focusedId || busyStates.has(entry.status) || readOnlyStorage)return;
  const previous=entries;entries=entries.filter(e=>e.id!==entry.id);
  if(!save()) {
    entries=previous;$('remove-error').textContent='Could not save this change. Your card and photos have been kept. Please try again.';$('remove-error').hidden=false;return;
  }
  for(const id of [entry.id,...(entry.scanHistory || []).map(h=>h.id)])PokeSiftPhotos.remove(id);
  pendingRemovalId=null;$('detail-view').close();render();notify('Card removed.');
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
function addFiles(files, capture=null) {
  const replacingId=retakeId;
  if(replacingId) {if(retakePreparing)return;files=files.slice(0,1);}
  for (const file of files) {
    if (pendingPreparation + jobs.length + active >= 20) { notify('The queue is full. Let a few cards finish before adding more.'); break; }
    if(replacingId)retakePreparing=true;
    pendingPreparation++;
    preparing = preparing.then(async() => {
      try {
        const {blob,thumbnail} = await preparePhoto(file);
        if(readOnlyStorage)throw new Error('Another tab changed the collection. Reload before retaking or adding cards.');
        let e;
        if(replacingId) {
          e=entries.find(item=>item.id===replacingId);
          if(!e || e.status!=='retake')throw new Error('This card changed. Open it again before retaking.');
          retainHistoricalEvidence(e);
          const oldPhoto=await PokeSiftPhotos.get(e.id),history={id:crypto.randomUUID(),thumbnail:e.thumbnail,capturedAt:e.lastCapturedAt || e.createdAt,result:structuredClone(e.result || null),capture:e.capture || null};
          if(oldPhoto)history.scanPhoto={id:history.id,mime:oldPhoto.type,bytes:oldPhoto.size,quality:'exact_upload',persisted:await PokeSiftPhotos.put(history.id,oldPhoto)};
          else if(e.scanPhoto)history.scanPhoto={...e.scanPhoto,id:history.id,persisted:false};
          e.scanHistory=[...(e.scanHistory || []),history];e.lastCapturedAt=new Date().toISOString();
          e.status='queued';e.thumbnail=thumbnail;e.message='';
          delete e.result;delete e.catalogMatch;delete e.enrichment;delete e.priceCheck;delete e.selectedPriceKey;delete e.canonicalImage;
        } else e={id:crypto.randomUUID(),createdAt:new Date().toISOString(),status:'queued',thumbnail};
        const persisted = await PokeSiftPhotos.put(e.id,blob);
        e.scanPhoto = {id:e.id,mime:blob.type,bytes:blob.size,quality:'exact_upload',persisted};
        e.capture=capture ? structuredClone(capture) : {source:'photo_library'};
        if(!replacingId)entries.unshift(e);
        else {retakeId=null;renderRetakeMode();}
        sessionIds.add(e.id); jobs.push({id:e.id,blob}); save(); render(); pump();
      } catch(error) { notify(error.message || 'That photo could not be opened. Try a different image.'); }
      finally { pendingPreparation--;if(replacingId)retakePreparing=false; }
    });
  }
}
function showLatestFind(e) {
  if (!$('camera-view').open || !['matched','unsupported','not_found','ambiguous'].includes(e.status)) return;
  const price = mainPrice(e);
  $('latest-photo').src = e.canonicalImage || e.thumbnail;
  $('latest-name').textContent = titleOf(e);
  $('latest-source').hidden=!e.catalogMatch;
  if(e.catalogMatch)$('latest-source').href='https://pikaqian.com/cards/'+encodeURIComponent(e.catalogMatch.card.provider_id);
  $('latest-heading').textContent = e.status === 'matched' ? 'JUST FOUND' : 'SAVED FROM PHOTO';
  $('latest-printing').textContent = price?.printing || identityOf(e).number || statusOf(e);
  $('latest-price').textContent = valueLabel(e);
  $('latest-currency').textContent = price ? [priceBasis(e),fxLabel()].filter(Boolean).join(' · ') : 'Tap below for details';
  const banner = $('latest-find'); banner.dataset.entry = e.id; banner.hidden = false;
  banner.classList.remove('arrived'); void banner.offsetWidth; banner.classList.add('arrived');
  clearTimeout(latestTimer); latestTimer = setTimeout(() => { banner.hidden = true; },7000);
}
let lastScanStart=0,pumpTimer;
function pump() {
  clearTimeout(pumpTimer);
  while (active < 2 && jobs.length) {
    const delay=550-(Date.now()-lastScanStart);if(delay>0){pumpTimer=setTimeout(pump,delay);return;}lastScanStart=Date.now();
    const job = jobs.shift(); active++;
    runJob(job).finally(() => { active--; render(); pump(); });
  }
}
async function cacheCanonicalImage(e) {
  const card = cardOf(e), id = card?.tcgplayer_id;
  if (e.status !== 'matched') return;
  const chinese = e.catalogMatch?.card?.provider_id;
  if (!chinese && !/^[1-9][0-9]{0,9}$/.test(String(id || ''))) return;
  const url = chinese ? '/api/pikaqian-image?id='+encodeURIComponent(chinese) : '/api/card-image?id='+encodeURIComponent(id);
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(),20000);
  try {
    const response = await fetch(url,{credentials:'same-origin',signal:controller.signal});
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
    e.providerObservations = [...(e.providerObservations || []),{provider:'tcgapi',operation:'identify',receivedAt:new Date().toISOString(),snapshotKind:'provider_response',parameters:{game:'pokemon',include:'prices'},response:structuredClone(result)}];
    e.result = normalizeResult(result); e.currencyAssumed = Boolean(e.result.data.candidates?.some(c => c.prices?.some(p => p.currency_assumed))); e.status = result.data.status;
    showLatestFind(e);
    cacheCanonicalImage(e);
    if (canEnrich(e)) enrichCard(e);
  } catch(error) {
    e.status = error instanceof TypeError ? 'interrupted' : 'error';
    e.message = error.name === 'AbortError' ? 'This scan timed out. It may still have used a credit. Check your provider balance before scanning again.' : error instanceof TypeError ? 'Connection interrupted. A scan may have been used. No retry was made.' : error.message;
  } finally { clearTimeout(timeout); save(); render(); }
}
const enriching = new Set();
function canEnrich(e) {
  const read = readOf(e);
  return Boolean((e.catalogMatch || ['unsupported','not_found','ambiguous'].includes(e.status)) && read.name && /^\d{1,4}(?:\/\d{1,4})?$/.test(read.number || '') && (!read.game || read.game === 'pokemon'));
}
function applyCatalogMatch(e, candidate, confirmedBy, loadImage=true) {
  e.catalogMatch = {card:candidate.card,confirmedBy,confirmedAt:new Date().toISOString()};
  e.status = 'matched'; e.message = ''; e.currencyAssumed = false; delete e.selectedPriceKey;
  if(candidate.previewImage)e.canonicalImage=candidate.previewImage;else delete e.canonicalImage;
  e.enrichment.status = 'matched';
  save(); render(); showLatestFind(e); if(loadImage && !e.canonicalImage)cacheCanonicalImage(e);
}
function storeCatalogResult(e, result, loadImages=true) {
  e.enrichment = {...structuredClone(result),checkedAt:new Date().toISOString()};
  e.providerObservations = [...(e.providerObservations || []),...result.candidates.map(c=>structuredClone(c.observation))];
  const previous = e.enrichment.candidates.find(c=>c.card.provider_id===e.catalogMatch?.card.provider_id);
  if (previous) {
    e.catalogMatch.card = previous.card; e.currencyAssumed=false; e.enrichment.status='matched';
    if(loadImages)cacheCanonicalImage(e);
  } else if (result.status === 'matched' && result.candidates.length === 1) applyCatalogMatch(e,e.enrichment.candidates[0],'catalog_fields',loadImages);
  else if(loadImages && result.status==='review')e.enrichment.candidates.forEach(candidate=>previewCatalogCandidate(e,candidate));
}
async function enrichCard(e) {
  if (enriching.has(e.id)) return;
  enriching.add(e.id); render();
  const controller = new AbortController(), timeout = setTimeout(()=>controller.abort(),45000);
  try {
    const response = await fetch('/api/enrich',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({read:readOf(e)}),credentials:'same-origin',signal:controller.signal});
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error?.message || 'Chinese catalog lookup unavailable.');
    if (!Array.isArray(result.candidates) || !['matched','review','not_found'].includes(result.status)) throw new Error('Chinese catalog returned an unexpected response.');
    if (!entries.some(item=>item.id===e.id)) return;
    storeCatalogResult(e,result);
  } catch(error) {
    e.enrichment = {...e.enrichment,status:'unavailable',message:error.name==='AbortError'?'Chinese catalog lookup timed out. Your card is saved.':error.message};
  } finally {clearTimeout(timeout);enriching.delete(e.id);save();render();}
}
const PRICE_BATCH_LIMIT=25, PRICE_PAUSE_MS=2000, NO_SALES_COOLDOWN=24*3600*1000;
function priceCardId(e) {
  const id=e.catalogMatch?.card?.provider_id;
  return e.status==='matched' && ['user','catalog_fields'].includes(e.catalogMatch?.confirmedBy) && e.catalogMatch?.card?.provider==='pikaqian' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id || '') ? id : null;
}
function catalogLookupKey(e) {
  if(e.catalogMatch || !canEnrich(e))return null;
  const read=readOf(e);
  return 'catalog:'+JSON.stringify(['game','name','number','set','language','finish','stamp','kind'].map(k=>read[k] || ''));
}
function pendingCatalogReview(e) {return !e.catalogMatch && e.enrichment?.status==='review' && e.enrichment.candidates?.length>0;}
function missingPriceGroups() {
  const groups=new Map();
  // Share a healthy no-sales result across duplicate copies, including after reload.
  const recent=new Set(entries.filter(e=>e.priceCheck?.status==='no_sales' && Date.now()-Date.parse(e.priceCheck.checkedAt)<NO_SALES_COOLDOWN).map(priceCardId).filter(Boolean));
  const recentCatalog=new Set(entries.filter(e=>e.enrichment?.status==='not_found' && Date.now()-Date.parse(e.enrichment.checkedAt)<NO_SALES_COOLDOWN).map(catalogLookupKey).filter(Boolean));
  for(const e of entries) {
    const id=priceCardId(e) || catalogLookupKey(e);
    if(!id || availablePrices(e).length || enriching.has(e.id) || pendingCatalogReview(e) || recent.has(id) || recentCatalog.has(id))continue;
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push(e.id);
  }
  return groups;
}
function renderBulkPrices() {
  const count=missingPriceGroups().size;
  const reviewCount=entries.filter(pendingCatalogReview).length;
  $('bulk-pricing').hidden=false;
  $('update-missing-prices').disabled=priceBatch.running || !count || readOnlyStorage;
  $('update-missing-prices').textContent=priceBatch.running?'Updating missing prices…':'Update missing prices'+(count?' ('+count+')':'');
  $('stop-price-update').hidden=!priceBatch.running;
  $('stop-price-update').disabled=Boolean(priceBatch.stop);
  $('stop-price-update').textContent=priceBatch.stop?'Stopping after current lookup…':'Stop update';
  $('bulk-price-status').textContent=priceBatch.message || (count ? count+' saved card lookups ready. Older unrecognized cards are included when their name and number were saved.' : !entries.length ? 'Add cards to your collection to get started.' : reviewCount ? reviewCount+' cards need a printing confirmed. Open them in To review and choose “This is my printing”.' : 'No eligible updates. Cards need a saved name and number or a confirmed Chinese match. No-match and no-sales results wait 24 hours.');
}
function stopPriceBatch() {
  if(!priceBatch.running)return;
  priceBatch.stop=true;priceBatch.wake?.();renderBulkPrices();
}
function priceBatchSummary(batch) {
  return `${batch.checked} of ${batch.total} printings checked · ${batch.updated} cards priced · ${batch.review} need review · ${batch.notFound} not found · ${batch.noSales} with no recorded price · ${batch.errors} errors.`;
}
async function updateMissingPrices() {
  if(priceBatch.running || readOnlyStorage)return;
  const pending=[...missingPriceGroups()].slice(0,PRICE_BATCH_LIMIT);if(!pending.length)return;
  const batch=priceBatch={running:true,stop:false,checked:0,total:pending.length,updated:0,review:0,notFound:0,noSales:0,errors:0,consecutive:0,message:'Starting price update…'};
  render();
  try {
    for(const [cardId,ids] of pending) {
      if(batch.stop || readOnlyStorage || document.hidden || document.body.dataset.auth!=='signed-in')break;
      const catalog=cardId.startsWith('catalog:');
      const targets=()=>entries.filter(e=>ids.includes(e.id) && (priceCardId(e) || catalogLookupKey(e))===cardId && !availablePrices(e).length && !enriching.has(e.id) && !pendingCatalogReview(e));
      if(!targets().length)continue;
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),catalog?45000:15000);
      let shouldStop=false;
      try {
        const response=await fetch(catalog?'/api/enrich':'/api/pikaqian-prices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(catalog?{read:readOf(targets()[0])}:{cardId}),credentials:'same-origin',signal:controller.signal});
        let result;try{result=await response.json();}catch{throw new Error('Unreadable pricing response.');}
        if(!response.ok) {
          const error=new Error(result?.error?.message || 'Price lookup failed.');
          error.stop=[401,403,429].includes(response.status) || ['auth_required','not_configured','rate_limited','tier_required','circuit_open'].includes(result?.error?.code);
          throw error;
        }
        if(catalog) {
          if(!Array.isArray(result.candidates) || !['matched','review','not_found'].includes(result.status) || (result.status==='matched' && result.candidates.length!==1) || result.candidates.some(c=>c.card?.provider!=='pikaqian' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(c.card?.provider_id || '') || !c.observation))throw new Error('Unexpected catalog response.');
          const changed=targets();
          for(const e of changed) {
            storeCatalogResult(e,result,false);
            if(availablePrices(e).length)batch.updated++;
            if(result.status==='review')batch.review++;
            if(result.status==='not_found')batch.notFound++;
            if(priceCardId(e) && e.catalogMatch.card.pricing_status==='no_sales') {
              e.priceCheck={provider:'pikaqian',status:'no_sales',checkedAt:e.enrichment.checkedAt};batch.noSales++;
            }
          }
          if(!save()){batch.reason='Stopped because this browser could not save changes. Back up before leaving.';shouldStop=true;}
          // Save identity first; one canonical image can serve duplicate copies.
          if(!shouldStop && !batch.stop && !document.hidden && changed[0]?.catalogMatch) {
            await cacheCanonicalImage(changed[0]);
            for(const e of changed.slice(1))if(changed[0].canonicalImage)e.canonicalImage=changed[0].canonicalImage;
          }
          const pricingError=result.pricingError || (result.candidates.some(c=>c.card.pricing_status==='plan_required')?'tier_required':result.candidates.some(c=>c.card.pricing_status==='unavailable')?'unavailable':null);
          if(pricingError) {
            if(!save()){batch.reason='Stopped because this browser could not save changes. Back up before leaving.';shouldStop=true;}
            const error=new Error(pricingError==='tier_required'?'Card details saved. PikaQian pricing requires Hobby or above.':'Card details saved, but PikaQian pricing is unavailable.');
            error.stop=shouldStop || ['auth_required','not_configured','rate_limited','tier_required','circuit_open'].includes(pricingError);throw error;
          }
        } else {
        if((result.pricingStatus==='no_sales' && result.prices?.length) || result.cardId!==cardId || !['available','no_sales'].includes(result.pricingStatus) || !Array.isArray(result.prices) || !result.observation || !Number.isFinite(Date.parse(result.checkedAt)) || (result.pricingStatus==='available' && !result.prices.some(p=>p.currency==='USD' && Number.isFinite(p.market_price) && p.market_price>0)))throw new Error('Unexpected pricing response.');
        for(const e of targets()) {
          const card=e.catalogMatch.card;
          card.prices=result.prices.map(p=>({...p,printing:card.suggested_printing || p.printing}));card.pricing_status=result.pricingStatus;
          e.priceCheck={provider:'pikaqian',status:result.pricingStatus,checkedAt:result.checkedAt};
          e.providerObservations=[...(e.providerObservations || []),structuredClone(result.observation)];
          e.currencyAssumed=false;
          if(result.pricingStatus==='available')batch.updated++;
        }
        if(result.pricingStatus==='no_sales')batch.noSales++;
        }
        batch.consecutive=0;
        if(!save()){batch.reason='Stopped because this browser could not save changes. Back up before leaving.';shouldStop=true;}
      }catch(error) {
        batch.errors++;batch.consecutive++;
        shouldStop=shouldStop || Boolean(error.stop) || error.name==='AbortError' || batch.consecutive>=3 || batch.errors>=5;
        if(shouldStop)batch.reason=error.name==='AbortError'?'Stopped after a timeout; no retry was made.':error.stop?'Stopped. '+error.message:'Stopped after repeated errors; no retries were made.';
      }finally{clearTimeout(timeout);batch.checked++;batch.message=priceBatchSummary(batch);render();}
      if(shouldStop || batch.stop)break;
      if(batch.checked<batch.total)await new Promise(resolve=>{const timer=setTimeout(()=>{batch.wake=null;resolve();},PRICE_PAUSE_MS);batch.wake=()=>{clearTimeout(timer);batch.wake=null;resolve();};});
    }
  }finally {
    batch.running=false;batch.wake=null;
    const reason=batch.reason || (batch.stop || batch.checked<batch.total?'Stopped. Completed results are saved.':'Finished.');
    batch.message=reason+' '+priceBatchSummary(batch);render();
  }
}
$('update-missing-prices').onclick=updateMissingPrices;
$('stop-price-update').onclick=stopPriceBatch;
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPriceBatch();});
window.addEventListener('pagehide',stopPriceBatch);
const previewingCandidates=new WeakSet();
async function previewCatalogCandidate(e,candidate) {
  if(previewingCandidates.has(candidate))return;
  previewingCandidates.add(candidate);
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
  try {
    const response=await fetch('/api/pikaqian-image?id='+encodeURIComponent(candidate.card.provider_id),{credentials:'same-origin',signal:controller.signal});
    if(!response.ok)return;
    const {thumbnail}=await preparePhoto(await response.blob());
    if(!entries.includes(e) || !e.enrichment?.candidates?.includes(candidate))return;
    candidate.previewImage=thumbnail;save();
    if(focusedId===e.id && $('detail-view').open)renderEnrichment(e);
  }catch{ /* A missing preview never confirms a match or changes the user's card. */ }
  finally{clearTimeout(timeout);}
}
function catalogLink(e) {
  const link=element('a','catalog-source','Data from PikaQian ↗');
  link.href='https://pikaqian.com/cards/'+encodeURIComponent(e.catalogMatch.card.provider_id);link.target='_blank';link.rel='noopener noreferrer';return link;
}
function renderEnrichment(e) {
  const button=$('check-catalog'), state=e.enrichment;
  button.hidden=!canEnrich(e);button.disabled=enriching.has(e.id) || priceBatch.running;
  button.textContent=enriching.has(e.id)?'Checking Chinese catalog…':e.catalogMatch?'Refresh Chinese card details':'Check Chinese catalog';
  const pricing=e.catalogMatch?.card?.pricing_status;
  const priceMessage={plan_required:'Value unknown · PikaQian API pricing requires the Hobby plan or above.',no_sales:'Value unknown · no recorded raw-card price at PikaQian.',unavailable:'PikaQian pricing is temporarily unavailable.'}[pricing];
  $('catalog-status').textContent=enriching.has(e.id)?'Looking up saved details. No photo scan is used.':state?.status==='review'?'Possible Chinese printing found. Check the set, number and stamp before choosing.':state?.status==='not_found'?'No matching Chinese printing found in the accessible catalog.':state?.status==='unavailable'?state.message:priceMessage || '';
  const source=$('catalog-source');source.hidden=!e.catalogMatch;
  if(e.catalogMatch)source.href='https://pikaqian.com/cards/'+encodeURIComponent(e.catalogMatch.card.provider_id);
  const candidates=$('catalog-candidates');candidates.replaceChildren();
  if(state?.status!=='review')return;
  for(const candidate of state.candidates || []) {
    const card=candidate.card,box=element('div','catalog-candidate');
    if(!candidate.previewImage)previewCatalogCandidate(e,candidate);
    if(/^data:image\/(jpeg|png|webp);base64,/.test(candidate.previewImage || '')){const image=element('img','catalog-preview');image.src=candidate.previewImage;image.alt='Possible '+card.name+' printing — not yet confirmed';box.append(image);}
    box.append(element('strong','',card.name),element('p','',[card.set?.name,card.set?.id,card.number,card.suggested_printing,'Simplified Chinese'].filter(Boolean).join(' · ')));
    const link=element('a','catalog-source','View card at PikaQian ↗');link.href='https://pikaqian.com/cards/'+encodeURIComponent(card.provider_id);link.target='_blank';link.rel='noopener noreferrer';box.append(link);
    const choose=element('button','light-button','This is my printing');
    choose.onclick=()=>applyCatalogMatch(e,candidate,'user');box.append(choose);candidates.append(box);
  }
}
$('check-catalog').onclick=()=>{const e=entries.find(e=>e.id===focusedId);if(e)enrichCard(e);};
function cameraCrop(width,height,zoom=cameraZoom) {
  if(!Number.isFinite(width) || !Number.isFinite(height) || width<1 || height<1)throw new Error('Wait for the camera preview before capturing.');
  const cropWidth=Math.min(width,height*CARD_ASPECT)/Math.max(1,Math.min(3,zoom));
  const cropHeight=cropWidth/CARD_ASPECT;
  return {x:(width-cropWidth)/2,y:(height-cropHeight)/2,width:cropWidth,height:cropHeight};
}
function renderCameraFraming() {
  const stage=$('camera-crop').parentElement;
  // Leave room beside the portrait preview for touch-sized zoom controls.
  const width=Math.max(1,Math.min(stage.clientWidth-76,(stage.clientHeight-16)*CARD_ASPECT));
  $('camera-crop').style.width=width+'px';$('camera-crop').style.height=(width/CARD_ASPECT)+'px';
  $('camera-video').style.transform=`scale(${cameraZoom})`;
  $('crop-zoom-value').textContent=cameraZoom.toFixed(2).replace(/\.?0+$/,'')+'×';
  $('crop-zoom-in').disabled=cameraZoom>=3;$('crop-zoom-out').disabled=cameraZoom<=1;
}
$('crop-zoom-in').onclick=()=>{cameraZoom=Math.min(3,cameraZoom+.25);renderCameraFraming();};
$('crop-zoom-out').onclick=()=>{cameraZoom=Math.max(1,cameraZoom-.25);renderCameraFraming();};
new ResizeObserver(renderCameraFraming).observe($('camera-crop').parentElement);
async function enableCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { $('camera-help').textContent = 'Live camera is unavailable in this browser. Choose photos from your library instead.'; return; }
  const generation = ++cameraGeneration;
  $('enable-camera').disabled = true;
  try {
    const next = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1440}},audio:false});
    if (!$('camera-view').open || generation !== cameraGeneration) { next.getTracks().forEach(track => track.stop()); return; }
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = next; $('camera-video').srcObject = next; await $('camera-video').play();
    $('camera-crop').hidden=false;$('camera-framing').hidden=false;renderCameraFraming();
    $('camera-video').hidden = false; $('camera-placeholder').hidden = true; $('viewfinder').hidden = false; $('shutter').disabled = false;
  } catch {
    $('camera-help').textContent = 'Camera access wasn’t available. You can allow it in your browser settings, or choose photos below.';
  } finally { $('enable-camera').disabled = false; }
}
function renderRetakeMode() {
  $('photo-input').multiple=!retakeId;
  $('retake-note').hidden=!retakeId;
  $('retake-note').textContent=retakeId?'Retake this card · the next photo updates its saved entry and uses one scan.':'';
}
function startRetake(id) {
  if(readOnlyStorage || !entries.some(e=>e.id===id && e.status==='retake'))return;
  retakeId=id;
  if($('detail-view').open)$('detail-view').close();
  openCamera();if(!stream)enableCamera();
}
$('retake-card').onclick=()=>startRetake(focusedId);
function openCamera() { renderRetakeMode();if (!$('camera-view').open) $('camera-view').showModal(); }
function stopCamera() {
  retakeId=null;renderRetakeMode();
  clearTimeout(latestTimer); $('latest-find').hidden = true;
  cameraGeneration++; if (stream) stream.getTracks().forEach(track => track.stop()); stream = null;
  $('camera-video').srcObject = null; $('camera-video').hidden = true; $('viewfinder').hidden = true; $('camera-placeholder').hidden = false; $('shutter').disabled = true;
  $('camera-crop').hidden=true;$('camera-framing').hidden=true;
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
    const crop=cameraCrop(video.videoWidth,video.videoHeight);
    const capture={source:'camera',sourceWidth:video.videoWidth,sourceHeight:video.videoHeight,zoom:cameraZoom,crop};
    const canvas = document.createElement('canvas');canvas.width=Math.max(1,Math.round(crop.width));canvas.height=Math.max(1,Math.round(crop.height));
    canvas.getContext('2d').drawImage(video,crop.x,crop.y,crop.width,crop.height,0,0,canvas.width,canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.95));
    if (blob) addFiles([new File([blob],'card.jpg',{type:'image/jpeg'})],capture);
    $('capture-flash').hidden = false; setTimeout(() => { $('capture-flash').hidden = true; },120);
  } catch(error) {notify(error.message || 'Could not capture this photo. Try again when the camera is ready.');
  } finally { $('shutter').disabled = !stream; }
};
$('search').oninput = render;
for (const tab of document.querySelectorAll('.tab')) tab.onclick = () => {
  filter = tab.dataset.filter;
  for (const item of document.querySelectorAll('.tab')) { item.classList.toggle('active',item === tab); item.setAttribute('aria-pressed',String(item === tab)); }
  render();
};
function mediaRecords(list) {return list.flatMap(e=>[e,...(e.scanHistory || [])]);}
$('export').onclick = async() => {
  const button=$('export');button.disabled=true;button.textContent='Preparing backup…';
  try {
    const snapshot=structuredClone(entries), scanImages=Object.create(null), missingScanImages=[];
    for(const e of mediaRecords(snapshot)) {
      const source=await PokeSiftPhotos.get(e.id);
      if(source)scanImages[e.id]=await PokeSiftPhotos.dataURL(source);
      else if(e.scanPhoto)missingScanImages.push(e.id);
    }
    const backup={format:'pokesift-backup',backupVersion:4,version:1,exportedAt:new Date().toISOString(),entries:snapshot,scanImages,missingScanImages,exchangeRates:fx,collectionViews:structuredClone(collectionViews)};
    const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='pokesift-collection.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    if(missingScanImages.length)notify(`${missingScanImages.length} scan photos were unavailable. Their saved thumbnails and card details are included.`);
  }catch{notify('Backup could not be created. Keep this page open and try again.');}
  finally{button.disabled=false;button.textContent='Back up collection ↗';}
};
function validateBackup(value) {
  if (!value || value.version !== 1 || (value.backupVersion !== undefined && ![1,2,3,4].includes(value.backupVersion)) || !Array.isArray(value.entries) || value.entries.length > 1000) throw new Error('Unsupported or oversized backup. Choose a PokéSift JSON backup.');
  const statuses = new Set([...busyStates,...reviewStates,'matched']);
  const imageOK = image => typeof image === 'string' && image.length <= 2*1024*1024 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image);
  for (const e of value.entries) {
    if (!e || typeof e.id !== 'string' || !e.id.length || e.id.length > 100 || ['__proto__','constructor','prototype'].includes(e.id) || !statuses.has(e.status) || !imageOK(e.thumbnail) || (e.canonicalImage && !imageOK(e.canonicalImage))) throw new Error('This backup contains an invalid card entry. Nothing was imported.');
    if (e.result) {
      const candidates=e.result.data?.candidates ?? [];
      if (!e.result.data || typeof e.result.data !== 'object' || !Array.isArray(candidates) || candidates.length > 20 || candidates.some(c=>!c || typeof c !== 'object' || Array.isArray(c) || (c.prices !== undefined && (!Array.isArray(c.prices) || c.prices.some(p=>!p || typeof p !== 'object' || Array.isArray(p)))))) throw new Error('This backup contains invalid card results. Nothing was imported.');
    }
  }
  if (value.scanImages !== undefined && (!value.scanImages || typeof value.scanImages !== 'object' || Array.isArray(value.scanImages))) throw new Error('Invalid scan images in backup.');
  const ids=new Set(value.entries.map(e=>e.id));
  for(const e of value.entries) {
    if(e.scanHistory!==undefined && (!Array.isArray(e.scanHistory) || e.scanHistory.length>1000))throw new Error('Invalid capture history in backup.');
    for(const h of e.scanHistory || []) {
      if(!h || typeof h.id!=='string' || !h.id.length || h.id.length>100 || ['__proto__','constructor','prototype'].includes(h.id) || ids.has(h.id) || !imageOK(h.thumbnail))throw new Error('Invalid capture history in backup.');
      ids.add(h.id);
    }
  }
  for(const [id,image] of Object.entries(value.scanImages || {})) { if(!ids.has(id))throw new Error('Backup photo has no matching card.');PokeSiftPhotos.decode(image); }
  return value;
}
$('import-backup').onclick = () => $('backup-file').click();
$('backup-file').onchange = async event => {
  const file=event.target.files[0]; event.target.value=''; if (!file) return;
  try {
    if (active || jobs.length || pendingPreparation || priceBatch.running) throw new Error('Let current scans and price updates finish before restoring a backup.');
    if (file.size > 250*1024*1024) throw new Error('This backup exceeds the 250 MB import limit.');
    const backup=validateBackup(JSON.parse(await file.text())), seen=new Set(entries.map(e=>e.id));
    const added=[]; let skipped=0;
    for (const original of backup.entries) {
      const e=retainHistoricalEvidence(original);
      if (seen.has(e.id)) { skipped++; continue; }
      seen.add(e.id);
      const result=normalizeResult(e.result);
      added.push({...e,result,currencyAssumed:Boolean(result?.data?.candidates?.some(c=>c.prices?.some(p=>p.currency_assumed))),
        ...(busyStates.has(e.status)?{status:'interrupted',message:'This scan was unfinished when backed up. It has not been resubmitted.'}:{})});
    }
    const missingMedia=[],records=mediaRecords([...added,...entries]);
    for(const id of Object.keys(backup.scanImages || {})) { if(records.some(e=>e.id===id) && !await PokeSiftPhotos.get(id))missingMedia.push(id); }
    const restoreViews=Boolean(backup.collectionViews&&(!collectionViews||added.length));
    if (!added.length && !missingMedia.length && !restoreViews) { notify('All cards in this backup are already in your collection.'); return; }
    if (!confirm(`Restore ${added.length} cards and ${missingMedia.length} scan photos? ${skipped} duplicate entries will be skipped. Existing cards stay unchanged. Saved arrangements are included when available. No scans will be used.`)) return;
    for(const id of missingMedia) {
      const blob=PokeSiftPhotos.decode(backup.scanImages[id]), persisted=await PokeSiftPhotos.put(id,blob);
      const e=records.find(e=>e.id===id);
      e.scanPhoto={id,mime:blob.type,bytes:blob.size,quality:'exact_upload',persisted};
    }
    for(const e of mediaRecords(added)) { if(e.scanPhoto && !await PokeSiftPhotos.get(e.id))e.scanPhoto={...e.scanPhoto,persisted:false}; }
    const previousIds=entries.map(e=>e.id);entries=[...added,...entries];
    if(backup.collectionViews&&window.PokeSiftViews){
      const incoming=PokeSiftViews.sanitizeLayout(backup.collectionViews,entries.map(e=>e.id));
      if(!previousIds.length||!collectionViews)collectionViews=incoming;
      else {const current=PokeSiftViews.sanitizeLayout(collectionViews,previousIds),addedIds=new Set(added.map(e=>e.id)),placed=new Set();incoming.slots.forEach((id,i)=>{if(addedIds.has(id)&&!current.slots[i]){while(current.slots.length<=i)current.slots.push(null);current.slots[i]=id;placed.add(id);}});incoming.piles.forEach((pile,i)=>{for(const id of pile)if(addedIds.has(id)&&!placed.has(id)){current.piles[i].push(id);placed.add(id);}});for(const [id,position] of Object.entries(incoming.positions))if(!current.positions[id])current.positions[id]=position;collectionViews=PokeSiftViews.sanitizeLayout(current);}
    }
    if (validFx(backup.exchangeRates) && (!fx || backup.exchangeRates.date > fx.date)) {
      fx=backup.exchangeRates; fxFailed=true;
      try { localStorage.setItem(FX_KEY,JSON.stringify(fx)); } catch {}
    }
    const saved=save(); render();
    notify(saved ? `${added.length} cards and ${missingMedia.length} scan photos restored. No scans used.` : 'Cards restored in memory. Export them before leaving; browser storage is full.');
  } catch(error) { notify(error instanceof SyntaxError ? 'That file is not a valid JSON backup. Nothing was imported.' : error.message); }
};
window.addEventListener('beforeunload',event => { if (active || jobs.length || pendingPreparation || priceBatch.running || unsavedCollection || PokeSiftPhotos.hasTransient()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide',stopCamera);
window.addEventListener('storage',event => {
  if (event.key === STORAGE_KEY) { stopPriceBatch(); readOnlyStorage = true; storageWarning('Your collection changed in another tab. Export any new cards here, then reload to see that tab’s saved collection. This tab will not overwrite it.');window.PokeSiftViews?.refresh(); }
});
let initialized = false;
function initializeCollection() {
  if (initialized) { refreshFx(); return; }
  initialized = true;
  try { const stored = JSON.parse(localStorage.getItem(FX_KEY)); if (validFx(stored)) { fx = stored; fxFailed = true; } } catch {}
  $('fx-refresh').onclick = refreshFx;
  load(); render(); refreshFx();
  setInterval(() => { if (document.body.dataset.auth === 'signed-in') refreshFx(); },6*3600*1000);
  document.addEventListener('visibilitychange',() => { if (!document.hidden && document.body.dataset.auth === 'signed-in' && (!fx || Date.now()-Date.parse(fx.fetchedAt || 0)>6*3600*1000)) refreshFx(); });
}
window.addEventListener('pokesift:authenticated',initializeCollection);
window.addEventListener('pokesift:unauthorized',() => { stopPriceBatch(); stopCamera(); for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close(); });
if (document.body.dataset.auth === 'signed-in') initializeCollection();
