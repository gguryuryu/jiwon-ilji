// 브라우저 쪽의 화면과 상관없는 로직: 시각 해석, 충돌 합치기, 캘린더 파일 읽기, 예전 데이터 옮기기
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, escapeHtml, charCount, formatDateLong, clone } from '../js/util.js';
import { mergeInto } from '../js/merge.js';
import { parseIcs } from '../js/ics.js';
import { essayToQuestions, migrate, isPostingEvent, shownTime, groupFor, speakingTime, askedQuestions, reviewRound, defaultDetailTab, goalProgress, monthLabel, splitCertTitle, isLanguageTest, addMonths } from '../js/model.js';
import { data, experienceUses } from '../js/state.js';

test('시각 입력을 여러 모양으로 받아 HH:MM으로 바꾼다', () => {
  const cases = { '14:30': '14:30', '1430': '14:30', '930': '09:30', '9': '09:00', '오후 2시 30분': '14:30', '오후 2시': '14:00', '2:30pm': '14:30', '오전 12:10': '00:10', '23:59': '23:59', '': '' };
  for (const [input, expected] of Object.entries(cases)) assert.equal(parseTime(input), expected, input);
  for (const input of ['25:00', '12:60', 'abc', '99시']) assert.equal(parseTime(input), null, input);
});

test('HTML 특수 문자를 이스케이프한다', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
});

test('자소서 글자 수: 공백 포함·제외', () => {
  assert.deepEqual(charCount('가나 다\n라'), { withSpaces: 6, withoutSpaces: 4 });
  assert.deepEqual(charCount('😀 a'), { withSpaces: 3, withoutSpaces: 2 }, '이모지는 한 글자');
});

test('날짜에 요일을 붙이고 올해가 아니면 연도를 붙인다', () => {
  assert.equal(formatDateLong('2020-03-01'), '2020년 3월 1일 (일)');
  assert.equal(formatDateLong('잘못된 값'), '');
});

// ---------- 저장 충돌 합치기 ----------
const base = () => ({
  postings: [{ id: 'a', organization: 'A공사', role: '사무', status: '관심' }, { id: 'b', organization: 'B공단', role: '전산', status: '관심' }],
  experiences: [{ id: 'e', name: '동아리' }],
  calendarEvents: [{ id: 'g1', title: '일정' }],
});

test('서로 다른 공고를 고치면 둘 다 남는다', () => {
  const local = base(); local.postings[0].role = '이 창';
  const server = base(); server.postings[1].role = '다른 창';
  mergeInto(local, base(), server);
  assert.equal(local.postings[0].role, '이 창');
  assert.equal(local.postings[1].role, '다른 창');
});

test('같은 공고의 다른 칸을 고치면 두 칸 모두 남는다', () => {
  const local = base(); local.postings[0].status = '지원 완료';
  const server = base(); server.postings[0].role = '행정';
  mergeInto(local, base(), server);
  assert.deepEqual(local.postings[0], { id: 'a', organization: 'A공사', role: '행정', status: '지원 완료' });
});

test('같은 칸을 둘 다 고치면 이 창 값이 남는다', () => {
  const local = base(); local.postings[0].role = '이 창';
  const server = base(); server.postings[0].role = '다른 창';
  mergeInto(local, base(), server);
  assert.equal(local.postings[0].role, '이 창');
});

test('다른 창에서 추가한 것은 들어오고, 지운 것은 여기서 안 고쳤을 때만 지운다', () => {
  const server = base(); server.postings.push({ id: 'c', organization: '새 공고' }); server.postings = server.postings.filter(p => p.id !== 'b');
  const local = base();
  mergeInto(local, base(), server);
  assert.deepEqual(local.postings.map(p => p.id), ['a', 'c']);
  const edited = base(); edited.postings[1].role = '고침';
  mergeInto(edited, base(), server);
  assert.ok(edited.postings.some(p => p.id === 'b'), '여기서 고친 공고는 지우지 않는다');
});

test('합칠 때 편집 중인 객체를 바꾸지 않고 그 안에 합친다', () => {
  const local = base(); const held = local.postings[0];
  const server = base(); server.postings[0].role = '다른 창';
  mergeInto(local, base(), server);
  assert.equal(local.postings[0], held);
  assert.equal(held.role, '다른 창');
});

test('캘린더 일정은 이 창에서 안 바꿨으면 서버 것을 쓴다', () => {
  const server = base(); server.calendarEvents = [{ id: 'g2', title: '새 일정' }];
  const local = base();
  mergeInto(local, base(), server);
  assert.deepEqual(local.calendarEvents, [{ id: 'g2', title: '새 일정' }]);
  assert.notEqual(local.calendarEvents, server.calendarEvents, '복사해서 넣는다');
});

// ---------- 캘린더 파일(.ics) ----------
const ics = lines => ['BEGIN:VCALENDAR', ...lines, 'END:VCALENDAR'].join('\r\n');

test('종일 일정의 끝 날짜는 하루를 빼고, UTC 시각은 한국 시각으로 바꾼다', () => {
  const [allDay, timed] = parseIcs(ics([
    'BEGIN:VEVENT', 'UID:x1', 'SUMMARY:접수 기간', 'DTSTART;VALUE=DATE:20260923', 'DTEND;VALUE=DATE:20261001', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:x2', 'SUMMARY:면접', 'DTSTART:20260930T050000Z', 'END:VEVENT',
  ]), 'google');
  assert.equal(allDay.date, '2026-09-23');
  assert.equal(allDay.endDate, '2026-09-30');
  assert.equal(allDay.id, 'google:x1');
  assert.equal(timed.date, '2026-09-30');
  assert.equal(timed.time, '14:00');
});

test('취소된 일정은 빼고, 반복 일정에서 따로 고친 회차는 따로 센다', () => {
  const events = parseIcs(ics([
    'BEGIN:VEVENT', 'UID:r', 'SUMMARY:회의', 'DTSTART;VALUE=DATE:20261001', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:r', 'RECURRENCE-ID:20261008', 'SUMMARY:회의(변경)', 'DTSTART;VALUE=DATE:20261009', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:c', 'STATUS:CANCELLED', 'SUMMARY:취소', 'DTSTART;VALUE=DATE:20261002', 'END:VEVENT',
  ]));
  assert.deepEqual(events.map(event => event.id), ['r', 'r:20261008']);
});

test('설명 속 링크를 일정 링크로 쓰고, 줄 바꿈·쉼표 이스케이프를 푼다', () => {
  const [event] = parseIcs(ics(['BEGIN:VEVENT', 'UID:u', 'SUMMARY:공고\\, 마감', 'DESCRIPTION:직무: 전산\\n링크: https://example.com/p?id=1.', 'DTSTART;VALUE=DATE:20261001', 'END:VEVENT']));
  assert.equal(event.title, '공고, 마감');
  assert.equal(event.description, '직무: 전산\n링크: https://example.com/p?id=1.');
  assert.equal(event.url, 'https://example.com/p?id=1');
});

// ---------- 데이터 모양 ----------
test('예전 자유 문서형 자소서를 # 제목 기준으로 문항으로 나눈다', () => {
  const questions = essayToQuestions('# 지원 동기\n\n첫 문단\n\n## 소제목\n둘째 줄\n# 입사 후 포부\n포부');
  assert.deepEqual(questions.map(q => [q.title, q.answer]), [['지원 동기', '첫 문단\n소제목\n둘째 줄'], ['입사 후 포부', '포부']]);
});

test('불러올 때 빈 경험은 정리하고 자소서를 문항으로 옮긴다', () => {
  const value = migrate({ postings: [{ id: 'p', essay: '# 문항\n답' }], experiences: [{ id: 'blank', name: '', keywords: [] }, { id: 'kept', name: '동아리', keywords: [] }], calendarEvents: [] });
  assert.deepEqual(value.experiences.map(e => e.id), ['kept']);
  assert.equal(value.postings[0].questions[0].title, '문항');
  assert.equal('essay' in value.postings[0], false);
  assert.deepEqual([value.postings[0].interviewQuestions, value.postings[0].interviewReviews], [[], []], '면접 준비·후기 칸을 만든다');
});

test('개인 일정과 공고 일정을 구분하고, 공고의 00:00은 시각 미공개로 본다', () => {
  assert.equal(isPostingEvent({ source: 'google', title: 'Off', description: '' }), false);
  assert.equal(isPostingEvent({ source: 'google', title: 'LG', description: '직무: NW기술' }), true);
  assert.equal(shownTime({ source: 'google', time: '00:00' }), '');
  assert.equal(shownTime({ source: 'local', time: '00:00' }), '00:00');
});

test('진행 상태를 진행 중·관심·종료로 묶는다', () => {
  assert.equal(groupFor({ status: '1차 면접 예정' }), 'active');
  assert.equal(groupFor({ status: '필기 전형 예정' }), 'active');
  assert.equal(groupFor({ status: '필기 불합격' }), 'done');
  assert.equal(groupFor({ status: '자소서 작성 중' }), 'interest');
  assert.equal(groupFor({ status: '최종 합격' }), 'done');
  assert.deepEqual(clone({ a: [1] }), { a: [1] });
});

// ---------- 면접 준비·후기 ----------
test('답변을 말하는 시간을 어림한다(1분에 약 330자)', () => {
  assert.equal(speakingTime(''), '');
  assert.equal(speakingTime('가'.repeat(55)), '약 10초');
  assert.equal(speakingTime('가'.repeat(330)), '약 1분');
  assert.equal(speakingTime('가'.repeat(413)), '약 1분 15초');
});

test('받은 질문을 한 줄에 하나씩 읽고 앞의 목록 표시를 뗀다', () => {
  assert.deepEqual(askedQuestions('- 자기소개\n2) 지원 동기\n\n • 마지막 한마디 '), ['자기소개', '지원 동기', '마지막 한마디']);
});

test('후기 제목은 다음 일정이나 진행 상태로 미리 채운다', () => {
  const format = date => date.slice(5);
  assert.equal(reviewRound({ nextLabel: '1차 면접', nextDate: '2026-10-02', status: '1차 면접 예정' }, format), '1차 면접 · 10-02');
  assert.equal(reviewRound({ nextLabel: '서류 결과', nextDate: '2026-10-02', status: '2차 면접 예정' }, format), '2차 면접');
  assert.equal(reviewRound({ status: '지원 완료' }, format), '');
});

test('진행 상태에 맞는 탭을 먼저 연다', () => {
  assert.equal(defaultDetailTab({ status: '1차 면접 예정' }), 'interview');
  assert.equal(defaultDetailTab({ status: '최종 결과 대기' }), 'review');
  assert.equal(defaultDetailTab({ status: '관심' }), 'essay');
});

test('경험을 쓴 곳에 자소서 문항과 면접 질문을 모두 센다', () => {
  data.postings = [{ id: 'p', questions: [{ title: '지원 동기', experienceIds: ['e'] }], interviewQuestions: [{ title: '갈등 경험', experienceIds: ['e'] }] }];
  assert.deepEqual(experienceUses('e').map(use => [use.kind, use.question.title]), [['essay', '지원 동기'], ['interview', '갈등 경험']]);
  data.postings = [];
});

// ---------- 홈: 목표 ----------
test('목표 진행률: 할 일이 있으면 끝낸 비율, 없으면 직접 정한 값, 완료면 100%', () => {
  assert.deepEqual(goalProgress({ status: 'doing', tasks: [{ done: true }, { done: false }, { done: true }], progress: 90 }), { done: 2, total: 3, percent: 67 });
  assert.equal(goalProgress({ status: 'doing', tasks: [], progress: 40 }).percent, 40);
  assert.equal(goalProgress({ status: 'doing', tasks: [], progress: 140 }).percent, 100);
  assert.equal(goalProgress({ status: 'done', tasks: [{ done: false }] }).percent, 100);
});

test('목표 시기를 달로 보여 준다(올해가 아니면 연도까지)', () => {
  const year = new Date().getFullYear();
  assert.equal(monthLabel(`${year}-10`), '10월');
  assert.equal(monthLabel(`${year + 1}-03`), `${year + 1}년 3월`);
  assert.equal(monthLabel(''), '');
});

test('불러올 때 목표·자격 목록을 만들고, 충돌 때 다른 창의 목표도 합친다', () => {
  const value = migrate({ postings: [], experiences: [], calendarEvents: [] });
  assert.deepEqual([value.goals, value.certs], [[], []]);
  const local = { postings: [], experiences: [], calendarEvents: [], goals: [{ id: 'g', title: '토익', status: 'doing' }], certs: [] };
  const baseValue = { postings: [], experiences: [], calendarEvents: [], goals: [{ id: 'g', title: '토익', status: 'todo' }], certs: [] };
  const server = { postings: [], experiences: [], calendarEvents: [], goals: [{ id: 'g', title: '토익 900', status: 'todo' }], certs: [{ id: 'c', name: 'SQLD' }] };
  mergeInto(local, baseValue, server);
  assert.deepEqual(local.goals[0], { id: 'g', title: '토익 900', status: 'doing' });
  assert.deepEqual(local.certs.map(cert => cert.name), ['SQLD']);
});

test('자격증 목표 이름에서 자격 이름과 등급·점수를 나눈다', () => {
  assert.deepEqual(splitCertTitle('토익스피킹 IH'), { name: '토익스피킹', score: 'IH' });
  assert.deepEqual(splitCertTitle('한국사능력검정 1급 취득'), { name: '한국사능력검정', score: '1급' });
  assert.deepEqual(splitCertTitle('TOEIC 900점 이상'), { name: 'TOEIC', score: '900점' });
  assert.deepEqual(splitCertTitle('OPIc IM2 달성'), { name: 'OPIc', score: 'IM2' });
  assert.deepEqual(splitCertTitle('정보처리기사 실기 합격'), { name: '정보처리기사 실기', score: '' });
});

test('어학 성적을 알아보고, 유효기간은 달 단위로 더한다', () => {
  assert.equal(isLanguageTest('TOEIC'), true);
  assert.equal(isLanguageTest('토익스피킹'), true);
  assert.equal(isLanguageTest('정보처리기사'), false);
  assert.equal(addMonths('2026-03', 24), '2028-03');
  assert.equal(addMonths('2026-11', 3), '2027-02');
  assert.equal(addMonths('', 3), '');
});
