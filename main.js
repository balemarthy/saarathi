require('dotenv').config({ quiet: true });
const { app, BrowserWindow, ipcMain, globalShortcut, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { toolDefinitions, executeTool } = require('./tools');
const { matchWake } = require('./wake');

// Tap once to start listening, tap again to stop. Electron has no key-up
// event, so true hold-to-talk is deferred (would need uiohook-napi).
const HOTKEY = 'Control+Shift+F9';
// Turns always-on wake-phrase listening on/off (also closes the mic).
const WAKE_TOGGLE_HOTKEY = 'Control+Shift+F8';
// Fixed on purpose: Haiku is the cheapest model and plenty for short commands.
const MODEL = 'claude-haiku-4-5-20251001';
const SYSTEM_PROMPT =
  'You are Saarathi, a voice assistant on the user\'s desktop. You can open a website, open an ' +
  'installed app, or search the web using your tools; when the user asks for one of these, call ' +
  'the tool. Otherwise just answer. Your reply is spoken aloud, so keep it to one or two short ' +
  'plain sentences: no markdown, no lists, no emoji.';

// USD per million tokens for MODEL.
const PRICING = { 'claude-haiku-4-5': { input: 1, output: 5 } };
let sessionCost = 0;
let sessionChats = 0;

const WHISPER_DIR = path.join(__dirname, 'vendor', 'whisper');
const WHISPER_EXE = path.join(WHISPER_DIR, 'Release', 'whisper-cli.exe');
const WHISPER_MODEL = path.join(WHISPER_DIR, 'ggml-base.en.bin');

// Temporary tuning aid: SAARATHI_CALIBRATE=1 logs what whisper heard for every
// ambient utterance to logs/calibration.txt so the wake matcher can be tuned.
const CALIBRATE = process.env.SAARATHI_CALIBRATE === '1';

let win = null;
let busy = false; // a command is being processed (Claude call + speech)
let transcribing = 0; // whisper runs in progress
let dragOrigin = null;
let anthropic = null;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropic) anthropic = new Anthropic();
  return anthropic;
}

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function setState(state) {
  if (win && !win.isDestroyed()) win.webContents.send('set-state', state);
}

function costOf(usage) {
  const key = Object.keys(PRICING).find((k) => MODEL.startsWith(k));
  if (!key) return null;
  const p = PRICING[key];
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  return (
    ((usage.input_tokens || 0) * p.input +
      cacheWrite * p.input * 1.25 +
      cacheRead * p.input * 0.1 +
      (usage.output_tokens || 0) * p.output) /
    1e6
  );
}

// Returns { text, toolCalls, usage }. Claude only picks a tool; it never runs anything.
async function askClaude(text) {
  const client = getClient();
  if (!client) throw new Error('ANTHROPIC_API_KEY is not set (create .env in the project root)');
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    tools: toolDefinitions(),
    messages: [{ role: 'user', content: text }],
  });
  return {
    text: msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim(),
    toolCalls: msg.content.filter((b) => b.type === 'tool_use').slice(0, 3),
    usage: msg.usage,
  };
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

// One JSON line per exchange, in a gitignored logs/ folder.
function logExchange(entry) {
  try {
    const dir = path.join(__dirname, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, 'history.jsonl'),
      JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n'
    );
  } catch (err) {
    console.error('[warn] could not write history:', err.message);
  }
}

async function handleTranscript(text) {
  console.log('[you]', text);
  busy = true;
  setState('thinking');
  try {
    const { text: reply, toolCalls, usage } = await askClaude(text);
    const actions = [];
    for (const call of toolCalls) {
      console.log('[tool]', call.name, JSON.stringify(call.input));
      actions.push({ tool: call.name, input: call.input, result: await executeTool(call.name, call.input) });
    }
    // With a tool call, speak what actually happened; otherwise Claude's answer.
    const spoken = actions.length ? actions.map((a) => a.result).join(' ') : reply;
    console.log('[claude]', spoken);

    const cost = costOf(usage);
    sessionChats += 1;
    if (cost !== null) sessionCost += cost;
    console.log(
      `[usage] in ${usage.input_tokens} / out ${usage.output_tokens} tokens` +
        (cost !== null ? ` = $${cost.toFixed(5)} (session: ${sessionChats} chats, $${sessionCost.toFixed(5)})` : '')
    );
    logExchange({
      you: text,
      claude: spoken,
      ...(actions.length ? { actions } : {}),
      model: MODEL,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cost_usd: cost,
    });

    setState('done');
    if (spoken) await speak(spoken);
  } catch (err) {
    console.error('[error]', err.message);
    logExchange({ you: text, error: err.message });
    setState('done');
    await speak('Sorry, something went wrong.').catch(() => {});
  }
  busy = false;
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
      autoplayPolicy: 'no-user-gesture-required', // let the always-on mic start without a click
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
  if (!globalShortcut.register(WAKE_TOGGLE_HOTKEY, () => send('toggle-wake'))) {
    console.error(`[error] could not register hotkey ${WAKE_TOGGLE_HOTKEY}`);
  }
  if (!ok) console.error(`[error] could not register hotkey ${HOTKEY} (already in use?)`);
});

ipcMain.on('quit-app', () => app.quit());

// Ambient utterances that arrive while whisper is still busy wait here (newest 2 kept)
// instead of being dropped, so a quick second try isn't lost.
const pendingWake = [];

// mode: 'wake' (ambient speech, act only if it starts with the name),
// 'hotkey' (user pressed the hotkey), 'followup' (name heard alone, command next).
async function processAudio(wav, mode) {
  if (mode !== 'wake') setState('thinking');

  let text = '';
  transcribing += 1;
  try {
    // Whisper emits tags like [BLANK_AUDIO] or (silence) for quiet/noise.
    const raw = (await transcribe(wav))
      .replace(/\[[^\]]*\]|\([^)]*\)/g, '')
      .trim()
      .slice(0, 1000);
    const wake = matchWake(raw);
    if (CALIBRATE && mode === 'wake') {
      console.log(`[heard] ${wake ? 'MATCH' : 'no   '} | ${raw}`);
      try {
        fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
        fs.appendFileSync(path.join(__dirname, 'logs', 'calibration.txt'), `${wake ? 'MATCH' : 'no   '} | ${raw}
`);
      } catch {}
    }
    if (mode === 'wake') {
      if (busy || !wake) text = ''; // ambient talk: dropped, never logged
      else {
        console.log('[wake] heard the name');
        if (wake.command.length < 3) send('expect-command');
        else text = wake.command;
      }
    } else {
      text = wake ? wake.command : raw; // "Saarathi, open youtube" via hotkey works too
    }
  } catch (err) {
    console.error('[error]', err.message);
  } finally {
    transcribing -= 1;
  }

  if (text) await handleTranscript(text);
  else if (mode !== 'wake') {
    console.log('[you] (nothing heard)');
    setState('idle');
  }

  // Next waiting ambient utterance, unless a command has started in the meantime.
  if (busy) pendingWake.length = 0;
  else if (pendingWake.length && !transcribing) processAudio(pendingWake.shift(), 'wake');
}

ipcMain.on('audio', (event, wav, mode) => {
  if (!['wake', 'hotkey', 'followup'].includes(mode)) return;
  const buf = Buffer.from(wav);
  if (mode === 'wake') {
    if (busy) return; // Saarathi is answering: this may be its own voice
    if (transcribing) {
      pendingWake.push(buf);
      if (pendingWake.length > 2) pendingWake.shift();
      return;
    }
  }
  processAudio(buf, mode);
});

ipcMain.on('renderer-log', (event, msg) => console.log('[renderer]', String(msg).slice(0, 500)));

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
