{
'use strict';
const $ = s => document.querySelector(s);
const MOIS = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
const MOIS_L = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmtD = t => new Date(t).toLocaleDateString('fr-FR', {weekday:'short', day:'numeric', month:'short', year:'numeric'});
const fmtH = t => new Date(t).toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
const fmtDist = m => m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(2).replace('.', ',') + ' km';
const fmtDur = ms => { const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} h ${String(m).padStart(2,'0')}` : `${m} min`; };
const readDate = (el, orig) => { const v = el.value; if (orig && v === localInput(orig)) return orig; return new Date(v).getTime() || Date.now(); };
const localInput = t => { const d = new Date(t); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const toRad = d => d * Math.PI / 180;
function hav(a, b) { const R = 6371000, dLa = toRad(b[0] - a[0]), dLo = toRad(b[1] - a[1]); const x = Math.sin(dLa/2)**2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLo/2)**2; return 2 * R * Math.asin(Math.sqrt(x)); }
const trackDist = pts => { let d = 0; for (let i = 1; i < pts.length; i++) d += hav(pts[i-1], pts[i]); return d; };
let toastT;
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }

/* ---------- Stockage (IndexedDB) ---------- */
const DB = {
  db: null,
  open() { return new Promise((res, rej) => { const r = indexedDB.open('carnet-champi', 1);
    r.onupgradeneeded = () => { const d = r.result; for (const n of ['points','zones','traces','photos']) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, {keyPath:'id'}); };
    r.onsuccess = () => { this.db = r.result; res(); }; r.onerror = () => rej(r.error); }); },
  req(store, mode, fn) { return new Promise((res, rej) => { const q = fn(this.db.transaction(store, mode).objectStore(store)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  all(s) { return this.req(s, 'readonly', o => o.getAll()); },
  get(s, id) { return this.req(s, 'readonly', o => o.get(id)); },
  put(s, v) { return this.req(s, 'readwrite', o => o.put(v)); },
  del(s, id) { return this.req(s, 'readwrite', o => o.delete(id)); }
};
const S = { points: [], zones: [], traces: [] };
let persisted = false;
async function askPersist() { if (persisted || !navigator.storage?.persist) return; try { persisted = await navigator.storage.persist(); } catch (e) {} }

/* ---------- Photos ---------- */
const urlCache = new Map();
async function photoURL(id) { if (urlCache.has(id)) return urlCache.get(id); const p = await DB.get('photos', id); if (!p) return ''; const u = URL.createObjectURL(p.blob); urlCache.set(id, u); return u; }
function resize(file, max = 1600) {
  return new Promise(res => { const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); c.toBlob(b => res(b || file), 'image/jpeg', .82); };
    img.onerror = () => { URL.revokeObjectURL(u); res(file); }; img.src = u; });
}

/* ---------- Carte ---------- */
const ign = (layer, fmt) => L.tileLayer(`https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM&FORMAT=${fmt}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`, {maxZoom:20, maxNativeZoom:18, attribution:'© IGN Géoplateforme'});
const baseLayers = {
  'Plan IGN': ign('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'),
  'Photos aériennes IGN': ign('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'),
  'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:20, maxNativeZoom:19, attribution:'© contributeurs OpenStreetMap'})
};
let savedView = null; try { savedView = JSON.parse(localStorage.getItem('vue')); } catch (e) {}
const map = L.map('map', {zoomControl:false, attributionControl:true}).setView(savedView?.c || [43.53, 5.45], savedView?.z || 10);
let baseName = 'Plan IGN'; try { baseName = localStorage.getItem('fond') || baseName; } catch (e) {}
(baseLayers[baseName] || baseLayers['Plan IGN']).addTo(map);
const isPhoto = () => map.hasLayer(baseLayers['Photos aériennes IGN']);
const gLieux = L.layerGroup().addTo(map), gTraces = L.layerGroup().addTo(map), gZones = L.layerGroup().addTo(map), gPoints = L.layerGroup().addTo(map), gLive = L.layerGroup().addTo(map);
L.control.layers(baseLayers, {'Mes trouvailles & signets':gPoints, 'Zones « rien trouvé »':gZones, 'Mes traces':gTraces, 'Secteurs proposés':gLieux}, {position:'topright'}).addTo(map);
map.on('baselayerchange', e => { try { localStorage.setItem('fond', e.name); } catch (x) {} setTimeout(() => { drawLieux(); drawZones(); drawTraces(); }, 0); });
map.on('moveend', () => { try { localStorage.setItem('vue', JSON.stringify({c:[map.getCenter().lat, map.getCenter().lng], z:map.getZoom()})); } catch (e) {} });

const GLYPH = {
  trouve: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 12a9 7 0 0 1 18 0z"/><path d="M10 12h4v6a2 2 0 0 1-4 0z"/></svg>',
  signet: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 21V4h12l-2.5 4L18 12H8v9z"/></svg>'
};
const COL = { trouve:'#e0842a', signet:'#1f73e8' };
const icon = type => L.divIcon({className:'', html:`<div class="mk" style="background:${COL[type]}">${GLYPH[type]}</div>`, iconSize:[30,30], iconAnchor:[15,30], popupAnchor:[0,-28]});

function halo(layer, group) { // trait blanc sous la forme pour la détacher de la photo
  const o = layer.options, h = layer instanceof L.Circle ? L.circle(layer.getLatLng(), {radius:layer.getRadius()}) : layer instanceof L.Polygon ? L.polygon(layer.getLatLngs()) : L.polyline(layer.getLatLngs());
  h.setStyle({color:'#fff', weight:(o.weight || 3) + 4, opacity:.85, fill:false, interactive:false, dashArray:null}); h.addTo(group); layer.addTo(group); return layer;
}
function drawLieux() {
  gLieux.clearLayers();
  const ph = isPhoto();
  for (const l of LIEUX) halo(L.circle([l.lat, l.lng], {radius:l.rayon, color:ph ? '#ffd400' : '#8a5a12', weight:3, fillColor:ph ? '#ffd400' : '#e0a030', fillOpacity:ph ? .18 : .14, dashArray:'10 6'})
    .bindPopup(`<div class="pop"><h3>${esc(l.nom)}</h3><div class="meta">${esc(l.commune)}</div><p>${esc(l.milieu)}</p><p><b>À chercher :</b> ${esc(l.especes.join(', '))}</p><p class="meta">Secteur indicatif, position approximative.</p></div>`), gLieux);
}
function popPoint(p) {
  const ph = (p.photos || []).map(id => `<img data-ph="${id}" alt="">`).join('');
  return `<div class="pop"><h3>${esc(p.type === 'trouve' ? (p.espece || 'Trouvaille') : (p.titre || 'Signet'))}</h3>
  <div class="meta">${fmtD(p.date)} à ${fmtH(p.date)}${p.qte ? ' · ' + esc(p.qte) : ''}</div>
  ${p.note ? `<p>${esc(p.note)}</p>` : ''}${ph ? `<div class="ph">${ph}</div>` : ''}
  <div class="act"><button class="btn sm" data-act="edit" data-id="${p.id}">Modifier</button><button class="btn sm warn" data-act="del" data-id="${p.id}">Supprimer</button></div></div>`;
}
function drawPoints() { gPoints.clearLayers(); for (const p of S.points) L.marker([p.lat, p.lng], {icon:icon(p.type)}).bindPopup(() => popPoint(p), {maxWidth:280}).addTo(gPoints); }
function zoneLayer(z) {
  const ph = isPhoto(), st = {color:ph ? '#ff2d55' : '#4a4a4a', weight:3, dashArray:'6 5', fillColor:ph ? '#ff2d55' : '#6b6b6b', fillOpacity:ph ? .28 : .25};
  return z.kind === 'poly' ? L.polygon(z.latlngs, st) : L.circle(z.center, Object.assign({radius:z.radius}, st));
}
function drawZones() { gZones.clearLayers(); for (const z of S.zones) halo(zoneLayer(z).bindPopup(`<div class="pop"><h3>Rien trouvé</h3><div class="meta">${fmtD(z.date)} à ${fmtH(z.date)}</div>${z.cherche ? `<p>Cherché : ${esc(z.cherche)}</p>` : ''}${z.note ? `<p>${esc(z.note)}</p>` : ''}<div class="act"><button class="btn sm warn" data-act="delz" data-id="${z.id}">Supprimer</button></div></div>`), gZones); }
function drawTraces() {
  gTraces.clearLayers();
  for (const t of S.traces) { if (t.points.length < 2) continue;
    halo(L.polyline(t.points.map(p => [p[0], p[1]]), {color:isPhoto() ? '#b388ff' : '#6b3fa0', weight:4, opacity:.9}).bindPopup(`<div class="pop"><h3>Sortie du ${fmtD(t.start)}</h3><div class="meta">${fmtH(t.start)} – ${fmtH(t.end)} · ${fmtDur(t.end - t.start)} · ${fmtDist(t.dist || 0)}</div></div>`), gTraces); }
}
function drawAll() { drawPoints(); drawZones(); drawTraces(); }

map.on('popupopen', async e => {
  const el = e.popup.getElement(); if (!el) return;
  for (const img of el.querySelectorAll('img[data-ph]')) { img.src = await photoURL(img.dataset.ph); img.onclick = () => viewPhoto(img.src); }
  el.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
    const id = b.dataset.id; map.closePopup();
    if (b.dataset.act === 'edit') openPointForm(S.points.find(p => p.id === id));
    if (b.dataset.act === 'del' && await ask('Supprimer ce repère et ses photos ?')) await delPoint(id);
    if (b.dataset.act === 'delz' && await ask('Supprimer cette zone ?')) { await DB.del('zones', id); S.zones = S.zones.filter(z => z.id !== id); drawZones(); }
  });
});

/* ---------- GPS ---------- */
let watchId = null, lastPos = null, follow = false;
const meMarker = L.marker([0,0], {icon:L.divIcon({className:'', html:'<div class="me"></div>', iconSize:[18,18], iconAnchor:[9,9]}), interactive:false, zIndexOffset:1000});
const meAcc = L.circle([0,0], {radius:1, color:'#1f73e8', weight:1, fillOpacity:.1, interactive:false});
function startGeo() {
  if (!('geolocation' in navigator)) { toast('Ce navigateur ne donne pas accès au GPS.'); return false; }
  if (!window.isSecureContext) { toast('Le GPS exige une adresse en https:// (voir Lieux & infos > Installation).', 5000); return false; }
  if (watchId !== null) return true;
  watchId = navigator.geolocation.watchPosition(onPos, onGeoErr, {enableHighAccuracy:true, maximumAge:3000, timeout:30000});
  return true;
}
function onGeoErr(e) {
  const m = e.code === 1 ? 'Accès à la position refusé : autorisez-le dans les réglages du navigateur.' : e.code === 3 ? 'Recherche du signal GPS…' : 'Position indisponible pour le moment.';
  toast(m, 4000); if (e.code === 1) { navigator.geolocation.clearWatch(watchId); watchId = null; }
}
function onPos(p) {
  const {latitude:lat, longitude:lng, accuracy:acc} = p.coords;
  lastPos = {lat, lng, acc, t:p.timestamp || Date.now()};
  meMarker.setLatLng([lat, lng]); meAcc.setLatLng([lat, lng]).setRadius(acc);
  if (!map.hasLayer(meMarker)) { meMarker.addTo(gLive); meAcc.addTo(gLive); }
  const g = $('#gpspill'); g.hidden = false; g.textContent = `GPS ± ${Math.round(acc)} m`;
  if (follow) map.setView([lat, lng], Math.max(map.getZoom(), 16), {animate:true});
  if (rec) addTrackPoint(lastPos);
}
$('#b-loc').onclick = () => {
  if (!startGeo()) return;
  follow = !follow; $('#b-loc').classList.toggle('on', follow);
  if (follow && lastPos) map.setView([lastPos.lat, lastPos.lng], Math.max(map.getZoom(), 16));
  toast(follow ? 'La carte suit votre position' : 'Suivi de la carte arrêté');
};
map.on('dragstart', () => { if (follow) { follow = false; $('#b-loc').classList.remove('on'); } });

/* ---------- Enregistrement de la sortie ---------- */
let rec = null, recTimer = null, lastSave = 0, wakeLock = null;
const livePoly = L.polyline([], {color:'#b3202a', weight:5}).addTo(gLive);
async function wake() { try { if (navigator.wakeLock && rec) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && rec) { wake(); if (rec) DB.put('traces', rec); } else if (rec) DB.put('traces', rec); });
function addTrackPoint(p) {
  if (p.acc > 40) return;
  const pts = rec.points, ll = [+p.lat.toFixed(6), +p.lng.toFixed(6)];
  if (pts.length && hav(pts[pts.length - 1], ll) < 4) return;
  pts.push([ll[0], ll[1], p.t, Math.round(p.acc)]); livePoly.addLatLng(ll);
  if (Date.now() - lastSave > 15000) { lastSave = Date.now(); rec.dist = trackDist(pts); DB.put('traces', rec); }
}
function recUI() {
  const on = !!rec, b = $('#b-rec');
  b.className = 'mbtn ' + (on ? 'stop' : 'go');
  b.querySelector('span').textContent = on ? 'Terminer la sortie' : 'Démarrer la sortie';
  $('#recpill').hidden = !on; clearInterval(recTimer);
  if (on) { const tick = () => { $('#rectxt').textContent = `${fmtDur(Date.now() - rec.start)} · ${fmtDist(trackDist(rec.points))}`; }; tick(); recTimer = setInterval(tick, 5000); }
}
async function startRec(resume) {
  if (!startGeo()) return;
  if (!resume) rec = {id:uid(), start:Date.now(), end:null, points:[], enCours:true, dist:0};
  livePoly.setLatLngs(rec.points.map(p => [p[0], p[1]]));
  await DB.put('traces', rec); askPersist(); wake(); recUI();
  follow = true; $('#b-loc').classList.add('on');
  toast('Sortie en cours. Gardez l’appli ouverte, écran allumé, pour une trace complète.', 5000);
}
async function stopRec() {
  rec.end = Date.now(); rec.enCours = false; rec.dist = trackDist(rec.points);
  await DB.put('traces', rec);
  if (rec.points.length >= 2) S.traces.push(rec); else await DB.del('traces', rec.id);
  const n = S.points.filter(p => p.date >= rec.start && p.date <= rec.end).length;
  toast(`Sortie enregistrée : ${fmtDur(rec.end - rec.start)}, ${fmtDist(rec.dist)}, ${n} repère(s).`, 4000);
  rec = null; livePoly.setLatLngs([]); try { await wakeLock?.release(); } catch (e) {} wakeLock = null;
  drawTraces(); recUI(); renderJournal();
}
$('#b-rec').onclick = async () => { if (rec) { if (await ask('Terminer et enregistrer la sortie ?', 'Terminer')) stopRec(); } else startRec(false); };

/* ---------- Feuille (formulaires) ---------- */
const sheet = $('#sheet'), sb = $('#sheet-body');
function openSheet(html) { sb.innerHTML = html; sheet.hidden = false; sb.scrollTop = 0; }
function closeSheet() { sheet.hidden = true; sb.innerHTML = ''; }
sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
function ask(q, ok = 'Supprimer') { return new Promise(res => { openSheet(`<h2>${esc(q)}</h2><div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn" id="a-no">Annuler</button><button class="btn pri" id="a-yes">${esc(ok)}</button></div>`); $('#a-no').onclick = () => { closeSheet(); res(false); }; $('#a-yes').onclick = () => { closeSheet(); res(true); }; }); }
function viewPhoto(src) { openSheet(`<img src="${src}" style="width:100%;border-radius:12px" alt=""><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" id="vp-x">Fermer</button></div>`); $('#vp-x').onclick = closeSheet; }

let pickLL = null; // point touché longuement
map.on('contextmenu', e => { if (drawing) return; pickLL = e.latlng; openSheet(`<h2>Ajouter ici</h2><p class="muted small">${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}</p><div class="row"><button class="btn pri" data-t="trouve">J’ai trouvé</button><button class="btn" data-t="rien">Rien trouvé ici</button><button class="btn" data-t="signet">Signet</button><button class="btn" data-t="x">Annuler</button></div>`);
  sb.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { const t = b.dataset.t; closeSheet(); if (t === 'trouve' || t === 'signet') openPointForm(null, t, 'touche'); else if (t === 'rien') openZoneForm('touche'); }); });

function posChoice(def) {
  const gps = lastPos ? `Ma position GPS (± ${Math.round(lastPos.acc)} m)` : 'Ma position GPS (en attente…)';
  const opts = [['gps', gps], ['centre', 'Centre de la carte']]; if (pickLL) opts.push(['touche', 'Point touché sur la carte']);
  return `<label class="f">Emplacement<select id="f-pos">${opts.map(([v, l]) => `<option value="${v}" ${v === def ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
}
function resolvePos(v) {
  if (v === 'gps') return lastPos ? [lastPos.lat, lastPos.lng] : null;
  if (v === 'touche' && pickLL) return [pickLL.lat, pickLL.lng];
  const c = map.getCenter(); return [c.lat, c.lng];
}
function defaultPos() { return lastPos ? 'gps' : 'centre'; }

let formPhotos = [], formT0 = 0; // {id, blob?, url}
function thumbsHTML() { return formPhotos.map((p, i) => `<div><img src="${p.url}" alt=""><button data-rm="${i}" aria-label="Retirer">×</button></div>`).join(''); }
function bindPhotos() {
  const refresh = () => { $('#f-th').innerHTML = thumbsHTML(); $('#f-th').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { formPhotos.splice(+b.dataset.rm, 1); refresh(); }); };
  const add = async files => { for (const f of files) { const blob = await resize(f); formPhotos.push({id:uid(), blob, url:URL.createObjectURL(blob)}); } refresh(); };
  $('#f-cam').onchange = e => add(e.target.files); $('#f-gal').onchange = e => add(e.target.files); refresh();
}
async function openPointForm(p, type, posDef) {
  const edit = !!p; type = p?.type || type || 'trouve';
  formPhotos = []; if (edit) for (const id of p.photos || []) formPhotos.push({id, url:await photoURL(id)});
  const isT = type === 'trouve'; formT0 = p?.date || Date.now();
  openSheet(`<h2>${edit ? 'Modifier' : isT ? 'Nouvelle trouvaille' : 'Nouveau signet'}</h2>
   ${edit ? '' : posChoice(posDef || defaultPos())}
   ${isT ? `<label class="f">Espèce<input type="text" id="f-esp" list="dl-esp" value="${esc(p?.espece)}" placeholder="ex. Lactaire sanguin" autocomplete="off"></label>
   <label class="f">Quantité<select id="f-qte">${['', 'Quelques-uns', 'Une poignée', 'Un panier', 'Beaucoup (coin à retenir)'].map(q => `<option ${p?.qte === q ? 'selected' : ''}>${q}</option>`).join('')}</select></label>`
   : `<label class="f">Titre<input type="text" id="f-tit" value="${esc(p?.titre)}" placeholder="ex. Parking, coin à revoir après la pluie"></label>`}
   <label class="f">Date et heure<input type="datetime-local" id="f-date" value="${localInput(formT0)}"></label>
   <label class="f">Note<textarea id="f-note" placeholder="Milieu, arbres autour, état, à vérifier…">${esc(p?.note)}</textarea></label>
   <div class="row"><label class="btn"><input type="file" id="f-cam" class="photo-in" accept="image/*" capture="environment">Prendre une photo</label><label class="btn"><input type="file" id="f-gal" class="photo-in" accept="image/*" multiple>Depuis la galerie</label></div>
   <div class="thumbs" id="f-th"></div>
   <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" id="f-x">Annuler</button><button class="btn pri" id="f-ok">Enregistrer</button></div>`);
  bindPhotos(); $('#f-x').onclick = closeSheet;
  $('#f-ok').onclick = async () => {
    let ll = edit ? [p.lat, p.lng] : resolvePos($('#f-pos').value);
    if (!ll) { toast('Pas encore de position GPS : choisissez « Centre de la carte » ou attendez le signal.'); return; }
    const o = edit ? p : {id:uid(), type, lat:ll[0], lng:ll[1], photos:[]};
    if (!edit && $('#f-pos').value === 'gps') o.acc = Math.round(lastPos.acc);
    if (isT) { o.espece = $('#f-esp').value.trim(); o.qte = $('#f-qte').value; } else o.titre = $('#f-tit').value.trim();
    o.date = readDate($('#f-date'), formT0); o.note = $('#f-note').value.trim();
    const keep = new Set(formPhotos.map(f => f.id));
    for (const id of o.photos || []) if (!keep.has(id)) { await DB.del('photos', id); urlCache.delete(id); }
    for (const f of formPhotos) if (f.blob) { await DB.put('photos', {id:f.id, blob:f.blob}); urlCache.set(f.id, f.url); }
    o.photos = formPhotos.map(f => f.id);
    await DB.put('points', o); askPersist();
    if (!edit) S.points.push(o);
    closeSheet(); pickLL = null; drawPoints(); renderJournal(); toast(isT ? 'Trouvaille enregistrée' : 'Signet enregistré');
  };
}
async function delPoint(id) { const p = S.points.find(x => x.id === id); for (const ph of p?.photos || []) { await DB.del('photos', ph); urlCache.delete(ph); } await DB.del('points', id); S.points = S.points.filter(x => x.id !== id); drawPoints(); renderJournal(); }
$('#b-find').onclick = () => { pickLL = null; openPointForm(null, 'trouve'); };
$('#b-mark').onclick = () => { pickLL = null; openPointForm(null, 'signet'); };

/* Zones « rien trouvé » */
let drawing = null, drawPoly = null, zoneDraft = null;
function openZoneForm(posDef, poly) {
  const f = zoneDraft || {}; const zT0 = f.date || Date.now();
  openSheet(`<h2>Rien trouvé</h2>
   ${poly ? `<p class="muted">Zone dessinée : ${poly.length} sommets.</p>` : `${posChoice(posDef || defaultPos())}
   <label class="f">Forme de la zone<select id="z-r">${[25, 50, 100, 200, 500].map(r => `<option value="${r}" ${r === 50 ? 'selected' : ''}>Cercle de ${r} m autour du point</option>`).join('')}<option value="draw">Dessiner la zone sur la carte…</option></select></label>`}
   <label class="f">Ce que je cherchais<input type="text" id="z-ch" list="dl-esp" value="${esc(f.cherche)}" placeholder="ex. sanguins"></label>
   <label class="f">Date et heure<input type="datetime-local" id="z-date" value="${localInput(zT0)}"></label>
   <label class="f">Note<textarea id="z-note" placeholder="Trop sec, déjà ramassé, terrain privé…">${esc(f.note)}</textarea></label>
   <div class="row" style="justify-content:flex-end"><button class="btn" id="z-x">Annuler</button><button class="btn pri" id="z-ok">${poly ? 'Enregistrer' : 'Continuer'}</button></div>`);
  $('#z-x').onclick = () => { zoneDraft = null; closeSheet(); };
  $('#z-ok').onclick = async () => {
    const z = {id:uid(), cherche:$('#z-ch').value.trim(), date:readDate($('#z-date'), zT0), note:$('#z-note').value.trim()};
    if (poly) { z.kind = 'poly'; z.latlngs = poly; }
    else if ($('#z-r').value === 'draw') { zoneDraft = z; closeSheet(); startDraw(); return; }
    else { const ll = resolvePos($('#f-pos').value); if (!ll) { toast('Pas encore de position GPS.'); return; } z.kind = 'cercle'; z.center = ll; z.radius = +$('#z-r').value; }
    zoneDraft = null; await DB.put('zones', z); askPersist(); S.zones.push(z); closeSheet(); pickLL = null; drawZones(); renderJournal(); toast('Zone « rien trouvé » enregistrée');
  };
}
function startDraw() {
  drawing = []; map.closePopup(); map.getContainer().classList.add('drawing'); drawPoly = L.polygon([], {color:'#555', dashArray:'4 6', fillOpacity:.2}).addTo(gLive);
  $('#mapbar').hidden = true; $('#drawbar').hidden = false; $('#drawtxt').textContent = 'Touchez la carte pour poser les coins de la zone (3 minimum).';
}
function endDraw() { drawing = null; map.getContainer().classList.remove('drawing'); drawPoly?.remove(); drawPoly = null; $('#mapbar').hidden = false; $('#drawbar').hidden = true; }
map.on('click', e => { if (!drawing) return; drawing.push([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]); drawPoly.setLatLngs(drawing); $('#drawtxt').textContent = `${drawing.length} sommet(s) posé(s).`; });
$('#d-undo').onclick = () => { if (drawing?.length) { drawing.pop(); drawPoly.setLatLngs(drawing); } };
$('#d-cancel').onclick = () => { endDraw(); zoneDraft = null; };
$('#d-ok').onclick = () => { if (!drawing || drawing.length < 3) { toast('Posez au moins 3 sommets.'); return; } const poly = drawing.slice(); endDraw(); openZoneForm(null, poly); };
$('#b-none').onclick = () => { pickLL = null; zoneDraft = null; openZoneForm(); };

/* ---------- Onglets ---------- */
const VIEWS = ['carte', 'journal', 'saison', 'infos'];
function show(v) {
  if (!VIEWS.includes(v)) v = 'carte';
  for (const k of VIEWS) $('#v-' + k).classList.toggle('on', k === v);
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'carte') setTimeout(() => map.invalidateSize(), 50);
  if (v === 'saison') lazyImgs();
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => { if (location.hash !== '#' + b.dataset.v) location.hash = b.dataset.v; else show(b.dataset.v); });
window.addEventListener('hashchange', () => show(location.hash.slice(1)));
function goMap(bounds, ll) { location.hash = 'carte'; show('carte'); setTimeout(() => { if (bounds) map.fitBounds(bounds, {padding:[30, 30]}); else map.setView(ll, 17); }, 80); }

/* ---------- Journal ---------- */
let jTab = 'sorties', jFilter = '';
document.querySelectorAll('#j-seg button').forEach(b => b.onclick = () => { jTab = b.dataset.k; document.querySelectorAll('#j-seg button').forEach(x => x.classList.toggle('on', x === b)); renderJournal(); });
async function renderJournal() {
  const body = $('#j-body'); let h = '';
  if (jTab === 'sorties') {
    const tr = [...S.traces].sort((a, b) => b.start - a.start);
    if (!tr.length) h = `<div class="empty">Aucune sortie enregistrée.<br>Sur la carte, touchez « Démarrer la sortie » en arrivant sur place.</div>`;
    for (const t of tr) {
      const pts = S.points.filter(p => p.date >= t.start && p.date <= t.end), tv = pts.filter(p => p.type === 'trouve');
      const zv = S.zones.filter(z => z.date >= t.start && z.date <= t.end).length;
      const d = new Date(t.start);
      h += `<div class="card tr"><div class="big">${d.getDate()}<small>${MOIS[d.getMonth()]} ${d.getFullYear()}</small></div><div style="flex:1">
       <h3>${esc(t.nom || 'Sortie du ' + fmtD(t.start))}</h3>
       <div class="stats"><span><b>${fmtH(t.start)}–${fmtH(t.end)}</b></span><span><b>${fmtDur(t.end - t.start)}</b></span><span><b>${fmtDist(t.dist || 0)}</b></span><span><b>${tv.length}</b> trouvaille(s)</span><span><b>${zv}</b> zone(s) vide(s)</span></div>
       ${tv.length ? `<p class="small muted">${esc([...new Set(tv.map(p => p.espece || '?'))].join(', '))}</p>` : ''}
       <div class="row"><button class="btn sm" data-see="${t.id}">Voir sur la carte</button><button class="btn sm" data-ren="${t.id}">Renommer</button><button class="btn sm" data-gpx="${t.id}">GPX</button><button class="btn sm warn" data-delt="${t.id}">Supprimer</button></div></div></div>`;
    }
  } else if (jTab === 'trouv') {
    const all = S.points.filter(p => p.type === 'trouve' || p.type === 'signet').sort((a, b) => b.date - a.date);
    const list = all.filter(p => !jFilter || (p.espece + ' ' + p.titre + ' ' + p.note).toLowerCase().includes(jFilter.toLowerCase()));
    h = `<input type="search" id="j-q" placeholder="Filtrer (espèce, note…)" value="${esc(jFilter)}" style="margin-bottom:12px">`;
    const sp = {}; all.filter(p => p.type === 'trouve').forEach(p => { const k = p.espece || 'Non précisé'; sp[k] = (sp[k] || 0) + 1; });
    if (Object.keys(sp).length) h += `<p class="small muted">${Object.entries(sp).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${esc(k)} : <b>${n}</b>`).join(' · ')}</p>`;
    h += list.length ? `<div class="grid">${list.map(p => `<button class="fi" data-pt="${p.id}"><div class="th">${p.photos?.length ? `<img data-ph="${p.photos[0]}" alt="">` : (p.type === 'signet' ? 'Signet' : 'Pas de photo')}</div><div class="t"><b>${esc(p.type === 'trouve' ? (p.espece || 'Trouvaille') : (p.titre || 'Signet'))}</b><br><span class="muted">${fmtD(p.date)}</span></div></button>`).join('')}</div>` : `<div class="empty">Aucune trouvaille${jFilter ? ' pour ce filtre' : ''}.</div>`;
  } else {
    const zs = [...S.zones].sort((a, b) => b.date - a.date);
    h = zs.length ? zs.map(z => `<div class="card"><h3>${fmtD(z.date)} à ${fmtH(z.date)}</h3><p class="small muted">${z.kind === 'poly' ? 'Zone dessinée' : 'Cercle de ' + z.radius + ' m'}${z.cherche ? ' · cherché : ' + esc(z.cherche) : ''}</p>${z.note ? `<p>${esc(z.note)}</p>` : ''}<button class="btn sm" data-z="${z.id}">Voir sur la carte</button></div>`).join('') : `<div class="empty">Aucune zone « rien trouvé ».</div>`;
  }
  body.innerHTML = h;
  body.querySelectorAll('img[data-ph]').forEach(async i => i.src = await photoURL(i.dataset.ph));
  const q = $('#j-q'); if (q) q.oninput = () => { jFilter = q.value; const pos = q.selectionStart; renderJournal().then(() => { const n = $('#j-q'); n.focus(); n.setSelectionRange(pos, pos); }); };
  body.querySelectorAll('[data-see]').forEach(b => b.onclick = () => { const t = S.traces.find(x => x.id === b.dataset.see); goMap(L.latLngBounds(t.points.map(p => [p[0], p[1]]))); });
  body.querySelectorAll('[data-pt]').forEach(b => b.onclick = () => { const p = S.points.find(x => x.id === b.dataset.pt); goMap(null, [p.lat, p.lng]); });
  body.querySelectorAll('[data-z]').forEach(b => b.onclick = () => { const z = S.zones.find(x => x.id === b.dataset.z); goMap(z.kind === 'poly' ? L.latLngBounds(z.latlngs) : L.latLng(z.center).toBounds(z.radius * 2.5)); });
  body.querySelectorAll('[data-gpx]').forEach(b => b.onclick = () => { const t = S.traces.find(x => x.id === b.dataset.gpx); const pts = S.points.filter(p => p.date >= t.start && p.date <= t.end); saveFile(gpx([t], pts), `sortie-${new Date(t.start).toISOString().slice(0, 10)}.gpx`, 'application/gpx+xml'); });
  body.querySelectorAll('[data-delt]').forEach(b => b.onclick = async () => { if (!await ask('Supprimer cette trace ? (les trouvailles sont conservées)')) return; await DB.del('traces', b.dataset.delt); S.traces = S.traces.filter(x => x.id !== b.dataset.delt); drawTraces(); renderJournal(); });
  body.querySelectorAll('[data-ren]').forEach(b => b.onclick = () => { const t = S.traces.find(x => x.id === b.dataset.ren);
    openSheet(`<h2>Nom de la sortie</h2><input type="text" id="r-n" value="${esc(t.nom || '')}" placeholder="ex. Concors après l’orage"><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="r-x">Annuler</button><button class="btn pri" id="r-ok">Enregistrer</button></div>`);
    $('#r-x').onclick = closeSheet; $('#r-ok').onclick = async () => { t.nom = $('#r-n').value.trim(); await DB.put('traces', t); closeSheet(); renderJournal(); }; });
}

/* ---------- Saison ---------- */
let sMonth = new Date().getMonth() + 1, sTab = 'bons';
const ALL_ESP = [...COMESTIBLES, ...TOXIQUES];
$('#dl-esp').innerHTML = COMESTIBLES.map(e => `<option value="${esc(e.nom.replace(/ \(.*\)/, ''))}">`).join('');
document.querySelectorAll('#s-seg button').forEach(b => b.onclick = () => { sTab = b.dataset.k; document.querySelectorAll('#s-seg button').forEach(x => x.classList.toggle('on', x === b)); renderSaison(); });
function monthsBar(m) { const now = new Date().getMonth() + 1; return `<div class="months">${MOIS.map((n, i) => `<span class="${m.includes(i + 1) ? 'in' : ''} ${i + 1 === now ? 'now' : ''}">${n.slice(0, 3)}</span>`).join('')}</div>`; }
function card(e, danger) {
  return `<div class="card sp ${danger ? 'danger' : ''}"><div class="img" data-wiki="${esc(e.wiki)}"></div><div class="txt">
   <h3>${esc(e.nom)}</h3><div class="lat">${esc(e.latin)}</div>
   ${danger ? `<span class="badge ${e.gravite}">${e.gravite === 'mortel' ? 'MORTEL' : e.gravite === 'grave' ? 'Intoxication grave' : 'Toxique'}</span>` : `<span class="badge">Niveau : ${esc(e.niveau)}</span>`}
   ${monthsBar(e.mois)}
   <p class="small"><b>Où :</b> ${esc(e.habitat)}</p>
   <b class="small">Pour le reconnaître</b><ul class="small">${e.reconnaitre.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
   ${danger ? `<div class="conf"><b>Effets :</b> ${esc(e.symptomes)}</div>` : `<div class="conf"><b>Confusions :</b> ${esc(e.confusions)}</div>`}
  </div></div>`;
}
function renderSaison() {
  $('#s-mois').textContent = MOIS_L[sMonth - 1];
  $('#s-chips').innerHTML = MOIS_L.map((m, i) => `<button class="chip ${i + 1 === sMonth ? 'on' : ''}" data-m="${i + 1}">${m}</button>`).join('');
  $('#s-chips').querySelectorAll('[data-m]').forEach(b => b.onclick = () => { sMonth = +b.dataset.m; renderSaison(); });
  const on = $('#s-chips .chip.on'); if (on) $('#s-chips').scrollLeft = on.offsetLeft - 16;
  let h;
  if (sTab === 'bons') {
    const list = COMESTIBLES.filter(e => e.mois.includes(sMonth)), off = COMESTIBLES.filter(e => !e.mois.includes(sMonth));
    h = list.length ? list.map(e => card(e, false)).join('') : `<div class="empty">Peu de comestibles en ${MOIS_L[sMonth - 1]}.</div>`;
    if (off.length) h += `<details><summary>Hors saison ce mois-ci (${off.length})</summary>${off.map(e => card(e, false)).join('')}</details>`;
  } else {
    const order = {mortel:0, grave:1, toxique:2};
    const list = [...TOXIQUES].sort((a, b) => (b.mois.includes(sMonth) - a.mois.includes(sMonth)) || order[a.gravite] - order[b.gravite]);
    const n = list.filter(e => e.mois.includes(sMonth)).length;
    h = `<p class="muted small">${n} espèce(s) dangereuse(s) susceptibles de pousser en ${MOIS_L[sMonth - 1]} (en premier), puis les autres.</p>` + list.map(e => card(e, true)).join('');
  }
  $('#s-body').innerHTML = h; lazyImgs();
}
const imgMem = {};
async function tryJSON(url) { try { const r = await fetch(url, {headers:{'Accept':'application/json'}}); return r.ok ? await r.json() : null; } catch (e) { return null; } }
async function wikiImg(title) {
  if (imgMem[title] !== undefined) return imgMem[title];
  try { const c = JSON.parse(localStorage.getItem('wi2:' + title)); if (c) return imgMem[title] = c; } catch (e) {}
  let v = null;
  for (const lang of ['fr', 'en']) {
    const j = await tryJSON(`https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=pageimages|info&inprop=url&piprop=thumbnail&pithumbsize=500&titles=${encodeURIComponent(title)}`);
    const pg = j?.query?.pages && Object.values(j.query.pages)[0];
    if (pg?.thumbnail?.source) { v = {src:pg.thumbnail.source, page:pg.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`}; break; }
  }
  if (!v) for (const lang of ['fr', 'en']) {
    const j = await tryJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
    if (j?.thumbnail?.source) { v = {src:j.thumbnail.source, page:j.content_urls?.desktop?.page || ''}; break; }
  }
  if (v) { try { localStorage.setItem('wi2:' + title, JSON.stringify(v)); } catch (e) {} }
  return imgMem[title] = v;
}
const io = 'IntersectionObserver' in window ? new IntersectionObserver(ents => { for (const en of ents) if (en.isIntersecting) { io.unobserve(en.target); fillImg(en.target); } }, {rootMargin:'300px'}) : null;
async function fillImg(el) {
  const t = el.dataset.wiki, link = `https://fr.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}`;
  const fail = msg => { el.innerHTML = `<a class="nophoto" href="${link}" target="_blank" rel="noopener">${msg}<br><b>Voir les photos sur Wikipédia</b></a>`; };
  if (!navigator.onLine) { fail('Photo disponible avec une connexion.'); delete el.dataset.done; return; }
  const v = await wikiImg(t);
  if (!v) { fail('Photo introuvable.'); return; }
  const img = new Image(); img.alt = t; img.referrerPolicy = 'no-referrer';
  img.onload = () => { el.innerHTML = ''; el.appendChild(img); el.insertAdjacentHTML('beforeend', `<a href="${v.page || link}" target="_blank" rel="noopener">Photo : Wikipédia</a>`); };
  img.onerror = () => { try { localStorage.removeItem('wi2:' + t); } catch (e) {} delete imgMem[t]; fail('La photo n’a pas pu se charger.'); };
  img.src = v.src;
}
window.addEventListener('online', () => lazyImgs());
function lazyImgs() { document.querySelectorAll('#s-body .img[data-wiki]:not([data-done])').forEach(el => { el.dataset.done = 1; io ? io.observe(el) : fillImg(el); }); }

/* ---------- Infos, lieux, données ---------- */
function renderInfos() {
  $('#i-body').innerHTML = `<h1>Lieux &amp; infos</h1>
  <h2>Secteurs à explorer</h2>
  <p class="small muted">Massifs connus pour leurs milieux favorables (pinèdes, chênaies, hêtraie). Ce ne sont pas des coins garantis : positions approximatives, à affiner avec vos propres repères. Les cercles beiges sur la carte les situent.</p>
  ${LIEUX.map(l => `<div class="card"><h3>${esc(l.nom)}</h3><p class="small muted">${esc(l.commune)}</p><p class="small">${esc(l.milieu)}</p><p class="small"><b>À chercher :</b> ${esc(l.especes.join(', '))}</p><p class="small">${esc(l.conseil)}</p>
    <div class="row"><button class="btn sm" data-l="${l.id}">Voir sur la carte</button><a class="btn sm" href="https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}" target="_blank" rel="noopener">Itinéraire</a></div></div>`).join('')}
  <h2>Avant de partir</h2>
  <div class="card small"><ul style="margin:0;padding-left:18px">
    <li><b>Été (1er juin – 30 sept.)</b> : l’accès aux massifs des Bouches-du-Rhône est réglementé chaque jour selon le risque incendie. Consultez la carte de la préfecture la veille, ou le 0811 20 13 13. Rouge = accès interdit.</li>
    <li><b>Propriété</b> : les champignons appartiennent au propriétaire du terrain. En forêt publique (domaniale, communale), la cueillette familiale est tolérée, autour de <b>5 litres par personne</b> (un panier), sauf arrêté local plus strict. Revente interdite.</li>
    <li><b>Calanques</b> : dans le cœur du Parc national, cueillette uniquement pour un usage domestique, dans les quantités prévues.</li>
    <li>Prévenez un proche de votre itinéraire. Téléphone chargé, batterie externe (le GPS consomme).</li></ul></div>
  <h2>Règles d’or de la cueillette</h2>
  <div class="card small"><ul style="margin:0;padding-left:18px">
    <li>Ne cueillir que ce que l’on connaît parfaitement ; dans le doute, on laisse.</li>
    <li>Cueillir le champignon entier (base comprise : la volve peut être sous terre), en bon état, et séparer les espèces.</li>
    <li>Panier ou cagette, jamais de sac plastique.</li>
    <li>Faire contrôler la récolte par un pharmacien ou une association mycologique (l’Association mycologique d’Aix-en-Provence organise chaque automne un salon où l’on peut apporter sa récolte).</li>
    <li>Photographier la récolte avant de cuisiner : utile en cas d’intoxication. Bien cuire, manger en petite quantité, jamais aux jeunes enfants.</li></ul></div>
  <div class="alert"><b>En cas de symptômes après un repas de champignons</b> (vomissements, diarrhée, vertiges, troubles de la vue…) : centre antipoison de Marseille <a href="tel:0491752525">04 91 75 25 25</a>. Détresse grave : <a href="tel:15">15</a> ou <a href="tel:112">112</a>. Certains symptômes n’apparaissent qu’après 6 h ou plus : ne pas attendre.</div>
  <h2>Mes données</h2>
  <div class="card small" id="i-data"><p>Tout est stocké <b>sur ce téléphone uniquement</b>, dans le navigateur. Faites une sauvegarde régulière : si vous videz les données du navigateur, tout est perdu.</p>
    <p id="i-usage" class="muted"></p>
    <div class="row"><button class="btn sm pri" id="x-json">Sauvegarder tout (avec photos)</button><button class="btn sm" id="x-gpx">Exporter en GPX</button><label class="btn sm"><input type="file" id="x-imp" class="photo-in" accept=".json,application/json">Restaurer une sauvegarde</label></div></div>
  <h2>Installation sur le téléphone</h2>
  <div class="card small"><p>L’appli doit être ouverte depuis une adresse <b>https://</b> pour avoir accès au GPS (voir le fichier LISEZMOI). Ensuite : sur Android (Chrome), menu ⋮ puis « Ajouter à l’écran d’accueil » ; sur iPhone (Safari), bouton Partager puis « Sur l’écran d’accueil ».</p>
    <p><b>Limite à connaître :</b> une appli web ne peut pas enregistrer la trace quand l’écran est verrouillé ou l’appli en arrière-plan. Pendant une sortie, l’appli garde l’écran allumé si le téléphone le permet ; baissez la luminosité pour économiser la batterie.</p>
    <p>Hors réseau : l’appli s’ouvre, et les morceaux de carte déjà consultés restent visibles. Astuce : avant de partir, parcourez le secteur sur la carte avec du réseau.</p></div>
  <p class="small muted">Fonds de carte © IGN Géoplateforme, © contributeurs OpenStreetMap. Photos d’espèces : Wikipédia / Wikimedia Commons.</p>`;
  document.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { const l = LIEUX.find(x => x.id === b.dataset.l); if (!map.hasLayer(gLieux)) gLieux.addTo(map); goMap(L.latLng(l.lat, l.lng).toBounds(l.rayon * 2.2)); });
  $('#x-json').onclick = exportJSON;
  $('#x-gpx').onclick = () => saveFile(gpx(S.traces, S.points, S.zones), 'carnet-champignons.gpx', 'application/gpx+xml');
  $('#x-imp').onchange = e => e.target.files[0] && importJSON(e.target.files[0]);
  usage();
}
async function usage() { try { if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); $('#i-usage').textContent = `${S.traces.length} sortie(s), ${S.points.length} repère(s), ${S.zones.length} zone(s) · espace utilisé : ${(e.usage / 1048576).toFixed(1).replace('.', ',')} Mo${persisted ? ' · stockage protégé' : ''}`; } } catch (x) {} }

async function saveFile(content, name, type) {
  const file = new File([content], name, {type});
  try { if (navigator.canShare && navigator.canShare({files:[file]})) { await navigator.share({files:[file], title:name}); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
const xmlEsc = s => String(s ?? '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
function gpx(traces, points, zones = []) {
  const iso = t => new Date(t).toISOString();
  const w = points.map(p => `<wpt lat="${(+p.lat).toFixed(6)}" lon="${(+p.lng).toFixed(6)}"><time>${iso(p.date)}</time><name>${xmlEsc(p.type === 'trouve' ? (p.espece || 'Trouvaille') : (p.titre || 'Signet'))}</name><desc>${xmlEsc([p.qte, p.note].filter(Boolean).join(' – '))}</desc><type>${p.type}</type></wpt>`).join('\n');
  const z = zones.map(z => { const c = z.kind === 'poly' ? z.latlngs.reduce((a, b) => [a[0] + b[0] / z.latlngs.length, a[1] + b[1] / z.latlngs.length], [0, 0]) : z.center; return `<wpt lat="${c[0].toFixed(6)}" lon="${c[1].toFixed(6)}"><time>${iso(z.date)}</time><name>Rien trouvé</name><desc>${xmlEsc(z.cherche || '')}</desc><type>rien</type></wpt>`; }).join('\n');
  const t = traces.map(t => `<trk><name>${xmlEsc(t.nom || 'Sortie du ' + fmtD(t.start))}</name><trkseg>${t.points.map(p => `<trkpt lat="${p[0]}" lon="${p[1]}"><time>${iso(p[2])}</time></trkpt>`).join('')}</trkseg></trk>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Carnet de cueillette" xmlns="http://www.topografix.com/GPX/1/1">\n${w}\n${z}\n${t}\n</gpx>`;
}
const blobToData = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
async function exportJSON() {
  toast('Préparation de la sauvegarde…');
  const photos = []; for (const p of await DB.all('photos')) photos.push({id:p.id, data:await blobToData(p.blob)});
  const data = {app:'carnet-champignons', version:1, date:new Date().toISOString(), points:S.points, zones:S.zones, traces:S.traces, photos};
  saveFile(JSON.stringify(data), `carnet-champignons-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
}
async function importJSON(file) {
  try {
    const d = JSON.parse(await file.text()); if (d.app !== 'carnet-champignons') throw new Error('format');
    let n = 0;
    for (const p of d.photos || []) { const blob = await (await fetch(p.data)).blob(); await DB.put('photos', {id:p.id, blob}); }
    for (const k of ['points', 'zones', 'traces']) for (const o of d[k] || []) { await DB.put(k, o); n++; }
    await load(); toast(`${n} élément(s) restauré(s).`);
  } catch (e) { toast('Fichier de sauvegarde non reconnu.'); }
}

/* ---------- Démarrage ---------- */
async function load() {
  S.points = await DB.all('points'); S.zones = await DB.all('zones');
  const tr = await DB.all('traces'); S.traces = tr.filter(t => !t.enCours);
  drawAll(); renderJournal(); renderInfos();
  return tr.find(t => t.enCours);
}
(async () => {
  drawLieux(); renderSaison();
  try { await DB.open(); } catch (e) { toast('Stockage indisponible : les données ne seront pas conservées.', 6000); return; }
  const pending = await load();
  try { persisted = !!(await navigator.storage?.persisted?.()); } catch (e) {}
  show(location.hash.slice(1));
  if (pending) {
    openSheet(`<h2>Une sortie n’a pas été terminée</h2><p>Commencée le ${fmtD(pending.start)} à ${fmtH(pending.start)}, ${fmtDist(trackDist(pending.points))} enregistrés.</p><div class="row" style="justify-content:flex-end"><button class="btn" id="p-end">La terminer</button><button class="btn pri" id="p-go">Reprendre</button></div>`);
    $('#p-go').onclick = () => { closeSheet(); rec = pending; startRec(true); };
    $('#p-end').onclick = async () => { closeSheet(); rec = pending; rec.end = rec.points.length ? rec.points[rec.points.length - 1][2] : rec.start; rec.enCours = false; rec.dist = trackDist(rec.points); await DB.put('traces', rec); if (rec.points.length >= 2) S.traces.push(rec); else await DB.del('traces', rec.id); rec = null; drawTraces(); renderJournal(); };
  }
  if (window.isSecureContext && 'geolocation' in navigator && navigator.permissions) {
    try { const st = await navigator.permissions.query({name:'geolocation'}); if (st.state === 'granted') startGeo(); } catch (e) {}
  }
})();
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
}
