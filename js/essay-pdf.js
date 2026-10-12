// 자소서 공유: 고른 기업의 문항과 답변만 A4 PDF로 만든다(회사 정보는 파일 이름에만).
// 화면에는 숨겨 둔 시트(#print-sheet)를 인쇄할 때만 보이게 하고, 앱이 그 화면을 PDF로 뽑는다.
// 맥 앱: 다운로드 폴더에 저장 + 공유 메뉴(카톡·메일·AirDrop). 윈도우 앱: 저장 + 폴더 열기. 브라우저: 인쇄 창의 'PDF로 저장'.
import { main } from './dom.js';
import { showToast } from './ui.js';
import { data, selectedId, view } from './state.js';
import { escapeHtml as esc, icon, nativeHost } from './util.js';

const isMac = () => Boolean(window.webkit?.messageHandlers?.jiwon);

export function shareMenuHtml() {
  const second = isMac() ? `${icon('share')}공유하기…` : nativeHost() ? `${icon('open')}저장하고 폴더 열기` : '';
  return `<details class="more-menu essay-share"><summary class="text-button" title="문항과 답변을 PDF로">${icon('share')}공유</summary><div class="menu-panel" role="menu">
      <button type="button" class="menu-item" role="menuitem" data-essay-pdf="save">${icon('download')}PDF로 저장</button>
      ${second ? `<button type="button" class="menu-item" role="menuitem" data-essay-pdf="share">${second}</button>` : ''}
    </div></details>`;
}

// 제목도 답변도 없는 빈 문항은 뺀다. 답변 줄바꿈은 그대로 둔다.
function sheetHtml(questions) {
  return questions.map((question, index) => `<section class="print-q"><h2>${index + 1}. ${esc(question.title || '문항')}</h2><p>${esc(question.answer || '')}</p></section>`).join('');
}

// 파일 이름에 쓸 수 없는 글자(/ : * ? 등)는 뺀다.
const fileName = item => `${(item.organization || '이름 없음').replace(/[\\/:*?"<>|]+/g, ' ').trim() || '자소서'} 자소서.pdf`;

let savedTitle = '';
function clearSheet() {
  document.querySelector('#print-sheet')?.remove(); document.documentElement.classList.remove('printing');
  if (savedTitle) { document.title = savedTitle; savedTitle = ''; }
}
window.addEventListener('jiwon:printed', clearSheet);
window.addEventListener('afterprint', clearSheet);

function makePdf(item, share, anchor) {
  const questions = (item.questions || []).filter(question => question.title?.trim() || question.answer?.trim());
  if (!questions.length) { showToast('PDF에 넣을 문항이 없어요. 문항을 먼저 추가해 주세요.'); return; }
  clearSheet();
  const sheet = document.createElement('div');
  sheet.id = 'print-sheet';
  sheet.innerHTML = sheetHtml(questions);
  document.body.append(sheet);
  document.documentElement.classList.add('printing');
  const host = nativeHost();
  // 브라우저는 창 제목이 파일 이름이 되므로 잠깐 바꿔 둔다.
  if (!host) { savedTitle = document.title; document.title = fileName(item).replace(/\.pdf$/, ''); window.print(); return; }
  // 공유 메뉴는 공유 버튼 아래에 띄운다(화면 좌표 그대로 보내고 앱이 확대 배율을 곱한다).
  const box = anchor.getBoundingClientRect();
  host.postMessage({ type: 'pdf', name: fileName(item), share, x: box.left, y: box.top, width: box.width, height: box.height });
}

main.addEventListener('click', event => {
  const control = view === 'essays' && event.target.closest('[data-essay-pdf]'); if (!control) return;
  const item = data.postings.find(posting => posting.id === selectedId); if (!item) return;
  makePdf(item, control.dataset.essayPdf === 'share', control.closest('.essay-share').querySelector('summary'));
});
