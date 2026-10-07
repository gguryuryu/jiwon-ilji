// 기업별 자료 파일(공고문·직무기술서 등): 자소서 탭에서 올리고, 누르면 컴퓨터의 기본 프로그램으로 연다.
// 파일은 기록 폴더의 files/ 에 두고, 공고 기록(posting.files)에는 이름·크기만 적는다.
import { main } from './dom.js';
import { data, selectedId, view } from './state.js';
import { persist } from './store.js';
import { showToast } from './ui.js';
import { escapeHtml as esc, icon } from './util.js';

const appHeaders = { 'X-Jiwon-Ilji': '1' };
const pendingDeletes = new Map(); // 지운 파일은 되돌리기를 누를 수 있는 동안 실제로 지우지 않는다.
const uploading = new Map(); // 공고 id → 올리는 중인 파일 이름들

export const formatSize = bytes => bytes < 1024 ? `${bytes}B` : bytes < 1024 ** 2 ? `${Math.round(bytes / 1024)}KB` : `${(bytes / 1024 ** 2).toFixed(1)}MB`;

const kindIcon = name => /\.(png|jpe?g|gif|webp|heic)$/i.test(name) ? 'image' : 'doc';

export function filesHtml(item) {
  const chips = (item.files || []).map(file => `<span class="essay-file">
      <button type="button" class="essay-file-open" data-file-open="${esc(file.id)}" title="${esc(file.name)} · 기본 프로그램으로 열기">${icon(kindIcon(file.name))}<span class="essay-file-name">${esc(file.name)}</span><span class="essay-file-size">${formatSize(file.size || 0)}</span></button>
      <button type="button" class="chip-remove" data-file-remove="${esc(file.id)}" aria-label="${esc(file.name)} 지우기">×</button>
    </span>`).join('');
  const busy = (uploading.get(item.id) || []).map(name => `<span class="essay-file busy"><span class="essay-file-open">${icon('upload')}<span class="essay-file-name">${esc(name)}</span><span class="essay-file-size">올리는 중…</span></span></span>`).join('');
  return `<span class="essay-files-label">${icon('paperclip')}자료</span>${chips}${busy}
    <button type="button" class="essay-file-add" data-file-add>${icon('plus')}${item.files?.length ? '추가' : '공고문·직무기술서 올리기'}</button>
    <input type="file" class="essay-file-input" multiple hidden>`;
}

const current = () => view === 'essays' ? data.postings.find(posting => posting.id === selectedId) : null;
const refresh = item => { const box = main.querySelector('#essay-files'); if (box && current() === item) box.innerHTML = filesHtml(item); };

export async function uploadFiles(item, fileList) {
  const list = [...fileList]; if (!list.length) return;
  const names = uploading.get(item.id) || []; uploading.set(item.id, names);
  names.push(...list.map(file => file.name)); refresh(item);
  for (const file of list) {
    try {
      const response = await fetch(`/api/files?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { ...appHeaders, 'Content-Type': 'application/octet-stream' }, body: file });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `서버 오류 (${response.status})`);
      (item.files ||= []).push({ id: result.id, name: result.name, size: result.size, addedAt: new Date().toISOString() });
      item.updatedAt = new Date().toISOString(); persist();
    } catch (error) { showToast(`‘${file.name}’을(를) 올리지 못했어요 · ${error.message}`); }
    names.splice(names.indexOf(file.name), 1); if (!names.length) uploading.delete(item.id); refresh(item);
  }
}

async function openFile(id) {
  const response = await fetch(`/api/files/${encodeURIComponent(id)}/open`, { method: 'POST', headers: appHeaders }).catch(() => null);
  if (response?.status === 404) showToast('파일을 찾을 수 없어요. 다른 컴퓨터에서 올린 파일은 그 컴퓨터에만 있어요.');
  else if (!response?.ok) showToast('파일을 열지 못했어요.');
}

function removeFile(item, id) {
  const index = (item.files || []).findIndex(file => file.id === id); if (index < 0) return;
  const [removed] = item.files.splice(index, 1);
  item.updatedAt = new Date().toISOString(); persist(); refresh(item);
  // 알림이 사라진 뒤(되돌리기를 누르지 않았으면) 컴퓨터에서도 지운다.
  pendingDeletes.set(id, setTimeout(() => { pendingDeletes.delete(id); fetch(`/api/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: appHeaders }).catch(() => {}); }, 9000));
  showToast(`‘${removed.name}’을(를) 지웠어요.`, { label: '되돌리기', run: () => {
    clearTimeout(pendingDeletes.get(id)); pendingDeletes.delete(id);
    item.files.splice(Math.min(index, item.files.length), 0, removed); item.updatedAt = new Date().toISOString(); persist(); refresh(item);
  } });
}

main.addEventListener('click', event => {
  const item = current(); if (!item) return;
  const open = event.target.closest('[data-file-open]'); if (open) { openFile(open.dataset.fileOpen); return; }
  const remove = event.target.closest('[data-file-remove]'); if (remove) { removeFile(item, remove.dataset.fileRemove); return; }
  if (event.target.closest('[data-file-add]')) main.querySelector('.essay-file-input')?.click();
});

main.addEventListener('change', event => {
  const item = current(); if (!item || !event.target.classList.contains('essay-file-input')) return;
  uploadFiles(item, event.target.files); event.target.value = '';
});

// 자소서 쪽(오른쪽)에 파일을 끌어다 놓으면 그 기업의 자료로 올린다.
const hasFiles = event => [...(event.dataTransfer?.types || [])].includes('Files');
main.addEventListener('dragover', event => {
  const zone = current() && hasFiles(event) && event.target.closest?.('.essay-editor'); if (!zone) return;
  event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; zone.classList.add('file-over');
});
main.addEventListener('dragleave', event => {
  const zone = event.target.closest?.('.essay-editor');
  if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove('file-over');
});
main.addEventListener('drop', event => {
  const zone = current() && hasFiles(event) && event.target.closest?.('.essay-editor'); if (!zone) return;
  event.preventDefault(); zone.classList.remove('file-over');
  uploadFiles(current(), event.dataTransfer.files);
});

// 다른 곳에 파일을 떨어뜨려도 앱 화면이 그 파일로 바뀌지 않게 막는다.
for (const type of ['dragover', 'drop']) window.addEventListener(type, event => { if (hasFiles(event) && !event.defaultPrevented) event.preventDefault(); });
