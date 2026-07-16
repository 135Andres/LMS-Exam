/**
 * dashboard.js — Terminal Dashboard Unificado
 *
 * Monitorea dos procesos en paralelo:
 *   - Izquierda: Python Auth (FastAPI OTP) en backend-python/
 *   - Derecha:   Node.js Backend (Express + IA) en backend/
 *
 * Uso: node dashboard.js
 */

const blessed = require('blessed');
const { spawn, execSync } = require('child_process');
const path = require('path');

// ═════════════════════════════════════════════════════════════════════
//  Configuración
// ═════════════════════════════════════════════════════════════════════

const ROOT = __dirname;
const MAX_LINES = 500;
const KILL_TIMEOUT = 3000;
const RESTART_DELAY = 2000;

const PYTHON_CWD = path.join(ROOT, 'backend-python');
const NODE_CWD = path.join(ROOT, 'backend');

const PYTHON_CMD = process.platform === 'win32' ? 'python' : './.venv/bin/python';
const PYTHON_ARGS = ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '3001'];

const NODE_CMD = process.platform === 'win32' ? 'npx.cmd tsx watch server.ts' : 'npx tsx watch server.ts';

// ═════════════════════════════════════════════════════════════════════
//  Screen
// ═════════════════════════════════════════════════════════════════════

const screen = blessed.screen({
  smartCSR: true,
  title: 'LMS EXAM — Panel de Control',
  cursor: { artificial: true, blink: false },
  fullUnicode: true,
  dockBorders: true,
  ignoreDockContrast: true,
});

screen.key(['C-c', 'q'], () => gracefulShutdown());

// ═════════════════════════════════════════════════════════════════════
//  Banner (sin borde, solo texto centrado)
// ═════════════════════════════════════════════════════════════════════

const BANNER_LINES = [
  '██╗     ███╗   ███╗███████╗    ███████╗██╗  ██╗ █████╗ ███╗   ███╗',
  '██║     ████╗ ████║██╔════╝    ██╔════╝╚██╗██╔╝██╔══██╗████╗ ████║',
  '██║     ██╔████╔██║███████╗    █████╗   ╚███╔╝ ███████║██╔████╔██║',
  '██║     ██║╚██╔╝██║╚════██║    ██╔══╝   ██╔██╗ ██╔══██║██║╚██╔╝██║',
  '███████╗██║ ╚═╝ ██║███████║    ███████╗██╔╝ ██╗██║  ██║██║ ╚═╝ ██║',
  '╚══════╝╚═╝     ╚═╝╚══════╝    ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝',
  '',
  '                      Panel de Control Unificado  •  Ctrl+C = Salir',
];

const BANNER_HEIGHT = BANNER_LINES.length;

const banner = blessed.box({
  parent: screen,
  top: 0,
  left: 0,
  width: '100%',
  height: BANNER_HEIGHT,
  align: 'center',
  valign: 'middle',
  tags: true,
  style: { fg: 'cyan', bold: true },
  content: BANNER_LINES.join('\n'),
});

// ═════════════════════════════════════════════════════════════════════
//  Paneles laterales
// ═════════════════════════════════════════════════════════════════════

// Panel izquierdo — Logs de Python Auth
const leftPanel = blessed.log({
  parent: screen,
  top: BANNER_HEIGHT,
  left: 0,
  width: '50%',
  bottom: 1,
  label: ' LOGINS & AUTENTICACIÓN ',
  tags: true,
  scrollback: MAX_LINES,
  mouse: true,
  keys: true,
  vi: true,
  scrollbar: { ch: ' ' },
  border: { type: 'line', fg: 'brightBlue' },
  style: {
    fg: 'white',
    border: { fg: 'brightBlue' },
    label: { fg: 'brightBlue', bold: true },
  },
});

// Panel derecho — Logs de Node + IA
const rightPanel = blessed.log({
  parent: screen,
  top: BANNER_HEIGHT,
  left: '50%',
  width: '50%',
  bottom: 1,
  label: ' ACTIVIDAD DE IA & SISTEMA ',
  tags: true,
  scrollback: MAX_LINES,
  mouse: true,
  keys: true,
  vi: true,
  scrollbar: { ch: ' ' },
  border: { type: 'line', fg: 'brightMagenta' },
  style: {
    fg: 'white',
    border: { fg: 'brightMagenta' },
    label: { fg: 'brightMagenta', bold: true },
  },
});

// ═════════════════════════════════════════════════════════════════════
//  Status Bar
// ═════════════════════════════════════════════════════════════════════

const statusBar = blessed.box({
  parent: screen,
  bottom: 0,
  left: 0,
  width: '100%',
  height: 1,
  tags: true,
  style: { fg: 'white' },
});

function renderStatus() {
  const py = pythonAlive
    ? '{green-fg}● running{/green-fg}'
    : '{red-fg}● stopped{/red-fg}';
  const nd = nodeAlive
    ? '{green-fg}● running{/green-fg}'
    : '{red-fg}● stopped{/red-fg}';
  statusBar.setContent(
    ' [\u2699] Python: ' + py + '  |  Node: ' + nd + '  |  {bold}Ctrl{/bold}+C = Salir'
  );
  screen.render();
}

// ═════════════════════════════════════════════════════════════════════
//  Helpers de texto
// ═════════════════════════════════════════════════════════════════════

/** Escapa { } para que blessed no los interprete como tags */
function esc(text) {
  return text.replace(/\{/g, '{open}').replace(/\}/g, '{close}');
}

/** Aplica resaltado para el panel derecho (IA keywords) */
function formatLine(line) {
  const safe = esc(line);
  if (/Embedding generado/.test(line)) {
    return '{yellow-fg}' + safe + ' \uD83E\uDDE0{/yellow-fg}';
  }
  if (/Llamada streaming/.test(line) || /NVIDIA API/.test(line)) {
    return '{magenta-fg}' + safe + ' \u26A1{/magenta-fg}';
  }
  if (/[Ee]rror/.test(line)) {
    return '{red-fg}' + safe + '{/red-fg}';
  }
  return safe;
}

/** Agrega línea formateada a un log y forza render + scroll */
function pushLog(log, text) {
  log.add(text);
  log.setScrollPerc(100);
  screen.render();
}

// ═════════════════════════════════════════════════════════════════════
//  State global de procesos
// ═════════════════════════════════════════════════════════════════════

let pythonProc = null;
let nodeProc = null;
let pythonAlive = false;
let nodeAlive = false;
let shutdownFlag = false;
let pythonRestartAttempts = 0;
let pythonRestartCount = 0;
const MAX_PYTHON_RESTARTS = 5;

let nodeRestarted = false;
// ═════════════════════════════════════════════════════════════════════
//  Python Auth — proceso
// ═════════════════════════════════════════════════════════════════════

function spawnPython() {
  try {
    pythonProc = spawn(PYTHON_CMD, PYTHON_ARGS, {
      cwd: PYTHON_CWD,
      windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
  } catch (err) {
    pushLog(leftPanel, '{red-fg}[FATAL] No se pudo iniciar Python: ' + esc(err.message) + '{/red-fg}');
    return;
  }

  pythonAlive = true;
  pythonRestartCount = 0;
  renderStatus();

  pythonProc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      pushLog(leftPanel, '{cyan-fg}[stdout]{/cyan-fg} ' + esc(line));
    }
  });

  pythonProc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      pushLog(leftPanel, '{yellow-fg}[stderr]{/yellow-fg} ' + esc(line));
    }
  });

  pythonProc.on('exit', (code) => {
    pythonAlive = false;
    renderStatus();
    if (!shutdownFlag && pythonRestartCount < MAX_PYTHON_RESTARTS) {
      pythonRestartCount++;
      const delay = Math.min(RESTART_DELAY * pythonRestartCount, 10000);
      pushLog(leftPanel, '{yellow-fg}\uD83D\uDD04 Reiniciando (' + pythonRestartCount + '/' + MAX_PYTHON_RESTARTS + ') en ' + (delay / 1000) + 's...{/yellow-fg}');
      setTimeout(spawnPython, delay);
    }
  });

  pythonProc.on('error', (err) => {
    pythonAlive = false;
    pushLog(leftPanel, '{red-fg}[ERROR] ' + esc(err.message) + '{/red-fg}');
    renderStatus();
  });
}

// ═════════════════════════════════════════════════════════════════════
//  Node Backend — proceso
// ═════════════════════════════════════════════════════════════════════

function spawnNode() {
  try {
    nodeProc = spawn(NODE_CMD, [], {
      cwd: NODE_CWD,
      shell: true,
      windowsHide: true,
    });
  } catch (err) {
    pushLog(rightPanel, '{red-fg}[FATAL] No se pudo iniciar Node: ' + esc(err.message) + '{/red-fg}');
    return;
  }

  nodeAlive = true;
  renderStatus();

  nodeProc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      pushLog(rightPanel, '{green-fg}[stdout]{/green-fg} ' + formatLine(line));
    }
  });

  nodeProc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      pushLog(rightPanel, '{yellow-fg}[stderr]{/yellow-fg} ' + formatLine(line));
    }
  });

  nodeProc.on('exit', (code) => {
    nodeAlive = false;
    renderStatus();
    if (!shutdownFlag && !nodeRestarted) {
      nodeRestarted = true;
      pushLog(rightPanel, '{yellow-fg}\uD83D\uDD04 Reiniciando... (exit ' + code + '){/yellow-fg}');
      setTimeout(spawnNode, RESTART_DELAY);
    }
  });

  nodeProc.on('error', (err) => {
    nodeAlive = false;
    pushLog(rightPanel, '{red-fg}[ERROR] ' + esc(err.message) + '{/red-fg}');
    renderStatus();
  });
}

// ═════════════════════════════════════════════════════════════════════
//  Mata proceso y toda su árbol (taskkill en Windows)
// ═════════════════════════════════════════════════════════════════════

function killProcessTree(proc) {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /T /F /PID ${proc.pid}`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGKILL');
    }
  } catch (_) {}
}

function freePort(port) {
  if (process.platform !== 'win32') return;
  for (let attempt = 0; attempt < 5; attempt++) {
    // Check if port is free
    try {
      execSync(`netstat -ano | findstr ":${port}" | findstr "LISTENING"`, {
        encoding: 'utf8', timeout: 2000, stdio: 'pipe',
      });
    } catch (_) {
      return; // No listening port found — free
    }
    // Kill ANY orphan python/node.exe that might hold it
    for (const exe of ['python.exe', 'node.exe']) {
      try { execSync(`taskkill /F /IM ${exe} /T 2>nul`, { stdio: 'ignore' }); } catch (_) {}
    }
    try { execSync(`timeout /T 1 /NOBREAK >nul 2>nul`, { stdio: 'ignore' }); } catch (_) {}
  }
}

// ═════════════════════════════════════════════════════════════════════
//  Shutdown graceful
// ═════════════════════════════════════════════════════════════════════

function gracefulShutdown() {
  if (shutdownFlag) return;
  shutdownFlag = true;

  // Mata árbol de procesos completo (taskkill /T mata cmd.exe + node/python)
  killProcessTree(pythonProc);
  killProcessTree(nodeProc);

  // Timeout de seguridad
  setTimeout(() => {
    try { process.exit(0); } catch (_) {}
  }, KILL_TIMEOUT);
}

// ═════════════════════════════════════════════════════════════════════
//  Hooks de salida
// ═════════════════════════════════════════════════════════════════════

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('exit', () => {
  killProcessTree(pythonProc);
  killProcessTree(nodeProc);
});

// ═════════════════════════════════════════════════════════════════════
//  Arranque
// ═════════════════════════════════════════════════════════════════════

pushLog(leftPanel, '{cyan-fg}[SISTEMA] Liberando puertos ocupados...{/cyan-fg}');
freePort(3000);
freePort(3001);

pushLog(leftPanel, '{cyan-fg}[SISTEMA] Iniciando Python Auth...{/cyan-fg}');
pushLog(rightPanel, '{cyan-fg}[SISTEMA] Iniciando Node Backend...{/cyan-fg}');
screen.render();

spawnPython();
spawnNode();
screen.render();
