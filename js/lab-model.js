// 실험실: while·if 블록으로 적는 할 일. while은 '도는 동안' 시간을 재고, if는 실행할 때마다 기록한다.
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
  block.runningSince = now.toISOString();
}

export function breakLoop(block, now = new Date()) {
  if (!block.runningSince) return null;
  const started = new Date(block.runningSince);
  const minutes = Math.max(0, Math.round((now - started) / 60_000));
  // 뽀모도로라면 끝낸 라운드 수와 실제 집중한 분만 남긴다(휴식 시간은 빼고).
  const plan = parsePomodoro(block.cond);
  const state = plan && pomodoroState(plan, (now - started) / 1000);
  const rounds = state ? state.round - (state.phase === 'focus' ? 1 : 0) : undefined;
  const focusMinutes = !state ? minutes : state.done ? plan.rounds * plan.focus
    : Math.round(state.phase === 'focus' ? (state.round - 1) * plan.focus + (state.phaseLength - state.left) / 60 : state.round * plan.focus);
  const run = { date: dateKey(started), at: block.runningSince, endedAt: now.toISOString(), minutes: Math.max(0, focusMinutes), ...(plan ? { rounds } : {}) };
  block.runs = [...(block.runs || []), run];
  block.runningSince = '';
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
  const ended = new Date(started.getTime() + pomodoroState(plan, 0).total * 1000);
  const run = { date: dateKey(started), at: block.runningSince, endedAt: ended.toISOString(), minutes: plan.rounds * plan.focus, rounds: plan.rounds, completed: true };
  block.runs = [...(block.runs || []), run];
  block.runningSince = '';
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
