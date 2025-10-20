const API_BASE = 'https://api.todoist.com/rest/v2';
const PROXY_BASE = '/api';

// LocalStorage helpers
const storage = {
  getToken: () => localStorage.getItem('todoissimus_token') || '',
  setToken: (t) => localStorage.setItem('todoissimus_token', t || ''),
  getMode: () => localStorage.getItem('todoissimus_mode') || 'label',
  setMode: (m) => localStorage.setItem('todoissimus_mode', m || 'label'),
  getLabel: () => localStorage.getItem('todoissimus_label') || '',
  setLabel: (l) => localStorage.setItem('todoissimus_label', l || ''),
  getProjectId: () => localStorage.getItem('todoissimus_project') || '',
  setProjectId: (p) => localStorage.setItem('todoissimus_project', p || ''),
  getFilter: () => localStorage.getItem('todoissimus_filter') || '',
  setFilter: (f) => localStorage.setItem('todoissimus_filter', f || ''),
  getOrder: (key) => {
    try { return JSON.parse(localStorage.getItem(`todoissimus_order_${key}`) || '[]'); } catch { return []; }
  },
  setOrder: (key, order) => localStorage.setItem(`todoissimus_order_${key}`, JSON.stringify(order || [])),
};

// DOM elements
const els = {
  settings: document.getElementById('settings'),
  toggleSettings: document.getElementById('toggle-settings'),
  saveSettings: document.getElementById('save-settings'),
  loadList: document.getElementById('load-list'),
  updateApp: document.getElementById('update-app'),
  token: document.getElementById('token'),
  label: document.getElementById('label'),
  refresh: document.getElementById('refresh'),
  listTitle: document.getElementById('list-title'),
  list: document.getElementById('task-list'),
  empty: document.getElementById('empty'),
  tpl: document.getElementById('task-item-template'),
  addTaskBtn: document.getElementById('add-task'),
  newTaskContent: document.getElementById('new-task-content'),
  mode: document.getElementById('mode'),
  project: document.getElementById('project'),
  filter: document.getElementById('filter'),
  rowProject: document.getElementById('row-project'),
  rowFilter: document.getElementById('row-filter'),
  // removed due/priority inputs in composer
};

// Inject a Todoist icon button into header controls
(() => {
  const controls = document.querySelector('.controls');
  if (!controls) return;
  const existing = document.getElementById('open-todoist-label');
  if (existing) {
    els.openTodoistLabel = existing;
    try { console.log('[Todoissimus] Using existing Todoist icon button'); } catch (_) {}
    return;
  }
  const btn = document.createElement('button');
  btn.id = 'open-todoist-label';
  btn.title = 'In Todoist anzeigen';
  // Icon-only: ASCII to avoid any encoding/font issues
  btn.textContent = 'T';
  btn.setAttribute('aria-label', 'In Todoist anzeigen');
  controls.appendChild(btn);
  els.openTodoistLabel = btn;
  try { console.log('[Todoissimus] Injected Todoist icon button'); } catch (_) {}
})();

let state = {
  tasks: [],
  label: '',
  token: '',
  mode: 'label',
  projectId: '',
  filter: '',
  orderKey: '',
  activePointerId: null,
  projects: new Map(),
  drag: { srcEl: null, srcId: null, indicator: null, placeholder: null },
};

// Prefer Pointer Events; fall back to Touch on older browsers
const SUPPORTS_POINTER = typeof window !== 'undefined' && 'PointerEvent' in window;
const IS_TOUCH = (() => { try { return (('ontouchstart' in window) || (navigator.maxTouchPoints > 0)); } catch (_) { return false; } })();

// Safely cancel any active drag and restore hidden elements
function cancelActiveDrag() {
  try {
    if (state.drag.srcEl) {
      state.drag.srcEl.classList.remove('dragging');
      state.drag.srcEl.style.display = '';
    }
    if (state.drag.indicator && state.drag.indicator.parentNode) {
      state.drag.indicator.parentNode.removeChild(state.drag.indicator);
    }
  } catch (_) {}
  state.drag.indicator = null;
  state.drag.srcEl = null;
  state.drag.srcId = null;
}

// UI helpers
function showSettings(show) {
  els.settings.classList.toggle('hidden', !show);
}

function setTitle(label) {
  els.listTitle.textContent = label ? `Aufgaben für Label: ${label}` : 'Aufgaben';
}

function toast(msg) {
  console.log('[Todoissimus]', msg);
}

// Lightweight description overlay
function ensureDescOverlay() {
  let root = document.getElementById('desc-overlay');
  if (root) {
    const content = root.querySelector('.desc-content');
    const closeBtn = root.querySelector('.desc-close');
    return { root, content, closeBtn };
  }
  root = document.createElement('div');
  root.id = 'desc-overlay';
  root.className = 'desc-modal hidden';
  root.innerHTML = `
    <div class="desc-box" role="dialog" aria-modal="true" aria-labelledby="desc-title">
      <div class="desc-header">
        <div id="desc-title" class="desc-title">Beschreibung</div>
        <button class="desc-close" aria-label="Schließen">Schließen</button>
      </div>
      <div class="desc-content"></div>
    </div>`;
  document.body.appendChild(root);
  const content = root.querySelector('.desc-content');
  const closeBtn = root.querySelector('.desc-close');
  const onBgClick = (e) => {
    if (e.target === root) root.classList.add('hidden');
  };
  const onClose = () => root.classList.add('hidden');
  closeBtn.addEventListener('click', onClose);
  root.addEventListener('click', onBgClick);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') onClose(); });
  return { root, content, closeBtn };
}

function showDescriptionPopup(text) {
  const { root, content } = ensureDescOverlay();
  content.textContent = text || '';
  root.classList.remove('hidden');
}

function setTitleByState() {
  const m = state.mode || 'label';
  if (m === 'project') {
    const name = state.projects.get(String(state.projectId)) || (state.projectId ? `Projekt ${state.projectId}` : 'Projekt');
    els.listTitle.textContent = `Aufgaben im Projekt: ${name}`;
    return;
  }
  if (m === 'filter') {
    els.listTitle.textContent = state.filter ? `Aufgaben für Filter: ${state.filter}` : 'Aufgaben';
    return;
  }
  els.listTitle.textContent = state.label ? `Aufgaben für Label: ${state.label}` : 'Aufgaben';
}

// SW update helper: triggers update and reloads when new SW takes control
async function updateAppNow() {
  if (!('serviceWorker' in navigator)) { toast('Kein Service Worker verfügbar.'); return; }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) { location.reload(); return; }
    let reloaded = false;
    const onCtrl = () => { if (!reloaded) { reloaded = true; location.reload(); } };
    navigator.serviceWorker.addEventListener('controllerchange', onCtrl, { once: true });
    // Ask any waiting worker to activate immediately
    if (reg.waiting) {
      try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {}
    }
    // Trigger update fetch
    await reg.update();
    // In case nothing changes, fallback reload after short delay
    setTimeout(() => { if (!reloaded) location.reload(); }, 2000);
  } catch (e) {
    toast('Aktualisierung fehlgeschlagen, neu laden...');
    location.reload();
  }
}

// API helpers
async function api(path, { method = 'GET', token, body } = {}) {
  // On localhost with a token, try direct Todoist first (fast path, avoids local proxy issues).
  // Otherwise (or on failure), use the proxy. On Render, proxy remains the primary path.
  const isLocal = (() => { try { return /^(localhost|127\.|0\.0\.0\.0)$/.test(location.hostname); } catch (_) { return false; } })();

  const tryDirect = async () => {
    const directHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
    const directUrl = `${API_BASE}${path}`;
    const res = await fetch(directUrl, { method, headers: directHeaders, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Direct ${method} ${path} failed ${res.status}: ${text}`);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  };

  const tryProxy = async () => {
    const proxyHeaders = { 'Content-Type': 'application/json' };
    if (token) proxyHeaders['X-Auth-Token'] = token;
    const proxyUrl = `${PROXY_BASE}${path}`;
    const res = await fetch(proxyUrl, { method, headers: proxyHeaders, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`API ${method} ${path} failed ${res.status}: ${text}`);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  };

  if (isLocal && token) {
    try {
      return await tryDirect();
    } catch (_) {
      // Fall back to proxy if direct fails (e.g., CORS/network)
      return tryProxy();
    }
  }
  return tryProxy();
}

async function getTasksByLabel(label, token) {
  const labelParam = encodeURIComponent(label);
  return api(`/tasks?label=${labelParam}`, { token });
}

async function getTasksByProject(projectId, token) {
  const pid = encodeURIComponent(projectId);
  return api(`/tasks?project_id=${pid}`, { token });
}

async function getTasksByFilter(filter, token) {
  const f = encodeURIComponent(filter);
  return api(`/tasks?filter=${f}`, { token });
}

async function closeTask(id, token) {
  return api(`/tasks/${id}/close`, { method: 'POST', token });
}

async function updateTask(id, payload, token) {
  // Todoist REST v2 updates via POST to /tasks/{id}
  try {
    return await api(`/tasks/${id}`, { method: 'POST', token, body: payload });
  } catch (e) {
    // Fallback to PATCH if needed
    return api(`/tasks/${id}`, { method: 'PATCH', token, body: payload });
  }
}

async function createTask(payload, token) {
  return api('/tasks', { method: 'POST', token, body: payload });
}

async function getProjects(token) {
  return api('/projects', { token });
}

async function getLabels(token) {
  return api('/labels', { token });
}

async function getFilters(token) {
  return api('/filters', { token });
}

// Rendering & interaction
function renderTasks(tasks) {
  els.list.innerHTML = '';
  if (!tasks.length) {
    els.empty.classList.remove('hidden');
    return;
  }
  els.empty.classList.add('hidden');
  const frag = document.createDocumentFragment();
  for (const t of tasks) {
    const li = els.tpl.content.firstElementChild.cloneNode(true);
    li.dataset.id = t.id;

    const checkbox = li.querySelector('.task-checkbox');
    const contentEl = li.querySelector('.task-content');
    const dueRead = li.querySelector('.task-due-read');
    // Reuse priority pill as project pill if template still contains it
    let projectEl = li.querySelector('.task-project');
    if (!projectEl) {
      const legacyPrio = li.querySelector('.task-priority-read');
      if (legacyPrio) {
        legacyPrio.classList.remove('task-priority-read');
        legacyPrio.classList.add('task-project');
        legacyPrio.setAttribute('title', 'Projekt');
        projectEl = legacyPrio;
      }
    }
    const meta = li.querySelector('.task-meta');
    const openBtn = li.querySelector('.open-todoist');

    contentEl.textContent = t.content || '';
    const dueText = (t.due && (t.due.string || t.due.date)) || '';
    dueRead.textContent = dueText ? dueText : '';
    const apiPrio = Number(t.priority || 1);
    // Map Todoist API priority -> UI P1..P4
    // API: 4=highest,3,2,1=lowest;
    // UI: P1=highest (red) ... P4=lowest (gray)
    const uiPrio = apiPrio === 4 ? 1 : apiPrio === 3 ? 2 : apiPrio === 2 ? 3 : 4;
    li.classList.add(`prio-${uiPrio}`);

    // Show project name in the pill
    if (projectEl) {
      const projName = state.projects.get(String(t.project_id)) || '';
      projectEl.textContent = projName;
    }

    // Description indicator and popup
    const desc = (t.description || '').trim();
    if (desc && meta) {
      const descBtn = document.createElement('span');
      descBtn.className = 'task-desc pill';
      descBtn.title = 'Beschreibung anzeigen';
      descBtn.textContent = 'Beschreibung';
      if (openBtn && openBtn.parentNode === meta) meta.insertBefore(descBtn, openBtn);
      else meta.appendChild(descBtn);
      descBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showDescriptionPopup(desc);
      });
    }

    checkbox.addEventListener('change', async (e) => {
      checkbox.disabled = true;
      try {
        await closeTask(t.id, state.token);
        // Remove locally and persist order sans this id
        state.tasks = state.tasks.filter(x => x.id !== t.id);
        const order = storage.getOrder(state.orderKey).filter(id => String(id) !== String(t.id));
        storage.setOrder(state.orderKey, order);
        renderTasks(state.tasks);
      } catch (err) {
        toast(err.message);
        checkbox.checked = false;
      } finally {
        checkbox.disabled = false;
      }
    });

    // Open task in Todoist desktop app if available, else web
    // Make the button icon-like (white T on red background)
    if (openBtn) {
      openBtn.textContent = 'T';
      openBtn.title = 'In Todoist anzeigen';
      openBtn.setAttribute('aria-label', 'In Todoist anzeigen');
    }

    openBtn.addEventListener('click', () => {
      const webUrl = t.url || `https://todoist.com/app/task/${t.id}`;
      const candidates = [
        `todoist://app/task/${t.id}`,
        `todoist://task?id=${t.id}`,
      ];

      let launched = false;
      const onBlur = () => { launched = true; };
      window.addEventListener('blur', onBlur, { once: true });

      const fallbackWeb = () => {
        if (!launched) {
          try { window.open(webUrl, '_blank', 'noopener'); } catch (_) { location.href = webUrl; }
        }
        window.removeEventListener('blur', onBlur);
      };

      const tryNext = (i) => {
        if (launched) return; // already switched focus
        if (i >= candidates.length) { fallbackWeb(); return; }
        try {
          location.href = candidates[i];
        } catch (_) {
          tryNext(i + 1);
          return;
        }
        setTimeout(() => { if (!launched) tryNext(i + 1); }, 800);
      };

      tryNext(0);
    });

    // Drag & drop events (desktop)
    function isInteractive(el) {
      return (
        el.isContentEditable ||
        ['INPUT','SELECT','BUTTON','TEXTAREA','OPTION'].includes(el.tagName)
      );
    }

    // Helper: get or create the red insertion indicator
    function ensureIndicator() {
      if (!state.drag.indicator) {
        const ind = document.createElement('li');
        ind.className = 'drop-indicator';
        state.drag.indicator = ind;
      }
      return state.drag.indicator;
    }
    function positionIndicatorAtY(clientY) {
      const ind = ensureIndicator();
      const items = Array.from(els.list.children).filter(el => el.classList && el.classList.contains('task-item') && el !== state.drag.srcEl);
      if (!items.length) { els.list.appendChild(ind); return; }
      for (const item of items) {
        const r = item.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        if (clientY < mid) { els.list.insertBefore(ind, item); return; }
      }
      els.list.appendChild(ind);
    }

    li.addEventListener('dragstart', (e) => {
      if (isInteractive(e.target)) { e.preventDefault(); return; }
      // Ignore HTML5 drag if a pointer/touch drag is active
      if (state.drag && state.drag.srcEl) { e.preventDefault(); return; }
      li.classList.add('dragging');
      state.drag.srcEl = li;
      state.drag.srcId = t.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.id);
      // Place indicator based on pointer Y and hide the item
      positionIndicatorAtY(e.clientY || (li.getBoundingClientRect().top + 1));
      li.style.display = 'none';
    });
    li.addEventListener('dragend', () => {
      // If drag ended without a proper drop, restore original position
      if (state.drag.indicator && state.drag.srcEl) {
        els.list.insertBefore(li, state.drag.indicator);
      }
      li.style.display = '';
      li.classList.remove('dragging');
      // Cleanup indicator
      if (state.drag.indicator && state.drag.indicator.parentNode) {
        state.drag.indicator.parentNode.removeChild(state.drag.indicator);
      }
      state.drag.indicator = null;
      state.drag.srcEl = null;
      state.drag.srcId = null;
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      positionIndicatorAtY(e.clientY);
    });
    li.addEventListener('drop', () => {
      // Insert the dragged item at the indicator and persist new order
      const ind = state.drag.indicator;
      if (ind) {
        els.list.insertBefore(li, ind);
        if (ind.parentNode) ind.parentNode.removeChild(ind);
      }
      li.style.display = '';
      li.classList.remove('dragging');
      // Persist new order
      const ids = Array.from(els.list.querySelectorAll('.task-item')).map(x => x.dataset.id);
      storage.setOrder(state.orderKey, ids);
      state.drag.indicator = null;
      state.drag.srcEl = null;
      state.drag.srcId = null;
    });

    // Touch-friendly reorder (pointer events fallback)
    const handle = li; // allow dragging from anywhere on the task item
    let pointerDragging = false;
    let pressTimer = null;
    let startX = 0, startY = 0;
    let lastX = 0, lastY = 0;
    let scrollRAF = 0;
    let dragMoved = false;
    let dragStartTs = 0;
    const LONG_PRESS_MS = 300;
    const MOVE_TOL = 8;

    function ensureIndicator() {
      if (!state.drag.indicator) {
        const el = document.createElement('li');
        el.className = 'drop-indicator';
        state.drag.indicator = el;
      }
      return state.drag.indicator;
    }
    function ensurePlaceholder(refEl) {
      if (!state.drag.placeholder) {
        const ph = document.createElement('li');
        ph.className = 'drag-placeholder';
        try { ph.style.height = `${refEl ? refEl.offsetHeight : 44}px`; } catch(_) {}
        state.drag.placeholder = ph;
      }
      return state.drag.placeholder;
    }
    function getMarker(refEl){ return state.drag.placeholder || state.drag.indicator || ensureIndicator(refEl); }
    function positionMarkerAtY(clientY) {
      const marker = getMarker();
      const items = Array.from(els.list.children).filter(el => el.classList && el.classList.contains('task-item') && el !== state.drag.srcEl);
      if (!items.length) { els.list.appendChild(marker); return; }
      for (const item of items) {
        const r = item.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        if (clientY < mid) { els.list.insertBefore(marker, item); return; }
      }
      els.list.appendChild(marker);
    }

    function preventTouchMove(e){ try { e.preventDefault(); } catch(_){} }

    function beginDrag() {
      pointerDragging = true;
      li.classList.add('dragging');
      try { li.draggable = false; } catch(_) {}
      state.drag.srcEl = li;
      state.drag.srcId = t.id;
      dragMoved = false;
      dragStartTs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      // Keep pointer stream attached (helps Android/Chrome)
      try { if (state.activePointerId != null && li.setPointerCapture) li.setPointerCapture(state.activePointerId); } catch(_) {}
      // do not use pointer capture as it can suppress document-level move on some browsers
      // Disable default touch gestures while dragging
      try { document.body.style.touchAction = 'none'; } catch (_) {}
      try { document.documentElement.style.overscrollBehaviorY = 'contain'; } catch (_) {}
      try { (document.scrollingElement || document.documentElement).style.overflow = 'hidden'; } catch (_) {}
      // Block touch scrolling explicitly on touch devices (incl. iOS with PointerEvents)
      document.addEventListener('touchmove', preventTouchMove, { passive: false });
      try { document.documentElement.classList.add('drag-active'); } catch(_) {}
      try { document.body.classList.add('drag-active'); } catch(_) {}
      // Place red indicator at current Y and move the item offscreen (keep pointer stream alive)
      positionIndicatorAtY(lastY || (li.getBoundingClientRect().top + 1));
      li.style.position = 'fixed';
      li.style.top = '-9999px';
      li.style.left = '-9999px';
      li.style.pointerEvents = 'none';
      // Rebind move listener as non-passive to allow preventDefault during drag
      window.removeEventListener('pointermove', onPointerMove);
      window.addEventListener('pointermove', onPointerMove, { passive: false });
      // Start edge auto-scroll loop
      const edge = 60; // px from top/bottom to trigger auto-scroll
      const step = 10; // px per frame
      function autoScrollLoop(){
        if (!pointerDragging) { scrollRAF = 0; return; }
        const h = window.innerHeight || 0;
        let delta = 0;
        if (lastY < edge) delta = -step;
        else if (lastY > h - edge) delta = step;
        if (delta !== 0) {
          window.scrollBy(0, delta);
          // Also update indicator while scrolling continues
          try { positionIndicatorAtY(lastY); } catch(_){}
        }
        scrollRAF = requestAnimationFrame(autoScrollLoop);
      }
      scrollRAF = requestAnimationFrame(autoScrollLoop);
    }

    function onPointerMove(ev) {
      if (!pointerDragging) {
        // While not dragging, detect significant movement to let scroll happen and cancel long-press
        const dx = (ev.clientX || 0) - startX;
        const dy = (ev.clientY || 0) - startY;
        if (Math.hypot(dx, dy) > MOVE_TOL && pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
        return;
      }
      lastX = ev.clientX || lastX; lastY = ev.clientY || lastY;
      // During drag: update indicator and prevent scroll
      try { ev.preventDefault(); } catch (_) {}
      dragMoved = true;
      positionIndicatorAtY(ev.clientY);
    }

    function onPointerUp() {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      document.removeEventListener('touchmove', preventTouchMove);
      // Also remove any touchmove/touchend listeners used for tracking
      try { document.removeEventListener('touchmove', onTouchMove); } catch(_) {}
      try { document.removeEventListener('touchend', onTouchEnd); } catch(_) {}
      try { document.removeEventListener('touchcancel', onTouchEnd); } catch(_) {}
      try { if (state.activePointerId != null && li.releasePointerCapture) li.releasePointerCapture(state.activePointerId); } catch(_) {}
      state.activePointerId = null;
      if (scrollRAF) { try { cancelAnimationFrame(scrollRAF); } catch(_){} scrollRAF = 0; }
      if (!pointerDragging) return; // treated as tap/scroll
      pointerDragging = false;
      // Place item at marker (placeholder preferred)
      if (state.drag.placeholder) {
        els.list.insertBefore(li, state.drag.placeholder);
        if (state.drag.placeholder.parentNode) state.drag.placeholder.parentNode.removeChild(state.drag.placeholder);
      } else if (state.drag.indicator) {
        els.list.insertBefore(li, state.drag.indicator);
        if (state.drag.indicator.parentNode) state.drag.indicator.parentNode.removeChild(state.drag.indicator);
      }
      if (state.drag.srcEl) state.drag.srcEl.classList.remove('dragging');
      try { li.draggable = true; } catch(_) {}
      // Restore item styles
      li.style.position = '';
      li.style.top = '';
      li.style.left = '';
      li.style.pointerEvents = '';
      state.drag.srcEl = null;
      state.drag.srcId = null;
      state.drag.indicator = null;
      state.drag.placeholder = null;
      // Restore default touch behavior
      try { document.body.style.touchAction = ''; } catch (_) {}
      try { document.documentElement.style.overscrollBehaviorY = ''; } catch (_) {}
      try { (document.scrollingElement || document.documentElement).style.overflow = ''; } catch (_) {}
      try { document.documentElement.classList.remove('drag-select-block'); } catch(_) {}
      try { document.body.classList.remove('drag-select-block'); } catch(_) {}
      try { document.documentElement.classList.remove('drag-active'); } catch(_) {}
      try { document.body.classList.remove('drag-active'); } catch(_) {}
      const ids = Array.from(els.list.querySelectorAll('.task-item')).map(x => x.dataset.id);
      storage.setOrder(state.orderKey, ids);
    }

    if (SUPPORTS_POINTER) {
      handle.addEventListener('pointerdown', (ev) => {
        if (isInteractive(ev.target)) return;
        // If any previous drag is active, restore it first
        if (state.drag.srcEl && state.drag.srcEl !== li) cancelActiveDrag();
        state.activePointerId = ev.pointerId || null;
        // Prevent text selection kick-off on Android/Chrome
        try { ev.preventDefault(); } catch(_) {}
        startX = ev.clientX || 0;
        startY = ev.clientY || 0;
        lastX = startX; lastY = startY;
        // Start long-press timer; only then we begin dragging
        pressTimer = setTimeout(() => { beginDrag(); }, LONG_PRESS_MS);
        // Listen for movement/up; initially keep move passive to allow scroll
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
      // During long-press window, block text selection but allow scroll
      try { document.documentElement.classList.add('drag-select-block'); } catch(_) {}
      try { document.body.classList.add('drag-select-block'); } catch(_) {}
      });
    }

    // Touch fallbacks to ensure updates on iOS Safari (only if no Pointer Events)
    function onTouchMove(ev) {
      const t = (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]);
      if (!t) return;
      if (!pointerDragging) {
        const dx = (t.clientX || 0) - startX;
        const dy = (t.clientY || 0) - startY;
        if (Math.hypot(dx, dy) > MOVE_TOL && pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        return;
      }
      lastX = t.clientX || lastX; lastY = t.clientY || lastY;
      try { ev.preventDefault(); } catch(_) {}
      positionIndicatorAtY(lastY);
    }
    function onTouchEnd() { onPointerUp(); }
    if (!SUPPORTS_POINTER) {
      handle.addEventListener('touchstart', (ev) => {
        if (isInteractive(ev.target)) return;
        if (state.drag.srcEl && state.drag.srcEl !== li) cancelActiveDrag();
        const t = (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]);
        if (!t) return;
        startX = t.clientX || 0;
        startY = t.clientY || 0;
        lastX = startX; lastY = startY;
        pressTimer = setTimeout(() => { beginDrag(); }, LONG_PRESS_MS);
      document.addEventListener('touchmove', onTouchMove, { passive: true });
      document.addEventListener('touchend', onTouchEnd);
      document.addEventListener('touchcancel', onTouchEnd);
    });
    }

    frag.appendChild(li);
  }
  els.list.appendChild(frag);
}

function sortByLocalOrder(tasks, key) {
  const order = storage.getOrder(key).map(String);
  if (!order.length) return tasks.slice();
  const map = new Map(tasks.map(t => [String(t.id), t]));
  const sorted = [];
  for (const id of order) {
    if (map.has(id)) {
      sorted.push(map.get(id));
      map.delete(id);
    }
  }
  for (const rest of map.values()) sorted.push(rest);
  return sorted;
}

async function load() {
  // Allow deep-link via query parameter: ?label=foo
  try {
    const params = new URLSearchParams(location.search);
    const qpLabel = (params.get('label') || params.get('l') || '').trim();
    if (qpLabel) {
      storage.setLabel(qpLabel);
      try { history.replaceState(null, '', location.pathname); } catch (_) {}
    }
  } catch (_) {}

  state.token = storage.getToken();
  state.mode = storage.getMode();
  state.label = storage.getLabel();
  state.projectId = storage.getProjectId();
  state.filter = storage.getFilter();
  els.token.value = state.token;
  els.mode.value = state.mode;
  els.label.value = state.label;
  els.filter.value = state.filter;
  setTitleByState();

  // Toggle settings rows visibility
  const showProject = state.mode === 'project';
  const showFilter = state.mode === 'filter';
  const showLabel = state.mode === 'label';
  // Label row is the sibling of mode; it's the label field's parent
  const labelRow = els.label && els.label.closest ? els.label.closest('.settings-row') : null;
  els.rowProject.style.display = showProject ? '' : 'none';
  els.rowFilter.style.display = showFilter ? '' : 'none';
  if (labelRow) labelRow.style.display = showLabel ? '' : 'none';

  try {
    const [projects, labels, filters] = await Promise.all([
      getProjects(state.token).catch(() => []),
      getLabels(state.token).catch(() => []),
      getFilters(state.token).catch(() => []),
    ]);
    // Build projects map id -> name
    state.projects = new Map((projects || []).map(p => [String(p.id), p.name]));
    // Populate project select if present
    if (els.project && projects && projects.length) {
      els.project.innerHTML = '';
      for (const p of projects) {
        const opt = document.createElement('option');
        opt.value = String(p.id);
        opt.textContent = p.name;
        if (String(p.id) === String(state.projectId)) opt.selected = true;
        els.project.appendChild(opt);
      }
      if (!state.projectId && projects.length) {
        state.projectId = String(projects[0].id);
        storage.setProjectId(state.projectId);
      }
    }

    // Populate labels select
    if (els.label && els.label.tagName === 'SELECT') {
      els.label.innerHTML = '';
      if (labels && labels.length) {
        // Placeholder
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = '— Label auswählen —';
        ph.disabled = true;
        if (!state.label) ph.selected = true;
        els.label.appendChild(ph);
        for (const l of labels) {
          const opt = document.createElement('option');
          opt.value = l.name;
          opt.textContent = l.name;
          if (String(l.name) === String(state.label)) opt.selected = true;
          els.label.appendChild(opt);
        }
        if (!state.label && labels.length) {
          state.label = String(labels[0].name || '');
          storage.setLabel(state.label);
          try { els.label.value = state.label; } catch(_) {}
        }
      } else {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Keine Labels gefunden (Token?)';
        opt.disabled = true;
        opt.selected = true;
        els.label.appendChild(opt);
      }
    }

    // Optional: populate filters if we add a dropdown later

    // If still missing a required selection after populating, show settings and stop
    if ((state.mode === 'label' && !state.label) || (state.mode === 'project' && !state.projectId)) {
      showSettings(true);
      return;
    }

    // Fetch tasks per mode
    let tasks = [];
    if (state.mode === 'project') tasks = await getTasksByProject(state.projectId, state.token);
    else if (state.mode === 'filter') tasks = await getTasksByFilter(state.filter || '', state.token);
    else tasks = await getTasksByLabel(state.label, state.token);

    // Compute order key for this view
    const valueKey = state.mode === 'project' ? String(state.projectId) : (state.mode === 'filter' ? String(state.filter || '') : String(state.label || ''));
    state.orderKey = `${state.mode}:${valueKey}`;
    state.tasks = sortByLocalOrder(tasks, state.orderKey);
    setTitleByState();
    renderTasks(state.tasks);
  } catch (err) {
    toast(err.message);
    showSettings(true);
  }
}

// Handlers
els.toggleSettings.addEventListener('click', () => {
  els.settings.classList.toggle('hidden');
});

els.saveSettings.addEventListener('click', () => {
  const token = els.token.value.trim();
  const mode = (els.mode && els.mode.value) || 'label';
  const label = els.label.value.trim();
  const projectId = els.project && els.project.value ? String(els.project.value) : '';
  const filter = els.filter && els.filter.value ? els.filter.value.trim() : '';
  storage.setToken(token);
  storage.setMode(mode);
  storage.setLabel(label);
  storage.setProjectId(projectId);
  storage.setFilter(filter);
  setTitleByState();
  toast('Einstellungen gespeichert.');
});

els.loadList.addEventListener('click', () => {
  showSettings(false);
  load();
});

els.refresh.addEventListener('click', () => load());

if (els.mode) {
  els.mode.addEventListener('change', () => {
    const m = els.mode.value;
    storage.setMode(m);
    // Toggle rows
    els.rowProject.style.display = m === 'project' ? '' : 'none';
    els.rowFilter.style.display = m === 'filter' ? '' : 'none';
    const labelRow = els.label && els.label.closest ? els.label.closest('.settings-row') : null;
    if (labelRow) labelRow.style.display = m === 'label' ? '' : 'none';
    // Persist any immediate selection change
    if (m === 'project' && els.project && els.project.value) storage.setProjectId(String(els.project.value));
    if (m === 'filter' && els.filter) storage.setFilter(els.filter.value.trim());
    if (m === 'label' && els.label) storage.setLabel(els.label.value.trim());
    setTitleByState();
  });
}

if (els.label) {
  els.label.addEventListener('change', () => {
    storage.setLabel(els.label.value.trim());
  });
}
if (els.project) {
  els.project.addEventListener('change', () => {
    storage.setProjectId(String(els.project.value));
  });
}
if (els.filter) {
  els.filter.addEventListener('change', () => {
    storage.setFilter(els.filter.value.trim());
  });
}

if (els.updateApp) {
  els.updateApp.addEventListener('click', () => updateAppNow());
}

// Open current selection directly in Todoist (web)
if (els.openTodoistLabel) {
  els.openTodoistLabel.addEventListener('click', () => {
    let desktopUrl = '';
    let webUrl = '';
    const mode = state.mode || storage.getMode();
    if (mode === 'project' && state.projectId) {
      // Open project view
      const pid = String(state.projectId);
      desktopUrl = `todoist://app/project/${encodeURIComponent(pid)}`;
      webUrl = `https://todoist.com/app/project/${encodeURIComponent(pid)}`;
    } else if (mode === 'filter') {
      const rawFilter = (state.filter || storage.getFilter() || '').trim();
      if (!rawFilter) { showSettings(true); return; }
      desktopUrl = `todoist://app/search/${encodeURIComponent(rawFilter)}`;
      webUrl = `https://todoist.com/app/search/${encodeURIComponent(rawFilter)}`;
    } else {
      const raw = (state.label || storage.getLabel() || '').trim();
      if (!raw) { showSettings(true); return; }
      const query = raw.startsWith('@') ? raw : `@${raw}`;
      desktopUrl = `todoist://app/search/${encodeURIComponent(query)}`;
      webUrl = `https://todoist.com/app/search/${encodeURIComponent(query)}`;
    }

    // Try opening the desktop app via custom protocol with a web fallback
    let launched = false;
    const onBlur = () => { launched = true; };
    window.addEventListener('blur', onBlur, { once: true });

    const fallback = () => {
      if (!launched) {
        try { window.open(webUrl, '_blank', 'noopener'); } catch (_) { location.href = webUrl; }
      }
      window.removeEventListener('blur', onBlur);
    };

    try {
      // Direct navigation is most reliable for custom protocols
      location.href = desktopUrl;
    } catch (_) {
      // If navigation throws, immediately fallback to web
      try { window.open(webUrl, '_blank', 'noopener'); } catch { location.href = webUrl; }
      return;
    }

    // If the desktop app did not take focus within a short window, fallback
    setTimeout(fallback, 1200);
  });
}

els.addTaskBtn.addEventListener('click', async () => {
  const content = els.newTaskContent.value.trim();
  if (!content) return;
  const payload = { content };
  if (state.mode === 'project' && state.projectId) payload.project_id = state.projectId;
  else if (state.mode === 'label' && state.label) payload.labels = [state.label];
  try {
    const created = await createTask(payload, state.token);
    state.tasks.push(created);
    const ids = Array.from(els.list.querySelectorAll('.task-item')).map(x => x.dataset.id);
    ids.push(String(created.id));
    storage.setOrder(state.orderKey, ids);
    renderTasks(state.tasks);
    els.newTaskContent.value = '';
  } catch (err) {
    toast(err.message);
  }
});

// Start
load();
