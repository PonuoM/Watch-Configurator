"use strict";

// Initial parts are empty; all data should come from Supabase/local storage
let PARTS = {};

const IMG_BASE = "./assets/";
// Default watermark image (placed in ./watermark)
const WATERMARK_IMAGE = "./watermark/b5693b3604dbf7fa4561ba0b99474a55.png";

// Catalog of SKUs -> parts; start empty and merge with localStorage admin data
const DEFAULT_CATALOG = {};

function loadCatalogFromStorage() {
  try {
    const raw = localStorage.getItem('watchCatalog');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) { return null; }
}

let CATALOG = { ...DEFAULT_CATALOG, ...(loadCatalogFromStorage() || {}) };
let currentSKU = Object.keys(CATALOG)[0] || null;
PARTS = (currentSKU && CATALOG[currentSKU]) ? CATALOG[currentSKU] : PARTS;
let MASTER_GROUP_LIST = []; // Will be loaded from Supabase

async function loadPartGroups(client) {
  const { data, error } = await client.from('part_groups').select('key, name_th, name_en, sort_order, z_index').order('sort_order');
  if (error) {
    console.error('Error loading part groups:', error);
    // Fallback to a hardcoded list if the table doesn't exist or fails to load
    MASTER_GROUP_LIST = ['bracelet','outer','inner','dial','hands','second'].map((k, idx) => ({ 
      key: k, 
      name_en: k, 
      name_th: k, 
      sort_order: idx + 1,
      z_index: idx + 1 
    }));
  } else {
    MASTER_GROUP_LIST = data;
  }
}

async function maybeLoadCatalogFromSupabase() {
  try {
    // Use the singleton client instead of creating a new one
    const client = getSupabaseClient();
    if (!client) return false;
    
    // Load part groups first
    await loadPartGroups(client);

    // Fetch SKUs and assets (include created_at for admin list)
    const { data: skus, error: e1 } = await client
      .from('skus')
      .select('id,name,created_at')
      .order('name', { ascending: true });
    if (e1) return false;
    const { data: assets, error: e2 } = await client
      .from('assets')
      .select('sku_id, group_key, label, url, sort')
      .order('sort', { ascending: true });
    if (e2) return false;
    // Debug logs to help diagnose missing images in the browser console
    try { console.debug('supabase skus:', skus); console.debug('supabase assets (sample 10):', assets && assets.slice(0,10)); } catch(e){}
    // Transform â†' CATALOG shape (support arbitrary group_key values)
    const toEmpty = () => ({});
    const cat = {};
    skus.forEach(s => { cat[s.id] = { __name: s.name || s.id, __created_at: s.created_at || null }; });
    assets.forEach(a => {
      const sku = a.sku_id; const g = a.group_key;
      if (!cat[sku]) cat[sku] = { __name: sku };
      if (!cat[sku][g]) cat[sku][g] = [];
      // avoid duplicates: if an asset with same url already pushed, skip
      const url = normalizeUrl(a.url || '');
      const already = cat[sku][g].some(item => normalizeUrl(item.dataUrl || '') === url || (item.file && a.file && item.file === a.file));
      if (already) return;
      const idx = cat[sku][g].length + 1;
      cat[sku][g].push({ label: a.label || `${g} ${idx}`, file: null, dataUrl: url });
    });
    // Debug: log counts per SKU/group to help diagnose cross-SKU contamination
    try {
      const summary = Object.entries(cat).map(([sku, parts]) => {
        const groups = Object.keys(parts).filter(k => k !== '__name');
        const counts = {};
        groups.forEach(g => { counts[g] = (parts[g] || []).length; });
        return { sku, name: parts.__name || sku, counts };
      });
      console.debug('catalog summary (post-load):', summary);
    } catch (e) { /* ignore */ }
    // Merge to CATALOG
    CATALOG = { ...DEFAULT_CATALOG, ...cat };
    currentSKU = Object.keys(cat)[0] || currentSKU || null;
    PARTS = (currentSKU && CATALOG[currentSKU]) ? CATALOG[currentSKU] : PARTS;
  // Diagnostic: detect assets whose URL contains a different sku id than the sku_id field
  // More precise check: look for /watch-assets/{sku}/ pattern specifically
  try {
    const mismatches = [];
    Object.entries(cat).forEach(([sku, parts]) => {
      Object.entries(parts || {}).forEach(([g, arr]) => {
        if (g === '__name') return;
        (arr || []).forEach((it) => {
          if (!it || !it.dataUrl) return;
          const url = it.dataUrl;
          // Precise heuristic: look for /watch-assets/{sku}/ or /storage/v1/object/public/watch-assets/{sku}/
          const m = url.match(/\/watch-assets\/([^/]+)\//);
          if (m && m[1] && m[1] !== sku) {
            mismatches.push({ expectedSku: sku, foundInUrl: m[1], group: g, url });
          }
        });
      });
    });
    if (mismatches.length) {
      console.warn('Detected asset->SKU mismatches (in watch-assets path):', mismatches.slice(0,20));
      console.info('Run SQL to inspect: SELECT id, sku_id, group_key, url FROM public.assets WHERE url LIKE \'%/' + mismatches[0].foundInUrl + '/%\' LIMIT 50;');
    }
  } catch (e) { /* ignore diagnostics errors */ }
    return true;
  } catch (_) { return false; }
}

function getGroupsFromCatalog(partsObj) {
  const keys = Object.keys(partsObj || {});
  // Exclude internal metadata keys (prefix '__') from group list
  return keys.filter(k => !String(k).startsWith('__'));
}

function getGroupsOrdered(partsObj) {
  const defaultOrder = ['bracelet','outer','inner','dial','hands','second'];
  const groups = getGroupsFromCatalog(partsObj);
  const ordered = [];
  defaultOrder.forEach(g => { if (groups.includes(g)) ordered.push(g); });
  groups.forEach(g => { if (!ordered.includes(g)) ordered.push(g); });
  return ordered;
}

// Singleton Supabase client to avoid multiple instances
let _supabaseClient = null;
let _isCreatingClient = false;

function getSupabaseClient() {
  // Return existing client if already created
  if (_supabaseClient) return _supabaseClient;
  
  // Prevent race condition - if already creating, wait and return null (caller should retry)
  if (_isCreatingClient) {
    console.warn('Supabase client is being created, please retry');
    return null;
  }
  
  const hasKeys = !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY);
  const hasSDK = !!(window.supabase && window.supabase.createClient);
  if (!hasKeys || !hasSDK) return null;
  
  try {
    _isCreatingClient = true;
    // Create client only once and cache it
    _supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
    console.log('Supabase client created successfully (singleton)');
    return _supabaseClient;
  } catch (e) {
    console.error('Failed to create Supabase client:', e);
    return null;
  } finally {
    _isCreatingClient = false;
  }
}

function $(id) {
  return document.getElementById(id);
}

// Normalize public URLs to compare reliably (strip query string/fragment, trailing slash)
function normalizeUrl(u) {
  try {
    if (!u) return '';
    const url = new URL(u);
    url.search = '';
    url.hash = '';
    let s = url.toString();
    // remove trailing slash
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch (e) {
    // fallback: strip ? and # manually
    if (!u) return '';
    return u.split('?')[0].split('#')[0].replace(/\/+$/,'');
  }
}

// ---- Asset metadata (local) helpers: store extra fields per asset URL ----
function getAssetMetaMap() {
  try { const raw = localStorage.getItem('watchAssetMeta'); return raw ? JSON.parse(raw) : {}; } catch (_) { return {}; }
}
function setAssetMeta(url, patch) {
  const key = normalizeUrl(url || '');
  if (!key) return;
  const m = getAssetMetaMap();
  m[key] = { ...(m[key] || {}), ...(patch || {}) };
  try { localStorage.setItem('watchAssetMeta', JSON.stringify(m)); } catch (_) {}
}
function getAssetMeta(url) {
  const key = normalizeUrl(url || '');
  const m = getAssetMetaMap();
  return m[key] || {};
}

// Subcategory list per (sku|group) so admin can predefine options
function getSubcatListKey(sku, groupKey) { return `${sku}__${groupKey}`; }
function getSubcatList(sku, groupKey) {
  try { const raw = localStorage.getItem('watchSubcategoryList'); const obj = raw ? JSON.parse(raw) : {}; return obj[getSubcatListKey(sku, groupKey)] || []; } catch (_) { return []; }
}
function saveSubcatList(sku, groupKey, arr) {
  try { const raw = localStorage.getItem('watchSubcategoryList'); const obj = raw ? JSON.parse(raw) : {}; obj[getSubcatListKey(sku, groupKey)] = Array.from(new Set(arr.filter(Boolean))); localStorage.setItem('watchSubcategoryList', JSON.stringify(obj)); } catch (_) {}
}
function unionSubcatsFromMeta(sku, groupKey) {
  const items = (CATALOG[sku] && CATALOG[sku][groupKey]) ? CATALOG[sku][groupKey] : [];
  const set = new Set();
  items.forEach(it => { const url = it.dataUrl || (it.file ? (IMG_BASE + it.file) : ''); const sc = (getAssetMeta(url) || {}).subcategory; if (sc) set.add(String(sc)); });
  return Array.from(set);
}

// Loading overlay helpers
function showLoading(show) {
  const el = document.getElementById('loading-overlay');
  if (!el) return;
  el.style.display = show ? 'flex' : 'none';
}

// Safe close for admin overlay: if original showAdmin exists use it, else hide overlay element if present
function closeAdminIfOverlayExists() {
  try {
    if (typeof showAdmin === 'function') { showAdmin(false); return; }
  } catch (e) { /* ignore */ }
  const overlay = document.getElementById('admin-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
  }
}

// Preload images for a given SKU (resolve when all loaded or after timeout)
function preloadImagesForSKU(skuKey, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const parts = CATALOG[skuKey] || {};
    const urls = [];
    Object.keys(parts).forEach((k) => {
      if (String(k).startsWith('__')) return;
      const arr = Array.isArray(parts[k]) ? parts[k] : [];
      arr.forEach((it) => {
        const src = it && it.dataUrl ? it.dataUrl : (it && it.file ? (IMG_BASE + it.file) : null);
        if (src) urls.push(src);
      });
    });
    if (!urls.length) return resolve();
    let remaining = urls.length;
    const onDone = () => {
      remaining--;
      if (remaining <= 0) resolve();
    };
    urls.forEach((u) => {
      const im = new Image();
      im.onload = onDone;
      im.onerror = onDone;
      // attempt to load
      try { im.src = u; } catch (e) { onDone(); }
    });
    // safety timeout
    setTimeout(() => resolve(), timeoutMs);
  });
}

function setLayerSrc(layerId, fileName) {
  const el = $(layerId);
  if (!el) return;
  if (!fileName) {
    el.src = "";
    el.style.visibility = 'hidden';
    return;
  }
  el.src = IMG_BASE + fileName;
  el.style.visibility = 'visible';
}

function setLayerFromItem(layerId, item) {
  const el = $(layerId);
  if (!el) return;
  if (!item) { el.src = ""; el.style.visibility = 'hidden'; return; }
  const src = item.dataUrl ? item.dataUrl : (item.file ? (IMG_BASE + item.file) : "");
  if (!src) { el.src = ""; el.style.visibility = 'hidden'; return; }
  el.src = src;
  el.style.visibility = 'visible';
}

function renderGrid(gridId, items, groupKey, state) {
  const grid = $(gridId);
  if (!grid) return;
  grid.innerHTML = "";
  // Filter items so we only show items that belong to currentSKU when they come from storage URLs
  const filtered = (items || []).filter((it) => {
    try {
      if (it && it.dataUrl) {
        // if url contains another sku path, skip unless it appears to belong to currentSKU
        const url = normalizeUrl(it.dataUrl || '');
        // if url clearly includes another sku id segment ("/sku-id/"), ensure it matches currentSKU
        const match = url.match(/\/(?:storage|[^/]+)\/([^/]+)\//);
        // simple heuristic: if url contains currentSKU somewhere, accept; if it contains a different sku id segment, skip
        if (url.includes('/' + currentSKU + '/')) return true;
        if (match && match[1] && !url.includes('/' + currentSKU + '/')) {
          console.warn(`Skipping asset in group ${groupKey} because URL appears to belong to different SKU:`, url);
          return false;
        }
        // otherwise accept (could be external host without sku path)
        return true;
      }
    } catch (e) { /* ignore and include */ }
    return true;
  });
  // Apply subcategory filter if present
  try {
    const sub = (window.SUB_FILTERS && window.SUB_FILTERS[groupKey]) || 'all';
    if (sub && sub !== 'all') {
      const meta = getAssetMetaMap();
      const n = (u) => normalizeUrl(u||'');
      const arr = filtered.filter((it) => {
        const url = it.dataUrl ? it.dataUrl : (it.file ? (IMG_BASE + it.file) : '');
        const sc = (meta[n(url)] || {}).subcategory || '';
        return sc === sub;
      });
      filtered.length = 0; Array.prototype.push.apply(filtered, arr);
    }
  } catch (_) {}
  
  filtered.forEach((it, idx) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "thumb";
    card.setAttribute("data-index", String(idx));
    card.setAttribute("data-group", groupKey);

    const img = document.createElement("img");
    img.src = it.dataUrl ? it.dataUrl : IMG_BASE + it.file;
    img.alt = it.label;
    img.draggable = false;

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = it.label;

    if (state[groupKey] === idx) card.classList.add("selected");

    card.appendChild(img);
    card.appendChild(label);
    grid.appendChild(card);

    // Click to select
    card.addEventListener("click", () => {
      state[groupKey] = idx;
      applySelections(state);
      // update selection UI
      renderGroupSelection(gridId, state[groupKey]);
    });

    // Double click to open modal preview
    card.addEventListener("dblclick", () => openModal(groupKey, idx));
  });
}

// Render a compact horizontal row (mobile) - ACCEPTS ELEMENT
function renderMobileRow(rowEl, items, groupKey, state) {
  rowEl.innerHTML = ''; // Clear previous items
  items.forEach((item, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'mobile-thumb';
    if (idx === state[groupKey]) {
      thumb.classList.add('selected');
    }
    const imgSrc = item.dataUrl ? item.dataUrl : IMG_BASE + item.file;
    thumb.innerHTML = `<img src="${imgSrc}" alt="${item.label}" loading="lazy">`;
    thumb.addEventListener('click', () => {
      state[groupKey] = idx;
      applySelections(state);
      
      // Update title with new selection name
      const titleEl = document.getElementById(`mobile-group-title-${groupKey}`);
      if (titleEl) {
        const nameSpan = titleEl.querySelector('.selected-item-name');
        if (nameSpan) {
          nameSpan.textContent = item.label;
        }
      }
      
      // Re-render this row to update selection visual
      renderMobileRow(rowEl, items, groupKey, state);
    });
    rowEl.appendChild(thumb);
  });
}

// NEW: Renders all part groups vertically for mobile view
function renderMobilePartGroups(state) {
  const container = document.getElementById('mobile-parts-container');
  if (!container) return;
  container.innerHTML = ''; // Clear existing

  const availableGroups = MASTER_GROUP_LIST
    .filter(g => PARTS[g.key] && PARTS[g.key].length > 0);
  
  if (availableGroups.length === 0) {
    container.textContent = 'No parts available for this model.';
    return;
  }

  availableGroups.forEach(groupInfo => {
    const items = PARTS[groupInfo.key] || [];
    const currentSelectionIdx = state[groupInfo.key] || 0;
    const selectedItem = items[currentSelectionIdx];

    // Title row with inline subcategory filter
    const titleRow = document.createElement('div');
    titleRow.className = 'flex items-center justify-between';

    const title = document.createElement('h3');
    title.id = `mobile-group-title-${groupInfo.key}`;
    title.innerHTML = `
      ${groupInfo.name_th} / ${groupInfo.name_en}
      <span class="selected-item-name">${selectedItem ? selectedItem.label : ''}</span>
    `;

    const scSelect = document.createElement('select');
    scSelect.id = `msc-filter-${groupInfo.key}`;
    scSelect.className = 'border border-slate-300 rounded-md text-slate-700 bg-white px-2 py-1 text-sm';
    const firstOpt = document.createElement('option'); firstOpt.value = 'all'; firstOpt.textContent = 'All'; scSelect.appendChild(firstOpt);
    try {
      const fromList = getSubcatList(currentSKU, groupInfo.key);
      const fromMeta = unionSubcatsFromMeta(currentSKU, groupInfo.key);
      Array.from(new Set([...(fromList||[]), ...(fromMeta||[])])).forEach(v => { const o=document.createElement('option'); o.value=v; o.textContent=v; scSelect.appendChild(o); });
    } catch (_) {}
    scSelect.addEventListener('change', () => {
      try { window.SUB_FILTERS = window.SUB_FILTERS || {}; window.SUB_FILTERS[groupInfo.key] = scSelect.value; } catch(_){}
      renderMobilePartGroups(state);
    });

    titleRow.appendChild(title);
    titleRow.appendChild(scSelect);
    container.appendChild(titleRow);

    // Apply filter to items for mobile row
    let filtered = items;
    try {
      const sel = (window.SUB_FILTERS || {})[groupInfo.key] || 'all';
      if (sel !== 'all') {
        filtered = items.filter((it) => {
          const url = it && (it.dataUrl || (it.file ? (IMG_BASE + it.file) : ''));
          const meta = getAssetMeta(url);
          return (meta && meta.subcategory) ? (meta.subcategory === sel) : false;
        });
      }
    } catch (_) {}

    // Horizontally scrollable row for thumbnails
    const row = document.createElement('div');
    row.className = 'mobile-row';
    container.appendChild(row);

    // Render thumbnails into the row
    renderMobileRow(row, filtered, groupInfo.key, state);
  });
}

function renderGroupSelection(gridId, selectedIdx) {
  const grid = $(gridId);
  if (!grid) return;
  [...grid.children].forEach((el, i) => {
    el.classList.toggle("selected", i === selectedIdx);
  });
}

function applySelections(state) {
  // Helper to safely pick an item from PARTS for a given key using the state's index
  function pickItem(key) {
    try {
      const arr = PARTS && PARTS[key];
      if (!arr || !Array.isArray(arr) || arr.length === 0) return null;
      const idx = state ? state[key] : undefined;
      if (typeof idx === 'number') return arr[idx] || null;
      const parsed = parseInt(idx, 10);
      if (!Number.isNaN(parsed)) return arr[parsed] || null;
      return arr[0] || null;
    } catch (e) {
      return null;
    }
  }

  // Apply selections dynamically for all groups in MASTER_GROUP_LIST
  MASTER_GROUP_LIST.forEach(groupInfo => {
    const key = groupInfo.key;
    setLayerFromItem(`layer-${key}`, pickItem(key));
  });
  
  // After changing images, resync heights when images load
  queueHeightSyncOnImages();
}

function randomizeState() {
  const randIdx = (arr) => Math.floor(Math.random() * arr.length);
  return {
    dial: randIdx(PARTS.dial),
    hands: randIdx(PARTS.hands),
    second: randIdx(PARTS.second),
    outer: randIdx(PARTS.outer),
    inner: randIdx(PARTS.inner),
    bracelet: randIdx(PARTS.bracelet)
  };
}

// Modal helpers
let modalContext = { groupKey: null, index: null };
let heightSyncQueued = false;
let zoom = 1; // default: 100%
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;
function syncHeights() {
  const previewCard = document.querySelector("#preview > div");
  const panel = document.getElementById("controls-panel");
  if (!previewCard || !panel) return;
  if (window.matchMedia("(min-width: 768px)").matches) {
    const rect = previewCard.getBoundingClientRect();
    panel.style.maxHeight = "";
    panel.style.height = Math.floor(rect.height) + "px";
  } else {
    panel.style.height = "";
    panel.style.maxHeight = "";
  }
}

// Simple toast helper (small non-blocking messages)
function showToast(msg, type = 'info', timeout = 2500) {
  function normalizeMsg(m, t) {
    try {
      if (typeof m !== 'string') return t === 'error' ? 'เกิดข้อผิดพลาด' : (t === 'success' ? 'ทำรายการสำเร็จ' : 'แจ้งเตือน');
      const s = m.trim();
      if (!s) return t === 'error' ? 'เกิดข้อผิดพลาด' : (t === 'success' ? 'ทำรายการสำเร็จ' : 'แจ้งเตือน');
      const suspect = /[\uFFFD]|[à-ÿ]/.test(s);
      if (suspect) return t === 'error' ? 'เกิดข้อผิดพลาด' : (t === 'success' ? 'ทำรายการสำเร็จ' : 'แจ้งเตือน');
      return s;
    } catch (_) { return t === 'error' ? 'เกิดข้อผิดพลาด' : (t === 'success' ? 'ทำรายการสำเร็จ' : 'แจ้งเตือน'); }
  }
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    wrap.style.position = 'fixed';
    wrap.style.right = '16px';
    wrap.style.top = '16px';
    wrap.style.zIndex = 60;
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.textContent = normalizeMsg(msg, type);
  el.className = 'px-3 py-2 rounded-md text-sm text-white';
  el.style.marginTop = '8px';
  el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)';
  if (type === 'success') el.style.background = '#059669';
  else if (type === 'error') el.style.background = '#dc2626';
  else el.style.background = '#374151';
  wrap.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity 300ms, transform 300ms'; el.style.opacity = '0'; el.style.transform = 'translateY(-6px)'; setTimeout(() => el.remove(), 350); }, timeout);
}

function applyHeaderHeightVar() {
  const header = document.querySelector('header');
  const h = header ? header.offsetHeight : 0;
  document.documentElement.style.setProperty('--header-h', h + 'px');
}
function queueHeightSyncOnImages() {
  if (heightSyncQueued) return;
  heightSyncQueued = true;
  const layers = [
    "layer-bracelet",
    "layer-outer",
    "layer-inner",
    "layer-dial",
    "layer-hands",
    "layer-second"
  ]
    .map((id) => $(id))
    .filter(Boolean);
  let remaining = layers.length;
  const done = () => {
    remaining--;
    if (remaining <= 0) {
      heightSyncQueued = false;
      syncHeights();
    }
  };
  layers.forEach((img) => {
    if (!img.complete) {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    } else {
      done();
    }
  });
}
function openModal(groupKey, idx) {
  const it = PARTS[groupKey][idx];
  modalContext = { groupKey, index: idx };
  const src = it ? (it.dataUrl ? it.dataUrl : (it.file ? IMG_BASE + it.file : "")) : "";
  $("modal-img").src = src;
  $("modal-caption").textContent = it.label;
  const m = $("image-modal");
  m.classList.remove("hidden");
  m.classList.add("flex");
}
function closeModal() {
  const m = $("image-modal");
  m.classList.add("hidden");
  m.classList.remove("flex");
}

// Function to create dynamic layer images based on MASTER_GROUP_LIST
function createDynamicLayers() {
  const zoomInner = document.getElementById('zoom-inner');
  if (!zoomInner) return;
  
  // Clear existing layers
  zoomInner.innerHTML = '';
  
  // Create layers in order from MASTER_GROUP_LIST
  MASTER_GROUP_LIST.forEach(groupInfo => {
    const img = document.createElement('img');
    img.id = `layer-${groupInfo.key}`;
    img.alt = groupInfo.name_en || groupInfo.key;
    img.className = 'absolute inset-0 w-full h-full object-contain';
    img.style.visibility = 'hidden'; // initially hidden
    
    // Apply z-index from database to control layer stacking
    if (groupInfo.z_index !== undefined && groupInfo.z_index !== null) {
      img.style.zIndex = groupInfo.z_index;
    }
    
    zoomInner.appendChild(img);
  });

  // Append watermark overlay (scaled with zoom because it's inside zoom-inner)
  try {
    const wm = document.createElement('img');
    wm.id = 'wm-overlay';
    
    // Try to get watermark from profile settings first, then fall back to default
    const savedWatermarkUrl = localStorage.getItem('watchWatermarkUrl');
    const savedWatermarkOpacity = localStorage.getItem('watchWatermarkOpacity');
    const savedWatermarkPosition = localStorage.getItem('watchWatermarkPosition');
    const savedWatermarkSize = localStorage.getItem('watchWatermarkSize');
    const savedWatermarkType = localStorage.getItem('watchWatermarkType') || 'image';
    const savedStoreName = localStorage.getItem('watchStoreName') || 'Watch Configurator';

    if (savedWatermarkType === 'none') {
      // Don't append anything if type is 'none'
      return;
    }

    if (savedWatermarkType === 'text') {
      const textWatermark = document.createElement('div');
      textWatermark.id = 'wm-overlay-text';
      textWatermark.textContent = savedStoreName.toUpperCase();
      textWatermark.className = 'watermark-overlay-text'; // Add a class for styling
      zoomInner.appendChild(textWatermark);
      // Note: Position, size, opacity for text would need separate handling/styling
    } else { // 'image'
      wm.src = savedWatermarkUrl || WATERMARK_IMAGE;
      wm.alt = 'watermark';
      wm.className = 'watermark-overlay';
      wm.draggable = false;

      // Apply watermark settings if available
      if (savedWatermarkOpacity) {
        wm.style.opacity = savedWatermarkOpacity;
      }
      
      if (savedWatermarkSize) {
        wm.style.width = savedWatermarkSize + 'px';
        wm.style.height = 'auto';
      }
      
      // Apply position - use the same logic as in preview
      // Check if it's a custom position
      if (savedWatermarkPosition && savedWatermarkPosition.startsWith('custom:')) {
        // Extract the x and y percentages from the custom position
        const parts = savedWatermarkPosition.split(':');
        if (parts.length === 3) {
          const xPercent = parseFloat(parts[1]);
          const yPercent = parseFloat(parts[2]);
          
          // Apply custom position
          wm.style.left = xPercent + '%';
          wm.style.top = yPercent + '%';
          wm.style.right = 'auto';
          wm.style.bottom = 'auto';
          wm.style.transform = 'translate(-50%, -50%)';
        }
      } else {
        const positions = {
          'top-left': { top: '10px', left: '10px', right: 'auto', bottom: 'auto' },
          'top-right': { top: '10px', right: '10px', left: 'auto', bottom: 'auto' },
          'bottom-left': { bottom: '10px', left: '10px', top: 'auto', right: 'auto' },
          'bottom-right': { bottom: '10px', right: '10px', top: 'auto', left: 'auto' },
          'center': { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', right: 'auto', bottom: 'auto' }
        };
        
        const pos = positions[savedWatermarkPosition] || positions['bottom-right'];
        Object.keys(pos).forEach(key => {
          wm.style[key] = pos[key];
        });
      }
      
      zoomInner.appendChild(wm);
    }
  } catch (e) { /* ignore */ }
}

// Function to create dynamic grids based on MASTER_GROUP_LIST and current SKU parts
function createDynamicGrids() {
  const controlsPanel = document.getElementById('controls-panel');
  if (!controlsPanel) return;
  try { window.SUB_FILTERS = window.SUB_FILTERS || {}; } catch(_) {}
  
  // Find the buttons container to preserve it
  const buttonsContainer = controlsPanel.querySelector('.flex.gap-3');
  
  // Clear everything except the first paragraph and buttons
  const firstP = controlsPanel.querySelector('p');
  controlsPanel.innerHTML = '';
  if (firstP) controlsPanel.appendChild(firstP);
  
  // Get groups that exist in current SKU
  const currentParts = PARTS || {};
  const availableGroups = MASTER_GROUP_LIST.filter(g => currentParts[g.key] && currentParts[g.key].length > 0);
  
  // Create grid for each available group
  availableGroups.forEach(groupInfo => {
    const key = groupInfo.key;

    // Title row with inline subcategory filter
    const titleRow = document.createElement('div');
    titleRow.className = 'flex items-center justify-between mt-4';

    const title = document.createElement('h3');
    title.className = 'part-title m-0';
    title.textContent = `${groupInfo.name_th} / ${groupInfo.name_en}`;

    const scSelect = document.createElement('select');
    scSelect.id = `sc-filter-${key}`;
    scSelect.className = 'border border-slate-300 rounded-md text-slate-700 bg-white px-2 py-1 text-sm';
    const firstOpt = document.createElement('option'); firstOpt.value = 'all'; firstOpt.textContent = 'All'; scSelect.appendChild(firstOpt);
    try {
      const fromList = getSubcatList(currentSKU, key);
      const fromMeta = unionSubcatsFromMeta(currentSKU, key);
      Array.from(new Set([...(fromList||[]), ...(fromMeta||[])])).forEach(v => { const o=document.createElement('option'); o.value=v; o.textContent=v; scSelect.appendChild(o); });
    } catch (_) {}
    scSelect.addEventListener('change', () => { try { window.SUB_FILTERS = window.SUB_FILTERS || {}; window.SUB_FILTERS[key] = scSelect.value; } catch(_){} renderGrid(`grid-${key}`, PARTS[key] || [], key, {}); });

    titleRow.appendChild(title);
    titleRow.appendChild(scSelect);
    controlsPanel.appendChild(titleRow);

    // Create grid
    const grid = document.createElement('div');
    grid.id = `grid-${key}`;
    grid.className = 'part-grid';
    controlsPanel.appendChild(grid);
  });
  
  // Re-append buttons container
  if (buttonsContainer) controlsPanel.appendChild(buttonsContainer);
}

// --- Store Settings ---
async function loadStoreSettings() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.log("Supabase client not available, using default store name.");
    return;
  }
  try {
    const { data, error } = await supabase
      .from('profile_settings')
      .select('store_name')
      .limit(1);

    if (error) throw error;

    const storeName = data && data.length > 0 ? data[0].store_name : 'Watch Configurator';
    const titleEl = document.getElementById('app-title');
    if (titleEl) {
      titleEl.textContent = storeName;
    }
    document.title = storeName;
  } catch (error) {
    console.error("Error loading store settings:", error);
    const titleEl = document.getElementById('app-title');
    if (titleEl) {
      titleEl.textContent = 'Watch Configurator';
    }
    document.title = 'Watch Configurator';
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // Load store name first
  await loadStoreSettings();

  // Handle watermark type radio buttons (only on admin page)
  const watermarkTypeRadios = document.querySelectorAll('input[name="watermark_type"]');
  const watermarkImageSettings = document.getElementById('watermark-image-settings');

  if (watermarkTypeRadios.length > 0 && watermarkImageSettings) {
    function handleWatermarkTypeChange() {
      const selectedRadio = document.querySelector('input[name="watermark_type"]:checked');
      if (selectedRadio) {
        const selectedType = selectedRadio.value;
        if (selectedType === 'image') {
          watermarkImageSettings.style.display = 'block';
        } else {
          watermarkImageSettings.style.display = 'none';
        }
      }
    }

    watermarkTypeRadios.forEach(radio => {
      radio.addEventListener('change', handleWatermarkTypeChange);
    });

    // Initial check
    handleWatermarkTypeChange();
  }

  // Load store name from localStorage or use default
  const storeNameDisplay = document.getElementById('store-name-display');
  if (storeNameDisplay) {
    const savedStoreName = localStorage.getItem('watchStoreName');
    if (savedStoreName) {
      storeNameDisplay.textContent = savedStoreName;
    }
  }
  
  // show loading overlay until catalog and initial images are loaded
  showLoading(true);
  await maybeLoadCatalogFromSupabase();
  
  // Create dynamic layers and grids after loading catalog
  createDynamicLayers();
  createDynamicGrids();
  
  // preload images for the initial SKU to avoid layout shift
  try { await preloadImagesForSKU(currentSKU, 4000); } catch (e) { /* ignore */ }
  showLoading(false);
  // Set CSS var for header height so main can fit exactly 1 screen
  applyHeaderHeightVar();
  window.addEventListener('resize', applyHeaderHeightVar);
  // Default state (index 0) - create dynamically from current PARTS
  const state = {};
  Object.keys(PARTS || {}).forEach(key => {
    if (key !== '__name') state[key] = 0;
  });

  // Render grids dynamically for all groups that exist in current SKU
  Object.keys(PARTS || {}).forEach(key => {
    if (key === '__name') return;
    const items = PARTS[key];
    if (Array.isArray(items) && items.length > 0) {
      renderGrid(`grid-${key}`, items, key, state);
      // Mobile overlay grids (share same data/state)
      renderGrid(`mgrid-${key}`, items, key, state);
    }
  });

  // Setup mobile view
  renderMobilePartGroups(state);

  applySelections(state);

  syncHeights();
  window.addEventListener("resize", syncHeights);
  queueHeightSyncOnImages();

  // --- Anti-copy deterrents on the main page preview (index only) ---
  try {
    if (document.getElementById('preview')) {
      // Disable context menu (outside of inputs) on index page
      document.addEventListener('contextmenu', (e) => {
        const tag = (e.target && e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        e.preventDefault();
      });
      // Prevent dragging images in preview area
      document.addEventListener('dragstart', (e) => {
        const t = e.target;
        if (t && t.tagName === 'IMG' && t.closest('#zoom-inner')) { e.preventDefault(); }
      });
      // Reduce long-press save on mobile (CSS handles most)
      document.addEventListener('touchstart', (e) => {
        const t = e.target;
        if (t && t.closest && t.closest('#zoom-inner')) { /* noop */ }
      }, { passive: true });
    }
  } catch (_) { /* ignore */ }

  // Buttons
  const btnReset = $("btn-reset");
  if (btnReset) {
    btnReset.addEventListener("click", () => {
      // Reset all groups to index 0
      Object.keys(PARTS || {}).forEach(key => {
        if (key !== '__name') state[key] = 0;
      });
      // Re-render all grids
      Object.keys(PARTS || {}).forEach(key => {
        if (key === '__name') return;
        const items = PARTS[key];
        if (Array.isArray(items) && items.length > 0) {
          renderGrid(`grid-${key}`, items, key, state);
        }
      });
      applySelections(state);
    });
  }

  const btnRandom = $("btn-random");
  if (btnRandom) {
    btnRandom.addEventListener("click", () => {
      // Randomize all groups
      const randIdx = (arr) => Math.floor(Math.random() * arr.length);
      Object.keys(PARTS || {}).forEach(key => {
        if (key !== '__name' && Array.isArray(PARTS[key]) && PARTS[key].length > 0) {
          state[key] = randIdx(PARTS[key]);
        }
      });
      // Re-render all grids
      Object.keys(PARTS || {}).forEach(key => {
        if (key === '__name') return;
        const items = PARTS[key];
        if (Array.isArray(items) && items.length > 0) {
          renderGrid(`grid-${key}`, items, key, state);
        }
      });
      applySelections(state);
    });
  }

  // Modal bindings
  const modalClose = $("modal-close");
  if (modalClose) modalClose.addEventListener("click", closeModal);
  const imageModal = $("image-modal");
  if (imageModal) {
    imageModal.addEventListener("click", (e) => {
      if (e.target && e.target.id === "image-modal") closeModal();
    });
  }
  const modalSelect = $("modal-select");
  if (modalSelect) {
    modalSelect.addEventListener("click", () => {
      if (modalContext.groupKey == null) return closeModal();
      // apply chosen
      state[modalContext.groupKey] = modalContext.index;
      applySelections(state);
      // re-render group for selection state
      renderGrid(
        `grid-${modalContext.groupKey}`,
        PARTS[modalContext.groupKey],
        modalContext.groupKey,
        state
      );
      closeModal();
    });
  }

  // Mobile overlay controls
  const openMobile = $("open-mobile");
  const closeMobile = $("close-mobile");
  const mobileOverlay = $("mobile-overlay");
  if (openMobile && closeMobile && mobileOverlay) {
    openMobile.addEventListener("click", () => {
      mobileOverlay.classList.remove("hidden");
      const drawer = document.getElementById("mobile-drawer");
      if (drawer) {
        // start off-screen then animate in
        requestAnimationFrame(() => {
          drawer.style.transform = "translateX(0)";
        });
      }
    });
    closeMobile.addEventListener("click", () => {
      const drawer = document.getElementById("mobile-drawer");
      if (drawer) drawer.style.transform = "translateX(-100%)";
      setTimeout(() => mobileOverlay.classList.add("hidden"), 300);
    });
    mobileOverlay.addEventListener("click", (e) => {
      if (e.target && e.target.id === "mobile-backdrop") {
        const drawer = document.getElementById("mobile-drawer");
        if (drawer) drawer.style.transform = "translateX(-100%)";
        setTimeout(() => mobileOverlay.classList.add("hidden"), 300);
      }
    });
  }

  // Zoom controls (desktop)
  const zoomInner = $("zoom-inner");
  const zoomInBtn = $("zoom-in");
  const zoomOutBtn = $("zoom-out");
  const zoomResetBtn = $("zoom-reset");
  function applyZoom() {
    if (!zoomInner) return;
    // Keep horizontally centered but align to the top vertically
    zoomInner.style.transformOrigin = 'center top';
    zoomInner.style.transform = `scale(${zoom})`;
    if (zoomOutBtn) zoomOutBtn.disabled = zoom <= MIN_ZOOM + 1e-6;
    if (zoomInBtn) zoomInBtn.disabled = zoom >= MAX_ZOOM - 1e-6;
    if (zoomResetBtn) {
      const pct = Math.round(zoom * 100);
      zoomResetBtn.textContent = `${pct}%`;
      zoomResetBtn.title = 'Reset zoom to fit';
    }
  }
  // expose helpers so other functions can reset to fit
  window.__applyZoom = applyZoom;
  window.__resetZoomToFit = function() { zoom = 1; applyZoom(); };
  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
      zoom = Math.min(MAX_ZOOM, Math.round((zoom + ZOOM_STEP) * 100) / 100);
      applyZoom();
    });
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
      zoom = Math.max(MIN_ZOOM, Math.round((zoom - ZOOM_STEP) * 100) / 100);
      applyZoom();
    });
  }
  if (zoomResetBtn) {
    zoomResetBtn.addEventListener('click', () => {
      zoom = 1;
      applyZoom();
    });
  }
  applyZoom();

  // Forward wheel/trackpad scroll on preview to the left controls panel
  const previewBox = $("preview-box");
  const controlsPanel = $("controls-panel");
  if (previewBox && controlsPanel) {
    previewBox.addEventListener(
      'wheel',
      (e) => {
        const dy = e.deltaY;
        // Determine if the left panel can scroll in the intended direction
        const atTop = controlsPanel.scrollTop <= 0;
        const atBottom = Math.ceil(controlsPanel.scrollTop + controlsPanel.clientHeight) >= controlsPanel.scrollHeight;
        const goingDown = dy > 0;
        const goingUp = dy < 0;
        const canScrollDown = !atBottom;
        const canScrollUp = !atTop;
        if ((goingDown && canScrollDown) || (goingUp && canScrollUp)) {
          e.preventDefault();
          controlsPanel.scrollTop += dy;
        }
        // else: allow default page scroll
      },
      { passive: false }
    );
  }

  // SKU select (desktop and mobile)
  const skuSelect = $("sku-select");
  const mobileSkuSelect = $("mobile-sku-select");

  function refreshSkuSelect() {
    const selects = [skuSelect, mobileSkuSelect].filter(Boolean);
    if (selects.length === 0) return;
    
    const fragment = document.createDocumentFragment();
    Object.entries(CATALOG).forEach(([key, parts]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = (parts.__name || key);
      fragment.appendChild(opt);
    });
    
    selects.forEach(sel => {
      sel.innerHTML = '';
      sel.appendChild(fragment.cloneNode(true));
      sel.value = currentSKU;
    });
  }

  async function handleSkuChange(newSku, state) {
    if (!CATALOG[newSku] || newSku === currentSKU) return; // Don't reload if same SKU is selected

    showLoading(true);

    // Preload images for the new SKU before updating the UI
    await preloadImagesForSKU(newSku, 4000);

    currentSKU = newSku;
    PARTS = CATALOG[currentSKU];
    
    // Update both dropdowns to stay in sync
    if (skuSelect) skuSelect.value = currentSKU;
    if (mobileSkuSelect) mobileSkuSelect.value = currentSKU;

    // Reset state for available groups
    const groups = getGroupsOrdered(PARTS);
    const newState = {};
    groups.forEach((g) => { newState[g] = 0; });
    Object.assign(state, newState); // Mutate the original state object

    // Re-create dynamic grids for new SKU
    createDynamicGrids();
    
    // Render all grids dynamically
    Object.keys(PARTS || {}).forEach(key => {
      if (key === '__name') return;
      const items = PARTS[key];
      if (Array.isArray(items) && items.length > 0) {
        renderGrid(`grid-${key}`, items, key, state);
        renderGrid(`mgrid-${key}`, items, key, state);
      }
    });
    
    // Re-initialize mobile parts view
    renderMobilePartGroups(state);
    
    applySelections(state);

    // Hide loading after all UI updates are done
    showLoading(false);
  }

  refreshSkuSelect();
  
  if (skuSelect) {
    skuSelect.addEventListener('change', () => handleSkuChange(skuSelect.value, state));
  }
  if (mobileSkuSelect) {
    mobileSkuSelect.addEventListener('change', () => handleSkuChange(mobileSkuSelect.value, state));
  }

  // Admin overlay events (localStorage based)
  // Open admin as a separate page instead of overlay
  const openAdmin = $("open-admin");
  if (openAdmin) {
    openAdmin.addEventListener('click', (e) => {
      e.preventDefault();
      // open admin.html in same tab
      window.location.href = './admin.html';
    });
  }

  const adminSave = $("admin-save");
  if (adminSave) {
    adminSave.addEventListener('click', async () => {
      // button now handled to prevent duplicate submits; UI state managed
      const prevText = adminSave.textContent;
      if (adminSave.disabled) return;
      adminSave.disabled = true;
      adminSave.classList.add('opacity-70', 'cursor-wait');
      adminSave.textContent = 'Saving...';
      try {
        const skuIdRaw = (document.getElementById('admin-sku-id')?.value || '').trim();
        const skuName = (document.getElementById('admin-sku-name')?.value || '').trim();
        // Fix mojibake message: validate inputs in Thai before legacy line
        if (!skuIdRaw && !skuName) { showToast('กรุณากรอกชื่อรุ่นหรือ SKU ID อย่างน้อยหนึ่งช่อง', 'error'); return; }
        if (!skuIdRaw && !skuName) { showToast('à¸à¸£à¸¸à¸"à¸²à¹ƒà¸ªà¹ˆà¸Šà¸·à¹ˆà¸­à¸£à¸¸à¹ˆà¸™à¸«à¸£à¸·à¸­ SKU ID à¸­à¸¢à¹ˆà¸²à¸‡à¸™à¹‰à¸­à¸¢à¸«à¸™à¸¶à¹ˆà¸‡à¸Šà¹ˆà¸­à¸‡', 'error'); return; }
        const skuKey = sanitizeKey(skuIdRaw || skuName);
        const supa = getSupabaseClient();
        const bucket = window.SUPABASE_BUCKET || 'watch-assets';
        // collect dynamic groups present in file inputs
        // determine which groups are toggled on in the UI (existing + new)
        const toggles = document.querySelectorAll('#admin-part-toggles input.part-toggle');
        let groups = [];
        toggles.forEach(t => { if (t.checked && t.dataset && t.dataset.group) groups.push(t.dataset.group); });
        // Also include any file inputs that actually contain files (covers index.html admin inputs
        // where toggles may not be used). This ensures groups are detected when user selected files
        // but didn't toggle the part checkboxes.
        try {
          const fileInputs = Array.from(document.querySelectorAll('input[id^="admin-files-"]'));
          fileInputs.forEach((input) => {
            try {
              const id = input && input.id ? input.id : '';
              const m = id.match(/^admin-files-(.+)$/);
              if (m && m[1]) {
                const g = m[1];
                const hasFiles = input.files && input.files.length;
                // include if toggled on OR files present
                if (hasFiles || !groups.includes(g)) {
                  groups.push(g);
                }
              }
            } catch (e) { /* ignore per-input */ }
          });
        } catch (e) { /* ignore DOM quirks */ }
        // de-duplicate
        groups = Array.from(new Set(groups));
        console.debug('admin-save detected groups:', groups);
        const assetRows = [];
        if (supa) {
          const { error: eSku } = await supa.from('skus').upsert({ id: skuKey, name: skuName || skuIdRaw }).select();
          if (eSku) throw eSku;
          // fetch existing counts
          const { data: existingAssets } = await supa.from('assets').select('group_key, sort').eq('sku_id', skuKey);
          const counts = {};
          groups.forEach(g => { counts[g] = (existingAssets || []).filter(a => a.group_key === g).length; });
          for (const g of groups) {
            const input = document.getElementById('admin-files-' + g);
            const files = input && input.files ? Array.from(input.files) : [];
            let idx = (counts[g] || 0) + 1;
            for (const f of files) {
              const safeName = sanitizeFileName(f.name);
              const path = `${skuKey}/${g}/${Date.now()}-${idx}-${safeName}`;
              const { error: eUp } = await supa.storage.from(bucket).upload(path, f, { upsert: true, contentType: f.type });
              if (eUp) throw eUp;
              const { data: pub } = supa.storage.from(bucket).getPublicUrl(path);
              const url = pub?.publicUrl || '';
              assetRows.push({ sku_id: skuKey, group_key: g, label: `${g[0].toUpperCase()+g.slice(1)} ${idx}`, url, sort: idx });
              idx++;
            }
          }
          if (assetRows.length) {
            // avoid inserting duplicates that already exist in DB (matching by URL)
            const existingUrls = (existingAssets || []).map(a => normalizeUrl(a.url || ''));
            const filteredRows = assetRows.filter(r => !existingUrls.includes(normalizeUrl(r.url || '')));
            if (filteredRows.length) {
              const { error: eIns } = await supa.from('assets').insert(filteredRows).select();
              if (eIns) throw eIns;
            }
          }
          await maybeLoadCatalogFromSupabase();
          refreshSkuSelect();
          if (skuSelect) { skuSelect.value = skuKey; skuSelect.dispatchEvent(new Event('change')); }
          // Refresh SKU table if on admin page
          if (typeof refreshSkuTable === 'function') {
            refreshSkuTable();
          }
          // close admin overlay if present, otherwise no-op
          try { closeAdminIfOverlayExists(); } catch (e) {}
          // Go back to SKU list panel
          if (typeof window.showSkuList === 'function') {
            window.showSkuList();
          }
          showToast('à¸šà¸±à¸™à¸—à¸¶à¸ SKU à¸¥à¸‡ Supabase à¸ªà¸³à¹€à¸£à¹‡à¸ˆ', 'success');
        } else {
          // fallback local
          const newParts = { __name: skuName || skuIdRaw, __created_at: new Date().toISOString() };
          for (const g of groups) {
            const input = document.getElementById('admin-files-' + g);
            const files = input && input.files ? Array.from(input.files) : [];
            const arr = [];
            let idx = 1;
            for (const f of files) {
              const dataUrl = await fileToDataURL(f);
              arr.push({ label: `${g[0].toUpperCase()+g.slice(1)} ${idx++}`, dataUrl });
            }
            if (arr.length > 0) newParts[g] = arr;
          }
          const existing = CATALOG[skuKey] || null;
          if (existing) {
            for (const g of Object.keys(newParts)) {
              if (g === '__name') continue;
              const base = existing[g] || [];
              const incoming = newParts[g] || [];
              CATALOG[skuKey][g] = base.concat(incoming);
            }
          } else {
            CATALOG[skuKey] = newParts;
          }
          localStorage.setItem('watchCatalog', JSON.stringify(CATALOG));
          refreshSkuSelect();
          if (skuSelect) { skuSelect.value = skuKey; skuSelect.dispatchEvent(new Event('change')); }
          // Refresh SKU table if on admin page
          if (typeof refreshSkuTable === 'function') {
            refreshSkuTable();
          }
          // Go back to SKU list panel
          if (typeof window.showSkuList === 'function') {
            window.showSkuList();
          }
          showToast('à¸šà¸±à¸™à¸—à¸¶à¸ SKU à¸ªà¸³à¹€à¸£à¹‡à¸ˆ (Local)', 'success');
        }
      } catch (err) {
        console.error(err);
        showToast('à¹€à¸à¸´à¸"à¸‚à¹‰à¸­à¸œà¸´à¸"à¸žà¸¥à¸²à¸"à¸‚à¸"à¸°à¸šà¸±à¸™à¸—à¸¶à¸: ' + (err && err.message ? err.message : String(err)), 'error');
      } finally {
        adminSave.disabled = false;
        adminSave.classList.remove('opacity-70', 'cursor-wait');
        adminSave.textContent = prevText;
      }
    });
  }

  const adminExport = $("admin-export");
  if (adminExport) {
    adminExport.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(CATALOG, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'watch-catalog.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    });
  }
  const adminImport = $("admin-import");
  const adminImportInput = $("admin-import-input");
  if (adminImport && adminImportInput) {
    adminImport.addEventListener('click', () => adminImportInput.click());
    adminImportInput.addEventListener('change', async () => {
      const f = adminImportInput.files && adminImportInput.files[0];
      if (!f) return;
      const text = await f.text();
      try {
        const obj = JSON.parse(text);
        if (typeof obj === 'object') {
          CATALOG = { ...DEFAULT_CATALOG, ...obj };
          localStorage.setItem('watchCatalog', JSON.stringify(CATALOG));
          refreshSkuSelect();
          alert('à¸™à¸³à¹€à¸‚à¹‰à¸²à¹à¸¥à¹‰à¸§');
        }
      } catch (e) { alert('à¹„à¸Ÿà¸¥à¹Œà¹„à¸¡à¹ˆà¸–à¸¹à¸à¸•à¹‰à¸­à¸‡'); }
    });
  }

  // Scan assets button (report duplicates and sku mismatches)
  const adminScanBtn = $("admin-scan-assets");
  async function scanAssetsReport() {
    const supa = getSupabaseClient();
    const results = { duplicates: [], mismatches: [], total: 0 };
    if (!supa) { showToast('Supabase not configured', 'error'); return results; }
    try {
      // fetch all assets (limit safety)
      const { data: assets, error } = await supa.from('assets').select('id,sku_id,group_key,label,url,sort').limit(5000);
      if (error) throw error;
      results.total = (assets || []).length;
      // duplicates by normalized url
      const byUrl = {};
      (assets || []).forEach(a => {
        const u = normalizeUrl(a.url || '');
        byUrl[u] = byUrl[u] || [];
        byUrl[u].push(a);
      });
      Object.entries(byUrl).forEach(([u, arr]) => {
        if (arr.length > 1) results.duplicates.push({ url: u, rows: arr.map(x => ({ id: x.id, sku: x.sku_id, group: x.group_key })) });
      });
      // mismatches: url contains a different sku-like segment
      (assets || []).forEach(a => {
        const u = a.url || '';
        const m = u.match(/\/(?:[^/]+)\/([^/]+)\//);
        if (m && m[1] && m[1] !== a.sku_id) {
          results.mismatches.push({ id: a.id, sku_id: a.sku_id, urlSku: m[1], url: u });
        }
      });
      // render report to a modal-like element (create if missing)
      let wrap = document.getElementById('admin-scan-report');
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'admin-scan-report';
        wrap.className = 'fixed inset-0 z-50 flex items-start justify-center p-6';
        wrap.innerHTML = '<div class="bg-white rounded-lg w-full max-w-4xl max-h-[80vh] overflow-auto p-4 shadow">' +
          '<div class="flex items-center justify-between"><div class="font-semibold">Scan assets report</div>' +
          '<button id="admin-scan-close" class="px-2 py-1 rounded border bg-gray-100">Close</button></div><div id="admin-scan-body" class="mt-3 text-sm"></div></div>';
        document.body.appendChild(wrap);
        document.getElementById('admin-scan-close').addEventListener('click', () => wrap.remove());
      }
      const body = document.getElementById('admin-scan-body');
      if (body) {
        body.innerHTML = `<p>Total assets: ${results.total}</p>`;
        body.innerHTML += `<h4 class="mt-3 font-medium">Duplicates (${results.duplicates.length})</h4>`;
        results.duplicates.slice(0,50).forEach(d => {
          const el = document.createElement('div');
          el.className = 'p-2 border rounded mt-2';
          el.innerHTML = `<div class="text-xs text-gray-700">${d.url}</div>` +
            `<div class="text-xs mt-1">${d.rows.map(r=>`id:${r.id} sku:${r.sku} group:${r.group}`).join('<br/>')}</div>`;
          body.appendChild(el);
        });
        body.innerHTML += `<h4 class="mt-3 font-medium">SKU mismatches (${results.mismatches.length})</h4>`;
        results.mismatches.slice(0,200).forEach(m=>{
          const el = document.createElement('div');
          el.className = 'p-2 border rounded mt-2';
          el.innerHTML = `<div class="text-xs">id:${m.id} sku_id:${m.sku_id} urlSku:${m.urlSku}</div>` +
            `<div class="text-xs text-gray-600">${m.url}</div>`;
          body.appendChild(el);
        });
      }
      return results;
    } catch (err) {
      console.error(err);
      showToast('Error scanning assets: ' + (err && err.message ? err.message : String(err)), 'error');
      return results;
    }
  }
  if (adminScanBtn) adminScanBtn.addEventListener('click', async () => {
    adminScanBtn.disabled = true; adminScanBtn.textContent = 'Scanning...';
    try { await scanAssetsReport(); } finally { adminScanBtn.disabled = false; adminScanBtn.textContent = 'Scan assets (Report)'; }
  });

  // Ensure part toggles reflect existing SKU when editing
  function syncPartTogglesForSKU(skuKey) {
    const toggles = document.querySelectorAll('#admin-part-toggles input.part-toggle');
    const parts = CATALOG[skuKey] || {};
    toggles.forEach(t => {
      const g = t.dataset.group;
      // if SKU already has items for that group, check it; otherwise leave default
      t.checked = !!(parts && parts[g] && parts[g].length);
    });
  }

  // Admin list render for delete/edit per SKU
  function renderAdminList() {
    const wrap = document.getElementById('admin-list-contents');
    if (!wrap) return;
    wrap.innerHTML = '';
    Object.entries(CATALOG).forEach(([key, parts]) => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-2';
      const left = document.createElement('div');
      left.textContent = `${key} â€" ${parts.__name || ''}`;
      const right = document.createElement('div');
      right.className = 'flex items-center gap-2';
      const btnEdit = document.createElement('button');
      btnEdit.className = 'px-2 py-1 rounded-md border text-sm bg-white';
      btnEdit.textContent = 'Edit';
      btnEdit.addEventListener('click', () => {
        // populate admin form for editing
        const idEl = document.getElementById('admin-sku-id');
        const nameEl = document.getElementById('admin-sku-name');
        if (idEl) idEl.value = key;
        if (nameEl) nameEl.value = parts.__name || '';
        // mark SKU ID as existing/user (do not auto-overwrite when name changes)
        if (idEl) idEl.dataset.auto = 'false';
        // update preview (will not overwrite id because auto='false')
        if (typeof updateSkuPreview === 'function') updateSkuPreview();
        // sync toggles to show existing groups
        try { syncPartTogglesForSKU(key); } catch (e) { /* ignore */ }
        // focus name
        if (nameEl) nameEl.focus();
      });
      const btnDelete = document.createElement('button');
      btnDelete.className = 'px-2 py-1 rounded-md border text-sm bg-red-600 text-white';
      btnDelete.textContent = 'Delete';
      btnDelete.addEventListener('click', async () => {
        if (!confirm(`ต้องการลบ SKU ${key} และทั้งหมดของสินค้าที่เกี่ยวข้องหายไปหรือไม่?`)) return;
        const supa = getSupabaseClient();
        try {
          if (supa) {
            // First: fetch asset rows so we can remove files from storage (avoid orphaned objects)
            const bucket = window.SUPABASE_BUCKET || 'watch-assets';
            try {
              const { data: assetsToRemove, error: eFetch } = await supa.from('assets').select('id,url').eq('sku_id', key);
              if (eFetch) throw eFetch;
              const paths = (assetsToRemove || []).map(a => {
                const url = a && a.url ? String(a.url) : '';
                // common Supabase public URL pattern includes `/storage/v1/object/public/<bucket>/<path>`
                const m = url.match(/\/storage\/v1\/object\/public\/(?:[^/]+)\/(.+)$/);
                if (m && m[1]) return decodeURIComponent(m[1]);
                // fallback: find `/${bucket}/` and take the remainder
                const idx = url.indexOf('/' + bucket + '/');
                if (idx !== -1) return url.slice(idx + bucket.length + 2);
                return null;
              }).filter(Boolean);
              if (paths.length) {
                const { error: eRem } = await supa.storage.from(bucket).remove(paths);
                if (eRem) console.warn('storage remove returned error', eRem);
              }
            } catch (e) {
              console.warn('Failed to remove storage objects for SKU', key, e);
              // proceed to delete DB rows anyway
            }

            // delete DB rows for assets and the sku record
            const { error: eDel } = await supa.from('assets').delete().eq('sku_id', key);
            if (eDel) throw eDel;
            const { error: eSku } = await supa.from('skus').delete().eq('id', key);
            if (eSku) throw eSku;
          }
          // remove local
          delete CATALOG[key];
          localStorage.setItem('watchCatalog', JSON.stringify(CATALOG));
          await maybeLoadCatalogFromSupabase();
          refreshSkuSelect();
          if (typeof renderAdminList === 'function') try { renderAdminList(); } catch (_) {}
          if (typeof refreshSkuTable === 'function') try { refreshSkuTable(); } catch (_) {}
          showToast('ลบ SKU สำเร็จ', 'success');
        } catch (err) {
          console.error(err);
          showToast('เกิดข้อผิดพลาด: ' + (err && err.message ? err.message : String(err)), 'error');
        }
      });
      right.appendChild(btnEdit);
      right.appendChild(btnDelete);
      row.appendChild(left);
      row.appendChild(right);
      wrap.appendChild(row);
    });
  }
  renderAdminList();
  // --- New admin single-page SKU manager wiring ---
  // DUPLICATES below (defined earlier); comment out re-declarations
  // const skuTableBody = document.querySelector('#sku-table tbody');
  // const btnAddSkuTop = document.getElementById('btn-add-sku');
  // const partModal = document.getElementById('part-modal');
  // const pmClose = document.getElementById('pm-close');
  // const pmSkuKey = document.getElementById('pm-sku-key');
  // const pmGroupSelect = document.getElementById('pm-group-select');
  // const btnAddGroup = document.getElementById('btn-add-group');
  // const pmFiles = document.getElementById('pm-files');
  // const pmThumbs = document.getElementById('pm-thumbs');
  // Dragging state for part thumbnails
  // let pmDragEl = null;
  // const pmAddBtn = document.getElementById('pm-add-btn');

  // Add Group Modal elements (duplicates — already defined earlier)
  // const groupAddModal = document.getElementById('group-add-modal');
  // const gamClose = document.getElementById('gam-close');
  // const gamSkuKey = document.getElementById('gam-sku-key');
  // const gamGroupList = document.getElementById('gam-group-list');
  // const gamSave = document.getElementById('gam-save');
  // const gamAddNewBtn = document.getElementById('gam-add-new');
  // const gamNewKeyInput = document.getElementById('gam-new-key');
  // const gamNewNameThInput = document.getElementById('gam-new-name-th');
  // const gamNewNameEnInput = document.getElementById('gam-new-name-en');

  function buildSkuRow(key, parts) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${key}</td>` +
      `<td>${(parts && parts.__name) ? parts.__name : ''}</td>` +
      `<td>${Object.keys(parts || {}).filter(k=>k !== '__name').length}</td>` +
      `<td><div class="flex items-center gap-2">` +
      `<button class="edit-sku btn btn-secondary" data-sku="${key}">âœï¸ à¹à¸à¹‰à¹„à¸‚</button>` +
      `<button class="pm-open btn btn-secondary" data-sku="${key}">à¸ˆà¸±à¸"à¸à¸²à¸£à¸¥à¸²à¸¢</button>` +
      `<button class="del-sku btn-text-danger" data-sku="${key}">à¸¥à¸š SKU</button>` +
      `</div></td>`;
    return tr;
  }

  // Delete SKU helper reused by table actions
  async function deleteSkuById(key) {
    if (!key) return;
    if (!confirm('Delete this SKU and all its assets?')) return;
    const supa = getSupabaseClient();
    try {
      if (supa) {
        const bucket = window.SUPABASE_BUCKET || 'watch-assets';
        try {
          const { data: assetsToRemove, error: eFetch } = await supa
            .from('assets')
            .select('id,url')
            .eq('sku_id', key);
          if (eFetch) throw eFetch;
          const paths = (assetsToRemove || [])
            .map(a => {
              const url = a && a.url ? String(a.url) : '';
              const m = url.match(/\/storage\/v1\/object\/public\/(?:[^/]+)\/(.+)$/);
              if (m && m[1]) return decodeURIComponent(m[1]);
              const idx = url.indexOf('/' + bucket + '/');
              if (idx !== -1) return url.slice(idx + bucket.length + 2);
              return null;
            })
            .filter(Boolean);
          if (paths.length) {
            const { error: eRem } = await supa.storage.from(bucket).remove(paths);
            if (eRem) console.warn('storage remove returned error', eRem);
          }
        } catch (e) {
          console.warn('Failed to remove storage objects for SKU', key, e);
        }
        const { error: eDel } = await supa.from('assets').delete().eq('sku_id', key);
        if (eDel) throw eDel;
        const { error: eSku } = await supa.from('skus').delete().eq('id', key);
        if (eSku) throw eSku;
      }
      // always remove local copy too
      delete CATALOG[key];
      localStorage.setItem('watchCatalog', JSON.stringify(CATALOG));
      await maybeLoadCatalogFromSupabase();
      refreshSkuSelect();
      if (typeof renderAdminList === 'function') try { renderAdminList(); } catch (_) {}
      if (typeof refreshSkuTable === 'function') try { refreshSkuTable(); } catch (_) {}
      showToast('Deleted SKU successfully', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to delete SKU: ' + (err && err.message ? err.message : String(err)), 'error');
    }
  }

  // Render admin SKU table in admin.html
  function refreshSkuTable() {
    const tbody = document.querySelector('#sku-table tbody');
    if (!tbody) return;
    const q = (document.getElementById('sku-search')?.value || '').toLowerCase().trim();
    const entries = Object.entries(CATALOG || {})
      .filter(([key, parts]) => parts && typeof parts === 'object')
      .sort((a, b) => ((a[1].__name || a[0]).localeCompare(b[1].__name || b[0])));
    tbody.innerHTML = '';
    let count = 0;
    entries.forEach(([key, parts]) => {
      const name = (parts && parts.__name) ? String(parts.__name) : '';
      if (q && !(key.toLowerCase().includes(q) || name.toLowerCase().includes(q))) return;
      const tr = document.createElement('tr');
      const groups = Object.keys(parts || {}).filter(k => k !== '__name' && k !== '__created_at');
      const groupsCount = groups.length;
      const imagesCount = groups.reduce((sum, g) => sum + ((parts[g] || []).length), 0);
      const createdAt = parts.__created_at ? new Date(parts.__created_at).toLocaleString() : '-';
      tr.innerHTML = `
        <td>${key}</td>
        <td>${name || '-'}</td>
        <td>${createdAt}</td>
        <td>${imagesCount}</td>
        <td>
          <div class="flex items-center gap-2">
            <button class="edit-sku btn btn-secondary" data-sku="${key}">Edit</button>
            <button class="pm-open btn btn-secondary" data-sku="${key}">Manage parts</button>
            <button class="del-sku btn-text-danger" data-sku="${key}">Delete</button>
          </div>
        </td>`;
      tbody.appendChild(tr);
      count++;
    });
    if (count === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="5" class="text-center text-gray-500">No SKUs</td>';
      tbody.appendChild(tr);
    }
    // Wire row actions
    tbody.querySelectorAll('.edit-sku').forEach(btn => {
      btn.addEventListener('click', () => {
        const sku = btn.getAttribute('data-sku');
        if (typeof openEditSkuModal === 'function') {
          openEditSkuModal(sku);
        } else {
          // Fallback to name-only modal if present
          try { openEditSKUModal(sku); } catch (e) { console.warn('edit modal not available'); }
        }
      });
    });
    tbody.querySelectorAll('.pm-open').forEach(btn => {
      btn.addEventListener('click', () => {
        const sku = btn.getAttribute('data-sku');
        try { openPartModalForSKU(sku); } catch (e) { console.warn('openPartModalForSKU missing', e); }
      });
    });
    tbody.querySelectorAll('.del-sku').forEach(btn => {
      btn.addEventListener('click', async () => {
        const sku = btn.getAttribute('data-sku');
        await deleteSkuById(sku);
      });
    });
  }

  function renderSkuTable() {
    const tableBody = document.getElementById('skuTableBody');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    skuData.forEach(sku => {
      const row = document.createElement('tr');
      
      // Create store icon based on store name
      let storeIcon = '';
      if (sku.store_name && sku.store_name.toLowerCase().includes('lazada')) {
        storeIcon = '<i class="store-icon lazada-icon" title="Lazada">🛒</i>';
      } else if (sku.store_name && sku.store_name.toLowerCase().includes('shopee')) {
        storeIcon = '<i class="store-icon shopee-icon" title="Shopee">🛍️</i>';
      } else {
        storeIcon = '<i class="store-icon default-icon" title="Store">🏪</i>';
      }
      
      // Create image thumbnails
      const imageThumbnails = sku.image_urls && sku.image_urls.length > 0 
          ? sku.image_urls.map(url => `<img src="${url}" alt="Product image" class="thumbnail" onclick="window.open('${url}', '_blank')">`).join('')
          : 'No images';
      
      // Create MCP Supabase status
      const mcpStatus = sku.mcp_supabase_id 
          ? `<span class="status-badge success">âœ" Synced</span>`
          : `<span class="status-badge pending">Not synced</span>`;
      
      row.innerHTML = `
          <td>${sku.sku}</td>
          <td>${storeIcon} ${sku.store_name || 'N/A'}</td>
          <td><a href="${sku.store_url || '#'}" target="_blank">${sku.store_url ? 'Visit Store' : 'N/A'}</a></td>
          <td>${sku.product_name || 'N/A'}</td>
          <td><a href="${sku.product_url || '#'}" target="_blank">${sku.product_url ? 'View Product' : 'N/A'}</a></td>
          <td>${sku.price || 'N/A'}</td>
          <td>${sku.stock || 'N/A'}</td>
          <td class="image-cell">${imageThumbnails}</td>
          <td>${mcpStatus}</td>
          <td>
              <button class="btn btn-primary btn-sm" onclick="editSku('${sku.sku}')">Edit</button>
              <button class="btn btn-danger btn-sm" onclick="deleteSku('${sku.sku}')">Delete</button>
          </td>
      `;
      
      tableBody.appendChild(row);
    });
  }

  // Support admin.html side modal (#editSkuModal)
  const skuSideModal = document.getElementById('editSkuModal');
  const editSkuForm = document.getElementById('editSkuForm');
  const esId = document.getElementById('edit-sku-id');
  const esStoreName = document.getElementById('edit-store-name');
  const esStoreUrl = document.getElementById('edit-store-url');
  const esProductName = document.getElementById('edit-product-name');
  const esProductUrl = document.getElementById('edit-product-url');
  const esPrice = document.getElementById('edit-price');
  const esStock = document.getElementById('edit-stock');

  function openEditSkuModal(skuId) {
    if (!skuSideModal || !skuId) return;
    editSkuContext = skuId;
    if (esId) esId.value = skuId;
    const name = (CATALOG[skuId] && CATALOG[skuId].__name) ? CATALOG[skuId].__name : '';
    if (esStoreName) esStoreName.value = name;
    if (esProductName) esProductName.value = name;
    // Optional fields left blank for now
    skuSideModal.classList.remove('hidden');
    skuSideModal.style.display = 'flex';
  }
  function closeEditSkuModal() {
    if (!skuSideModal) return;
    skuSideModal.style.display = 'none';
    skuSideModal.classList.add('hidden');
    if (editSkuForm) editSkuForm.reset();
    editSkuContext = null;
  }
  try { window.openEditSkuModal = openEditSkuModal; window.closeEditSkuModal = closeEditSkuModal; } catch (_) {}

  if (editSkuForm) {
    editSkuForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!editSkuContext) return;
      const newName = esStoreName ? esStoreName.value.trim() : '';
      try {
        const supa = getSupabaseClient();
        if (supa) {
          const { error } = await supa
            .from('skus')
            .update({ name: newName || editSkuContext })
            .eq('id', editSkuContext);
          if (error) throw error;
        }
        if (CATALOG[editSkuContext]) {
          CATALOG[editSkuContext].__name = newName || CATALOG[editSkuContext].__name || editSkuContext;
        }
        localStorage.setItem('watchCatalog', JSON.stringify(CATALOG));
        refreshSkuSelect();
        refreshSkuTable();
        showToast('Saved changes', 'success');
        closeEditSkuModal();
      } catch (err) {
        console.error(err);
        showToast('Failed to save: ' + (err && err.message ? err.message : String(err)), 'error');
      }
    });
  }

  // Edit Pattern Name Modal Functions
  let editPatternContext = null;
  const editPatternModal = document.getElementById('edit-pattern-modal');
  const editPatternNameInput = document.getElementById('edit-pattern-name-input');
  const editPatternGroupDisplay = document.getElementById('edit-pattern-group-display');
  const editPatternPreview = document.getElementById('edit-pattern-preview');
  const editPatternClose = document.getElementById('edit-pattern-close');
  const editPatternCancel = document.getElementById('edit-pattern-cancel');
  const editPatternSave = document.getElementById('edit-pattern-save');

  function openEditPatternModal(skuId, groupKey, itemIdx, itemData) {
    if (!skuId || !groupKey || itemIdx === undefined || !itemData) return;
    editPatternContext = { skuId, groupKey, itemIdx, itemData };
    
    const groupInfo = MASTER_GROUP_LIST.find(g => g.key === groupKey);
    const groupName = groupInfo ? `${groupInfo.name_th} (${groupInfo.name_en})` : groupKey;
    
    editPatternNameInput.value = itemData.label || '';
    editPatternGroupDisplay.value = groupName;
    editPatternPreview.src = itemData.dataUrl || (itemData.file ? (IMG_BASE + itemData.file) : '');
    
    if (editPatternModal) editPatternModal.classList.remove('hidden');
  }

  function closeEditPatternModal() {
    editPatternContext = null;
    if (editPatternModal) editPatternModal.classList.add('hidden');
    if (editPatternNameInput) editPatternNameInput.value = '';
    if (editPatternGroupDisplay) editPatternGroupDisplay.value = '';
    if (editPatternPreview) editPatternPreview.src = '';
  }

  async function saveEditPattern() {
    if (!editPatternContext) return;
    const { skuId, groupKey, itemIdx, itemData } = editPatternContext;
    const newLabel = editPatternNameInput ? editPatternNameInput.value.trim() : '';
    
    if (!newLabel) {
      showToast('à¸à¸£à¸¸à¸"à¸²à¸à¸£à¸­à¸à¸Šà¸·à¹ˆà¸­à¸¥à¸²à¸¢', 'error');
      return;
    }

    const supa = getSupabaseClient();
    if (!supa) {
      showToast('à¹„à¸¡à¹ˆà¸ªà¸²à¸¡à¸²à¸£à¸–à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­ Supabase', 'error');
      return;
    }

    try {
      // Find the asset in Supabase by matching URL
      const { data: assets, error: fetchError } = await supa
        .from('assets')
        .select('id,url')
        .eq('sku_id', skuId)
        .eq('group_key', groupKey);

      if (fetchError) throw fetchError;

      // Find the matching asset by URL
      const normalizedUrl = normalizeUrl(itemData.dataUrl || '');
      const matchingAsset = (assets || []).find(a => normalizeUrl(a.url || '') === normalizedUrl);

      if (!matchingAsset) {
        showToast('à¹„à¸¡à¹ˆà¸žà¸šà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸¥à¸²à¸¢à¸™à¸µà¹‰à¹ƒà¸™à¸à¸²à¸™à¸‚à¹‰à¸­à¸¡à¸¹à¸¥', 'error');
        return;
      }

      // Update in Supabase
      const { error: updateError } = await supa
        .from('assets')
        .update({ label: newLabel })
        .eq('id', matchingAsset.id);

      if (updateError) throw updateError;

      // Update local catalog
      if (CATALOG[skuId] && CATALOG[skuId][groupKey] && CATALOG[skuId][groupKey][itemIdx]) {
        CATALOG[skuId][groupKey][itemIdx].label = newLabel;
      }
      localStorage.setItem('watchCatalog', JSON.stringify(CATALOG));

      showToast('à¹à¸à¹‰à¹„à¸‚à¸Šà¸·à¹ˆà¸­à¸¥à¸²à¸¢à¸ªà¸³à¹€à¸£à¹‡à¸ˆ', 'success');
      closeEditPatternModal();
      renderModalThumbs();
      
      // Update preview if this is the current SKU
      if (skuId === currentSKU) {
        PARTS = CATALOG[currentSKU] || {};
        renderGrid('grid-' + groupKey, PARTS[groupKey] || [], groupKey, state);
        applySelections(state);
      }
    } catch (e) {
      console.error(e);
      showToast('à¹€à¸à¸´à¸"à¸‚à¹‰à¸­à¸œà¸´à¸"à¸žà¸¥à¸²à¸"à¸‚à¸"à¸°à¸¥à¸š: ' + (e && e.message ? e.message : String(e)), 'error');
    }
  }

  if (editPatternClose) editPatternClose.addEventListener('click', closeEditPatternModal);
  if (editPatternCancel) editPatternCancel.addEventListener('click', closeEditPatternModal);
  if (editPatternSave) editPatternSave.addEventListener('click', saveEditPattern);

  // ===== PART GROUPS MANAGEMENT =====
  const menuPartGroups = document.getElementById('menu-part-groups');
  // DUPLICATE: panelPartGroups is already defined earlier
  // const panelPartGroups = document.getElementById('panel-part-groups');
  const partGroupsTable = document.getElementById('part-groups-table');
  const partGroupsTableBody = partGroupsTable ? partGroupsTable.querySelector('tbody') : null;
  const btnAddPartGroup = document.getElementById('btn-add-part-group');
  
  const partGroupModal = document.getElementById('part-group-modal');
  const partGroupModalTitle = document.getElementById('part-group-modal-title');
  const partGroupModalClose = document.getElementById('part-group-modal-close');
  const partGroupCancel = document.getElementById('part-group-cancel');
  const partGroupSave = document.getElementById('part-group-save');
  const pgNameEn = document.getElementById('pg-name-en');
  const pgNameTh = document.getElementById('pg-name-th');
  const pgKey = document.getElementById('pg-key');
  const pgSortOrder = document.getElementById('pg-sort-order');
  const pgZIndex = document.getElementById('pg-z-index');
  
  let editingPartGroupKey = null; // null = adding new, otherwise editing existing

  // Auto-generate key from English name
  if (pgNameEn) {
    pgNameEn.addEventListener('input', () => {
      if (!editingPartGroupKey && pgKey) {
        pgKey.value = pgNameEn.value.toLowerCase().replace(/[^a-z0-9]/g, '');
      }
    });
  }

  // Menu switching - this is handled later in the unified menu system (line 2930-2942)
  // But we need to add the refresh table logic
  if (menuPartGroups) {
    menuPartGroups.addEventListener('click', () => {
      // Refresh table when panel becomes visible
      refreshPartGroupsTable();
    });
  }

  async function refreshPartGroupsTable() {
    if (!partGroupsTableBody) return;
    
    partGroupsTableBody.innerHTML = '<tr><td colspan="6" class="text-center">กำลังโหลด...</td></tr>';
    
    const supa = getSupabaseClient();
    if (!supa) {
      partGroupsTableBody.innerHTML = '<tr><td colspan="6" class="text-center text-red-600">ไม่สามารถเชื่อมต่อ Supabase</td></tr>';
      return;
    }
    
    try {
      const { data, error } = await supa
        .from('part_groups')
        .select('*')
        .order('z_index', { ascending: true }); // เรียงตาม Layer จากล่างขึ้นบน
      
      if (error) throw error;
      
      if (!data || data.length === 0) {
        partGroupsTableBody.innerHTML = '<tr><td colspan="6" class="text-center">ไม่มีข้อมูล</td></tr>';
        return;
      }
      
      partGroupsTableBody.innerHTML = '';
      data.forEach((pg, index) => {
        const tr = document.createElement('tr');
        tr.draggable = true;
        tr.dataset.key = pg.key;
        tr.dataset.zIndex = pg.z_index;
        tr.style.cursor = 'move';
        
        tr.innerHTML = `
          <td>
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-gray-400" style="cursor: move;">drag_indicator</span>
              <code class="bg-gray-100 px-2 py-1 rounded">${pg.key}</code>
            </div>
          </td>
          <td>${pg.name_th || '-'}</td>
          <td>${pg.name_en || '-'}</td>
          <td class="text-center">${pg.sort_order || '-'}</td>
          <td class="text-center font-bold">${pg.z_index || '-'}</td>
          <td>
            <div class="flex items-center gap-2">
              <button class="edit-part-group btn btn-secondary text-sm" data-key="${pg.key}" title="แก้ไข"><span class="material-symbols-outlined">edit</span></button>
              <button class="delete-part-group btn-text-danger text-sm" data-key="${pg.key}" title="ลบ"><span class="material-symbols-outlined">delete</span></button>
            </div>
          </td>
        `;
        
        // Add drag event listeners
        tr.addEventListener('dragstart', handleDragStart);
        tr.addEventListener('dragover', handleDragOver);
        tr.addEventListener('drop', handleDrop);
        tr.addEventListener('dragend', handleDragEnd);
        
        partGroupsTableBody.appendChild(tr);
      });
      
      // Wire up edit buttons
      document.querySelectorAll('.edit-part-group').forEach(btn => {
        btn.addEventListener('click', async () => {
          const key = btn.dataset.key;
          await openEditPartGroupModal(key);
        });
      });
      
      // Wire up delete buttons
      document.querySelectorAll('.delete-part-group').forEach(btn => {
        btn.addEventListener('click', async () => {
          const key = btn.dataset.key;
          await deletePartGroup(key);
        });
      });
      
    } catch (e) {
      console.error(e);
      partGroupsTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-red-600">เกิดข้อผิดพลาด: ${e.message}</td></tr>`;
    }
  }

  async function openAddPartGroupModal() {
    editingPartGroupKey = null;
    if (partGroupModalTitle) partGroupModalTitle.textContent = 'เพิ่ม Part Group ใหม่';
    if (pgNameEn) pgNameEn.value = '';
    if (pgNameTh) pgNameTh.value = '';
    if (pgKey) { pgKey.value = ''; pgKey.readOnly = false; }
    
    // Auto-calculate Sort Order and Layer (Z-Index) to be on top
    const supa = getSupabaseClient();
    if (supa) {
      try {
        const { data, error } = await supa
          .from('part_groups')
          .select('sort_order, z_index')
          .order('sort_order', { ascending: false })
          .limit(1);
        
        if (!error && data && data.length > 0) {
          const maxSortOrder = data[0].sort_order || 0;
          
          // Get max z_index separately
          const { data: zData } = await supa
            .from('part_groups')
            .select('z_index')
            .order('z_index', { ascending: false })
            .limit(1);
          
          const maxZIndex = (zData && zData[0]) ? zData[0].z_index || 0 : 0;
          
          if (pgSortOrder) pgSortOrder.value = maxSortOrder + 1;
          if (pgZIndex) pgZIndex.value = maxZIndex + 1;
        } else {
          // Default if no existing part groups
          if (pgSortOrder) pgSortOrder.value = '1';
          if (pgZIndex) pgZIndex.value = '1';
        }
      } catch (e) {
        console.error('Error getting max values:', e);
        // Default values on error
        if (pgSortOrder) pgSortOrder.value = '1';
        if (pgZIndex) pgZIndex.value = '1';
      }
    } else {
      // Default values if no Supabase connection
      if (pgSortOrder) pgSortOrder.value = '1';
      if (pgZIndex) pgZIndex.value = '1';
    }
    
    if (partGroupModal) partGroupModal.classList.remove('hidden');
  }

  async function openEditPartGroupModal(key) {
    editingPartGroupKey = key;
    if (partGroupModalTitle) partGroupModalTitle.textContent = 'แก้ไข Part Group';
    
    const supa = getSupabaseClient();
    if (!supa) {
      showToast('ไม่สามารถเชื่อมต่อ Supabase', 'error');
      return;
    }
    
    try {
      const { data, error } = await supa
        .from('part_groups')
        .select('*')
        .eq('key', key)
        .single();
      
      if (error) throw error;
      
      if (data) {
        if (pgNameEn) pgNameEn.value = data.name_en || '';
        if (pgNameTh) pgNameTh.value = data.name_th || '';
        if (pgKey) { pgKey.value = data.key || ''; pgKey.readOnly = true; }
        if (pgSortOrder) pgSortOrder.value = data.sort_order || '1';
        if (pgZIndex) pgZIndex.value = data.z_index || '1';
      }
      
      if (partGroupModal) partGroupModal.classList.remove('hidden');
    } catch (e) {
      console.error(e);
      showToast('ไม่สามารถโหลดข้อมูล: ' + e.message, 'error');
    }
  }

  function closePartGroupModal() {
    editingPartGroupKey = null;
    if (partGroupModal) partGroupModal.classList.add('hidden');
    if (pgNameEn) pgNameEn.value = '';
    if (pgNameTh) pgNameTh.value = '';
    if (pgKey) pgKey.value = '';
    if (pgSortOrder) pgSortOrder.value = '1';
    if (pgZIndex) pgZIndex.value = '1';
  }

  async function savePartGroup() {
    const nameEn = pgNameEn ? pgNameEn.value.trim() : '';
    const nameTh = pgNameTh ? pgNameTh.value.trim() : '';
    const key = pgKey ? pgKey.value.trim() : '';
    const sortOrder = pgSortOrder ? parseInt(pgSortOrder.value) : 1;
    const zIndex = pgZIndex ? parseInt(pgZIndex.value) : 1;
    
    if (!nameEn || !nameTh || !key) {
      showToast('กรุณากรอกข้อมูลให้ครบถ้วน', 'error');
      return;
    }
    
    const supa = getSupabaseClient();
    if (!supa) {
      showToast('ไม่สามารถเชื่อมต่อ Supabase', 'error');
      return;
    }
    
    try {
      const data = {
        key,
        name_en: nameEn,
        name_th: nameTh,
        sort_order: sortOrder,
        z_index: zIndex
      };
      
      if (editingPartGroupKey) {
        // Update existing
        const { error } = await supa
          .from('part_groups')
          .update({
            name_en: nameEn,
            name_th: nameTh,
            sort_order: sortOrder,
            z_index: zIndex
          })
          .eq('key', editingPartGroupKey);
        
        if (error) throw error;
        showToast('แก้ไข Part Group สำเร็จ', 'success');
      } else {
        // Insert new
        const { error } = await supa
          .from('part_groups')
          .insert([data]);
        
        if (error) throw error;
        showToast('เพิ่ม Part Group สำเร็จ', 'success');
      }
      
      closePartGroupModal();
      
      // Reload part groups and refresh UI
      await loadPartGroups(supa);
      refreshPartGroupsTable();
      
      // Clear localStorage to force reload on main page
      localStorage.removeItem('watchCatalog');
      
    } catch (e) {
      console.error(e);
      showToast('เกิดข้อผิดพลาด: ' + (e.message || String(e)), 'error');
    }
  }

  async function deletePartGroup(key) {
    if (!confirm(`ต้องการลบ Part Group "${key}" ใช่หรือไม่?\n\n⚠️ คำเตือน: การลบจะทำให้ข้อมูลทั้งหมดที่เกี่ยวข้องหายไป`)) {
      return;
    }
    
    const supa = getSupabaseClient();
    if (!supa) {
      showToast('ไม่สามารถเชื่อมต่อ Supabase', 'error');
      return;
    }
    
    try {
      // Check if there are assets using this group
      const { data: assets, error: assetsError } = await supa
        .from('assets')
        .select('id')
        .eq('group_key', key)
        .limit(1);
      
      if (assetsError) throw assetsError;
      
      if (assets && assets.length > 0) {
        if (!confirm(`พบข้อมูล ${assets.length} รายการที่ใช้ Part Group นี้\n\nต้องการลบทั้งหมดใช่หรือไม่?`)) {
          return;
        }
        
        // Delete all assets with this group_key
        const { error: deleteAssetsError } = await supa
          .from('assets')
          .delete()
          .eq('group_key', key);
        
        if (deleteAssetsError) throw deleteAssetsError;
      }
      
      // Delete the part group
      const { error } = await supa
        .from('part_groups')
        .delete()
        .eq('key', key);
      
      if (error) throw error;
      
      showToast('ลบ Part Group สำเร็จ', 'success');
      
      // Reload part groups and refresh UI
      await loadPartGroups(supa);
      refreshPartGroupsTable();
      
      // Clear localStorage to force reload on main page
      localStorage.removeItem('watchCatalog');
      
    } catch (e) {
      console.error(e);
      showToast('เกิดข้อผิดพลาด: ' + (e.message || String(e)), 'error');
    }
  }

  // Drag and Drop functionality for reordering layers
  let draggedRow = null;

  function handleDragStart(e) {
    draggedRow = this;
    this.style.opacity = '0.4';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
  }

  function handleDragOver(e) {
    if (e.preventDefault) {
      e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';
    return false;
  }

  function handleDragEnter(e) {
    if (this !== draggedRow) {
      this.style.backgroundColor = '#e3f2fd';
    }
  }

  function handleDragLeave(e) {
    this.style.backgroundColor = '';
  }

  async function handleDrop(e) {
    if (e.stopPropagation) {
      e.stopPropagation();
    }
    
    if (draggedRow !== this) {
      // Get all rows
      const rows = Array.from(partGroupsTableBody.querySelectorAll('tr'));
      const draggedIndex = rows.indexOf(draggedRow);
      const droppedIndex = rows.indexOf(this);
      
      // Reorder in DOM
      if (draggedIndex < droppedIndex) {
        this.parentNode.insertBefore(draggedRow, this.nextSibling);
      } else {
        this.parentNode.insertBefore(draggedRow, this);
      }
      
      // Update z_index values based on new order
      await updateLayerOrder();
    }
    
    this.style.backgroundColor = '';
    return false;
  }

  function handleDragEnd(e) {
    this.style.opacity = '1';
    
    // Remove all background colors
    const rows = partGroupsTableBody.querySelectorAll('tr');
    rows.forEach(row => {
      row.style.backgroundColor = '';
    });
  }

  async function updateLayerOrder() {
    const rows = Array.from(partGroupsTableBody.querySelectorAll('tr'));
    const supa = getSupabaseClient();
    
    if (!supa) {
      showToast('ไม่สามารถเชื่อมต่อ Supabase', 'error');
      return;
    }
    
    try {
      // Update z_index based on position (first row = z_index 1, last row = highest z_index)
      const updates = rows.map((row, index) => {
        const key = row.dataset.key;
        const newZIndex = index + 1; // Start from 1
        return { key, z_index: newZIndex };
      });
      
      // Update each part group in database
      for (const update of updates) {
        const { error } = await supa
          .from('part_groups')
          .update({ z_index: update.z_index })
          .eq('key', update.key);
        
        if (error) throw error;
      }
      
      // Update the display immediately without refreshing (to prevent flickering)
      rows.forEach((row, index) => {
        const layerCell = row.querySelector('td:nth-child(5)'); // Layer column
        if (layerCell) {
          layerCell.textContent = index + 1;
        }
        row.dataset.zIndex = index + 1;
      });
      
      showToast('อัปเดตลำดับ Layer สำเร็จ', 'success');
      
      // Reload part groups in background (don't refresh table to avoid re-sorting)
      await loadPartGroups(supa);
      
      // Clear localStorage to force reload on main page
      localStorage.removeItem('watchCatalog');
      
    } catch (e) {
      console.error(e);
      showToast('เกิดข้อผิดพลาด: ' + (e.message || String(e)), 'error');
      refreshPartGroupsTable(); // Refresh to restore original order only on error
    }
  }

  // Event listeners
  if (btnAddPartGroup) btnAddPartGroup.addEventListener('click', async () => {
    await openAddPartGroupModal();
  });
  if (partGroupModalClose) partGroupModalClose.addEventListener('click', closePartGroupModal);
  if (partGroupCancel) partGroupCancel.addEventListener('click', closePartGroupModal);
  if (partGroupSave) partGroupSave.addEventListener('click', savePartGroup);

  // Part modal elements for SKU management
  const partModal = document.getElementById('part-modal');
  const pmClose = document.getElementById('pm-close');
  const pmSkuKey = document.getElementById('pm-sku-key');
  const pmGroupSelect = document.getElementById('pm-group-select');
  const pmFiles = document.getElementById('pm-files');
  const pmThumbs = document.getElementById('pm-thumbs');
  const btnAddSkuTop = document.getElementById('btn-add-sku');
  const pmAddBtn = document.getElementById('pm-add-btn');
  
  // Dragging state for part thumbnails
  let pmDragEl = null;

  async function openPartModalForSKU(sku) {
    modalContextSku = sku;
    pmSkuKey.textContent = sku;
    
    // ดึงข้อมูลจากฐานข้อมูล Supabase เท่านั้น
    const supabase = getSupabaseClient();
    if (!supabase) {
      alert('ไม่สามารถเชื่อมต่อฐานข้อมูลได้');
      return;
    }

    try {
      // ดึง part groups ที่มี assets สำหรับ SKU นี้
      const { data: groups, error: groupError } = await supabase
        .from('assets')
        .select('group_key')
        .eq('sku_id', sku)
        .not('group_key', 'is', null);
      
      if (groupError) throw groupError;

      // ดึงข้อมูล part_groups เพื่อแสดงชื่อภาษาไทย
      const uniqueGroups = [...new Set(groups.map(g => g.group_key))];
      const { data: partGroups, error: partGroupError } = await supabase
        .from('part_groups')
        .select('key, name_th, name_en, sort_order')
        .in('key', uniqueGroups)
        .order('sort_order');

      if (partGroupError) throw partGroupError;

      // populate group select
      pmGroupSelect.innerHTML = '';
      partGroups.forEach(group => {
        const opt = document.createElement('option');
        opt.value = group.key;
        opt.textContent = `${group.name_th} (${group.name_en})`;
        pmGroupSelect.appendChild(opt);
      });

      // default to first group
      if (partGroups.length && pmGroupSelect) {
        pmGroupSelect.value = partGroups[0].key;
      }

      // populate thumbs AFTER setting the value
      setTimeout(() => {
        refreshSubcategoryControls();
        renderModalThumbs();
      }, 0);
      
      if (partModal) partModal.classList.remove('hidden');
    } catch (error) {
      console.error('Error loading parts:', error);
      alert('เกิดข้อผิดพลาดในการโหลดข้อมูล: ' + error.message);
    }
  }
  function closePartModal() { modalContextSku = null; if (partModal) partModal.classList.add('hidden'); pmThumbs.innerHTML = ''; pmFiles.value = ''; }
  if (pmClose) pmClose.addEventListener('click', closePartModal);
  if (btnAddSkuTop) btnAddSkuTop.addEventListener('click', () => { /* reuse existing admin flow: open overlay or reuse existing fields */ alert('Use the SKU creation area (not implemented)'); });
  if (pmGroupSelect) pmGroupSelect.addEventListener('change', () => { refreshSubcategoryControls(); renderModalThumbs(); });
  const pmSubcatFilter = document.getElementById('pm-subcat-filter');
  const pmSubcatNew = document.getElementById('pm-subcat-new');
  const pmSubcatAdd = document.getElementById('pm-subcat-add');

  async function refreshSubcategoryControls() {
    if (!pmSubcatFilter) return;
    const g = pmGroupSelect ? pmGroupSelect.value : null;
    const current = pmSubcatFilter.value || 'all';
    pmSubcatFilter.innerHTML = '';
    const optAll = document.createElement('option'); optAll.value = 'all'; optAll.textContent = 'All'; pmSubcatFilter.appendChild(optAll);

    try {
      const supabase = getSupabaseClient();
      if (supabase) {
        // ดึง subcategories จากฐานข้อมูล
        const { data: subcategories, error: subError } = await supabase
          .from('subcategories')
          .select('name')
          .eq('sku_id', modalContextSku)
          .eq('group_key', g);

        if (!subError && subcategories) {
          subcategories.forEach(sc => {
            const opt = document.createElement('option');
            opt.value = sc.name;
            opt.textContent = sc.name;
            pmSubcatFilter.appendChild(opt);
          });
        }

        // ดึง subcategories จาก assets.subcategory
        const { data: assets, error: assetError } = await supabase
          .from('assets')
          .select('subcategory')
          .eq('sku_id', modalContextSku)
          .eq('group_key', g)
          .not('subcategory', 'is', null)
          .not('subcategory', 'eq', '');

        if (!assetError && assets) {
          const uniqueAssets = [...new Set(assets.map(a => a.subcategory))];
          uniqueAssets.forEach(name => {
            // ตรวจสอบว่าไม่มีอยู่แล้ว
            if (!Array.from(pmSubcatFilter.options).some(opt => opt.value === name)) {
              const opt = document.createElement('option');
              opt.value = name;
              opt.textContent = name + ' (จาก Assets)';
              pmSubcatFilter.appendChild(opt);
            }
          });
        }
      }
    } catch (error) {
      console.error('Error loading subcategories:', error);
    }

    // Also include locally added names (from localStorage) so they appear immediately
    try {
      const listLocal = getSubcatList(modalContextSku, g) || [];
      listLocal.forEach(name => {
        if (!Array.from(pmSubcatFilter.options).some(opt => opt.value === name)) {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          pmSubcatFilter.appendChild(opt);
        }
      });
    } catch (_) {}

    pmSubcatFilter.value = Array.from(pmSubcatFilter.options).some(opt => opt.value === current) ? current : 'all';
  }
  if (pmSubcatFilter) pmSubcatFilter.addEventListener('change', renderModalThumbs);
  if (pmSubcatAdd) pmSubcatAdd.addEventListener('click', async () => {
    const g = pmGroupSelect ? pmGroupSelect.value : null;
    const val = (pmSubcatNew && pmSubcatNew.value || '').trim();
    if (!val) return;
    const list = getSubcatList(modalContextSku, g);
    list.push(val);
    saveSubcatList(modalContextSku, g, list);
    // Try to persist to DB so it shows up under "subcategories" too
    try {
      const supabase = getSupabaseClient();
      if (supabase && modalContextSku && g) {
        await supabase
          .from('subcategories')
          .insert({ sku_id: modalContextSku, group_key: g, name: val, sort_order: 999 });
      }
    } catch (e) {
      console.warn('Failed to insert subcategory into DB:', (e && e.message) || e);
    }
    if (pmSubcatNew) pmSubcatNew.value = '';
    refreshSubcategoryControls();
    renderModalThumbs();
  });
  async function renderModalThumbs() {
    pmThumbs.innerHTML = '';
    if (!modalContextSku) return;
    const g = pmGroupSelect ? pmGroupSelect.value : null;
    
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        pmThumbs.innerHTML = '<div class="text-center text-gray-500 p-4">ไม่สามารถเชื่อมต่อฐานข้อมูลได้</div>';
        return;
      }

      // ดึงข้อมูล assets จากฐานข้อมูล
      const { data: assets, error } = await supabase
        .from('assets')
        .select('*')
        .eq('sku_id', modalContextSku)
        .eq('group_key', g)
        .order('sort', { ascending: true });

      if (error) throw error;

      if (!assets || assets.length === 0) {
        pmThumbs.innerHTML = '<div class="text-center text-gray-500 p-4">ไม่มีรูปภาพสำหรับกลุ่มนี้</div>';
        return;
      }

      // แสดงรูปภาพ
      assets.forEach((asset, idx) => {
        const url = asset.url;
        const wrap = document.createElement('div');
        wrap.className = 'relative cursor-move border border-transparent hover:border-gray-300 rounded';
        wrap.draggable = true;
        wrap.dataset.assetId = asset.id;
        try { wrap.dataset.url = normalizeUrl(url || ''); } catch (_) { wrap.dataset.url = url || ''; }
        
        const img = document.createElement('img'); 
        img.src = url; 
        img.className = 'w-full h-40 md:h-44 lg:h-48 object-contain select-none pointer-events-none';
        
        // Edit button
        const edit = document.createElement('button'); 
        edit.textContent = '✏️'; 
        edit.className = 'absolute top-1 left-1 bg-blue-600 text-white px-2 py-1 text-xs rounded hover:bg-blue-700';
        edit.addEventListener('click', () => {
          alert('Edit functionality not implemented yet');
        });
        
        // Delete button
        const del = document.createElement('button'); 
        del.textContent = '🗑'; 
        del.className = 'absolute top-1 right-1 bg-red-600 text-white px-2 py-1 text-xs rounded hover:bg-red-700';
        del.addEventListener('click', async () => {
          if (!confirm('แน่ใจหรือไม่ที่จะลบรูปนี้?')) return;
          
          del.disabled = true;
          del.textContent = '⏳';
          
          try {
            const { error: delError } = await supabase.from('assets').delete().eq('id', asset.id);
            if (delError) throw delError;
            
            showToast('ลบสำเร็จ', 'success');
            setTimeout(() => renderModalThumbs(), 100);
            
            if (typeof refreshSkuTable === 'function') {
              refreshSkuTable();
            }
          } catch (e) { 
            console.error(e); 
            showToast('เกิดข้อผิดพลาดในการลบ: ' + (e && e.message ? e.message : String(e)), 'error'); 
            del.disabled = false;
            del.textContent = '🗑';
          }
        });
        
        // Add label text below the image
        const labelDiv = document.createElement('div');
        labelDiv.className = 'text-center text-xs font-medium text-gray-600 mt-2 px-1 truncate';
        labelDiv.textContent = asset.label || 'ไม่มีชื่อ';
        
        // Subcategory selector
        const scSel = document.createElement('select');
        scSel.className = 'mt-2 w-full bg-white border border-gray-300 rounded text-xs px-2 py-1';
        scSel.value = asset.subcategory || '';
        
        // Add options
        const optNone = document.createElement('option'); 
        optNone.value = ''; 
        optNone.textContent = '(no subcategory)'; 
        scSel.appendChild(optNone);
        
        // Add existing subcategories
        const existingOptions = Array.from(pmSubcatFilter.options).filter(opt => opt.value !== 'all');
        existingOptions.forEach(opt => {
          const newOpt = document.createElement('option');
          newOpt.value = opt.value;
          newOpt.textContent = opt.textContent;
          scSel.appendChild(newOpt);
        });
        
        scSel.addEventListener('change', async () => {
          const newVal = scSel.value;
          try {
            const { error: updateError } = await supabase
              .from('assets')
              .update({ subcategory: newVal || null })
              .eq('id', asset.id);
            
            if (updateError) throw updateError;
            
            // Update label display
            labelDiv.textContent = (asset.label || 'ไม่มีชื่อ') + (newVal ? ` · ${newVal}` : '');
            
            // Refresh subcategory controls if needed
            const filter = document.getElementById('pm-subcat-filter');
            if (filter && filter.value !== 'all' && filter.value !== newVal) {
              renderModalThumbs();
            }
          } catch (error) {
            console.error('Error updating subcategory:', error);
            showToast('เกิดข้อผิดพลาดในการอัพเดท: ' + error.message, 'error');
          }
        });
        
        wrap.appendChild(img);
        wrap.appendChild(edit);
        wrap.appendChild(del);
        wrap.appendChild(scSel);
        wrap.appendChild(labelDiv);
        pmThumbs.appendChild(wrap);
      });
      
    } catch (error) {
      console.error('Error loading assets:', error);
      pmThumbs.innerHTML = '<div class="text-center text-red-500 p-4">เกิดข้อผิดพลาดในการโหลดข้อมูล</div>';
    }
  }
      
      /* DEDUP: stray duplicate block start
      // Edit button
      const edit = document.createElement('button'); 
      edit.textContent = 'âœï¸'; 
      edit.className = 'absolute top-1 left-1 bg-blue-600 text-white px-2 py-1 text-xs rounded hover:bg-blue-700';
      edit.addEventListener('click', () => {
        openEditPatternModal(modalContextSku, g, idx, it);
      });
      // force monochrome icon style for edit button
      try { edit.innerHTML = '<span class="material-symbols-outlined">edit</span>'; edit.className = 'absolute top-1 left-1 text-gray-700 bg-white/80 border border-gray-300 rounded p-1 hover:bg-gray-100'; } catch (_) {}
      
      // Delete button
      const del = document.createElement('button'); del.textContent = 'à¸¥à¸š'; del.className = 'absolute top-1 right-1 bg-red-600 text-white px-2 py-1 text-xs rounded hover:bg-red-700';
      // force monochrome icon style for delete button
      try { del.innerHTML = '<span class="material-symbols-outlined">delete</span>'; del.className = 'absolute top-1 right-1 text-gray-700 bg-white/80 border border-gray-300 rounded p-1 hover:bg-gray-100'; } catch (_) {}
      del.addEventListener('click', async () => {
        if (!confirm('à¸•à¹‰à¸­à¸‡à¸à¸²à¸£à¸¥à¸šà¸£à¸¹à¸›à¸™à¸µà¹‰à¹ƒà¸Šà¹ˆà¸«à¸£à¸·à¸­à¹„à¸¡à¹ˆ?')) return;
        
        // Show loading state
        del.disabled = true;
        del.textContent = 'à¸à¸³à¸¥à¸±à¸‡à¸¥à¸š...';
        
        try {
          const supa = getSupabaseClient();
          if (supa && it.dataUrl) {
            const bucket = window.SUPABASE_BUCKET || 'watch-assets';
            const m = it.dataUrl.match(/\/storage\/v1\/object\/public\/(?:[^/]+)\/(.+)$/);
            const path = m && m[1] ? decodeURIComponent(m[1]) : null;
            
            // Find asset rows for this SKU and remove those whose normalized URL matches
            try {
              const { data: assetsForSku, error: eFetch } = await supa.from('assets').select('id,url').eq('sku_id', modalContextSku);
              if (eFetch) throw eFetch;
              const idsToDelete = (assetsForSku || []).filter(a => normalizeUrl(a.url || '') === normalizeUrl(it.dataUrl || '')).map(a => a.id);
              if (idsToDelete.length) {
                // Delete from database first
                const { error: eDel } = await supa.from('assets').delete().in('id', idsToDelete);
                if (eDel) throw eDel;
                
                // Then delete from storage
                if (path) {
                  const { error: eRem } = await supa.storage.from(bucket).remove([path]);
                  if (eRem) console.warn('storage remove returned error', eRem);
                }
                
                showToast('à¸¥à¸šà¸£à¸¹à¸›à¸ªà¸³à¹€à¸£à¹‡à¸ˆ', 'success');
              } else {
                showToast('à¹„à¸¡à¹ˆà¸žà¸šà¸£à¸¹à¸›à¹ƒà¸™à¸à¸²à¸™à¸‚à¹‰à¸­à¸¡à¸¹à¸¥', 'error');
              }
            } catch (e) {
              console.error('Failed to remove DB asset rows by URL', e);
              throw e;
            }
            
            // FIX: Clear caches and force fresh reload from Supabase
            console.log('Deleting asset - clearing caches and reloading...');
            
            // 1. Clear localStorage catalog cache to force fresh load
            localStorage.removeItem('watchCatalog');
            
            // 2. Add a small delay to ensure DB has processed the deletion
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // 3. Refresh CATALOG from Supabase to reflect deletion IMMEDIATELY
            // Note: We don't clear _supabaseClient to avoid multiple client instances
            const refreshSuccess = await maybeLoadCatalogFromSupabase();
            
            if (!refreshSuccess) {
              console.error('Failed to refresh catalog after deletion');
              showToast('à¸„à¸³à¹€à¸•à¸·à¸­à¸™: à¹„à¸¡à¹ˆà¸ªà¸²à¸¡à¸²à¸£à¸–à¹‚à¸«à¸¥à¸"à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹ƒà¸«à¸¡à¹ˆ à¸à¸£à¸¸à¸" refresh à¸«à¸™à¹‰à¸²à¹€à¸§à¹‡à¸š', 'error');
              // Don't proceed if refresh failed
              return;
            }
            
            console.log('Catalog refreshed successfully. Assets for this SKU:', 
              CATALOG[modalContextSku] && CATALOG[modalContextSku][g] ? 
              CATALOG[modalContextSku][g].length : 0,
              'items in group', g);
            
            // Force update PARTS reference for the current modal SKU
            if (CATALOG[modalContextSku]) {
              // Update PARTS if this is the current SKU being viewed
              if (modalContextSku === currentSKU) {
                PARTS = CATALOG[currentSKU] || {};
                
                // Re-render controls grids for this group and mobile grid
                renderGrid('grid-' + g, PARTS[g] || [], g, state);
                const mid = 'mgrid-' + g;
                const mel = document.getElementById(mid);
                if (mel) renderGrid(mid, PARTS[g] || [], g, state);
                
                // Re-apply selections so preview layers update
                applySelections(state);
                queueHeightSyncOnImages();
              }
            }
            
            // Re-render modal thumbs to show updated list (use fresh CATALOG data)
            setTimeout(() => {
              renderModalThumbs();
            }, 100);
            
            // Update the SKU table if on admin page
            if (typeof refreshSkuTable === 'function') {
              refreshSkuTable();
            }
          } else {
            // Local-only deletion fallback
            if (CATALOG[modalContextSku] && Array.isArray(CATALOG[modalContextSku][g])) {
              CATALOG[modalContextSku][g].splice(idx, 1);
              localStorage.setItem('watchCatalog', JSON.stringify(CATALOG));
              
              if (modalContextSku === currentSKU) {
                PARTS = CATALOG[currentSKU] || {};
                renderGrid('grid-' + g, PARTS[g] || [], g, state);
                const mid = 'mgrid-' + g;
                const mel = document.getElementById(mid);
                if (mel) renderGrid(mid, PARTS[g] || [], g, state);
                applySelections(state);
                queueHeightSyncOnImages();
              }
              
              renderModalThumbs();
              showToast('à¸¥à¸šà¸£à¸¹à¸›à¸ªà¸³à¹€à¸£à¹‡à¸ˆ (Local)', 'success');
            }
          }
        } catch (e) { 
          console.error(e); 
          showToast('à¹€à¸à¸´à¸"à¸‚à¹‰à¸­à¸œà¸´à¸"à¸žà¸¥à¸²à¸"à¸‚à¸"à¸°à¸¥à¸š: ' + (e && e.message ? e.message : String(e)), 'error'); 
          del.disabled = false;
          del.textContent = 'à¸¥à¸š';
        }
      });
      
      // Add label text below the image
      const labelDiv = document.createElement('div');
      labelDiv.className = 'text-center text-xs font-medium text-gray-600 mt-2 px-1 truncate';
      labelDiv.textContent = it.label || 'à¹„à¸¡à¹ˆà¸¡à¸µà¸Šà¸·à¹ˆà¸­';
      labelDiv.title = it.label || 'à¹„à¸¡à¹ˆà¸¡à¸µà¸Šà¸·à¹ˆà¸­'; // Show full name on hover
      
      wrap.appendChild(img); wrap.appendChild(edit); wrap.appendChild(del); wrap.appendChild(labelDiv);
      // Insert subcategory selector and enrich label with subcategory
      try {
        const metaFor = getAssetMeta(url) || {}; const sc = metaFor.subcategory || '';
        labelDiv.textContent = (it.label || '...') + (sc ? ` Â· ${sc}` : '');
        const scSel = document.createElement('select');
        scSel.className = 'mt-2 w-full bg-white border border-gray-300 rounded text-xs px-2 py-1';
        const gList = Array.from(new Set([...(getSubcatList(modalContextSku, g)||[]), ...(unionSubcatsFromMeta(modalContextSku, g)||[])]));
        const optNone = document.createElement('option'); optNone.value=''; optNone.textContent='(no subcategory)'; scSel.appendChild(optNone);
        gList.forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v; scSel.appendChild(o); });
        scSel.value = sc || '';
        scSel.addEventListener('change', async () => {
          const newVal = scSel.value; setAssetMeta(url, { subcategory: newVal || null });
          try { const supa = getSupabaseClient(); if (supa) { const { data: rows } = await supa.from('assets').select('id,url').eq('sku_id', modalContextSku).eq('group_key', g); const n=(u)=>normalizeUrl(u||''); const found=(rows||[]).find(r=>n(r.url||'')===n(url)); if (found&&found.id) { await supa.from('assets').update({ subcategory: newVal || null }).eq('id', found.id); } } } catch {}
          const f = document.getElementById('pm-subcat-filter'); if (f && f.value && f.value!=='all' && f.value!==(newVal||'')) { renderModalThumbs(); } else { labelDiv.textContent = (it.label || '...') + (newVal ? ` Â· ${newVal}` : ''); }
        });
        wrap.insertBefore(scSel, labelDiv);
      } catch {}

      // Drag & drop handlers for reordering thumbnails
      wrap.addEventListener('dragstart', (e) => { pmDragEl = wrap; wrap.style.opacity = '0.5'; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'thumb'); } catch(_){} });
      wrap.addEventListener('dragend', () => { if (pmDragEl) pmDragEl.style.opacity = '1'; pmDragEl = null; });
      wrap.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      wrap.addEventListener('dragenter', () => { wrap.classList.add('ring', 'ring-blue-200'); });
      wrap.addEventListener('dragleave', () => { wrap.classList.remove('ring', 'ring-blue-200'); });
      wrap.addEventListener('drop', async (e) => {
        e.preventDefault();
        wrap.classList.remove('ring', 'ring-blue-200');
        if (!pmDragEl || pmDragEl === wrap) return;
        const children = Array.from(pmThumbs.children);
        const from = children.indexOf(pmDragEl);
        const to = children.indexOf(wrap);
        if (from === -1 || to === -1) return;
        if (from < to) pmThumbs.insertBefore(pmDragEl, wrap.nextSibling); else pmThumbs.insertBefore(pmDragEl, wrap);
        await persistThumbOrder(modalContextSku, g);
      });

      pmThumbs.appendChild(wrap);
    });
  */

  // Persist current order in pm-thumbs to DB/local
  async function persistThumbOrder(sku, groupKey) {
    const orderedUrls = Array.from(pmThumbs.children).map((el) => String(el.dataset.url || ''));
    await reorderAssets(sku, groupKey, orderedUrls);
  }

  // Reorder assets using Supabase 'sort' or localStorage fallback
  async function reorderAssets(sku, groupKey, orderedUrls) {
    const supa = getSupabaseClient();
    const norm = (u) => normalizeUrl(u || '');
    if (supa) {
      try {
        const { data: rows, error } = await supa.from('assets').select('id,url').eq('sku_id', sku).eq('group_key', groupKey);
        if (error) throw error;
        const byUrl = {};
        (rows || []).forEach(r => { byUrl[norm(r.url)] = r.id; });
        for (let i = 0; i < orderedUrls.length; i++) {
          const id = byUrl[orderedUrls[i]];
          if (!id) continue;
          const { error: eUpd } = await supa.from('assets').update({ sort: i + 1 }).eq('id', id);
          if (eUpd) throw eUpd;
        }
        await maybeLoadCatalogFromSupabase();
        setTimeout(() => renderModalThumbs(), 0);
        showToast('Updated image order', 'success');
      } catch (e) {
        console.error('Failed to reorder assets', e);
        showToast('Failed to update order: ' + (e.message || String(e)), 'error');
      }
    } else {
      try {
        if (CATALOG[sku] && Array.isArray(CATALOG[sku][groupKey])) {
          const arr = CATALOG[sku][groupKey];
          const map = new Map(arr.map((it) => [norm(it.dataUrl || (it.file ? (IMG_BASE + it.file) : '')), it]));
          const reordered = orderedUrls.map((u) => map.get(u)).filter(Boolean);
          CATALOG[sku][groupKey] = reordered;
          localStorage.setItem('watchCatalog', JSON.stringify(CATALOG));
          setTimeout(() => renderModalThumbs(), 0);
          showToast('Updated image order (local)', 'success');
        }
      } catch (e) { console.error(e); }
    }
  }
  if (pmAddBtn) pmAddBtn.addEventListener('click', async () => {
    if (!modalContextSku) return;
    if (pmAddBtn.disabled) return; // prevent double submit
    const prevText = pmAddBtn.textContent;
    try {
      pmAddBtn.disabled = true;
      pmAddBtn.classList.add('opacity-70', 'cursor-wait');
      pmAddBtn.textContent = 'à¸à¸³à¸¥à¸±à¸‡à¸­à¸±à¸›à¹‚à¸«à¸¥à¸"...';

      const files = pmFiles && pmFiles.files ? Array.from(pmFiles.files) : [];
      if (!files.length) { showToast('à¹‚à¸›à¸£à¸"à¹€à¸¥à¸·à¸­à¸à¹„à¸Ÿà¸¥à¹Œà¸à¹ˆà¸­à¸™', 'error'); return; }
      const g = pmGroupSelect ? pmGroupSelect.value : null;
      if (!g) { showToast('à¹‚à¸›à¸£à¸"à¹€à¸¥à¸·à¸­à¸à¸à¸¥à¸¸à¹ˆà¸¡', 'error'); return; }
      const supa = getSupabaseClient();
      if (supa) {
        const bucket = window.SUPABASE_BUCKET || 'watch-assets';
        try {
          // fetch existing counts
          const { data: existingAssets } = await supa.from('assets').select('group_key, sort').eq('sku_id', modalContextSku);
          const counts = {};
          (existingAssets || []).forEach(a => { counts[a.group_key] = Math.max(counts[a.group_key] || 0, a.sort || 0); });
          let idx = (counts[g] || 0) + 1;
          const assetRows = [];
          for (const f of files) {
            const safeName = sanitizeFileName(f.name);
            const path = `${modalContextSku}/${g}/${Date.now()}-${idx}-${safeName}`;
            const { error: eUp } = await supa.storage.from(bucket).upload(path, f, { upsert: true, contentType: f.type });
            if (eUp) throw eUp;
            const { data: pub } = supa.storage.from(bucket).getPublicUrl(path);
            const url = pub?.publicUrl || '';
            assetRows.push({ sku_id: modalContextSku, group_key: g, label: `${g[0].toUpperCase()+g.slice(1)} ${idx}`, url, sort: idx });
            idx++;
          }
          if (assetRows.length) {
            const { error: eIns } = await supa.from('assets').insert(assetRows).select();
            if (eIns) throw eIns;
          }
          await maybeLoadCatalogFromSupabase();
          // Move newly uploaded images to the top
          try {
            const newUrls = assetRows.map(r => normalizeUrl(r.url || ''));
            const currentItems = (CATALOG[modalContextSku] && CATALOG[modalContextSku][g]) ? CATALOG[modalContextSku][g] : [];
            const currentUrls = currentItems.map(it => normalizeUrl(it.dataUrl || (it.file ? (IMG_BASE + it.file) : '')));
            const ordered = newUrls.concat(currentUrls.filter(u => !newUrls.includes(u)));
            await reorderAssets(modalContextSku, g, ordered);
          } catch (e) { /* reordering best-effort */ }
          refreshSkuTable();
          renderModalThumbs();
          showToast('à¹€à¸žà¸´à¹ˆà¸¡à¸£à¸¹à¸›à¸ªà¸³à¹€à¸£à¹‡à¸ˆ', 'success');
          // Clear file input to avoid confusion
          if (pmFiles) pmFiles.value = '';
        } catch (err) {
          console.error(err);
          showToast('à¹„à¸¡à¹ˆà¸ªà¸²à¸¡à¸²à¸£à¸–à¸­à¸±à¸›à¹‚à¸«à¸¥à¸"à¹„à¸"à¹‰: ' + (err && err.message ? err.message : ''), 'error');
          // Clear file input as well to reduce confusion
          if (pmFiles) pmFiles.value = '';
        }
      } else {
        // local fallback
        const existing = CATALOG[modalContextSku] || { __name: modalContextSku };
        existing[g] = existing[g] || [];
        for (const f of files) {
          try { const dataUrl = await fileToDataURL(f); existing[g].push({ label: `${g} ${existing[g].length+1}`, dataUrl }); } catch (e) { console.error(e); }
        }
        CATALOG[modalContextSku] = existing;
        localStorage.setItem('watchCatalog', JSON.stringify(CATALOG));
        refreshSkuTable();
        renderModalThumbs();
        showToast('à¹€à¸žà¸´à¹ˆà¸¡à¸£à¸¹à¸› (Local) à¸ªà¸³à¹€à¸£à¹‡à¸ˆ', 'success');
        if (pmFiles) pmFiles.value = '';
      }
    } finally {
      pmAddBtn.disabled = false;
      pmAddBtn.classList.remove('opacity-70', 'cursor-wait');
      pmAddBtn.textContent = prevText;
    }
  });

  // Function to update the state of file inputs based on checkbox state
  function updatePartInputsState() {
    const toggles = document.querySelectorAll('input.part-toggle');
    toggles.forEach(toggle => {
      const group = toggle.getAttribute('data-group');
      if (group) {
        const fileInput = document.getElementById(`admin-files-${group}`);
        if (fileInput) {
          fileInput.disabled = !toggle.checked;
          // Visual feedback: make disabled inputs look greyed out
          if (toggle.checked) {
            fileInput.classList.remove('opacity-50', 'cursor-not-allowed');
          } else {
            fileInput.classList.add('opacity-50', 'cursor-not-allowed');
          }
        }
      }
    });
  }

  // Function to render part group checkboxes and file inputs dynamically
  function renderPartGroupControls() {
    const container = document.getElementById('admin-part-controls');
    
    if (!container) return;
    
    // Clear existing content
    container.innerHTML = '';
    
    // Render from MASTER_GROUP_LIST
    MASTER_GROUP_LIST.forEach(groupInfo => {
      const group = groupInfo.key;
      const nameTh = groupInfo.name_th || group;
      const nameEn = groupInfo.name_en || group;
      
      // Create wrapper div for checkbox and file input in same row
      const rowDiv = document.createElement('div');
      rowDiv.className = 'flex items-center gap-3 p-3 rounded border border-gray-200 hover:bg-gray-50';
      rowDiv.id = `wrap-admin-files-${group}`;
      
      // Create checkbox label (left side - fixed width)
      const checkboxLabel = document.createElement('label');
      checkboxLabel.className = 'flex items-center cursor-pointer min-w-[200px]';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'part-toggle mr-2 h-4 w-4';
      checkbox.setAttribute('data-group', group);
      checkbox.checked = true; // default checked
      
      const labelSpan = document.createElement('span');
      labelSpan.className = 'text-sm font-medium text-gray-700';
      labelSpan.textContent = `${nameTh} (${nameEn})`;
      
      checkboxLabel.appendChild(checkbox);
      checkboxLabel.appendChild(labelSpan);
      
      // Create file input (right side - flexible width)
      const fileInputWrapper = document.createElement('div');
      fileInputWrapper.className = 'flex-1';
      
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.id = `admin-files-${group}`;
      fileInput.multiple = true;
      fileInput.accept = 'image/*';
      fileInput.className = 'w-full text-sm border border-gray-300 rounded-md p-2';
      
      fileInputWrapper.appendChild(fileInput);
      
      // Append checkbox and file input to row
      rowDiv.appendChild(checkboxLabel);
      rowDiv.appendChild(fileInputWrapper);
      
      // Append row to container
      container.appendChild(rowDiv);
    });
    
    // Wire event listeners for newly created checkboxes
    const newToggles = container.querySelectorAll('input.part-toggle');
    newToggles.forEach(t => t.addEventListener('change', updatePartInputsState));
    
    // Update part inputs state after rendering
    updatePartInputsState();
  }

  // initial fill
  refreshSkuTable();
  // Wire up table search
  const skuSearchInput = document.getElementById('sku-search');
  if (skuSearchInput) skuSearchInput.addEventListener('input', refreshSkuTable);

  // Initial render of part group controls (will be re-rendered when opening form)
  // This ensures the controls are ready if the form is already visible
  renderPartGroupControls();

  // Define panel management functions in outer scope so admin-save can use them
  window.showSkuForm = function() {
    const panelSkuList = document.getElementById('panel-sku-list');
    const panelSku = document.getElementById('panel-sku');
    if (panelSkuList) panelSkuList.classList.add('hidden');
    if (panelSku) panelSku.classList.remove('hidden');
    
    // Render part group controls dynamically from Supabase data
    renderPartGroupControls();
    
    // focus the name input
    const nameEl = document.getElementById('admin-sku-name'); 
    if (nameEl) {
      nameEl.value = ''; // clear form
      nameEl.focus();
    }
    // clear SKU ID
    const idEl = document.getElementById('admin-sku-id');
    if (idEl) idEl.value = '';
  };

  window.showSkuList = function() {
    const panelSku = document.getElementById('panel-sku');
    const panelSkuList = document.getElementById('panel-sku-list');
    if (panelSku) panelSku.classList.add('hidden');
    if (panelSkuList) panelSkuList.classList.remove('hidden');
  };

  // Wire add SKU button to toggle panels
  const addSkuTopBtn = document.getElementById('btn-add-component');
  const btnBackToList = document.getElementById('btn-back-to-list');
  const btnCancelSku = document.getElementById('btn-cancel-sku');

  if (addSkuTopBtn) {
    addSkuTopBtn.addEventListener('click', window.showSkuForm);
  }

  if (btnBackToList) {
    btnBackToList.addEventListener('click', window.showSkuList);
  }

  if (btnCancelSku) {
    btnCancelSku.addEventListener('click', window.showSkuList);
  }

  // Auto-generate SKU key preview when name changes and lock SKU ID field
  // Function to sanitize a name into a valid key format
  function sanitizeKey(name) {
    if (!name || typeof name !== 'string') return '';
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')           // Replace spaces with hyphens
      .replace(/[^\w\-]/g, '')        // Remove non-word chars except hyphens
      .replace(/\-+/g, '-')           // Replace multiple hyphens with single
      .replace(/^-+|-+$/g, '');       // Remove leading/trailing hyphens
  }

  const skuIdInput = document.getElementById('admin-sku-id');
  const skuNameInput = document.getElementById('admin-sku-name');
  const skuPreviewKeyEl = document.getElementById('admin-sku-preview-key');
  // Always generate SKU id from name on create and DO NOT overwrite it later.
  // Generate once now if empty, then prevent further overwrites from name changes.
  if (skuIdInput && (!skuIdInput.value || skuIdInput.value.trim() === '')) {
    skuIdInput.value = sanitizeKey((skuNameInput && skuNameInput.value) ? skuNameInput.value.trim() : '') || ('sku-' + Date.now());
  }
  function updateSkuPreview() {
    const rawName = (skuNameInput && skuNameInput.value) ? skuNameInput.value.trim() : '';
    const generated = sanitizeKey(rawName || '');
    // display before/after values
    const oldEl = document.getElementById('admin-sku-prev-key-old');
    const newEl = document.getElementById('admin-sku-prev-key-new');
    const oldVal = skuIdInput ? (skuIdInput.value || '-') : '-';
    if (oldEl) oldEl.textContent = oldVal;
    if (newEl) newEl.textContent = (generated || '-');
    // Do NOT overwrite SKU ID after initial generation
    if (skuPreviewKeyEl) skuPreviewKeyEl.textContent = generated || '(will generate)';
    return generated;
  }
  if (skuNameInput) skuNameInput.addEventListener('input', updateSkuPreview);
  // initialize on load
  updateSkuPreview();

  // Always keep SKU ID fixed once generated â€" make readonly to prevent accidental changes
  if (skuIdInput) {
    skuIdInput.readOnly = true;
  }

  // --- Admin page: sidebar and panels (if on admin.html) ---
  const menuAddSku = document.getElementById('menu-add-sku');
  const menuAddPart = document.getElementById('menu-add-part');
  const menuProfileSettings = document.getElementById('menu-profile-settings');
  const menuSubcategories = document.getElementById('menu-subcategories');

  const panelSkuList = document.getElementById('panel-sku-list');
  const panelPartGroups = document.getElementById('panel-part-groups');
  const panelProfileSettings = document.getElementById('panel-profile-settings');
  const panelSubcategories = document.getElementById('panel-subcategories');
  const mainHeader = document.querySelector('.header-title h1');

  const menus = [
    { btn: menuAddSku, panel: panelSkuList, title: 'จัดการ SKU' },
    { btn: menuPartGroups, panel: panelPartGroups, title: 'จัดการกลุ่มชิ้นส่วน' },
    { btn: menuProfileSettings, panel: panelProfileSettings, title: 'ตั้งค่าโปรไฟล์' },
    { btn: menuSubcategories, panel: panelSubcategories, title: 'จัดการ Subcategory' },
  ];

  menus.forEach(menu => {
    if (menu.btn) {
      menu.btn.addEventListener('click', () => {
        menus.forEach(m => {
          if (m.panel) m.panel.classList.add('hidden');
          if (m.btn) m.btn.classList.remove('active');
        });
        if (menu.panel) menu.panel.classList.remove('hidden');
        if (menu.btn) menu.btn.classList.add('active');
        if (mainHeader) mainHeader.textContent = menu.title;
      });
    }
  });

  // Subcategory Management Logic (moved to main section)

  async function populateSubcategoryFilters() {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    // Populate SKUs
    const { data: skus, error: skuError } = await supabase.from('skus').select('id, name');
    if (skuError) return console.error('Error fetching SKUs for filter:', skuError);
    scFilterSku.innerHTML = '<option value="">เลือก SKU...</option>' + 
      skus.map(s => `<option value="${s.id}">${s.name}</option>`).join('');

    // Populate Part Groups with Thai names
    const { data: groups, error: groupError } = await supabase.from('part_groups').select('key, name_th, name_en').order('sort_order');
    if (groupError) return console.error('Error fetching part groups for filter:', groupError);
    scFilterGroup.innerHTML = '<option value="">เลือกกลุ่มชิ้นส่วน...</option>' + 
      groups.map(g => `<option value="${g.key}">${g.name_th} (${g.name_en})</option>`).join('');

    // Add event listeners to reload table on filter change
    scFilterSku.addEventListener('change', loadSubcategoriesForTable);
    scFilterGroup.addEventListener('change', loadSubcategoriesForTable);

    // Initial load
    loadSubcategoriesForTable();
  }

  async function loadSubcategoriesForTable() {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const skuId = scFilterSku.value;
    const groupKey = scFilterGroup.value;
    const tableBody = document.querySelector('#subcategories-table tbody');
    tableBody.innerHTML = '<tr><td colspan="4" class="text-center p-4">Loading...</td></tr>';

    // ตัวเลือก 1: ดึงจาก subcategories table
    const { data: fromTable, error: tableError } = await supabase
      .from('subcategories')
      .select('*')
      .eq('sku_id', skuId)
      .eq('group_key', groupKey)
      .order('sort_order', { ascending: true });

    // ตัวเลือก 2: ดึงชื่อที่ไม่ซ้ำจาก assets.subcategory (text column)
    let fromAssets = null;
    try {
      const result = await supabase.rpc('get_distinct_subcategories', {
        p_sku_id: skuId,
        p_group_key: groupKey
      });
      if (!result.error) {
        fromAssets = result.data;
      }
    } catch (e) {
      // RPC function ไม่มี หรือ error, ข้ามไป
      console.log('RPC not available, using direct query');
    }

    // ถ้า RPC ไม่มี ให้ query เอง
    let distinctFromAssets = [];
    if (!fromAssets || fromAssets.length === 0) {
      const { data: rawAssets } = await supabase
        .from('assets')
        .select('subcategory')
        .eq('sku_id', skuId)
        .eq('group_key', groupKey)
        .not('subcategory', 'is', null)
        .not('subcategory', 'eq', '');
      
      if (rawAssets) {
        const unique = [...new Set(rawAssets.map(a => a.subcategory))];
        distinctFromAssets = unique.map((name, idx) => ({ 
          id: null, 
          name, 
          sort_order: idx + 1, 
          image_url: null,
          from_assets: true 
        }));
      }
    }

    // รวมข้อมูลจากทั้ง 2 แหล่ง
    let allData = [...(fromTable || []), ...distinctFromAssets];
    
    // ลบชื่อซ้ำ (ถ้ามีทั้งใน table และ assets)
    const seen = new Set();
    allData = allData.filter(item => {
      if (seen.has(item.name)) return false;
      seen.add(item.name);
      return true;
    });

    if (tableError && !allData.length) {
      tableBody.innerHTML = '<tr><td colspan="4" class="text-center p-4 text-red-500">Error loading data.</td></tr>';
      return console.error('Error loading subcategories:', tableError);
    }

    if (allData.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="4" class="text-center p-4">No subcategories found. Upload assets first or add manually.</td></tr>';
      return;
    }

    tableBody.innerHTML = allData.map(sc => `
      <tr data-id="${sc.id || ''}" data-from-assets="${sc.from_assets || false}">
        <td>
          ${sc.image_url ? 
            `<img src="${sc.image_url}" alt="${sc.name}" class="w-10 h-10 object-contain rounded-md">` :
            `<div class="w-10 h-10 bg-gray-200 rounded-md flex items-center justify-center text-xs text-gray-500">${sc.name.charAt(0)}</div>`
          }
        </td>
        <td>
          ${sc.name}
          ${sc.from_assets ? '<span class="ml-2 text-xs text-blue-600">(จาก Assets)</span>' : ''}
        </td>
        <td>${sc.sort_order || '-'}</td>
        <td class="flex items-center gap-2">
          ${!sc.from_assets ? `
            <button class="btn-upload-image btn btn-primary btn-sm" data-id="${sc.id}" data-name="${sc.name}">📷 รูป</button>
            <button class="btn-edit-subcategory btn btn-secondary btn-sm">Edit</button>
            <button class="btn-delete-subcategory btn btn-text-danger btn-sm">Delete</button>
          ` : `
            <button class="btn-save-to-table btn btn-primary btn-sm" data-name="${sc.name}">บันทึกลง DB</button>
          `}
        </td>
      </tr>
    `).join('');

    // Add event listener for "บันทึกลง DB" buttons
    document.querySelectorAll('.btn-save-to-table').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const name = e.target.dataset.name;
        const { error } = await supabase
          .from('subcategories')
          .insert({ sku_id: skuId, group_key: groupKey, name, sort_order: 999 });
        
        if (error) {
          alert('Error: ' + error.message);
        } else {
          alert('บันทึกสำเร็จ!');
          loadSubcategoriesForTable();
        }
      });
    });

    // Add event listener for "📷 รูป" buttons
    document.querySelectorAll('.btn-upload-image').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const subcategoryId = e.target.dataset.id;
        const subcategoryName = e.target.dataset.name;
        uploadSubcategoryImage(subcategoryId, subcategoryName);
      });
    });
  }

  // Function to upload subcategory image
  async function uploadSubcategoryImage(subcategoryId, subcategoryName) {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    // Create file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert('ไฟล์ใหญ่เกินไป (สูงสุด 5MB)');
        return;
      }

      // Validate file type
      if (!file.type.startsWith('image/')) {
        alert('กรุณาเลือกไฟล์รูปภาพ');
        return;
      }

      try {
        // Show loading
        const loadingBtn = document.querySelector(`[data-id="${subcategoryId}"]`);
        const originalText = loadingBtn.textContent;
        loadingBtn.textContent = '⏳ อัพโหลด...';
        loadingBtn.disabled = true;

        // Generate unique filename
        const timestamp = Date.now();
        const fileExt = file.name.split('.').pop();
        const fileName = `subcategory-${subcategoryId}-${timestamp}.${fileExt}`;
        const filePath = `subcategories/${fileName}`;

        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('watch-assets')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) {
          throw uploadError;
        }

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('watch-assets')
          .getPublicUrl(filePath);

        // Update subcategory with image URL
        const { error: updateError } = await supabase
          .from('subcategories')
          .update({ image_url: urlData.publicUrl })
          .eq('id', subcategoryId);

        if (updateError) {
          throw updateError;
        }

        alert('อัพโหลดรูปสำเร็จ!');
        loadSubcategoriesForTable(); // Refresh table

      } catch (error) {
        console.error('Upload error:', error);
        alert('เกิดข้อผิดพลาด: ' + error.message);
      } finally {
        // Restore button
        loadingBtn.textContent = originalText;
        loadingBtn.disabled = false;
        document.body.removeChild(input);
      }
    };

    // Trigger file dialog
    input.click();
  }
  
  // Initial population of filters
  if (scFilterSku) {
    populateSubcategoryFilters();
  }

  // --- Init ---
  if (menuAddSku) {
    refreshSkuTable();
  }

  // --- New admin single-page SKU manager wiring --- (duplicate block commented)
  // const skuTableBody = document.querySelector('#sku-table tbody');
  // const btnAddSkuTop = document.getElementById('btn-add-sku');
  // const partModal = document.getElementById('part-modal');
  // const pmClose = document.getElementById('pm-close');
  // const pmSkuKey = document.getElementById('pm-sku-key');
  // const pmGroupSelect = document.getElementById('pm-group-select');
  // const btnAddGroup = document.getElementById('btn-add-group');
  // const pmFiles = document.getElementById('pm-files');
  // const pmThumbs = document.getElementById('pm-thumbs');
  // Dragging state for part thumbnails
  // let pmDragEl = null;
  // const pmAddBtn = document.getElementById('pm-add-btn');

  // Add Group Modal elements (dedup; active set defined later)
  // const groupAddModal = document.getElementById('group-add-modal');
  // const gamClose = document.getElementById('gam-close');
  // const gamSkuKey = document.getElementById('gam-sku-key');
  // const gamGroupList = document.getElementById('gam-group-list');
  // const gamSave = document.getElementById('gam-save');
  // const gamAddNewBtn = document.getElementById('gam-add-new');
  // const gamNewKeyInput = document.getElementById('gam-new-key');
  // const gamNewNameThInput = document.getElementById('gam-new-name-th');
  // const gamNewNameEnInput = document.getElementById('gam-new-name-en');

  function buildSkuRow(key, parts) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${key}</td>` +
      `<td>${(parts && parts.__name) ? parts.__name : ''}</td>` +
      `<td>${Object.keys(parts || {}).filter(k=>k !== '__name').length}</td>` +
      `<td><div class="flex items-center gap-2">` +
      `<button class="edit-sku btn btn-secondary" data-sku="${key}">âœï¸ à¹à¸à¹‰à¹„à¸‚</button>` +
      `<button class="pm-open btn btn-secondary" data-sku="${key}">à¸ˆà¸±à¸"à¸à¸²à¸£à¸¥à¸²à¸¢</button>` +
      `<button class="del-sku btn-text-danger" data-sku="${key}">à¸¥à¸š SKU</button>` +
      `</div></td>`;
    return tr;
  }

  // Delete SKU helper reused by table actions
  async function deleteSkuById(key) {
    if (!key) return;
    if (!confirm('Delete this SKU and all its assets?')) return;
    const supa = getSupabaseClient();
    try {
      if (supa) {
        const bucket = window.SUPABASE_BUCKET || 'watch-assets';
        try {
          const { data: assetsToRemove, error: eFetch } = await supa
            .from('assets')
            .select('id,url')
            .eq('sku_id', key);
          if (eFetch) throw eFetch;
          const paths = (assetsToRemove || [])
            .map(a => {
              const url = a && a.url ? String(a.url) : '';
              const m = url.match(/\/storage\/v1\/object\/public\/(?:[^/]+)\/(.+)$/);
              if (m && m[1]) return decodeURIComponent(m[1]);
              const idx = url.indexOf('/' + bucket + '/');
              if (idx !== -1) return url.slice(idx + bucket.length + 2);
              return null;
            })
            .filter(Boolean);
          if (paths.length) {
            const { error: eRem } = await supa.storage.from(bucket).remove(paths);
            if (eRem) console.warn('storage remove returned error', eRem);
          }
        } catch (e) {
          console.warn('Failed to remove storage objects for SKU', key, e);
        }
        const { error: eDel } = await supa.from('assets').delete().eq('sku_id', key);
        if (eDel) throw eDel;
        const { error: eSku } = await supa.from('skus').delete().eq('id', key);
        if (eSku) throw eSku;
      }
      // always remove local copy too
      delete CATALOG[key];
      localStorage.setItem('watchCatalog', JSON.stringify(CATALOG));
      await maybeLoadCatalogFromSupabase();
      refreshSkuSelect();
      if (typeof renderAdminList === 'function') try { renderAdminList(); } catch (_) {}
      if (typeof refreshSkuTable === 'function') try { refreshSkuTable(); } catch (_) {}
      showToast('Deleted SKU successfully', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to delete SKU: ' + (err && err.message ? err.message : String(err)), 'error');
    }
  }

  // Render admin SKU table in admin.html
  function refreshSkuTable() {
    const tbody = document.querySelector('#sku-table tbody');
    if (!tbody) return;
    const q = (document.getElementById('sku-search')?.value || '').toLowerCase().trim();
    const entries = Object.entries(CATALOG || {})
      .filter(([key, parts]) => parts && typeof parts === 'object')
      .sort((a, b) => ((a[1].__name || a[0]).localeCompare(b[1].__name || b[0])));
    tbody.innerHTML = '';
    let count = 0;
    entries.forEach(([key, parts]) => {
      const name = (parts && parts.__name) ? String(parts.__name) : '';
      if (q && !(key.toLowerCase().includes(q) || name.toLowerCase().includes(q))) return;
      const tr = document.createElement('tr');
      const groups = Object.keys(parts || {}).filter(k => k !== '__name' && k !== '__created_at');
      const groupsCount = groups.length;
      const imagesCount = groups.reduce((sum, g) => sum + ((parts[g] || []).length), 0);
      const createdAt = parts.__created_at ? new Date(parts.__created_at).toLocaleString() : '-';
      tr.innerHTML = `
        <td>${key}</td>
        <td>${name || '-'}</td>
        <td>${createdAt}</td>
        <td>${imagesCount}</td>
        <td>
          <div class="flex items-center gap-2">
            <button class="edit-sku btn btn-secondary" data-sku="${key}">Edit</button>
            <button class="pm-open btn btn-secondary" data-sku="${key}">Manage parts</button>
            <button class="del-sku btn-text-danger" data-sku="${key}">Delete</button>
          </div>
        </td>`;
      tbody.appendChild(tr);
      count++;
    });
    if (count === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="5" class="text-center text-gray-500">No SKUs</td>';
      tbody.appendChild(tr);
    }
    // Wire row actions
    tbody.querySelectorAll('.edit-sku').forEach(btn => {
      btn.addEventListener('click', () => {
        const sku = btn.getAttribute('data-sku');
        if (typeof openEditSkuModal === 'function') {
          openEditSkuModal(sku);
        } else {
          // Fallback to name-only modal if present
          try { openEditSKUModal(sku); } catch (e) { console.warn('edit modal not available'); }
        }
      });
    });
    tbody.querySelectorAll('.pm-open').forEach(btn => {
      btn.addEventListener('click', () => {
        const sku = btn.getAttribute('data-sku');
        try { openPartModalForSKU(sku); } catch (e) { console.warn('openPartModalForSKU missing', e); }
      });
    });
    tbody.querySelectorAll('.del-sku').forEach(btn => {
      btn.addEventListener('click', async () => {
        const sku = btn.getAttribute('data-sku');
        await deleteSkuById(sku);
      });
    });
  }

  function renderSkuTable() {
    const tableBody = document.getElementById('skuTableBody');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    skuData.forEach(sku => {
      const row = document.createElement('tr');
      
      // Create store icon based on store name
      let storeIcon = '';
      if (sku.store_name && sku.store_name.toLowerCase().includes('lazada')) {
        storeIcon = '<i class="store-icon lazada-icon" title="Lazada">🛒</i>';
      } else if (sku.store_name && sku.store_name.toLowerCase().includes('shopee')) {
        storeIcon = '<i class="store-icon shopee-icon" title="Shopee">🛍️</i>';
      } else {
        storeIcon = '<i class="store-icon default-icon" title="Store">🏪</i>';
      }
      
      // Create image thumbnails
      const imageThumbnails = sku.image_urls && sku.image_urls.length > 0 
          ? sku.image_urls.map(url => `<img src="${url}" alt="Product image" class="thumbnail" onclick="window.open('${url}', '_blank')">`).join('')
          : 'No images';
      
      // Create MCP Supabase status
      const mcpStatus = sku.mcp_supabase_id 
          ? `<span class="status-badge success">âœ" Synced</span>`
          : `<span class="status-badge pending">Not synced</span>`;
      
      row.innerHTML = `
          <td>${sku.sku}</td>
          <td>${storeIcon} ${sku.store_name || 'N/A'}</td>
          <td><a href="${sku.store_url || '#'}" target="_blank">${sku.store_url ? 'Visit Store' : 'N/A'}</a></td>
          <td>${sku.product_name || 'N/A'}</td>
          <td><a href="${sku.product_url || '#'}" target="_blank">${sku.product_url ? 'View Product' : 'N/A'}</a></td>
          <td>${sku.price || 'N/A'}</td>
          <td>${sku.stock || 'N/A'}</td>
          <td class="image-cell">${imageThumbnails}</td>
          <td>${mcpStatus}</td>
          <td>
              <button class="btn btn-primary btn-sm" onclick="editSku('${sku.sku}')">Edit</button>
              <button class="btn btn-danger btn-sm" onclick="deleteSku('${sku.sku}')">Delete</button>
          </td>
      `;
      
      tableBody.appendChild(row);
    });
  }

  // part modal helpers
  let modalContextSku = null;
  // Edit SKU Name Modal Functions
  let editSkuContext = null;
  const editSkuModal = document.getElementById('edit-sku-modal');
  const editSkuNameInput = document.getElementById('edit-sku-name-input');
  const editSkuIdDisplay = document.getElementById('edit-sku-id-display');
  const editSkuClose = document.getElementById('edit-sku-close');
  const editSkuCancel = document.getElementById('edit-sku-cancel');
  const editSkuSave = document.getElementById('edit-sku-save');

  function openEditSKUModal(skuId) {
    if (!skuId || !CATALOG[skuId]) return;
    editSkuContext = skuId;
    editSkuNameInput.value = CATALOG[skuId].__name || '';
    editSkuIdDisplay.value = skuId;
    if (editSkuModal) editSkuModal.classList.remove('hidden');
  }

  function closeEditSKUModal() {
    editSkuContext = null;
    if (editSkuModal) editSkuModal.classList.add('hidden');
    if (editSkuNameInput) editSkuNameInput.value = '';
    if (editSkuIdDisplay) editSkuIdDisplay.value = '';
  }

  async function saveEditSKU() {
    if (!editSkuContext) return;
    const newName = editSkuNameInput ? editSkuNameInput.value.trim() : '';
    if (!newName) {
      showToast('à¸à¸£à¸¸à¸"à¸²à¸à¸£à¸­à¸à¸Šà¸·à¹ˆà¸­ SKU', 'error');
      return;
    }

    const supa = getSupabaseClient();
    if (!supa) {
      showToast('à¹„à¸¡à¹ˆà¸ªà¸²à¸¡à¸²à¸£à¸–à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­ Supabase', 'error');
      return;
    }

    try {
      // Update in Supabase
      const { error } = await supa
        .from('skus')
        .update({ name: newName })
        .eq('id', editSkuContext);

      if (error) throw error;

      // Update local catalog
      if (CATALOG[editSkuContext]) {
        CATALOG[editSkuContext].__name = newName;
      }
      localStorage.setItem('watchCatalog', JSON.stringify(CATALOG));

      showToast('à¹à¸à¹‰à¹„à¸‚à¸Šà¸·à¹ˆà¸­ SKU à¸ªà¸³à¹€à¸£à¹‡à¸ˆ', 'success');
      closeEditSKUModal();
      refreshSkuTable();
      
      // Update SKU selector if current SKU
      if (editSkuContext === currentSKU) {
        populateSkuSelector();
      }
    } catch (e) {
      console.error(e);
      showToast('à¹€à¸à¸´à¸"à¸‚à¹‰à¸­à¸œà¸´à¸"à¸žà¸¥à¸²à¸"à¸‚à¸"à¸°à¸šà¸±à¸™à¸—à¸¶à¸: ' + (e && e.message ? e.message : String(e)), 'error');
    }
  }

  if (editSkuClose) editSkuClose.addEventListener('click', closeEditSKUModal);
  if (editSkuCancel) editSkuCancel.addEventListener('click', closeEditSKUModal);
  if (editSkuSave) editSkuSave.addEventListener('click', saveEditSKU);

  // ===== SUBCATEGORY MANAGEMENT =====
  const btnAddSubcategory = document.getElementById('btn-add-subcategory');
  const subcategoryModal = document.getElementById('subcategory-modal');
  const subcategoryModalClose = document.getElementById('subcategory-modal-close');
  const subcategoryCancel = document.getElementById('subcategory-cancel');
  const subcategorySave = document.getElementById('subcategory-save');
  const subcategoryModalTitle = document.getElementById('subcategory-modal-title');
  const scId = document.getElementById('sc-id');
  const scName = document.getElementById('sc-name');
  const scImageUrl = document.getElementById('sc-image-url');
  const scImageFile = document.getElementById('sc-image-file');
  const scUploadBtn = document.getElementById('sc-upload-btn');
  const scImagePreview = document.getElementById('sc-image-preview');
  const scImagePreviewContainer = document.getElementById('sc-image-preview-container');
  const scSortOrder = document.getElementById('sc-sort-order');
  const subcategoriesTable = document.getElementById('subcategories-table');
  const scFilterSku = document.getElementById('sc-filter-sku');
  const scFilterGroup = document.getElementById('sc-filter-group');
  const scSkuSelect = document.getElementById('sc-sku-select');
  const scGroupSelect = document.getElementById('sc-group-select');

  let subcategoryContext = null;

  // Open subcategory modal for adding new
  async function openAddSubcategoryModal() {
    subcategoryContext = null;
    subcategoryModalTitle.textContent = 'Add Subcategory';
    scId.value = '';
    scName.value = '';
    scImageUrl.value = '';
    scSortOrder.value = '0';
    scImagePreview.src = '';
    scImagePreview.classList.add('hidden');
    
    // Load SKUs and part groups for selection
    await loadSubcategoryFormData();
    
    if (subcategoryModal) subcategoryModal.classList.remove('hidden');
  }

  // Load data for subcategory form (SKUs and part groups)
  async function loadSubcategoryFormData() {
    const supa = getSupabaseClient();
    if (!supa) return;

    try {
      // Load SKUs
      const { data: skus, error: skuError } = await supa
        .from('skus')
        .select('id, name')
        .order('name');

      if (skuError) throw skuError;

      // Load part groups
      const { data: partGroups, error: groupError } = await supa
        .from('part_groups')
        .select('key, name_th, name_en')
        .order('sort_order');

      if (groupError) throw groupError;

      // Populate filter dropdowns
      if (scFilterSku) {
        scFilterSku.innerHTML = '<option value="all">All SKUs</option>';
        skus.forEach(sku => {
          const option = document.createElement('option');
          option.value = sku.id;
          option.textContent = sku.name;
          scFilterSku.appendChild(option);
        });
      }

      if (scFilterGroup) {
        scFilterGroup.innerHTML = '<option value="all">All Groups</option>';
        partGroups.forEach(group => {
          const option = document.createElement('option');
          option.value = group.key;
          option.textContent = `${group.name_th} (${group.name_en})`;
          scFilterGroup.appendChild(option);
        });
      }

      // Populate modal dropdowns
      if (scSkuSelect) {
        scSkuSelect.innerHTML = '<option value="">Select SKU</option>';
        skus.forEach(sku => {
          const option = document.createElement('option');
          option.value = sku.id;
          option.textContent = sku.name;
          scSkuSelect.appendChild(option);
        });
      }

      if (scGroupSelect) {
        scGroupSelect.innerHTML = '<option value="">Select Part Group</option>';
        partGroups.forEach(group => {
          const option = document.createElement('option');
          option.value = group.key;
          option.textContent = `${group.name_th} (${group.name_en})`;
          scGroupSelect.appendChild(option);
        });
      }

    } catch (e) {
      console.error(e);
      showToast('เกิดข้อผิดพลาดในการโหลดข้อมูล: ' + (e.message || String(e)), 'error');
    }
  }

  // Open subcategory modal for editing
  async function openEditSubcategoryModal(id) {
    const supa = getSupabaseClient();
    if (!supa) {
      showToast('ไม่สามารถเชื่อมต่อฐานข้อมูลได้', 'error');
      return;
    }

    try {
      const { data: subcategory, error } = await supa
        .from('subcategories')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      subcategoryContext = id;
      subcategoryModalTitle.textContent = 'Edit Subcategory';
      scId.value = subcategory.id;
      scName.value = subcategory.name || '';
      scImageUrl.value = subcategory.image_url || '';
      scSortOrder.value = subcategory.sort_order || 0;
      
      // Load form data first
      await loadSubcategoryFormData();
      
      // Set selected values
      if (scSkuSelect) scSkuSelect.value = subcategory.sku_id || '';
      if (scGroupSelect) scGroupSelect.value = subcategory.group_key || '';
      
      if (subcategory.image_url) {
        scImagePreview.src = subcategory.image_url;
        scImagePreview.classList.remove('hidden');
      } else {
        scImagePreview.classList.add('hidden');
      }
      
      if (subcategoryModal) subcategoryModal.classList.remove('hidden');
    } catch (e) {
      console.error(e);
      showToast('เกิดข้อผิดพลาดในการโหลดข้อมูล: ' + (e.message || String(e)), 'error');
    }
  }

  // Close subcategory modal
  function closeSubcategoryModal() {
    subcategoryContext = null;
    if (subcategoryModal) subcategoryModal.classList.add('hidden');
  }

  // Save subcategory
  async function saveSubcategory() {
    const name = scName.value.trim();
    const skuId = scSkuSelect ? scSkuSelect.value : '';
    const groupKey = scGroupSelect ? scGroupSelect.value : '';
    
    if (!name) {
      showToast('กรุณาใส่ชื่อ Subcategory', 'error');
      return;
    }
    
    if (!skuId) {
      showToast('กรุณาเลือก SKU', 'error');
      return;
    }
    
    if (!groupKey) {
      showToast('กรุณาเลือก Part Group', 'error');
      return;
    }

    const supa = getSupabaseClient();
    if (!supa) {
      showToast('ไม่สามารถเชื่อมต่อฐานข้อมูลได้', 'error');
      return;
    }

    try {
      const data = {
        name: name,
        sku_id: skuId,
        group_key: groupKey,
        image_url: scImageUrl.value.trim() || null,
        sort_order: parseInt(scSortOrder.value) || 0
      };

      if (subcategoryContext) {
        // Update existing
        const { error } = await supa
          .from('subcategories')
          .update(data)
          .eq('id', subcategoryContext);
        
        if (error) throw error;
        showToast('อัปเดต Subcategory สำเร็จ', 'success');
      } else {
        // Create new
        const { error } = await supa
          .from('subcategories')
          .insert(data);
        
        if (error) throw error;
        showToast('เพิ่ม Subcategory สำเร็จ', 'success');
      }

      closeSubcategoryModal();
      await loadSubcategories();
    } catch (e) {
      console.error(e);
      showToast('เกิดข้อผิดพลาด: ' + (e.message || String(e)), 'error');
    }
  }

  // Load subcategories
  async function loadSubcategories() {
    const supa = getSupabaseClient();
    if (!supa) return;

    try {
      // Get filter values
      const selectedSku = scFilterSku ? scFilterSku.value : '';
      const selectedGroup = scFilterGroup ? scFilterGroup.value : '';

      let query = supa
        .from('subcategories')
        .select(`
          *,
          skus:sku_id(name),
          part_groups:group_key(name_th, name_en)
        `)
        .order('sort_order', { ascending: true });

      // Apply filters
      if (selectedSku && selectedSku !== 'all') {
        query = query.eq('sku_id', selectedSku);
      }
      if (selectedGroup && selectedGroup !== 'all') {
        query = query.eq('group_key', selectedGroup);
      }

      const { data: subcategories, error } = await query;

      if (error) throw error;

      const tbody = subcategoriesTable.querySelector('tbody');
      if (!tbody) return;

      tbody.innerHTML = '';

      subcategories.forEach(subcategory => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>
            ${subcategory.image_url ? 
              `<img src="${subcategory.image_url}" alt="${subcategory.name}" class="w-12 h-12 object-cover rounded">` : 
              '<div class="w-12 h-12 bg-gray-200 rounded flex items-center justify-center text-gray-500 text-xs">No Image</div>'
            }
          </td>
          <td class="font-medium">${subcategory.name}</td>
          <td>${subcategory.skus?.name || subcategory.sku_id}</td>
          <td>${subcategory.part_groups?.name_th || subcategory.group_key}</td>
          <td>${subcategory.sort_order}</td>
          <td>
            <button class="edit-subcategory px-2 py-1 rounded-md border text-sm bg-blue-600 text-white mr-2" data-id="${subcategory.id}">Edit</button>
            <button class="delete-subcategory px-2 py-1 rounded-md border text-sm bg-red-600 text-white" data-id="${subcategory.id}">Delete</button>
          </td>
        `;
        tbody.appendChild(row);
      });

      // Wire up edit buttons
      document.querySelectorAll('.edit-subcategory').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          openEditSubcategoryModal(id);
        });
      });

      // Wire up delete buttons
      document.querySelectorAll('.delete-subcategory').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          if (confirm('ต้องการลบ Subcategory นี้หรือไม่?')) {
            await deleteSubcategory(id);
          }
        });
      });

    } catch (e) {
      console.error(e);
      showToast('เกิดข้อผิดพลาดในการโหลดข้อมูล: ' + (e.message || String(e)), 'error');
    }
  }

  // Delete subcategory
  async function deleteSubcategory(id) {
    const supa = getSupabaseClient();
    if (!supa) return;

    try {
      const { error } = await supa
        .from('subcategories')
        .delete()
        .eq('id', id);

      if (error) throw error;
      showToast('ลบ Subcategory สำเร็จ', 'success');
      await loadSubcategories();
    } catch (e) {
      console.error(e);
      showToast('เกิดข้อผิดพลาดในการลบ: ' + (e.message || String(e)), 'error');
    }
  }

  // Image upload handler
  if (scUploadBtn && scImageFile) {
    scUploadBtn.addEventListener('click', () => scImageFile.click());
    scImageFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const supa = getSupabaseClient();
        if (!supa) {
          showToast('ไม่สามารถเชื่อมต่อฐานข้อมูลได้', 'error');
          return;
        }

        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const filePath = `subcategories/${fileName}`;

        const { error: uploadError } = await supa.storage
          .from('images')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supa.storage
          .from('images')
          .getPublicUrl(filePath);

        scImageUrl.value = publicUrl;
        scImagePreview.src = publicUrl;
        scImagePreview.classList.remove('hidden');
      } catch (e) {
        console.error(e);
        showToast('เกิดข้อผิดพลาดในการอัปโหลด: ' + (e.message || String(e)), 'error');
      }
    });
  }

  // Event listeners for subcategory management
  if (btnAddSubcategory) btnAddSubcategory.addEventListener('click', openAddSubcategoryModal);
  if (subcategoryModalClose) subcategoryModalClose.addEventListener('click', closeSubcategoryModal);
  if (subcategoryCancel) subcategoryCancel.addEventListener('click', closeSubcategoryModal);
  if (subcategorySave) subcategorySave.addEventListener('click', saveSubcategory);

  // Load subcategories when panel becomes visible
  if (menuSubcategories) {
    menuSubcategories.addEventListener('click', () => {
      loadSubcategories();
    });
  }

  // Filter change handlers
  if (scFilterSku) {
    scFilterSku.addEventListener('change', () => {
      loadSubcategories();
    });
  }

  if (scFilterGroup) {
    scFilterGroup.addEventListener('change', () => {
      loadSubcategories();
    });
  }

}); // Close DOMContentLoaded
