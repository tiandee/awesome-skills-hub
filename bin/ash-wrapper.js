#!/usr/bin/env node
const { spawn, execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const isWindows = os.platform() === 'win32';
const scriptName = isWindows ? 'ash.ps1' : 'ash';
const scriptPath = path.join(__dirname, scriptName);

// Check if script exists
if (!fs.existsSync(scriptPath)) {
  console.error(`[错误] 找不到脚本文件: ${scriptPath}`);
  process.exit(1);
}

// Find bash path (prefer /bin/bash, fallback to bash in PATH)
function findBash() {
  const paths = ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash'];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  // Fallback: try to find bash in PATH
  try {
    const result = execSync('which bash', { encoding: 'utf8' }).trim();
    if (result && fs.existsSync(result)) {
      return result;
    }
  } catch (e) {
    // which command failed
  }
  return null;
}

if (isWindows) {
  const child = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...process.argv.slice(2)], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code));
} else {
  const bashPath = findBash();

  if (!bashPath) {
    console.error('[错误] 未找到 bash。请确保您的系统安装了 bash (通常位于 /bin/bash)。');
    console.error('[提示] 在 macOS 上，bash 应该默认可用。');
    console.error('[提示] 在 Linux 上，可以通过 apt/yum install bash 安装。');
    process.exit(1);
  }

  const child = spawn(bashPath, [scriptPath, ...process.argv.slice(2)], { stdio: 'inherit' });

  child.on('error', (err) => {
    console.error(`[错误] 执行脚本失败: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code !== null ? code : 1);
  });
}
