// 진행 상태·일정 규칙과 데이터 모양 맞추기(예전 형식 옮기기)
import { uid, validUrl } from './util.js';

export const statusOptions = [
  '관심', '자소서 작성 중', '지원 완료', '서류 심사 중', '필기 전형 예정', '1차 면접 예정', '2차 면접 예정',
  '최종 결과 대기', '서류 불합격', '필기 불합격', '1차 면접 불합격', '2차 면접 불합격', '최종 불합격', '최종 합격', '지원 포기'
];

const doneStatuses = new Set(['서류 불합격', '필기 불합격', '1차 면접 불합격', '2차 면접 불합격', '최종 불합격', '최종 합격', '지원 포기']);

export const interestStatuses = new Set(['관심', '자소서 작성 중']);

export const passedDocumentStatuses = new Set(['필기 전형 예정', '필기 불합격', '1차 면접 예정', '2차 면접 예정', '최종 결과 대기', '1차 면접 불합격', '2차 면접 불합격', '최종 불합격', '최종 합격']);

export const employmentOptions = ['정규직', '인턴', '계약직', '무기계약직', '공무직', '기간제', '기타'];

// 진행 상태마다 노션 선택 속성처럼 고유한 색을 준다.
const statusColors = {
  '관심': 'gray', '자소서 작성 중': 'yellow', '지원 완료': 'blue', '서류 심사 중': 'blue', '필기 전형 예정': 'teal', '1차 면접 예정': 'purple', '2차 면접 예정': 'purple',
  '최종 결과 대기': 'pink', '서류 불합격': 'red', '필기 불합격': 'red', '1차 면접 불합격': 'red', '2차 면접 불합격': 'red', '최종 불합격': 'red', '최종 합격': 'green', '지원 포기': 'brown',
};

const statusColor = status => statusColors[status] || 'gray';

export const statusTag = status => `tag tag-${statusColor(status)}`;

export const groupFor = item => doneStatuses.has(item.status) ? 'done' : interestStatuses.has(item.status) ? 'interest' : 'active';

const statusClass = item => item.status === '최종 합격' ? 'passed' : groupFor(item);

// 지난 일정의 결과를 남길 때 '통과'로 옮겨 갈 다음 진행 상태
export const nextStageStatus = status => ({ '지원 완료': '필기 전형 예정', '서류 심사 중': '필기 전형 예정', '필기 전형 예정': '1차 면접 예정', '1차 면접 예정': '2차 면접 예정', '2차 면접 예정': '최종 결과 대기', '최종 결과 대기': '최종 합격' })[status] || '';

export const nextRelevant = item => groupFor(item) === 'active' && item.nextDate ? { date: item.nextDate, time: item.nextTime || '', label: item.nextLabel || '다음 일정' } : item.deadline ? { date: item.deadline, time: item.deadlineTime || '', label: '접수 마감' } : null;

// 교대 근무·기념일 같은 개인 일정과 공고 일정을 구분한다.
const postingPattern = /(?:^|\n)\s*(?:직무|직무명|모집\s*분야|고용\s*형태|마감|마감일|접수|접수\s*기간|접수\s*마감)\s*[:：]/;

export const isPostingEvent = event => event.source === 'local' || postingPattern.test(event.description || '') || Boolean(validUrl(event.url));

// 캘린더에 00:00으로 들어간 공고 일정은 대부분 '마감시각 미공개'다.
export const shownTime = event => event.time && !(event.time === '00:00' && event.source !== 'local') ? event.time : '';

export const newQuestion = (title = '', answer = '') => ({ id: uid(), title, limit: null, answer, experienceIds: [] });

// ---------- 면접 준비·후기 ----------
// 자주 나오는 면접 질문: 면접 준비 탭에서 눌러 바로 추가한다.
export const commonInterviewQuestions = ['1분 자기소개', '지원 동기', '입사 후 포부', '직무 관련 경험', '갈등을 해결한 경험', '마지막으로 하고 싶은 말'];

// 말하는 시간: 발표 속도(1분에 약 330자, 공백 포함) 기준 어림값
export function speakingTime(text) {
  const seconds = Math.round([...String(text || '').trim()].length / 5.5);
  if (!seconds) return '';
  return seconds < 60 ? `약 ${seconds}초` : `약 ${Math.floor(seconds / 60)}분${seconds % 60 ? ` ${seconds % 60}초` : ''}`;
}

// 후기에 적은 '받은 질문'을 한 줄에 하나씩 읽는다. 앞에 붙은 -, •, 1. 같은 표시는 뗀다.
export const askedQuestions = text => String(text || '').split('\n').map(line => line.replace(/^\s*(?:[-•·*]|\d+[.)])\s*/, '').trim()).filter(Boolean);

export const newReview = (round = '') => ({ id: uid(), round, asked: '', note: '', regret: '', createdAt: new Date().toISOString() });

// 다음 일정·진행 상태를 보고 후기 제목을 미리 채운다(예: '1차 면접 · 10월 2일').
export function reviewRound(item, formatDate) {
  const round = /면접/.test(item.nextLabel || '') ? item.nextLabel.trim() : (item.status || '').match(/^(\d차 면접)/)?.[1] || '';
  return round && item.nextDate && /면접/.test(item.nextLabel || '') ? `${round} · ${formatDate(item.nextDate)}` : round;
}

// 진행 상태에 맞는 탭을 먼저 연다: 면접을 앞두면 면접 준비, 결과를 기다리면 면접 후기.
export const defaultDetailTab = item => /면접 예정$/.test(item.status || '') ? 'interview' : item.status === '최종 결과 대기' ? 'review' : 'essay';

// 예전 자유 문서형 자소서(essay)를 '# 문항' 제목 기준으로 나눠 문항 목록으로 옮긴다.
export function essayToQuestions(markdown) {
  const text = String(markdown || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  const sections = []; let current = null;
  for (const line of text.split('\n')) {
    const heading = line.match(/^# (.+)$/);
    if (heading) { current = { title: heading[1].trim(), lines: [] }; sections.push(current); continue; }
    if (!current) { current = { title: '', lines: [] }; sections.push(current); }
    current.lines.push(line.replace(/^## /, ''));
  }
  return sections.map(section => newQuestion(section.title, section.lines.join('\n').replace(/\n{2,}/g, '\n').trim()));
}

export const blankExperience = item => !item.name?.trim() && !item.type && !item.period && !item.role && !item.keywords?.length && !item.description && !item.result && !item.detail?.trim();

// ---------- 홈: 목표·자격 ----------
// 목표 상태: todo(남은 목표) → doing(진행 중) → done(해 온 것). kind가 cert이면 완료할 때 자격 목록에 들어간다.
export const goalStatuses = [['todo', '남은 목표'], ['doing', '진행 중'], ['done', '완료']];

export const newGoal = (status = 'todo') => ({ id: uid(), title: '', kind: 'goal', status, target: '', tasks: [], progress: 0, note: '', doneAt: '', certId: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

export const newCert = (name = '') => ({ id: uid(), name, score: '', acquired: '', expires: '', note: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

// 진행률: 할 일이 있으면 끝낸 비율, 없으면 직접 정한 값. 완료한 목표는 100%.
export function goalProgress(goal) {
  const total = goal.tasks?.length || 0; const done = goal.tasks?.filter(task => task.done).length || 0;
  const percent = goal.status === 'done' ? 100 : total ? Math.round(done / total * 100) : Math.max(0, Math.min(100, Math.round(Number(goal.progress) || 0)));
  return { done, total, percent };
}

// 자격증 목표 이름에서 자격 이름과 점수·등급을 나눈다. '토익스피킹 IH 취득' → { name: '토익스피킹', score: 'IH' }
export function splitCertTitle(title) {
  const text = String(title || '').trim().replace(/\s*(취득|합격|따기|달성)$/, '').trim();
  const match = text.match(/^(.+?)\s+(\d{2,3}\s*점(?:\s*이상)?|\d급|[1-9]\s*급|IH|IM[1-3]?|IL|AL|NH|NM|NL|Lv\.?\s*\d|Level\s*\d)$/i);
  return match ? { name: match[1].trim(), score: match[2].replace(/\s*이상$/, '').replace(/\s+/g, '') } : { name: text, score: '' };
}

// 어학 성적은 보통 2년 동안 유효하다.
export const isLanguageTest = name => /토익|toeic|오픽|opic|텝스|teps|토플|toefl|아이엘츠|ielts|지텔프|g-?telp|jpt|hsk|flex/i.test(String(name || ''));

export function addMonths(month, count) {
  const [year, value] = String(month || '').split('-').map(Number);
  if (!year || !value) return '';
  const date = new Date(year, value - 1 + count, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// 자격 취득·유효기간 달을 'YYYY-MM'으로 맞춘다. '2026.3', '2026년 3월', '2026-03' 모두 받는다. 알아볼 수 없으면 ''.
export function normalizeMonth(value) {
  const match = String(value || '').match(/(\d{4})\D{0,3}(\d{1,2})/);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return '';
  return `${match[1]}-${match[2].padStart(2, '0')}`;
}

// 'YYYY-MM' → '10월' (올해가 아니면 '2027년 3월')
export function monthLabel(month) {
  const [year, value] = String(month || '').split('-').map(Number);
  if (!year || !value) return '';
  return year === new Date().getFullYear() ? `${value}월` : `${year}년 ${value}월`;
}

export function migrate(value) {
  if (!Array.isArray(value.goals)) value.goals = [];
  if (!Array.isArray(value.certs)) value.certs = [];
  for (const key of ['studyRoutines', 'studyBooks', 'studyLogs', 'labBlocks']) if (!Array.isArray(value[key])) value[key] = [];
  // 잠깐 있던 공부 기록 형식(숫자 칸·전공 목차·오답·모의고사)은 루틴·교재로 바뀌어 지운다.
  for (const key of ['studyChapters', 'studyDays', 'studyMocks']) delete value[key];
  // 잠깐 있던 집중 루프 여러 줄 형식(lines)은 내용이 있는 첫 줄을 할 일 한 줄(body·link)로 되돌린다.
  for (const block of value.labBlocks) {
    if (!Array.isArray(block.lines)) continue;
    const first = block.lines.find(line => line?.text?.trim() || line?.link) || block.lines[0] || {};
    block.body ??= first.text || ''; block.link ??= first.link || null;
    delete block.lines;
  }
  // 사파리(맥 앱)에서 달 입력칸이 글자 칸으로 보이던 때 적힌 날짜도 형식을 맞춘다.
  for (const cert of value.certs) {
    for (const key of ['acquired', 'expires']) if (cert[key]) cert[key] = normalizeMonth(cert[key]) || cert[key];
    for (const entry of cert.history || []) if (entry.acquired) entry.acquired = normalizeMonth(entry.acquired) || entry.acquired;
  }
  // '새 경험'만 누르고 아무것도 쓰지 않은 빈 경험은 정리한다.
  value.experiences = value.experiences.filter(item => !blankExperience(item));
  for (const item of value.postings) {
    if (!Array.isArray(item.questions)) item.questions = essayToQuestions(item.essay);
    delete item.essay;
    if (!Array.isArray(item.interviewQuestions)) item.interviewQuestions = [];
    if (!Array.isArray(item.interviewReviews)) item.interviewReviews = [];
    for (const question of [...item.questions, ...item.interviewQuestions]) if (!Array.isArray(question.experienceIds)) question.experienceIds = [];
  }
  return value;
}
