'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const baselineRoot = process.env.TWPF_PHASE32_BASELINE_DIR;
function source(file) {
    return fs.readFileSync(path.join(baselineRoot || root, file), 'utf8');
}
const tests = [];
function test(name, run) { tests.push({ name, run }); }
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function storage(initial = {}) {
    const values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
    return {
        getItem: key => values.get(String(key)) ?? null,
        setItem: (key, value) => values.set(String(key), String(value)),
        removeItem: key => values.delete(String(key))
    };
}
function context(extra = {}) {
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        Date, Math, JSON, Map, Set, WeakMap, Promise, URL, URLSearchParams, AbortController,
        localStorage: storage(), document: { querySelector: () => null, getElementById: () => null },
        game_data: { csrf: 'csrf', link_base_pure: '/game.php?village=1&screen=', village: { id: 1 }, features: { Premium: { active: true } } },
        setTimeout, clearTimeout, requestAnimationFrame: callback => callback(),
        t: key => key, showAutoHideBox() {}, bqGet: () => null, bqSet() {},
        fetch: async () => ({ ok: true, status: 200, json: async () => ({ response: { success: true } }) }),
        ...extra
    };
    ctx.window = ctx;
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    return ctx;
}
function load(ctx, file) { vm.runInContext(source(file), ctx, { filename: file }); }
async function flush(rounds = 20) { for (let index = 0; index < rounds; index++) await Promise.resolve(); }

test('unrelated slow/rejected hydration cannot block the early UI and init is single-shot', async () => {
    const map = deferred();
    const reservations = deferred();
    let simulatedMs = 0;
    const order = [];
    const entries = [];
    const once = new Map();
    let scheduledBoot = null;
    const settings = { general: { show__village_list: true, show__notepad: true, show__recruit_troops: true, show__building_queue: true },
        widgets: ['village_list', 'notepad', 'recruit_troops', 'building_queue'].map(name => ({ name, column: 'col' })) };
    const document = { readyState: 'loading', location: { href: 'https://example.test/game.php?screen=overview' },
        getElementById: () => null, createElement: () => ({ appendChild() {} }) };
    const ctx = context({
        document, settings_cookies: settings,
        performance: { now: () => simulatedMs },
        $: () => ({ off() { return this; }, on() { return this; } }),
        PremiumFeaturesRuntimeRegistry: {
            onceAsync(key, run) { if (!once.has(key)) once.set(key, Promise.resolve().then(run)); return once.get(key); },
            addEventListener() {}, installInteractionTracking() {}, requestReconcile(_reason, run) { run(); },
            setTimeout(_key, run) { scheduledBoot = run; }
        },
        PremiumFeaturesDiagnostics: { record(entry) { entries.push(entry); } },
        prepareLocalStorageItems: () => order.push('settings'),
        hydrateBuildQueueCache: () => order.push('build-cache'),
        cleanupLegacyNotepadStorage: () => { order.push('notepad-cleanup'); },
        hydrateNotepadCache: () => { order.push('notepad-hydrate'); },
        hydrateVillageProfileNotesCache: () => order.push('notes'),
        hydrateReservationsCache: () => reservations.promise,
        cleanupLegacyMapDataLocalStorage: () => order.push('map-cleanup'),
        hydrateMapDataCache: () => map.promise,
        cleanupLegacyRecruitQueueLocalStorage() {}, cleanupLegacyReportsLocalStorage() {},
        restoreTimeouts() {}, prepareBuildQueueStorageDefaults() {},
        injectScriptColumn() {}, injectVillagesListWidget() { order.push('village-list'); },
        injectNotepadWidget() { order.push('notepad-shell'); },
        createWidgetLoadingElement: () => ({}),
        createWidgetElement({ widgetKey }) { order.push(widgetKey); },
        injectScriptSettingsPopUp() { order.push('settings-shell'); },
        start() { order.push('start'); },
        PremiumFeaturesCoordination: { start() {} }, PremiumFeaturesBackgroundScheduler: { start() {} }
    });
    load(ctx, 'main.user.js');
    if (ctx.PremiumFeaturesBootLifecycle) {
        ctx.PremiumFeaturesBootLifecycle.bootNow();
        ctx.PremiumFeaturesBootLifecycle.bootNow();
    } else {
        scheduledBoot();
    }
    await flush();
    assert.ok(order.includes('settings-shell'));
    assert.ok(order.includes('village-list'));
    assert.ok(order.includes('recruit'));
    assert.ok(order.includes('start'));
    assert.equal(order.filter(value => value === 'start').length, 1);
    assert.equal(order.indexOf('notepad-cleanup') < order.indexOf('notepad-hydrate'), true);
    assert.equal(entries.some(entry => entry.status === 'BOOT_UI_MOUNT'), true);
    assert.equal(entries.some(entry => entry.status === 'BOOT_COMPLETE'), false);
    const earlyMount = entries.find(entry => entry.status === 'BOOT_UI_MOUNT');
    assert.equal(earlyMount.sinceUserscriptMs, 0);
    simulatedMs = 3000;
    map.reject(new Error('map unavailable'));
    reservations.resolve();
    await flush();
    assert.equal(ctx.PremiumFeaturesHydration.mapData.status, 'FAILED');
    assert.equal(entries.some(entry => entry.status === 'BOOT_COMPLETE'), true);
    assert.equal(entries.find(entry => entry.status === 'BOOT_COMPLETE').durationMs, 3000);
});

test('slow Building Queue hydration does not gate global start or unrelated UI', async () => {
    const buildQueue = deferred();
    const order = [];
    const once = new Map();
    let boot;
    let bqNetwork = 0;
    const document = {
        readyState: 'loading', location: { href: 'https://example.test/game.php?screen=overview' },
        getElementById: () => null, createElement: () => ({ appendChild() {} })
    };
    const ctx = context({
        document,
        settings_cookies: { general: { show__village_list: true, show__building_queue: true },
            widgets: [{ name: 'village_list', column: 'col' }, { name: 'building_queue', column: 'col' }] },
        $: () => ({ off() { return this; }, on() { return this; } }),
        PremiumFeaturesRuntimeRegistry: {
            onceAsync(key, run) { if (!once.has(key)) once.set(key, Promise.resolve().then(run)); return once.get(key); },
            addEventListener() {}, installInteractionTracking() {}, requestReconcile(_reason, run) { run(); },
            setTimeout(_key, run) { boot = run; }
        },
        prepareLocalStorageItems() {},
        hydrateBuildQueueCache: () => buildQueue.promise,
        cleanupLegacyNotepadStorage() {}, hydrateNotepadCache() {},
        hydrateVillageProfileNotesCache() {}, hydrateReservationsCache() {},
        cleanupLegacyMapDataLocalStorage() {}, hydrateMapDataCache() {},
        cleanupLegacyRecruitQueueLocalStorage() {}, cleanupLegacyReportsLocalStorage() {},
        restoreTimeouts() {}, restoreScavengingAutoWakes() {}, prepareBuildQueueStorageDefaults() {},
        injectScriptColumn() {}, injectVillagesListWidget() { order.push('village-list'); },
        createWidgetLoadingElement: () => ({}), createWidgetElement({ widgetKey }) { order.push(widgetKey); },
        injectScriptSettingsPopUp() { order.push('settings'); }, start() { order.push('start'); },
        PremiumFeaturesCoordination: { start() {} }, PremiumFeaturesBackgroundScheduler: { start() {} },
        fetch: async () => { bqNetwork++; throw new Error('BQ must not fetch before hydration'); }
    });
    load(ctx, 'main.user.js');
    if (ctx.PremiumFeaturesBootLifecycle) ctx.PremiumFeaturesBootLifecycle.bootNow();
    else boot();
    await flush();
    assert.ok(order.includes('settings'));
    assert.ok(order.includes('village-list'));
    assert.ok(order.includes('start'), 'global start must precede BQ hydration completion');
    assert.equal(order.filter(item => item === 'start').length, 1);
    assert.equal(ctx.PremiumFeaturesHydration.buildQueue.status, 'PENDING');
    assert.equal(bqNetwork, 0);
    buildQueue.resolve();
    await flush();
    assert.equal(ctx.PremiumFeaturesHydration.buildQueue.status, 'READY');
    assert.equal(order.filter(item => item === 'start').length, 1);
});

test('slow map-cache hydration cannot turn a fresh TTL into redundant map GETs', async () => {
    const pendingMap = deferred();
    const registered = [];
    let requests = 0;
    const ctx = context({
        document: { location: { href: 'https://example.test/game.php?screen=other' }, getElementById: () => null },
        game_data: { village: { id: 1 }, features: { Premium: { active: true } } },
        settings_cookies: { general: {}, widgets: [] },
        BACKGROUND_TASK_PRIORITY: { REFRESH: 4, AUTOMATIC: 3, HOUSEKEEPING: 5 },
        PremiumFeaturesHydration: { mapData: { status: 'PENDING', promise: pendingMap.promise } },
        PremiumFeaturesRuntimeRegistry: { currentGeneration: () => 1, claimFeature: () => true, clearInterval() {} },
        PremiumFeaturesCoordination: { registerBackgroundTask: key => registered.push(key) },
        detectServerTimezoneOffsetMs: () => 0,
        prepareVillageList() {}, listenTextAreas() {}, setCookieCurrentVillage() {}, addRessourcesHover() {},
        insertNavigationArrows() {}, insertListVillagesPopup() {}, injectNavigationBar() {}, defineKeyboardShortcuts() {},
        injectScriptSettingsPopUp() {},
        $: () => ({ length: 0 }),
        fetch: async () => { requests++; throw new Error('unexpected map request'); }
    });
    load(ctx, 'utils/core_utils.js');
    ctx.start();
    assert.equal(registered.filter(key => key.startsWith('map-')).length, 0);
    pendingMap.resolve();
    await flush();
    assert.deepEqual(registered.filter(key => key.startsWith('map-')), ['map-villages', 'map-players', 'map-allies']);
    assert.equal(requests, 0);
});

test('pending Build Queue hydration defers only its dependent background registrations', async () => {
    const pendingBuildQueue = deferred();
    const registered = [];
    const ctx = context({
        document: { location: { href: 'https://example.test/game.php?screen=other' }, getElementById: () => null },
        game_data: { village: { id: 1 }, features: { Premium: { active: true } } },
        settings_cookies: { general: {}, widgets: [] },
        BACKGROUND_TASK_PRIORITY: { REFRESH: 4, AUTOMATIC: 3, HOUSEKEEPING: 5 },
        PremiumFeaturesHydration: { buildQueue: { status: 'PENDING', promise: pendingBuildQueue.promise } },
        PremiumFeaturesRuntimeRegistry: { currentGeneration: () => 1, claimFeature: () => true, clearInterval() {} },
        PremiumFeaturesCoordination: { registerBackgroundTask: key => registered.push(key) },
        detectServerTimezoneOffsetMs: () => 0,
        prepareVillageList() {}, listenTextAreas() {}, setCookieCurrentVillage() {}, addRessourcesHover() {},
        insertNavigationArrows() {}, insertListVillagesPopup() {}, injectNavigationBar() {}, defineKeyboardShortcuts() {},
        injectScriptSettingsPopUp() {},
        $: () => ({ length: 0 })
    });
    load(ctx, 'utils/core_utils.js');
    ctx.start();
    assert.equal(registered.includes('build-queue-sweep'), false);
    assert.equal(registered.includes('build-instant-timers'), false);
    assert.ok(registered.includes('map-villages'), 'unrelated work must not wait for BQ');
    ctx.PremiumFeaturesHydration.buildQueue.status = 'READY';
    pendingBuildQueue.resolve();
    await flush();
    assert.equal(registered.filter(key => key === 'build-queue-sweep').length, 1);
    assert.equal(registered.filter(key => key === 'build-instant-timers').length, 1);
});

test('reservation action does not treat a pending cache as proof of no reservation', async () => {
    const pending = deferred();
    let confirmations = 0;
    const hydration = { status: 'PENDING', promise: pending.promise };
    const ctx = context({
        game_data: { player: { id: 7, ally: 2 } },
        PremiumFeaturesHydration: { reservations: hydration },
        isMapContextButtonEnabled: () => false,
        reservationsGetAll: () => ({}),
        UI: { ConfirmationBox() { confirmations++; } },
        refreshCtxCustom() {}
    });
    load(ctx, 'features/allyReservations.js');
    const target = { classList: { remove() {}, add() {} }, title: '' };
    const village = { villageId: '42', ownerId: '9', x: 500, y: 500, coords: '500|500' };
    assert.equal(ctx.renderExternalReservationCtxAction(village, target), false);
    ctx.handleExternalReservationCtxAction(village, target);
    assert.equal(confirmations, 0);
    hydration.status = 'READY';
    pending.resolve();
    await flush();
    assert.equal(ctx.renderExternalReservationCtxAction(village, target), true);
});

function createDom() {
    const all = [];
    function element(tagName = 'div') {
        const node = {
            nodeType: 1, tagName: tagName.toUpperCase(), children: [], childNodes: [], style: {}, dataset: {},
            className: '', id: '', parentNode: null, removed: false,
            set textContent(value) { this.childNodes = [{ nodeType: 3, textContent: String(value), parentNode: this }]; },
            get textContent() { return this.childNodes.map(child => child.textContent || '').join(''); },
            setAttribute(key, value) { this[key] = String(value); },
            getAttribute(key) { return this[key] ?? null; },
            appendChild(child) { if (child.parentNode) child.parentNode.removeChild(child); this.childNodes.push(child); if (child.nodeType === 1) this.children.push(child); child.parentNode = this; return child; },
            removeChild(child) { this.childNodes = this.childNodes.filter(value => value !== child); this.children = this.children.filter(value => value !== child); child.parentNode = null; },
            insertBefore(child, reference) { if (child.parentNode) child.parentNode.removeChild(child); const at = reference ? this.childNodes.indexOf(reference) : -1; this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, child); if (child.nodeType === 1) this.children.push(child); child.parentNode = this; return child; },
            replaceChildren(...children) { for (const child of [...this.childNodes]) this.removeChild(child); for (const child of children) this.appendChild(child); },
            replaceWith(replacement) { const parent = this.parentNode; parent.insertBefore(replacement, this); parent.removeChild(this); this.removed = true; },
            remove() { this.parentNode?.removeChild(this); this.removed = true; },
            addEventListener() {}
        };
        all.push(node);
        return node;
    }
    const body = element('body');
    const document = { body, createElement: element,
        createTextNode: value => ({ nodeType: 3, textContent: String(value), parentNode: null }),
        getElementById: id => all.find(node => node.id === id && (node === body || node.parentNode)) || null };
    return { document, element };
}

test('shared widget replacement preserves root and never exposes an async blank gap', async () => {
    const dom = createDom();
    const column = dom.element('div');
    column.id = 'column';
    dom.document.body.appendChild(column);
    const ctx = context({ document: dom.document, settings_cookies: { widgets: [{ name: 'recruit_troops', open: true, pos: -1 }] } });
    load(ctx, 'utils/core_widgets.js');
    const first = ctx.createWidgetElement({ identifier: 'Recruit', widgetKey: 'recruit', extra_name: 'troops', columnToUse: 'column', contents: dom.element('div'), loading: true });
    const slow = deferred();
    const update = slow.promise.then(() => ctx.createWidgetElement({ identifier: 'Recruit', widgetKey: 'recruit', extra_name: 'troops', columnToUse: 'column', contents: dom.element('div'), loading: false }));
    assert.equal(dom.document.getElementById('show_recruit_troops'), first);
    slow.resolve();
    const final = await update;
    assert.equal(final, first);
    assert.equal(first.removed, false);
    assert.equal(dom.document.getElementById('widget_content_recruit_troops').getAttribute('aria-busy'), 'false');
});

test('vertical questlog scroll keeps Settings icon anchored without recreating it', () => {
    const listeners = {};
    let scrollY = 0;
    const classes = new Set(['questlog']);
    const quest = { parentNode: null, nextSibling: null, children: [],
        classList: { contains: name => classes.has(name), toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
        getBoundingClientRect: () => ({ left: quest.parentNode === portal ? 20 : 120, right: quest.parentNode === portal ? 220 : 320, top: 100 - scrollY, bottom: 300 - scrollY, width: 200, height: 200 }),
        appendChild(child) { this.children.push(child); child.parentNode = this; }
    };
    const normal = { insertBefore(child) { child.parentNode = this; } };
    const portal = { appendChild(child) { child.parentNode = this; }, remove() {} };
    quest.parentNode = normal;
    const document = { body: { appendChild() {} }, querySelector: selector => selector === '.questlog' ? quest : null,
        querySelectorAll: () => [], getElementById: id => id === 'main_layout' ? {} : null,
        createElement: () => portal };
    const ctx = context({ document, innerWidth: 1000,
        addEventListener(type, listener) { listeners[type] = listener; },
        requestAnimationFrame: callback => callback(), getComputedStyle: () => ({ marginLeft: '20px' }) });
    load(ctx, 'utils/core_sidebar.js');
    const firstX = quest.getBoundingClientRect().left;
    for (const y of [600, 0, 900]) {
        scrollY = y;
        listeners.scroll?.();
        assert.equal(quest.getBoundingClientRect().left, firstX);
        assert.equal(quest.parentNode, normal);
    }
    assert.equal(listeners.scroll, undefined, 'vertical scroll must not trigger sidebar repositioning');
});

function recruitContext(extra = {}) {
    let queue = { spear: 0 };
    let postCount = 0;
    let getCount = 0;
    const button = { dataset: {}, innerHTML: 'Recruit', disabled: false };
    const disperse = { dataset: {}, innerHTML: 'Disperse', disabled: false };
    const input = { value: 3, dataset: { unitInput: 'spear' } };
    const container = { querySelector: selector => selector === '[data-recruit-btn]' ? button : disperse,
        querySelectorAll: () => [input] };
    const ctx = context({ bqGet: key => key === 'train_queue_data' ? queue : key === 'unit_managers_costs' ? { spear: { wood: 1, stone: 1, iron: 1 } } : null,
        fetch: async () => { postCount++; queue = { spear: queue.spear + 3 }; return { ok: true, status: 200, json: async () => ({ response: { success: true } }) }; },
        ...extra });
    load(ctx, 'widgets/recruitTroops.js');
    ctx.renderRecruitForm = () => {};
    ctx.calculateMaxTroops = () => {};
    const widget = { villageId: '1', linkBase: '/game.php?village=1&screen=', containerEl: container, isLive: true,
        pendingDeduction: { wood: 0, stone: 0, iron: 0 }, deductResources() {},
        refreshData: async () => { getCount++; return {}; } };
    return { ctx, widget, button, disperse, input,
        get queue() { return queue; }, set queue(value) { queue = value; },
        get posts() { return postCount; }, get gets() { return getCount; },
        set fetch(handler) { ctx.fetch = async (...args) => { postCount++; return handler(...args); }; } };
}

test('recruit success uses one POST and one in-place GET, with no partial reload', async () => {
    const fixture = recruitContext({ partialReload() { throw new Error('redundant partial reload'); } });
    await fixture.ctx.submitTroops(fixture.widget);
    assert.equal(fixture.posts, 1);
    assert.equal(fixture.gets, 1);
    assert.equal(fixture.button.disabled, false);
    assert.equal(fixture.ctx.localStorage.getItem('twpf_recruit_uncertain:1'), null);
});

test('recruit applied-but-response-lost reconciles without duplicate POST or stuck button', async () => {
    const fixture = recruitContext();
    fixture.fetch = async () => { fixture.queue = { spear: 3 }; throw new Error('lost response'); };
    await fixture.ctx.submitTroops(fixture.widget);
    assert.equal(fixture.posts, 1);
    assert.equal(fixture.gets, 1);
    assert.equal(fixture.button.disabled, false);
    assert.equal(fixture.ctx.localStorage.getItem('twpf_recruit_uncertain:1'), null);
});

test('recruit 500/502/503 and malformed responses are uncertain; no blind retry', async () => {
    for (const status of [500, 502, 503, 200]) {
        const fixture = recruitContext();
        fixture.fetch = async () => status === 200
            ? { ok: true, status, json: async () => { throw new Error('truncated'); } }
            : { ok: false, status, json: async () => ({}) };
        await fixture.ctx.submitTroops(fixture.widget);
        assert.equal(fixture.posts, 1);
        assert.equal(fixture.widget.recruitMutationState, 'UNCERTAIN');
        assert.ok(fixture.ctx.localStorage.getItem('twpf_recruit_uncertain:1'));
        assert.equal(fixture.button.disabled, false);
        await fixture.ctx.submitTroops(fixture.widget);
        assert.equal(fixture.posts, 1, 'a second click can only reconcile an unknown outcome');
    }
});

test('Recruit UI disables both actions while reconciling, then exposes explicit recheck', () => {
    const dom = createDom();
    const ctx = context({ document: dom.document });
    load(ctx, 'widgets/recruitTroops.js');
    ctx.calculateMaxTroops = () => {};
    const container = dom.element('div');
    const recruit = { villageId: '1', containerEl: container, isLive: false, recruitMutationState: 'RECONCILING' };
    const find = (node, key) => {
        if (node.dataset?.[key]) return node;
        for (const child of node.children || []) { const result = find(child, key); if (result) return result; }
        return null;
    };
    ctx.renderRecruitForm(recruit);
    assert.equal(find(container, 'recruitBtn').disabled, true);
    assert.equal(find(container, 'disperseBtn').disabled, true);
    recruit.recruitMutationState = 'UNCERTAIN';
    const nextContainer = dom.element('div');
    recruit.containerEl = nextContainer;
    ctx.renderRecruitForm(recruit);
    assert.equal(find(nextContainer, 'recruitBtn').disabled, undefined);
    assert.equal(find(nextContainer, 'recruitBtn').textContent, 'recruit.reconcileAction');
});

test('stale second-tab Recruit context sees persisted UNCERTAIN and sends no POST', async () => {
    const fixture = recruitContext();
    fixture.ctx.localStorage.setItem('twpf_recruit_uncertain:1', JSON.stringify({
        units: { spear: 3 }, before: { spear: 0 }, at: Date.now()
    }));
    await fixture.ctx.submitTroops(fixture.widget);
    assert.equal(fixture.posts, 0);
    assert.equal(fixture.gets, 1);
    assert.equal(fixture.widget.recruitMutationState, 'UNCERTAIN');
});

test('disperse stops after an uncertain second batch, without sending batch three', async () => {
    const fixture = recruitContext();
    fixture.input.value = 3;
    fixture.fetch = async () => {
        if (fixture.posts === 1) { fixture.queue = { spear: 1 }; return { ok: true, status: 200, json: async () => ({ response: { success: true } }) }; }
        fixture.queue = { spear: 2 };
        throw new Error('response lost');
    };
    await fixture.ctx.disperseTroops(fixture.widget, 1);
    assert.equal(fixture.posts, 2);
    assert.equal(fixture.gets, 1);
    assert.equal(fixture.widget.pendingDeduction.wood, 0);
    assert.equal(fixture.disperse.disabled, false);
});

test('derived official level with cached cost is display-only until official offer observed', () => {
    const costs = { farm: { 11: { wood: 100, stone: 100, iron: 100, pop: 1 } } };
    const ctx = context({ localStorage: storage({ buildings_data: JSON.stringify(costs) }), updateCachedBuildCost() {} });
    load(ctx, 'widgets/extraBuildQueue.js');
    const record = { official: { generation: 1, fetchedAt: Date.now(), currentLevels: { farm: 10 }, queue: [], nextBuildOffers: {} } };
    const fallback = ctx.resolveHeadBuildCost('1', { buildingId: 'farm', targetLevel: 11 }, record);
    assert.equal(fallback.source, 'DERIVED_OFFICIAL_LEVEL_CACHE_COST');
    assert.equal(fallback.authoritative, false);
    record.official.nextBuildOffers.farm = { level: 11, wood: 90, stone: 80, iron: 70, pop: 1, observedAt: Date.now() };
    const official = ctx.resolveHeadBuildCost('1', { buildingId: 'farm', targetLevel: 11 }, record);
    assert.equal(official.source, 'SERVER_OBSERVATION');
    assert.equal(official.authoritative, true);
    assert.equal(official.cost.wood, 90);
});

test('cached BQ cost cannot send mutation; one official offer restores eligibility', async () => {
    let requests = 0;
    const item = { id: 'stable-1', buildingId: 'farm', targetLevel: 11 };
    const record = { queue: [item], resources: { wood: 1000, stone: 1000, iron: 1000, pop: 0, popMax: 100 },
        official: { generation: 1, fetchedAt: Date.now(), full: false, currentLevels: { farm: 10 }, queue: [], nextBuildOffers: {} } };
    const state = { isCurrent: () => true, get: () => record };
    const ctx = context({
        localStorage: storage({ buildings_data: JSON.stringify({ farm: { 11: { wood: 100, stone: 100, iron: 100, pop: 1 } } }) }),
        PremiumFeaturesBuildState: state,
        $: { ajax(options) { requests++; options.error({ status: 503 }, 'error', 'error'); options.complete(); } }
    });
    load(ctx, 'widgets/extraBuildQueue.js');
    const captured = { hash: 'snapshot' };
    const blocked = await ctx.executeBuildQueueMutation('1', item, { snapshot: captured });
    assert.equal(blocked.accepted, false);
    assert.equal(requests, 0);
    record.official.nextBuildOffers.farm = { level: 11, wood: 90, stone: 80, iron: 70, pop: 1, observedAt: Date.now() };
    await assert.rejects(ctx.executeBuildQueueMutation('1', item, { snapshot: captured }));
    assert.equal(requests, 1);
});

test('ambiguous cancel response reconciles from official queue and sends exactly one POST', async () => {
    let posts = 0;
    let gets = 0;
    class Xhr {
        open() {} setRequestHeader() {}
        send() { posts++; this.readyState = 4; this.status = 200; this.responseText = '{bad'; this.onreadystatechange(); }
    }
    const ctx = context({ XMLHttpRequest: Xhr,
        bqGet: key => key === 'queue_cancelIds' ? ['build-7'] : [] });
    load(ctx, 'widgets/extraBuildQueue.js');
    ctx.fetchVillageMainPage = async () => { gets++; return { doc: { querySelector: () => ({}) }, buildStateObservation: { official: { cancelIds: [] } } }; };
    ctx.renderCachedBuildQueueWidget = () => {};
    const result = await ctx.removeFromActiveBuildQueue(0, '1');
    assert.equal(result.status, 'APPLIED');
    assert.equal(posts, 1);
    assert.equal(gets, 1);
    assert.equal(ctx.localStorage.getItem('twpf_cancel_uncertain:1:build-7'), null);
});

test('cancel classifies confirmed success/failure separately from 500 and network ambiguity', async () => {
    for (const scenario of [
        { response: '{"response":{"success":true}}', status: 200, expected: 'success' },
        { response: '{"response":{"success":false}}', status: 200, expected: 'CANCEL_FAILED' },
        { response: '', status: 500, expected: 'CANCEL_UNCERTAIN' },
        { response: '', status: 0, expected: 'CANCEL_UNCERTAIN', network: true }
    ]) {
        let posts = 0;
        class Xhr {
            open() {} setRequestHeader() {}
            send() {
                posts++;
                this.status = scenario.status;
                this.responseText = scenario.response;
                if (scenario.network) this.onerror();
                else { this.readyState = 4; this.onreadystatechange(); }
            }
        }
        const ctx = context({ XMLHttpRequest: Xhr });
        load(ctx, 'widgets/extraBuildQueue.js');
        if (scenario.expected === 'success') await ctx.callRemoveFromActiveBuildingQueue('build-7', '1');
        else await assert.rejects(ctx.callRemoveFromActiveBuildingQueue('build-7', '1'), error => error.code === scenario.expected);
        assert.equal(posts, 1);
    }
});

test('cancel transmission marker survives reload and prevents a second POST', async () => {
    let posts = 0;
    const ctx = context({
        localStorage: storage({ 'twpf_cancel_uncertain:1:build-7': JSON.stringify({ phase: 'transmitting' }) }),
        bqGet: key => key === 'queue_cancelIds' ? ['build-7'] : [],
        XMLHttpRequest: class { send() { posts++; } }
    });
    load(ctx, 'widgets/extraBuildQueue.js');
    ctx.fetchVillageMainPage = async () => ({ doc: { querySelector: () => ({}) }, buildStateObservation: { official: { cancelIds: ['build-7'] } } });
    const result = await ctx.removeFromActiveBuildQueue(0, '1');
    assert.equal(result.status, 'NOT_APPLIED');
    assert.equal(posts, 0);
});

test('generic TWPF pink/green highlight CSS is absent without suppressing native focus', () => {
    const css = source('utils/core_css.js');
    assert.equal(/#ff00ff|#39ff14/i.test(css), false);
    assert.equal(/outline:\s*2px solid #ff00ff/i.test(css), false);
    assert.equal(/outline:\s*(?:none|0)(?:[;!\s])/i.test(css), false);
});

(async () => {
    const selected = tests.filter(entry => !process.env.TWPF_PHASE32_FILTER || entry.name.includes(process.env.TWPF_PHASE32_FILTER));
    for (const entry of selected) {
        await entry.run();
        console.log('ok - ' + entry.name);
    }
    console.log('passed ' + selected.length + ' UI regression tests');
})().catch(error => { console.error(error); process.exitCode = 1; });
