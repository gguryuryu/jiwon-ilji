import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyData } from '../js/state.js';
import { migrate } from '../js/model.js';
import { mergeInto } from '../js/merge.js';
import { EDU_LIMIT, addEdu, certDate, defaultProfileFields, eduOf, setCertDate, tidyProfile } from '../js/profile-model.js';

test('인적사항은 처음 한 번만 기본 항목으로 채우고, 다 지운 뒤에는 다시 채우지 않는다', () => {
  const old = migrate({ version: 1, postings: [], experiences: [], calendarEvents: [] });
  assert.deepEqual(old.profileFields.map(field => field.label).slice(0, 3), ['이름', '한자 이름', '영문 이름']);
  assert.deepEqual(old.profileEdu, []);
  assert.equal(emptyData().profileFields.length, defaultProfileFields().length);
  const cleared = migrate({ ...emptyData(), profileFields: [] });
  assert.deepEqual(cleared.profileFields, []);
});

test('두 창이 동시에 처음 열어도 기본 항목이 겹쳐 생기지 않는다', () => {
  const base = emptyData(); const local = emptyData(); const server = emptyData();
  local.profileFields[0].value = '홍길동';
  server.profileFields[1].value = '洪吉童';
  mergeInto(local, base, server);
  assert.equal(local.profileFields.length, defaultProfileFields().length);
  assert.deepEqual(local.profileFields.slice(0, 2).map(field => field.value), ['홍길동', '洪吉童']);
});

test('학교교육·직업교육은 각각 10개까지 적는다', () => {
  const state = emptyData();
  for (let i = 0; i < EDU_LIMIT; i++) assert.ok(addEdu(state, 'school'));
  assert.equal(addEdu(state, 'school'), null);
  assert.ok(addEdu(state, 'job'));
  assert.equal(eduOf(state, 'school').length, EDU_LIMIT);
  assert.equal(eduOf(state, 'job').length, 1);
});

test('자격증 취득일을 날짜로 적으면 홈의 취득 달도 맞춘다', () => {
  const cert = { name: '정보처리기사', acquired: '2025-11' };
  assert.equal(certDate(cert), '2025.11');
  setCertDate(cert, '2025.12.24');
  assert.equal(cert.acquired, '2025-12');
  assert.equal(certDate(cert), '2025.12.24');
  setCertDate(cert, '12월쯤');
  assert.equal(cert.acquired, '2025-12');
});

test('추가만 하고 비워 둔 줄은 정리하고, 적은 줄과 기본 항목은 남긴다', () => {
  const state = emptyData();
  state.profileFields.push({ id: 'x', group: 'basic', label: ' ', value: '' });
  addEdu(state, 'job'); addEdu(state, 'job').name = '빅데이터 과정';
  state.certs.push({ id: 'a', name: '', score: '' }, { id: 'b', name: '', score: '', number: '123' });
  assert.equal(tidyProfile(state), true);
  assert.equal(state.profileFields.length, defaultProfileFields().length);
  assert.deepEqual(state.profileEdu.map(item => item.name), ['빅데이터 과정']);
  assert.deepEqual(state.certs.map(cert => cert.id), ['b']);
  assert.equal(tidyProfile(state), false);
});
