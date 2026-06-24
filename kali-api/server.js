'use strict';

// ─────────────────────────────────────────────────────────────
//  kali-api/server.js — API de ejecución segura de herramientas
//
//  Responsabilidades:
//    1. Ejecutar herramientas de pentesting / CTF dentro de Kali
//    2. Gestionar jobs en background para scans largos
//    3. Aplicar whitelist estricta de herramientas permitidas
//
//  Diseñado para ser consumido por el servidor MCP de Forge.
//  Los comandos se ejecutan como arrays (sin bash -c) para
//  prevenir inyección de comandos por diseño.
// ─────────────────────────────────────────────────────────────

const express      = require('express');
const cors         = require('cors');
const Docker       = require('dockerode');
const { PassThrough } = require('stream');
const crypto       = require('crypto');

const app    = express();
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// ── Configuración ────────────────────────────────────────────
const KALI_CONTAINER   = process.env.KALI_CONTAINER || 'forge-kali';
const PORT             = process.env.PORT           || 4000;
const KALI_USER        = process.env.KALI_USER      || 'hacker';
const DEFAULT_TIMEOUT  = 300;               // 5 minutos (segundos)
const MAX_TIMEOUT      = 600;               // 10 minutos (segundos)
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;   // 5 MB por stream
const JOB_TTL_MS       = 60 * 60 * 1000;    // 1 hora de retención

// ─────────────────────────────────────────────────────────────
//  Catálogo de herramientas permitidas
//
//  Solo las herramientas listadas aquí pueden ejecutarse.
//  Están agrupadas por categoría para documentación y para
//  el endpoint GET /api/v1/tools.
// ─────────────────────────────────────────────────────────────
const TOOL_CATEGORIES = {
  recon: {
    label: 'Reconocimiento',
    tools: [
      'nmap', 'masscan', 'arp-scan', 'whatweb',
      'whois', 'dig', 'host', 'dnsrecon', 'dnsenum',
      'ping', 'traceroute',
    ],
  },
  web: {
    label: 'Web Hacking',
    tools: [
      'sqlmap', 'nikto', 'dirb', 'gobuster',
      'ffuf', 'wfuzz', 'curl', 'wget',
    ],
  },
  bruteforce: {
    label: 'Fuerza bruta',
    tools: ['hydra', 'john', 'hashcat', 'crunch'],
  },
  exploit: {
    label: 'Explotación',
    tools: ['msfconsole', 'msfvenom', 'searchsploit'],
  },
  network: {
    label: 'Red',
    tools: ['netcat', 'ncat', 'nc', 'tcpdump', 'responder', 'netexec'],
  },
  forensics: {
    label: 'Forense / CTF',
    tools: [
      'binwalk', 'foremost', 'exiftool', 'steghide',
      'strings', 'file', 'xxd', 'base64',
    ],
  },
  wireless: {
    label: 'Wireless',
    tools: ['aircrack-ng', 'airodump-ng', 'aireplay-ng'],
  },
  utils: {
    label: 'Utilidades',
    tools: [
      'cat', 'grep', 'find', 'ls', 'head', 'tail',
      'wc', 'sort', 'uniq', 'awk', 'sed', 'tr', 'cut',
      'echo', 'pwd', 'id', 'whoami', 'uname', 'hostname',
    ],
  },
};

// Set plano para búsqueda O(1)
const ALLOWED_TOOLS = new Set(
  Object.values(TOOL_CATEGORIES).flatMap(c => c.tools)
);

// ─────────────────────────────────────────────────────────────
//  Almacén de jobs en background
// ─────────────────────────────────────────────────────────────
const jobs = new Map();

// Limpieza periódica: eliminar jobs finalizados con más de 1 hora
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && (now - job.finishedAt) > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000);

// ─────────────────────────────────────────────────────────────
//  Middleware
// ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────
//  Validación
// ─────────────────────────────────────────────────────────────

function validateTool(tool) {
  if (!tool || typeof tool !== 'string') {
    return { valid: false, error: 'El campo "tool" es requerido y debe ser un string.' };
  }
  if (!ALLOWED_TOOLS.has(tool)) {
    return {
      valid: false,
      error: `Herramienta no permitida: "${tool}". Usa GET /api/v1/tools para ver las disponibles.`,
    };
  }
  return { valid: true };
}

function validateArgs(args) {
  if (args === undefined) return { valid: true, args: [] };
  if (!Array.isArray(args)) {
    return { valid: false, error: 'El campo "args" debe ser un array de strings.' };
  }
  for (let i = 0; i < args.length; i++) {
    if (typeof args[i] !== 'string') {
      return { valid: false, error: `Argumento en índice ${i} no es un string.` };
    }
  }
  return { valid: true, args };
}

function clampTimeout(value) {
  const t = parseInt(value, 10);
  if (isNaN(t) || t <= 0)  return DEFAULT_TIMEOUT;
  if (t > MAX_TIMEOUT)     return MAX_TIMEOUT;
  return t;
}

// ─────────────────────────────────────────────────────────────
//  Utilidad: ejecutar un comando en el contenedor Kali
//
//  El comando se pasa como ARRAY (Cmd: [tool, ...args]).
//  Docker lo ejecuta con execve(), es decir, SIN shell.
//  Esto previene inyección de comandos por diseño:
//    "; rm -rf /" se trataría como un argumento literal.
//
//  La salida stdout/stderr se separa usando demuxStream
//  (requiere Tty: false).
// ─────────────────────────────────────────────────────────────
async function execInKali(cmdArray, { timeout = DEFAULT_TIMEOUT } = {}) {
  const container = docker.getContainer(KALI_CONTAINER);

  const exec = await container.exec({
    Cmd:          cmdArray,
    AttachStdout: true,
    AttachStderr: true,
    Tty:          false,
    User:         KALI_USER,
    Env:          [`HOME=/home/${KALI_USER}`],
  });

  const stream = await exec.start({ Detach: false });

  return new Promise((resolve, reject) => {
    let stdout    = '';
    let stderr    = '';
    let truncated = false;

    const outStream = new PassThrough();
    const errStream = new PassThrough();

    // Separar stdout y stderr del stream multiplexado de Docker
    docker.modem.demuxStream(stream, outStream, errStream);

    outStream.on('data', (chunk) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += chunk.toString('utf8');
      } else {
        truncated = true;
      }
    });

    errStream.on('data', (chunk) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += chunk.toString('utf8');
      } else {
        truncated = true;
      }
    });

    // Timeout de seguridad
    const timer = setTimeout(() => {
      stream.destroy();
      reject(new Error(`Timeout: el comando excedió ${timeout}s.`));
    }, timeout * 1000);

    stream.on('end', async () => {
      clearTimeout(timer);
      try {
        const info = await exec.inspect();
        resolve({
          stdout:   stdout.trim(),
          stderr:   stderr.trim(),
          exitCode: info.ExitCode,
          truncated,
        });
      } catch {
        resolve({
          stdout:   stdout.trim(),
          stderr:   stderr.trim(),
          exitCode: -1,
          truncated,
        });
      }
    });

    stream.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ─────────────────────────────────────────────────────────────
//  API REST — Endpoints
// ─────────────────────────────────────────────────────────────

// ── GET /api/v1/health ───────────────────────────────────────
// Estado del servicio y del contenedor Kali
app.get('/api/v1/health', async (_req, res) => {
  try {
    const container = docker.getContainer(KALI_CONTAINER);
    const info = await container.inspect();
    res.json({
      service:   'kali-api',
      status:    'ok',
      kali:      info.State.Running ? 'running' : 'stopped',
      container: info.Name.replace('/', ''),
      uptime:    process.uptime(),
      activeJobs: [...jobs.values()].filter(j => j.status === 'running').length,
    });
  } catch (err) {
    res.status(503).json({
      service: 'kali-api',
      status:  'degraded',
      kali:    'unreachable',
      error:   err.message,
    });
  }
});

// ── GET /api/v1/tools ────────────────────────────────────────
// Lista las herramientas permitidas agrupadas por categoría
app.get('/api/v1/tools', (_req, res) => {
  res.json({
    total: ALLOWED_TOOLS.size,
    categories: Object.entries(TOOL_CATEGORIES).map(([id, cat]) => ({
      id,
      label: cat.label,
      tools: cat.tools,
    })),
  });
});

// ── POST /api/v1/exec ────────────────────────────────────────
// Ejecuta una herramienta de forma síncrona (espera a que termine)
//
// Body:
//   { "tool": "nmap", "args": ["-sV", "10.10.10.1"], "timeout": 120 }
//
// Respuesta:
//   { "ok": true, "tool": "nmap", "exitCode": 0, "stdout": "...", ... }
app.post('/api/v1/exec', async (req, res) => {
  const { tool, args: rawArgs, timeout: rawTimeout } = req.body;

  // Validar herramienta
  const toolCheck = validateTool(tool);
  if (!toolCheck.valid) return res.status(400).json({ ok: false, error: toolCheck.error });

  // Validar argumentos
  const argsCheck = validateArgs(rawArgs);
  if (!argsCheck.valid) return res.status(400).json({ ok: false, error: argsCheck.error });

  const args    = argsCheck.args;
  const timeout = clampTimeout(rawTimeout);
  const started = Date.now();

  console.log(`[EXEC] ${tool} ${args.join(' ')} (timeout: ${timeout}s)`);

  try {
    const result = await execInKali([tool, ...args], { timeout });
    const durationMs = Date.now() - started;

    console.log(`[EXEC] ${tool} → exitCode=${result.exitCode} (${durationMs}ms)`);

    res.json({
      ok:         true,
      tool,
      args,
      exitCode:   result.exitCode,
      stdout:     result.stdout,
      stderr:     result.stderr,
      truncated:  result.truncated,
      durationMs,
      timestamp:  new Date().toISOString(),
    });
  } catch (err) {
    const durationMs = Date.now() - started;
    console.error(`[EXEC] ${tool} — ERROR: ${err.message} (${durationMs}ms)`);

    const isTimeout = err.message.includes('Timeout');
    res.status(isTimeout ? 408 : 500).json({
      ok:    false,
      tool,
      args,
      error: err.message,
      durationMs,
      timestamp: new Date().toISOString(),
    });
  }
});

// ── POST /api/v1/exec/background ─────────────────────────────
// Lanza una herramienta en background. Devuelve un jobId para
// consultar el estado/output después.
//
// Body:
//   { "tool": "nmap", "args": ["-sV", "-p-", "10.10.10.0/24"], "timeout": 600 }
//
// Respuesta:
//   { "ok": true, "jobId": "abc123...", "tool": "nmap" }
app.post('/api/v1/exec/background', async (req, res) => {
  const { tool, args: rawArgs, timeout: rawTimeout } = req.body;

  // Validar herramienta
  const toolCheck = validateTool(tool);
  if (!toolCheck.valid) return res.status(400).json({ ok: false, error: toolCheck.error });

  // Validar argumentos
  const argsCheck = validateArgs(rawArgs);
  if (!argsCheck.valid) return res.status(400).json({ ok: false, error: argsCheck.error });

  const args    = argsCheck.args;
  const timeout = clampTimeout(rawTimeout);
  const jobId   = crypto.randomUUID();

  // Crear registro del job
  const job = {
    id:         jobId,
    tool,
    args,
    status:     'running',      // running | completed | failed | killed | timeout
    stdout:     '',
    stderr:     '',
    exitCode:   null,
    truncated:  false,
    startedAt:  Date.now(),
    finishedAt: null,
    durationMs: null,
    exec:       null,           // referencia al exec de Docker (para kill)
    stream:     null,           // referencia al stream (para destroy)
  };

  jobs.set(jobId, job);

  console.log(`[BG] Iniciando job ${jobId}: ${tool} ${args.join(' ')} (timeout: ${timeout}s)`);

  try {
    const container = docker.getContainer(KALI_CONTAINER);

    const exec = await container.exec({
      Cmd:          [tool, ...args],
      AttachStdout: true,
      AttachStderr: true,
      Tty:          false,
      User:         KALI_USER,
      Env:          [`HOME=/home/${KALI_USER}`],
    });

    const stream = await exec.start({ Detach: false });

    job.exec   = exec;
    job.stream = stream;

    const outStream = new PassThrough();
    const errStream = new PassThrough();
    docker.modem.demuxStream(stream, outStream, errStream);

    outStream.on('data', (chunk) => {
      if (job.stdout.length < MAX_OUTPUT_BYTES) {
        job.stdout += chunk.toString('utf8');
      } else {
        job.truncated = true;
      }
    });

    errStream.on('data', (chunk) => {
      if (job.stderr.length < MAX_OUTPUT_BYTES) {
        job.stderr += chunk.toString('utf8');
      } else {
        job.truncated = true;
      }
    });

    // Timeout de seguridad
    const timer = setTimeout(() => {
      if (job.status === 'running') {
        job.status     = 'timeout';
        job.finishedAt = Date.now();
        job.durationMs = job.finishedAt - job.startedAt;
        stream.destroy();
        console.log(`[BG] Job ${jobId} — TIMEOUT (${timeout}s)`);
      }
    }, timeout * 1000);

    stream.on('end', async () => {
      clearTimeout(timer);
      if (job.status !== 'running') return; // ya fue killed/timeout

      try {
        const info     = await exec.inspect();
        job.exitCode   = info.ExitCode;
        job.status     = info.ExitCode === 0 ? 'completed' : 'failed';
      } catch {
        job.status = 'completed';
        job.exitCode = -1;
      }

      job.stdout     = job.stdout.trim();
      job.stderr     = job.stderr.trim();
      job.finishedAt = Date.now();
      job.durationMs = job.finishedAt - job.startedAt;

      console.log(`[BG] Job ${jobId} → ${job.status} (exitCode=${job.exitCode}, ${job.durationMs}ms)`);
    });

    stream.on('error', (err) => {
      clearTimeout(timer);
      if (job.status !== 'running') return;

      job.status     = 'failed';
      job.stderr     = (job.stderr + '\n' + err.message).trim();
      job.finishedAt = Date.now();
      job.durationMs = job.finishedAt - job.startedAt;

      console.error(`[BG] Job ${jobId} — ERROR: ${err.message}`);
    });

    // Responder inmediatamente con el jobId
    res.status(202).json({
      ok:    true,
      jobId,
      tool,
      args,
      message: `Job iniciado. Consulta GET /api/v1/jobs/${jobId} para ver el progreso.`,
    });

  } catch (err) {
    job.status     = 'failed';
    job.stderr     = err.message;
    job.finishedAt = Date.now();
    job.durationMs = job.finishedAt - job.startedAt;

    console.error(`[BG] Error al iniciar job ${jobId}: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/v1/jobs ─────────────────────────────────────────
// Lista todos los jobs activos y recientes
app.get('/api/v1/jobs', (_req, res) => {
  const list = [...jobs.values()].map(j => ({
    id:         j.id,
    tool:       j.tool,
    args:       j.args,
    status:     j.status,
    exitCode:   j.exitCode,
    truncated:  j.truncated,
    startedAt:  new Date(j.startedAt).toISOString(),
    finishedAt: j.finishedAt ? new Date(j.finishedAt).toISOString() : null,
    durationMs: j.durationMs,
  }));

  res.json({ total: list.length, jobs: list });
});

// ── GET /api/v1/jobs/:id ─────────────────────────────────────
// Consulta el estado y output de un job específico
app.get('/api/v1/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'Job no encontrado.' });

  res.json({
    ok:         true,
    id:         job.id,
    tool:       job.tool,
    args:       job.args,
    status:     job.status,
    exitCode:   job.exitCode,
    stdout:     job.stdout.trim(),
    stderr:     job.stderr.trim(),
    truncated:  job.truncated,
    startedAt:  new Date(job.startedAt).toISOString(),
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
    durationMs: job.durationMs,
  });
});

// ── DELETE /api/v1/jobs/:id ──────────────────────────────────
// Mata un job en background y destruye su proceso
app.delete('/api/v1/jobs/:id', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'Job no encontrado.' });

  if (job.status !== 'running') {
    return res.json({
      ok:      true,
      message: `El job ya terminó con status "${job.status}".`,
    });
  }

  try {
    // Intentar matar el proceso dentro del contenedor Kali
    if (job.exec) {
      try {
        const info = await job.exec.inspect();
        if (info.Running && info.Pid > 0) {
          const container = docker.getContainer(KALI_CONTAINER);
          const killExec = await container.exec({
            Cmd:          ['kill', '-TERM', String(info.Pid)],
            AttachStdout: true,
            User:         'root',
          });
          await killExec.start({ Detach: true });
        }
      } catch {
        // Si no pudimos obtener el PID, al menos destruimos el stream
      }
    }

    // Destruir el stream para liberar recursos
    if (job.stream) job.stream.destroy();

    job.status     = 'killed';
    job.finishedAt = Date.now();
    job.durationMs = job.finishedAt - job.startedAt;

    console.log(`[BG] Job ${job.id} — KILLED`);

    res.json({
      ok:      true,
      jobId:   job.id,
      message: 'Job terminado.',
    });
  } catch (err) {
    console.error(`[BG] Error al matar job ${job.id}: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  Arrancar servidor
// ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   Forge — Kali API                        ║
╠═══════════════════════════════════════════╣
║  HTTP  → http://localhost:${PORT}            ║
║  Kali  → contenedor "${KALI_CONTAINER}"      ║
║  Tools → ${ALLOWED_TOOLS.size} herramientas permitidas    ║
╚═══════════════════════════════════════════╝
  `);
});
