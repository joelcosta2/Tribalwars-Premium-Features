// Auto Daily Bonus — one server-day state and one fenced executor across tabs.

const DAILY_BONUS_STATE_KEY = 'twpf_daily_bonus_v1:' + encodeURIComponent([
    window.location?.hostname || 'unknown-host',
    window.game_data?.world || 'unknown-world',
    window.game_data?.player?.id || 'unknown-player'
].join(':'));

function _dailyServerDay() {
    const serverLocalMs = Timing.getCurrentServerTime() + serverTimezoneOffsetMs;
    return new Date(serverLocalMs).toISOString().split('T')[0];
}

function _dailyReadState() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(DAILY_BONUS_STATE_KEY) || '{}'); } catch (_error) { /* reset corrupt state */ }
    const legacyDay = localStorage.getItem('daily_bonus_last_date');
    return Object.assign({
        serverDay: legacyDay || null,
        status: legacyDay ? 'DONE' : 'UNKNOWN',
        generation: 1,
        attempted: Boolean(legacyDay),
        collected: false,
        nextDueAt: null,
        uncertain: null,
        reason: legacyDay ? 'legacy-attempt' : 'initial'
    }, saved);
}

function _dailyWriteState(patch, keepGeneration) {
    const previous = _dailyReadState();
    const next = Object.assign({}, previous, patch, {
        generation: keepGeneration ? previous.generation : previous.generation + 1,
        updatedAt: Date.now()
    });
    localStorage.setItem(DAILY_BONUS_STATE_KEY, JSON.stringify(next));
    if (next.status === 'DONE') localStorage.setItem('daily_bonus_last_date', next.serverDay);
    window.PremiumFeaturesCoordination?.broadcast?.('daily-bonus-state', next);
    return next;
}

function _dailySnapshot(state) {
    const value = {
        serverDay: state.serverDay,
        status: state.status,
        generation: state.generation,
        uncertain: state.uncertain
    };
    return window.PremiumFeaturesAsync?.stableSnapshotHash?.(value) || JSON.stringify(value);
}

function _dailyLeaseActive() {
    const coordinator = window.PremiumFeaturesCoordination;
    if (!coordinator?.readLease) return true;
    const lease = coordinator.readLease('daily-bonus');
    return Boolean(lease && lease.owner === coordinator.tabId &&
        lease.instanceId === coordinator.instanceId && lease.expiresAt > Date.now());
}

function _deferDailyLease(reason) {
    const lease = window.PremiumFeaturesCoordination?.readLease?.('daily-bonus');
    const dueAt = Math.max(Date.now() + 1000, Number(lease?.expiresAt) + 50 || 0);
    const state = _dailyReadState();
    _scheduleDailyWorker(dueAt, reason || 'lease-deferred', state);
    return { status: 'WAITING_LEASE', dueAt };
}

function _dailyInvalidateBuildResources(reason) {
    const villageId = String(game_data?.village?.id || '');
    const buildState = window.PremiumFeaturesBuildState;
    if (!villageId || !buildState?.invalidate) return;
    buildState.invalidate(villageId, ['resources'], reason);
    if (buildState.get(villageId)?.queue?.length && typeof requestBuildQueueReconcile === 'function') {
        requestBuildQueueReconcile(villageId, {
            reason,
            delayMs: 0,
            priority: window.PremiumFeaturesBackgroundScheduler?.PRIORITY?.RECONCILIATION || 2,
            forceFresh: true
        });
    }
}

function _scheduleDailyWorker(dueAt, reason, state) {
    const current = state || _dailyReadState();
    const targetAt = Math.max(Date.now(), Number(dueAt) || Date.now());
    const scheduled = _dailyWriteState({ nextDueAt: targetAt, reason }, true);
    setHandlerOnTimeOut('daily_bonus', 'dailyBonusWorker', [scheduled.serverDay, scheduled.generation, _dailySnapshot(scheduled), reason], Math.max(0, targetAt - Date.now()));
    return scheduled;
}

function _scheduleNextDailyServerDay(state) {
    const nextServerMidnightMs = twWallClockToEpochMs(0, 0, 0, 1);
    const delayMs = Math.max(1000, nextServerMidnightMs - Timing.getCurrentServerTime());
    return _scheduleDailyWorker(Date.now() + delayMs, 'next-server-day', state);
}

function checkAndScheduleDailyBonus() {
    if (!settings_cookies?.general?.show__auto_daily_bonus) {
        if (typeof clearPersistedTimeout === 'function') clearPersistedTimeout('daily_bonus');
        return { status: 'DISABLED' };
    }
    const today = _dailyServerDay();
    let state = _dailyReadState();
    if (state.serverDay !== today) {
        state = _dailyWriteState({
            serverDay: today, status: 'UNKNOWN', attempted: false, collected: false,
            nextDueAt: null, uncertain: null, reason: 'new-server-day'
        });
    }
    if (state.status === 'DONE') {
        _scheduleNextDailyServerDay(state);
        return { status: 'DONE' };
    }
    if ((state.status === 'SOFT_PAUSED' || state.status === 'UNCERTAIN') && state.nextDueAt > Date.now()) {
        _scheduleDailyWorker(state.nextDueAt, state.status === 'UNCERTAIN' ? 'uncertain-reconcile' : 'soft-pause', state);
        return { status: state.status };
    }
    _scheduleDailyWorker(Date.now(), state.status === 'UNCERTAIN' ? 'uncertain-reconcile' : 'daily-due', state);
    return { status: 'SCHEDULED' };
}

function _dailyResponseError(response, url) {
    if (response?.ok) return response;
    const error = new Error('HTTP ' + (response?.status || 0));
    error.status = Number(response?.status) || 0;
    error.url = response?.url || url;
    throw error;
}

function _dailyNetwork(fields, run) {
    return window.PremiumFeaturesDiagnostics?.request
        ? window.PremiumFeaturesDiagnostics.request(fields, run)
        : Promise.resolve().then(run);
}

function _parseDailyBonus(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const initScriptText = Array.from(doc.querySelectorAll('script'))
        .map(script => script.textContent)
        .find(text => text.includes('DailyBonus.init('));
    if (!initScriptText) return null;
    const start = initScriptText.indexOf('DailyBonus.init(') + 'DailyBonus.init('.length;
    let depth = 0;
    let position = start;
    while (position < initScriptText.length) {
        if (initScriptText[position] === '{') depth++;
        else if (initScriptText[position] === '}' && --depth === 0) break;
        position++;
    }
    try { return JSON.parse(initScriptText.slice(start, position + 1)); } catch (_error) { return null; }
}

async function _readDailyBonus(reason) {
    const url = game_data.link_base_pure + 'info_player&mode=daily_bonus';
    return window.PremiumFeaturesSingleFlight.run('daily-bonus-state:' + _dailyServerDay(), async function () {
        const response = await _dailyNetwork({
            feature: 'daily-bonus', taskKey: 'daily-bonus', logicalResource: 'daily-bonus-state',
            method: 'GET', reason
        }, () => fetch(url, { credentials: 'include' }));
        _dailyResponseError(response, url);
        return _parseDailyBonus(await response.text());
    });
}

async function runDailyBonusWorker(expectedDay, expectedGeneration, expectedHash, reason) {
    if (!settings_cookies?.general?.show__auto_daily_bonus) return { status: 'DISABLED' };
    const today = _dailyServerDay();
    let state = _dailyReadState();
    if (state.serverDay !== today) {
        state = _dailyWriteState({ serverDay: today, status: 'UNKNOWN', attempted: false, collected: false, uncertain: null });
    }
    if (!_dailyLeaseActive()) return _deferDailyLease('lease-before-read');
    if (state.serverDay !== expectedDay || state.generation !== Number(expectedGeneration) || _dailySnapshot(state) !== expectedHash) {
        return checkAndScheduleDailyBonus();
    }
    if (state.status === 'DONE') return _scheduleNextDailyServerDay(state);

    const readResult = await window.PremiumFeaturesAsync.runResilientTask({
        key: 'daily-bonus:state', feature: 'daily-bonus', logicalResource: 'daily-bonus-state',
        method: 'GET', url: game_data.link_base_pure + 'info_player&mode=daily_bonus',
        snapshotHash: String(state.serverDay), run: () => _readDailyBonus(reason)
    });
    if (readResult.status !== 'SUCCESS') {
        if (readResult.status !== 'HARD_STOP') {
            const retryAt = Number(readResult.retryAt) || Date.now() + 60000;
            const paused = _dailyWriteState({ status: 'SOFT_PAUSED', nextDueAt: retryAt, reason: 'state-fetch-failed' });
            _scheduleDailyWorker(retryAt, 'soft-pause', paused);
        }
        return readResult;
    }
    if (!_dailyLeaseActive()) return _deferDailyLease('lease-after-read');
    const bonusData = readResult.value;
    if (!bonusData?.chests) {
        const paused = _dailyWriteState({ status: 'SOFT_PAUSED', nextDueAt: Date.now() + 30000, reason: 'state-parse-failed' });
        _scheduleDailyWorker(paused.nextDueAt, 'parse-reconcile', paused);
        return { status: 'SOFT_PAUSED' };
    }
    const targetChest = Object.values(bonusData.chests).find(chest => !chest.is_locked && !chest.is_collected);
    if (!targetChest) {
        if (state.uncertain) _dailyInvalidateBuildResources('daily-bonus-uncertain-confirmed');
        const done = _dailyWriteState({ status: 'DONE', attempted: true, collected: false, nextDueAt: null, uncertain: null, reason: 'nothing-collectible' });
        _scheduleNextDailyServerDay(done);
        return { status: 'DONE' };
    }
    return _collectDailyBonus(targetChest.day, state);
}

async function _collectDailyBonus(day, expectedState) {
    if (!settings_cookies?.general?.show__auto_daily_bonus) {
        if (typeof clearPersistedTimeout === 'function') clearPersistedTimeout('daily_bonus');
        return { status: 'DISABLED' };
    }
    if (!_dailyLeaseActive()) return _deferDailyLease('lease-before-collect');
    const current = _dailyReadState();
    if (current.generation !== expectedState.generation || current.serverDay !== expectedState.serverDay) return { status: 'STALE_GENERATION' };
    const executing = _dailyWriteState({ status: 'EXECUTING', attempted: true, reason: 'collect', uncertain: null });
    const url = game_data.link_base_pure + 'daily_bonus&ajaxaction=open';
    const snapshotHash = _dailySnapshot(executing);
    const result = await window.PremiumFeaturesAsync.runResilientTask({
        key: 'daily-bonus:mutation', feature: 'daily-bonus', logicalResource: 'daily-bonus-collect',
        method: 'POST', url, mutation: true, leaseKey: 'daily-bonus', snapshotHash: String(day),
        scheduler: window.PremiumFeaturesBackgroundScheduler,
        reconcile: function () {
            const latest = _dailyReadState();
            _scheduleDailyWorker(Date.now(), 'uncertain-reconcile', latest);
        },
        run: async function () {
            if (!settings_cookies?.general?.show__auto_daily_bonus) {
                return Promise.reject(Object.assign(new Error('Daily Bonus disabled before mutation'), { code: 'STALE_CONFIG' }));
            }
            if (window.PremiumFeaturesBotProtection?.isActive?.()) {
                return Promise.reject(Object.assign(new Error('Bot protection active'), { code: 'HARD_STOP' }));
            }
            if (!_dailyLeaseActive()) {
                const error = new Error('Daily Bonus lease lost');
                error.code = 'LEASE_LOST';
                throw error;
            }
            const response = await _dailyNetwork({
                feature: 'daily-bonus', taskKey: 'daily-bonus', logicalResource: 'daily-bonus-collect',
                method: 'POST', reason: 'collect'
            }, () => fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'tribalwars-ajax': '1', 'x-requested-with': 'XMLHttpRequest' },
                referrer: game_data.link_base_pure + 'info_player&mode=daily_bonus',
                body: 'day=' + encodeURIComponent(day) + '&from_screen=profile&h=' + encodeURIComponent(game_data.csrf),
                credentials: 'include'
            }));
            _dailyResponseError(response, url);
            try {
                return await response.json();
            } catch (error) {
                error.afterTransmission = true;
                throw error;
            }
        }
    });
    if (result.status === 'UNCERTAIN') {
        _dailyWriteState({
            status: 'UNCERTAIN', nextDueAt: result.retryAt, reason: 'collect-uncertain',
            uncertain: { day, snapshotHash, at: Date.now() }
        });
        return result;
    }
    if (result.status === 'SOFT_PAUSED') {
        const paused = _dailyWriteState({ status: 'SOFT_PAUSED', nextDueAt: result.retryAt, reason: 'collect-failed' });
        _scheduleDailyWorker(result.retryAt, 'soft-pause', paused);
        return result;
    }
    if (result.stale || result.failure?.error?.code === 'STALE_CONFIG') {
        if (typeof clearPersistedTimeout === 'function') clearPersistedTimeout('daily_bonus');
        _dailyWriteState({ status: 'UNKNOWN', nextDueAt: null, reason: 'disabled-before-mutation', uncertain: null });
        return { status: 'DISABLED' };
    }
    if (result.status !== 'SUCCESS') {
        if (result.status !== 'HARD_STOP') {
            const paused = _dailyWriteState({ status: 'SOFT_PAUSED', nextDueAt: result.retryAt || Date.now() + 300000, reason: 'collect-confirmed-failure' });
            _scheduleDailyWorker(paused.nextDueAt, 'soft-pause', paused);
        }
        return result;
    }
    if (!_dailyLeaseActive()) {
        const retryAt = Date.now() + 30000;
        const uncertain = _dailyWriteState({
            status: 'UNCERTAIN', nextDueAt: retryAt, reason: 'lease-lost-after-response',
            uncertain: { day, snapshotHash, at: Date.now() }
        });
        _scheduleDailyWorker(retryAt, 'uncertain-reconcile', uncertain);
        return { status: 'UNCERTAIN', retryAt };
    }
    if (result.value?.error) {
        showAutoHideBox(t('dailyBonus.apiError', { error: result.value.error }), true);
        const done = _dailyWriteState({ status: 'DONE', attempted: true, collected: false, nextDueAt: null, reason: 'server-rejected', uncertain: null });
        _scheduleNextDailyServerDay(done);
        return { status: 'DONE' };
    }
    showAutoHideBox(t('dailyBonus.collectedDay', { day }), false);
    if (typeof DailyBonus !== 'undefined') DailyBonus?.reportViewed?.();
    _dailyInvalidateBuildResources('daily-bonus-resource-change');
    const done = _dailyWriteState({ status: 'DONE', attempted: true, collected: true, nextDueAt: null, reason: 'collected', uncertain: null });
    _scheduleNextDailyServerDay(done);
    return { status: 'DONE' };
}

function autoDailyBonusCollect() {
    const state = _dailyReadState();
    return runDailyBonusWorker(state.serverDay, state.generation, _dailySnapshot(state), 'legacy-entry');
}

async function runDailyBonusWorkerSafely() {
    try {
        return await runDailyBonusWorker.apply(null, arguments);
    } catch (error) {
        if (error?.code === 'HARD_STOP') throw error;
        const state = _dailyReadState();
        const afterTransmission = state.status === 'EXECUTING';
        const retryAt = Date.now() + (afterTransmission ? 30000 : 60000);
        const recovered = _dailyWriteState({
            status: afterTransmission ? 'UNCERTAIN' : 'SOFT_PAUSED',
            nextDueAt: retryAt,
            reason: afterTransmission ? 'worker-exception-uncertain' : 'worker-exception-soft-pause',
            uncertain: afterTransmission ? (state.uncertain || { at: Date.now() }) : null
        });
        _scheduleDailyWorker(retryAt, afterTransmission ? 'uncertain-reconcile' : 'soft-pause', recovered);
        return { status: afterTransmission ? 'UNCERTAIN' : 'SOFT_PAUSED', retryAt, error };
    }
}

if (typeof registerTimeoutHandler === 'function') {
    registerTimeoutHandler('dailyBonusWorker', runDailyBonusWorkerSafely);
    registerTimeoutHandler('dailyBonusCheck', checkAndScheduleDailyBonus);
}
