'use strict';

const assert = require('node:assert/strict');
const rules = require('../rules.js');
const providers = require('../providers.js');
const languages = require('../languages.js');
const i18n = require('../i18n.js');

const context = { topOrigin: 'https://chat.presend.test/path', frameOrigin: 'https://chat.presend.test/frame', fingerprint: 'textarea#message' };
const resolve = (enabled, siteRule) => rules.resolveAccess({
  enabled,
  siteRules: typeof siteRule === 'boolean' ? { 'https://chat.presend.test': { enabled: siteRule } } : {}
}, context);

assert.deepEqual(resolve(false, null), { enabled: false, source: 'global' });
assert.deepEqual(resolve(false, true), { enabled: true, source: 'site' });
assert.deepEqual(resolve(true, false), { enabled: false, source: 'site' });
assert.deepEqual(resolve(true, null), { enabled: true, source: 'global' });
assert.equal(rules.normalizeOrigin('https://presend.test/path?q=1'), 'https://presend.test');
assert.equal(rules.normalizeOrigin('chrome://extensions'), '');
assert.equal(rules.endpointOrigin('https://api.deepseek.com/chat/completions'), 'https://api.deepseek.com/*');
assert.equal(rules.endpointOrigin('http://localhost:8787/v1/chat/completions'), 'http://localhost:8787/*');
assert.equal(rules.endpointOrigin('http://44.244.2.6:8788/v1/chat/completions'), 'http://44.244.2.6:8788/*');
assert.equal(rules.endpointDetails('http://44.244.2.6:8788/v1/chat/completions').insecureRemote, true);
assert.equal(rules.endpointDetails('https://api.presend.test/v1').insecureRemote, false);
assert.throws(() => rules.endpointOrigin('api.presend.test/v1'), /complete endpoint URL/);

const prompt = providers.renderPrompt('Translate {{sourceLanguage}} to {{targetLanguage}}', 'zh', 'en');
assert.equal(prompt, 'Translate zh to en');
assert.match(providers.DEFAULT_PROMPT, /Do not answer questions/);
assert.equal(languages.normalizeLanguage('de-DE'), 'de');
assert.equal(languages.normalizeLanguage('zh_CN'), 'zh');
assert.equal(languages.normalizeLanguage('jpJP'), 'ja');
assert.equal(languages.normalizeLanguage('ja-JP'), 'ja');
assert.equal(languages.normalizeLanguage('it-IT'), 'it');
assert.ok(languages.availableTargetLanguages('en').includes('it'));
assert.ok(languages.availableTargetLanguages('en').includes('ko'));
assert.equal(languages.languageBadge('en-US'), 'EN');
assert.equal(languages.languageBadge('zh-CN'), '中');
assert.equal(languages.languageLabel('ja-JP'), 'Japanese');
assert.equal(i18n.locale('jpJP'), 'ja');
assert.equal(i18n.locale('it-IT'), 'it');
assert.equal(i18n.locale('nl-NL'), 'en');
assert.equal(i18n.t('translating', 'zh-CN'), '正在翻译…');
// t() placeholder substitution keeps word order and CJK spacing per-locale.
assert.equal(i18n.t('translateTo', 'en', { language: 'English' }), 'Translate this input to English');
assert.equal(i18n.t('translateTo', 'zh', { language: '英语' }), '将此输入框翻译为英语');
assert.equal(i18n.t('languagePairUnavailable', 'ja', { source: 'EN', target: '日本語' }), 'EN → 日本語 の言語ペアは利用できません。');
assert.ok(i18n.t('translateTo', 'fr').includes('{language}'), 'template carries placeholder when params omitted');
assert.ok(i18n.t('builtinNeedsGesture', 'de').length > 0);
// Popup-referenced keys must resolve in every UI locale, never fall back to the raw key.
for (const lang of i18n.SUPPORTED) {
  for (const key of ['checking', 'connectionError']) {
    const value = i18n.t(key, lang);
    assert.ok(value && value !== key, `${key} unresolved for locale ${lang}`);
  }
}

// Every shipped locale must expose the same manifest message keys.
const fs = require('node:fs');
const path = require('node:path');
const localeKeys = (dir) => Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_locales', dir, 'messages.json'), 'utf8'))).sort().join(',');
const enKeys = localeKeys('en');
for (const dir of ['de', 'es', 'fr', 'it', 'ja', 'zh_CN']) {
  assert.equal(localeKeys(dir), enKeys, `${dir} locale key set differs from en`);
}

console.log('All unit tests passed.');
