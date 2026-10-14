import { defaultState, applySettings, parseFragment, hasContent, styleFromJson } from './state.js';
import { bind, bindLogo, sync, render, offerLinkContent } from './ui.js';
import { bindActions } from './actions.js';
import { showCount } from './counter.js';

export const VERSION = '1.1.0';

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
bindLogo(state);
bindActions(state);
sync(state);
render(state);
showCount();
readFragment();
window.addEventListener('hashchange', readFragment);

if ('serviceWorker' in navigator && location.protocol === 'https:')
  navigator.serviceWorker.register('sw.js').catch(() => {});
