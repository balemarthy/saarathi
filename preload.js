const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('saarathi', {
  quit: () => ipcRenderer.send('quit-app'),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('drag-move', dx, dy),
  sendAudio: (wav, mode) => ipcRenderer.send('audio', wav, mode),
  log: (msg) => ipcRenderer.send('renderer-log', msg),
  onToggleListen: (cb) => ipcRenderer.on('toggle-listen', () => cb()),
  onExpectCommand: (cb) => ipcRenderer.on('expect-command', () => cb()),
  onToggleWake: (cb) => ipcRenderer.on('toggle-wake', () => cb()),
  onSetState: (cb) => ipcRenderer.on('set-state', (event, state) => cb(state)),
});
