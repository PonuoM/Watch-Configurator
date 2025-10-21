"use strict";

// Basic data model mapping part groups to available image files in ./assets/
// Standardized filenames to avoid encoding/quoting issues from the original.
const PARTS = {
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

function $(id) {
  return document.getElementById(id);
}

function setLayerSrc(layerId, fileName) {
  const el = $(layerId);
  if (!el) return;
  el.src = fileName ? IMG_BASE + fileName : "";
}

function renderGrid(gridId, items, groupKey, state) {
  const grid = $(gridId);
  if (!grid) return;
  grid.innerHTML = "";
  items.forEach((it, idx) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "thumb";
    card.setAttribute("data-index", String(idx));
    card.setAttribute("data-group", groupKey);

    const img = document.createElement("img");
    img.src = IMG_BASE + it.file;
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

// Render a compact horizontal row (mobile)
function renderMobileRow(rowId, items, groupKey, state) {
  const row = $(rowId);
  if (!row) return;
  row.innerHTML = "";
  items.forEach((it, idx) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "thumb";
    const img = document.createElement("img");
    img.src = IMG_BASE + it.file;
    img.alt = it.label;
    img.draggable = false;
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = it.label;
    if (state[groupKey] === idx) card.classList.add("selected");
    card.appendChild(img);
    card.appendChild(label);
    row.appendChild(card);
    card.addEventListener("click", () => {
      state[groupKey] = idx;
      applySelections(state);
      renderMobileRow(rowId, items, groupKey, state);
    });
    card.addEventListener("dblclick", () => openModal(groupKey, idx));
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
  setLayerSrc("layer-bracelet", PARTS.bracelet[state.bracelet]?.file);
  setLayerSrc("layer-outer", PARTS.outer[state.outer]?.file);
  setLayerSrc("layer-inner", PARTS.inner[state.inner]?.file);
  setLayerSrc("layer-dial", PARTS.dial[state.dial]?.file);
  setLayerSrc("layer-hands", PARTS.hands[state.hands]?.file);
  setLayerSrc("layer-second", PARTS.second[state.second]?.file);
  // After changing images, resync heights when images load
  queueHeightSyncOnImages();
  // Ensure default view shows the whole watch
  if (typeof window !== 'undefined' && window.__resetZoomToFit) {
    window.__resetZoomToFit();
  }
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
let zoom = 0.7; // default: show whole watch smaller
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
  $("modal-img").src = IMG_BASE + it.file;
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

document.addEventListener("DOMContentLoaded", () => {
  // Set CSS var for header height so main can fit exactly 1 screen
  applyHeaderHeightVar();
  window.addEventListener('resize', applyHeaderHeightVar);
  // Default state (index 0)
  const state = {
    dial: 0,
    hands: 0,
    second: 0,
    outer: 0,
    inner: 0,
    bracelet: 0
  };

  // Render grids
  renderGrid("grid-dial", PARTS.dial, "dial", state);
  renderGrid("grid-hands", PARTS.hands, "hands", state);
  renderGrid("grid-second", PARTS.second, "second", state);
  renderGrid("grid-outer", PARTS.outer, "outer", state);
  renderGrid("grid-inner", PARTS.inner, "inner", state);
  renderGrid("grid-bracelet", PARTS.bracelet, "bracelet", state);
  // Mobile overlay grids (share same data/state)
  renderGrid("mgrid-dial", PARTS.dial, "dial", state);
  renderGrid("mgrid-hands", PARTS.hands, "hands", state);
  renderGrid("mgrid-second", PARTS.second, "second", state);
  renderGrid("mgrid-outer", PARTS.outer, "outer", state);
  renderGrid("mgrid-inner", PARTS.inner, "inner", state);
  renderGrid("mgrid-bracelet", PARTS.bracelet, "bracelet", state);

  // Mobile bottom carousel logic (only if elements exist)
  const mTitle = $("m-title");
  const mSubtitle = $("m-subtitle");
  const mPrev = $("m-prev");
  const mNext = $("m-next");
  const mRow = $("m-row");
  const mPage = $("m-page");
  if (mPrev && mNext) {
    // Show all watch parts on mobile stepper
    const groups = [
      { key: "dial", title: "Dial", subtitle: "Choose a dial design" },
      { key: "hands", title: "Hands", subtitle: "Pick hour/minute hands" },
      { key: "second", title: "Second Hand", subtitle: "Pick the second hand" },
      { key: "outer", title: "Outer Bezel", subtitle: "Select the outer bezel" },
      { key: "inner", title: "Inner Ring", subtitle: "Select the inner ring" },
      { key: "bracelet", title: "Bracelet", subtitle: "Choose a bracelet" }
    ];
    let page = 0;
    function updateNavState() {
      if (mPrev) mPrev.disabled = page <= 0;
      if (mNext) mNext.disabled = page >= groups.length - 1;
      if (mPage) mPage.textContent = `${page + 1}/${groups.length}`;
    }
    function setPage(p) {
      // clamp to ends (no wrap)
      page = Math.max(0, Math.min(p, groups.length - 1));
      const g = groups[page];
      if (mTitle) mTitle.textContent = g.title;
      if (mSubtitle) mSubtitle.textContent = g.subtitle;
      const items = PARTS[g.key];
      if (mRow) renderMobileRow("m-row", items, g.key, state);
      // Ensure row scrolls back to start on change
      if (mRow) mRow.scrollTo({ left: 0, behavior: "smooth" });
      if (typeof window !== 'undefined' && window.__resetZoomToFit) {
        window.__resetZoomToFit();
      }
      updateNavState();
    }
    setPage(0);
    const prevHandler = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      setPage(page - 1);
    };
    const nextHandler = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      setPage(page + 1);
    };
    mPrev.addEventListener("click", prevHandler);
    mNext.addEventListener("click", nextHandler);
  }

  applySelections(state);

  syncHeights();
  window.addEventListener("resize", syncHeights);
  queueHeightSyncOnImages();

  // Buttons
  const btnReset = $("btn-reset");
  if (btnReset) {
    btnReset.addEventListener("click", () => {
      state.dial = 0;
      state.hands = 0;
      state.second = 0;
      state.outer = 0;
      state.inner = 0;
      state.bracelet = 0;
      renderGrid("grid-dial", PARTS.dial, "dial", state);
      renderGrid("grid-hands", PARTS.hands, "hands", state);
      renderGrid("grid-second", PARTS.second, "second", state);
      renderGrid("grid-outer", PARTS.outer, "outer", state);
      renderGrid("grid-inner", PARTS.inner, "inner", state);
      renderGrid("grid-bracelet", PARTS.bracelet, "bracelet", state);
      applySelections(state);
    });
  }

  const btnRandom = $("btn-random");
  if (btnRandom) {
    btnRandom.addEventListener("click", () => {
      const rnd = randomizeState();
      Object.assign(state, rnd);
      renderGrid("grid-dial", PARTS.dial, "dial", state);
      renderGrid("grid-hands", PARTS.hands, "hands", state);
      renderGrid("grid-second", PARTS.second, "second", state);
      renderGrid("grid-outer", PARTS.outer, "outer", state);
      renderGrid("grid-inner", PARTS.inner, "inner", state);
      renderGrid("grid-bracelet", PARTS.bracelet, "bracelet", state);
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
  window.__resetZoomToFit = function() { zoom = 0.7; applyZoom(); };
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
});
