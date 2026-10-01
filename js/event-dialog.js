// 달력 일정 창: 일정에서 공고 정보를 읽어 지원 현황에 추가
import { allEvents, renderCalendar } from './calendar.js';
import { $, eventDialog } from './dom.js';
import { isPostingEvent, shownTime } from './model.js';
import { openPostingDialog } from './posting-dialog.js';
import { navTo } from './router.js';
import { data, view } from './state.js';
import { persist } from './store.js';
import { showToast } from './ui.js';
import { dateValue, escapeHtml, formatDate, icon, uid, validUrl } from './util.js';

export const eventFieldCache = new Map();

// 창을 열면 닫기(X)가 아니라 주요 버튼에 초점을 둔다.
export function showEventDialog() {
  eventDialog.showModal();
  ($('#event-actions .primary-button:not(:disabled)') || $('#event-actions button, #event-actions a') || eventDialog).focus();
}

let openEventId = '';

function eventButton(label, className, onClick) {
  const button = document.createElement('button'); button.type = 'button'; button.className = className; button.textContent = label;
  button.addEventListener('click', onClick); return button;
}

function eventFieldsHtml(fields) {
  const missing = '<span class="missing">찾지 못함</span>';
  const row = (label, value) => `<div><dt>${label}</dt><dd>${value || missing}</dd></div>`;
  const source = { event: '일정 제목과 설명에서 읽었어요.', link: '일정에 있는 공고 링크에서 읽었어요.' }[fields.method] || '';
  return `<dl class="event-field-list">${row('회사·기관', escapeHtml(fields.organization))}${row('직무', escapeHtml(fields.role))}${row('접수 마감', fields.deadline ? `${escapeHtml(formatDate(fields.deadline))}${fields.deadlineTime ? ` ${escapeHtml(fields.deadlineTime)}` : ''}` : '')}${fields.employmentType ? row('고용형태', escapeHtml(fields.employmentType)) : ''}</dl><p class="event-field-source">${source}${fields.complete ? '' : ' 빈칸은 다음 화면에서 채울 수 있어요.'}</p>`;
}

export async function readEventFields(event) {
  if (eventFieldCache.has(event.id)) return eventFieldCache.get(event.id);
  const response = await fetch('/api/event-fields', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: event.title, description: event.description || '', date: event.date, endDate: event.endDate || '', time: event.time || '', url: event.url || '' }) });
  const fields = await response.json();
  if (!response.ok) throw new Error(fields.error || '공고 정보를 읽지 못했습니다.');
  eventFieldCache.set(event.id, fields);
  return fields;
}

function postingFromEvent(event, fields) {
  const now = new Date().toISOString();
  return { id: uid(), organization: fields.organization, role: fields.role, originalTitle: fields.originalTitle || event.title, employmentType: fields.employmentType || '', deadline: dateValue(fields.deadline), deadlineTime: fields.deadlineTime || '', status: '관심', nextDate: '', nextTime: '', nextLabel: '', url: validUrl(fields.url), note: fields.note || '', calendarEventId: event.id, calendarTitle: event.title, syncedDeadline: dateValue(fields.deadline), syncedDeadlineTime: fields.deadlineTime || '', questions: [], interviewQuestions: [], interviewReviews: [], createdAt: now, updatedAt: now };
}

async function addPostingFromEvent(event, fields) {
  const item = postingFromEvent(event, fields);
  data.postings.push(item);
  await persist();
  eventDialog.close();
  if (view === 'calendar') renderCalendar();
  showToast(`${item.organization} 공고를 지원 현황에 추가했어요.`);
}

export async function openEvent(id) {
  const event = allEvents().find(item => item.id === id);
  if (!event) return;
  openEventId = id;
  const sourceLabel = event.source === 'google' ? '구글 캘린더' : event.source === 'external' ? '파일에서 가져온 일정' : '내 지원 일정';
  $('#event-source').textContent = `${sourceLabel} · ${formatDate(event.date)}${shownTime(event) ? ` ${shownTime(event)}` : ''}`;
  $('#event-dialog-title').textContent = event.title;
  $('#event-date').textContent = '';
  $('#event-description').textContent = event.description || '';
  const fieldsBox = $('#event-fields'); fieldsBox.hidden = true; fieldsBox.innerHTML = '';
  const actions = $('#event-actions'); actions.replaceChildren();
  if (event.source === 'local') {
    actions.append(eventButton('지원 기록 열기', 'primary-button', () => { eventDialog.close(); navTo('posting-detail', event.postingId); }));
    showEventDialog(); return;
  }
  if (validUrl(event.url)) { const link = document.createElement('a'); link.className = 'ghost-button'; link.href = event.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.innerHTML = `${icon('external')}링크 열기`; actions.append(link); }
  const registered = data.postings.find(item => item.calendarEventId === event.id || (validUrl(event.url) && validUrl(item.url) === validUrl(event.url)));
  if (registered || !isPostingEvent(event)) {
    if (!registered) { showEventDialog(); return; }
    actions.append(eventButton('지원 기록 열기', 'primary-button', () => { eventDialog.close(); navTo('posting-detail', registered.id); }));
    showEventDialog(); return;
  }
  // 일정에서 회사·직무·마감일을 읽어 미리 보여 주고, 다 찾았으면 한 번에 추가한다.
  fieldsBox.hidden = false;
  fieldsBox.innerHTML = `<div class="skeleton-list" role="status" aria-label="공고 정보를 읽는 중">${[64, 44, 52].map(width => `<div><span class="skeleton" style="width:56px"></span><span class="skeleton" style="width:${width}%"></span></div>`).join('')}</div>`;
  const edit = eventButton('직접 수정', 'secondary-button', () => { eventDialog.close(); openPostingDialog(null, event, eventFieldCache.get(event.id)); });
  const add = eventButton('지원 현황에 추가', 'primary-button', () => {});
  add.disabled = true;
  actions.append(edit, add);
  showEventDialog();
  try {
    const fields = await readEventFields(event);
    if (!eventDialog.open || openEventId !== id) return;
    fieldsBox.innerHTML = eventFieldsHtml(fields);
    add.disabled = false;
    if (fields.complete) add.addEventListener('click', () => addPostingFromEvent(event, fields));
    else { add.textContent = '빈칸 채우고 추가'; add.addEventListener('click', () => { eventDialog.close(); openPostingDialog(null, event, fields); }); }
  } catch (error) {
    if (!eventDialog.open || openEventId !== id) return;
    fieldsBox.innerHTML = `<div class="event-fields-loading">${escapeHtml(/Failed to fetch|Unexpected token/i.test(error.message) ? '앱 서버에 연결하지 못했어요.' : error.message)}</div>`;
    add.disabled = false; add.textContent = '직접 입력해서 추가';
    add.addEventListener('click', () => { eventDialog.close(); openPostingDialog(null, event); });
    edit.remove();
  }
}
