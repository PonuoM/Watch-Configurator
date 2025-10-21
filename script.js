// Basic data model mapping part groups to available image files in ./รวม/
// Names follow your provided assets: กรอบ*, กรอบใน*, หน้าปัด*, เข็ม*, เข็มวิ*, สาย*

const PARTS = {
  dial: [
    { label: 'Dial 1', file: 'หน้าปัด1.png' },
    { label: 'Dial 2', file: 'หน้าปัด2.png' }
  ],
  hands: [
    { label: 'Hands 1', file: 'เข็ม1.png' },
    { label: 'Hands 2', file: 'เข็ม2.png' }
  ],
  second: [
    { label: 'Second 1', file: 'เข็มวิ1.png' },
    { label: 'Second 2', file: 'เข็มวิ2.png' }
  ],
  outer: [
    { label: 'Outer 1', file: 'กรอบ1.png' },
    { label: 'Outer 2', file: 'กรอบ2.png' }
  ],
  inner: [
    { label: 'Inner 1', file: 'กรอบใน1.png' },
    { label: 'Inner 2', file: 'กรอบใน2.png' }
  ],
  bracelet: [
    { label: 'Bracelet 1', file: 'สาย1.png' },
    { label: 'Bracelet 2', file: 'สาย2.png' }
  ]
};

const IMG_BASE = './รวม/';

function $(id) {
  return document.getElementById(id);
}

function setLayerSrc(layerId, fileName) {
  const el = $(layerId);
  if (!el) return;
  el.src = fileName ? IMG_BASE + fileName : '';
}

function renderGrid(gridId, items, groupKey, state) {
  const grid = $(gridId);
  grid.innerHTML = '';
  items.forEach((it, idx) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'thumb';
    card.setAttribute('data-index', String(idx));
    card.setAttribute('data-group', groupKey);

    const img = document.createElement('img');
    img.src = IMG_BASE + it.file;
    img.alt = it.label;
    img.draggable = false;

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = it.label;

    if (state[groupKey] === idx) card.classList.add('selected');

    card.appendChild(img);
    card.appendChild(label);
    grid.appendChild(card);

    // Click to select
    card.addEventListener('click', () => {
      state[groupKey] = idx;
      applySelections(state);
      // update selection UI
      renderGroupSelection(gridId, state[groupKey]);
    });

    // Double click to open modal preview
    card.addEventListener('dblclick', () => openModal(groupKey, idx));
  });
}

function renderGroupSelection(gridId, selectedIdx) {
  const grid = $(gridId);
  [...grid.children].forEach((el, i) => {
    el.classList.toggle('selected', i === selectedIdx);
  });
}

function applySelections(state) {
  setLayerSrc('layer-bracelet', PARTS.bracelet[state.bracelet]?.file);
  setLayerSrc('layer-outer', PARTS.outer[state.outer]?.file);
  setLayerSrc('layer-inner', PARTS.inner[state.inner]?.file);
  setLayerSrc('layer-dial', PARTS.dial[state.dial]?.file);
  setLayerSrc('layer-hands', PARTS.hands[state.hands]?.file);
  setLayerSrc('layer-second', PARTS.second[state.second]?.file);
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
function queueHeightSyncOnImages() {
  if (heightSyncQueued) return;
  heightSyncQueued = true;
  const layers = ['layer-bracelet','layer-outer','layer-inner','layer-dial','layer-hands','layer-second']
    .map(id => $(id))
    .filter(Boolean);
  let remaining = layers.length;
  const done = () => { remaining--; if (remaining <= 0) { heightSyncQueued = false; syncHeights(); } };
  layers.forEach(img => {
    if (!img.complete) {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    } else {
      done();
    }
  });
}
function openModal(groupKey, idx) {
  const it = PARTS[groupKey][idx];
  modalContext = { groupKey, index: idx };
  $('modal-img').src = IMG_BASE + it.file;
  $('modal-caption').textContent = it.label;
  const m = $('image-modal');
  m.classList.remove('hidden');
  m.classList.add('flex');
}
function closeModal() {
  const m = $('image-modal');
  m.classList.add('hidden');
  m.classList.remove('flex');
}

document.addEventListener('DOMContentLoaded', () => {
  // Default state (index 0)
  const state = { dial: 0, hands: 0, second: 0, outer: 0, inner: 0, bracelet: 0 };

  // Render grids
  renderGrid('grid-dial', PARTS.dial, 'dial', state);
  renderGrid('grid-hands', PARTS.hands, 'hands', state);
  renderGrid('grid-second', PARTS.second, 'second', state);
  renderGrid('grid-outer', PARTS.outer, 'outer', state);
  renderGrid('grid-inner', PARTS.inner, 'inner', state);
  renderGrid('grid-bracelet', PARTS.bracelet, 'bracelet', state);

  applySelections(state);

  // Sync controls panel height roughly to preview box height on load/resize
  function syncHeights() {
    const previewCard = document.querySelector('#preview > div');
    const panel = document.getElementById('controls-panel');
    if (!previewCard || !panel) return;
    const rect = previewCard.getBoundingClientRect();
    // Set explicit height equal to preview for perfect match
    panel.style.maxHeight = '';
    panel.style.height = Math.floor(rect.height) + 'px';
  }
  syncHeights();
  window.addEventListener('resize', syncHeights);
  queueHeightSyncOnImages();

  // Buttons
  $('btn-reset').addEventListener('click', () => {
    state.dial = 0; state.hands = 0; state.second = 0; state.outer = 0; state.inner = 0; state.bracelet = 0;
    renderGrid('grid-dial', PARTS.dial, 'dial', state);
    renderGrid('grid-hands', PARTS.hands, 'hands', state);
    renderGrid('grid-second', PARTS.second, 'second', state);
    renderGrid('grid-outer', PARTS.outer, 'outer', state);
    renderGrid('grid-inner', PARTS.inner, 'inner', state);
    renderGrid('grid-bracelet', PARTS.bracelet, 'bracelet', state);
    applySelections(state);
  });

  $('btn-random').addEventListener('click', () => {
    const rnd = randomizeState();
    Object.assign(state, rnd);
    renderGrid('grid-dial', PARTS.dial, 'dial', state);
    renderGrid('grid-hands', PARTS.hands, 'hands', state);
    renderGrid('grid-second', PARTS.second, 'second', state);
    renderGrid('grid-outer', PARTS.outer, 'outer', state);
    renderGrid('grid-inner', PARTS.inner, 'inner', state);
    renderGrid('grid-bracelet', PARTS.bracelet, 'bracelet', state);
    applySelections(state);
  });

  // Modal bindings
  $('modal-close').addEventListener('click', closeModal);
  $('image-modal').addEventListener('click', (e) => {
    if (e.target.id === 'image-modal') closeModal();
  });
  $('modal-select').addEventListener('click', () => {
    if (modalContext.groupKey == null) return closeModal();
    // apply chosen
    state[modalContext.groupKey] = modalContext.index;
    applySelections(state);
    // re-render group for selection state
    renderGrid(`grid-${modalContext.groupKey}`, PARTS[modalContext.groupKey], modalContext.groupKey, state);
    closeModal();
  });
});


