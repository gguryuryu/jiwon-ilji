// 잡알리오 공고 고르기: 근무지·NCS 분야·고용형태·채용구분·검색어로 거르고, 고른 공고를 달력 일정으로 바꾼다.
// 선택지는 받아 온 공고에 실제로 있는 값에서 만든다(코드표 없이도 정확히 맞는다).

export const emptyAlioFilter = () => ({ regions: [], ncs: [], hire: [], kinds: [], keywords: '', excludes: '', skipReplacement: true });

// 전산직 추천 조건: 정보통신 분야의 공채(일용·단순 정비·업무보조 같은 비정규 모집은 뺀다)
export const itAlioFilter = () => ({ ...emptyAlioFilter(), ncs: ['정보통신'], hire: ['정규직', '무기계약직', '청년인턴(채용형)', '청년인턴(체험형)'], kinds: ['신입', '신입+경력'], excludes: '일용, 단순, 업무보조, 작업원, 기간제' });

const words = text => String(text || '').split(/[,，\n]/).map(word => word.trim().toLowerCase()).filter(Boolean);
const any = (chosen, values) => !chosen?.length || values.some(value => chosen.includes(value));

export function matchesAlio(item, filter) {
  if (!filter) return false; // 조건을 저장하기 전에는 달력에 띄우지 않는다
  if (filter.skipReplacement && item.replacement) return false;
  if (!any(filter.regions, item.regions) || !any(filter.ncs, item.ncs) || !any(filter.hire, item.hire)) return false;
  if (filter.kinds?.length && !filter.kinds.includes(item.kind)) return false;
  const text = `${item.organization} ${item.title}`.toLowerCase();
  if (words(filter.excludes).some(word => text.includes(word))) return false;
  const keywords = words(filter.keywords);
  return !keywords.length || keywords.some(word => text.includes(word));
}

// 고를 수 있는 값과 공고 수(많은 순)
export function alioOptions(items) {
  const count = pick => {
    const counts = new Map();
    for (const item of items) for (const value of [pick(item)].flat()) if (value) counts.set(value, (counts.get(value) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  };
  return { regions: count(item => item.regions), ncs: count(item => item.ncs), hire: count(item => item.hire), kinds: count(item => item.kind) };
}

// 고른 값이 있으면 그 값만(공고 하나에 분야가 여러 개여도 내가 지원할 분야만 남긴다)
const chosenOf = (values, chosen) => chosen?.length && values.some(value => chosen.includes(value)) ? values.filter(value => chosen.includes(value)) : values;

// 달력 일정: 제목은 '기관 | 공고 제목', 설명은 일정 창이 읽는 '항목: 값' 줄
export function alioEvent(item, filter) {
  const ncs = chosenOf(item.ncs, filter?.ncs); const hire = chosenOf(item.hire, filter?.hire);
  const lines = [
    ncs.length ? `직무: ${ncs.join(', ')}` : '',
    hire.length ? `고용형태: ${hire.join(', ')}` : '',
    item.regions.length ? `근무지: ${item.regions.join(', ')}` : '',
    item.kind ? `채용구분: ${item.kind}` : '',
    item.headcount ? `채용인원: ${item.headcount}명` : '',
    `접수 마감: ${item.end}`,
    `공고 링크: ${item.url}`,
  ].filter(Boolean);
  return { id: `alio:${item.id}`, source: 'alio', title: `${item.organization} | ${item.title}`, date: item.end, endDate: '', time: '', description: lines.join('\n'), url: item.url };
}

export const alioEvents = (items, filter) => items.filter(item => matchesAlio(item, filter)).map(item => alioEvent(item, filter)).sort((a, b) => a.id.localeCompare(b.id));
