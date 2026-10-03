// 시작점: 공통 이벤트를 연결하고 데이터를 불러와 첫 화면을 그린다.
import { allEvents, calendarState, eventClass, eventKindLabel, eventShort, openCalendarDialog, renderCalendar, showThisMonth, stepMonth, syncGoogleCalendar, togglePersonalEvents } from './calendar.js';
import { closeDatePopovers, dateActions, dateTarget, handleDateAction, miniCalendarHtml } from './date-field.js';
import { $, eventDialog, main } from './dom.js';
import { openEvent, showEventDialog } from './event-dialog.js';
import { keywordEditorHtml, toggleExperienceKeyword } from './experiences.js';
import { migrate, newQuestion, shownTime } from './model.js';
import { handleInterviewAction, setDetailTab } from './interview.js';
import { closePeek, peekEdited, peekOpen } from './peek.js';
import { renderPostingDetail, renderQuestions } from './posting-detail.js';
import { openPostingDialog } from './posting-dialog.js';
import { boardColumns, closingStatus, collapsed, demoPostings, editRoleCell, filterStage, refreshPostingTable, renderPostings, search, setPostingLayout } from './postings.js';
import { navTo, render, routeFrom, routeHash } from './router.js';
import { data, selectedId, setData, setRoute, view } from './state.js';
import { persist, refreshFromServer, saveCurrentEditor, startFromServer } from './store.js';
import { animateReorder, flushPending, reducedMotion, setSaveState, showToast } from './ui.js';
import { autoGrow, dateKey, escapeHtml, formatDateLong, icon, todayKey, uid } from './util.js';
import { setupUpdateButton } from './update.js';
import { alioState, openAlioDialog, syncAlio } from './alio.js';

const sidebarToggle = $('#sidebar-toggle');
const sidebar = $('#sidebar');
function setSidebarCollapsed(collapsed, { save = false } = {}) {
  document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
  sidebar.hidden = collapsed;
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  const label = collapsed ? '사이드바 보이기' : '사이드바 숨기기';
  sidebarToggle.setAttribute('aria-label', label);
  sidebarToggle.title = label;
  if (save) {
    try { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0'); } catch { /* 현재 창에서는 계속 사용할 수 있다. */ }
  }
}
try { setSidebarCollapsed(localStorage.getItem('sidebarCollapsed') === '1'); } catch { setSidebarCollapsed(false); }
sidebarToggle.addEventListener('click', () => setSidebarCollapsed(!sidebar.hidden, { save: true }));

main.addEventListener('focusout', flushPending);

document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', flushPending));

document.querySelectorAll('[data-icon]').forEach(element => element.insertAdjacentHTML('afterbegin', icon(element.dataset.icon)));

document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));

document.querySelectorAll('.primary-nav button').forEach(button => button.addEventListener('click', () => navTo(button.dataset.view)));

$('.brand').addEventListener('click', () => navTo('postings'));

main.addEventListener('click', async event => {
  // 카드·행 안의 드롭다운을 누를 때는 카드를 열지 않는다.
  if (event.target.closest('select, .date-popover input')) return;
  if (!event.target.closest('.date-field')) closeDatePopovers();
  // 피크 바깥의 빈 곳을 누르면 피크를 닫는다.
  if (peekOpen() && !event.target.closest('#peek, button, a, input, textarea, label, [data-action], .data-row, .board-card, .pipeline')) { closePeek(); return; }
  const control = event.target.closest('[data-action], [data-group]'); if (!control) return;
  if (control.dataset.group) { const group = control.dataset.group; collapsed.has(group) ? collapsed.delete(group) : collapsed.add(group); renderPostings(); return; }
  const action = control.dataset.action; const id = control.dataset.id;
  if (action === 'new-posting') openPostingDialog();
  if (action === 'edit-posting') openPostingDialog(data.postings.find(item => item.id === id));
  // 지원 현황에서는 오른쪽 피크로 연다. 피크가 열려 있으면 기록을 쌓지 않고 내용만 바꾼다.
  if (action === 'open-posting' || action === 'open-essay') {
    if (action === 'open-essay' || control.dataset.tab) setDetailTab(id, control.dataset.tab || 'essay');
    if (view === 'postings') navTo('postings', id, { history: peekOpen() ? 'replace' : 'push' }); else navTo('posting-detail', id);
    if (action === 'open-essay') ($('.question-answer') || $('.add-question'))?.focus({ preventScroll: view === 'postings' });
  }
  if (action === 'close-peek') closePeek();
  if (action === 'expand-peek') navTo('posting-detail', id, { history: 'replace' });
  if (action === 'filter-stage') filterStage(control.dataset.stage);
  if (action === 'edit-role') editRoleCell(control, data.postings.find(item => item.id === id));
  if (['detail-tab', 'add-review', 'delete-review', 'asked-to-prep'].includes(action)) {
    const item = data.postings.find(posting => posting.id === selectedId); if (item) handleInterviewAction(action, control, item);
  }
  // 자소서 문항(questions)과 면접 질문(interviewQuestions)은 같은 방식으로 추가·삭제한다.
  if (['add-question', 'delete-question', 'unlink-experience'].includes(action)) {
    const item = data.postings.find(posting => posting.id === selectedId); if (!item) return;
    const list = control.closest('[data-list]')?.dataset.list || 'questions'; const questions = item[list] ||= [];
    if (action === 'add-question') {
      const title = control.dataset.title || '';
      questions.push(newQuestion(title)); renderQuestions(item, list);
      $(`.question-list[data-list="${list}"] .question:last-child ${title ? '.question-answer' : '.question-title'}`)?.focus();
    }
    if (action === 'delete-question') {
      const index = questions.findIndex(entry => entry.id === control.dataset.qid); if (index < 0) return;
      const [removed] = questions.splice(index, 1); renderQuestions(item, list);
      showToast(list === 'questions' ? `${index + 1}번 문항을 삭제했어요.` : '면접 질문을 삭제했어요.', { label: '되돌리기', run: () => {
        questions.splice(Math.min(index, questions.length), 0, removed); item.updatedAt = new Date().toISOString(); persist();
        if (selectedId === item.id) renderQuestions(item, list);
        peekEdited({ now: true });
      } });
    }
    if (action === 'unlink-experience') { const question = questions.find(entry => entry.id === control.dataset.qid); question.experienceIds = question.experienceIds.filter(entry => entry !== id); renderQuestions(item, list); }
    item.updatedAt = new Date().toISOString(); persist(); peekEdited({ now: true });
  }
  if (action === 'filter-keyword') {
    toggleExperienceKeyword(control.dataset.keyword);
  }
  if (action === 'calendar-settings') openCalendarDialog();
  if (action === 'alio-settings') openAlioDialog();
  if (action === 'go-calendar') navTo('calendar');
  if (action === 'posting-layout') {
    setPostingLayout(control.dataset.layout);
  }
  if (dateActions.includes(action)) handleDateAction(control, action);
  if (action === 'history-back') { if (history.length > 1 && history.state) history.back(); else navTo(view === 'experience-detail' ? 'experiences' : 'postings'); }
  if (action === 'follow-calendar') {
    const item = data.postings.find(posting => posting.id === selectedId); if (!item) return;
    item.deadline = item.syncedDeadline; item.deadlineTime = item.syncedDeadlineTime || ''; item.updatedAt = new Date().toISOString();
    persist(); const scroll = window.scrollY; renderPostingDetail(); window.scrollTo({ top: scroll, behavior: 'instant' }); showToast('캘린더 마감일로 되돌렸어요. 앞으로 캘린더를 따라 바뀝니다.');
  }
  if (action === 'toggle-personal') {
    togglePersonalEvents();
  }
  if (action === 'back-postings') navTo('postings');
  if (action === 'delete-posting') {
    const index = data.postings.findIndex(item => item.id === id); if (index < 0) return;
    const fromPeek = view === 'postings';
    const [removed] = data.postings.splice(index, 1);
    persist();
    if (fromPeek && history.state?.peek) history.back(); else navTo('postings', null, { history: 'replace' });
    showToast(`‘${removed.organization || '이름 없음'}’ 공고를 삭제했어요.`, { label: '되돌리기', run: () => {
      data.postings.splice(Math.min(index, data.postings.length), 0, removed); persist();
      if (fromPeek && view === 'postings') navTo('postings', removed.id); else navTo('posting-detail', removed.id);
    } });
  }
  if (action === 'new-experience') {
    const now = new Date().toISOString();
    const item = { id: uid(), name: '', type: '', period: '', role: '', keywords: [], description: '', result: '', detail: '', createdAt: now, updatedAt: now };
    data.experiences.push(item); persist(); navTo('experience-detail', item.id); $('.title-input')?.focus();
  }
  if (action === 'remove-keyword') {
    const item = data.experiences.find(experience => experience.id === selectedId); if (!item) return;
    item.keywords = item.keywords.filter(keyword => keyword !== control.dataset.keyword);
    item.updatedAt = new Date().toISOString(); persist();
    $('#keyword-editor').innerHTML = keywordEditorHtml(item);
  }
  if (action === 'open-experience') navTo('experience-detail', id);
  if (action === 'back-experiences') navTo('experiences');
  if (action === 'delete-experience') {
    const index = data.experiences.findIndex(item => item.id === id); if (index < 0) return;
    const [removed] = data.experiences.splice(index, 1);
    const linked = data.postings.flatMap(posting => [...(posting.questions || []), ...(posting.interviewQuestions || [])].filter(question => question.experienceIds.includes(id)));
    linked.forEach(question => { question.experienceIds = question.experienceIds.filter(entry => entry !== id); });
    persist(); navTo('experiences', null, { history: 'replace' });
    showToast(`‘${removed.name || '제목 없음'}’ 경험을 삭제했어요.`, { label: '되돌리기', run: () => {
      data.experiences.splice(Math.min(index, data.experiences.length), 0, removed);
      linked.forEach(question => { if (!question.experienceIds.includes(id)) question.experienceIds.push(id); });
      persist(); navTo('experience-detail', removed.id);
    } });
  }
  if (action === 'prev-month' || action === 'next-month') stepMonth(action === 'prev-month' ? -1 : 1);
  if (action === 'today') showThisMonth();
  if (action === 'import-ics') $('#ics-file').click();
  if (action === 'open-event') openEvent(id);
  if (action === 'more-events') {
    // 하루 목록은 시각 순서로 (종일 일정은 맨 위)
    const date = control.dataset.date; const events = allEvents().filter(item => item.date === date).sort((a, b) => (shownTime(a) || '').localeCompare(shownTime(b) || ''));
    $('#event-source').textContent = '하루 전체 일정'; $('#event-dialog-title').textContent = `${formatDateLong(date)} · ${events.length}개`;
    $('#event-date').textContent = ''; $('#event-fields').hidden = true; $('#event-description').textContent = '';
    const actions = $('#event-actions'); actions.replaceChildren();
    for (const item of events) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `day-event ${eventClass(item)}`;
      button.innerHTML = `<span class="day-event-time">${escapeHtml(shownTime(item) || '종일')}</span><span class="dot" aria-hidden="true"></span><span class="day-event-name">${escapeHtml(eventShort(item))}</span><span class="day-event-kind">${escapeHtml(eventKindLabel(item))}</span>`;
      button.addEventListener('click', () => { eventDialog.close(); openEvent(item.id); }); actions.append(button);
    }
    showEventDialog();
  }
  if (action === 'load-demo') { data.postings.push(...demoPostings()); await persist(); renderPostings(); showToast('예시 공고를 추가했습니다. 언제든 삭제할 수 있습니다.'); }
});

document.addEventListener('keydown', event => {
  // '/' 로 검색창에 바로 들어간다.
  if (event.key === '/' && !event.target.closest?.('input, textarea, select, [contenteditable], dialog')) {
    const search = $('#posting-search') || $('#experience-search');
    if (search) { event.preventDefault(); search.focus(); search.select(); }
  }
  // Esc: 입력 중이면 입력만 마치고, 아니면 피크를 닫는다.
  if (event.key === 'Escape' && !event.defaultPrevented && peekOpen() && !document.querySelector('dialog[open]') && !event.target.closest?.('.date-popover')) {
    if (event.target.closest?.('#peek') && event.target.matches('input, textarea, select')) event.target.blur(); else closePeek();
    return;
  }
  const popover = event.target.closest?.('.date-popover');
  if (!popover) return;
  if (event.key === 'Escape' || (event.key === 'Enter' && event.target.tagName === 'INPUT')) { event.preventDefault(); popover.querySelector('[data-action=close-date]').click(); return; }
  const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
  if (move && event.target.classList.contains('mini-day')) {
    event.preventDefault();
    const [year, month, day] = event.target.dataset.date.split('-').map(Number);
    const next = dateKey(new Date(year, month - 1, day + move));
    let target = popover.querySelector(`.mini-day[data-date="${next}"]`);
    if (!target) {
      const field = popover.closest('.date-field');
      popover.querySelector('.mini-cal').outerHTML = miniCalendarHtml(next.slice(0, 7), dateTarget(field)?.data[field.dataset.dateProp] || '');
      target = popover.querySelector(`.mini-day[data-date="${next}"]`);
    }
    target?.focus();
  }
});

main.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.classList?.contains('board-card')) { event.preventDefault(); event.target.click(); }
});

// 창 너비가 바뀌면 줄 수도 바뀌므로 글 입력칸 높이를 다시 맞춘다.
let resizeTimer = 0;

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => main.querySelectorAll('textarea').forEach(autoGrow), 80);
});

// 보드 카드 끌어서 옮기기
main.addEventListener('dragstart', event => {
  const card = event.target.closest?.('.board-card'); if (!card) return;
  event.dataTransfer.setData('text/plain', card.dataset.id); event.dataTransfer.effectAllowed = 'move';
  // 끌 때 보이는 카드: 살짝 기울고 그림자가 진 채로 떠오른다.
  if (!reducedMotion() && event.dataTransfer.setDragImage) {
    const ghost = document.createElement('div'); ghost.className = 'drag-ghost'; ghost.append(card.cloneNode(true));
    document.body.append(ghost);
    const rect = card.getBoundingClientRect();
    event.dataTransfer.setDragImage(ghost, event.clientX - rect.left + 14, event.clientY - rect.top + 14);
    setTimeout(() => ghost.remove(), 0);
  }
  // 끌기 이미지를 만든 뒤 원래 카드를 흐리게 한다. 그사이 끌기가 끝났으면 흐리게 하지 않는다.
  card.dataset.dragging = '1';
  requestAnimationFrame(() => { if (card.dataset.dragging) card.classList.add('dragging'); });
});

main.addEventListener('dragend', event => { const card = event.target.closest?.('.board-card'); if (card) { delete card.dataset.dragging; card.classList.remove('dragging'); } main.querySelectorAll('.drop-target').forEach(column => column.classList.remove('drop-target')); });

main.addEventListener('dragover', event => {
  const column = event.target.closest?.('.board-column'); if (!column) return;
  event.preventDefault();
  main.querySelectorAll('.drop-target').forEach(other => { if (other !== column) other.classList.remove('drop-target'); });
  column.classList.add('drop-target');
});

main.addEventListener('drop', event => {
  const target = event.target.closest?.('.board-column'); if (!target) return;
  event.preventDefault();
  const item = data.postings.find(posting => posting.id === event.dataTransfer.getData('text/plain'));
  const column = boardColumns.find(entry => entry.key === target.dataset.column);
  if (!item || !column || column.statuses.includes(item.status)) { refreshPostingTable(); return; }
  item.status = column.drop || closingStatus(item.status); item.updatedAt = new Date().toISOString();
  persist(); animateReorder(refreshPostingTable, item.id); if (selectedId === item.id && peekOpen()) renderPostingDetail();
  showToast(`${item.organization} → ${item.status}`);
});

// 표 안의 진행 상태·고용형태 드롭다운은 노션 데이터베이스처럼 그 자리에서 바로 저장한다.
main.addEventListener('change', event => {
  const select = event.target.closest('select[data-field]'); if (!select) return;
  const item = data.postings.find(posting => posting.id === select.dataset.id); if (!item) return;
  item[select.dataset.field] = select.value; item.updatedAt = new Date().toISOString();
  persist(); animateReorder(refreshPostingTable, item.id); if (selectedId === item.id && peekOpen()) renderPostingDetail();
});

// 다른 탭·앱으로 이동할 때 작성 중인 내용을 먼저 저장하고, 돌아오면 구글 캘린더를 새로 가져온다.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { saveCurrentEditor(); return; }
  // 돌아오면 다른 창에서 바뀐 내용부터 불러온 뒤 캘린더를 확인한다.
  refreshFromServer().then(() => { if (Date.now() - calendarState.lastSyncedAt > 60_000) syncGoogleCalendar(); });
});

$('#export-button').addEventListener('click', () => { saveCurrentEditor(); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `지원일지-백업-${todayKey()}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });

$('#import-button').addEventListener('click', () => $('#import-file').click());

$('#import-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const value = JSON.parse(await file.text());
    if (value.version !== 1 || !Array.isArray(value.postings) || !Array.isArray(value.experiences) || !Array.isArray(value.calendarEvents)) throw new Error('지원일지 백업 파일이 아닙니다.');
    if (!confirm('현재 기록을 백업 파일의 내용으로 바꿀까요? 기존 기록은 덮어써집니다.')) return;
    setData(migrate(value)); delete data.revision; await persist(); navTo('postings', null, { history: 'replace' }); showToast('백업을 복원했습니다.');
  } catch (error) { showToast(error.message); }
  event.target.value = '';
});

// 맥 앱처럼 화면을 감싼 쪽에서 알림을 띄울 수 있게 한다(예: 백업 파일 저장 완료).
window.addEventListener('jiwon:toast', event => showToast(String(event.detail || '')));

// 이 화면이 열려 있다는 신호. 윈도우 바로가기(앱 창)로 켰을 때는 창을 모두 닫으면 서버가 스스로 꺼진다.
function startPresence() {
  const id = uid();
  const send = kind => fetch(`/api/${kind}`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Jiwon-Ilji': '1' }, body: JSON.stringify({ id }) }).catch(() => {});
  send('ping');
  setInterval(() => send('ping'), 30_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') send('ping'); });
  window.addEventListener('pagehide', () => send('bye'));
}

try {
  const response = await fetch('/api/data'); if (!response.ok) throw new Error('저장 파일을 열지 못했습니다.');
  const loaded = await response.json();
  startFromServer(loaded);
  setupUpdateButton();
  // 새로고침하거나 주소로 바로 열어도 보던 화면이 그대로 열린다.
  const route = routeFrom(location.hash);
  setRoute(route.view, route.id);
  history.replaceState({ scrollY: 0 }, '', routeHash(view, selectedId));
  render();
  startPresence();
  try {
    calendarState.connected = Boolean((await (await fetch('/api/calendar')).json()).connected);
    if (calendarState.connected) { if (view === 'calendar') renderCalendar(); syncGoogleCalendar(); }
  } catch { /* 캘린더 연결 확인에 실패해도 기록은 그대로 쓸 수 있다. */ }
  try {
    alioState.connected = Boolean((await (await fetch('/api/alio')).json()).connected);
    if (alioState.connected) syncAlio();
  } catch { /* 잡알리오 연결 확인에 실패해도 기록은 그대로 쓸 수 있다. */ }
} catch (error) {
  setSaveState('연결 오류');
  main.innerHTML = `<div class="empty-state"><h2>저장 파일을 열지 못했습니다</h2><p>${escapeHtml(error.message)} 서버를 다시 실행한 뒤 새로고침해 주세요.</p></div>`;
}
