// Bridge between the web app and the extension. Runs as a content script on
// the dashboard's origins (configured in manifest.json content_scripts).
//
// Protocol:
//   Page  →  Extension: { source: 'tally-dashboard', type: 'setConfig', config: {...} }
//   Page  →  Extension: { source: 'tally-dashboard', type: 'ping' }
//   Extension → Page:   { source: 'tally-extension', event: 'ready',   version }
//   Extension → Page:   { source: 'tally-extension', event: 'configSaved' }
//   Extension → Page:   { source: 'tally-extension', event: 'pong',    version }
//
// The bridge only accepts messages whose `source` field is 'tally-dashboard'
// so random other scripts on the page can't spoof writes into our storage.

const STORAGE_KEY = 'tallyDashboardSyncConfig';
const VERSION = chrome.runtime.getManifest().version;

function send(event, extra = {}) {
  window.postMessage({ source: 'tally-extension', event, version: VERSION, ...extra }, '*');
}

window.addEventListener('message', (ev) => {
  if (ev.source !== window) return;
  const data = ev.data;
  if (!data || data.source !== 'tally-dashboard') return;

  if (data.type === 'ping') {
    send('pong');
    return;
  }

  if (data.type === 'setConfig' && data.config && typeof data.config === 'object') {
    // Merge so callers can push a partial update (e.g. just the sync token).
    chrome.storage.local.get([STORAGE_KEY], (r) => {
      const merged = { ...(r[STORAGE_KEY] || {}), ...data.config };
      chrome.storage.local.set({ [STORAGE_KEY]: merged }, () => {
        send('configSaved');
      });
    });
  }
});

// Announce presence on load so the page's detection effect fires without
// needing to ping explicitly. Ping is still supported for on-demand checks.
send('ready');
