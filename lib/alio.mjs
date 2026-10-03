// 잡알리오 공고 받기: 공공데이터포털 '재정경제부_공공기관 채용정보 조회서비스' 오픈API(무료 인증키 필요).
// https://www.data.go.kr/data/15125273/openapi.do — 진행 중인 채용공시를 모두 받아 앱에서 쓰기 좋은 모양으로 바꾼다.
const ENDPOINT = 'https://apis.data.go.kr/1051000/recruitment/list';

export class AlioError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

// 포털은 '인코딩' 키(%가 섞인 것)와 '디코딩' 키를 함께 준다. 어느 쪽을 붙여 넣어도 되게 한다.
export const keyParam = key => /%[0-9A-F]{2}/i.test(key) ? key : encodeURIComponent(key);

// 인증 오류 등은 JSON이 아니라 XML로 온다.
function explainText(text) {
  if (/SERVICE_KEY_IS_NOT_REGISTERED|SERVICE KEY IS NOT REGISTERED/i.test(text)) return new AlioError('인증키가 아직 등록되지 않았어요. 공공데이터포털에서 활용신청이 승인됐는지 확인하고, 발급 직후라면 1시간쯤 뒤에 다시 시도해 주세요.', 422);
  if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS/i.test(text)) return new AlioError('오늘 쓸 수 있는 잡알리오 조회 횟수를 다 썼어요. 내일 다시 받아 와요.', 429);
  if (/SERVICE_ACCESS_DENIED|DEADLINE_HAS_EXPIRED|UNREGISTERED_IP/i.test(text)) return new AlioError('이 인증키로는 잡알리오를 조회할 수 없어요. 공공데이터포털에서 활용신청 상태와 기간을 확인해 주세요.', 422);
  return new AlioError('잡알리오에서 알 수 없는 응답이 왔어요. 잠시 후 다시 시도해 주세요.');
}

const codeMessages = {
  7: ['인증키를 확인하지 못했어요. 공공데이터포털 마이페이지의 일반 인증키를 그대로 붙여 넣어 주세요.', 422],
  10: ['잡알리오 조회 조건이 올바르지 않아요.', 422],
  11: ['잡알리오 조회에 필요한 값이 빠졌어요.', 422],
};

const ymd = value => {
  const text = String(value || '').replace(/\D/g, '');
  return text.length === 8 ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : '';
};
const list = value => String(value || '').split(/[,，]/).map(part => part.trim()).filter(Boolean);

// 공고 하나를 앱에서 쓰는 모양으로(필요한 칸만)
export function normalizeAlio(raw) {
  const item = raw?.item ?? raw;
  const id = String(item?.recrutPblntSn ?? '').trim();
  const end = ymd(item?.pbancEndYmd);
  if (!id || !end) return null;
  return {
    id,
    organization: String(item.instNm || '').trim(),
    title: String(item.recrutPbancTtl || '').replace(/\s+/g, ' ').trim(),
    start: ymd(item.pbancBgngYmd),
    end,
    regions: list(item.workRgnNmLst),
    ncs: list(item.ncsCdNmLst),
    hire: list(item.hireTypeNmLst),
    kind: String(item.recrutSeNm || '').trim(),
    headcount: Number(item.recrutNope) || 0,
    replacement: item.replmprYn === 'Y',
    url: `https://job.alio.go.kr/recruitview.do?idx=${encodeURIComponent(id)}`,
  };
}

// 진행 중인 공고를 모두 받는다(100개씩, 최대 20쪽).
export async function fetchAlioPostings(key, { fetch: request = globalThis.fetch, rows = 100, maxPages = 20 } = {}) {
  if (!String(key || '').trim()) throw new AlioError('잡알리오 인증키가 없어요.', 422);
  const items = [];
  let total = Infinity;
  for (let page = 1; page <= maxPages && (page - 1) * rows < total; page++) {
    const url = `${ENDPOINT}?serviceKey=${keyParam(String(key).trim())}&resultType=json&ongoingYn=Y&numOfRows=${rows}&pageNo=${page}`;
    let text;
    try { text = await (await request(url, { signal: AbortSignal.timeout(20_000) })).text(); }
    catch (error) {
      throw new AlioError(error?.name === 'TimeoutError' ? '잡알리오 응답이 늦어요. 잠시 후 다시 시도해 주세요.' : '잡알리오(공공데이터포털)에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.', 504);
    }
    let body;
    try { body = JSON.parse(text); } catch { throw explainText(text); }
    // 인증 오류는 { OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg } } } 모양으로 온다.
    if (body.OpenAPI_ServiceResponse || (body.resultCode === undefined && body.response?.header?.resultCode === undefined)) throw explainText(text);
    const code = Number(body.resultCode ?? body.response.header.resultCode);
    if (code === 3) break; // 데이터 없음
    if (code !== 0 && code !== 200) {
      const [message, status] = codeMessages[code] || [`잡알리오 오류: ${body.resultMsg || code}`, 502];
      throw new AlioError(message, status);
    }
    total = Number(body.totalCount ?? 0);
    const result = Array.isArray(body.result) ? body.result : body.result ? [body.result] : [];
    items.push(...result);
    if (!result.length) break;
  }
  const seen = new Set();
  return items.map(normalizeAlio).filter(item => item && !seen.has(item.id) && seen.add(item.id));
}
