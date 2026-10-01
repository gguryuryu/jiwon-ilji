// 앱 데이터와 지금 보고 있는 화면. 다른 파일은 setData, setRoute로만 바꾼다.

export const emptyData = () => ({ version: 1, postings: [], experiences: [], calendarEvents: [], goals: [], certs: [], studyRoutines: [], studyBooks: [], studyLogs: [] });

export let data = emptyData();

export let view = 'postings';

export let selectedId = null;

// 다른 파일에서는 이 두 함수로만 데이터와 현재 화면을 바꾼다.
export function setData(value) { data = value; }

export function setRoute(nextView, nextId) { view = nextView; selectedId = nextId; }

// 이 경험을 연결한 자소서 문항과 면접 질문
export const experienceUses = id => data.postings.flatMap(posting => [
  ...(posting.questions || []).map((question, index) => ({ posting, question, index, kind: 'essay' })),
  ...(posting.interviewQuestions || []).map((question, index) => ({ posting, question, index, kind: 'interview' })),
].filter(use => use.question.experienceIds?.includes(id)));
