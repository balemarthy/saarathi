const VALID_STATES = ['idle', 'listening', 'thinking', 'done'];

function currentState() {
  return document.body.getAttribute('data-orb-state');
}

function setOrbState(state) {
  if (!VALID_STATES.includes(state)) return;
  document.body.setAttribute('data-orb-state', state);
}

setOrbState('idle');

document.querySelectorAll('#dev-controls button').forEach((btn) => {
  btn.addEventListener('click', () => setOrbState(btn.dataset.state));
});

window.addEventListener('keydown', (e) => {
  const map = { '1': 'idle', '2': 'listening', '3': 'thinking', '4': 'done' };
  if (map[e.key]) setOrbState(map[e.key]);
});

document.getElementById('close-btn').addEventListener('click', () => {
  window.saarathi.quit();
});

let dragging = false;
let dragStartMouse = { x: 0, y: 0 };

document.getElementById('orb').addEventListener('mousedown', (e) => {
  dragging = true;
  dragStartMouse = { x: e.screenX, y: e.screenY };
  window.saarathi.dragStart();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  window.saarathi.dragMove(e.screenX - dragStartMouse.x, e.screenY - dragStartMouse.y);
});

window.addEventListener('mouseup', () => {
  dragging = false;
});

// --- Voice capture ---------------------------------------------------------
// One mic pipeline (16 kHz mono) with simple energy-based voice detection.
// It cuts the audio into utterances and sends each to main (whisper.cpp) as a WAV.
//   wake mode    (default): every utterance is sent; main acts only if it starts
//                           with "Saarathi" and drops everything else.
//   'hotkey'     armed by Ctrl+Shift+F9: the next utterance is the command.
//   'followup'   armed after the name was heard alone: the next utterance is the command.
// Audio is dropped while Saarathi is thinking/speaking, so it never hears itself.

const CHUNK = 2048; // ~128 ms at 16 kHz
const START_CHUNKS = 3; // consecutive loud chunks that begin an utterance
const END_SILENCE_CHUNKS = 8; // ~1 s of quiet ends it
const MIN_VOICED_CHUNKS = 4; // shorter blips are ignored
const PRE_ROLL_CHUNKS = 4; // audio kept from just before speech was detected
const MAX_UTTERANCE_CHUNKS = Math.floor((15 * 16000) / CHUNK);
const ARM_TIMEOUT_MS = 8000; // give up if nothing is said after arming
const COOLDOWN_MS = 800; // deaf period after Saarathi finishes speaking

let mic = null; // { stream, ctx, source, proc }
let wakeEnabled = true;
document.body.setAttribute('data-wake', 'on');
let armed = null; // null | 'hotkey' | 'followup'
let armTimer = null;
let noiseFloor = 0.005;
let preRoll = [];
let loudRun = 0;
let seg = null; // { chunks, voiced, silent }
let ignoreUntil = 0;

function encodeWav(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new ArrayBuffer(44 + total * 2);
  const v = new DataView(buf);
  const str = (o, t) => [...t].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + total * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, total * 2, true);
  let o = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++, o += 2) {
      v.setInt16(o, Math.max(-1, Math.min(1, c[i])) * 0x7fff, true);
    }
  }
  return buf;
}

async function ensureMic() {
  if (mic) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(CHUNK, 1, 1);
    proc.onaudioprocess = (e) => onChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(proc);
    proc.connect(ctx.destination);
    mic = { stream, ctx, source, proc };
    return true;
  } catch (err) {
    window.saarathi.log('mic error: ' + err.message);
    return false;
  }
}

function releaseMic() {
  if (!mic) return;
  mic.proc.disconnect();
  mic.source.disconnect();
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.ctx.close();
  mic = null;
  seg = null;
  preRoll = [];
  loudRun = 0;
}

// Close the mic when nothing needs it (wake listening off and not armed).
function releaseMicIfUnneeded() {
  if (!wakeEnabled && !armed && !seg) releaseMic();
}

function arm(mode) {
  armed = mode;
  clearTimeout(armTimer);
  armTimer = setTimeout(() => {
    if (armed && !seg) disarm(); // if speech is in progress it will finish and send
  }, ARM_TIMEOUT_MS);
  setOrbState('listening');
}

function disarm() {
  armed = null;
  clearTimeout(armTimer);
  if (currentState() === 'listening') setOrbState('idle');
  releaseMicIfUnneeded();
}

function finishSegment(force = false) {
  const s = seg;
  seg = null;
  preRoll = [];
  loudRun = 0;
  if (!s) return;
  if (s.voiced < (force ? 2 : MIN_VOICED_CHUNKS)) {
    if (armed && !force) return; // blip while armed: keep waiting for real speech
    if (armed) disarm();
    return;
  }
  const mode = armed || 'wake';
  window.saarathi.log(`utterance ${((s.chunks.length * CHUNK) / 16000).toFixed(1)}s (${mode})`);
  if (armed) {
    armed = null;
    clearTimeout(armTimer);
  }
  window.saarathi.sendAudio(encodeWav(s.chunks), mode);
  releaseMicIfUnneeded();
}

function onChunk(data) {
  const state = currentState();
  // Deaf while thinking/speaking, right after finishing, or when wake listening is off and unarmed.
  const deaf =
    (state !== 'idle' && state !== 'listening') ||
    Date.now() < ignoreUntil ||
    (!wakeEnabled && !armed);
  if (deaf) {
    seg = null;
    preRoll = [];
    loudRun = 0;
    return;
  }

  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  const rms = Math.sqrt(sum / data.length);
  const loud = rms > Math.max(0.02, noiseFloor * 3.5);

  if (!seg) {
    preRoll.push(data);
    if (preRoll.length > PRE_ROLL_CHUNKS) preRoll.shift();
    if (!loud) {
      noiseFloor = noiseFloor * 0.95 + rms * 0.05; // track the room's background level
      loudRun = 0;
      return;
    }
    loudRun += 1;
    if (loudRun >= START_CHUNKS) {
      seg = { chunks: preRoll, voiced: loudRun, silent: 0 };
      preRoll = [];
    }
    return;
  }

  seg.chunks.push(data);
  if (loud) {
    seg.voiced += 1;
    seg.silent = 0;
  } else {
    seg.silent += 1;
  }
  if (seg.silent >= END_SILENCE_CHUNKS || seg.chunks.length >= MAX_UTTERANCE_CHUNKS) finishSegment();
}

// Hotkey: first press arms (one utterance, ends on silence); a second press ends it early.
window.saarathi.onToggleListen(async () => {
  if (armed) {
    if (seg) finishSegment(true);
    else disarm();
    return;
  }
  if (currentState() !== 'idle') return;
  if (await ensureMic()) arm('hotkey');
});

// Main heard the name on its own ("Saarathi."): the next utterance is the command.
window.saarathi.onExpectCommand(async () => {
  if (currentState() !== 'idle') return;
  if (await ensureMic()) arm('followup');
});

// The command was already captured (heard while the name was being transcribed).
window.saarathi.onCancelFollowup(() => {
  if (armed === 'followup' && !seg) disarm();
});

window.saarathi.onToggleWake(async () => {
  wakeEnabled = !wakeEnabled;
  document.body.setAttribute('data-wake', wakeEnabled ? 'on' : 'off');
  window.saarathi.log('wake listening ' + (wakeEnabled ? 'ON' : 'OFF'));
  if (wakeEnabled) await ensureMic();
  else releaseMicIfUnneeded();
});

window.saarathi.onSetState((state) => {
  if (state === 'idle') ignoreUntil = Date.now() + COOLDOWN_MS;
  setOrbState(state);
});

ensureMic().then((ok) => window.saarathi.log(ok ? 'wake listening ON' : 'mic unavailable'));
