// 공부 기록: 잔디(날마다 루틴을 얼마나 끝냈는지), 요일별 루틴, 교재 진도
import { $, main } from './dom.js';
import { data, view } from './state.js';
import { persist } from './store.js';
import { flushPending, reducedMotion, showToast } from './ui.js';
import { escapeHtml as esc, formatDateLong, icon, todayKey, uid } from './util.js';
import { addStarterPlan, bookProgress, dayProgress, categoryColor, grassRange, halfYear, liveBooks, liveRoutines, mondayOf, newStudyBook, removeBook, removeRoutine, studyCategories, certCategory, certGoals, recordStudy, routineFields, saveRoutineDefinition, shiftStudyDate, studyDayNames, studyDays, studyEntries, studyUnits, weekProgress } from './study-model.js';

let selectedDate = todayKey();
let lastToday = selectedDate;
let studyView = 'today';
let grassOffset = 0; // 잔디에 보이는 반년: 0은 오늘이 든 반년, -1은 그 앞
const bookById = id => data.studyBooks.find(book => book.id === id);
const goalTitle = id => id ? (data.goals || []).find(goal => goal.id === id)?.title || '' : '';
const daysLabel = days => days.length === 7 ? '매일' : days.length === 5 && [1, 2, 3, 4, 5].every(day => days.includes(day)) ? '평일' : studyDays.filter(day => days.includes(day)).map(day => studyDayNames[day]).join('·');
const action = (name, label, id = '', className = 'ghost-button') => `<button type="button" class="${className}" data-study-action="${name}" data-id="${esc(id)}">${label}</button>`;

const dayTitle = date => { const { done, total } = dayProgress(data, date); return `${formatDateLong(date)} · ${total ? `루틴 ${done}/${total}` : '예정된 루틴 없음'}`; };

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 잔디: 칸 하나가 하루, 그날 루틴을 끝낸 비율만큼 진해진다. 예정된 루틴이 없는 날은 쉬는 날로 흐리게, 앞으로 올 날은 테두리만.
function grassHtml() {
  const today = todayKey(); const { start, end } = halfYear(today, grassOffset); const weeks = grassRange(today, grassOffset);
  // 달 이름은 그달 1일이 든 주 위에 적는다(깃허브 잔디처럼 영어 약자).
  const months = weeks.map(week => { const first = week.find(date => date.endsWith('-01') && date >= start && date <= end); return `<span>${first ? monthNames[Number(first.slice(5, 7)) - 1] : ''}</span>`; }).join('');
  const cells = weeks.flat().map(date => {
    if (date < start || date > end) return '<span class="grass-cell outside" aria-hidden="true"></span>';
    const future = date > today; const { level } = dayProgress(data, date);
    const classes = ['grass-cell', `lv${future ? 0 : level ?? 0}`, level === null && 'rest', future && 'future', date === today && 'today', date === selectedDate && 'selected'].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" data-study-action="date" data-id="${date}" title="${esc(dayTitle(date))}" aria-label="${esc(dayTitle(date))}" aria-pressed="${date === selectedDate}"></button>`;
  }).join('');
  return `<div class="grass-scroll"><div class="grass" style="--weeks:${weeks.length}">
      <span class="grass-corner" aria-hidden="true"></span>
      <div class="grass-months" aria-hidden="true">${months}</div>
      <div class="grass-days" aria-hidden="true"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>
      <div class="grass-cells">${cells}</div>
    </div></div>`;
}

// 폭이 좁아 잔디를 가로로 밀어 봐야 할 때는 오늘(또는 고른 날)이 보이도록 맞춘다.
function scrollGrassToToday() {
  const scroller = main.querySelector('.grass-scroll'); if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
  const cell = scroller.querySelector('.grass-cell.selected') || scroller.querySelector('.grass-cell.today');
  scroller.scrollLeft = cell ? cell.offsetLeft - scroller.clientWidth / 2 : scroller.scrollWidth;
}

// 마지막 입력이 키보드였는지: 다시 그린 뒤 초점을 되돌릴 때 마우스로 누른 경우엔 초점 테두리를 띄우지 않는다.
let keyboardUsed = false;
document.addEventListener('keydown', () => { keyboardUsed = true; }, true);
document.addEventListener('pointerdown', () => { keyboardUsed = false; }, true);

// 왼쪽 위 카드: 이번 주 루틴(오늘까지) + 잔디 + 범례
function recordHtml() {
  const week = weekProgress(data, todayKey());
  const percent = week.total ? Math.min(100, Math.round(week.done / week.total * 100)) : 0;
  return `<section class="study-panel study-record" aria-label="공부한 날">
    <div class="study-panel-head"><h2>공부한 날</h2><div class="grass-nav">${action('grass-prev', icon('chevron-left') + '<span class="sr-only">이전 반년</span>', '', 'icon-button')}<span>${halfYear(todayKey(), grassOffset).label}</span>${grassOffset < 0 ? action('grass-next', icon('chevron-right') + '<span class="sr-only">다음 반년</span>', '', 'icon-button') : '<span class="grass-nav-spacer"></span>'}</div></div>
    <div class="study-week">
      <div class="study-week-numbers"><span>이번 주 루틴</span><strong>${week.done}<small> / ${week.total}</small></strong></div>
      <div class="study-bar" role="progressbar" aria-label="이번 주 루틴, 오늘까지" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div>
      <span class="study-week-note">오늘까지 할 루틴 기준</span>
    </div>
    ${grassHtml()}
    <div class="grass-legend" aria-hidden="true"><span>Less</span>${[0, 1, 2, 3, 4].map(level => `<span class="grass-cell lv${level}"></span>`).join('')}<span>More</span></div>
  </section>`;
}

function routineRow({ routine, definition, log }) {
  const done = Boolean(log?.done); const future = selectedDate > todayKey(); const book = bookById(definition.bookId);
  const goal = book ? `${definition.amount || routine.amount}${book.unit} 목표` : definition.target;
  const linkedGoal = goalTitle(routine.goalId);
  const detail = done && log.bookId ? '' : [linkedGoal, book?.name, goal].filter(Boolean).join(' · ');
  const amount = done && log.bookId ? `<span>${esc(log.bookName)} · <button type="button" class="study-amount" data-study-action="edit-amount" data-id="${esc(routine.id)}" title="분량 고치기">${log.amount}${esc(log.unit)}</button> 기록</span>` : '';
  return `<li class="study-routine-row${done ? ' is-complete' : ''}">
    <button type="button" class="study-check" role="checkbox" aria-checked="${done}" aria-label="${esc(definition.title)} ${done ? '완료 취소' : '완료'}" data-study-action="check" data-id="${esc(routine.id)}" ${future ? 'disabled title="해당 날짜가 되면 기록할 수 있어요"' : ''}>${icon('check')}</button>
    <div class="study-routine-copy"><strong>${esc(definition.title)}</strong>${detail ? `<span>${esc(detail)}</span>` : amount}</div>
    ${routine.deletedAt ? '<span class="study-row-edit" aria-hidden="true"></span>' : action('edit-routine', icon('edit') + `<span class="sr-only">${esc(definition.title)} 루틴 수정</span>`, routine.id, 'icon-button study-row-edit')}
  </li>`;
}

function dailyHtml() {
  const entries = studyEntries(data, selectedDate); const done = entries.filter(entry => entry.log?.done).length;
  // 체크해도 줄이 움직이지 않도록 루틴을 만든 순서 그대로 둔다(누르던 자리에서 다음 줄이 올라와 잘못 누르지 않게).
  const categories = [...new Set([...studyCategories(data), ...entries.map(entry => entry.definition.category)])];
  const groups = categories.map(category => {
    const rows = entries.filter(entry => entry.definition.category === category);
    return rows.length ? `<section class="study-category"><h3><span class="study-category-dot" style="background:var(--c-${categoryColor(data, category)})"></span>${esc(category)}<span class="study-small-count">${rows.length}</span></h3><ul>${rows.map(routineRow).join('')}</ul></section>` : '';
  }).join('') || '<p class="study-muted-row study-rest-day">이날은 예정된 루틴이 없어요.</p>';
  return `<div class="study-section-heading"><h2>${selectedDate === todayKey() ? `오늘의 루틴 <span class="study-small-count">${formatDateLong(selectedDate)}</span>` : formatDateLong(selectedDate)}</h2><span>${entries.length ? `${done} / ${entries.length} 완료` : ''}${selectedDate === todayKey() ? '' : action('today', '오늘로', '', 'study-text-button')}</span></div>
    ${!liveRoutines(data).length ? `<div class="study-empty"><h3>매일 이어갈 공부를 정해 보세요</h3><p>NCS 문제 풀이, 전공 교재, 자격증 공부처럼 반복할 루틴을 추가하세요.<br>공기업 전산직 필기 계획(민경채·응용수리·전공 이론·오답 다시 풀기·토요일 모의고사)으로 시작한 뒤 고쳐 써도 돼요.</p><div class="study-empty-actions">${action('starter-plan', '전산직 필기 계획으로 시작', '', 'primary-button')}${action('new-routine', icon('plus') + '직접 추가', '', 'secondary-button')}</div></div>` : groups}
    ${selectedDate > todayKey() ? '<p class="field-help">예정된 루틴이에요. 해당 날짜가 되면 완료를 기록할 수 있어요.</p>' : ''}`;
}

function routineManagementHtml() {
  const routines = liveRoutines(data);
  const rows = routines.map(routine => {
    const book = bookById(routine.bookId);
    return `<li class="study-managed-row${!routine.active ? ' paused' : ''}"><div class="study-routine-copy"><strong><span class="tag tag-${categoryColor(data, routine.category)} study-kind">${esc(routine.category)}</span>${esc(routine.title)}</strong><span>${esc(daysLabel(routine.days))}${goalTitle(routine.goalId) ? ` · ${esc(goalTitle(routine.goalId))}` : ''}${book ? ` · ${esc(book.name)} · ${routine.amount}${esc(book.unit)}` : routine.target ? ` · ${esc(routine.target)}` : ''}${routine.startDate > todayKey() ? ` · ${esc(formatDateLong(routine.startDate))} 시작` : ''}</span></div><div class="study-row-actions">${action('pause-routine', routine.active ? '일시정지' : '다시 시작', routine.id)}${action('edit-routine', '수정', routine.id)}${action('delete-routine', '삭제', routine.id, 'ghost-button danger')}</div></li>`;
  }).join('');
  return `<div class="study-section-heading"><h2>나의 루틴</h2><span>${routines.length}개</span></div>${rows ? `<ul class="study-managed-list">${rows}</ul>` : '<p class="study-muted-row">아직 등록한 루틴이 없어요. 위의 루틴 추가로 시작하세요.</p>'}<p class="field-help">루틴 수정과 일시정지는 오늘부터 적용돼요. 지난 날짜의 계획과 완료 기록은 남아 있어요.</p>`;
}

function booksHtml() {
  const books = liveBooks(data);
  const rows = books.map(book => {
    const progress = bookProgress(book, data.studyLogs);
    return `<li class="study-book">
      <div class="study-book-top"><span class="study-book-name">${esc(book.name)}</span><span class="study-book-percent">${progress.percent}%</span>${action('edit-book', icon('edit') + `<span class="sr-only">${esc(book.name)} 수정</span>`, book.id, 'icon-button study-book-edit')}</div>
      <div class="study-bar"><i style="width:${progress.percent}%"></i></div>
      <div class="study-book-meta"><span>${esc(book.subject || '과목 미지정')}</span><span>${progress.completed} / ${book.total}${esc(book.unit)}</span></div>
    </li>`;
  }).join('');
  return `<section class="study-panel study-books" aria-label="교재 진도">
    <div class="study-panel-head"><h2>교재 진도</h2>${action('new-book', icon('plus') + '<span>교재 추가</span>', '', 'study-text-button')}</div>
    ${rows ? `<ul class="study-book-list">${rows}</ul>` : '<p class="study-panel-empty">교재의 전체 분량을 등록하고 루틴에 연결하면, 체크할 때마다 진도가 쌓여요.</p>'}
  </section>`;
}

export function renderStudy() {
  const focused = document.activeElement?.closest('[data-study-action]');
  const focusAction = focused?.dataset.studyAction; const focusId = focused?.dataset.id;
  const currentToday = todayKey();
  if (selectedDate === lastToday && currentToday !== lastToday) selectedDate = currentToday;
  lastToday = currentToday;
  const tab = (key, iconName, label) => `<button type="button" class="view-tab${studyView === key ? ' active' : ''}" role="tab" aria-selected="${studyView === key}" data-study-action="view" data-id="${key}">${icon(iconName)}${label}</button>`;
  main.className = 'database-page study-page';
  main.innerHTML = `<header class="page-header"><h1 class="page-title">공부 기록</h1>${action('new-routine', icon('plus') + '루틴 추가', '', 'primary-button')}</header>
    <div class="study-layout">
      <aside class="study-side">${recordHtml()}${booksHtml()}</aside>
      <div class="study-main">
        <div class="view-bar"><div class="view-tabs" role="tablist" aria-label="공부 기록 보기">${tab('today', 'check', '오늘 루틴')}${tab('manage', 'book', '루틴·교재')}</div></div>
        <div class="study-content">${studyView === 'today' ? dailyHtml() : routineManagementHtml()}</div>
      </div>
    </div>`;
  if (focusAction) main.querySelector(`[data-study-action="${CSS.escape(focusAction)}"][data-id="${CSS.escape(focusId || '')}"]`)?.focus({ preventScroll: true, focusVisible: keyboardUsed });
  scrollGrassToToday();
}

// 다시 그려도 보던 위치를 지킨다(잔디 칸이나 오답 버튼을 누를 때).
const keepScroll = paint => { const top = window.scrollY; paint(); window.scrollTo({ top, behavior: 'instant' }); };

let dialog;
function showForm(title, body, onSubmit, { submit = '저장', description = '', onCancel = null, onDelete = null, deleteLabel = '삭제' } = {}) {
  dialog ||= document.body.appendChild(Object.assign(document.createElement('dialog'), { className: 'form-dialog study-dialog' }));
  if (dialog.open) dialog.close();
  dialog.setAttribute('aria-label', title);
  dialog.innerHTML = `<form><div class="dialog-top"><div><p class="eyebrow">공부 기록</p><h2>${esc(title)}</h2></div><button type="button" class="icon-button" data-close aria-label="닫기">×</button></div>${description ? `<p class="dialog-description">${description}</p>` : ''}<div class="form-grid">${body}</div><p class="study-form-error" role="alert" hidden></p><div class="dialog-actions">${onDelete ? `<button type="button" class="ghost-button danger" data-delete>${esc(deleteLabel)}</button>` : ''}<span class="dialog-spacer"></span><button type="button" class="secondary-button" data-close>취소</button><button type="submit" class="primary-button">${esc(submit)}</button></div></form>`;
  dialog.onclick = event => {
    if (event.target.closest('[data-close]')) { dialog.close(); onCancel?.(); return; }
    if (event.target.closest('[data-delete]')) { dialog.close(); onDelete(); return; }
    const segment = event.target.closest('[data-seg]:not(:disabled)');
    if (segment) {
      dialog.querySelector(`input[name="${segment.dataset.seg}"]`).value = segment.dataset.value;
      segment.parentElement.querySelectorAll('.segment').forEach(button => { const on = button === segment; button.classList.toggle('active', on); button.setAttribute('aria-checked', String(on)); });
      dialog.onchange?.();
      return;
    }
    const preset = event.target.closest('[data-days]');
    if (preset) { const days = preset.dataset.days.split(','); dialog.querySelectorAll('input[name=days]').forEach(box => { box.checked = days.includes(box.value); }); }
  };
  dialog.oncancel = event => { if (onCancel) { event.preventDefault(); dialog.close(); onCancel(); } };
  dialog.onclose = flushPending;
  dialog.onchange = null;
  dialog.onsubmit = event => {
    event.preventDefault();
    try { onSubmit(new FormData(event.target), event.target); }
    catch (error) { const message = dialog.querySelector('.study-form-error'); message.textContent = error.message; message.hidden = false; }
  };
  dialog.showModal();
  dialog.querySelector('input:not([disabled]):not([type=hidden]), select:not([disabled])')?.focus();
}

// 창 안의 칸을 보이거나 숨길 때: 새로 보이는 칸은 살짝 내려오며 나타나고, 창 높이는 부드럽게 바뀐다(윗변은 고정).
function resizeDialog(change, animate = true) {
  const fields = [...dialog.querySelectorAll('.form-grid > *')];
  const wasHidden = new Set(fields.filter(field => field.hidden));
  const before = dialog.getBoundingClientRect().height;
  change();
  if (!animate || reducedMotion()) return;
  const after = dialog.getBoundingClientRect().height;
  const timing = { duration: 220, easing: 'cubic-bezier(.2, .8, .2, 1)' };
  if (Math.abs(after - before) > 1) dialog.animate([{ height: `${before}px` }, { height: `${after}px` }], timing);
  for (const field of fields) if (wasHidden.has(field) && !field.hidden) field.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], timing);
}

function finishEdit(message) {
  dialog.close(); persist(); keepScroll(renderStudy); showToast(message);
}

function bookFields(book = {}) {
  return `<label class="full">교재 이름<input name="name" required maxlength="150" placeholder="예: 전산직 데이터베이스 기출" value="${esc(book.name || '')}"></label>
    <label>과목<input name="subject" maxlength="60" placeholder="예: 데이터베이스" value="${esc(book.subject || '')}"></label><div class="study-field"><span class="study-field-label">진도 단위</span>${segmentedField('unit', studyUnits.map(unit => [unit, unit]), book.unit || '쪽', Boolean(book.id && data.studyLogs.some(log => log.bookId === book.id)))}</div>
    <label>전체 분량<input name="total" type="number" min="1" max="1000000" step="1" required placeholder="예: 400" value="${book.total || ''}"></label><label>${book.id ? '등록 전 완료 분량' : '지금까지 완료한 분량'}<input name="initialProgress" type="number" min="0" step="1" required value="${book.initialProgress || 0}"></label>`;
}

function openBookDialog(book = null, afterSave = null) {
  showForm(book ? '교재 수정' : '교재 추가', bookFields(book || {}), values => {
    const validated = newStudyBook({ ...Object.fromEntries(values), unit: values.get('unit') || book?.unit });
    if (book) {
      const recorded = data.studyLogs.filter(log => log.done && log.bookId === book.id).reduce((sum, log) => sum + log.amount, 0);
      if (validated.total < validated.initialProgress + recorded) throw new Error('전체 분량이 기존 공부 기록보다 작아요. 전체 분량을 확인해 주세요.');
      Object.assign(book, validated, { id: book.id, createdAt: book.createdAt });
    } else data.studyBooks.push(validated);
    finishEdit(book ? '교재 정보를 수정했어요.' : '교재를 추가했어요.');
    afterSave?.(book || validated);
  }, { description: book ? '등록 전 분량에 날짜별 공부 기록을 더해 진도를 계산해요.' : '이미 공부한 분량부터 이어서 기록할 수 있어요.', onCancel: afterSave ? () => afterSave(null) : null, onDelete: book ? () => deleteBook(book) : null, deleteLabel: '교재 삭제' });
}

// 창 안의 작은 선택 막대(목표 창과 같은 모양). 고른 값은 같은 이름의 숨은 입력칸에 담긴다.
const segmentedField = (name, options, value, disabled = false, extra = '') => `<input type="hidden" name="${name}" value="${esc(value)}"><div class="segmented" role="radiogroup">${options.map(([key, label, title]) => `<button type="button" role="radio" class="segment${key === value ? ' active' : ''}" data-seg="${name}" data-value="${esc(key)}" aria-checked="${key === value}"${title ? ` title="${esc(title)}"` : ''}${disabled ? ' disabled' : ''}>${label}</button>`).join('')}${extra}</div>`;

function openRoutineDialog(routine = null, draft = null) {
  const today = todayKey(); const tomorrow = shiftStudyDate(today, 1); const nextMonday = shiftStudyDate(mondayOf(today), 7);
  const values = draft || routine || { title: '', category: 'NCS', target: '', days: [1, 2, 3, 4, 5], amount: 20, startDate: today, active: true };
  const startOptions = [[today, '오늘', `${formatDateLong(today)}부터`], [tomorrow, '내일', `${formatDateLong(tomorrow)}부터`], ...(nextMonday !== tomorrow ? [[nextMonday, '다음 주', `${formatDateLong(nextMonday)}부터`]] : [])];
  const bookOptions = liveBooks(data).map(book => `<option value="${esc(book.id)}"${values.bookId === book.id ? ' selected' : ''}>${esc(book.name)} (${esc(book.unit)})</option>`).join('');
  const dayChecked = day => values.days.map(Number).includes(day);
  // 자격증 루틴은 목표 보드의 자격증 목표 하나에 이을 수 있다(이미 이어 둔 목표가 완료됐어도 목록에 남긴다).
  const linkedGoal = (data.goals || []).find(goal => goal.id === values.goalId);
  const goalChoices = [...certGoals(data), ...(linkedGoal && !certGoals(data).includes(linkedGoal) ? [linkedGoal] : [])];
  const goalStatusLabel = { doing: '진행 중', todo: '남은 목표', done: '완료' };
  const goalOptions = goalChoices.map(goal => `<option value="${esc(goal.id)}"${goal.id === values.goalId ? ' selected' : ''}>${esc(goal.title || '제목 없는 목표')} · ${goalStatusLabel[goal.status] || ''}</option>`).join('');
  showForm(routine ? '루틴 수정' : '루틴 추가', `<label class="full">루틴 이름<input name="title" required maxlength="150" value="${esc(values.title)}" placeholder="예: 수리 문제 풀이, 데이터베이스 기출" autocomplete="off"></label>
    <div class="study-field study-field-wide"><span class="study-field-label">구분</span>${segmentedField('category', [...new Set([...studyCategories(data), values.category])].map(name => [name, esc(name)]), values.category, false, '<button type="button" class="segment segment-add" data-add-category>+ 추가</button>')}</div>
    <label class="full" data-cert-goal ${values.category === certCategory ? '' : 'hidden'}>어떤 자격증? <span class="faint">(선택)</span>${goalOptions ? `<select name="goalId" class="study-select"><option value="">목표에 잇지 않기</option>${goalOptions}</select><span class="field-help">이으면 지원 현황 목표 보드의 그 자격증 옆에 오늘 루틴 수가 보여요.</span>` : '<span class="field-help">지원 현황 위 목표 보드에 자격증 목표를 추가하면 여기서 이을 수 있어요.</span>'}</label>
    ${routine ? '' : `<div class="study-field"><span class="study-field-label">시작</span>${segmentedField('startDate', startOptions, startOptions.some(([key]) => key === values.startDate) ? values.startDate : today)}</div>`}
    <fieldset class="study-repeat full"><legend class="sr-only">반복 요일</legend><div class="study-repeat-head" aria-hidden="true"><span class="study-field-label">반복 요일</span><span class="study-day-presets"><button type="button" class="study-text-button" data-days="1,2,3,4,5" tabindex="-1">평일</button><button type="button" class="study-text-button" data-days="1,2,3,4,5,6,0" tabindex="-1">매일</button></span></div><div class="study-days">${studyDays.map(day => `<label><input type="checkbox" name="days" value="${day}"${dayChecked(day) ? ' checked' : ''}><span>${studyDayNames[day]}</span></label>`).join('')}</div></fieldset>
    <label class="full">교재 <span class="faint">(선택)</span><select name="bookId" class="study-select"><option value="">교재 없이</option>${bookOptions}</select></label>
    <div class="full study-inline-add"><button type="button" class="study-text-button" data-new-book>${icon('plus')}<span>새 교재 등록</span></button></div>
    <label class="full" data-quantity ${values.bookId ? '' : 'hidden'}>하루 목표 분량<span class="study-amount-input"><input name="amount" type="number" min="1" step="1" inputmode="numeric" value="${values.amount || 20}"><span data-unit></span></span></label>
    <label class="full" data-target ${values.bookId ? 'hidden' : ''}>할 내용 <span class="faint">(선택)</span><input name="target" maxlength="150" value="${esc(values.target || '')}" placeholder="예: 20문제 풀고 오답 복습" autocomplete="off"></label>`, form => {
    const definition = routineFields({ ...Object.fromEntries(form), days: form.getAll('days'), active: routine?.active !== false }, data.studyBooks);
    const date = todayKey();
    const item = routine || { id: uid(), startDate: form.get('startDate') || date, revisions: [], createdAt: new Date().toISOString() };
    const newlyLinked = definition.goalId && definition.goalId !== routine?.goalId ? (data.goals || []).find(goal => goal.id === definition.goalId) : null;
    saveRoutineDefinition(item, definition, date);
    if (!routine) data.studyRoutines.push(item);
    finishEdit(routine ? '오늘부터 루틴 변경을 반영했어요.' : '루틴을 추가했어요.');
    // 남은 목표에 있던 자격증에 루틴을 이으면, 공부를 시작한 것이니 진행 중으로 옮길지 묻는다(자동으로 옮기지는 않는다).
    if (newlyLinked?.status === 'todo') showToast(`‘${newlyLinked.title}’에 루틴을 이었어요. 진행 중으로 옮길까요?`, { label: '진행 중으로', run: () => { newlyLinked.status = 'doing'; newlyLinked.updatedAt = new Date().toISOString(); persist(); showToast(`‘${newlyLinked.title}’ 목표를 진행 중으로 옮겼어요.`); } });
  }, { description: routine ? '바꾼 내용은 오늘부터 적용되고, 지난 기록은 그대로 남아요.' : '교재를 연결하면 체크할 때마다 공부한 분량이 진도에 쌓여요.', onDelete: routine ? () => deleteRoutine(routine) : null, deleteLabel: '루틴 삭제' });
  wireCategoryAdd();
  // 자격증·교재에 따라 칸이 나타나거나 사라진다. 창 윗변은 그대로 두고 아래로만 부드럽게 늘고 줄게 한다.
  const updateFields = ({ animate = true } = {}) => resizeDialog(() => {
    const book = bookById(dialog.querySelector('[name=bookId]').value);
    dialog.querySelector('[data-quantity]').hidden = !book;
    dialog.querySelector('[name=amount]').required = Boolean(book);
    dialog.querySelector('[name=amount]').disabled = !book;
    dialog.querySelector('[data-target]').hidden = Boolean(book);
    dialog.querySelector('[data-unit]').textContent = book ? book.unit : '';
    const cert = dialog.querySelector('[name=category]').value === certCategory;
    dialog.querySelector('[data-cert-goal]').hidden = !cert;
    const goalSelect = dialog.querySelector('[name=goalId]'); if (goalSelect) goalSelect.disabled = !cert;
  }, animate);
  updateFields({ animate: false }); dialog.onchange = () => updateFields();
  dialog.querySelector('[data-new-book]').onclick = () => {
    const form = new FormData(dialog.querySelector('form'));
    const draft = { ...Object.fromEntries(form), days: form.getAll('days').map(Number) };
    dialog.close();
    openBookDialog(null, book => openRoutineDialog(routine, { ...draft, bookId: book?.id || draft.bookId }));
  };
}

// 루틴 창의 '+ 추가': 그 자리에서 새 구분 이름을 적으면 막대에 붙고 바로 골라진다(Enter로 확정, Esc로 취소).
function wireCategoryAdd() {
  const addButton = dialog.querySelector('[data-add-category]'); if (!addButton) return;
  addButton.onclick = () => {
    const input = Object.assign(document.createElement('input'), { className: 'study-new-category', maxLength: 20, placeholder: '새 구분', autocomplete: 'off' });
    input.setAttribute('aria-label', '새 구분 이름');
    addButton.replaceWith(input); input.focus();
    const commit = () => {
      if (!input.isConnected) return;
      const name = input.value.trim(); const bar = input.parentElement;
      if (name) {
        let segment = [...bar.querySelectorAll('[data-seg="category"]')].find(button => button.dataset.value === name);
        if (!segment) {
          segment = Object.assign(document.createElement('button'), { type: 'button', className: 'segment', textContent: name });
          Object.assign(segment.dataset, { seg: 'category', value: name }); segment.setAttribute('role', 'radio');
          bar.insertBefore(segment, input);
        }
        segment.click();
      }
      input.replaceWith(addButton);
      if (name) dialog.querySelector('[data-seg="category"].active')?.focus({ focusVisible: keyboardUsed }); else addButton.focus({ focusVisible: keyboardUsed });
    };
    input.onkeydown = event => {
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); input.value = ''; commit(); }
    };
    input.onblur = commit;
  };
}

// 루틴 삭제: 지난 기록은 남기고 오늘부터 목록에서 뺀다. 알림에서 되돌릴 수 있다.
function deleteRoutine(routine) {
  const undo = removeRoutine(data, routine, todayKey());
  persist(); keepScroll(renderStudy);
  showToast(`'${routine.title || '이름 없는'}' 루틴을 삭제했어요`, { label: '되돌리기', run: () => { undo(); persist(); keepScroll(renderStudy); } });
}

// 교재 삭제: 연결된 루틴은 오늘부터 교재 없이 이어진다. 알림에서 되돌릴 수 있다.
function deleteBook(book) {
  const { linked, undo } = removeBook(data, book, todayKey());
  persist(); keepScroll(renderStudy);
  showToast(`'${book.name}' 교재를 삭제했어요${linked ? ` · 연결된 루틴 ${linked}개는 교재 없이 이어져요` : ''}`, { label: '되돌리기', run: () => { undo(); persist(); keepScroll(renderStudy); } });
}

function checkRoutine(id) {
  if (selectedDate > todayKey()) return;
  const entry = studyEntries(data, selectedDate).find(item => item.routine.id === id);
  if (!entry) return;
  if (entry.log?.done) {
    entry.log.done = false; entry.log.updatedAt = new Date().toISOString(); persist(); keepScroll(renderStudy);
    showToast(entry.log.bookId ? '완료를 취소했어요. 교재 진도도 함께 되돌렸어요.' : '완료를 취소했어요.');
    return;
  }
  const date = selectedDate; const definition = entry.definition; const book = bookById(definition.bookId);
  const amount = book ? Math.min(definition.amount || 0, bookProgress(book, data.studyLogs).remaining) : 0;
  const before = main.querySelector(`.grass-cell[data-id="${date}"]`); const beforeColor = before && getComputedStyle(before).backgroundColor;
  recordStudy(data, definition, date, amount); persist(); keepScroll(renderStudy);
  // 체크칸이 살짝 튀고, 위쪽 잔디의 그날 칸은 예전 색에서 새 색으로 물들며 잔잔한 테두리가 한 번 퍼진다.
  if (!reducedMotion()) {
    main.querySelector(`.study-check[data-id="${CSS.escape(id)}"]`)?.classList.add('just-checked');
    const cell = main.querySelector(`.grass-cell[data-id="${date}"]`);
    if (cell && beforeColor) {
      const style = getComputedStyle(cell); const glow = style.getPropertyValue('--grass').trim() || style.backgroundColor;
      const ring = style.boxShadow === 'none' ? '' : `${style.boxShadow}, `;
      cell.animate([
        { backgroundColor: beforeColor, boxShadow: `${ring}0 0 0 0 color-mix(in srgb, ${glow} 70%, transparent)` },
        { backgroundColor: style.backgroundColor, boxShadow: `${ring}0 0 0 6px color-mix(in srgb, ${glow} 0%, transparent)` },
      ], { duration: 700, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    }
  }
  if (book) showToast(`${book.name} ${amount}${book.unit} 기록`, { label: '분량 고치기', run: () => editAmount(id, date) });
}

// 교재 루틴의 기록 분량 고치기: 목표와 다르게 공부한 날(덜 풀었거나 더 풀었거나)만 쓴다.
function editAmount(id, date = selectedDate) {
  const log = studyEntries(data, date).find(item => item.routine.id === id)?.log; const book = log && bookById(log.bookId);
  if (!log?.done || !book) return;
  const room = bookProgress(book, data.studyLogs, { exclude: log.id }).remaining;
  showForm('공부한 분량', `<div class="full study-record-summary"><strong>${esc(log.title)}</strong><span>${esc(book.name)} · ${esc(formatDateLong(log.date))}</span></div><label class="full">공부한 분량 (${esc(book.unit)})<input name="amount" type="number" min="0" max="${room}" step="1" required value="${log.amount}"></label><p class="field-help full">복습만 했다면 0으로 적어도 돼요. 이 교재에 남은 분량은 ${room}${esc(book.unit)}예요.</p>`, form => {
    const value = Number(form.get('amount'));
    if (!Number.isInteger(value) || value < 0 || value > room) throw new Error(`0부터 ${room}${book.unit} 사이로 적어 주세요.`);
    log.amount = value; log.updatedAt = new Date().toISOString();
    finishEdit('분량을 고쳤어요.');
  });
}

main.addEventListener('click', event => {
  const button = event.target.closest('[data-study-action]');
  if (!button || view !== 'study') return;
  const name = button.dataset.studyAction; const id = button.dataset.id;
  if (name === 'new-routine') openRoutineDialog();
  else if (name === 'new-book') openBookDialog();
  else if (name === 'edit-book') openBookDialog(bookById(id));
  else if (name === 'edit-routine') openRoutineDialog(data.studyRoutines.find(routine => routine.id === id));
  else if (name === 'delete-routine') { const routine = data.studyRoutines.find(entry => entry.id === id); if (routine) deleteRoutine(routine); }
  else if (name === 'check') checkRoutine(id);
  else if (name === 'edit-amount') editAmount(id);
  else if (name === 'grass-prev' || name === 'grass-next') { grassOffset = Math.min(0, grassOffset + (name === 'grass-next' ? 1 : -1)); keepScroll(renderStudy); }
  else if (name === 'starter-plan') { addStarterPlan(data, todayKey()); persist(); renderStudy(); showToast('필기 계획을 채웠어요. 루틴·교재 탭에서 고칠 수 있어요.'); }
  else if (name === 'pause-routine') {
    const routine = data.studyRoutines.find(entry => entry.id === id);
    saveRoutineDefinition(routine, { ...routine, active: !routine.active }, todayKey());
    persist(); renderStudy(); showToast(routine.active ? '루틴을 다시 시작했어요.' : '오늘부터 루틴을 일시정지했어요.');
  } else {
    if (name === 'view') studyView = id;
    if (name === 'date') { selectedDate = id; studyView = 'today'; }
    if (name === 'today') { selectedDate = todayKey(); grassOffset = 0; }
    if (name === 'previous-week') selectedDate = shiftStudyDate(selectedDate, -7);
    if (name === 'next-week') selectedDate = shiftStudyDate(selectedDate, 7);
    keepScroll(renderStudy);
  }
});

// 자정을 지나 앱으로 돌아왔을 때에도 오늘의 루틴으로 이어진다.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && view === 'study' && todayKey() !== lastToday && !document.querySelector('dialog[open]')) renderStudy();
});
