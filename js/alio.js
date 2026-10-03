// 잡알리오 공고 받기: 공공데이터포털 인증키로 진행 중인 공공기관 공고를 받아, 고른 조건에 맞는 것만 달력에 띄운다.
// 달력에 뜬 공고는 구글 캘린더 공고처럼 눌러서 '지원 현황에 추가'할 때만 지원 현황에 들어간다.
import { alioEvents, alioOptions, emptyAlioFilter, itAlioFilter, matchesAlio } from './alio-model.js';
import { renderCalendar } from './calendar.js';
import { $ } from './dom.js';
import { eventFieldCache } from './event-dialog.js';
import { data, view } from './state.js';
import { persist } from './store.js';
import { safeRender, showToast } from './ui.js';
import { escapeHtml, minutesAgo } from './util.js';

export const alioState = { connected: false, syncing: false, items: [], fetchedAt: 0, error: '' };

const dialog = $('#alio-dialog');
const form = $('#alio-form');
let draft = emptyAlioFilter(); // 창에서 고르는 중인 조건

const groups = [['regions', '근무지'], ['ncs', 'NCS 분야'], ['hire', '고용형태'], ['kinds', '채용구분']];

// 받아 온 공고로 달력의 잡알리오 일정을 바꾼다. 바뀐 게 있으면 저장하고 다시 그린다.
function applyAlio() {
  const incoming = alioEvents(alioState.items, data.alioFilter);
  const previous = data.calendarEvents.filter(event => event.source === 'alio');
  if (JSON.stringify(previous) === JSON.stringify(incoming)) return false;
  const before = new Map(previous.map(event => [event.id, event]));
  for (const event of incoming) if (before.get(event.id)?.description !== event.description) eventFieldCache.delete(event.id);
  data.calendarEvents = [...data.calendarEvents.filter(event => event.source !== 'alio'), ...incoming];
  persist();
  return true;
}

export async function syncAlio({ quiet = true, refresh = false } = {}) {
  // 뒤에 숨은 창이 예전 내용으로 저장하지 않도록, 지금 보고 있는 창에서만 받는다.
  if (!alioState.connected || alioState.syncing || document.hidden) return;
  alioState.syncing = true; updateDetail();
  try {
    const response = await fetch(`/api/alio/postings${refresh ? '?refresh=1' : ''}`); const result = await response.json();
    if (response.status === 404) { alioState.connected = false; return; }
    if (!response.ok) throw new Error(result.error || '잡알리오 공고를 받지 못했어요.');
    alioState.items = result.items || []; alioState.fetchedAt = result.fetchedAt || Date.now(); alioState.error = '';
    const changed = applyAlio();
    if (!quiet) showToast(data.alioFilter ? `잡알리오 공고 ${data.calendarEvents.filter(event => event.source === 'alio').length}개가 달력에 있어요.` : '받은 공고 중에서 달력에 띄울 조건을 골라 주세요.');
    if (changed) safeRender();
    if (dialog.open) renderFilters();
  } catch (error) {
    alioState.error = /Failed to fetch|Unexpected token/i.test(error.message) ? '앱 서버에 연결하지 못했어요.' : error.message;
    if (!quiet) showToast(alioState.error);
  } finally {
    alioState.syncing = false; updateDetail();
  }
}

// ---------- 창 ----------

function updateDetail() {
  const detail = $('#alio-sync-detail'); if (!detail) return;
  detail.textContent = alioState.syncing ? '잡알리오에서 받는 중…' : alioState.error ? `오류 · ${alioState.error}` : alioState.fetchedAt ? `잡알리오 · ${minutesAgo(alioState.fetchedAt)} 받음 · 30분마다 새로 받아요` : '';
  detail.classList.toggle('error', Boolean(alioState.error));
}

function renderFilters() {
  const options = alioOptions(alioState.items);
  for (const [group] of groups) {
    const chosen = new Set(draft[group]);
    // 지금 받은 공고에 없는 값이라도 전에 골라 둔 것은 남겨 둔다.
    const values = [...options[group], ...draft[group].filter(value => !options[group].some(([name]) => name === value)).map(value => [value, 0])];
    $(`#alio-form [data-group="${group}"]`).innerHTML = values.length
      ? values.map(([value, count]) => `<button type="button" class="alio-chip" data-value="${escapeHtml(value)}" aria-pressed="${chosen.has(value)}">${escapeHtml(value)}<span>${count}</span></button>`).join('')
      : '<span class="alio-empty">받은 공고가 없어요</span>';
  }
  updateCount();
}

function updateCount() {
  const total = alioState.items.length;
  const matched = alioState.items.filter(item => matchesAlio(item, draft)).length;
  $('#alio-count').innerHTML = total
    ? `진행 중인 공고 <strong>${total}</strong>개 중 <strong>${matched}</strong>개가 달력에 떠요.${matched > 150 ? ' 조건을 더 골라 보세요.' : ''}`
    : '아직 받은 공고가 없어요.';
}

function showStep(connected) {
  $('#alio-dialog-title').textContent = connected ? '잡알리오 공고 조건' : '잡알리오 공고 받기';
  $('#alio-connect').hidden = connected; $('#alio-filters').hidden = !connected;
  $('#alio-disconnect').hidden = !connected; $('#alio-sync-now').hidden = !connected;
  $('#alio-submit').textContent = connected ? '저장' : '연결';
}

function fillFields() {
  form.elements.keywords.value = draft.keywords || '';
  form.elements.excludes.value = draft.excludes || '';
  form.elements.skipReplacement.checked = draft.skipReplacement !== false;
}

export function openAlioDialog() {
  form.reset();
  draft = structuredClone(data.alioFilter || emptyAlioFilter());
  fillFields();
  showStep(alioState.connected);
  if (alioState.connected) { renderFilters(); updateDetail(); if (!alioState.items.length) syncAlio(); }
  dialog.showModal();
  if (!alioState.connected) form.elements.key.focus();
}

form.addEventListener('click', event => {
  if (event.target.closest('#alio-preset-it')) { draft = itAlioFilter(); fillFields(); renderFilters(); return; }
  const chip = event.target.closest('.alio-chip'); if (!chip) return;
  const group = chip.closest('[data-group]').dataset.group; const value = chip.dataset.value;
  draft[group] = draft[group].includes(value) ? draft[group].filter(item => item !== value) : [...draft[group], value];
  chip.setAttribute('aria-pressed', String(draft[group].includes(value)));
  updateCount();
});

form.addEventListener('input', event => {
  if (event.target.name === 'keywords') draft.keywords = event.target.value;
  if (event.target.name === 'excludes') draft.excludes = event.target.value;
  if (event.target.name === 'skipReplacement') draft.skipReplacement = event.target.checked;
  if (event.target.name !== 'key') updateCount();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#alio-submit');
  if (!alioState.connected) {
    const key = form.elements.key.value.trim();
    if (!key) { form.elements.key.focus(); return; }
    button.disabled = true; button.textContent = '확인하는 중…';
    try {
      const response = await fetch('/api/alio', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '연결하지 못했어요.');
      alioState.connected = true; alioState.error = '';
      showStep(true);
      await syncAlio({ refresh: false });
      renderFilters();
      showToast('잡알리오에 연결했어요. 달력에 띄울 조건을 골라 주세요.');
    } catch (error) { showToast(/Failed to fetch|Unexpected token/i.test(error.message) ? '앱 서버에 연결하지 못했어요.' : error.message); showStep(false); }
    finally { button.disabled = false; }
    return;
  }
  data.alioFilter = { ...draft, keywords: form.elements.keywords.value.trim(), excludes: form.elements.excludes.value.trim(), skipReplacement: form.elements.skipReplacement.checked };
  persist(); applyAlio();
  dialog.close();
  if (view === 'calendar') renderCalendar();
  showToast(`잡알리오 공고 ${data.calendarEvents.filter(item => item.source === 'alio').length}개를 달력에 띄웠어요. 지원할 공고만 눌러서 추가하세요.`);
});

$('#alio-sync-now').addEventListener('click', () => syncAlio({ quiet: false, refresh: true }));

$('#alio-disconnect').addEventListener('click', async () => {
  if (!confirm('잡알리오 연결을 해제할까요? 달력에 띄운 잡알리오 공고도 사라집니다(지원 현황에 추가한 공고는 그대로 남아요).')) return;
  try {
    const response = await fetch('/api/alio', { method: 'DELETE' });
    if (!response.ok) throw new Error((await response.json()).error || '연결을 해제하지 못했어요.');
    Object.assign(alioState, { connected: false, items: [], fetchedAt: 0, error: '' });
    data.calendarEvents = data.calendarEvents.filter(item => item.source !== 'alio');
    await persist(); dialog.close(); if (view === 'calendar') renderCalendar(); showToast('잡알리오 연결을 해제했어요.');
  } catch (error) { showToast(error.message); }
});

// 서버가 30분 동안 기억해 두므로 자주 물어도 공공데이터포털 조회 횟수는 늘지 않는다.
setInterval(() => syncAlio(), 30 * 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncAlio(); });
setInterval(updateDetail, 60_000);
