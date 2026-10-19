import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rm, stat, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = join(root, '.local/hello');
const pidFile = join(runtime, 'demo.pid');
const ticketFile = join(runtime, 'ticket.txt');
const url = 'http://127.0.0.1:5050';
const command = process.argv[2] ?? 'start';

async function runningPid() {
  try {
    const pid = Number((await readFile(pidFile, 'utf8')).trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    const { stdout } = await exec('ps', ['-p', String(pid), '-o', 'command=']);
    // A stale PID file must never signal an unrelated process.
    return stdout.includes('hello-demo.mjs') ? pid : null;
  } catch { return null; }
}

async function copyTicket() {
  const ticket = await readFile(ticketFile, 'utf8');
  await new Promise((resolve, reject) => {
    const child = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('Clipboard unavailable')));
    child.stdin.on('error', () => {});
    child.stdin.end(ticket.trim());
  });
  console.log('Hello attachment ticket copied to clipboard. Paste it into the app.');
}

if (command === 'background') {
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  if (await runningPid()) throw new Error('Hello demo is already running.');
  const log = await open(join(runtime, 'demo.log'), 'a', 0o600);
  try {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'start'], {
      cwd: root, env: process.env, detached: true,
      stdio: ['ignore', log.fd, log.fd],
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    console.log('Starting Hello demo in the background. Logs: .local/hello/demo.log');
  } finally { await log.close(); }
} else if (command === 'ticket') {
  await copyTicket();
} else if (command === 'stop') {
  const pid = await runningPid();
  if (pid) {
    process.kill(pid, 'SIGTERM');
    console.log('Stopping the Hello demo services.');
  } else {
    console.log('No Hello demo supervisor is running.');
  }
} else if (command === 'start') {
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  if (await runningPid()) throw new Error('Hello demo is already running. Use npm run demo:hello:stop first.');
  const binary = resolve(process.env.LOCHO_BINARY ?? join(root, '../locho/target/debug/locho'));
  await stat(binary);
  const children = [];
  let stopping = false;

  function signalService(child, signal) {
    try {
      // Flutter/Puro spawn nested processes. Signal this service's isolated
      // process group so stopping the wrapper also stops its Dart web server.
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }

  async function shutdown(code = 0) {
    if (stopping) return;
    stopping = true;
    await Promise.allSettled(children.reverse().map((child) => new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => signalService(child, 'SIGKILL'), 10000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      signalService(child, 'SIGTERM');
    })));
    await rm(pidFile, { force: true });
    process.exit(code);
  }

  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  await writeFile(pidFile, String(process.pid), { mode: 0o600 });

  function start(name, executable, args, ready, env = process.env, timeout = 30000) {
    const child = spawn(executable, args, {
      cwd: root, env, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    return new Promise((resolve, reject) => {
      let output = '', admitted = false;
      const timer = setTimeout(() => reject(new Error(`${name} startup timed out. See .local/hello/demo.log.`)), timeout);
      const data = (chunk) => {
        process.stdout.write(chunk);
        output = (output + chunk.toString()).slice(-16384);
        if (!admitted && ready.test(output)) {
          admitted = true;
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on('data', data);
      child.stderr.on('data', data);
      child.once('error', () => { clearTimeout(timer); reject(new Error(`Could not start ${name}.`)); });
      child.once('exit', () => {
        clearTimeout(timer);
        if (!admitted) reject(new Error(`${name} stopped during startup.`));
        else if (!stopping) {
          console.error(`${name} stopped; closing the demo services.`);
          void shutdown(1);
        }
      });
    });
  }

  try {
    await start('Caddy', 'caddy', [
      'run', '--config', 'demo/hello/Caddyfile', '--adapter', 'caddyfile',
    ], /serving initial configuration/);
    const hostEnv = { ...process.env, LOCHO_STATE_DIR: join(runtime, 'host-state') };
    await start('Locho host', binary, [
      'host', '--config', 'demo/hello/locho.toml',
    ], /- hello \(tcp\)/, hostEnv);
    const { stdout } = await exec(binary, [
      'share', 'hello', '--config', 'demo/hello/locho.toml', '--ticket',
    ], { cwd: root, env: hostEnv, timeout: 30000 });
    if (!stdout.trim().startsWith('locho1:')) throw new Error('Locho did not return an attachment ticket.');
    await writeFile(ticketFile, `${stdout.trim()}\n`, { mode: 0o600 });
    try { await copyTicket(); }
    catch { console.log('Ticket saved to .local/hello/ticket.txt.'); }
    await start('Flutter web', 'flutter', [
      'run', '-d', 'web-server', '--web-port', '5050', '--web-hostname', '127.0.0.1',
      '--target', 'lib/hello_main.dart',
    ], /is being served at http:\/\/127\.0\.0\.1:5050/, process.env, 180000);
    console.log(`\nHello demo is ready: ${url}`);
    console.log('Paste the ticket, click Connect, then Fetch page.');
    console.log('Stop with npm run demo:hello:stop (or Ctrl+C in the foreground).');
    if (process.platform === 'darwin') {
      await exec('open', ['-a', 'Google Chrome', url]).catch(() => {});
    }
  } catch (error) {
    console.error(error.message);
    await shutdown(1);
  }
} else {
  throw new Error('Use start, background, ticket, or stop.');
}
