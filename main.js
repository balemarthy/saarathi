require('dotenv').config({ quiet: true });
const { app, BrowserWindow, ipcMain, globalShortcut, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// Tap once to start listening, tap again to stop. Electron has no key-up
// event, so true hold-to-talk is deferred (would need uiohook-napi).
const HOTKEY = 'Control+Shift+F9';
const MODEL = process.env.SAARATHI_MODEL || 'claude-haiku-4-5-20251001';
const SYSTEM_PROMPT =
  'You are Saarathi, a voice assistant on the user\'s desktop. Your reply is spoken aloud, ' +
  'so answer in one or two short plain sentences: no markdown, no lists, no emoji.';

const WHISPER_DIR = path.join(__dirname, 'vendor', 'whisper');
const WHISPER_EXE = path.join(WHISPER_DIR, 'Release', 'whisper-cli.exe');
const WHISPER_MODEL = path.join(WHISPER_DIR, 'ggml-base.en.bin');

let win = null;
let dragOrigin = null;
let anthropic = null;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropic) anthropic = new Anthropic();
  return anthropic;
}

function setState(state) {
  if (win && !win.isDestroyed()) win.webContents.send('set-state', state);
}

async function askClaude(text) {
  const client = getClient();
  if (!client) throw new Error('ANTHROPIC_API_KEY is not set (create .env in the project root)');
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: text }],
  });
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim();
}

// Windows SAPI via PowerShell. The text goes in over stdin, never into the
// command string, so nothing Claude says can be interpreted as a command.
function speak(text) {
  return new Promise((resolve, reject) => {
    const script =
      '[Console]::InputEncoding = [System.Text.Encoding]::UTF8;' +
      'Add-Type -AssemblyName System.Speech;' +
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;' +
      '$s.Speak([Console]::In.ReadToEnd())';
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    ps.stderr.on('data', (d) => (stderr += d));
    ps.on('error', reject);
    ps.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`TTS exited ${code}: ${stderr}`))));
    ps.stdin.end(text, 'utf8');
  });
}

// Local speech-to-text via whisper.cpp. Fixed args, audio file only.
function transcribe(wavBuffer) {
  return new Promise((resolve, reject) => {
    const file = path.join(os.tmpdir(), `saarathi-${Date.now()}.wav`);
    fs.writeFileSync(file, wavBuffer);
    const cleanup = () => fs.rm(file, { force: true }, () => {});
    const proc = spawn(WHISPER_EXE, ['-m', WHISPER_MODEL, '-f', file, '-nt', '-np'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', (e) => { cleanup(); reject(e); });
    proc.on('close', (code) => {
      cleanup();
      if (code !== 0) return reject(new Error(`whisper exited ${code}: ${err.slice(-300)}`));
      resolve(out.trim());
    });
  });
}

async function handleTranscript(text) {
  console.log('[you]', text);
  setState('thinking');
  try {
    const reply = await askClaude(text);
    console.log('[claude]', reply);
    setState('done');
    if (reply) await speak(reply);
  } catch (err) {
    console.error('[error]', err.message);
    setState('done');
    await speak('Sorry, something went wrong.').catch(() => {});
  }
  setState('idle');
}

function createWindow() {
  win = new BrowserWindow({
    width: 220,
    height: 220,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: __dirname + '/preload.js',
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile('index.html');

  ipcMain.on('drag-start', () => {
    dragOrigin = win.getPosition();
  });

  ipcMain.on('drag-move', (event, dx, dy) => {
    if (!dragOrigin) return;
    win.setPosition(dragOrigin[0] + dx, dragOrigin[1] + dy);
  });
}

app.whenReady().then(() => {
  // Only the microphone is ever granted.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'media');

  createWindow();

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[warn] ANTHROPIC_API_KEY not set. Create .env with ANTHROPIC_API_KEY=... and restart.');
  }
  const ok = globalShortcut.register(HOTKEY, () => {
    if (win && !win.isDestroyed()) win.webContents.send('toggle-listen');
  });
  if (!ok) console.error(`[error] could not register hotkey ${HOTKEY} (already in use?)`);
});

ipcMain.on('quit-app', () => app.quit());

ipcMain.on('audio', async (event, wav) => {
  setState('thinking');
  try {
    // Whisper emits bracketed tags like [BLANK_AUDIO] for silence/noise.
    const text = (await transcribe(Buffer.from(wav))).replace(/\[[^\]]*\]/g, '').trim().slice(0, 1000);
    if (text) await handleTranscript(text);
    else { console.log('[you] (nothing heard)'); setState('idle'); }
  } catch (err) {
    console.error('[error]', err.message);
    setState('idle');
  }
});

ipcMain.on('renderer-log', (event, msg) => console.log('[renderer]', String(msg).slice(0, 500)));

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
