const { app, BrowserWindow, dialog } = require('electron');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let pyProcess = null;
const PORT = 6060;
const URL = `http://127.0.0.1:${PORT}`;

function startBackend() {
  const isPackaged = app.isPackaged;
  
  if (isPackaged) {
    // In production, load the compiled PyInstaller binary from resources
    let backendPath = '';
    if (process.platform === 'win32') {
      backendPath = path.join(process.resourcesPath, 'backend', 'fast_api.exe');
    } else {
      backendPath = path.join(process.resourcesPath, 'backend', 'fast_api');
    }
    console.log(`Starting packaged backend: ${backendPath}`);
    pyProcess = spawn(backendPath, ['--port', PORT.toString()]);
  } else {
    // In development, run the local python script using the system python interpreter
    const rootDir = path.join(__dirname, '..', '..');
    const scriptPath = path.join(rootDir, 'mineru', 'cli', 'fast_api.py');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    console.log(`Starting local Python backend: ${pythonCmd} ${scriptPath}`);
    pyProcess = spawn(pythonCmd, [scriptPath, '--port', PORT.toString()], {
      cwd: rootDir,
      env: process.env
    });
  }

  pyProcess.stdout.on('data', (data) => {
    console.log(`[Backend]: ${data}`);
  });

  pyProcess.stderr.on('data', (data) => {
    console.error(`[Backend Error]: ${data}`);
  });

  pyProcess.on('close', (code) => {
    console.log(`Backend process exited with code ${code}`);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, 'assets', 'logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'DocMiner',
  });

  // Remove the default File/Edit/View menu bar
  mainWindow.setMenu(null);

  // Display a loading message or splash page while waiting for backend
  mainWindow.loadFile(path.join(__dirname, 'loading.html'));

  pingAndLoad(URL, 0);
}

function pingAndLoad(url, attempts) {
  http.get(url, (res) => {
    // If the server responded, load the full page
    if (mainWindow) {
      mainWindow.loadURL(url);
    }
  }).on('error', (err) => {
    if (attempts < 60) { // Try for 60 seconds
      setTimeout(() => pingAndLoad(url, attempts + 1), 1000);
    } else {
      if (mainWindow) {
        dialog.showErrorBox(
          '连接服务失败',
          `无法连接到 DocMiner 后端服务 (端口 ${PORT})。\n请确保本地 Python 服务已在端口 ${PORT} 启动 (python mineru/cli/fast_api.py)`
        );
        app.quit();
      }
    }
  });
}

app.whenReady().then(() => {
  startBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (pyProcess) {
    console.log('Killing Backend process...');
    pyProcess.kill();
  }
});
