// 서버 저장: 판 번호 확인, 재시도, 다른 창과 맞추기, 자동 저장
import { syncEditor } from './experiences.js';
import { mergeInto } from './merge.js';
import { migrate } from './model.js';
import { data, emptyData, setData } from './state.js';
import { isEditing, safeRender, setSaveState, showToast } from './ui.js';

let pendingSave = false;

let saveQueue = Promise.resolve();

let editorTimer;

// ---------- 저장 ----------
// revision: 서버 파일의 판 번호. 저장할 때 함께 보내서, 다른 창이 먼저 저장했으면 예전 내용으로 덮어쓰지 않게 한다.
let revision = 0;

// 마지막으로 서버와 같았던 내용. 충돌이 나면 이것을 기준으로 양쪽 변경을 합친다.
let baseSnapshot = '{}';
let saveWaiting = false;

let saveRetries = 0;
let saveError = ''; // 마지막 저장 실패 이유(업데이트 안내에 함께 보여 준다)

let retryTimer;

const channel = 'BroadcastChannel' in window ? new BroadcastChannel('jiwon-ilji') : null;

export function persist() {
  setSaveState('저장 중…');
  if (saveRetries > 5) saveRetries = 0; // 포기한 뒤 다시 편집하면 새로 시도한다.
  // 이미 기다리는 저장이 있으면 그 저장이 보낼 때의 최신 내용을 함께 보낸다.
  if (saveWaiting) return saveQueue;
  saveWaiting = true;
  saveQueue = saveQueue.catch(() => {}).then(sendSave);
  return saveQueue;
}

async function sendSave() {
  saveWaiting = false;
  clearTimeout(retryTimer);
  const sent = JSON.stringify(data);
  let response;
  try {
    response = await fetch('/api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, revision }) });
  } catch { return retrySave('앱 서버에 연결하지 못했어요'); }
  let result = {};
  try { result = await response.json(); } catch { /* 본문이 없어도 상태 코드로 판단한다. */ }
  if (response.status === 409 && result.data) { mergeConflict(result.data); return; }
  if (!response.ok) return retrySave(result.error || `서버 오류 (${response.status})`);
  revision = result.revision; baseSnapshot = sent; saveRetries = 0;
  setSaveState('저장됨');
  channel?.postMessage({ type: 'saved', revision });
}

// 저장이 실패하면 1초, 2초, 4초… 간격으로 다시 시도하고, 여섯 번째에도 안 되면 알린다.
function retrySave(reason) {
  saveRetries += 1; saveError = reason;
  if (saveRetries > 5) {
    setSaveState('저장 오류');
    showToast(`저장하지 못했어요 · ${reason}`, { label: '다시 시도', run: () => { saveRetries = 0; persist(); } });
    return;
  }
  setSaveState('저장 재시도 중…');
  retryTimer = setTimeout(persist, Math.min(1000 * 2 ** (saveRetries - 1), 16_000));
}

window.addEventListener('online', () => { if (saveRetries) { saveRetries = 0; persist(); } });

// 처음 불러온 내용으로 시작한다.
export function startFromServer(loaded) {
  revision = loaded?.revision || 0; if (loaded) delete loaded.revision;
  setData(loaded && Array.isArray(loaded.postings) ? migrate(loaded) : emptyData());
  baseSnapshot = JSON.stringify(data);
}

// 서버의 최신 내용으로 바꾼다(이 창에 보내지 않은 편집이 없을 때만 쓴다).
function applyServerData(serverData) {
  const copy = { ...serverData };
  revision = copy.revision || 0; delete copy.revision;
  setData(migrate(copy)); baseSnapshot = JSON.stringify(data);
  saveRetries = 0; setSaveState('저장됨');
  safeRender();
}

// 다른 창이 먼저 저장했을 때: 양쪽 변경을 합친 뒤 최신 판 위에 다시 저장한다.
function mergeConflict(serverData) {
  const server = { ...serverData }; const serverRevision = server.revision || 0; delete server.revision;
  mergeInto(data, JSON.parse(baseSnapshot), server);
  revision = serverRevision; baseSnapshot = JSON.stringify(server);
  showToast('다른 창에서 바뀐 내용과 합쳐서 저장했어요.');
  safeRender();
  persist();
}

// 다른 창이 저장했으면 최신 내용을 불러온다. 이 창에 아직 보내지 않은 편집이 있거나 편집 중이면 미룬다.
export let refreshPending = false;

export async function refreshFromServer() {
  if (saveWaiting || pendingSave || isEditing()) { refreshPending = true; return; }
  refreshPending = false;
  try {
    const latest = await (await fetch('/api/data')).json();
    if ((latest.revision || 0) > revision && !saveWaiting && !pendingSave) applyServerData(latest);
  } catch { /* 서버에 못 닿으면 다음 기회에 다시 확인한다. */ }
}

channel?.addEventListener('message', event => { if (event.data?.type === 'saved' && event.data.revision > revision) refreshFromServer(); });

export function saveCurrentEditor() {
  clearTimeout(editorTimer);
  if (syncEditor() || pendingSave) { pendingSave = false; persist(); }
}

// 기다리던 자동 저장을 취소하고 바로 저장한다.
export function saveNow() {
  clearTimeout(editorTimer); pendingSave = false; persist();
}

// 업데이트 직전에는 재시도 예약뿐 아니라 실제 저장 완료까지 확인한다.
export async function saveBeforeUpdate() {
  saveCurrentEditor();
  persist();
  for (;;) {
    const pending = saveQueue;
    await pending;
    if (pending === saveQueue && !saveWaiting) break;
  }
  if (!saveRetries) return;
  // 앱 서버가 꺼졌으면(잠자기에서 깨어난 뒤 등) 이 창을 닫지 말고 앱을 다시 켜야 적은 내용이 저장된다.
  if (/연결하지 못했어요/.test(saveError)) throw new Error('앱 서버가 꺼져 있어 저장하지 못했어요. 이 창은 닫지 말고 지원일지 아이콘을 다시 눌러 켠 뒤, 업데이트를 다시 눌러 주세요.');
  throw new Error(`작성한 내용을 아직 저장하지 못했어요(${saveError}). 저장이 완료된 뒤 업데이트를 다시 눌러 주세요.`);
}

export function scheduleSave() {
  pendingSave = true;
  clearTimeout(editorTimer);
  editorTimer = setTimeout(saveCurrentEditor, 450);
}

// 탭을 닫을 때 아직 저장되지 않은 내용을 보낸다. keepalive는 본문 64KB 제한이 있어 작을 때만 쓴다.
window.addEventListener('pagehide', () => {
  clearTimeout(editorTimer);
  if (!syncEditor() && !pendingSave) return;
  pendingSave = false;
  const body = JSON.stringify({ ...data, revision });
  fetch('/api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: new Blob([body]).size < 60_000 }).catch(() => {});
});
