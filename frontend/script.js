// ── Configuración ──────────────────────────────────────
const BACKEND = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : `http://${window.location.hostname}:3000`;
const WS_URL  = BACKEND.replace('http', 'ws') + '/terminal';

// ── Catálogo: qué apps van en qué sección ─────────────
const APP_SECTIONS = {
  'apps-web':  ['firefox', 'burpsuite', 'zaproxy'],
  'apps-net':  ['wireshark', 'zenmap', 'ettercap'],
  'apps-pass': ['hydra', 'johnny'],
  'apps-other':['autopsy', 'fern', 'ghidra', 'terminal', 'files'],
};

// ── Estado ─────────────────────────────────────────────
let term, fitAddon, ws, statusInterval, guiOpen = false;
let appStatus = {};  // { wireshark: true, burpsuite: false, ... }

// ─────────────────────────────────────────────────────
//  xterm.js — iniciar terminal
// ─────────────────────────────────────────────────────
function initTerminal() {
  term = new Terminal({
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

  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon.WebLinksAddon());
  term.open(document.getElementById('terminal'));
  fitAddon.fit();

  // Reajustar cuando cambie el tamaño de ventana
  const ro = new ResizeObserver(() => {
    fitAddon.fit();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  });
  ro.observe(document.getElementById('terminal'));

  // Registrar onData UNA SOLA VEZ aquí.
  // connectTerminal() puede llamarse múltiples veces (reconexión), por eso
  // NO debe registrar onData — de lo contrario los listeners se acumulan
  // y cada tecla se envía N veces al backend (bug de caracteres duplicados).
  term.onData(data => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
  });

  connectTerminal();
}

// ─────────────────────────────────────────────────────
//  WebSocket — conectar con bash en Kali
// ─────────────────────────────────────────────────────
function connectTerminal() {
  if (ws) { ws.onclose = null; ws.close(); }
  setWsStatus('connecting...', false);

  ws = new WebSocket(WS_URL);
  //ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    setWsStatus('connected', true);
    term.clear();
    // Mandar tamaño inicial
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  };

  ws.onmessage = e => {
    /*const data = e.data instanceof ArrayBuffer
      ? new Uint8Array(e.data)
      : e.data;*/
    term.write(e.data);
  };

  ws.onclose = () => {
    setWsStatus('offline', false);
    term.write('\r\n\x1b[31m[connection closed — press "reconnect"]\x1b[0m\r\n');
  };

  ws.onerror = () => {
    setWsStatus('error', false);
  };
}

function setWsStatus(text, connected) {
  const el = document.getElementById('ws-label');
  el.textContent = text;
  el.className = 'ws-status' + (connected ? ' conn' : '');
}

// ─────────────────────────────────────────────────────
//  Panel noVNC (visor de apps GUI)
// ─────────────────────────────────────────────────────
function toggleGUI() {
  guiOpen = !guiOpen;
  document.getElementById('gui-panel').classList.toggle('open', guiOpen);
  document.getElementById('btn-gui').classList.toggle('active', guiOpen);
  // Reajustar terminal tras la animación
  setTimeout(() => fitAddon && fitAddon.fit(), 380);
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

    // Rellenar cada sección
    for (const [containerId, ids] of Object.entries(APP_SECTIONS)) {
      const container = document.getElementById(containerId);
      if (!container) continue;
      ids.forEach(id => {
        const app = byId[id];
        if (!app) return;
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
        container.appendChild(btn);
      });
    }
  } catch {
    // Backend aún no disponible, reintentar en 2s
    setTimeout(renderAppButtons, 2000);
  }
}

// ─────────────────────────────────────────────────────
//  Arranque
// ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTerminal();
  renderAppButtons();
  healthCheck();
  refreshStatus();
  // Polling
  setInterval(healthCheck,   10_000);
  setInterval(refreshStatus,  5_000);
});
