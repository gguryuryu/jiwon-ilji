// 실험실: while은 도는 동안 시간을 재고, if는 실행할 때마다 기록한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { breakLoop, clock, elapsedLabel, finishPomodoro, minutesLabel, newLabBlock, parsePomodoro, pomodoroState, runIf, runsOn, runsThisWeek, startLoop } from '../js/lab-model.js';
import { migrate } from '../js/model.js';
import { mergeInto } from '../js/merge.js';

test('while은 run부터 break까지 걸린 분을 시작한 날짜에 기록하고, 두 번 시작하지 않는다', () => {
  const block = newLabBlock('while');
  startLoop(block, new Date(2026, 9, 1, 23, 50));
  startLoop(block, new Date(2026, 9, 1, 23, 55));
  assert.equal(new Date(block.runningSince).getMinutes(), 50);
  const run = breakLoop(block, new Date(2026, 9, 2, 0, 15));
  assert.deepEqual([run.date, run.minutes, block.runningSince], ['2026-10-01', 25, '']);
  assert.equal(breakLoop(block), null);
  assert.equal(runsOn(block, '2026-10-01').length, 1);
});

test('if는 실행할 때마다 쌓이고, 이번 주(월~일) 횟수를 센다', () => {
  const block = newLabBlock('if');
  runIf(block, new Date(2026, 8, 27, 12)); // 지난주 일요일
  runIf(block, new Date(2026, 8, 28, 9));
  runIf(block, new Date(2026, 9, 1, 20));
  runIf(block, new Date(2026, 9, 1, 21));
  assert.equal(runsOn(block, '2026-10-01').length, 2);
  assert.equal(runsThisWeek(block, '2026-10-01'), 3);
  startLoop(block);
  assert.equal(block.runningSince, '');
});

test('경과 시간과 분을 읽기 쉽게 적는다', () => {
  const since = new Date(2026, 9, 1, 10, 0, 0).toISOString();
  assert.equal(elapsedLabel(since, new Date(2026, 9, 1, 10, 12, 3)), '12:03');
  assert.equal(elapsedLabel(since, new Date(2026, 9, 1, 11, 2, 3)), '1:02:03');
  assert.equal(minutesLabel(25), '25분');
  assert.equal(minutesLabel(90), '1시간 30분');
});

test('예전 파일에는 빈 실험실을 만들고, 두 창의 블록을 합친다', () => {
  assert.deepEqual(migrate({ postings: [], experiences: [] }).labBlocks, []);
  const block = newLabBlock('while');
  const base = { postings: [], experiences: [], labBlocks: [block] };
  const local = structuredClone(base); local.labBlocks[0].cond = '지하철 타는 동안';
  const server = structuredClone(base); server.labBlocks[0].body = '단어 외우기'; server.labBlocks.push(newLabBlock('if'));
  mergeInto(local, base, server);
  assert.deepEqual([local.labBlocks[0].cond, local.labBlocks[0].body, local.labBlocks.length], ['지하철 타는 동안', '단어 외우기', 2]);
});

test('while 괄호에 숫자·단위만 있으면 뽀모도로로 읽고, 문장 속 숫자는 그냥 조건으로 둔다', () => {
  assert.deepEqual(parsePomodoro('4'), { rounds: 4, focus: 25, rest: 5 });
  assert.deepEqual(parsePomodoro('4회'), { rounds: 4, focus: 25, rest: 5 });
  assert.deepEqual(parsePomodoro('50분'), { rounds: 1, focus: 50, rest: 0 });
  assert.deepEqual(parsePomodoro('50분 × 2'), { rounds: 2, focus: 50, rest: 10 });
  assert.deepEqual(parsePomodoro('🍅 3'), { rounds: 3, focus: 25, rest: 5 });
  for (const text of ['지하철 타는 동안', '지하철 2호선 타는 동안', '0', '', '99']) assert.equal(parsePomodoro(text), null, text);
});

test('뽀모도로는 집중 → 휴식을 번갈아 돌고, 마지막 집중이 끝나면 끝난다', () => {
  const plan = parsePomodoro('4');
  assert.deepEqual([pomodoroState(plan, 0).phase, pomodoroState(plan, 0).round], ['focus', 1]);
  assert.deepEqual([pomodoroState(plan, 25 * 60).phase, pomodoroState(plan, 25 * 60).left], ['rest', 300]);
  assert.deepEqual([pomodoroState(plan, 30 * 60).phase, pomodoroState(plan, 30 * 60).round], ['focus', 2]);
  assert.equal(pomodoroState(plan, 115 * 60).done, true);
  assert.equal(clock(1499), '24:59');
});

test('뽀모도로를 중간에 break하면 끝낸 라운드와 실제 집중한 분만, 끝까지 돌면 전부 기록한다', () => {
  const block = Object.assign(newLabBlock('while'), { cond: '4' });
  startLoop(block, new Date(2026, 9, 1, 9, 0));
  const run = breakLoop(block, new Date(2026, 9, 1, 9, 40)); // 2라운드 집중 10분째
  assert.deepEqual([run.rounds, run.minutes], [1, 35]);
  startLoop(block, new Date(2026, 9, 1, 13, 0));
  const done = finishPomodoro(block, parsePomodoro(block.cond));
  assert.deepEqual([done.rounds, done.minutes, done.completed, block.runningSince], [4, 100, true, '']);
});

test('블록을 공부 기록 루틴·목표 할 일에 이으면 이름이 코드처럼 보이고, 체크·되돌리기가 된다', async () => {
  const { asIdentifier, completeLink, linkCall, linkChoices, linkDone, linkTarget } = await import('../js/lab-model.js');
  const { newStudyBook, routineFields, saveRoutineDefinition, bookProgress } = await import('../js/study-model.js');
  const { emptyData } = await import('../js/state.js');
  const state = emptyData();
  const book = newStudyBook({ name: '응용수리 500제', total: 500, unit: '문제' }); state.studyBooks.push(book);
  const routine = { id: 'r', startDate: '2026-09-28', revisions: [] };
  saveRoutineDefinition(routine, routineFields({ title: '응용수리 20문제', category: 'NCS', days: [1, 2, 3, 4, 5], bookId: book.id, amount: 20 }, state.studyBooks), '2026-09-28');
  state.studyRoutines.push(routine);
  state.goals = [{ id: 'g', title: 'NCS', status: 'doing', tasks: [{ id: 't', text: '기본서 문제해결', done: false }] }];

  assert.equal(asIdentifier('기본서 문제해결 (2회)'), '기본서_문제해결_2회');
  const routineLink = { type: 'routine', id: 'r' }; const taskLink = { type: 'task', goalId: 'g', taskId: 't' };
  assert.deepEqual(linkCall(state, routineLink), { ns: 'routine', name: '응용수리_20문제' });
  assert.deepEqual(linkCall(state, taskLink), { ns: 'goal.NCS', name: '기본서_문제해결' });
  const choices = linkChoices(state, '2026-10-01');
  assert.equal(choices.routines[0].today, true);
  assert.equal(choices.tasks.length, 1);

  const undoRoutine = completeLink(state, routineLink, '2026-10-01');
  assert.equal(linkDone(state, routineLink, '2026-10-01'), true);
  assert.equal(bookProgress(book, state.studyLogs).completed, 20); // 목표 분량이 진도에 쌓인다
  assert.equal(completeLink(state, routineLink, '2026-10-01'), null); // 두 번 체크하지 않는다
  undoRoutine();
  assert.equal(linkDone(state, routineLink, '2026-10-01'), false);
  assert.equal(bookProgress(book, state.studyLogs).completed, 0);

  const undoTask = completeLink(state, taskLink, '2026-10-01');
  assert.equal(state.goals[0].tasks[0].done, true);
  undoTask();
  assert.equal(state.goals[0].tasks[0].done, false);

  state.goals[0].tasks = [];
  assert.equal(linkTarget(state, taskLink), null); // 할 일을 지우면 연결이 끊긴 것으로 본다
  assert.equal(completeLink(state, taskLink, '2026-10-01'), null);
});

test('pause한 동안은 시간이 흐르지 않고, done하면 블록은 치우되 기록은 남는다', async () => {
  const { activeSeconds, finishBlock, liveBlocks, pauseLoop, resumeLoop } = await import('../js/lab-model.js');
  const t = minutes => new Date(2026, 9, 1, 9, minutes);
  const block = Object.assign(newLabBlock('while'), { cond: '4' });
  startLoop(block, t(0));
  pauseLoop(block, t(10));
  assert.equal(activeSeconds(block, t(30)), 600); // 멈춘 20분은 세지 않는다
  resumeLoop(block, t(30));
  assert.equal(activeSeconds(block, t(40)), 1200);
  const run = breakLoop(block, t(40));
  assert.deepEqual([run.minutes, run.rounds], [20, 0]); // 첫 라운드 20분째에 멈춤
  startLoop(block, t(50));
  const state = { labBlocks: [block, newLabBlock('if')] };
  const last = finishBlock(block, t(55));
  assert.equal(last.minutes, 5);
  assert.equal(block.runs.length, 2); // 기록은 그대로
  assert.equal(liveBlocks(state).length, 1); // 편집기에서는 빠진다
});

test('while 15시까지: 시각을 읽고, 그 시각까지 남은 시간을 세고, 그 시각이 되면 기록한다', async () => {
  const { parseUntil, untilDate, untilState, finishUntil, pauseLoop, resumeLoop } = await import('../js/lab-model.js');
  for (const [text, label] of [['15시까지', '15:00'], ['오후 3시 30분까지', '15:30'], ['15:30까지', '15:30'], ['~18:00', '18:00'], ['until 9:05', '09:05'], ['오전 12시까지', '00:00']]) assert.equal(parseUntil(text)?.label, label, text);
  for (const text of ['15시', '3시 회의 전에', '4', '25시까지', '지하철 타는 동안']) assert.equal(parseUntil(text), null, text);
  assert.equal(parsePomodoro('15시까지'), null); // 뽀모도로와 섞이지 않는다

  const at = (h, m = 0) => new Date(2026, 9, 1, h, m);
  assert.equal(untilDate(parseUntil('15시까지'), at(14)).getHours(), 15);
  assert.equal(untilDate(parseUntil('15시까지'), at(16)), null); // 지난 시각은 다음 날로 넘기지 않는다
  assert.equal(untilDate(parseUntil('3시까지'), at(14)).getHours(), 15); // 오전·오후 없이 지난 시각이면 오후로

  const block = Object.assign(newLabBlock('while'), { cond: '15시까지' });
  startLoop(block, at(14)); block.untilAt = at(15).toISOString();
  assert.equal(Math.round(untilState(block, at(14, 30)).progress * 100), 50);
  pauseLoop(block, at(14, 30)); resumeLoop(block, at(14, 40)); // 멈춰도 끝나는 시각은 그대로
  assert.equal(untilState(block, at(14, 40)).left, 20 * 60);
  assert.equal(untilState(block, at(15)).done, true);
  const run = finishUntil(block);
  assert.deepEqual([run.minutes, run.until, run.completed, block.runningSince], [50, '15:00', true, '']); // 멈춘 10분은 뺀다
});
