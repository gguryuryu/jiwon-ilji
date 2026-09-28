// 공고 상세의 면접 후기: 면접을 본 뒤 받은 질문과 느낀 점을 남기고, 받은 질문은 면접 준비로 옮길 수 있다.
import { $ } from './dom.js';
import { askedQuestions, defaultDetailTab, newQuestion, newReview, reviewRound } from './model.js';
import { peekEdited } from './peek.js';
import { refreshDocTabs, renderQuestions, showDetailTab } from './posting-detail.js';
import { persist, scheduleSave } from './store.js';
import { showToast } from './ui.js';
import { autoGrow, escapeHtml, formatDate, icon } from './util.js';

// 공고마다 마지막으로 본 탭을 기억한다. 처음 열면 진행 상태에 맞는 탭을 연다.
const tabs = new Map();

export const detailTab = item => tabs.get(item.id) || defaultDetailTab(item);

export function setDetailTab(id, key) { tabs.set(id, key); }

export const reviewsHtml = () => `<p class="panel-hint">면접을 보고 나면 받은 질문과 느낀 점을 바로 남겨 두세요. 같은 회사나 비슷한 직무에 다시 지원할 때 큰 도움이 돼요.</p><div id="reviews" class="review-list"></div><button type="button" class="ghost-button add-question" data-action="add-review">${icon('plus')}후기 추가</button>`;

function reviewHtml(review) {
  const rid = escapeHtml(review.id);
  const field = (name, label, placeholder, rows) => `<label class="review-field"><span>${label}</span><textarea data-field="${name}" rows="${rows}" placeholder="${placeholder}">${escapeHtml(review[name] || '')}</textarea></label>`;
  const asked = askedQuestions(review.asked).length;
  return `<section class="question review" data-rid="${rid}">
    <div class="question-head"><span class="question-index">${icon('check')}</span>
      <textarea class="question-title" data-field="round" rows="1" placeholder="어떤 면접이었나요? (예: 1차 면접 · 10월 2일)" aria-label="면접 이름">${escapeHtml(review.round || '')}</textarea>
      <button type="button" class="icon-button question-delete" data-action="delete-review" data-rid="${rid}" aria-label="면접 후기 삭제">×</button></div>
    ${field('asked', '받은 질문', '한 줄에 질문 하나씩 적어 주세요', 3)}
    ${field('note', '분위기 · 메모', '면접관 수, 진행 방식, 분위기 등', 2)}
    ${field('regret', '아쉬웠던 점 · 다음엔 이렇게', '막혔던 답, 다시 한다면 이렇게 말하고 싶은 것', 2)}
    <div class="question-foot"><button type="button" class="text-button asked-to-prep" data-action="asked-to-prep" data-rid="${rid}"${asked ? '' : ' disabled'}>${icon('plus')}받은 질문 ${asked ? `${asked}개를 ` : ''}면접 준비에 추가</button></div>
  </section>`;
}

export function renderReviews(item) {
  const container = $('#reviews'); if (!container) return;
  container.innerHTML = item.interviewReviews.length ? item.interviewReviews.map(reviewHtml).join('') : '<p class="questions-empty">아직 남긴 면접 후기가 없어요.</p>';
  container.querySelectorAll('textarea').forEach(autoGrow);
  refreshDocTabs(item);
}

export function wireReviews(item) {
  const container = $('#reviews');
  container.addEventListener('input', event => {
    const review = item.interviewReviews.find(entry => entry.id === event.target.closest('.review')?.dataset.rid);
    const name = event.target.dataset.field; if (!review || !name) return;
    review[name] = name === 'round' ? event.target.value.replace(/\n/g, ' ') : event.target.value;
    autoGrow(event.target);
    if (name === 'asked') {
      const count = askedQuestions(review.asked).length; const button = event.target.closest('.review').querySelector('.asked-to-prep');
      button.disabled = !count; button.lastChild.textContent = `받은 질문 ${count ? `${count}개를 ` : ''}면접 준비에 추가`;
    }
    item.updatedAt = new Date().toISOString(); scheduleSave(); peekEdited();
  });
  container.addEventListener('keydown', event => { if (event.target.dataset.field === 'round' && event.key === 'Enter' && !event.isComposing) { event.preventDefault(); event.target.blur(); } });
}

// 탭 바꾸기, 후기 추가·삭제, 받은 질문을 면접 준비로 옮기기
export function handleInterviewAction(action, control, item) {
  const container = control.closest('#peek') || document.querySelector('#main');
  if (action === 'detail-tab') { setDetailTab(item.id, control.dataset.tab); showDetailTab(container, control.dataset.tab); return; }
  if (action === 'add-review') {
    item.interviewReviews.push(newReview(reviewRound(item, formatDate)));
    renderReviews(item);
    const last = $('#reviews .review:last-child'); (last.querySelector('.question-title').value ? last.querySelector('[data-field=asked]') : last.querySelector('.question-title')).focus();
  }
  if (action === 'delete-review') {
    const index = item.interviewReviews.findIndex(entry => entry.id === control.dataset.rid); if (index < 0) return;
    const [removed] = item.interviewReviews.splice(index, 1); renderReviews(item);
    showToast('면접 후기를 삭제했어요.', { label: '되돌리기', run: () => {
      item.interviewReviews.splice(Math.min(index, item.interviewReviews.length), 0, removed); item.updatedAt = new Date().toISOString(); persist();
      renderReviews(item); peekEdited({ now: true });
    } });
  }
  if (action === 'asked-to-prep') {
    const review = item.interviewReviews.find(entry => entry.id === control.dataset.rid); if (!review) return;
    const have = new Set(item.interviewQuestions.map(question => question.title.trim()));
    const added = askedQuestions(review.asked).filter(title => !have.has(title));
    if (!added.length) { showToast('받은 질문이 이미 모두 면접 준비에 있어요.'); return; }
    item.interviewQuestions.push(...added.map(title => newQuestion(title)));
    renderQuestions(item, 'interviewQuestions');
    showToast(`면접 준비에 질문 ${added.length}개를 추가했어요.`, { label: '보기', run: () => { setDetailTab(item.id, 'interview'); showDetailTab(container, 'interview'); } });
  }
  item.updatedAt = new Date().toISOString(); persist(); peekEdited({ now: true });
}
