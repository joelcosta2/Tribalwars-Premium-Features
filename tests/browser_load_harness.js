'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function createStorage() {
    const values = new Map();
    const storage = {
        get length() { return values.size; },
        key(index) { return Array.from(values.keys())[index] ?? null; },
        getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
        setItem(key, value) {
            key = String(key);
            values.set(key, String(value));
            Object.defineProperty(storage, key, { configurable: true, enumerable: true, get: () => values.get(key) });
        },
        removeItem(key) { values.delete(String(key)); delete storage[String(key)]; }
    };
    return storage;
}

function createEventTarget(extra = {}) {
    const listeners = new Map();
    return Object.assign({
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(listener);
        },
        removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
        dispatchEvent(event) { listeners.get(event.type)?.forEach(listener => listener(event)); }
    }, extra);
}

function createElement(tagName = 'div') {
    const element = createEventTarget({
        tagName: String(tagName).toUpperCase(), style: {}, dataset: {}, classList: { add() {}, remove() {}, contains() { return false; } },
        children: [], childNodes: [], append(...nodes) { this.children.push(...nodes); }, appendChild(node) { this.children.push(node); return node; },
        insertBefore(node) { this.children.unshift(node); return node; }, removeChild(node) { this.children = this.children.filter(value => value !== node); },
        remove() {}, click() {}, contains() { return false; }, closest() { return null; },
        matches() { return false; }, querySelector() { return null; }, querySelectorAll() { return []; }, getAttribute() { return null; },
        setAttribute() {}, removeAttribute() {}, cloneNode() { return createElement(tagName); }
    });
    element.insertCell = function () { return element.appendChild(createElement('td')); };
    element.insertRow = function () { return element.appendChild(createElement('tr')); };
    return element;
}

function createJquery() {
    function collection() {
        return {
            length: 0, off() { return this; }, on() { return this; }, ready(fn) { fn(); return this; }, data() { return undefined; },
            keydown() { return this; }, find() { return collection(); }, sortable() { return this; }, each() { return this; }, append() { return this; },
            prepend() { return this; }, remove() { return this; }, detach() { return this; }, css() { return this; }, attr() { return this; },
            prop() { return this; }, val() { return undefined; }, text() { return this; }, html() { return this; }, hide() { return this; }, show() { return this; }
        };
    }
    const jquery = function () { return collection(); };
    jquery.ajax = () => Promise.resolve({});
    jquery.getJSON = () => Promise.resolve({});
    jquery.post = () => Promise.resolve({});
    return jquery;
}

const localStorage = createStorage();
const bootErrors = [];
const harnessConsole = Object.assign({}, console, {
    error(...args) { bootErrors.push(args); console.error(...args); }
});
const document = createEventTarget({
    readyState: 'complete', hidden: false, cookie: '', body: createElement('body'), head: createElement('head'), documentElement: createElement('html'),
    location: { href: 'https://pt99.tribalwars.com.pt/game.php?village=1&screen=main' },
    createElement, createTextNode(text) { return { textContent: String(text) }; }, getElementById() { return null; },
    getElementsByTagName() { return []; }, getElementsByClassName() { return []; },
    querySelector() { return null; }, querySelectorAll() { return []; }
});
const timers = [];
const context = createEventTarget({
    console: harnessConsole, localStorage, document,
    location: { href: document.location.href, hostname: 'pt99.tribalwars.com.pt', host: 'pt99.tribalwars.com.pt', origin: 'https://pt99.tribalwars.com.pt', reload() {} },
    navigator: { userAgent: 'browser-load-harness' }, crypto: { randomUUID: () => 'test-tab-id' },
    game_data: { world: 'pt99', csrf: 'csrf', screen: 'main', link_base_pure: '/game.php?village=1&screen=', village: { id: 1 }, player: { id: 7 }, features: { Premium: { active: true } } },
    Timing: { getCurrentServerTime: () => Date.now() }, TribalWars: { getIdleTime: () => 0 },
    setTimeout(fn, delay) { timers.push({ fn, delay: Number(delay) || 0 }); return timers.length; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    requestAnimationFrame(fn) { return context.setTimeout(fn, 0); }, cancelAnimationFrame() {},
    MutationObserver: class { observe() {} disconnect() {} }, DOMParser: class { parseFromString() { return document; } },
    Image: class { set src(value) { this._src = value; } get src() { return this._src; } },
    URL, URLSearchParams, TextEncoder, fetch: async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({}) }),
    GM_addStyle() {}, GM_xmlhttpRequest() {}, GM_setValue() {}, GM_getValue() { return null; }, GM_getResourceText() { return '{}'; },
    $: createJquery(), jQuery: null
});
context.jQuery = context.$;
context.window = context;
context.globalThis = context;
context.unsafeWindow = context;
vm.createContext(context);

const main = fs.readFileSync(path.join(ROOT, 'main.user.js'), 'utf8');
const requires = Array.from(main.matchAll(
    /^\/\/ @require\s+https:\/\/raw\.githubusercontent\.com\/jpmartins98\/Tribalwars-Premium-Features\/master\/(.+)$/gm
), match => match[1].split(/[?#]/)[0]);

const installedSource = requires.map(relativePath => {
    const filename = path.join(ROOT, relativePath);
    return '\n// source: ' + relativePath + '\n' + fs.readFileSync(filename, 'utf8');
}).join('') + '\n// source: main.user.js\n' + main;
vm.runInContext(installedSource, context, { filename: 'installed-userscript.js' });
assert.ok(context.PremiumFeaturesRuntimeRegistry, 'runtime registry was not installed');
assert.ok(context.PremiumFeaturesBootLifecycle, 'main boot lifecycle was not installed');

(async function () {
    context.PremiumFeaturesBootLifecycle.bootNow();
    for (let round = 0; round < 80; round++) await Promise.resolve();
    assert.equal(context.PremiumFeaturesRuntimeRegistry.stats().claimedFeatures, 1, 'start() did not claim its lifecycle');
    assert.equal(bootErrors.some(args => String(args[0]).includes('[TW] Boot failed')), false, 'boot lifecycle threw before UI setup completed');
    assert.ok(context.PremiumFeaturesDiagnostics.getEntries().some(entry => entry.status === 'BOOT_UI_MOUNT'),
        'early TWPF UI mount was not diagnosed');
    console.log('ok - browser userscript graph evaluated and completed its boot lifecycle');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
