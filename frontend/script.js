// ── Configuración ──────────────────────────────────────
const BACKEND = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : `http://${window.location.hostname}:3000`;
const WS_URL  = BACKEND.replace('http', 'ws') + '/terminal';

// ── Catálogo: qué apps van en cada zona de la sidebar ──
const QUICK_APPS = ['firefox', 'files'];
const TOOL_APPS   = ['burpsuite', 'zaproxy', 'wireshark', 'zenmap', 'ettercap', 'hydra', 'johnny', 'autopsy', 'fern', 'ghidra', 'terminal'];

// ── Estado ─────────────────────────────────────────────
let guiOpen = false;
let appStatus = {};  // { wireshark: true, burpsuite: false, ... }
let currentTarget = null; // { host, ip }

// ── Pestañas de terminal ───────────────────────────────
let tabs = [];          // [{ id, term, fitAddon, ws, container, ro, label, wsConnected, wsStatusText }]
let activeTabId = null;
let tabCounter = 0;

// ─────────────────────────────────────────────────────
//  xterm.js — gestor de pestañas
//
//  Cada pestaña tiene su propia instancia de Terminal,
//  su propio WebSocket y su propio contenedor DOM. Solo
//  el panel de la pestaña activa se muestra; el resto
//  sigue corriendo en segundo plano.
// ─────────────────────────────────────────────────────

function initTerminals() {
  createTab();
}

function getActiveTab() {
  return tabs.find(t => t.id === activeTabId);
}

// Mantiene los nombres "shell N" consecutivos según la posición actual
// de cada pestaña, sin importar el id interno con el que se creó.
// Las pestañas con nombre personalizado (editado por el usuario) no se tocan.
function renumberTabs() {
  let n = 0;
  tabs.forEach(t => {
    n++;
    if (!t.customName) t.label = `shell ${n}`;
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function createTab() {
  tabCounter++;
  const id = `tab-${tabCounter}`;

  const container = document.createElement('div');
  container.className = 'terminal-pane';
  container.id = id;
  document.getElementById('terminal-panes').appendChild(container);

  const term = new Terminal({
    theme: {
      background:  '#0d0f14',
      foreground:  '#c8cdd8',
      cursor:      '#00ff88',
      cursorAccent:'#0d0f14',
      selectionBackground: 'rgba(0,255,136,0.2)',
      black:   '#1a1d24', brightBlack:   '#555c6e',
      red:     '#ff4757', brightRed:     '#ff6b81',
      green:   '#00ff88', brightGreen:   '#2ed573',
      yellow:  '#ffa502', brightYellow:  '#eccc68',
      blue:    '#378ADD', brightBlue:    '#70a1ff',
      magenta: '#D4537E', brightMagenta: '#ff6b9d',
      cyan:    '#1D9E75', brightCyan:    '#5DCAA5',
      white:   '#c8cdd8', brightWhite:   '#e8ecf4',
    },
    fontFamily: "'JetBrains Mono', monospace",
    fontSize:   14,
    lineHeight: 1.4,
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback:  5000,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon.WebLinksAddon());
  term.open(container);

  const tabObj = {
    id, term, fitAddon, container,
    ws: null,
    label: `shell ${tabCounter}`,
    wsConnected: false,
    wsStatusText: 'desconectado',
    editing: false,
    customName: false,
  };
  tabs.push(tabObj);

  term.onData(data => {
    if (tabObj.ws && tabObj.ws.readyState === WebSocket.OPEN) tabObj.ws.send(data);
  });

  const ro = new ResizeObserver(() => {
    if (tabObj.id === activeTabId) {
      fitAddon.fit();
      sendResize(tabObj);
    }
  });
  ro.observe(container);
  tabObj.ro = ro;

  renumberTabs();
  renderTabsBar();
  switchTab(id);
  connectTab(tabObj);

  return tabObj;
}

function switchTab(id) {
  activeTabId = id;
  tabs.forEach(t => t.container.classList.toggle('active', t.id === id));
  renderTabsBar();

  const t = getActiveTab();
  if (t) {
    setTimeout(() => {
      t.fitAddon.fit();
      sendResize(t);
      t.term.focus();
    }, 0);
  }
  updateWsLabelForActive();
}

function closeTab(id, e) {
  if (e) e.stopPropagation();
  if (tabs.length <= 1) return; // siempre debe quedar al menos una pestaña

  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  const t = tabs[idx];
  if (t.ws) { t.ws.onclose = null; t.ws.close(); }
  t.ro && t.ro.disconnect();
  t.term.dispose();
  t.container.remove();
  tabs.splice(idx, 1);
  renumberTabs();

  if (activeTabId === id) {
    const next = tabs[Math.max(0, idx - 1)];
    switchTab(next.id);
  } else {
    renderTabsBar();
  }
}

function renderTabsBar() {
  const bar = document.getElementById('tabs-bar');
  bar.innerHTML = '';
  tabs.forEach(t => {
    const el = document.createElement('div');
    el.className = 'tab-item' + (t.id === activeTabId ? ' active' : '');
    el.onclick = () => switchTab(t.id);
    el.oncontextmenu = (e) => { e.preventDefault(); openTabContextMenu(e, t.id); };

    const nameHtml = t.editing
      ? `<input
           class="tab-name-input"
           id="name-input-${t.id}"
           value="${escapeHtml(t.label)}"
           onclick="event.stopPropagation()"
           onkeydown="handleTabNameKeydown(event, '${t.id}')"
           onblur="commitTabName('${t.id}', this.value)"
         />`
      : `<span class="tab-name">${escapeHtml(t.label)}</span>`;

    el.innerHTML = `
      ${nameHtml}
      ${tabs.length > 1 ? `<button class="tab-close" title="Close tab" onclick="closeTab('${t.id}', event)">×</button>` : ''}
    `;
    bar.appendChild(el);
  });

  // Si una pestaña entró en modo edición, enfocar su input
  const editingTab = tabs.find(t => t.editing);
  if (editingTab) {
    setTimeout(() => {
      const input = document.getElementById(`name-input-${editingTab.id}`);
      if (input) { input.focus(); input.select(); }
    }, 0);
  }
}

// ─────────────────────────────────────────────────────
//  Menú contextual de pestañas (clic derecho)
// ─────────────────────────────────────────────────────
let contextMenuTabId = null;

function openTabContextMenu(e, tabId) {
  contextMenuTabId = tabId;
  const menu = document.getElementById('tab-context-menu');
  menu.style.left = `${e.clientX}px`;
  menu.style.top  = `${e.clientY}px`;
  menu.classList.add('open');
}

function closeTabContextMenu() {
  document.getElementById('tab-context-menu').classList.remove('open');
  contextMenuTabId = null;
}

function startEditTabName() {
  const tabId = contextMenuTabId;
  closeTabContextMenu();
  const t = tabs.find(x => x.id === tabId);
  if (!t) return;
  t.editing = true;
  renderTabsBar();
}

function commitTabName(tabId, value) {
  const t = tabs.find(x => x.id === tabId);
  if (!t) return;
  const trimmed = (value || '').trim();
  if (trimmed) {
    t.label = trimmed;
    t.customName = true;
  }
  t.editing = false;
  renderTabsBar();
}

function handleTabNameKeydown(e, tabId) {
  if (e.key === 'Enter') {
    e.target.blur(); // dispara commitTabName vía onblur
  } else if (e.key === 'Escape') {
    const t = tabs.find(x => x.id === tabId);
    if (t) t.editing = false;
    renderTabsBar();
  }
}

// ─────────────────────────────────────────────────────
//  WebSocket — conectar con bash en Kali (por pestaña)
// ─────────────────────────────────────────────────────
function connectTab(t) {
  if (t.ws) { t.ws.onclose = null; t.ws.close(); }
  setTabWsStatus(t, 'connecting...', false);

  t.ws = new WebSocket(WS_URL);

  t.ws.onopen = () => {
    setTabWsStatus(t, 'connected', true);
    t.term.clear();
    sendResize(t);
  };

  t.ws.onmessage = e => {
    t.term.write(e.data);
  };

  t.ws.onclose = () => {
    setTabWsStatus(t, 'offline', false);
    t.term.write('\r\n\x1b[31m[connection closed — press "reconnect"]\x1b[0m\r\n');
  };

  t.ws.onerror = () => {
    setTabWsStatus(t, 'error', false);
  };
}

function reconnectActiveTab() {
  const t = getActiveTab();
  if (t) connectTab(t);
}

function sendResize(t) {
  if (t.ws && t.ws.readyState === WebSocket.OPEN) {
    t.ws.send(JSON.stringify({ type: 'resize', cols: t.term.cols, rows: t.term.rows }));
  }
}

function setTabWsStatus(t, text, connected) {
  t.wsStatusText = text;
  t.wsConnected  = connected;
  if (t.id === activeTabId) updateWsLabelForActive();
}

function updateWsLabelForActive() {
  const t  = getActiveTab();
  const el = document.getElementById('ws-label');
  if (!t || !el) return;
  el.textContent = t.wsStatusText;
  el.className = 'ws-status' + (t.wsConnected ? ' conn' : '');
}

// ─────────────────────────────────────────────────────
//  Panel noVNC (visor de apps GUI)
// ─────────────────────────────────────────────────────
function toggleGUI() {
  guiOpen = !guiOpen;
  document.getElementById('gui-panel').classList.toggle('open', guiOpen);
  document.getElementById('btn-gui').classList.toggle('active', guiOpen);
}

// ─────────────────────────────────────────────────────
//  Lanzador de apps
// ─────────────────────────────────────────────────────
async function launchApp(appId) {
  try {
    const r = await fetch(`${BACKEND}/api/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: appId }),
    });
    const data = await r.json();
    if (data.ok) {
      showToast(`Launching ${data.label}...`);
      // Abrir el visor GUI automáticamente si estaba cerrado
      if (!guiOpen) toggleGUI();
      // Forzar refresh de estado tras 1.5s para que el pulso aparezca
      setTimeout(refreshStatus, 1500);
    } else {
      showToast(data.error || 'Unknown error', true);
    }
  } catch {
    showToast('The backend cannot be contacted', true);
  }
}

async function killApp(appId, e) {
  e.stopPropagation();
  try {
    await fetch(`${BACKEND}/api/kill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: appId }),
    });
    showToast('App stopped');
    setTimeout(refreshStatus, 800);
  } catch {
    showToast('Error stopping the app', true);
  }
}

// ─────────────────────────────────────────────────────
//  Estado de apps (polling cada 5s)
// ─────────────────────────────────────────────────────
async function refreshStatus() {
  try {
    const r = await fetch(`${BACKEND}/api/status`);
    appStatus = await r.json();
    updateAppButtons();
  } catch { /* backend no responde aún */ }
}

function updateAppButtons() {
  document.querySelectorAll('.app-btn').forEach(btn => {
    const id = btn.dataset.app;
    btn.classList.toggle('running', !!appStatus[id]);
  });
}

// ─────────────────────────────────────────────────────
//  Health check — indicador Kali vivo/muerto
// ─────────────────────────────────────────────────────
async function healthCheck() {
  const dot  = document.getElementById('kali-dot');
  const label= document.getElementById('kali-status');
  try {
    const r    = await fetch(`${BACKEND}/api/health`);
    const data = await r.json();
    const alive = data.kali === 'running';
    dot.className  = 'dot ' + (alive ? 'alive' : 'dead');
    label.textContent = alive ? `${data.name} — running` : 'forge-kali — stopped';
  } catch {
    dot.className = 'dot dead';
    label.textContent = 'backend — unresponsive';
  }
}

// ─────────────────────────────────────────────────────
//  Toast
// ─────────────────────────────────────────────────────
let toastTimeout;
function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { el.className = ''; }, 3000);
}

// ─────────────────────────────────────────────────────
//  Renderizar botones de apps desde la API
// ─────────────────────────────────────────────────────
async function renderAppButtons() {
  try {
    const r    = await fetch(`${BACKEND}/api/apps`);
    const apps = await r.json();

    // Índice id → definición
    const byId = {};
    apps.forEach(a => { byId[a.id] = a; });

    const buildBtn = (id) => {
      const app = byId[id];
      if (!app) return null;
      const btn = document.createElement('button');
      btn.className   = 'app-btn';
      btn.dataset.app = id;
      btn.onclick     = () => launchApp(id);
      btn.innerHTML   = `
        <span class="app-icon">${app.icon}</span>
        <span class="app-name">${app.label}</span>
        <span class="pulse"></span>
        <button class="kill-btn" title="Kill" onclick="killApp('${id}', event)">×</button>
      `;
      return btn;
    };

    const quickContainer = document.getElementById('apps-quick');
    if (quickContainer) {
      QUICK_APPS.forEach(id => {
        const btn = buildBtn(id);
        if (btn) quickContainer.appendChild(btn);
      });
    }

    const toolsContainer = document.getElementById('apps-tools');
    if (toolsContainer) {
      TOOL_APPS.forEach(id => {
        const btn = buildBtn(id);
        if (btn) toolsContainer.appendChild(btn);
      });
    }
  } catch {
    // Backend aún no disponible, reintentar en 2s
    setTimeout(renderAppButtons, 2000);
  }
}

// ─────────────────────────────────────────────────────
//  Droplist de tools
// ─────────────────────────────────────────────────────
function toggleToolsDropdown() {
  document.getElementById('apps-tools').classList.toggle('open');
  document.getElementById('tools-dropdown-btn').classList.toggle('open');
}

// ─────────────────────────────────────────────────────
//  SET TARGET
// ─────────────────────────────────────────────────────
function onTargetButtonClick() {
  // Si ya hay target, el botón no abre el modal (el × lo limpia)
  if (currentTarget) return;
  openTargetModal();
}
 
function openTargetModal() {
  document.getElementById('target-host-input').value = '';
  document.getElementById('target-ip-input').value = '';
  document.getElementById('target-modal-backdrop').classList.add('open');
  setTimeout(() => document.getElementById('target-host-input').focus(), 50);
}
 
function closeTargetModal() {
  document.getElementById('target-modal-backdrop').classList.remove('open');
}
 
function acceptTarget() {
  const host = document.getElementById('target-host-input').value.trim();
  const ip   = document.getElementById('target-ip-input').value.trim();
 
  if (!host || !ip) {
    showToast('Hostname and IP are required', true);
    return;
  }
 
  currentTarget = { host, ip };
  renderTargetButton();
  closeTargetModal();
  showToast(`Target set: ${host} (${ip})`);
}
 
function clearTarget(e) {
  if (e) e.stopPropagation();
  currentTarget = null;
  renderTargetButton();
  showToast('Target cleared');
}
 
function copyTargetIp(e) {
  e.stopPropagation();
  if (!currentTarget) return;
  navigator.clipboard.writeText(currentTarget.ip)
    .then(() => showToast('IP copied to clipboard'))
    .catch(() => showToast('Could not copy IP', true));
}
 
function renderTargetButton() {
  const btn = document.getElementById('btn-target');
 
  if (!currentTarget) {
    btn.classList.remove('has-target');
    btn.innerHTML = '[ SET TARGET ]';
    btn.title = 'Set target';
    return;
  }
 
  btn.classList.add('has-target');
  btn.title = '';
  btn.innerHTML = `
    <span class="target-host">${escapeHtml(currentTarget.host)}</span>
    <span class="target-sep">//</span>
    <span class="target-ip" onclick="copyTargetIp(event)" title="Click to copy">
      <span class="ip-value">${escapeHtml(currentTarget.ip)}</span>
      <span class="ip-copy-label">copy ip</span>
    </span>
    <button class="target-clear" onclick="clearTarget(event)" title="Clear target">×</button>
  `;
}

// ─────────────────────────────────────────────────────
//  Arranque
// ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTerminals();
  renderAppButtons();
  healthCheck();
  refreshStatus();
  renderTargetButton();
  // Polling
  setInterval(healthCheck,   10_000);
  setInterval(refreshStatus,  5_000);

  // Cerrar el modal con Escape / aceptar con Enter
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeTargetModal();
      closeTabContextMenu();
    }
    if (e.key === 'Enter' && document.getElementById('target-modal-backdrop').classList.contains('open')) {
      acceptTarget();
    }
  });

  // Cerrar el menú contextual de pestañas al hacer clic fuera o hacer scroll
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('tab-context-menu');
    if (menu.classList.contains('open') && !menu.contains(e.target)) {
      closeTabContextMenu();
    }
  });
  document.addEventListener('scroll', closeTabContextMenu, true);
});
