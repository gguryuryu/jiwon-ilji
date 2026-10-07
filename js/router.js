// 주소(#/…)와 화면 이동, 뒤로 가기
import { renderCalendar } from './calendar.js';
import { renderEssays } from './essays.js';
import { renderStudy } from './study.js';
import { renderLab, startTicking } from './lab.js';
import { main } from './dom.js';
import { renderExperienceDetail, renderExperiences } from './experiences.js';
import { blankExperience } from './model.js';
import { renderProfile } from './profile.js';
import { tidyProfile } from './profile-model.js';
import { peekOpen, updatePeek } from './peek.js';
import { renderPostingDetail } from './posting-detail.js';
import { refreshPostingTable, renderPostings } from './postings.js';
import { data, selectedId, setRoute, view } from './state.js';
import { persist, saveCurrentEditor } from './store.js';
import { reducedMotion } from './ui.js';

// 화면 이동을 브라우저 기록에 남겨 뒤로·앞으로 가기(마우스 버튼, ⌘[ 포함)가 동작하게 한다.
export const routeHash = (next, id) => next === 'postings' && id ? `#/peek/${id}` : ({ 'posting-detail': `#/postings/${id}`, calendar: '#/calendar', study: '#/study', lab: '#/lab', profile: '#/profile', essays: id ? `#/essays/${id}` : '#/essays', experiences: '#/experiences', 'experience-detail': `#/experiences/${id}` })[next] || '#/';

export function routeFrom(hash) {
  const [, section = '', id = ''] = decodeURIComponent(hash || '').replace(/^#/, '').split('/');
  if (section === 'postings' && id) return { view: 'posting-detail', id };
  if (section === 'peek' && id) return { view: 'postings', id };
  if (section === 'experiences') return id ? { view: 'experience-detail', id } : { view: 'experiences', id: null };
  if (section === 'calendar') return { view: 'calendar', id: null };
  if (section === 'study') return { view: 'study', id: null };
  if (section === 'lab') return { view: 'lab', id: null };
  if (section === 'profile') return { view: 'profile', id: null };
  if (section === 'essays') return { view: 'essays', id: id || null };
  return { view: 'postings', id: null };
}

export function navTo(next, id = null, { history: mode = 'push' } = {}) {
  saveCurrentEditor();
  if (view === 'experience-detail' && !(next === view && id === selectedId)) {
    const leaving = data.experiences.find(item => item.id === selectedId);
    if (leaving && blankExperience(leaving)) { data.experiences = data.experiences.filter(item => item !== leaving); persist(); }
  }
  if (view === 'profile' && next !== 'profile' && tidyProfile(data)) persist();
  const hash = routeHash(next, id);
  // 지원 현황 안에서 피크만 열고 닫을 때는 목록을 그대로 두고 스크롤도 옮기지 않는다.
  const peekOnly = view === 'postings' && next === 'postings';
  if (mode !== 'none') {
    // 지금 화면의 스크롤 위치를 기록해 두었다가 뒤로 왔을 때 되살린다.
    history.replaceState({ ...history.state, scrollY: window.scrollY }, '', location.hash || '#/');
    const pushing = mode !== 'replace' && location.hash !== hash;
    // peek: 이 기록이 피크를 열면서 쌓은 것인지. 닫을 때 뒤로 가기로 돌아갈 수 있는지 판단한다.
    const state = { scrollY: peekOnly ? window.scrollY : 0, peek: next === 'postings' && Boolean(id) && (pushing || Boolean(history.state?.peek)) };
    if (pushing) history.pushState(state, '', hash); else history.replaceState(state, '', hash);
  }
  // 피크에서 전체 페이지로 넓힐 때는 본문이 피크 자리에서 페이지 자리로 미끄러져 온다.
  const expandFrom = next === 'posting-detail' && peekOpen() && selectedId === id ? main.querySelector('#peek .detail-body')?.getBoundingClientRect() : null;
  const changed = view !== next || selectedId !== id;
  // 자소서 탭 안에서 기업만 바꿀 때는 화면 전체가 다시 들어오는 움직임 없이 바꾼다.
  const withinEssays = view === 'essays' && next === 'essays';
  setRoute(next, id);
  if (peekOnly) { refreshPostingTable(); updatePeek(); return; }
  render();
  if (mode !== 'none') window.scrollTo({ top: 0, behavior: 'instant' });
  if (!changed || withinEssays || reducedMotion()) return;
  const body = expandFrom && main.querySelector('.detail-body');
  if (body) {
    const to = body.getBoundingClientRect();
    body.animate([{ transform: `translate(${expandFrom.left - to.left}px, ${expandFrom.top - to.top}px)`, opacity: .6 }, { transform: 'none', opacity: 1 }], { duration: 340, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    main.querySelector('.page-topbar')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 80, fill: 'backwards' });
    return;
  }
  main.classList.remove('view-enter'); void main.offsetWidth; main.classList.add('view-enter');
}

window.addEventListener('popstate', event => {
  // 창이 열려 있을 때 뒤로 가기는 창만 닫고 지금 화면에 머문다.
  const openDialogs = document.querySelectorAll('dialog[open]');
  if (openDialogs.length) {
    openDialogs.forEach(dialog => dialog.close());
    history.pushState({ scrollY: window.scrollY }, '', routeHash(view, selectedId));
    return;
  }
  const route = routeFrom(location.hash);
  const peekOnly = view === 'postings' && route.view === 'postings';
  navTo(route.view, route.id, { history: 'none' });
  if (!peekOnly) window.scrollTo({ top: event.state?.scrollY || 0, behavior: 'instant' });
});

export function render() {
  document.querySelectorAll('[data-count]').forEach(element => { const count = data[element.dataset.count]?.length; element.textContent = count ? count : ''; });
  document.querySelectorAll('.primary-nav button').forEach(button => button.classList.toggle('active', button.dataset.view === (view.startsWith('posting') ? 'postings' : view.startsWith('experience') ? 'experiences' : view)));
  // 다시 그려도 피크 안에서 읽던 위치는 그대로 둔다.
  const peekScroll = main.querySelector('#peek .peek-scroll')?.scrollTop || 0;
  if (view === 'postings') renderPostings();
  else if (view === 'posting-detail') renderPostingDetail();
  else if (view === 'calendar') renderCalendar();
  else if (view === 'study') renderStudy();
  else if (view === 'lab') renderLab();
  else if (view === 'profile') renderProfile();
  else if (view === 'essays') renderEssays();
  else if (view === 'experiences') renderExperiences();
  else if (view === 'experience-detail') renderExperienceDetail();
  // 집중 루프 탭 밖에 있어도 도는 while의 남은 시간을 창 제목에 보여 주고, 뽀모도로가 끝나면 알린다.
  if (view !== 'lab') startTicking();
  updatePeek();
  const peekBody = main.querySelector('#peek .peek-scroll'); if (peekBody) peekBody.scrollTop = peekScroll;
}
