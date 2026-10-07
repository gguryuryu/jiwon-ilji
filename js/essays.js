// 자소서: 왼쪽에 지원 현황의 기업 목록(상태 색·기업명·마감), 오른쪽에 고른 기업의 자소서.
// 자소서는 여기서만 쓴다. 지원 현황의 자소서 칸·공고 상세의 '자소서 ›'를 누르면 이 탭의 그 기업으로 온다.
import { main } from './dom.js';
import { filesHtml } from './files.js';
import { essayGroups, experiencePlainText, statusColor, statusTag } from './model.js';
import { markdownToHtml } from './experiences.js';
import { renderQuestions, wireQuestions } from './posting-detail.js';
import { navTo, routeHash } from './router.js';
import { persist } from './store.js';
import { reducedMotion, showToast } from './ui.js';
import { data, selectedId, setRoute, view } from './state.js';
import { copyText, escapeHtml as esc, formatDate, icon, todayKey } from './util.js';

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

// ---------- 문항에 연결한 경험을 옆에서 보기 ----------
// 자소서를 쓰다가 경험 칩을 누르면 경험 정리로 넘어가지 않고, 그 문항 아래에 내용을 펼친다. 답변에 바로 넣을 수도 있다.
function experiencePeekHtml(experience) {
  const id = esc(experience.id);
  const meta = [experience.type, experience.period, experience.role].filter(Boolean).map(esc).join(' · ');
  const detail = experience.detail?.trim();
  const empty = !detail && !experience.description && !experience.result;
  return `<div class="exp-peek" data-exp="${id}">
    <div class="exp-peek-head"><strong>${esc(experience.name || '제목 없음')}</strong>${meta ? `<span>${meta}</span>` : ''}
      <span class="exp-peek-actions"><button type="button" class="text-button" data-exp-insert="${id}"${experiencePlainText(experience) ? '' : ' disabled'} title="답변의 커서 자리에 경험 내용을 넣어요">답변에 넣기</button><button type="button" class="text-button" data-exp-open="${id}">경험 정리에서 열기</button><button type="button" class="icon-button" data-exp-close aria-label="닫기">×</button></span></div>
    ${experience.description ? `<p class="exp-peek-desc">${esc(experience.description)}</p>` : ''}
    ${experience.result ? `<p class="exp-peek-result"><b>핵심 결과</b>${esc(experience.result)}</p>` : ''}
    ${detail ? `<div class="exp-peek-body">${markdownToHtml(detail)}</div>` : ''}
    ${empty ? '<p class="exp-peek-empty">아직 적은 내용이 없어요. 경험 정리에서 이어서 적어 보세요.</p>' : ''}
  </div>`;
}

// 답변 칸의 마지막 커서 자리에 넣는다. 편집 기록에 남겨 ⌘Z로 되돌릴 수 있게 한다.
function insertIntoAnswer(answer, text) {
  const start = answer.selectionStart ?? answer.value.length; const end = answer.selectionEnd ?? start;
  const before = answer.value.slice(0, start);
  const piece = (before && !before.endsWith('\n') ? '\n' : '') + text;
  answer.focus(); answer.setSelectionRange(start, end);
  if (!document.execCommand('insertText', false, piece)) { answer.setRangeText(piece, start, end, 'end'); answer.dispatchEvent(new Event('input', { bubbles: true })); }
}

main.addEventListener('click', event => {
  if (view !== 'essays') return;
  const question = event.target.closest('.question'); if (!question) return;
  const chip = event.target.closest('.experience-chip [data-action="open-experience"]');
  if (chip) {
    // 경험 정리로 넘어가는 기본 동작(main.js) 대신 여기서 펼친다.
    event.stopImmediatePropagation();
    const experience = data.experiences.find(entry => entry.id === chip.dataset.id); if (!experience) return;
    const open = question.querySelector(`.exp-peek[data-exp="${CSS.escape(experience.id)}"]`);
    question.querySelector('.exp-peek')?.remove();
    question.querySelectorAll('.experience-chip.open').forEach(element => element.classList.remove('open'));
    if (!open) { question.insertAdjacentHTML('beforeend', experiencePeekHtml(experience)); chip.closest('.experience-chip').classList.add('open'); }
    return;
  }
  const close = () => { question.querySelector('.exp-peek')?.remove(); question.querySelectorAll('.experience-chip.open').forEach(element => element.classList.remove('open')); };
  if (event.target.closest('[data-exp-close]')) { close(); return; }
  const openButton = event.target.closest('[data-exp-open]'); if (openButton) { navTo('experience-detail', openButton.dataset.expOpen); return; }
  const insert = event.target.closest('[data-exp-insert]');
  if (insert) {
    const experience = data.experiences.find(entry => entry.id === insert.dataset.expInsert);
    if (experience) insertIntoAnswer(question.querySelector('.question-answer'), experiencePlainText(experience));
  }
});

// ---------- 답변 복사 ----------
// 지원 사이트 입력칸에 바로 붙여 넣게 답변을 복사한다. 잠깐 체크 표시로 알려 준다.
main.addEventListener('click', async event => {
  if (view !== 'essays') return;
  const button = event.target.closest('[data-copy-answer]'); if (!button) return;
  const answer = button.closest('.question').querySelector('.question-answer').value;
  if (!answer.trim()) { showToast('아직 쓴 답변이 없어요.'); return; }
  if (!(await copyText(answer))) { showToast('복사하지 못했어요. 답변을 선택해 직접 복사해 주세요.'); return; }
  button.classList.add('copied'); button.querySelector('span').textContent = '복사됨';
  clearTimeout(button.copyTimer);
  button.copyTimer = setTimeout(() => { button.classList.remove('copied'); button.querySelector('span').textContent = '복사'; }, 1400);
});

// ---------- 문항 순서 바꾸기 ----------
// 문항 번호를 잡고 끌면 순서를 바꾼다. 번호에서 시작할 때만 끌 수 있게 해서, 답변 글을 고르는 동작과 겹치지 않게 한다.
const listOf = () => main.querySelector('.essay-editor .question-list');
const clearDrop = () => main.querySelectorAll('.question.drop-before, .question.drop-after').forEach(element => element.classList.remove('drop-before', 'drop-after'));
let dragged = null;

// 끌고 있는 위치 바로 아래(또는 맨 끝)의 문항: 그 문항 앞에 놓는다.
function dropSpot(clientY) {
  const others = [...listOf().querySelectorAll(':scope > .question')].filter(element => element !== dragged);
  const before = others.find(element => { const rect = element.getBoundingClientRect(); return clientY < rect.top + rect.height / 2; });
  return { before, last: others.at(-1) };
}

main.addEventListener('pointerdown', event => {
  const handle = view === 'essays' && event.target.closest('.essay-editor [data-drag-handle]');
  if (handle) handle.closest('.question').draggable = true;
});

main.addEventListener('dragstart', event => {
  const section = view === 'essays' && event.target.closest?.('.essay-editor .question[draggable="true"]'); if (!section) return;
  dragged = section;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-question', section.dataset.qid);
  requestAnimationFrame(() => section.classList.add('dragging'));
});

main.addEventListener('dragover', event => {
  if (!dragged || !event.target.closest?.('.essay-editor .question-list')) return;
  event.preventDefault(); event.dataTransfer.dropEffect = 'move';
  const { before, last } = dropSpot(event.clientY);
  clearDrop();
  if (before) before.classList.add('drop-before'); else last?.classList.add('drop-after');
});

main.addEventListener('drop', event => {
  if (!dragged || !event.target.closest?.('.essay-editor .question-list')) return;
  event.preventDefault();
  const item = data.postings.find(posting => posting.id === selectedId); if (!item) return;
  const { before } = dropSpot(event.clientY);
  const moving = item.questions.find(question => question.id === dragged.dataset.qid);
  const order = item.questions.filter(question => question !== moving);
  const at = before ? order.findIndex(question => question.id === before.dataset.qid) : order.length;
  order.splice(at, 0, moving);
  if (order.every((question, index) => question === item.questions[index])) return;
  // 옮기기 전 자리를 기억해 두었다가 새 자리로 미끄러지게 한다.
  const rects = new Map([...listOf().querySelectorAll('.question')].map(element => [element.dataset.qid, element.getBoundingClientRect().top]));
  item.questions = order; item.updatedAt = new Date().toISOString(); persist();
  renderQuestions(item, 'questions');
  if (reducedMotion()) return;
  for (const element of listOf().querySelectorAll('.question')) {
    const dy = (rects.get(element.dataset.qid) ?? 0) - element.getBoundingClientRect().top;
    if (dy) element.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  }
});

main.addEventListener('dragend', () => {
  if (!dragged) return;
  dragged.classList.remove('dragging'); dragged.draggable = false; dragged = null; clearDrop();
});

// 끌지 않고 번호만 눌렀다 떼면 다시 글을 고를 수 있게 되돌린다.
main.addEventListener('pointerup', () => { if (!dragged) main.querySelectorAll('.essay-editor .question[draggable="true"]').forEach(element => { element.draggable = false; }); });
