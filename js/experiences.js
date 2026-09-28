// 경험 정리: 목록, 상세, 키워드, 문서 편집기
import { $, main } from './dom.js';
import { topbar, wireProperties } from './posting-detail.js';
import { navTo } from './router.js';
import { data, experienceUses, selectedId, view } from './state.js';
import { persist, saveCurrentEditor, scheduleSave } from './store.js';
import { escapeHtml, icon, propRow, th } from './util.js';

let experienceSearch = '';

let experienceKeyword = '';

// 같은 키워드를 다시 누르면 필터를 푼다. 다른 화면에서 누르면 경험 정리로 가서 걸러 보여 준다.
export function toggleExperienceKeyword(keyword) {
  experienceKeyword = view === 'experiences' && experienceKeyword === keyword ? '' : keyword;
  if (view === 'experiences') refreshExperienceTable(); else navTo('experiences');
}

function filteredExperiences() {
  return data.experiences.filter(item => (!experienceKeyword || item.keywords?.includes(experienceKeyword))
    && [item.name, item.type, item.role, item.keywords?.join(' '), item.description].some(value => String(value || '').toLocaleLowerCase().includes(experienceSearch.toLocaleLowerCase())));
}

function experienceResults() {
  const rows = filteredExperiences().map(item => {
    const id = escapeHtml(item.id);
    const uses = experienceUses(item.id);
    const postings = new Set(uses.map(use => use.posting.id)).size;
    const cell = value => value ? escapeHtml(value) : '<span class="placeholder">—</span>';
    return `<tr class="data-row"><td><button type="button" class="row-title" data-action="open-experience" data-id="${id}"><span class="row-title-text">${item.name ? escapeHtml(item.name) : '<span class="placeholder">제목 없음</span>'}</span><span class="open-hint">${icon('open')}열기</span></button></td><td class="c-type">${cell(item.type)}</td><td class="c-period">${cell(item.period)}</td><td>${cell(item.role)}</td><td><span class="keywords">${(item.keywords || []).map(keyword => `<button type="button" class="keyword keyword-button${keyword === experienceKeyword ? ' selected' : ''}" data-action="filter-keyword" data-keyword="${escapeHtml(keyword)}">${escapeHtml(keyword)}</button>`).join('') || '<span class="placeholder">—</span>'}</span></td><td class="muted c-desc" title="${escapeHtml(item.description || '')}">${cell(item.description)}</td><td title="${escapeHtml(uses.map(use => `${use.posting.organization} ${use.kind === 'interview' ? '면접 질문' : `${use.index + 1}번 문항`}`).join(', '))}">${postings ? `${postings}곳` : '<span class="placeholder">—</span>'}</td></tr>`;
  }).join('') || `<tr><td colspan="7" class="empty-group">조건에 맞는 경험이 없습니다.</td></tr>`;
  return `${rows}<tr class="add-row"><td colspan="7"><button type="button" data-action="new-experience">${icon('plus')}새 경험</button></td></tr>`;
}

function keywordFilterHtml() {
  const counts = new Map();
  for (const item of data.experiences) for (const keyword of item.keywords || []) counts.set(keyword, (counts.get(keyword) || 0) + 1);
  const keywords = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  return keywords.length ? `<span class="filter-label">키워드</span>${keywords.map(([keyword, count]) => `<button type="button" class="keyword keyword-button${keyword === experienceKeyword ? ' selected' : ''}" data-action="filter-keyword" data-keyword="${escapeHtml(keyword)}" aria-pressed="${keyword === experienceKeyword}">${escapeHtml(keyword)} <span class="keyword-count">${count}</span></button>`).join('')}` : '';
}

function refreshExperienceTable() {
  if (view !== 'experiences' || !$('#experience-results')) return;
  $('#experience-results').innerHTML = experienceResults();
  $('#keyword-filter').innerHTML = keywordFilterHtml();
  $('#experience-count').textContent = experienceCountText();
}

function experienceCountText() {
  const shownCount = filteredExperiences().length;
  return shownCount === data.experiences.length ? `${data.experiences.length}개` : `${data.experiences.length}개 중 ${shownCount}개`;
}

export function renderExperiences() {
  main.className = 'database-page';
  main.innerHTML = `<header class="page-header"><h1 class="page-title">경험 정리</h1><p class="page-description">자소서에 쓸 경험을 키워드와 역할로 정리합니다.</p></header>
    <div class="view-bar"><div class="view-tabs"><span class="view-tab active">${icon('table')}전체 경험<span class="view-count" id="experience-count">${experienceCountText()}</span></span></div><div class="view-actions"><label class="search-box">${icon('search')}<input id="experience-search" type="search" value="${escapeHtml(experienceSearch)}" placeholder="검색" aria-label="경험 검색 (단축키 /)"><kbd>/</kbd></label><button type="button" class="primary-button" data-action="new-experience">${icon('plus')}새 경험</button></div></div>
    <div class="keyword-filter" id="keyword-filter">${keywordFilterHtml()}</div>
    ${!data.experiences.length ? `<div class="empty-state"><h2>기억해 둘 경험을 적어보세요</h2><p>경험 이름과 역할, 키워드만 먼저 적고 자세한 내용은 나중에 이어서 써도 돼요.</p><div class="empty-actions"><button type="button" class="primary-button" data-action="new-experience">${icon('plus')}경험 추가</button></div></div>` : `<div class="table-scroll"><table class="data-table experience-table" aria-label="경험 정리"><thead><tr>${th('text', '경험', '', '22%')}${th('list', '유형', 'c-type', '10%')}${th('calendar', '기간', 'c-period', '12%')}${th('user', '내 역할', '', '15%')}${th('tag', '키워드', '', '18%')}${th('text', '간단 설명', 'c-desc', '15%')}${th('doc', '쓴 공고', '', '8%')}</tr></thead><tbody id="experience-results">${experienceResults()}</tbody></table></div>`}`;
  $('#experience-search')?.addEventListener('input', event => { experienceSearch = event.target.value; refreshExperienceTable(); });
}

export function keywordEditorHtml(item) {
  return `${(item.keywords || []).map(keyword => `<span class="keyword-tag"><button type="button" class="keyword-text" data-action="filter-keyword" data-keyword="${escapeHtml(keyword)}" title="이 키워드로 경험 보기">${escapeHtml(keyword)}</button><button type="button" class="chip-remove" data-action="remove-keyword" data-keyword="${escapeHtml(keyword)}" aria-label="${escapeHtml(keyword)} 키워드 삭제">×</button></span>`).join('')}<input class="keyword-input" placeholder="${item.keywords?.length ? '추가' : '키워드 입력 후 Enter'}" aria-label="키워드 추가" autocomplete="off">`;
}

export function renderExperienceDetail() {
  const item = data.experiences.find(experience => experience.id === selectedId);
  if (!item) return navTo('experiences', null, { history: 'replace' });
  const value = name => escapeHtml(item[name] || '');
  const text = (iconName, label, prop, placeholder) => propRow(iconName, label, `<input class="prop-input" data-prop="${prop}" value="${value(prop)}" placeholder="${placeholder}" aria-label="${label}" autocomplete="off">`);
  main.className = 'detail-page';
  main.innerHTML = `${topbar('back-experiences', 'layers', '경험 정리', item.name, 'delete-experience', item.id)}
    <article class="detail-body">
      <textarea class="title-input" data-prop="name" rows="1" placeholder="경험 이름" aria-label="경험 이름" autocomplete="off">${value('name')}</textarea>
      <div class="props">
        ${text('list', '유형', 'type', '예: 프로젝트, 대외활동')}
        ${text('calendar', '기간', 'period', '예: 2025.03–2025.08')}
        ${text('user', '내 역할', 'role', '비어 있음')}
        ${propRow('tag', '키워드', `<div class="keyword-editor" id="keyword-editor">${keywordEditorHtml(item)}</div>`)}
        ${text('text', '간단 설명', 'description', '한두 문장으로 요약')}
        ${text('check', '핵심 결과', 'result', '비어 있음')}
        ${propRow('doc', '쓴 공고', `<div class="uses">${experienceUses(item.id).map(use => `<button type="button" class="use-link" data-action="open-posting" data-id="${escapeHtml(use.posting.id)}" data-tab="${use.kind}">${escapeHtml(use.posting.organization)}<span>${use.kind === 'interview' ? '면접' : `${use.index + 1}번`} · ${escapeHtml(use.question.title || '문항')}</span></button>`).join('') || '<span class="placeholder">자소서 문항이나 면접 질문에서 이 경험을 연결하면 여기에 표시돼요</span>'}</div>`)}
      </div>
      <section class="doc-section"><div class="section-head"><h2>자세한 내용</h2></div>
        <div id="markdown-editor" class="rich-editor" contenteditable="true" role="textbox" aria-label="경험 상세 작성" aria-multiline="true" data-placeholder="상황, 내가 한 일, 결과를 자유롭게 적어보세요.">${markdownToHtml(item.detail || '')}</div>
        <div class="editor-foot"><span># 제목 · ## 소제목 · - 목록 · ⌘B 굵게</span></div></section>
    </article>`;
  wireProperties(item);
  wireKeywordEditor(item);
  wireEditor();
}

function wireKeywordEditor(item) {
  const editor = $('#keyword-editor');
  editor.addEventListener('keydown', event => {
    if (!event.target.classList.contains('keyword-input') || event.isComposing) return;
    const value = event.target.value.trim();
    if ((event.key === 'Enter' || event.key === ',') && value) {
      event.preventDefault();
      item.keywords = [...new Set([...(item.keywords || []), value])];
      item.updatedAt = new Date().toISOString(); persist();
      editor.innerHTML = keywordEditorHtml(item); editor.querySelector('.keyword-input').focus();
    } else if (event.key === 'Backspace' && !event.target.value && item.keywords?.length) {
      item.keywords = item.keywords.slice(0, -1);
      item.updatedAt = new Date().toISOString(); persist();
      editor.innerHTML = keywordEditorHtml(item); editor.querySelector('.keyword-input').focus();
    }
  });
}

function markdownInline(value) {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  let output = '';
  let inList = false;
  for (const line of lines) {
    if (!line.trim()) { if (inList) { output += '</ul>'; inList = false; } continue; }
    if (/^- /.test(line)) {
      if (!inList) { output += '<ul>'; inList = true; }
      output += `<li>${markdownInline(line.slice(2))}</li>`;
      continue;
    }
    if (inList) { output += '</ul>'; inList = false; }
    if (/^## /.test(line)) output += `<h3>${markdownInline(line.slice(3))}</h3>`;
    else if (/^# /.test(line)) output += `<h2>${markdownInline(line.slice(2))}</h2>`;
    else output += `<p>${markdownInline(line)}</p>`;
  }
  if (inList) output += '</ul>';
  return output || '<p><br></p>';
}

function inlineToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const value = [...node.childNodes].map(inlineToMarkdown).join('');
  if (node.tagName === 'STRONG' || node.tagName === 'B') return `**${value}**`;
  if (node.tagName === 'EM' || node.tagName === 'I') return `*${value}*`;
  if (node.tagName === 'BR') return '';
  return value;
}

function editorToMarkdown(editor) {
  const result = [];
  for (const node of editor.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) { if (node.textContent.trim()) result.push(node.textContent); continue; }
    const value = inlineToMarkdown(node);
    if (node.tagName === 'H2') result.push(`# ${value}`);
    else if (node.tagName === 'H3') result.push(`## ${value}`);
    else if (node.tagName === 'UL') result.push([...node.querySelectorAll(':scope > li')].map(li => `- ${inlineToMarkdown(li)}`).join('\n'));
    else if (value.trim()) result.push(value);
  }
  return result.join('\n\n').trim();
}

// 경험 상세의 문서 편집기 내용을 데이터에 반영한다. 바뀐 내용이 있으면 true.
export function syncEditor() {
  const editor = $('#markdown-editor');
  if (!editor || !selectedId || view !== 'experience-detail') return false;
  const item = data.experiences.find(entry => entry.id === selectedId);
  if (!item) return false;
  const value = editorToMarkdown(editor);
  if (item.detail === value) return false;
  item.detail = value; item.updatedAt = new Date().toISOString();
  return true;
}

function shortcut(editor, event) {
  if (event.key !== ' ' || event.isComposing) return;
  const selection = getSelection();
  if (!selection?.isCollapsed || !editor.contains(selection.anchorNode)) return;
  let block = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement;
  while (block && block.parentElement !== editor && block !== editor) block = block.parentElement;
  if (!block) return;
  const mark = block.textContent.trim();
  if (!['#', '##', '-'].includes(mark)) return;
  event.preventDefault();
  const element = mark === '-' ? document.createElement('li') : document.createElement(mark === '#' ? 'h2' : 'h3');
  element.append(document.createElement('br'));
  const replacement = mark === '-' ? document.createElement('ul') : element;
  if (mark === '-') replacement.append(element);
  if (block === editor) editor.replaceChildren(replacement);
  else block.replaceWith(replacement);
  const range = document.createRange(); range.selectNodeContents(element); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
  saveCurrentEditor();
}

function wireEditor() {
  const editor = $('#markdown-editor');
  editor.addEventListener('keydown', event => shortcut(editor, event));
  editor.addEventListener('input', scheduleSave);
  editor.addEventListener('blur', saveCurrentEditor);
}
