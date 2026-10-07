// 자소서: 왼쪽에 지원 현황의 기업 목록(상태 색·기업명·마감), 오른쪽에 고른 기업의 자소서.
// 자소서는 여기서만 쓴다. 지원 현황의 자소서 칸·공고 상세의 '자소서 ›'를 누르면 이 탭의 그 기업으로 온다.
import { main } from './dom.js';
import { filesHtml } from './files.js';
import { essayGroups, statusColor, statusTag } from './model.js';
import { renderQuestions, wireQuestions } from './posting-detail.js';
import { navTo, routeHash } from './router.js';
import { data, selectedId, setRoute, view } from './state.js';
import { escapeHtml as esc, formatDate, icon, todayKey } from './util.js';

let lastPicked = ''; // 다른 탭에 다녀와도 보던 기업으로 돌아온다.

function dDay(deadline) {
  if (!deadline) return '';
  const days = Math.round((new Date(`${deadline}T00:00`) - new Date(`${todayKey()}T00:00`)) / 86_400_000);
  return days === 0 ? '오늘' : days > 0 ? `D-${days}` : '';
}

// 마감 칸: 쓸 곳은 D-day(사흘 안이면 강조), 나머지는 날짜
function deadlineCell(item, group) {
  if (!item.deadline) return '<span class="placeholder">—</span>';
  const left = group === 'writing' ? dDay(item.deadline) : '';
  if (left) return `<span class="essay-dday${/^(오늘|D-[1-3]$)/.test(left) ? ' soon' : ''}" title="${esc(formatDate(item.deadline))} 마감">${left}</span>`;
  const [, month, day] = item.deadline.split('-').map(Number);
  return `<span title="${esc(formatDate(item.deadline))}">${month}.${day}</span>`;
}

// 한 줄: 진행 상태 색 점(달력처럼 색으로만, 이름은 마우스를 올리면) · 기업명 · 마감
function rowHtml(item, group, current) {
  const active = item === current;
  return `<button type="button" class="essay-item${active ? ' active' : ''}" data-id="${esc(item.id)}"${active ? ' aria-current="true"' : ''} title="${esc([item.organization, item.role, item.status].filter(Boolean).join(' · '))}">
    <span class="essay-dot" style="--c: var(--c-${statusColor(item.status)})" aria-label="${esc(item.status)}"></span>
    <span class="essay-org">${item.organization ? esc(item.organization) : '<span class="placeholder">이름 없음</span>'}</span>
    <span class="essay-deadline">${deadlineCell(item, group)}</span>
  </button>`;
}

function listHtml(current) {
  return essayGroups(data.postings).map(group => `<div class="essay-group"><div class="essay-group-title">${group.title}<span>${group.items.length}</span></div>
    ${group.items.map(item => rowHtml(item, group.key, current)).join('')}</div>`).join('');
}

function editorHtml(item) {
  const deadline = item.deadline ? `마감 ${formatDate(item.deadline)}${item.deadlineTime ? ` ${item.deadlineTime}` : ''}` : '';
  return `<div class="essay-head">
      <h2 class="essay-title">${esc(item.organization || '이름 없음')}</h2>
      <button type="button" class="text-button" data-action="open-posting" data-id="${esc(item.id)}">${icon('open')}공고 보기</button>
    </div>
    <div class="essay-doc-meta">${[item.role, deadline].filter(Boolean).map(text => `<span>${esc(text)}</span>`).join('')}<span class="${statusTag(item.status)}">${esc(item.status)}</span></div>
    <div class="essay-files" id="essay-files">${filesHtml(item)}</div>
    <div class="question-list" id="questions" data-list="questions"></div>
    <button type="button" class="ghost-button add-question" data-action="add-question" data-list="questions">${icon('plus')}문항 추가</button>`;
}

// 고른 기업이 없으면(처음 열 때) 보던 기업이나 쓸 곳의 첫 기업을 고르고, 주소도 그 기업으로 바꿔 둔다.
function currentPosting() {
  const picked = data.postings.find(item => item.id === selectedId);
  if (picked) { lastPicked = picked.id; return picked; }
  const first = data.postings.find(item => item.id === lastPicked) || essayGroups(data.postings)[0]?.items[0];
  if (first) { setRoute('essays', first.id); lastPicked = first.id; history.replaceState({ ...history.state }, '', routeHash('essays', first.id)); }
  return first || null;
}

export function renderEssays() {
  main.className = 'database-page essays-page';
  const header = '<header class="page-header"><h1 class="page-title">자소서</h1><p class="page-description">지원 현황의 기업별로 자소서를 쓰고 모아 둬요.</p></header>';
  const current = currentPosting();
  if (!current) {
    main.innerHTML = `${header}<div class="empty-state"><h2>아직 공고가 없어요</h2><p>지원 현황에 공고를 추가하면 여기서 기업별로 자소서를 쓸 수 있어요.</p><div class="empty-actions"><button type="button" class="primary-button" data-action="new-posting">${icon('plus')}새 공고</button></div></div>`;
    return;
  }
  const listScroll = main.querySelector('.essay-side')?.scrollTop || 0;
  main.innerHTML = `${header}
    <div class="essay-layout">
      <nav class="essay-side" aria-label="기업 목록">${listHtml(current)}</nav>
      <section class="essay-editor" aria-label="${esc(current.organization)} 자소서">${editorHtml(current)}</section>
    </div>`;
  main.querySelector('.essay-side').scrollTop = listScroll;
  current.questions ||= [];
  renderQuestions(current, 'questions');
  wireQuestions(current, 'questions');
}

// 기업을 누르면 오른쪽만 그 기업으로 바꾼다. 기업마다 기록을 쌓지 않는다.
main.addEventListener('click', event => {
  if (view !== 'essays') return;
  const row = event.target.closest('.essay-item');
  if (row && row.dataset.id !== selectedId) navTo('essays', row.dataset.id, { history: 'replace' });
});
