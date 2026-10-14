import { defaultState, applySettings, parseFragment, hasContent, styleFromJson } from './state.js';
import { bind, sync, render, offerLinkContent } from './ui.js';
import { bindActions } from './actions.js';
import { loadLogo } from './logo.js';

export const VERSION = '1.0.0';

const state = defaultState();
state.logo = null;

try {
  styleFromJson(state, localStorage.getItem('qr-settings') ?? '');
} catch {
  // Storage may be unavailable; the defaults will do.
}

const params = parseFragment(location.hash);
if (params) {
  applySettings(state, key => params.get(key));
  if (hasContent(params))
    offerLinkContent(state, params);
}

bind(state);
bindActions(state);
sync(state);
render(state);

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
