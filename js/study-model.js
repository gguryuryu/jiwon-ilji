// 공부 기록: 요일별 루틴, 날짜별 완료 기록, 교재의 누적 진도.
import { dateKey, uid } from './util.js';

export const studyUnits = ['쪽', '문제', '강', '단원'];
export const studyDays = [1, 2, 3, 4, 5, 6, 0];
export const studyDayNames = ['일', '월', '화', '수', '목', '금', '토'];
const definitionFields = ['title', 'category', 'target', 'days', 'bookId', 'amount', 'active', 'goalId'];

export function shiftStudyDate(key, days) {
  const [year, month, day] = key.split('-').map(Number);
  return dateKey(new Date(year, month - 1, day + days, 12));
}

export function studyWeek(key) {
  const [year, month, day] = key.split('-').map(Number);
  const weekday = new Date(year, month - 1, day, 12).getDay();
  const monday = shiftStudyDate(key, -((weekday + 6) % 7));
  return studyDays.map((_, index) => shiftStudyDate(monday, index));
}

// 수정·일시정지는 적용일 이후에만 반영한다. 지난 주의 계획은 유지한다.
export function routineOn(routine, date) {
  if (date < routine.startDate) return null;
  const revisions = routine.revisions || [];
  const revision = [...revisions].reverse().find(entry => entry.effectiveDate <= date);
  const definition = revision || (revisions.length ? null : routine);
  if (!definition) return null;
  return { ...definition, id: routine.id, startDate: routine.startDate };
}

export function saveRoutineDefinition(routine, fields, date) {
  const definition = Object.fromEntries(definitionFields.map(key => [key, fields[key]]));
  const history = routine.revisions || [{ effectiveDate: routine.startDate, ...Object.fromEntries(definitionFields.map(key => [key, routine[key]])) }];
  routine.revisions = [...history.filter(entry => entry.effectiveDate !== date), { effectiveDate: date, ...definition }].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  Object.assign(routine, definition, { updatedAt: new Date().toISOString() });
}

export function studyEntries(state, date) {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(year, month - 1, day, 12).getDay();
  return state.studyRoutines.flatMap(routine => {
    const log = state.studyLogs.find(entry => entry.routineId === routine.id && entry.date === date);
    const definition = routineOn(routine, date);
    if (log?.done) return [{ routine, definition: log, log }];
    if (!definition?.active || !definition.days?.includes(weekday)) return [];
    return [{ routine, definition, log }];
  });
}

export function bookProgress(book, logs, { before = '', exclude = '' } = {}) {
  const recorded = logs.filter(log => log.done && log.bookId === book.id && log.id !== exclude && (!before || log.date < before)).reduce((sum, log) => sum + (Number(log.amount) || 0), 0);
  const completed = Math.max(0, Math.min(book.total, book.initialProgress + recorded));
  return { completed, remaining: book.total - completed, percent: Math.round(completed / book.total * 100) };
}

export function newStudyBook(fields) {
  const total = Number(fields.total); const initialProgress = Number(fields.initialProgress || 0);
  if (!fields.name?.trim()) throw new Error('교재 이름을 입력해 주세요.');
  if (!Number.isInteger(total) || total < 1 || total > 1_000_000) throw new Error('전체 분량은 1 이상의 정수로 입력해 주세요.');
  if (!Number.isInteger(initialProgress) || initialProgress < 0 || initialProgress > total) throw new Error('등록 전 진도는 0부터 전체 분량 사이로 입력해 주세요.');
  if (!studyUnits.includes(fields.unit)) throw new Error('진도 단위를 선택해 주세요.');
  const now = new Date().toISOString();
  return { id: uid(), name: fields.name.trim(), subject: fields.subject?.trim() || '', unit: fields.unit, total, initialProgress, createdAt: now, updatedAt: now };
}

export function routineFields(fields, books) {
  const days = [...new Set(fields.days.map(Number))].filter(day => studyDays.includes(day));
  if (!fields.title?.trim()) throw new Error('루틴 이름을 입력해 주세요.');
  if (!days.length) throw new Error('반복할 요일을 하나 이상 선택해 주세요.');
  const category = String(fields.category || '').trim();
  if (!category) throw new Error('구분을 골라 주세요.');
  if (category.length > 20) throw new Error('구분 이름은 20자까지 쓸 수 있어요.');
  const book = books.find(entry => entry.id === fields.bookId);
  if (fields.bookId && !book) throw new Error('연결할 교재를 다시 선택해 주세요.');
  const amount = book ? Number(fields.amount) : 0;
  if (book && (!Number.isInteger(amount) || amount < 1 || amount > book.total)) throw new Error('하루 목표 분량은 1부터 교재 전체 분량 사이로 입력해 주세요.');
  return { title: fields.title.trim(), category, goalId: category === certCategory ? String(fields.goalId || '') : '', target: fields.target?.trim() || '', days, bookId: book?.id || '', amount, active: fields.active !== false };
}

// 루틴·날짜 조합을 ID로 써서 두 창에서 같은 날 체크해도 진도가 중복되지 않는다.
export function recordStudy(state, definition, date, amount = 0) {
  const id = `${definition.id}:${date}`;
  const existing = state.studyLogs.find(log => log.id === id);
  if (existing?.done) return existing;
  const book = state.studyBooks.find(entry => entry.id === definition.bookId);
  if (definition.bookId && !book) throw new Error('연결된 교재를 찾을 수 없어요. 루틴의 교재를 다시 선택해 주세요.');
  const quantity = book ? Number(amount) : 0;
  if (book && (!Number.isInteger(quantity) || quantity < 0 || quantity > bookProgress(book, state.studyLogs).remaining)) throw new Error('공부한 분량이 교재의 남은 분량을 넘지 않게 입력해 주세요.');
  const log = { id, routineId: definition.id, date, title: definition.title, category: definition.category, target: definition.target, bookId: book?.id || '', bookName: book?.name || '', unit: book?.unit || '', amount: quantity, done: true, updatedAt: new Date().toISOString() };
  if (existing) Object.assign(existing, log); else state.studyLogs.push(log);
  return existing || log;
}

// ---------- 루틴 삭제 ----------
// 목록에 보이는 루틴(지운 루틴은 빠진다)
export const liveRoutines = state => state.studyRoutines.filter(routine => !routine.deletedAt);

// 한 번이라도 쓴 루틴(시작일이 지났거나 체크한 적이 있는)은 오늘부터 멈추고 목록에서만 빼서, 지난 기록과 잔디는 그대로 둔다.
// 쓴 적 없는 루틴은 완전히 지운다. 되돌리기 함수를 돌려준다.
export function removeRoutine(state, routine, today) {
  const snapshot = structuredClone(routine);
  const used = routine.startDate < today || state.studyLogs.some(log => log.routineId === routine.id && log.done);
  if (!used) {
    const logs = state.studyLogs.filter(log => log.routineId === routine.id);
    state.studyRoutines = state.studyRoutines.filter(item => item !== routine);
    state.studyLogs = state.studyLogs.filter(log => log.routineId !== routine.id);
    return () => { state.studyRoutines.push(snapshot); state.studyLogs.push(...logs); };
  }
  saveRoutineDefinition(routine, { ...routine, active: false }, today);
  routine.deletedAt = today;
  return () => { for (const key of Object.keys(routine)) delete routine[key]; Object.assign(routine, snapshot); };
}

// ---------- 교재 삭제 ----------
export const liveBooks = state => state.studyBooks.filter(book => !book.deletedAt);

// 교재를 지우면 연결된 루틴은 오늘부터 교재 없이 이어진다(지난 기록의 교재 이름·분량은 그대로).
// 기록이 남은 교재는 목록에서만 빼고, 아무 데도 안 쓴 교재는 완전히 지운다. 되돌리기 함수를 돌려준다.
export function removeBook(state, book, today) {
  const snapshot = structuredClone(book);
  const linked = state.studyRoutines.filter(routine => !routine.deletedAt && routine.bookId === book.id);
  const routineSnapshots = linked.map(routine => [routine, structuredClone(routine)]);
  for (const routine of linked) saveRoutineDefinition(routine, { ...routine, bookId: '', amount: 0 }, today);
  const used = state.studyLogs.some(log => log.bookId === book.id) || state.studyRoutines.some(routine => (routine.revisions || []).some(entry => entry.bookId === book.id));
  if (used) book.deletedAt = today;
  else state.studyBooks = state.studyBooks.filter(item => item !== book);
  return {
    linked: linked.length,
    undo() {
      if (used) { for (const key of Object.keys(book)) delete book[key]; Object.assign(book, snapshot); } else state.studyBooks.push(snapshot);
      for (const [routine, before] of routineSnapshots) { for (const key of Object.keys(routine)) delete routine[key]; Object.assign(routine, before); }
    },
  };
}

// ---------- 잔디 ----------
// 반년(1~6월, 7~12월) 단위로 보여 준다. 지나간 날과 앞으로 올 날이 함께 보여 남은 기간이 가늠된다.
export const mondayOf = key => studyWeek(key)[0];

// offset 0은 오늘이 든 반년, -1은 그 앞 반년.
export function halfYear(today, offset = 0) {
  const [year, month] = today.split('-').map(Number);
  const index = year * 2 + (month > 6 ? 1 : 0) + offset;
  const y = Math.floor(index / 2); const second = index % 2 === 1;
  return { start: `${y}-${second ? '07' : '01'}-01`, end: `${y}-${second ? '12-31' : '06-30'}`, label: `${y}년 ${second ? '7–12월' : '1–6월'}` };
}

// 잔디 범위: 반년의 첫날이 든 주부터 마지막 날이 든 주까지. 깃허브 잔디처럼 한 줄(열)은 일요일에 시작해
// 요일 표시(Mon·Wed·Fri)가 위아래 한 칸씩 띄워 가운데에 온다. 반년 밖의 앞뒤 며칠은 화면에서 비워 둔다.
export const sundayOf = key => { const [year, month, day] = key.split('-').map(Number); return shiftStudyDate(key, -new Date(year, month - 1, day, 12).getDay()); };

export function grassRange(today, offset = 0) {
  const { start, end } = halfYear(today, offset);
  const weeks = [];
  for (let sunday = sundayOf(start); sunday <= end; sunday = shiftStudyDate(sunday, 7)) weeks.push(Array.from({ length: 7 }, (_, day) => shiftStudyDate(sunday, day)));
  return weeks;
}

// ---------- 하루 할 일 ----------
// 루틴과 달리 그날 하루만 하는 일. 잔디와 '완료' 수에는 루틴과 함께 센다.
export const todosOn = (state, date) => (state.studyTodos || []).filter(todo => todo.date === date);

export function addTodo(state, date, text) {
  const value = String(text || '').trim();
  if (!value) return null;
  if (value.length > 100) throw new Error('할 일은 100자까지 쓸 수 있어요.');
  const now = new Date().toISOString();
  const todo = { id: uid(), date, text: value, done: false, createdAt: now, updatedAt: now };
  (state.studyTodos ||= []).push(todo);
  return todo;
}

// 내일로 미루기: 할 일을 다음 날로 옮긴다. 되돌릴 때 쓰도록 원래 날짜를 돌려준다.
export function postponeTodo(todo) {
  const from = todo.date;
  todo.date = shiftStudyDate(from, 1); todo.updatedAt = new Date().toISOString();
  return from;
}

// 그날 루틴·할 일을 얼마나 끝냈는지: 0(안 함)~4(다 함). 예정된 루틴도 할 일도 없는 날은 null(쉬는 날).
export function dayProgress(state, date) {
  const entries = studyEntries(state, date); const todos = todosOn(state, date);
  const done = entries.filter(entry => entry.log?.done).length + todos.filter(todo => todo.done).length;
  const total = entries.length + todos.length;
  if (!total) return { done, total: 0, level: null };
  const ratio = done / total;
  return { done, total, level: !done ? 0 : ratio < 1 / 3 ? 1 : ratio < 2 / 3 ? 2 : ratio < 1 ? 3 : 4 };
}

// 이번 주 루틴: 아직 오지 않은 요일은 빼고 오늘까지 할 것만 센다(주 초반에도 막대가 제대로 보이게).
export const weekProgress = (state, today) => studyWeek(today).filter(date => date <= today).reduce((sum, date) => { const { done, total } = dayProgress(state, date); return { done: sum.done + done, total: sum.total + total }; }, { done: 0, total: 0 });

// ---------- 구분 ----------
// 기본 구분 셋에, 루틴에서 직접 만든 구분이 뒤에 붙는다. 직접 만든 구분은 쓰는 루틴이 없어지면 저절로 빠진다.
export const certCategory = '자격증';

export const defaultCategories = ['NCS', '전공', certCategory];

export function studyCategories(state) {
  const custom = liveRoutines(state).map(routine => routine.category).filter(Boolean);
  return [...new Set([...defaultCategories, ...custom])];
}

// 구분마다 지원 현황 태그 색을 차례로 붙인다.
const categoryPalette = ['blue', 'purple', 'teal', 'orange', 'pink', 'yellow', 'green', 'brown', 'red'];

export function categoryColor(state, category) {
  const index = studyCategories(state).indexOf(category);
  return categoryPalette[(index < 0 ? categoryPalette.length - 1 : index) % categoryPalette.length];
}

// 목표 보드의 목표 옆에 보여 줄 오늘 루틴 수: 목표 이름에 구분 이름이 들어 있으면 그 구분, '필기'가 들어 있으면 전부.
export function studyCategoryFor(state, title) {
  const text = String(title || '').toLocaleLowerCase();
  const match = studyCategories(state).filter(category => text.includes(category.toLocaleLowerCase())).sort((a, b) => b.length - a.length)[0];
  return match ?? (text.includes('필기') ? '' : null);
}

// 자격증 루틴을 이을 수 있는 목표: 목표 보드의 진행 중·남은 자격증 목표
export const certGoals = state => (state.goals || []).filter(goal => goal.kind === 'cert' && goal.status !== 'done');

// 이 목표에 이은 루틴(지운 루틴은 빼고)
export const linkedRoutines = (state, goalId) => liveRoutines(state).filter(routine => routine.goalId === goalId);

// 그날 이 목표에 이은 루틴을 얼마나 했는지
export function goalRoutinesOn(state, date, goalId) {
  const entries = studyEntries(state, date).filter(entry => entry.routine.goalId === goalId);
  return { done: entries.filter(entry => entry.log?.done).length, total: entries.length };
}

export function todayRoutines(state, date, category = '') {
  const entries = studyEntries(state, date).filter(entry => !category || entry.definition.category === category);
  return { done: entries.filter(entry => entry.log?.done).length, total: entries.length };
}

// 처음 시작할 때 한 번에 채우는 기본 계획(공기업 전산직 필기). 채운 뒤에는 루틴·교재를 자유롭게 고치고 지운다.
export function addStarterPlan(state, date) {
  const book = newStudyBook({ name: '독끝 NCS 응용수리 500제', subject: 'NCS 수리', unit: '문제', total: 500, initialProgress: 0 });
  state.studyBooks.push(book);
  const weekdays = [1, 2, 3, 4, 5];
  const plan = [
    { title: '민경채 15문제', category: 'NCS', days: weekdays, target: '언어논리5·자료해석5·상황판단5, 문제당 2분 30초' },
    { title: '민경채 해설 분석 + 오답노트', category: 'NCS', days: weekdays },
    { title: '응용수리 20문제', category: 'NCS', days: weekdays, bookId: book.id, amount: 20 },
    { title: '전공 이론 1챕터 + 해당 기출', category: '전공', days: weekdays, target: '박미진 컴퓨터일반' },
    { title: '오늘 틀린 문제 다시 풀기', category: 'NCS', days: weekdays },
    { title: '모의고사 1회', category: 'NCS', days: [6] },
  ];
  for (const fields of plan) {
    const routine = { id: uid(), startDate: date, revisions: [], createdAt: new Date().toISOString() };
    saveRoutineDefinition(routine, routineFields(fields, state.studyBooks), date);
    state.studyRoutines.push(routine);
  }
}
