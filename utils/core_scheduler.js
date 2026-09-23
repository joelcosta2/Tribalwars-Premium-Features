// Persistent generation-fenced timeouts plus a low-concurrency cooperative task scheduler.

var activeTimeouts = {};
var activeTimeoutGenerations = {};
var timeoutHandlers = {};

const BACKGROUND_TASK_PRIORITY = Object.freeze({
    MANUAL: 1,
    RECONCILIATION: 2,
    AUTOMATIC: 3,
    REFRESH: 4,
    HOUSEKEEPING: 5
});

const BACKGROUND_TASK_DUE_MODE = Object.freeze({
    REPLACE: 'REPLACE',
    EARLIEST: 'EARLIEST',
    LATEST: 'LATEST',
    KEEP: 'KEEP'
});

function deterministicSpread(key, minimumMs, maximumMs) {
    const low = Math.max(0, Math.floor(Number(minimumMs) || 0));
    const high = Math.max(low, Math.floor(Number(maximumMs) || low));
    if (low === high) return low;
    const text = String(key);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return low + (hash >>> 0) % (high - low + 1);
}

function createCooperativeScheduler(options = {}) {
    const host = options.host || window;
    const clock = options.clock || host;
    const now = options.now || (() => Date.now());
    const runtime = options.runtime || null;
    const coordinator = options.coordinator || null;
    const concurrency = Math.max(1, Number(options.concurrency) || 1);
    const turnGapMs = Math.max(0, Number(options.turnGapMs) || 250);
    const interactionDeferMs = Math.max(50, Number(options.interactionDeferMs) || 500);
    const hardStopStorageKey = options.hardStopStorageKey || 'twpf_scheduler_hard_stop_v1';
    const tasks = new Map();
    const activeTasks = new Map();
    const persistentHandlers = new Map();
    const taskPauses = new Map();
    let sequence = 0;
    let running = 0;
    let wakeTimer = null;
    let wakeAt = null;
    let nextEligibleAt = 0;
    let paused = false;
    let hardStopped = false;
    let hardStopReason = null;
    let started = false;

    function record(status, details = {}) {
        host.PremiumFeaturesDiagnostics?.record?.(Object.assign({
            feature: 'scheduler',
            status,
            timestamp: now()
        }, details));
    }

    function normalizeDueAt(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : now();
    }

    function mergeDueAt(previous, requested, mode) {
        const next = normalizeDueAt(requested);
        switch (mode) {
            case BACKGROUND_TASK_DUE_MODE.REPLACE: return next;
            case BACKGROUND_TASK_DUE_MODE.LATEST: return Math.max(previous, next);
            case BACKGROUND_TASK_DUE_MODE.KEEP: return previous;
            case BACKGROUND_TASK_DUE_MODE.EARLIEST:
            default: return Math.min(previous, next);
        }
    }

    function loadPersistedHardStop() {
        try {
            const raw = host.localStorage?.getItem(hardStopStorageKey);
            if (!raw) return;
            const persisted = JSON.parse(raw);
            hardStopped = true;
            paused = true;
            hardStopReason = persisted?.reason || 'persisted-hard-stop';
        } catch (error) {
            console.warn('[TW Scheduler] Invalid persisted hard-stop', error);
        }
    }

    function persistentStorageKey(key) {
        return 'twpf_background_task_v1:' + String(key);
    }

    function persistDescriptor(task) {
        if (!task.persist || !task.handlerName) return;
        const record = {
            key: task.key,
            handlerName: task.handlerName,
            args: task.args || [],
            priority: task.priority,
            dueAt: task.dueAt,
            leaseKey: task.leaseKey,
            requiresCoordinator: task.requiresCoordinator,
            interactionScope: task.interactionScope,
            generation: task.generation,
            dueMode: BACKGROUND_TASK_DUE_MODE.REPLACE
        };
        const writer = host.PremiumFeaturesWriteBehind;
        if (writer) writer.set(persistentStorageKey(task.key), JSON.stringify(record));
        else host.localStorage?.setItem(persistentStorageKey(task.key), JSON.stringify(record));
    }

    function removePersistedDescriptor(key) {
        const writer = host.PremiumFeaturesWriteBehind;
        if (writer) writer.remove(persistentStorageKey(key));
        else host.localStorage?.removeItem(persistentStorageKey(key));
    }

    function createTask(descriptor) {
        let resolvePromise;
        const promise = new Promise(resolve => { resolvePromise = resolve; });
        const handlerName = descriptor.handlerName;
        const handler = handlerName ? persistentHandlers.get(handlerName) : null;
        return {
            key: String(descriptor.key),
            run: descriptor.run || (handler ? guard => handler(descriptor.args || [], guard) : null),
            handlerName,
            args: descriptor.args || [],
            priority: Math.min(5, Math.max(1, Number(descriptor.priority) || BACKGROUND_TASK_PRIORITY.REFRESH)),
            dueAt: normalizeDueAt(descriptor.dueAt),
            dueMode: descriptor.dueMode || BACKGROUND_TASK_DUE_MODE.EARLIEST,
            leaseKey: descriptor.leaseKey || null,
            leaseTtlMs: Number(descriptor.leaseTtlMs) || 30000,
            requiresCoordinator: !!descriptor.requiresCoordinator,
            interactionScope: descriptor.interactionScope || null,
            snapshotHash: descriptor.snapshotHash || null,
            persist: !!descriptor.persist,
            generation: Number(descriptor.generation) || 1,
            sequence: sequence++,
            blockingReason: descriptor.blockingReason || null,
            promise,
            resolve: resolvePromise
        };
    }

    function enqueue(descriptor) {
        if (!descriptor || !descriptor.key) throw new Error('Background task requires a key');
        const key = String(descriptor.key);
        const active = activeTasks.get(key);
        if (active && !descriptor.rerunWhileActive) return active.promise;
        const existing = tasks.get(key);
        if (existing) {
            const previousDueAt = existing.dueAt;
            const dueMode = descriptor.dueMode || BACKGROUND_TASK_DUE_MODE.EARLIEST;
            existing.run = descriptor.run || existing.run;
            existing.handlerName = descriptor.handlerName || existing.handlerName;
            existing.args = descriptor.args || existing.args;
            existing.priority = Math.min(existing.priority, Number(descriptor.priority) || existing.priority);
            existing.dueAt = mergeDueAt(existing.dueAt, descriptor.dueAt, dueMode);
            existing.dueMode = dueMode;
            existing.leaseKey = descriptor.leaseKey || existing.leaseKey;
            existing.requiresCoordinator = descriptor.requiresCoordinator ?? existing.requiresCoordinator;
            existing.interactionScope = descriptor.interactionScope || existing.interactionScope;
            existing.snapshotHash = descriptor.snapshotHash || existing.snapshotHash;
            existing.persist = descriptor.persist ?? existing.persist;
            existing.generation = Math.max(existing.generation + 1, Number(descriptor.generation) || 0);
            existing.blockingReason = null;
            if (!existing.run && existing.handlerName && persistentHandlers.has(existing.handlerName)) {
                existing.run = guard => persistentHandlers.get(existing.handlerName)(existing.args || [], guard);
            }
            persistDescriptor(existing);
            record(previousDueAt === existing.dueAt ? 'TASK_ENQUEUE' : 'TASK_REPLACE_DUE', {
                taskKey: key,
                dueAt: existing.dueAt,
                previousDueAt,
                dueMode
            });
            scheduleWake();
            return existing.promise;
        }
        const task = createTask(descriptor);
        if (typeof task.run !== 'function') {
            task.resolve({ status: 'MISSING_HANDLER', key });
            return task.promise;
        }
        tasks.set(key, task);
        persistDescriptor(task);
        record('TASK_ENQUEUE', { taskKey: key, dueAt: task.dueAt, dueMode: task.dueMode, priority: task.priority });
        scheduleWake();
        return task.promise;
    }

    function cancel(key, reason = 'cancelled') {
        const task = tasks.get(String(key));
        if (!task) return false;
        tasks.delete(String(key));
        removePersistedDescriptor(String(key));
        task.resolve({ status: 'CANCELLED', reason, key: String(key) });
        record('TASK_CANCEL', { taskKey: String(key), reason });
        scheduleWake();
        return true;
    }

    function sortedEligibleTasks(timestamp) {
        return Array.from(tasks.values())
            .filter(task => task.dueAt <= timestamp && (taskPauses.get(task.key) || 0) <= timestamp)
            .sort((first, second) => first.priority - second.priority || first.dueAt - second.dueAt ||
                first.sequence - second.sequence || first.key.localeCompare(second.key));
    }

    function clearWake() {
        if (wakeTimer === null) return;
        clock.clearTimeout(wakeTimer);
        wakeTimer = null;
        wakeAt = null;
    }

    function scheduleWake() {
        clearWake();
        if (paused || hardStopped || running >= concurrency || tasks.size === 0) return;
        const timestamp = now();
        const earliestDue = Math.min(...Array.from(tasks.values()).map(task => Math.max(
            task.dueAt,
            taskPauses.get(task.key) || 0,
            nextEligibleAt
        )));
        wakeAt = earliestDue;
        record('TASK_WAKE_ARMED', { dueAt: earliestDue, queued: tasks.size });
        wakeTimer = clock.setTimeout(function () {
            wakeTimer = null;
            wakeAt = null;
            record('TASK_WAKE_FIRED', { dueAt: earliestDue });
            pump();
        }, Math.max(0, earliestDue - timestamp));
    }

    function rescheduleAfterLeaseContention(task, error) {
        const leaseExpiry = Number(error?.currentLease?.expiresAt) || now();
        task.dueAt = Math.max(now() + turnGapMs, leaseExpiry + deterministicSpread(task.key, 25, 250));
        task.blockingReason = 'lease';
        tasks.set(task.key, task);
        persistDescriptor(task);
        record('TASK_DEFER_LEASE', { taskKey: task.key, dueAt: task.dueAt, leaseExpiry });
    }

    async function execute(task) {
        tasks.delete(task.key);
        activeTasks.set(task.key, task);
        task.blockingReason = null;
        record('TASK_DISPATCH', { taskKey: task.key, dueAt: task.dueAt, priority: task.priority });
        const capturedGeneration = task.generation;
        try {
            let value;
            const invoke = async function (guard) {
                if (task.generation !== capturedGeneration) {
                    window.PremiumFeaturesDiagnostics?.record?.({ taskKey: task.key, status: 'SKIPPED', reason: 'stale-generation' });
                    return { status: 'STALE_GENERATION' };
                }
                guard?.assertActive?.();
                return task.run(guard || { assertActive: function () { return true; }, isActive: function () { return true; } });
            };
            if (task.requiresCoordinator && coordinator && !coordinator.isCoordinator()) {
                const error = new Error('Coordinator unavailable');
                error.code = 'LEASE_UNAVAILABLE';
                error.currentLease = coordinator.readLease('coordinator');
                throw error;
            }
            if (task.leaseKey && coordinator) value = await coordinator.runWithLease(task.leaseKey, invoke, { ttlMs: task.leaseTtlMs });
            else value = await invoke(null);

            activeTasks.delete(task.key);
            if (tasks.has(task.key)) persistDescriptor(tasks.get(task.key));
            else removePersistedDescriptor(task.key);
            task.resolve({ status: 'COMPLETED', key: task.key, value });
            record('TASK_COMPLETE', { taskKey: task.key });
        } catch (error) {
            if (error?.code === 'LEASE_UNAVAILABLE' || error?.code === 'LEASE_LOST') {
                activeTasks.delete(task.key);
                if (tasks.has(task.key) && tasks.get(task.key) !== task) {
                    persistDescriptor(tasks.get(task.key));
                    task.resolve({ status: 'SUPERSEDED', key: task.key });
                } else {
                    rescheduleAfterLeaseContention(task, error);
                }
            } else {
                activeTasks.delete(task.key);
                if (tasks.has(task.key)) persistDescriptor(tasks.get(task.key));
                else removePersistedDescriptor(task.key);
                task.resolve({ status: 'FAILED', key: task.key, error });
                record('TASK_ERROR', { taskKey: task.key, reason: error?.message || String(error) });
                console.error('[TW Scheduler] Task failed:', task.key, error);
            }
        } finally {
            running--;
            nextEligibleAt = Math.max(nextEligibleAt, now() + turnGapMs);
            scheduleWake();
        }
    }

    function pump() {
        if (paused || hardStopped) return;
        const timestamp = now();
        if (timestamp < nextEligibleAt) {
            scheduleWake();
            return;
        }
        while (running < concurrency) {
            const candidates = sortedEligibleTasks(timestamp);
            if (!candidates.length) break;
            let task = candidates[0];
            if (task.interactionScope && runtime?.isInteractionActive?.(task.interactionScope)) {
                task.dueAt = timestamp + interactionDeferMs;
                task.blockingReason = 'interaction';
                persistDescriptor(task);
                record('TASK_DEFER_INTERACTION', { taskKey: task.key, dueAt: task.dueAt, interactionScope: task.interactionScope });
                const alternative = candidates.find(candidate => candidate !== task &&
                    (!candidate.interactionScope || !runtime?.isInteractionActive?.(candidate.interactionScope)));
                if (!alternative) break;
                task = alternative;
            }
            running++;
            execute(task);
            if (turnGapMs > 0) break;
        }
        scheduleWake();
    }

    function pause() {
        paused = true;
        clearWake();
    }

    function resume(reason = 'resume') {
        if (hardStopped) return;
        paused = false;
        const overdue = Array.from(tasks.values()).filter(task => task.dueAt <= now()).length;
        if (overdue) record('TASK_OVERDUE_RESUME', { reason, overdue });
        scheduleWake();
    }

    function pauseTask(key, untilMs) {
        taskPauses.set(String(key), Math.max(now(), Number(untilMs) || now()));
        scheduleWake();
    }

    function hardStop(reason) {
        hardStopped = true;
        paused = true;
        hardStopReason = reason || 'hard-stop';
        try {
            host.localStorage?.setItem(hardStopStorageKey, JSON.stringify({ reason: hardStopReason, stoppedAt: now() }));
        } catch (error) {
            console.warn('[TW Scheduler] Failed to persist hard-stop', error);
        }
        clearWake();
        host.refreshHardStopRecoveryControl?.();
        return reason;
    }

    function clearHardStop() {
        try {
            host.localStorage?.removeItem(hardStopStorageKey);
        } catch (error) {
            console.warn('[TW Scheduler] Failed to clear persisted hard-stop', error);
            return false;
        }
        hardStopped = false;
        paused = false;
        hardStopReason = null;
        scheduleWake();
        host.refreshHardStopRecoveryControl?.();
        return true;
    }

    function registerHandler(name, handler) {
        persistentHandlers.set(String(name), handler);
        if (started) restorePersistedTasks();
    }

    function restorePersistedTasks() {
        if (!host.localStorage) return;
        Object.keys(host.localStorage).filter(key => key.startsWith('twpf_background_task_v1:')).forEach(storageKey => {
            try {
                const record = JSON.parse(host.localStorage.getItem(storageKey));
                if (!record?.key || !persistentHandlers.has(record.handlerName)) return;
                enqueue(Object.assign({}, record, {
                    persist: true,
                    run: guard => persistentHandlers.get(record.handlerName)(record.args || [], guard)
                }));
            } catch (error) {
                console.warn('[TW Scheduler] Invalid persisted task:', storageKey, error);
            }
        });
    }

    function start() {
        if (started) return;
        started = true;
        loadPersistedHardStop();
        if (runtime) {
            runtime.addEventListener('scheduler:visibility', host.document, 'visibilitychange', function () {
                // Hidden documents may still execute JavaScript. Visibility is only a useful
                // resume signal; background automation must not be globally paused here.
                if (!host.document.hidden) resume('visibility');
            });
            runtime.addEventListener('scheduler:pageshow', host, 'pageshow', function () { resume('pageshow'); });
            runtime.addEventListener('scheduler:online', host, 'online', function () { resume('online'); });
            runtime.onInteractionChange?.(function (scope, active) {
                if (active) return;
                let changed = false;
                tasks.forEach(function (task) {
                    if (task.interactionScope !== scope || task.blockingReason !== 'interaction') return;
                    task.dueAt = Math.min(task.dueAt, now());
                    task.blockingReason = null;
                    persistDescriptor(task);
                    record('TASK_REARM', { taskKey: task.key, reason: 'interaction-ended', dueAt: task.dueAt });
                    changed = true;
                });
                if (changed) scheduleWake();
            });
        }
        restorePersistedTasks();
        scheduleWake();
    }

    function describe(key) {
        const stringKey = String(key);
        const active = activeTasks.get(stringKey);
        if (active) return { taskKey: stringKey, state: hardStopped ? 'HARD_STOP' : 'RUNNING', running: true, dueAt: active.dueAt, hardStopped, hardStopReason };
        const task = tasks.get(stringKey);
        if (!task) return { taskKey: stringKey, state: hardStopped ? 'HARD_STOP' : 'MISSING', hardStopped, hardStopReason };
        const timestamp = now();
        let state = task.blockingReason === 'lease' ? 'WAITING_LEASE' :
            task.blockingReason === 'interaction' ? 'DEFERRED' :
                task.dueAt <= timestamp ? 'OVERDUE' : 'QUEUED';
        if (hardStopped) state = 'HARD_STOP';
        return {
            taskKey: stringKey,
            state,
            dueAt: task.dueAt,
            overdueByMs: Math.max(0, timestamp - task.dueAt),
            blockingReason: task.blockingReason,
            wakeArmed: wakeTimer !== null,
            wakeAt,
            hardStopped,
            hardStopReason
        };
    }

    function hasTask(key) {
        const stringKey = String(key);
        return tasks.has(stringKey) || activeTasks.has(stringKey);
    }

    function hasPendingHigherPriority(priorityValue) {
        const threshold = Number(priorityValue) || BACKGROUND_TASK_PRIORITY.HOUSEKEEPING;
        return Array.from(tasks.values()).some(task => task.priority < threshold && task.dueAt <= now()) ||
            Array.from(activeTasks.values()).some(task => task.priority < threshold);
    }

    function stats() {
        return { started, queued: tasks.size, running, paused, hardStopped, hardStopReason, wakeTimerActive: wakeTimer !== null, wakeAt };
    }

    const api = {
        PRIORITY: BACKGROUND_TASK_PRIORITY,
        DUE_MODE: BACKGROUND_TASK_DUE_MODE,
        enqueue,
        cancel,
        pump,
        pause,
        resume,
        pauseTask,
        hardStop,
        clearHardStop,
        registerHandler,
        restorePersistedTasks,
        start,
        describe,
        hasTask,
        hasPendingHigherPriority,
        stats
    };
    if (options.autoStart !== false) start();
    return api;
}

window.createCooperativeScheduler = createCooperativeScheduler;
var BackgroundScheduler = window.PremiumFeaturesBackgroundScheduler || createCooperativeScheduler({
    runtime: window.PremiumFeaturesRuntimeRegistry,
    coordinator: window.PremiumFeaturesCoordination
});
window.PremiumFeaturesBackgroundScheduler = BackgroundScheduler;

function registerTimeoutHandler(name, fn) {
    timeoutHandlers[name] = fn;
}

// core_utils loads before the scheduler so it cannot register this handler at evaluation time.
if (typeof runKeepAwakeCheck === 'function') {
    registerTimeoutHandler('keepAwakeCheck', runKeepAwakeCheck);
    if (typeof runKeepAwakeConfirmation === 'function') {
        registerTimeoutHandler('keepAwakeConfirmation', runKeepAwakeConfirmation);
    }
}

function timeoutGenerationKey(id) {
    return 'timeoutGeneration_' + id;
}

function getPersistedTimeoutGeneration(id) {
    return Number(localStorage.getItem(timeoutGenerationKey(id))) || 0;
}

function nextPersistedTimeoutGeneration(id) {
    const generation = getPersistedTimeoutGeneration(id) + 1;
    localStorage.setItem(timeoutGenerationKey(id), String(generation));
    return generation;
}

function isCurrentPersistedTimeout(id, generation, endTime) {
    return getPersistedTimeoutGeneration(id) === generation &&
        Number(localStorage.getItem('endTime_' + id)) === Number(endTime);
}

function clearActiveTimeout(id, generation) {
    if (generation !== undefined && activeTimeoutGenerations[id] !== generation) return;
    if (activeTimeouts[id] !== undefined) clearTimeout(activeTimeouts[id]);
    delete activeTimeouts[id];
    delete activeTimeoutGenerations[id];
}

function clearPersistedTimeout(id) {
    nextPersistedTimeoutGeneration(id);
    clearActiveTimeout(id);
    localStorage.removeItem('endTime_' + id);
    localStorage.removeItem('function_' + id);
    localStorage.removeItem('handler_' + id);
    BackgroundScheduler?.cancel?.('persistent-timeout:' + id, 'persistent timeout cleared');
}

function getPersistentTaskPolicy(id, args) {
    let match = String(id).match(/^building_queue_(\d+)/);
    if (match) return { priority: BACKGROUND_TASK_PRIORITY.AUTOMATIC, requiresCoordinator: true, leaseKey: 'build-queue:' + match[1] };
    match = String(id).match(/^build_instant_free_(\d+)/);
    if (match) return { priority: BACKGROUND_TASK_PRIORITY.AUTOMATIC, requiresCoordinator: true, leaseKey: 'build-instant:' + match[1] };
    if (id === 'auto_trainer_paladin') return { priority: BACKGROUND_TASK_PRIORITY.AUTOMATIC, requiresCoordinator: true, leaseKey: 'paladin' };
    if (id === 'daily_bonus') return { priority: BACKGROUND_TASK_PRIORITY.AUTOMATIC, requiresCoordinator: true, leaseKey: 'daily-bonus' };
    if (id === 'keep-awake' || id === 'keep-awake-confirm') {
        return { priority: BACKGROUND_TASK_PRIORITY.HOUSEKEEPING, requiresCoordinator: true, leaseKey: 'keep-awake' };
    }
    if (String(id).startsWith('scavenging')) {
        const villageId = args?.[0] || window.game_data?.village?.id || 'unknown';
        return { priority: BACKGROUND_TASK_PRIORITY.AUTOMATIC, requiresCoordinator: true, leaseKey: 'scavenging:' + villageId };
    }
    return { priority: BACKGROUND_TASK_PRIORITY.AUTOMATIC, requiresCoordinator: false, leaseKey: null };
}

function consumeAndRunPersistedTimeout(id, generation, endTime) {
    if (!isCurrentPersistedTimeout(id, generation, endTime)) {
        window.PremiumFeaturesDiagnostics?.record?.({ taskKey: id, status: 'SKIPPED', reason: 'stale-timeout-generation' });
        return { status: 'STALE_GENERATION' };
    }
    const handlerRaw = localStorage.getItem('handler_' + id);
    const functionRaw = localStorage.getItem('function_' + id);

    // Final generation check is deliberately adjacent to claiming the record and real work.
    // Keep the persisted descriptor while the Promise is unresolved: if this tab is suspended or
    // disappears mid-callback, another coordinator can execute it after the task lease expires.
    if (!isCurrentPersistedTimeout(id, generation, endTime)) return { status: 'STALE_GENERATION' };
    clearActiveTimeout(id, generation);

    const clearClaimedRecord = function () {
        if (!isCurrentPersistedTimeout(id, generation, endTime)) return;
        localStorage.removeItem('endTime_' + id);
        localStorage.removeItem('handler_' + id);
        localStorage.removeItem('function_' + id);
    };
    let result;
    if (handlerRaw) {
        let parsed;
        try {
            parsed = JSON.parse(handlerRaw);
        } catch (error) {
            clearClaimedRecord();
            throw error;
        }
        const handler = timeoutHandlers[parsed.handlerName];
        if (!handler) {
            clearClaimedRecord();
            throw new Error('No timeout handler registered for "' + parsed.handlerName + '"');
        }
        try {
            result = handler(...(parsed.args || []));
        } catch (error) {
            clearClaimedRecord();
            throw error;
        }
    } else if (!functionRaw) {
        clearClaimedRecord();
        return { status: 'MISSING_CALLBACK' };
    } else {
        try {
            result = eval('(' + functionRaw + ')();');
        } catch (error) {
            clearClaimedRecord();
            throw error;
        }
    }
    if (!result || typeof result.then !== 'function') {
        clearClaimedRecord();
        return result;
    }
    return Promise.resolve(result).then(value => {
        clearClaimedRecord();
        return value;
    }, error => {
        clearClaimedRecord();
        throw error;
    });
}

function dispatchPersistedTimeout(id, generation, endTime) {
    if (!isCurrentPersistedTimeout(id, generation, endTime)) return;
    const handlerRaw = localStorage.getItem('handler_' + id);
    let args = [];
    try { args = handlerRaw ? (JSON.parse(handlerRaw).args || []) : []; } catch (_error) { /* handled at execution */ }
    const policy = getPersistentTaskPolicy(id, args);
    BackgroundScheduler.enqueue({
        key: 'persistent-timeout:' + id,
        priority: policy.priority,
        dueAt: endTime,
        dueMode: BackgroundScheduler.DUE_MODE?.REPLACE || 'REPLACE',
        requiresCoordinator: policy.requiresCoordinator,
        leaseKey: policy.leaseKey,
        generation,
        run: function (guard) {
            if (!isCurrentPersistedTimeout(id, generation, endTime)) return { status: 'STALE_GENERATION' };
            guard?.assertActive?.();
            return consumeAndRunPersistedTimeout(id, generation, endTime);
        },
        rerunWhileActive: true
    });
}

function armPersistedTimeout(id, generation, endTime) {
    clearActiveTimeout(id);
    const delayMs = Math.max(0, Number(endTime) - Date.now());
    activeTimeoutGenerations[id] = generation;
    const timer = setTimeout(function () {
        if (activeTimeoutGenerations[id] !== generation) return;
        dispatchPersistedTimeout(id, generation, endTime);
    }, delayMs);
    activeTimeouts[id] = timer;
    return timer;
}

function persistAndArmTimeout(id, payloadKey, payloadValue, timeToRun, spreadMinMs, spreadMaxMs) {
    clearActiveTimeout(id);
    const spreadMs = deterministicSpread(id, spreadMinMs, spreadMaxMs);
    const delayMs = Math.max(0, Math.floor(Number(timeToRun) || 0) + spreadMs);
    const endTime = Date.now() + delayMs;
    const generation = nextPersistedTimeoutGeneration(id);
    const otherPayloadKey = payloadKey === 'handler_' ? 'function_' : 'handler_';
    localStorage.removeItem(otherPayloadKey + id);
    localStorage.setItem(payloadKey + id, payloadValue);
    localStorage.setItem('endTime_' + id, String(endTime));
    armPersistedTimeout(id, generation, endTime);
    return { id, generation, endTime, delayMs };
}

/**
 * Schedules a reload-surviving callback. Optional spread is deterministic per id; by default the
 * requested due time is exact and the cooperative queue handles simultaneous work.
 */
function setFunctionOnTimeOut(id, func, timeToRun, spreadMinMs = 0, spreadMaxMs = 0) {
    return persistAndArmTimeout(id, 'function_', func.toString(), timeToRun, spreadMinMs, spreadMaxMs);
}

/** Schedules a named, reload-surviving callback with JSON-serialisable arguments. */
function setHandlerOnTimeOut(id, handlerName, args, timeToRun, spreadMinMs = 0, spreadMaxMs = 0) {
    return persistAndArmTimeout(
        id,
        'handler_',
        JSON.stringify({ handlerName, args: Array.isArray(args) ? args : [] }),
        timeToRun,
        spreadMinMs,
        spreadMaxMs
    );
}

function restoreTimeoutById(id) {
    const endTime = Number(localStorage.getItem('endTime_' + id));
    if (!Number.isFinite(endTime) || (!localStorage.getItem('handler_' + id) && !localStorage.getItem('function_' + id))) {
        clearActiveTimeout(id);
        return false;
    }
    let generation = getPersistedTimeoutGeneration(id);
    if (!generation) {
        generation = nextPersistedTimeoutGeneration(id);
    }
    armPersistedTimeout(id, generation, endTime);
    return true;
}

/** Restores every persisted timeout idempotently and registers each timer in activeTimeouts. */
function restoreTimeouts(options = {}) {
    Object.keys(localStorage)
        .filter(key => key.startsWith('endTime_'))
        .map(key => key.slice('endTime_'.length))
        .forEach(id => {
            if (options.missingOnly) {
                if (BackgroundScheduler?.hasTask?.('persistent-timeout:' + id)) return;
                if (activeTimeouts[id] !== undefined &&
                    Number(localStorage.getItem('endTime_' + id)) > Date.now()) return;
            }
            restoreTimeoutById(id);
        });
}

function handlePersistedTimeoutStorageEvent(event) {
    if (!event.key) return;
    if (event.key.startsWith('endTime_')) {
        const id = event.key.slice('endTime_'.length);
        if (event.newValue === null) {
            clearActiveTimeout(id);
            BackgroundScheduler.cancel('persistent-timeout:' + id, 'completed in another tab');
        }
        else restoreTimeoutById(id);
    } else if (event.key.startsWith('timeoutGeneration_')) {
        const id = event.key.slice('timeoutGeneration_'.length);
        if (activeTimeoutGenerations[id] !== Number(event.newValue)) {
            clearActiveTimeout(id);
            restoreTimeoutById(id);
        }
    }
}

if (window.PremiumFeaturesRuntimeRegistry) {
    window.PremiumFeaturesRuntimeRegistry.addEventListener(
        'persistent-timeouts:storage', window, 'storage', handlePersistedTimeoutStorageEvent
    );
}
