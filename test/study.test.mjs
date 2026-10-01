import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyData } from '../js/state.js';
import { migrate } from '../js/model.js';
import { mergeInto } from '../js/merge.js';
import { addStarterPlan, bookProgress, categoryColor, certGoals, goalRoutinesOn, linkedRoutines, dayProgress, grassRange, halfYear, liveBooks, liveRoutines, newStudyBook, removeBook, removeRoutine, studyCategories, studyCategoryFor, todayRoutines, recordStudy, routineFields, routineOn, saveRoutineDefinition, shiftStudyDate, studyEntries, studyWeek, weekProgress } from '../js/study-model.js';

const makeRoutine = (state, { id = 'r', startDate = '2026-10-01', ...changes } = {}) => {
  const fields = routineFields({ title: '기출 풀이', category: '전공', days: [1, 2, 3, 4, 5], amount: 20, bookId: state.studyBooks[0]?.id, ...changes }, state.studyBooks);
  const routine = { id, startDate, revisions: [] };
  saveRoutineDefinition(routine, fields, startDate); state.studyRoutines.push(routine); return routine;
};
const makeState = () => {
  const state = emptyData();
  state.studyBooks.push(newStudyBook({ name: '데이터베이스', total: 100, initialProgress: 30, unit: '쪽' }));
  return state;
};

test('예전 백업도 필기 기록을 위한 빈 목록으로 시작한다', () => {
  const data = migrate({ version: 1, postings: [], experiences: [], calendarEvents: [] });
  for (const key of ['studyRoutines', 'studyBooks', 'studyLogs']) assert.deepEqual(data[key], []);
  const trial = migrate({ postings: [], experiences: [], studyChapters: [{ id: 'c', title: '운영체제', doneAt: '' }], studyDays: [{ id: '2026-10-01', psat: 1, math: 1, mistakes: { concept: 0 } }, { id: '2026-10-02', psat: 15, mistakes: { time: 2 } }] });
  assert.equal(trial.studyChapters, undefined);
  assert.equal(trial.studyDays, undefined);
});

test('반복 요일과 시작일을 지키고, 지난 미완료가 다음 날에 쌓이지 않는다', () => {
  const state = makeState(); makeRoutine(state);
  assert.equal(studyEntries(state, '2026-09-30').length, 0);
  assert.equal(studyEntries(state, '2026-10-01').length, 1);
  assert.equal(studyEntries(state, '2026-10-02').length, 1);
  assert.equal(studyEntries(state, '2026-10-03').length, 0);
});

test('루틴을 수정하거나 정지해도 과거 계획과 완료 기록을 바꾸지 않는다', () => {
  const state = makeState(); const routine = makeRoutine(state);
  recordStudy(state, routineOn(routine, '2026-10-01'), '2026-10-01', 15);
  saveRoutineDefinition(routine, { ...routine, title: '다른 교재', active: false }, '2026-10-02');
  assert.equal(studyEntries(state, '2026-10-02').length, 0);
  const historical = studyEntries(state, '2026-10-01')[0];
  assert.equal(historical.definition.title, '기출 풀이');
  assert.equal(historical.log.amount, 15);
  saveRoutineDefinition(routine, { ...routine, active: true }, '2026-10-05');
  assert.equal(studyEntries(state, '2026-10-02').length, 0);
  assert.equal(studyEntries(state, '2026-10-05').length, 1);
});

test('목표보다 적은 실제 분량, 취소와 재체크, 완료 상한을 계산한다', () => {
  const state = makeState(); const routine = makeRoutine(state); const definition = routineOn(routine, '2026-10-01');
  const log = recordStudy(state, definition, '2026-10-01', 15);
  assert.deepEqual(bookProgress(state.studyBooks[0], state.studyLogs), { completed: 45, remaining: 55, percent: 45 });
  recordStudy(state, definition, '2026-10-01', 15);
  assert.equal(state.studyLogs.length, 1);
  log.done = false;
  assert.equal(bookProgress(state.studyBooks[0], state.studyLogs).completed, 30);
  recordStudy(state, definition, '2026-10-01', 10);
  assert.equal(bookProgress(state.studyBooks[0], state.studyLogs).completed, 40);
  assert.throws(() => recordStudy(state, definition, '2026-10-02', 61), /남은 분량/);
  recordStudy(state, definition, '2026-10-02', 60);
  assert.equal(bookProgress(state.studyBooks[0], state.studyLogs).percent, 100);
  recordStudy(state, definition, '2026-10-05', 0);
  assert.equal(bookProgress(state.studyBooks[0], state.studyLogs).percent, 100);
});

test('목표와 교재의 잘못된 분량, 빈 요일을 저장하지 않는다', () => {
  assert.throws(() => newStudyBook({ name: '책', total: 10, initialProgress: 20, unit: '쪽' }));
  assert.throws(() => newStudyBook({ name: '책', total: 0, unit: '쪽' }));
  assert.throws(() => routineFields({ title: '수리', category: 'NCS', days: [] }, []));
  const state = makeState();
  assert.throws(() => makeRoutine(state, { amount: -1 }));
});

test('교재 없는 NCS 루틴도 독립적으로 완료하고 다음 날에는 새로 시작한다', () => {
  const state = emptyData(); const routine = makeRoutine(state, { category: 'NCS', target: '수리 20문제' });
  recordStudy(state, routineOn(routine, '2026-10-01'), '2026-10-01');
  assert.equal(studyEntries(state, '2026-10-01')[0].log.done, true);
  assert.equal(studyEntries(state, '2026-10-02')[0].log, undefined);
});

test('두 창의 공부 기록을 합쳐도 같은 날짜·루틴의 진도를 중복하지 않는다', () => {
  const state = makeState(); makeRoutine(state);
  const base = structuredClone(state); const other = structuredClone(state);
  recordStudy(state, routineOn(state.studyRoutines[0], '2026-10-01'), '2026-10-01', 15);
  recordStudy(other, routineOn(other.studyRoutines[0], '2026-10-01'), '2026-10-01', 15);
  recordStudy(other, routineOn(other.studyRoutines[0], '2026-10-02'), '2026-10-02', 20);
  mergeInto(state, base, other);
  assert.equal(state.studyLogs.length, 2);
  assert.equal(bookProgress(state.studyBooks[0], state.studyLogs).completed, 65);
});

test('월말·연말·일요일에도 주간 날짜를 올바르게 이동한다', () => {
  assert.deepEqual(studyWeek('2026-10-04'), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.equal(shiftStudyDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftStudyDate('2028-03-01', -1), '2028-02-29');
});

test('잔디 진하기는 그날 루틴을 끝낸 비율이고, 예정된 루틴이 없는 날은 쉬는 날이다', () => {
  const state = emptyData();
  const a = makeRoutine(state, { id: 'a', category: 'NCS' }); makeRoutine(state, { id: 'b', category: 'NCS' }); makeRoutine(state, { id: 'c', category: 'NCS' });
  assert.deepEqual(dayProgress(state, '2026-10-01'), { done: 0, total: 3, level: 0 });
  recordStudy(state, routineOn(a, '2026-10-01'), '2026-10-01');
  assert.equal(dayProgress(state, '2026-10-01').level, 2);
  for (const id of ['b', 'c']) recordStudy(state, routineOn(state.studyRoutines.find(r => r.id === id), '2026-10-01'), '2026-10-01');
  assert.equal(dayProgress(state, '2026-10-01').level, 4);
  assert.equal(dayProgress(state, '2026-10-04').level, null); // 일요일: 루틴 없음
  assert.deepEqual(weekProgress(state, '2026-10-01'), { done: 3, total: 3 }); // 아직 오지 않은 금요일은 세지 않는다
  assert.deepEqual(weekProgress(state, '2026-10-02'), { done: 3, total: 6 });
});

test('잔디는 반년(1~6월, 7~12월) 단위로, 첫날이 든 주부터 마지막 날이 든 주까지 보여 준다', () => {
  assert.deepEqual(halfYear('2026-10-01'), { start: '2026-07-01', end: '2026-12-31', label: '2026년 7–12월' });
  assert.deepEqual(halfYear('2026-10-01', -1), { start: '2026-01-01', end: '2026-06-30', label: '2026년 1–6월' });
  assert.deepEqual(halfYear('2026-03-15', -1), { start: '2025-07-01', end: '2025-12-31', label: '2025년 7–12월' });
  const weeks = grassRange('2026-10-01');
  assert.equal(weeks[0][0], '2026-06-28'); // 7월 1일(수)이 든 주의 일요일(깃허브처럼 일요일 시작)
  assert.equal(weeks.at(-1)[0], '2026-12-27'); // 12월 31일(목)이 든 주
  assert.ok(weeks.every(week => new Date(`${week[0]}T12:00`).getDay() === 0));
  assert.equal(weeks.length, 27);
  const days = weeks.flat();
  assert.ok(days.slice(1).every((day, index) => day === shiftStudyDate(days[index], 1)));
  assert.ok(days.includes('2026-10-01'));
});

test('목표 제목으로 필기 공부 루틴 묶음을 고르고 오늘 한 수를 센다', () => {
  const state = emptyData();
  assert.deepEqual(['NCS', '전공', '필기 준비', '토익 850', '정보처리기사 자격증'].map(title => studyCategoryFor(state, title)), ['NCS', '전공', '', null, '자격증']); const ncs = makeRoutine(state, { id: 'n', category: 'NCS' }); makeRoutine(state, { id: 'm', category: '전공' });
  recordStudy(state, routineOn(ncs, '2026-10-01'), '2026-10-01');
  assert.deepEqual(todayRoutines(state, '2026-10-01', 'NCS'), { done: 1, total: 1 });
  assert.deepEqual(todayRoutines(state, '2026-10-01', '전공'), { done: 0, total: 1 });
  assert.deepEqual(todayRoutines(state, '2026-10-01'), { done: 1, total: 2 });
});

test('전산직 필기 계획으로 시작하면 평일 루틴 5개와 토요일 모의고사, 응용수리 교재가 생긴다', () => {
  const state = emptyData(); addStarterPlan(state, '2026-10-01');
  assert.equal(state.studyBooks[0].total, 500);
  assert.equal(studyEntries(state, '2026-10-01').length, 5);
  assert.deepEqual(studyEntries(state, '2026-10-03').map(entry => entry.definition.title), ['모의고사 1회']);
  assert.equal(studyEntries(state, '2026-10-04').length, 0);
  const math = state.studyRoutines.find(routine => routine.bookId);
  recordStudy(state, routineOn(math, '2026-10-01'), '2026-10-01', 20);
  assert.equal(bookProgress(state.studyBooks[0], state.studyLogs).completed, 20);
});

test('루틴을 지우면 쓴 적 있는 루틴은 지난 기록을 남기고 오늘부터 빠지고, 쓴 적 없는 루틴은 완전히 지워진다', () => {
  const state = emptyData();
  const used = makeRoutine(state, { id: 'used', category: 'NCS', startDate: '2026-09-28' });
  recordStudy(state, routineOn(used, '2026-09-29'), '2026-09-29');
  const fresh = makeRoutine(state, { id: 'fresh', category: 'NCS', startDate: '2026-10-01' });
  const undoUsed = removeRoutine(state, used, '2026-10-01');
  assert.deepEqual(liveRoutines(state).map(routine => routine.id), ['fresh']);
  assert.equal(dayProgress(state, '2026-09-29').done, 1); // 지난 잔디는 그대로
  assert.equal(dayProgress(state, '2026-09-30').total, 2 - 1); // 지난 날 계획도 그대로(fresh는 10/1 시작)
  assert.equal(studyEntries(state, '2026-10-02').some(entry => entry.routine.id === 'used'), false); // 오늘부터는 빠진다
  removeRoutine(state, fresh, '2026-10-01');
  assert.equal(state.studyRoutines.some(routine => routine.id === 'fresh'), false);
  undoUsed();
  assert.deepEqual(liveRoutines(state).map(routine => routine.id), ['used']);
  assert.equal(studyEntries(state, '2026-10-02').some(entry => entry.routine.id === 'used'), true);
});

test('교재를 지우면 연결된 루틴은 오늘부터 교재 없이 이어지고, 지난 기록과 되돌리기는 유지된다', () => {
  const state = makeState(); const book = state.studyBooks[0];
  const routine = makeRoutine(state, { startDate: '2026-09-28' });
  recordStudy(state, routineOn(routine, '2026-09-29'), '2026-09-29', 10);
  const { linked, undo } = removeBook(state, book, '2026-10-01');
  assert.equal(linked, 1);
  assert.deepEqual(liveBooks(state), []);
  assert.equal(routineOn(routine, '2026-10-01').bookId, '');
  assert.equal(routineOn(routine, '2026-09-29').bookId, book.id); // 지난 계획은 그대로
  recordStudy(state, routineOn(routine, '2026-10-01'), '2026-10-01'); // 교재 없이 체크된다
  assert.equal(state.studyLogs.find(log => log.date === '2026-09-29').bookName, '데이터베이스');
  undo();
  assert.equal(liveBooks(state).length, 1);
  assert.equal(routineOn(routine, '2026-10-02').bookId, book.id);
  const unused = newStudyBook({ name: '안 쓴 책', total: 10, unit: '쪽' }); state.studyBooks.push(unused);
  removeBook(state, unused, '2026-10-01');
  assert.equal(state.studyBooks.includes(unused), false);
});

test('구분은 기본 셋(NCS·전공·자격증)에 직접 만든 구분이 붙고, 쓰는 루틴이 없어지면 빠진다', () => {
  const state = emptyData();
  assert.deepEqual(studyCategories(state), ['NCS', '전공', '자격증']);
  const sqld = makeRoutine(state, { id: 's', category: 'SQLD' });
  assert.deepEqual(studyCategories(state), ['NCS', '전공', '자격증', 'SQLD']);
  assert.equal(categoryColor(state, 'NCS'), 'blue');
  assert.equal(categoryColor(state, 'SQLD'), 'orange');
  assert.equal(studyCategoryFor(state, 'SQLD 합격'), 'SQLD');
  assert.throws(() => routineFields({ title: '빈 구분', category: '  ', days: [1] }, []), /구분/);
  removeRoutine(state, sqld, '2026-10-01');
  assert.deepEqual(studyCategories(state), ['NCS', '전공', '자격증']);
});

test('자격증 루틴은 목표 보드의 자격증 목표에 이을 수 있고, 다른 구분이면 연결이 빠진다', () => {
  const state = emptyData();
  state.goals = [{ id: 'g1', kind: 'cert', status: 'todo', title: 'SQLD' }, { id: 'g2', kind: 'cert', status: 'done', title: '정보처리기사' }, { id: 'g3', kind: 'goal', status: 'doing', title: 'NCS' }];
  assert.deepEqual(certGoals(state).map(goal => goal.id), ['g1']);
  const routine = makeRoutine(state, { id: 'r1', category: '자격증', goalId: 'g1' });
  assert.equal(routine.goalId, 'g1');
  assert.deepEqual(linkedRoutines(state, 'g1').map(item => item.id), ['r1']);
  assert.deepEqual(goalRoutinesOn(state, '2026-10-01', 'g1'), { done: 0, total: 1 });
  recordStudy(state, routineOn(routine, '2026-10-01'), '2026-10-01');
  assert.deepEqual(goalRoutinesOn(state, '2026-10-01', 'g1'), { done: 1, total: 1 });
  assert.equal(routineFields({ title: 'x', category: 'NCS', goalId: 'g1', days: [1] }, []).goalId, '');
  removeRoutine(state, routine, '2026-10-02');
  assert.deepEqual(linkedRoutines(state, 'g1'), []);
});
