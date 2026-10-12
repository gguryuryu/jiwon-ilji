// 다음 일정 이름 칸(data-label-pick): 누르면 아래에 자주 쓰는 이름 목록을 펼친다. 치면 맞는 것만 남고, 목록에 없는 이름도 그대로 쓴다.
// 목록은 칸 바로 옆에 붙인다(새 공고 창은 맨 위 층이라 body에 붙이면 창 뒤로 숨는다).
import { escapeHtml as esc } from './util.js';

export const NEXT_LABELS = ['서류 발표', '필기', '인적성', '1차 면접', '2차 면접', '최종 발표'];

let input = null; // 목록이 열린 칸
let active = -1;  // ↑↓로 고른 줄
let typed = false; // 막 열었을 때는 칸에 이름이 있어도 전체 목록을 보여 주고, 치기 시작하면 거른다

const menu = () => input?.parentElement.querySelector(':scope > .label-pick');
const matches = () => { const text = typed ? input.value.trim() : ''; return text ? NEXT_LABELS.filter(label => label.includes(text) && label !== text) : NEXT_LABELS; };

function show() {
  const list = matches(); let box = menu();
  if (!list.length) { box?.remove(); return; }
  if (!box) { box = document.createElement('div'); box.className = 'label-pick'; box.setAttribute('role', 'listbox'); input.after(box); }
  input.parentElement.classList.add('label-pick-host');
  active = Math.min(active, list.length - 1);
  box.innerHTML = list.map((label, index) => `<button type="button" class="label-pick-item${index === active ? ' active' : ''}" role="option" tabindex="-1" data-label="${esc(label)}">${esc(label)}</button>`).join('');
  // 아래 공간(창이나 새 공고 창의 끝)이 모자라면 위로 펼친다.
  const limit = input.closest('dialog')?.getBoundingClientRect().bottom ?? window.innerHeight;
  const up = input.getBoundingClientRect().bottom + box.offsetHeight + 12 > limit && input.getBoundingClientRect().top > box.offsetHeight + 12;
  box.style.left = `${input.offsetLeft}px`; box.style.minWidth = `${Math.min(input.offsetWidth, 220)}px`;
  box.style.top = `${up ? input.offsetTop - box.offsetHeight - 4 : input.offsetTop + input.offsetHeight + 4}px`;
  input.setAttribute('aria-expanded', 'true');
}

function close() {
  menu()?.remove(); input?.parentElement.classList.remove('label-pick-host'); input?.setAttribute('aria-expanded', 'false');
  input = null; active = -1; typed = false;
}

// 고르면 직접 친 것처럼 input·change를 보내서 공고 상세는 바로 저장되고, 새 공고 창은 그 값으로 저장된다.
function pick(label) {
  const target = input; close();
  target.value = label;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
}

const open = target => { if (input !== target) { close(); input = target; } typed = false; show(); };

document.addEventListener('focusin', event => { if (event.target.matches?.('[data-label-pick]')) open(event.target); else if (input && !menu()?.contains(event.target)) close(); });
document.addEventListener('click', event => {
  if (event.target.matches?.('[data-label-pick]')) { open(event.target); return; }
  const item = event.target.closest?.('.label-pick-item'); if (item && input) { pick(item.dataset.label); return; }
  if (input && event.target !== input) close();
});
// 목록을 눌러도 칸의 커서가 빠지지 않게 한다.
document.addEventListener('mousedown', event => { if (event.target.closest?.('.label-pick')) event.preventDefault(); });
document.addEventListener('input', event => { if (event.target === input) { active = -1; typed = true; show(); } });
document.addEventListener('keydown', event => {
  if (event.target !== input || !input || event.isComposing) return; // 한글 조합 중의 Enter·화살표는 칸에 맡긴다
  const list = menu() ? matches() : [];
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!menu()) { show(); event.preventDefault(); return; }
    if (event.key === 'ArrowDown') active = active + 1 >= list.length ? -1 : active + 1;
    else active = active - 1 < -1 ? list.length - 1 : active - 1;
    show(); event.preventDefault();
  } else if (event.key === 'Enter' && active >= 0 && list[active]) { event.preventDefault(); pick(list[active]); }
  else if (event.key === 'Escape' && menu()) { event.preventDefault(); event.stopPropagation(); menu().remove(); input.setAttribute('aria-expanded', 'false'); }
  else if (event.key === 'Tab') close();
}, true);
