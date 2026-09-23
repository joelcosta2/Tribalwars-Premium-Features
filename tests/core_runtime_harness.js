'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

class FakeClock {
    constructor(now = 0) {
        this.now = now;
        this.nextId = 1;
        this.timers = new Map();
    }

    setTimeout(fn, delay = 0) {
        const id = this.nextId++;
        this.timers.set(id, { fn, at: this.now + Math.max(0, Number(delay) || 0), interval: 0 });
        return id;
    }

    clearTimeout(id) { this.timers.delete(id); }

    setInterval(fn, delay = 0) {
        const id = this.nextId++;
        const interval = Math.max(1, Number(delay) || 1);
        this.timers.set(id, { fn, at: this.now + interval, interval });
        return id;
    }

    clearInterval(id) { this.timers.delete(id); }

    nextTimer(beforeOrAt = Infinity) {
        return Array.from(this.timers.entries())
            .filter(([, timer]) => timer.at <= beforeOrAt)
            .sort((first, second) => first[1].at - second[1].at || first[0] - second[0])[0] || null;
    }

    runNext(beforeOrAt = Infinity) {
        const next = this.nextTimer(beforeOrAt);
        if (!next) return false;
        const [id, timer] = next;
        this.now = timer.at;
        if (timer.interval) timer.at += timer.interval;
        else this.timers.delete(id);
        timer.fn();
        return true;
    }

    tick(ms) {
        const target = this.now + ms;
        let safety = 10000;
        while (this.runNext(target)) {
            if (--safety === 0) throw new Error('Fake clock runaway');
        }
        this.now = target;
    }
}

function createStorage(initial = {}) {
    const data = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
    const storage = {
        get length() { return data.size; },
        key(index) { return Array.from(data.keys())[index] ?? null; },
        getItem(key) { return data.has(String(key)) ? data.get(String(key)) : null; },
        setItem(key, value) {
            const normalizedKey = String(key);
            const normalizedValue = String(value);
            data.set(normalizedKey, normalizedValue);
            Object.defineProperty(storage, normalizedKey, {
                configurable: true,
                enumerable: true,
                get: () => data.get(normalizedKey)
            });
        },
        removeItem(key) {
            data.delete(String(key));
            delete storage[String(key)];
        },
        clear() {
            Array.from(data.keys()).forEach(key => storage.removeItem(key));
        },
        dump() { return Object.fromEntries(data); }
    };
    Object.entries(initial).forEach(([key, value]) => storage.setItem(key, value));
    return storage;
}

function createEventTarget() {
    const listeners = new Map();
    return {
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(fn);
        },
        removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
        dispatch(type, event = {}) { listeners.get(type)?.forEach(fn => fn(Object.assign({ type }, event))); },
        listenerCount(type) { return listeners.get(type)?.size || 0; }
    };
}

function createScavengeUiDocument() {
    const elements = [];
    function element(tagName = 'div') {
        const node = {
            tagName: tagName.toUpperCase(), style: {}, dataset: {}, children: [], childNodes: [],
            className: '', id: '', name: '', value: '', checked: false, disabled: false, textContent: '',
            classList: { add() {}, remove() {}, contains() { return false; } },
            append(...children) { children.forEach(child => this.appendChild(child)); },
            appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
            insertBefore(child) { this.children.unshift(child); child.parentElement = this; return child; },
            addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
            setAttribute(name, value) { this[name] = String(value); },
            getAttribute(name) { return this[name] ?? null; },
            closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
            insertRow() { return this.appendChild(element('tr')); },
            insertCell() { return this.appendChild(element('td')); }
        };
        elements.push(node);
        return node;
    }
    const container = element('div');
    const document = {
        hidden: false, body: element('body'), location: {
            href: 'https://pt99.tribalwars.com.pt/game.php?village=1&screen=place&mode=scavenge'
        },
        createElement: element, createTextNode: text => ({ textContent: String(text) }),
        getElementById: id => elements.find(node => node.id === id) || null,
        querySelector: selector => selector === '.scavenge-screen-main-widget' ? container : null,
        querySelectorAll: () => [],
        addEventListener() {}, removeEventListener() {}
    };
    return { document, elements };
}

function jqueryStub() {
    function makeCollection() {
        return {
            length: 0,
            off() { return this; },
            on() { return this; },
            ready(fn) { fn(); return this; },
            data() { return undefined; },
            keydown() { return this; },
            find() { return makeCollection(); },
            sortable() { return this; }
        };
    }
    const jquery = function () { return makeCollection(); };
    jquery.ajax = function () { throw new Error('Unexpected ajax'); };
    return jquery;
}

function createContext({ storage = createStorage(), clock = new FakeClock(), overrides = {} } = {}) {
    const windowEvents = createEventTarget();
    const documentEvents = createEventTarget();
    const document = Object.assign(documentEvents, {
        hidden: false,
        body: {},
        location: { href: 'https://pt99.tribalwars.com.pt/game.php?village=1&screen=main' },
        getElementById() { return null; },
        getElementsByTagName() { return []; },
        getElementsByClassName() { return []; },
        querySelector() { return null; },
        querySelectorAll() { return []; }
    });
    let uuidCounter = 0;
    const FakeDate = class extends Date {
        constructor(...args) { super(...(args.length ? args : [clock.now])); }
        static now() { return clock.now; }
    };
    const context = {
        console,
        Promise,
        Map,
        Set,
        WeakMap,
        WeakSet,
        Uint32Array,
        Object,
        Array,
        Math,
        JSON,
        Number,
        String,
        Boolean,
        RegExp,
        Error,
        TypeError,
        URL,
        URLSearchParams,
        Date: FakeDate,
        localStorage: storage,
        document,
        location: { href: document.location.href, hostname: 'pt99.tribalwars.com.pt' },
        crypto: { randomUUID: () => 'uuid-' + (++uuidCounter) },
        setTimeout: clock.setTimeout.bind(clock),
        clearTimeout: clock.clearTimeout.bind(clock),
        setInterval: clock.setInterval.bind(clock),
        clearInterval: clock.clearInterval.bind(clock),
        queueMicrotask,
        requestAnimationFrame: fn => clock.setTimeout(fn, 0),
        cancelAnimationFrame: id => clock.clearTimeout(id),
        $: jqueryStub(),
        ...windowEvents,
        ...overrides
    };
    context.window = context;
    context.globalThis = context;
    vm.createContext(context);
    return { context, clock, storage, document, windowEvents };
}

function load(context, relativePath) {
    const filename = path.join(ROOT, relativePath);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
}

async function flushMicrotasks(rounds = 5) {
    for (let i = 0; i < rounds; i++) await Promise.resolve();
}

async function drainTimers(clock, limit = 200) {
    for (let i = 0; i < limit; i++) {
        if (!clock.runNext()) {
            await flushMicrotasks();
            if (!clock.runNext()) return;
        }
        await flushMicrotasks();
    }
    throw new Error('Timer drain limit exceeded');
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function loadCore(context) {
    load(context, 'utils/core_runtime.js');
    load(context, 'utils/core_coordination.js');
    load(context, 'utils/core_async.js');
    load(context, 'utils/core_scheduler.js');
}

test('restore persisted A/B dispatches the correct handlers', async () => {
    const storage = createStorage();
    const first = createContext({ storage });
    loadCore(first.context);
    vm.runInContext(`
        registerTimeoutHandler('A', function () {});
        registerTimeoutHandler('B', function () {});
        setHandlerOnTimeOut('A', 'A', [], 100, 0, 0);
        setHandlerOnTimeOut('B', 'B', [], 200, 0, 0);
    `, first.context);

    const restored = createContext({ storage, clock: new FakeClock(0) });
    restored.context.events = [];
    loadCore(restored.context);
    vm.runInContext(`
        registerTimeoutHandler('A', function () { events.push('A'); });
        registerTimeoutHandler('B', function () { events.push('B'); });
        restoreTimeouts();
        restoreTimeouts();
    `, restored.context);
    assert.deepEqual(Object.keys(restored.context.activeTimeouts).sort(), ['A', 'B']);
    await drainTimers(restored.clock);
    assert.deepEqual(Array.from(restored.context.events), ['A', 'B']);
    assert.equal(Object.keys(restored.context.activeTimeouts).length, 0);
});

test('a persisted Scavenging wake crosses the real scheduler and lease into its worker', async () => {
    const ui = createScavengeUiDocument();
    const env = createContext({ clock: new FakeClock(1000000), overrides: {
        document: ui.document,
        game_data: { world: 'pt99', csrf: 'csrf', village: { id: 1 }, player: { id: 7 } },
        settings_cookies: { general: {} },
        t: key => key,
        showAutoHideBox() {}
    } });
    loadCore(env.context);
    load(env.context, 'bots/scavenging.js');
    env.context.reads = 0;
    env.context.posts = 0;
    vm.runInContext(`
        _fetchScavengingVillageData = async function () {
            reads++;
            return { options: { 1: { base_id: 1, is_locked: false, scavenging_squad: null } },
                unit_counts_home: { spear: 10 } };
        };
        sendScavengeSquadApi = async function () {
            posts++;
            return { success: true, returnMs: 300000, returnAtByOption: { 1: Date.now() + 300000 } };
        };
        PremiumFeaturesCoordination.start();
        PremiumFeaturesBackgroundScheduler.start();
        injectScavengeConfigPanel();
    `, env.context);
    const toggle = ui.document.getElementById('scavenge_config_enabled');
    const start = ui.elements.find(node => node.textContent === 'scavenge.saveAndStart');
    assert.ok(toggle && start);
    toggle.checked = true;
    toggle.onchange();
    await start.onclick();
    assert.equal(env.context.getScavengeConfig('1').enabled, true);
    assert.equal(JSON.parse(env.storage.getItem('handler_scavenging-auto:1')).handlerName, 'scavengingAutoCheck');
    assert.equal(env.context.reads, 0);
    for (let i = 0; i < 8; i++) {
        env.clock.tick(0);
        await flushMicrotasks(8);
    }
    assert.equal(env.context.reads, 1);
    assert.equal(env.context.posts, 1);
    assert.ok(Number(env.storage.getItem('endTime_scavenging-auto:1')) > env.clock.now);
    vm.runInContext(`
        clearPersistedTimeout('scavenging-auto:1');
        restoreScavengingAutoWakes();
        restoreScavengingAutoWakes();
    `, env.context);
    assert.equal(Object.keys(env.context.activeTimeouts).filter(id => id === 'scavenging-auto:1').length, 1);
    assert.equal(env.context.reads, 1, 'wake restoration itself must not inspect the server');
});

test('replacing timer A fences and cancels the old callback', async () => {
    const env = createContext();
    env.context.events = [];
    loadCore(env.context);
    vm.runInContext(`
        registerTimeoutHandler('oldA', function () { events.push('old'); });
        registerTimeoutHandler('newA', function () { events.push('new'); });
        setHandlerOnTimeOut('replace-A', 'oldA', [], 100, 0, 0);
        setHandlerOnTimeOut('replace-A', 'newA', [], 150, 0, 0);
    `, env.context);
    await drainTimers(env.clock);
    assert.deepEqual(Array.from(env.context.events), ['new']);
});

test('persisted hard-stop needs a safe manual action and resumes a queued real scheduler task', async () => {
    const storage = createStorage();
    const first = createContext({ storage, overrides: { getSetting: () => true, BotProtect: { show() {} } } });
    loadCore(first.context);
    first.context.PremiumFeaturesBackgroundScheduler.hardStop({ source: 'bot-protection' });
    const restored = createContext({ storage, overrides: { getSetting: () => true, BotProtect: { show() {} } } });
    loadCore(restored.context);
    load(restored.context, 'utils/core_bot_protection.js');
    restored.context.PremiumFeaturesBackgroundScheduler.start();
    let runs = 0;
    restored.context.PremiumFeaturesBackgroundScheduler.enqueue({
        key: 'due-after-manual-recovery', dueAt: restored.clock.now,
        run() { runs++; }
    });
    restored.clock.tick(1000);
    await flushMicrotasks();
    assert.equal(runs, 0);
    assert.equal(restored.context.PremiumFeaturesBackgroundScheduler.stats().hardStopped, true);
    assert.equal(restored.context.PremiumFeaturesBotProtection.resumeAfterHardStop(), true);
    for (let i = 0; i < 5; i++) { restored.clock.tick(0); await flushMicrotasks(); }
    assert.equal(runs, 1);
    assert.equal(storage.getItem('twpf_scheduler_hard_stop_v1'), null);
});

test('manual hard-stop recovery refuses active protection markers', () => {
    const env = createContext({ overrides: { getSetting: () => true, BotProtect: { show() {} } } });
    loadCore(env.context);
    load(env.context, 'utils/core_bot_protection.js');
    env.context.PremiumFeaturesBackgroundScheduler.hardStop({ source: 'bot-protection' });
    env.document.querySelector = selector => selector === '.captcha' ? {} : null;
    assert.equal(env.context.PremiumFeaturesBotProtection.canResumeAfterHardStop(), false);
    assert.equal(env.context.PremiumFeaturesBotProtection.resumeAfterHardStop(), false);
    assert.equal(env.context.PremiumFeaturesBackgroundScheduler.stats().hardStopped, true);
});

test('manual recovery signal reopens an eligible second tab; storage removal alone does not', () => {
    const storage = createStorage();
    const first = createContext({ storage, overrides: { getSetting: () => true, BotProtect: { show() {} } } });
    const second = createContext({ storage, overrides: { getSetting: () => true, BotProtect: { show() {} } } });
    for (const env of [first, second]) {
        loadCore(env.context);
        load(env.context, 'utils/core_bot_protection.js');
        env.context.PremiumFeaturesBackgroundScheduler.hardStop({ source: 'bot-protection' });
    }
    storage.removeItem('twpf_scheduler_hard_stop_v1');
    assert.equal(second.context.PremiumFeaturesBackgroundScheduler.stats().hardStopped, true);
    assert.equal(first.context.PremiumFeaturesBotProtection.resumeAfterHardStop(), true);
    const key = Object.keys(storage).find(value => value.startsWith('twpf_hard_stop_manual_resume_v1:'));
    assert.ok(key);
    second.windowEvents.dispatch('storage', { key, newValue: storage.getItem(key) });
    assert.equal(second.context.PremiumFeaturesBackgroundScheduler.stats().hardStopped, false);
});

test('real scheduler resumes Building Queue, Instant Free and Scavenging through their workers', async () => {
    const requests = { buildGet: 0, buildPost: 0, instantGet: 0, instantMutation: 0, scavGet: 0, scavPost: 0 };
    const instantReasons = [];
    const clock = new FakeClock(1000000);
    const env = createContext({ clock, overrides: {
        game_data: { world: 'pt99', csrf: 'csrf', screen: 'overview',
            link_base_pure: '/game.php?village=3&screen=', village: { id: 3 }, player: { id: 7 } },
        settings_cookies: { general: { show__building_queue: true, show__auto_build_instant_free: true } },
        getSetting: () => true, BotProtect: { show() {} }, t: key => key,
        showAutoHideBox() {}, getVillageLinkBase: id => '/game.php?village=' + id + '&screen=',
        getVillageName: id => String(id),
        fetch: async (url, options = {}) => {
            if (String(url).includes('build_order_reduce')) {
                requests.instantMutation++;
                return { ok: true, status: 200, url, json: async () => ({}) };
            }
            if (String(url).includes('mode=scavenge')) {
                requests.scavGet++;
                const village = { options: { 1: { base_id: 1, is_locked: false, scavenging_squad: null } },
                    unit_counts_home: { spear: 10 } };
                return { ok: true, status: 200, url, text: async () => 'var village = ' + JSON.stringify(village) + ';' };
            }
            if (String(url).includes('scavenge_api') && options.method === 'POST') {
                requests.scavPost++;
                return { ok: true, status: 200, url, json: async () => ({ response: {
                    squad_responses: [{ success: true }], villages: { 3: { options: {
                        1: { base_id: 1, scavenging_squad: { return_time: Math.floor((clock.now + 300000) / 1000) } }
                    } } }
                } }) };
            }
            throw new Error('Unexpected request: ' + url);
        },
        DOMParser: class { parseFromString(html) {
            return { querySelectorAll: () => [{ textContent: html }] };
        } }
    } });
    env.context.PremiumFeaturesBuildState = {};
    loadCore(env.context);
    const timerSets = [];
    const setHandler = env.context.setHandlerOnTimeOut;
    env.context.setHandlerOnTimeOut = function (...args) {
        timerSets.push({ id: args[0], reason: args[2]?.[3], at: clock.now });
        return setHandler(...args);
    };
    load(env.context, 'utils/buildStateStore.js');
    const stored = {};
    const queueStorage = {
        get(field, id) { return stored[String(id)]?.[field] ?? null; },
        patchMemory(fields, id) { stored[String(id)] = Object.assign({}, stored[String(id)] || {}, fields); },
        persistVillage() { return Promise.resolve(); },
        listVillageIds() { return Object.keys(stored); }
    };
    const store = env.context.createBuildStateStore({
        host: env.context, storage: env.storage, queueStorage, clock, now: () => clock.now,
        coordination: env.context.PremiumFeaturesCoordination, writeBehind: null
    });
    env.context.PremiumFeaturesBuildState = store;
    store.start();
    let scheduler = env.context.PremiumFeaturesBackgroundScheduler;
    const createController = currentScheduler => env.context.createBuildQueueController({
        store, scheduler: currentScheduler, clock, now: () => clock.now, handlerName: 'reconcileBuildQueueVillage',
        getCost: (_id, head, record) => {
            const offer = record.official?.nextBuildOffers?.[head.buildingId];
            return offer ? { effectiveLevel: offer.level, cost: offer, source: 'SERVER_OBSERVATION', authoritative: true }
                : { effectiveLevel: head.targetLevel, cost: { wood: 100, stone: 100, iron: 100 },
                    source: 'LOCAL_TARGET_CACHE', authoritative: false };
        },
        inspect: async (_villageId, context) => {
            assert.equal(context.requireNetwork, true, 'manual recovery must not authorize from stale page DOM');
            requests.buildGet++;
            return { official: { queue: [], levels: [], slots: [], cancelIds: [], full: false,
                maxSlots: 2, nextBuildOffers: { farm: { level: 25, wood: 100, stone: 100, iron: 100 } },
                fetchedAt: clock.now, source: 'test-official' },
            resources: { wood: 1000, stone: 1000, iron: 1000, pop: 0, popMax: 1000,
                fetchedAt: clock.now, source: 'test-official' } };
        },
        mutate: async () => { requests.buildPost++; return { accepted: true }; },
        runResilientTask: async options => ({ status: 'SUCCESS', value: await options.run() })
    });
    let controller = createController(scheduler);
    env.context.initializeBuildQueueStateInfrastructure = () => controller;
    env.context.ensureBuildQueueController = () => controller;
    env.context.getBuildQueueTimeoutId = id => 'building_queue_' + id;
    scheduler.registerHandler('reconcileBuildQueueVillage', (args, guard) => controller.reconcile(args[0], guard));
    store.add('1', 'farm', 25);
    store.setExecution('1', { state: 'RECONCILING', nextDueAt: null, reason: 'interrupted-before-inspect' }, true);
    store.updateOfficial('2', { queue: ['farm25'], levels: [25], slots: [clock.now + 179000],
        cancelIds: ['7'], nextSlotAt: clock.now + 179000, full: false,
        instantFree: { orderId: '7', availableFrom: clock.now - 1000, availableTo: clock.now + 179000 },
        fetchedAt: clock.now, source: 'test-official' });
    const officialUpdates = [];
    const updateOfficial = store.updateOfficial;
    store.updateOfficial = function (id, observation) {
        if (String(id) === '2') officialUpdates.push({ source: observation?.source,
            queue: observation?.queue?.length, at: clock.now });
        return updateOfficial(id, observation);
    };
    load(env.context, 'bots/buildInstantFree.js');
    const instantWorkerResults = [];
    const instantHandler = env.context.timeoutHandlers.instantFreeWorker;
    env.context.timeoutHandlers.instantFreeWorker = async (...args) => {
        const currentOfficial = store.get('2').official;
        const before = { expectedGeneration: args[1], actualGeneration: currentOfficial.generation,
            sameHash: args[2] === env.context._buildInstantSnapshot('2', currentOfficial) };
        const result = await instantHandler(...args);
        instantWorkerResults.push({ reason: args[3], status: result?.status || 'none', before });
        return result;
    };
    vm.runInContext(`_inspectBuildInstant = async function (villageId, reason) {
        window.__instantInspections(reason);
        return { official: PremiumFeaturesBuildState.get(villageId).official };
    };`, env.context);
    env.context.__instantInspections = reason => { requests.instantGet++; instantReasons.push(reason); };
    load(env.context, 'bots/scavenging.js');
    load(env.context, 'utils/core_bot_protection.js');
    vm.runInContext(`saveScavengeConfig({ enabled: true, level: 0, allUnits: true, units: {} }, '3');
        checkAndScheduleBuildInstantFree('2', { observeDom: false });
        _scheduleScavengingAuto(0, '3');`, env.context);
    controller.schedule('1', { dueAt: clock.now, state: 'RECONCILING', forceFresh: true });
    scheduler.hardStop({ source: 'bot-protection' });
    scheduler.cancel(controller.taskKey('1'), 'simulate interrupted hard-stop reconcile');
    assert.equal(scheduler.hasTask(controller.taskKey('1')), false);
    load(env.context, 'features/overviewVillages/init.js');
    load(env.context, 'features/overviewVillages/productionTable.js');
    assert.equal(env.context.getBuildQueueOverviewWaitingStatus('1').kind, 'HARD_STOP');
    for (let i = 0; i < 3; i++) { clock.tick(500); await flushMicrotasks(12); }
    assert.deepEqual(requests, { buildGet: 0, buildPost: 0, instantGet: 0,
        instantMutation: 0, scavGet: 0, scavPost: 0 });
    assert.equal(scheduler.stats().hardStopped, true);
    assert.equal(scheduler.hasTask('persistent-timeout:build_instant_free_2'), true);
    // Simulate a page reload: timers and scheduler memory disappear, while the persisted
    // hard-stop, queue intent, official snapshot, scavenging config and deadlines remain.
    clock.timers.clear();
    env.context.activeTimeouts = {};
    env.context.activeTimeoutGenerations = {};
    scheduler = env.context.createCooperativeScheduler({
        host: env.context, clock, now: () => clock.now,
        runtime: env.context.PremiumFeaturesRuntimeRegistry,
        coordinator: env.context.PremiumFeaturesCoordination, autoStart: false
    });
    env.context.BackgroundScheduler = scheduler;
    env.context.PremiumFeaturesBackgroundScheduler = scheduler;
    controller = createController(scheduler);
    scheduler.registerHandler('reconcileBuildQueueVillage', (args, guard) => controller.reconcile(args[0], guard));
    scheduler.start();
    assert.equal(scheduler.stats().hardStopped, true, 'reload must not auto-clear protection');
    assert.deepEqual(requests, { buildGet: 0, buildPost: 0, instantGet: 0,
        instantMutation: 0, scavGet: 0, scavPost: 0 });
    assert.equal(env.context.PremiumFeaturesBotProtection.resumeAfterHardStop(), true);
    for (let i = 0; i < 18; i++) { clock.tick(500); await flushMicrotasks(20); }
    assert.deepEqual(requests, { buildGet: 1, buildPost: 1, instantGet: 1,
        instantMutation: 1, scavGet: 1, scavPost: 1 }, 'instant reasons: ' + instantReasons.join(', ') +
        '; worker: ' + JSON.stringify(instantWorkerResults) + '; updates: ' + JSON.stringify(officialUpdates) +
        '; sets: ' + JSON.stringify(timerSets));
    assert.equal(store.get('1').queue.length, 0);
    assert.equal(store.get('2').official.queue.length, 0);
    assert.notEqual(env.context.getBuildQueueOverviewWaitingStatus('1').kind, 'HARD_STOP');
});

test('Instant Free expiry during hard-stop performs a fresh read but no stale reduce mutation', async () => {
    const clock = new FakeClock(1000000);
    let reads = 0;
    let mutations = 0;
    const official = { generation: 1, queue: ['farm25'], levels: [25],
        slots: [clock.now + 179000], cancelIds: ['7'], nextSlotAt: clock.now + 179000,
        instantFree: { orderId: '7', availableFrom: clock.now - 1000, availableTo: clock.now + 179000 },
        fetchedAt: clock.now, source: 'test-official' };
    const record = { official, instant: {} };
    const env = createContext({ clock, overrides: {
        game_data: { world: 'pt99', csrf: 'csrf', village: { id: 2 }, player: { id: 7 },
            link_base_pure: '/game.php?village=2&screen=' },
        settings_cookies: { general: { show__auto_build_instant_free: true } },
        PremiumFeaturesBuildState: {
            get: () => record,
            setInstant(_id, patch) { Object.assign(record.instant, patch); return record; },
            updateOfficial(_id, patch) { Object.assign(record.official, patch); record.official.generation++; return record; },
            publishObservation() {}
        },
        getSetting: () => true, BotProtect: { show() {} }, getVillageLinkBase: id => '/game.php?village=' + id + '&screen=',
        fetch: async () => { mutations++; return { ok: true, status: 200, json: async () => ({}) }; }
    } });
    loadCore(env.context);
    load(env.context, 'bots/buildInstantFree.js');
    load(env.context, 'utils/core_bot_protection.js');
    vm.runInContext(`_inspectBuildInstant = async function () {
        window.__countInstantRead();
        return { official: PremiumFeaturesBuildState.get('2').official };
    };`, env.context);
    env.context.__countInstantRead = () => { reads++; };
    env.context.checkAndScheduleBuildInstantFree('2', { observeDom: false });
    env.context.PremiumFeaturesBackgroundScheduler.hardStop({ source: 'bot-protection' });
    clock.tick(180000);
    await flushMicrotasks(10);
    assert.equal(reads, 0);
    assert.equal(mutations, 0);
    assert.equal(env.context.PremiumFeaturesBotProtection.resumeAfterHardStop(), true);
    for (let i = 0; i < 5; i++) { clock.tick(500); await flushMicrotasks(20); }
    assert.equal(reads, 1);
    assert.equal(mutations, 0);
});

test('persisted timeout remains recoverable until its asynchronous callback settles', async () => {
    const env = createContext();
    loadCore(env.context);
    let release;
    env.context.pendingCallback = new Promise(resolve => { release = resolve; });
    vm.runInContext(`
        registerTimeoutHandler('recoverable', function () { return pendingCallback; });
        setHandlerOnTimeOut('recoverable', 'recoverable', [], 100, 0, 0);
    `, env.context);
    const generation = env.context.getPersistedTimeoutGeneration('recoverable');
    const endTime = Number(env.context.localStorage.getItem('endTime_recoverable'));
    const running = env.context.consumeAndRunPersistedTimeout('recoverable', generation, endTime);
    assert.equal(Number(env.context.localStorage.getItem('endTime_recoverable')), endTime);
    release('done');
    assert.equal(await running, 'done');
    assert.equal(env.context.localStorage.getItem('endTime_recoverable'), null);
});

test('a persisted auto worker can arm its next cycle while the first callback is still active', async () => {
    const env = createContext();
    env.context.events = [];
    loadCore(env.context);
    vm.runInContext(`
        registerTimeoutHandler('auto-cycle', async function () {
            events.push('run');
            if (events.length === 1) {
                setHandlerOnTimeOut('auto-cycle', 'auto-cycle', [], 100, 0, 0);
            }
        });
        setHandlerOnTimeOut('auto-cycle', 'auto-cycle', [], 100, 0, 0);
    `, env.context);
    await drainTimers(env.clock);
    assert.deepEqual(Array.from(env.context.events), ['run', 'run']);
    assert.equal(env.storage.getItem('endTime_auto-cycle'), null);
});

test('start called five times installs one logical lifecycle', () => {
    const env = createContext();
    load(env.context, 'utils/core_runtime.js');
    const counters = { prepare: 0, ui: 0, background: 0, observers: 0 };
    const scheduler = { marker: 'single-scheduler' };
    Object.assign(env.context, {
        BACKGROUND_TASK_PRIORITY: { AUTOMATIC: 3, REFRESH: 4 },
        PremiumFeaturesBackgroundScheduler: scheduler,
        PremiumFeaturesCoordination: {
            registerBackgroundTask() { counters.background++; },
            isCoordinator() { return true; }
        },
        game_data: { village: { id: 1 }, player: { villages: 1 }, link_base_pure: '/game.php?village=1&screen=', csrf: 'x' },
        settings_cookies: {
            widgets: [],
            general: {
                keep_awake: true,
                redirect__train_buildings: false,
                show__auto_daily_bonus: false,
                show__auto_paladin_train: { enabled: false },
                show__player_profile_stats: false
            }
        },
        serverTimezoneOffsetMs: 0,
        detectServerTimezoneOffsetMs: () => 0,
        prepareVillageList: () => { counters.prepare++; },
        listenTextAreas() {},
        setCookieCurrentVillage() {},
        checkEarlyBuildOpportunity() {},
        captureCurrentVillageMarketTransports() {},
        injectOverviewVillagesTopbarMenu() {},
        addRessourcesHover() {},
        insertNavigationArrows: () => { counters.ui++; },
        insertListVillagesPopup() {},
        injectNavigationBar() {},
        defineKeyboardShortcuts() {},
        injectScriptSettingsPopUp() {},
        registerWidgetPopupSidebarShortcuts() {},
        fetchAndCacheWorldSettings: async () => ({}),
        updateMapInfoVillages: async () => {},
        updateMapInfoPlayers: async () => {},
        updateMapInfoAllies: async () => {},
        storeUnitsInfo() {},
        fetchAndCacheBuildingsData: async () => ({}),
        localStorage: createStorage({ villages_info: '[]', settings_cookies: JSON.stringify({ widgets: [], general: { keep_awake: true } }) })
    });
    env.context.window.PremiumFeaturesCoordination = env.context.PremiumFeaturesCoordination;
    env.context.window.PremiumFeaturesBackgroundScheduler = scheduler;
    load(env.context, 'utils/core_utils.js');

    const target = createEventTarget();
    const registry = env.context.window.PremiumFeaturesRuntimeRegistry;
    registry.addEventListener('test:listener', target, 'change', function () {});
    registry.addEventListener('test:listener', target, 'change', function () {});
    registry.setObserver('test:observer', function () { counters.observers++; return { disconnect() {} }; });
    registry.setObserver('test:observer', function () { counters.observers++; return { disconnect() {} }; });
    for (let i = 0; i < 5; i++) env.context.start();

    assert.equal(counters.prepare, 1);
    assert.equal(counters.ui, 1);
    assert.equal(counters.background, 10);
    assert.equal(counters.observers, 1);
    assert.equal(target.listenerCount('change'), 1);
    assert.equal(registry.stats().intervals, 0);
    assert.strictEqual(env.context.window.PremiumFeaturesBackgroundScheduler, scheduler);
});

test('replaceable observer rebinds after partial DOM reload and disconnects the stale target', () => {
    const env = createContext();
    load(env.context, 'utils/core_runtime.js');
    const runtime = env.context.createRuntimeRegistry({ clock: env.clock });
    let staleDisconnects = 0;
    let currentDisconnects = 0;
    const stale = { disconnect() { staleDisconnects++; } };
    const current = { disconnect() { currentDisconnects++; } };
    assert.equal(runtime.setObserver('resource-dom', () => stale), stale);
    assert.equal(runtime.setObserver('resource-dom', () => current, true), current);
    assert.equal(staleDisconnects, 1);
    assert.equal(currentDisconnects, 0);
    assert.equal(runtime.stats().observers, 1);
    runtime.clearObserver('resource-dom');
    assert.equal(currentDisconnects, 1);
});

test('two tabs compete, fail over, and reject stale fencing', () => {
    const env = createContext();
    load(env.context, 'utils/core_runtime.js');
    load(env.context, 'utils/core_coordination.js');
    let now = 1000;
    const shared = createStorage();
    const common = { storage: shared, now: () => now, host: env.context, heartbeatMs: 1000, coordinatorLeaseMs: 3000 };
    const tabA = env.context.createTabCoordinator({ ...common, tabId: 'A', instanceId: 'A1' });
    const tabB = env.context.createTabCoordinator({ ...common, tabId: 'B', instanceId: 'B1' });

    const leaseA = tabA.acquireLease('build-queue:123', 3000);
    assert.ok(leaseA);
    assert.equal(tabB.acquireLease('build-queue:123', 3000), null);
    now = 5000;
    const leaseB = tabB.acquireLease('build-queue:123', 3000);
    assert.ok(leaseB);
    assert.ok(leaseB.token > leaseA.token);
    assert.equal(tabA.validateLease(leaseA), false);
    assert.throws(() => tabA.assertLease(leaseA), error => error.code === 'LEASE_LOST');

    assert.equal(tabA.evaluateCoordinator(), true);
    assert.equal(tabB.evaluateCoordinator(), false);
    now = 9001;
    assert.equal(tabB.evaluateCoordinator(), true);
    assert.equal(tabA.isCoordinator(), false);
});

test('coordinator delay is a future occurrence and does not occupy a scheduler slot', () => {
    const env = createContext();
    load(env.context, 'utils/core_runtime.js');
    load(env.context, 'utils/core_coordination.js');
    const scheduled = [];
    env.context.PremiumFeaturesBackgroundScheduler = {
        DUE_MODE: { REPLACE: 'REPLACE' },
        enqueue(descriptor) { scheduled.push(descriptor); return Promise.resolve(); }
    };
    const coordinator = env.context.createTabCoordinator({
        host: env.context, storage: createStorage(), now: () => env.clock.now,
        clock: env.clock, tabId: 'A', instanceId: 'A1', scope: 'delayed-job-test'
    });
    assert.equal(coordinator.evaluateCoordinator(), true);
    coordinator.registerBackgroundTask('map-player', function () {}, {
        delayMs: 2000, dueMode: 'REPLACE', priority: 4, leaseKey: 'world-data-refresh'
    });
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].dueAt, env.clock.now + 2000);
    assert.equal(scheduled[0].dueMode, 'REPLACE');
    assert.equal(scheduled[0].leaseKey, 'world-data-refresh');
});

test('single-flight shares the exact Promise and executes once', async () => {
    const env = createContext();
    load(env.context, 'utils/core_async.js');
    const singleFlight = env.context.PremiumFeaturesAsync.createSingleFlight();
    let calls = 0;
    let release;
    const deferred = new Promise(resolve => { release = resolve; });
    const first = singleFlight.run('screen=main:village=1', () => { calls++; return deferred; });
    const second = singleFlight.run('screen=main:village=1', () => { calls++; return Promise.resolve('wrong'); });
    assert.strictEqual(first, second);
    assert.equal(calls, 0);
    await flushMicrotasks();
    assert.equal(calls, 1);
    release('ok');
    assert.equal(await second, 'ok');
});

test('single-flight rejection is evicted and the next legitimate call runs again', async () => {
    const env = createContext();
    load(env.context, 'utils/core_async.js');
    const flight = env.context.createSingleFlight();
    let executions = 0;
    await assert.rejects(flight.run('village-main:1', async () => {
        executions++;
        throw new Error('transient read failure');
    }));
    await flushMicrotasks();
    const value = await flight.run('village-main:1', async () => {
        executions++;
        return 'fresh';
    });
    assert.equal(value, 'fresh');
    assert.equal(executions, 2);
    assert.equal(flight.size(), 0);
});

test('cache exposes fresh, stale-usable and expired states per resource policy', () => {
    const env = createContext();
    load(env.context, 'utils/core_async.js');
    let now = 1000;
    const cache = env.context.PremiumFeaturesAsync.createResourceCache({ now: () => now });
    cache.set('village:1', { wood: 10 });
    const policy = { freshForMs: 100, staleForMs: 200 };
    assert.equal(cache.read('village:1', policy).state, 'FRESH');
    now = 1150;
    assert.equal(cache.read('village:1', policy).state, 'STALE_BUT_USABLE');
    now = 1400;
    assert.equal(cache.read('village:1', policy).state, 'EXPIRED');
});

test('circuit breaker opens only for repeated same-snapshot failures', () => {
    const env = createContext();
    load(env.context, 'utils/core_async.js');
    let now = 0;
    const breaker = env.context.PremiumFeaturesAsync.createCircuitBreaker({ now: () => now, threshold: 3 });
    breaker.recordFailure('paladin', 'snapshot-a', { status: 503 });
    breaker.recordFailure('paladin', 'snapshot-a', { status: 503 });
    assert.equal(breaker.getState('paladin').state, 'CLOSED');
    breaker.recordFailure('paladin', 'snapshot-a', { status: 503 });
    assert.equal(breaker.getState('paladin').state, 'OPEN');
    assert.equal(breaker.canRun('paladin', 'snapshot-a'), false);
    assert.equal(breaker.canRun('paladin', 'snapshot-b'), true);
    assert.equal(breaker.getState('paladin').failureCount, 0);
});

test('timeout soft-pauses without immediate retry', async () => {
    const env = createContext();
    load(env.context, 'utils/core_async.js');
    let calls = 0;
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    const breaker = env.context.PremiumFeaturesAsync.createCircuitBreaker({ now: () => 1000 });
    const result = await env.context.runResilientTask({
        key: 'reports-sync',
        snapshot: { page: 1 },
        breaker,
        run: async () => { calls++; throw timeout; }
    });
    assert.equal(result.status, 'SOFT_PAUSED');
    assert.equal(result.retryAt, 31000);
    assert.equal(calls, 1);
});

test('POST timeout becomes UNCERTAIN and schedules one reconciliation', async () => {
    const env = createContext();
    load(env.context, 'utils/core_async.js');
    let calls = 0;
    const queued = [];
    const timeout = new Error('post timed out');
    timeout.name = 'TimeoutError';
    const breaker = env.context.PremiumFeaturesAsync.createCircuitBreaker({ now: () => 0 });
    const result = await env.context.runResilientTask({
        key: 'build-instant:1',
        snapshot: { orderId: 9 },
        mutation: true,
        timeout: true,
        leaseKey: 'build-instant:1',
        breaker,
        scheduler: { PRIORITY: { RECONCILIATION: 2 }, enqueue: task => queued.push(task) },
        reconcile: async () => 'checked',
        run: async () => { calls++; throw timeout; }
    });
    assert.equal(result.status, 'UNCERTAIN');
    assert.equal(calls, 1);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].priority, 2);
});

test('mutation HTTP 500/502/503 is UNCERTAIN and reconciliation prevents duplicate mutation', async () => {
    const env = createContext();
    load(env.context, 'utils/core_async.js');
    const queued = [];
    const scheduler = {
        PRIORITY: { RECONCILIATION: 2 },
        DUE_MODE: { EARLIEST: 'EARLIEST' },
        enqueue(task) { queued.push(task); }
    };
    let mutations = 0;
    for (const status of [500, 502, 503]) {
        let applied = false;
        const result = await env.context.runResilientTask({
            key: 'mutation-' + status, mutation: true, method: 'POST', url: '/game.php',
            snapshotHash: 'same-decision', scheduler,
            run: async () => {
                mutations++;
                applied = true;
                const error = new Error('HTTP ' + status + ' after apply');
                error.status = status;
                error.url = '/game.php';
                throw error;
            },
            reconcile: async () => ({ applied })
        });
        assert.equal(result.status, 'UNCERTAIN');
    }
    assert.equal(mutations, 3);
    assert.equal(queued.length, 3);
    for (const task of queued) assert.equal((await task.run()).applied, true);
    assert.equal(mutations, 3);
});

test('mutation response parse failure after transmission is UNCERTAIN', async () => {
    const env = createContext();
    load(env.context, 'utils/core_async.js');
    const queued = [];
    const parseError = Object.assign(new SyntaxError('invalid JSON after accepted mutation'), {
        afterTransmission: true
    });
    const result = await env.context.runResilientTask({
        key: 'mutation-parse', mutation: true, method: 'POST', url: '/game.php',
        snapshotHash: 'transmitted',
        scheduler: {
            PRIORITY: { RECONCILIATION: 2 }, DUE_MODE: { EARLIEST: 'EARLIEST' },
            enqueue(task) { queued.push(task); }
        },
        run: async () => { throw parseError; },
        reconcile: async () => ({ applied: true })
    });
    assert.equal(result.status, 'UNCERTAIN');
    assert.equal(queued.length, 1);
    assert.deepEqual(await queued[0].run(), { applied: true });
});

test('same-origin 429 performs zero retries and hard-stops', async () => {
    let ajaxCalls = 0;
    let hardStops = 0;
    const jquery = jqueryStub();
    jquery.ajax = settings => {
        ajaxCalls++;
        settings.error({ status: 429, responseURL: 'https://pt99.tribalwars.com.pt/game.php' });
    };
    const env = createContext({ overrides: { $: jquery } });
    env.context.PremiumFeaturesBotProtection = { block: () => { hardStops++; } };
    env.context.PremiumFeaturesBackgroundScheduler = { hardStop: () => { hardStops++; } };
    load(env.context, 'utils/core_async.js');
    await assert.rejects(env.context.fetchWithRetry429({ url: '/game.php', type: 'GET' }));
    assert.equal(ajaxCalls, 1);
    assert.equal(hardStops, 2);
});

test('403/429 hard-stop policy is restricted to same-origin Tribal Wars', async () => {
    const env = createContext();
    load(env.context, 'utils/core_async.js');
    const classify = env.context.PremiumFeaturesAsync.classifyRequestFailure;
    assert.equal(classify({ status: 403 }, { url: '/game.php' }).hardStop, true);
    assert.equal(classify({ status: 429 }, { url: 'https://api.example.com/data' }).hardStop, false);
    const transient = classify({ status: 503 }, { url: '/game.php' });
    assert.equal(transient.transient, true);
    assert.equal(transient.hardStop, false);

    let explicitStops = 0;
    env.context.PremiumFeaturesBackgroundScheduler = { hardStop() { explicitStops++; } };
    env.context.PremiumFeaturesCoordination = { broadcast() {}, stop() { explicitStops++; } };
    env.context.PremiumFeaturesBotProtection = { block() { explicitStops++; } };
    const explicit = new Error('detector active');
    explicit.code = 'HARD_STOP';
    const result = await env.context.runResilientTask({
        key: 'explicit-hard-stop',
        snapshot: { generation: 1 },
        run: async () => { throw explicit; }
    });
    assert.equal(result.status, 'HARD_STOP');
    assert.equal(explicitStops, 3);
});

test('resume processes overdue work one task per deterministic turn', async () => {
    const env = createContext();
    loadCore(env.context);
    const starts = [];
    const scheduler = env.context.createCooperativeScheduler({
        host: env.context,
        clock: env.clock,
        now: () => env.clock.now,
        autoStart: false,
        turnGapMs: 100,
        concurrency: 1
    });
    scheduler.start();
    scheduler.pause();
    for (let i = 0; i < 6; i++) {
        scheduler.enqueue({ key: 'overdue-' + i, priority: 3, dueAt: 0, run: () => { starts.push(env.clock.now); } });
    }
    scheduler.resume();
    env.clock.tick(0);
    await flushMicrotasks();
    assert.equal(starts.length, 1);
    env.clock.tick(99);
    await flushMicrotasks();
    assert.equal(starts.length, 1);
    env.clock.tick(1);
    await flushMicrotasks();
    assert.equal(starts.length, 2);
    await drainTimers(env.clock);
    assert.equal(starts.length, 6);
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 100);
});

test('runtime resume makes overdue automation immediately eligible before housekeeping', async () => {
    const env = createContext();
    loadCore(env.context);
    const order = [];
    const scheduler = env.context.createCooperativeScheduler({
        host: env.context, clock: env.clock, now: () => env.clock.now,
        autoStart: false, turnGapMs: 10, concurrency: 1
    });
    scheduler.start();
    scheduler.enqueue({ key: 'keep-awake', priority: 5, dueAt: 0, run: () => order.push('housekeeping') });
    scheduler.enqueue({ key: 'build-queue', priority: 3, dueAt: 100, run: () => order.push('automatic') });
    // Advance wall time without executing any JavaScript timers, modelling browser/OS suspension.
    env.clock.now = 600;
    scheduler.resume('pageshow-after-suspension');
    env.clock.tick(0);
    await flushMicrotasks();
    assert.deepEqual(order, ['automatic']);
    await drainTimers(env.clock);
    assert.deepEqual(order, ['automatic', 'housekeeping']);
});

test('scheduler due modes make replacement semantics explicit', () => {
    const env = createContext();
    loadCore(env.context);
    const scheduler = env.context.createCooperativeScheduler({
        host: env.context, clock: env.clock, now: () => env.clock.now, autoStart: false
    });
    scheduler.start();
    scheduler.pause();
    scheduler.enqueue({ key: 'mode', dueAt: 100, run() {} });
    scheduler.enqueue({ key: 'mode', dueAt: 200, dueMode: scheduler.DUE_MODE.REPLACE, run() {} });
    assert.equal(scheduler.describe('mode').dueAt, 200);
    scheduler.enqueue({ key: 'mode', dueAt: 150, dueMode: scheduler.DUE_MODE.LATEST, run() {} });
    assert.equal(scheduler.describe('mode').dueAt, 200);
    scheduler.enqueue({ key: 'mode', dueAt: 50, dueMode: scheduler.DUE_MODE.EARLIEST, run() {} });
    assert.equal(scheduler.describe('mode').dueAt, 50);
    scheduler.enqueue({ key: 'mode', dueAt: 500, dueMode: scheduler.DUE_MODE.KEEP, run() {} });
    assert.equal(scheduler.describe('mode').dueAt, 50);
});

test('a hidden document does not pause due background work', async () => {
    const env = createContext();
    loadCore(env.context);
    const runtime = env.context.createRuntimeRegistry({ clock: env.clock });
    const scheduler = env.context.createCooperativeScheduler({
        host: env.context, runtime, clock: env.clock, now: () => env.clock.now,
        autoStart: false, turnGapMs: 10
    });
    let executions = 0;
    scheduler.start();
    env.document.hidden = true;
    env.document.dispatch('visibilitychange');
    scheduler.enqueue({ key: 'hidden-automatic', dueAt: env.clock.now, priority: 3, run: () => { executions++; } });
    env.clock.tick(0);
    await flushMicrotasks();
    assert.equal(executions, 1);
    assert.equal(scheduler.stats().paused, false);
});

test('lease contention records a future wake and executes after expiry without reload', async () => {
    const env = createContext();
    loadCore(env.context);
    let attempts = 0;
    const coordinator = {
        isCoordinator: () => true,
        readLease: () => ({ owner: 'other', expiresAt: 100 }),
        async runWithLease(_key, run) {
            attempts++;
            if (attempts === 1) {
                const error = new Error('owned elsewhere');
                error.code = 'LEASE_UNAVAILABLE';
                error.currentLease = { owner: 'other', expiresAt: 100 };
                throw error;
            }
            return run({ assertActive() {}, isActive: () => true });
        }
    };
    const scheduler = env.context.createCooperativeScheduler({
        host: env.context, coordinator, clock: env.clock, now: () => env.clock.now,
        autoStart: false, turnGapMs: 10
    });
    let ran = 0;
    scheduler.start();
    scheduler.enqueue({ key: 'leased', leaseKey: 'build-queue:1', dueAt: 0, run: () => { ran++; } });
    env.clock.tick(0);
    await flushMicrotasks();
    const waiting = scheduler.describe('leased');
    assert.equal(waiting.state, 'WAITING_LEASE');
    assert.ok(waiting.dueAt > 100);
    assert.equal(waiting.wakeArmed, true);
    await drainTimers(env.clock);
    assert.equal(ran, 1);
});

test('explicit hard-stop survives scheduler recreation until manual clear', async () => {
    const storage = createStorage();
    const first = createContext({ storage });
    loadCore(first.context);
    const firstScheduler = first.context.createCooperativeScheduler({
        host: first.context, clock: first.clock, now: () => first.clock.now,
        hardStopStorageKey: 'test-hard-stop', autoStart: false
    });
    firstScheduler.start();
    firstScheduler.hardStop({ source: 'bot-protection' });

    const resumed = createContext({ storage, clock: new FakeClock(first.clock.now) });
    loadCore(resumed.context);
    const secondScheduler = resumed.context.createCooperativeScheduler({
        host: resumed.context, clock: resumed.clock, now: () => resumed.clock.now,
        hardStopStorageKey: 'test-hard-stop', autoStart: false
    });
    let ran = 0;
    secondScheduler.start();
    secondScheduler.enqueue({ key: 'must-stay-stopped', run: () => { ran++; } });
    resumed.clock.tick(1000);
    await flushMicrotasks();
    assert.equal(secondScheduler.stats().hardStopped, true);
    assert.equal(ran, 0);
    secondScheduler.clearHardStop();
    await drainTimers(resumed.clock);
    assert.equal(ran, 1);
});

test('an active task cannot erase or overwrite its newer same-key rerun', async () => {
    const env = createContext();
    loadCore(env.context);
    const events = [];
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    const scheduler = env.context.createCooperativeScheduler({
        host: env.context,
        clock: env.clock,
        now: () => env.clock.now,
        autoStart: false,
        turnGapMs: 10,
        concurrency: 1
    });
    scheduler.registerHandler('same-key-handler', function () {});
    scheduler.start();

    const first = scheduler.enqueue({
        key: 'same-key',
        handlerName: 'same-key-handler',
        args: ['old'],
        persist: true,
        rerunWhileActive: true,
        run: async () => {
            events.push('old');
            await firstGate;
        }
    });
    env.clock.tick(0);
    await flushMicrotasks();

    scheduler.enqueue({
        key: 'same-key',
        handlerName: 'same-key-handler',
        args: ['new'],
        persist: true,
        rerunWhileActive: true,
        dueAt: 100,
        run: () => events.push('new')
    });
    releaseFirst();
    await first;
    await flushMicrotasks();

    const persisted = JSON.parse(env.context.PremiumFeaturesWriteBehind.get('twpf_background_task_v1:same-key'));
    assert.deepEqual(Array.from(persisted.args), ['new']);
    await drainTimers(env.clock);
    assert.deepEqual(events, ['old', 'new']);
    assert.equal(env.context.PremiumFeaturesWriteBehind.get('twpf_background_task_v1:same-key'), null);
});

test('manual and reconciliation work outrank automatic background work', async () => {
    const env = createContext();
    loadCore(env.context);
    const order = [];
    const scheduler = env.context.createCooperativeScheduler({
        host: env.context,
        clock: env.clock,
        now: () => env.clock.now,
        autoStart: false,
        turnGapMs: 10,
        concurrency: 1
    });
    scheduler.start();
    scheduler.pause();
    scheduler.enqueue({ key: 'housekeeping', priority: 5, run: () => order.push('housekeeping') });
    scheduler.enqueue({ key: 'automatic', priority: 3, run: () => order.push('automatic') });
    scheduler.enqueue({ key: 'manual', priority: 1, run: () => order.push('manual') });
    scheduler.enqueue({ key: 'reconcile', priority: 2, run: () => order.push('reconcile') });
    scheduler.resume();
    await drainTimers(env.clock);
    assert.deepEqual(order, ['manual', 'reconcile', 'automatic', 'housekeeping']);
});

test('editing pauses only tasks bound to that UI scope', async () => {
    const env = createContext();
    loadCore(env.context);
    const order = [];
    const runtime = env.context.createRuntimeRegistry({ clock: env.clock });
    const scheduler = env.context.createCooperativeScheduler({
        host: env.context,
        runtime,
        clock: env.clock,
        now: () => env.clock.now,
        autoStart: false,
        turnGapMs: 10,
        interactionDeferMs: 100,
        concurrency: 1
    });
    scheduler.start();
    runtime.beginInteraction('build-editor');
    scheduler.enqueue({ key: 'related', priority: 1, interactionScope: 'build-editor', run: () => order.push('related') });
    scheduler.enqueue({ key: 'unrelated', priority: 3, run: () => order.push('unrelated') });
    env.clock.tick(0);
    await flushMicrotasks();
    assert.deepEqual(order, ['unrelated']);
    runtime.endInteraction('build-editor');
    await drainTimers(env.clock);
    assert.deepEqual(order, ['unrelated', 'related']);
});

test('write-behind consolidates rapid writes and idle infrastructure makes no requests', () => {
    const storage = createStorage();
    let ajaxCalls = 0;
    const jquery = jqueryStub();
    jquery.ajax = () => { ajaxCalls++; };
    const env = createContext({ storage, overrides: { $: jquery } });
    loadCore(env.context);
    const writer = env.context.createWriteBehindStore({ storage, clock: env.clock, delayMs: 50 });
    writer.set('state', 'one');
    writer.set('state', 'two');
    writer.set('state', 'three');
    assert.equal(writer.pendingCount(), 1);
    assert.equal(storage.getItem('state'), null);
    env.clock.tick(50);
    assert.equal(storage.getItem('state'), 'three');
    assert.equal(ajaxCalls, 0);
});

test('main userscript require graph resolves locally and Premium Compat remains present', () => {
    const main = fs.readFileSync(path.join(ROOT, 'main.user.js'), 'utf8');
    const requires = Array.from(
        main.matchAll(/^\/\/ @require\s+https:\/\/raw\.githubusercontent\.com\/jpmartins98\/Tribalwars-Premium-Features\/master\/(.+)$/gm),
        match => match[1].split(/[?#]/)[0]
    );
    assert.ok(requires.length > 0);
    requires.forEach(relativePath => assert.ok(fs.existsSync(path.join(ROOT, relativePath)), 'missing @require ' + relativePath));
    assert.match(main, /Premium Features \[Premium Compat\]/);
    const queue = fs.readFileSync(path.join(ROOT, 'widgets/extraBuildQueue.js'), 'utf8');
    assert.match(queue, /game_data\?\.features\?\.Premium\?\.active \? 5 : 2/);
});

(async () => {
    let passed = 0;
    const pattern = process.env.TEST_PATTERN || '';
    const selectedTests = pattern ? tests.filter(current => current.name.includes(pattern)) : tests;
    for (const current of selectedTests) {
        try {
            await current.fn();
            passed++;
            console.log('ok', passed, '-', current.name);
        } catch (error) {
            console.error('not ok', passed + 1, '-', current.name);
            throw error;
        }
    }
    console.log(`\n${passed} core runtime tests passed`);
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
