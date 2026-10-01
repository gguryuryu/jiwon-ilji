import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGitUpdater, desktopGitCandidates } from '../lib/update.mjs';

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
