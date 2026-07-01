const { app, BrowserWindow, dialog, ipcMain, shell, session } = require('electron');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let pyProcess = null;
const PORT = 6060;
const URL = `http://127.0.0.1:${PORT}`;

function startBackend() {
  const isPackaged = app.isPackaged;
  const env = { 
    ...process.env, 
    PYTHONIOENCODING: 'utf-8', 
    PYTHONUTF8: '1',
    TQDM_ASCII: 'True'
  };
  
  if (isPackaged) {
    // In production, load the compiled PyInstaller binary from resources
    let backendPath = '';
    if (process.platform === 'win32') {
      backendPath = path.join(process.resourcesPath, 'backend', 'fast_api.exe');
    } else {
      backendPath = path.join(process.resourcesPath, 'backend', 'fast_api');
    }
    
    const fs = require('fs');
    if (fs.existsSync(backendPath)) {
      console.log(`Starting packaged backend binary: ${backendPath}`);
      pyProcess = spawn(backendPath, ['--port', PORT.toString()], { env });
    } else {
      // Fallback: Try to run python script copied to resources
      const scriptPath = path.join(process.resourcesPath, 'mineru', 'cli', 'fast_api.py');
      if (fs.existsSync(scriptPath)) {
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        console.log(`Starting bundled Python backend script: ${pythonCmd} ${scriptPath}`);
        pyProcess = spawn(pythonCmd, [scriptPath, '--port', PORT.toString()], { env });
      } else {
        console.log(`Neither binary nor Python script found in resources. Assuming local Python server is running separately.`);
      }
    }
  } else {
    // In development, run the local python script using the system python interpreter
    const rootDir = path.join(__dirname, '..', '..');
    const scriptPath = path.join(rootDir, 'mineru', 'cli', 'fast_api.py');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    console.log(`Starting local Python backend: ${pythonCmd} ${scriptPath}`);
    pyProcess = spawn(pythonCmd, [scriptPath, '--port', PORT.toString()], {
      cwd: rootDir,
      env: env
    });
  }

  if (pyProcess) {
    pyProcess.stdout.on('data', (data) => {
      console.log(`[Backend]: ${data}`);
    });

    pyProcess.stderr.on('data', (data) => {
      const logStr = data.toString();
      if (/ERROR|CRITICAL|WARNING|Traceback|Exception/i.test(logStr)) {
        console.error(`[Backend Error]: ${logStr}`);
      } else {
        console.log(`[Backend]: ${logStr}`);
      }
    });

    pyProcess.on('close', (code) => {
      console.log(`Backend process exited with code ${code}`);
      pyProcess = null;
    });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, 'assets', 'logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'DocMiner',
  });

  // Remove the default File/Edit/View menu bar
  mainWindow.setMenu(null);

  // Clear session cache on startup to ensure updated scripts and styles are loaded
  mainWindow.webContents.session.clearCache().catch((err) => {
    console.error('Failed to clear cache:', err);
  });

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

let currentDownloadItem = null;

app.whenReady().then(() => {
  startBackend();
  createWindow();

  // Handle updates download
  session.defaultSession.on('will-download', (event, item, webContents) => {
    const tempPath = app.getPath('temp');
    const fileName = item.getFilename();
    const savePath = path.join(tempPath, fileName);
    
    item.setSavePath(savePath);
    currentDownloadItem = item;

    item.on('updated', (event, state) => {
      if (state === 'interrupted') {
        webContents.send('download-status', { status: 'interrupted' });
      } else if (state === 'progressing') {
        if (item.isPaused()) {
          webContents.send('download-status', { status: 'paused' });
        } else {
          const received = item.getReceivedBytes();
          const total = item.getTotalBytes();
          const percent = total > 0 ? Math.round((received / total) * 100) : 0;
          webContents.send('download-status', { 
            status: 'downloading', 
            percent, 
            received, 
            total 
          });
        }
      }
    });

    item.on('done', (event, state) => {
      if (state === 'completed') {
        webContents.send('download-status', { 
          status: 'completed', 
          savePath: item.getSavePath() 
        });
      } else if (state === 'cancelled') {
        webContents.send('download-status', { status: 'cancelled' });
      } else {
        webContents.send('download-status', { 
          status: 'failed', 
          error: state 
        });
      }
      currentDownloadItem = null;
    });
  });

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

let childWindow = null;

// Automatically maximize any child window (like the print preview window) when it is created
app.on('browser-window-created', (event, window) => {
  if (mainWindow && window !== mainWindow) {
    window.maximize();
    childWindow = window;
    
    window.on('closed', () => {
      if (childWindow === window) {
        childWindow = null;
      }
    });
  }
});

// Programmatic PDF Export handler to bypass browser printer Spooler block
ipcMain.on('save-as-pdf', (event) => {
  const targetWindow = childWindow || BrowserWindow.fromWebContents(event.sender);
  const webContents = targetWindow.webContents;
  const win = targetWindow;
  
  const options = {
    margins: { marginType: 1 }, // No margins (custom margins handled by preview CSS)
    pageSize: 'A4',
    printBackground: true
  };
  
  webContents.printToPDF(options).then((data) => {
    dialog.showSaveDialog(win, {
      title: '另存为 PDF',
      defaultPath: 'document.pdf',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    }).then((file) => {
      if (!file.canceled && file.filePath) {
        const fs = require('fs');
        fs.writeFile(file.filePath, data, (err) => {
          if (err) {
            dialog.showErrorBox('保存失败', '写入 PDF 文件时出错：' + err.message);
          }
        });
      }
    }).catch((err) => {
      dialog.showErrorBox('保存失败', '保存文件对话框出错：' + err.message);
    });
  }).catch((err) => {
    dialog.showErrorBox('导出 PDF 失败', '无法生成 PDF 数据：' + err.message);
  });
});

// Programmatic Markdown Export handler
ipcMain.on('save-as-md', (event, content, filename) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  dialog.showSaveDialog(win, {
    title: '保存 Markdown 文件',
    defaultPath: filename,
    filters: [{ name: 'Markdown Files', extensions: ['md'] }]
  }).then((file) => {
    if (!file.canceled && file.filePath) {
      const fs = require('fs');
      fs.writeFile(file.filePath, content, 'utf8', (err) => {
        if (err) {
          dialog.showErrorBox('保存失败', '写入文件时出错：' + err.message);
        }
      });
    }
  }).catch((err) => {
    dialog.showErrorBox('保存失败', '保存文件对话框出错：' + err.message);
  });
});

// ==================== Software Update IPCs ====================
// Return app version
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Open external URL in user's browser
ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url).catch((err) => {
    console.error('Failed to open external URL:', err);
  });
});

// Start downloading update package
ipcMain.on('start-download', (event, downloadUrl) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.webContents.downloadURL(downloadUrl);
  }
});

// Cancel active download
ipcMain.on('cancel-download', () => {
  if (currentDownloadItem) {
    currentDownloadItem.cancel();
    currentDownloadItem = null;
  }
});

// Install update package
ipcMain.on('install-update', (event, filePath) => {
  if (!filePath) return;
  console.log(`Running installer: ${filePath}`);
  
  if (process.platform === 'win32') {
    const child = spawn(filePath, [], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    app.quit();
  } else if (process.platform === 'darwin') {
    shell.openPath(filePath).then((errStr) => {
      if (errStr) {
        console.error('Failed to open DMG:', errStr);
      } else {
        app.quit();
      }
    });
  } else {
    shell.openPath(path.dirname(filePath)).then(() => {
      app.quit();
    });
  }
});
