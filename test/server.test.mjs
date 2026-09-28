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

function request(path, { method = 'GET', body = null, host = `127.0.0.1:${port}` } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { host, 'content-type': 'application/json' } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function startServer(dataDir) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), JOB_TRACKER_DATA_PATH: join(dataDir, 'job-search.json') } });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exited = new Promise(resolve => child.on('exit', code => resolve(code)));
  return { child, exited, output: () => output };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await request('/api/data')).status === 200) return; } catch { /* 아직 뜨는 중 */ }
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
  });

  await t.test('폴더 밖의 파일은 내주지 않는다', async () => {
    for (const path of ['/js/..%2Fserver.mjs', '/js/..%5Cserver.mjs', '/js/%2E%2E/%2E%2E/package.json', '/data/job-search.json', '/server.mjs']) {
      assert.equal((await request(path)).status, 404, path);
    }
  });

  await t.test('다른 주소(Host)로 들어온 요청은 막는다', async () => {
    assert.equal((await request('/api/data', { host: 'evil.example' })).status, 403);
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
