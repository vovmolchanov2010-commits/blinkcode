#!/usr/bin/env node
// Запуск всего проекта одной командой: `npm start` из корня репозитория.
// 1) сервер, Postgres и Redis — в Docker; 2) приложение — в Expo Go на телефоне по QR-коду.
// Нужны только Docker Desktop и Node.js 22+.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const API_PORT = 3000;

function step(message) {
  console.log(`\n\x1b[1m▸ ${message}\x1b[0m`);
}

function fail(message) {
  console.error(`\n\x1b[31m✖ ${message}\x1b[0m`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: isWindows, ...options });
  return result.status === 0;
}

function succeeds(command, args) {
  return spawnSync(command, args, { stdio: 'ignore', shell: isWindows }).status === 0;
}

/** IP компьютера в локальной сети — по нему телефон достучится до сервера. */
function lanAddress() {
  const virtual = /^(docker|br-|veth|vmnet|vboxnet|utun|tun|tap|lo|vEthernet)/i;
  const candidates = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (virtual.test(name)) continue;
    for (const a of addresses ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      candidates.push(a.address);
    }
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return candidates.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

async function waitForApi(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${API_PORT}/health`);
      if (res.ok) return true;
    } catch {
      // сервер ещё стартует
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) fail(`Нужен Node.js 22 или новее (сейчас ${process.versions.node}): https://nodejs.org`);

step('Проверяю Docker');
if (!succeeds('docker', ['info'])) {
  fail('Docker не запущен. Установи и открой Docker Desktop: https://www.docker.com/products/docker-desktop/');
}

step('Запускаю сервер, базу и Redis (первый раз — несколько минут на сборку)');
if (!run('docker', ['compose', '--profile', 'app', 'up', '-d', '--build'])) {
  fail('Не удалось запустить контейнеры — смотри ошибку выше.');
}
if (!(await waitForApi(180_000))) {
  fail('Сервер не отвечает. Логи: docker compose logs api');
}
console.log(`Сервер работает: http://localhost:${API_PORT}`);

if (!existsSync(join(root, 'node_modules'))) {
  step('Устанавливаю зависимости приложения (один раз)');
  if (!run('npx', ['--yes', 'pnpm@10.28.0', 'install'])) fail('Не удалось установить зависимости.');
}

const ip = lanAddress();
if (!ip) fail('Не нашёл IP компьютера в локальной сети. Подключись к Wi-Fi.');
const apiUrl = `http://${ip}:${API_PORT}`;

step('Запускаю приложение');
console.log(`
  1. Установи на телефон «Expo Go» (App Store / Google Play).
  2. Телефон должен быть в той же Wi-Fi, что и компьютер.
  3. Отсканируй QR-код ниже: на iPhone — камерой, на Android — в Expo Go.
  4. Войди с любым номером: код подставится сам.

  Сервер для телефона: ${apiUrl}
  Остановить: Ctrl+C, затем \`docker compose --profile app down\`
`);

const expo = spawn('npx', ['expo', 'start', '--go'], {
  cwd: join(root, 'apps', 'mobile'),
  stdio: 'inherit',
  shell: isWindows,
  env: { ...process.env, EXPO_PUBLIC_API_URL: apiUrl },
});
expo.on('exit', (code) => process.exit(code ?? 0));
