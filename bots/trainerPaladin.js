// Bot: Auto Paladin Trainer — persisted event time, fenced executor and uncertain reconciliation.

const PALADIN_STATE_KEY = 'twpf_paladin_state_v1:' + encodeURIComponent([
    window.location?.hostname || 'unknown-host',
    window.game_data?.world || 'unknown-world',
    window.game_data?.player?.id || 'unknown-player'
].join(':'));

function _paladinDefaultState() {
    const legacyEndSec = Number(localStorage.getItem('statue_knight_endtime')) || 0;
    return {
        state: legacyEndSec * 1000 > Timing.getCurrentServerTime() ? 'TRAINING' : 'IDLE',
        generation: 1,
        trainingEndsAt: legacyEndSec ? legacyEndSec * 1000 : null,
        knightId: null,
        regimenId: null,
        level: null,
        nextDueAt: null,
        reason: legacyEndSec ? 'legacy-state' : 'initial',
        uncertain: null,
        updatedAt: 0
    };
}

function _readPaladinState() {
    try {
        return Object.assign(_paladinDefaultState(), JSON.parse(localStorage.getItem(PALADIN_STATE_KEY) || '{}'));
    } catch (_error) {
        return _paladinDefaultState();
    }
}

function _paladinSnapshot(state) {
    const value = {
        generation: Number(state?.generation) || 0,
        state: state?.state || 'IDLE',
        trainingEndsAt: Number(state?.trainingEndsAt) || null,
        knightId: state?.knightId || null,
        regimenId: state?.regimenId || null,
        uncertain: state?.uncertain || null
    };
    return window.PremiumFeaturesAsync?.stableSnapshotHash?.(value) || JSON.stringify(value);
}

function _paladinWorkSnapshot(state) {
    const value = {
        knightId: state?.knightId || null,
        regimenId: state?.regimenId || null,
        trainingEndsAt: Number(state?.trainingEndsAt) || null,
        level: Number(state?.level) || null,
        uncertain: state?.uncertain || null
    };
    return window.PremiumFeaturesAsync?.stableSnapshotHash?.(value) || JSON.stringify(value);
}

function _writePaladinState(patch, options = {}) {
    const previous = _readPaladinState();
    const next = Object.assign({}, previous, patch, {
        generation: options.keepGeneration ? previous.generation : previous.generation + 1,
        updatedAt: Date.now()
    });
    localStorage.setItem(PALADIN_STATE_KEY, JSON.stringify(next));
    if (next.trainingEndsAt) localStorage.setItem('statue_knight_endtime', String(Math.floor(next.trainingEndsAt / 1000)));
    window.PremiumFeaturesCoordination?.broadcast?.('paladin-state', {
        state: next,
        source: window.PremiumFeaturesCoordination?.instanceId || 'local'
    });
    return next;
}

function _paladinEnabled() {
    return Boolean(settings_cookies?.general?.show__auto_paladin_train?.enabled);
}

function _paladinMaxLevel() {
    const configured = Number(settings_cookies?.general?.show__auto_paladin_train?.maxLevel);
    return Number.isInteger(configured) && configured > 0 ? configured : 30;
}

function _paladinLeaseActive() {
    const coordinator = window.PremiumFeaturesCoordination;
    if (!coordinator?.readLease) return true;
    const lease = coordinator.readLease('paladin');
    return Boolean(lease && lease.owner === coordinator.tabId &&
        lease.instanceId === coordinator.instanceId && lease.expiresAt > Date.now());
}

function _deferPaladinLease(reason) {
    const lease = window.PremiumFeaturesCoordination?.readLease?.('paladin');
    const dueAt = Math.max(Date.now() + 1000, Number(lease?.expiresAt) + 50 || 0);
    const state = _readPaladinState();
    _schedulePaladinWorker(dueAt, reason || 'lease-deferred', state);
    return { status: 'WAITING_LEASE', dueAt };
}

function _schedulePaladinWorker(dueAt, reason, state) {
    const current = state || _readPaladinState();
    const targetAt = Math.max(Date.now(), Number(dueAt) || Date.now());
    const scheduled = _writePaladinState({ nextDueAt: targetAt, reason }, { keepGeneration: true });
    setHandlerOnTimeOut(
        'auto_trainer_paladin',
        'paladinTrainerWorker',
        [scheduled.generation, _paladinSnapshot(scheduled), reason],
        Math.max(0, targetAt - Date.now())
    );
    return scheduled;
}

function schedulePaladinTrainerCheck(waitMs) {
    return _schedulePaladinWorker(Date.now() + Math.max(0, Number(waitMs) || 0), 'legacy-schedule');
}

/** On reload, a known training end is simply re-armed; no GET is performed. */
function checkAndSchedulePaladinTrainer() {
    if (!_paladinEnabled()) {
        if (typeof clearPersistedTimeout === 'function') clearPersistedTimeout('auto_trainer_paladin');
        return { status: 'DISABLED' };
    }
    const storedFn = localStorage.getItem('function_auto_trainer_paladin') || '';
    if (storedFn.includes('location.href') && typeof clearPersistedTimeout === 'function') {
        clearPersistedTimeout('auto_trainer_paladin');
    }
    const state = _readPaladinState();
    const serverNow = Timing.getCurrentServerTime();
    const configuredMaxLevel = _paladinMaxLevel();
    if (state.state === 'COMPLETE' && Number(state.level) >= configuredMaxLevel) {
        return { status: 'COMPLETE' };
    }
    if (state.trainingEndsAt && state.trainingEndsAt > serverNow) {
        const dueAt = Date.now() + state.trainingEndsAt - serverNow;
        _schedulePaladinWorker(dueAt, 'known-training-finish', Object.assign({}, state, { state: 'TRAINING' }));
        return { status: 'TRAINING', dueAt };
    }
    if ((state.state === 'SOFT_PAUSED' || state.state === 'UNCERTAIN') && state.nextDueAt > Date.now()) {
        _schedulePaladinWorker(state.nextDueAt, state.state === 'UNCERTAIN' ? 'uncertain-reconcile' : 'soft-pause', state);
        return { status: state.state, dueAt: state.nextDueAt };
    }
    _schedulePaladinWorker(Date.now(), state.state === 'UNCERTAIN' ? 'uncertain-reconcile' : 'state-unknown', state);
    return { status: 'CHECKING', dueAt: Date.now() };
}

function _parseKnightData(doc, strict = false) {
    const scriptText = Array.from(doc.querySelectorAll('script'))
        .map(script => script.textContent)
        .find(text => text.includes('receiveKnightsData'));
    if (!scriptText) return null;
    const fnStart = scriptText.indexOf('receiveKnightsData(');
    const firstBracket = scriptText.indexOf('[', fnStart);
    const bracketClose = scriptText.indexOf(']', firstBracket);
    const objectStart = scriptText.indexOf('{', bracketClose);
    if (objectStart === -1) return null;
    let depth = 0;
    let position = objectStart;
    while (position < scriptText.length) {
        if (scriptText[position] === '{') depth++;
        else if (scriptText[position] === '}' && --depth === 0) break;
        position++;
    }
    try {
        const knights = JSON.parse(scriptText.slice(objectStart, position + 1));
        return Object.values(knights)[0] ?? null;
    } catch (error) {
        console.error('[PaladinTrainer] Failed to parse knights data:', error);
        if (strict) throw error;
        return null;
    }
}

function _paladinResponseError(response, url) {
    if (response?.ok) return response;
    const error = new Error('HTTP ' + (response?.status || 0));
    error.status = Number(response?.status) || 0;
    error.url = response?.url || url;
    throw error;
}

function _paladinNetwork(fields, run) {
    return window.PremiumFeaturesDiagnostics?.request
        ? window.PremiumFeaturesDiagnostics.request(fields, run)
        : Promise.resolve().then(run);
}

async function _fetchPaladinState(reason) {
    const url = game_data.link_base_pure + 'statue';
    return window.PremiumFeaturesSingleFlight.run('paladin-state', async function () {
        const response = await _paladinNetwork({
            feature: 'paladin', taskKey: 'paladin', logicalResource: 'paladin-state',
            method: 'GET', reason
        }, () => fetch(url, { credentials: 'include' }));
        _paladinResponseError(response, url);
        return _parseKnightData(new DOMParser().parseFromString(await response.text(), 'text/html'), true);
    });
}

function _observePaladinKnight(knight, reason) {
    if (!knight) return _writePaladinState({
        state: 'IDLE', trainingEndsAt: null, nextDueAt: null, reason: reason || 'no-paladin', uncertain: null
    });
    const trainingEndsAt = Number(knight.activity?.finish_time) * 1000 || null;
    return _writePaladinState({
        state: knight.current_regimen !== null ? 'TRAINING' : 'IDLE',
        trainingEndsAt,
        knightId: String(knight.id),
        regimenId: knight.current_regimen != null ? String(knight.current_regimen) : null,
        level: Number(knight.level) || 0,
        nextDueAt: null,
        reason: reason || 'observed',
        uncertain: null
    });
}

async function runPaladinTrainerWorker(expectedGeneration, expectedHash, reason) {
    if (!_paladinEnabled()) return { status: 'DISABLED' };
    let state = _readPaladinState();
    if (!_paladinLeaseActive()) return _deferPaladinLease('lease-before-read');
    if (Number(state.generation) !== Number(expectedGeneration) || _paladinSnapshot(state) !== expectedHash) {
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: 'paladin', taskKey: 'paladin', status: 'SKIPPED', reason: 'stale-generation'
        });
        // The retained timeout may be picked up after an owner crashed mid-callback. Rebuild from
        // the latest persisted state so EXECUTING/UNCERTAIN is reconciled instead of orphaned.
        return checkAndSchedulePaladinTrainer();
    }
    state = _writePaladinState({ state: 'CHECKING', nextDueAt: null, reason }, { keepGeneration: true });
    const result = await window.PremiumFeaturesAsync.runResilientTask({
        key: 'paladin:state', feature: 'paladin', logicalResource: 'paladin-state', method: 'GET',
        url: game_data.link_base_pure + 'statue', snapshotHash: _paladinWorkSnapshot(state),
        run: () => _fetchPaladinState(reason)
    });
    if (result.status !== 'SUCCESS') {
        if (result.status !== 'HARD_STOP') {
            const retryAt = Number(result.retryAt) || Date.now() + 60000;
            const paused = _writePaladinState({ state: 'SOFT_PAUSED', nextDueAt: retryAt, reason: 'state-fetch-failed' });
            _schedulePaladinWorker(retryAt, 'soft-pause', paused);
        }
        return result;
    }
    if (!_paladinLeaseActive()) return _deferPaladinLease('lease-after-read');
    const knight = result.value;
    state = _observePaladinKnight(knight, 'server-state');
    if (!knight) return { status: 'IDLE' };

    const maxLevel = _paladinMaxLevel();
    if (Number(knight.level) >= Number(maxLevel)) {
        _writePaladinState({ state: 'COMPLETE', nextDueAt: null, reason: 'max-level' });
        return { status: 'COMPLETE' };
    }
    if (knight.current_regimen !== null) {
        if (state.trainingEndsAt > Timing.getCurrentServerTime()) {
            const dueAt = Date.now() + state.trainingEndsAt - Timing.getCurrentServerTime();
            _schedulePaladinWorker(dueAt, 'known-training-finish', state);
            return { status: 'TRAINING', dueAt };
        }
        const paused = _writePaladinState({ state: 'SOFT_PAUSED', nextDueAt: Date.now() + 30000, reason: 'training-end-unknown' });
        _schedulePaladinWorker(paused.nextDueAt, 'unknown-training-end', paused);
        return { status: 'SOFT_PAUSED' };
    }

    const regimen = (knight.usable_regimens || [])[0];
    if (!regimen) return { status: 'IDLE' };
    return _startPaladinTraining(String(knight.id), String(regimen.id), Number(regimen.duration) || 0, state);
}

async function _startPaladinTraining(knightId, regimenId, durationSec, expectedState) {
    if (!_paladinEnabled()) {
        if (typeof clearPersistedTimeout === 'function') clearPersistedTimeout('auto_trainer_paladin');
        return { status: 'DISABLED' };
    }
    if (!_paladinLeaseActive()) return _deferPaladinLease('lease-before-training');
    const current = _readPaladinState();
    if (current.generation !== expectedState.generation || _paladinSnapshot(current) !== _paladinSnapshot(expectedState) ||
        current.knightId !== knightId || current.state !== 'IDLE') {
        return { status: 'STALE_GENERATION' };
    }
    const csrf = game_data?.csrf;
    if (!csrf) return { status: 'FAILED' };
    const executing = _writePaladinState({ state: 'EXECUTING', regimenId, reason: 'start-training' });
    const mutationSnapshot = _paladinSnapshot(executing);
    const url = game_data.link_base_pure + 'statue&ajaxaction=regimen';
    const params = new URLSearchParams({ knight: knightId, regimen: regimenId, cheap: '0', h: csrf });
    const result = await window.PremiumFeaturesAsync.runResilientTask({
        key: 'paladin:mutation', feature: 'paladin', logicalResource: 'paladin-training',
        method: 'POST', url, mutation: true, leaseKey: 'paladin', snapshotHash: mutationSnapshot,
        scheduler: window.PremiumFeaturesBackgroundScheduler,
        reconcile: function () {
            const latest = _readPaladinState();
            _schedulePaladinWorker(Date.now(), 'uncertain-reconcile', latest);
        },
        run: async function () {
            if (!_paladinEnabled()) return Promise.reject(Object.assign(new Error('Paladin disabled before mutation'), { code: 'STALE_CONFIG' }));
            if (window.PremiumFeaturesBotProtection?.isActive?.()) {
                return Promise.reject(Object.assign(new Error('Bot protection active'), { code: 'HARD_STOP' }));
            }
            if (!_paladinLeaseActive()) {
                const error = new Error('Paladin lease lost');
                error.code = 'LEASE_LOST';
                throw error;
            }
            const response = await _paladinNetwork({
                feature: 'paladin', taskKey: 'paladin', logicalResource: 'paladin-training',
                method: 'POST', reason: 'start-training'
            }, () => fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'tribalwars-ajax': '1', 'x-requested-with': 'XMLHttpRequest' },
                body: params.toString(), credentials: 'include', mode: 'cors'
            }));
            _paladinResponseError(response, url);
            try {
                return await response.json();
            } catch (error) {
                error.afterTransmission = true;
                throw error;
            }
        }
    });
    if (result.status === 'UNCERTAIN') {
        _writePaladinState({
            state: 'UNCERTAIN', nextDueAt: result.retryAt, reason: 'start-uncertain',
            uncertain: { knightId, regimenId, snapshotHash: mutationSnapshot, at: Date.now() }
        });
        return result;
    }
    if (result.status === 'SOFT_PAUSED') {
        const paused = _writePaladinState({ state: 'SOFT_PAUSED', nextDueAt: result.retryAt, reason: 'start-failed' });
        _schedulePaladinWorker(result.retryAt, 'soft-pause', paused);
        return result;
    }
    if (result.stale || result.failure?.error?.code === 'STALE_CONFIG') {
        if (typeof clearPersistedTimeout === 'function') clearPersistedTimeout('auto_trainer_paladin');
        _writePaladinState({ state: 'IDLE', nextDueAt: null, reason: 'disabled-before-mutation', uncertain: null });
        return { status: 'DISABLED' };
    }
    if (result.status !== 'SUCCESS') {
        if (result.status !== 'HARD_STOP') {
            const retryAt = Number(result.retryAt) || Date.now() + 60000;
            const paused = _writePaladinState({ state: 'SOFT_PAUSED', nextDueAt: retryAt, reason: 'training-confirmed-failure' });
            _schedulePaladinWorker(retryAt, 'soft-pause', paused);
        }
        return result;
    }
    if (!_paladinLeaseActive()) {
        const retryAt = Date.now() + 30000;
        const uncertain = _writePaladinState({
            state: 'UNCERTAIN', nextDueAt: retryAt, reason: 'lease-lost-after-response',
            uncertain: { knightId, regimenId, snapshotHash: mutationSnapshot, at: Date.now() }
        });
        _schedulePaladinWorker(retryAt, 'uncertain-reconcile', uncertain);
        return { status: 'UNCERTAIN', retryAt };
    }

    showAutoHideBox(t('trainerPaladin.trainingStarted'), false);
    const data = result.value;
    const finishRaw = data?.response?.knight?.activity?.finish_time ?? data?.response?.endtime ?? data?.response?.end_time;
    let trainingEndsAt = typeof finishRaw === 'number'
        ? finishRaw * 1000
        : finishRaw ? new Date(String(finishRaw).replace(' ', 'T')).getTime() : null;
    if (!Number.isFinite(trainingEndsAt) && durationSec > 0) {
        trainingEndsAt = Timing.getCurrentServerTime() + durationSec * 1000;
    }
    const trained = _writePaladinState({
        state: trainingEndsAt ? 'TRAINING' : 'SOFT_PAUSED',
        trainingEndsAt: Number.isFinite(trainingEndsAt) ? trainingEndsAt : null,
        nextDueAt: null, reason: trainingEndsAt ? 'training-started' : 'training-end-unknown', uncertain: null
    });
    if (game_data?.screen === 'overview' && typeof getStatueInfo === 'function') getStatueInfo();
    const dueAt = trainingEndsAt
        ? Date.now() + Math.max(0, trainingEndsAt - Timing.getCurrentServerTime())
        : Date.now() + 30000;
    _schedulePaladinWorker(dueAt, trainingEndsAt ? 'known-training-finish' : 'unknown-training-end', trained);
    return { status: 'TRAINING', dueAt };
}

// Kept for callers from earlier versions; it now enters the fenced worker rather than fetching directly.
function fetchAndStartPaladinTraining() {
    const state = _readPaladinState();
    return runPaladinTrainerWorker(state.generation, _paladinSnapshot(state), 'legacy-entry');
}

function _reschedulePaladinFromPage() {
    return checkAndSchedulePaladinTrainer();
}

function installPaladinDomObserver() {
    const runtime = window.PremiumFeaturesRuntimeRegistry;
    const target = document.getElementById('knight_activity');
    if (!runtime?.setObserver || !target || typeof MutationObserver !== 'function') return;
    runtime.setObserver('paladin:activity', function () {
        const observer = new MutationObserver(function () {
            runtime.setTimeout('paladin:activity-coalesce', function () {
                if (!_paladinEnabled()) return;
                const current = _readPaladinState();
                const endtime = Number(target.querySelector('span[data-endtime]')?.dataset?.endtime) * 1000 || null;
                if (endtime && endtime !== current.trainingEndsAt) {
                    const observed = _writePaladinState({
                        state: 'TRAINING', trainingEndsAt: endtime,
                        reason: 'statue-dom-change', uncertain: null
                    });
                    _schedulePaladinWorker(Date.now() + Math.max(0, endtime - Timing.getCurrentServerTime()), 'statue-dom-change', observed);
                } else if (!endtime && current.state === 'TRAINING') {
                    const observed = _writePaladinState({
                        state: 'IDLE', trainingEndsAt: null,
                        reason: 'statue-dom-training-ended', uncertain: null
                    });
                    _schedulePaladinWorker(Date.now(), 'statue-dom-training-ended', observed);
                }
            }, 100, true);
        });
        observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-endtime'] });
        return observer;
    }, true);
}

function injectScriptAutoTrainerPaladin() {
    if (!_paladinEnabled()) {
        if (typeof clearPersistedTimeout === 'function') clearPersistedTimeout('auto_trainer_paladin');
        return;
    }
    installPaladinDomObserver();
    const knight = _parseKnightData(document);
    if (knight) {
        const observed = _observePaladinKnight(knight, 'statue-dom');
        if (observed.trainingEndsAt > Timing.getCurrentServerTime()) {
            _schedulePaladinWorker(Date.now() + observed.trainingEndsAt - Timing.getCurrentServerTime(), 'statue-dom-finish', observed);
        } else {
            _schedulePaladinWorker(Date.now(), 'statue-dom-free', observed);
        }
        return;
    }
    const endtimeEl = document.querySelector('#knight_activity span[data-endtime]');
    if (endtimeEl?.dataset?.endtime) {
        const observed = _writePaladinState({
            state: 'TRAINING', trainingEndsAt: Number(endtimeEl.dataset.endtime) * 1000,
            reason: 'statue-dom-endtime', uncertain: null
        });
        _schedulePaladinWorker(Date.now() + Math.max(0, observed.trainingEndsAt - Timing.getCurrentServerTime()), 'statue-dom-finish', observed);
    }
}

async function runPaladinTrainerWorkerSafely(expectedGeneration, expectedHash, reason) {
    try {
        return await runPaladinTrainerWorker(expectedGeneration, expectedHash, reason);
    } catch (error) {
        if (error?.code === 'HARD_STOP') throw error;
        const current = _readPaladinState();
        const afterTransmission = current.state === 'EXECUTING';
        const retryAt = Date.now() + (afterTransmission ? 30000 : 60000);
        const recovered = _writePaladinState({
            state: afterTransmission ? 'UNCERTAIN' : 'SOFT_PAUSED',
            nextDueAt: retryAt,
            reason: afterTransmission ? 'worker-exception-uncertain' : 'worker-exception-soft-pause',
            uncertain: afterTransmission ? (current.uncertain || {
                knightId: current.knightId,
                regimenId: current.regimenId,
                at: Date.now()
            }) : null
        });
        _schedulePaladinWorker(retryAt, afterTransmission ? 'uncertain-reconcile' : 'soft-pause', recovered);
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: 'paladin', taskKey: 'paladin',
            status: afterTransmission ? 'UNCERTAIN' : 'SOFT_PAUSE',
            reason: 'worker-exception:' + (error?.message || String(error))
        });
        return { status: afterTransmission ? 'UNCERTAIN' : 'SOFT_PAUSED', retryAt, error };
    }
}

if (typeof registerTimeoutHandler === 'function') {
    registerTimeoutHandler('paladinTrainerWorker', runPaladinTrainerWorkerSafely);
    registerTimeoutHandler('paladinTrainerCheck', checkAndSchedulePaladinTrainer);
}
