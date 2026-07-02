const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const PYTHON_VERSION = '3.10.11';
const TARGET_DIR = path.join(__dirname, 'python');

// URLs for portable Python packages
const WINDOWS_ZIP_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`;
const MAC_ARM64_URL = `https://github.com/indygreg/python-build-standalone/releases/download/20230507/cpython-3.10.11%2B20230507-aarch64-apple-darwin-install_only.tar.gz`;
const MAC_X64_URL = `https://github.com/indygreg/python-build-standalone/releases/download/20230507/cpython-3.10.11%2B20230507-x86_64-apple-darwin-install_only.tar.gz`;

function downloadFile(url, destPath) {
  console.log(`Downloading ${url}...`);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function ensureDirExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function main() {
  const platform = process.platform;
  const arch = process.arch;

  console.log(`System details: Platform=${platform}, Architecture=${arch}`);
  
  ensureDirExists(TARGET_DIR);
  
  // Clean target directory except .gitkeep
  const files = fs.readdirSync(TARGET_DIR);
  for (const file of files) {
    if (file !== '.gitkeep') {
      const p = path.join(TARGET_DIR, file);
      try {
        if (fs.statSync(p).isDirectory()) {
          fs.rmSync(p, { recursive: true, force: true });
        } else {
          fs.unlinkSync(p);
        }
      } catch (err) {
        console.warn(`Could not delete ${p}: ${err.message}`);
      }
    }
  }

  const tempDir = path.join(__dirname, 'temp_download');
  ensureDirExists(tempDir);

  try {
    if (platform === 'win32') {
      const zipPath = path.join(tempDir, 'python.zip');
      await downloadFile(WINDOWS_ZIP_URL, zipPath);
      
      console.log('Extracting Python zip...');
      execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${TARGET_DIR}' -Force"`);
      
      // Configure ._pth file to enable site-packages
      const pthFile = path.join(TARGET_DIR, 'python310._pth');
      if (fs.existsSync(pthFile)) {
        console.log('Configuring python310._pth to import site...');
        let content = fs.readFileSync(pthFile, 'utf8');
        content = content.replace(/#\s*import site/, 'import site');
        fs.writeFileSync(pthFile, content, 'utf8');
      }

      // Download get-pip.py and run it to install pip
      const pipScriptPath = path.join(TARGET_DIR, 'get-pip.py');
      await downloadFile('https://bootstrap.pypa.io/get-pip.py', pipScriptPath);
      
      console.log('Installing pip...');
      const pythonExe = path.join(TARGET_DIR, 'python.exe');
      execSync(`"${pythonExe}" "${pipScriptPath}" --no-warn-script-location`, { stdio: 'inherit' });
      
      try {
        fs.unlinkSync(pipScriptPath);
      } catch (e) {}

      console.log('Upgrading pip...');
      execSync(`"${pythonExe}" -m pip install --upgrade pip --no-warn-script-location -i https://mirrors.aliyun.com/pypi/simple`, { stdio: 'inherit' });

    } else if (platform === 'darwin') {
      const tarGzUrl = arch === 'arm64' ? MAC_ARM64_URL : MAC_X64_URL;
      const tarGzPath = path.join(tempDir, 'python.tar.gz');
      await downloadFile(tarGzUrl, tarGzPath);

      const extractTempDir = path.join(tempDir, 'extracted');
      ensureDirExists(extractTempDir);

      console.log('Extracting Python tar.gz...');
      execSync(`tar -xzf "${tarGzPath}" -C "${extractTempDir}"`);

      // Find the installation folder inside the extracted files
      // python-build-standalone extracts to a folder like `python/install`
      const sourceInstallDir = path.join(extractTempDir, 'python', 'install');
      if (fs.existsSync(sourceInstallDir)) {
        console.log('Moving extracted files to destination...');
        const items = fs.readdirSync(sourceInstallDir);
        for (const item of items) {
          const src = path.join(sourceInstallDir, item);
          const dest = path.join(TARGET_DIR, item);
          if (fs.statSync(src).isDirectory()) {
            ensureDirExists(dest);
            // Move contents recursively or use rename
            // Using renameSync might fail across mount points, but within the same folder it's fine.
            fs.renameSync(src, dest);
          } else {
            fs.renameSync(src, dest);
          }
        }
      } else {
        throw new Error('Failed to locate python install directory in extracted files');
      }
    } else {
      console.error(`Unsupported platform: ${platform}. Only Windows and macOS are supported.`);
      process.exit(1);
    }

    console.log('\nPortable Python environment configured successfully!');
    
    // Check python version
    const pythonCmd = platform === 'win32' 
      ? path.join(TARGET_DIR, 'python.exe')
      : path.join(TARGET_DIR, 'bin', 'python3');
      
    if (fs.existsSync(pythonCmd)) {
      const versionOutput = execSync(`"${pythonCmd}" --version`).toString().trim();
      console.log(`Interpreter verified: ${versionOutput} at ${pythonCmd}`);
      
      console.log('\nInstalling project dependencies...');
      const rootDir = path.join(__dirname, '..', '..');
      
      // Install dependencies using Aliyun mirror for speed
      execSync(`"${pythonCmd}" -m pip install -e "${rootDir}[core]" -i https://mirrors.aliyun.com/pypi/simple`, { stdio: 'inherit' });
      console.log('\nAll packages installed successfully!');
    } else {
      console.error(`Interpreter not found at ${pythonCmd}`);
    }

  } catch (error) {
    console.error('Error during configuration:', error);
  } finally {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {}
    }
  }
}

main();
