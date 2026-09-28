// 공고 페이지·캘린더 일정에서 회사·직무·마감일을 읽는 함수들. 네트워크나 파일을 쓰지 않아 테스트하기 쉽다.
import { isIP } from 'node:net';

export function privateAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const lower = address.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return privateAddress(mapped);
  return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80') || lower.startsWith('::ffff:');
}

export function decode(value) {
  return String(value || '').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, code => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[code])
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function meta(html, wanted) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) attributes[match[1].toLowerCase()] = match[3];
    if ([attributes.property, attributes.name, attributes.itemprop].includes(wanted)) return decode(attributes.content);
  }
  return '';
}

export function jobPosting(html) {
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      const candidates = [parsed, ...(Array.isArray(parsed) ? parsed : []), ...(parsed['@graph'] || [])];
      const job = candidates.find(item => item && (item['@type'] === 'JobPosting' || item['@type']?.includes?.('JobPosting')));
      if (job) return job;
    } catch { /* Sites sometimes include invalid JSON-LD. */ }
  }
  return null;
}

export function decodedHtml(response, bytes) {
  const declared = `${response.headers.get('content-type') || ''} ${bytes.subarray(0, 4096).toString('latin1')}`;
  const charset = declared.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]?.toLowerCase() || 'utf-8';
  try { return new TextDecoder(charset === 'ks_c_5601-1987' ? 'euc-kr' : charset).decode(bytes); }
  catch { return new TextDecoder('utf-8').decode(bytes); }
}

export function normalizedDate(value) {
  const match = String(value || '').match(/(?:^|\D)(\d{4}|\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})(?:\D|$)/);
  if (!match) return '';
  const year = match[1].length === 2 ? 2000 + Number(match[1]) : Number(match[1]);
  const month = Number(match[2]); const day = Number(match[3]);
  const actual = new Date(year, month - 1, day);
  return actual.getFullYear() === year && actual.getMonth() === month - 1 && actual.getDate() === day
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
}

export function normalizedTime(value) {
  const match = String(value || '').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
}

// 여러 고용형태가 함께 적혀 있으면 먼저 나온 것을 고른다. '인턴십 전형'은 인턴 채용이 아니다.
export function employmentKinds(value) {
  const text = Array.isArray(value) ? value.join(' ') : String(value || '');
  const kinds = [['인턴', /인턴(?!십)|INTERN(?!SHIP)/i], ['무기계약직', /무기계약/], ['공무직', /공무직/], ['기간제', /기간제/], ['계약직', /(?<!무기)계약|CONTRACT|TEMPORARY/i], ['정규직', /정규|FULL_TIME/i]];
  return kinds.map(([name, pattern]) => [name, text.search(pattern)]).filter(([, index]) => index >= 0).sort((a, b) => a[1] - b[1]).map(([name]) => name);
}
export function normalizedEmployment(value) { return employmentKinds(value)[0] || ''; }

// '(재)우체국금융개발원', '주식회사 카카오' → 기관 이름만
export function cleanOrganization(value) {
  return String(value || '').replace(/^\s*(?:\((?:재|사|주)\)|㈜|재단법인|사단법인|주식회사)\s*/, '').replace(/\s*(?:\((?:재|사|주)\)|㈜|주식회사)\s*$/, '').trim();
}

// 공고 페이지 제목에서 회사를 찾는다. 페이지 제목은 보통 '내용 | 메뉴 | 사이트 이름' 순서라 마지막 조각이 회사다.
export const jobBoards = /사람인|잡코리아|인크루트|원티드|잡알리오|잡플래닛|워크넷|고용24|careers?|recruit|채용\s*(?:홈페이지|사이트|포털)/i;
export function pageTitleParts(title, siteName) {
  const text = decode(title);
  const bracket = text.match(/^[\[【]([^\]】]{1,40})[\]】]\s*(.+?)(?:\s+[-|–]\s+[^-|–]+)?$/);
  if (bracket) return { organization: bracket[1].trim(), role: cleanRole(bracket[2]) };
  const named = text.match(/[가-힣A-Za-z]{2,}(?:공사|공단|재단|진흥원|개발원|연구원|연구소|협회|위원회|은행|병원|대학교|발전|관리원|기술원)(?![가-힣])/)?.[0];
  if (named) return { organization: named, role: '' };
  const segments = text.split(/\s+[|\-–—>]\s+|\s*>\s*/).map(part => part.trim()).filter(Boolean);
  const site = [...segments].reverse().find(part => !jobBoards.test(part) && !/채용|공고|안내|정보|소식|게시판|소개|상세|화면|목록|본문|공지|메인/.test(part) && part.length <= 30);
  if (segments.length > 1 && site) return { organization: site, role: '' };
  const single = cleanRole(text);
  if (single && single !== text && !/\s/.test(single)) return { organization: single, role: '' };
  const siteLabel = decode(siteName);
  if (siteLabel && !jobBoards.test(siteLabel)) return { organization: siteLabel, role: '' };
  return { organization: '', role: '' };
}

export function roleFromTitle(title) {
  const match = String(title || '').match(/[（(]([^()（）]{2,30})[)）]/);
  const candidate = match?.[1]?.trim() || '';
  return candidate && !/신입|경력|장애|보훈|수습|채용|기간|일반직|정규직/.test(candidate) ? candidate : '';
}

export function jobAlioFields(html) {
  const organization = decode(html.match(/<div\s+class=["']topInfo["'][\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]);
  const title = decode(html.match(/<p\s+class=["']titleH2["'][^>]*title=["']([^"']+)["']/i)?.[1]);
  const fields = {};
  for (const match of html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) fields[decode(match[1])] = decode(match[2]);
  const dates = [...String(fields['채용기간'] || '').matchAll(/(?:\d{4}|\d{2})[.\/-]\d{1,2}[.\/-]\d{1,2}/g)];
  const fieldRole = String(fields['근무분야'] || '').trim();
  return {
    organization,
    originalTitle: title,
    role: roleFromTitle(title) || (fieldRole && !fieldRole.includes(',') && fieldRole.length <= 25 ? fieldRole : ''),
    // 공고 하나에 정규직·무기계약직 등이 섞여 있으면 어느 쪽에 지원할지 모르므로 비워 둔다.
    employmentType: employmentKinds(fields['고용형태']).length === 1 ? employmentKinds(fields['고용형태'])[0] : '',
    deadline: normalizedDate(dates.at(-1)?.[0]),
    deadlineTime: '',
  };
}

// 본문의 '접수기간: 2026.09.23 ~ 2026.10.06 18:00' 같은 줄에서 마감일을 찾는다.
export function textDeadline(text) {
  const thisYear = new Date().getFullYear();
  for (const line of String(text || '').split('\n')) {
    if (!/(?:접수|원서|지원|모집|서류)\s*(?:기간|마감|기한|일정)|마감\s*(?:일|일시)/.test(line)) continue;
    const tail = line.split(/[~〜]/).at(-1);
    const dates = [...tail.matchAll(/(\d{4}|\d{2})\s*(?:[.\/-]|년)\s*(\d{1,2})\s*(?:[.\/-]|월)\s*(\d{1,2})/g)].map(match => normalizedDate(`${match[1]}.${match[2]}.${match[3]}`));
    const date = dates.filter(Boolean).at(-1);
    if (date && Number(date.slice(0, 4)) >= thisYear - 1) return { deadline: date, deadlineTime: normalizedTime(tail) };
  }
  return null;
}

export function pageText(html) {
  return decode(html.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(?:p|div|li|tr|td|h[1-6])>/gi, '\n')).slice(0, 18_000);
}

// 캘린더 일정(다른 AI가 넣은 공고 일정)에서 회사·직무·마감일을 읽는다.
// 1) 설명의 '회사: …' 같은 항목 → 2) 제목의 구분자('회사 | 직무', '[회사] 직무') → 3) 공고 링크 → 4) AI 순서로 빈칸만 채운다.
export const eventLabels = {
  organization: /^(?:회사|회사명|기업|기업명|기관|기관명|채용\s*기관)$/,
  role: /^(?:직무|직무명|모집\s*직무|모집\s*분야|채용\s*분야|지원\s*분야|포지션|분야)$/,
  employmentType: /^(?:고용\s*형태|채용\s*형태|근무\s*형태)$/,
  deadline: /^(?:마감|마감일|마감\s*일시|접수|접수\s*마감|지원\s*마감|서류\s*마감|접수\s*기간|지원\s*기간|모집\s*기간)$/,
};

// '2026년 하반기 신입채용 — NW기술 (8명)' → 'NW기술'
export function cleanRole(value) {
  let role = String(value || '').trim();
  const dash = role.split(/\s+[—–]\s+/);
  if (dash.length > 1) role = dash.at(-1);
  else role = role.replace(/^\d{4}년(?:도)?\s*(?:(?:상|하)반기\s*)?(?:제?\d+(?:차|회)\s*)?/, '');
  return role
    .replace(/\s*\(?\s*\d+\s*명\s*\)?\s*$/, '')
    .replace(/\s*(?:(?:신입|경력)(?:\s*[·\/]\s*(?:신입|경력))?\s*)?(?:사원\s*)?(?:채용\s*공고|채용|모집|공고)\s*$/, '')
    .replace(/\s{2,}/g, ' ').trim();
}

export function titleParts(raw) {
  const title = decode(raw)
    .replace(/^\s*(?:\[(?:마감|접수\s*마감|서류\s*마감|D-?\d+)\]|\((?:마감|D-?\d+)\))\s*/i, '')
    .replace(/\s*(?:[-–·|:]\s*)?(?:서류|접수|지원)?\s*마감(?:일)?\s*$/, '')
    .replace(/\s*D-?\d+\s*$/i, '').trim();
  const bracket = title.match(/^[\[【]([^\]】]{1,40})[\]】]\s*(.+)$/);
  if (bracket) return { organization: bracket[1].trim(), role: cleanRole(bracket[2]), title };
  const parts = title.split(/\s+[-–—\/]\s+|\s*[|·ㅣ]\s*/).map(part => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { organization: parts[0], role: cleanRole(parts.slice(1).join(' ')), title };
  const colon = title.match(/^([^:：]{2,30})[:：]\s*(.+)$/);
  if (colon) return { organization: colon[1].trim(), role: cleanRole(colon[2]), title };
  const suffix = title.match(/^(.+?(?:공사|공단|은행|재단|진흥원|개발원|연구원|연구소|협회|센터|병원|대학교|그룹|\(주\)|㈜|주식회사))\s+(.+)$/);
  if (suffix) return { organization: suffix[1].trim(), role: cleanRole(suffix[2]), title };
  // 'LG전자 채용'처럼 회사 이름만 있는 제목
  const single = cleanRole(title);
  if (single && single !== title && !/\s/.test(single)) return { organization: single, role: '', title };
  return { organization: '', role: '', title };
}

// 구글 캘린더 설명은 <p>, <br>, &amp; 같은 HTML이 섞여 오므로 줄바꿈을 살린 일반 텍스트로 바꾼다.
export function eventText(value) {
  return String(value || '').replace(/<br\s*\/?>\s*/gi, '\n').replace(/<\/(?:p|div|li|h\d)>\s*/gi, '\n')
    .split('\n').map(line => decode(line)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// 설명의 링크 중 공고 원문('공식 공고')을 먼저, 그다음 지원 페이지를 고른다.
export function eventUrl(lines, fallback) {
  const links = lines.map(line => ({ label: line.match(/^\s*[-•*]?\s*([^:：]{1,20})\s*[:：]/)?.[1] || '', url: line.match(/https?:\/\/[^\s<>"]+/)?.[0]?.replace(/[.,;)]$/, '') })).filter(link => link.url);
  const pick = links.find(link => /공고/.test(link.label)) || links.find(link => /지원|채용|링크/.test(link.label)) || links[0];
  return pick?.url || fallback || '';
}

// 일정 제목·설명만으로 공고 정보를 읽는다(네트워크 없이).
export function parseEventFields(event) {
  const title = decode(event.title);
  const description = eventText(event.description);
  const lines = description.split('\n');
  const labeled = {};
  for (const line of lines) {
    const match = line.match(/^\s*[-•*]?\s*([^:：]{1,12})\s*[:：]\s*(.+?)\s*$/);
    if (!match) continue;
    const field = Object.keys(eventLabels).find(name => eventLabels[name].test(match[1].trim()));
    if (field && !labeled[field]) labeled[field] = match[2];
  }
  const fromTitle = titleParts(title);
  // '접수기간: 09-18 10:00 ~ 09-28 12:00'이면 물결표 뒤(마감 쪽)만 본다.
  const deadlineText = String(labeled.deadline || '').split(/[~〜]/).at(-1);
  const deadlineDates = [...deadlineText.matchAll(/(?:\d{4}|\d{2})[.\/-]\d{1,2}[.\/-]\d{1,2}/g)];
  // 캘린더에 00:00으로 들어간 일정은 대부분 '마감시각 미공개'라 시각을 비워 둔다.
  const eventTime = normalizedTime(event.time) === '00:00' ? '' : normalizedTime(event.time);
  const values = {
    // 설명이 '직무: …' 형식이면 제목은 회사·기관 이름 그 자체다.
    organization: cleanOrganization(labeled.organization || fromTitle.organization || (labeled.role ? fromTitle.title : '')),
    role: cleanRole(labeled.role) || fromTitle.role,
    employmentType: normalizedEmployment(labeled.employmentType) || normalizedEmployment(title),
    deadline: normalizedDate(deadlineDates.at(-1)?.[0]) || normalizedDate(event.endDate) || normalizedDate(event.date),
    deadlineTime: normalizedTime(deadlineText) || (deadlineDates.length ? '' : eventTime),
    url: eventUrl(lines, decode(event.url)),
    // 제목이 회사 이름뿐이면 설명의 직무명 줄이 공고 제목 역할을 한다.
    originalTitle: !fromTitle.role && labeled.role ? decode(labeled.role) : title,
    note: description,
  };
  if (!values.deadlineTime && normalizedDate(deadlineDates.at(-1)?.[0]) === normalizedDate(event.date)) values.deadlineTime = eventTime;
  return { values, title, description };
}
