const API_BASE = 'https://api.todoist.com/rest/v2';
const PROXY_BASE = '/api';

// LocalStorage helpers
const storage = {
  getToken: () => localStorage.getItem('todoissimus_token') || '',
  setToken: (t) => localStorage.setItem('todoissimus_token', t || ''),
  getLabel: () => localStorage.getItem('todoissimus_label') || '',
  setLabel: (l) => localStorage.setItem('todoissimus_label', l || ''),
  getOrder: (label) => {
    try { return JSON.parse(localStorage.getItem(`todoissimus_order_${label}`) || '[]'); } catch { return []; }
  },
  setOrder: (label, order) => localStorage.setItem(`todoissimus_order_${label}`, JSON.stringify(order || [])),
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
  projects: new Map(),
  drag: { srcEl: null, srcId: null, indicator: null },
};

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
  // Always use the proxy to avoid CORS issues in browsers (incl. Render).
  // If a token is provided, send it via X-Auth-Token so the proxy can forward it.
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Auth-Token'] = token;
  const url = `${PROXY_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${method} ${path} failed ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

async function getTasksByLabel(label, token) {
  const labelParam = encodeURIComponent(label);
  // List active tasks filtered by label
  return api(`/tasks?label=${labelParam}`, { token });
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

    checkbox.addEventListener('change', async (e) => {
      checkbox.disabled = true;
      try {
        await closeTask(t.id, state.token);
        // Remove locally and persist order sans this id
        state.tasks = state.tasks.filter(x => x.id !== t.id);
        const order = storage.getOrder(state.label).filter(id => String(id) !== String(t.id));
        storage.setOrder(state.label, order);
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
      storage.setOrder(state.label, ids);
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

    function preventTouchMove(e){ try { e.preventDefault(); } catch(_){} }

    function beginDrag() {
      pointerDragging = true;
      li.classList.add('dragging');
      state.drag.srcEl = li;
      state.drag.srcId = t.id;
      // Disable default touch gestures while dragging
      try { document.body.style.touchAction = 'none'; } catch (_) {}
      try { document.documentElement.style.overscrollBehaviorY = 'contain'; } catch (_) {}
      try { (document.scrollingElement || document.documentElement).style.overflow = 'hidden'; } catch (_) {}
      // Block touch scrolling on iOS explicitly
      document.addEventListener('touchmove', preventTouchMove, { passive: false });
      // Insert indicator at current pointer Y and hide the item
      const ind = ensureIndicator();
      positionIndicatorAtY(lastY || (li.getBoundingClientRect().top + 1));
      li.style.display = 'none';
      // Rebind move listener as non-passive to allow preventDefault during drag
      document.removeEventListener('pointermove', onPointerMove);
      document.addEventListener('pointermove', onPointerMove, { passive: false });
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
      positionIndicatorAtY(ev.clientY);
    }

    function onPointerUp() {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('touchmove', preventTouchMove);
      // Also remove any touchmove/touchend listeners used for tracking
      try { document.removeEventListener('touchmove', onTouchMove); } catch(_) {}
      try { document.removeEventListener('touchend', onTouchEnd); } catch(_) {}
      if (scrollRAF) { try { cancelAnimationFrame(scrollRAF); } catch(_){} scrollRAF = 0; }
      if (!pointerDragging) return; // treated as tap/scroll
      pointerDragging = false;
      // Place item at indicator (or restore if none)
      if (state.drag.indicator) {
        els.list.insertBefore(li, state.drag.indicator);
        if (state.drag.indicator.parentNode) state.drag.indicator.parentNode.removeChild(state.drag.indicator);
      }
      if (state.drag.srcEl) state.drag.srcEl.classList.remove('dragging');
      li.style.display = '';
      state.drag.srcEl = null;
      state.drag.srcId = null;
      state.drag.indicator = null;
      // Restore default touch behavior
      try { document.body.style.touchAction = ''; } catch (_) {}
      try { document.documentElement.style.overscrollBehaviorY = ''; } catch (_) {}
      try { (document.scrollingElement || document.documentElement).style.overflow = ''; } catch (_) {}
      const ids = Array.from(els.list.querySelectorAll('.task-item')).map(x => x.dataset.id);
      storage.setOrder(state.label, ids);
    }

    handle.addEventListener('pointerdown', (ev) => {
      if (isInteractive(ev.target)) return;
      startX = ev.clientX || 0;
      startY = ev.clientY || 0;
      lastX = startX; lastY = startY;
      // Start long-press timer; only then we begin dragging
      pressTimer = setTimeout(() => { beginDrag(); }, LONG_PRESS_MS);
      // Listen for movement/up; initially keep move passive to allow scroll
      document.addEventListener('pointermove', onPointerMove, { passive: true });
      document.addEventListener('pointerup', onPointerUp);
    });

    // Touch fallbacks to ensure updates on iOS Safari
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
    handle.addEventListener('touchstart', (ev) => {
      if (isInteractive(ev.target)) return;
      const t = (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]);
      if (!t) return;
      startX = t.clientX || 0;
      startY = t.clientY || 0;
      lastX = startX; lastY = startY;
      pressTimer = setTimeout(() => { beginDrag(); }, LONG_PRESS_MS);
      document.addEventListener('touchmove', onTouchMove, { passive: true });
      document.addEventListener('touchend', onTouchEnd);
    });

    frag.appendChild(li);
  }
  els.list.appendChild(frag);
}

function sortByLocalOrder(tasks, label) {
  const order = storage.getOrder(label).map(String);
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
  state.label = storage.getLabel();
  els.token.value = state.token;
  els.label.value = state.label;
  setTitle(state.label);

  // Only require a label. If no token is provided, we use the proxy.
  if (!state.label) {
    showSettings(true);
    return;
  }
  try {
    const [tasks, projects] = await Promise.all([
      getTasksByLabel(state.label, state.token),
      getProjects(state.token).catch(() => []),
    ]);
    // Build projects map id -> name
    state.projects = new Map((projects || []).map(p => [String(p.id), p.name]));
    state.tasks = sortByLocalOrder(tasks, state.label);
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
  const label = els.label.value.trim();
  storage.setToken(token);
  storage.setLabel(label);
  setTitle(label);
  toast('Einstellungen gespeichert.');
});

els.loadList.addEventListener('click', () => {
  showSettings(false);
  load();
});

els.refresh.addEventListener('click', () => load());

if (els.updateApp) {
  els.updateApp.addEventListener('click', () => updateAppNow());
}

// Open current label directly in Todoist (web)
if (els.openTodoistLabel) {
  els.openTodoistLabel.addEventListener('click', () => {
    const raw = (state.label || storage.getLabel() || '').trim();
    if (!raw) { showSettings(true); return; }
    const query = raw.startsWith('@') ? raw : `@${raw}`;

    const desktopUrl = `todoist://app/search/${encodeURIComponent(query)}`;
    const webUrl = `https://todoist.com/app/search/${encodeURIComponent(query)}`;

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
  const payload = { content, labels: [state.label] };
  try {
    const created = await createTask(payload, state.token);
    state.tasks.push(created);
    const ids = Array.from(els.list.querySelectorAll('.task-item')).map(x => x.dataset.id);
    ids.push(String(created.id));
    storage.setOrder(state.label, ids);
    renderTasks(state.tasks);
    els.newTaskContent.value = '';
  } catch (err) {
    toast(err.message);
  }
});

// Start
load();
