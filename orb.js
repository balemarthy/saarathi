const VALID_STATES = ['idle', 'listening', 'thinking', 'done'];

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

// --- Voice capture: raw 16 kHz mono PCM, transcribed by whisper.cpp in main ---
const MAX_RECORD_MS = 15000;
let capture = null;

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

async function startListening() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext({ sampleRate: 16000 });
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(proc);
    proc.connect(ctx.destination);
    capture = { stream, ctx, proc, source, chunks, timer: setTimeout(stopListening, MAX_RECORD_MS) };
    setOrbState('listening');
  } catch (err) {
    window.saarathi.log('mic error: ' + err.message);
    setOrbState('idle');
  }
}

function stopListening() {
  if (!capture) return;
  const { stream, ctx, proc, source, chunks, timer } = capture;
  capture = null;
  clearTimeout(timer);
  proc.disconnect();
  source.disconnect();
  stream.getTracks().forEach((t) => t.stop());
  ctx.close();
  window.saarathi.sendAudio(encodeWav(chunks)); // main transcribes, then sets state
}

window.saarathi.onToggleListen(() => {
  const state = document.body.getAttribute('data-orb-state');
  if (state === 'listening' && capture) stopListening();
  else if (state === 'idle' || state === 'done') startListening();
});

window.saarathi.onSetState(setOrbState);
