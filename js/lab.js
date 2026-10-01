// 집중 루프: 할 일을 파이썬의 while·if처럼 적는다. 화면 전체가 lab.py 파일 하나처럼 줄 번호가 이어지고,
// while 조건에 숫자를 넣으면 뽀모도로로 돈다. 아래 OUTPUT에는 오늘 실행한 기록이 터미널처럼 쌓인다.
import { main } from './dom.js';
import { data, view } from './state.js';
import { persist, scheduleSave } from './store.js';
import { showToast } from './ui.js';
import { escapeHtml as esc, todayKey } from './util.js';
import { activeSeconds, breakLoop, clock, finishUntil, parseUntil, untilDate, untilState, finishBlock, liveBlocks, pauseLoop, resumeLoop, completeLink, elapsedLabel, finishPomodoro, linkCall, linkChoices, linkDone, linkTarget, minutesLabel, newLabBlock, parsePomodoro, pomodoroState, runIf, runsOn, runsThisWeek, startLoop } from './lab-model.js';

const blockById = id => data.labBlocks.find(block => block.id === id);
const bodyLabel = block => { const call = block.link && linkCall(data, block.link); return call ? `${call.ns}.${call.name}()` : block.body || '…'; };
const hhmm = iso => { const date = new Date(iso); return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; };
const elapsedSeconds = block => activeSeconds(block); // 멈춰 있던 시간은 뺀다
const hms = seconds => { const t = Math.floor(seconds); const h = Math.floor(t / 3600); const m = Math.floor(t % 3600 / 60); const pad = v => String(v).padStart(2, '0'); return h ? `${h}:${pad(m)}:${pad(t % 60)}` : `${m}:${pad(t % 60)}`; };
// 버튼 아이콘: 얇은 선 SVG(글꼴 기호 ▶ ❚❚ ■ ✓는 대체 글꼴 높이가 달라 글자 줄이 어긋났다)
const ICONS = {
  play: '<path d="M2.6 1.8v6.4L8 5z" stroke-linejoin="round"/>',
  pause: '<path d="M3.3 2v6M6.7 2v6" stroke-linecap="round"/>',
  stop: '<rect x="2.2" y="2.2" width="5.6" height="5.6" rx="1.2"/>',
  check: '<path d="M1.8 5.3 4 7.4 8.3 2.8" stroke-linecap="round" stroke-linejoin="round"/>',
  x: '<path d="M2.6 2.6l4.8 4.8M7.4 2.6 2.6 7.4" stroke-linecap="round"/>',
};
const icon = (name, text) => `<svg class="lab-ico" viewBox="0 0 10 10" aria-hidden="true">${ICONS[name]}</svg><span>${text}</span>`;
let freshId = ''; // 방금 실행한 블록: 주석·출력 줄이 타자 치듯 나타난다

// 칸 너비를 글자에 맞춰 늘린다(보이지 않는 글자 복사본이 칸 크기를 정한다).
const field = (block, name, placeholder) => {
  const locked = name === 'cond' && Boolean(block.runningSince);
  const number = name === 'cond' && block.kind === 'while' && (parsePomodoro(block.cond) || parseUntil(block.cond));
  return `<span class="lab-autosize lab-${name}${number ? ' lab-num' : ''}" data-value="${esc(block[name] || placeholder)}"><input size="1" data-field="${name}" data-id="${esc(block.id)}" value="${esc(block[name])}" placeholder="${placeholder}" spellcheck="false" autocomplete="off" aria-label="${block.kind} ${name === 'cond' ? '조건' : '할 일'}"${locked ? ' readonly title="실행 중인 조건이에요. break로 종료한 뒤 수정할 수 있어요."' : ''}></span>`;
};

// 블록 끝 주석: 오늘·이번 주에 몇 번 돌았는지(못 했다고 재촉하지는 않는다)
function commentFor(block, today) {
  const todayRuns = runsOn(block, today); const week = runsThisWeek(block, today);
  const weekText = week > todayRuns.length ? ` · 이번 주 ${week}회` : '';
  if (block.kind === 'while' && todayRuns.length) {
    const minutes = todayRuns.reduce((sum, run) => sum + (run.minutes || 0), 0);
    const tomatoes = todayRuns.reduce((sum, run) => sum + (run.rounds || 0), 0);
    return `# ✓ 오늘 ${tomatoes ? `${tomatoes}라운드 · ` : `${todayRuns.length}회 · `}${minutesLabel(minutes)}${weekText}`;
  }
  if (block.kind === 'if' && todayRuns.length) return `# ✓ 오늘 ${hhmm(todayRuns.at(-1).at)} 실행${todayRuns.length > 1 ? ` (${todayRuns.length}회)` : ''}${weekText}`;
  return week ? `# 이번 주 ${week}회` : '';
}

// 괄호 옆 작은 힌트(코드 편집기의 인레이 힌트처럼): 뽀모도로 계획
const hintFor = plan => plan ? `<span class="lab-hint" title="조건에 숫자를 넣으면 뽀모도로가 돼요"># ${plan.focus}m${plan.rounds > 1 ? ` × ${plan.rounds}, rest ${plan.rest}m` : ''}</span>` : '';
// 시각까지: '# until 15:00 · 1시간 23분 남음' (이미 지났으면 알려 준다)
const untilHint = until => {
  if (!until) return '';
  const target = untilDate(until); const minutes = target ? Math.ceil((target - Date.now()) / 60_000) : 0;
  return `<span class="lab-hint" title="이 시각까지 타이머가 돌아요"># until ${target ? `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')} · ${minutesLabel(minutes)} 남음` : `${until.label} · 이미 지난 시각이에요`}</span>`;
};
const condHint = block => block.kind !== 'while' ? '' : block.untilAt ? `<span class="lab-hint"># until ${hhmm(block.untilAt)}</span>` : hintFor(parsePomodoro(block.cond)) || untilHint(parseUntil(block.cond));

// 글자로 그린 진행 막대(레트로 터미널처럼): [████████░░░░░░░░]
const BAR = 20;
const asciiBar = ratio => { const filled = Math.round(Math.min(1, Math.max(0, ratio)) * BAR); return `<i>[</i><b>${'█'.repeat(filled)}</b><i>${'░'.repeat(BAR - filled)}]</i>`; };
// 끝을 정하지 않은 while: 세 칸짜리 덩어리가 막대 안을 왔다 갔다 한다.
const loopBar = seconds => { const span = BAR - 3; const step = Math.floor(seconds) % (span * 2); const at = step < span ? step : span * 2 - step; return `<i>[${'░'.repeat(at)}</i><b>███</b><i>${'░'.repeat(span - at)}]</i>`; };

// 도는 동안 블록 안에 생기는 진행 줄(남은 시간은 오른쪽 시계가 보여 준다)
function progressHtml(block) {
  const until = untilState(block);
  if (until) return `<span class="lab-indent"></span><span class="lab-ascii until" data-ascii>${asciiBar(until.progress)}</span><span class="lab-pct" data-pct>${Math.floor(until.progress * 100)}%</span><span class="lab-phase until">until ${hhmm(block.untilAt)}</span><span class="lab-left" data-left>${hms(until.left)}</span>`;
  const plan = parsePomodoro(block.cond);
  if (plan) {
    const state = pomodoroState(plan, elapsedSeconds(block));
    const ratio = (state.phaseLength - state.left) / state.phaseLength;
    return `<span class="lab-indent"></span><span class="lab-ascii ${state.phase}" data-ascii>${asciiBar(ratio)}</span><span class="lab-pct" data-pct>${Math.floor(ratio * 100)}%</span><span class="lab-phase ${state.phase}" data-phase="${state.phase}">${state.phase === 'rest' ? 'rest()' : 'focus()'}</span><span class="lab-left" data-left>${clock(state.left)}</span><span class="lab-round">round ${state.round}/${plan.rounds}</span>`;
  }
  const seconds = elapsedSeconds(block);
  return `<span class="lab-indent"></span><span class="lab-ascii loop" data-loop>${loopBar(seconds)}</span><span class="lab-iter">i = <b data-iter>${Math.floor(seconds / 60)}</b></span><span class="lab-left" data-elapsed>${hms(elapsedSeconds(block))}</span>`;
}

// 도는 블록 오른쪽 타이머: 남은 분만큼 은은한 부채꼴, 가장자리만 진한 선, 가운데 큰 숫자(Time Timer를 참고).
// 뽀모도로는 0 쪽으로 줄어들고, 끝을 정하지 않은 while은 흐른 분만큼 늘어난다(60분마다 다시).
const C = 64; const R = 52; // 128×128 안의 중심과 반지름
const polar = (radius, minutes) => { const angle = minutes / 60 * 2 * Math.PI; return [C + radius * Math.sin(angle), C - radius * Math.cos(angle)]; };

function arcPaths(minutes) {
  const m = Math.max(0, Math.min(60, minutes));
  if (m <= 0) return { wedge: '', edge: '' };
  if (m >= 59.99) return { wedge: `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - .01} ${C - R} Z`, edge: `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - .01} ${C - R}` };
  const [x, y] = polar(R, m); const end = `${x.toFixed(2)} ${y.toFixed(2)}`; const large = m > 30 ? 1 : 0;
  return { wedge: `M ${C} ${C} L ${C} ${C - R} A ${R} ${R} 0 ${large} 1 ${end} Z`, edge: `M ${C} ${C - R} A ${R} ${R} 0 ${large} 1 ${end}` };
}

function dialState(block) {
  const dial = dialStateRaw(block);
  return block.pausedAt ? { ...dial, label: 'paused', phaseText: `일시정지 · ${dial.phaseText}` } : dial;
}

function dialStateRaw(block) {
  const until = untilState(block);
  // 시각까지: 시작할 때 가득 찼다가 그 시각에 0이 된다(남은 비율만큼 부채꼴).
  if (until) return { minutes: (1 - until.progress) * 60, time: hms(until.left), label: `until ${hhmm(block.untilAt)}`, phaseText: `${hhmm(block.untilAt)}까지 · ${minutesLabel(Math.ceil(until.left / 60))} 남음`, tone: 'until' };
  const plan = parsePomodoro(block.cond); const seconds = elapsedSeconds(block);
  if (plan) {
    const state = pomodoroState(plan, seconds);
    return { minutes: state.left / 60, time: clock(state.left), label: state.phase === 'rest' ? 'rest' : 'focus', phaseText: `${state.phase === 'rest' ? '휴식' : '집중'} · round ${state.round}/${plan.rounds}`, tone: state.phase === 'rest' ? 'rest' : 'focus' };
  }
  return { minutes: (seconds / 60) % 60, time: hms(elapsedSeconds(block)), label: 'loop', phaseText: `반복 i = ${Math.floor(seconds / 60)}`, tone: 'loop' };
}

function dialHtml(block) {
  const dial = dialState(block); const paths = arcPaths(dial.minutes);
  return `<div class="lab-dial ${dial.tone}" aria-hidden="true"><svg viewBox="0 0 128 128">
    <circle class="lab-dial-track" cx="${C}" cy="${C}" r="${R}"/>
    <path class="lab-dial-wedge" data-dial-wedge d="${paths.wedge}"/>
    <path class="lab-dial-edge" data-dial-edge d="${paths.edge}"/>
    <text class="lab-dial-time" x="${C}" y="${C + 7}" data-dial-time>${dial.time}</text>
    <text class="lab-dial-label" x="${C}" y="${C + 24}" data-dial-label>${dial.label}</text>
  </svg></div>`;
}

// IDE 왼쪽 여백(거터) 표시: 도는 while은 노란 실행 화살표, if는 빨간 중단점, 오늘 실행한 블록은 초록 체크
function gutterMark(block, today) {
  if (block.runningSince) return '<span class="lab-mark run" title="실행 중">▶</span>';
  if (runsOn(block, today).length) return '<span class="lab-mark ok" title="오늘 실행함">✓</span>';
  return block.kind === 'if' ? '<span class="lab-mark bp" title="조건">●</span>' : '';
}

// 할 일 줄: 공부 기록 루틴·목표 할 일에 이었으면 routine.이름() / goal.목표.이름() 처럼 보인다.
function bodyHtml(block, today) {
  if (!block.link) return `${field(block, 'body', block.kind === 'while' ? '영단어 외우기' : '응용수리 10문제')}<button type="button" class="lab-link-btn" data-lab="link" data-id="${esc(block.id)}" aria-haspopup="menu" title="공부 기록 루틴이나 목표 할 일에 잇기">↗ 연결</button>`;
  const call = linkCall(data, block.link); const target = linkTarget(data, block.link);
  if (!call) return `<button type="button" class="lab-call broken" data-lab="link" data-id="${esc(block.id)}" aria-haspopup="menu" title="연결을 바꾸거나 끊기"><span class="lab-ns">?</span>.<span class="lab-fn">연결이_끊김</span><span class="lab-punct">()</span></button><span class="lab-comment lab-link-note"># 연결한 루틴·할 일을 지웠어요</span>`;
  const where = target.kind === 'routine' ? `공부 기록${target.routine.bookId ? ` · ${esc(data.studyBooks.find(book => book.id === target.routine.bookId)?.name || '')}` : ''}` : `목표 보드 · ${esc(target.goal.title || '목표')}`;
  const done = linkDone(data, block.link, today);
  // 이름을 누르면 연결 메뉴(바꾸기·끊기). 끝냈으면 이름이 청록으로 바뀌고 주석 끝에 '완료'가 붙는다.
  return `<button type="button" class="lab-call${done ? ' done' : ''}" data-lab="link" data-id="${esc(block.id)}" aria-haspopup="menu" title="${target.kind === 'routine' ? '공부 기록 루틴' : '목표 보드 할 일'}에 이어져 있어요 · 눌러서 바꾸거나 끊기"><span class="lab-ns">${esc(call.ns)}</span>.<span class="lab-fn">${esc(call.name)}</span><span class="lab-punct">()</span></button><span class="lab-comment lab-link-note"># ↔ ${where}${done ? ' · 완료' : ''}</span>`;
}

// 연결 메뉴: 공부 기록 루틴(오늘 할 것 먼저) · 진행 중 목표의 남은 할 일
function linkMenuHtml(block) {
  const { routines, tasks } = linkChoices(data, todayKey());
  const item = choice => `<button type="button" role="menuitem" class="lab-link-item" data-lab="pick-link" data-id="${esc(block.id)}" data-link='${esc(JSON.stringify(choice.link))}'><span>${esc(choice.title || '이름 없음')}</span><small>${esc(choice.meta || '')}</small></button>`;
  const group = (title, list, empty) => `<div class="lab-link-group"><div class="lab-link-title">${title}</div>${list.length ? list.map(item).join('') : `<div class="lab-link-empty">${empty}</div>`}</div>`;
  const unlink = block.link ? `<div class="lab-link-group lab-link-foot"><button type="button" role="menuitem" class="lab-link-item danger" data-lab="unlink" data-id="${esc(block.id)}"><span>연결 끊기</span><small>할 일을 다시 직접 적어요</small></button></div>` : '';
  return `<div class="lab-link-menu" role="menu" aria-label="연결할 루틴·할 일">${group('공부 기록 · 루틴', routines, '공부 기록 탭에 루틴이 없어요')}${group('목표 보드 · 진행 중 할 일', tasks, '진행 중 목표에 남은 할 일이 없어요')}${unlink}</div>`;
}

// 메뉴가 화면 밖으로 잘리지 않게: 아래 공간이 모자라고 위가 더 넓으면 위로 열고, 높이를 남은 공간에 맞춘다.
function placeLinkMenu(menu) {
  if (!menu) return;
  const line = menu.parentElement.getBoundingClientRect(); const margin = 12;
  const below = window.innerHeight - line.bottom - margin; const above = line.top - margin;
  const up = below < Math.min(menu.scrollHeight, 320) && above > below;
  menu.classList.toggle('up', up);
  menu.style.setProperty('--menu-room', `${Math.max(140, Math.min(360, up ? above : below))}px`);
}

const closeLinkMenu = () => main.querySelectorAll('.lab-link-menu').forEach(menu => { menu.parentElement.classList.remove('menu-open'); menu.remove(); });
let keyboardUsed = false; // 마우스로 연 메뉴에는 초점 테두리를 띄우지 않는다
document.addEventListener('keydown', () => { keyboardUsed = true; }, true);
document.addEventListener('pointerdown', () => { keyboardUsed = false; }, true);

// 블록 한 개(파이썬처럼 `while 조건:` 다음 줄을 들여 쓴다). 줄 번호가 이어지도록 몇 줄을 썼는지도 돌려준다.
function blockHtml(block, startLine, today) {
  const running = Boolean(block.runningSince); const plan = block.kind === 'while' ? parsePomodoro(block.cond) : null;
  const comment = running ? '' : commentFor(block, today);
  const paused = Boolean(block.pausedAt);
  const control = block.kind === 'while'
    ? running ? `<button type="button" class="lab-run lab-pause" data-lab="${paused ? 'resume' : 'pause'}" data-id="${esc(block.id)}">${paused ? icon('play', 'resume') : icon('pause', 'pause')}</button><button type="button" class="lab-run lab-break" data-lab="break" data-id="${esc(block.id)}">${icon('stop', 'break')}</button>`
      : `<button type="button" class="lab-run" data-lab="start" data-id="${esc(block.id)}">${icon('play', 'run')}</button>`
    : `<button type="button" class="lab-run" data-lab="run-if" data-id="${esc(block.id)}">${icon('play', 'run')}</button>`;
  let number = startLine;
  const first = number;
  const line = (content, extra = '') => `<div class="lab-line${extra}"><span class="lab-gutter" aria-hidden="true">${number === first ? gutterMark(block, today) : ''}</span><span class="lab-no" aria-hidden="true">${number++}</span><div class="lab-code">${content}</div></div>`;
  const placeholder = block.kind === 'while' ? '지하철 타는 동안' : '밥 먹고 나면';
  const html = [`<section class="lab-block${running ? ' running' : ''}${block.pausedAt ? ' paused' : ''}${plan ? ' pomodoro' : ''}${block.id === freshId ? ' fresh' : ''}" data-kind="${block.kind}" data-id="${esc(block.id)}" aria-label="${block.kind} 블록"><div class="lab-block-lines">`,
    line(`<span class="lab-kw">${block.kind}</span><span class="lab-punct">&nbsp;</span>${field(block, 'cond', placeholder)}<span class="lab-punct">:</span>${condHint(block)}<span class="lab-controls"><button type="button" class="lab-remove lab-done-btn" data-lab="done" data-id="${esc(block.id)}" title="다 했어요: 블록을 치우고 기록만 남겨요">${icon('check', 'done')}</button><button type="button" class="lab-remove" data-lab="remove" data-id="${esc(block.id)}" aria-label="블록 지우기" title="지우기">${icon('x', 'del')}</button>${control}</span>`),
    line(`<span class="lab-indent"></span>${bodyHtml(block, today)}`, ' lab-body-line'),
    running ? line(progressHtml(block), ' lab-progress') : '',
    comment ? line(`<span class="lab-indent"></span><span class="lab-comment">${esc(comment)}</span>`) : '',
    '</div>',
    '</section>'].join('');
  return { html, lines: number - startLine };
}

// ---------- 지금 집중할 것: 편집기 맨 위에 타이머 하나 ----------
// 여러 개가 돌면 작은 탭으로 고른다. 고른 게 없거나 멈췄으면 가장 먼저 시작한 것을 보여 준다.
let nowId = '';
function nowBlock() {
  const running = liveBlocks(data).filter(block => block.runningSince).sort((a, b) => a.runningSince.localeCompare(b.runningSince));
  return running.find(block => block.id === nowId) || running[0] || null;
}

// 아무것도 안 돌 때도 패널은 같은 자리에 둔다(생겼다 사라지며 아래 코드가 튀지 않게): 빈 시계 + 오늘 마지막 실행
function idleHtml() {
  const today = todayKey();
  const last = data.labBlocks.flatMap(block => runsOn(block, today).filter(run => block.kind === 'while').map(run => ({ block, run }))).sort((a, b) => (a.run.endedAt || a.run.at).localeCompare(b.run.endedAt || b.run.at)).at(-1);
  const summary = last ? `<span class="lab-comment"># 마지막: while ${esc(last.block.cond || '…')} · ${minutesLabel(last.run.minutes || 0)}${last.run.rounds ? ` · ${last.run.rounds}라운드` : ''} · ${hhmm(last.run.endedAt || last.run.at)}</span>` : '<span class="lab-comment"># 오늘은 아직 돌린 while이 없어요</span>';
  return `<section class="lab-now idle" aria-label="실행 대기">
    <div class="lab-dial idle" aria-hidden="true"><svg viewBox="0 0 128 128"><circle class="lab-dial-track" cx="${C}" cy="${C}" r="${R}"/><text class="lab-dial-time" x="${C}" y="${C + 7}">--:--</text><text class="lab-dial-label" x="${C}" y="${C + 24}">idle</text></svg></div>
    <div class="lab-now-info">
      <div class="lab-now-code"><span class="lab-punct">$</span> <span class="lab-now-body">대기 중</span></div>
      <div class="lab-now-state"><span class="lab-now-detail">while 블록의 ▶ run을 누르면 여기서 시간이 흘러요. 괄호에 숫자를 넣으면 뽀모도로예요.</span></div>
      <div class="lab-now-last">${summary}</div>
    </div>
  </section>`;
}

function nowHtml() {
  const block = nowBlock(); if (!block) return idleHtml();
  const running = liveBlocks(data).filter(item => item.runningSince).sort((a, b) => a.runningSince.localeCompare(b.runningSince));
  const dial = dialState(block); const plan = parsePomodoro(block.cond);
  const tabs = running.length > 1 ? `<div class="lab-now-tabs" role="tablist" aria-label="실행 중인 while">${running.map(item => `<button type="button" role="tab" class="lab-now-tab${item === block ? ' active' : ''}" aria-selected="${item === block}" data-lab="show-now" data-id="${esc(item.id)}"><span class="lab-kw">while</span> ${esc(item.cond || '…')}:</button>`).join('')}</div>` : '';
  const detail = block.untilAt ? `총 ${minutesLabel(Math.round((new Date(block.untilAt) - new Date(block.runningSince)) / 60_000))} · pause해도 끝나는 시각은 그대로` : plan ? `${plan.focus}분 집중 × ${plan.rounds}${plan.rounds > 1 ? ` · 휴식 ${plan.rest}분` : ''}` : 'break할 때까지 도는 중';
  return `<section class="lab-now ${dial.tone}${block.pausedAt ? ' paused' : ''}" data-now="${esc(block.id)}" aria-label="지금 실행 중">
    ${dialHtml(block)}
    <div class="lab-now-info">
      ${tabs}
      <div class="lab-now-code"><span class="lab-kw">while</span> <span class="lab-cond${plan || block.untilAt ? ' lab-num' : ''}">${esc(block.cond || '…')}</span><span class="lab-punct">:</span> <span class="lab-now-body">${esc(bodyLabel(block))}</span></div>
      <div class="lab-now-state"><span class="lab-now-phase" data-now-phase>${dial.phaseText}</span><span class="lab-now-detail">${detail}</span></div>
      <div class="lab-now-actions"><button type="button" class="lab-run lab-pause" data-lab="${block.pausedAt ? 'resume' : 'pause'}" data-id="${esc(block.id)}">${block.pausedAt ? icon('play', 'resume') : icon('pause', 'pause')}</button><button type="button" class="lab-run lab-break" data-lab="break" data-id="${esc(block.id)}">${icon('stop', 'break')}</button><span class="lab-now-since">${hhmm(block.runningSince)}부터</span></div>
    </div>
  </section>`;
}

// 탭 아래 경로 줄: 지금 도는 블록이 있으면 그 블록까지
function crumbsHtml() {
  const running = nowBlock();
  return `<span>jiwon-ilji</span><span class="lab-sep">›</span><span>lab</span><span class="lab-sep">›</span><span>lab.py</span>${running ? `<span class="lab-sep">›</span><span class="lab-crumb-now"><span class="lab-kw">while</span> ${esc(running.cond || '…')}:</span>` : ''}`;
}

// 상태 막대: 실행 표시만 강조하고 시간·오늘 실행 수는 작은 요약으로 둔다.
function statusHtml(today) {
  const running = liveBlocks(data).filter(block => block.runningSince);
  const ran = data.labBlocks.reduce((sum, block) => sum + runsOn(block, today).length, 0);
  const first = running[0]; const plan = first && parsePomodoro(first.cond);
  const state = plan && pomodoroState(plan, elapsedSeconds(first));
  const until = first && untilState(first);
  const now = !first ? '' : until ? `until ${hhmm(first.untilAt)} · ${hms(until.left)}` : state ? `pomo ${state.round}/${plan.rounds} · ${state.phase === 'rest' ? 'break' : 'focus'} ${clock(state.left)}` : `loop ${hms(elapsedSeconds(first))}`;
  return `<span>⎇ main</span><span class="lab-status-state">${running.length ? `● ${running.length} running` : '○ idle'}</span>${now ? `<span class="lab-status-now">${now}</span>` : ''}<span class="lab-status-right">오늘 실행 ${ran} · UTF-8 · Python 3.12</span>`;
}

// OUTPUT: 오늘 실행한 것을 시간순으로(터미널 출력처럼)
function outputHtml(today) {
  const events = [];
  for (const block of data.labBlocks) {
    const cond = esc(block.cond || '…');
    if (block.doneAt && runsOn({ runs: [{ at: block.doneAt }] }, today).length) events.push({ at: block.doneAt, block, html: `<span class="lab-kw">${block.kind}</span> ${cond}: done <span class="lab-ok">✓</span> <span class="lab-out-dim">블록을 치웠어요</span>` });
    for (const run of runsOn(block, today)) {
      if (block.kind === 'if') events.push({ at: run.at, block, html: `<span class="lab-kw">if</span> ${cond}: ${esc(bodyLabel(block))} <span class="lab-ok">✓</span>` });
      else {
        // 끝난 시각에 찍는다(예전 기록처럼 끝난 시각이 없으면 시작 시각)
        const at = run.endedAt || run.at;
        events.push({ at, block, html: `<span class="lab-kw">while</span> ${cond}: exited · ${minutesLabel(run.minutes || 0)}${run.rounds ? ` · ${run.rounds} round${run.rounds > 1 ? 's' : ''}` : ''}` });
        if (run.completed) events.push({ at, block, html: '<span class="lab-ok">Process finished with exit code 0</span>' });
      }
    }
    if (block.runningSince && runsOn({ runs: [{ at: block.runningSince }] }, today).length) events.push({ at: block.runningSince, block, html: `<span class="lab-kw">while</span> ${cond}: running<span class="lab-ellipsis">…</span>`, running: true });
  }
  events.sort((a, b) => a.at.localeCompare(b.at));
  const freshAt = events.filter(event => event.block.id === freshId).at(-1);
  const lines = events.map(event => `<div class="lab-out${event.running ? ' running' : ''}${event === freshAt ? ' fresh' : ''}"><span class="lab-out-time">[${hhmm(event.at)}]</span><span>${event.html}</span></div>`).join('');
  return `<div class="lab-output" aria-label="오늘 실행 기록">
    <div class="lab-output-head"><span>OUTPUT</span><span>${today.slice(5).replace('-', '.')} · 오늘</span></div>
    <div class="lab-output-body">${lines || '<div class="lab-out muted"><span class="lab-out-time">$</span><span>▶ run을 누르면 여기에 찍혀요</span></div>'}<div class="lab-out"><span class="lab-out-time">$</span><span class="lab-cursor" aria-hidden="true"></span></div></div>
  </div>`;
}

export function renderLab() {
  const today = todayKey();
  let lineNumber = 1;
  // 블록 사이에만 빈 줄을 둔다(첫 블록은 1번 줄부터).
  const blocks = liveBlocks(data).map((block, index) => {
    const gap = index ? `<div class="lab-line lab-gap"><span class="lab-gutter"></span><span class="lab-no" aria-hidden="true">${lineNumber++}</span></div>` : '';
    const { html, lines } = blockHtml(block, lineNumber, today);
    lineNumber += lines; return gap + html;
  }).join('');
  const runningCount = liveBlocks(data).filter(block => block.runningSince).length;
  main.className = 'database-page lab-page';
  main.innerHTML = `<header class="page-header"><h1 class="page-title">집중 루프</h1></header>
    <div class="lab-editor">
      <div class="lab-tabbar"><span class="lab-file"><span class="lab-file-dot" aria-hidden="true"></span>lab.py</span><span class="lab-running-count">${runningCount ? `<span class="lab-running-dot" aria-hidden="true"></span>${runningCount}개 실행 중` : ''}</span></div>
      <div class="lab-crumbs" data-crumbs>${crumbsHtml()}</div>
      <div data-now-slot>${nowHtml()}</div>
      <div class="lab-source">
        ${blocks}
        <div class="lab-line lab-gap"><span class="lab-gutter"></span><span class="lab-no" aria-hidden="true">${lineNumber++}</span></div>
        <div class="lab-line lab-add"><span class="lab-gutter"></span><span class="lab-no" aria-hidden="true">${lineNumber}</span><div class="lab-code"><button type="button" class="lab-new" data-lab="add" data-kind="while" title="시간을 재거나 집중 타이머로 공부하기">+ while</button><button type="button" class="lab-new" data-lab="add" data-kind="if" title="조건에 맞춰 공부한 일을 기록하기">+ if</button></div></div>
      </div>
      ${outputHtml(today)}
      <div class="lab-statusbar${runningCount ? ' running' : ''}" data-status>${statusHtml(today)}</div>
    </div>`;
  freshId = '';
  main.querySelectorAll('.lab-source input[data-field]').forEach(input => {
    input.addEventListener('input', () => {
      const block = blockById(input.dataset.id); if (!block) return;
      if (input.dataset.field === 'cond' && block.runningSince) {
        input.value = block.cond;
        input.parentElement.dataset.value = block.cond || input.placeholder;
        return;
      }
      block[input.dataset.field] = input.value; block.updatedAt = new Date().toISOString();
      input.parentElement.dataset.value = input.value || input.placeholder;
      // 괄호에 숫자를 적는 순간 뽀모도로 힌트가 붙는다(다시 그리지 않고 힌트만 바꾼다).
      if (input.dataset.field === 'cond' && block.kind === 'while' && !block.runningSince) {
        const code = input.closest('.lab-code'); code.querySelector('.lab-hint')?.remove();
        const plan = parsePomodoro(block.cond); const hint = condHint(block);
        if (hint) code.querySelectorAll('.lab-punct')[1]?.insertAdjacentHTML('afterend', hint);
        input.closest('.lab-block').classList.toggle('pomodoro', Boolean(plan));
        input.parentElement.classList.toggle('lab-num', Boolean(plan || parseUntil(block.cond)));
      }
      scheduleSave();
    });
    // Enter: 조건 → 할 일 칸으로, 할 일 칸에서는 입력을 마친다.
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      if (input.dataset.field === 'cond') main.querySelector(`input[data-field="body"][data-id="${CSS.escape(input.dataset.id)}"]`)?.focus();
      else input.blur();
    });
  });
  startTicking();
}

const keepScroll = paint => { const top = window.scrollY; paint(); window.scrollTo({ top, behavior: 'instant' }); };

main.addEventListener('click', event => {
  if (view !== 'lab') return;
  if (!event.target.closest('.lab-link-menu, [data-lab="link"]')) closeLinkMenu();
  const button = event.target.closest('[data-lab]'); if (!button) return;
  const block = blockById(button.dataset.id); const action = button.dataset.lab;
  if (action === 'add') {
    const created = newLabBlock(button.dataset.kind); data.labBlocks.push(created); persist(); keepScroll(renderLab);
    main.querySelector(`input[data-field="cond"][data-id="${CSS.escape(created.id)}"]`)?.focus();
    return;
  }
  if (!block) return;
  if (action === 'show-now') { nowId = block.id; keepScroll(renderLab); return; }
  if (action === 'pause') { pauseLoop(block); persist(); keepScroll(renderLab); showToast('일시정지 · 멈춘 동안은 시간이 흐르지 않아요'); return; }
  if (action === 'resume') { resumeLoop(block); persist(); keepScroll(renderLab); return; }
  if (action === 'done') {
    // 다 했어요: 블록을 치우고 기록만 남긴다. 연결한 루틴·할 일이 남아 있으면 같이 체크할지 알림에서 고른다.
    const run = finishBlock(block); persist(); keepScroll(renderLab);
    const target = linkTarget(data, block.link); const date = run?.date || todayKey();
    const check = target && !linkDone(data, block.link, date) ? [{ label: target.kind === 'routine' ? '공부 기록에 체크' : '할 일 체크', run: () => { const undo = completeLink(data, block.link, date); persist(); keepScroll(renderLab); if (undo) showToast(target.kind === 'routine' ? '공부 기록에도 체크했어요' : '목표 할 일을 체크했어요', { label: '되돌리기', run: () => { undo(); persist(); keepScroll(renderLab); } }); } }] : [];
    showToast(`${block.kind} ${block.cond || '…'}: done · 기록은 OUTPUT에 남겨요`, [...check, { label: '되돌리기', run: () => { block.doneAt = ''; if (run) { block.runs = block.runs.filter(item => item !== run); block.runningSince = run.at; } persist(); keepScroll(renderLab); } }]);
    return;
  }
  if (action === 'link') {
    const code = button.closest('.lab-code'); const open = code.querySelector('.lab-link-menu'); closeLinkMenu(); if (open) return;
    code.insertAdjacentHTML('beforeend', linkMenuHtml(block)); code.classList.add('menu-open');
    placeLinkMenu(code.querySelector('.lab-link-menu'));
    code.querySelector('.lab-link-item')?.focus({ preventScroll: true, focusVisible: keyboardUsed });
    return;
  }
  if (action === 'pick-link') { block.link = JSON.parse(button.dataset.link); block.updatedAt = new Date().toISOString(); persist(); keepScroll(renderLab); return; }
  if (action === 'unlink') {
    const before = block.link; block.link = null; persist(); keepScroll(renderLab);
    showToast('연결을 끊었어요', { label: '되돌리기', run: () => { block.link = before; persist(); keepScroll(renderLab); } });
    return;
  }
  if (action === 'start') {
    const until = parseUntil(block.cond); const target = until && untilDate(until);
    if (until && !target) { showToast(`${until.label}은 이미 지난 시각이에요. 조건의 시각을 바꿔 주세요.`); return; }
    startLoop(block); if (target) block.untilAt = target.toISOString();
    freshId = block.id; nowId = block.id; persist(); keepScroll(renderLab);
    if (target) { showToast(`${hhmm(block.untilAt)}까지 · ${minutesLabel(Math.ceil((target - Date.now()) / 60_000))} 동안 돌아요`); return; }
    const plan = parsePomodoro(block.cond);
    showToast(plan ? `${plan.focus}분 집중 시작${plan.rounds > 1 ? ` · 1/${plan.rounds}라운드` : ''}` : `while ${block.cond || '…'}: 도는 중 · 끝나면 break`);
  } else if (action === 'break') {
    const run = breakLoop(block); freshId = block.id; persist(); keepScroll(renderLab);
    if (!run) return;
    const undoRun = { label: '되돌리기', run: () => { block.runs = block.runs.filter(item => item !== run); block.runningSince = run.at; persist(); keepScroll(renderLab); } };
    // 중간에 멈췄을 때는 연결된 루틴·할 일을 바로 체크하지 않고, 했다고 판단하면 누르게 한다.
    const target = linkTarget(data, block.link);
    const check = target && !linkDone(data, block.link, run.date) ? [{ label: target.kind === 'routine' ? '공부 기록에 체크' : '할 일 체크', run: () => { const undo = completeLink(data, block.link, run.date); persist(); keepScroll(renderLab); if (undo) showToast(target.kind === 'routine' ? '공부 기록에도 체크했어요' : '목표 할 일을 체크했어요', { label: '되돌리기', run: () => { undo(); persist(); keepScroll(renderLab); } }); } }] : [];
    showToast(`루프 탈출 · ${minutesLabel(run.minutes)}${run.rounds ? ` · ${run.rounds}라운드` : ''}`, [...check, undoRun]);
  } else if (action === 'run-if') {
    const run = runIf(block); const undoLink = completeLink(data, block.link, run.date); freshId = block.id; persist(); keepScroll(renderLab);
    const linked = undoLink ? (linkTarget(data, block.link).kind === 'routine' ? ' · 공부 기록에도 체크' : ' · 목표 할 일 체크') : '';
    showToast(`if ${block.cond || '…'}: ${bodyLabel(block)} ✓${linked}`, { label: '되돌리기', run: () => { block.runs = block.runs.filter(item => item !== run); undoLink?.(); persist(); keepScroll(renderLab); } });
  } else if (action === 'remove') {
    const index = data.labBlocks.indexOf(block);
    data.labBlocks.splice(index, 1); persist(); keepScroll(renderLab);
    showToast(`${block.kind} 블록을 지웠어요`, { label: '되돌리기', run: () => { data.labBlocks.splice(index, 0, block); persist(); keepScroll(renderLab); } });
  }
});

main.addEventListener('keydown', event => {
  if (view === 'lab' && event.key === 'Escape' && main.querySelector('.lab-link-menu')) { event.preventDefault(); const trigger = main.querySelector('.lab-link-menu').parentElement.querySelector('[data-lab="link"]'); closeLinkMenu(); trigger?.focus(); }
});

// ---------- 1초마다: 남은 시간·막대·반복 횟수를 고치고, 집중↔휴식이 바뀌면 알린다 ----------
let timer = 0;
const baseTitle = document.title;
const lastPhase = new Map(); // 블록별로 마지막에 본 '라운드:집중/휴식'

function chime(times = 2) {
  try {
    const audio = new (window.AudioContext || window.webkitAudioContext)();
    for (let index = 0; index < times; index++) {
      const tone = audio.createOscillator(); const gain = audio.createGain();
      tone.frequency.value = index % 2 ? 1046 : 784; tone.connect(gain); gain.connect(audio.destination);
      const at = audio.currentTime + index * .18;
      gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(.12, at + .02); gain.gain.exponentialRampToValueAtTime(.0001, at + .16);
      tone.start(at); tone.stop(at + .17);
    }
    setTimeout(() => audio.close(), 1000);
  } catch { /* 소리를 못 내도 알림 글은 뜬다 */ }
}

function tick() {
  const running = liveBlocks(data).filter(block => block.runningSince);
  if (!running.length) { document.title = baseTitle; clearInterval(timer); timer = 0; return; }
  let title = '';
  for (const block of running) {
    const plan = parsePomodoro(block.cond);
    const element = view === 'lab' ? main.querySelector(`.lab-block[data-id="${CSS.escape(block.id)}"]`) : null;
    const until = untilState(block);
    if (until) {
      if (until.done) {
        const finished = finishUntil(block); const undoLink = finished && completeLink(data, block.link, finished.date); freshId = block.id; persist(); chime(3);
        const linked = undoLink ? (linkTarget(data, block.link).kind === 'routine' ? ' · 공부 기록에도 체크했어요' : ' · 목표 할 일을 체크했어요') : '';
        showToast(`${finished.until} 됐어요 · ${minutesLabel(finished.minutes)} 했어요${linked}`, undoLink ? { label: '체크 되돌리기', run: () => { undoLink(); persist(); if (view === 'lab') keepScroll(renderLab); } } : null);
        if (view === 'lab') keepScroll(renderLab);
        continue;
      }
      if (element) {
        element.querySelector('[data-ascii]').innerHTML = asciiBar(until.progress);
        element.querySelector('[data-pct]').textContent = `${Math.floor(until.progress * 100)}%`;
        element.querySelector('[data-left]').textContent = hms(until.left);
      }
      title ||= `${block.pausedAt ? '❚❚ ' : ''}${hms(until.left)} · ${hhmm(block.untilAt)}까지`;
      continue;
    }
    if (plan) {
      const state = pomodoroState(plan, elapsedSeconds(block));
      if (state.done) {
        const finished = finishPomodoro(block, plan); const undoLink = finished && completeLink(data, block.link, finished.date); freshId = block.id; persist(); chime(3);
        const linked = undoLink ? (linkTarget(data, block.link).kind === 'routine' ? ' · 공부 기록에도 체크했어요' : ' · 목표 할 일을 체크했어요') : '';
        showToast(`${plan.rounds}라운드 완료 · ${minutesLabel(plan.rounds * plan.focus)} 집중했어요${linked}`, undoLink ? { label: '체크 되돌리기', run: () => { undoLink(); persist(); if (view === 'lab') keepScroll(renderLab); } } : null);
        if (view === 'lab') keepScroll(renderLab);
        continue;
      }
      // 집중↔휴식이 바뀌면 다른 탭에 있어도 소리와 알림으로 알린다(처음 본 순간은 알리지 않는다).
      const key = `${block.id}:${block.runningSince}`; const before = lastPhase.get(key); lastPhase.set(key, `${state.round}:${state.phase}`);
      if (before && before !== `${state.round}:${state.phase}`) {
        chime(2); showToast(state.phase === 'rest' ? `${state.round}라운드 끝 · ${plan.rest}분 쉬어요` : `${state.round}/${plan.rounds}라운드 집중 시작`);
        if (view === 'lab') { keepScroll(renderLab); return; }
      }
      if (element) {
        const ratio = (state.phaseLength - state.left) / state.phaseLength;
        element.querySelector('[data-ascii]').innerHTML = asciiBar(ratio);
        element.querySelector('[data-left]').textContent = clock(state.left);
        element.querySelector('[data-pct]').textContent = `${Math.floor(ratio * 100)}%`;
      }
      title ||= `${block.pausedAt ? '❚❚ ' : ''}${clock(state.left)} ${block.pausedAt ? '일시정지' : state.phase === 'rest' ? '휴식' : '집중'}`;
    } else {
      if (element) {
        element.querySelector('[data-iter]').textContent = Math.floor(elapsedSeconds(block) / 60);
        element.querySelector('[data-loop]').innerHTML = loopBar(elapsedSeconds(block));
        element.querySelector('[data-elapsed]').textContent = hms(elapsedSeconds(block));
      }
      title ||= `${block.pausedAt ? '❚❚' : '↻'} ${hms(elapsedSeconds(block))}`;
    }
  }
  if (view === 'lab') {
    const panel = main.querySelector('[data-now]'); const block = nowBlock();
    if (panel && block && panel.dataset.now === block.id) {
      const dial = dialState(block); const paths = arcPaths(dial.minutes);
      panel.querySelector('[data-dial-wedge]').setAttribute('d', paths.wedge); panel.querySelector('[data-dial-edge]').setAttribute('d', paths.edge);
      panel.querySelector('[data-dial-time]').textContent = dial.time; panel.querySelector('[data-dial-label]').textContent = dial.label;
      panel.querySelector('[data-now-phase]').textContent = dial.phaseText;
    }
  }
  if (view === 'lab') { const status = main.querySelector('[data-status]'); if (status) { status.innerHTML = statusHtml(todayKey()); status.classList.toggle('running', running.length > 0); } }
  // 다른 탭에 있어도 창 제목에서 남은 시간을 본다.
  document.title = title ? `${title} · ${baseTitle}` : baseTitle;
}

export function startTicking() {
  clearInterval(timer); timer = 0;
  if (!data.labBlocks?.some(block => block.runningSince)) { document.title = baseTitle; return; }
  tick(); timer = setInterval(tick, 1000);
}
