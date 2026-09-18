const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('saarathi', {
  quit: () => ipcRenderer.send('quit-app'),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('drag-move', dx, dy),
});
