'use strict';

// Store-listing screenshot generator. Loads the real extension in headless Chrome
// over CDP (zero npm dependencies) and captures 1280x800 JPEGs (no alpha channel)
// that satisfy the Chrome Web Store "Global screenshots" requirements.
// Run: node tests/capture-store-screenshots.js
// Output: ../../release/screenshots/*.jpg

const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIXTURE_PATH = path.join(__dirname, 'input-fixture.html');
const EXTENSION_DIR = path.resolve(__dirname, '..');
const BROWSER_CACHE = process.env.PRESEND_BROWSER_CACHE || path.join(os.homedir(), '.cache', 'presend-browsers');
// Chrome UI language drives chrome.i18n.getUILanguage(), which the extension follows.
// Default to en-US so store listings get English screenshots; override with --lang=zh-CN etc.
const LANG = (process.argv.find((arg) => arg.startsWith('--lang=')) || '--lang=en-US').split('=')[1];
const OUT_DIR = path.resolve(__dirname, '..', '..', 'release', 'screenshots', LANG.split('-')[0].toLowerCase());
const WIDTH = 1280;
const HEIGHT = 800;

// Store promo tiles are brand + tagline graphics (not screenshots). The product name
// stays in English; only the tagline is localized for the two languages we ship tiles for.
const BRAND = 'PreSend Translate';
const TAGLINES = {
  en: 'Translate what you type \u2014 before you send.',
  zh: '\u8f93\u5165\u5373\u7ffb\u8bd1\uff0c\u53d1\u9001\u524d\u5148\u68c0\u67e5\u3002'
};
const TAGLINE = TAGLINES[LANG.split('-')[0].toLowerCase()] || TAGLINES.en;
const ICON_512 = path.join(EXTENSION_DIR, 'icons', 'icon512.png');

function iconDataUrl() {
  return 'data:image/png;base64,' + fs.readFileSync(ICON_512).toString('base64');
}

function promoHtml(variant) {
  const icon = iconDataUrl();
  const base = "*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;overflow:hidden}"
    + "body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;"
    + "background:radial-gradient(125% 125% at 12% 0%,#17809a 0%,#126779 46%,#0b4652 100%);color:#fff;display:flex;align-items:center}";
  if (variant === 'marquee') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>${base}`
      + ".wrap{display:flex;align-items:center;gap:64px;padding:0 92px;width:100%}"
      + '.mark{width:196px;height:196px;flex:none;filter:drop-shadow(0 18px 40px rgba(0,0,0,.35))}'
      + '.txt{display:flex;flex-direction:column;gap:22px;min-width:0}'
      + 'h1{font-size:84px;font-weight:800;letter-spacing:-2px;line-height:1}'
      + 'p{font-size:38px;font-weight:400;opacity:.93;letter-spacing:-.5px}'
      + `</style></head><body><div class="wrap"><img class="mark" src="${icon}"><div class="txt"><h1>${BRAND}</h1><p>${TAGLINE}</p></div></div></body></html>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${base}`
    + '.wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:26px;text-align:center;width:100%}'
    + '.mark{width:80px;height:80px;filter:drop-shadow(0 10px 22px rgba(0,0,0,.35))}'
    + 'h1{font-size:32px;font-weight:800;letter-spacing:-.8px;line-height:1.05}'
    + 'p{font-size:15px;font-weight:400;opacity:.93;line-height:1.3}'
    + `</style></head><body><div class="wrap"><img class="mark" src="${icon}"><h1>${BRAND}</h1><p>${TAGLINE}</p></div></body></html>`;
}

function findChromeForTesting() {
  const builds = path.join(BROWSER_CACHE, 'chrome');
  if (!fs.existsSync(builds)) return null;
  const exe = fs.readdirSync(builds).sort().reverse()
    .map((entry) => path.join(builds, entry, 'chrome-win64', 'chrome.exe'))
    .find((candidate) => fs.existsSync(candidate));
  return exe || null;
}

function findChrome() {
  return [process.env.PRESEND_CHROME, findChromeForTesting(),
    'D:\\Chrome\\chrome.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']
    .filter(Boolean).find((candidate) => fs.existsSync(candidate));
}

function startServer() {
  const html = fs.readFileSync(FIXTURE_PATH, 'utf8');
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    if (requestUrl.pathname === '/promo') {
      res.end(promoHtml(requestUrl.searchParams.get('variant') || 'small'));
      return;
    }
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done) => server.close(done)) }));
  });
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new Cdp(socket);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(payload));
    });
  }
}

async function waitForCdp(port, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      if (info.webSocketDebuggerUrl) return info;
    } catch { /* still starting */ }
    await sleep(300);
  }
  throw new Error('Chrome did not expose a DevTools endpoint in time.');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
  });
}

async function readExtensionId(profileDir, extensionDir, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  const wanted = path.resolve(extensionDir).toLowerCase();
  while (Date.now() < deadline) {
    for (const name of ['Secure Preferences', 'Preferences']) {
      try {
        const prefs = JSON.parse(fs.readFileSync(path.join(profileDir, 'Default', name), 'utf8'));
        for (const [id, entry] of Object.entries(prefs.extensions?.settings || {})) {
          const stored = String(entry.path || '').replace(/[\\/]+$/, '').toLowerCase();
          if (stored === wanted) return id;
        }
      } catch { /* not written yet */ }
    }
    await sleep(250);
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(cdp, sessionId, expression, predicate, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    last = result.result?.value;
    if (predicate(last)) return last;
    await sleep(150);
  }
  return last;
}

async function capture(cdp, shot) {
  const width = shot.width || WIDTH;
  const height = shot.height || HEIGHT;
  const targetId = (await cdp.send('Target.createTarget', { url: shot.url })).targetId;
  const sessionId = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  await waitUntil(cdp, sessionId, 'document.readyState', (value) => value === 'complete');
  await sleep(900); // let i18n + dynamic render settle
  if (shot.css) {
    // Center narrow fixed-width pages (e.g. the popup) as a card on the 1280x800 canvas.
    await cdp.send('Runtime.evaluate', { expression: `(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(shot.css)}; document.head.appendChild(s); })()`, returnByValue: true }, sessionId);
    await sleep(150);
  }
  if (shot.focus) {
    await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(shot.focus)})?.focus(); true`, returnByValue: true }, sessionId);
    await waitUntil(cdp, sessionId,
      `(() => { const i = document.getElementById('presend-translate-input-button'); return !!(i && !i.hidden && i.dataset.state === 'ready'); })()`,
      (value) => value === true, 8000);
    await sleep(400);
  }
  const image = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 }, sessionId);
  const file = path.join(OUT_DIR, shot.name);
  fs.writeFileSync(file, Buffer.from(image.data, 'base64'));
  await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  console.log(`SAVED ${path.relative(process.cwd(), file)} (${width}x${height} jpeg)`);
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath) throw new Error('No Chrome found. Install Chrome for Testing or set PRESEND_CHROME.');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startServer();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'presend-shots-'));
  const cdpPort = await freePort();
  const child = spawn(chromePath, [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`,
    `--load-extension=${EXTENSION_DIR}`, `--disable-extensions-except=${EXTENSION_DIR}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1440,860',
    `--lang=${LANG}`, `--accept-lang=${LANG}`, 'about:blank'
  ], { stdio: 'ignore' });

  let cdp;
  try {
    const versionInfo = await waitForCdp(cdpPort);
    const extensionId = await readExtensionId(profileDir, EXTENSION_DIR);
    if (!extensionId) throw new Error(`Extension did not load (this Chrome ignores --load-extension?): ${chromePath}`);
    cdp = await Cdp.connect(versionInfo.webSocketDebuggerUrl);

    await capture(cdp, { name: '01-options.jpg', url: `chrome-extension://${extensionId}/options.html` });
    await capture(cdp, { name: '02-input-button.jpg', url: `${server.origin}/`, focus: '#message-body' });
    await capture(cdp, { name: '03-welcome.jpg', url: `chrome-extension://${extensionId}/welcome.html` });
    await capture(cdp, {
      name: '04-popup.jpg',
      url: `chrome-extension://${extensionId}/popup.html`,
      css: 'html,body{height:100%!important}body.popup-body{width:100%!important;min-height:100vh!important;box-sizing:border-box!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:40px!important;background:#eef2f4!important}body.popup-body .popup{width:390px!important;background:#fff!important;border:1px solid #d7dedf!important;border-radius:14px!important;box-shadow:0 24px 60px rgba(15,23,26,.18)!important;}'
    });
    await capture(cdp, { name: 'small-promo-tile.jpg', url: `${server.origin}/promo?variant=small`, width: 440, height: 280 });
    await capture(cdp, { name: 'marquee-promo-tile.jpg', url: `${server.origin}/promo?variant=marquee`, width: 1400, height: 560 });
  } finally {
    await cdp?.send('Browser.close').catch(() => {});
    child.kill();
    await server.close();
    try { fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }); } catch { /* locked */ }
  }
  console.log(`\nDone. Screenshots are in ${OUT_DIR}`);
}

main().catch((error) => { console.error(`FAILED  ${error.message}`); process.exitCode = 1; });
