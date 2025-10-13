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

let state = {
  tasks: [],
  label: '',
  token: '',
  drag: { srcEl: null, srcId: null },
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

// API helpers
async function api(path, { method = 'GET', token, body } = {}) {
  const usingProxy = !token;
  const headers = usingProxy
    ? { 'Content-Type': 'application/json' }
    : { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  const url = (usingProxy ? `${PROXY_BASE}${path}` : `${API_BASE}${path}`);
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
    const prioRead = li.querySelector('.task-priority-read');
    const openBtn = li.querySelector('.open-todoist');

    contentEl.textContent = t.content || '';
    const dueText = (t.due && (t.due.string || t.due.date)) || '';
    dueRead.textContent = dueText ? dueText : '';
    const apiPrio = Number(t.priority || 1);
    // Map Todoist API priority -> UI P1..P4
    // API: 4=highest,3,2,1=lowest;
    // UI: P1=highest (red) ... P4=lowest (gray)
    const uiPrio = apiPrio === 4 ? 1 : apiPrio === 3 ? 2 : apiPrio === 2 ? 3 : 4;
    prioRead.textContent = `P${uiPrio}`;
    li.classList.add(`prio-${uiPrio}`);

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

    // Open Todoist's own edit UI for this task (due date etc.)
    openBtn.addEventListener('click', () => {
      const taskUrl = t.url || `https://todoist.com/app/task/${t.id}`;
      try { window.open(taskUrl, '_blank', 'noopener'); } catch (_) { location.href = taskUrl; }
    });

    // Drag & drop events (desktop)
    function isInteractive(el) {
      return (
        el.isContentEditable ||
        ['INPUT','SELECT','BUTTON','TEXTAREA','OPTION'].includes(el.tagName)
      );
    }

    li.addEventListener('dragstart', (e) => {
      if (isInteractive(e.target)) { e.preventDefault(); return; }
      li.classList.add('dragging');
      state.drag.srcEl = li;
      state.drag.srcId = t.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.id);
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      state.drag.srcEl = null;
      state.drag.srcId = null;
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const over = e.currentTarget;
      if (over === state.drag.srcEl) return;
      const list = els.list;
      const rect = over.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      if (before) list.insertBefore(state.drag.srcEl, over);
      else list.insertBefore(state.drag.srcEl, over.nextSibling);
    });
    li.addEventListener('drop', () => {
      // Persist new order
      const ids = Array.from(els.list.querySelectorAll('.task-item')).map(x => x.dataset.id);
      storage.setOrder(state.label, ids);
    });

    // Touch-friendly reorder (pointer events fallback)
    const handle = li.querySelector('.drag-handle') || li;
    let pointerDragging = false;
    function onPointerMove(ev) {
      if (!pointerDragging) return;
      const overEl = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!overEl) return;
      const overItem = overEl.closest && overEl.closest('.task-item');
      if (!overItem || overItem === state.drag.srcEl) return;
      const rect = overItem.getBoundingClientRect();
      const before = (ev.clientY - rect.top) < rect.height / 2;
      if (before) els.list.insertBefore(state.drag.srcEl, overItem);
      else els.list.insertBefore(state.drag.srcEl, overItem.nextSibling);
    }
    function onPointerUp() {
      if (!pointerDragging) return;
      pointerDragging = false;
      if (state.drag.srcEl) state.drag.srcEl.classList.remove('dragging');
      state.drag.srcEl = null;
      state.drag.srcId = null;
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      const ids = Array.from(els.list.querySelectorAll('.task-item')).map(x => x.dataset.id);
      storage.setOrder(state.label, ids);
    }
    handle.addEventListener('pointerdown', (ev) => {
      if (isInteractive(ev.target)) return;
      pointerDragging = true;
      li.classList.add('dragging');
      state.drag.srcEl = li;
      state.drag.srcId = t.id;
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
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
    const tasks = await getTasksByLabel(state.label, state.token);
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
