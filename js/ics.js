// .ics(캘린더 파일) 읽기
import { dateKey, htmlText, uid, validUrl } from './util.js';

export function parseIcs(text, source = 'external') {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const items = []; let current = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT') {
      if (current?.date && current.title && current.status !== 'CANCELLED') {
        if (!(current.endDate > current.date)) delete current.endDate;
        if (!current.url) current.url = validUrl(current.description?.match(/https?:\/\/[^\s<>"]+/)?.[0]?.replace(/[.,;)]$/, '') || '');
        items.push(current);
      }
      current = null; continue;
    }
    if (!current) continue;
    const split = line.indexOf(':'); if (split < 0) continue;
    const name = line.slice(0, split).split(';')[0].toUpperCase();
    const value = line.slice(split + 1).replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
    if (name === 'UID') current.uid = value;
    if (name === 'RECURRENCE-ID') current.recurrenceId = value;
    if (name === 'STATUS') current.status = value.toUpperCase();
    if (name === 'SUMMARY') current.title = value;
    if (name === 'DESCRIPTION') current.description = htmlText(value);
    if (name === 'URL') current.url = validUrl(htmlText(value));
    if (name === 'DTEND') {
      // 종일 일정의 DTEND는 다음 날로 적히므로 하루를 뺀다.
      const match = value.match(/^(\d{4})(\d{2})(\d{2})(T)?/);
      if (match) { const end = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) - (match[4] ? 0 : 1)); current.endDate = dateKey(end); }
    }
    if (name === 'DTSTART') {
      const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
      if (match) { current.date = `${match[1]}-${match[2]}-${match[3]}`; current.time = match[4] ? `${match[4]}:${match[5]}` : ''; }
      if (match && value.endsWith('Z')) {
        const formatted = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')));
        const parsed = formatted.match(/(\d{4})-(\d{2})-(\d{2}),?\s+(\d{2}):(\d{2})/);
        if (parsed) { current.date = `${parsed[1]}-${parsed[2]}-${parsed[3]}`; current.time = `${parsed[4]}:${parsed[5]}`; }
      }
    }
  }
  // 반복 일정에서 따로 수정된 회차는 UID가 같으므로 RECURRENCE-ID까지 붙여 구분한다.
  return items.map(({ uid: eventUid, recurrenceId, status, ...item }) => {
    const key = eventUid ? `${eventUid}${recurrenceId ? `:${recurrenceId}` : ''}` : uid();
    return { ...item, id: source === 'google' ? `google:${key}` : key, source };
  });
}
