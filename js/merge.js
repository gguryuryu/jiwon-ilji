// 저장 충돌 때 두 창의 변경을 칸 단위로 합친다(세 갈래 합치기)
import { clone, same } from './util.js';

// 세 갈래 합치기: 기준(base)에서 이 창이 고친 칸은 이 창 값을, 다른 창만 고친 칸은 그쪽 값을 쓴다.
// 편집 중인 화면이 들고 있는 객체를 그대로 두기 위해, 이 창의 객체 안으로 합친다.
export function mergeInto(local, base, server) {
  for (const key of ['postings', 'experiences', 'goals', 'certs']) {
    const baseById = new Map((base[key] || []).map(item => [item.id, item]));
    const serverById = new Map((server[key] || []).map(item => [item.id, item]));
    local[key] ||= [];
    local[key] = local[key].filter(item => {
      const before = baseById.get(item.id); const remote = serverById.get(item.id);
      if (before && !remote) return !same(item, before); // 다른 창에서 지웠고 여기서 손대지 않았으면 지운다.
      if (before && remote) {
        for (const field of new Set([...Object.keys(remote), ...Object.keys(item)])) {
          if (same(item[field], before[field]) && !same(remote[field], before[field])) item[field] = clone(remote[field]);
        }
      }
      return true;
    });
    const localIds = new Set(local[key].map(item => item.id));
    for (const remote of server[key] || []) if (!localIds.has(remote.id) && !baseById.has(remote.id)) local[key].push(clone(remote)); // 다른 창에서 새로 만든 것
  }
  if (same(local.calendarEvents, base.calendarEvents)) local.calendarEvents = clone(server.calendarEvents || []);
}
