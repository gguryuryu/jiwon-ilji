// 서버를 실제로 띄워서 화면 파일·저장·보안 규칙을 확인한다(윈도우 경로 구분자 문제도 여기서 잡힌다).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = 4900 + Math.floor(Math.random() * 90);

function request(path, { method = 'GET', body = null, host = `127.0.0.1:${port}`, headers = {}, to = port } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: to, path, method, headers: { host: host.replace(String(port), String(to)), 'content-type': 'application/json', ...headers } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function startServer(dataDir, { args = [], env = {}, at = port } = {}) {
  const child = spawn(process.execPath, ['server.mjs', ...args], { cwd: root, env: { ...process.env, PORT: String(at), JOB_TRACKER_DATA_PATH: join(dataDir, 'job-search.json'), ...env } });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exited = new Promise(resolve => child.on('exit', code => resolve(code)));
  return { child, exited, output: () => output };
}

async function waitForServer(to = port) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await request('/api/data', { to })).status === 200) return; } catch { /* 아직 뜨는 중 */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('서버가 뜨지 않았습니다.');
}

test('서버: 화면 파일, 저장 충돌, 경로·호스트 차단, 중복 실행', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'jiwon-ilji-'));
  const server = startServer(dataDir);
  t.after(async () => { server.child.kill(); await server.exited; await rm(dataDir, { recursive: true, force: true }); });
  await waitForServer();

  await t.test('첫 화면과 js·글꼴 파일을 내준다', async () => {
    assert.equal((await request('/')).status, 200);
    const script = await request('/js/main.js');
    assert.equal(script.status, 200);
    assert.match(script.headers['content-type'], /javascript/);
    assert.equal((await request('/fonts/PretendardVariable.woff2')).status, 200);
    // 맥 앱의 작은 타이머 창
    const mini = await request('/mini.html');
    assert.equal(mini.status, 200);
    assert.match(mini.headers['content-type'], /html/);
    assert.equal((await request('/js/mini.js')).status, 200);
  });

  await t.test('폴더 밖의 파일은 내주지 않는다', async () => {
    for (const path of ['/js/..%2Fserver.mjs', '/js/..%5Cserver.mjs', '/js/%2E%2E/%2E%2E/package.json', '/data/job-search.json', '/server.mjs']) {
      assert.equal((await request(path)).status, 404, path);
    }
  });

  await t.test('다른 주소(Host)로 들어온 요청은 막는다', async () => {
    assert.equal((await request('/api/data', { host: 'evil.example' })).status, 403);
  });

  await t.test('업데이트는 앱의 POST 요청만 허용하고 다른 사이트의 요청은 차단한다', async () => {
    assert.equal((await request('/api/update')).status, 404);
    assert.equal((await request('/api/update', { method: 'POST' })).status, 403);
    assert.equal((await request('/api/update', { method: 'POST', headers: { 'x-jiwon-ilji': '1', origin: 'https://evil.example' } })).status, 403);
  });

  await t.test('판 번호가 맞을 때만 저장하고, 어긋나면 409와 최신 데이터를 준다', async () => {
    const empty = JSON.parse((await request('/api/data')).text);
    assert.deepEqual(empty.postings, []);
    const saved = await request('/api/data', { method: 'PUT', body: { ...empty, postings: [{ id: 'p', organization: 'A' }] } });
    assert.equal(saved.status, 200);
    assert.equal(JSON.parse(saved.text).revision, 1);
    const stale = await request('/api/data', { method: 'PUT', body: { ...empty, revision: 0 } });
    assert.equal(stale.status, 409);
    assert.equal(JSON.parse(stale.text).data.postings[0].organization, 'A');
  });

  await t.test('이미 켜져 있으면 두 번째 실행은 안내만 하고 정상 종료한다', async () => {
    const second = startServer(dataDir);
    assert.equal(await second.exited, 0);
    assert.match(second.output(), /이미 실행 중/);
  });
});

test('앱 창 모드(--exit-when-closed): 창을 닫거나 신호가 끊기면 서버가 스스로 꺼진다', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'jiwon-ilji-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const signal = { 'x-jiwon-ilji': '1' };

  await t.test('전용 헤더 없는 신호는 막고, 작별 신호를 받으면 꺼진다', async () => {
    const at = port + 100;
    const server = startServer(dataDir, { args: ['--exit-when-closed'], env: { JIWON_BYE_MS: '300' }, at });
    t.after(() => server.child.kill());
    await waitForServer(at);
    assert.equal((await request('/api/ping', { method: 'POST', body: { id: 'a' }, to: at })).status, 403);
    assert.equal((await request('/api/ping', { method: 'POST', body: { id: 'a' }, headers: signal, to: at })).status, 200);
    assert.equal((await request('/api/ping', { method: 'POST', body: { id: 'b' }, headers: signal, to: at })).status, 200);
    await request('/api/bye', { method: 'POST', body: { id: 'a' }, headers: signal, to: at });
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal((await request('/api/data', { to: at })).status, 200, '다른 창(b)이 남아 있으면 켜져 있다');
    await request('/api/bye', { method: 'POST', body: { id: 'b' }, headers: signal, to: at });
    assert.equal(await server.exited, 0);
  });

  await t.test('아무 신호도 없으면 기다렸다가 꺼진다', async () => {
    const at = port + 101;
    const server = startServer(dataDir, { args: ['--exit-when-closed'], env: { JIWON_IDLE_MS: '600' }, at });
    t.after(() => server.child.kill());
    await waitForServer(at);
    assert.equal(await server.exited, 0);
  });

  await t.test('앱 창 모드가 아니면 작별 신호를 받아도 켜져 있다', async () => {
    const at = port + 102;
    const server = startServer(dataDir, { env: { JIWON_BYE_MS: '100' }, at });
    t.after(async () => { server.child.kill(); await server.exited; });
    await waitForServer(at);
    await request('/api/bye', { method: 'POST', body: { id: 'a' }, headers: signal, to: at });
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal((await request('/api/data', { to: at })).status, 200);
  });
});
