const { app, BrowserWindow, ipcMain } = require('electron');

let dragOrigin = null;

function createWindow() {
  const win = new BrowserWindow({
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

app.whenReady().then(createWindow);

ipcMain.on('quit-app', () => app.quit());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
