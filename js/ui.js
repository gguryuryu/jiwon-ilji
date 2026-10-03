// 알림(토스트), 저장 상태 표시, 움직임, 편집 중 다시 그리기 미루기
import { $, main } from './dom.js';
import { render } from './router.js';
import { refreshFromServer, refreshPending } from './store.js';

let toastTimer;

// 시스템에서 '동작 줄이기'를 켰으면 움직임 효과를 쓰지 않는다.
export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// 목록을 다시 그리기 전후의 위치를 비교해, 자리를 옮긴 줄·카드가 새 자리로 미끄러지게 한다(FLIP).
export function animateReorder(update, movedId = null) {
  const selector = '.data-row[data-id], .board-card[data-id], .goal-pill[data-id]';
  const before = new Map([...main.querySelectorAll(selector)].map(element => [element.dataset.id, element.getBoundingClientRect()]));
  update();
  if (reducedMotion()) return;
  for (const element of main.querySelectorAll(selector)) {
    const previous = before.get(element.dataset.id); const next = element.getBoundingClientRect();
    if (element.dataset.id === movedId) { element.classList.remove('just-moved'); void element.offsetWidth; element.classList.add('just-moved'); }
    if (!previous) continue;
    const dx = previous.left - next.left; const dy = previous.top - next.top;
    if (!dx && !dy) continue;
    element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  }
}

// 탭 밑줄: 고른 탭으로 밑줄이 미끄러져 간다. 탭 줄을 통째로 다시 그려도(표↔보드 등) 이전 자리에서 출발하도록
// 탭 줄 이름(aria-label)마다 마지막 위치를 기억한다.
const lastIndicator = new Map();
export function syncTabIndicators(root = main) {
  for (const tabs of root.querySelectorAll('.view-tabs')) {
    const active = tabs.querySelector('.view-tab.active'); if (!active || !active.offsetWidth) continue;
    const key = tabs.getAttribute('aria-label') || ''; const x = active.offsetLeft; const w = active.offsetWidth;
    const set = (left, width) => { tabs.style.setProperty('--ind-x', `${left}px`); tabs.style.setProperty('--ind-w', `${width}px`); };
    if (!tabs.classList.contains('has-indicator')) {
      const previous = lastIndicator.get(key);
      set(previous?.x ?? x, previous?.w ?? w);
      tabs.classList.add('has-indicator');
      if (previous && !reducedMotion()) { void tabs.offsetWidth; tabs.classList.add('ind-animate'); }
    } else if (!tabs.classList.contains('ind-animate') && !reducedMotion()) tabs.classList.add('ind-animate');
    set(x, w);
    lastIndicator.set(key, { x, w });
  }
}

// action을 주면 '되돌리기' 같은 버튼이 붙고 조금 더 오래 보인다. 버튼이 여럿이면 배열로 준다.
export const showToast = (message, action = null) => {
  const toast = $('#toast');
  toast.replaceChildren(document.createTextNode(message));
  for (const entry of [action].flat().filter(Boolean)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'toast-action'; button.textContent = entry.label;
    button.addEventListener('click', () => { toast.classList.remove('show'); clearTimeout(toastTimer); entry.run(); });
    toast.append(button);
  }
  const duration = action ? 7000 : 3500;
  const hide = () => toast.classList.remove('show');
  toast.onmouseenter = toast.onmouseleave = null;
  if (action) {
    const bar = document.createElement('span'); bar.className = 'toast-timer'; bar.style.animationDuration = `${duration}ms`; toast.append(bar);
    toast.onmouseenter = () => { clearTimeout(toastTimer); bar.style.animationPlayState = 'paused'; };
    toast.onmouseleave = () => {
      bar.style.animationPlayState = 'running';
      const elapsed = bar.getAnimations?.()[0]?.currentTime ?? 0;
      clearTimeout(toastTimer); toastTimer = setTimeout(hide, Math.max(1200, duration - elapsed));
    };
  }
  toast.classList.toggle('actionable', Boolean(action)); toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(hide, duration);
};

// 저장 상태는 사이드바와 상세 페이지 위쪽에 한 번만 보여 준다.
export const setSaveState = message => { document.querySelectorAll('[data-save-state]').forEach(element => { element.textContent = message; element.classList.toggle('error', /오류/.test(message)); element.classList.toggle('busy', /중/.test(message)); }); };

// ---------- 편집 중에는 화면을 다시 그리지 않는다 ----------
export function isEditing() {
  const active = document.activeElement;
  return Boolean(document.querySelector('dialog[open]') || main.querySelector('.date-popover:not([hidden]), .board-card.dragging')
    || (active && main.contains(active) && active.matches('input, textarea, select, [contenteditable="true"]')));
}

let renderPending = false;

export function safeRender({ force = false } = {}) {
  if (!force && isEditing()) { renderPending = true; return; }
  renderPending = false;
  const scroll = window.scrollY; render(); window.scrollTo({ top: scroll, behavior: 'instant' });
}

// 편집을 마치면(칸을 벗어나거나 창을 닫으면) 미뤄 둔 새로 고침을 한다.
export function flushPending() {
  setTimeout(() => {
    if (isEditing()) return;
    if (refreshPending) refreshFromServer(); else if (renderPending) safeRender();
  }, 0);
}
