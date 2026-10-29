'use strict';

const DEFAULTS = { enabled: true, provider: 'builtin', target: 'en', aiProfiles: [], siteRules: {} };
const $ = (id) => document.getElementById(id);
let settings;
let aiKeys = {};
let selectedId = null;

init().catch((error) => setSaveState(error.message));

async function init() {
  PreSendI18n.apply();
  if (globalThis.chrome?.storage?.sync) {
    settings = await chrome.storage.sync.get(DEFAULTS);
    ({ aiKeys = {} } = await chrome.storage.local.get({ aiKeys: {} }));
  } else {
    settings = structuredClone(DEFAULTS);
    setSaveState(PreSendI18n.t('previewMode'));
  }
  bindNavigation();
  bindGeneral();
  bindProfiles();
  renderGeneral();
  renderProfiles();
  renderRules();
  await renderShortcut();
}

async function renderShortcut() {
  if (!globalThis.chrome?.commands?.getAll) { $('shortcut-value').textContent = PreSendI18n.t('availableAfterLoad'); return; }
  const commands = await chrome.commands.getAll();
  const command = commands.find((item) => item.name === 'translate-focused-input');
  $('shortcut-value').textContent = command?.shortcut || PreSendI18n.t('notSet');
  $('shortcut-value').classList.toggle('unset', !command?.shortcut);
}

function bindNavigation() {
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => showPanel(button.dataset.panel)));
  $('menu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
}

function showPanel(id) {
  document.querySelectorAll('.screen').forEach((panel) => panel.classList.toggle('active', panel.id === id));
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.panel === id));
  $('top-title').textContent = document.querySelector(`[data-panel="${id}"]`).textContent;
  document.querySelector('.sidebar').classList.remove('open');
}

function bindGeneral() {
  $('save-general').addEventListener('click', async () => {
    settings.enabled = $('enabled').checked; settings.provider = $('provider').value; settings.target = $('target').value;
    await chrome.storage.sync.set({ enabled: settings.enabled, provider: settings.provider, target: settings.target });
    setSaveState(PreSendI18n.t('saved')); renderGeneral();
  });
  $('shortcuts').addEventListener('click', () => chrome.tabs?.create?.({ url: shortcutManagerUrl() }));
}

function shortcutManagerUrl() {
  return /Edg\//.test(navigator.userAgent) ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts';
}

function renderGeneral() {
  $('enabled').checked = settings.enabled;
  renderTargetLanguages();
  const normalizedTarget = settings.target === 'page' ? 'page' : PreSendLanguages.normalizeLanguage(settings.target);
  settings.target = normalizedTarget || 'en';
  $('target').value = settings.target;
  $('provider').replaceChildren(new Option(PreSendI18n.t('chromeBuiltin'), 'builtin'), ...settings.aiProfiles.filter((p) => p.enabled).map((p) => new Option(p.name, p.id)));
  if (![...$('provider').options].some((option) => option.value === settings.provider)) settings.provider = 'builtin';
  $('provider').value = settings.provider;
  $('provider-note').textContent = settings.provider === 'builtin' ? 'On-device when Chrome supports the selected language pair.' : `Text is sent only to ${settings.aiProfiles.find((p) => p.id === settings.provider)?.endpoint || 'the selected endpoint'}.`;
}

function renderTargetLanguages() {
  const locale = PreSendI18n.current();
  const options = [new Option(PreSendI18n.t('pageAuto', locale), 'page')];
  const codes = PreSendLanguages.availableTargetLanguages(locale);
  if (settings.target !== 'page' && !codes.includes(settings.target)) codes.push(settings.target);
  codes.forEach((code) => options.push(new Option(PreSendLanguages.languageLabel(code, locale), code)));
  $('target').replaceChildren(...options);
}

function bindProfiles() {
  $('add-profile').addEventListener('click', () => editProfile(null));
  $('show-key').addEventListener('click', () => { const input = $('profile-key'); input.type = input.type === 'password' ? 'text' : 'password'; $('show-key').textContent = input.type === 'password' ? 'Show' : 'Hide'; });
  $('profile-form').addEventListener('submit', saveProfile);
  $('test-profile').addEventListener('click', () => testProfile().catch(showTestError));
  $('delete-profile').addEventListener('click', deleteProfile);
}

function renderProfiles() {
  const list = $('profile-list'); list.replaceChildren();
  if (!settings.aiProfiles.length) { list.innerHTML = '<p class="empty-state">No AI service yet.<br>Add one to use your own model.</p>'; editProfile(null); return; }
  settings.aiProfiles.forEach((profile) => {
    const button = document.createElement('button'); button.className = `service-item${profile.id === selectedId ? ' selected' : ''}`;
    const name = document.createElement('strong'); name.textContent = profile.name;
    const model = document.createElement('small'); model.textContent = profile.model;
    const state = document.createElement('span'); state.textContent = profile.enabled ? 'Enabled' : 'Disabled';
    button.append(name, model, state); button.addEventListener('click', () => editProfile(profile.id)); list.append(button);
  });
  if (!selectedId || !settings.aiProfiles.some((p) => p.id === selectedId)) editProfile(settings.aiProfiles[0].id);
}

function editProfile(id) {
  selectedId = id; const profile = settings.aiProfiles.find((item) => item.id === id);
  $('profile-title').textContent = profile?.name || 'New AI service'; $('profile-enabled').checked = profile?.enabled ?? true;
  $('profile-name').value = profile?.name || ''; $('profile-model').value = profile?.model || ''; $('profile-endpoint').value = profile?.endpoint || '';
  $('profile-key').value = profile ? aiKeys[profile.id] || '' : ''; $('profile-temperature').value = profile?.temperature ?? 0.1; $('profile-timeout').value = profile?.timeout ?? 30;
  $('profile-prompt').value = profile?.systemPrompt || PreSendProviders.DEFAULT_PROMPT; $('delete-profile').hidden = !profile; $('test-result').textContent = '';
  document.querySelectorAll('.service-item').forEach((item, index) => item.classList.toggle('selected', settings.aiProfiles[index]?.id === id));
}

function profileFromForm() {
  return {
    id: selectedId || `ai-${crypto.randomUUID()}`, name: $('profile-name').value.trim(), enabled: $('profile-enabled').checked,
    model: $('profile-model').value.trim(), endpoint: $('profile-endpoint').value.trim(), systemPrompt: $('profile-prompt').value.trim(),
    temperature: Number($('profile-temperature').value), timeout: Number($('profile-timeout').value), type: 'openai-compatible'
  };
}

async function saveProfile(event) {
  event.preventDefault(); const profile = profileFromForm();
  if (!profile.name || !profile.model || !profile.endpoint) return;
  const index = settings.aiProfiles.findIndex((item) => item.id === profile.id);
  if (index >= 0) settings.aiProfiles[index] = profile; else settings.aiProfiles.push(profile);
  selectedId = profile.id; aiKeys[profile.id] = $('profile-key').value.trim();
  await Promise.all([chrome.storage.sync.set({ aiProfiles: settings.aiProfiles }), chrome.storage.local.set({ aiKeys })]);
  setSaveState('Service saved'); renderProfiles(); renderGeneral();
}

async function testProfile() {
  clearTestError();
  const profile = profileFromForm();
  if (!profile.name || !profile.model || !profile.endpoint || !$('profile-key').value.trim()) {
    throw new Error('Enter the service name, model, complete endpoint, and API key before testing.');
  }
  const endpoint = new URL(profile.endpoint);
  const endpointInfo = PreSendRules.endpointDetails(profile.endpoint);
  if (endpointInfo.insecureRemote) {
    const warning = 'This endpoint uses unencrypted HTTP:\n\n' + endpointInfo.origin + '\n\nYour API key and text can be read or modified in transit. Continue testing this endpoint?';
    if (!confirm(warning)) { $('test-result').textContent = 'Test cancelled. Use HTTPS when possible.'; return; }
    $('endpoint-warning').textContent = 'Unencrypted HTTP: the API key and translated text are exposed in transit.';
  }
  $('test-result').textContent = `Requesting access to ${endpoint.origin}…`;
  const origin = endpointInfo.permissionOrigin;
  if (!await chrome.permissions.contains({ origins: [origin] })) {
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) { $('test-result').textContent = 'Endpoint access was not granted.'; return; }
  }
  const result = await chrome.runtime.sendMessage({ type: 'TEST_AI_PROFILE', profile, apiKey: $('profile-key').value.trim() });
  $('test-result').textContent = result.ok ? `Connected · ${result.sample}` : result.error;
  $('test-result').className = `inline-status ${result.ok ? 'success' : 'error'}`;
}

function clearTestError() {
  $('endpoint-warning').textContent = '';
  $('endpoint-error').textContent = '';
  $('profile-endpoint').removeAttribute('aria-invalid');
  $('test-result').textContent = '';
  $('test-result').className = 'inline-status';
}

function showTestError(error) {
  const message = error?.message || 'The service test failed.';
  const endpointProblem = /URL|HTTPS|HTTP|endpoint|localhost/i.test(message);
  if (endpointProblem) {
    $('endpoint-error').textContent = message;
    $('profile-endpoint').setAttribute('aria-invalid', 'true');
    $('profile-endpoint').focus();
  }
  $('test-result').textContent = message;
  $('test-result').className = 'inline-status error';
}

async function deleteProfile() {
  if (!selectedId || !confirm('Delete this AI service?')) return;
  settings.aiProfiles = settings.aiProfiles.filter((item) => item.id !== selectedId); delete aiKeys[selectedId];
  if (settings.provider === selectedId) settings.provider = 'builtin';
  await Promise.all([chrome.storage.sync.set({ aiProfiles: settings.aiProfiles, provider: settings.provider }), chrome.storage.local.set({ aiKeys })]);
  selectedId = null; renderProfiles(); renderGeneral(); setSaveState('Service deleted');
}

function renderRules() {
  renderRuleList('site-rules', Object.entries(settings.siteRules), ([origin, rule]) => [origin, rule.enabled ? 'Enabled' : 'Disabled', formatDate(rule.updatedAt)], async ([origin]) => { delete settings.siteRules[origin]; await chrome.storage.sync.set({ siteRules: settings.siteRules }); });
}

function renderRuleList(id, entries, cells, remove) {
  const container = $(id); container.replaceChildren();
  if (!entries.length) { container.innerHTML = '<p class="empty-state">No rules saved.</p>'; return; }
  entries.forEach((entry) => { const row = document.createElement('div'); row.className = 'rule-row'; cells(entry).forEach((value, i) => { const cell = document.createElement(i === 0 ? 'strong' : 'span'); cell.textContent = value; row.append(cell); }); const button = document.createElement('button'); button.className = 'text-button'; button.textContent = 'Remove'; button.addEventListener('click', async () => { await remove(entry); renderRules(); }); row.append(button); container.append(row); });
}

function formatDate(value) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(value) : '—'; }
function setSaveState(message) { $('save-state').textContent = message; }
