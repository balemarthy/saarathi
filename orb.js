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
