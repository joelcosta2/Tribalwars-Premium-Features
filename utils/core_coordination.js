// Multi-tab coordination: event bus, coordinator election, task leases and fencing tokens.
(function (root) {
    'use strict';

    const COORDINATION_PREFIX = 'twpf_coordination_v1:';

    function makeId(cryptoObject) {
        if (cryptoObject && typeof cryptoObject.randomUUID === 'function') return cryptoObject.randomUUID();
        const bytes = new Uint32Array(4);
        if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
            cryptoObject.getRandomValues(bytes);
            return Array.from(bytes, value => value.toString(36)).join('-');
        }
        return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }

    function createTabCoordinator(options = {}) {
        const host = options.host || root;
        const storage = options.storage || host.localStorage;
        const now = options.now || (() => Date.now());
        const clock = options.clock || host;
        const runtime = options.runtime || null;
        const tabId = options.tabId || makeId(host.crypto);
        const instanceId = options.instanceId || makeId(host.crypto);
        const heartbeatMs = Math.max(1000, Number(options.heartbeatMs) || 5000);
        const coordinatorLeaseMs = Math.max(heartbeatMs * 2, Number(options.coordinatorLeaseMs) || 15000);
        const scope = options.scope || [
            host.location?.hostname || 'unknown-host',
            host.game_data?.world || 'unknown-world',
            host.game_data?.player?.id || 'unknown-player'
        ].join(':');
        const encodedScope = encodeURIComponent(scope) + ':';
        const listeners = new Map();
        const jobs = new Map();
        const heldLeases = new Map();
        const renewalTimers = new Map();
        const activeLeaseRuns = new Set();
        let channel = null;
        let started = false;
        let coordinatorLease = null;
        let coordinatorTerm = null;
        let coordinatorCheckTimer = null;

        function leaseStorageKey(taskKey) {
            return COORDINATION_PREFIX + encodedScope + 'lease:' + encodeURIComponent(taskKey);
        }

        function fenceStorageKey(taskKey) {
            return COORDINATION_PREFIX + encodedScope + 'fence:' + encodeURIComponent(taskKey);
        }

        function messageStorageKey() {
            return COORDINATION_PREFIX + encodedScope + 'message';
        }

        function parse(raw) {
            if (!raw) return null;
            try { return JSON.parse(raw); } catch (_error) { return null; }
        }

        function writeStorage(key, value) {
            try {
                if (storage === host.localStorage && typeof safeLocalStorageSet === 'function') {
                    return safeLocalStorageSet(key, value);
                }
                storage.setItem(key, value);
                return true;
            } catch (error) {
                console.warn('[TW Coordination] Storage write failed:', key, error);
                return false;
            }
        }

        function readLease(taskKey) {
            return parse(storage.getItem(leaseStorageKey(taskKey)));
        }

        function nextFencingToken(taskKey, previousToken) {
            const key = fenceStorageKey(taskKey);
            const stored = Number(storage.getItem(key)) || 0;
            const token = Math.max(stored, Number(previousToken) || 0) + 1;
            return writeStorage(key, String(token)) ? token : null;
        }

        function emit(type, payload) {
            const callbacks = listeners.get(type);
            if (callbacks) callbacks.forEach(callback => {
                try { callback(payload); } catch (error) { console.error('[TW Coordination] listener failed', error); }
            });
        }

        function receiveMessage(message) {
            if (!message || message.scope !== scope || message.sender === instanceId) return;
            emit(message.type, message.payload);
            if (message.type === 'lease-changed' && message.payload?.taskKey === 'coordinator') {
                evaluateCoordinator();
            }
        }

        function broadcast(type, payload) {
            const message = { scope, sender: instanceId, type, payload, sentAt: now(), id: makeId(host.crypto) };
            if (channel) {
                try { channel.postMessage(message); } catch (error) { console.warn('[TW Coordination] BroadcastChannel failed', error); }
            }
            writeStorage(messageStorageKey(), JSON.stringify(message));
            emit(type, payload);
        }

        function acquireLease(taskKey, ttlMs = coordinatorLeaseMs) {
            const current = readLease(taskKey);
            const timestamp = now();
            if (current && current.expiresAt > timestamp && current.owner !== tabId) return null;

            if (current && current.owner === tabId && current.instanceId === instanceId && current.expiresAt > timestamp) {
                return renewLease(current, ttlMs);
            }

            const token = nextFencingToken(taskKey, current?.token);
            if (token === null) return null;
            const candidate = {
                taskKey,
                owner: tabId,
                instanceId,
                token,
                nonce: makeId(host.crypto),
                acquiredAt: timestamp,
                expiresAt: timestamp + Math.max(1000, Number(ttlMs) || coordinatorLeaseMs)
            };
            if (!writeStorage(leaseStorageKey(taskKey), JSON.stringify(candidate))) return null;
            const confirmed = readLease(taskKey);
            if (!confirmed || confirmed.owner !== candidate.owner || confirmed.instanceId !== candidate.instanceId ||
                confirmed.token !== candidate.token || confirmed.nonce !== candidate.nonce) {
                return null;
            }
            heldLeases.set(taskKey, candidate);
            host.PremiumFeaturesDiagnostics?.record?.({
                taskKey,
                status: 'LEASE',
                reason: 'acquired',
                fencingToken: candidate.token
            });
            broadcast('lease-changed', { taskKey, owner: tabId, token: candidate.token, expiresAt: candidate.expiresAt });
            return Object.assign({}, candidate);
        }

        function validateLease(lease) {
            if (!lease || lease.owner !== tabId || lease.instanceId !== instanceId || lease.expiresAt <= now()) return false;
            const current = readLease(lease.taskKey);
            return Boolean(current && current.owner === lease.owner && current.instanceId === lease.instanceId &&
                current.token === lease.token && current.nonce === lease.nonce && current.expiresAt > now());
        }

        function assertLease(lease) {
            if (validateLease(lease)) return true;
            const error = new Error('Lease lost for ' + (lease?.taskKey || 'unknown task'));
            error.code = 'LEASE_LOST';
            error.lease = lease;
            throw error;
        }

        function renewLease(lease, ttlMs = coordinatorLeaseMs) {
            if (!validateLease(lease)) return null;
            const renewed = Object.assign({}, lease, { expiresAt: now() + Math.max(1000, Number(ttlMs) || coordinatorLeaseMs) });
            if (!writeStorage(leaseStorageKey(lease.taskKey), JSON.stringify(renewed))) return null;
            if (!validateLease(renewed)) return null;
            heldLeases.set(lease.taskKey, renewed);
            if (lease.taskKey === 'coordinator') coordinatorLease = renewed;
            return Object.assign({}, renewed);
        }

        function releaseLease(leaseOrTaskKey) {
            const lease = typeof leaseOrTaskKey === 'string' ? heldLeases.get(leaseOrTaskKey) : leaseOrTaskKey;
            if (!lease) return false;
            stopRenewing(lease.taskKey);
            const current = readLease(lease.taskKey);
            if (!current || current.owner !== lease.owner || current.instanceId !== lease.instanceId ||
                current.token !== lease.token || current.nonce !== lease.nonce) {
                heldLeases.delete(lease.taskKey);
                return false;
            }
            const expired = Object.assign({}, current, { expiresAt: now() - 1, releasedAt: now() });
            if (!writeStorage(leaseStorageKey(lease.taskKey), JSON.stringify(expired))) return false;
            heldLeases.delete(lease.taskKey);
            broadcast('lease-changed', { taskKey: lease.taskKey, owner: null, token: lease.token, expiresAt: expired.expiresAt });
            return true;
        }

        function startRenewing(lease, ttlMs) {
            stopRenewing(lease.taskKey);
            const intervalMs = Math.max(1000, Math.floor(ttlMs / 3));
            const renew = function () {
                const current = heldLeases.get(lease.taskKey);
                const renewed = current && renewLease(current, ttlMs);
                if (!renewed) stopRenewing(lease.taskKey);
            };
            const timer = clock.setInterval(renew, intervalMs);
            renewalTimers.set(lease.taskKey, timer);
        }

        function stopRenewing(taskKey) {
            const timer = renewalTimers.get(taskKey);
            if (timer !== undefined) clock.clearInterval(timer);
            renewalTimers.delete(taskKey);
        }

        function isCoordinator() {
            return validateLease(coordinatorLease);
        }

        function runCoordinatorJob(job) {
            if (!isCoordinator() || job.lastTerm === coordinatorTerm) return;
            job.lastTerm = coordinatorTerm;
            const scheduler = host.PremiumFeaturesBackgroundScheduler;
            const descriptor = {
                key: 'coordinator-job:' + job.key,
                priority: job.priority,
                dueAt: now() + job.delayMs,
                dueMode: job.dueMode || scheduler?.DUE_MODE?.REPLACE || 'REPLACE',
                requiresCoordinator: true,
                leaseKey: job.leaseKey || ('background:' + job.key),
                run: job.run,
                rerunWhileActive: job.rerunWhileActive
            };
            if (scheduler && typeof scheduler.enqueue === 'function') {
                scheduler.enqueue(descriptor);
            } else {
                Promise.resolve().then(function () {
                    if (isCoordinator()) return job.run({ assertActive: function () { assertLease(coordinatorLease); } });
                }).catch(error => console.error('[TW Coordination] Background job failed:', job.key, error));
            }
        }

        function runCoordinatorJobs() {
            jobs.forEach(runCoordinatorJob);
        }

        function scheduleCoordinatorCheck() {
            if (!started) return;
            const current = readLease('coordinator');
            const delayMs = isCoordinator()
                ? heartbeatMs
                : current && current.expiresAt > now()
                    ? Math.max(heartbeatMs, current.expiresAt - now() + 25)
                    : heartbeatMs;
            if (runtime) {
                coordinatorCheckTimer = runtime.setTimeout(
                    'coordination:lease-check', evaluateCoordinator, delayMs, true
                );
            } else {
                if (coordinatorCheckTimer !== null) clock.clearTimeout(coordinatorCheckTimer);
                coordinatorCheckTimer = clock.setTimeout(evaluateCoordinator, delayMs);
            }
        }

        function evaluateCoordinator() {
            const wasCoordinator = isCoordinator();
            if (!wasCoordinator) {
                coordinatorLease = acquireLease('coordinator', coordinatorLeaseMs);
            } else {
                coordinatorLease = renewLease(coordinatorLease, coordinatorLeaseMs);
            }
            const coordinatorNow = isCoordinator();
            if (coordinatorNow) {
                const nextTerm = coordinatorLease.token + ':' + coordinatorLease.nonce;
                if (nextTerm !== coordinatorTerm) {
                    coordinatorTerm = nextTerm;
                    emit('coordinator-change', { isCoordinator: true, lease: Object.assign({}, coordinatorLease) });
                }
                runCoordinatorJobs();
            } else if (coordinatorTerm !== null) {
                coordinatorTerm = null;
                emit('coordinator-change', { isCoordinator: false, lease: readLease('coordinator') });
            }
            scheduleCoordinatorCheck();
            return coordinatorNow;
        }

        function onStorage(event) {
            if (event.key === messageStorageKey()) receiveMessage(parse(event.newValue));
            if (event.key === leaseStorageKey('coordinator')) evaluateCoordinator();
        }

        function start() {
            if (started) return;
            started = true;
            if (typeof host.BroadcastChannel === 'function') {
                try {
                    channel = new host.BroadcastChannel(COORDINATION_PREFIX + encodedScope + 'bus');
                    channel.onmessage = event => receiveMessage(event.data);
                } catch (_error) { channel = null; }
            }
            if (runtime) {
                runtime.addEventListener('coordination:storage', host, 'storage', onStorage);
                runtime.addEventListener('coordination:visibility', host.document, 'visibilitychange', function () {
                    if (!host.document.hidden) evaluateCoordinator();
                });
                runtime.addEventListener('coordination:pagehide', host, 'pagehide', function () {
                    if (coordinatorLease) releaseLease(coordinatorLease);
                });
            } else {
                host.addEventListener?.('storage', onStorage);
            }
            evaluateCoordinator();
        }

        function stop() {
            if (!started) return;
            started = false;
            Array.from(heldLeases.values()).forEach(releaseLease);
            Array.from(renewalTimers.keys()).forEach(stopRenewing);
            if (runtime) {
                runtime.clearTimeout('coordination:lease-check');
                runtime.removeEventListener('coordination:storage');
                runtime.removeEventListener('coordination:visibility');
                runtime.removeEventListener('coordination:pagehide');
            } else if (coordinatorCheckTimer !== null) {
                clock.clearTimeout(coordinatorCheckTimer);
            }
            coordinatorCheckTimer = null;
            channel?.close?.();
            channel = null;
        }

        function subscribe(type, callback) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(callback);
            return function () { listeners.get(type)?.delete(callback); };
        }

        function registerBackgroundTask(key, run, taskOptions = {}) {
            const existing = jobs.get(key);
            const job = existing || { key, lastTerm: null };
            job.run = run;
            job.priority = Number(taskOptions.priority) || 4;
            job.leaseKey = taskOptions.leaseKey;
            job.delayMs = Math.max(0, Number(taskOptions.delayMs) || 0);
            job.dueMode = taskOptions.dueMode || 'REPLACE';
            job.rerunWhileActive = !!taskOptions.reconcile;
            if (existing && taskOptions.reconcile) job.lastTerm = null;
            jobs.set(key, job);
            runCoordinatorJob(job);
            return job;
        }

        async function runWithLease(taskKey, run, leaseOptions = {}) {
            taskKey = String(taskKey);
            if (activeLeaseRuns.has(taskKey)) {
                const error = new Error('Lease already active in this tab for ' + taskKey);
                error.code = 'LEASE_UNAVAILABLE';
                error.currentLease = readLease(taskKey);
                throw error;
            }
            const ttlMs = Math.max(1000, Number(leaseOptions.ttlMs) || 30000);
            const lease = acquireLease(taskKey, ttlMs);
            if (!lease) {
                host.PremiumFeaturesDiagnostics?.record?.({ taskKey, status: 'SKIPPED', reason: 'lease-unavailable' });
                const error = new Error('Lease unavailable for ' + taskKey);
                error.code = 'LEASE_UNAVAILABLE';
                error.currentLease = readLease(taskKey);
                throw error;
            }
            // Yield once so simultaneous localStorage contenders can publish their candidate,
            // then verify again before any caller can reach real work.
            await Promise.resolve();
            if (!validateLease(lease)) {
                heldLeases.delete(taskKey);
                const error = new Error('Lease lost during acquisition for ' + taskKey);
                error.code = 'LEASE_LOST';
                error.currentLease = readLease(taskKey);
                throw error;
            }
            activeLeaseRuns.add(taskKey);
            startRenewing(lease, ttlMs);
            const guard = {
                lease,
                token: lease.token,
                assertActive: function () {
                    const current = heldLeases.get(taskKey) || lease;
                    return assertLease(current);
                },
                isActive: function () {
                    const current = heldLeases.get(taskKey) || lease;
                    return validateLease(current);
                }
            };
            try {
                guard.assertActive();
                return await run(guard);
            } finally {
                activeLeaseRuns.delete(taskKey);
                releaseLease(heldLeases.get(taskKey) || lease);
            }
        }

        return {
            tabId,
            instanceId,
            scope,
            start,
            stop,
            broadcast,
            subscribe,
            acquireLease,
            readLease,
            renewLease,
            releaseLease,
            validateLease,
            assertLease,
            runWithLease,
            evaluateCoordinator,
            isCoordinator,
            registerBackgroundTask,
            stats: function () {
                return { started, tabId, instanceId, coordinator: isCoordinator(), heldLeases: heldLeases.size, jobs: jobs.size };
            }
        };
    }

    root.createTabCoordinator = createTabCoordinator;
    if (!root.PremiumFeaturesCoordination && root.localStorage) {
        root.PremiumFeaturesCoordination = createTabCoordinator({
            runtime: root.PremiumFeaturesRuntimeRegistry
        });
    }
})(window);

var TabCoordinator = window.PremiumFeaturesCoordination;
