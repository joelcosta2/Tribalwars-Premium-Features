// Async/network helpers: deterministic batching, single-flight, SWR cache and failure isolation.

/**
 * Returns a Promise that resolves after the given number of seconds.
 * @param {number} seconds
 * @returns {Promise<void>}
 */
function wait(seconds) {
    return new Promise(resolve => {
        setTimeout(resolve, seconds * 1000);
    });
}

/**
 * Runs `worker` over `items` with at most `concurrency` calls in flight at once, waiting a
 * deterministic delay in [minDelay, maxDelay] ms before every start (including slot refills).
 * This spreads internal work predictably without probing or adapting to server limits. Never rejects — a worker's own
 * error is swallowed so one failed item doesn't stop the rest of the batch; callers that need to
 * know about failures should handle them inside `worker` itself.
 * @param {Array<*>} items
 * @param {(item:*, index:number) => Promise<*>} worker
 * @param {{concurrency?:number, minDelay?:number, maxDelay?:number}} [options]
 * @returns {Promise<void>} Resolves once every item has settled.
 */
function runWithConcurrencyLimit(items, worker, { concurrency = 2, minDelay = 150, maxDelay = 400 } = {}) {
    let nextIndex = 0;

    function deterministicDelay(index) {
        const low = Math.max(0, Number(minDelay) || 0);
        const high = Math.max(low, Number(maxDelay) || low);
        if (high === low) return low;
        return low + ((index * 2654435761) >>> 0) % (high - low + 1);
    }

    function runNext() {
        const index = nextIndex++;
        if (index >= items.length) return Promise.resolve();

        const delay = deterministicDelay(index);
        return wait(delay / 1000)
            .then(() => Promise.resolve(worker(items[index], index)).catch(() => {}))
            .then(runNext);
    }

    const lanes = Array.from({ length: Math.min(concurrency, items.length) }, runNext);
    return Promise.all(lanes);
}

/**
 * Compatibility wrapper for existing call sites. HTTP 429 is intentionally never retried:
 * same-origin Tribal Wars 403/429 are hard-stop signals; external-service responses are rejected
 * without applying Tribal Wars policy. The historical function name is retained to avoid breaking
 * existing features while their request paths migrate to runResilientTask().
 * @param {Object} ajaxSettings - Passed through to $.ajax as-is (success/error are overridden).
 * @param {Object} [_options] - Legacy options are accepted and intentionally ignored.
 * @returns {Promise<*>} Resolves with the response data on success.
 */
function fetchWithRetry429(ajaxSettings, _options = {}) {
    return new Promise((resolve, reject) => {
        $.ajax(Object.assign({}, ajaxSettings, { success: resolve, error: reject }));
    }).catch((jqXHR) => {
        const failure = classifyRequestFailure(jqXHR, { url: ajaxSettings?.url });
        if (failure.hardStop) triggerPremiumFeaturesHardStop(failure);
        return Promise.reject(jqXHR);
    });
}

const CACHE_STATE = Object.freeze({
    FRESH: 'FRESH',
    STALE_BUT_USABLE: 'STALE_BUT_USABLE',
    EXPIRED: 'EXPIRED'
});

const TASK_RESULT = Object.freeze({
    SUCCESS: 'SUCCESS',
    SOFT_PAUSED: 'SOFT_PAUSED',
    UNCERTAIN: 'UNCERTAIN',
    HARD_STOP: 'HARD_STOP',
    FAILED: 'FAILED'
});

function stableSnapshotHash(value) {
    const seen = new WeakSet();
    function normalize(input) {
        if (input === null || typeof input !== 'object') return input;
        if (seen.has(input)) return '[Circular]';
        seen.add(input);
        if (Array.isArray(input)) return input.map(normalize);
        const output = {};
        Object.keys(input).sort().forEach(key => { output[key] = normalize(input[key]); });
        return output;
    }
    const text = JSON.stringify(normalize(value)) ?? String(value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function createSingleFlight() {
    const inFlight = new Map();
    function run(key, factory) {
        const logicalKey = String(key);
        if (inFlight.has(logicalKey)) {
            window.PremiumFeaturesDiagnostics?.record?.({
                logicalResource: logicalKey,
                status: 'COALESCED',
                reason: 'single-flight'
            });
            return inFlight.get(logicalKey);
        }
        const promise = Promise.resolve().then(factory);
        inFlight.set(logicalKey, promise);
        promise.finally(function () {
            if (inFlight.get(logicalKey) === promise) inFlight.delete(logicalKey);
        }).catch(function () { /* the caller owns the original rejection */ });
        return promise;
    }
    return { run, has: key => inFlight.has(String(key)), size: () => inFlight.size };
}

var SingleFlight = window.PremiumFeaturesSingleFlight || createSingleFlight();
window.PremiumFeaturesSingleFlight = SingleFlight;

function createResourceCache(options = {}) {
    const entries = new Map();
    const storage = options.storage || null;
    const storagePrefix = options.storagePrefix || 'twpf_cache:';
    const writeBehind = options.writeBehind !== undefined
        ? options.writeBehind
        : storage === window.localStorage ? window.PremiumFeaturesWriteBehind : null;
    const now = options.now || (() => Date.now());
    const singleFlight = options.singleFlight || SingleFlight;

    function loadPersisted(key) {
        if (!storage || entries.has(key)) return;
        try {
            const raw = writeBehind?.get?.(storagePrefix + key) ?? storage.getItem(storagePrefix + key);
            if (raw) entries.set(key, JSON.parse(raw));
        } catch (_error) { /* corrupt cache is treated as expired */ }
    }

    function classify(entry, policy = {}) {
        if (!entry) return CACHE_STATE.EXPIRED;
        const ageMs = Math.max(0, now() - entry.storedAt);
        if (typeof policy.classify === 'function') return policy.classify(entry.value, ageMs, entry);
        const freshForMs = Math.max(0, Number(policy.freshForMs) || 0);
        const staleForMs = Math.max(0, Number(policy.staleForMs) || 0);
        if (ageMs <= freshForMs) return CACHE_STATE.FRESH;
        if (ageMs <= freshForMs + staleForMs) return CACHE_STATE.STALE_BUT_USABLE;
        return CACHE_STATE.EXPIRED;
    }

    function read(key, policy) {
        const logicalKey = String(key);
        loadPersisted(logicalKey);
        const entry = entries.get(logicalKey) || null;
        const state = classify(entry, policy);
        if (state === CACHE_STATE.FRESH || state === CACHE_STATE.STALE_BUT_USABLE) {
            window.PremiumFeaturesDiagnostics?.record?.({
                logicalResource: logicalKey,
                status: state === CACHE_STATE.FRESH ? 'CACHE_HIT' : 'STALE_HIT'
            });
        }
        return { state, value: entry?.value, entry };
    }

    function set(key, value, setOptions = {}) {
        const logicalKey = String(key);
        const entry = {
            value,
            storedAt: Number(setOptions.storedAt) || now(),
            snapshotHash: setOptions.snapshotHash || stableSnapshotHash(value)
        };
        entries.set(logicalKey, entry);
        if (storage) {
            const storageKey = storagePrefix + logicalKey;
            if (writeBehind) writeBehind.set(storageKey, JSON.stringify(entry), { immediate: !!setOptions.immediate });
            else storage.setItem(storageKey, JSON.stringify(entry));
        }
        return entry;
    }

    function invalidate(key, invalidateOptions = {}) {
        const logicalKey = String(key);
        entries.delete(logicalKey);
        if (storage) {
            const storageKey = storagePrefix + logicalKey;
            if (writeBehind) writeBehind.remove(storageKey, { immediate: !!invalidateOptions.immediate });
            else storage.removeItem(storageKey);
        }
    }

    function refresh(key, loader, setOptions) {
        const logicalKey = String(key);
        return singleFlight.run('cache:' + logicalKey, function () {
            return Promise.resolve(loader()).then(value => {
                set(logicalKey, value, setOptions);
                return value;
            });
        });
    }

    function getOrRevalidate(key, loader, policy = {}, requestOptions = {}) {
        const cached = read(key, policy);
        if (cached.state === CACHE_STATE.FRESH) {
            return Promise.resolve({ state: cached.state, value: cached.value, revalidatePromise: null });
        }
        if (cached.state === CACHE_STATE.STALE_BUT_USABLE && !requestOptions.requireFresh) {
            const revalidatePromise = refresh(key, loader, requestOptions.setOptions).catch(function () { return cached.value; });
            return Promise.resolve({ state: cached.state, value: cached.value, revalidatePromise });
        }
        return refresh(key, loader, requestOptions.setOptions).then(value => ({
            state: CACHE_STATE.FRESH,
            value,
            revalidatePromise: null
        }));
    }

    return { read, set, invalidate, refresh, getOrRevalidate, classify, size: () => entries.size };
}

function isSameOriginTribalWarsUrl(url) {
    try {
        const parsed = new URL(url || window.location.href, window.location.href);
        const current = new URL(window.location.href);
        return parsed.origin === current.origin && /(^|\.)tribalwars\./i.test(parsed.hostname);
    } catch (_error) {
        return false;
    }
}

function classifyRequestFailure(error, context = {}) {
    const status = Number(error?.status ?? error?.response?.status ?? context.status) || 0;
    const url = context.url || error?.url || error?.responseURL || error?.response?.url;
    const sameOriginTribalWars = isSameOriginTribalWarsUrl(url);
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError' ||
        error?.code === 'ETIMEDOUT' || error?.textStatus === 'timeout' || context.timeout === true;
    const network = !status && (timeout || error instanceof TypeError || error?.status === 0 || context.network === true);
    const transient = timeout || network || [500, 502, 503].includes(status);
    const hardStop = sameOriginTribalWars && (status === 403 || status === 429);
    return { status, url, timeout, network, transient, hardStop, sameOriginTribalWars, error };
}

function triggerPremiumFeaturesHardStop(failure) {
    console.warn('[TW Resilience] Hard stop:', failure.status || 'bot-protection');
    window.PremiumFeaturesBackgroundScheduler?.hardStop?.(failure);
    window.PremiumFeaturesCoordination?.broadcast?.('hard-stop', {
        source: 'same-origin-http',
        status: failure.status
    });
    window.PremiumFeaturesCoordination?.stop?.();
    window.PremiumFeaturesBotProtection?.block?.();
}

function createCircuitBreaker(options = {}) {
    const states = new Map();
    const now = options.now || (() => Date.now());
    const threshold = Math.max(1, Number(options.threshold) || 3);
    const backoffMs = options.backoffMs || [30000, 60000, 120000, 300000, 600000];
    const writeBehind = options.writeBehind || null;
    const storagePrefix = options.storagePrefix || 'twpf_breaker:';

    function storageKey(key) { return storagePrefix + String(key); }

    function load(key) {
        const logicalKey = String(key);
        if (states.has(logicalKey)) return states.get(logicalKey);
        let state = { state: 'CLOSED', failureCount: 0, snapshotHash: null, retryAt: 0 };
        try {
            const raw = writeBehind?.get?.(storageKey(logicalKey));
            if (raw) state = Object.assign(state, JSON.parse(raw));
        } catch (_error) { /* invalid persisted state starts closed */ }
        states.set(logicalKey, state);
        return state;
    }

    function save(key, state) {
        states.set(String(key), state);
        writeBehind?.set?.(storageKey(key), JSON.stringify(state));
        return Object.assign({}, state);
    }

    function canRun(key, snapshotHash) {
        const state = load(key);
        if (snapshotHash && state.snapshotHash && snapshotHash !== state.snapshotHash) {
            save(key, { state: 'CLOSED', failureCount: 0, snapshotHash, retryAt: 0 });
            return true;
        }
        if (state.retryAt > now()) return false;
        if (state.state === 'OPEN') state.state = 'HALF_OPEN';
        return true;
    }

    function recordSuccess(key, snapshotHash) {
        return save(key, { state: 'CLOSED', failureCount: 0, snapshotHash: snapshotHash || null, retryAt: 0 });
    }

    function recordFailure(key, snapshotHash, failure) {
        const previous = load(key);
        const sameSnapshot = previous.snapshotHash === (snapshotHash || null);
        const failureCount = sameSnapshot ? previous.failureCount + 1 : 1;
        const delay = backoffMs[Math.min(failureCount - 1, backoffMs.length - 1)];
        return save(key, {
            state: failureCount >= threshold ? 'OPEN' : 'CLOSED',
            failureCount,
            snapshotHash: snapshotHash || null,
            retryAt: now() + delay,
            lastFailure: { status: failure?.status || 0, timeout: !!failure?.timeout, network: !!failure?.network }
        });
    }

    function getState(key) { return Object.assign({}, load(key)); }
    function reset(key) { return recordSuccess(key, null); }
    return { canRun, recordSuccess, recordFailure, getState, reset };
}

var CircuitBreakers = window.PremiumFeaturesCircuitBreakers || createCircuitBreaker({
    writeBehind: window.PremiumFeaturesWriteBehind,
    storagePrefix: 'twpf_breaker_v1:'
});
window.PremiumFeaturesCircuitBreakers = CircuitBreakers;

async function runResilientTask(options) {
    const taskKey = String(options.key);
    const snapshotHash = options.snapshotHash || stableSnapshotHash(options.snapshot);
    const breaker = options.breaker || CircuitBreakers;
    if (!breaker.canRun(taskKey, snapshotHash)) {
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: options.feature,
            taskKey,
            villageId: options.villageId,
            logicalResource: options.logicalResource,
            status: 'CIRCUIT_OPEN'
        });
        return { status: TASK_RESULT.SOFT_PAUSED, retryAt: breaker.getState(taskKey).retryAt };
    }
    try {
        const value = await options.run();
        breaker.recordSuccess(taskKey, snapshotHash);
        return { status: TASK_RESULT.SUCCESS, value };
    } catch (error) {
        const failure = classifyRequestFailure(error, options);
        if (failure.hardStop || error?.code === 'HARD_STOP') {
            failure.hardStop = true;
            triggerPremiumFeaturesHardStop(failure);
            return { status: TASK_RESULT.HARD_STOP, failure };
        }
        if (error?.code === 'STALE_CONFIG' || error?.code === 'STALE_GENERATION') {
            window.PremiumFeaturesDiagnostics?.record?.({
                feature: options.feature,
                taskKey,
                villageId: options.villageId,
                logicalResource: options.logicalResource,
                method: options.method,
                status: 'SKIPPED',
                reason: String(error.code).toLowerCase()
            });
            return { status: TASK_RESULT.FAILED, failure, stale: true };
        }
        const breakerState = breaker.recordFailure(taskKey, snapshotHash, failure);
        // A mutating request may have reached and been applied by the server even when its
        // response is a transient 5xx.  Treat the transmission result as unknown and reconcile;
        // never turn it into an automatic retry that can duplicate the mutation.
        if (options.mutation && (error?.afterTransmission || failure.timeout || failure.network ||
            [500, 502, 503].includes(Number(failure.status)))) {
            const scheduler = options.scheduler || window.PremiumFeaturesBackgroundScheduler;
            if (scheduler && typeof options.reconcile === 'function') {
                scheduler.enqueue({
                    key: 'reconcile:' + taskKey,
                    priority: scheduler.PRIORITY?.RECONCILIATION || 2,
                    dueAt: breakerState.retryAt,
                    dueMode: scheduler.DUE_MODE?.EARLIEST || 'EARLIEST',
                    leaseKey: options.leaseKey,
                    snapshotHash,
                    run: options.reconcile
                });
            }
            window.PremiumFeaturesDiagnostics?.record?.({
                feature: options.feature,
                taskKey,
                villageId: options.villageId,
                logicalResource: options.logicalResource,
                method: options.method,
                status: 'UNCERTAIN'
            });
            return { status: TASK_RESULT.UNCERTAIN, failure, retryAt: breakerState.retryAt };
        }
        if (failure.transient) {
            window.PremiumFeaturesDiagnostics?.record?.({
                feature: options.feature,
                taskKey,
                villageId: options.villageId,
                logicalResource: options.logicalResource,
                method: options.method,
                status: 'SOFT_PAUSE'
            });
            return { status: TASK_RESULT.SOFT_PAUSED, failure, retryAt: breakerState.retryAt };
        }
        return { status: TASK_RESULT.FAILED, failure, retryAt: breakerState.retryAt };
    }
}

window.PremiumFeaturesAsync = Object.assign(window.PremiumFeaturesAsync || {}, {
    CACHE_STATE,
    TASK_RESULT,
    createSingleFlight,
    createResourceCache,
    createCircuitBreaker,
    classifyRequestFailure,
    stableSnapshotHash,
    runResilientTask
});

function installHardStopTransportGuards() {
    if (typeof window.fetch === 'function' && !window.fetch.__twpfHardStopGuard) {
        const originalFetch = window.fetch.bind(window);
        const guardedFetch = function (input, init) {
            const requestedUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
            return originalFetch(input, init).then(function (response) {
                const failure = classifyRequestFailure(response, { url: response.url || requestedUrl });
                if (failure.hardStop) triggerPremiumFeaturesHardStop(failure);
                return response;
            });
        };
        guardedFetch.__twpfHardStopGuard = true;
        guardedFetch.__twpfOriginalFetch = originalFetch;
        window.fetch = guardedFetch;
    }

    if (typeof $ === 'function' && typeof document !== 'undefined') {
        $(document).off('ajaxError.premium_features_hard_stop').on(
            'ajaxError.premium_features_hard_stop',
            function (_event, jqXHR, ajaxSettings) {
                const failure = classifyRequestFailure(jqXHR, { url: ajaxSettings?.url });
                if (failure.hardStop) triggerPremiumFeaturesHardStop(failure);
            }
        );
    }

    const xhrPrototype = window.XMLHttpRequest?.prototype;
    if (xhrPrototype && !xhrPrototype.open.__twpfHardStopGuard) {
        const originalOpen = xhrPrototype.open;
        const guardedOpen = function (method, url) {
            this.__twpfRequestedUrl = url;
            if (!this.__twpfHardStopListener) {
                this.__twpfHardStopListener = true;
                this.addEventListener('loadend', function () {
                    const failure = classifyRequestFailure(this, {
                        url: this.responseURL || this.__twpfRequestedUrl
                    });
                    if (failure.hardStop) triggerPremiumFeaturesHardStop(failure);
                });
            }
            return originalOpen.apply(this, arguments);
        };
        guardedOpen.__twpfHardStopGuard = true;
        guardedOpen.__twpfOriginalOpen = originalOpen;
        xhrPrototype.open = guardedOpen;
    }
}

installHardStopTransportGuards();

/**
 * Wraps GM_xmlhttpRequest in a Promise for use with async/await.
 * Needed for cross-origin fetches (e.g. twstats.com) that regular fetch() cannot
 * perform due to CORS restrictions on the game page.
 * @param {string} url
 * @param {{method?: string, data?: string}} [options] - method defaults to GET; data is a
 *   url-encoded form body, used e.g. for TWStats' POST-only ranking search.
 * @returns {Promise<string>} Response text
 */
function gmFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: options.method || 'GET',
            url: url,
            data: options.data,
            headers: options.data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
            onload: function (response) {
                if (response.status >= 200 && response.status < 300) {
                    resolve(response.responseText);
                } else {
                    reject(new Error('HTTP ' + response.status + ' — ' + url));
                }
            },
            onerror: function () {
                reject(new Error('Network error fetching ' + url));
            }
        });
    });
}
