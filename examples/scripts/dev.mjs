import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(__dirname, '..');
const pluginDir = path.resolve(examplesDir, '..');

const processes = [];

function run(command, args, { cwd, label } = {}) {
  console.log(`\n> ${label ?? `${command} ${args.join(' ')}`}\n`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      cwd,
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${label ?? command} failed with exit code ${code ?? 1}`));
    });
  });
}

function runDetached(command, args, { cwd, label } = {}) {
  console.log(`\n> ${label ?? `${command} ${args.join(' ')}`}\n`);

  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd,
    env: process.env,
  });

  processes.push(child);
  return child;
}

function stopAll(signal = 'SIGTERM') {
  for (const child of processes) {
    if (!child.killed) child.kill(signal);
  }
}

process.on('SIGINT', () => {
  stopAll('SIGINT');
  process.exit(130);
});
process.on('SIGTERM', () => {
  stopAll('SIGTERM');
  process.exit(143);
});

async function prepare() {
  await run('npm', ['install'], { cwd: pluginDir, label: 'install plugin dependencies' });
  await run('npm', ['install'], { cwd: examplesDir, label: 'install examples dependencies' });

  await run('npm', ['run', 'build'], { cwd: pluginDir, label: 'build wallet plugin' });
}

prepare()
  .then(() => {
    runDetached('npx', ['vite'], { cwd: examplesDir, label: 'start vite dev server' });
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
