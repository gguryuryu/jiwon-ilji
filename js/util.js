// 화면과 상관없는 공통 도구: 글자 이스케이프, 날짜, 아이콘, 시각 해석 등

const icons = {
  flask: '<path d="M9.5 3.5h5M10.5 3.5v5.2L5 18.3a1.5 1.5 0 0 0 1.3 2.2h11.4a1.5 1.5 0 0 0 1.3-2.2l-5.5-9.6V3.5"/><path d="M7.5 14.5h9"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15l-1 5Z"/>',
  book: '<path d="M12 6.5C9.5 4.6 6.6 4.2 3.5 5v13.5c3.1-.8 6-.4 8.5 1.5 2.5-1.9 5.4-2.3 8.5-1.5V5c-3.1-.8-6-.4-8.5 1.5Zm0 0V20"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8.5 7V5.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V7M3 12.5h18"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  layers: '<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8 12 3.5Z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5"/>',
  download: '<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 20h14"/>',
  upload: '<path d="M12 16V5m-4.5 4.5L12 5l4.5 4.5M5 20h14"/>',
  refresh: '<path d="M20 4v6h-6M4 20v-6h6"/><path d="M6.1 6.1a8 8 0 0 1 13.4 3.4M4.5 14.5a8 8 0 0 0 13.4 3.4"/>',
  text: '<path d="M4 6h16M4 12h11M4 18h7"/>',
  user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  status: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r=".6"/><circle cx="4.8" cy="12" r=".6"/><circle cx="4.8" cy="17.5" r=".6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  doc: '<path d="M6.5 3h7.5l4.5 4.5V21h-12z"/><path d="M14 3v4.5h4.5M9.5 12.5h5M9.5 16.5h5"/>',
  tag: '<path d="M3.5 12.2V4h8.2l8.8 8.8-8.2 8.2-8.8-8.8Z"/><circle cx="8" cy="8.5" r="1.2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  external: '<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  open: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9.5 9.5v10"/>',
  board: '<rect x="3.5" y="4.5" width="5" height="15" rx="1.5"/><rect x="10.5" y="4.5" width="5" height="10" rx="1.5"/><rect x="17.5" y="4.5" width="3" height="7" rx="1.2"/>',
  'chevron-left': '<path d="m14.5 6-6 6 6 6"/>',
  'chevron-right': '<path d="m9.5 6 6 6-6 6"/>',
  award: '<circle cx="12" cy="9" r="5.5"/><path d="m8.8 13.5-1.3 7 4.5-2.5 4.5 2.5-1.3-7"/>',
  'chevrons-right': '<path d="m6 6.5 5.5 5.5L6 17.5M12.5 6.5 18 12l-5.5 5.5"/>',
  expand: '<path d="M14.5 4.5h5v5M9.5 19.5h-5v-5M19.5 4.5l-6 6M4.5 19.5l6-6"/>',
};

export const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ''}</svg>`;

export const th = (name, label, className = '', width = '') => `<th scope="col" class="${className}"${width ? ` style="width:${width}"` : ''}><span class="th">${icon(name)}${label}</span></th>`;

export const propRow = (iconName, label, control) => `<div class="prop"><div class="prop-label">${icon(iconName)}<span>${label}</span></div><div class="prop-value">${control}</div></div>`;

export const optionsHtml = (options, selected) => options.map(option => `<option ${option === selected ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('');

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const validUrl = value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
};

export const dateValue = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '';

export const formatDate = value => {
  if (!dateValue(value)) return '—';
  const [year, month, day] = value.split('-').map(Number);
  return year === new Date().getFullYear() ? `${month}월 ${day}일` : `${year}년 ${month}월 ${day}일`;
};

export const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const todayKey = () => dateKey(new Date());

export const weekdayNames = ['일', '월', '화', '수', '목', '금', '토'];

// '9월 17일 (수)' — 올해가 아니면 연도를 붙인다.
export const formatDateLong = value => {
  if (!dateValue(value)) return '';
  const [year, month, day] = value.split('-').map(Number);
  return `${year === new Date().getFullYear() ? '' : `${year}년 `}${month}월 ${day}일 (${weekdayNames[new Date(year, month - 1, day).getDay()]})`;
};

// 구글 캘린더 설명의 <p>, <br>, &amp; 를 줄바꿈이 살아 있는 일반 텍스트로 바꾼다.
export const htmlText = value => {
  const text = String(value || '');
  if (!/[<&]/.test(text)) return text;
  const doc = new DOMParser().parseFromString(text.replace(/<br\s*\/?>\s*/gi, '\n').replace(/<\/(?:p|div|li|h\d)>\s*/gi, '\n'), 'text/html');
  return doc.body.textContent.replace(/\n{3,}/g, '\n\n').trim();
};

export const autoGrow = element => { element.style.height = 'auto'; element.style.height = `${element.scrollHeight}px`; };

export const minutesAgo = time => { const minutes = Math.floor((Date.now() - time) / 60_000); return minutes < 1 ? '방금' : minutes < 60 ? `${minutes}분 전` : `${Math.floor(minutes / 60)}시간 전`; };

export const charCount = text => {
  const value = String(text || '').replace(/\r\n/g, '\n');
  return { withSpaces: [...value].length, withoutSpaces: [...value.replace(/\s/g, '')].length };
};

export const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// '14:30', '1430', '930', '오후 2시 30분', '2:30pm' → 'HH:MM'. 비우면 '', 알아볼 수 없으면 null.
export function parseTime(value) {
  const text = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return '';
  const pm = /오후|pm|p\.m/.test(text); const am = /오전|am|a\.m/.test(text);
  const digits = text.replace(/오전|오후|am|pm|a\.m\.?|p\.m\.?/g, '').trim();
  let match = digits.match(/^(\d{1,2})\s*(?::|시|\.)\s*(\d{1,2})?\s*분?$/) || digits.match(/^(\d{1,2})$/);
  if (!match && /^\d{3,4}$/.test(digits)) match = [digits, digits.slice(0, -2), digits.slice(-2)];
  if (!match) return null;
  let hour = Number(match[1]); const minute = Number(match[2] || 0);
  if (pm && hour < 12) hour += 12;
  if (am && hour === 12) hour = 0;
  return hour < 24 && minute < 60 ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : null;
}
