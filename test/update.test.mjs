import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, access } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGitUpdater, createUpdater, desktopGitCandidates } from '../lib/update.mjs';

const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true })).stdout.trim();

async function repository(t) {
  const dir = await mkdtemp(join(tmpdir(), 'jiwon-update-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const origin = join(dir, 'remote.git'); const author = join(dir, 'author'); const friend = join(dir, '친구 앱');
  await git(dir, 'init', '--bare', '--initial-branch=main', origin);
  await git(dir, 'clone', origin, author);
  await git(author, 'config', 'user.name', 'Update Test');
  await git(author, 'config', 'user.email', 'test@example.invalid');
  await git(author, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(author, '.gitignore'), 'data/\n');
  await writeFile(join(author, 'app.txt'), 'version 1');
  await git(author, 'add', '.'); await git(author, 'commit', '-m', 'initial'); await git(author, 'push', '-u', 'origin', 'main');
  await git(dir, 'clone', origin, friend);
  return { dir, origin, author, friend };
}

async function publish(author) {
  await writeFile(join(author, 'app.txt'), 'version 2');
  await git(author, 'add', '.'); await git(author, 'commit', '-m', 'update'); await git(author, 'push');
}

test('친구의 한글 경로에서 실제 pull을 하고, 개인 기록과 설정은 그대로 두며 최신 버전도 구분한다', async t => {
  const { author, friend } = await repository(t);
  await mkdir(join(friend, 'data'));
  await writeFile(join(friend, 'data', 'job-search.json'), '{"personal":"기록"}');
  await writeFile(join(friend, 'data', 'settings.json'), '{"personal":"설정"}');
  await publish(author);
  const update = createGitUpdater(friend);
  const result = await update();
  assert.equal(result.updated, true);
  assert.equal(result.revision, (await git(author, 'rev-parse', 'HEAD')).slice(0, 8));
  assert.equal(await readFile(join(friend, 'app.txt'), 'utf8'), 'version 2');
  assert.equal(await readFile(join(friend, 'data', 'job-search.json'), 'utf8'), '{"personal":"기록"}');
  assert.equal(await readFile(join(friend, 'data', 'settings.json'), 'utf8'), '{"personal":"설정"}');
  assert.equal((await update()).updated, false);
});

test('친구가 수정한 파일을 덮어쓰지 않고, 수정 정리 뒤에는 다시 업데이트할 수 있다', async t => {
  const { author, friend } = await repository(t); await publish(author);
  await writeFile(join(friend, 'app.txt'), 'local edit');
  const update = createGitUpdater(friend);
  await assert.rejects(update(), /수정한 앱 파일/);
  assert.equal(await readFile(join(friend, 'app.txt'), 'utf8'), 'local edit');
  await git(friend, 'restore', 'app.txt');
  assert.equal((await update()).updated, true);
});

test('갈라진 커밋은 자동 병합하지 않는다', async t => {
  const { author, friend } = await repository(t);
  await git(friend, 'config', 'user.name', 'Friend'); await git(friend, 'config', 'user.email', 'friend@example.invalid');
  await git(friend, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(friend, 'local.txt'), 'local');
  await git(friend, 'add', '.'); await git(friend, 'commit', '-m', 'local commit');
  const head = await git(friend, 'rev-parse', 'HEAD'); await publish(author);
  await assert.rejects(createGitUpdater(friend)(), /만든 커밋이 있어서/);
  assert.equal(await git(friend, 'rev-parse', 'HEAD'), head);
});

test('Git 폴더가 아니거나 기본 브랜치에 없는 커밋이면 이해할 수 있는 안내를 내준다', async t => {
  const { dir, friend } = await repository(t);
  await assert.rejects(createGitUpdater(dir)(), /Git으로 받은 앱 폴더가 아니/);
  await git(friend, 'config', 'user.name', 'Friend'); await git(friend, 'config', 'user.email', 'friend@example.invalid');
  await git(friend, 'config', 'commit.gpgsign', 'false');
  await git(friend, 'checkout', '-b', 'local-only');
  await git(friend, 'commit', '--allow-empty', '-m', 'local only');
  const head = await git(friend, 'rev-parse', 'HEAD');
  await assert.rejects(createGitUpdater(friend)(), /main 브랜치로 바꾼 뒤/);
  assert.equal(await git(friend, 'rev-parse', 'HEAD'), head);
});

test('PR 브랜치가 합쳐진 뒤 GitHub에서 지워졌으면 main으로 옮겨서 업데이트한다', async t => {
  const { author, friend } = await repository(t);
  await git(friend, 'config', 'user.name', 'Friend'); await git(friend, 'config', 'user.email', 'friend@example.invalid');
  await git(friend, 'config', 'commit.gpgsign', 'false');
  await git(friend, 'checkout', '-b', 'fix/icon');
  await writeFile(join(friend, 'icon.txt'), 'icon'); await git(friend, 'add', '.'); await git(friend, 'commit', '-m', 'icon');
  await git(friend, 'push', '-u', 'origin', 'fix/icon');
  await git(author, 'pull', 'origin', 'fix/icon', '--no-rebase', '--no-edit'); await git(author, 'push');
  await git(author, 'push', 'origin', '--delete', 'fix/icon');
  await publish(author);
  const result = await createGitUpdater(friend)();
  assert.equal(result.updated, true);
  assert.equal(await git(friend, 'branch', '--show-current'), 'main');
  assert.equal(await readFile(join(friend, 'app.txt'), 'utf8'), 'version 2');
});

test('알 수 없는 Git 오류는 Git 메시지를 함께 보여 준다', async t => {
  const { friend } = await repository(t);
  await git(friend, 'remote', 'set-url', 'origin', join(friend, 'missing.git'));
  await assert.rejects(createGitUpdater(friend)(), /Git 메시지: .+/);
});

test('두 창의 동시 업데이트는 한 번만 진행한다', async t => {
  const { friend } = await repository(t);
  const update = createGitUpdater(friend); const first = update();
  await assert.rejects(update(), error => error.status === 409);
  await first;
});

test('GitHub Desktop의 윈도우 설치 폴더는 새 버전부터 확인한다', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jiwon-desktop-git-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const version of ['app-3.9.1', 'app-3.10.0', 'packages']) await mkdir(join(dir, 'GitHubDesktop', version), { recursive: true });
  const candidates = await desktopGitCandidates('win32', { LOCALAPPDATA: dir });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0], join(dir, 'GitHubDesktop', 'app-3.10.0', 'resources', 'app', 'git', 'cmd', 'git.exe'));
});

// GitHub 압축 파일과 같은 모양(전역 pax 머리글, 맨 앞 폴더, 긴 경로는 pax)으로 tar.gz를 만든다.
function tarHeader(name, size, mode, type) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write(mode.toString(8).padStart(7, '0'), 100); header.write('0000000', 108); header.write('0000000', 116);
  header.write(size.toString(8).padStart(11, '0'), 124); header.write('00000000000', 136);
  header.write('        ', 148); header.write(type, 156); header.write('ustar\0', 257); header.write('00', 263);
  let sum = 0; for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return header;
}
const padded = data => Buffer.concat([data, Buffer.alloc((512 - data.length % 512) % 512)]);
function paxRecord(key, value) {
  const record = `${key}=${value}\n`; let length = Buffer.byteLength(record) + 2;
  while (String(length).length + 1 + Buffer.byteLength(record) !== length) length = String(length).length + 1 + Buffer.byteLength(record);
  return Buffer.from(`${length} ${record}`);
}
function tarball(sha, files) {
  const top = `jiwon-ilji-${sha.slice(0, 7)}`;
  const comment = paxRecord('comment', sha);
  const parts = [tarHeader('pax_global_header', comment.length, 0o666, 'g'), padded(comment), tarHeader(`${top}/`, 0, 0o755, '5')];
  for (const [path, content, mode = 0o644] of files) {
    const name = path.startsWith('../') ? path : `${top}/${path}`; const data = Buffer.from(content);
    if (Buffer.byteLength(name) > 99) { const pax = paxRecord('path', name); parts.push(tarHeader('pax', pax.length, 0o644, 'x'), padded(pax)); }
    parts.push(tarHeader(name.slice(0, 40), data.length, mode, '0'), padded(data));
  }
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}
function fakeGitHub() {
  const revisions = {}; const calls = []; let latest = '';
  return {
    calls,
    publish(sha, files) { revisions[sha] = tarball(sha, files); latest = sha; },
    fetch: async url => {
      calls.push(url);
      if (url.includes('/commits/')) return new Response(latest);
      return new Response(revisions[url.split('/').pop()]);
    },
  };
}
const sha = digit => digit.repeat(40);
const longPath = '지원일지.app/Contents/Resources/아주-긴-한글-폴더-이름/아이콘-파일.txt';

test('Git 없이 ZIP으로 받은 폴더도 압축 파일로 업데이트하고, 개인 기록과 직접 만든 파일은 그대로 둔다', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jiwon-zip-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'data'));
  await writeFile(join(dir, 'data', 'job-search.json'), '{"personal":"기록"}');
  await writeFile(join(dir, 'server.mjs'), 'old');
  await writeFile(join(dir, '내 메모.txt'), 'mine');
  const github = fakeGitHub();
  github.publish(sha('1'), [
    ['server.mjs', 'version 1'], ['start.command', '#!/bin/sh', 0o755], [longPath, 'icon'], ['old.js', 'gone soon'],
    ['data/job-search.json', '{"overwritten":true}'], ['../escape.txt', 'outside'], ['.git/config', 'nope'],
  ]);
  const update = createUpdater(dir, { fetch: github.fetch });
  assert.deepEqual(await update(), { updated: true, revision: '11111111' });
  assert.equal(await readFile(join(dir, 'server.mjs'), 'utf8'), 'version 1');
  assert.equal(await readFile(join(dir, ...longPath.split('/')), 'utf8'), 'icon');
  assert.equal(await readFile(join(dir, 'data', 'job-search.json'), 'utf8'), '{"personal":"기록"}');
  assert.equal(await readFile(join(dir, '내 메모.txt'), 'utf8'), 'mine');
  await assert.rejects(access(join(dir, '..', 'escape.txt')));
  await assert.rejects(access(join(dir, '.git')));
  if (process.platform !== 'win32') assert.equal((await stat(join(dir, 'start.command'))).mode & 0o111, 0o111);

  const calls = github.calls.length;
  assert.deepEqual(await update(), { updated: false, revision: '11111111' });
  assert.equal(github.calls.length, calls + 1, '최신이면 압축 파일을 다시 받지 않는다');

  github.publish(sha('2'), [['server.mjs', 'version 2'], ['start.command', '#!/bin/sh', 0o755], [longPath, 'icon']]);
  assert.equal((await update()).updated, true);
  assert.equal(await readFile(join(dir, 'server.mjs'), 'utf8'), 'version 2');
  await assert.rejects(access(join(dir, 'old.js')), '새 버전에서 빠진 앱 파일은 지운다');
  assert.equal(await readFile(join(dir, '내 메모.txt'), 'utf8'), 'mine');
});

test('압축 파일 업데이트는 인터넷 오류와 GitHub 요청 제한을 안내하고 파일을 건드리지 않는다', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jiwon-zip-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'server.mjs'), 'old');
  const offline = createUpdater(dir, { fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(offline(), error => error.status === 502 && /인터넷 연결/.test(error.message));
  const limited = createUpdater(dir, { fetch: async () => new Response('', { status: 403 }) });
  await assert.rejects(limited(), /몇 분 뒤/);
  assert.equal(await readFile(join(dir, 'server.mjs'), 'utf8'), 'old');
});

test('Git으로 받은 폴더는 Git으로 업데이트한다', async t => {
  const { author, friend } = await repository(t); await publish(author);
  const result = await createUpdater(friend, { fetch: async () => { throw new Error('압축 파일을 받으면 안 된다'); } })();
  assert.equal(result.updated, true);
  assert.equal(await readFile(join(friend, 'app.txt'), 'utf8'), 'version 2');
});
