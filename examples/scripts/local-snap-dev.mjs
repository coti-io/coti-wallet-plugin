import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_ROOT = resolve(__dirname, '..');
const PLUGIN_ROOT = resolve(EXAMPLE_ROOT, '..');
const SNAP_ROOT = resolve(process.env.COTI_SNAP_ROOT ?? resolve(PLUGIN_ROOT, '..', 'coti-snap'));
const SNAP_SITE_ENV = resolve(SNAP_ROOT, 'packages/site/.env.local');

const LOCAL_SNAP_ID = process.env.VITE_SNAP_ID?.trim() || 'local:http://localhost:8080';
const WALLET_EXAMPLE_URL = 'http://localhost:5173';
const SNAP_SITE_URL = 'http://localhost:8000';
const SNAP_SERVER_URL = 'http://localhost:8080';

const processes = [];
const env = {
  ...process.env,
  VITE_WALLETCONNECT_PROJECT_ID:
    process.env.VITE_WALLETCONNECT_PROJECT_ID || 'your_walletconnect_project_id_here',
  VITE_SNAP_ID: LOCAL_SNAP_ID,
};

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
    ...options,
  });
  processes.push(child);
  return child;
}

function runChecked(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env,
      ...options,
    });
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code ?? 1}`));
    });
  });
}

function stopAll(signal = 'SIGTERM') {
  for (const child of processes) {
    if (!child.killed) child.kill(signal);
  }
}

function printLinks() {
  console.log('');
  console.log('Useful links');
  console.log(`- Wallet example:       ${WALLET_EXAMPLE_URL}`);
  console.log(`- Snap companion dApp:  ${SNAP_SITE_URL}`);
  console.log(`- Local snap server:    ${SNAP_SERVER_URL}`);
  console.log('');
  console.log('Notes');
  console.log(`- Wallet example uses snap id: ${LOCAL_SNAP_ID}`);
  console.log('- Use MetaMask desktop with COTI testnet');
  console.log('- Onboarding can auto-install the local snap from the wallet example');
  console.log('- Stop with Ctrl+C');
  console.log('');
}

function ensureSnapSiteEnv() {
  const requiredLine = 'VITE_SNAP_ENV=local';
  if (!existsSync(SNAP_SITE_ENV)) {
    writeFileSync(SNAP_SITE_ENV, `${requiredLine}\n`, 'utf8');
    console.log(`Created ${SNAP_SITE_ENV}`);
    return;
  }

  const content = readFileSync(SNAP_SITE_ENV, 'utf8');
  if (/^VITE_SNAP_ENV=/m.test(content)) {
    return;
  }

  writeFileSync(
    SNAP_SITE_ENV,
    `${content.trimEnd()}\n${requiredLine}\n`,
    'utf8',
  );
  console.log(`Appended ${requiredLine} to ${SNAP_SITE_ENV}`);
}

function assertPrerequisites() {
  if (!existsSync(SNAP_ROOT)) {
    console.error(`coti-snap not found at ${SNAP_ROOT}`);
    console.error('Clone coti-snap as a sibling of coti-wallet-plugin, or set COTI_SNAP_ROOT.');
    process.exit(1);
  }

  if (!existsSync(resolve(SNAP_ROOT, 'node_modules'))) {
    console.error('coti-snap dependencies are missing.');
    console.error(`Run: cd ${SNAP_ROOT} && yarn install`);
    process.exit(1);
  }

  const yarnCheck = spawnSync('yarn', ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (yarnCheck.status !== 0) {
    console.error('yarn is required to start the local snap stack.');
    process.exit(1);
  }
}

async function waitFor(url, label, timeoutMs = 120_000) {
  const startedAt = Date.now();
  let lastError;
  let nextLogAt = 0;
  console.log(`Waiting for ${label}: ${url}`);
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) {
        console.log(`${label} is ready.`);
        return;
      }
      lastError = new Error(`${label} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    if (elapsedSeconds >= nextLogAt) {
      console.log(
        `Still waiting for ${label} (${elapsedSeconds}s): ${lastError?.message || 'not reachable yet'}`,
      );
      nextLogAt = elapsedSeconds + 10;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError?.message || 'unknown error'}`);
}

process.on('SIGINT', () => {
  stopAll('SIGINT');
  process.exit(130);
});
process.on('SIGTERM', () => {
  stopAll('SIGTERM');
  process.exit(143);
});

assertPrerequisites();
ensureSnapSiteEnv();
printLinks();

try {
  console.log('Starting local snap (watch) + companion dApp...');
  run('yarn', ['start'], { cwd: SNAP_ROOT });
  await waitFor(SNAP_SITE_URL, 'snap companion dApp');

  console.log('Building wallet plugin package...');
  await runChecked('npm', ['run', 'build'], { cwd: PLUGIN_ROOT });

  console.log(`Starting wallet example at ${WALLET_EXAMPLE_URL}`);
  run('npm', ['run', 'dev'], { cwd: EXAMPLE_ROOT });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stopAll();
  process.exit(1);
}
