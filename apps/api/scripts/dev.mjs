// Dev loop: tsc --watch + restart node on successful compiles.
// (tsx/esbuild cannot emit decorator metadata, which Nest's DI requires.)
import { spawn } from 'node:child_process';

let server = null;
const start = () => {
  server?.kill();
  server = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/src/main.js'], { stdio: 'inherit' });
};
const tsc = spawn(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], { stdio: ['ignore', 'pipe', 'inherit'] });
tsc.stdout.on('data', (buf) => {
  const out = buf.toString();
  process.stdout.write(out);
  if (/Found 0 errors/.test(out)) start();
});
process.on('SIGINT', () => { server?.kill(); tsc.kill(); process.exit(0); });
