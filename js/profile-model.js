// 인적사항: 지원서마다 다시 적는 내용(기본 정보·학력·병역 등, 학교교육·직업교육). 자격증은 홈의 자격 목록(certs)을 같이 쓴다.
import { normalizeMonth } from './model.js';
import { uid } from './util.js';

// 이름·값 한 줄씩. 처음 기본 항목은 고정 id라 두 창이 동시에 처음 열어도 겹쳐 생기지 않는다.
export const PROFILE_GROUPS = [
  { key: 'basic', title: '기본 정보', fields: ['이름', '한자 이름', '영문 이름', '생년월일', '휴대폰', '이메일', '주소'] },
  { key: 'school', title: '학력', fields: ['고등학교', '대학교', '전공', '입학', '졸업', '학점'] },
  { key: 'etc', title: '병역 · 기타', fields: ['병역', '보훈 대상', '장애 여부', '취업지원 대상'] },
];

export const defaultProfileFields = () => PROFILE_GROUPS.flatMap(group => group.fields.map((label, index) => ({ id: `pf-${group.key}-${index}`, group: group.key, label, value: '' })));

export const newProfileField = group => ({ id: uid(), group, label: '', value: '' });

// 학교교육·직업교육: 블라인드 채용 지원서의 교육사항 칸. 지원서마다 10개 안팎이라 10개까지 적는다.
export const EDU_LIMIT = 10;
export const EDU_KINDS = {
  school: { title: '학교교육', columns: [['name', '과목명', '예: 데이터베이스'], ['hours', '이수 학점·시간', '예: 3학점'], ['content', '주요 내용', '배운 내용을 한두 줄로']] },
  job: { title: '직업교육', columns: [['name', '교육명', '예: 빅데이터 분석 과정'], ['org', '교육기관', '예: 한국폴리텍대학'], ['period', '기간', '예: 2025.03–2025.06'], ['hours', '시간', '예: 120시간'], ['content', '주요 내용', '배운 내용을 한두 줄로']] },
};

export const eduOf = (state, kind) => (state.profileEdu || []).filter(item => item.kind === kind);

export function addEdu(state, kind) {
  if (eduOf(state, kind).length >= EDU_LIMIT) return null;
  const item = { id: uid(), kind, name: '', org: '', period: '', hours: '', content: '' };
  state.profileEdu.push(item);
  return item;
}

// 자격증 취득일: 지원서는 보통 날짜까지 묻는다. 날짜(acquiredDate)를 적으면 홈에서 쓰는 취득 달(acquired)도 맞춘다.
export const certDate = cert => cert.acquiredDate || (cert.acquired ? cert.acquired.replace('-', '.') : '');

export function setCertDate(cert, value) {
  cert.acquiredDate = value;
  const month = normalizeMonth(value);
  if (month) cert.acquired = month;
}

// 추가만 누르고 비워 둔 줄은 정리한다(인적사항을 떠날 때·불러올 때). 고친 게 있으면 true.
const blank = (item, keys) => keys.every(key => !String(item[key] || '').trim());
export const blankCert = cert => blank(cert, ['name', 'score', 'number', 'issuer', 'acquiredDate', 'acquired', 'expires', 'note']);

export function tidyProfile(state) {
  const before = state.profileFields.length + state.profileEdu.length + state.certs.length;
  state.profileFields = state.profileFields.filter(field => !blank(field, ['label', 'value']));
  state.profileEdu = state.profileEdu.filter(item => !blank(item, ['name', 'org', 'period', 'hours', 'content']));
  state.certs = state.certs.filter(cert => !blankCert(cert));
  return state.profileFields.length + state.profileEdu.length + state.certs.length !== before;
}
