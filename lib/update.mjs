import { execFile } from 'node:child_process';
import { access, readdir, readFile, writeFile, rename, rm, mkdir, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

const exec = promisify(execFile);
// Git 안내문이 한국어 등으로 번역되면 원인을 가려내지 못하므로 영어로 받는다.
const gitEnvironment = env => ({ ...env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', GIT_SSH_COMMAND: env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes -o ConnectTimeout=15' });

export class UpdateError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}

// GitHub Desktop만 설치한 컴퓨터도 번들 Git을 찾는다. 토큰이나 비밀번호는 읽지 않는다.
export async function desktopGitCandidates(platform = process.platform, env = process.env) {
  if (platform === 'darwin') return ['/Applications', join(homedir(), 'Applications')].map(base => join(base, 'GitHub Desktop.app', 'Contents', 'Resources', 'app', 'git', 'bin', 'git'));
  if (platform !== 'win32' || !env.LOCALAPPDATA) return [];
  const base = join(env.LOCALAPPDATA, 'GitHubDesktop');
  const versions = await readdir(base).catch(() => []);
  return versions.filter(name => /^app-\d/.test(name)).sort((a, b) => b.localeCompare(a, 'en', { numeric: true })).map(name => join(base, name, 'resources', 'app', 'git', 'cmd', 'git.exe'));
}

async function findGit(env) {
  const bundled = await desktopGitCandidates(process.platform, env);
  const candidates = process.platform === 'darwin' ? [...bundled, 'git', '/opt/homebrew/bin/git', '/usr/local/bin/git'] : ['git', ...bundled];
  for (const candidate of candidates) {
    try {
      if (candidate !== 'git') await access(candidate);
      await exec(candidate, ['--version'], { env, timeout: 5000, windowsHide: true });
      return candidate;
    } catch { /* 다음 실행 경로를 확인한다. */ }
  }
  throw new UpdateError('Git을 찾지 못했어요. Git 또는 GitHub Desktop을 설치한 뒤 앱을 다시 켜 주세요.');
}

function pullError(error) {
  const detail = `${error.stderr || ''}\n${error.stdout || ''}`;
  if (error.killed || error.code === 'ETIMEDOUT') return new UpdateError('업데이트 연결이 지연되고 있어요. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.', 504);
  if (/Authentication failed|could not read Username|terminal prompts disabled|Permission denied|Repository not found|credential/i.test(detail)) return new UpdateError('GitHub 저장소에 접근하지 못했어요. 앱 폴더에 연결된 저장소 주소를 확인해 주세요.');
  if (/resolve host|Could not resolve|Failed to connect|unable to access|Connection timed out|Network is unreachable/i.test(detail)) return new UpdateError('GitHub에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.', 502);
  if (/fast-forward|divergent|Not possible to fast-forward/i.test(detail)) return new UpdateError('이 컴퓨터에서 만든 커밋이 있어서 자동 업데이트하지 못했어요. 그 커밋을 정리한 뒤 다시 눌러 주세요.');
  if (/overwritten|untracked working tree|local changes/i.test(detail)) return new UpdateError('이 컴퓨터에서 수정한 앱 파일이 있어요. 변경 내용을 정리한 뒤 다시 눌러 주세요.');
  const line = detail.split('\n').map(text => text.replace(/^(fatal|error):\s*/, '').trim()).filter(Boolean).at(-1);
  return new UpdateError(line ? `업데이트하지 못했어요. Git 메시지: ${line.slice(0, 160)}` : '업데이트하지 못했어요. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.');
}

async function defaultBranch(run, remote) {
  for (const ref of [`${remote}/HEAD`, `${remote}/main`, `${remote}/master`]) {
    const name = await run(['rev-parse', '--abbrev-ref', ref]).catch(() => '');
    if (name && name !== `${remote}/HEAD`) return name;
  }
  return '';
}

// 요청에서 명령어나 경로를 받지 않고 앱 폴더의 현재 브랜치만 업데이트한다.
export function createGitUpdater(root, { env = process.env } = {}) {
  let busy = false;
  return async () => {
    if (busy) throw new UpdateError('이미 업데이트 중이에요. 잠시 기다려 주세요.', 409);
    busy = true;
    try {
      const environment = gitEnvironment(env);
      const git = await findGit(environment);
      const run = async (args, timeout = 10_000) => (await exec(git, args, { cwd: root, env: environment, timeout, maxBuffer: 1024 * 1024, windowsHide: true })).stdout.trim();
      try { await run(['rev-parse', '--show-toplevel']); }
      catch { throw new UpdateError('Git으로 받은 앱 폴더가 아니에요. 저장소를 Clone해서 설치한 앱에서 업데이트할 수 있어요.'); }
      if (await run(['status', '--porcelain', '--untracked-files=no'])) throw new UpdateError('이 컴퓨터에서 수정한 앱 파일이 있어요. 변경 내용을 정리한 뒤 다시 눌러 주세요.');
      const branch = await run(['rev-parse', '--abbrev-ref', 'HEAD']);
      const remote = (branch !== 'HEAD' && await run(['config', `branch.${branch}.remote`]).catch(() => '')) || 'origin';
      try { await run(['fetch', '--prune', remote], 90_000); }
      catch (error) { throw pullError(error); }
      const before = await run(['rev-parse', 'HEAD']);
      const upstream = await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => '');
      // PR용 브랜치가 합쳐진 뒤 GitHub에서 지워지면 그 브랜치로는 더 받을 게 없다.
      // 내 커밋이 모두 기본 브랜치에 들어 있을 때만 기본 브랜치로 옮겨서 잃는 작업이 없게 한다.
      if (!upstream) {
        const main = await defaultBranch(run, remote);
        const merged = main && await run(['merge-base', '--is-ancestor', 'HEAD', main]).then(() => true, () => false);
        if (!merged) throw new UpdateError(`업데이트할 브랜치가 연결되어 있지 않아요. 앱 폴더를 ${main ? main.slice(remote.length + 1) : 'main'} 브랜치로 바꾼 뒤 다시 눌러 주세요.`);
        try { await run(['checkout', main.slice(remote.length + 1)]); }
        catch (error) { throw pullError(error); }
      }
      try { await run(['merge', '--ff-only', '@{upstream}'], 30_000); }
      catch (error) { throw pullError(error); }
      const after = await run(['rev-parse', 'HEAD']);
      return { updated: before !== after, revision: after.slice(0, 8) };
    } finally { busy = false; }
  };
}

// ---- Git 없이 받기: 공개 저장소의 압축 파일을 받아 앱 파일만 바꾼다 ----

export const UPDATE_REPO = 'gguryuryu/jiwon-ilji';
const VERSION_FILE = '.app-version.json';

function paxPath(data) {
  let path;
  for (let at = 0; at < data.length;) {
    const space = data.indexOf(0x20, at);
    const length = Number(data.subarray(at, space).toString());
    if (space < 0 || !length) break;
    const record = data.subarray(space + 1, at + length - 1).toString('utf8');
    if (record.startsWith('path=')) path = record.slice(5);
    at += length;
  }
  return path;
}

// GitHub 압축 파일(tar)을 읽는다. 긴 한글 경로는 pax/GNU 머리글로 따로 온다.
export function untar(archive) {
  const files = [];
  let longPath;
  for (let at = 0; at + 512 <= archive.length;) {
    const header = archive.subarray(at, at + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, length) => { const raw = header.subarray(start, start + length); const end = raw.indexOf(0); return raw.subarray(0, end < 0 ? length : end).toString('utf8'); };
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1) || '0';
    const data = archive.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') { longPath = paxPath(data) ?? longPath; continue; }
    if (type === 'L') { longPath = data.toString('utf8').replace(/\0+$/, ''); continue; }
    const prefix = header.subarray(257, 263).toString() === 'ustar\0' ? field(345, 155) : '';
    const path = longPath ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longPath = undefined;
    if (type === '0' || type === '7') files.push({ path, mode: parseInt(field(100, 8).trim() || '644', 8), data: Buffer.from(data) });
  }
  return files;
}

// 압축 파일 맨 앞 폴더(jiwon-ilji-<커밋>/)를 떼고, 개인 기록·Git 폴더·앱 밖 경로는 건드리지 않는다.
function appPath(path, { stripTop = false } = {}) {
  const parts = path.split('/').slice(stripTop ? 1 : 0).filter(part => part && part !== '.');
  if (!parts.length || parts.some(part => part === '..' || /[\\:]/.test(part))) return null;
  if (['data', '.git', 'node_modules', VERSION_FILE].includes(parts[0])) return null;
  return parts.join('/');
}

async function placeFile(root, { path, mode, data }) {
  const target = join(root, ...path.split('/'));
  const same = await readFile(target).then(old => old.equals(data), () => false);
  if (same) return;
  // 실행 중인 파일도 안전하게 바뀌도록 옆에 써 두고 이름만 바꿔 끼운다.
  const temporary = `${target}.update-${process.pid}`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, data);
  if (mode & 0o111) await chmod(temporary, 0o755).catch(() => {});
  try { await rename(temporary, target); }
  catch (error) { await rm(temporary, { force: true }); throw new UpdateError(`${path} 파일을 바꾸지 못했어요. 앱을 껐다 켠 뒤 다시 눌러 주세요.`); }
}

export function createArchiveUpdater(root, { fetch = globalThis.fetch, repo = UPDATE_REPO, branch = 'main' } = {}) {
  async function get(url, headers = {}) {
    let response;
    try { response = await fetch(url, { headers: { 'User-Agent': 'jiwon-ilji', ...headers }, signal: AbortSignal.timeout(90_000) }); }
    catch (error) {
      if (error?.name === 'TimeoutError') throw new UpdateError('업데이트 연결이 지연되고 있어요. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.', 504);
      throw new UpdateError('GitHub에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.', 502);
    }
    if (response.status === 403 || response.status === 429) throw new UpdateError('GitHub 요청이 잠시 많아요. 몇 분 뒤 다시 눌러 주세요.', 503);
    if (!response.ok) throw new UpdateError(`GitHub에서 새 버전을 받지 못했어요(${response.status}). 잠시 후 다시 눌러 주세요.`, 502);
    return response;
  }
  return async () => {
    const installed = await readFile(join(root, VERSION_FILE), 'utf8').then(JSON.parse, () => null);
    const revision = (await (await get(`https://api.github.com/repos/${repo}/commits/${branch}`, { Accept: 'application/vnd.github.sha' })).text()).trim();
    if (!/^[0-9a-f]{40}$/.test(revision)) throw new UpdateError('GitHub에서 최신 버전 정보를 읽지 못했어요. 잠시 후 다시 눌러 주세요.', 502);
    if (installed?.revision === revision) return { updated: false, revision: revision.slice(0, 8) };
    const archive = Buffer.from(await (await get(`https://codeload.github.com/${repo}/tar.gz/${revision}`)).arrayBuffer());
    let entries;
    try { entries = untar(gunzipSync(archive)); }
    catch { throw new UpdateError('받은 파일이 손상되었어요. 다시 눌러 주세요.', 502); }
    const files = entries.map(file => ({ ...file, path: appPath(file.path, { stripTop: true }) })).filter(file => file.path);
    if (!files.some(file => file.path === 'server.mjs')) throw new UpdateError('받은 파일이 지원일지 앱이 아니에요. 잠시 후 다시 눌러 주세요.', 502);
    for (const file of files) await placeFile(root, file);
    // 지난번 업데이트로 받았는데 새 버전에서 빠진 앱 파일만 지운다. 직접 만든 파일은 목록에 없으니 그대로 둔다.
    const current = new Set(files.map(file => file.path));
    for (const old of installed?.files || []) {
      const path = typeof old === 'string' && appPath(old);
      if (path && !current.has(path)) await rm(join(root, ...path.split('/')), { force: true });
    }
    await writeFile(join(root, VERSION_FILE), JSON.stringify({ revision, files: [...current] }, null, 2));
    return { updated: true, revision: revision.slice(0, 8) };
  };
}

// Git으로 받은 폴더이고 Git이 있으면 Git으로, 아니면(ZIP으로 받았거나 Git이 없으면) 압축 파일로 받는다.
export function createUpdater(root, options = {}) {
  const env = options.env || process.env;
  const viaGit = createGitUpdater(root, { env });
  const viaArchive = createArchiveUpdater(root, options);
  let busy = false;
  return async () => {
    if (busy) throw new UpdateError('이미 업데이트 중이에요. 잠시 기다려 주세요.', 409);
    busy = true;
    try {
      const cloned = await access(join(root, '.git')).then(() => true, () => false);
      const hasGit = cloned && await findGit(gitEnvironment(env)).then(() => true, () => false);
      return await (hasGit ? viaGit() : viaArchive());
    } finally { busy = false; }
  };
}
