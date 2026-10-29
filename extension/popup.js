'use strict';

let tab;
let state;
const byId = (id) => document.getElementById(id);

init().catch(showError);

async function init() {
  PreSendI18n.apply();
  if (!globalThis.chrome?.tabs?.query) {
    renderPreview();
    return;
  }
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  bind();
  await Promise.all([refreshState(), renderShortcut()]);
}

function renderPreview() {
  state = { ok: true, enabled: true, source: 'global', globalDefault: true, siteRule: null, origin: PreSendI18n.t('currentPage') };
  render();
  byId('shortcut').textContent = `Shortcut: ${PreSendI18n.t('notSet')}`;
}

async function refreshState(statusMessage = '') {
  state = await sendRuntime({ type: 'GET_TAB_STATE', tabId: tab.id });
  if (!state?.ok) throw new Error(state?.error || PreSendI18n.t('cannotManage'));
  render();
  setStatus(statusMessage);
}

function render() {
  byId('origin').textContent = state.origin || PreSendI18n.t('restrictedPage');
  byId('effective-state').classList.toggle('disabled', !state.enabled);
  byId('effective-title').textContent = PreSendI18n.t(state.enabled ? 'translationEnabled' : 'translationDisabled');
  byId('effective-source').textContent = sourceLabel(state.source);
  selectSegment('global', String(state.globalDefault));
  selectSegment('site', state.siteRule === null ? 'inherit' : String(state.siteRule));
  byId('site-state').textContent = PreSendI18n.t(state.siteRule === null ? 'usesGlobalDefault' : state.siteRule ? 'alwaysOn' : 'alwaysOff');
  byId('refresh-notice').hidden = !state.supportedPage || state.contentReady;
  byId('restricted-notice').hidden = state.supportedPage !== false;
}

function sourceLabel(source) {
  return PreSendI18n.t(source === 'site' ? 'siteOverride' : 'globalDefault');
}

function selectSegment(name, value) {
  document.querySelectorAll(`[data-${name}]`).forEach((button) => {
    const selected = button.dataset[name] === value;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

async function renderShortcut() {
  const commands = await chrome.commands.getAll();
  const command = commands.find((item) => item.name === 'translate-focused-input');
  byId('shortcut').textContent = `Shortcut: ${command?.shortcut || PreSendI18n.t('notSet')}`;
}

function bind() {
  document.querySelectorAll('[data-global]').forEach((button) => button.addEventListener('click', async () => {
    await send({ type: 'SET_GLOBAL', enabled: button.dataset.global === 'true' });
    await refreshState('Global default updated.');
  }));
  document.querySelectorAll('[data-site]').forEach((button) => button.addEventListener('click', async () => {
    const value = button.dataset.site;
    await send(value === 'inherit' ? { type: 'CLEAR_SITE', origin: state.origin } : { type: 'SET_SITE', origin: state.origin, enabled: value === 'true' });
    await refreshState('Site setting updated.');
  }));
  byId('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  byId('refresh-page').addEventListener('click', async () => {
    byId('refresh-page').disabled = true;
    byId('refresh-page').textContent = PreSendI18n.t('refreshing');
    await chrome.tabs.reload(tab.id);
    window.close();
  });
  byId('shortcut').addEventListener('click', () => chrome.tabs.create({ url: shortcutManagerUrl() }));
}

async function send(message) {
  const response = await sendRuntime(message);
  if (!response?.ok) throw new Error(response?.error || 'The setting could not be saved.');
  return response;
}

// Sends a message to the background service worker, waking it once if it is cold.
async function sendRuntime(message) {
  const invoke = () => chrome.runtime.sendMessage(message);
  try {
    return await invoke();
  } catch (error) {
    // MV3 service workers can be asleep right after an extension reload, so the first
    // message rejects with "Could not establish connection. Receiving end does not
    // exist." Waking it and retrying once is the remedy; the raw Chrome string must
    // never be shown to the user.
    if (!/Receiving end does not exist|Could not establish connection/i.test(String(error?.message || error))) throw error;
    await new Promise((resolve) => setTimeout(resolve, 300));
    try { return await invoke(); } catch { throw new Error(PreSendI18n.t('connectionError')); }
  }
}

function shortcutManagerUrl() { return /Edg\//.test(navigator.userAgent) ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts'; }
function setStatus(message) { byId('status').textContent = message; }
function showError(error) { setStatus(error?.message || 'This page cannot be managed.'); }
