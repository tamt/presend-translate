(function () {
  'use strict';

  if (globalThis.__preSendTranslateLoaded) {
    return;
  }
  globalThis.__preSendTranslateLoaded = true;
  let activeField = null;
  let icon = null;
  let accessCheck = 0;
  let focusProbe = 0;
  let iconResetTimer = 0;
  let translating = false;
  let anchorField = null;
  let anchorEl = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PRESEND_PING') {
      sendResponse({ ok: true, ready: true });
      return;
    }
    if (message?.type === 'IDENTIFY_FOCUSED_INPUT') {
      const field = getActiveEditable();
      sendResponse(field ? { identity: identityFor(field) } : {});
      return;
    }
    if (message?.type === 'TRANSLATE_FOCUSED_INPUT') {
      translateField(getActiveEditable() || activeField);
      sendResponse({ ok: true });
    }
  });

  document.addEventListener('focusin', handleFocusIn, true);
  document.addEventListener('focusout', handleFocusOut, true);
  addEventListener('scroll', positionIcon, true);
  addEventListener('resize', positionIcon);
  chrome.storage.onChanged.addListener(() => refreshIconAccess());
  // Keep the badge the last element child of <html>, so a page portal/modal added after us
  // cannot paint over it: at the badge's maximum z-index the only way to win is DOM order.
  new MutationObserver(bringToFront).observe(document.documentElement, { childList: true });
  focusProbe = setInterval(() => {
    const field = getActiveEditable();
    if (!field || field === activeField) return;
    activeField = field;
    ensureIcon();
    positionIcon();
    refreshIconAccess();
  }, 500);
  addEventListener('pagehide', () => clearInterval(focusProbe), { once: true });

  async function translateField(field) {
    if (!field || translating) return;
    activeField = field;
    ensureIcon();
    setIconState('checking', { title: PreSendI18n.t('checking') });

    const identity = identityFor(field);
    const access = await chrome.runtime.sendMessage({ type: 'CHECK_ACCESS', identity }).catch((error) => ({ error: error.message }));
    if (!access?.ok) { showIconError(access?.error || PreSendI18n.t('accessError')); return; }
    if (!access.enabled) { hideIcon(); return; }

    const original = readText(field);
    if (!original.trim()) {
      setIconState('empty', { text: '∅', title: PreSendI18n.t('empty'), resetAfter: 1800 });
      return;
    }

    translating = true;
    setIconState('translating', { title: PreSendI18n.t('translating') });
    try {
      const { provider = 'builtin', target: configuredTarget = 'en' } = await chrome.storage.sync.get(['provider', 'target']);
      const target = resolveTargetLanguage(field, configuredTarget);
      let translated;
      if (provider === 'builtin') translated = await translateBuiltIn(original, target);
      else {
        const result = await chrome.runtime.sendMessage({ type: 'TRANSLATE', text: original, target });
        if (!result?.ok) throw new Error(result?.error || PreSendI18n.t('failed'));
        translated = result.text;
      }
      writeText(field, translated);
      positionIcon();
      setIconState('success', { text: '✓', title: PreSendI18n.t('translated'), resetAfter: 1800 }); // taste-skill-ignore: compact status glyph inside the existing input action.
    } catch (error) {
      showIconError(`${PreSendI18n.t('failed')}: ${error.message}`);
    } finally {
      translating = false;
    }
  }

  function handleFocusIn(event) {
    const target = event.composedPath?.()[0] || event.target;
    const field = editableFrom(target);
    if (!field) {
      // Focus landed on a non-editable element (a read-only input, a link, a button, ...).
      // Drop the badge and its anchor so it neither shows here nor re-anchors to a stale
      // field on a later scroll/resize. Never hide when our own action button is focused.
      if (target !== icon) { activeField = null; hideIcon(); }
      return;
    }
    activeField = field;
    ensureIcon();
    positionIcon();
    refreshIconAccess();
  }

  function handleFocusOut() {
    setTimeout(() => {
      if (document.activeElement === icon || getActiveEditable()) return;
      activeField = null;
      hideIcon();
    }, 0);
  }

  function editableFrom(element) {
    if (!(element instanceof Element)) return null;
    // A read-only input/textarea is focusable but the user cannot type into it, so it
    // never fits "translate what you are about to send". Skip it. (A read-only
    // contenteditable already reports isContentEditable === false, so it is excluded above.)
    if (element.readOnly === true) return null;
    const type = String(element.type || '').toLowerCase();
    return element.isContentEditable || element.tagName === 'TEXTAREA' ||
      (element.tagName === 'INPUT' && (!type || ['text', 'search', 'email', 'url'].includes(type))) ? element : null;
  }

  function ensureIcon() {
    if (icon?.isConnected) return;
    icon = document.createElement('button');
    icon.id = 'presend-translate-input-button';
    icon.type = 'button';
    // No glyph is picked here: refreshIconAccess() fills in the localized target-language badge.
    icon.textContent = '';
    icon.dataset.state = 'ready';
    icon.title = PreSendI18n.t('translateFocused');
    icon.setAttribute('aria-label', PreSendI18n.t('translateFocused'));
    icon.addEventListener('pointerdown', (event) => event.preventDefault());
    icon.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      translateField(activeField);
    });
    document.documentElement.appendChild(icon);
    refreshIconAccess();
  }

  // Layered rich-text composers (ProseMirror/Tiptap/Slate/Lexical) keep the editable
  // node at content height and move padding, min-height and the action row onto a
  // wrapper. Measuring only the content node made those fields look "too small" and
  // pinned the badge to the wrong box, so resolve the nearest visible container and use
  // that box for both the size gate and positioning. Plain inputs/textareas have no such
  // wrapper and keep their own box, so their behavior is unchanged.
  function anchorFor(field) {
    if (anchorField === field && anchorEl?.isConnected) return anchorEl;
    let chosen = field;
    let node = field.parentElement;
    for (let depth = 0; node && depth < 4; depth += 1) {
      const box = node.getBoundingClientRect();
      const inner = chosen.getBoundingClientRect();
      const style = getComputedStyle(node);
      const hasChrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) > 1 ||
        parseFloat(style.minHeight) > 0 || style.overflowY !== 'visible';
      if (box.height > inner.height + 2 && hasChrome && box.height < innerHeight * 0.6) {
        chosen = node;
        if (box.height >= 44) break;
      }
      node = node.parentElement;
    }
    anchorField = field;
    anchorEl = chosen;
    return chosen;
  }

  function positionIcon() {
    if (!icon?.isConnected || !activeField?.isConnected) return;
    const field = activeField.getBoundingClientRect();
    // Concern 1: is the field actually rendered and on screen? This replaces the old
    // single "height < 24" guess that wrongly hid short but legitimate editors.
    if (field.width < 8 || field.height < 8 || field.bottom <= 0 || field.right <= 0 ||
      field.top >= innerHeight || field.left >= innerWidth) { hideIcon(); return; }
    // Concern 2: is the visible field large enough to host the badge? Measured on the
    // container so a 21px content node inside a ~44px composer still counts as a field.
    const box = anchorFor(activeField).getBoundingClientRect();
    if (box.width < 60 || box.height < 20) { hideIcon(); return; }
    const badgeLength = icon.textContent.length;
    const width = badgeLength > 2 ? 38 : 26;
    const size = 26;
    const inset = 6;
    icon.style.width = `${width}px`;
    icon.style.left = `${Math.max(inset, Math.min(innerWidth - width - inset, box.right - width - inset))}px`;
    // Vertically center the badge on the editable node itself. A plain single-line input
    // (field box == visible box) becomes truly centered; a layered composer keeps its
    // content node at the top of the wrapper, so the badge stays near the top and clear of
    // bottom-anchored send/mic controls. Clamp inside the container so the badge can never
    // escape the visible field.
    const margin = 2;
    let top = field.top + field.height / 2 - size / 2;
    top = Math.max(box.top + margin, Math.min(top, box.bottom - size - margin));
    top = Math.max(inset, Math.min(innerHeight - size - inset, top));
    icon.style.top = `${top}px`;
    icon.hidden = false;
    bringToFront();
  }

  function hideIcon() { if (icon) icon.hidden = true; }

  // Re-append the badge as the last child of <html>. Within the root stacking context every
  // page overlay competes by z-index; the badge already uses the 32-bit maximum, so the only
  // way a portal can still cover it is by matching that maximum and coming later in the DOM.
  // Appending last wins that tie. Skip while the badge itself has focus so we never steal it.
  function bringToFront() {
    if (!icon?.isConnected) return;
    const root = document.documentElement;
    if (root.lastElementChild !== icon && document.activeElement !== icon) root.appendChild(icon);
  }

  function setIconState(state, options = {}) {
    if (!icon) return;
    clearTimeout(iconResetTimer);
    icon.dataset.state = state;
    icon.hidden = false;
    icon.disabled = state === 'checking' || state === 'translating';
    icon.toggleAttribute('aria-busy', state === 'checking' || state === 'translating');
    icon.textContent = options.text ?? (state === 'checking' ? '…' : state === 'translating' ? '' : icon.textContent);
    if (options.title) { icon.title = options.title; icon.setAttribute('aria-label', options.title); }
    positionIcon();
    if (options.resetAfter) iconResetTimer = setTimeout(() => refreshIconAccess(), options.resetAfter);
  }

  function showIconError(message) {
    setIconState('error', { text: '!', title: message, resetAfter: 4200 });
  }

  async function refreshIconAccess() {
    if (!activeField?.isConnected) return hideIcon();
    if (translating) return;
    const check = ++accessCheck;
    const [access, preferences] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'CHECK_ACCESS', identity: identityFor(activeField) }).catch(() => null),
      chrome.storage.sync.get({ target: 'en' })
    ]);
    if (check !== accessCheck || !icon) return;
    const target = resolveTargetLanguage(activeField, preferences.target);
    const targetLabel = PreSendLanguages.languageLabel(target, PreSendI18n.current());
    clearTimeout(iconResetTimer);
    icon.dataset.state = 'ready';
    icon.textContent = PreSendLanguages.languageBadge(target);
    icon.dataset.targetLanguage = target;
    icon.disabled = !access?.ok;
    icon.removeAttribute('aria-busy');
    icon.title = access?.ok ? PreSendI18n.t('translateTo', PreSendI18n.current(), { language: targetLabel }) : PreSendI18n.t('accessError');
    icon.setAttribute('aria-label', icon.title);
    if (!access?.ok) { icon.dataset.state = 'error'; positionIcon(); return; }
    if (!access?.enabled) return hideIcon();
    positionIcon();
  }

  function resolveTargetLanguage(field, configuredTarget) {
    return configuredTarget === 'page'
      ? PreSendLanguages.resolvePageLanguage(document, navigator, field)
      : PreSendLanguages.normalizeLanguage(configuredTarget) || 'en';
  }

  function getActiveEditable() {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    if (!element) return null;
    return editableFrom(element);
  }

  function identityFor(element) {
    let topOrigin = location.origin;
    try { topOrigin = top.location.origin; } catch { /* Cross-origin frames are finalized by the service worker. */ }
    return {
      topOrigin,
      frameOrigin: location.origin,
      fingerprint: fingerprintEditable(element),
      label: inputLabel(element)
    };
  }

  function fingerprintEditable(element) {
    if (isStable(element.id)) return `${element.tagName.toLowerCase()}#${cssEscape(element.id)}`;
    if (isStable(element.getAttribute('name'))) return `${element.tagName.toLowerCase()}[name="${cssEscape(element.getAttribute('name'))}"]`;
    const parts = [];
    let node = element;
    while (node?.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      const tag = node.tagName.toLowerCase();
      const siblings = node.parentElement ? [...node.parentElement.children].filter((item) => item.tagName === node.tagName) : [];
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag);
      node = node.parentElement;
    }
    return parts.join('>');
  }

  function inputLabel(element) {
    const kind = element.isContentEditable ? 'Rich text editor' : element.tagName === 'TEXTAREA' ? 'Text area' : 'Text input';
    return element.id && isStable(element.id) ? `${kind} · #${element.id}` : kind;
  }

  function isStable(value) {
    return Boolean(value) && value.length <= 80 && !/[0-9a-f]{10,}/i.test(value) && !/^\d+$/.test(value);
  }

  function cssEscape(value) {
    return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^a-z0-9_-]/gi, '\\$&');
  }

  function readText(element) { return element.isContentEditable ? element.innerText : element.value; }

  function writeText(element, text) {
    element.focus();
    if (element.isContentEditable) {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      if (!document.execCommand('insertText', false, text)) {
        element.textContent = text;
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
      return;
    }
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, text);
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function translateBuiltIn(text, target) {
    if (!('Translator' in self) || !('LanguageDetector' in self)) {
      throw new Error(PreSendI18n.t('builtinUnavailable'));
    }
    try {
      const detector = await LanguageDetector.create();
      const [best] = await detector.detect(text);
      const source = best?.detectedLanguage;
      if (!source || source === target) return text;
      const availability = await Translator.availability({ sourceLanguage: source, targetLanguage: target });
      if (availability === 'unavailable') throw new Error(PreSendI18n.t('languagePairUnavailable', PreSendI18n.current(), { source, target }));
      const translator = await Translator.create({ sourceLanguage: source, targetLanguage: target });
      return await translator.translate(text);
    } catch (error) {
      // Chrome refuses the first model download without user activation, which happens
      // on the hotkey and context-menu paths. Its raw error text means nothing to users.
      if (error?.name === 'NotAllowedError') throw new Error(PreSendI18n.t('builtinNeedsGesture'));
      throw error;
    }
  }

})();
