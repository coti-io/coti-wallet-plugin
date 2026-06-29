import { spawn } from 'node:child_process';

if (!process.env.MOCK_GRANT_PRIVATE_KEY) {
  console.error('MOCK_GRANT_PRIVATE_KEY is required.');
  console.error('Example: MOCK_GRANT_PRIVATE_KEY=0x... npm run dev:onboarding');
  process.exit(1);
}

const processes = [];
const env = {
  ...process.env,
  VITE_WALLETCONNECT_PROJECT_ID:
    process.env.VITE_WALLETCONNECT_PROJECT_ID || 'your_walletconnect_project_id_here',
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

const build = run('npm', ['--prefix', '..', 'run', 'build']);

build.on('exit', (code) => {
  if (code !== 0) {
    stopAll();
    process.exit(code ?? 1);
  }

  run('npm', ['exec', 'tsx', 'mock-grant-server.ts']);
  run('npm', ['run', 'dev']);
});

