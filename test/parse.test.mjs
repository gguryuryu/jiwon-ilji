// 공고 페이지·캘린더 일정에서 회사·직무·마감일을 읽는 서버 쪽 함수들
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  titleParts, cleanRole, cleanOrganization, normalizedEmployment, employmentKinds,
  normalizedDate, normalizedTime, parseEventFields, pageTitleParts, textDeadline, privateAddress, eventText,
} from '../lib/parse.mjs';

test('일정 제목에서 회사와 직무를 나눈다', () => {
  const cases = [
    ['LG유플러스 | NW기술', 'LG유플러스', 'NW기술'],
    ['[한국수자원공사] 행정직 신입 채용', '한국수자원공사', '행정직'],
    ['[마감] 국민건강보험공단 - 행정직 6급', '국민건강보험공단', '행정직 6급'],
    ['한국철도공사 경영지원 채용 마감', '한국철도공사', '경영지원'],
    ['카카오 · 프론트엔드 개발자', '카카오', '프론트엔드 개발자'],
    ['LG전자 채용', 'LG전자', ''],
  ];
  for (const [title, organization, role] of cases) {
    const parts = titleParts(title);
    assert.equal(parts.organization, organization, title);
    assert.equal(parts.role, role, title);
  }
});

test('직무에서 연도·차수·인원 같은 군더더기를 걷어낸다', () => {
  assert.equal(cleanRole('2026년 하반기 신입채용 — NW기술'), 'NW기술');
  assert.equal(cleanRole('2026년도 하반기 신규직원 — 전산직 6급가 (8명)'), '전산직 6급가');
  assert.equal(cleanRole('일반직 6급 정보보호 및 정보기술관리 (3명)'), '일반직 6급 정보보호 및 정보기술관리');
  assert.equal(cleanRole('2026년도 제3차 4직급 신입직원 IT(일반)'), '4직급 신입직원 IT(일반)');
  assert.equal(cleanRole('사무 신입/경력 채용'), '사무');
});

test('기관 이름 앞뒤의 법인 표기를 뗀다', () => {
  assert.equal(cleanOrganization('(재)우체국금융개발원'), '우체국금융개발원');
  assert.equal(cleanOrganization('주식회사 카카오'), '카카오');
  assert.equal(cleanOrganization('한국전력공사'), '한국전력공사');
});

test('고용형태: 먼저 나온 것을 고르고, 인턴십 전형은 인턴이 아니다', () => {
  assert.equal(normalizedEmployment('정규직 및 무기계약직 신입'), '정규직');
  assert.equal(normalizedEmployment('채용형 인턴 신입(정규직 공채)'), '인턴');
  assert.equal(normalizedEmployment('신입사원 공개채용(2차 면접 합격 후 인턴십 전형)'), '');
  assert.equal(normalizedEmployment('FULL_TIME'), '정규직');
  assert.deepEqual(employmentKinds('무기계약직, 정규직'), ['무기계약직', '정규직']);
});

test('날짜·시각을 표준 모양으로 바꾸고, 없는 날짜는 거른다', () => {
  assert.equal(normalizedDate('2026.9.30'), '2026-09-30');
  assert.equal(normalizedDate('26-10-02'), '2026-10-02');
  assert.equal(normalizedDate('2026-02-30'), '');
  assert.equal(normalizedTime('마감 18:00까지'), '18:00');
  assert.equal(normalizedTime('24:00'), '');
});

test('정리된 형식의 캘린더 일정을 읽는다', () => {
  const { values } = parseEventFields({
    title: 'LG유플러스 | NW기술', date: '2026-09-27', time: '23:00',
    description: '<p>직무: NW기술</p>\n<p>고용형태: 정규직</p>\n<p>마감: 2026-09-27 23:00</p>\n<p>공고 링크: https://example.com/a?x=1&amp;y=2</p>\n<p>지원 링크: https://example.com/apply</p>',
  });
  assert.equal(values.organization, 'LG유플러스');
  assert.equal(values.role, 'NW기술');
  assert.equal(values.employmentType, '정규직');
  assert.equal(values.deadline, '2026-09-27');
  assert.equal(values.deadlineTime, '23:00');
  assert.equal(values.url, 'https://example.com/a?x=1&y=2', '공고 링크를 지원 링크보다 먼저, &amp;는 풀어서');
  assert.equal(values.note, '직무: NW기술\n고용형태: 정규직\n마감: 2026-09-27 23:00\n공고 링크: https://example.com/a?x=1&y=2\n지원 링크: https://example.com/apply', '<p>마다 빈 줄이 끼지 않는다');
});

test('제목이 회사 이름뿐이고 설명에 직무명이 있으면 회사로 본다', () => {
  const { values } = parseEventFields({ title: '한국철도공사', date: '2026-09-30', time: '14:00', description: '직무명: 2026년 하반기 청년 체험형 인턴 — AI 청년인턴\n접수: 2026-09-23 ~ 2026-09-30 14:00' });
  assert.equal(values.organization, '한국철도공사');
  assert.equal(values.role, 'AI 청년인턴');
  assert.equal(values.originalTitle, '2026년 하반기 청년 체험형 인턴 — AI 청년인턴');
});

test('접수기간은 물결표 뒤(마감 쪽) 시각을 쓰고, 00:00 일정은 시각을 비운다', () => {
  assert.equal(parseEventFields({ title: '한국남부발전', date: '2026-09-28', time: '12:00', description: '직무: ICT\n접수기간: 2026-09-18 10:00 ~ 2026-09-28 12:00' }).values.deadlineTime, '12:00');
  const unknown = parseEventFields({ title: '광주환경공단', date: '2026-10-08', time: '00:00', description: '직무명: 전산\n마감일: 2026-10-08 / 마감시각 미공개' }).values;
  assert.equal(unknown.deadline, '2026-10-08');
  assert.equal(unknown.deadlineTime, '');
});

test('여러 날에 걸친 일정은 마지막 날을 마감일로 본다', () => {
  assert.equal(parseEventFields({ title: '카카오 · 프론트엔드', date: '2026-10-10', endDate: '2026-10-14' }).values.deadline, '2026-10-14');
});

test('공고 페이지 제목에서 회사를 찾는다', () => {
  assert.equal(pageTitleParts('공사소개>채용정보>채용공고 - 한국철도공사').organization, '한국철도공사');
  assert.deepEqual(pageTitleParts('[오성푸드] 경리 회계사무원 모집 - 사람인'), { organization: '오성푸드', role: '경리 회계사무원' });
  assert.equal(pageTitleParts('채용정보-2026년 서울시설공단 직무중심 공개채용 | 시설공단>공단소개').organization, '서울시설공단');
  assert.equal(pageTitleParts('한국소방산업기술원 채용').organization, '한국소방산업기술원');
});

test('본문의 접수기간 줄에서 마감일을 찾는다', () => {
  assert.deepEqual(textDeadline('모집 안내\n접수기간: 2026.09.23 ~ 2026.10.06 18:00\n문의'), { deadline: '2026-10-06', deadlineTime: '18:00' });
  assert.deepEqual(textDeadline('원서접수 기간 2026년 9월 22일 ~ 2026년 9월 29일'), { deadline: '2026-09-29', deadlineTime: '' });
  assert.equal(textDeadline('관련 없는 글 2026.01.01'), null);
});

test('내부망 주소는 막는다', () => {
  for (const address of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.1.1', '::1', '::ffff:127.0.0.1', 'fd00::1']) assert.equal(privateAddress(address), true, address);
  for (const address of ['8.8.8.8', '211.43.14.187', '2606:4700::1111']) assert.equal(privateAddress(address), false, address);
});

test('캘린더 설명의 HTML을 줄바꿈이 살아 있는 글로 바꾼다', () => {
  assert.equal(eventText('<p>가</p>\n<p>나</p><br>다'), '가\n나\n다');
});
