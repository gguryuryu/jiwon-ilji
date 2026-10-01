// 집중 루프: while·if 블록으로 적는 할 일. while은 '도는 동안' 시간을 재고, if는 실행할 때마다 기록한다.
import { dateKey, uid } from './util.js';
import { bookProgress, liveRoutines, recordStudy, routineOn, studyEntries } from './study-model.js';

export const newLabBlock = kind => ({ id: uid(), kind, cond: '', body: '', runs: [], runningSince: '', createdAt: new Date().toISOString() });

const runDate = run => run.date || (run.at ? dateKey(new Date(run.at)) : '');

export const runsOn = (block, date) => (block.runs || []).filter(run => runDate(run) === date);

// 이번 주(월~일) 실행 횟수
export function runsThisWeek(block, today) {
  const [year, month, day] = today.split('-').map(Number);
  const now = new Date(year, month - 1, day, 12);
  const monday = new Date(now); monday.setDate(now.getDate() - (now.getDay() + 6) % 7);
  const start = dateKey(monday);
  return (block.runs || []).filter(run => runDate(run) >= start && runDate(run) <= today).length;
}

// while 돌리기: 시작 시각만 적어 두고(앱을 껐다 켜도 이어서 돈다), break 때 걸린 분을 기록한다.
export function startLoop(block, now = new Date()) {
  if (block.kind !== 'while' || block.runningSince) return;
  block.runningSince = now.toISOString(); block.pausedAt = ''; block.pausedMs = 0;
}

// 실제로 돈 시간(초): 시작부터 지금(멈춰 있으면 멈춘 순간)까지에서 멈춰 있던 시간을 뺀다.
export function activeSeconds(block, now = new Date()) {
  if (!block.runningSince) return 0;
  const end = block.pausedAt ? new Date(block.pausedAt) : now;
  return Math.max(0, (end - new Date(block.runningSince) - (block.pausedMs || 0)) / 1000);
}

// pause: 멈춘 동안은 시간이 흐르지 않는다(뽀모도로도 그 자리에서 멈춘다). resume으로 이어서 돈다.
export function pauseLoop(block, now = new Date()) {
  if (!block.runningSince || block.pausedAt) return false;
  block.pausedAt = now.toISOString(); return true;
}

export function resumeLoop(block, now = new Date()) {
  if (!block.runningSince || !block.pausedAt) return false;
  block.pausedMs = (block.pausedMs || 0) + (now - new Date(block.pausedAt)); block.pausedAt = ''; return true;
}

// done: 블록을 편집기에서 치우고 기록(OUTPUT)만 남긴다. 돌고 있었으면 먼저 멈춰 기록한다.
export function finishBlock(block, now = new Date()) {
  const run = block.runningSince ? breakLoop(block, now) : null;
  block.doneAt = now.toISOString();
  return run;
}

export const liveBlocks = state => (state.labBlocks || []).filter(block => !block.doneAt);

export function breakLoop(block, now = new Date()) {
  if (!block.runningSince) return null;
  const started = new Date(block.runningSince); const active = activeSeconds(block, now);
  const minutes = Math.max(0, Math.round(active / 60));
  // 뽀모도로라면 끝낸 라운드 수와 실제 집중한 분만 남긴다(휴식·멈춘 시간은 빼고).
  const plan = parsePomodoro(block.cond);
  const state = plan && pomodoroState(plan, active);
  const rounds = state ? state.round - (state.phase === 'focus' ? 1 : 0) : undefined;
  const focusMinutes = !state ? minutes : state.done ? plan.rounds * plan.focus
    : Math.round(state.phase === 'focus' ? (state.round - 1) * plan.focus + (state.phaseLength - state.left) / 60 : state.round * plan.focus);
  const run = { date: dateKey(started), at: block.runningSince, endedAt: now.toISOString(), minutes: Math.max(0, focusMinutes), ...(plan ? { rounds } : {}) };
  block.runs = [...(block.runs || []), run];
  block.runningSince = ''; block.pausedAt = ''; block.pausedMs = 0; block.untilAt = '';
  return run;
}

export function runIf(block, now = new Date()) {
  const run = { date: dateKey(now), at: now.toISOString() };
  block.runs = [...(block.runs || []), run];
  return run;
}

// '12:03'(분:초) 또는 '1:02:03'
export function elapsedLabel(since, now = new Date()) {
  const seconds = Math.max(0, Math.floor((now - new Date(since)) / 1000));
  const h = Math.floor(seconds / 3600); const m = Math.floor(seconds % 3600 / 60); const s = seconds % 60;
  const pad = value => String(value).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export const minutesLabel = minutes => minutes >= 60 ? `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}` : `${minutes}분`;

// ---------- 뽀모도로: while 괄호 안 숫자 ----------
// '4' · '4회' → 25분 집중 × 4(사이 5분 휴식), '50분' → 50분 한 번, '50분 × 2' · '50분 2회' → 50분 × 2.
// 숫자가 없으면 null(끝을 정하지 않고 break할 때까지 도는 while).
export function parsePomodoro(cond) {
  const text = String(cond || '').trim();
  if (!/\d/.test(text)) return null;
  // 숫자와 단위만 있을 때만 뽀모도로로 본다('지하철 2호선 타는 동안'처럼 문장 속 숫자는 그냥 조건).
  if (text.replace(/\d+|뽀모도로|뽀모|pomodoros?|pomos?|라운드|rounds?|세트|min|분|회|번|개|🍅|[mx×*·,+\s]/gi, '')) return null;
  const minutes = text.match(/(\d+)\s*(?:분|m\b|min)/i);
  const rest = text.replace(minutes?.[0] || '', ' ');
  const rounds = rest.match(/(\d+)\s*(?:회|번|개|세트|라운드|rounds?|pomos?|뽀모)?/i);
  if (!minutes && !rounds) return null;
  const focus = minutes ? Number(minutes[1]) : 25;
  const count = rounds ? Number(rounds[1]) : 1;
  if (!(focus >= 1 && focus <= 240 && count >= 1 && count <= 12)) return null;
  return { rounds: count, focus, rest: count > 1 ? (focus >= 50 ? 10 : 5) : 0 };
}

// 시작한 지 elapsed초 지났을 때 어디쯤인지: 몇 번째 라운드, 집중/휴식, 이 구간에 남은 초, 전체 진행률
export function pomodoroState(plan, elapsedSeconds) {
  const focus = plan.focus * 60; const rest = plan.rest * 60;
  const total = plan.rounds * focus + (plan.rounds - 1) * rest;
  if (elapsedSeconds >= total) return { done: true, round: plan.rounds, phase: 'done', left: 0, phaseLength: 1, progress: 1, total };
  let t = elapsedSeconds;
  for (let round = 1; round <= plan.rounds; round++) {
    if (t < focus) return { done: false, round, phase: 'focus', left: focus - t, phaseLength: focus, progress: elapsedSeconds / total, total };
    t -= focus;
    if (round < plan.rounds) {
      if (t < rest) return { done: false, round, phase: 'rest', left: rest - t, phaseLength: rest, progress: elapsedSeconds / total, total };
      t -= rest;
    }
  }
  return { done: true, round: plan.rounds, phase: 'done', left: 0, phaseLength: 1, progress: 1, total };
}

// 끝까지 돈 뽀모도로를 끝난 시각 기준으로 기록한다(앱을 꺼 둔 사이 끝났어도 맞게 남는다).
export function finishPomodoro(block, plan) {
  if (!block.runningSince) return null;
  const started = new Date(block.runningSince);
  const ended = new Date(started.getTime() + pomodoroState(plan, 0).total * 1000 + (block.pausedMs || 0));
  const run = { date: dateKey(started), at: block.runningSince, endedAt: ended.toISOString(), minutes: plan.rounds * plan.focus, rounds: plan.rounds, completed: true };
  block.runs = [...(block.runs || []), run];
  block.runningSince = ''; block.pausedAt = ''; block.pausedMs = 0;
  return run;
}

export const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// ---------- 연결: 블록의 할 일 줄을 공부 기록 루틴이나 목표 보드의 할 일에 잇는다 ----------
// link = { type: 'routine', id } | { type: 'task', goalId, taskId }
export const asIdentifier = text => String(text || '').trim().replace(/[\s·,./()+\-]+/g, '_').replace(/^_+|_+$/g, '') || '할_일';

// 연결 대상(없으면 null: 루틴·할 일을 지웠을 때)
export function linkTarget(state, link) {
  if (!link) return null;
  if (link.type === 'routine') { const routine = state.studyRoutines.find(item => item.id === link.id && !item.deletedAt); return routine ? { kind: 'routine', routine } : null; }
  const goal = (state.goals || []).find(item => item.id === link.goalId); const task = goal?.tasks?.find(item => item.id === link.taskId);
  return task ? { kind: 'task', goal, task } : null;
}

// 코드처럼 보이는 이름: routine.응용수리_20문제() · goal.NCS.기본서_문제해결()
export function linkCall(state, link) {
  const target = linkTarget(state, link); if (!target) return null;
  return target.kind === 'routine' ? { ns: 'routine', name: asIdentifier(target.routine.title) } : { ns: `goal.${asIdentifier(target.goal.title)}`, name: asIdentifier(target.task.text) };
}

// 그날 이미 끝냈는지(루틴은 그날 체크, 할 일은 체크 여부)
export function linkDone(state, link, date) {
  const target = linkTarget(state, link); if (!target) return false;
  if (target.kind === 'task') return Boolean(target.task.done);
  return state.studyLogs.some(log => log.routineId === target.routine.id && log.date === date && log.done);
}

// 연결된 루틴·할 일을 체크한다. 이미 끝났거나 대상이 없으면 null, 체크했으면 되돌리기 함수를 돌려준다.
// 교재가 이어진 루틴은 목표 분량(남은 분량을 넘지 않게)을 진도에 쌓는다 — 공부 기록에서 체크한 것과 같다.
export function completeLink(state, link, date) {
  const target = linkTarget(state, link); if (!target || linkDone(state, link, date)) return null;
  if (target.kind === 'task') {
    target.task.done = true; target.goal.updatedAt = new Date().toISOString();
    return () => { target.task.done = false; target.goal.updatedAt = new Date().toISOString(); };
  }
  const definition = studyEntries(state, date).find(entry => entry.routine.id === target.routine.id)?.definition || routineOn(target.routine, date) || { ...target.routine, id: target.routine.id };
  const book = state.studyBooks.find(item => item.id === definition.bookId);
  const amount = book ? Math.min(definition.amount || 0, bookProgress(book, state.studyLogs).remaining) : 0;
  const log = recordStudy(state, definition, date, amount);
  return () => { log.done = false; log.updatedAt = new Date().toISOString(); };
}

// 연결 메뉴에 보일 후보: 공부 기록 루틴(오늘 할 것 먼저)과 진행 중 목표의 남은 할 일
export function linkChoices(state, date) {
  const today = new Set(studyEntries(state, date).map(entry => entry.routine.id));
  const routines = liveRoutines(state).map(routine => ({ link: { type: 'routine', id: routine.id }, title: routine.title, meta: `${routine.category}${today.has(routine.id) ? ' · 오늘' : ''}`, today: today.has(routine.id) })).sort((a, b) => Number(b.today) - Number(a.today));
  const tasks = (state.goals || []).filter(goal => goal.status === 'doing').flatMap(goal => (goal.tasks || []).filter(task => !task.done).map(task => ({ link: { type: 'task', goalId: goal.id, taskId: task.id }, title: task.text, meta: goal.title })));
  return { routines, tasks };
}

// ---------- 시각까지: while 15시까지: / ~18:30 / until 18:30 ----------
// '까지'·'~'·'until' 가운데 하나가 있어야 시각으로 본다('3시 회의 전에'처럼 그냥 숫자가 든 조건은 건드리지 않는다).
export function parseUntil(cond) {
  const text = String(cond || '').trim();
  if (!/까지\s*$|^~|^until\b/i.test(text)) return null;
  const body = text.replace(/^~\s*|^until\s+/i, '').replace(/\s*까지\s*$/, '').trim();
  const match = body.match(/^(오전|오후|am|pm)?\s*(\d{1,2})\s*(?:(?::|시)\s*(?:(\d{1,2})\s*분?)?)?\s*(오전|오후|am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[2]); const minute = Number(match[3] || 0);
  const half = (match[1] || match[4] || '').toLowerCase();
  if (half === '오후' || half === 'pm') { if (hour < 12) hour += 12; } else if ((half === '오전' || half === 'am') && hour === 12) hour = 0;
  if (hour > 24 || minute > 59 || (hour === 24 && minute)) return null;
  // 오전·오후 없이 1~11시를 적었으면, 그 시각이 지났을 때 오후로 본다(낮에 '3시까지'는 보통 15시).
  return { hour, minute, flexible: !half && hour >= 1 && hour <= 11, label: `${String(hour % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

// 그 시각(시작한 날 기준). 이미 지났으면 null — 다음 날로 넘기지 않고 알려 준다.
export function untilDate(plan, from = new Date()) {
  const target = new Date(from); target.setHours(plan.hour, plan.minute, 0, 0);
  if (target > from) return target;
  if (plan.flexible) { target.setHours(plan.hour + 12, plan.minute, 0, 0); if (target > from) return target; }
  return null;
}

// 도는 동안: 남은 초(벽시계 기준, pause해도 끝나는 시각은 그대로)와 진행률
export function untilState(block, now = new Date()) {
  if (!block.untilAt) return null;
  const start = new Date(block.runningSince); const end = new Date(block.untilAt);
  const total = Math.max(1, (end - start) / 1000); const left = Math.max(0, (end - now) / 1000);
  return { left, total, progress: 1 - left / total, done: left <= 0, end };
}

// 그 시각이 되면: 실제로 한 시간(멈춘 시간 빼고)을 기록하고 '끝까지 함'으로 남긴다.
export function finishUntil(block) {
  if (!block.runningSince || !block.untilAt) return null;
  const end = new Date(block.untilAt);
  const run = { date: dateKey(new Date(block.runningSince)), at: block.runningSince, endedAt: block.untilAt, minutes: Math.round(activeSeconds(block, end) / 60), until: `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`, completed: true };
  block.runs = [...(block.runs || []), run];
  block.runningSince = ''; block.pausedAt = ''; block.pausedMs = 0; block.untilAt = '';
  return run;
}
