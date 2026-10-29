importScripts('rules.js', 'providers.js', 'languages.js');

const DEFAULTS = { enabled: true, provider: 'builtin', target: 'en', aiProfiles: [], siteRules: {} };
const MENU_TRANSLATE = 'presend-translate';

chrome.runtime.onInstalled.addListener(async (details) => {
  const current = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set(current);
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_TRANSLATE,
      title: chrome.i18n.getMessage('contextMenuTitle') || 'Translate this input',
      contexts: ['editable']
    });
  });
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});

chrome.commands.onCommand.addListener((_command, tab) => triggerTranslation(tab));
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_TRANSLATE) triggerTranslation(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((error) => sendResponse({ ok: false, error: publicError(error) }));
  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case 'CHECK_ACCESS':
      return { ok: true, ...await accessForSender(sender, message.identity) };
    case 'TRANSLATE':
      return { ok: true, text: await translateRemote(message) };
    case 'GET_TAB_STATE':
      return getTabState(message.tabId);
    case 'SET_GLOBAL':
      await chrome.storage.sync.set({ enabled: Boolean(message.enabled) });
      return { ok: true };
    case 'SET_SITE':
      return setSiteRule(message.origin, message.enabled);
    case 'CLEAR_SITE':
      return clearSiteRule(message.origin);
    case 'TRIGGER_TRANSLATION':
      await triggerTranslation({ id: message.tabId });
      return { ok: true };
    case 'TEST_AI_PROFILE':
      return testAIProfile(message.profile, message.apiKey);
    default:
      return { ok: false, error: 'Unknown request.' };
  }
}

async function triggerTranslation(tab) {
  if (!tab?.id) return;
  const delivered = await chrome.tabs.sendMessage(tab.id, { type: 'TRANSLATE_FOCUSED_INPUT' }).then(() => true).catch(() => false);
  if (delivered) return;
  await chrome.scripting.insertCSS({ target: { tabId: tab.id, allFrames: true }, files: ['content.css'] }).catch(() => {});
  await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['i18n.js', 'languages.js', 'content.js'] }).catch(() => {});
  await chrome.tabs.sendMessage(tab.id, { type: 'TRANSLATE_FOCUSED_INPUT' }).catch(() => {});
}

async function accessForSender(sender, identity) {
  const topOrigin = PreSendRules.normalizeOrigin(sender.tab?.url || identity?.topOrigin);
  const frameOrigin = PreSendRules.normalizeOrigin(sender.url || identity?.frameOrigin || topOrigin);
  const context = { topOrigin, frameOrigin, fingerprint: identity?.fingerprint || '' };
  const settings = await chrome.storage.sync.get(DEFAULTS);
  return { ...PreSendRules.resolveAccess(settings, context), identity: context };
}

async function translateRemote(message) {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  const profile = settings.aiProfiles.find((item) => item.id === settings.provider);
  if (!profile?.enabled) throw new Error('The selected AI service is disabled or missing.');
  await ensureEndpointPermission(profile.endpoint);
  const secrets = await chrome.storage.local.get('aiKeys');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(5, Number(profile.timeout || 30)) * 1000);
  try {
    return await PreSendProviders.translateAI({
      text: message.text, source: message.source || 'auto', target: message.target || settings.target, profile,
      apiKey: secrets.aiKeys?.[profile.id], signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The AI service timed out.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function testAIProfile(profile, apiKey) {
  await ensureEndpointPermission(profile.endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(5, Number(profile.timeout || 30)) * 1000);
  try {
    const text = await PreSendProviders.translateAI({ text: 'Hello', source: 'en', target: 'es', profile, apiKey, signal: controller.signal });
    return { ok: true, sample: text };
  } finally { clearTimeout(timeout); }
}

async function ensureEndpointPermission(endpoint) {
  const origin = PreSendRules.endpointOrigin(endpoint);
  if (await chrome.permissions.contains({ origins: [origin] })) return;
  throw new Error('Provider access is not granted. Test the service in Settings first.');
}

async function getTabState(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const settings = await chrome.storage.sync.get(DEFAULTS);
  const origin = PreSendRules.normalizeOrigin(tab.url);
  const siteRule = settings.siteRules[origin];
  const context = { topOrigin: origin, frameOrigin: origin, fingerprint: '' };
  const supportedPage = Boolean(origin);
  const contentReady = supportedPage
    ? await chrome.tabs.sendMessage(tabId, { type: 'PRESEND_PING' }).then((response) => response?.ready === true).catch(() => false)
    : false;
  return {
    ok: true,
    ...PreSendRules.resolveAccess(settings, context),
    globalDefault: settings.enabled !== false,
    origin,
    siteRule: siteRule?.enabled ?? null,
    supportedPage,
    contentReady,
    provider: settings.provider,
    target: settings.target
  };
}

async function setSiteRule(origin, enabled) {
  const settings = await chrome.storage.sync.get({ siteRules: {} });
  const normalized = PreSendRules.normalizeOrigin(origin);
  if (!normalized) throw new Error('This page cannot have a site rule.');
  settings.siteRules[normalized] = { enabled: Boolean(enabled), updatedAt: Date.now() };
  await chrome.storage.sync.set({ siteRules: settings.siteRules });
  return { ok: true };
}

async function clearSiteRule(origin) {
  const settings = await chrome.storage.sync.get({ siteRules: {} });
  delete settings.siteRules[PreSendRules.normalizeOrigin(origin)];
  await chrome.storage.sync.set({ siteRules: settings.siteRules });
  return { ok: true };
}

function publicError(error) {
  if (error?.message?.includes('Extension context invalidated')) return 'Reload the page and try again.';
  return error?.message || 'Unexpected error.';
}
