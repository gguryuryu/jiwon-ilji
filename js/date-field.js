// 날짜 칸: 작은 달력과 시각 입력(상세 페이지와 새 공고 창에서 함께 쓴다)
import { localEvents } from './calendar.js';
import { $, postingDialog } from './dom.js';
import { peekEdited } from './peek.js';
import { deadlineHint } from './posting-detail.js';
import { data, selectedId, view } from './state.js';
import { persist } from './store.js';
import { showToast } from './ui.js';
import { dateKey, escapeHtml, formatDateLong, icon, parseTime, todayKey, weekdayNames } from './util.js';

// 날짜는 '9월 17일 (수) 18:00'처럼 글자로 보여 주고, 누르면 날짜·시각을 고르는 작은 창이 열린다.
function dateDisplayHtml(date, time) {
  return date ? `${escapeHtml(formatDateLong(date))}${time ? `<span class="date-time">${escapeHtml(time)}</span>` : ''}` : '비어 있음';
}

// 작은 월 달력. 다른 공고의 마감·일정이 있는 날에는 점을 찍어 겹치는 날을 알 수 있게 한다.
export function miniCalendarHtml(month, selected) {
  const [year, monthIndex] = month.split('-').map(Number).map((value, index) => index ? value - 1 : value);
  const offset = new Date(year, monthIndex, 1).getDay();
  const cells = Math.ceil((offset + new Date(year, monthIndex + 1, 0).getDate()) / 7) * 7;
  const busy = new Set(localEvents().filter(event => event.postingId !== selectedId).map(event => event.date));
  const today = todayKey();
  let days = '';
  for (let index = 0; index < cells; index++) {
    const date = new Date(year, monthIndex, index - offset + 1); const key = dateKey(date);
    const classes = ['mini-day', date.getMonth() !== monthIndex ? 'outside' : '', key === today ? 'today' : '', key === selected ? 'selected' : '', busy.has(key) ? 'busy' : ''].filter(Boolean).join(' ');
    days += `<button type="button" class="${classes}" data-action="pick-date" data-date="${key}" aria-label="${escapeHtml(formatDateLong(key))}${busy.has(key) ? ', 다른 일정 있음' : ''}"${key === selected ? ' aria-pressed="true"' : ''}>${date.getDate()}</button>`;
  }
  return `<div class="mini-cal" data-month="${month}"><div class="mini-cal-head"><strong>${year}년 ${monthIndex + 1}월</strong><button type="button" class="mini-today" data-action="cal-today">오늘</button><button type="button" class="icon-button" data-action="cal-step" data-step="-1" aria-label="이전 달">${icon('chevron-left')}</button><button type="button" class="icon-button" data-action="cal-step" data-step="1" aria-label="다음 달">${icon('chevron-right')}</button></div><div class="mini-cal-grid">${weekdayNames.map(day => `<span class="mini-weekday">${day}</span>`).join('')}${days}</div></div>`;
}

export function dateFieldHtml(item, dateProp, timeProp, label) {
  const date = item[dateProp] || ''; const time = item[timeProp] || '';
  const month = (date || todayKey()).slice(0, 7);
  return `<div class="date-field" data-date-prop="${dateProp}" data-time-prop="${timeProp}"><button type="button" class="date-display${date ? '' : ' empty'}" data-action="toggle-date" aria-expanded="false" aria-label="${label} 바꾸기">${dateDisplayHtml(date, time)}</button>
    <div class="date-popover" role="dialog" aria-label="${label}" hidden>${miniCalendarHtml(month, date)}<div class="time-row"><label><span>시각 <span class="faint">(선택)</span></span><input type="text" class="popover-input time-text" inputmode="numeric" autocomplete="off" placeholder="예: 14:00" value="${escapeHtml(time)}" aria-label="${label} 시각"></label><div class="time-chips">${['09:00', '10:00', '14:00', '18:00', '23:59'].map(chip => `<button type="button" class="time-chip${chip === time ? ' selected' : ''}" data-action="pick-time" data-time="${chip}">${chip}</button>`).join('')}</div></div><div class="popover-actions"><button type="button" class="ghost-button" data-action="clear-date">지우기</button><button type="button" class="primary-button" data-action="close-date">완료</button></div></div></div>`;
}

// 시각 칸의 글자를 저장한다. 알아볼 수 없는 값이면 false.
// 날짜 칸이 읽고 쓰는 대상: 새 공고 창이면 폼 입력칸, 상세 페이지면 그 공고·경험.
export function dateTarget(field) {
  const form = field.closest('form');
  if (form) return { data: new Proxy({}, { get: (_, key) => form.elements[key]?.value || '', set: (_, key, value) => { if (form.elements[key]) form.elements[key].value = value; return true; } }), save: () => {} };
  const item = detailItem();
  return item ? { data: item, save: () => { item.updatedAt = new Date().toISOString(); persist(); peekEdited({ now: true }); } } : null;
}

function dateChanged(field, target) {
  refreshDateField(target.data, field);
  if (field.dataset.dateProp === 'deadline' && !field.closest('form') && $('#deadline-hint')) $('#deadline-hint').innerHTML = deadlineHint(target.data);
  target.save();
}

// 시각 칸의 글자를 저장한다. 알아볼 수 없는 값이면 false.
function commitTime(field) {
  const input = field.querySelector('.time-text'); const target = dateTarget(field); if (!target || !input) return true;
  const time = parseTime(input.value);
  if (time === null) { showToast('시각은 14:00, 1430, 오후 2시처럼 입력해 주세요.'); input.focus(); input.select(); return false; }
  input.value = time;
  field.querySelectorAll('.time-chip').forEach(chip => chip.classList.toggle('selected', chip.dataset.time === time));
  if ((target.data[field.dataset.timeProp] || '') !== time) { target.data[field.dataset.timeProp] = time; dateChanged(field, target); }
  return true;
}

// 공고 상세 페이지와 지원 현황의 사이드 피크는 공고를, 경험 상세 페이지는 경험을 고친다.
const detailItem = () => (view === 'experience-detail' ? data.experiences : data.postings).find(entry => entry.id === selectedId);

export function refreshDateField(item, field) {
  const date = item[field.dataset.dateProp] || ''; const time = item[field.dataset.timeProp] || '';
  const display = field.querySelector('.date-display');
  display.innerHTML = dateDisplayHtml(date, time); display.classList.toggle('empty', !date);
}

export function closeDatePopovers(except = null) {
  document.querySelectorAll('.date-field').forEach(field => {
    if (field === except) return;
    if (!field.querySelector('.date-popover').hidden && !commitTime(field)) field.querySelector('.time-text').value = dateTarget(field)?.data[field.dataset.timeProp] || '';
    field.querySelector('.date-popover').hidden = true;
    field.querySelector('.date-display').setAttribute('aria-expanded', 'false');
  });
}

export const dateActions = ['toggle-date', 'close-date', 'clear-date', 'pick-date', 'cal-step', 'cal-today', 'pick-time'];

export function handleDateAction(control, action) {
  const field = control.closest('.date-field'); const popover = field.querySelector('.date-popover');
  const target = dateTarget(field); if (!target) return;
  const { dateProp, timeProp } = field.dataset;
  const showMonth = month => { popover.querySelector('.mini-cal').outerHTML = miniCalendarHtml(month, target.data[dateProp] || ''); };
  if (action === 'toggle-date') {
    closeDatePopovers(field);
    if (!popover.hidden && !commitTime(field)) return;
    popover.hidden = !popover.hidden; control.setAttribute('aria-expanded', String(!popover.hidden));
    if (!popover.hidden) {
      // 아래 공간이 모자라면 위로 연다.
      const rect = field.getBoundingClientRect(); const limit = field.closest('dialog')?.getBoundingClientRect().bottom ?? window.innerHeight;
      popover.classList.toggle('up', limit - rect.bottom < 400 && rect.top > 420);
      showMonth((target.data[dateProp] || todayKey()).slice(0, 7));
      (popover.querySelector('.mini-day.selected') || popover.querySelector('.mini-day.today') || popover.querySelector('.mini-day:not(.outside)')).focus();
    }
  }
  if (action === 'cal-step') {
    const [year, month] = popover.querySelector('.mini-cal').dataset.month.split('-').map(Number);
    showMonth(dateKey(new Date(year, month - 1 + Number(control.dataset.step), 1)).slice(0, 7));
    popover.querySelector(`[data-action=cal-step][data-step="${control.dataset.step}"]`).focus();
  }
  if (action === 'cal-today') { showMonth(todayKey().slice(0, 7)); popover.querySelector('.mini-day.today')?.focus(); }
  if (action === 'pick-date') {
    // 날짜를 누르면 바로 저장하고, 시각을 넣을 수 있게 창은 열어 둔다.
    target.data[dateProp] = control.dataset.date;
    showMonth(control.dataset.date.slice(0, 7)); dateChanged(field, target);
    popover.querySelector(`.mini-day[data-date="${control.dataset.date}"]`)?.focus();
  }
  if (action === 'clear-date') {
    target.data[dateProp] = ''; target.data[timeProp] = '';
    popover.querySelector('.time-text').value = ''; dateChanged(field, target);
  }
  if (action === 'pick-time') { popover.querySelector('.time-text').value = control.dataset.time; commitTime(field); }
  if (action === 'close-date' && !commitTime(field)) return;
  if (action === 'close-date' || action === 'clear-date') { popover.hidden = true; field.querySelector('.date-display').setAttribute('aria-expanded', 'false'); field.querySelector('.date-display').focus(); }
}

// 새 공고 창 안의 날짜 칸도 같은 달력을 쓴다.
postingDialog.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (control && dateActions.includes(control.dataset.action)) { handleDateAction(control, control.dataset.action); return; }
  if (!event.target.closest('.date-field')) closeDatePopovers();
});

export function renderDialogDates() {
  const form = $('#posting-form');
  const proxy = new Proxy({}, { get: (_, key) => form.elements[key]?.value || '' });
  form.querySelectorAll('[data-date-slot]').forEach(slot => { const [dateProp, timeProp, label] = slot.dataset.dateSlot.split('|'); slot.innerHTML = dateFieldHtml(proxy, dateProp, timeProp, label); });
}
