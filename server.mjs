import http from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookup } from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { privateAddress, decode, meta, jobPosting, decodedHtml, normalizedDate, normalizedTime, normalizedEmployment, cleanOrganization, pageTitleParts, roleFromTitle, jobAlioFields, textDeadline, pageText, parseEventFields } from './lib/parse.mjs';
import { createGitUpdater } from './lib/update.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.JOB_TRACKER_DATA_PATH ? resolve(process.env.JOB_TRACKER_DATA_PATH) : join(root, 'data', 'job-search.json');
const settingsPath = join(dirname(dataPath), 'settings.json');
const port = Number(process.env.PORT || 4173);
const empty = { version: 1, postings: [], experiences: [], calendarEvents: [] };
const pullUpdate = createGitUpdater(root);
let updateTask = null;

// Node.js가 너무 오래된 버전이면 알 수 없는 오류 대신 안내하고 끝낸다.
if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error(`Node.js ${process.versions.node}이(가) 설치되어 있어요. 지원일지는 Node.js 22 이상이 필요합니다. https://nodejs.org 에서 LTS 버전을 설치해 주세요.`);
  process.exit(1);
}

async function loadData() {
  try { return JSON.parse(await readFile(dataPath, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return empty;
    throw error;
  }
}

// 저장은 한 번에 하나씩 처리한다. 동시에 들어온 요청이 같은 파일을 덮어쓰며 부딪히지 않게 한다.
let writeChain = Promise.resolve();
function serialized(task) {
  const run = writeChain.then(task, task);
  writeChain = run.catch(() => {});
  return run;
}

// 파일을 바로 덮어쓰지 않고, 겹치지 않는 이름의 임시 파일에 먼저 쓴 뒤 바꿔 끼운다.
async function writeAtomic(path, text, options = 'utf8') {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, options);
  await rename(temporary, path);
}

class ConflictError extends Error {
  constructor(current) { super('다른 창에서 먼저 저장한 내용이 있습니다.'); this.current = current; }
}

// 보낸 쪽이 알고 있던 판(revision)이 지금 파일의 판과 다르면, 예전 내용으로 덮어쓰지 않고 거절한다.
function saveData(value) {
  return serialized(async () => {
    if (!value || value.version !== 1 || !Array.isArray(value.postings) || !Array.isArray(value.experiences) || !Array.isArray(value.calendarEvents)) {
      throw new Error('저장할 데이터 형식이 올바르지 않습니다.');
    }
    const current = await loadData();
    const currentRevision = current.revision || 0;
    if ((value.revision || 0) !== currentRevision) throw new ConflictError(current);
    const next = { ...value, revision: currentRevision + 1 };
    await writeAtomic(dataPath, JSON.stringify(next, null, 2));
    return next.revision;
  });
}

// 구글 캘린더 비공개 iCal 주소는 비밀번호처럼 다뤄야 하므로 백업 파일(job-search.json)과 분리해 둔다.
async function loadSettings() {
  try { return JSON.parse(await readFile(settingsPath, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function saveSettings(value) {
  return serialized(() => writeAtomic(settingsPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 }));
}

function googleIcalUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { url = null; }
  if (!url || url.protocol !== 'https:' || url.hostname !== 'calendar.google.com' || !url.pathname.startsWith('/calendar/ical/') || !url.pathname.endsWith('.ics')) {
    throw new Error('구글 캘린더의 "iCal 형식의 비공개 주소"를 붙여 넣어 주세요. https://calendar.google.com/calendar/ical/… 로 시작합니다.');
  }
  return url.href;
}

async function fetchGoogleCalendar(raw) {
  let url = await publicHttps(raw);
  let response;
  for (let index = 0; index < 4; index++) {
    response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    url = await publicHttps(new URL(response.headers.get('location'), url).href);
  }
  if (response.status === 404) throw new Error('캘린더 주소를 찾지 못했습니다. 비공개 주소를 재설정했다면 새 주소로 다시 연결해 주세요.');
  if (!response.ok) throw new Error(`구글 캘린더를 읽지 못했습니다 (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 15_000_000) throw new Error('캘린더 파일이 너무 큽니다.');
  const text = bytes.toString('utf8');
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('캘린더 형식의 응답이 아닙니다. 주소를 다시 확인해 주세요.');
  return text;
}

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 5_000_000) throw new Error('파일 크기가 너무 큽니다.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function publicHttps(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('공개 HTTPS 공고 링크만 읽을 수 있습니다.');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(item => privateAddress(item.address))) throw new Error('공개 공고 링크만 읽을 수 있습니다.');
  return url;
}

async function fetchPosting(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetch(url, {
        redirect: 'manual', signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LocalJobTracker/1.0)' },
      });
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

async function preview(raw) {
  let url = await publicHttps(raw);
  let response;
  for (let index = 0; index < 4; index++) {
    response = await fetchPosting(url);
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    url = await publicHttps(new URL(response.headers.get('location'), url).href);
  }
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('이 사이트에서는 공고 정보를 자동으로 읽지 못했습니다. 직접 입력할 수 있습니다.');
  const html = decodedHtml(response, Buffer.from(await response.arrayBuffer())).slice(0, 1_500_000);
  const job = jobPosting(html);
  const title = decode(job?.title) || meta(html, 'og:title') || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const values = {
    url: url.href,
    organization: decode(job?.hiringOrganization?.name),
    originalTitle: title,
    role: roleFromTitle(title),
    deadline: normalizedDate(job?.validThrough),
    deadlineTime: '',
    employmentType: normalizedEmployment(job?.employmentType),
  };
  let method = job ? 'structured' : 'title';
  if (url.hostname === 'job.alio.go.kr' && url.pathname.endsWith('/recruitview.do')) {
    Object.assign(values, jobAlioFields(html));
    method = 'job-alio';
  }
  if (!values.organization || !values.role) {
    const fromTitle = pageTitleParts(title, meta(html, 'og:site_name'));
    values.organization ||= fromTitle.organization;
    values.role ||= fromTitle.role;
  }
  values.organization = cleanOrganization(values.organization);
  if (url.hostname.endsWith('incruit.com')) {
    const closing = html.match(/<em>\s*마감\s*<\/em>[\s\S]{0,300}?<em>\s*((?:\d{4}|\d{2})[.\/-]\d{1,2}[.\/-]\d{1,2}[^<]*)<\/em>/i)?.[1];
    if (closing) { values.deadline = normalizedDate(closing) || values.deadline; values.deadlineTime = normalizedTime(closing); }
  }
  if (!values.deadline) {
    const found = textDeadline(pageText(html));
    if (found) Object.assign(values, found);
  }
  return { ...values, found: Boolean(values.organization || values.role || values.deadline), method };
}

// 일정에서 읽고, 빈칸이 남으면 공고 링크에서 채운다.
async function eventFields(event) {
  const { values, title, description } = parseEventFields(event);
  let method = values.organization && values.role ? 'event' : '';
  if ((!values.organization || !values.role) && values.url) {
    try {
      const page = await preview(values.url);
      for (const field of ['organization', 'role', 'employmentType']) if (!values[field] && page[field]) values[field] = page[field];
      if (page.url) values.url = page.url;
      method = 'link';
    } catch { /* 링크를 못 읽어도 일정에서 읽은 값은 그대로 쓴다. */ }
  }
  return { ...values, method: method || 'event', complete: Boolean(values.organization && values.role && values.deadline) };
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2' };
const files = { '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css' };
// js/, fonts/ 폴더의 파일만 내준다. '..' 같은 경로로 폴더 밖을 읽지 못하게 막는다.
const staticFolders = ['js', 'fonts'];
function staticFile(pathname) {
  if (files[pathname]) return join(root, files[pathname]);
  const [, folder, ...rest] = pathname.split('/');
  if (!staticFolders.includes(folder) || !rest.length || !mime[extname(pathname)]) return null;
  const filename = resolve(root, folder, ...rest.map(decodeURIComponent));
  return filename.startsWith(join(root, folder) + sep) ? filename : null;
}

// ---------- 앱 창을 닫으면 꺼지기(--exit-when-closed, 윈도우 바로가기에서 사용) ----------
// 열려 있는 화면은 30초마다 신호(ping)를 보내고, 닫힐 때 작별 신호(bye)를 보낸다.
// 열린 화면이 하나도 없으면 저장을 마친 뒤 서버를 끈다. 닫힐 때 신호를 놓쳐도 idleMs 뒤에는 꺼진다.
const exitWhenClosed = process.argv.includes('--exit-when-closed');
const idleMs = Number(process.env.JIWON_IDLE_MS || 150_000);
const clients = new Map();
let lastSeen = Date.now();

async function shutdown() {
  await writeChain.catch(() => {});
  await updateTask?.catch(() => {});
  server.close();
  process.exit(0);
}

// 오래 신호가 없는 화면은 닫힌 것으로 보고, 열린 화면이 하나도 없으면 끈다(창이 늦게 떠도 idleMs는 기다린다).
function sweep() {
  const now = Date.now();
  for (const [id, seen] of clients) if (now - seen > idleMs) clients.delete(id);
  if (!clients.size && now - lastSeen > idleMs) shutdown();
}

if (exitWhenClosed) setInterval(sweep, Math.min(15_000, idleMs / 3)).unref();

// 신호는 앱 화면만 보낼 수 있게 전용 헤더를 요구한다(다른 웹사이트는 이 헤더를 붙여 보낼 수 없다).
async function presence(request, response, kind) {
  if (request.headers['x-jiwon-ilji'] !== '1') return sendJson(response, 403, { error: '허용되지 않은 요청입니다.' });
  const { id } = await readBody(request).catch(() => ({}));
  if (typeof id !== 'string' || !id || id.length > 100) return sendJson(response, 400, { error: 'id가 필요합니다.' });
  lastSeen = Date.now();
  if (kind === 'ping') clients.set(id, lastSeen);
  // 창을 닫으면 잠깐 기다렸다가(새로 고침이면 곧 다시 신호가 온다) 남은 화면이 없으면 끈다.
  else { clients.delete(id); if (exitWhenClosed) setTimeout(() => { if (!clients.size) shutdown(); }, Number(process.env.JIWON_BYE_MS || 6000)); }
  return sendJson(response, 200, { ok: true });
}

const server = http.createServer(async (request, response) => {
  try {
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(request.headers.host || '')) return sendJson(response, 403, { error: '허용되지 않은 요청입니다.' });
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/api/update' && request.method === 'POST') {
      if (request.headers['x-jiwon-ilji'] !== '1' || (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)) return sendJson(response, 403, { error: '허용되지 않은 요청입니다.' });
      if (updateTask) return sendJson(response, 409, { error: '이미 업데이트 중이에요. 잠시 기다려 주세요.' });
      updateTask = pullUpdate();
      try { return sendJson(response, 200, await updateTask); }
      catch (error) { return sendJson(response, error.status || 500, { error: error.status ? error.message : '업데이트하지 못했어요. 잠시 후 다시 눌러 주세요.' }); }
      finally { updateTask = null; }
    }
    if (url.pathname === '/api/data' && request.method === 'GET') return sendJson(response, 200, await loadData());
    if (url.pathname === '/api/ping' && request.method === 'POST') return presence(request, response, 'ping');
    if (url.pathname === '/api/bye' && request.method === 'POST') return presence(request, response, 'bye');
    if (url.pathname === '/api/data' && request.method === 'PUT') {
      try { return sendJson(response, 200, { saved: true, revision: await saveData(await readBody(request)) }); }
      catch (error) {
        if (error instanceof ConflictError) return sendJson(response, 409, { error: error.message, data: error.current });
        throw error;
      }
    }
    if (url.pathname === '/api/calendar') {
      const settings = await loadSettings();
      if (request.method === 'GET') return sendJson(response, 200, { connected: Boolean(settings.googleIcalUrl) });
      if (request.method === 'PUT') {
        const { url: raw } = await readBody(request);
        let calendarUrl;
        try { calendarUrl = googleIcalUrl(raw); }
        catch (error) { return sendJson(response, 422, { error: error.message }); }
        await saveSettings({ ...settings, googleIcalUrl: calendarUrl });
        return sendJson(response, 200, { connected: true });
      }
      if (request.method === 'DELETE') {
        delete settings.googleIcalUrl;
        await saveSettings(settings);
        return sendJson(response, 200, { connected: false });
      }
    }
    if (url.pathname === '/api/calendar/ics' && request.method === 'GET') {
      const { googleIcalUrl: calendarUrl } = await loadSettings();
      if (!calendarUrl) return sendJson(response, 404, { error: '구글 캘린더가 연결되어 있지 않습니다.' });
      try { return sendJson(response, 200, { ics: await fetchGoogleCalendar(calendarUrl) }); }
      catch (error) {
        const message = error.name === 'TimeoutError' || /fetch failed|aborted due to timeout/i.test(error.message)
          ? '구글 캘린더 연결이 지연되고 있어요. 잠시 후 다시 시도합니다.' : error.message;
        return sendJson(response, 502, { error: message });
      }
    }
    if (url.pathname === '/api/event-fields' && request.method === 'POST') {
      return sendJson(response, 200, await eventFields(await readBody(request)));
    }
    if (url.pathname === '/api/preview' && request.method === 'GET') {
      try { return sendJson(response, 200, await preview(url.searchParams.get('url') || '')); }
      catch (error) {
        const message = error.name === 'TimeoutError' || /fetch failed|aborted due to timeout/i.test(error.message)
          ? '공고 사이트 연결이 지연되거나 차단됐어요. 다시 읽기를 눌러 주세요.' : error.message;
        return sendJson(response, 422, { error: message });
      }
    }
    const filename = request.method === 'GET' ? staticFile(url.pathname) : null;
    if (!filename) return sendJson(response, 404, { error: '찾을 수 없습니다.' });
    let body;
    try { body = await readFile(filename); } catch { return sendJson(response, 404, { error: '찾을 수 없습니다.' }); }
    // 글꼴은 바뀌지 않으므로 오래 캐시하고, 코드·화면 파일은 항상 새로 받는다.
    response.writeHead(200, { 'Content-Type': mime[extname(filename)], 'Cache-Control': extname(filename) === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-store' });
    response.end(body);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

const appUrl = `http://127.0.0.1:${port}`;

// --open: 서버가 뜨면 기본 브라우저로 앱을 연다(맥 앱 아이콘, start.command, start.bat에서 사용).
function openBrowser() {
  if (!process.argv.includes('--open')) return;
  const [command, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', appUrl]] : process.platform === 'darwin' ? ['open', [appUrl]] : ['xdg-open', [appUrl]];
  execFile(command, args, () => {});
}

// 이미 켜져 있으면 새로 띄우지 않고 브라우저만 연다. 다른 프로그램이 같은 포트를 쓰면 알아듣기 쉽게 안내한다.
server.on('error', async error => {
  if (error.code !== 'EADDRINUSE') throw error;
  const ours = await fetch(`${appUrl}/api/data`, { signal: AbortSignal.timeout(2000) }).then(response => response.ok).catch(() => false);
  if (ours) { console.log(`지원일지가 이미 실행 중이에요: ${appUrl}`); openBrowser(); return; }
  console.error(`${port}번 포트를 다른 프로그램이 쓰고 있어요. 그 프로그램을 끄거나, 다른 포트로 실행해 주세요 (예: PORT=4180 node server.mjs).`);
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  lastSeen = Date.now(); console.log(`지원일지: ${appUrl}${process.stdout.isTTY ? ' (이 창을 닫으면 앱이 꺼집니다)' : ''}`); openBrowser(); });
