// Bot: Auto Build Instant Free — event-driven, generation-fenced and multi-tab safe.

const BUILD_INSTANT_FREE_WINDOW_SEC = 180;
const BUILD_INSTANT_COMPLETION_MARGIN_MS = 2000;
const BUILD_INSTANT_FALLBACK_MS = 5 * 60 * 1000;
const BUILD_INSTANT_CONFIRMATION_LEAD_MS = 60 * 1000;
let buildInstantObservedRoot = null;
const buildInstantNeedsFreshAfterHardStop = new Set();

function markBuildInstantHardStopRecovery() {
    if (!_buildInstantEnabled()) return;
    Object.keys(localStorage).filter(key => key.startsWith('endTime_build_instant_free_'))
        .forEach(key => buildInstantNeedsFreshAfterHardStop.add(
            key.slice('endTime_build_instant_free_'.length)
        ));
    const state = _buildInstantStateApi();
    state?.listVillageIds?.().forEach(villageId => {
        if ((state.get(villageId)?.official?.queue || []).length) {
            buildInstantNeedsFreshAfterHardStop.add(String(villageId));
        }
    });
}

function restoreMissingBuildInstantWakes() {
    if (!_buildInstantEnabled()) return;
    const state = _buildInstantStateApi();
    state?.listVillageIds?.().forEach(villageId => {
        const vId = String(villageId);
        if (!(state.get(vId)?.official?.queue || []).length) return;
        if (localStorage.getItem('endTime_' + _buildInstantTaskId(vId)) ||
            window.PremiumFeaturesBackgroundScheduler?.hasTask?.('persistent-timeout:' + _buildInstantTaskId(vId))) return;
        checkAndScheduleBuildInstantFree(vId, { observeDom: false });
    });
}

function _observeBuildInstantActionDom(villageId) {
    const runtime = window.PremiumFeaturesRuntimeRegistry;
    if (!runtime?.setObserver || typeof MutationObserver !== 'function' ||
        String(villageId) !== String(game_data?.village?.id || '')) return;
    const root = document.querySelector('#building_wrapper');
    if (!root) {
        runtime.clearObserver?.('build-instant:current-action');
        buildInstantObservedRoot = null;
        return;
    }
    if (root === buildInstantObservedRoot) return;
    buildInstantObservedRoot = root;
    let lastCandidate = null;
    runtime.setObserver('build-instant:current-action', function () {
        const observer = new MutationObserver(function () {
            const button = root.querySelector?.('.btn-instant-free');
            const orderId = (button?.getAttribute('onclick') || '').match(/change_order\((\d+)/)?.[1] || null;
            if (!orderId) { lastCandidate = null; return; }
            if (lastCandidate === orderId) return;
            lastCandidate = orderId;
            if (String(_buildInstantStateApi()?.get(villageId)?.official?.instantFree?.orderId || '') === orderId) return;
            if (typeof observeBuildQueueDocument === 'function') {
                observeBuildQueueDocument(document, villageId, 'dom');
                checkAndScheduleBuildInstantFree(villageId, { observeDom: false });
            }
        });
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'onclick'] });
        return observer;
    }, true);
}

function _buildInstantHardStopped() {
    return Boolean(window.PremiumFeaturesBotProtection?.isActive?.() ||
        window.PremiumFeaturesBackgroundScheduler?.stats?.().hardStopped);
}

function _parkBuildInstantHardStop(villageId, official, uncertain) {
    if (window.PremiumFeaturesBotProtection?.isActive?.() &&
        !window.PremiumFeaturesBackgroundScheduler?.stats?.().hardStopped) {
        window.PremiumFeaturesBackgroundScheduler?.hardStop?.('bot-protection');
    }
    const vId = String(villageId);
    _scheduleBuildInstantWorker(vId, Date.now(), 'hard-stop-reconcile', official || {}, {
        orderId: uncertain?.orderId || null,
        uncertain: uncertain || null,
        statePatch: { state: uncertain ? 'UNCERTAIN' : 'STALE' }
    });
    return { status: 'HARD_STOP' };
}

// One confirmation tied to the known free window, never a repeating short poll.
function _buildInstantConfirmationAt(nextSlotAt, now) {
    const remaining = Number(nextSlotAt) - now;
    if (remaining <= 2000) return null;
    const preferred = Math.max(now + 30000, Number(nextSlotAt) - BUILD_INSTANT_CONFIRMATION_LEAD_MS);
    return preferred < Number(nextSlotAt) - 5000
        ? preferred
        : now + Math.floor(remaining / 2);
}

function _buildInstantActionProof(record, orderId, now) {
    const official = record?.official || {};
    const action = official.instantFree;
    const nextSlotAt = Number(official.nextSlotAt) || 0;
    return Boolean(action?.orderId && String(action.orderId) === String(orderId) &&
        (official.queue || []).length > 0 &&
        official.cancelIds?.some(id => String(id) === String(orderId)) &&
        nextSlotAt > now && now >= nextSlotAt - BUILD_INSTANT_FREE_WINDOW_SEC * 1000 &&
        (!action.availableFrom || now >= Number(action.availableFrom)) &&
        (!action.availableTo || now < Number(action.availableTo)));
}

function _buildInstantStateApi() {
    return window.PremiumFeaturesBuildState;
}

function _buildInstantEnabled() {
    return Boolean(settings_cookies?.general?.show__auto_build_instant_free);
}

function _buildInstantTaskId(villageId) {
    return 'build_instant_free_' + String(villageId);
}

function _buildInstantSnapshot(villageId, official) {
    const value = {
        villageId: String(villageId),
        generation: Number(official?.generation) || 0,
        queue: official?.queue || [],
        slots: official?.slots || [],
        cancelIds: official?.cancelIds || [],
        nextSlotAt: Number(official?.nextSlotAt) || null
    };
    return window.PremiumFeaturesAsync?.stableSnapshotHash?.(value) || JSON.stringify(value);
}

function _buildInstantLeaseActive(villageId) {
    const coordinator = window.PremiumFeaturesCoordination;
    if (!coordinator?.readLease) return true;
    const lease = coordinator.readLease('build-instant:' + String(villageId));
    return Boolean(lease && lease.owner === coordinator.tabId &&
        lease.instanceId === coordinator.instanceId && lease.expiresAt > Date.now());
}

function _deferBuildInstantLease(villageId, reason) {
    const vId = String(villageId);
    const lease = window.PremiumFeaturesCoordination?.readLease?.('build-instant:' + vId);
    const dueAt = Math.max(Date.now() + 1000, Number(lease?.expiresAt) + 50 || 0);
    const official = _buildInstantStateApi()?.get(vId)?.official || {};
    _scheduleBuildInstantWorker(vId, dueAt, reason || 'lease-deferred', official, {
        statePatch: { state: 'STALE' }
    });
    return { status: 'WAITING_LEASE', dueAt };
}

function _throwBuildInstantResponse(response, url) {
    if (response?.ok) return response;
    const error = new Error('HTTP ' + (response?.status || 0));
    error.status = Number(response?.status) || 0;
    error.url = response?.url || url;
    throw error;
}

function _buildInstantRequest(fields, run) {
    return window.PremiumFeaturesDiagnostics?.request
        ? window.PremiumFeaturesDiagnostics.request(fields, run)
        : Promise.resolve().then(run);
}

function _setBuildInstantState(villageId, patch, immediate) {
    return _buildInstantStateApi()?.setInstant?.(String(villageId), patch, immediate);
}

function _clearBuildInstantFreeTimeout(villageId) {
    const id = _buildInstantTaskId(villageId || game_data?.village?.id);
    if (typeof clearPersistedTimeout === 'function') clearPersistedTimeout(id);
}

function _scheduleBuildInstantWorker(villageId, dueAt, reason, official, extra = {}) {
    const vId = String(villageId);
    const state = _buildInstantStateApi();
    const currentOfficial = official || state?.get(vId)?.official || {};
    const generation = Number(currentOfficial.generation) || 0;
    const snapshotHash = _buildInstantSnapshot(vId, currentOfficial);
    const targetAt = Math.max(Date.now(), Number(dueAt) || Date.now());
    _setBuildInstantState(vId, Object.assign({
        state: reason === 'window-open' ? 'CHECKING' : 'WAITING_WINDOW',
        nextDueAt: targetAt,
        checkedOfficialGeneration: Number(extra.checkedOfficialGeneration) || 0,
        snapshotHash,
        reason,
        uncertain: extra.uncertain || null
    }, extra.statePatch || {}), true);
    setHandlerOnTimeOut(
        _buildInstantTaskId(vId),
        'instantFreeWorker',
        [vId, generation, snapshotHash, reason, extra.orderId || null],
        Math.max(0, targetAt - Date.now())
    );
}

/** Rebuilds the one relevant timer without fetching merely because the page reloaded. */
function checkAndScheduleBuildInstantFree(villageId, options = {}) {
    const vId = String(villageId || game_data?.village?.id || '');
    if (!vId) return { status: 'NO_VILLAGE' };
    if (!_buildInstantEnabled()) {
        if (vId === String(game_data?.village?.id || '')) {
            window.PremiumFeaturesRuntimeRegistry?.clearObserver?.('build-instant:current-action');
            buildInstantObservedRoot = null;
        }
        _clearBuildInstantFreeTimeout(vId);
        _setBuildInstantState(vId, { state: 'IDLE', nextDueAt: null, reason: 'disabled', uncertain: null }, true);
        return { status: 'DISABLED' };
    }

    const state = _buildInstantStateApi();
    _observeBuildInstantActionDom(vId);
    if (vId == String(game_data?.village?.id || '') &&
        document.querySelector('#building_wrapper') && document.querySelector('#buildings') &&
        typeof observeBuildQueueDocument === 'function' && options.observeDom !== false) {
        const cached = state?.get(vId);
        const liveButton = document.querySelector('.btn-instant-free');
        const liveOrderId = (liveButton?.getAttribute('onclick') || '').match(/change_order\((\d+)/)?.[1] || null;
        if (cached?.official?.source !== 'dom' || Date.now() - Number(cached.official.fetchedAt || 0) > 1000 ||
            (liveOrderId && String(cached?.official?.instantFree?.orderId || '') !== String(liveOrderId))) {
            observeBuildQueueDocument(document, vId, 'dom');
        }
    }

    const record = state?.get(vId);
    const official = record?.official || {};
    const instant = record?.instant || {};
    if (instant.state === 'UNCERTAIN') {
        const dueAt = Math.max(Date.now(), Number(instant.nextDueAt) || Date.now());
        const orderId = instant.uncertain?.orderId || instant.orderId || null;
        _scheduleBuildInstantWorker(vId, dueAt, 'uncertain-reconcile', official, {
            orderId,
            uncertain: instant.uncertain,
            statePatch: { state: 'UNCERTAIN', orderId: orderId != null ? String(orderId) : null }
        });
        return { status: 'UNCERTAIN', dueAt };
    }
    if (instant.state === 'SOFT_PAUSED' && Number(instant.nextDueAt) > Date.now()) {
        _scheduleBuildInstantWorker(vId, instant.nextDueAt, 'soft-pause', official, {
            statePatch: { state: 'SOFT_PAUSED' }
        });
        return { status: 'SOFT_PAUSED', dueAt: instant.nextDueAt };
    }
    // A fresh official observation of an empty queue must win over an older legacy mirror.
    // Falling back through `||` reused the previous slot after a confirmed instant completion,
    // rearmed the same window and caused one redundant inspection.
    const hasOfficialObservation = Number(official.generation) > 0 || Number(official.fetchedAt) > 0;
    const nextSlotAt = hasOfficialObservation
        ? Number(official.nextSlotAt) || 0
        : Number(typeof bqGet === 'function' ? bqGet('building_queue_next_slot', vId) : 0) || 0;
    if (!nextSlotAt || nextSlotAt <= Date.now()) {
        _clearBuildInstantFreeTimeout(vId);
        _setBuildInstantState(vId, { state: 'IDLE', nextDueAt: null, reason: 'no-active-build', uncertain: null }, true);
        return { status: 'IDLE' };
    }

    const freeAt = nextSlotAt - BUILD_INSTANT_FREE_WINDOW_SEC * 1000;
    if (Date.now() < freeAt) {
        _scheduleBuildInstantWorker(vId, freeAt, 'known-free-window', official, {
            statePatch: { confirmationAttempted: false }
        });
        return { status: 'WAITING_WINDOW', dueAt: freeAt };
    }

    const snapshotHash = _buildInstantSnapshot(vId, official);
    if (instant.state === 'WAITING_FREE_CONFIRMATION' && instant.snapshotHash === snapshotHash &&
        Number(instant.checkedOfficialGeneration) === Number(official.generation) &&
        Number(instant.nextDueAt) < nextSlotAt) {
        const dueAt = Math.max(Date.now(), Number(instant.nextDueAt) || Date.now());
        if (!localStorage.getItem('endTime_' + _buildInstantTaskId(vId))) {
            _scheduleBuildInstantWorker(vId, dueAt, 'free-confirmation', official, {
                checkedOfficialGeneration: official.generation,
                statePatch: { state: 'WAITING_FREE_CONFIRMATION', confirmationAttempted: true }
            });
        }
        return { status: 'WAITING_FREE_CONFIRMATION', dueAt };
    }
    if (instant.state === 'STALE' && instant.snapshotHash === snapshotHash &&
        Number(instant.checkedOfficialGeneration) === Number(official.generation)) {
        if (instant.reason === 'button-absent' && !instant.confirmationAttempted) {
            const confirmationAt = _buildInstantConfirmationAt(nextSlotAt, Date.now());
            if (confirmationAt) {
                _scheduleBuildInstantWorker(vId, confirmationAt, 'free-confirmation', official, {
                    checkedOfficialGeneration: official.generation,
                    statePatch: { state: 'WAITING_FREE_CONFIRMATION', confirmationAttempted: true }
                });
                return { status: 'WAITING_FREE_CONFIRMATION', dueAt: confirmationAt };
            }
        }
        const dueAt = Math.max(Date.now(), nextSlotAt + BUILD_INSTANT_COMPLETION_MARGIN_MS);
        if (!localStorage.getItem('endTime_' + _buildInstantTaskId(vId))) {
            _scheduleBuildInstantWorker(vId, dueAt, 'known-completion', official, {
                checkedOfficialGeneration: official.generation,
                statePatch: { state: 'STALE' }
            });
        }
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: 'build-instant', villageId: vId, taskKey: 'build-instant:' + vId,
            status: 'SKIPPED', reason: 'same-stale-snapshot'
        });
        return { status: 'STALE', dueAt };
    }

    _scheduleBuildInstantWorker(vId, Date.now(), 'window-open', official, {
        statePatch: { confirmationAttempted: false }
    });
    return { status: 'CHECKING', dueAt: Date.now() };
}

function initInstantFreeForAllVillages() {
    if (typeof getAllVillageIds !== 'function') return;
    if (!_buildInstantEnabled()) {
        getAllVillageIds().forEach(vId => _clearBuildInstantFreeTimeout(vId));
        return;
    }
    getAllVillageIds().forEach(vId => checkAndScheduleBuildInstantFree(vId));
}

/** A known build mutation is a legitimate reason to inspect the new queue once. */
function scheduleBuildInstantReconciliation(villageId, delayMs = 200) {
    const vId = String(villageId || game_data?.village?.id || '');
    if (!vId || !_buildInstantEnabled()) return { status: 'DISABLED' };
    const official = _buildInstantStateApi()?.get(vId)?.official || {};
    _scheduleBuildInstantWorker(vId, Date.now() + Math.max(0, Number(delayMs) || 0), 'known-build-mutation', official, {
        statePatch: { state: 'STALE', confirmationAttempted: false }
    });
    return { status: 'RECONCILING' };
}

async function _inspectBuildInstant(villageId, reason) {
    const vId = String(villageId);
    if (_buildInstantHardStopped()) {
        const error = new Error('Build Instant hard stop before state inspection');
        error.code = 'HARD_STOP';
        throw error;
    }
    if (!buildInstantNeedsFreshAfterHardStop.has(vId) && vId == String(game_data?.village?.id || '') &&
        document.querySelector('#building_wrapper') && document.querySelector('#buildings') &&
        typeof observeBuildQueueDocument === 'function') {
        return observeBuildQueueDocument(document, vId, 'dom');
    }
    if (typeof fetchVillageMainPage === 'function') {
        const result = await fetchVillageMainPage(vId);
        buildInstantNeedsFreshAfterHardStop.delete(vId);
        return typeof observeBuildQueueDocument === 'function'
            ? observeBuildQueueDocument(result.doc, vId, 'build-instant-' + reason)
            : { doc: result.doc };
    }
    const url = (typeof getVillageLinkBase === 'function' ? getVillageLinkBase(vId) : game_data.link_base_pure) + 'main';
    const response = await _buildInstantRequest({
        feature: 'build-instant', villageId: vId, logicalResource: 'village-main:' + vId,
        method: 'GET', reason
    }, () => fetch(url, { credentials: 'include' }));
    _throwBuildInstantResponse(response, url);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    buildInstantNeedsFreshAfterHardStop.delete(vId);
    return { doc };
}

function _buildInstantButtonData(observed) {
    const fromState = observed?.official?.instantFree;
    const button = observed?.doc?.querySelector?.('.btn-instant-free');
    const match = (button?.getAttribute('onclick') || '').match(/change_order\((\d+)/);
    const domOrderId = match?.[1] || null;
    if (fromState?.orderId && domOrderId && String(fromState.orderId) !== String(domOrderId)) {
        return { conflict: true };
    }
    if (fromState?.orderId) return fromState;
    // A DOM-only button is useful evidence for reconciliation, but cannot authorize a mutation
    // until the official BuildState observation agrees on its order ID.
    return domOrderId ? { conflict: true } : null;
}

async function runBuildInstantFreeWorker(villageId, expectedGeneration, expectedHash, reason, uncertainOrderId) {
    const vId = String(villageId || game_data?.village?.id || '');
    if (!_buildInstantEnabled() || !vId) return { status: 'DISABLED' };
    const state = _buildInstantStateApi();
    let record = state?.get(vId);
    if (_buildInstantHardStopped()) return _parkBuildInstantHardStop(vId, record?.official, record?.instant?.uncertain);
    if (!_buildInstantLeaseActive(vId)) return _deferBuildInstantLease(vId, 'lease-before-check');
    if (Number(record?.official?.generation) !== Number(expectedGeneration) ||
        _buildInstantSnapshot(vId, record?.official) !== expectedHash) {
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: 'build-instant', villageId: vId, taskKey: 'build-instant:' + vId,
            status: 'SKIPPED', reason: 'stale-snapshot'
        });
        return checkAndScheduleBuildInstantFree(vId, { observeDom: false });
    }

    _setBuildInstantState(vId, { state: 'CHECKING', nextDueAt: null, reason }, true);
    const inspectSnapshot = _buildInstantSnapshot(vId, record?.official);
    const result = await window.PremiumFeaturesAsync.runResilientTask({
        key: 'build-instant:inspect:' + vId,
        feature: 'build-instant', villageId: vId, logicalResource: 'village-main:' + vId,
        method: 'GET',
        url: (typeof getVillageLinkBase === 'function' ? getVillageLinkBase(vId) : game_data.link_base_pure) + 'main',
        snapshotHash: inspectSnapshot,
        run: () => _inspectBuildInstant(vId, reason)
    });
    if (result.status !== 'SUCCESS') {
        if (result.status === 'HARD_STOP') {
            _parkBuildInstantHardStop(vId, state?.get(vId)?.official, record?.instant?.uncertain);
        } else {
            const retryAt = Number(result.retryAt) || Date.now() + BUILD_INSTANT_FALLBACK_MS;
            const stillUncertain = Boolean(uncertainOrderId || record?.instant?.uncertain);
            _scheduleBuildInstantWorker(vId, retryAt,
                stillUncertain ? 'uncertain-reconcile' : 'soft-pause', record?.official, {
                    orderId: uncertainOrderId || record?.instant?.uncertain?.orderId || null,
                    uncertain: stillUncertain ? record?.instant?.uncertain : null,
                    statePatch: { state: stillUncertain ? 'UNCERTAIN' : 'SOFT_PAUSED' }
                });
        }
        return result;
    }

    if (!_buildInstantLeaseActive(vId)) return _deferBuildInstantLease(vId, 'lease-after-check');
    record = state?.get(vId);
    const inspectedGeneration = Number(record?.official?.generation) || 0;
    const inspectedHash = _buildInstantSnapshot(vId, record?.official);
    const button = _buildInstantButtonData(result.value);
    if (Number(state?.get(vId)?.official?.generation) !== inspectedGeneration ||
        _buildInstantSnapshot(vId, state?.get(vId)?.official) !== inspectedHash) {
        return checkAndScheduleBuildInstantFree(vId, { observeDom: false });
    }
    if (uncertainOrderId) {
        if (String(button?.orderId || '') !== String(uncertainOrderId) &&
            !record?.official?.cancelIds?.some(id => String(id) === String(uncertainOrderId))) {
            _setBuildInstantState(vId, { state: 'IDLE', uncertain: null, reason: 'uncertain-confirmed-complete' }, true);
            return checkAndScheduleBuildInstantFree(vId, { observeDom: false });
        }
        // A still-visible order after a lost response is not proof that the mutation was never
        // applied. Wait for another legitimate official state change; never repeat reduce blindly.
        const dueAt = Number(record.official.nextSlotAt) > Date.now()
            ? Number(record.official.nextSlotAt) + BUILD_INSTANT_COMPLETION_MARGIN_MS
            : Date.now() + BUILD_INSTANT_FALLBACK_MS;
        _scheduleBuildInstantWorker(vId, dueAt, 'uncertain-reconcile', record.official, {
            orderId: String(uncertainOrderId),
            uncertain: record.instant?.uncertain || { orderId: String(uncertainOrderId), at: Date.now() },
            statePatch: { state: 'UNCERTAIN' }
        });
        return { status: 'UNCERTAIN', dueAt };
    }
    if (!button?.orderId || button.conflict) {
        const snapshotHash = _buildInstantSnapshot(vId, record?.official);
        const hasOfficialWork = (record?.official?.queue || []).length > 0;
        const nextSlotAt = Number(record?.official?.nextSlotAt) || 0;
        if (!hasOfficialWork) {
            _clearBuildInstantFreeTimeout(vId);
            _setBuildInstantState(vId, {
                state: 'IDLE', nextDueAt: null, reason: 'no-active-build', uncertain: null,
                confirmationAttempted: false
            }, true);
            return { status: 'IDLE' };
        }
        const alreadyConfirmed = Boolean(record?.instant?.confirmationAttempted) || reason === 'free-confirmation';
        const confirmationAt = !alreadyConfirmed && nextSlotAt > Date.now()
            ? _buildInstantConfirmationAt(nextSlotAt, Date.now()) : null;
        if (confirmationAt) {
            _scheduleBuildInstantWorker(vId, confirmationAt, 'free-confirmation', record.official, {
                checkedOfficialGeneration: record.official.generation,
                statePatch: {
                    state: 'WAITING_FREE_CONFIRMATION', confirmationAttempted: true,
                    reason: button?.conflict ? 'action-conflict' : 'button-absent'
                }
            });
            return { status: 'WAITING_FREE_CONFIRMATION', dueAt: confirmationAt };
        }
        const dueAt = nextSlotAt > Date.now()
            ? nextSlotAt + BUILD_INSTANT_COMPLETION_MARGIN_MS
            : Date.now() + BUILD_INSTANT_FALLBACK_MS;
        _setBuildInstantState(vId, {
            state: 'STALE', nextDueAt: dueAt,
            checkedOfficialGeneration: record?.official?.generation || 0,
            snapshotHash, reason: button?.conflict ? 'action-conflict' : 'button-absent', uncertain: null,
            confirmationAttempted: true
        }, true);
        _scheduleBuildInstantWorker(vId, dueAt, nextSlotAt ? 'known-completion' : 'stale-fallback', record.official, {
            checkedOfficialGeneration: record.official.generation,
            statePatch: { state: 'STALE', confirmationAttempted: true }
        });
        return { status: 'STALE', dueAt };
    }

    const now = Date.now();
    if (button.availableFrom && now < button.availableFrom) {
        _scheduleBuildInstantWorker(vId, button.availableFrom, 'button-window', record.official, {
            orderId: button.orderId,
            statePatch: { state: 'WAITING_WINDOW', orderId: String(button.orderId), availableFrom: button.availableFrom, availableTo: button.availableTo }
        });
        return { status: 'WAITING_WINDOW' };
    }
    if (button.availableTo && now >= button.availableTo) {
        const dueAt = Number(record.official?.nextSlotAt) > now
            ? Number(record.official.nextSlotAt) + BUILD_INSTANT_COMPLETION_MARGIN_MS
            : now + BUILD_INSTANT_FALLBACK_MS;
        _setBuildInstantState(vId, {
            state: 'STALE', checkedOfficialGeneration: record.official.generation,
            snapshotHash: _buildInstantSnapshot(vId, record.official), reason: 'window-closed', nextDueAt: dueAt
        }, true);
        _scheduleBuildInstantWorker(vId, dueAt, 'window-closed-reconcile', record.official, {
            checkedOfficialGeneration: record.official.generation,
            statePatch: { state: 'STALE' }
        });
        return { status: 'STALE', dueAt };
    }
    return buildInstantFreeApiCall(button.orderId, vId, inspectedGeneration, inspectedHash);
}

async function buildInstantFreeApiCall(orderId, villageId, expectedGeneration, expectedHash) {
    const vId = String(villageId || game_data?.village?.id || '');
    const csrf = game_data?.csrf;
    const state = _buildInstantStateApi();
    const record = state?.get(vId);
    if (!vId || !csrf) return { status: 'FAILED' };
    if (!_buildInstantEnabled()) {
        _clearBuildInstantFreeTimeout(vId);
        return { status: 'DISABLED' };
    }
    if (_buildInstantHardStopped()) return _parkBuildInstantHardStop(vId, record?.official, record?.instant?.uncertain);
    if (!_buildInstantLeaseActive(vId)) return _deferBuildInstantLease(vId, 'lease-before-mutation');
    if (Number(record?.official?.generation) !== Number(expectedGeneration) ||
        _buildInstantSnapshot(vId, record?.official) !== expectedHash) {
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: 'build-instant', villageId: vId, taskKey: 'build-instant:' + vId,
            status: 'SKIPPED', reason: 'mutation-precondition'
        });
        return checkAndScheduleBuildInstantFree(vId, { observeDom: false });
    }
    if (!_buildInstantActionProof(record, orderId, Date.now())) {
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: 'build-instant', villageId: vId, taskKey: 'build-instant:' + vId,
            status: 'SKIPPED', reason: 'official-free-action-not-proven'
        });
        _setBuildInstantState(vId, {
            state: 'STALE', checkedOfficialGeneration: record.official.generation,
            snapshotHash: expectedHash, reason: 'official-free-action-not-proven',
            confirmationAttempted: true
        }, true);
        return checkAndScheduleBuildInstantFree(vId, { observeDom: false });
    }

    _setBuildInstantState(vId, { state: 'EXECUTING', orderId: String(orderId), reason: 'free-window' }, true);
    const linkBase = typeof getVillageLinkBase === 'function' ? getVillageLinkBase(vId) : game_data.link_base_pure;
    const url = linkBase + 'main&ajaxaction=build_order_reduce&h=' + csrf + '&id=' + orderId + '&destroy=0';
    const resilient = await window.PremiumFeaturesAsync.runResilientTask({
        key: 'build-instant:mutation:' + vId,
        feature: 'build-instant', villageId: vId, logicalResource: 'build-instant:' + vId,
        method: 'GET', url, mutation: true, leaseKey: 'build-instant:' + vId,
        snapshotHash: expectedHash,
        run: async function () {
            if (!_buildInstantEnabled()) return Promise.reject(Object.assign(new Error('Build Instant disabled before mutation'), { code: 'STALE_CONFIG' }));
            if (_buildInstantHardStopped()) {
                return Promise.reject(Object.assign(new Error('Bot protection active'), { code: 'HARD_STOP' }));
            }
            if (!_buildInstantLeaseActive(vId)) {
                const error = new Error('Build Instant lease lost');
                error.code = 'LEASE_LOST';
                throw error;
            }
            const latest = state?.get(vId);
            if (Number(latest?.official?.generation) !== Number(expectedGeneration) ||
                _buildInstantSnapshot(vId, latest?.official) !== expectedHash ||
                !_buildInstantActionProof(latest, orderId, Date.now())) {
                const error = new Error('Build Instant official action changed before network');
                error.code = 'STALE_GENERATION';
                throw error;
            }
            const response = await _buildInstantRequest({
                feature: 'build-instant', villageId: vId, logicalResource: 'build-instant:' + vId,
                method: 'GET', reason: 'instant-free-mutation'
            }, () => {
                const atNetwork = state?.get(vId);
                if (!_buildInstantEnabled() || _buildInstantHardStopped()) {
                    const error = new Error('Build Instant disabled or hard-stopped before network');
                    error.code = _buildInstantHardStopped() ? 'HARD_STOP' : 'STALE_CONFIG';
                    throw error;
                }
                if (!_buildInstantLeaseActive(vId)) {
                    const error = new Error('Build Instant lease lost immediately before network');
                    error.code = 'LEASE_LOST';
                    throw error;
                }
                if (Number(atNetwork?.official?.generation) !== Number(expectedGeneration) ||
                    _buildInstantSnapshot(vId, atNetwork?.official) !== expectedHash ||
                    !_buildInstantActionProof(atNetwork, orderId, Date.now())) {
                    const error = new Error('Build Instant action invalid immediately before network');
                    error.code = 'STALE_GENERATION';
                    throw error;
                }
                return fetch(url, {
                    method: 'GET',
                    headers: { accept: 'application/json, text/javascript, */*; q=0.01', 'tribalwars-ajax': '1', 'x-requested-with': 'XMLHttpRequest' },
                    credentials: 'include'
                });
            });
            _throwBuildInstantResponse(response, url);
            try {
                return await response.json();
            } catch (error) {
                error.afterTransmission = true;
                throw error;
            }
        }
    });

    if (resilient.status === 'UNCERTAIN') {
        const uncertain = { orderId: String(orderId), snapshotHash: expectedHash, at: Date.now() };
        const dueAt = Number(resilient.retryAt) || Date.now() + 30000;
        _scheduleBuildInstantWorker(vId, dueAt, 'uncertain-reconcile', state?.get(vId)?.official || {}, {
            orderId: String(orderId), uncertain,
            statePatch: { state: 'UNCERTAIN', orderId: String(orderId) }
        });
        _setBuildInstantState(vId, {
            state: 'UNCERTAIN', uncertain, nextDueAt: dueAt, reason: 'mutation-uncertain'
        }, true);
        return resilient;
    }
    if (resilient.status === 'SOFT_PAUSED') {
        _scheduleBuildInstantWorker(vId, resilient.retryAt, 'soft-pause', record.official, {
            statePatch: { state: 'SOFT_PAUSED' }
        });
        return resilient;
    }
    if (resilient.failure?.error?.code === 'STALE_GENERATION') {
        return checkAndScheduleBuildInstantFree(vId, { observeDom: false });
    }
    if (resilient.failure?.error?.code === 'LEASE_LOST') {
        return _deferBuildInstantLease(vId, 'lease-immediately-before-network');
    }
    if (resilient.stale || resilient.failure?.error?.code === 'STALE_CONFIG') {
        _clearBuildInstantFreeTimeout(vId);
        _setBuildInstantState(vId, { state: 'IDLE', nextDueAt: null, reason: 'disabled-before-mutation', uncertain: null }, true);
        return { status: 'DISABLED' };
    }
    if (resilient.status !== 'SUCCESS') {
        if (resilient.status === 'HARD_STOP') {
            _parkBuildInstantHardStop(vId, state?.get(vId)?.official, {
                orderId: String(orderId), snapshotHash: expectedHash, at: Date.now()
            });
        } else {
            const dueAt = Number(record.official?.nextSlotAt) > Date.now()
                ? Number(record.official.nextSlotAt) + BUILD_INSTANT_COMPLETION_MARGIN_MS
                : Date.now() + BUILD_INSTANT_FALLBACK_MS;
            _scheduleBuildInstantWorker(vId, dueAt, 'mutation-confirmed-failure', record.official, {
                statePatch: { state: 'STALE' }
            });
        }
        return resilient;
    }
    if (!_buildInstantLeaseActive(vId)) {
        const retryAt = Date.now() + 30000;
        _setBuildInstantState(vId, {
            state: 'UNCERTAIN', uncertain: { orderId: String(orderId), snapshotHash: expectedHash, at: Date.now() },
            nextDueAt: retryAt, reason: 'lease-lost-after-response'
        }, true);
        _scheduleBuildInstantWorker(vId, retryAt, 'uncertain-reconcile', record.official, {
            orderId: String(orderId),
            uncertain: { orderId: String(orderId), snapshotHash: expectedHash, at: Date.now() },
            statePatch: { state: 'UNCERTAIN' }
        });
        return { status: 'UNCERTAIN', retryAt };
    }

    const official = state.get(vId).official || {};
    const queue = (official.queue || []).slice();
    const levels = (official.levels || []).slice();
    const slots = (official.slots || []).slice();
    const cancelIds = (official.cancelIds || []).slice();
    let completedIndex = cancelIds.findIndex(id => String(id) === String(orderId));
    if (completedIndex < 0) completedIndex = 0;
    queue.splice(completedIndex, 1); levels.splice(completedIndex, 1);
    slots.splice(completedIndex, 1); cancelIds.splice(completedIndex, 1);
    state.updateOfficial(vId, Object.assign({}, official, {
        queue, levels, slots, cancelIds,
        nextSlotAt: slots[0] || null,
        lastSlotAt: slots.length > 1 ? slots[slots.length - 1] : null,
        full: false, instantFree: null, fetchedAt: Date.now(), source: 'build-instant-response'
    }));
    _setBuildInstantState(vId, { state: 'IDLE', uncertain: null, orderId: null, reason: 'completed' }, true);
    state.publishObservation?.(vId);
    const villageName = typeof getVillageName === 'function' ? getVillageName(vId) : vId;
    showAutoHideBox('[' + villageName + '] ' + t('buildQueue.instantFreeCompleted'), false);
    if (typeof requestBuildQueueReconcile === 'function') {
        requestBuildQueueReconcile(vId, { reason: 'build-instant-completed', delayMs: BUILD_INSTANT_COMPLETION_MARGIN_MS });
    }
    return checkAndScheduleBuildInstantFree(vId, { observeDom: false });
}

// Compatibility wrappers for timeout records persisted by earlier versions.
function fetchAndExecuteBuildInstantFree(_expectedCompletionMs, villageId) {
    const vId = String(villageId || game_data?.village?.id || '');
    const official = _buildInstantStateApi()?.get(vId)?.official || {};
    return runBuildInstantFreeWorker(vId, official.generation, _buildInstantSnapshot(vId, official), 'legacy-check', null);
}

function scheduleVillageInstantFreeCheck(villageId, waitTime) {
    const official = _buildInstantStateApi()?.get(villageId)?.official || {};
    _scheduleBuildInstantWorker(villageId, Date.now() + Math.max(0, Number(waitTime) || 0), 'legacy-schedule', official);
}

function scheduleVillageInstantFreeApiCall(villageId, orderId, waitTime) {
    const official = _buildInstantStateApi()?.get(villageId)?.official || {};
    _scheduleBuildInstantWorker(villageId, Date.now() + Math.max(0, Number(waitTime) || 0), 'legacy-api-schedule', official, { orderId });
}

async function runBuildInstantFreeWorkerSafely() {
    const args = Array.from(arguments);
    const vId = String(args[0] || game_data?.village?.id || '');
    try {
        return await runBuildInstantFreeWorker.apply(null, args);
    } catch (error) {
        if (error?.code === 'HARD_STOP') throw error;
        const record = _buildInstantStateApi()?.get(vId);
        const afterTransmission = record?.instant?.state === 'EXECUTING';
        const dueAt = Date.now() + (afterTransmission ? 30000 : BUILD_INSTANT_FALLBACK_MS);
        _scheduleBuildInstantWorker(vId, dueAt, afterTransmission ? 'worker-exception-uncertain' : 'worker-exception-soft-pause', record?.official || {}, {
            uncertain: afterTransmission ? { orderId: record?.instant?.orderId, at: Date.now() } : null,
            statePatch: { state: afterTransmission ? 'UNCERTAIN' : 'SOFT_PAUSED' }
        });
        return { status: afterTransmission ? 'UNCERTAIN' : 'SOFT_PAUSED', retryAt: dueAt, error };
    }
}

if (typeof registerTimeoutHandler === 'function') {
    registerTimeoutHandler('instantFreeWorker', runBuildInstantFreeWorkerSafely);
    registerTimeoutHandler('instantFreeCheck', fetchAndExecuteBuildInstantFree);
    registerTimeoutHandler('instantFreeApiCall', function (orderId, villageId) {
        const official = _buildInstantStateApi()?.get(villageId)?.official || {};
        return runBuildInstantFreeWorker(villageId, official.generation, _buildInstantSnapshot(villageId, official), 'legacy-api', orderId);
    });
}
