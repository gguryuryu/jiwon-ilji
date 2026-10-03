// 월간 달력과 구글 캘린더 동기화
import { $, calendarDialog, main } from './dom.js';
import { eventFieldCache, readEventFields } from './event-dialog.js';
import { parseIcs } from './ics.js';
import { groupFor, isPostingEvent, shownTime } from './model.js';
import { data, view } from './state.js';
import { persist } from './store.js';
import { reducedMotion, safeRender, showToast } from './ui.js';
import { dateValue, escapeHtml, formatDate, formatDateLong, icon, minutesAgo, todayKey, validUrl } from './util.js';

export const calendarState = { connected: false, syncing: false, lastSyncedAt: 0, error: '' };

let showPersonalEvents = true;

try { showPersonalEvents = localStorage.getItem('showPersonalEvents') !== '0'; } catch { /* 저장소를 못 써도 기본값으로 동작한다. */ }

let shown = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

export function localEvents() {
  const events = [];
  for (const item of data.postings) {
    if (item.deadline) events.push({ id: `${item.id}:deadline`, source: 'local', kind: 'deadline', postingId: item.id, date: item.deadline, time: item.deadlineTime || '', title: `${item.organization} · 접수 마감`, short: item.organization, kindLabel: '접수 마감', description: item.role, url: item.url });
    if (item.nextDate && groupFor(item) === 'active') events.push({ id: `${item.id}:next`, source: 'local', kind: 'next', postingId: item.id, date: item.nextDate, time: item.nextTime || '', title: `${item.organization} · ${item.nextLabel || '다음 일정'}`, short: item.organization, kindLabel: item.nextLabel || '다음 일정', description: item.role, url: item.url });
  }
  return events;
}

// 이미 지원 현황에 등록한 공고의 캘린더 일정과, 같은 공고가 두 번 들어간 일정은 한 번만 보여 준다.
export function allEvents() {
  const fromEvents = new Set(data.postings.map(item => item.calendarEventId).filter(Boolean));
  const addedKeys = new Set(data.calendarEvents.filter(event => fromEvents.has(event.id)).map(event => `${event.title}|${event.date}`));
  const registered = new Set(data.postings.filter(item => validUrl(item.url) && item.deadline).map(item => `${validUrl(item.url)} ${item.deadline}`));
  const seen = new Set();
  const candidates = [...data.calendarEvents].sort((a, b) => Number(!shownTime(a)) - Number(!shownTime(b)));
  const imported = candidates.filter(event => {
    const posting = isPostingEvent(event);
    if (!posting) return showPersonalEvents;
    const key = `${event.title}|${event.date}`;
    if (fromEvents.has(event.id) || addedKeys.has(key) || seen.has(key)) return false;
    if (validUrl(event.url) && registered.has(`${validUrl(event.url)} ${event.date}`)) return false;
    seen.add(key);
    return true;
  });
  return [...localEvents(), ...imported].sort((a, b) => Number(!isPostingEvent(a)) - Number(!isPostingEvent(b)) || (shownTime(a) || '99').localeCompare(shownTime(b) || '99') || a.title.localeCompare(b.title, 'ko'));
}

// 아직 지원 현황에 없는, 마감이 지나지 않은 캘린더 공고
export const pendingCalendarPostings = () => allEvents().filter(event => event.source !== 'local' && isPostingEvent(event) && (event.endDate || event.date) >= todayKey());

export const eventClass = event => !isPostingEvent(event) ? 'personal' : event.source === 'google' ? 'google' : event.source === 'alio' ? 'alio' : event.source === 'external' ? 'external' : event.kind === 'next' ? 'next' : 'deadline';

// 달력 칸에는 회사 이름을 먼저 보여 준다. 'LG유플러스 | NW기술' → 'LG유플러스'
export const eventShort = event => event.short || String(event.title).split(/\s*[|｜]\s*/)[0];

export const eventKindLabel = event => event.kindLabel || (!isPostingEvent(event) ? '개인 일정' : event.source === 'google' ? '캘린더 공고' : event.source === 'alio' ? '잡알리오 공고' : '가져온 일정');

function calendarEventHtml(event, key) {
  const time = shownTime(event);
  return `<button type="button" class="calendar-event ${eventClass(event)}" data-action="open-event" data-id="${escapeHtml(event.id)}" title="${escapeHtml(`${time ? `${time} ` : ''}${event.title}`)}" aria-label="${escapeHtml(`${formatDate(key)} ${time} ${event.title}`)}"><span class="dot" aria-hidden="true"></span><span class="label">${escapeHtml(eventShort(event))}</span>${time ? `<span class="event-time">${escapeHtml(time)}</span>` : ''}</button>`;
}

function calendarStatusText() {
  if (!calendarState.connected) return '지원 현황의 마감·일정이 자동으로 표시됩니다';
  if (calendarState.syncing) return '구글 캘린더에서 가져오는 중…';
  if (calendarState.error) return `구글 캘린더 오류 · ${calendarState.error}`;
  return calendarState.lastSyncedAt ? `구글 캘린더 · ${minutesAgo(calendarState.lastSyncedAt)} 가져옴` : '구글 캘린더 연결됨';
}

function updateCalendarStatus() {
  const status = $('#calendar-status');
  if (status) { status.textContent = calendarStatusText(); status.classList.toggle('error', Boolean(calendarState.error)); }
  const detail = $('#calendar-sync-detail');
  if (detail) detail.textContent = calendarStatusText();
}

// ---------- 달 단위로 이어지는 달력: 아래로 내리면 다음 달, 위로 올리면 지난달이 붙는다 ----------
const monthKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const addMonth = (key, delta) => { const [year, month] = key.split('-').map(Number); return monthKey(new Date(year, month - 1 + delta, 1)); };
const thisMonth = () => monthKey(new Date());
// 너무 멀리까지 붙지 않게 오늘 기준 앞뒤 2년까지만.
const inBounds = key => key >= addMonth(thisMonth(), -24) && key <= addMonth(thisMonth(), 24);

// 그려 둔 달의 범위. 다시 그려도 같은 범위를 유지해야 스크롤 위치가 그대로 남는다.
let range = null;
let calendarObserver = null;

export function stepMonth(delta) { scrollToMonth(addMonth(monthKey(shown), delta)); }

export function showThisMonth() { scrollToMonth(thisMonth()); }

export function togglePersonalEvents() {
  showPersonalEvents = !showPersonalEvents;
  try { localStorage.setItem('showPersonalEvents', showPersonalEvents ? '1' : '0'); } catch { /* 이번 화면에서만 적용된다. */ }
  renderCalendar();
}

// 한 달치 달력. 앞뒤 달 날짜 칸은 비워 두어 같은 날짜가 두 번 나오지 않게 한다.
function monthHtml(key, map) {
  const [year, monthNumber] = key.split('-').map(Number); const month = monthNumber - 1;
  const offset = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const count = Math.ceil((offset + days) / 7) * 7;
  const today = todayKey();
  let cells = '';
  const weeks = Array.from({ length: count / 7 }, () => ({ visible: 0, more: false }));
  for (let index = 0; index < count; index++) {
    const date = new Date(year, month, index - offset + 1);
    if (date.getMonth() !== month) { cells += `<div class="calendar-day outside${index >= count - 7 ? ' last-week' : ''}" aria-hidden="true"></div>`; continue; }
    const dayKey = `${key}-${String(date.getDate()).padStart(2, '0')}`;
    const events = map.get(dayKey) || [];
    const week = weeks[Math.floor(index / 7)];
    week.visible = Math.max(week.visible, Math.min(events.length, 4));
    week.more ||= events.length > 4;
    const classes = ['calendar-day', index >= count - 7 ? 'last-week' : '', dayKey === today ? 'today' : '', dayKey < today ? 'past' : '', date.getDay() === 0 ? 'sunday' : date.getDay() === 6 ? 'saturday' : ''].filter(Boolean).join(' ');
    cells += `<div class="${classes}" aria-label="${escapeHtml(formatDateLong(dayKey))}${events.length ? `, 일정 ${events.length}개` : ''}"><div class="date-line"><span class="date-number">${date.getDate()}</span></div><div class="calendar-events">${events.slice(0, 4).map(event => calendarEventHtml(event, dayKey)).join('')}${events.length > 4 ? `<button type="button" class="calendar-more" data-action="more-events" data-date="${dayKey}">+${events.length - 4}개 더보기</button>` : ''}</div></div>`;
  }
  // 일정이 많은 주는 넉넉하게, 조용한 주는 좁게.
  const rowSizes = weeks.map(({ visible, more }) => ({ base: visible ? 36 + Math.max(visible - 1, 0) * 3 + (more ? 25 : 0) : 56, visible }));
  const gridRows = rowSizes.map(({ base, visible }) => `minmax(calc(${base}px + ${visible} * var(--calendar-event-height)), 1fr)`).join(' ');
  const minHeight = `calc(${rowSizes.reduce((sum, row) => sum + row.base, 0)}px + ${rowSizes.reduce((sum, row) => sum + row.visible, 0)} * var(--calendar-event-height))`;
  return `<section class="calendar-month" data-month="${key}" aria-label="${year}년 ${month + 1}월"><h2 class="month-heading">${year === new Date().getFullYear() ? '' : `${year}년 `}${month + 1}월</h2><div class="calendar-grid" style="grid-template-rows:${gridRows};--calendar-min-height:${minHeight}">${cells}</div></section>`;
}

function eventMap() {
  const map = new Map();
  for (const event of allEvents()) { if (!map.has(event.date)) map.set(event.date, []); map.get(event.date).push(event); }
  return map;
}

function monthsInRange() {
  const months = []; for (let key = range.start; key <= range.end; key = addMonth(key, 1)) months.push(key);
  return months;
}

export function renderCalendar() {
  // 다른 화면에서 들어오면 이번 달부터 시작한다. 달력 안에서 다시 그릴 때는 보던 범위를 유지한다.
  const entering = !main.classList.contains('calendar-page');
  if (entering || !range) { shown = new Date(new Date().getFullYear(), new Date().getMonth(), 1); range = { start: thisMonth(), end: addMonth(thisMonth(), 1) }; }
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const map = eventMap();
  main.className = 'calendar-page';
  main.innerHTML = `<div class="calendar-head"><div class="calendar-toolbar"><h1 class="calendar-title" id="calendar-title">${shown.getFullYear()}년 ${shown.getMonth() + 1}월</h1><div class="month-nav"><button type="button" class="icon-button" data-action="prev-month" aria-label="이전 달">${icon('chevron-left')}</button><button type="button" class="ghost-button" data-action="today">오늘</button><button type="button" class="icon-button" data-action="next-month" aria-label="다음 달">${icon('chevron-right')}</button></div><span class="spacer"></span><span class="source-note" id="calendar-status" role="status"></span><button type="button" class="ghost-button" data-action="import-ics" aria-label="파일 가져오기" title="파일 가져오기">${icon('upload')}<span class="btn-label">파일 가져오기</span></button><button type="button" class="ghost-button" data-action="alio-settings" title="잡알리오 공고 받기">${icon('download')}<span class="btn-label">잡알리오</span></button><button type="button" class="secondary-button" data-action="calendar-settings" aria-label="${calendarState.connected ? '구글 캘린더' : '구글 캘린더 연결'}" title="${calendarState.connected ? '구글 캘린더' : '구글 캘린더 연결'}">${icon('calendar')}<span class="btn-label">${calendarState.connected ? '구글 캘린더' : '구글 캘린더 연결'}</span></button><input type="file" id="ics-file" accept=".ics,text/calendar" hidden></div>
    <div class="calendar-weekdays" aria-hidden="true">${weekdays.map((day, index) => `<span class="${index === 0 ? 'sunday' : index === 6 ? 'saturday' : ''}">${day}</span>`).join('')}</div></div>
    <div class="calendar-wrap"><div class="calendar-sentinel" data-edge="start"></div><div class="calendar-months" id="calendar-months">${monthsInRange().map(key => monthHtml(key, map)).join('')}</div><div class="calendar-sentinel" data-edge="end"></div></div><div class="calendar-legend"><span class="legend-item deadline"><span class="dot"></span>접수 마감</span><span class="legend-item next"><span class="dot"></span>면접·결과 일정</span>${calendarState.connected || data.calendarEvents.some(event => event.source === 'google') ? '<span class="legend-item google"><span class="dot"></span>캘린더 공고 (담기 전)</span>' : ''}${data.calendarEvents.some(event => event.source === 'alio') ? '<span class="legend-item alio"><span class="dot"></span>잡알리오 공고 (담기 전)</span>' : ''}${data.calendarEvents.some(event => !isPostingEvent(event)) ? `<span class="legend-item personal"><span class="dot"></span>개인 일정</span><button type="button" class="legend-toggle" data-action="toggle-personal">${showPersonalEvents ? '개인 일정 숨기기' : '개인 일정 보기'}</button>` : ''}${data.calendarEvents.some(event => event.source === 'external') ? '<span class="legend-item external"><span class="dot"></span>파일에서 가져온 일정</span>' : ''}</div>`;
  $('#ics-file').addEventListener('change', importIcs);
  updateCalendarStatus();
  watchCalendarEdges();
}

// 달 하나를 위나 아래에 붙인다. 위에 붙일 때는 붙인 만큼 스크롤을 내려 보던 자리를 지킨다.
function addMonthAt(edge) {
  const container = $('#calendar-months'); if (!container) return false;
  const key = edge === 'end' ? addMonth(range.end, 1) : addMonth(range.start, -1);
  if (!inBounds(key)) return false;
  const html = monthHtml(key, eventMap());
  if (edge === 'end') { range.end = key; container.insertAdjacentHTML('beforeend', html); return true; }
  const before = document.documentElement.scrollHeight; const scrolled = window.scrollY;
  range.start = key; container.insertAdjacentHTML('afterbegin', html);
  const added = document.documentElement.scrollHeight - before;
  // 브라우저가 스크롤 위치를 알아서 보정했으면(scroll anchoring) 한 번 더 밀지 않는다.
  if (Math.abs(window.scrollY - scrolled) < 1) window.scrollBy({ top: added, behavior: 'instant' });
  // 버튼으로 이동하는 중이었다면 밀려난 목표 위치로 다시 간다.
  if (scrollTarget) scrollToMonth(scrollTarget, { extend: false });
  return true;
}

// 좁은 화면에서는 메뉴 막대가 위에 붙어 있으므로, 달력 제목 줄은 그 바로 아래에 붙인다.
function stickyTop() {
  const bar = document.querySelector('.sidebar');
  if (!bar || bar.hidden || getComputedStyle(bar).position !== 'sticky') return 0;
  const rect = bar.getBoundingClientRect();
  return rect.width > rect.height * 2 ? rect.height : 0;
}

const placeHead = () => { const head = main.querySelector('.calendar-head'); if (head) head.style.top = `${stickyTop()}px`; };

window.addEventListener('resize', () => { if (view === 'calendar') placeHead(); });

// 끝에 가까워지면 달을 붙이고, 지금 가장 많이 보이는 달을 제목에 보여 준다.
function watchCalendarEdges() {
  placeHead();
  calendarObserver?.disconnect();
  calendarObserver = new IntersectionObserver(entries => {
    if (view !== 'calendar') return;
    for (const entry of entries) {
      if (!entry.isIntersecting || !addMonthAt(entry.target.dataset.edge)) continue;
      // 붙인 뒤에도 끝이 가까우면 한 번 더 확인하도록 다시 지켜본다.
      calendarObserver.unobserve(entry.target); calendarObserver.observe(entry.target);
    }
  }, { rootMargin: '600px 0px' });
  main.querySelectorAll('.calendar-sentinel').forEach(sentinel => calendarObserver.observe(sentinel));
  // 좁은 화면에서 달력을 옆으로 밀면 고정된 요일 줄도 같이 움직인다.
  const wrap = main.querySelector('.calendar-wrap'); const weekdays = main.querySelector('.calendar-weekdays');
  wrap.addEventListener('scroll', () => { weekdays.style.transform = `translateX(${-wrap.scrollLeft}px)`; }, { passive: true });
}

function currentMonthInView() {
  const line = (document.querySelector('.calendar-head')?.getBoundingClientRect().bottom || 0) + 80;
  let current = null;
  for (const section of main.querySelectorAll('.calendar-month')) { if (section.getBoundingClientRect().top <= line) current = section.dataset.month; else break; }
  return current || main.querySelector('.calendar-month')?.dataset.month;
}

let titleFrame = 0;

window.addEventListener('scroll', () => {
  if (view !== 'calendar' || titleFrame) return;
  titleFrame = requestAnimationFrame(() => {
    titleFrame = 0;
    const key = currentMonthInView(); if (!key) return;
    const [year, month] = key.split('-').map(Number);
    shown = new Date(year, month - 1, 1);
    const title = $('#calendar-title'); if (title) title.textContent = `${year}년 ${month}월`;
  });
}, { passive: true });

// ‹ › · 오늘 버튼: 그 달이 제목 아래에 오도록 스크롤한다. 앞뒤 달을 먼저 붙여 두어 도중에 위치가 밀리지 않게 한다.
let scrollTarget = null; let scrollTargetTimer = 0;

function scrollToMonth(key, { extend = true } = {}) {
  if (!range || !inBounds(key)) return;
  if (extend) {
    scrollTarget = null;
    while (addMonth(key, 1) > range.end && addMonthAt('end'));
    while (addMonth(key, -1) < range.start && addMonthAt('start'));
  }
  const section = main.querySelector(`.calendar-month[data-month="${key}"]`); if (!section) return;
  const offset = stickyTop() + (document.querySelector('.calendar-head')?.getBoundingClientRect().height || 0) + 8;
  scrollTarget = key; clearTimeout(scrollTargetTimer); scrollTargetTimer = setTimeout(() => { scrollTarget = null; }, 1200);
  const distance = section.getBoundingClientRect().top - offset;
  // 멀리 떨어진 달은 오래 굴러가지 않고 바로 옮긴다.
  window.scrollTo({ top: window.scrollY + distance, behavior: reducedMotion() || Math.abs(distance) > window.innerHeight * 3 ? 'instant' : 'smooth' });
}

// 구글 캘린더의 일정을 통째로 새로 받아 교체한다. 캘린더에서 수정·삭제된 일정도 그대로 반영된다.
export async function syncGoogleCalendar({ quiet = true } = {}) {
  // 뒤에 숨은 창이 예전 내용으로 저장하지 않도록, 캘린더 동기화는 지금 보고 있는 창에서만 한다.
  if (!calendarState.connected || calendarState.syncing || document.hidden) return;
  calendarState.syncing = true; updateCalendarStatus();
  try {
    const response = await fetch('/api/calendar/ics'); const result = await response.json();
    if (response.status === 404) { calendarState.connected = false; return; }
    if (!response.ok) throw new Error(result.error || '구글 캘린더를 읽지 못했습니다.');
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 6);
    const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
    const incoming = parseIcs(result.ics, 'google').filter(event => event.date >= cutoffKey).sort((a, b) => a.id.localeCompare(b.id));
    const previous = data.calendarEvents.filter(event => event.source === 'google');
    const previousById = new Map(previous.map(event => [event.id, event]));
    const changedIds = new Set(incoming.filter(event => {
      const before = previousById.get(event.id);
      return !before || ['title', 'date', 'endDate', 'time', 'description'].some(key => (before[key] || '') !== (event[key] || ''));
    }).map(event => event.id));
    changedIds.forEach(id => eventFieldCache.delete(id));
    const changed = JSON.stringify(previous) !== JSON.stringify(incoming);
    if (changed) data.calendarEvents = [...data.calendarEvents.filter(event => event.source !== 'google'), ...incoming];
    const followed = await followCalendarDeadlines(incoming, previousById, changedIds);
    if (changed || followed.touched) persist();
    calendarState.lastSyncedAt = Date.now(); calendarState.error = '';
    if (followed.updated.length) {
      const [first] = followed.updated;
      showToast(followed.updated.length === 1 ? `캘린더가 바뀌어 ${first.organization} 마감일을 ${formatDate(first.deadline)}${first.deadlineTime ? ` ${first.deadlineTime}` : ''}로 바꿨어요.` : `캘린더가 바뀌어 공고 ${followed.updated.length}개의 마감일을 바꿨어요.`);
    } else if (!quiet) showToast(changed ? `구글 캘린더 일정 ${incoming.length}개를 반영했습니다.` : '바뀐 일정이 없습니다.');
    if (changed || followed.updated.length) safeRender();
  } catch (error) {
    calendarState.error = /Failed to fetch|Unexpected token/i.test(error.message) ? '앱 서버에 연결하지 못했습니다.' : error.message;
    if (!quiet) showToast(calendarState.error);
  } finally {
    calendarState.syncing = false; updateCalendarStatus();
  }
}

// 캘린더에서 가져온 공고는 캘린더 일정이 바뀌면 마감일도 따라 바꾼다.
// syncedDeadline은 마지막으로 캘린더에서 받은 마감일이다. 사용자가 마감일을 직접 고쳤다면(값이 다르면) 그 값을 지킨다.
async function followCalendarDeadlines(incoming, previousById, changedIds) {
  const incomingById = new Map(incoming.map(event => [event.id, event]));
  const linked = new Set(data.postings.map(item => item.calendarEventId).filter(Boolean));
  const updated = [];
  let touched = false;
  for (const item of data.postings) {
    if (!item.calendarEventId?.startsWith('google:')) continue;
    if (item.syncedDeadline === undefined) { item.syncedDeadline = item.deadline || ''; item.syncedDeadlineTime = item.deadlineTime || ''; touched = true; }
    if (!item.calendarTitle && previousById.get(item.calendarEventId)?.title) { item.calendarTitle = previousById.get(item.calendarEventId).title; touched = true; }
    let event = incomingById.get(item.calendarEventId);
    let relinked = false;
    if (!event && item.calendarTitle) {
      // 일정을 지웠다가 다시 만들면 ID가 바뀌므로 같은 제목의 새 일정에 다시 연결한다.
      event = incoming.find(candidate => candidate.title === item.calendarTitle && !linked.has(candidate.id));
      if (event) { linked.delete(item.calendarEventId); linked.add(event.id); item.calendarEventId = event.id; relinked = touched = true; }
    }
    if (!event || (!relinked && !changedIds.has(event.id))) continue;
    if (item.calendarTitle !== event.title) { item.calendarTitle = event.title; touched = true; }
    let fields;
    try { fields = await readEventFields(event); } catch { continue; }
    const deadline = dateValue(fields.deadline); const deadlineTime = fields.deadlineTime || '';
    if (!deadline || (deadline === item.syncedDeadline && deadlineTime === item.syncedDeadlineTime)) continue;
    const editedByUser = (item.deadline || '') !== item.syncedDeadline || (item.deadlineTime || '') !== item.syncedDeadlineTime;
    item.syncedDeadline = deadline; item.syncedDeadlineTime = deadlineTime; touched = true;
    if (editedByUser) continue;
    item.deadline = deadline; item.deadlineTime = deadlineTime; item.updatedAt = new Date().toISOString();
    updated.push(item);
  }
  return { updated, touched };
}

export function openCalendarDialog() {
  const form = $('#calendar-form'); form.reset();
  const connected = calendarState.connected;
  $('#calendar-dialog-title').textContent = connected ? '구글 캘린더' : '구글 캘린더 연결';
  $('#calendar-connect').hidden = connected; $('#calendar-connected').hidden = !connected;
  $('#calendar-disconnect').hidden = !connected; $('#calendar-sync-now').hidden = !connected; $('#calendar-connect-button').hidden = connected;
  updateCalendarStatus();
  calendarDialog.showModal();
  if (!connected) form.elements.url.focus();
}

async function importIcs(event) {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const incoming = parseIcs(await file.text(), 'external');
    if (!incoming.length) throw new Error('일정을 찾지 못했습니다. .ics 파일인지 확인해 주세요.');
    const existing = new Set(data.calendarEvents.map(item => item.id));
    const added = incoming.filter(item => !existing.has(item.id));
    data.calendarEvents.push(...added);
    await persist(); renderCalendar(); showToast(`${added.length}개 일정을 가져왔습니다${incoming.length !== added.length ? ` · 중복 ${incoming.length - added.length}개 제외` : ''}.`);
  } catch (error) { showToast(error.message); }
}

$('#calendar-form').addEventListener('submit', async event => {
  event.preventDefault();
  const url = event.currentTarget.elements.url.value.trim();
  if (!url) { event.currentTarget.elements.url.focus(); return; }
  try {
    const response = await fetch('/api/calendar', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '연결하지 못했습니다.');
    calendarState.connected = true; calendarState.error = '';
    calendarDialog.close();
    if (view === 'calendar') renderCalendar();
    await syncGoogleCalendar({ quiet: false });
  } catch (error) { showToast(error.message); }
});

$('#calendar-sync-now').addEventListener('click', () => syncGoogleCalendar({ quiet: false }));

$('#calendar-disconnect').addEventListener('click', async () => {
  if (!confirm('구글 캘린더 연결을 해제할까요? 구글 캘린더에서 가져온 일정도 달력에서 사라집니다.')) return;
  try {
    const response = await fetch('/api/calendar', { method: 'DELETE' });
    if (!response.ok) throw new Error((await response.json()).error || '연결을 해제하지 못했습니다.');
    calendarState.connected = false; calendarState.error = ''; calendarState.lastSyncedAt = 0;
    data.calendarEvents = data.calendarEvents.filter(item => item.source !== 'google');
    await persist(); calendarDialog.close(); if (view === 'calendar') renderCalendar(); showToast('구글 캘린더 연결을 해제했습니다.');
  } catch (error) { showToast(error.message); }
});

setInterval(() => syncGoogleCalendar(), 5 * 60_000);

setInterval(updateCalendarStatus, 60_000);
