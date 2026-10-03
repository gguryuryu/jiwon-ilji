// 공고 상세 페이지: 속성, 공고 메모, 자소서 문항
import { dateFieldHtml, refreshDateField } from './date-field.js';
import { $, main } from './dom.js';
import { commonInterviewQuestions, employmentOptions, groupFor, nextStageStatus, speakingTime, statusOptions, statusTag } from './model.js';
import { detailTab, renderReviews, reviewsHtml, wireReviews } from './interview.js';
import { navTo } from './router.js';
import { closePeek, peekEdited } from './peek.js';
import { closingStatus } from './postings.js';
import { data, selectedId, view } from './state.js';
import { persist, saveNow, scheduleSave } from './store.js';
import { showToast } from './ui.js';
import { autoGrow, charCount, escapeHtml, formatDate, icon, optionsHtml, propRow, todayKey, validUrl } from './util.js';

// 삭제처럼 자주 쓰지 않는 동작은 ⋯ 메뉴 안에 둔다.
const moreMenu = (deleteAction, id) => `<details class="more-menu"><summary class="icon-button" aria-label="더보기" title="더보기">${icon('more')}</summary><div class="menu-panel" role="menu"><button type="button" class="menu-item danger" role="menuitem" data-action="${deleteAction}" data-id="${escapeHtml(id)}">${icon('trash')}삭제</button></div></details>`;

export function topbar(backAction, backIcon, backLabel, title, deleteAction, id) {
  return `<div class="page-topbar"><nav class="breadcrumb" aria-label="현재 위치"><button type="button" class="history-back" data-action="history-back" aria-label="뒤로 가기" title="뒤로 가기 (⌘[)">${icon('chevron-left')}</button><button type="button" data-action="${backAction}">${icon(backIcon)}${backLabel}</button><span class="crumb-sep">/</span><span class="crumb-current" id="crumb-current">${escapeHtml(title || '이름 없음')}</span></nav><div class="topbar-actions"><span class="topbar-save" data-save-state>저장됨</span>${moreMenu(deleteAction, id)}</div></div>`;
}

// 진행 중 공고의 다음 일정이 지났으면, 결과를 바로 남길 수 있게 다음 상태 두 개를 버튼으로 둔다.
function pastStepHtml(item) {
  const next = nextStageStatus(item.status);
  if (groupFor(item) !== 'active' || !item.nextDate || item.nextDate >= todayKey() || !next) return '';
  const button = status => `<button type="button" class="past-step-button" data-action="past-step" data-status="${escapeHtml(status)}">${escapeHtml(status)}</button>`;
  return `<div class="past-step"><span>지난 일정이에요. 결과를 남겨 둘까요?</span>${button(next)}${button(closingStatus(item.status))}</div>`;
}

// 캘린더에서 가져온 공고의 마감일이 캘린더를 따라가는지 보여 준다.
export function deadlineHint(item) {
  if (!item.calendarEventId?.startsWith('google:') || item.syncedDeadline === undefined) return '';
  const edited = (item.deadline || '') !== item.syncedDeadline || (item.deadlineTime || '') !== (item.syncedDeadlineTime || '');
  return edited
    ? `<button type="button" class="prop-hint" data-action="follow-calendar" title="캘린더 마감일: ${escapeHtml(formatDate(item.syncedDeadline))} ${escapeHtml(item.syncedDeadlineTime || '')}">직접 고침 · 캘린더 마감일로 되돌리기</button>`
    : '<span class="prop-hint">캘린더와 연동</span>';
}

// 피크 위쪽 막대: 닫기, 전체 페이지로 열기, 저장 상태, 삭제
function peekBar(item) {
  return `<div class="peek-bar"><button type="button" class="icon-button" data-action="close-peek" aria-label="닫기" title="닫기 (Esc)">${icon('chevrons-right')}</button><button type="button" class="icon-button" data-action="expand-peek" data-id="${escapeHtml(item.id)}" aria-label="전체 페이지로 열기" title="전체 페이지로 열기">${icon('expand')}</button><span class="peek-spacer"></span><span class="topbar-save" data-save-state>저장됨</span>${moreMenu('delete-posting', item.id)}</div>`;
}

// 전체 페이지(#/postings/…)와 지원 현황 위의 사이드 피크(#/peek/…)가 같은 내용을 그린다.
export function renderPostingDetail() {
  const item = data.postings.find(posting => posting.id === selectedId);
  const peek = view === 'postings';
  if (!item) return peek ? closePeek() : navTo('postings', null, { history: 'replace' });
  const container = peek ? $('#peek') : main;
  item.interviewQuestions ||= []; item.interviewReviews ||= [];
  const scroll = peek ? container.querySelector('.peek-scroll')?.scrollTop || 0 : 0;
  const employment = item.employmentType && !employmentOptions.includes(item.employmentType) ? [...employmentOptions, item.employmentType] : employmentOptions;
  const link = validUrl(item.url);
  const value = name => escapeHtml(item[name] || '');
  if (!peek) main.className = 'detail-page';
  container.innerHTML = `${peek ? peekBar(item) : topbar('back-postings', 'briefcase', '지원 현황', item.organization, 'delete-posting', item.id)}
    ${peek ? '<div class="peek-scroll">' : ''}<article class="detail-body">
      <textarea class="title-input" data-prop="organization" rows="1" placeholder="회사·기관명" aria-label="회사·기관명" autocomplete="off">${value('organization')}</textarea>
      <div class="props">
        ${propRow('user', '직무', `<input class="prop-input" data-prop="role" value="${value('role')}" placeholder="비어 있음" aria-label="직무" autocomplete="off">`)}
        ${propRow('status', '진행 상태', `<select class="${statusTag(item.status)} tag-select" data-prop="status" aria-label="진행 상태">${optionsHtml(statusOptions, item.status)}</select>`)}
        ${propRow('list', '고용형태', `<select class="prop-select" data-prop="employmentType" aria-label="고용형태"><option value="">비어 있음</option>${optionsHtml(employment, item.employmentType)}</select>`)}
        ${propRow('clock', '접수 마감', `<div class="prop-inline">${dateFieldHtml(item, 'deadline', 'deadlineTime', '접수 마감')}<span id="deadline-hint">${deadlineHint(item)}</span></div>`)}
        ${propRow('calendar', '다음 일정', `<div class="prop-inline">${dateFieldHtml(item, 'nextDate', 'nextTime', '다음 일정')}<input class="prop-input next-label" data-prop="nextLabel" value="${value('nextLabel')}" placeholder="일정 이름 (예: 1차 면접)" aria-label="다음 일정 이름" autocomplete="off"></div><div id="past-step">${pastStepHtml(item)}</div>`)}
        ${propRow('link', '공고 링크', `<div class="prop-inline"><input type="url" class="prop-input" data-prop="url" value="${value('url')}" placeholder="비어 있음" aria-label="공고 링크" autocomplete="off">${link ? `<a class="icon-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" aria-label="공고 원문 열기">${icon('external')}</a>` : ''}</div>`)}
        ${propRow('text', '원문 제목', `<input class="prop-input" data-prop="originalTitle" value="${value('originalTitle')}" placeholder="비어 있음" aria-label="원문 제목" autocomplete="off">`)}
      </div>
      <section class="doc-section note-section"><div class="section-head"><h2>공고 메모</h2></div><textarea class="note-input" id="posting-note" rows="2" placeholder="자격 요건, 우대 사항, 지원 전략 등을 적어 두세요." aria-label="공고 메모">${escapeHtml(item.note || '')}</textarea></section>
      <section class="doc-section doc-tabs-section">
        <div class="view-tabs doc-tabs" role="tablist" aria-label="공고 문서">${docTabsHtml(item)}</div>
        <div class="tab-panel" data-panel="essay" role="tabpanel"><div class="question-list" id="questions" data-list="questions"></div><button type="button" class="ghost-button add-question" data-action="add-question" data-list="questions">${icon('plus')}문항 추가</button></div>
        <div class="tab-panel" data-panel="interview" role="tabpanel"><p class="panel-hint">예상 질문과 답을 적어 두세요. 답변 옆에 말하는 데 걸리는 시간을 함께 보여 줘요.</p><div class="question-list" id="interview-questions" data-list="interviewQuestions"></div><div class="prep-foot" data-list="interviewQuestions"><button type="button" class="ghost-button add-question" data-action="add-question" data-list="interviewQuestions">${icon('plus')}질문 추가</button><div class="quick-questions" id="quick-questions"></div></div></div>
        <div class="tab-panel" data-panel="review" role="tabpanel">${reviewsHtml()}</div>
      </section>
    </article>${peek ? '</div>' : ''}`;
  wireProperties(item, container);
  const note = $('#posting-note');
  autoGrow(note);
  note.addEventListener('input', () => { item.note = note.value; item.updatedAt = new Date().toISOString(); autoGrow(note); scheduleSave(); });
  for (const list of ['questions', 'interviewQuestions']) { renderQuestions(item, list); wireQuestions(item, list); }
  renderReviews(item); wireReviews(item);
  showDetailTab(container, detailTab(item));
  if (peek) container.querySelector('.peek-scroll').scrollTop = scroll;
}

// 노션 페이지 속성처럼 상세 화면의 값은 그 자리에서 바로 고치고 저장한다.
export function wireProperties(item, container = main) {
  const body = container.querySelector('.detail-body');
  const textLike = control => control.classList.contains('title-input') || (control.tagName === 'INPUT' && ['text', 'url', ''].includes(control.getAttribute('type') || ''));
  // 제목은 한 줄 이름이므로 Enter로 줄을 바꾸지 않고 입력을 마친다.
  const title = body.querySelector('.title-input');
  autoGrow(title);
  title.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); title.blur(); } });
  title.addEventListener('input', () => { if (title.value.includes('\n')) title.value = title.value.replace(/\n/g, ' '); autoGrow(title); });
  body.querySelectorAll('[data-prop]').forEach(control => control.classList.toggle('empty', !control.value));
  body.addEventListener('input', event => {
    const control = event.target.closest('[data-prop]'); if (!control) return;
    control.classList.toggle('empty', !control.value);
    if (!textLike(control) || control.type === 'url') return;
    item[control.dataset.prop] = control.value;
    item.updatedAt = new Date().toISOString();
    if (control.classList.contains('title-input') && $('#crumb-current')) $('#crumb-current').textContent = control.value.trim() || '이름 없음';
    scheduleSave(); peekEdited();
  });
  body.addEventListener('change', event => {
    const control = event.target.closest('[data-prop]'); if (!control) return;
    const prop = control.dataset.prop;
    if (control.type === 'url') {
      const url = validUrl(control.value.trim());
      if (control.value.trim() && !url) { showToast('https://로 시작하는 올바른 링크를 입력해 주세요.'); return; }
      item.url = url;
      const inline = control.closest('.prop-inline');
      inline.querySelector('.icon-link')?.remove();
      if (url) inline.insertAdjacentHTML('beforeend', `<a class="icon-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="공고 원문 열기">${icon('external')}</a>`);
    } else item[prop] = textLike(control) ? control.value.trim() : control.value;
    if (prop === 'status') control.className = `${statusTag(control.value)} tag-select`;
    if ((prop === 'deadline' || prop === 'deadlineTime') && $('#deadline-hint')) $('#deadline-hint').innerHTML = deadlineHint(item);
    if ((prop === 'status' || prop === 'nextDate') && container.querySelector('#past-step')) container.querySelector('#past-step').innerHTML = pastStepHtml(item);
    const dateField = control.closest('.date-field'); if (dateField) refreshDateField(item, dateField);
    item.updatedAt = new Date().toISOString();
    saveNow(); peekEdited({ now: true });
  });
}

// 탭: 자소서 · 면접 준비 · 면접 후기. 개수를 함께 보여 준다.
function docTabsHtml(item) {
  const tab = (key, label, count) => `<button type="button" role="tab" class="view-tab" data-action="detail-tab" data-tab="${key}" aria-selected="false">${label}${count ? `<span class="tab-count">${count}</span>` : ''}</button>`;
  return tab('essay', '자소서', item.questions.length) + tab('interview', '면접 준비', item.interviewQuestions.length) + tab('review', '면접 후기', item.interviewReviews.length);
}

export function refreshDocTabs(item) {
  const tabs = $('.doc-tabs'); if (!tabs) return;
  const current = tabs.querySelector('[aria-selected=true]')?.dataset.tab;
  tabs.innerHTML = docTabsHtml(item);
  tabs.querySelectorAll('.view-tab').forEach(button => { const active = button.dataset.tab === current; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
}

// 숨겨 둔 탭의 글 입력칸은 높이를 잴 수 없으므로 보일 때 다시 맞춘다.
export function showDetailTab(container, key) {
  container.querySelectorAll('.doc-tabs .view-tab').forEach(button => { const active = button.dataset.tab === key; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
  container.querySelectorAll('.tab-panel').forEach(panel => { panel.hidden = panel.dataset.panel !== key; });
  container.querySelectorAll(`.tab-panel[data-panel="${key}"] textarea`).forEach(autoGrow);
}

function countHtml(question, list) {
  const { withSpaces, withoutSpaces } = charCount(question.answer);
  if (list === 'interviewQuestions') {
    const time = speakingTime(question.answer);
    return `<span title="1분에 약 330자 말하는 속도 기준">말하기 <strong>${time || '—'}</strong></span><span>공백 포함 ${withSpaces.toLocaleString()}자</span>`;
  }
  const limit = Number(question.limit) || 0;
  return `<span class="${limit && withSpaces > limit ? 'over' : ''}">공백 포함 <strong>${withSpaces.toLocaleString()}</strong>${limit ? ` / ${limit.toLocaleString()}자` : '자'}</span><span>공백 제외 ${withoutSpaces.toLocaleString()}자</span>`;
}

function questionHtml(question, index, list) {
  const qid = escapeHtml(question.id);
  const interview = list === 'interviewQuestions';
  const name = interview ? `${index + 1}번 면접 질문` : `${index + 1}번 문항`;
  const linked = question.experienceIds.map(id => data.experiences.find(experience => experience.id === id)).filter(Boolean);
  const available = data.experiences.filter(experience => !question.experienceIds.includes(experience.id));
  return `<section class="question${interview ? ' interview-question' : ''}" data-qid="${qid}">
    <div class="question-head"><span class="question-index">${interview ? 'Q' : index + 1}</span>
      <textarea class="question-title" rows="1" placeholder="${interview ? '예상 질문 (예: 우리 회사에 지원한 이유는?)' : '문항을 적어 주세요 (예: 지원 동기와 입사 후 포부)'}" aria-label="${name}">${escapeHtml(question.title)}</textarea>
      ${interview ? '' : `<label class="question-limit">제한 <input type="number" min="0" step="50" inputmode="numeric" value="${escapeHtml(question.limit ?? '')}" placeholder="—" aria-label="${name} 글자 수 제한">자</label>`}
      <button type="button" class="icon-button question-delete" data-action="delete-question" data-qid="${qid}" aria-label="${name} 삭제">×</button></div>
    <textarea class="question-answer" rows="${interview ? 3 : 5}" placeholder="${interview ? '답변을 말하듯이 적어 보세요' : '답변을 작성하세요'}" aria-label="${name} 답변">${escapeHtml(question.answer)}</textarea>
    <div class="question-foot">
      <div class="linked-experiences">${linked.map(experience => `<span class="experience-chip"><button type="button" data-action="open-experience" data-id="${escapeHtml(experience.id)}">${escapeHtml(experience.name)}</button><button type="button" class="chip-remove" data-action="unlink-experience" data-qid="${qid}" data-id="${escapeHtml(experience.id)}" aria-label="${escapeHtml(experience.name)} 연결 해제">×</button></span>`).join('')}${available.length ? `<select class="experience-picker" data-qid="${qid}" aria-label="${name}에 경험 연결"><option value="">+ 경험 연결</option>${available.map(experience => `<option value="${escapeHtml(experience.id)}">${escapeHtml(experience.name)}</option>`).join('')}</select>` : ''}</div>
      <div class="char-count">${countHtml(question, list)}</div>
    </div>
  </section>`;
}

const listContainer = list => $(`.question-list[data-list="${list}"]`);

export function renderQuestions(item, list = 'questions') {
  const container = listContainer(list); if (!container) return;
  const questions = item[list] ||= [];
  const empty = list === 'questions' ? '아직 문항이 없어요. 공고의 자소서 문항을 추가해 보세요.' : '아직 준비한 질문이 없어요. 아래 자주 나오는 질문부터 골라 보세요.';
  container.innerHTML = questions.length ? questions.map((question, index) => questionHtml(question, index, list)).join('') : `<p class="questions-empty">${empty}</p>`;
  container.querySelectorAll('textarea').forEach(autoGrow);
  if (list === 'interviewQuestions') {
    const have = new Set(questions.map(question => question.title.trim()));
    const left = commonInterviewQuestions.filter(title => !have.has(title));
    $('#quick-questions').innerHTML = left.length ? `<span class="quick-label">자주 나오는 질문</span>${left.map(title => `<button type="button" class="quick-question" data-action="add-question" data-list="interviewQuestions" data-title="${escapeHtml(title)}">${icon('plus')}${escapeHtml(title)}</button>`).join('')}` : '';
  }
  refreshDocTabs(item);
}

function wireQuestions(item, list) {
  const container = listContainer(list);
  const questionOf = element => item[list].find(question => question.id === element.closest('.question')?.dataset.qid);
  container.addEventListener('input', event => {
    const question = questionOf(event.target); if (!question) return;
    if (event.target.classList.contains('question-title')) question.title = event.target.value;
    else if (event.target.classList.contains('question-answer')) question.answer = event.target.value;
    else if (event.target.type === 'number') question.limit = event.target.value ? Math.max(0, Math.round(Number(event.target.value))) : null;
    else return;
    if (event.target.tagName === 'TEXTAREA') autoGrow(event.target);
    event.target.closest('.question').querySelector('.char-count').innerHTML = countHtml(question, list);
    item.updatedAt = new Date().toISOString();
    scheduleSave(); peekEdited();
  });
  container.addEventListener('change', event => {
    if (!event.target.classList.contains('experience-picker') || !event.target.value) return;
    const question = questionOf(event.target);
    question.experienceIds.push(event.target.value);
    item.updatedAt = new Date().toISOString(); persist(); renderQuestions(item, list); peekEdited({ now: true });
  });
}
