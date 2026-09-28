// 사이드 피크: 목록을 그대로 둔 채 오른쪽에서 공고를 열어 본다(노션의 '사이드에서 보기').
import { $, main } from './dom.js';
import { renderPostingDetail } from './posting-detail.js';
import { refreshPostingTable } from './postings.js';
import { navTo } from './router.js';
import { data, selectedId, view } from './state.js';
import { reducedMotion } from './ui.js';

let shown = false;

export const peekOpen = () => view === 'postings' && Boolean(selectedId) && data.postings.some(item => item.id === selectedId);

// 지금 주소에 맞게 패널을 열거나 닫고, 목록에서 열린 줄을 표시한다.
export function updatePeek() {
  const panel = $('#peek'); if (!panel) { shown = false; return; }
  const open = peekOpen();
  main.querySelectorAll('.peeked').forEach(element => element.classList.toggle('peeked', open && element.dataset.id === selectedId));
  if (open) {
    main.querySelectorAll('.data-row[data-id], .board-card[data-id]').forEach(element => { if (element.dataset.id === selectedId) element.classList.add('peeked'); });
    // 글 입력칸 높이를 재려면 먼저 보이게 해야 한다.
    panel.getAnimations().forEach(animation => animation.cancel());
    panel.hidden = false;
    renderPostingDetail();
    if (!shown && !reducedMotion()) panel.animate([{ opacity: 0, transform: 'translateX(28px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    shown = true;
    return;
  }
  if (panel.hidden) return;
  shown = false;
  const hide = () => { if (!peekOpen()) { panel.hidden = true; panel.replaceChildren(); } };
  if (reducedMotion()) hide();
  else {
    // 창이 뒤로 가 있으면 애니메이션이 멈추므로 시간이 지나면 어쨌든 닫는다.
    panel.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(20px)' }], { duration: 160, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }).finished.then(hide, hide);
    setTimeout(hide, 220);
  }
}

// 연 곳에서 닫는다. 피크를 연 기록이 바로 앞에 있으면 뒤로 가기로 닫아, 기록이 쌓이지 않게 한다.
export function closePeek() {
  if (!peekOpen()) return;
  const row = main.querySelector(`.peeked[data-id="${CSS.escape(selectedId)}"]`);
  if (history.state?.peek) history.back(); else navTo('postings', null, { history: 'replace' });
  (row?.querySelector('.row-title') || row)?.focus({ preventScroll: true });
}

// 피크 안에서 고친 내용을 목록에도 곧바로 반영한다(글자 입력은 잠깐 모았다가).
let refreshTimer = 0;

export function peekEdited({ now = false } = {}) {
  if (!peekOpen()) return;
  clearTimeout(refreshTimer);
  if (now) refreshPostingTable(); else refreshTimer = setTimeout(refreshPostingTable, 250);
}
