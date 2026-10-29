(function (root) {
  'use strict';

  function normalizeOrigin(value) {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url.origin : '';
    } catch {
      return '';
    }
  }

  function resolveAccess(settings, context) {
    const siteRule = settings.siteRules?.[normalizeOrigin(context.topOrigin)];
    if (typeof siteRule?.enabled === 'boolean') return { enabled: siteRule.enabled, source: 'site' };
    return { enabled: settings.enabled !== false, source: 'global' };
  }

  function endpointDetails(endpoint) {
    let url;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error('Enter a complete endpoint URL, for example https://api.deepseek.com/chat/completions.');
    }
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('The endpoint must use HTTP or HTTPS.');
    return {
      permissionOrigin: `${url.origin}/*`,
      insecureRemote: url.protocol === 'http:' && !local,
      origin: url.origin
    };
  }

  function endpointOrigin(endpoint) { return endpointDetails(endpoint).permissionOrigin; }

  const api = { normalizeOrigin, resolveAccess, endpointDetails, endpointOrigin };
  root.PreSendRules = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
