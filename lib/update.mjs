import { execFile } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
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
