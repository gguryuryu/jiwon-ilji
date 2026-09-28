// OpenAI API 키를 저장하고 바로 인증을 확인한다.
// macOS는 키체인에, 그 밖(윈도우 등)은 data/settings.json에 저장한다(이 폴더는 git과 백업 파일에 들어가지 않는다).
import { execFile } from 'node:child_process';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { userInfo } from 'node:os';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';

const run = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const settingsPath = join(root, 'data', 'settings.json');

async function saveKey(key) {
  if (process.platform === 'darwin') {
    await run('/usr/bin/security', ['add-generic-password', '-a', userInfo().username, '-s', 'local-job-tracker-openai', '-l', '지원일지 AI 추출', '-U', '-w', key]);
    return '키체인';
  }
  let settings = {};
  try { settings = JSON.parse(await readFile(settingsPath, 'utf8')); } catch { /* 처음 저장 */ }
  await mkdir(dirname(settingsPath), { recursive: true });
  const temporary = `${settingsPath}.tmp`;
  await writeFile(temporary, JSON.stringify({ ...settings, openaiKey: key }, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, settingsPath);
  return 'data/settings.json';
}

async function verify(key) {
  const response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(12_000) });
  if (response.ok) return 'OpenAI API 키 인증을 확인했습니다. 앱에서 공고 링크를 다시 넣어 보세요.';
  if (response.status === 401) throw new Error('OpenAI에서 유효하지 않은 키라고 응답했습니다. 새 키를 발급받아 다시 실행해 주세요.');
  throw new Error(`인증 상태를 확인하지 못했습니다 (HTTP ${response.status}). 앱에서 공고 링크로 다시 시도해 주세요.`);
}

const prompt = createInterface({ input: process.stdin, output: process.stdout });
try {
  console.log('지원일지의 AI 자동 추출에 쓸 OpenAI API 키를 붙여 넣고 Enter를 누르세요.');
  console.log('키는 이 컴퓨터에만 저장되고, 공고 페이지를 읽을 때만 쓰입니다.');
  const key = (await prompt.question('API 키: ')).trim();
  if (!key) throw new Error('키를 입력하지 않았습니다.');
  console.log(`${await saveKey(key)}에 저장했습니다. 인증을 확인하는 중…`);
  console.log(await verify(key));
} catch (error) {
  console.error(error.name === 'TimeoutError' || /fetch failed/i.test(error.message) ? '저장은 했지만 OpenAI 연결이 지연되어 인증을 확인하지 못했습니다.' : error.message);
  process.exitCode = 1;
} finally {
  await prompt.question('Enter를 누르면 닫힙니다.').catch(() => {});
  prompt.close();
}
