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
