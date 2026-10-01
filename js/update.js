import { $ } from './dom.js';
import { saveBeforeUpdate } from './store.js';
import { showToast } from './ui.js';

export function setupUpdateButton() {
  const button = $('#update-button');
  const label = button.querySelector('span');
  const state = $('#update-state');
  let restartRequired = false;
  button.disabled = false;
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    label.textContent = '업데이트 중…';
    state.hidden = false;
    state.classList.remove('error');
    state.textContent = '저장한 뒤 새 버전을 가져와요.';
    try {
      await saveBeforeUpdate();
      const response = await fetch('/api/update', { method: 'POST', headers: { 'X-Jiwon-Ilji': '1' } });
      if (response.status === 404) throw new Error('업데이트 기능을 적용하려면 앱을 한 번 껐다 켜 주세요.');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '업데이트하지 못했어요.');
      restartRequired ||= result.updated;
      const message = restartRequired ? '업데이트를 받았어요. 앱을 껐다 켜면 적용돼요.' : '이미 최신 버전이에요.';
      state.textContent = restartRequired ? '적용하려면 앱을 다시 켜 주세요.' : '최신 버전이에요.';
      state.classList.remove('error');
      showToast(message);
    } catch (error) {
      const message = error instanceof TypeError ? '앱 서버에 연결하지 못했어요. 앱을 다시 켠 뒤 눌러 주세요.' : error.message;
      state.textContent = message;
      state.classList.add('error');
      showToast(message);
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      label.textContent = '업데이트';
    }
  });
}
