import { defaultState, applySettings, parseFragment, hasContent, styleFromJson } from './state.js';
import { bind, sync, render, offerLinkContent } from './ui.js';
import { bindActions } from './actions.js';
import { loadLogo } from './logo.js';
import { showCount } from './counter.js';

export const VERSION = '1.0.0';

const state = defaultState();
state.logo = null;

try {
  styleFromJson(state, localStorage.getItem('qr-settings') ?? '');
} catch {
  // Storage may be unavailable; the defaults will do.
}

// A settings link opened while the page is already up changes only the fragment.
function readFragment() {
  const params = parseFragment(location.hash);
  if (!params)
    return;
  applySettings(state, key => params.get(key));
  sync(state);
  render(state);
  if (hasContent(params))
    offerLinkContent(state, params);
}

bind(state);
bindActions(state);
sync(state);
render(state);
showCount();
readFragment();
window.addEventListener('hashchange', readFragment);

const logoInput = document.getElementById('logo-file');
logoInput.addEventListener('change', async () => {
  const file = logoInput.files[0];
  const error = document.getElementById('logo-error');
  error.textContent = '';
  if (!file)
    return;
  try {
    state.logo = await loadLogo(file);
    document.getElementById('logo-clear').hidden = false;
  } catch (err) {
    state.logo = null;
    error.textContent = err.message;
    logoInput.value = '';
  }
  render(state);
});
document.getElementById('logo-clear').addEventListener('click', () => {
  state.logo = null;
  logoInput.value = '';
  document.getElementById('logo-clear').hidden = true;
  render(state);
});

if ('serviceWorker' in navigator && location.protocol === 'https:')
  navigator.serviceWorker.register('sw.js').catch(() => {});
