// 집중 루프: 할 일을 파이썬의 while·if처럼 적는다. 화면 전체가 lab.py 파일 하나처럼 줄 번호가 이어지고,
// while 조건에 숫자를 넣으면 뽀모도로로 돈다. 아래 OUTPUT에는 오늘 실행한 기록이 터미널처럼 쌓인다.
import { main } from './dom.js';
import { data, view } from './state.js';
import { persist, scheduleSave } from './store.js';
import { showToast } from './ui.js';
import { escapeHtml as esc, nativeHost, todayKey } from './util.js';
import { activeSeconds, asIdentifier, breakLoop, clock, completeBlockLinks, finishUntil, parseUntil, pendingLinks, untilDate, untilState, finishBlock, liveBlocks, pauseLoop, resumeLoop, elapsedLabel, finishPomodoro, linkCall, linkChoices, linkDone, linkTarget, minutesLabel, newLabBlock, parsePomodoro, pomodoroState, runIf, runsOn, runsThisWeek, startLoop } from './lab-model.js';

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
// 실행문 줄은 여러 개: 첫 줄은 body(연결도 이 줄), 그 아래 줄들은 extra[i]. '#'으로 시작하면 주석처럼 흐리게.
const field = (block, name, placeholder, index = -1) => {
  const locked = name === 'cond' && Boolean(block.runningSince);
  const number = name === 'cond' && block.kind === 'while' && (parsePomodoro(block.cond) || parseUntil(block.cond));
  const value = name === 'extra' ? block.extra[index] || '' : block[name] || '';
  const comment = name !== 'cond' && value.trim().startsWith('#');
  return `<span class="lab-autosize lab-${name === 'extra' ? 'body' : name}${number ? ' lab-num' : ''}${comment ? ' lab-commented' : ''}" data-value="${esc(value || placeholder)}"><input size="1" data-field="${name}"${name === 'extra' ? ` data-index="${index}"` : ''} data-id="${esc(block.id)}" value="${esc(value)}" placeholder="${placeholder}" spellcheck="false" autocomplete="off" aria-label="${block.kind} ${name === 'cond' ? '조건' : '할 일'}"${locked ? ' readonly title="실행 중인 조건이에요. break로 종료한 뒤 수정할 수 있어요."' : ''}></span>`;
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
  if (!block.link) return `${field(block, 'body', block.kind === 'while' ? '영단어 외우기' : '응용수리 10문제')}${linkButton(block, -1)}`;
  return callHtml(block, block.link, -1, today);
}

// 아래 줄(extra[i]): 글이면 입력칸, 연결이면 함수 이름
const extraHtml = (block, index, today) => {
  const line = block.extra[index];
  return line && typeof line === 'object' ? callHtml(block, line.link, index, today) : `${field(block, 'extra', '', index)}${linkButton(block, index)}`;
};
const indexAttr = index => index < 0 ? '' : ` data-index="${index}"`;
const linkButton = (block, index) => `<button type="button" class="lab-link-btn" data-lab="link" data-id="${esc(block.id)}"${indexAttr(index)} aria-haspopup="menu" title="공부 기록 루틴이나 목표 할 일에 잇기 · routine. 이나 goal. 을 쳐도 돼요">↗ 연결</button>`;

function callHtml(block, link, index, today) {
  const call = linkCall(data, link); const target = linkTarget(data, link);
  if (!call) return `<button type="button" class="lab-call broken" data-lab="link" data-id="${esc(block.id)}"${indexAttr(index)} aria-haspopup="menu" title="연결을 바꾸거나 끊기"><span class="lab-ns">?</span>.<span class="lab-fn">연결이_끊김</span><span class="lab-punct">()</span></button><span class="lab-comment lab-link-note"># 연결한 루틴·할 일을 지웠어요</span>`;
  const where = target.kind === 'routine' ? `공부 기록${target.routine.bookId ? ` · ${esc(data.studyBooks.find(book => book.id === target.routine.bookId)?.name || '')}` : ''}` : `목표 보드 · ${esc(target.goal.title || '목표')}`;
  const done = linkDone(data, link, today);
  // 이름을 누르면 연결 메뉴(바꾸기·끊기). 끝냈으면 이름이 청록으로 바뀌고 주석 끝에 '완료'가 붙는다.
  return `<button type="button" class="lab-call${done ? ' done' : ''}" data-lab="link" data-id="${esc(block.id)}"${indexAttr(index)} aria-haspopup="menu" title="${target.kind === 'routine' ? '공부 기록 루틴' : '목표 보드 할 일'}에 이어져 있어요 · 눌러서 바꾸거나 끊기"><span class="lab-ns">${esc(call.ns)}</span>.<span class="lab-fn">${esc(call.name)}</span><span class="lab-punct">()</span></button><span class="lab-comment lab-link-note"># ↔ ${where}${done ? ' · 완료' : ''}</span>`;
}

// 연결 메뉴: 공부 기록 루틴(오늘 할 것 먼저) · 진행 중 목표의 남은 할 일
function linkMenuHtml(block, index = -1) {
  const { routines, tasks } = linkChoices(data, todayKey());
  const item = choice => `<button type="button" role="menuitem" class="lab-link-item" data-lab="pick-link" data-id="${esc(block.id)}"${indexAttr(index)} data-link='${esc(JSON.stringify(choice.link))}'><span>${esc(choice.title || '이름 없음')}</span><small>${esc(choice.meta || '')}</small></button>`;
  const group = (title, list, empty) => `<div class="lab-link-group"><div class="lab-link-title">${title}</div>${list.length ? list.map(item).join('') : `<div class="lab-link-empty">${empty}</div>`}</div>`;
  const linked = index < 0 ? block.link : typeof block.extra[index] === 'object' && block.extra[index]?.link;
  const unlink = linked ? `<div class="lab-link-group lab-link-foot"><button type="button" role="menuitem" class="lab-link-item danger" data-lab="unlink" data-id="${esc(block.id)}"${indexAttr(index)}><span>연결 끊기</span><small>할 일을 다시 직접 적어요</small></button></div>` : '';
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
    ...(block.extra || []).map((_, index) => line(`<span class="lab-indent"></span>${extraHtml(block, index, today)}`, ' lab-body-line lab-extra-line')),
    running ? line(progressHtml(block), ' lab-progress') : '',
    comment ? line(`<span class="lab-indent"></span><span class="lab-comment">${esc(comment)}</span>`) : '',
    '</div>',
    '</section>'].join('');
  return { html, lines: number - startLine };
}

// ---------- 지금 집중할 것: 편집기 맨 위에 타이머 하나 ----------
// 여러 개가 돌면 두 개까지 나란히 보여 준다(예: 18시까지 공부 + 그 안의 뽀모도로).
// 먼저 시작한 것이 왼쪽, 셋 이상이면 오른쪽 자리를 아래 칩으로 바꾼다.
let nowId = '';
const runningBlocks = () => liveBlocks(data).filter(block => block.runningSince).sort((a, b) => a.runningSince.localeCompare(b.runningSince));
function nowBlocks() {
  const running = runningBlocks();
  if (running.length <= 2) return running;
  const picked = running.find(block => block.id === nowId);
  return picked && picked !== running[0] ? [running[0], picked] : running.slice(0, 2);
}
const nowBlock = () => nowBlocks()[0] || null;

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
  const shown = nowBlocks(); if (!shown.length) return idleHtml();
  if (shown.length === 1) return nowPanelHtml(shown[0]);
  // 셋 이상이면 나머지는 오른쪽 칸 안의 칩으로(줄을 따로 만들면 패널 높이가 바뀌어 아래 코드가 튄다).
  const hidden = runningBlocks().filter(block => !shown.includes(block));
  const more = hidden.length ? `<div class="lab-now-more"><span class="lab-comment"># 함께 도는 중</span>${hidden.map(item => `<button type="button" class="lab-now-tab" data-lab="show-now" data-id="${esc(item.id)}" title="오른쪽에 보이기"><span class="lab-kw">while</span> ${esc(item.cond || '…')}:</button>`).join('')}</div>` : '';
  return `<div class="lab-now-pair">${nowPanelHtml(shown[0], true)}${nowPanelHtml(shown[1], true, more)}</div>`;
}

function nowPanelHtml(block, compact = false, extra = '') {
  const dial = dialState(block); const plan = parsePomodoro(block.cond);
  const detail = block.untilAt ? `총 ${minutesLabel(Math.round((new Date(block.untilAt) - new Date(block.runningSince)) / 60_000))}` : plan ? `${plan.focus}분 집중 × ${plan.rounds}${plan.rounds > 1 ? ` · 휴식 ${plan.rest}분` : ''}` : 'break할 때까지 도는 중';
  return `<section class="lab-now ${dial.tone}${block.pausedAt ? ' paused' : ''}${compact ? ' compact' : ''}" data-now="${esc(block.id)}" aria-label="실행 중: while ${esc(block.cond || '…')}">
    ${dialHtml(block)}
    <div class="lab-now-info">
      <div class="lab-now-code"><span class="lab-kw">while</span> <span class="lab-cond${plan || block.untilAt ? ' lab-num' : ''}">${esc(block.cond || '…')}</span><span class="lab-punct">:</span> <span class="lab-now-body">${esc(bodyLabel(block))}</span></div>
      <div class="lab-now-state"><span class="lab-now-phase" data-now-phase>${dial.phaseText}</span><span class="lab-now-detail">${detail}</span></div>
      <div class="lab-now-actions"><button type="button" class="lab-run lab-pause" data-lab="${block.pausedAt ? 'resume' : 'pause'}" data-id="${esc(block.id)}">${block.pausedAt ? icon('play', 'resume') : icon('pause', 'pause')}</button><button type="button" class="lab-run lab-break" data-lab="break" data-id="${esc(block.id)}">${icon('stop', 'break')}</button><span class="lab-now-since">${hhmm(block.runningSince)}부터</span></div>
      ${extra}
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
    <div class="lab-output-body">${lines || '<div class="lab-out muted"><span>▶ run을 누르면 여기에 찍혀요</span></div>'}</div>
  </div>`;
}

export function renderLab() {
  const today = todayKey();
  // 블록 사이에만 빈 줄을 둔다(첫 블록은 1번 줄부터).
  let lineNumber = 1;
  // 빈 줄은 모두 쓸 수 있는 줄: while · if 를 치면 그 자리에 새 블록이 생긴다(블록이 없으면 1번 줄부터).
  const blankLine = at => `<div class="lab-line lab-add"><span class="lab-gutter"></span><span class="lab-no" aria-hidden="true">${lineNumber++}</span><div class="lab-code"><span class="lab-autosize lab-new-line"><input data-field="new" data-at="${at}" spellcheck="false" autocomplete="off" aria-label="빈 줄: while 이나 if 를 치면 새 블록(wh 만 쳐도 자동 완성)"></span></div></div>`;
  const live = liveBlocks(data);
  const blocks = live.map((block, index) => {
    const gap = index ? blankLine(index) : '';
    const { html, lines } = blockHtml(block, lineNumber, today);
    lineNumber += lines; return gap + html;
  }).join('') + blankLine(live.length);
  const runningCount = liveBlocks(data).filter(block => block.runningSince).length;
  main.className = 'database-page lab-page';
  main.innerHTML = `<header class="page-header"><h1 class="page-title">집중 루프</h1></header>
    <div class="lab-editor">
      <div class="lab-tabbar"><span class="lab-file"><span class="lab-file-dot" aria-hidden="true"></span>lab.py</span><span class="lab-running-count">${runningCount ? `<span class="lab-running-dot" aria-hidden="true"></span>${runningCount}개 실행 중` : ''}</span>${nativeBridge() ? '<button type="button" class="lab-mini-open" data-lab="open-mini" title="다른 앱 위에 늘 떠 있는 작은 타이머 창">⧉ 작은 창</button>' : ''}</div>
      <div class="lab-crumbs" data-crumbs>${crumbsHtml()}</div>
      <div data-now-slot>${nowHtml()}</div>
      <div class="lab-source">
        ${blocks}
      </div>
      ${outputHtml(today)}
      <div class="lab-statusbar${runningCount ? ' running' : ''}" data-status>${statusHtml(today)}</div>
    </div>`;
  freshId = '';
  main.querySelectorAll('.lab-source input[data-field]:not([data-field="new"])').forEach(input => {
    input.addEventListener('input', () => {
      const block = blockById(input.dataset.id); if (!block) return;
      if (input.dataset.field === 'cond' && block.runningSince) {
        input.value = block.cond;
        input.parentElement.dataset.value = block.cond || input.placeholder;
        return;
      }
      if (input.dataset.field === 'extra') block.extra[Number(input.dataset.index)] = input.value;
      else block[input.dataset.field] = input.value;
      block.updatedAt = new Date().toISOString();
      fitWidth(input);
      if (input.dataset.field !== 'cond') { input.parentElement.classList.toggle('lab-commented', input.value.trim().startsWith('#')); updateCompletion(input); }
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
    // 코드 편집기처럼: Enter로 아래에 새 실행문, 줄 맨 앞 Backspace로 윗줄에 붙이기, ↑↓로 줄 이동, 여러 줄 붙여넣기
    input.addEventListener('keydown', event => editorKey(event, input));
    input.addEventListener('compositionend', () => composeEnded(input));
    // 칸 너비: 글자를 칠 때 밀린 것 되돌리기, 한글 조합 중인 글자도 너비에 넣기
    input.addEventListener('scroll', () => unscroll(input));
    input.addEventListener('compositionstart', () => { composing.set(input, ''); });
    input.addEventListener('compositionupdate', event => { composing.set(input, event.data || ''); fitWidth(input); });
    input.addEventListener('compositionend', () => { composing.delete(input); fitWidth(input); });
    input.addEventListener('blur', () => { if (completion?.input === input) closeCompletion(); });
    if (input.dataset.field !== 'cond') input.addEventListener('paste', event => pasteLines(event, input));
  });
  // 빈 줄: while · if 를 쳐서 그 자리에 새 블록
  main.querySelectorAll('.lab-source input[data-field="new"]').forEach(newLine => {
    newLine.addEventListener('input', () => updateKeywordCompletion(newLine));
    newLine.addEventListener('keydown', event => newLineKey(event, newLine));
    newLine.addEventListener('compositionend', () => composeEnded(newLine));
    newLine.addEventListener('blur', () => { if (completion?.input === newLine) closeCompletion(); });
  });
  startTicking();
}

const keepScroll = paint => { const top = window.scrollY; paint(); window.scrollTo({ top, behavior: 'instant' }); };

// ---------- 연결: 첫 줄(block.link) 또는 아래 줄(extra[i] = { link }) ----------
const lineOf = element => element.dataset.index === undefined ? -1 : Number(element.dataset.index);
function setLink(block, index, link) {
  if (index < 0) block.link = link; else block.extra[index] = { link };
  block.updatedAt = new Date().toISOString();
}

// 중간에 멈췄거나 '다 했어요'를 눌렀을 때: 아직 안 끝낸 연결이 있으면 알림에 '체크' 버튼을 둔다(했다고 판단하면 누르게).
function checkOffer(block, date) {
  const pending = pendingLinks(data, block, date); if (!pending.length) return [];
  const kinds = new Set(pending.map(link => linkTarget(data, link).kind));
  const label = kinds.size > 1 ? '공부 기록·할 일 체크' : kinds.has('routine') ? '공부 기록에 체크' : '할 일 체크';
  return [{ label, run: () => { const linked = completeBlockLinks(data, block, date); persist(); keepScroll(renderLab); if (linked) showToast(linked.label, { label: '되돌리기', run: () => { linked.undo(); persist(); keepScroll(renderLab); } }); } }];
}

// ---------- 칸 너비: 보이지 않는 글자 복사본(data-value)이 칸 크기를 정한다 ----------
// 조합 중인 글자가 칸 값에 아직 없으면 커서 자리에 끼워 넣어 잰다(이미 있으면 그대로).
const composing = new WeakMap();
function fitWidth(input) {
  const value = input.value; const data = composing.get(input) || '';
  const start = input.selectionStart ?? value.length; const end = input.selectionEnd ?? start;
  const included = !data || value.slice(start, end) === data || value.slice(Math.max(0, start - data.length), start) === data;
  input.parentElement.dataset.value = (included ? value : value.slice(0, start) + data + value.slice(end)) || input.placeholder;
  unscroll(input);
}

// 글자를 치는 순간에는 칸이 아직 안 늘어나 브라우저가 글자를 왼쪽으로 밀어(스크롤) 앞 글자가 가려진다.
// 칸이 글자에 맞춰 늘어난 뒤에는 밀린 것을 되돌린다.
function unscroll(input) {
  // WebKit은 커서 자리 때문에 내용 폭이 칸보다 2px쯤 크게 나온다. 그 정도 차이면 다 들어간 것으로 본다.
  if (input.scrollLeft && input.scrollWidth <= input.clientWidth + 3) input.scrollLeft = 0;
}

// ---------- 실행문 여러 줄 편집 ----------
// 줄 번호: body는 -1, extra[i]는 i. 연결해 둔 블록은 body 자리에 함수 이름이 있어 글로 고칠 수 없다.
const lineText = (block, index) => index < 0 ? (block.link ? null : block.body || '') : typeof block.extra[index] === 'object' && block.extra[index] ? null : block.extra[index] || '';
const setLine = (block, index, value) => { if (index < 0) block.body = value; else block.extra[index] = value; };
const lineIndex = input => input.dataset.field === 'body' ? -1 : Number(input.dataset.index);

// 다시 그린 뒤 그 줄(커서 자리까지)로 돌아간다.
function focusLine(id, index, caret) {
  const selector = index < 0 ? `input[data-field="body"][data-id="${CSS.escape(id)}"]` : `input[data-field="extra"][data-id="${CSS.escape(id)}"][data-index="${index}"]`;
  const input = main.querySelector(selector); if (!input) return;
  input.focus({ preventScroll: false });
  const at = caret === 'end' ? input.value.length : Math.min(caret, input.value.length);
  input.setSelectionRange(at, at);
}

function changed(block) { block.updatedAt = new Date().toISOString(); persist(); keepScroll(renderLab); }

function editorKey(event, input) {
  if (completionKey(event, input)) return;
  // 한글을 쓰는 중(조합 중)에 누른 Enter는 마지막 글자가 칸에 들어간 직후에 줄을 나눈다(한 번만 눌러도 되게).
  if (event.isComposing || event.keyCode === 229) {
    if (event.key === 'Enter' || event.keyCode === 229 && event.code === 'Enter') input.dataset.enterAfterCompose = '1';
    return;
  }
  const block = blockById(input.dataset.id); if (!block) return;
  const field = input.dataset.field;
  // ↑↓: 위아래 줄로(블록을 넘어가도 이어서)
  if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
    const inputs = [...main.querySelectorAll('.lab-source input[data-field]')];
    const target = inputs[inputs.indexOf(input) + (event.key === 'ArrowUp' ? -1 : 1)]; if (!target) return;
    event.preventDefault();
    const at = Math.min(input.selectionStart ?? 0, target.value.length);
    target.focus(); target.setSelectionRange(at, at);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    if (field === 'cond') {
      // 조건 → 첫 실행문으로(연결해 둔 블록이면 그 아래 줄, 없으면 새로 만든다)
      if (!block.link) { focusLine(block.id, -1, 'end'); return; }
      if (block.extra?.length) { focusLine(block.id, 0, 'end'); return; }
      block.extra = ['']; changed(block); focusLine(block.id, 0, 0); return;
    }
    // 블록의 마지막 실행문이 비어 있으면 파이썬에서 들여쓰기를 빠져나오듯 블록 밖으로(다음 블록이나 맨 아래 빈 줄)
    const index = lineIndex(input); const lastIndex = (block.extra?.length || 0) - 1;
    if (!input.value && index === lastIndex) { leaveBlock(block, index); return; }
    splitLine(block, input);
    return;
  }
  // 줄 맨 앞 Backspace: 윗줄 끝에 붙인다(윗줄이 연결한 함수 이름이면 빈 줄만 지운다).
  if (event.key === 'Backspace' && field === 'extra' && input.selectionStart === 0 && input.selectionEnd === 0) {
    const index = lineIndex(input); const above = lineText(block, index - 1);
    if (above === null && input.value) return;
    event.preventDefault();
    block.extra.splice(index, 1);
    if (above !== null) setLine(block, index - 1, above + input.value);
    changed(block);
    if (above === null) focusLine(block.id, index, 0); else focusLine(block.id, index - 1, above.length);
  }
}

function leaveBlock(block, index) {
  if (index >= 0) { block.extra.splice(index, 1); changed(block); }
  // 블록 바로 아래 빈 줄로(거기서 wh 를 치면 그 자리에 다음 블록)
  const at = liveBlocks(data).indexOf(block) + 1;
  main.querySelector(`.lab-source input[data-field="new"][data-at="${at}"]`)?.focus();
}

// 커서 뒤 글자는 새 줄로 넘긴다.
function splitLine(block, input) {
  const index = lineIndex(input); const at = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, at); const after = input.value.slice(input.selectionEnd ?? at);
  setLine(block, index, before);
  (block.extra ||= []).splice(index + 1, 0, after);
  changed(block); focusLine(block.id, index + 1, 0);
}

function composeEnded(input) {
  if (!input.dataset.enterAfterCompose) return;
  delete input.dataset.enterAfterCompose;
  // 자동 완성 목록이 떠 있으면 줄을 나누지 않고 고른 항목을 넣는다.
  if (completion?.input === input) { setTimeout(() => { if (input.dataset.field === 'new') updateKeywordCompletion(input); else updateCompletion(input); acceptCompletion(); }, 0); return; }
  // 확정된 글자가 칸과 데이터에 들어간 뒤(input 이벤트 다음)에 나눈다.
  setTimeout(() => {
    const block = blockById(input.dataset.id); if (!block || !input.isConnected) return;
    if (input.dataset.field === 'cond') { if (!block.link) focusLine(block.id, -1, 'end'); return; }
    setLine(block, lineIndex(input), input.value); splitLine(block, input);
  }, 0);
}

// ---------- 자동 완성(IDE처럼) ----------
// · 맨 아래 새 줄: wh → while, i → if. 고르면 새 블록이 생긴다.
// · 실행문 줄 맨 앞: ro → routine., go → goal. 고르면 이어서 목록이 뜬다.
// · routine. · goal. 다음: 공부 기록 루틴·목표 할 일. 고르면 그 줄이 연결되어 블록을 끝까지 마칠 때 같이 체크된다.
let completion = null; // { input, kind, items, active, render(item), accept(item), empty }
const squash = text => String(text || '').toLocaleLowerCase().replace(/[\s_]+/g, '');
const KEYWORDS = [
  { word: 'while', hint: '시간 재기·집중 타이머 · while 4: 뽀모도로 · while 18시까지:' },
  { word: 'if', hint: '조건에 맞춰 한 일 기록 · if 밥 먹고 나면:' },
];
const NAMESPACES = [
  { word: 'routine', hint: '공부 기록 루틴', dot: true },
  { word: 'goal', hint: '목표 보드 · 진행 중 할 일', dot: true },
];
const wordRow = item => `<code><span class="lab-kw">${esc(item.word)}</span>${item.dot ? '<span class="lab-punct">.</span>' : ''}</code><small>${esc(item.hint)}</small>`;

function linkItems(ns, query) {
  const { routines, tasks } = linkChoices(data, todayKey());
  const list = ns === 'routine'
    ? routines.map(choice => ({ ...choice, ns: 'routine', name: asIdentifier(choice.title) }))
    : tasks.map(choice => ({ ...choice, ns: `goal.${asIdentifier(choice.meta)}`, name: asIdentifier(choice.title) }));
  const wanted = squash(query);
  return list.filter(item => !wanted || squash(`${item.ns}.${item.name}`).includes(wanted) || squash(item.title).includes(wanted)).slice(0, 8);
}

function openCompletion(input, options) {
  const active = completion?.input === input && completion.kind === options.kind ? Math.min(completion.active, Math.max(0, options.items.length - 1)) : 0;
  completion = { input, active, ...options };
  renderCompletion();
}

// 실행문 줄: routine. · goal. 다음이면 목록, 줄 맨 앞 첫 단어가 routine·goal의 앞부분이면 이름공간(영어 메모를 쓸 때 방해되지 않게 첫 단어만)
function updateCompletion(input) {
  const before = input.value.slice(0, input.selectionStart ?? input.value.length);
  const link = before.match(/(?:^|\s)(routine|goal)\.([^\s()]*)$/i);
  if (link) {
    const ns = link[1].toLowerCase();
    openCompletion(input, {
      kind: 'link', items: linkItems(ns, link[2]),
      render: item => `<code><span class="lab-ns">${esc(item.ns)}</span>.<span class="lab-fn">${esc(item.name)}</span><span class="lab-punct">()</span></code><small>${esc(item.meta || '')}</small>`,
      empty: `# ${ns === 'routine' ? '맞는 루틴이 없어요 · 공부 기록 탭에서 루틴을 만들어요' : '진행 중 목표에 맞는 할 일이 없어요'}`,
      accept: item => acceptLink(input, item),
    });
    return;
  }
  const word = before.match(/^\s*([a-z]+)$/i)?.[1]?.toLowerCase();
  const items = word ? NAMESPACES.filter(item => item.word.startsWith(word)) : [];
  if (!items.length) { closeCompletion(); return; }
  openCompletion(input, {
    kind: 'namespace', items, render: wordRow,
    // 첫 단어를 routine. · goal. 로 바꾸고, 이어서 목록을 띄운다.
    accept: item => {
      const at = input.selectionStart ?? input.value.length;
      input.focus(); input.setRangeText(`${item.word}.`, before.length - word.length, at, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
  });
}

// 맨 아래 새 줄: while · if
function updateKeywordCompletion(input) {
  const word = input.value.match(/^\s*([a-z]+)$/i)?.[1]?.toLowerCase();
  const items = word ? KEYWORDS.filter(item => item.word.startsWith(word)) : [];
  if (!items.length) { closeCompletion(); return; }
  openCompletion(input, { kind: 'keyword', items, render: wordRow, accept: item => createBlock(item.word, '', Number(input.dataset.at)) });
}

function renderCompletion() {
  main.querySelectorAll('.lab-complete').forEach(box => box.remove());
  if (!completion?.input.isConnected) { completion = null; return; }
  const { input, items, active, render, empty } = completion;
  const code = input.closest('.lab-code'); const span = input.parentElement;
  const rows = items.map((item, index) => `<div class="lab-complete-item${index === active ? ' active' : ''}" role="option" aria-selected="${index === active}" data-complete="${index}">${render(item)}</div>`).join('');
  code.insertAdjacentHTML('beforeend', `<div class="lab-complete" role="listbox" aria-label="자동 완성" style="--x:${span.offsetLeft}px">${rows || `<div class="lab-complete-empty">${esc(empty || '')}</div>`}<div class="lab-complete-foot">↑↓ 고르기 · Enter·Tab 넣기 · Esc 닫기</div></div>`);
}

function closeCompletion() {
  completion = null;
  main.querySelectorAll('.lab-complete').forEach(box => box.remove());
}

function acceptCompletion(index = completion?.active ?? 0) {
  const current = completion; const item = current?.items[index]; closeCompletion();
  if (item && current.input.isConnected) current.accept(item);
}

function acceptLink(input, item) {
  const block = blockById(input.dataset.id); if (!block) return;
  const line = lineIndex(input);
  if (line < 0) block.body = '';
  setLink(block, line, item.link);
  // 코드 편집기처럼 다음 줄로 이어서 적는다(다음 줄이 없으면 빈 줄을 만든다. 안 쓰면 Backspace로 지운다).
  const next = (block.extra ||= [])[line + 1];
  if (next === undefined || typeof next === 'object') block.extra.splice(line + 1, 0, '');
  persist(); keepScroll(renderLab);
  focusLine(block.id, line + 1, 'end');
}

// 새 블록: while·if 키워드로 그 빈 줄 자리(at번째 블록 앞)에 만들고 조건 칸으로(조건까지 적었으면 실행문 칸으로) 간다.
function createBlock(kind, cond, at) {
  const created = newLabBlock(kind); created.cond = cond;
  const before = liveBlocks(data)[at];
  if (before) data.labBlocks.splice(data.labBlocks.indexOf(before), 0, created); else data.labBlocks.push(created);
  persist(); keepScroll(renderLab);
  const target = main.querySelector(`input[data-field="${cond ? 'body' : 'cond'}"][data-id="${CSS.escape(created.id)}"]`);
  target?.focus(); target?.setSelectionRange(target.value.length, target.value.length);
}

// 목록이 떠 있을 때의 키: ↑↓ 고르기, Enter·Tab 넣기, Esc 닫기. 처리했으면 true.
function completionKey(event, input) {
  if (completion?.input !== input) return false;
  if (event.isComposing || event.keyCode === 229) { if (event.key === 'Enter') input.dataset.enterAfterCompose = '1'; return true; }
  const count = completion.items.length;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (count) completion.active = (completion.active + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
    renderCompletion(); return true;
  }
  if ((event.key === 'Enter' || event.key === 'Tab') && count) { event.preventDefault(); acceptCompletion(); return true; }
  if (event.key === 'Escape') { event.preventDefault(); closeCompletion(); return true; }
  return false;
}

// 빈 줄의 키: 목록이 없을 때 Enter는 'while 4:' 처럼 적은 대로 블록을 만든다. ↑↓는 위아래 줄로.
function newLineKey(event, input) {
  if (completionKey(event, input) || event.isComposing || event.keyCode === 229) return;
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    const inputs = [...main.querySelectorAll('.lab-source input[data-field]')];
    const target = inputs[inputs.indexOf(input) + (event.key === 'ArrowUp' ? -1 : 1)]; if (!target) return;
    event.preventDefault(); target.focus(); target.setSelectionRange(target.value.length, target.value.length);
    return;
  }
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const typed = input.value.trim().match(/^(while|if)\b\s*(.*?)\s*:?\s*$/i);
  if (typed) { createBlock(typed[1].toLowerCase(), typed[2], Number(input.dataset.at)); return; }
  if (input.value.trim()) showToast('while 이나 if 로 시작해 주세요 · 예: while 4:  ·  if 밥 먹고 나면:');
}

// 목록을 마우스로 고를 때는 입력칸 초점을 잃지 않게 한다.
main.addEventListener('mousedown', event => {
  const row = event.target.closest('.lab-complete-item'); if (!row) return;
  event.preventDefault(); acceptCompletion(Number(row.dataset.complete));
});

// 여러 줄을 붙여넣으면 줄마다 실행문이 된다.
function pasteLines(event, input) {
  const text = event.clipboardData?.getData('text') || '';
  if (!/\r?\n/.test(text)) return;
  event.preventDefault();
  const block = blockById(input.dataset.id); if (!block) return;
  const index = lineIndex(input); const at = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, at); const after = input.value.slice(input.selectionEnd ?? at);
  const pasted = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n');
  const last = pasted.length - 1;
  setLine(block, index, before + pasted[0]);
  (block.extra ||= []).splice(index + 1, 0, ...pasted.slice(1).map((line, i) => i === last - 1 ? line + after : line));
  if (!last) setLine(block, index, before + pasted[0] + after);
  changed(block); focusLine(block.id, index + last, last ? pasted[last].length : before.length + pasted[0].length);
}

// ---------- 맥 앱의 작은 타이머 창 ----------
// 전용 창(맥 지원일지.app · 윈도우 앱) 안에서만 보이는 버튼. 작은 창의 pause·break는 여기로 돌아와 본 창에서 처리한다.
const nativeBridge = nativeHost;
window.jiwonLab = {
  act(action, id) {
    const block = blockById(id); if (!block?.runningSince) return;
    const redraw = () => { persist(); if (view === 'lab') keepScroll(renderLab); else startTicking(); };
    if (action === 'pause' && !block.pausedAt) { pauseLoop(block); redraw(); showToast('일시정지 · 멈춘 동안은 시간이 흐르지 않아요'); }
    if (action === 'resume' && block.pausedAt) { resumeLoop(block); redraw(); }
    if (action === 'break') {
      const run = breakLoop(block); redraw(); if (!run) return;
      showToast(`루프 탈출 · ${minutesLabel(run.minutes)}${run.rounds ? ` · ${run.rounds}라운드` : ''}`, { label: '되돌리기', run: () => { block.runs = block.runs.filter(item => item !== run); block.runningSince = run.at; redraw(); } });
    }
  },
};

main.addEventListener('click', event => {
  if (view !== 'lab') return;
  if (!event.target.closest('.lab-link-menu, [data-lab="link"]')) closeLinkMenu();
  const button = event.target.closest('[data-lab]'); if (!button) return;
  const block = blockById(button.dataset.id); const action = button.dataset.lab;
  if (action === 'open-mini') { nativeBridge()?.postMessage({ type: 'openMini' }); return; }
  if (!block) return;
  if (action === 'show-now') { nowId = block.id; keepScroll(renderLab); return; }
  if (action === 'pause') { pauseLoop(block); persist(); keepScroll(renderLab); showToast('일시정지 · 멈춘 동안은 시간이 흐르지 않아요'); return; }
  if (action === 'resume') { resumeLoop(block); persist(); keepScroll(renderLab); return; }
  if (action === 'done') {
    // 다 했어요: 블록을 치우고 기록만 남긴다. 연결한 루틴·할 일이 남아 있으면 같이 체크할지 알림에서 고른다.
    const run = finishBlock(block); persist(); keepScroll(renderLab);
    const check = checkOffer(block, run?.date || todayKey());
    showToast(`${block.kind} ${block.cond || '…'}: done · 기록은 OUTPUT에 남겨요`, [...check, { label: '되돌리기', run: () => { block.doneAt = ''; if (run) { block.runs = block.runs.filter(item => item !== run); block.runningSince = run.at; } persist(); keepScroll(renderLab); } }]);
    return;
  }
  if (action === 'link') {
    const code = button.closest('.lab-code'); const open = code.querySelector('.lab-link-menu'); closeLinkMenu(); if (open) return;
    code.insertAdjacentHTML('beforeend', linkMenuHtml(block, lineOf(button))); code.classList.add('menu-open');
    placeLinkMenu(code.querySelector('.lab-link-menu'));
    code.querySelector('.lab-link-item')?.focus({ preventScroll: true, focusVisible: keyboardUsed });
    return;
  }
  if (action === 'pick-link') { setLink(block, lineOf(button), JSON.parse(button.dataset.link)); persist(); keepScroll(renderLab); return; }
  if (action === 'unlink') {
    const index = lineOf(button); const before = index < 0 ? block.link : block.extra[index];
    if (index < 0) block.link = null; else block.extra[index] = '';
    block.updatedAt = new Date().toISOString(); persist(); keepScroll(renderLab);
    showToast('연결을 끊었어요', { label: '되돌리기', run: () => { if (index < 0) block.link = before; else block.extra[index] = before; persist(); keepScroll(renderLab); } });
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
    const check = checkOffer(block, run.date);
    showToast(`루프 탈출 · ${minutesLabel(run.minutes)}${run.rounds ? ` · ${run.rounds}라운드` : ''}`, [...check, undoRun]);
  } else if (action === 'run-if') {
    const run = runIf(block); const linked = completeBlockLinks(data, block, run.date); freshId = block.id; persist(); keepScroll(renderLab);
    showToast(`if ${block.cond || '…'}: ${bodyLabel(block)} ✓${linked ? ` · ${linked.label}` : ''}`, { label: '되돌리기', run: () => { block.runs = block.runs.filter(item => item !== run); linked?.undo(); persist(); keepScroll(renderLab); } });
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
        const finished = finishUntil(block); const linked = finished && completeBlockLinks(data, block, finished.date); freshId = block.id; persist(); chime(3);
        showToast(`${finished.until} 됐어요 · ${minutesLabel(finished.minutes)} 했어요${linked ? ` · ${linked.label}` : ''}`, linked ? { label: '체크 되돌리기', run: () => { linked.undo(); persist(); if (view === 'lab') keepScroll(renderLab); } } : null);
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
        const finished = finishPomodoro(block, plan); const linked = finished && completeBlockLinks(data, block, finished.date); freshId = block.id; persist(); chime(3);
        showToast(`${plan.rounds}라운드 완료 · ${minutesLabel(plan.rounds * plan.focus)} 집중했어요${linked ? ` · ${linked.label}` : ''}`, linked ? { label: '체크 되돌리기', run: () => { linked.undo(); persist(); if (view === 'lab') keepScroll(renderLab); } } : null);
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
    for (const panel of main.querySelectorAll('[data-now]')) {
      const block = running.find(item => item.id === panel.dataset.now); if (!block) continue;
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
