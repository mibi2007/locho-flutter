import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { acceptanceFixture } from '../../locho_sdk_examples/scripts/acceptance-fixture.mjs';

const device = process.env.LOCHO_DEVICE;
if (!device) throw new Error('Set LOCHO_DEVICE to a connected Android/iOS device ID.');
const fixture = await acceptanceFixture(process.env.LOCHO_BINARY ?? resolve('../locho/target/debug/locho'));
const directory = await mkdtemp(join(tmpdir(), 'flutter-locho-native-'));
try {
  const defines = join(directory, 'defines.json');
  await writeFile(defines, JSON.stringify({ LOCHO_TICKET: fixture.ticket }), { mode: 0o600 });
  const child = spawn('flutter', [
    'test', 'integration_test/native_notes_test.dart', '-d', device,
    `--dart-define-from-file=${defines}`,
  ], { stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Native integration test timed out'));
    }, 600000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); resolve(code); });
  });
  if (code !== 0) throw new Error('Native integration test failed');
} finally {
  await fixture.cleanup();
  await rm(directory, { recursive: true, force: true });
}
