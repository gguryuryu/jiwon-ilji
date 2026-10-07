// 인적사항: 지원서에 매번 적는 내용을 모아 두고, 칸마다 복사 버튼으로 바로 붙여 넣게 한다.
import { main } from './dom.js';
import { newCert } from './model.js';
import { EDU_KINDS, EDU_LIMIT, PROFILE_GROUPS, addEdu, certDate, eduOf, newProfileField, setCertDate } from './profile-model.js';
import { data, view } from './state.js';
import { persist, scheduleSave } from './store.js';
import { showToast } from './ui.js';
import { autoGrow, copyText, escapeHtml as esc, icon } from './util.js';

const touch = item => { item.updatedAt = new Date().toISOString(); };

// 칸 하나: 입력칸과 복사 버튼. 비어 있으면 복사 버튼은 숨는다(CSS :placeholder-shown).
const copyButton = label => `<button type="button" class="pf-copy" data-profile-action="copy" aria-label="${esc(label)} 복사" title="복사">${icon('copy')}${icon('check')}</button>`;
const cell = (attrs, value, placeholder, label, { multiline = false } = {}) => `<div class="pf-cell" data-label="${esc(label)}">${multiline
  ? `<textarea ${attrs} rows="1" placeholder="${esc(placeholder)}" aria-label="${esc(label)}" autocomplete="off">${esc(value)}</textarea>`
  : `<input ${attrs} value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}" autocomplete="off" spellcheck="false">`}${copyButton(label)}</div>`;
const removeButton = (action, id, label) => `<button type="button" class="pf-remove" data-profile-action="${action}" data-id="${esc(id)}" aria-label="${esc(label)} 지우기" title="지우기">×</button>`;

function groupHtml(group) {
  const rows = data.profileFields.filter(field => field.group === group.key).map(field => `<div class="pf-row" data-id="${esc(field.id)}">
      <input class="pf-label" data-pf="label" value="${esc(field.label)}" placeholder="항목 이름" aria-label="항목 이름" autocomplete="off" spellcheck="false">
      ${cell('class="pf-value" data-pf="value"', field.value, '비어 있음', field.label || '값')}
      ${removeButton('remove-field', field.id, field.label || '항목')}
    </div>`).join('');
  return `<section class="pf-card"><h2 class="pf-heading">${group.title}</h2><div class="pf-rows">${rows}</div>
    <button type="button" class="pf-add" data-profile-action="add-field" data-id="${group.key}">${icon('plus')}항목 추가</button></section>`;
}

const tableHead = labels => `<div class="pf-thead" aria-hidden="true">${labels.map(label => `<span>${label}</span>`).join('')}<span></span></div>`;

function certsHtml() {
  const columns = [['name', '자격·어학명', '예: 정보처리기사'], ['score', '등급·점수', '예: 1급, 875점'], ['number', '자격번호', '자격증에 적힌 번호'], ['issuer', '발급 기관', '예: 한국산업인력공단'], ['date', '취득일', '예: 2025.06.13']];
  const rows = data.certs.map(cert => `<div class="pf-trow" data-cert="${esc(cert.id)}">${columns.map(([key, label, placeholder]) => cell(`data-cert-field="${key}"`, key === 'date' ? certDate(cert) : cert[key] || '', placeholder, label)).join('')}${removeButton('remove-cert', cert.id, cert.name || '자격')}</div>`).join('');
  return `<section class="pf-section">
      <div class="pf-section-head"><h2 class="pf-heading">자격증 · 어학</h2><span class="pf-note">홈의 자격 목록과 같은 목록이에요</span></div>
      <div class="pf-table pf-certs">${tableHead(columns.map(column => column[1]))}${rows}</div>
      <button type="button" class="pf-add" data-profile-action="add-cert">${icon('plus')}자격 추가</button>
    </section>`;
}

function eduHtml(kind) {
  const { title, columns } = EDU_KINDS[kind];
  const items = eduOf(data, kind);
  const rows = items.map(item => `<div class="pf-trow" data-edu="${esc(item.id)}">${columns.map(([key, label, placeholder]) => cell(`data-edu-field="${key}"`, item[key], placeholder, label, { multiline: key === 'content' })).join('')}${removeButton('remove-edu', item.id, item.name || title)}</div>`).join('');
  return `<section class="pf-section">
      <div class="pf-section-head"><h2 class="pf-heading">${title}</h2><span class="pf-note">${items.length}/${EDU_LIMIT}</span></div>
      <div class="pf-table pf-edu-${kind}">${tableHead(columns.map(column => column[1]))}${rows}</div>
      ${items.length < EDU_LIMIT ? `<button type="button" class="pf-add" data-profile-action="add-edu" data-id="${kind}">${icon('plus')}${title} 추가</button>` : `<p class="pf-full">${EDU_LIMIT}개까지 적을 수 있어요.</p>`}
    </section>`;
}

export function renderProfile(focus = '') {
  main.className = 'database-page profile-page';
  main.innerHTML = `<header class="page-header"><h1 class="page-title">인적사항</h1><p class="page-description">지원서에 매번 적는 내용을 모아 두세요. 칸 오른쪽 복사 버튼을 누르면 바로 붙여 넣을 수 있어요.</p></header>
    <div class="pf-groups">${PROFILE_GROUPS.map(groupHtml).join('')}</div>
    ${certsHtml()}${eduHtml('school')}${eduHtml('job')}`;
  main.querySelectorAll('.pf-cell textarea').forEach(autoGrow);
  if (focus) main.querySelector(focus)?.focus();
}

function undoToast(message, restore) {
  persist(); renderProfile();
  showToast(message, { label: '되돌리기', run: () => { restore(); persist(); if (view === 'profile') renderProfile(); } });
}

main.addEventListener('click', async event => {
  if (view !== 'profile') return;
  const control = event.target.closest('[data-profile-action]'); if (!control) return;
  const { profileAction: action, id } = control.dataset;
  if (action === 'copy') {
    const value = control.closest('.pf-cell').querySelector('input, textarea').value;
    if (!value || !(await copyText(value))) { if (value) showToast('복사하지 못했어요. 칸을 눌러 직접 복사해 주세요.'); return; }
    control.classList.add('copied'); clearTimeout(control.copyTimer);
    control.copyTimer = setTimeout(() => control.classList.remove('copied'), 1300);
  }
  if (action === 'add-field') {
    // 같은 묶음의 마지막 항목 바로 뒤에 넣는다.
    const field = newProfileField(id); const last = data.profileFields.findLastIndex(item => item.group === id);
    data.profileFields.splice(last + 1, 0, field); scheduleSave();
    renderProfile(`.pf-row[data-id="${field.id}"] .pf-label`);
  }
  if (action === 'remove-field') {
    const index = data.profileFields.findIndex(item => item.id === id); if (index < 0) return;
    const [removed] = data.profileFields.splice(index, 1);
    undoToast(`‘${removed.label || '항목'}’을(를) 지웠어요.`, () => data.profileFields.splice(Math.min(index, data.profileFields.length), 0, removed));
  }
  if (action === 'add-cert') {
    const cert = newCert(); data.certs.push(cert); scheduleSave();
    renderProfile(`.pf-trow[data-cert="${cert.id}"] [data-cert-field="name"]`);
  }
  if (action === 'remove-cert') {
    const index = data.certs.findIndex(item => item.id === id); if (index < 0) return;
    const [removed] = data.certs.splice(index, 1);
    undoToast(`‘${removed.name || '자격'}’을(를) 지웠어요. 홈의 자격 목록에서도 빠져요.`, () => data.certs.splice(Math.min(index, data.certs.length), 0, removed));
  }
  if (action === 'add-edu') {
    const item = addEdu(data, id); if (!item) return;
    scheduleSave(); renderProfile(`.pf-trow[data-edu="${item.id}"] [data-edu-field="name"]`);
  }
  if (action === 'remove-edu') {
    const index = data.profileEdu.findIndex(item => item.id === id); if (index < 0) return;
    const [removed] = data.profileEdu.splice(index, 1);
    undoToast(`‘${removed.name || EDU_KINDS[removed.kind].title}’을(를) 지웠어요.`, () => data.profileEdu.splice(Math.min(index, data.profileEdu.length), 0, removed));
  }
});

main.addEventListener('input', event => {
  if (view !== 'profile') return;
  const target = event.target; const value = target.value;
  if (target.dataset.pf) {
    const field = data.profileFields.find(item => item.id === target.closest('.pf-row').dataset.id); if (!field) return;
    field[target.dataset.pf] = value;
  } else if (target.dataset.certField) {
    const cert = data.certs.find(item => item.id === target.closest('.pf-trow').dataset.cert); if (!cert) return;
    if (target.dataset.certField === 'date') setCertDate(cert, value); else cert[target.dataset.certField] = value;
    touch(cert);
  } else if (target.dataset.eduField) {
    const item = data.profileEdu.find(entry => entry.id === target.closest('.pf-trow').dataset.edu); if (!item) return;
    item[target.dataset.eduField] = value;
    if (target.tagName === 'TEXTAREA') autoGrow(target);
  } else return;
  scheduleSave();
});

// 한 줄 칸에서 Enter는 다음 칸으로 간다. 항목 이름에서는 그 값으로, 값에서는 아래 줄의 값으로.
main.addEventListener('keydown', event => {
  const target = event.target;
  if (view !== 'profile' || event.key !== 'Enter' || event.isComposing || target.tagName !== 'INPUT' || !target.closest('.pf-card, .pf-section')) return;
  event.preventDefault();
  if (target.classList.contains('pf-label')) { target.closest('.pf-row').querySelector('.pf-value').focus(); return; }
  const fields = [...target.closest('.pf-card, .pf-section').querySelectorAll(target.classList.contains('pf-value') ? '.pf-value' : '.pf-cell input, .pf-cell textarea')];
  fields[fields.indexOf(target) + 1]?.focus();
});
