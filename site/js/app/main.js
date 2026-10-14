import { defaultState, applySettings, parseFragment, hasContent, styleFromJson } from './state.js';
import { bind, bindLogo, sync, render, offerLinkContent, hideLinkBanner } from './ui.js';
import { bindActions } from './actions.js';
import { showCount } from './counter.js';

// Read by the tests, which check it against the service worker's copy. The deploy script
// stamps both with the commit being served.
export const VERSION = '1.2.0';

const state = defaultState();

try {
  styleFromJson(state, localStorage.getItem('qr-settings') ?? '');
} catch {
  // Storage may be unavailable; the defaults will do.
}

// Reads the settings link at load, and again when one is opened on the live page, which only
// changes the fragment. A link's style replaces the page's; Ignore puts it back.
function readFragment() {
  hideLinkBanner();
  const params = parseFragment(location.hash);
  if (!params)
    return;
  const before = { ...state.style };
  applySettings(state, key => params.get(key));
  sync(state);
  render(state);
  if (hasContent(params))
    offerLinkContent(state, params, () => {
      state.style = before;
    });
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
