'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

class FakeClock {
    constructor(now = 1000) {
        this.now = now;
        this.nextId = 1;
        this.timers = new Map();
    }
    setTimeout(fn, delay = 0) {
        const id = this.nextId++;
        this.timers.set(id, { at: this.now + Math.max(0, Number(delay) || 0), fn });
        return id;
    }
    clearTimeout(id) { this.timers.delete(id); }
    tick(ms) {
        const target = this.now + ms;
        let safety = 10000;
        while (safety--) {
            const next = Array.from(this.timers.entries())
                .filter(([, timer]) => timer.at <= target)
                .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
            if (!next) break;
            this.timers.delete(next[0]);
            this.now = next[1].at;
            next[1].fn();
        }
        if (safety < 0) throw new Error('fake timer runaway');
        this.now = target;
    }
}

function createStorage(initial = {}) {
    const data = new Map(Object.entries(initial).map(([key, value]) => [String(key), String(value)]));
    return {
        get length() { return data.size; },
        key(index) { return Array.from(data.keys())[index] ?? null; },
        getItem(key) { return data.has(String(key)) ? data.get(String(key)) : null; },
        setItem(key, value) { data.set(String(key), String(value)); },
        removeItem(key) { data.delete(String(key)); },
        dump() { return Object.fromEntries(data); }
    };
}

function copy(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createQueueAdapter(sharedRecords, writes) {
    const memory = copy(sharedRecords);
    return {
        get(field, villageId) { return memory[String(villageId)]?.[field] ?? null; },
        patchMemory(fields, villageId) {
            const id = String(villageId);
            memory[id] = Object.assign({}, memory[id] || {}, copy(fields));
            return memory[id];
        },
        async persistVillage(villageId) {
            const id = String(villageId);
            sharedRecords[id] = copy(memory[id] || {});
            writes.count++;
        },
        listVillageIds() { return Object.keys(memory); },
        getRecord(villageId) { return memory[String(villageId)] || null; }
    };
}

class CoordinationBus {
    constructor(clock) {
        this.clock = clock;
        this.listeners = new Map();
        this.leases = new Map();
        this.fences = new Map();
    }
    coordinator(id) {
        const bus = this;
        const listeners = new Map();
        bus.listeners.set(id, listeners);
        function emit(type, payload) {
            const set = listeners.get(type);
            if (set) Array.from(set).forEach(fn => fn(copy(payload)));
        }
        return {
            instanceId: id,
            scope: 'test-world:test-player',
            subscribe(type, fn) {
                if (!listeners.has(type)) listeners.set(type, new Set());
                listeners.get(type).add(fn);
                return () => listeners.get(type)?.delete(fn);
            },
            broadcast(type, payload) {
                for (const target of bus.listeners.values()) {
                    const set = target.get(type);
                    if (set) Array.from(set).forEach(fn => fn(copy(payload)));
                }
            },
            acquireLease(taskKey, ttlMs = 30000) {
                const current = bus.leases.get(taskKey);
                if (current && current.expiresAt > bus.clock.now && current.owner !== id) return null;
                const token = (bus.fences.get(taskKey) || 0) + 1;
                bus.fences.set(taskKey, token);
                const lease = { taskKey, owner: id, token, expiresAt: bus.clock.now + ttlMs };
                bus.leases.set(taskKey, lease);
                return copy(lease);
            },
            validateLease(lease) {
                const current = bus.leases.get(lease?.taskKey);
                return !!current && current.owner === id && current.token === lease.token && current.expiresAt > bus.clock.now;
            },
            assertLease(lease) {
                if (this.validateLease(lease)) return true;
                const error = new Error('lease lost');
                error.code = 'LEASE_LOST';
                throw error;
            },
            async runWithLease(taskKey, run, options = {}) {
                const lease = this.acquireLease(taskKey, options.ttlMs || 30000);
                if (!lease) {
                    const error = new Error('lease unavailable');
                    error.code = 'LEASE_UNAVAILABLE';
                    error.currentLease = copy(bus.leases.get(taskKey));
                    throw error;
                }
                await Promise.resolve();
                const api = this;
                const guard = {
                    token: lease.token,
                    assertActive() { return api.assertLease(lease); },
                    isActive() { return api.validateLease(lease); }
                };
                try {
                    guard.assertActive();
                    return await run(guard);
                } finally {
                    const current = bus.leases.get(taskKey);
                    if (current?.owner === id && current.token === lease.token) bus.leases.delete(taskKey);
                }
            },
            disappear() {
                // A crashed tab does not release leases; expiry provides failover.
                bus.listeners.delete(id);
            },
            _emit: emit
        };
    }
}

class TestScheduler {
    constructor(clock, coordination) {
        this.clock = clock;
        this.coordination = coordination;
        this.tasks = new Map();
        this.PRIORITY = { MANUAL: 1, RECONCILIATION: 2, AUTOMATIC: 3, REFRESH: 4, HOUSEKEEPING: 5 };
        this.DUE_MODE = { REPLACE: 'REPLACE', EARLIEST: 'EARLIEST', LATEST: 'LATEST', KEEP: 'KEEP' };
    }
    enqueue(descriptor) {
        let resolveCompletion;
        descriptor.completion = new Promise(resolve => { resolveCompletion = resolve; });
        descriptor.resolveCompletion = resolveCompletion;
        this.tasks.set(String(descriptor.key), descriptor);
        return descriptor.completion;
    }
    cancel(key) {
        const task = this.tasks.get(String(key));
        if (!task) return false;
        this.tasks.delete(String(key));
        task.resolveCompletion?.({ status: 'CANCELLED' });
        return true;
    }
    describe(key) {
        const task = this.tasks.get(String(key));
        if (!task) return { taskKey: String(key), state: 'MISSING', wakeArmed: false };
        return {
            taskKey: String(key),
            state: Number(task.dueAt) <= this.clock.now ? 'OVERDUE' : 'QUEUED',
            dueAt: Number(task.dueAt),
            wakeArmed: true,
            wakeAt: Number(task.dueAt),
            overdueByMs: Math.max(0, this.clock.now - Number(task.dueAt))
        };
    }
    async runNext() {
        const entry = Array.from(this.tasks.entries())
            .filter(([, task]) => Number(task.dueAt) <= this.clock.now)
            .sort((a, b) => a[1].priority - b[1].priority || a[1].dueAt - b[1].dueAt)[0];
        if (!entry) return null;
        const [key, task] = entry;
        this.tasks.delete(key);
        try {
            const value = task.leaseKey
                ? await this.coordination.runWithLease(task.leaseKey, task.run, { ttlMs: 30000 })
                : await task.run(null);
            task.resolveCompletion?.({ status: 'COMPLETED', value });
            return { status: 'COMPLETED', value };
        } catch (error) {
            if (error.code === 'LEASE_UNAVAILABLE') {
                task.dueAt = Number(error.currentLease?.expiresAt) + 1 || this.clock.now + 1000;
                this.tasks.set(key, task);
                return { status: 'LEASE_UNAVAILABLE' };
            }
            if (error.code === 'LEASE_LOST') {
                task.resolveCompletion?.({ status: 'LEASE_LOST' });
                return { status: 'LEASE_LOST' };
            }
            task.resolveCompletion?.({ status: 'FAILED', error });
            throw error;
        }
    }
    dueCount() {
        return Array.from(this.tasks.values()).filter(task => task.dueAt <= this.clock.now).length;
    }
}

const context = {
    console,
    Promise,
    Map,
    Set,
    Object,
    Array,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Error,
    Date,
    structuredClone,
    crypto: { randomUUID: () => 'context-uuid' }
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'utils/buildStateStore.js'), 'utf8'),
    context,
    { filename: 'utils/buildStateStore.js' }
);

function stableHash(value) {
    function normalize(input) {
        if (input == null || typeof input !== 'object') return input;
        if (Array.isArray(input)) return input.map(normalize);
        return Object.fromEntries(Object.keys(input).sort().map(key => [key, normalize(input[key])]));
    }
    return JSON.stringify(normalize(value));
}

function makeResilience(clock) {
    return async function runResilientTask(options) {
        try {
            return { status: 'SUCCESS', value: await options.run() };
        } catch (error) {
            if (options.mutation && (error.timeout || error.network)) {
                return { status: 'UNCERTAIN', failure: { error }, retryAt: clock.now + 30000 };
            }
            if (error.status === 403 || error.status === 429) return { status: 'HARD_STOP', failure: { error } };
            return { status: 'SOFT_PAUSED', failure: { error }, retryAt: clock.now + 30000 };
        }
    };
}

async function flushMicrotasks(rounds = 8) {
    for (let index = 0; index < rounds; index++) await Promise.resolve();
}

function defaultObservation(clock, server) {
    return {
        official: {
            queue: (server.queue || []).slice(),
            levels: (server.levels || []).slice(),
            slots: (server.slots || []).slice(),
            cancelIds: [],
            nextSlotAt: server.nextSlotAt || null,
            lastSlotAt: null,
            full: !!server.full,
            maxSlots: server.premium ? 5 : 2,
            currentLevels: Object.assign({}, server.currentLevels || {}),
            fetchedAt: clock.now,
            source: 'test-network'
        },
        resources: Object.assign({
            wood: 100000,
            stone: 100000,
            iron: 100000,
            pop: 0,
            popMax: 10000,
            fetchedAt: clock.now,
            source: 'test-network'
        }, server.resources || {})
    };
}

function createSystem(options = {}) {
    const clock = options.clock || new FakeClock();
    const storage = options.storage || createStorage();
    const sharedRecords = options.sharedRecords || {};
    const writes = options.writes || { count: 0 };
    const bus = options.bus || new CoordinationBus(clock);
    const id = options.id || 'tab-a';
    const coordination = bus.coordinator(id);
    const scheduler = new TestScheduler(clock, coordination);
    const queueStorage = createQueueAdapter(sharedRecords, writes);
    const writeBehind = {
        set(key, value) { storage.setItem(key, value); },
        get(key) { return storage.getItem(key); },
        remove(key) { storage.removeItem(key); }
    };
    const store = context.createBuildStateStore({
        host: { crypto: { randomUUID: () => id + '-uuid-' + clock.now } },
        storage,
        queueStorage,
        coordination,
        runtime: null,
        writeBehind,
        clock,
        now: () => clock.now,
        actorId: id,
        scope: 'extra-build-queue-tests',
        hash: stableHash,
        compactDelayMs: 250
    });
    const counters = options.counters || { inspections: 0, mutations: 0 };
    const server = options.server || { queue: [], levels: [], slots: [], full: false, currentLevels: {}, resources: {} };
    const inspect = options.inspect || (async () => {
        counters.inspections++;
        return defaultObservation(clock, server);
    });
    const mutate = options.mutate || (async (_villageId, item) => {
        counters.mutations++;
        return Object.assign({ accepted: true }, defaultObservation(clock, server));
    });
    const controller = context.createBuildQueueController({
        store,
        scheduler,
        now: () => clock.now,
        hash: stableHash,
        inspect,
        mutate,
        getCost: options.getCost || (() => ({ wood: 100, stone: 100, iron: 100, pop: 1 })),
        isEnabled: options.isEnabled,
        runResilientTask: makeResilience(clock),
        editDebounceMs: options.editDebounceMs ?? 350,
        fallbackMs: 300000,
        slotMarginMs: 2000,
        resourceMarginMs: 2000
    });
    store.start();
    store.subscribe((record, change) => {
        if (change?.kind === 'intent' && change.event?.type !== 'CONSUME') controller.invalidateForEdit(record.villageId);
    });
    return { clock, storage, sharedRecords, writes, bus, coordination, scheduler, queueStorage, store, controller, counters, server };
}

async function advance(system, ms) {
    system.clock.tick(ms);
    await flushMicrotasks();
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('1. long queue executes in declared order', async () => {
    const built = [];
    const system = createSystem({
        mutate: async (_villageId, item) => {
            system.counters.mutations++;
            built.push(item.buildingId + ':' + item.targetLevel);
            return Object.assign({ accepted: true }, defaultObservation(system.clock, system.server));
        }
    });
    for (let index = 0; index < 25; index++) system.store.add('1', 'building-' + index, index + 1);
    await advance(system, 350);
    for (let index = 0; index < 25; index++) {
        await system.scheduler.runNext();
        await flushMicrotasks();
        await advance(system, 250);
    }
    assert.equal(system.store.get('1').queue.length, 0);
    assert.deepEqual(built, Array.from({ length: 25 }, (_, index) => 'building-' + index + ':' + (index + 1)));
});

test('2. twenty rapid ADD operations coalesce to one reconciliation', async () => {
    const system = createSystem();
    for (let index = 0; index < 20; index++) system.store.add('1', 'farm', index + 1);
    assert.equal(system.counters.inspections, 0);
    assert.equal(system.scheduler.tasks.size, 1);
    await advance(system, 349);
    assert.equal(system.scheduler.dueCount(), 0);
    await advance(system, 1);
    await system.scheduler.runNext();
    assert.equal(system.counters.inspections, 1);
    assert.equal(system.counters.mutations, 1);
});

test('3. ADD then REMOVE before debounce performs no request', async () => {
    const system = createSystem();
    system.store.add('1', 'farm', 25);
    system.store.removeAt('1', 0);
    await advance(system, 1000);
    assert.equal(system.scheduler.tasks.size, 0);
    assert.deepEqual(system.counters, { inspections: 0, mutations: 0 });
});

test('4. repeated reorder is local and produces one final reconciliation', async () => {
    const system = createSystem();
    ['farm', 'storage', 'barracks', 'stable'].forEach((id, index) => system.store.add('1', id, index + 1));
    for (let index = 0; index < 10; index++) system.store.move('1', index % 2, 3 - (index % 2));
    assert.equal(system.counters.inspections, 0);
    assert.equal(system.scheduler.tasks.size, 1);
    await advance(system, 350);
    await system.scheduler.runNext();
    assert.equal(system.counters.inspections, 1);
});

test('5. callback carrying an old revision is rejected', () => {
    const system = createSystem();
    system.store.add('1', 'farm', 25);
    const captured = system.store.capture('1');
    system.store.add('1', 'storage', 24);
    assert.equal(system.store.isCurrent('1', captured), false);
});

test('6. five refresh bootstraps retain known nextDueAt and issue zero requests', () => {
    const clock = new FakeClock(1000);
    const storage = createStorage();
    const sharedRecords = {};
    const writes = { count: 0 };
    const bus = new CoordinationBus(clock);
    const counters = { inspections: 0, mutations: 0 };
    const first = createSystem({ clock, storage, sharedRecords, writes, bus, id: 'refresh-0', counters });
    first.store.add('1', 'farm', 25);
    first.controller.schedule('1', { dueAt: 20000, state: 'WAITING_SLOT', reason: 'known-slot' });
    for (let index = 1; index <= 5; index++) {
        const refreshed = createSystem({ clock, storage, sharedRecords, writes, bus, id: 'refresh-' + index, counters });
        refreshed.controller.bootstrap(['1']);
        assert.equal(refreshed.scheduler.dueCount(), 0);
    }
    assert.deepEqual(counters, { inspections: 0, mutations: 0 });
});

test('7. three tabs competing execute one inspection and one mutation', async () => {
    const clock = new FakeClock();
    const storage = createStorage();
    const sharedRecords = {};
    const writes = { count: 0 };
    const bus = new CoordinationBus(clock);
    const counters = { inspections: 0, mutations: 0 };
    let releaseInspect;
    const gate = new Promise(resolve => { releaseInspect = resolve; });
    const inspect = async () => {
        counters.inspections++;
        await gate;
        return defaultObservation(clock, {});
    };
    const mutate = async () => {
        counters.mutations++;
        return Object.assign({ accepted: true }, defaultObservation(clock, {}));
    };
    const tabs = ['a', 'b', 'c'].map(id => createSystem({ clock, storage, sharedRecords, writes, bus, id, counters, inspect, mutate }));
    tabs[1].store.add('1', 'farm', 25);
    await advance(tabs[0], 350);
    const runs = tabs.map(tab => tab.scheduler.runNext());
    await flushMicrotasks();
    releaseInspect();
    await Promise.all(runs);
    assert.deepEqual(counters, { inspections: 1, mutations: 1 });
});

test('8. a secondary tab edit propagates the queue and revision', () => {
    const clock = new FakeClock();
    const storage = createStorage();
    const sharedRecords = {};
    const bus = new CoordinationBus(clock);
    const first = createSystem({ clock, storage, sharedRecords, bus, id: 'primary' });
    const second = createSystem({ clock, storage, sharedRecords, bus, id: 'secondary' });
    second.store.add('7', 'stable', 15);
    const fromPrimary = first.store.get('7');
    assert.equal(fromPrimary.queue[0].buildingId, 'stable');
    assert.equal(fromPrimary.revision, 1);

    second.store.updateOfficial('7', {
        queue: ['main25', 'farm25', 'storage24', 'barracks20', 'stable15'],
        levels: [25, 25, 24, 20, 15],
        full: true,
        maxSlots: 5,
        nextSlotAt: 50000,
        fetchedAt: clock.now
    });
    second.store.updateResources('7', {
        wood: 321,
        stone: 654,
        iron: 987,
        pop: 100,
        popMax: 1000,
        fetchedAt: clock.now
    });
    second.store.publishObservation('7');
    const observedByPrimary = first.store.get('7');
    assert.equal(observedByPrimary.official.full, true);
    assert.equal(observedByPrimary.official.maxSlots, 5);
    assert.equal(observedByPrimary.resources.wood, 321);
});

test('9. owner disappearance fails over after lease expiry', async () => {
    const clock = new FakeClock();
    const storage = createStorage();
    const sharedRecords = {};
    const bus = new CoordinationBus(clock);
    const owner = createSystem({ clock, storage, sharedRecords, bus, id: 'owner' });
    const successor = createSystem({ clock, storage, sharedRecords, bus, id: 'successor' });
    successor.store.add('1', 'farm', 25);
    const abandoned = owner.coordination.acquireLease('build-queue:1', 1000);
    assert.ok(abandoned);
    owner.coordination.disappear();
    await advance(successor, 350);
    assert.equal((await successor.scheduler.runNext()).status, 'LEASE_UNAVAILABLE');
    assert.equal(successor.counters.mutations, 0);
    await advance(successor, 1001);
    await successor.scheduler.runNext();
    assert.equal(successor.counters.mutations, 1);
});

test('10. an empty queue has no task, polling, inspection or mutation', () => {
    const system = createSystem();
    system.controller.bootstrap(['1']);
    assert.equal(system.scheduler.tasks.size, 0);
    assert.deepEqual(system.counters, { inspections: 0, mutations: 0 });
    assert.equal(system.clock.timers.size, 0);
});

test('11. a full official queue wakes only at nextSlotAt', async () => {
    const server = { full: true, nextSlotAt: 50000, slots: [50000], queue: ['farm25'], levels: [25] };
    const system = createSystem({ server });
    system.store.add('1', 'storage', 24);
    await advance(system, 350);
    await system.scheduler.runNext();
    const execution = system.store.get('1').execution;
    assert.equal(execution.state, 'WAITING_SLOT');
    assert.equal(execution.nextDueAt, 52000);
    assert.equal(system.counters.mutations, 0);
});

test('12. insufficient resources do not mutate', async () => {
    const server = { resources: { wood: 10, stone: 10, iron: 10 } };
    const system = createSystem({ server, getCost: () => ({ wood: 1000, stone: 1000, iron: 1000, pop: 0 }) });
    system.store.add('1', 'farm', 25);
    await advance(system, 350);
    await system.scheduler.runNext();
    assert.equal(system.counters.mutations, 0);
    assert.equal(system.store.get('1').execution.state, 'WAITING_RESOURCES');

    const unknownPopulation = createSystem({
        inspect: async () => ({
            official: defaultObservation(system.clock, {}).official,
            resources: { wood: 1000, stone: 1000, iron: 1000, fetchedAt: system.clock.now }
        }),
        getCost: () => ({ wood: 100, stone: 100, iron: 100, pop: 1 })
    });
    unknownPopulation.store.add('2', 'farm', 25);
    await advance(unknownPopulation, 350);
    await unknownPopulation.scheduler.runNext();
    assert.equal(unknownPopulation.counters.mutations, 0);
});

test('13. reliable production derives a resource ETA', async () => {
    const server = { resources: { wood: 0, stone: 0, iron: 0, production: { wood: 3600, stone: 3600, iron: 3600 }, reliableUntil: 9999999 } };
    const system = createSystem({ server, getCost: () => ({ wood: 3600, stone: 1800, iron: 900, pop: 0 }) });
    system.store.add('1', 'farm', 25);
    await advance(system, 350);
    await system.scheduler.runNext();
    const dueAt = system.store.get('1').execution.nextDueAt;
    assert.equal(dueAt, system.clock.now + 3600000 + 2000);
});

test('14. missing production data uses the conservative fallback', async () => {
    const server = { resources: { wood: 0, stone: 0, iron: 0 } };
    const system = createSystem({ server, getCost: () => ({ wood: 100, stone: 100, iron: 100, pop: 0 }) });
    system.store.add('1', 'farm', 25);
    await advance(system, 350);
    await system.scheduler.runNext();
    assert.equal(system.store.get('1').execution.nextDueAt, system.clock.now + 300000);

    const bounded = createSystem({
        server: {
            resources: {
                wood: 0,
                stone: 0,
                iron: 0,
                production: { wood: 100, stone: 100, iron: 100 },
                reliableUntil: 2000
            }
        },
        getCost: () => ({ wood: 1000, stone: 1000, iron: 1000, pop: 0 })
    });
    bounded.store.add('2', 'storage', 24);
    await advance(bounded, 350);
    await bounded.scheduler.runNext();
    assert.equal(bounded.store.get('2').execution.nextDueAt, bounded.clock.now + 300000);
});

test('15. mutation timeout becomes UNCERTAIN and reconciles without blind retry', async () => {
    const server = { queue: [], levels: [], currentLevels: {} };
    let mutationAttempts = 0;
    const system = createSystem({
        server,
        mutate: async (_villageId, item) => {
            mutationAttempts++;
            server.queue = [item.buildingId];
            server.levels = [item.targetLevel];
            const error = new Error('timeout');
            error.timeout = true;
            throw error;
        }
    });
    system.store.add('1', 'farm', 25);
    system.store.updateOfficial('1', {
        queue: [], levels: [], full: false, currentLevels: { farm: 25 },
        fetchedAt: system.clock.now, source: 'official-without-offer'
    });
    await advance(system, 350);
    await system.scheduler.runNext();
    assert.equal(system.store.get('1').execution.state, 'UNCERTAIN');
    assert.equal(mutationAttempts, 1);
    await advance(system, 30000);
    await system.scheduler.runNext();
    assert.equal(mutationAttempts, 1);
    assert.equal(system.store.get('1').queue.length, 0);
});

test('16. lease lost during inspection prevents mutation', async () => {
    let system;
    system = createSystem({
        inspect: async () => {
            system.counters.inspections++;
            system.bus.leases.set('build-queue:1', { taskKey: 'build-queue:1', owner: 'other', token: 999, expiresAt: system.clock.now + 30000 });
            return defaultObservation(system.clock, system.server);
        }
    });
    system.store.add('1', 'farm', 25);
    await advance(system, 350);
    const result = await system.scheduler.runNext();
    assert.equal(result.status, 'LEASE_LOST');
    assert.equal(system.counters.mutations, 0);
});

test('17. an item removed during inspection is never built', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const system = createSystem({
        inspect: async () => {
            system.counters.inspections++;
            await gate;
            return defaultObservation(system.clock, system.server);
        }
    });
    system.store.add('1', 'farm', 25);
    await advance(system, 350);
    const running = system.scheduler.runNext();
    await flushMicrotasks();
    system.store.removeAt('1', 0);
    release();
    await running;
    assert.equal(system.counters.mutations, 0);
    assert.equal(system.store.get('1').queue.length, 0);
});

test('18. reorder during inspection never builds the former head', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const built = [];
    const system = createSystem({
        inspect: async () => {
            system.counters.inspections++;
            await gate;
            return defaultObservation(system.clock, system.server);
        },
        mutate: async (_villageId, item) => {
            system.counters.mutations++;
            built.push(item.buildingId);
            return Object.assign({ accepted: true }, defaultObservation(system.clock, system.server));
        }
    });
    system.store.add('1', 'farm', 25);
    system.store.add('1', 'storage', 24);
    await advance(system, 350);
    const running = system.scheduler.runNext();
    await flushMicrotasks();
    system.store.move('1', 1, 0);
    release();
    await running;
    assert.deepEqual(built, []);
    assert.equal(system.store.get('1').queue[0].buildingId, 'storage');
});

test('19. Premium active keeps five official build slots', () => {
    const source = fs.readFileSync(path.join(ROOT, 'widgets/extraBuildQueue.js'), 'utf8');
    const match = source.match(/function getMaxBuildQueueSize\(\)\s*\{[\s\S]*?\n\}/);
    assert.ok(match);
    const premiumContext = { game_data: { features: { Premium: { active: true } } } };
    vm.createContext(premiumContext);
    vm.runInContext(match[0], premiumContext);
    assert.equal(premiumContext.getMaxBuildQueueSize(), 5);
});

test('20. legacy persisted queue is migrated without deletion', () => {
    const sharedRecords = {
        42: {
            building_queue: ['farm', 'storage', 'barracks'],
            building_queue_levels: [25, 24, 20]
        }
    };
    const system = createSystem({ sharedRecords });
    const record = system.store.get('42');
    assert.deepEqual(record.queue.map(item => item.buildingId), ['farm', 'storage', 'barracks']);
    assert.deepEqual(system.queueStorage.get('building_queue', '42'), ['farm', 'storage', 'barracks']);

    system.store.add('42', 'farm', 26);
    system.store.removeAt('42', 0);
    assert.equal(system.store.get('42').queue.find(item => item.buildingId === 'farm').targetLevel, 25);
});

test('request metrics: 10 ADD, 10 MOVE, 5 refreshes and 3 tabs stay coalesced', async () => {
    const addSystem = createSystem();
    for (let index = 0; index < 10; index++) addSystem.store.add('1', 'farm', index + 1);
    await advance(addSystem, 350);
    await addSystem.scheduler.runNext();
    assert.deepEqual(addSystem.counters, { inspections: 1, mutations: 1 });

    const moveSystem = createSystem();
    ['a', 'b', 'c'].forEach((id, index) => moveSystem.store.add('2', id, index + 1));
    for (let index = 0; index < 10; index++) moveSystem.store.move('2', index % 2, 2 - (index % 2));
    await advance(moveSystem, 350);
    await moveSystem.scheduler.runNext();
    assert.deepEqual(moveSystem.counters, { inspections: 1, mutations: 1 });
});

test('tail edit burst preserves the executable decision and performs zero network', async () => {
    const system = createSystem();
    system.store.add('1', 'farm', 25);
    for (let index = 1; index < 20; index++) system.store.add('1', 'tail-' + index, index);
    system.store.updateOfficial('1', {
        queue: [], levels: [], full: false, nextSlotAt: null,
        currentLevels: { farm: 24 }, fetchedAt: system.clock.now, source: 'test'
    });
    system.store.updateResources('1', {
        wood: 1, stone: 1, iron: 1, pop: 0, popMax: 100,
        fetchedAt: system.clock.now, source: 'test'
    });
    system.controller.schedule('1', { dueAt: 20000, state: 'WAITING_RESOURCES', reason: 'known-eta' });
    const before = system.store.get('1');
    const preservedHash = before.execution.decisionHash;
    const preservedDueAt = before.execution.nextDueAt;
    const tailIds = before.queue.slice(-10).map(item => item.id);
    tailIds.forEach(itemId => system.store.removeItem('1', itemId));
    for (let index = 0; index < 10; index++) system.store.add('1', 'new-tail-' + index, index + 1);
    await advance(system, 5000);
    const after = system.store.get('1');
    assert.equal(after.queue[0].id, before.queue[0].id);
    assert.equal(after.execution.state, 'WAITING_RESOURCES');
    assert.equal(after.execution.decisionHash, preservedHash);
    assert.equal(after.execution.nextDueAt, preservedDueAt);
    assert.deepEqual(system.counters, { inspections: 0, mutations: 0 });
    assert.equal(system.scheduler.tasks.get('build-queue:reconcile:1').dueAt, preservedDueAt);
});

test('multi-second queue editing extends one quiet scope without intermediate reconciliation', async () => {
    const system = createSystem({ editDebounceMs: 800 });
    system.store.add('1', 'farm', 25);
    for (let index = 0; index < 8; index++) system.store.add('1', 'tail-' + index, index + 1);
    system.store.updateOfficial('1', {
        queue: [], levels: [], full: false, nextSlotAt: null,
        currentLevels: { farm: 24 }, fetchedAt: system.clock.now, source: 'test'
    });
    system.store.updateResources('1', {
        wood: 1, stone: 1, iron: 1, pop: 0, popMax: 100,
        fetchedAt: system.clock.now, source: 'test'
    });
    system.controller.schedule('1', { dueAt: 20000, state: 'WAITING_RESOURCES', reason: 'known-eta' });
    const headId = system.store.get('1').queue[0].id;
    for (let index = 0; index < 6; index++) {
        const queue = system.store.get('1').queue;
        const item = queue[queue.length - 1];
        system.store.moveItem('1', item.id, { beforeItemId: queue[1].id });
        await advance(system, 500);
        assert.deepEqual(system.counters, { inspections: 0, mutations: 0 });
    }
    await advance(system, 800);
    const after = system.store.get('1');
    assert.equal(after.queue[0].id, headId);
    assert.equal(after.execution.state, 'WAITING_RESOURCES');
    assert.equal(after.execution.nextDueAt, 20000);
    assert.deepEqual(system.counters, { inspections: 0, mutations: 0 });
});

test('stable-id MOVE and stale-view REMOVE remain local and preserve exact order', async () => {
    const system = createSystem();
    ['A', 'B', 'C', 'D'].forEach((buildingId, index) => system.store.add('9', buildingId, index + 1));
    const original = system.store.get('9').queue;
    system.store.moveItem('9', original[3].id, { beforeItemId: original[1].id });
    assert.deepEqual(system.store.get('9').queue.map(item => item.buildingId), ['A', 'D', 'B', 'C']);
    system.store.removeItem('9', original[1].id); // another tab removed B
    system.store.removeItem('9', original[2].id); // stale DOM still identifies C by id
    assert.deepEqual(system.store.get('9').queue.map(item => item.buildingId), ['A', 'D']);
    assert.deepEqual(system.counters, { inspections: 0, mutations: 0 });
    await system.store.compact('9');
    const restored = createSystem({
        clock: system.clock, storage: system.storage, sharedRecords: system.sharedRecords,
        writes: system.writes, bus: system.bus, id: 'restored'
    });
    assert.deepEqual(restored.store.get('9').queue.map(item => item.buildingId), ['A', 'D']);
});

test('countdown due dispatches one mutation without reload and rearms the next occurrence', async () => {
    const system = createSystem();
    ['farm', 'storage', 'barracks'].forEach((buildingId, index) => system.store.add('1', buildingId, index + 1));
    system.controller.schedule('1', { dueAt: 5000, state: 'WAITING_RESOURCES', reason: 'countdown' });
    await advance(system, 4999);
    assert.equal(system.counters.mutations, 0);
    await advance(system, 1);
    await system.scheduler.runNext();
    assert.equal(system.counters.mutations, 1);
    assert.equal(system.store.get('1').queue.length, 2);
    assert.ok(system.scheduler.tasks.has('build-queue:reconcile:1'));
});

test('population shortage is distinct and always has a future wake', async () => {
    const system = createSystem({
        getCost: () => ({
            effectiveLevel: 25,
            cost: { wood: 100, stone: 100, iron: 100, pop: 20 },
            source: 'SERVER_OBSERVATION', authoritative: true
        }),
        server: { queue: [], full: false, resources: { wood: 1000, stone: 1000, iron: 1000, pop: 95, popMax: 100 } }
    });
    system.store.add('1', 'farm', 26);
    await advance(system, 350);
    await system.scheduler.runNext();
    const execution = system.store.get('1').execution;
    assert.equal(execution.state, 'WAITING_POPULATION');
    assert.equal(execution.reason, 'insufficient-population');
    assert.ok(execution.nextDueAt > system.clock.now);
    assert.equal(system.counters.mutations, 0);
});

test('transient worker exception cannot leave RECONCILING without a retry wake', async () => {
    const system = createSystem({
        inspect: async () => {
            system.counters.inspections++;
            throw new TypeError('network unavailable');
        }
    });
    system.store.add('1', 'farm', 25);
    await advance(system, 350);
    await system.scheduler.runNext();
    const execution = system.store.get('1').execution;
    assert.equal(execution.state, 'SOFT_PAUSED');
    assert.ok(execution.nextDueAt > system.clock.now);
    assert.ok(system.scheduler.tasks.has('build-queue:reconcile:1'));
    assert.equal(system.counters.mutations, 0);
});

test('official next offer rebases stale target metadata without changing intent identity', () => {
    const system = createSystem();
    system.store.add('1', 'farm', 26);
    system.store.add('1', 'farm', 27);
    const before = system.store.get('1');
    const ids = before.queue.map(item => item.id);
    system.store.updateOfficial('1', {
        queue: [], levels: [], full: false, currentLevels: { farm: 24 },
        nextBuildOffers: {
            farm: { level: 25, wood: 800, stone: 900, iron: 700, pop: 5, observedAt: system.clock.now, source: 'SERVER_OBSERVATION' }
        },
        fetchedAt: system.clock.now, source: 'test-server'
    });
    const after = system.store.get('1');
    assert.equal(after.revision, before.revision);
    assert.ok(after.executionGeneration > before.executionGeneration);
    assert.deepEqual(after.queue.map(item => item.id), ids);
    assert.deepEqual(after.queue.map(item => item.targetLevel), [25, 26]);
    assert.deepEqual(system.counters, { inspections: 0, mutations: 0 });
});

test('known building completion advances an older resource ETA without polling', async () => {
    const system = createSystem({
        server: {
            queue: ['wood'], levels: [20], slots: [61000], nextSlotAt: 61000, full: false,
            resources: {
                wood: 0, stone: 0, iron: 0, pop: 0, popMax: 100,
                production: { wood: 100, stone: 100, iron: 100 }, reliableUntil: 3600000
            }
        },
        getCost: () => ({ wood: 1000, stone: 1000, iron: 1000, pop: 1 })
    });
    system.store.add('1', 'farm', 25);
    await advance(system, 350);
    await system.scheduler.runNext();
    const execution = system.store.get('1').execution;
    assert.equal(execution.state, 'WAITING_RESOURCES');
    assert.equal(execution.nextDueAt, 63000);
    assert.match(execution.reason, /known-production-change/);
    assert.deepEqual(system.counters, { inspections: 1, mutations: 0 });
});

test('twenty tail MOVE operations preserve a waiting decision and generate zero network', async () => {
    const system = createSystem();
    system.store.add('1', 'farm', 25);
    for (let index = 0; index < 20; index++) system.store.add('1', 'tail-' + index, index + 1);
    system.store.updateOfficial('1', {
        queue: [], levels: [], full: false, currentLevels: { farm: 24 },
        fetchedAt: system.clock.now, source: 'test'
    });
    system.store.updateResources('1', {
        wood: 0, stone: 0, iron: 0, pop: 0, popMax: 100,
        fetchedAt: system.clock.now, source: 'test'
    });
    system.controller.schedule('1', { dueAt: 50000, state: 'WAITING_RESOURCES', reason: 'known-eta' });
    const before = system.store.get('1');
    const headId = before.queue[0].id;
    for (let index = 0; index < 20; index++) {
        const queue = system.store.get('1').queue;
        const item = queue[1 + (index % (queue.length - 1))];
        const anchor = queue[1 + ((index + 7) % (queue.length - 1))];
        if (item.id !== anchor.id) system.store.moveItem('1', item.id, { beforeItemId: anchor.id });
    }
    await advance(system, 5000);
    const after = system.store.get('1');
    assert.equal(after.queue[0].id, headId);
    assert.equal(after.execution.state, 'WAITING_RESOURCES');
    assert.equal(after.execution.nextDueAt, 50000);
    assert.deepEqual(system.counters, { inspections: 0, mutations: 0 });
});

test('official offer rebase moves up, moves down, and skips an already matching target', () => {
    const system = createSystem();
    system.store.add('1', 'barracks', 19);
    system.store.add('1', 'barracks', 20);
    const initial = system.store.get('1');
    system.store.updateOfficial('1', {
        nextBuildOffers: {
            barracks: { level: 18, wood: 1, stone: 1, iron: 1, observedAt: system.clock.now }
        }, fetchedAt: system.clock.now
    });
    const lowered = system.store.get('1');
    assert.deepEqual(lowered.queue.map(item => item.targetLevel), [18, 19]);
    assert.equal(lowered.revision, initial.revision);
    const generationAfterLower = lowered.executionGeneration;
    system.store.updateOfficial('1', {
        nextBuildOffers: {
            barracks: { level: 18, wood: 1, stone: 1, iron: 1, observedAt: system.clock.now }
        }, fetchedAt: system.clock.now
    });
    assert.equal(system.store.get('1').executionGeneration, generationAfterLower);
    system.store.updateOfficial('1', {
        nextBuildOffers: {
            barracks: { level: 20, wood: 2, stone: 2, iron: 2, observedAt: system.clock.now }
        }, fetchedAt: system.clock.now
    });
    assert.deepEqual(system.store.get('1').queue.map(item => item.targetLevel), [20, 21]);
    assert.deepEqual(system.counters, { inspections: 0, mutations: 0 });
});

test('Build Queue diagnostics explain scheduler, lease, cost, resources and interaction state locally', () => {
    const system = createSystem();
    system.store.add('1', 'farm', 25);
    system.controller.schedule('1', { dueAt: 10000, state: 'WAITING_RESOURCES', reason: 'diagnostic-test' });
    const details = system.controller.diagnostics('1');
    assert.equal(details.villageId, '1');
    assert.equal(details.itemId, system.store.get('1').queue[0].id);
    assert.equal(details.executionState, 'WAITING_RESOURCES');
    assert.equal(details.nextDueAt, 10000);
    assert.equal(details.schedulerTaskPresent, true);
    assert.equal(details.interactionState, 'INACTIVE');
});

test('missing authoritative offer performs one necessary inspection and never a blind mutation', async () => {
    const system = createSystem({
        getCost: (_villageId, head) => ({
            effectiveLevel: head.targetLevel,
            cost: { wood: 1, stone: 1, iron: 1, pop: 0 },
            source: 'LOCAL_TARGET_CACHE', authoritative: false
        })
    });
    system.store.add('1', 'farm', 25);
    await advance(system, 350);
    await system.scheduler.runNext();
    const execution = system.store.get('1').execution;
    assert.equal(execution.state, 'SOFT_PAUSED');
    assert.ok(execution.nextDueAt > system.clock.now);
    assert.deepEqual(system.counters, { inspections: 1, mutations: 0 });
    assert.equal(system.store.get('1').queue.length, 1, 'stale target metadata cannot consume the intent');
});

test('early resource event reads one official offer and rejects a higher server cost', async () => {
    const server = {
        queue: [], full: false,
        resources: { wood: 1000, stone: 1000, iron: 1000, pop: 0, popMax: 100 },
        nextBuildOffers: { farm: { level: 25, wood: 1200, stone: 1200, iron: 1200, pop: 1 } }
    };
    const system = createSystem({
        server,
        inspect: async () => {
            system.counters.inspections++;
            const observation = defaultObservation(system.clock, server);
            observation.official.nextBuildOffers = server.nextBuildOffers;
            return observation;
        },
        getCost: (_villageId, _head, record) => {
            const offer = record.official?.nextBuildOffers?.farm;
            return offer
                ? { effectiveLevel: offer.level, cost: offer, source: 'SERVER_OBSERVATION', authoritative: true }
                : { effectiveLevel: 25, cost: { wood: 800, stone: 800, iron: 800, pop: 1 },
                    source: 'DERIVED_OFFICIAL_LEVEL_CACHE_COST', authoritative: false };
        }
    });
    system.store.add('1', 'farm', 25);
    system.controller.schedule('1', {
        delayMs: 0, forceFresh: true, reason: 'cached-cost-possibly-affordable'
    });
    await system.scheduler.runNext();
    assert.deepEqual(system.counters, { inspections: 1, mutations: 0 });
    assert.equal(system.store.get('1').execution.state, 'WAITING_RESOURCES');
    assert.ok(system.store.get('1').execution.nextDueAt > system.clock.now);
});

test('early resource event builds once only after the fresh official cost confirms affordability', async () => {
    const server = {
        queue: [], full: false,
        resources: { wood: 1000, stone: 1000, iron: 1000, pop: 0, popMax: 100 },
        nextBuildOffers: { farm: { level: 25, wood: 900, stone: 900, iron: 900, pop: 1 } }
    };
    const system = createSystem({
        server,
        inspect: async () => {
            system.counters.inspections++;
            const observation = defaultObservation(system.clock, server);
            observation.official.nextBuildOffers = server.nextBuildOffers;
            return observation;
        },
        getCost: (_villageId, _head, record) => {
            const offer = record.official?.nextBuildOffers?.farm;
            return offer
                ? { effectiveLevel: offer.level, cost: offer, source: 'SERVER_OBSERVATION', authoritative: true }
                : { effectiveLevel: 25, cost: { wood: 800, stone: 800, iron: 800, pop: 1 },
                    source: 'DERIVED_OFFICIAL_LEVEL_CACHE_COST', authoritative: false };
        }
    });
    system.store.add('1', 'farm', 25);
    system.controller.schedule('1', {
        delayMs: 0, forceFresh: true, reason: 'cached-cost-possibly-affordable'
    });
    await system.scheduler.runNext();
    assert.deepEqual(system.counters, { inspections: 1, mutations: 1 });
    assert.equal(system.store.get('1').queue.length, 0);
});

test('disabled Building Queue preserves intent but restores no background task or network work', () => {
    const system = createSystem({ isEnabled: () => false });
    system.store.add('1', 'farm', 25);
    system.controller.bootstrap(['1']);
    assert.equal(system.store.get('1').queue.length, 1);
    assert.equal(system.store.get('1').execution.reason, 'disabled');
    assert.equal(system.scheduler.tasks.size, 0);
    assert.deepEqual(system.counters, { inspections: 0, mutations: 0 });
});

(async () => {
    let passed = 0;
    const pattern = process.env.TEST_PATTERN || '';
    const selectedTests = pattern ? tests.filter(item => item.name.includes(pattern)) : tests;
    for (const { name, fn } of selectedTests) {
        try {
            await fn();
            passed++;
            console.log('ok ' + passed + ' - ' + name);
        } catch (error) {
            console.error('not ok - ' + name);
            throw error;
        }
    }
    console.log('\n' + passed + ' extra build queue tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
