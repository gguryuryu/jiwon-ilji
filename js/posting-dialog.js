// 새 공고 창: 링크를 읽어 채우고 저장
import { renderDialogDates } from './date-field.js';
import { $, postingDialog } from './dom.js';
import { statusOptions } from './model.js';
import { navTo } from './router.js';
import { data, view } from './state.js';
import { persist } from './store.js';
import { showToast } from './ui.js';
import { dateValue, escapeHtml, uid, validUrl } from './util.js';

// 지원 현황에서 저장했으면 목록을 둔 채 오른쪽 사이드 피크로, 다른 화면이면 공고 페이지로 연다.
const openSaved = id => view === 'postings' ? navTo('postings', id) : navTo('posting-detail', id);

let postingPreviewTimer;

let postingPreviewRequest = 0;

let postingPreviewUrl = '';

const postingAutofilled = new Map();

function showPostingReview(source = '') {
  $('#posting-review').hidden = false;
  $('#posting-save-button').hidden = false;
  $('#manual-entry-button').hidden = true;
  $('#posting-review').querySelectorAll('input, select').forEach(control => { control.disabled = false; });
  $('#posting-review-source').textContent = source;
  $('#posting-review-heading').textContent = source.endsWith('읽음') ? '가져온 정보' : '공고 정보';
  const title = $('#posting-form').elements.originalTitle.value.trim();
  $('#posting-title-preview').textContent = title;
  $('#posting-title-preview').hidden = !title;
  $('#preview-button').textContent = validUrl($('#posting-form').elements.url.value.trim()) ? '다시 읽기' : '가져오기';
}

export function openPostingDialog(item = null, event = null, fields = null) {
  clearTimeout(postingPreviewTimer); postingPreviewRequest++;
  postingAutofilled.clear();
  const form = $('#posting-form'); form.reset(); form.dataset.id = item?.id || ''; form.dataset.eventId = event?.id || ''; form.dataset.eventTitle = event?.title || ''; form.dataset.note = fields?.note || '';
  $('#posting-dialog-title').textContent = item ? '공고 수정' : '새 공고';
  $('#posting-form .dialog-description').textContent = item ? '바꿀 내용만 고친 뒤 저장해 주세요.' : event ? '캘린더 일정에서 읽은 내용이에요. 빈칸만 채우면 됩니다.' : '가져온 정보는 저장 전에 확인하고 수정할 수 있어요.';
  $('#preview-message').textContent = item ? '필요한 정보만 바꿔 주세요.' : '링크를 붙여 넣으면 자동으로 읽습니다.';
  $('#posting-review').hidden = !item && !event;
  $('#posting-save-button').hidden = !item && !event;
  $('#manual-entry-button').hidden = Boolean(item || event);
  $('#posting-more').open = Boolean(item);
  $('#preview-button').textContent = item || event ? '다시 읽기' : '가져오기';
  $('#preview-button').disabled = false;
  form.elements.url.removeAttribute('aria-busy');
  $('#posting-review').querySelectorAll('input, select').forEach(control => { control.disabled = !item && !event; });
  const values = item || { url: fields?.url || event?.url || '', organization: fields?.organization || '', role: fields?.role || '', originalTitle: fields?.originalTitle || event?.title || '', employmentType: fields?.employmentType || '', deadline: fields?.deadline || event?.endDate || event?.date || '', deadlineTime: fields?.deadlineTime || event?.time || '', status: '관심', nextDate: '', nextTime: '', nextLabel: '' };
  for (const name of ['url', 'organization', 'role', 'originalTitle', 'employmentType', 'deadline', 'deadlineTime', 'status', 'nextDate', 'nextTime', 'nextLabel']) form.elements[name].value = values[name] || '';
  renderDialogDates();
  postingPreviewUrl = form.elements.url.value.trim();
  if (item || event) showPostingReview(item ? '저장된 공고' : fields ? '일정에서 읽음' : '일정에서 가져옴');
  postingDialog.showModal();
  // 일정에서 읽은 값이 있으면 비어 있는 첫 칸으로 바로 이동한다.
  const firstEmpty = fields && ['organization', 'role', 'deadline'].find(name => !form.elements[name].value);
  (firstEmpty ? form.elements[firstEmpty] : fields ? $('#posting-save-button') : form.elements.url).focus();
  if (fields) $('#preview-message').textContent = firstEmpty ? '빈칸만 채우고 저장해 주세요.' : '내용을 확인하고 저장해 주세요.';
  else if (event?.url) loadPostingPreview();
}

$('#posting-status').innerHTML = statusOptions.map(option => `<option>${escapeHtml(option)}</option>`).join('');

$('#posting-form').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('#posting-review').hidden) { loadPostingPreview(); return; }
  const form = event.currentTarget; const id = form.dataset.id;
  const prior = data.postings.find(item => item.id === id);
  const item = { id: id || uid(), organization: form.elements.organization.value.trim(), role: form.elements.role.value.trim(), originalTitle: form.elements.originalTitle.value.trim(), employmentType: form.elements.employmentType.value, deadline: dateValue(form.elements.deadline.value), deadlineTime: form.elements.deadlineTime.value, status: form.elements.status.value, nextDate: dateValue(form.elements.nextDate.value), nextTime: form.elements.nextTime.value, nextLabel: form.elements.nextLabel.value.trim(), url: validUrl(form.elements.url.value.trim()), calendarEventId: prior?.calendarEventId || form.dataset.eventId || '', note: prior ? prior.note || '' : form.dataset.note || '', questions: prior?.questions || [], interviewQuestions: prior?.interviewQuestions || [], interviewReviews: prior?.interviewReviews || [], createdAt: prior?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (form.elements.url.value && !item.url) { $('#preview-message').textContent = '공고 링크가 올바른 http 또는 https 주소인지 확인해 주세요.'; form.elements.url.focus(); return; }
  if (item.deadlineTime && !item.deadline) { showToast('마감 시각과 함께 마감일도 입력해 주세요.'); form.elements.deadline.focus(); return; }
  if ((item.nextTime || item.nextLabel) && !item.nextDate) { showToast('다음 일정의 날짜를 입력해 주세요.'); form.elements.nextDate.focus(); return; }
  if (!prior && form.dataset.eventId) Object.assign(item, { calendarTitle: form.dataset.eventTitle, syncedDeadline: item.deadline, syncedDeadlineTime: item.deadlineTime || '' });
  if (prior) Object.assign(prior, item); else data.postings.push(item);
  await persist(); postingDialog.close(); openSaved(item.id); showToast(prior ? '공고를 수정했습니다.' : '공고를 저장했습니다.');
});

async function loadPostingPreview() {
  const form = $('#posting-form'); const url = form.elements.url.value.trim(); const message = $('#preview-message');
  if (!validUrl(url)) { message.textContent = '올바른 공고 링크를 입력해 주세요.'; return; }
  const request = ++postingPreviewRequest;
  postingPreviewUrl = url;
  message.textContent = '공고를 읽고 있어요…'; $('#preview-button').disabled = true;
  form.elements.url.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(`/api/preview?url=${encodeURIComponent(url)}`); const result = await response.json();
    if (request !== postingPreviewRequest || !postingDialog.open) return;
    if (!response.ok) throw new Error(result.error || '정보를 읽지 못했습니다.');
    for (const name of ['organization', 'role', 'originalTitle', 'deadline', 'deadlineTime', 'employmentType']) {
      if (!form.elements[name].value && result[name]) {
        form.elements[name].value = result[name];
        postingAutofilled.set(name, result[name]);
      }
    }
    renderDialogDates();
    showPostingReview(result.method === 'ai' ? 'AI로 읽음' : result.method === 'job-alio' ? '잡알리오에서 읽음' : result.method === 'structured' ? '공고에서 읽음' : '페이지 제목에서 읽음');
    const missing = [!form.elements.organization.value && '회사·기관명', !form.elements.role.value && '직무', !form.elements.deadline.value && '마감일'].filter(Boolean);
    const duplicate = data.postings.find(item => validUrl(item.url) === validUrl(result.url || url) && item.id !== form.dataset.id);
    message.textContent = missing.length ? `${missing.join('·')}만 확인해 주세요.` : '내용을 확인하고 저장해 주세요.';
    if (result.aiError && missing.length) message.textContent += /API 키|권한|한도/.test(result.aiError) ? ' (AI 보완은 API 키 문제로 쓰지 못했어요.)' : ` (${result.aiError})`;
    if (duplicate) {
      message.innerHTML = `<span class="duplicate-note">${escapeHtml(duplicate.organization)} 공고로 이미 등록된 링크예요.</span> <button type="button" class="inline-link" data-open-posting="${escapeHtml(duplicate.id)}">기존 공고 열기</button>`;
    }
  } catch (error) {
    if (request !== postingPreviewRequest || !postingDialog.open) return;
    showPostingReview('직접 확인');
    message.textContent = /Failed to fetch|Unexpected token/i.test(error.message)
      ? '앱 서버에 연결하지 못했어요. 앱을 다시 열어 주세요.'
      : error.message || '공고 정보를 읽지 못했어요. 빈칸만 채워 주세요.';
  } finally {
    if (request === postingPreviewRequest) { $('#preview-button').disabled = false; form.elements.url.removeAttribute('aria-busy'); }
  }
}

$('#preview-button').addEventListener('click', loadPostingPreview);

$('#preview-message').addEventListener('click', event => {
  const id = event.target.closest('[data-open-posting]')?.dataset.openPosting; if (!id) return;
  postingDialog.close(); openSaved(id);
});

$('#manual-entry-button').addEventListener('click', () => { showPostingReview('직접 입력'); $('#preview-message').textContent = '필수 항목만 채운 뒤 저장하세요.'; $('#posting-form').elements.organization.focus(); });

$('#posting-url').addEventListener('input', event => {
  clearTimeout(postingPreviewTimer);
  const url = event.target.value.trim();
  postingPreviewRequest++;
  $('#preview-button').disabled = false;
  event.target.removeAttribute('aria-busy');
  if (url !== postingPreviewUrl) {
    const form = $('#posting-form');
    for (const [name, value] of postingAutofilled) if (form.elements[name].value === value) form.elements[name].value = '';
    renderDialogDates();
    postingAutofilled.clear();
    $('#posting-title-preview').textContent = form.elements.originalTitle.value.trim();
    $('#posting-title-preview').hidden = !form.elements.originalTitle.value.trim();
    if (!form.dataset.id && !form.elements.organization.value && !form.elements.role.value) {
      $('#posting-review').hidden = true;
      $('#posting-save-button').hidden = true;
      $('#manual-entry-button').hidden = false;
      $('#posting-review').querySelectorAll('input, select').forEach(control => { control.disabled = true; });
    }
  }
  $('#preview-message').textContent = validUrl(url) ? '공고를 읽고 있어요…' : '링크를 붙여 넣으면 자동으로 읽습니다.';
  if (!validUrl(url)) return;
  postingPreviewTimer = setTimeout(loadPostingPreview, event.inputType === 'insertFromPaste' ? 160 : 700);
});

$('#posting-url').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); clearTimeout(postingPreviewTimer); loadPostingPreview(); }
});
