// 지원 현황 위의 '목표 · 자격' 두 줄: 진행 중인 목표와 가진 자격을 간단히 보고, 눌러서 고친다.
import { $, main } from './dom.js';
import { addMonths, goalProgress, goalStatuses, isLanguageTest, monthLabel, newCert, newGoal, normalizeMonth, splitCertTitle } from './model.js';
import { navTo } from './router.js';
import { data, view } from './state.js';
import { persist, scheduleSave } from './store.js';
import { animateReorder, flushPending, reducedMotion, showToast } from './ui.js';
import { autoGrow, escapeHtml, icon, todayKey, uid } from './util.js';

const byTarget = (a, b) => (a.target || '9999-99').localeCompare(b.target || '9999-99') || (a.createdAt || '').localeCompare(b.createdAt || '');
const goalsIn = status => (data.goals || []).filter(goal => goal.status === status).sort(byTarget);
const touch = item => { item.updatedAt = new Date().toISOString(); };

// 진행률: 글자 크기만 한 작은 파이와 %. --p가 바뀌면 부드럽게 채워진다.
const pieHtml = percent => `<span class="pct${percent >= 100 ? ' full' : ''}" style="--p: ${percent}"><span class="pie" aria-hidden="true"></span><span class="pct-value">${percent}%</span></span>`;

const updatePie = (element, percent) => {
  const pct = element?.querySelector('.pct'); if (!pct) return;
  pct.style.setProperty('--p', percent); pct.classList.toggle('full', percent >= 100); pct.querySelector('.pct-value').textContent = `${percent}%`;
};

// ---------- 지원 현황 위: 진행 중 · 남은 목표 · 자격 · 해 온 것 ----------
const SHOWN = 4;

function doingItem(goal) {
  const { total, percent } = goalProgress(goal);
  const next = goal.tasks.find(task => !task.done);
  const id = escapeHtml(goal.id);
  const sub = next
    ? `<button type="button" class="gb-next" data-action="check-task" data-id="${id}" data-task="${escapeHtml(next.id)}" title="끝냈으면 체크"><span class="check-box" aria-hidden="true"></span><span>${escapeHtml(next.text)}</span></button>`
    : total ? '<span class="gb-sub">할 일을 모두 끝냈어요</span>'
    : `<span class="gb-sub gb-adjust"><button type="button" data-action="progress-step" data-id="${id}" data-step="-10" aria-label="10% 줄이기"${percent <= 0 ? ' disabled' : ''}>−</button><button type="button" data-action="progress-step" data-id="${id}" data-step="10" aria-label="10% 늘리기"${percent >= 100 ? ' disabled' : ''}>+</button></span>`;
  return `<li class="gb-item gb-goal" role="button" tabindex="0" draggable="true" data-action="open-goal" data-id="${id}"><span class="gb-line"><span class="gb-title">${escapeHtml(goal.title) || '제목 없는 목표'}</span>${pieHtml(percent)}</span>${sub}</li>`;
}

// 아직 시작하지 않은 목표 표시: 점선 원. CSS 점선 테두리는 작은 원에서 점선이 고르지 않아(특히 사파리) SVG로 그린다.
const todoRing = '<svg class="todo-ring" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" pathLength="24" /></svg>';

const todoItem = goal => `<li class="gb-item" role="button" tabindex="0" draggable="true" data-action="open-goal" data-id="${escapeHtml(goal.id)}"><span class="gb-line"><span class="gb-mark" aria-hidden="true">${todoRing}</span><span class="gb-title">${escapeHtml(goal.title) || '제목 없는 목표'}</span><span class="gb-meta">${escapeHtml(monthLabel(goal.target))}</span></span></li>`;

// 해 온 것: 끝낸 목표, 자격 · 어학 점수, 최종 합격을 날짜순으로 한데 모은다.
// 자격증 목표를 완료해 자격이 생겼으면 목표 대신 자격 한 줄로만 보여 준다.
function doneEntries() {
  const month = todayKey().slice(0, 7);
  const certIds = new Set((data.certs || []).map(cert => cert.id));
  const certNames = new Set((data.certs || []).map(cert => cert.name.trim().toLowerCase()));
  const hasCert = goal => (goal.certId && certIds.has(goal.certId)) || (goal.kind === 'cert' && certNames.has(splitCertTitle(goal.title).name.toLowerCase()));
  return [
    ...goalsIn('done').filter(goal => !hasCert(goal)).map(goal => ({ id: goal.id, month: (goal.doneAt || goal.updatedAt || '').slice(0, 7), title: goal.title || '제목 없는 목표', type: 'goal', action: 'open-goal', at: goal.updatedAt || '' })),
    ...(data.certs || []).map(cert => ({ id: cert.id, month: cert.acquired || '', title: cert.name || '이름 없음', score: cert.score, expired: Boolean(cert.expires && cert.expires < month), expires: cert.expires, type: 'cert', action: 'open-cert', at: cert.updatedAt || cert.createdAt || '' })),
    ...data.postings.filter(item => item.status === '최종 합격').map(item => ({ id: item.id, month: (item.updatedAt || '').slice(0, 7), title: `${item.organization} 최종 합격`, type: 'pass', action: 'open-posting-page', at: item.updatedAt || '' })),
  ].sort((a, b) => (b.month || '0').localeCompare(a.month || '0') || b.at.localeCompare(a.at)); // 같은 달이면 최근에 넣거나 고친 것부터
}

const certTitle = entry => [entry.month ? `${entry.month.replace('-', '.')} 취득` : '', entry.expires ? (entry.expired ? '유효기간 지남' : `${entry.expires.replace('-', '.')}까지`) : ''].filter(Boolean).join(' · ');

const doneItem = entry => `<li class="gb-item${entry.expired ? ' expired' : ''}" role="button" tabindex="0"${entry.type === 'goal' ? ' draggable="true"' : ''} data-action="${entry.action}" data-id="${escapeHtml(entry.id)}"${entry.type === 'cert' ? ` title="${escapeHtml(certTitle(entry))}"` : ''}><span class="gb-line"><span class="gb-mark done${entry.type === 'cert' ? ' cert' : ''}" aria-hidden="true">${icon(entry.type === 'cert' ? 'award' : 'check')}</span><span class="gb-title">${escapeHtml(entry.title)}${entry.score ? `<span class="gb-score">${escapeHtml(entry.score)}</span>` : ''}</span><span class="gb-meta">${escapeHtml(monthLabel(entry.month))}</span></span></li>`;

// 세 칸(해 온 것 · 진행 중 · 남은 목표)은 목표를 끌어다 놓아 상태를 바꿀 수 있다.
function column(key, title, items, render, empty, add) {
  // 진행 중은 지금 하는 일이라 모두 보여 준다. 나머지 칸은 4개까지만.
  const limit = key === 'doing' ? Infinity : SHOWN;
  const more = items.length - limit;
  // 해 온 것의 +는 자격 · 점수와 이룬 일 중에서 고른다.
  const addButton = key === 'done'
    ? `<span class="gb-menu-wrap"><button type="button" class="gb-add" data-action="done-menu" aria-label="해 온 것에 추가" aria-expanded="false">${icon('plus')}</button><span class="gb-menu" hidden><button type="button" data-action="new-cert">${icon('award')}자격 · 어학 점수</button><button type="button" data-action="new-done-goal">${icon('check')}이룬 일 (수료, 합격 등)</button></span></span>`
    : add ? `<button type="button" class="gb-add" data-action="${add}" data-status="${key}" aria-label="${title}에 추가">${icon('plus')}</button>` : '';
  return `<div class="gb-col goal-col" data-col="${key}"><h3>${title}${items.length ? `<span>${items.length}</span>` : ''}${addButton}</h3>
    ${items.length ? `<ul>${items.slice(0, limit).map(render).join('')}</ul>` : `<p class="gb-empty">${empty}</p>`}
    ${more > 0 ? `<button type="button" class="gb-more" data-action="all-goals">${more}개 더 보기</button>` : ''}</div>`;
}

export function goalStripHtml() {
  return `<section class="goal-board" id="goal-strip" aria-label="목표와 해 온 것">
    ${column('done', '해 온 것', doneEntries(), doneItem, '이룬 목표, 자격증, 어학 점수가 여기에 쌓여요.', '')}
    ${column('doing', '진행 중', goalsIn('doing'), doingItem, '지금 하고 있는 목표', 'new-goal')}
    ${column('todo', '남은 목표', goalsIn('todo'), todoItem, '앞으로 하고 싶은 일', 'new-goal')}
  </section>`;
}

function refreshGoals() {
  const strip = $('#goal-strip'); if (strip) strip.outerHTML = goalStripHtml();
  if (goalListDialog?.open) renderGoalList();
}

// ---------- 목표 전체 창: 진행 중 · 남은 목표 · 지난 목표 ----------
let goalListDialog = null;

function renderGoalList() {
  const row = goal => {
    const { percent } = goalProgress(goal);
    const mark = goal.status === 'doing' ? `<span class="list-mark">${pieHtml(percent)}</span>` : `<span class="list-mark">${todoRing}</span>`;
    const when = goal.target ? `${monthLabel(goal.target)} 목표` : '';
    return `<li><button type="button" class="goal-row" data-goal="${escapeHtml(goal.id)}">${mark}<span class="goal-row-title">${escapeHtml(goal.title) || '제목 없는 목표'}</span><span class="goal-row-when">${escapeHtml(when)}</span></button></li>`;
  };
  const doneRow = entry => `<li><button type="button" class="goal-row is-done${entry.expired ? ' expired' : ''}" data-${entry.type === 'cert' ? 'cert' : entry.type === 'pass' ? 'posting' : 'goal'}="${escapeHtml(entry.id)}"><span class="list-mark done${entry.type === 'cert' ? ' cert' : ''}">${icon(entry.type === 'cert' ? 'award' : 'check')}</span><span class="goal-row-title">${escapeHtml(entry.title)}${entry.score ? `<span class="gb-score">${escapeHtml(entry.score)}</span>` : ''}</span><span class="goal-row-when">${escapeHtml(monthLabel(entry.month))}</span></button></li>`;
  const group = (title, items, render, empty) => `<section class="goal-group"><h3>${title}<span>${items.length}</span></h3>${items.length ? `<ul>${items.map(render).join('')}</ul>` : `<p class="faint">${empty}</p>`}</section>`;
  goalListDialog.innerHTML = `<div class="dialog-top"><div><p class="eyebrow">목표</p><h2>전체 보기</h2></div><button type="button" class="icon-button" data-close aria-label="닫기">×</button></div>
    ${group('해 온 것', doneEntries(), doneRow, '이룬 목표, 자격증, 어학 점수가 여기에 쌓여요.')}${group('진행 중', goalsIn('doing'), row, '진행 중인 목표가 없어요.')}${group('남은 목표', goalsIn('todo'), row, '앞으로 하고 싶은 일을 적어 두세요.')}
    <div class="dialog-actions"><button type="button" class="ghost-button" data-new>${icon('plus')}남은 목표 추가</button><span class="dialog-spacer"></span><button type="button" class="primary-button" data-close>닫기</button></div>`;
}

function openGoalList() {
  goalListDialog ||= makeDialog('goal-list-dialog', '전체 목표');
  const dialog = goalListDialog;
  renderGoalList();
  dialog.onclick = event => {
    const control = event.target.closest('button'); if (!control) return;
    if (control.hasAttribute('data-close')) dialog.close();
    const goal = data.goals.find(entry => entry.id === control.dataset.goal);
    if (goal) { dialog.close(); openGoalDialog(goal); }
    const cert = data.certs.find(entry => entry.id === control.dataset.cert);
    if (cert) { dialog.close(); openCertDialog(cert); }
    if (control.dataset.posting) { dialog.close(); navTo('posting-detail', control.dataset.posting); }
    if (control.hasAttribute('data-new')) { dialog.close(); const created = newGoal('todo'); data.goals.push(created); openGoalDialog(created); }
  };
  if (!dialog.open) dialog.showModal();
}

// ---------- 목표 완료·시작 ----------
function finishGoal(goal) {
  goal.status = 'done'; goal.doneAt = todayKey(); touch(goal);
  let cert = null;
  if (goal.kind === 'cert' && !(data.certs || []).some(entry => entry.id === goal.certId)) {
    // '토익스피킹 IH' 같은 목표는 이름과 등급을 나눠 넣고, 어학 성적이면 유효기간(2년)도 채운다.
    const { name, score } = splitCertTitle(goal.title); const acquired = todayKey().slice(0, 7);
    cert = { ...newCert(name), score, acquired, expires: isLanguageTest(name) ? addMonths(acquired, 24) : '' };
    data.certs.push(cert); goal.certId = cert.id;
  }
  persist(); animateReorder(refreshGoals, goal.id);
  const undo = { label: '되돌리기', run: () => {
    goal.status = 'doing'; goal.doneAt = '';
    if (cert) { data.certs = data.certs.filter(entry => entry !== cert); goal.certId = ''; }
    touch(goal); persist(); animateReorder(refreshGoals, goal.id);
  } };
  if (cert) showToast(`‘${goal.title}’ 완료! 해 온 것에 자격으로 남겼어요.`, cert.score ? undo : [{ label: '점수 적기', run: () => openCertDialog(cert) }, undo]);
  else showToast(`‘${goal.title || '목표'}’ 완료! 해 온 것에 남겼어요.`, undo);
}

// 체크하면 같은 자리에 다음 할 일이 나타나므로, 잇따라 누른 두 번째 클릭은 무시한다.
let lastCheck = 0;

function checkTask(goal, taskId) {
  if (Date.now() - lastCheck < 900) return;
  lastCheck = Date.now();
  const task = goal.tasks.find(entry => entry.id === taskId); if (!task) return;
  task.done = true; touch(goal); persist();
  // 원만 먼저 채우고, 잠깐 뒤에 다음 할 일로 바꿔 그린다.
  const item = main.querySelector(`.gb-goal[data-id="${CSS.escape(goal.id)}"]`);
  const { percent } = goalProgress(goal);
  updatePie(item, percent);
  item?.querySelector('.gb-next')?.classList.add('checked');
  setTimeout(() => { if (!goalDialog?.open) refreshGoals(); }, reducedMotion() ? 0 : 420);
  const undo = { label: '되돌리기', run: () => { task.done = false; touch(goal); persist(); refreshGoals(); } };
  if (percent >= 100) showToast('할 일을 모두 끝냈어요. 목표를 완료로 옮길까요?', [{ label: '완료로 옮기기', run: () => finishGoal(goal) }, undo]);
  else showToast(`‘${task.text}’ 끝!`, undo);
}

// ---------- 목표 창 ----------
let goalDialog = null; let certDialog = null;

// 창을 닫으면 빈 항목을 정리하고 저장한 뒤 목표 · 자격 줄을 다시 그린다.
const closed = () => { flushPending(); refreshGoals(); };

function makeDialog(className, label) {
  const dialog = document.createElement('dialog'); dialog.className = `form-dialog ${className}`; dialog.setAttribute('aria-label', label);
  document.body.append(dialog);
  return dialog;
}

const segmented = (name, options, value) => `<div class="segmented" role="radiogroup">${options.map(([key, label]) => `<button type="button" role="radio" class="segment${key === value ? ' active' : ''}" data-set="${name}" data-value="${key}" aria-checked="${key === value}">${label}</button>`).join('')}</div>`;

function taskHtml(task) {
  return `<li class="task${task.done ? ' done' : ''}" data-task="${escapeHtml(task.id)}"><label class="task-check"><input type="checkbox"${task.done ? ' checked' : ''} aria-label="끝냄"><span class="check-box" aria-hidden="true"></span></label><input class="task-text" value="${escapeHtml(task.text)}" aria-label="할 일"><button type="button" class="icon-button task-delete" aria-label="할 일 삭제">×</button></li>`;
}

// 목표 시기: 이번 달부터 1년 반 뒤까지 고른다. 이미 지난 달이 적혀 있으면 그 달도 보여 준다.
function monthOptions(selected) {
  const start = todayKey().slice(0, 7);
  const months = Array.from({ length: 19 }, (_, index) => addMonths(start, index));
  if (selected && !months.includes(selected)) months.unshift(selected);
  return `<option value="">정하지 않음</option>${months.map(month => `<option value="${month}"${month === selected ? ' selected' : ''}>${new Date(`${month}-01T00:00`).getFullYear()}년 ${Number(month.slice(5))}월</option>`).join('')}`;
}

function goalDialogHtml(goal) {
  const { done, total, percent } = goalProgress(goal);
  return `<div class="dialog-top"><div><p class="eyebrow">${goal.kind === 'cert' ? '자격증 목표' : '목표'}</p></div><button type="button" class="icon-button" data-close aria-label="닫기">×</button></div>
    <textarea class="goal-title-input" rows="1" placeholder="목표 (예: 정보처리기사 실기 합격)" aria-label="목표">${escapeHtml(goal.title)}</textarea>
    <div class="goal-props">
      <span class="goal-prop-label">종류</span>${segmented('kind', [['goal', '목표'], ['cert', '자격증']], goal.kind)}
      <span class="goal-prop-label">상태</span>${segmented('status', goalStatuses, goal.status)}
      <span class="goal-prop-label">목표 시기</span><select class="goal-month" aria-label="목표 시기">${monthOptions(goal.target)}</select>
    </div>
    <div class="goal-progress-head"><strong>진행 정도</strong>${pieHtml(percent)}<span class="faint">${total ? `할 일 ${done}/${total}개 끝냄` : '할 일을 나눠 적으면 끝낸 만큼 채워져요'}</span></div>
    <ul class="task-list">${goal.tasks.map(taskHtml).join('')}</ul>
    <input class="task-new" placeholder="+ 할 일 추가 (Enter)" aria-label="할 일 추가">
    ${total ? '' : `<label class="progress-range"><span>직접 정하기</span><input type="range" min="0" max="100" step="10" value="${percent}" aria-label="진행률"><output>${percent}%</output></label>`}
    <textarea class="goal-note" rows="2" placeholder="메모 (공부 방법, 참고 자료 등)" aria-label="메모">${escapeHtml(goal.note)}</textarea>
    <div class="dialog-actions"><button type="button" class="ghost-button danger" data-delete>${icon('trash')}삭제</button><span class="dialog-spacer"></span><button type="button" class="primary-button" data-close>확인</button></div>`;
}

function openGoalDialog(goal) {
  goalDialog ||= makeDialog('goal-dialog', '목표');
  const dialog = goalDialog; dialog.dataset.id = goal.id;
  const redraw = ({ keepFocus = null } = {}) => {
    dialog.innerHTML = goalDialogHtml(goal);
    dialog.querySelectorAll('textarea').forEach(autoGrow);
    if (keepFocus) dialog.querySelector(keepFocus)?.focus();
  };
  // 진행률 원과 설명만 바꿔, 할 일을 체크할 때 원이 부드럽게 늘어나게 한다.
  const refreshProgress = () => {
    const { done, total, percent } = goalProgress(goal);
    updatePie(dialog.querySelector('.goal-progress-head'), percent);
    dialog.querySelector('.goal-progress-head .faint').textContent = total ? `할 일 ${done}/${total}개 끝냄` : '할 일을 나눠 적으면 끝낸 만큼 채워져요';
  };
  const changed = () => { touch(goal); scheduleSave(); };
  redraw();
  dialog.oninput = event => {
    const target = event.target;
    if (target.classList.contains('goal-title-input')) { goal.title = target.value.replace(/\n/g, ' '); autoGrow(target); }
    else if (target.classList.contains('goal-note')) { goal.note = target.value; autoGrow(target); }
    else if (target.classList.contains('task-text')) goal.tasks.find(task => task.id === target.closest('.task').dataset.task).text = target.value;
    else if (target.type === 'range') { goal.progress = Number(target.value); target.nextElementSibling.textContent = `${target.value}%`; refreshProgress(); }
    else return;
    changed();
  };
  dialog.onchange = event => {
    const target = event.target;
    if (target.classList.contains('goal-month')) { goal.target = target.value; changed(); }
    if (target.type === 'checkbox') {
      const task = goal.tasks.find(entry => entry.id === target.closest('.task').dataset.task);
      task.done = target.checked; target.closest('.task').classList.toggle('done', task.done); changed(); refreshProgress();
    }
  };
  dialog.onkeydown = event => {
    if (event.isComposing) return;
    if (event.key === 'Enter' && event.target.classList.contains('goal-title-input')) { event.preventDefault(); dialog.querySelector('.task-new').focus(); }
    if (event.key === 'Enter' && event.target.classList.contains('task-new') && event.target.value.trim()) {
      event.preventDefault();
      goal.tasks.push({ id: uid(), text: event.target.value.trim(), done: false }); changed();
      redraw({ keepFocus: '.task-new' });
    }
  };
  dialog.onclick = event => {
    const control = event.target.closest('button'); if (!control) return;
    if (control.hasAttribute('data-close')) { dialog.close(); onClosed(); return; }
    if (control.hasAttribute('data-delete')) {
      const index = data.goals.indexOf(goal); if (index >= 0) data.goals.splice(index, 1);
      persist(); dialog.close(); onClosed();
      if (goal.title) showToast(`‘${goal.title}’ 목표를 삭제했어요.`, { label: '되돌리기', run: () => { data.goals.splice(Math.min(index, data.goals.length), 0, goal); persist(); refreshGoals(); } });
      return;
    }
    if (control.classList.contains('task-delete')) { goal.tasks = goal.tasks.filter(task => task.id !== control.closest('.task').dataset.task); changed(); redraw(); return; }
    if (control.dataset.set === 'kind') { goal.kind = control.dataset.value; changed(); redraw(); }
    if (control.dataset.set === 'status' && control.dataset.value !== goal.status) {
      // 완료로 옮기면 finishGoal이 다시 그리므로, 창을 닫을 때는 그리지 않는다.
      if (control.dataset.value === 'done') { dialog.close(); onClosed({ render: false }); finishGoal(goal); return; }
      goal.status = control.dataset.value; goal.doneAt = ''; changed(); redraw();
    }
  };
  // 제목 없이 닫은 새 목표는 남기지 않는다. 버튼으로 닫으면 바로, Esc로 닫으면 close 이벤트에서 한 번만 정리한다.
  let done = false;
  const onClosed = ({ render = true } = {}) => {
    if (done) return; done = true;
    if (!goal.title.trim() && !goal.tasks.length && !goal.note.trim()) data.goals = data.goals.filter(entry => entry !== goal);
    persist(); if (render) closed(); else flushPending();
  };
  // 늦게 도착한 이전 창의 close 이벤트가 새로 연 창을 정리하지 않게 한다.
  dialog.onclose = () => { if (!dialog.open) onClosed(); };
  if (!dialog.open) dialog.showModal();
  // 글 입력칸 높이는 창이 열린 뒤에야 잴 수 있다.
  dialog.querySelectorAll('textarea').forEach(autoGrow);
  // 창이 낮을 때 아래쪽 '확인'에 포커스를 주면 사파리가 창을 아래로 스크롤해 제목·종류·상태가 잘린다.
  // 그래서 맨 위의 닫기(×) 버튼에 포커스를 준다(자동 저장이라 Enter로 닫아도 같다).
  (goal.title ? dialog.querySelector('.dialog-top [data-close]') : dialog.querySelector('.goal-title-input')).focus({ preventScroll: true });
  dialog.scrollTop = 0;
}

// ---------- 자격증 창 ----------
// 연·월 고르기. 사파리(맥 앱)는 달 입력칸(type=month)을 지원하지 않아 목록 두 개로 고른다.
function monthPickerHtml(name, label, value, fromYear, toYear) {
  const [year, month] = (normalizeMonth(value) || '-').split('-');
  const years = []; for (let y = toYear; y >= fromYear; y--) years.push(String(y));
  if (year && !years.includes(year)) years.push(year);
  return `<div class="month-field"><span class="field-label">${label}</span><div class="month-picker" data-month-of="${name}">
    <select data-part="year" aria-label="${label} 연도"><option value="">연도</option>${years.map(y => `<option value="${y}"${y === year ? ' selected' : ''}>${y}년</option>`).join('')}</select>
    <select data-part="month" aria-label="${label} 월"><option value="">월</option>${Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')).map(m => `<option value="${m}"${m === month ? ' selected' : ''}>${Number(m)}월</option>`).join('')}</select></div></div>`;
}

function setMonthPicker(dialog, name, value) {
  const [year = '', month = ''] = value ? value.split('-') : [];
  const picker = dialog.querySelector(`.month-picker[data-month-of="${name}"]`); if (!picker) return;
  const yearSelect = picker.querySelector('[data-part=year]');
  if (year && ![...yearSelect.options].some(option => option.value === year)) yearSelect.add(new Option(`${year}년`, year));
  yearSelect.value = year; picker.querySelector('[data-part=month]').value = month;
}

function certDialogHtml(cert) {
  const field = (name, label, type, placeholder) => `<label class="full">${label}<input name="${name}" type="${type}" value="${escapeHtml(cert[name] || '')}" placeholder="${placeholder}" autocomplete="off"></label>`;
  const thisYear = new Date().getFullYear();
  return `<div class="dialog-top"><div><p class="eyebrow">자격 · 스펙</p><h2>${cert.name ? escapeHtml(cert.name) : '새 자격'}</h2></div><button type="button" class="icon-button" data-close aria-label="닫기">×</button></div>
    <div class="form-grid">${field('name', '이름', 'text', '예: 정보처리기사, TOEIC')}${field('score', '점수 · 등급', 'text', '예: 875점, 1급, IH')}${monthPickerHtml('acquired', '취득', cert.acquired, thisYear - 20, thisYear)}${monthPickerHtml('expires', '유효기간 끝 (있으면)', cert.expires, thisYear - 5, thisYear + 10)}<label class="full">메모<input name="note" value="${escapeHtml(cert.note || '')}" placeholder="자격번호, 발급기관 등" autocomplete="off"></label></div>
    <p class="field-help cert-hint" aria-live="polite">${certHistoryHtml(cert)}</p>
    <div class="dialog-actions"><button type="button" class="ghost-button danger" data-delete>${icon('trash')}삭제</button><span class="dialog-spacer"></span><button type="button" class="primary-button" data-close>확인</button></div>`;
}

// 다시 시험을 봐서 점수와 취득 달이 모두 바뀌면, 이전 성적을 기록으로 남긴다.
const certHistoryHtml = cert => (cert.history || []).length ? `이전 기록: ${cert.history.map(entry => `${escapeHtml(entry.score || '—')}${entry.acquired ? ` (${escapeHtml(entry.acquired.replace('-', '.'))})` : ''}`).join(', ')}` : '';

function openCertDialog(cert) {
  certDialog ||= makeDialog('cert-dialog', '자격 · 스펙');
  const dialog = certDialog;
  dialog.innerHTML = certDialogHtml(cert);
  const before = { score: cert.score, acquired: cert.acquired, expires: cert.expires };
  dialog.oninput = event => {
    // 연·월 목록: 연도만 고르면 1월로 채우고, 연도를 비우면 날짜를 지운다.
    const picker = event.target.closest('.month-picker');
    let name = event.target.name; let value = event.target.value;
    if (picker) {
      name = picker.dataset.monthOf;
      const yearSelect = picker.querySelector('[data-part=year]'); const monthSelect = picker.querySelector('[data-part=month]');
      if (yearSelect.value && !monthSelect.value) monthSelect.value = '01';
      if (!yearSelect.value) monthSelect.value = '';
      value = yearSelect.value ? `${yearSelect.value}-${monthSelect.value}` : '';
    }
    if (!name) return;
    cert[name] = value;
    if (name === 'name') dialog.querySelector('h2').textContent = value || '새 자격';
    // 어학 성적은 취득 달을 넣으면 유효기간(2년)을 채운다. 직접 적은 유효기간은 건드리지 않는다.
    if (name === 'acquired' && isLanguageTest(cert.name) && cert.acquired && (!before.expires || cert.expires === before.expires)) {
      cert.expires = addMonths(cert.acquired, 24); setMonthPicker(dialog, 'expires', cert.expires);
      dialog.querySelector('.cert-hint').textContent = '어학 성적이라 유효기간을 2년 뒤로 채웠어요.';
    }
    touch(cert); scheduleSave();
  };
  // 한 줄 칸에서 Enter는 '확인'과 같다.
  dialog.onkeydown = event => { if (event.key === 'Enter' && !event.isComposing && event.target.tagName === 'INPUT') { event.preventDefault(); dialog.close(); onClosed(); } };
  dialog.onclick = event => {
    const control = event.target.closest('button'); if (!control) return;
    if (control.hasAttribute('data-close')) { dialog.close(); onClosed(); }
    if (control.hasAttribute('data-delete')) {
      const index = data.certs.indexOf(cert); if (index >= 0) data.certs.splice(index, 1);
      persist(); dialog.close(); onClosed();
      if (cert.name) showToast(`‘${cert.name}’을(를) 삭제했어요.`, { label: '되돌리기', run: () => { data.certs.splice(Math.min(index, data.certs.length), 0, cert); persist(); refreshGoals(); } });
    }
  };
  let done = false;
  const onClosed = () => {
    if (done) return; done = true;
    if (!cert.name.trim() && !cert.score.trim()) data.certs = data.certs.filter(entry => entry !== cert);
    else if (before.score && cert.score !== before.score && cert.acquired !== before.acquired) cert.history = [{ score: before.score, acquired: before.acquired }, ...(cert.history || [])];
    persist(); closed();
  };
  dialog.onclose = () => { if (!dialog.open) onClosed(); };
  if (!dialog.open) dialog.showModal();
  // 창이 낮을 때 아래쪽 버튼에 포커스가 가며 위가 잘리지 않게, 스크롤하지 않고 포커스만 준다.
  dialog.querySelector(cert.name ? (cert.score ? '.dialog-top [data-close]' : 'input[name=score]') : 'input[name=name]').focus({ preventScroll: true });
  dialog.scrollTop = 0;
}

// ---------- 목표 · 자격 줄의 클릭 ----------
main.addEventListener('click', event => {
  if (view !== 'postings') return;
  // 해 온 것의 + 메뉴는 바깥을 누르면 닫는다.
  main.querySelectorAll('#goal-strip .gb-menu:not([hidden])').forEach(menu => { if (!menu.parentElement.contains(event.target)) { menu.hidden = true; menu.previousElementSibling.setAttribute('aria-expanded', 'false'); } });
  const control = event.target.closest('#goal-strip [data-action]'); if (!control) return;
  const action = control.dataset.action; const goal = (data.goals || []).find(entry => entry.id === control.dataset.id);
  if (action === 'all-goals') openGoalList();
  if (action === 'done-menu') {
    const menu = control.nextElementSibling; menu.hidden = !menu.hidden; control.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) menu.querySelector('button').focus();
    return;
  }
  if (action === 'new-done-goal') { const created = { ...newGoal('done'), doneAt: todayKey() }; data.goals.push(created); openGoalDialog(created); }
  if (action === 'open-posting-page') navTo('posting-detail', control.dataset.id);
  if (action === 'new-goal') { const created = newGoal(control.dataset.status || 'todo'); data.goals.push(created); openGoalDialog(created); }
  if (action === 'new-cert') { const created = newCert(); data.certs.push(created); openCertDialog(created); }
  if (action === 'open-cert') { const cert = data.certs.find(entry => entry.id === control.dataset.id); if (cert) openCertDialog(cert); }
  if (!goal) return;
  if (action === 'open-goal') openGoalDialog(goal);
  if (action === 'check-task') checkTask(goal, control.dataset.task);
  if (action === 'progress-step') {
    // 다시 그리지 않고 원과 숫자만 바꿔, 늘어나는 모습이 이어지게 한다.
    goal.progress = Math.max(0, Math.min(100, (Number(goal.progress) || 0) + Number(control.dataset.step))); touch(goal); persist();
    const item = control.closest('.gb-goal'); const percent = goalProgress(goal).percent;
    updatePie(item, percent);
    item.querySelector('[data-step="-10"]').disabled = percent <= 0; item.querySelector('[data-step="10"]').disabled = percent >= 100;
    if (percent >= 100) showToast('진행률 100%! 목표를 완료로 옮길까요?', { label: '완료로 옮기기', run: () => finishGoal(goal) });
  }
});

main.addEventListener('keydown', event => {
  if (event.key === 'Escape' && event.target.closest?.('.gb-menu-wrap')) {
    const wrap = event.target.closest('.gb-menu-wrap'); wrap.querySelector('.gb-menu').hidden = true;
    const toggle = wrap.querySelector('.gb-add'); toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); event.preventDefault(); return;
  }
  if (event.key === 'Enter' && event.target.classList?.contains('gb-item')) { event.preventDefault(); event.target.click(); }
});

// ---------- 목표 끌어서 옮기기: 해 온 것에 놓으면 완료, 진행 중이면 시작, 남은 목표면 보류 ----------
const moveLabels = { doing: '진행 중', todo: '남은 목표' };

function moveGoal(goal, status) {
  if (goal.status === status) return;
  if (status === 'done') { finishGoal(goal); return; }
  const before = { status: goal.status, doneAt: goal.doneAt };
  goal.status = status; goal.doneAt = ''; touch(goal); persist(); animateReorder(refreshGoals, goal.id);
  showToast(`‘${goal.title || '목표'}’를 ${moveLabels[status]}으로 옮겼어요.`, { label: '되돌리기', run: () => { Object.assign(goal, before); touch(goal); persist(); animateReorder(refreshGoals, goal.id); } });
}

main.addEventListener('dragstart', event => {
  const item = event.target.closest?.('#goal-strip .gb-item[draggable]'); if (!item) return;
  event.dataTransfer.setData('application/x-goal', item.dataset.id); event.dataTransfer.effectAllowed = 'move';
  requestAnimationFrame(() => item.classList.add('dragging'));
  main.querySelector('#goal-strip')?.classList.add('is-dragging');
});

main.addEventListener('dragend', event => {
  event.target.closest?.('.gb-item')?.classList.remove('dragging');
  main.querySelectorAll('#goal-strip .drop-target').forEach(col => col.classList.remove('drop-target'));
  main.querySelector('#goal-strip')?.classList.remove('is-dragging');
});

main.addEventListener('dragover', event => {
  const col = event.target.closest?.('#goal-strip .goal-col'); if (!col || !event.dataTransfer.types.includes('application/x-goal')) return;
  event.preventDefault();
  main.querySelectorAll('#goal-strip .drop-target').forEach(other => { if (other !== col) other.classList.remove('drop-target'); });
  col.classList.add('drop-target');
});

main.addEventListener('drop', event => {
  const col = event.target.closest?.('#goal-strip .goal-col'); if (!col) return;
  const goal = (data.goals || []).find(entry => entry.id === event.dataTransfer.getData('application/x-goal')); if (!goal) return;
  event.preventDefault();
  moveGoal(goal, col.dataset.col);
});
