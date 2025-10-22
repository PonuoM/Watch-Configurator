"use strict";

// Basic data model mapping part groups to available image files in ./assets/
// Standardized filenames to avoid encoding/quoting issues from the original.
let PARTS = {
  dial: [
    { label: "Dial 1", file: "dial1.png" },
    { label: "Dial 2", file: "dial2.png" }
  ],
  hands: [
    { label: "Hands 1", file: "hands1.png" },
    { label: "Hands 2", file: "hands2.png" }
  ],
  second: [
    { label: "Second 1", file: "second1.png" },
    { label: "Second 2", file: "second2.png" }
  ],
  outer: [
    { label: "Outer 1", file: "outer1.png" },
    { label: "Outer 2", file: "outer2.png" }
  ],
  inner: [
    { label: "Inner 1", file: "inner1.png" },
    { label: "Inner 2", file: "inner2.png" }
  ],
  bracelet: [
    { label: "Bracelet 1", file: "bracelet1.png" },
    { label: "Bracelet 2", file: "bracelet2.png" }
  ]
};

const IMG_BASE = "./assets/";
// Default watermark image (placed in ./watermark)
const WATERMARK_IMAGE = "./watermark/b5693b3604dbf7fa4561ba0b99474a55.png";

// Catalog of SKUs -> parts; merge with localStorage admin data
const DEFAULT_CATALOG = {
  default: PARTS
};

function loadCatalogFromStorage() {
  try {
    const raw = localStorage.getItem('watchCatalog');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) { return null; }
}

let CATALOG = { ...DEFAULT_CATALOG, ...(loadCatalogFromStorage() || {}) };
let currentSKU = Object.keys(CATALOG)[0] || 'default';
PARTS = CATALOG[currentSKU] || PARTS;
let MASTER_GROUP_LIST = []; // Will be loaded from Supabase

async function loadPartGroups(client) {
  const { data, error } = await client.from('part_groups').select('key, name_th, name_en, sort_order').order('sort_order');
  if (error) {
    console.error('Error loading part groups:', error);
    // Fallback to a hardcoded list if the table doesn't exist or fails to load
    MASTER_GROUP_LIST = ['bracelet','outer','inner','dial','hands','second'].map(k => ({ key: k, name_en: k, name_th: k, sort_order: 0 }));
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

    // Fetch SKUs and assets
    const { data: skus, error: e1 } = await client.from('skus').select('id,name').order('name', { ascending: true });
    if (e1) return false;
    const { data: assets, error: e2 } = await client
      .from('assets')
      .select('sku_id, group_key, label, url, sort')
      .order('sort', { ascending: true });
    if (e2) return false;
    // Debug logs to help diagnose missing images in the browser console
    try { console.debug('supabase skus:', skus); console.debug('supabase assets (sample 10):', assets && assets.slice(0,10)); } catch(e){}
    // Transform → CATALOG shape (support arbitrary group_key values)
    const toEmpty = () => ({});
    const cat = {};
    skus.forEach(s => { cat[s.id] = { __name: s.name || s.id }; });
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
    currentSKU = Object.keys(cat)[0] || 'default';
    PARTS = CATALOG[currentSKU] || PARTS;
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
  return keys.filter(k => k !== '__name');
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
      if (k === '__name') return;
      const arr = parts[k] || [];
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
function renderMobileRow(rowElement, items, groupKey, state) {
  if (!rowElement) return;
  rowElement.innerHTML = "";
  // Defensive: ensure items is an array before iterating (can be undefined when SKU lacks a group)
  const list = Array.isArray(items) ? items : [];
  list.forEach((it, idx) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "thumb";
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
    rowElement.appendChild(card);
    card.addEventListener("click", () => {
      state[groupKey] = idx;
      applySelections(state);
      // Re-render only this row to update selection
      renderMobileRow(rowElement, items, groupKey, state);
    });
    card.addEventListener("dblclick", () => openModal(groupKey, idx));
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
    // Group Title
    const title = document.createElement('h3');
    title.className = 'text-base font-semibold';
    title.textContent = `${groupInfo.name_th} / ${groupInfo.name_en}`;
    container.appendChild(title);

    // Horizontally scrollable row for thumbnails
    const row = document.createElement('div');
    row.className = 'mobile-row';
    container.appendChild(row);

    // Render thumbnails into the row
    const items = PARTS[groupInfo.key];
    renderMobileRow(row, items, groupInfo.key, state);
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
  el.textContent = msg;
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
    zoomInner.appendChild(img);
  });

  // Append watermark overlay (scaled with zoom because it's inside zoom-inner)
  try {
    const wm = document.createElement('img');
    wm.id = 'wm-overlay';
    wm.src = WATERMARK_IMAGE;
    wm.alt = 'watermark';
    wm.className = 'watermark-overlay';
    wm.draggable = false;
    zoomInner.appendChild(wm);
  } catch (e) { /* ignore */ }
}

// Function to create dynamic grids based on MASTER_GROUP_LIST and current SKU parts
function createDynamicGrids() {
  const controlsPanel = document.getElementById('controls-panel');
  if (!controlsPanel) return;
  
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
    
    // Create title
    const title = document.createElement('h3');
    title.className = 'part-title';
    title.textContent = `${groupInfo.name_th} / ${groupInfo.name_en}`;
    controlsPanel.appendChild(title);
    
    // Create grid
    const grid = document.createElement('div');
    grid.id = `grid-${key}`;
    grid.className = 'part-grid';
    controlsPanel.appendChild(grid);
  });
  
  // Re-append buttons container
  if (buttonsContainer) controlsPanel.appendChild(buttonsContainer);
}

document.addEventListener("DOMContentLoaded", async () => {
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
        if (!skuIdRaw && !skuName) { showToast('กรุณาใส่ชื่อรุ่นหรือ SKU ID อย่างน้อยหนึ่งช่อง', 'error'); return; }
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
          showToast('บันทึก SKU ลง Supabase สำเร็จ', 'success');
        } else {
          // fallback local
          const newParts = { __name: skuName || skuIdRaw };
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
          showToast('บันทึก SKU สำเร็จ (Local)', 'success');
        }
      } catch (err) {
        console.error(err);
        showToast('เกิดข้อผิดพลาดขณะบันทึก: ' + (err && err.message ? err.message : String(err)), 'error');
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
          alert('นำเข้าแล้ว');
        }
      } catch (e) { alert('ไฟล์ไม่ถูกต้อง'); }
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
      left.textContent = `${key} — ${parts.__name || ''}`;
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
        if (!confirm(`ลบ SKU ${key} และทุกส่วนย่อย?`)) return;
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
          renderAdminList();
          showToast('ลบ SKU สำเร็จ', 'success');
        } catch (err) {
          console.error(err);
          showToast('ไม่สามารถลบได้: ' + (err && err.message ? err.message : String(err)), 'error');
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
  const skuTableBody = document.querySelector('#sku-table tbody');
  const btnAddSkuTop = document.getElementById('btn-add-sku');
  const partModal = document.getElementById('part-modal');
  const pmClose = document.getElementById('pm-close');
  const pmSkuKey = document.getElementById('pm-sku-key');
  const pmGroupSelect = document.getElementById('pm-group-select');
  const btnAddGroup = document.getElementById('btn-add-group');
  const pmFiles = document.getElementById('pm-files');
  const pmThumbs = document.getElementById('pm-thumbs');
  const pmAddBtn = document.getElementById('pm-add-btn');

  // Add Group Modal elements
  const groupAddModal = document.getElementById('group-add-modal');
  const gamClose = document.getElementById('gam-close');
  const gamSkuKey = document.getElementById('gam-sku-key');
  const gamGroupList = document.getElementById('gam-group-list');
  const gamSave = document.getElementById('gam-save');
  const gamAddNewBtn = document.getElementById('gam-add-new');
  const gamNewKeyInput = document.getElementById('gam-new-key');
  const gamNewNameThInput = document.getElementById('gam-new-name-th');
  const gamNewNameEnInput = document.getElementById('gam-new-name-en');

  function buildSkuRow(key, parts) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${key}</td>` +
      `<td>${(parts && parts.__name) ? parts.__name : ''}</td>` +
      `<td>${Object.keys(parts || {}).filter(k=>k !== '__name').length}</td>` +
      `<td><div class="flex items-center gap-4">` +
      `<button class="pm-open btn btn-secondary" data-sku="${key}">จัดการลาย</button>` +
      `<button class="del-sku btn-text-danger" data-sku="${key}">ลบ SKU</button>` +
      `</div></td>`;
    return tr;
  }

  function refreshSkuTable() {
    if (!skuTableBody) return;
    skuTableBody.innerHTML = '';
    Object.entries(CATALOG).forEach(([k, parts]) => {
      const row = buildSkuRow(k, parts);
      skuTableBody.appendChild(row);
    });
    // wire actions
    Array.from(document.querySelectorAll('.pm-open')).forEach(b => {
      b.addEventListener('click', (e) => {
        const sku = b.dataset && b.dataset.sku;
        openPartModalForSKU(sku);
      });
    });
    Array.from(document.querySelectorAll('.del-sku')).forEach(b => {
      b.addEventListener('click', async (e) => {
        const sku = b.dataset && b.dataset.sku;
        if (!sku) return;
        if (!confirm(`ลบ SKU ${sku} และทุกส่วนย่อย?`)) return;
        const supa = getSupabaseClient();
        try {
          if (supa) {
            const bucket = window.SUPABASE_BUCKET || 'watch-assets';
            const { data: assetsToRemove } = await supa.from('assets').select('id,url').eq('sku_id', sku);
            const paths = (assetsToRemove || []).map(a => {
              const url = a && a.url ? String(a.url) : '';
              const m = url.match(/\/storage\/v1\/object\/public\/(?:[^/]+)\/(.+)$/);
              if (m && m[1]) return decodeURIComponent(m[1]);
              const idx = url.indexOf('/' + bucket + '/');
              if (idx !== -1) return url.slice(idx + bucket.length + 2);
              return null;
            }).filter(Boolean);
            if (paths.length) {
              await supa.storage.from(bucket).remove(paths);
            }
            await supa.from('assets').delete().eq('sku_id', sku);
            await supa.from('skus').delete().eq('id', sku);
          }
          delete CATALOG[sku];
          localStorage.setItem('watchCatalog', JSON.stringify(CATALOG));
          refreshSkuTable();
          showToast('ลบ SKU สำเร็จ', 'success');
        } catch (err) {
          console.error(err);
          showToast('ลบไม่สำเร็จ', 'error');
        }
      });
    });
  }

  // part modal helpers
  let modalContextSku = null;
  function openPartModalForSKU(sku) {
    modalContextSku = sku;
    pmSkuKey.textContent = sku;
    // populate group select from parts available in CATALOG for the current SKU
    const parts = CATALOG[sku] || {};
    const groups = getGroupsOrdered(parts);
    pmGroupSelect.innerHTML = '';
    groups.forEach(g => {
      const groupInfo = MASTER_GROUP_LIST.find(item => item.key === g);
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = groupInfo ? `${groupInfo.name_th} (${groupInfo.name_en})` : g;
      pmGroupSelect.appendChild(opt);
    });
    // default to first group and ensure thumbs render for a valid group
    if (groups.length && pmGroupSelect) {
      pmGroupSelect.value = groups[0];
    }
    // FIX: populate thumbs AFTER setting the value to ensure correct group is displayed
    // Use setTimeout to ensure the DOM has updated before rendering
    setTimeout(() => {
      renderModalThumbs();
    }, 0);
    if (partModal) partModal.classList.remove('hidden');
  }
  function closePartModal() { modalContextSku = null; if (partModal) partModal.classList.add('hidden'); pmThumbs.innerHTML = ''; pmFiles.value = ''; }
  if (pmClose) pmClose.addEventListener('click', closePartModal);
  if (btnAddSkuTop) btnAddSkuTop.addEventListener('click', () => { /* reuse existing admin flow: open overlay or reuse existing fields */ alert('Use the SKU creation area (not implemented)'); });
  if (pmGroupSelect) pmGroupSelect.addEventListener('change', renderModalThumbs);
  function renderModalThumbs() {
    pmThumbs.innerHTML = '';
    if (!modalContextSku) return;
    const g = pmGroupSelect ? pmGroupSelect.value : null;
    const items = (CATALOG[modalContextSku] && CATALOG[modalContextSku][g]) ? CATALOG[modalContextSku][g] : [];
    items.forEach((it, idx) => {
      const wrap = document.createElement('div'); wrap.className = 'relative';
      const img = document.createElement('img'); img.src = it.dataUrl ? it.dataUrl : (it.file ? (IMG_BASE + it.file) : ''); img.className = 'w-full h-36 object-contain';
      const del = document.createElement('button'); del.textContent = 'ลบ'; del.className = 'absolute top-1 right-1 bg-red-600 text-white px-2 py-1 text-xs';
      del.addEventListener('click', async () => {
        if (!confirm('ต้องการลบรูปนี้ใช่หรือไม่?')) return;
        
        // Show loading state
        del.disabled = true;
        del.textContent = 'กำลังลบ...';
        
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
                
                showToast('ลบรูปสำเร็จ', 'success');
              } else {
                showToast('ไม่พบรูปในฐานข้อมูล', 'error');
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
              showToast('คำเตือน: ไม่สามารถโหลดข้อมูลใหม่ กรุณา refresh หน้าเว็บ', 'error');
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
              showToast('ลบรูปสำเร็จ (Local)', 'success');
            }
          }
        } catch (e) { 
          console.error(e); 
          showToast('เกิดข้อผิดพลาดขณะลบ: ' + (e && e.message ? e.message : String(e)), 'error'); 
          del.disabled = false;
          del.textContent = 'ลบ';
        }
      });
      wrap.appendChild(img); wrap.appendChild(del); pmThumbs.appendChild(wrap);
    });
  }
  if (pmAddBtn) pmAddBtn.addEventListener('click', async () => {
    if (!modalContextSku) return;
    if (pmAddBtn.disabled) return; // prevent double submit
    const prevText = pmAddBtn.textContent;
    try {
      pmAddBtn.disabled = true;
      pmAddBtn.classList.add('opacity-70', 'cursor-wait');
      pmAddBtn.textContent = 'กำลังอัปโหลด...';

      const files = pmFiles && pmFiles.files ? Array.from(pmFiles.files) : [];
      if (!files.length) { showToast('โปรดเลือกไฟล์ก่อน', 'error'); return; }
      const g = pmGroupSelect ? pmGroupSelect.value : null;
      if (!g) { showToast('โปรดเลือกกลุ่ม', 'error'); return; }
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
          refreshSkuTable();
          renderModalThumbs();
          showToast('เพิ่มรูปสำเร็จ', 'success');
          // Clear file input to avoid confusion
          if (pmFiles) pmFiles.value = '';
        } catch (err) {
          console.error(err);
          showToast('ไม่สามารถอัปโหลดได้: ' + (err && err.message ? err.message : ''), 'error');
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
        showToast('เพิ่มรูป (Local) สำเร็จ', 'success');
        if (pmFiles) pmFiles.value = '';
      }
    } finally {
      pmAddBtn.disabled = false;
      pmAddBtn.classList.remove('opacity-70', 'cursor-wait');
      pmAddBtn.textContent = prevText;
    }
  });

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

  // Always keep SKU ID fixed once generated — make readonly to prevent accidental changes
  if (skuIdInput) {
    skuIdInput.readOnly = true;
  }

  // --- Admin page: sidebar and panels (if on admin.html) ---
  const menuAddSku = document.getElementById('menu-add-sku');
  const menuAddPart = document.getElementById('menu-add-part');
  const panelSku = document.getElementById('panel-sku');
  const panelPart = document.getElementById('panel-part');
  const adminSelectSku = document.getElementById('admin-select-sku');
  const adminSelectGroup = document.getElementById('admin-select-group');
  const addPartFiles = document.getElementById('admin-files-newpart');
  const addPartSave = document.getElementById('admin-addpart-save');

  function setActiveMenu(button) {
    [menuAddSku, menuAddPart].forEach(b => { if (b) b.classList.remove('active'); });
    if (button) button.classList.add('active');
  }
  function showPanel(panel) {
    if (panelSku) panelSku.classList.add('hidden');
    if (panelPart) panelPart.classList.add('hidden');
    if (panel) panel.classList.remove('hidden');
  }
  if (menuAddSku) {
    menuAddSku.addEventListener('click', () => { setActiveMenu(menuAddSku); showPanel(panelSku); });
  }
  if (menuAddPart) {
    menuAddPart.addEventListener('click', () => { setActiveMenu(menuAddPart); showPanel(panelPart); });
  }

  // populate sku select for add-part panel
  function populateAdminSkuSelect() {
    if (!adminSelectSku) return;
    adminSelectSku.innerHTML = '';
    Object.entries(CATALOG).forEach(([key, parts]) => {
      const opt = document.createElement('option');
      opt.value = key; opt.textContent = (parts.__name || key);
      adminSelectSku.appendChild(opt);
    });
  }
  populateAdminSkuSelect();

  // handle adding new part files to selected SKU
  if (addPartSave) {
    addPartSave.addEventListener('click', async () => {
      const skuKey = adminSelectSku ? adminSelectSku.value : null;
      const groupKey = adminSelectGroup ? adminSelectGroup.value : null;
      const files = addPartFiles && addPartFiles.files ? Array.from(addPartFiles.files) : [];
      if (!skuKey || !groupKey || files.length === 0) { showToast('กรุณาเลือก SKU, กลุ่ม และ ไฟล์', 'error'); return; }
      // If Supabase is configured, upload files to storage and insert asset rows
      const supa = getSupabaseClient();
      const bucket = window.SUPABASE_BUCKET || 'watch-assets';
      if (supa) {
        try {
          // fetch existing counts to continue numbering
          const { data: existingAssets, error: eAssets } = await supa.from('assets').select('group_key, sort').eq('sku_id', skuKey);
          if (eAssets) throw eAssets;
          const counts = {};
          (existingAssets || []).forEach(a => { counts[a.group_key] = Math.max(counts[a.group_key] || 0, a.sort || 0); });
          const assetRows = [];
          let idxStart = (counts[groupKey] || 0) + 1;
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const safeName = sanitizeFileName(f.name);
            const path = `${skuKey}/${groupKey}/${Date.now()}-${idxStart + i}-${safeName}`;
            const { error: eUp } = await supa.storage.from(bucket).upload(path, f, { upsert: true, contentType: f.type });
            if (eUp) throw eUp;
            const { data: pub } = supa.storage.from(bucket).getPublicUrl(path);
            const url = pub?.publicUrl || '';
            assetRows.push({ sku_id: skuKey, group_key: groupKey, label: `${groupKey[0].toUpperCase()+groupKey.slice(1)} ${idxStart + i}`, url, sort: idxStart + i });
          }
          if (assetRows.length) {
            // prevent duplicate insert by checking existing URLs
            const existingUrls = (existingAssets || []).map(a => normalizeUrl(a.url || ''));
            const filteredRows = assetRows.filter(r => !existingUrls.includes(normalizeUrl(r.url || '')));
            if (filteredRows.length) {
              const { error: eIns } = await supa.from('assets').insert(filteredRows).select();
              if (eIns) throw eIns;
            }
          }
          await maybeLoadCatalogFromSupabase();
          populateAdminSkuSelect();
          renderAdminList();
          showToast('เพิ่มลายสำเร็จ (Supabase)', 'success');
        } catch (err) {
          console.error(err);
          showToast('ไม่สามารถอัปโหลดไป Supabase: ' + (err && err.message ? err.message : String(err)), 'error');
        }
      } else {
        // fallback local storage behavior
        const existing = CATALOG[skuKey] || { __name: skuKey };
        existing[groupKey] = existing[groupKey] || [];
        let idx = existing[groupKey].length + 1;
        for (const f of files) {
          try {
            const dataUrl = await fileToDataURL(f);
            existing[groupKey].push({ label: `${groupKey[0].toUpperCase()+groupKey.slice(1)} ${idx++}`, dataUrl });
          } catch (e) { console.error(e); }
        }
        CATALOG[skuKey] = existing;
        localStorage.setItem('watchCatalog', JSON.stringify(CATALOG));
        showToast('เพิ่มลายสำเร็จ (Local)', 'success');
        populateAdminSkuSelect();
        renderAdminList();
      }
    });
  }

  // Enable/disable file inputs when toggles change
  function updatePartInputsState() {
    // support both checkbox table and legacy toggles
    const toggles = Array.from(document.querySelectorAll('#admin-parts-table tbody input.part-checkbox'))
      .concat(Array.from(document.querySelectorAll('#admin-part-toggles input.part-toggle')));
    toggles.forEach(t => {
      const g = t.dataset.group;
      const wrap = document.getElementById('wrap-admin-files-' + g) || document.getElementById('admin-files-' + g)?.parentElement;
      const input = document.getElementById('admin-files-' + g);
      if (wrap) {
        if (t.checked) wrap.classList.remove('part-disabled');
        else wrap.classList.add('part-disabled');
      }
      if (input) input.disabled = !t.checked;
      // if checkbox is in table, mark the row disabled state
      const row = t.closest('tr');
      if (row) row.classList.toggle('part-disabled', !t.checked);
    });
  }
  // wire legacy toggles and table checkboxes
  const partToggles = document.querySelectorAll('#admin-part-toggles input.part-toggle');
  partToggles.forEach(t => t.addEventListener('change', updatePartInputsState));
  const tableCheckboxes = document.querySelectorAll('#admin-parts-table tbody input.part-checkbox');
  tableCheckboxes.forEach(t => t.addEventListener('change', updatePartInputsState));
  // initial state
  updatePartInputsState();

  // Download PNG with watermark
  const btnDownload = $("btn-download");
  if (btnDownload) {
    btnDownload.addEventListener('click', async () => {
      try {
        const dataUrl = await composePreviewPNG({ watermark: '© Your Brand' });
        const a = document.createElement('a');
        a.href = dataUrl;
        const ts = new Date().toISOString().replace(/[:.]/g,'-');
        a.download = `${currentSKU}-${ts}.png`;
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e) { alert('ไม่สามารถบันทึกรูปได้'); }
    });
  }

  // --- Add Group to SKU Modal Logic ---
  const masterGroupList = ['bracelet','outer','inner','dial','hands','second'];

  function openGroupAddModal() {
    if (!modalContextSku) return;
    gamSkuKey.textContent = modalContextSku;
    gamGroupList.innerHTML = '';

    const existingGroups = getGroupsFromCatalog(CATALOG[modalContextSku] || {});

    MASTER_GROUP_LIST.forEach(groupInfo => {
      const group = groupInfo.key;
      const isExisting = existingGroups.includes(group);
      const label = document.createElement('label');
      label.className = 'flex items-center p-2 rounded-md hover:bg-gray-50';
      if (isExisting) label.classList.add('opacity-50', 'cursor-not-allowed');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'groupToAdd';
      checkbox.value = group;
      checkbox.className = 'mr-3 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500';
      if (isExisting) {
        checkbox.checked = true;
        checkbox.disabled = true;
      }
      
      const text = document.createElement('span');
      text.textContent = `${groupInfo.name_th} (${groupInfo.name_en})`;

      label.appendChild(checkbox);
      label.appendChild(text);
      gamGroupList.appendChild(label);
    });

    if (groupAddModal) groupAddModal.classList.remove('hidden');
  }
  
  function closeGroupAddModal() {
    if (groupAddModal) groupAddModal.classList.add('hidden');
  }

  if (btnAddGroup) btnAddGroup.addEventListener('click', openGroupAddModal);
  if (gamClose) gamClose.addEventListener('click', closeGroupAddModal);
  if (gamSave) {
    gamSave.addEventListener('click', () => {
      const checkboxes = gamGroupList.querySelectorAll('input[name="groupToAdd"]:checked:not(:disabled)');
      const groupsToAdd = Array.from(checkboxes).map(cb => cb.value);

      if (groupsToAdd.length > 0) {
        if (!CATALOG[modalContextSku]) {
          CATALOG[modalContextSku] = { __name: modalContextSku };
        }
        groupsToAdd.forEach(group => {
          if (!CATALOG[modalContextSku][group]) {
            CATALOG[modalContextSku][group] = [];
          }
        });

        // Potentially save to localStorage or Supabase if needed, for now just update UI
        localStorage.setItem('watchCatalog', JSON.stringify(CATALOG));

        // Refresh the main part modal's dropdown
        openPartModalForSKU(modalContextSku); 
      }
      closeGroupAddModal();
    });
  }

  if (gamAddNewBtn) {
    gamAddNewBtn.addEventListener('click', async () => {
        const key = sanitizeKey((gamNewKeyInput.value || '').trim());
        const name_th = (gamNewNameThInput.value || '').trim();
        const name_en = (gamNewNameEnInput.value || '').trim();

        if (!key || !name_th || !name_en) {
            showToast('กรุณากรอกข้อมูลพาทใหม่ให้ครบทุกช่อง', 'error');
            return;
        }

        if (MASTER_GROUP_LIST.some(g => g.key === key)) {
            showToast('ID Part (key) นี้มีอยู่แล้วในระบบ', 'error');
            return;
        }

        const supa = getSupabaseClient();
        if (!supa) {
            showToast('Supabase not connected', 'error');
            return;
        }

        const maxSortOrder = MASTER_GROUP_LIST.reduce((max, g) => Math.max(max, g.sort_order || 0), 0);

        try {
            const { error } = await supa.from('part_groups').insert({
                key,
                name_th,
                name_en,
                sort_order: maxSortOrder + 1
            });

            if (error) throw error;

            showToast('เพิ่มพาทใหม่เข้าระบบสำเร็จ', 'success');
            gamNewKeyInput.value = '';
            gamNewNameThInput.value = '';
            gamNewNameEnInput.value = '';
            
            // Refresh the master list and re-render the modal content
            await loadPartGroups(supa);
            openGroupAddModal();
        } catch (err) {
            console.error('Error adding new part group:', err);
            showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
        }
    });
  }

  // Auto-generate key from English name in the 'add new part' form
  if (gamNewNameEnInput && gamNewKeyInput) {
      gamNewNameEnInput.addEventListener('input', () => {
          gamNewKeyInput.value = sanitizeKey((gamNewNameEnInput.value || '').trim());
      });
  }

  // Wire add SKU button (top) to open the existing add-SKU panel
  // This is declared earlier, ensure no re-declaration
  // const addSkuTopBtn = document.getElementById('btn-add-component');
  if (addSkuTopBtn) {
    addSkuTopBtn.addEventListener('click', () => {
      // switch to the Add SKU panel
      try { setActiveMenu(menuAddSku); showPanel(panelSku); } catch (e) { /* fallback */ }
      // focus the name input
      const nameEl = document.getElementById('admin-sku-name'); if (nameEl) nameEl.focus();
    });
  }
});

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

function sanitizeFileName(name) {
  return String(name).replace(/[^A-Za-z0-9._-]/g, '-');
}

function sanitizeKey(name) {
  // SKU keys / storage paths should be ASCII lowercase + digits, dot, underscore or hyphen
  // replace any other character with '-' and trim leading/trailing '-'
  const s = String(name).toLowerCase().replace(/[^a-z0-9._-]/g, '-');
  // collapse multiple '-' to single and trim
  const cleaned = s.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (cleaned) return cleaned;
  // fallback to generated key when input contains no ASCII chars
  return 'sku-' + Date.now();
}

async function composePreviewPNG({ watermark = '' } = {}) {
  // Load layer images in order to a hidden canvas
  const order = ['bracelet','outer','inner','dial','hands','second'];
  // pick first available layer as base size or default 1200x1200
  let baseW = 1200, baseH = 1500;
  const imgs = [];
  for (const key of order) {
    const it = PARTS[key] && PARTS[key][0];
    const el = document.getElementById('layer-' + key);
    const src = el && el.src ? el.src : (it ? (it.dataUrl || (IMG_BASE + it.file)) : null);
    if (!src) { imgs.push(null); continue; }
    const img = await loadImage(src);
    imgs.push(img);
    if (img.naturalWidth && img.naturalHeight) { baseW = img.naturalWidth; baseH = img.naturalHeight; }
  }
  const canvas = document.createElement('canvas');
  canvas.width = baseW; canvas.height = baseH;
  const ctx = canvas.getContext('2d');
  const draw = (im) => { if (im) ctx.drawImage(im, 0, 0, baseW, baseH); };
  // draw in order
  imgs.forEach(draw);
  // watermark text (optional)
  if (watermark) {
    const pad = Math.round(baseW * 0.02);
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(2, Math.round(baseW * 0.0025));
    const fs = Math.max(24, Math.round(baseW * 0.03));
    ctx.font = `bold ${fs}px Manrope, Arial`;
    const m = ctx.measureText(watermark);
    const x = baseW - m.width - pad;
    const y = baseH - pad;
    ctx.strokeText(watermark, x, y);
    ctx.fillText(watermark, x, y);
    ctx.restore();
  }

  // watermark image from local folder (optional)
  try {
    if (WATERMARK_IMAGE) {
      const pad = Math.round(baseW * 0.02);
      const wimg = await loadImage(WATERMARK_IMAGE);
      const maxW = Math.round(baseW * 0.35);
      const scale = Math.min(1, maxW / (wimg.naturalWidth || maxW));
      const w = Math.round((wimg.naturalWidth || maxW) * scale);
      const h = Math.round((wimg.naturalHeight || maxW) * scale);
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.drawImage(wimg, baseW - w - pad, baseH - h - pad, w, h);
      ctx.restore();
    }
  } catch (e) { /* ignore drawing errors */ }
  return canvas.toDataURL('image/png');
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.crossOrigin = 'anonymous';
    im.src = src;
  });
}
