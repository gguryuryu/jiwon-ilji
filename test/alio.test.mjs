// 잡알리오 공고 받기: 공공데이터포털 응답을 읽고, 조건으로 거르고, 달력 일정으로 바꾼다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AlioError, fetchAlioPostings, keyParam, normalizeAlio } from '../lib/alio.mjs';
import { parseEventFields } from '../lib/parse.mjs';
import { alioEvent, alioEvents, alioOptions, emptyAlioFilter, itAlioFilter, matchesAlio } from '../js/alio-model.js';

const raw = (sn, extra = {}) => ({
  recrutPblntSn: sn, instNm: '한국전력공사', recrutPbancTtl: '2026년 하반기 신입사원 채용', pbancBgngYmd: '20261001', pbancEndYmd: '20261015',
  workRgnNmLst: '광주광역시,전라남도', ncsCdNmLst: '정보통신, 경영.회계.사무', hireTypeNmLst: '정규직', recrutSeNm: '신입', recrutNope: 12, replmprYn: 'N', ...extra,
});

function fakeFetch(pages) {
  const calls = [];
  return { calls, fetch: async url => { calls.push(url); const page = Number(new URL(url).searchParams.get('pageNo')); return new Response(typeof pages === 'function' ? pages(page) : JSON.stringify(pages[page - 1] ?? { resultCode: 0, totalCount: 0, result: [] })); } };
}

test('잡알리오 공고를 앱에서 쓰는 모양으로 바꾼다', () => {
  assert.deepEqual(normalizeAlio({ item: raw(305670) }), {
    id: '305670', organization: '한국전력공사', title: '2026년 하반기 신입사원 채용', start: '2026-10-01', end: '2026-10-15',
    regions: ['광주광역시', '전라남도'], ncs: ['정보통신', '경영.회계.사무'], hire: ['정규직'], kind: '신입', headcount: 12, replacement: false,
    url: 'https://job.alio.go.kr/recruitview.do?idx=305670',
  });
  assert.equal(normalizeAlio(raw('', {})), null); // 번호 없는 공고는 버린다
  assert.equal(normalizeAlio(raw(1, { pbancEndYmd: '' })), null); // 마감일 없는 공고도
});

test('여러 쪽을 이어 받고, 같은 공고가 두 번 와도 한 번만 남긴다', async () => {
  const { fetch, calls } = fakeFetch([
    { resultCode: 0, totalCount: 3, result: [raw(1), raw(2)] },
    { resultCode: 0, totalCount: 3, result: [raw(2), raw(3)] },
  ]);
  const items = await fetchAlioPostings('a+b/c==', { fetch, rows: 2 });
  assert.deepEqual(items.map(item => item.id), ['1', '2', '3']);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /serviceKey=a%2Bb%2Fc%3D%3D&/); // 디코딩 키는 인코딩해서 보낸다
  assert.match(calls[0], /ongoingYn=Y/);
  assert.equal(keyParam('a%2Bb'), 'a%2Bb'); // 인코딩 키는 그대로
});

test('인증키·한도 오류는 알아들을 수 있는 말로 바꾼다', async () => {
  const xml = text => fakeFetch(() => `<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>${text}</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>`).fetch;
  await assert.rejects(fetchAlioPostings('key', { fetch: xml('SERVICE_KEY_IS_NOT_REGISTERED_ERROR') }), error => error instanceof AlioError && error.status === 422 && /1시간/.test(error.message));
  await assert.rejects(fetchAlioPostings('key', { fetch: xml('LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR') }), /내일/);
  await assert.rejects(fetchAlioPostings('key', { fetch: fakeFetch([{ resultCode: 7, resultMsg: 'auth' }]).fetch }), /인증키를 확인하지 못했어요/);
  // 실제로 받은 응답: 등록되지 않은 키는 JSON 안의 cmmMsgHeader로 온다.
  const unregistered = { OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', returnAuthMsg: '등록되지 않은 서비스키', returnReasonCode: '30' } } };
  await assert.rejects(fetchAlioPostings('key', { fetch: fakeFetch([unregistered]).fetch }), /아직 등록되지 않았어요/);
  await assert.rejects(fetchAlioPostings('key', { fetch: fakeFetch([{ something: 'else' }]).fetch }), /알 수 없는 응답/);
  await assert.rejects(fetchAlioPostings('key', { fetch: async () => { throw new TypeError('fetch failed'); } }), /연결하지 못했어요/);
  await assert.rejects(fetchAlioPostings('  '), /인증키가 없어요/);
  assert.deepEqual(await fetchAlioPostings('key', { fetch: fakeFetch([{ resultCode: 3, resultMsg: '데이터 없음' }]).fetch }), []);
});

test('조건으로 거른다: 고르지 않은 항목은 전부, 여러 개는 하나라도 맞으면', () => {
  const items = [raw(1), raw(2, { workRgnNmLst: '서울특별시', ncsCdNmLst: '경영.회계.사무' }), raw(3, { replmprYn: 'Y' }), raw(4, { recrutPbancTtl: '전산직 경력 채용', recrutSeNm: '경력' })].map(normalizeAlio);
  const pick = filter => items.filter(item => matchesAlio(item, { ...emptyAlioFilter(), ...filter })).map(item => item.id);
  assert.deepEqual(items.filter(item => matchesAlio(item, null)), []); // 조건을 저장하기 전에는 아무것도 띄우지 않는다
  assert.deepEqual(pick({}), ['1', '2', '4']); // 대체인력은 기본으로 뺀다
  assert.deepEqual(pick({ skipReplacement: false }), ['1', '2', '3', '4']);
  assert.deepEqual(pick({ regions: ['전라남도', '부산광역시'] }), ['1', '4']);
  assert.deepEqual(pick({ ncs: ['정보통신'], kinds: ['신입'] }), ['1']);
  assert.deepEqual(pick({ keywords: '전산, 없는말' }), ['4']);
  const options = alioOptions(items);
  assert.deepEqual(options.regions[0], ['광주광역시', 3]);
  assert.deepEqual(options.kinds.map(([kind]) => kind), ['신입', '경력']);
});

test('달력 일정으로 바꾸면 일정 창이 기관·직무·마감·링크를 그대로 읽는다', () => {
  const item = normalizeAlio(raw(305670));
  const event = alioEvent(item);
  assert.equal(event.id, 'alio:305670');
  assert.equal(event.date, '2026-10-15');
  const { values } = parseEventFields(event);
  assert.equal(values.organization, '한국전력공사');
  assert.equal(values.role, '정보통신, 경영.회계.사무');
  assert.equal(values.deadline, '2026-10-15');
  assert.equal(values.employmentType, '정규직');
  assert.equal(values.url, 'https://job.alio.go.kr/recruitview.do?idx=305670');
  assert.deepEqual(alioEvents([item, normalizeAlio(raw(2, { workRgnNmLst: '서울특별시' }))], { ...emptyAlioFilter(), regions: ['서울특별시'] }).map(entry => entry.id), ['alio:2']);
});

test('빼는 단어·전산직 추천 조건으로 일용·단순 모집을 빼고, 직무에는 고른 분야만 남긴다', () => {
  const items = [
    raw(1, { ncsCdNmLst: '사업관리, 건설, 정보통신', hireTypeNmLst: '정규직' }),
    raw(2, { recrutPbancTtl: '전력통신설비 유지보수 단순정비 작업원 모집', ncsCdNmLst: '정보통신', hireTypeNmLst: '비정규직' }),
    raw(3, { recrutPbancTtl: 'AMI분야 일용근로자 모집', ncsCdNmLst: '정보통신', hireTypeNmLst: '정규직' }),
    raw(4, { ncsCdNmLst: '보건.의료' }),
  ].map(normalizeAlio);
  assert.deepEqual(items.filter(item => matchesAlio(item, itAlioFilter())).map(item => item.id), ['1']);
  assert.deepEqual(items.filter(item => matchesAlio(item, { ...emptyAlioFilter(), excludes: '일용, 단순' })).map(item => item.id), ['1', '4']);
  const { values } = parseEventFields(alioEvent(items[0], itAlioFilter()));
  assert.equal(values.role, '정보통신'); // '사업관리, 건설, 정보통신'이 아니라 고른 분야만
  assert.equal(parseEventFields(alioEvent(items[0], emptyAlioFilter())).values.role, '사업관리, 건설, 정보통신'); // 고르지 않았으면 전부
});
