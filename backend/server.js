'use strict';

// ─────────────────────────────────────────────────────────────
//  server.js — Backend del Panel de Hacking
//
//  Responsabilidades:
//    1. Servir el WebSocket que conecta xterm.js con bash en Kali
//    2. API REST para lanzar / matar apps GUI en el contenedor
//    3. API de estado: qué apps están corriendo
// ─────────────────────────────────────────────────────────────

const pty = require('node-pty');

const express    = require('express');
const cors       = require('cors');
const http       = require('http');
const { WebSocketServer } = require('ws');
const Docker     = require('dockerode');

const app    = express();
const server = http.createServer(app);
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// ── Nombre del contenedor Kali ────────────────────────────────
const KALI_CONTAINER = process.env.KALI_CONTAINER || 'forge-kali';
const PORT           = process.env.PORT            || 3000;

// ─────────────────────────────────────────────────────────────
//  Catálogo de aplicaciones lanzables
//  Cada entrada define el comando que se ejecuta en Kali con
//  DISPLAY=:1 para que la ventana aparezca en el VNC/noVNC.
// ─────────────────────────────────────────────────────────────
const APPS = {
  firefox:    { label: 'Firefox',         cmd: 'firefox',                        icon: '🦊' },
  burpsuite:  { label: 'Burp Suite',      cmd: 'burpsuite',                      icon: '🔥' },
  wireshark:  { label: 'Wireshark',       cmd: 'wireshark',                      icon: '🦈' },
  zaproxy:    { label: 'OWASP ZAP',       cmd: 'zaproxy',                        icon: '⚡' },
  zenmap:     { label: 'Zenmap',          cmd: 'zenmap',                         icon: '🗺️'  },
  hydra:      { label: 'xHydra',         cmd: 'xhydra',                         icon: '💧' },
  johnny:     { label: 'Johnny (JtR)',    cmd: 'johnny',                         icon: '🔑' },
  autopsy:    { label: 'Autopsy',         cmd: 'autopsy',                        icon: '🔍' },
  fern:       { label: 'Fern WiFi',       cmd: 'fern-wifi-cracker',              icon: '📡' },
  ettercap:   { label: 'Ettercap',        cmd: 'ettercap -G',                    icon: '🕸️'  },
  terminal:   { label: 'Terminal Xfce',   cmd: 'xfce4-terminal',                 icon: '🖥️'  },
  files:      { label: 'Gestor archivos', cmd: 'thunar',                         icon: '📁' },
};

// ─────────────────────────────────────────────────────────────
//  Middleware
// ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────
//  Utilidad: ejecutar un comando en el contenedor Kali
//  Devuelve la salida como string.
// ─────────────────────────────────────────────────────────────
async function execInKali(cmdArray, opts = {}) {
  const container = docker.getContainer(KALI_CONTAINER);
  const exec = await container.exec({
    Cmd: cmdArray,
    AttachStdout: true,
    AttachStderr: true,
    User: opts.user || 'hacker',
    Env: ['DISPLAY=:1', 'HOME=/home/hacker', ...(opts.env || [])],
    ...opts,
  });
  const stream = await exec.start({ Detach: opts.detach || false });
  if (opts.detach) return { ok: true };

  return new Promise((resolve, reject) => {
    let output = '';
    stream.on('data', chunk => { output += chunk.toString(); });
    stream.on('end',  () => resolve(output.trim()));
    stream.on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────
//  API REST
// ─────────────────────────────────────────────────────────────

// GET /api/apps — lista el catálogo de apps disponibles
app.get('/api/apps', (_req, res) => {
  res.json(
    Object.entries(APPS).map(([id, info]) => ({ id, ...info }))
  );
});

// POST /api/launch  { app: "wireshark" }
// Lanza la app en el DISPLAY :1 del contenedor (aparece en noVNC)
app.post('/api/launch', async (req, res) => {
  const { app: appId } = req.body;
  const appDef = APPS[appId];

  if (!appDef) {
    return res.status(400).json({ error: `App desconocida: "${appId}"` });
  }

  try {
    // Lanzar en background con nohup para que sobreviva al exec
    const shellCmd = `nohup ${appDef.cmd} >/tmp/${appId}.log 2>&1 &`;
    await execInKali(['bash', '-c', shellCmd], { detach: true });

    console.log(`[+] App lanzada: ${appDef.label} (${appDef.cmd})`);
    res.json({ ok: true, app: appId, label: appDef.label });
  } catch (err) {
    console.error(`[!] Error lanzando ${appId}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kill  { app: "wireshark" }
// Mata el proceso de una app por nombre
app.post('/api/kill', async (req, res) => {
  const { app: appId } = req.body;
  const appDef = APPS[appId];
  if (!appDef) return res.status(400).json({ error: 'App desconocida' });

  try {
    const procName = appDef.cmd.split(' ')[0]; // "ettercap -G" → "ettercap"
    await execInKali(['bash', '-c', `pkill -f "${procName}" || true`], { detach: true });
    console.log(`[-] App detenida: ${appDef.label}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/status — devuelve qué apps están corriendo
app.get('/api/status', async (_req, res) => {
  try {
    const running = {};
    for (const [id, def] of Object.entries(APPS)) {
      const procName = def.cmd.split(' ')[0];
      const out = await execInKali(
        ['bash', '-c', `pgrep -x "${procName}" > /dev/null && echo yes || echo no`]
      );
      running[id] = out.includes('yes');
    }
    res.json(running);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/health — el frontend puede hacer ping para saber si el backend vive
app.get('/api/health', async (_req, res) => {
  try {
    const container = docker.getContainer(KALI_CONTAINER);
    const info = await container.inspect();
    res.json({
      backend: 'ok',
      kali:    info.State.Running ? 'running' : 'stopped',
      name:    info.Name.replace('/', ''),
    });
  } catch (err) {
    res.status(503).json({ backend: 'ok', kali: 'unreachable', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  WebSocket — Terminal interactiva (xterm.js ↔ bash en Kali)
//
//  Flujo:
//    1. Cliente abre ws://localhost:3000
//    2. Backend abre un exec con TTY en el contenedor Kali
//    3. Todo lo que escribe el usuario va al stream del exec
//    4. Todo lo que devuelve el exec va al cliente (xterm.js lo pinta)
//
//  El flag Tty:true es lo que hace que el shell sea interactivo
//  (colores, autocompletado, Ctrl+C, vim, etc.)
// ─────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/terminal' });

wss.on('connection', (ws) => {
  console.log('[WS] Nueva terminal');

  const shell = pty.spawn(

    'sshpass',
    [
      '-p',
      'hacker',
      'ssh',
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-o',
      'LogLevel=ERROR',
      'hacker@kali'
    ],

    {
      name:'xterm-256color',
      cols:80,
      rows:24,
      cwd:'/',
      env:{
        ...process.env,
        TERM:'xterm-256color'
      }
    }
  );

  shell.onData(data=>{

    if(ws.readyState===ws.OPEN){

      ws.send(data);

    }

  });

  ws.on('message',raw=>{

    const data=raw.toString();

    try{

      const msg=JSON.parse(data);

      if(msg.type==='resize'){
        if(msg.cols > 0 && msg.rows > 0){
          shell.resize(
            msg.cols,
            msg.rows
          );
        }
        return;
      }

    }catch{}

    shell.write(data);

  });

  ws.on('close',()=>{

    shell.kill();

  });
});

// ─────────────────────────────────────────────────────────────
//  Arrancar servidor
// ─────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   Forge — Backend                  ║
╠══════════════════════════════════════════╣
║  HTTP  → http://localhost:${PORT}           ║
║  WS    → ws://localhost:${PORT}/terminal    ║
║  Kali  → contenedor "${KALI_CONTAINER}"     ║
╚══════════════════════════════════════════╝
  `);
});
