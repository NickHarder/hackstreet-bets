// Shared helpers: start a real server on a free port with a throwaway data
// directory, and a tiny HTTP client that keeps its own login cookie.
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SERVER = path.join(ROOT, 'server', 'index.js');
export const ADMIN_PASSWORD = 'test-admin';

export async function freePort() {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}

export function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hackstreet-test-'));
}

export async function startServer({ dataDir = tempDataDir(), port, env = {}, expectFailure = false } = {}) {
  port = port || (await freePort());
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ADMIN_PASSWORD, DEMO: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  const started = await Promise.race([
    (async () => { for (let i = 0; i < 200; i++) { if (output.includes('is up')) return true; await new Promise((r) => setTimeout(r, 25)); } return false; })(),
    exited.then(() => false),
  ]);
  const server = {
    url: `http://127.0.0.1:${port}`, port, dataDir, child, exited,
    output: () => output,
    async stop() { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await exited; } },
  };
  if (!started && !expectFailure) { await server.stop(); throw new Error(`Server did not start:\n${output}`); }
  return server;
}

export class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async req(method, p, body) {
    const res = await fetch(this.base + p, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    return { status: res.status, ...data };
  }
  get(p) { return this.req('GET', p); }
  post(p, body = {}) { return this.req('POST', p, body); }
  patch(p, body = {}) { return this.req('PATCH', p, body); }
  del(p) { return this.req('DELETE', p); }
  async signIn(name, pin = '1234') { return this.post('/api/auth', { name, pin }); }
  async balance() { return (await this.get('/api/me')).me.user.balance; }
  async makeAdmin() { return this.post('/api/admin/login', { password: ADMIN_PASSWORD }); }
}

/** Create and sign in a client. */
export async function player(base, name) {
  const c = new Client(base);
  const r = await c.signIn(name);
  if (r.status !== 200) throw new Error(`sign in failed for ${name}: ${r.error}`);
  return c;
}
