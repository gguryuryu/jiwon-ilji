import test from 'node:test';
import assert from 'node:assert/strict';
import { essayGroups } from '../js/model.js';

test('자소서 탭: 쓸 곳은 마감 가까운 순, 지원한 곳은 최근 마감 먼저(마감일 없으면 맨 아래), 마감 지난 관심은 맨 아래', () => {
  const posting = (organization, status, deadline) => ({ organization, status, deadline });
  const postings = [
    posting('가', '관심', '2026-10-20'), posting('나', '자소서 작성 중', '2026-10-08'), posting('다', '관심', ''),
    posting('사', '지원 완료', ''), posting('라', '지원 완료', '2026-09-01'), posting('마', '최종 불합격', '2026-10-01'),
    posting('바', '관심', '2026-10-01'),
  ];
  const groups = essayGroups(postings, '2026-10-07');
  assert.deepEqual(groups.map(group => [group.key, group.items.map(item => item.organization).join('')]), [['writing', '나가다'], ['applied', '마라사'], ['closed', '바']]);
  assert.deepEqual(essayGroups([posting('가', '관심', '')], '2026-10-07').map(group => group.key), ['writing']);
});

test('경험 정리: 주제별 경험 수, 주제 키워드만 있는 경험은 빈 경험, 답변에 넣을 글', async () => {
  const { topicCounts, blankExperience, experiencePlainText } = await import('../js/model.js');
  const experiences = [{ keywords: ['협업', '갈등 해결'] }, { keywords: ['협업', '데이터'] }];
  assert.deepEqual(topicCounts(experiences).slice(0, 3), [{ topic: '협업', count: 2 }, { topic: '갈등 해결', count: 1 }, { topic: '문제 해결', count: 0 }]);
  assert.equal(blankExperience({ name: '', keywords: ['리더십'] }), true);
  assert.equal(blankExperience({ name: '', keywords: ['데이터'] }), false);
  const detail = '## 상황\n\n동아리에서 **역할**이 겹쳤다.\n\n## 과제\n\n## 행동\n\n- 표로 정리\n- 점검 회의';
  assert.equal(experiencePlainText({ detail }), '동아리에서 역할이 겹쳤다.\n\n- 표로 정리\n- 점검 회의');
  assert.equal(experiencePlainText({ detail: '## 상황', description: '요약', result: '배포' }), '요약\n배포');
});

test('D-day: 오늘·앞으로는 남은 날(사흘 안이면 강조), 지났거나 날짜가 없으면 비움', async () => {
  const { dDay, dateKey } = await import('../js/util.js');
  const after = days => { const date = new Date(); date.setDate(date.getDate() + days); return dateKey(date); };
  assert.deepEqual([0, 3, 4, -1].map(days => dDay(after(days))), [{ text: '오늘', soon: true }, { text: 'D-3', soon: true }, { text: 'D-4', soon: false }, { text: '', soon: false }]);
  assert.equal(dDay('').text, '');
});
