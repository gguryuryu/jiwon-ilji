// 작은 타이머 창(맥 앱의 '작은 창으로 띄우기'): 도는 while을 두 개까지 보여 준다.
// 시간은 이 창이 스스로 매초 센다(본 창이 뒤로 가 느려져도 정확하게). pause·break는 본 창에 맡겨 기록은 한 곳에서만 바뀐다.
import { activeSeconds, clock, linkCall, liveBlocks, parsePomodoro, pomodoroState, untilState } from './lab-model.js';
import { escapeHtml as esc } from './util.js';

const box = document.querySelector('#timers');
const post = message => window.webkit?.messageHandlers?.jiwon?.postMessage(message);
const hhmm = iso => { const date = new Date(iso); return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; };
const hms = seconds => { const t = Math.floor(seconds); const h = Math.floor(t / 3600); const m = Math.floor(t % 3600 / 60); const pad = v => String(v).padStart(2, '0'); return h ? `${h}:${pad(m)}:${pad(t % 60)}` : `${m}:${pad(t % 60)}`; };
const ICONS = {
  pause: '<path d="M4 2.5v7M8 2.5v7" stroke-linecap="round"/>',
  play: '<path d="M3.5 2.2v7.6L9.6 6z" stroke-linejoin="round"/>',
  stop: '<rect x="2.8" y="2.8" width="6.4" height="6.4" rx="1.4"/>',
};
const svg = name => `<svg viewBox="0 0 12 12" aria-hidden="true">${ICONS[name]}</svg>`;

// 원형 시계: 본 창 집중 루프의 시계와 같은 모양(한 바퀴 = 60분, 남은 시간만큼 부채꼴)
const C = 64; const R = 52;
const polar = minutes => { const angle = minutes / 60 * 2 * Math.PI; return [C + R * Math.sin(angle), C - R * Math.cos(angle)]; };
function arcPaths(minutes) {
  const m = Math.max(0, Math.min(60, minutes));
  if (m <= 0) return { wedge: '', edge: '' };
  if (m >= 59.99) return { wedge: `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - .01} ${C - R} Z`, edge: `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - .01} ${C - R}` };
  const [x, y] = polar(m); const end = `${x.toFixed(2)} ${y.toFixed(2)}`; const large = m > 30 ? 1 : 0;
  return { wedge: `M ${C} ${C} L ${C} ${C - R} A ${R} ${R} 0 ${large} 1 ${end} Z`, edge: `M ${C} ${C - R} A ${R} ${R} 0 ${large} 1 ${end}` };
}
const dialHtml = '<svg class="dial" viewBox="0 0 128 128" aria-hidden="true"><circle class="track" cx="64" cy="64" r="52"/><path class="wedge" data-wedge/><path class="edge" data-edge/></svg>';

let data = { labBlocks: [] };
let running = [];

// 본 창 집중 루프의 위쪽 시계와 같은 계산: 시각까지 · 뽀모도로 · 그냥 도는 중
function stateOf(block) {
  const until = untilState(block);
  if (until) return { tone: 'until', minutes: (1 - until.progress) * 60, time: until.done ? '0:00' : hms(until.left), phase: until.done ? '끝났어요' : `${hhmm(block.untilAt)}까지` };
  const plan = parsePomodoro(block.cond); const seconds = activeSeconds(block);
  if (plan) {
    const state = pomodoroState(plan, seconds);
    if (state.done) return { tone: 'focus', minutes: 0, time: '0:00', phase: '끝났어요' };
    return { tone: state.phase === 'rest' ? 'rest' : 'focus', minutes: state.left / 60, time: clock(state.left), phase: `${state.phase === 'rest' ? '휴식' : '집중'} ${state.round}/${plan.rounds}` };
  }
  return { tone: 'loop', minutes: (seconds / 60) % 60, time: hms(seconds), phase: '도는 중' };
}

const bodyLabel = block => { const call = block.link && linkCall(data, block.link); return call ? `${call.ns}.${call.name}()` : block.body || '…'; };

function render() {
  const shown = running.slice(0, 2); const hidden = running.length - shown.length;
  box.innerHTML = shown.length ? shown.map(block => `<section class="timer" data-id="${esc(block.id)}">
      ${dialHtml}
      <div class="copy" data-open title="지원일지 창 열기">
        <div class="row"><span class="time" data-time></span><span class="phase" data-phase></span></div>
        <div class="what"><b>while</b> ${esc(block.cond || '…')}: ${esc(bodyLabel(block))}</div>
      </div>
      <div class="actions">
        <button type="button" data-act="${block.pausedAt ? 'resume' : 'pause'}" title="${block.pausedAt ? '다시 시작' : '일시정지'}" aria-label="${block.pausedAt ? '다시 시작' : '일시정지'}">${svg(block.pausedAt ? 'play' : 'pause')}</button>
        <button type="button" data-act="break" title="그만하기(break)" aria-label="그만하기">${svg('stop')}</button>
      </div>
    </section>`).join('') + (hidden ? `<div class="more" data-open>그 밖에 ${hidden}개 더 도는 중 · 지원일지에서 보기</div>` : '')
    : '<div class="idle" data-open>돌고 있는 while이 없어요. 집중 루프에서 ▶ run을 누르면 여기에 떠요.</div>';
  tick();
  // 타이머 수에 맞춰 창 높이를 맞춘다.
  requestAnimationFrame(() => post({ type: 'size', height: Math.ceil(box.getBoundingClientRect().height) }));
}

function tick() {
  for (const section of box.querySelectorAll('.timer')) {
    const block = running.find(item => item.id === section.dataset.id); if (!block) continue;
    const state = stateOf(block);
    section.className = `timer ${state.tone}${block.pausedAt ? ' paused' : ''}`;
    section.querySelector('[data-time]').textContent = state.time;
    const paths = arcPaths(state.minutes);
    section.querySelector('[data-wedge]').setAttribute('d', paths.wedge); section.querySelector('[data-edge]').setAttribute('d', paths.edge);
    section.querySelector('[data-phase]').textContent = block.pausedAt ? '일시정지' : state.phase;
  }
}

async function refresh() {
  try {
    data = await (await fetch('/api/data', { cache: 'no-store' })).json();
    running = liveBlocks(data).filter(block => block.runningSince).sort((a, b) => a.runningSince.localeCompare(b.runningSince));
    render();
  } catch { /* 서버가 잠깐 끊겨도 다음에 다시 읽는다 */ }
}

box.addEventListener('click', event => {
  const button = event.target.closest('[data-act]');
  if (button) { post({ type: 'act', action: button.dataset.act, id: button.closest('.timer').dataset.id }); return; }
  if (event.target.closest('[data-open]')) post({ type: 'focusMain' });
});

// 본 창에서 저장하면 맥 앱이 알려 주고(miniRefresh), 같은 앱 안이면 BroadcastChannel로도 알 수 있다. 혹시 놓쳐도 20초마다 다시 읽는다.
window.miniRefresh = refresh;
if ('BroadcastChannel' in window) new BroadcastChannel('jiwon-ilji').addEventListener('message', event => { if (event.data?.type === 'saved') refresh(); });
setInterval(tick, 1000);
setInterval(refresh, 20_000);
refresh();
