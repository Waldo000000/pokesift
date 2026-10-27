'use strict';
const $ = id => document.getElementById(id);
let previewUrl, responseText = '', running = false;
$('photo').onchange = () => {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  const file = $('photo').files[0];
  $('preview').hidden = true;
  if (file) { previewUrl = URL.createObjectURL(file); $('preview').src = previewUrl; $('preview').hidden = false; }
};
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(responseText); $('copy').textContent = 'Copied'; }
  catch { $('status').textContent = 'Copy unavailable. Expand the full response and select the text to copy it.'; }
};
function render(data) {
  const payload = data?.data || {};
  const card = payload.candidates?.[0];
  $('result').hidden = false;
  $('title').textContent = payload.status === 'matched' ? (card?.name || 'Matched card') : ('Result: ' + (payload.status || 'Response received'));
  $('identity').textContent = [payload.status !== 'matched' && card ? 'Possible candidate: ' + card.name : '',card?.set?.name,card?.number,payload.read?.language,payload.message].filter(Boolean).join(' · ');
  $('prices').replaceChildren();
  if (payload.status !== 'matched') {
    const note = document.createElement('p'); note.textContent = 'Identification is not confirmed. Inspect the candidates in the full response before using a price.'; $('prices').append(note); return;
  }
  if (card?.suggested_printing) {
    const note = document.createElement('p');
    note.textContent = 'Suggested printing: ' + card.suggested_printing + '. Confirm the finish against your card.';
    $('prices').append(note);
  }
  for (const warning of Array.isArray(payload.warnings) ? payload.warnings : []) {
    const note = document.createElement('p');
    note.textContent = String(warning);
    $('prices').append(note);
  }
  const prices = card?.prices;
  if (!Array.isArray(prices) || !prices.length) { const note = document.createElement('p'); note.textContent = 'No market prices returned for this match.'; $('prices').append(note); return; }
  for (const p of prices) {
    const row = document.createElement('div'); row.className = 'price';
    const label = document.createElement('span'); label.textContent = p.printing || 'Printing unspecified';
    const value = document.createElement('strong'); const amount = Number(p.market_price);
    value.textContent = p.market_price == null || !Number.isFinite(amount) || amount <= 0 ? 'No market price' : amount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) + (p.currency ? ' ' + p.currency : ' (currency unspecified)');
    row.append(label,value); $('prices').append(row);
    const context = document.createElement('p'); context.className = 'hint';
    context.textContent = 'Source: ' + (p.source || 'TCGPlayer (per TCG API documentation)') + ' · Condition: ' + (p.condition || 'unspecified') + ' · Catalog reference price; not an appraisal.';
    $('prices').append(context);
    if (p.market_price_as_of || p.last_updated_at) { const date = document.createElement('p'); date.className = 'hint'; date.textContent = 'Price date: ' + (p.market_price_as_of || p.last_updated_at); $('prices').append(date); }
  }
}
$('test').onsubmit = async event => {
  event.preventDefault(); if (running) return;
  const file = $('photo').files[0];
  if (!file) return;
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { $('status').textContent = 'Choose a JPG, PNG or WebP image. HEIC photos need to be exported as JPG first.'; return; }
  if (file.size > 8 * 1024 * 1024) { $('status').textContent = 'This photo exceeds 8 MB. Choose a smaller image.'; return; }
  responseText = ''; $('raw').textContent = '';
  running = true; $('run').disabled = true; $('photo').disabled = true; $('result').hidden = true; $('copy').textContent = 'Copy response';
  $('status').textContent = 'Sending one photo to TCG API. Please keep this page open…';
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(),60000);
  const start = performance.now();
  try {
    const response = await fetch('/api/identify', {method:'POST',headers:{'Content-Type':file.type},body:file,signal:controller.signal,credentials:'same-origin',redirect:'error',referrerPolicy:'no-referrer'});
    const raw = await response.text();
    responseText = raw; // The backend redacts its private API key.
    let data; try { data = JSON.parse(responseText); responseText = JSON.stringify(data,null,2); } catch {}
    $('raw').textContent = responseText;
    const elapsed = ((performance.now() - start)/1000).toFixed(1);
    if (!response.ok) { $('status').textContent = 'API returned HTTP ' + response.status + ' after ' + elapsed + 's. See the response below. No retry was made.'; $('result').hidden = false; $('title').textContent = 'API error'; $('identity').textContent = ''; $('prices').replaceChildren(); }
    else if (!data || typeof data !== 'object' || Array.isArray(data)) { $('status').textContent = 'The API returned a non-JSON response. See details below.'; $('result').hidden = false; $('title').textContent = 'Unexpected response'; $('identity').textContent = ''; $('prices').replaceChildren(); }
    else { render(data); $('status').textContent = 'Response received in ' + elapsed + 's.' + (data.meta?.scans_remaining != null ? ' Scans remaining: ' + data.meta.scans_remaining + '.' : ''); }
  } catch (error) {
    $('status').textContent = error.name === 'AbortError' ? 'The request timed out after 60 seconds. It may still have used a scan. Check your provider dashboard before retrying.' : 'The browser could not read an API response. This can be a connection problem or a backend failure. A scan may have been used; check your dashboard before retrying. PokéSift forwards requests only to TCG API.';
  } finally { clearTimeout(timeout); running = false; $('run').disabled = false; $('photo').disabled = false; }
};
window.addEventListener('pagehide',() => { if(previewUrl) URL.revokeObjectURL(previewUrl); });
