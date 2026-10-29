(function (root) {
  'use strict';

  const LABELS = {
    en: 'English', zh: 'Chinese', de: 'German', es: 'Spanish', fr: 'French',
    ja: 'Japanese', ko: 'Korean', pt: 'Portuguese', it: 'Italian', ru: 'Russian',
    ar: 'Arabic', nl: 'Dutch', pl: 'Polish', tr: 'Turkish', vi: 'Vietnamese',
    th: 'Thai', id: 'Indonesian', hi: 'Hindi'
  };
  const BADGES = { zh: '中', ja: '日', ko: '한', ar: 'ع', hi: 'हि', th: 'ไทย' };
  const COMMON_TARGETS = [
    'af','sq','am','ar','hy','az','eu','be','bn','bs','bg','ca','ceb','zh','hr','cs','da','nl','en','eo','et','fi','fr','gl','ka','de','el','gu','ht','ha','he','hi','hu','is','ig','id','ga','it','ja','jv','kn','kk','km','ko','lo','la','lv','lt','lb','mk','ms','ml','mt','mi','mr','mn','my','ne','no','fa','pl','pt','pa','ro','ru','sr','sk','sl','so','es','sw','sv','tl','ta','te','th','tr','uk','ur','uz','vi','cy','xh','yi','yo','zu'
  ];
  const ALIASES = {
    jp: 'ja', jpjp: 'ja', jajp: 'ja',
    zhcn: 'zh', zhhans: 'zh', zhhant: 'zh',
    enus: 'en', engb: 'en'
  };

  function normalizeLanguage(value) {
    const raw = String(value || '').trim().replace('_', '-');
    if (!raw) return '';
    const compact = raw.replace(/-/g, '').toLowerCase();
    if (ALIASES[compact]) return ALIASES[compact];
    try { return new Intl.Locale(raw).language.toLowerCase(); }
    catch { return /^[a-z]{2,3}$/i.test(raw) ? raw.toLowerCase() : ''; }
  }

  function languageLabel(value, displayLocale) {
    const code = normalizeLanguage(value);
    if (!code) return 'Unknown language';
    try {
      const localized = new Intl.DisplayNames([normalizeLanguage(displayLocale) || 'en'], { type: 'language' }).of(code);
      if (localized) return localized;
    } catch { /* Use stable English labels below. */ }
    return LABELS[code] || code.toUpperCase();
  }

  function languageBadge(value) {
    const code = normalizeLanguage(value);
    if (!code) return '译';
    return BADGES[code] || code.toUpperCase().slice(0, 3);
  }

  function resolvePageLanguage(documentRef, navigatorRef, field) {
    const candidates = [
      field?.closest?.('[lang]')?.getAttribute('lang'),
      documentRef?.documentElement?.getAttribute('lang'),
      documentRef?.querySelector?.('meta[http-equiv="content-language" i]')?.content,
      documentRef?.querySelector?.('meta[name="language" i]')?.content,
      navigatorRef?.language
    ];
    for (const candidate of candidates) {
      const language = normalizeLanguage(String(candidate || '').split(',')[0]);
      if (language) return language;
    }
    return 'en';
  }

  function availableTargetLanguages(displayLocale) {
    const names = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames([normalizeLanguage(displayLocale) || 'en'], { type: 'language' }) : null;
    let codes = [];
    try { codes = Intl.supportedValuesOf?.('language') || []; } catch { /* Older Chromium: use the broad fallback below. */ }
    const fallback = [...COMMON_TARGETS, 'bg', 'cs', 'da', 'el', 'fi', 'he', 'hu', 'ms', 'no', 'ro', 'sk', 'sv', 'uk'];
    return [...new Set(codes.length ? [...COMMON_TARGETS, ...codes] : fallback)]
      .map(normalizeLanguage)
      .filter(Boolean)
      .sort((a, b) => (names?.of(a) || a).localeCompare(names?.of(b) || b, normalizeLanguage(displayLocale) || 'en'));
  }

  const api = { COMMON_TARGETS, normalizeLanguage, languageLabel, languageBadge, resolvePageLanguage, availableTargetLanguages };
  root.PreSendLanguages = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
