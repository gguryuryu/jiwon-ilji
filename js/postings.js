// 지원 현황: 표·보드·요약
import { pendingCalendarPostings } from './calendar.js';
import { $, main } from './dom.js';
import { employmentOptions, essayToQuestions, groupFor, interestStatuses, nextRelevant, passedDocumentStatuses, statusOptions, statusTag } from './model.js';
import { goalStripHtml } from './goals.js';
import { data, selectedId, view } from './state.js';
import { persist } from './store.js';
import { reducedMotion } from './ui.js';
import { escapeHtml, formatDate, icon, optionsHtml, th, todayKey, uid, validUrl } from './util.js';

// 일정 칸: 날짜 + 종류 배지. 상태와 같은 말(예: '2차 면접 예정' + '2차 면접')은 되풀이하지 않고 '일정'으로 줄인다.
// 지난 날짜는 흐리게 하고, 배지에 '마감됨'·'… 지남'을 붙여 앞으로의 일정과 헷갈리지 않게 한다.
function scheduleHtml(item, schedule) {
  if (!schedule) return '';
  const deadline = schedule.label === '접수 마감';
  const past = schedule.date < todayKey();
  const kind = deadline ? (past ? '마감됨' : '마감') : `${item.status.includes(schedule.label) ? '일정' : schedule.label}${past ? ' 지남' : ''}`;
  return `<span class="schedule${past ? ' past' : ''}"><span class="date-main">${escapeHtml(formatDate(schedule.date))}${schedule.time ? ` ${escapeHtml(schedule.time)}` : ''}</span><span class="date-kind${deadline ? '' : ' next'}">${escapeHtml(kind)}</span></span>`;
}

export let search = '';

let postingLayout = 'table';

try { postingLayout = localStorage.getItem('postingLayout') === 'board' ? 'board' : 'table'; } catch { /* 기본은 표 */ }

export const collapsed = new Set();

// 관심·작성 중에서 마감이 지난 공고는 아래로 내린다. 지원할 수 있는 공고가 먼저 보이게.
function sortedGroup(group, items) {
  const today = todayKey();
  const closed = item => group === 'interest' && Boolean(item.deadline) && item.deadline < today;
  return items.filter(item => groupFor(item) === group).sort((a, b) => {
    const aDate = `${nextRelevant(a)?.date || '9999-12-31'} ${nextRelevant(a)?.time || '23:59'}`;
    const bDate = `${nextRelevant(b)?.date || '9999-12-31'} ${nextRelevant(b)?.time || '23:59'}`;
    if (group === 'done') return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    return Number(closed(a)) - Number(closed(b)) || aDate.localeCompare(bDate) || a.organization.localeCompare(b.organization, 'ko');
  });
}

function postingRow(item) {
  const schedule = nextRelevant(item);
  const link = validUrl(item.url);
  const id = escapeHtml(item.id);
  const name = escapeHtml(item.organization);
  const questions = item.questions || [];
  const answered = questions.filter(question => question.answer?.trim()).length;
  const employment = item.employmentType && !employmentOptions.includes(item.employmentType) ? [...employmentOptions, item.employmentType] : employmentOptions;
  const done = groupFor(item) === 'done';
  // 끝난 공고에는 '+ 작성'을 두지 않는다. 쓴 문항이 있으면 진행 정도만 보여 준다.
  const essay = questions.length ? `<button type="button" class="essay-progress" data-action="open-essay" data-id="${id}" aria-label="${name} 자소서 ${answered}/${questions.length} 문항"><span class="progress-track"><span class="progress-fill" style="width:${Math.round(answered / questions.length * 100)}%"></span></span><span>${answered}/${questions.length}</span></button>` : done ? '' : `<button type="button" class="essay-add" data-action="open-essay" data-id="${id}" aria-label="${name} 자소서 작성">${icon('plus')}작성</button>`;
  return `<tr class="data-row${done && item.status !== '최종 합격' ? ' is-done' : ''}${item.id === selectedId ? ' peeked' : ''}" data-id="${id}">
    <td><button type="button" class="row-title" data-action="open-posting" data-id="${id}"><span class="row-title-text">${name || '<span class="placeholder">이름 없음</span>'}</span><span class="open-hint">${icon('open')}열기</span></button></td>
    <td class="edit-cell role-cell" title="${escapeHtml(item.originalTitle || item.role)}"><button type="button" class="cell-edit" data-action="edit-role" data-id="${id}" aria-label="${name} 직무 수정">${item.role ? escapeHtml(item.role) : '<span class="placeholder">비어 있음</span>'}</button></td>
    <td><select class="${statusTag(item.status)} tag-select" data-field="status" data-id="${id}" aria-label="${name} 진행 상태">${optionsHtml(statusOptions, item.status)}</select></td>
    <td class="c-emp"><select class="plain-select${item.employmentType ? '' : ' empty'}" data-field="employmentType" data-id="${id}" aria-label="${name} 고용형태"><option value="">—</option>${optionsHtml(employment, item.employmentType)}</select></td>
    <td class="date-cell">${scheduleHtml(item, schedule) || '<span class="placeholder">—</span>'}</td>
    <td class="c-link">${link ? `<a class="icon-link row-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" title="공고 원문 열기" aria-label="${name} 공고 원문 열기">${icon('external')}</a>` : ''}</td>
    <td class="c-essay">${essay}</td>
  </tr>`;
}

// 요약: 진행 단계별 공고 수. 단계를 누르면 그 단계의 공고만 표에 남긴다.
const stageLabels = { interest: '관심', writing: '작성 중', applied: '지원 · 서류', written: '필기', interview: '면접', passed: '합격', closed: '종료' };

let stageFilter = '';

function stageCounts() {
  return Object.fromEntries(boardColumns.map(column => [column.key, data.postings.filter(item => column.statuses.includes(item.status)).length]));
}

function documentRate() {
  const applied = data.postings.filter(item => !interestStatuses.has(item.status) && item.status !== '지원 포기').length;
  const passed = data.postings.filter(item => passedDocumentStatuses.has(item.status)).length;
  return applied ? { applied, passed, rate: Math.round(passed / applied * 100) } : null;
}

function postingSummary() {
  const counts = stageCounts();
  const legend = boardColumns.map(column => `<button type="button" class="pipeline-item" data-action="filter-stage" data-stage="${column.key}" style="--c: var(--c-${column.color})" aria-pressed="false"><span class="pipeline-dot" aria-hidden="true"></span>${stageLabels[column.key]}<strong>${counts[column.key]}</strong></button>`).join('');
  return `<div class="pipeline-legend">${legend}<span class="pipeline-rate"></span></div>`;
}

// 요약은 다시 그리지 않고 값만 바꾼다.
function refreshSummary() {
  const summary = $('#posting-summary'); if (!summary) return;
  const counts = stageCounts(); const board = postingLayout === 'board';
  summary.querySelectorAll('.pipeline-item').forEach(item => {
    const key = item.dataset.stage; const active = key === stageFilter && !board;
    item.querySelector('strong').textContent = counts[key];
    item.classList.toggle('zero', !counts[key]); item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active));
    item.title = board ? `${stageLabels[key]} 칸으로 이동` : active ? '필터 해제' : `${stageLabels[key]}만 보기`;
  });
  const rate = documentRate(); const label = summary.querySelector('.pipeline-rate');
  label.innerHTML = rate ? `서류 통과율 <strong>${rate.rate}%</strong>` : '';
  label.title = rate ? `지원 ${rate.applied}곳 중 ${rate.passed}곳 서류 통과` : '';
}

// 표에서는 그 단계만 걸러 보고, 보드에서는 그 칸으로 옮겨 가 잠깐 표시한다.
export function filterStage(key) {
  if (postingLayout === 'board') {
    const column = main.querySelector(`.board-column[data-column="${key}"]`); if (!column) return;
    column.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    column.classList.remove('flash'); void column.offsetWidth; column.classList.add('flash');
    return;
  }
  stageFilter = stageFilter === key ? '' : key;
  refreshPostingTable();
}

export function refreshPostingTable() {
  if (view !== 'postings') return;
  if ($('#posting-results')) $('#posting-results').innerHTML = postingResults();
  if ($('#posting-board')) $('#posting-board').innerHTML = boardHtml();
  refreshSummary();
}

export function editRoleCell(button, item) {
  const input = document.createElement('input');
  input.className = 'cell-input'; input.value = item.role || ''; input.setAttribute('aria-label', `${item.organization} 직무`);
  button.closest('td').replaceChildren(input);
  input.focus(); input.select();
  let finished = false;
  const finish = save => {
    if (finished) return; finished = true;
    const value = input.value.trim();
    if (save && value !== (item.role || '')) { item.role = value; item.updatedAt = new Date().toISOString(); persist(); }
    refreshPostingTable();
  };
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    if (event.key === 'Escape') { event.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

export function setPostingLayout(layout) {
  postingLayout = layout;
  try { localStorage.setItem('postingLayout', postingLayout); } catch { /* 이번 화면에서만 적용된다. */ }
  renderPostings();
  // 표와 보드가 툭 바뀌지 않게 짧게 겹쳐 나타낸다.
  if (!reducedMotion()) main.querySelector('#posting-board, .table-scroll')?.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2, .8, .2, 1)' });
}

const searchedPostings = () => {
  const query = search.toLocaleLowerCase();
  const stage = postingLayout === 'table' && boardColumns.find(column => column.key === stageFilter);
  return data.postings.filter(item => (!stage || stage.statuses.includes(item.status)) && [item.organization, item.role, item.originalTitle, item.status].some(value => String(value || '').toLocaleLowerCase().includes(query)));
};

// 보드 보기: 진행 단계별 칸. 카드를 다른 칸으로 끌면 그 단계의 첫 상태로 바뀐다.
export const boardColumns = [
  { key: 'interest', title: '관심', color: 'gray', statuses: ['관심'], drop: '관심' },
  { key: 'writing', title: '자소서 작성 중', color: 'yellow', statuses: ['자소서 작성 중'], drop: '자소서 작성 중' },
  { key: 'applied', title: '지원 · 서류', color: 'blue', statuses: ['지원 완료', '서류 심사 중'], drop: '지원 완료' },
  { key: 'written', title: '필기', color: 'teal', statuses: ['필기 전형 예정'], drop: '필기 전형 예정' },
  { key: 'interview', title: '면접', color: 'purple', statuses: ['1차 면접 예정', '2차 면접 예정', '최종 결과 대기'], drop: '1차 면접 예정' },
  { key: 'passed', title: '최종 합격', color: 'green', statuses: ['최종 합격'], drop: '최종 합격' },
  { key: 'closed', title: '종료', color: 'red', statuses: ['서류 불합격', '필기 불합격', '1차 면접 불합격', '2차 면접 불합격', '최종 불합격', '지원 포기'], drop: null },
];

// '종료' 칸에 놓으면 어느 단계에서 떨어졌는지에 맞춰 불합격 상태를 고른다.
export const closingStatus = status => ({ '지원 완료': '서류 불합격', '서류 심사 중': '서류 불합격', '필기 전형 예정': '필기 불합격', '1차 면접 예정': '1차 면접 불합격', '2차 면접 예정': '2차 면접 불합격', '최종 결과 대기': '최종 불합격' })[status] || '지원 포기';

// 칸 이름과 같은 상태는 카드에 다시 적지 않는다. 한 칸에 여러 상태가 모이는 칸(지원·서류, 면접, 종료)만 보여 준다.
function boardCard(item, showStatus = true) {
  const schedule = nextRelevant(item);
  const questions = item.questions || [];
  const answered = questions.filter(question => question.answer?.trim()).length;
  const id = escapeHtml(item.id);
  return `<article class="board-card${item.id === selectedId ? ' peeked' : ''}" draggable="true" tabindex="0" data-action="open-posting" data-id="${id}" aria-label="${escapeHtml(item.organization)} 열기">
    <div class="card-title">${escapeHtml(item.organization) || '<span class="placeholder">이름 없음</span>'}</div>
    ${item.role ? `<div class="card-role">${escapeHtml(item.role)}</div>` : ''}
    ${schedule ? `<div class="card-meta">${scheduleHtml(item, schedule)}</div>` : ''}
    ${showStatus || questions.length ? `<div class="card-foot">${showStatus ? `<select class="${statusTag(item.status)} tag-select" data-field="status" data-id="${id}" aria-label="${escapeHtml(item.organization)} 진행 상태">${optionsHtml(statusOptions, item.status)}</select>` : '<span></span>'}${questions.length ? `<span class="card-essay">${icon('doc')}${answered}/${questions.length}</span>` : ''}</div>` : ''}
  </article>`;
}

function boardHtml() {
  const items = searchedPostings();
  return boardColumns.map(column => {
    const members = sortedGroup(groupFor({ status: column.statuses[0] }), items.filter(item => column.statuses.includes(item.status)));
    return `<section class="board-column" data-column="${column.key}" style="--c: var(--c-${column.color})" aria-label="${column.title}"><header class="board-head"><span class="tag tag-${column.color}">${column.title}</span><span class="group-count">${members.length}</span></header><div class="board-cards">${members.map(item => boardCard(item, column.statuses.length > 1)).join('') || '<div class="board-empty">여기로 끌어다 놓기</div>'}</div></section>`;
  }).join('');
}

function postingResults() {
  const items = searchedPostings();
  let body = '';
  for (const [group, title, color] of [['active', '진행 중', 'blue'], ['interest', '관심 · 작성 중', 'yellow'], ['done', '종료', 'gray']]) {
    const members = sortedGroup(group, items);
    if (!members.length) continue;
    if (body) body += '<tr class="group-gap" aria-hidden="true"><td colspan="7"></td></tr>';
    body += `<tr class="group-row"><td colspan="7"><button type="button" class="group-toggle" data-group="${group}" aria-expanded="${!collapsed.has(group)}"><span class="caret" aria-hidden="true"></span><span class="tag tag-${color}">${title}</span><span class="group-count">${members.length}</span></button></td></tr>`;
    if (!collapsed.has(group)) body += members.map(postingRow).join('');
  }
  if (!body) body = `<tr><td colspan="7" class="empty-group">${search ? `‘${escapeHtml(search)}’에 맞는 ` : `${stageLabels[stageFilter] || ''} 단계인 `}공고가 없습니다.</td></tr>`;
  return `${body}<tr class="add-row"><td colspan="7"><button type="button" data-action="new-posting">${icon('plus')}새 공고</button></td></tr>`;
}

export function renderPostings() {
  main.className = 'database-page';
  const tab = (layout, iconName, label) => `<button type="button" role="tab" class="view-tab${postingLayout === layout ? ' active' : ''}" aria-selected="${postingLayout === layout}" data-action="posting-layout" data-layout="${layout}">${icon(iconName)}${label}</button>`;
  main.innerHTML = `<header class="page-header"><h1 class="page-title">지원 현황</h1>${data.postings.length ? `<div class="pipeline" id="posting-summary" aria-label="진행 단계별 공고 수">${postingSummary()}</div>` : '<p class="page-description">지원한 공고와 진행 상황을 한곳에서 봅니다.</p>'}</header>
    ${goalStripHtml()}
    <div class="view-bar"><div class="view-tabs" role="tablist" aria-label="보기 방식">${tab('table', 'table', '표')}${tab('board', 'board', '보드')}</div><div class="view-actions"><label class="search-box">${icon('search')}<input id="posting-search" type="search" value="${escapeHtml(search)}" placeholder="검색" aria-label="공고 검색 (단축키 /)"><kbd>/</kbd></label><button type="button" class="primary-button" data-action="new-posting">${icon('plus')}새 공고</button></div></div>
    ${!data.postings.length ? `${pendingCalendarPostings().length ? `<div class="empty-state"><h2>달력에 공고 ${pendingCalendarPostings().length}개가 있어요</h2><p>월간 달력에서 지원하고 싶은 공고 일정을 누르고 ‘지원 현황에 추가’를 누르면 관심 목록에 들어갑니다.</p><div class="empty-actions"><button type="button" class="primary-button" data-action="go-calendar">${icon('calendar')}월간 달력 열기</button><button type="button" class="secondary-button" data-action="new-posting">링크로 추가</button></div></div>` : `<div class="empty-state"><h2>첫 공고를 등록해 보세요</h2><p>공고 링크를 붙여 넣거나, 월간 달력에서 잡알리오·구글 캘린더 공고를 눌러 바로 추가할 수 있어요.</p><div class="empty-actions"><button type="button" class="primary-button" data-action="new-posting">${icon('plus')}공고 추가</button><button type="button" class="secondary-button" data-action="load-demo">예시 살펴보기</button></div></div>`}` : postingLayout === 'board' ? `<div class="board" id="posting-board">${boardHtml()}</div>` : `<div class="table-scroll"><table class="data-table posting-table" aria-label="지원 현황"><thead><tr>${th('text', '회사·기관', '', '25%')}${th('user', '직무', '', '16%')}${th('status', '진행 상태', '', '15%')}${th('list', '고용형태', 'c-emp', '9%')}${th('clock', '일정', '', '20%')}${th('link', '공고', 'c-link', '6%')}${th('doc', '자소서', 'c-essay', '9%')}</tr></thead><tbody id="posting-results">${postingResults()}</tbody></table></div>`}
    <aside class="peek" id="peek" aria-label="공고 미리 보기" hidden></aside>`;
  // 검색창을 다시 그리지 않아야 한글 조합 입력이 끊기지 않는다.
  $('#posting-search')?.addEventListener('input', event => { search = event.target.value; refreshPostingTable(); });
  refreshSummary();
}

export function demoPostings() {
  const year = new Date().getFullYear(); const month = new Date().getMonth();
  const date = offset => { const day = new Date(year, month, new Date().getDate() + offset); return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`; };
  return [
    { organization: '한국해양교통안전공단', role: '사무행정', employmentType: '정규직', status: '1차 면접 예정', deadline: date(-8), nextDate: date(7), nextLabel: '1차 면접', essay: '# 지원 동기와 입사 후 포부를 작성해 주세요.\n\n공공서비스를 이용하는 사람이 필요한 정보를 쉽게 찾도록 돕고 싶습니다.\n# 직무와 관련된 경험을 작성해 주세요.', url: '' },
    { organization: '한국남부발전', role: '일반행정', employmentType: '인턴', status: '서류 심사 중', deadline: date(-2), nextDate: date(12), nextLabel: '서류 결과', essay: '', url: '' },
    { organization: '한국토지주택공사', role: '일반행정', employmentType: '정규직', status: '자소서 작성 중', deadline: date(5), nextDate: '', nextLabel: '', essay: '', url: '' },
    { organization: '한국철도공사', role: '경영지원', employmentType: '인턴', status: '관심', deadline: date(15), nextDate: '', nextLabel: '', essay: '', url: '' },
    { organization: '한국공항공사', role: '사무행정', employmentType: '정규직', status: '1차 면접 불합격', deadline: date(-30), nextDate: '', nextLabel: '', essay: '', url: '' },
  ].map(({ essay, ...item }) => ({ ...item, questions: essayToQuestions(essay), id: uid(), originalTitle: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
}
