#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const isWindows = os.platform() === 'win32';
// On Windows execute ash.ps1, on Unix execute bash ash
// Note: We need to explicitly run bash on Unix because spawn doesn't use shell by default unless shell:true
const scriptName = isWindows ? 'ash.ps1' : 'ash';
const scriptPath = path.join(__dirname, scriptName);

const command = isWindows ? 'powershell' : 'bash';
const args = isWindows 
  ? ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...process.argv.slice(2)]
  : [scriptPath, ...process.argv.slice(2)];

const child = spawn(command, args, { stdio: 'inherit' });

child.on('exit', (code) => {
  process.exit(code);
});
