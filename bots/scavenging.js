

/**
 * Waits for the scavenge widget to be present in the DOM, then calls the callback.
 * Uses a MutationObserver to avoid polling.
 * @param {Function} callback - Function to call once the widget is detected.
 */
function waitForScavengeWidget(callback) {
    if (document.querySelector('.scavenge-screen-main-widget')) {
        callback();
        return;
    }
    const observer = new MutationObserver((_, obs) => {
        if (document.querySelector('.scavenge-screen-main-widget')) {
            obs.disconnect();
            callback();
        }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
}

/**
 * Returns the auto-scavenge configuration for the current village from localStorage.
 * Defaults to disabled with no specific unit settings if no config exists.
 * @returns {{ enabled: boolean, level: number, allUnits: boolean, units: Object, optionId?: number, lastUnitCounts?: Object }}
 */
let _scavengingTaskVillageId = null;

function _getScavengeVillageId(villageId) {
    return String(villageId || _scavengingTaskVillageId || game_data?.village?.id || '');
}

function getScavengeConfig(villageId) {
    const configs = JSON.parse(localStorage.getItem('scavenge_configs') || '{}');
    const vId = _getScavengeVillageId(villageId);
    return configs[vId] || { enabled: false, level: 0, allUnits: true, units: {} };
}

/**
 * Saves the auto-scavenge configuration for the current village to localStorage.
 * May also include optionId and lastUnitCounts, which are written back by the bot after a successful send.
 * @param {{ enabled: boolean, level: number, allUnits: boolean, units: Object, optionId?: number, lastUnitCounts?: Object }} config
 */
function saveScavengeConfig(config, villageId) {
    const configs = JSON.parse(localStorage.getItem('scavenge_configs') || '{}');
    const vId = _getScavengeVillageId(villageId);
    if (!vId) return;
    configs[vId] = config;
    localStorage.setItem('scavenge_configs', JSON.stringify(configs));
}

function _scavengingDecisionHash(config) {
    const current = config || {};
    const decision = {
        enabled: Boolean(current.enabled),
        level: Number(current.level) || 0,
        allUnits: current.allUnits !== false,
        units: current.units || {},
        optionId: current.optionId ?? null,
        lastUnitCounts: current.lastUnitCounts || {},
        optimizeMode: Boolean(current.optimizeMode),
        optimizeCalculationMode: current.optimizeCalculationMode || null,
        distributionByOption: current.distributionByOption || null,
        selectedLevelIndices: current.selectedLevelIndices || []
    };
    return window.PremiumFeaturesAsync?.stableSnapshotHash?.(decision) || JSON.stringify(decision);
}

function _scavengingDecisionIsCurrent(villageId, expectedHash, reason) {
    if (!expectedHash || _scavengingDecisionHash(getScavengeConfig(villageId)) === expectedHash) return true;
    window.PremiumFeaturesDiagnostics?.record?.({
        feature: 'scavenging', taskKey: 'scavenging:' + _getScavengeVillageId(villageId),
        villageId: _getScavengeVillageId(villageId), status: 'SKIPPED', reason: reason || 'stale-config-snapshot'
    });
    return false;
}

/**
 * Carry capacity per unit type, used to compute carry_max for the scavenge API call.
 * Values represent the number of resource tiles each unit can carry.
 */
const SCAVENGE_UNIT_CARRY = {
    spear: 25, sword: 15, axe: 10, archer: 10,
    spy: 0, light: 80, marcher: 50, heavy: 50,
    ram: 0, catapult: 0, knight: 100, snob: 0
};
const SCAVENGE_AUTO_UNITS = ['spear', 'sword', 'axe', 'archer', 'light', 'marcher', 'heavy'];

function _scavengingHardStopped() {
    return Boolean(window.PremiumFeaturesBotProtection?.isActive?.() ||
        window.PremiumFeaturesBackgroundScheduler?.stats?.().hardStopped);
}

function _scavengingStopForProtection(villageId) {
    if (!window.PremiumFeaturesBackgroundScheduler?.stats?.().hardStopped) {
        window.PremiumFeaturesBackgroundScheduler?.hardStop?.('bot-protection');
    }
    if (getScavengeConfig(villageId).enabled || getScavengeConfig(villageId).uncertain) {
        _scheduleScavengingAuto(0, villageId);
    }
    refreshScavengingAutoStatus(villageId);
    return { status: 'HARD_STOP' };
}

function _scavengingOperationalStatus(villageId, draftEnabled) {
    const vId = _getScavengeVillageId(villageId);
    const config = getScavengeConfig(vId);
    if (!config.enabled && !config.uncertain) return draftEnabled ? 'PENDING_ENABLE' : 'OFF';
    if (_scavengingHardStopped()) return 'HARD_STOP';
    const scheduled = window.PremiumFeaturesBackgroundScheduler?.describe?.('persistent-timeout:' + _scavengingTimerId(vId));
    if (config.uncertain) return scheduled?.state === 'RUNNING' ? 'RECONCILING' : 'UNCERTAIN';
    if (!config.enabled) return 'OFF';
    if (Number(config.resilience?.retryAt) > Date.now()) return 'SOFT_PAUSED';
    if (Number(config.waitLeaseUntil) > Date.now()) return 'WAITING_LEASE';
    if (scheduled?.state === 'WAITING_LEASE') return 'WAITING_LEASE';
    if (scheduled?.state === 'RUNNING') return 'EXECUTING';
    const dueAt = _scavengingScheduledDueAt(vId);
    if (dueAt > Date.now()) {
        const returns = Object.values(config.returnAtByOption || {}).some(value => Number(value) > Date.now());
        return returns ? 'WAITING_RETURN' : 'ON';
    }
    return 'STARTING';
}

function refreshScavengingAutoStatus(villageId, cellOverride, draftOverride) {
    const vId = _getScavengeVillageId(villageId);
    if (String(game_data?.village?.id || '') !== vId) return;
    const statusCell = cellOverride || document.getElementById('scavenge_auto_status');
    if (!statusCell) return;
    const draft = draftOverride === undefined
        ? document.getElementById('scavenge_config_enabled')?.checked
        : draftOverride;
    const status = _scavengingOperationalStatus(vId, draft);
    const labels = {
        OFF: 'scavenge.statusOff', PENDING_ENABLE: 'scavenge.statusPendingEnable',
        STARTING: 'scavenge.statusStarting', ON: 'scavenge.statusActive',
        WAITING_RETURN: 'scavenge.statusWaitingReturn', WAITING_LEASE: 'scavenge.statusWaitingLease',
        SOFT_PAUSED: 'scavenge.statusSoftPaused', UNCERTAIN: 'scavenge.statusUncertain',
        RECONCILING: 'scavenge.statusReconciling', EXECUTING: 'scavenge.statusExecuting',
        HARD_STOP: 'scavenge.statusHardStop'
    };
    const dueAt = _scavengingScheduledDueAt(vId);
    statusCell.textContent = t(labels[status] || labels.STARTING) +
        (dueAt > Date.now() && status !== 'HARD_STOP'
            ? ' · ' + t('scavenge.nextRunAt', { time: new Date(dueAt).toLocaleTimeString() }) : '');
    statusCell.dataset.twpfAutoStatus = status;
}

/**
 * World speed multiplier for scavenge duration calculations (df = speed^-0.55).
 * Reads the live value from the world_settings cache populated by fetchAndCacheWorldSettings().
 * Falls back to 1 if the cache is not available.
 */
const SCAVENGE_WORLD_SPEED = 1; // kept as fallback constant only

function _scavGetWorldSpeed() {
    return typeof getWorldSpeed === 'function' ? getWorldSpeed() : SCAVENGE_WORLD_SPEED;
}

// Fixed scavenge tier ratios per slot index 0-3 (game constants)
const SCAVENGE_TIER_RATIOS = [0.10, 0.25, 0.50, 0.75];

/**
 * Compatibility hook retained for callers from older versions. Known return events are exact;
 * cross-feature spreading is handled by the cooperative scheduler instead.
 */
function _scavSpreadDelayMs() {
    return 0;
}

function _scavengingReturnAtMs(value) {
    if (value == null || value === '') return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = new Date(String(value).replace(' ', 'T')).getTime();
    return Number.isFinite(parsed) ? parsed : null;
}

function _scavengingTimerId(villageId) {
    return 'scavenging-auto:' + _getScavengeVillageId(villageId);
}

function _scavengingScheduledDueAt(villageId) {
    const timerId = _scavengingTimerId(villageId);
    try {
        const handler = JSON.parse(localStorage.getItem('handler_' + timerId) || 'null');
        if (handler?.handlerName !== 'scavengingAutoCheck') return 0;
        return Number(localStorage.getItem('endTime_' + timerId)) || 0;
    } catch (_error) {
        return 0;
    }
}

function _scheduleScavengingAuto(waitMs, villageId) {
    const vId = _getScavengeVillageId(villageId);
    if (!vId) return;
    const retryAt = Number(getScavengeConfig(vId)?.resilience?.retryAt) || 0;
    const effectiveWaitMs = Math.max(
        0,
        Number(waitMs) || 0,
        retryAt > Date.now() ? retryAt - Date.now() : 0
    );
    if (localStorage.getItem('endTime_scavenging-auto') && typeof clearPersistedTimeout === 'function') {
        clearPersistedTimeout('scavenging-auto');
    }
    setHandlerOnTimeOut(_scavengingTimerId(vId), 'scavengingAutoCheck', [vId], effectiveWaitMs);
    refreshScavengingAutoStatus(vId);
}

function _ensureScavengingAutoWake(villageId) {
    const vId = _getScavengeVillageId(villageId);
    const config = getScavengeConfig(vId);
    if (!config.enabled && !config.uncertain) return false;
    if (window.PremiumFeaturesBackgroundScheduler?.hasTask?.('persistent-timeout:' + _scavengingTimerId(vId))) {
        return false;
    }
    if (_scavengingScheduledDueAt(vId) > Date.now()) return false;
    // A partly persisted/legacy deadline can still be useful even if its handler disappeared.
    // Repair the handler without moving a known future return forward to page-load time.
    const retainedDueAt = Number(localStorage.getItem('endTime_' + _scavengingTimerId(vId))) || 0;
    _scheduleScavengingAuto(Math.max(0, retainedDueAt - Date.now()), vId);
    return true;
}

function restoreScavengingAutoWakes() {
    let configs;
    try { configs = JSON.parse(localStorage.getItem('scavenge_configs') || '{}'); }
    catch (_error) { return; }
    Object.keys(configs || {}).forEach(villageId => {
        try { _ensureScavengingAutoWake(villageId); }
        catch (error) {
            window.PremiumFeaturesDiagnostics?.record?.({
                feature: 'scavenging', villageId, status: 'SKIPPED',
                reason: 'wake-restore-failed', error: String(error?.message || error)
            });
        }
    });
}

const SCAVENGING_BACKOFF_MS = [30000, 60000, 120000, 300000, 600000];

function _softPauseScavenging(error, reason) {
    if (error?.code === 'LEASE_LOST') return _deferScavengingForLease(_getScavengeVillageId()).dueAt;
    if (error?.code === 'HARD_STOP' || _scavengingHardStopped()) return null;
    const failure = window.PremiumFeaturesAsync?.classifyRequestFailure?.(error, {
        url: error?.url || game_data?.link_base_pure
    }) || {};
    if (failure.hardStop) {
        _scavengingStopForProtection(_getScavengeVillageId());
        return null;
    }
    const config = getScavengeConfig();
    const previous = config.resilience || {};
    const failureCount = Math.max(0, Number(previous.failureCount) || 0) + 1;
    const delayMs = SCAVENGING_BACKOFF_MS[Math.min(failureCount - 1, SCAVENGING_BACKOFF_MS.length - 1)];
    const retryAt = Date.now() + delayMs;
    saveScavengeConfig(Object.assign({}, config, {
        resilience: { failureCount, retryAt, reason: reason || 'transient-failure' }
    }));
    window.PremiumFeaturesDiagnostics?.record?.({
        feature: 'scavenging', taskKey: 'scavenging:' + _getScavengeVillageId(),
        villageId: _getScavengeVillageId(), status: 'SOFT_PAUSE', reason: reason || 'transient-failure'
    });
    // An uncertain manual send must also get one read-only reconciliation even when automation
    // is disabled. The reconciliation never repeats the POST blindly.
    if (config.enabled || config.uncertain) _scheduleScavengingAuto(delayMs);
    return retryAt;
}

function _resetScavengingFailures() {
    const config = getScavengeConfig();
    if (!config.resilience && !config.uncertain) return;
    saveScavengeConfig(Object.assign({}, config, { resilience: null, uncertain: null }));
}

function _scavengingLeaseActive(villageId) {
    const coordinator = window.PremiumFeaturesCoordination;
    if (!coordinator?.readLease) return true;
    const vId = _getScavengeVillageId(villageId);
    const lease = coordinator.readLease('scavenging:' + vId);
    return Boolean(lease && lease.owner === coordinator.tabId &&
        lease.instanceId === coordinator.instanceId && lease.expiresAt > Date.now());
}

function _deferScavengingForLease(villageId) {
    const vId = _getScavengeVillageId(villageId);
    const lease = window.PremiumFeaturesCoordination?.readLease?.('scavenging:' + vId);
    const dueAt = Math.max(Date.now() + 1000, Number(lease?.expiresAt) + 50 || 0);
    saveScavengeConfig(Object.assign({}, getScavengeConfig(vId), { waitLeaseUntil: dueAt }), vId);
    _scheduleScavengingAuto(dueAt - Date.now(), vId);
    window.PremiumFeaturesDiagnostics?.record?.({
        feature: 'scavenging', taskKey: 'scavenging:' + vId, villageId: vId,
        status: 'LEASE', reason: 'lease-deferred', dueAt
    });
    return { status: 'WAITING_LEASE', dueAt };
}

function _parseScavengingVillageDocument(doc) {
    const scriptText = Array.from(doc.querySelectorAll('script'))
        .map(script => script.textContent)
        .find(text => text.includes('var village = {'));
    if (!scriptText) return null;
    const start = scriptText.indexOf('var village = ') + 'var village = '.length;
    let depth = 0;
    let position = start;
    while (position < scriptText.length) {
        if (scriptText[position] === '{') depth++;
        else if (scriptText[position] === '}' && --depth === 0) break;
        position++;
    }
    try { return JSON.parse(scriptText.slice(start, position + 1)); } catch (_error) { return null; }
}

function _parseScavengingVillageData(html) {
    return _parseScavengingVillageDocument(new DOMParser().parseFromString(html, 'text/html'));
}

async function _fetchScavengingVillageData(reason) {
    const vId = _getScavengeVillageId();
    const targetBase = typeof getVillageLinkBase === 'function' ? getVillageLinkBase(vId) : game_data.link_base_pure;
    const url = targetBase + 'place&mode=scavenge';
    const load = async function () {
        const request = () => {
            if (_scavengingHardStopped()) {
                _scavengingStopForProtection(vId);
                const error = new Error('Scavenging hard stop before state read');
                error.code = 'HARD_STOP';
                throw error;
            }
            if (_scavengingTaskVillageId && !_scavengingLeaseActive(vId)) {
                const error = new Error('Scavenging lease lost before state read');
                error.code = 'LEASE_LOST';
                throw error;
            }
            return fetch(url, { credentials: 'include' });
        };
        const response = await (window.PremiumFeaturesDiagnostics?.request
            ? window.PremiumFeaturesDiagnostics.request({
                feature: 'scavenging', taskKey: 'scavenging:' + vId,
                villageId: vId, logicalResource: 'scavenging-state:' + vId,
                method: 'GET', reason
            }, request)
            : request());
        if (!response.ok) {
            const error = new Error('HTTP ' + response.status);
            error.status = response.status;
            error.url = response.url || url;
            throw error;
        }
        const parsed = _parseScavengingVillageData(await response.text());
        if (!parsed) throw new Error('Could not parse scavenging state');
        return parsed;
    };
    return window.PremiumFeaturesSingleFlight?.run
        ? window.PremiumFeaturesSingleFlight.run('scavenging-state:' + vId, load)
        : load();
}

async function _reconcileUncertainScavenging(config) {
    const villageId = _getScavengeVillageId();
    const decisionHash = _scavengingDecisionHash(config);
    let village;
    try {
        village = await _fetchScavengingVillageData('uncertain-reconcile');
    } catch (error) {
        _softPauseScavenging(error, 'uncertain-reconcile');
        return true;
    }
    if (!_scavengingLeaseActive()) {
        _scheduleScavengingAuto(1000, villageId);
        return true;
    }
    if (!_scavengingDecisionIsCurrent(villageId, decisionHash, 'config-changed-during-reconcile')) return true;
    const option = Object.values(village.options || {}).find(candidate =>
        Number(candidate.base_id) === Number(config.uncertain?.optionId));
    const returnAt = Number(option?.scavenging_squad?.return_time) * 1000 || null;
    saveScavengeConfig(Object.assign({}, config, { uncertain: null, resilience: null }));
    if (returnAt && returnAt > Date.now()) {
        if (config.enabled) _scheduleScavengingAuto(returnAt - Date.now());
        return true;
    }
    return false;
}

if (typeof registerTimeoutHandler === 'function') {
    registerTimeoutHandler('scavengingAutoCheck', triggerScavengingAuto);
}

// Unit order used in distribution calculations (excludes spy/ram/catapult/snob)
const SCAVENGE_UNIT_ORDER = ['spear', 'sword', 'axe', 'archer', 'light', 'marcher', 'heavy', 'knight'];

/**
 * Reads the live Tribal Wars scavenge widget and returns the unit list with the
 * maximum available count for each unit.
 * @returns {Array<{unit: string, maxCount: number}>}
 */
function getOriginalScavengeUnitMeta() {
    const originalWidget = getOriginalScavengeWidget();
    if (!originalWidget) return [];

    return Array.from(originalWidget.querySelectorAll('input[name]')).map(input => {
        const unit = input.name;
        const maxAttr = input.getAttribute('data-all-count')
            ?? input.getAttribute('data-all_count')
            ?? input.dataset.allCount
            ?? input.dataset.all_count;
        let maxCount = parseInt(maxAttr, 10);

        if (!Number.isFinite(maxCount) || maxCount < 0) {
            const fallbackButton = originalWidget.querySelector(`.units-entry-all[data-unit="${unit}"]`);
            const fallbackMatch = fallbackButton?.textContent?.match(/\d+/);
            maxCount = fallbackMatch ? parseInt(fallbackMatch[0], 10) : 0;
        }

        return { unit, maxCount };
    }).filter(item => !!item.unit);
}

function getOriginalScavengeWidget() {
    const widgets = Array.from(document.querySelectorAll('.candidate-squad-widget'));
    return widgets.find(widget => !widget.closest('#scavenge_bot_config')) || null;
}

function _scavengeSetInputValue(input, value) {
    if (!input) return;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

// ---- Scavenge optimization math (adapted from scavenger_calculator.js) ----

function _scavDuration(cap, ratio) {
    const df = Math.pow(_scavGetWorldSpeed(), -0.55);
    return cap <= 0 ? 1800 * df : (Math.pow(Math.pow(cap, 2) * 100 * Math.pow(ratio, 2), 0.45) + 1800) * df;
}

function _scavCapGivenLambda(lambda, ratio) {
    if (lambda <= 0) return Infinity;
    const df = Math.pow(_scavGetWorldSpeed(), -0.55);
    const A = df * Math.pow(100 * ratio * ratio, 0.45), B = 1800 * df;
    const D = (360 * ratio + Math.sqrt(Math.pow(360 * ratio, 2) + 4 * lambda * 3240 * ratio * B)) / (2 * lambda);
    return D <= B ? 0 : Math.pow((D - B) / A, 10 / 9);
}

function _scavOptimizeBalanced(totalCap, activeTiers) {
    if (!activeTiers.length || totalCap <= 0) return activeTiers.map(() => 0);
    const df = Math.pow(_scavGetWorldSpeed(), -0.55);
    let lambdaMax = 0;
    activeTiers.forEach(t => { lambdaMax = Math.max(lambdaMax, 2 * t.ratio / df); });
    let lo = 0, hi = lambdaMax;
    for (let i = 0; i < 100; i++) {
        const mid = (lo + hi) / 2;
        activeTiers.reduce((s, t) => s + _scavCapGivenLambda(mid, t.ratio), 0) > totalCap ? lo = mid : hi = mid;
    }
    const lam = (lo + hi) / 2;
    return activeTiers.map(t => { const c = _scavCapGivenLambda(lam, t.ratio); return isFinite(c) ? Math.max(0, c) : totalCap; });
}

function _scavCapForDuration(T, ratio) {
    const df = Math.pow(_scavGetWorldSpeed(), -0.55), inner = T / df - 1800;
    return inner <= 0 ? 0 : Math.sqrt(Math.max(0, Math.pow(inner, 1 / 0.45) / (100 * ratio * ratio)));
}

function _scavOptimizeFastest(totalCap, activeTiers) {
    if (!activeTiers.length || totalCap <= 0) return activeTiers.map(() => 0);
    const df = Math.pow(_scavGetWorldSpeed(), -0.55);
    let lo = 1800 * df, hi = lo + 1, g = 0;
    while (activeTiers.reduce((s, t) => s + _scavCapForDuration(hi, t.ratio), 0) < totalCap && g++ < 200) hi *= 2;
    for (let i = 0; i < 100; i++) {
        const mid = (lo + hi) / 2;
        activeTiers.reduce((s, t) => s + _scavCapForDuration(mid, t.ratio), 0) < totalCap ? lo = mid : hi = mid;
    }
    const T = (lo + hi) / 2;
    return activeTiers.map(t => _scavCapForDuration(T, t.ratio));
}

function _scavDistributeTroops(unitCounts, activeTiers, capTargets, totalCap) {
    const fracs = capTargets.map(c => totalCap > 0 ? c / totalCap : 0), n = activeTiers.length, result = {};
    SCAVENGE_UNIT_ORDER.forEach(unit => {
        const count = unitCounts[unit] || 0;
        result[unit] = new Array(n).fill(0);
        if (!count || !n) return;
        const raw = fracs.map(f => count * f), floors = raw.map(Math.floor);
        const rem = count - floors.reduce((s, v) => s + v, 0);
        const ord = raw.map((_, i) => i).sort((a, b) => (raw[b] - floors[b]) - (raw[a] - floors[a]));
        floors.forEach((v, i) => { result[unit][i] = v; });
        for (let k = 0; k < rem; k++) result[unit][ord[k]]++;
    });
    return result;
}

/**
 * Computes optimal troop distribution across unlocked scavenge options.
 * @param {Object} unitCounts - { unit: count } total pool to distribute
 * @param {Array} unlockedOptsData - [{ base_id, ratio }] sorted by level (lowest first)
 * @param {string} mode - 'balanced' | 'fastest'
 * @returns {{ distributionByOption: Object, tableHtml: string }}
 */
function computeScavengeOptimizedDistribution(unitCounts, unlockedOptsData, mode) {
    const totalCap = SCAVENGE_UNIT_ORDER.reduce((s, u) => s + (unitCounts[u] || 0) * (SCAVENGE_UNIT_CARRY[u] || 0), 0);
    if (!totalCap || !unlockedOptsData.length) {
        return { distributionByOption: {}, tableHtml: '<p style="color:#e06060;">' + t('scavenge.noUnitsOrOptions') + '</p>' };
    }
    const capTargets = mode === 'fastest' ? _scavOptimizeFastest(totalCap, unlockedOptsData) : _scavOptimizeBalanced(totalCap, unlockedOptsData);
    const troopSplit = _scavDistributeTroops(unitCounts, unlockedOptsData, capTargets, totalCap);

    const distributionByOption = {};
    unlockedOptsData.forEach((opt, i) => {
        const units = {};
        let carryMax = 0;
        SCAVENGE_UNIT_ORDER.forEach(u => {
            const cnt = troopSplit[u]?.[i] || 0;
            if (cnt > 0) { units[u] = cnt; carryMax += cnt * (SCAVENGE_UNIT_CARRY[u] || 0); }
        });
        if (Object.keys(units).length > 0) distributionByOption[opt.base_id] = { units, carryMax };
    });

    const base = typeof image_base !== 'undefined' ? image_base : 'graphic/';
    const unitCols = SCAVENGE_UNIT_ORDER.filter(u => (unitCounts[u] || 0) > 0);
    let html = '<table class="vis" style="width:100%;font-size:11px;margin-top:8px;"><tr><th>' + t('scavenge.levelHeader') + '</th>';
    unitCols.forEach(u => { html += `<th><img src="${base}unit/unit_${u}.webp" style="width:20px" title="${typeof getUnitDisplayName === 'function' ? getUnitDisplayName(u) : u}"/></th>`; });
    html += '<th>' + t('scavenge.capacityHeader') + '</th><th>' + t('scavenge.resourcesHeader') + '</th><th>' + t('scavenge.durationHeader') + '</th></tr>';
    unlockedOptsData.forEach((opt, i) => {
        let cap = 0;
        unitCols.forEach(u => { cap += (troopSplit[u]?.[i] || 0) * (SCAVENGE_UNIT_CARRY[u] || 0); });
        const res = cap > 0 ? Math.round(cap * opt.ratio) : 0;
        const dur = cap > 0 ? _scavDuration(cap, opt.ratio) : 0;
        const ds = dur > 0 ? `${String(Math.floor(dur/3600)).padStart(2,'0')}:${String(Math.floor((dur%3600)/60)).padStart(2,'0')}:${String(Math.round(dur%60)).padStart(2,'0')}` : '-';
        html += `<tr><td><b>${t('scavenge.levelFallback', { level: i + 1 })}</b></td>`;
        unitCols.forEach(u => { html += `<td>${troopSplit[u]?.[i] || 0}</td>`; });
        html += `<td>${cap}</td><td>${res}</td><td>${ds}</td></tr>`;
    });
    html += '</table>';
    return { distributionByOption, tableHtml: html };
}

/** Computes the current cycle from saved policy and fresh home troops. Stored distribution is
 * preview/legacy policy metadata only; it never authorizes a future POST verbatim. */
function _scavengingOptimizedCycle(config, villageData) {
    const home = villageData.unit_counts_home || {};
    const savedUnits = config.units || {};
    const legacyUnits = {};
    Object.values(config.distributionByOption || {}).forEach(entry => {
        Object.entries(entry?.units || {}).forEach(([unit, count]) => {
            legacyUnits[unit] = Number(legacyUnits[unit] || 0) + Number(count || 0);
        });
    });
    const policyUnits = Object.values(savedUnits).some(count => Number(count) > 0) ? savedUnits : legacyUnits;
    const pool = {};
    SCAVENGE_AUTO_UNITS.forEach(unit => {
        const count = Math.min(Number(home[unit] || 0), Number(policyUnits[unit] || 0));
        if (count > 0) pool[unit] = Math.floor(count);
    });
    const allOptions = Object.values(villageData.options || {})
        .sort((first, second) => Number(first.base_id) - Number(second.base_id));
    const unlocked = allOptions.filter(option => !option.is_locked);
    const selected = Array.isArray(config.selectedLevelIndices) && config.selectedLevelIndices.length
        ? config.selectedLevelIndices.map(Number)
        : unlocked.map((option, index) => config.distributionByOption?.[option.base_id] ? index + 1 : null).filter(Boolean);
    const tiers = unlocked.map((option, index) => ({
        base_id: Number(option.base_id),
        ratio: SCAVENGE_TIER_RATIOS[allOptions.indexOf(option)] || 0,
        selected: selected.includes(index + 1)
    })).filter(option => option.selected && option.ratio > 0);
    return computeScavengeOptimizedDistribution(pool, tiers, config.optimizeCalculationMode || 'balanced').distributionByOption;
}

/** Sends optimized troops using one official state read and a fresh local distribution. */
async function runOptimizedScavenge(forceRun = false) {
    const config = getScavengeConfig();
    const decisionHash = _scavengingDecisionHash(config);
    if (!forceRun && !config.enabled) return;
    if (!config.optimizeMode) return;

    let villageData;
    try {
        villageData = await _fetchScavengingVillageData('optimized-state');
    } catch (e) {
        console.error('[AutoScavenge] Optimize: fetch failed:', e);
        _softPauseScavenging(e, 'optimized-state-fetch');
        return;
    }

    if (!villageData) {
        console.warn('[AutoScavenge] Optimize: could not parse village data. Retrying in 5 min.');
        _softPauseScavenging(new Error('Could not parse scavenging state'), 'optimized-state-parse');
        return;
    }
    if (!_scavengingDecisionIsCurrent(_getScavengeVillageId(), decisionHash, 'config-changed-during-state-read')) return;
    _resetScavengingFailures();

    const optionsState = villageData.options || {};
    const distribution = _scavengingOptimizedCycle(config, villageData);
    if (!distribution || !Object.keys(distribution).length) {
        _scheduleScavengingAuto(30 * 60 * 1000);
        return;
    }
    const optionIds = Object.keys(distribution).map(Number).sort((a, b) => b - a); // highest first
    let earliestReturn = null;
    let homeRemaining = villageData.unit_counts_home ? { ...villageData.unit_counts_home } : null;

    for (const optionId of optionIds) {
        const optState = Object.values(optionsState).find(o => Number(o.base_id) === optionId);
        if (!optState || optState.is_locked) continue;

        if (optState.scavenging_squad) {
            const rt = optState.scavenging_squad.return_time;
            if (rt) {
                const rtMs = _scavengingReturnAtMs(rt);
                if (rtMs && (earliestReturn === null || rtMs < earliestReturn)) earliestReturn = rtMs;
            }
            continue;
        }

        const { units, carryMax } = distribution[optionId];
        if (homeRemaining && Object.entries(units || {}).some(([unit, count]) =>
            Number(count) > Number(homeRemaining[unit] || 0))) {
            console.warn(`[AutoScavenge] Optimize: optionId=${optionId} needs troops no longer at home.`);
            _scheduleScavengingAuto(earliestReturn && earliestReturn > Date.now()
                ? earliestReturn - Date.now() : 30 * 60 * 1000);
            return;
        }
        console.log(`[AutoScavenge] Optimize: sending optionId=${optionId} | carryMax=${carryMax}`);
        const result = await sendScavengeSquadApi(
            units, optionId, carryMax, _getScavengeVillageId(), decisionHash
        );

        if (result.uncertain || result.paused) return;

        if (!result.success) {
            // A rejected squad may reflect changing home troops or an already occupied option.
            // This is not evidence that the user's persisted automation intent was revoked.
            console.warn(`[AutoScavenge] Optimize: optionId=${optionId} rejected; deferring the next observation.`);
            _scheduleScavengingAuto(30 * 60 * 1000);
            return;
        }

        console.log(`[AutoScavenge] Optimize: optionId=${optionId} sent | returnMs=${result.returnMs}`);
        if (result.homeCounts) homeRemaining = { ...result.homeCounts };
        else if (homeRemaining) Object.entries(units || {}).forEach(([unit, count]) => {
            homeRemaining[unit] = Math.max(0, Number(homeRemaining[unit] || 0) - Number(count));
        });
        if (result.returnMs > 0) {
            const retTime = Date.now() + result.returnMs;
            if (earliestReturn === null || retTime < earliestReturn) earliestReturn = retTime;
        }
    }

    if (earliestReturn) {
        const spreadMs = _scavSpreadDelayMs();
        const waitMs = Math.max(0, earliestReturn - Date.now()) + spreadMs;
        _scheduleScavengingAuto(waitMs);
        console.log(`[AutoScavenge] Optimize: next check in ${Math.round(waitMs / 60000)} min (incl. ${Math.round(spreadMs / 60000)} min deterministic spread).`);
    } else {
        _scheduleScavengingAuto(30 * 60 * 1000);
        console.warn('[AutoScavenge] Optimize: no return times found. Retrying in 30 min.');
    }

    if (game_data?.screen === 'overview' && typeof getPlaceInfo === 'function') getPlaceInfo();
}

/**
 * Sends an optimized scavenge distribution immediately without scheduling a follow-up run.
 * Used by the manual Send now path so multi-level calculation still works when auto-scavenge is off.
 */
async function sendOptimizedScavengeNow(units, unlockedOptsData, calcMode) {
    const { distributionByOption } = computeScavengeOptimizedDistribution(units, unlockedOptsData, calcMode);
    if (!distributionByOption || !Object.keys(distributionByOption).length) {
        if (typeof showAutoHideBox === 'function') showAutoHideBox(t('scavenge.noOptionFound'), true);
        return { success: false };
    }
    const decisionHash = _scavengingDecisionHash(getScavengeConfig());

    // The active scavenge page already contains the authoritative initial state. Only fall back
    // to the shared logical GET when that legitimate DOM source is unavailable.
    let villageData = _parseScavengingVillageDocument(document);
    if (!villageData) {
        try {
            villageData = await _fetchScavengingVillageData('manual-optimize');
        } catch (e) {
            console.error('[AutoScavenge] Manual optimize: fetch failed:', e);
            _softPauseScavenging(e, 'manual-optimize-state');
            return { success: false };
        }
    }

    if (!villageData) {
        console.warn('[AutoScavenge] Manual optimize: could not parse village data.');
        return { success: false };
    }
    if (!_scavengingDecisionIsCurrent(_getScavengeVillageId(), decisionHash, 'config-changed-during-manual-state-read')) {
        return { success: false, stale: true };
    }

    const optionsState = villageData.options || {};
    const optionIds = Object.keys(distributionByOption).map(Number).sort((a, b) => b - a);
    let earliestReturn = null;

    for (const optionId of optionIds) {
        const optState = Object.values(optionsState).find(o => o.base_id === optionId);
        if (!optState || optState.is_locked) continue;
        if (optState.scavenging_squad) continue;

        const { units: optionUnits, carryMax } = distributionByOption[optionId];
        const result = await sendScavengeSquadApi(
            optionUnits, optionId, carryMax, _getScavengeVillageId(), decisionHash
        );
        if (result.uncertain || result.paused) return;
        if (!result.success) {
            return result;
        }

        if (result.returnMs > 0) {
            const retTime = Date.now() + result.returnMs;
            if (earliestReturn === null || retTime < earliestReturn) earliestReturn = retTime;
        }
    }

    return { success: true, returnMs: earliestReturn ? Math.max(0, earliestReturn - Date.now()) : 0 };
}

/**
 * Sends a scavenge squad via the game API without requiring page interaction or form submission.
 * @param {Object<string, number>} unitCounts - Map of unit name to troop count.
 * @param {number|string} optionId - The scavenge option ID (read from the DOM data-option-id attribute).
 * @param {number} carryMax - Total carry capacity of the squad (sum of unit counts × per-unit carry).
 * @returns {Promise<{success: boolean, returnMs: number}>}
 *   success  – whether the server accepted the squad.
 *   returnMs – milliseconds until the squad returns (0 if unknown). Populated even on failure when troops are already out.
 */
async function sendScavengeSquadApi(unitCounts, optionId, carryMax, explicitVillageId, expectedDecisionHash, leaseAlreadyHeld = false) {
    const villageId = _getScavengeVillageId(explicitVillageId);
    const csrf = game_data?.csrf;
    if (!villageId || !csrf) return { success: false, returnMs: 0 };
    if (!_scavengingTaskVillageId && !leaseAlreadyHeld) {
        const runLeased = async function (guard) {
            guard?.assertActive?.();
            const previousVillageId = _scavengingTaskVillageId;
            _scavengingTaskVillageId = villageId;
            try {
                return await sendScavengeSquadApi(
                    unitCounts, optionId, carryMax, villageId, expectedDecisionHash, true
                );
            } finally {
                _scavengingTaskVillageId = previousVillageId;
            }
        };
        const scheduler = window.PremiumFeaturesBackgroundScheduler;
        if (scheduler?.enqueue) {
            const scheduled = await scheduler.enqueue({
                key: 'manual:scavenging:' + villageId + ':' + String(optionId),
                priority: scheduler.PRIORITY?.MANUAL || 1,
                dueMode: scheduler.DUE_MODE?.EARLIEST || 'EARLIEST',
                leaseKey: 'scavenging:' + villageId,
                run: runLeased
            });
            return scheduled?.status === 'COMPLETED'
                ? scheduled.value
                : { success: false, returnMs: 0, paused: true, error: scheduled?.error };
        }
        const coordinator = window.PremiumFeaturesCoordination;
        if (coordinator?.runWithLease) {
            try {
                return await coordinator.runWithLease('scavenging:' + villageId, runLeased);
            } catch (error) {
                return { success: false, returnMs: 0, paused: true, error };
            }
        }
    }
    if (_scavengingTaskVillageId && !_scavengingLeaseActive(villageId)) {
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: 'scavenging', taskKey: 'scavenging:' + villageId,
            villageId, status: 'SKIPPED', reason: 'lease-lost-before-mutation'
        });
        _deferScavengingForLease(villageId);
        return { success: false, returnMs: 0, paused: true };
    }
    if (!_scavengingDecisionIsCurrent(villageId, expectedDecisionHash, 'stale-config-before-mutation')) {
        return { success: false, returnMs: 0, paused: true, stale: true };
    }

    const params = new URLSearchParams();
    params.set('squad_requests[0][village_id]', villageId);
    Object.entries(unitCounts).forEach(([unit, count]) => {
        params.set(`squad_requests[0][candidate_squad][unit_counts][${unit}]`, count);
    });
    params.set('squad_requests[0][candidate_squad][carry_max]', carryMax);
    params.set('squad_requests[0][option_id]', optionId);
    params.set('squad_requests[0][use_premium]', 'false');
    params.set('h', csrf);
    if (!_scavengingDecisionIsCurrent(villageId, expectedDecisionHash, 'stale-config-before-intent')) {
        return { success: false, returnMs: 0, paused: true, stale: true };
    }
    // Persist the mutation intent before network. If the owner disappears after the server accepts
    // the POST but before JavaScript sees the response, the retained timer performs a GET reconcile.
    const mutationConfig = getScavengeConfig(villageId);
    saveScavengeConfig(Object.assign({}, mutationConfig, {
        uncertain: { optionId: Number(optionId), at: Date.now(), phase: 'executing' }
    }), villageId);
    let data;
    let success = false;
    let returnMs = 0;
    let networkStarted = false;
    let notificationText = t('scavenge.notifySendFailed', { optionId });
    try {
        const targetBase = typeof getVillageLinkBase === 'function'
            ? getVillageLinkBase(villageId)
            : game_data.link_base_pure;
        const url = targetBase + 'scavenge_api&ajaxaction=send_squads';
        const request = () => {
            if (_scavengingHardStopped()) {
                _scavengingStopForProtection(villageId);
                const protectionError = new Error('Bot protection active');
                protectionError.code = 'HARD_STOP';
                throw protectionError;
            }
            if (_scavengingTaskVillageId && !_scavengingLeaseActive(villageId)) {
                const leaseError = new Error('Scavenging lease lost before network');
                leaseError.code = 'LEASE_LOST';
                throw leaseError;
            }
            if (!_scavengingDecisionIsCurrent(villageId, expectedDecisionHash, 'stale-config-immediately-before-network')) {
                const staleError = new Error('Scavenging config changed before network');
                staleError.code = 'STALE_CONFIG';
                throw staleError;
            }
            networkStarted = true;
            return fetch(url, {
                method: 'POST',
                headers: {
                    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'tribalwars-ajax': '1',
                    'x-requested-with': 'XMLHttpRequest',
                },
                body: params.toString(),
                credentials: 'include',
                mode: 'cors',
            });
        };
        const response = await (window.PremiumFeaturesDiagnostics?.request
            ? window.PremiumFeaturesDiagnostics.request({
                feature: 'scavenging', taskKey: 'scavenging:' + villageId,
                villageId, logicalResource: 'scavenging-send:' + villageId,
                method: 'POST', reason: 'send-squad'
            }, request)
            : request());
        if (!response.ok) {
            const responseError = new Error('HTTP ' + response.status);
            responseError.status = response.status;
            responseError.url = response.url || url;
            const failure = window.PremiumFeaturesAsync?.classifyRequestFailure?.(responseError, { url }) || {};
            if (failure.hardStop) {
                _scavengingStopForProtection(villageId);
                return { success: false, returnMs: 0, paused: true, hardStop: true };
            }
            if ([500, 502, 503].includes(Number(response.status))) {
                saveScavengeConfig(Object.assign({}, getScavengeConfig(villageId), {
                    uncertain: { optionId: Number(optionId), at: Date.now(), status: Number(response.status) }
                }), villageId);
                _softPauseScavenging(responseError, 'send-uncertain-http');
                window.PremiumFeaturesDiagnostics?.record?.({
                    feature: 'scavenging', taskKey: 'scavenging:' + villageId,
                    villageId, logicalResource: 'scavenging-send:' + villageId,
                    method: 'POST', status: 'UNCERTAIN', reason: 'http-' + response.status
                });
                return { success: false, returnMs: 0, uncertain: true };
            }
            if (failure.transient) {
                saveScavengeConfig(Object.assign({}, getScavengeConfig(villageId), { uncertain: null }), villageId);
                _softPauseScavenging(responseError, 'send-transient');
                return { success: false, returnMs: 0, paused: true };
            }
            saveScavengeConfig(Object.assign({}, getScavengeConfig(villageId), { uncertain: null }), villageId);
            if (typeof showAutoHideBox === 'function') showAutoHideBox(notificationText, true);
            return { success: false, returnMs: 0 };
        }
        data = await response.json();
        saveScavengeConfig(Object.assign({}, getScavengeConfig(villageId), { uncertain: null }), villageId);
        // Response shape: { response: { squad_responses: [{ success, error }], villages: { ... } } }
        const squadResponse = data?.response?.squad_responses?.[0];
        success = squadResponse?.success === true;
        if (!success) {
            console.warn('[AutoScavenge] Send rejected:', squadResponse?.error ?? 'no squad_responses in response');
        }

        notificationText = success ? t('scavenge.notifySendSuccess', { optionId }) : t('scavenge.notifySendFailed', { optionId });
    } catch (e) {
        console.error('[AutoScavenge] API send failed:', e);
        if (!networkStarted) {
            if (_scavengingDecisionIsCurrent(villageId, expectedDecisionHash)) {
                saveScavengeConfig(Object.assign({}, getScavengeConfig(villageId), { uncertain: null }), villageId);
            }
            if (e?.code === 'LEASE_LOST') _scheduleScavengingAuto(1000, villageId);
            return { success: false, returnMs: 0, paused: true, stale: e?.code === 'STALE_CONFIG' };
        }
        const config = getScavengeConfig(villageId);
        saveScavengeConfig(Object.assign({}, config, {
            uncertain: { optionId: Number(optionId), at: Date.now() }
        }), villageId);
        _softPauseScavenging(e, 'send-uncertain');
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: 'scavenging', taskKey: 'scavenging:' + villageId,
            villageId, logicalResource: 'scavenging-send:' + villageId,
            method: 'POST', status: 'UNCERTAIN', reason: 'send-outcome-unknown'
        });
        if (typeof showAutoHideBox === 'function') showAutoHideBox(notificationText, true);
        return { success: false, returnMs: 0, uncertain: true };
    }

    // Parse return time — attempted even on failure (troops from a different option may already be out).
    // Scan ALL options for the earliest active scavenging_squad.return_time so that when we fail to send
    // to option 1 because units are already in option 2, we still know when to retry.
    // return_time is an epoch timestamp in seconds.
    const responseVillage = data?.response?.villages?.[String(villageId)];
    const villageOptions = responseVillage?.options ?? {};
    const returnAtByOption = {};
    for (const [key, opt] of Object.entries(villageOptions)) {
        const returnAt = _scavengingReturnAtMs(opt?.scavenging_squad?.return_time);
        if (returnAt) returnAtByOption[String(opt?.base_id || key)] = returnAt;
    }
    const earliestReturnAt = Math.min(...Object.values(returnAtByOption).filter(value => value > Date.now()));
    if (Number.isFinite(earliestReturnAt)) returnMs = Math.max(0, earliestReturnAt - Date.now());
    if (responseVillage && Object.prototype.hasOwnProperty.call(responseVillage, 'options')) {
        saveScavengeConfig(Object.assign({}, getScavengeConfig(villageId), { returnAtByOption }), villageId);
    }

    if (typeof showAutoHideBox === 'function') showAutoHideBox(notificationText, !success);

    if (success) {
        _resetScavengingFailures();
        window.PremiumFeaturesBuildState?.invalidate?.(villageId, ['resources'], 'scavenging-send');
        if (String(game_data?.village?.id || '') === String(villageId)) {
            document.querySelectorAll('.scavenge-option').forEach(function (option) {
                const optionIdOnPage = String(option.dataset?.optionId || option.dataset?.option_id || '');
                const returnAt = returnAtByOption[optionIdOnPage];
                if (!returnAt) return;
                option.dataset.twpfReturnAt = String(returnAt);
                option.querySelectorAll('.free_send_button').forEach(function (button) {
                    button.setAttribute('aria-disabled', 'true');
                    button.style.pointerEvents = 'none';
                });
            });
        }
    }

    return { success, returnMs, returnAtByOption,
        homeCounts: responseVillage?.unit_counts_home || null };
}

/**
 * Scheduled entry point for auto-scavenge runs triggered by the timer on any page.
 * Reads unit counts and option ID from the existing scavenge_configs entry for this village.
 * Automatic runs use fresh official home troop counts; lastUnitCounts is diagnostic only.
 */
async function triggerScavengingAuto(villageId) {
    const previousVillageId = _scavengingTaskVillageId;
    _scavengingTaskVillageId = _getScavengeVillageId(villageId);
    try {
        refreshScavengingAutoStatus(_scavengingTaskVillageId);
        return await _triggerScavengingAutoForActiveVillage();
    } finally {
        refreshScavengingAutoStatus(_scavengingTaskVillageId);
        _scavengingTaskVillageId = previousVillageId;
    }
}

async function _triggerScavengingAutoForActiveVillage() {
    const initialConfig = getScavengeConfig();
    if (!initialConfig.enabled && !initialConfig.uncertain) return { status: 'DISABLED' };
    if (_scavengingHardStopped()) return _scavengingStopForProtection(_getScavengeVillageId());
    if (!_scavengingLeaseActive()) return _deferScavengingForLease();
    if (initialConfig.waitLeaseUntil) {
        saveScavengeConfig(Object.assign({}, initialConfig, { waitLeaseUntil: null }));
    }

    // Skip if a timer is already scheduled and still in the future — avoids redundant API calls.
    const existingEndTime = _scavengingScheduledDueAt();
    if (existingEndTime && existingEndTime > Date.now()) {
        console.log('[AutoScavenge] Timer already active, skipping redundant call.');
        return;
    }

    const config = getScavengeConfig();
    const decisionHash = _scavengingDecisionHash(config);
    const retryAt = Number(config.resilience?.retryAt) || 0;
    if (retryAt > Date.now()) {
        _scheduleScavengingAuto(retryAt - Date.now());
        return { status: 'SOFT_PAUSED', retryAt };
    }
    if (config.uncertain && await _reconcileUncertainScavenging(config)) return;
    if (!config.enabled) return;

    // A known return event can make resources available earlier than a Build Queue ETA.
    // Invalidate logically; the queue controller still follows DOM/store/single-flight/network.
    window.PremiumFeaturesBuildState?.invalidateResources?.(_getScavengeVillageId(), 'scavenging-return-due');
    const buildRecord = window.PremiumFeaturesBuildState?.get?.(_getScavengeVillageId());
    if (buildRecord?.queue?.length && typeof ensureBuildQueueController === 'function') {
        ensureBuildQueueController()?.schedule(_getScavengeVillageId(), {
            delayMs: 0,
            priority: window.PremiumFeaturesBackgroundScheduler?.PRIORITY?.RECONCILIATION || 2,
            reason: 'scavenging-return-due'
        });
    }

    if (config.optimizeMode) {
        await runOptimizedScavenge();
        return;
    }

    // For level=0 ("highest available"), the correct option changes each cycle.
    // Fetch the scavenge page HTML to find the currently free option — no redirect needed.
    if (config.level === 0) {
        let fetchedVillage;
        try {
            fetchedVillage = await _fetchScavengingVillageData('automatic-state');
        } catch (e) {
            console.error('[AutoScavenge] Failed to fetch scavenge page:', e);
            _softPauseScavenging(e, 'automatic-state');
            return;
        }
        if (!_scavengingDecisionIsCurrent(_getScavengeVillageId(), decisionHash, 'config-changed-during-state-read')) return;
        _resetScavengingFailures();
        console.log('[AutoScavenge] level=0: village data parsed | options:', Object.keys(fetchedVillage.options || {}));

        // Find highest unlocked option with no active squad
        const fetchedAllOpts = Object.values(fetchedVillage.options || {}).sort((a, b) => a.base_id - b.base_id);
        const fetchedFreeOpts = fetchedAllOpts.filter(opt => !opt.is_locked && opt.scavenging_squad === null);
        const fetchedTarget = fetchedFreeOpts[fetchedFreeOpts.length - 1] || null;
        console.log('[AutoScavenge] level=0: free options:', fetchedFreeOpts.map(o => o.base_id), '| target base_id:', fetchedTarget?.base_id ?? 'none');

        if (!fetchedTarget) {
            // All options busy — find earliest return_time across active squads
            let earliestRt = null;
            fetchedAllOpts.forEach(opt => {
                const rt = opt?.scavenging_squad?.return_time;
                if (rt && (earliestRt === null || rt < earliestRt)) earliestRt = rt;
            });
            const spreadMs = _scavSpreadDelayMs();
            const waitMs = earliestRt ? Math.max(0, earliestRt * 1000 - Date.now()) + spreadMs : 0;
            console.log('[AutoScavenge] level=0: all options busy | earliest return_time:', earliestRt, '| waiting:', Math.round(waitMs / 60000), 'min (incl. deterministic spread).');
            _scheduleScavengingAuto(waitMs > 0 ? waitMs : 30 * 60 * 1000);
            return;
        }

        const fetchedOptionId = fetchedTarget.base_id;
        console.log('[AutoScavenge] level=0: resolved optionId:', fetchedOptionId);

        // Use unit_counts_home for units (exclude militia and knight — bot intentionally skips paladin)
        let fetchedUnitCounts = {};
        if (config.allUnits !== false) {
            const home = fetchedVillage.unit_counts_home || {};
            fetchedUnitCounts = Object.fromEntries(
                Object.entries(home).filter(([unit, count]) => Number(count) > 0 && SCAVENGE_AUTO_UNITS.includes(unit))
            );
            console.log('[AutoScavenge] level=0: unit counts from unit_counts_home:', JSON.stringify(fetchedUnitCounts));
        } else {
            fetchedUnitCounts = config.units || {};
        }

        if (Object.keys(fetchedUnitCounts).length === 0) {
            console.warn('[AutoScavenge] level=0: no unit counts available; retrying in 30 min.');
            _scheduleScavengingAuto(30 * 60 * 1000);
            return;
        }
        if (Object.entries(fetchedUnitCounts).some(([unit, count]) =>
            Number(count) > Number(fetchedVillage.unit_counts_home?.[unit] || 0))) {
            console.warn('[AutoScavenge] level=0: requested troops are not at home.');
            _scheduleScavengingAuto(30 * 60 * 1000);
            return;
        }

        const updatedConfig = { ...getScavengeConfig(), optionId: fetchedOptionId, lastUnitCounts: fetchedUnitCounts };
        saveScavengeConfig(updatedConfig);
        const fetchedCarryMax = Object.entries(fetchedUnitCounts).reduce(
            (sum, [unit, count]) => sum + count * (SCAVENGE_UNIT_CARRY[unit] || 0), 0
        );
        console.log('[AutoScavenge] level=0: sending | optionId:', fetchedOptionId, '| carryMax:', fetchedCarryMax, '| units:', JSON.stringify(fetchedUnitCounts));
        const fetchedResult = await sendScavengeSquadApi(
            fetchedUnitCounts, fetchedOptionId, fetchedCarryMax,
            _getScavengeVillageId(), _scavengingDecisionHash(updatedConfig)
        );
        if (fetchedResult.uncertain || fetchedResult.paused) return;
        console.log('[AutoScavenge] level=0: result — success:', fetchedResult.success, '| returnMs:', fetchedResult.returnMs);
        if (fetchedResult.returnMs > 0) {
            const spreadMs = _scavSpreadDelayMs();
            const totalMs = fetchedResult.returnMs + spreadMs;
            console.log('[AutoScavenge] level=0: next run in', Math.round(totalMs / 60000), 'min (incl.', Math.round(spreadMs / 60000), 'min deterministic spread).');
            _scheduleScavengingAuto(totalMs);
        } else if (fetchedResult.success) {
            console.warn('[AutoScavenge] level=0: send succeeded but no returnMs — retrying in 5 min.');
            _scheduleScavengingAuto(5 * 60 * 1000);
        } else {
            console.warn('[AutoScavenge] level=0: send failed with no returnMs — retrying in 30 min.');
            _scheduleScavengingAuto(30 * 60 * 1000);
        }
        if (game_data?.screen === 'overview' && typeof getPlaceInfo === 'function') { getPlaceInfo(); }
        return;
    }

    // A due return is a reason for one fresh official observation. Saved unit counts describe
    // the previous send, not troops presently at home, and cannot authorize another POST.
    let fixedVillage;
    try {
        fixedVillage = await _fetchScavengingVillageData('fixed-level-due');
    } catch (error) {
        _softPauseScavenging(error, 'fixed-level-due');
        return;
    }
    if (!_scavengingDecisionIsCurrent(_getScavengeVillageId(), decisionHash, 'config-changed-during-fixed-read')) return;
    _resetScavengingFailures();
    const unlockedOptions = Object.values(fixedVillage.options || {})
        .filter(option => !option.is_locked)
        .sort((first, second) => Number(first.base_id) - Number(second.base_id));
    const targetOption = unlockedOptions[Number(config.level) - 1];
    if (!targetOption) {
        _scheduleScavengingAuto(30 * 60 * 1000);
        return;
    }
    const optionId = targetOption.base_id;
    if (targetOption.scavenging_squad) {
        const returnAt = _scavengingReturnAtMs(targetOption.scavenging_squad.return_time);
        _scheduleScavengingAuto(returnAt && returnAt > Date.now() ? returnAt - Date.now() : 30 * 60 * 1000);
        return;
    }
    const home = fixedVillage.unit_counts_home || {};
    const unitCounts = config.allUnits !== false
        ? Object.fromEntries(Object.entries(home).filter(([unit, count]) =>
            Number(count) > 0 && SCAVENGE_AUTO_UNITS.includes(unit)))
        : Object.fromEntries(Object.entries(config.units || {}).filter(([, count]) => Number(count) > 0));
    if (!Object.keys(unitCounts).length || Object.entries(unitCounts).some(([unit, count]) =>
        Number(count) > Number(home[unit] || 0))) {
        console.warn('[AutoScavenge] Required troops are not at home; deferring the next observation.');
        _scheduleScavengingAuto(30 * 60 * 1000);
        return;
    }
    const currentConfig = getScavengeConfig();
    if (Number(currentConfig.optionId) !== Number(optionId) ||
        JSON.stringify(currentConfig.lastUnitCounts || {}) !== JSON.stringify(unitCounts)) {
        saveScavengeConfig({ ...currentConfig, optionId, lastUnitCounts: unitCounts });
    }

    console.log('[AutoScavenge] Sending level', config.level, '| optionId:', optionId, '| units:', JSON.stringify(unitCounts));
    const carryMax = Object.entries(unitCounts).reduce(
        (sum, [unit, count]) => sum + count * (SCAVENGE_UNIT_CARRY[unit] || 0), 0
    );

    const result = await sendScavengeSquadApi(
        unitCounts,
        optionId,
        carryMax,
        _getScavengeVillageId(),
        _scavengingDecisionHash({ ...getScavengeConfig(), optionId, lastUnitCounts: unitCounts })
    );
    if (result.uncertain || result.paused) return;
    console.log('[AutoScavenge] Result — success:', result.success, '| returnMs:', result.returnMs);
    const targetReturnAt = Number(result.returnAtByOption?.[String(optionId)]) || 0;
    if (targetReturnAt > Date.now()) {
        _scheduleScavengingAuto(targetReturnAt - Date.now());
    } else if (result.success) {
        _scheduleScavengingAuto(5 * 60 * 1000);
    } else {
        _scheduleScavengingAuto(30 * 60 * 1000);
    }
    if (game_data?.screen === 'overview' && typeof getPlaceInfo === 'function') { getPlaceInfo(); }
}

/**
 * Injects the per-village auto-scavenge configuration panel into the scavenge screen.
 * Renders controls for enabling automation, choosing the scavenge level,
 * and optionally specifying exact unit amounts.
 */
function injectScavengeConfigPanel() {
    const container = document.querySelector('.scavenge-screen-main-widget');
    if (!container || document.getElementById('scavenge_bot_config')) return;

    const config = getScavengeConfig();
    const allOptions = Array.from(document.querySelectorAll('.scavenge-option'));
    const unlockedOptions = allOptions.filter(opt => !opt.querySelector('.locked-view'));
    const unitMeta = getOriginalScavengeUnitMeta();
    const unitNames = unitMeta.map(item => item.unit);

    const panel = document.createElement('div');
    panel.id = 'scavenge_bot_config';
    panel.className = 'vis';
    panel.style.cssText = 'width: 100%;';

    const header = document.createElement('h4');
    header.className = 'head with-button';
    header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; cursor: pointer; margin-bottom: 0;';
    const headerText = document.createElement('span');
    headerText.textContent = t('scavenge.panelTitle');
    header.appendChild(headerText);
    const toggleImg = document.createElement('img');
    toggleImg.src = 'https://dspt.innogamescdn.com/asset/95eda994/graphic//icons/slide_down.png';
    toggleImg.alt = t('button.collapse');
    toggleImg.className = 'village-list-toggle';
    toggleImg.style.cssText = 'transform: rotate(180deg); transition: transform 0.2s; cursor: pointer;';
    header.appendChild(toggleImg);
    panel.appendChild(header);

    const contentDiv = document.createElement('div');
    contentDiv.id = 'scavenge_bot_config_content';

    const table = document.createElement('table');
    table.className = 'vis';
    table.style.cssText = 'width:100%;table-layout:fixed;';
    const colgroup = document.createElement('colgroup');
    const col0 = document.createElement('col');
    col0.style.width = '90px';
    const col1 = document.createElement('col');
    colgroup.appendChild(col0);
    colgroup.appendChild(col1);
    table.appendChild(colgroup);
    const tbody = document.createElement('tbody');

    // Enable/disable automation for this village
    const enableRow = tbody.insertRow();
    const ec0 = enableRow.insertCell(0);
    ec0.style.fontWeight = 'bold';
    ec0.textContent = t('scavenge.automationLabel');
    const ec1 = enableRow.insertCell(1);
    const enableLabel = document.createElement('label');
    const enableCheckbox = document.createElement('input');
    enableCheckbox.type = 'checkbox';
    enableCheckbox.id = 'scavenge_config_enabled';
    enableCheckbox.checked = config.enabled === true;
    enableCheckbox.style.marginRight = '5px';
    enableLabel.appendChild(enableCheckbox);
    enableLabel.appendChild(document.createTextNode(t('scavenge.enableLabel')));
    ec1.appendChild(enableLabel);

    const statusRow = tbody.insertRow();
    statusRow.insertCell(0).textContent = t('scavenge.statusLabel');
    const statusCell = statusRow.insertCell(1);
    statusCell.id = 'scavenge_auto_status';
    function refreshAutomationStatus() {
        refreshScavengingAutoStatus(undefined, statusCell, enableCheckbox.checked);
    }
    refreshAutomationStatus();

    // Optimized multi-level row
    const optimizeRow = tbody.insertRow();
    optimizeRow.insertCell(0);
    const optimizeCell = optimizeRow.insertCell(1);
    const optimizeLabel = document.createElement('label');
    const optimizeCheckbox = document.createElement('input');
    optimizeCheckbox.type = 'checkbox';
    optimizeCheckbox.id = 'scavenge_config_optimize';
    optimizeCheckbox.checked = config.optimizeMode === true;
    optimizeCheckbox.style.marginRight = '5px';
    optimizeLabel.appendChild(optimizeCheckbox);
    const optimizeSpan = document.createElement('span');
    optimizeSpan.textContent = t('scavenge.optimizeLabel');
    optimizeLabel.appendChild(optimizeSpan);
    optimizeCell.appendChild(optimizeLabel);
    const optimizeHint = document.createElement('div');
    optimizeHint.style.cssText = 'font-size:10px;color:#888;margin-top:2px;line-height:1.3;';
    optimizeHint.textContent = t('scavenge.optimizeHint');
    optimizeCell.appendChild(optimizeHint);

    // Level selection — checkboxes (one per unlocked level; single-select unless optimize mode is on)
    const levelRow = tbody.insertRow();
    levelRow.id = 'scavenge_levels_row';
    const lc0 = levelRow.insertCell(0);
    lc0.style.fontWeight = 'bold';
    function isScavengeOptionRunning(opt) {
        return !!opt?.querySelector('.return-countdown');
    }

    function syncLevelCheckboxState() {
        const autoEnabled = enableCheckbox.checked;
        levelCheckboxes.forEach((cb, idx) => {
            const opt = unlockedOptions[idx];
            const isRunning = isScavengeOptionRunning(opt);
            cb.disabled = !autoEnabled && isRunning;
            const label = cb.closest('label');
            if (label) label.style.opacity = cb.disabled ? '0.55' : '';
            if (cb.disabled) cb.checked = false;
        });

        const enabledBoxes = levelCheckboxes.filter(cb => !cb.disabled);

        if (!autoEnabled) {
            if (optimizeCheckbox.checked) {
                enabledBoxes.forEach(cb => { cb.checked = true; });
            } else {
                const checkedBoxes = enabledBoxes.filter(cb => cb.checked);
                if (checkedBoxes.length > 1) {
                    const keepBox = checkedBoxes[checkedBoxes.length - 1];
                    enabledBoxes.forEach(cb => { if (cb !== keepBox) cb.checked = false; });
                } else if (checkedBoxes.length === 0 && enabledBoxes.length > 0) {
                    enabledBoxes[enabledBoxes.length - 1].checked = true;
                }
            }
            return;
        }

        if (!optimizeCheckbox.checked) {
            const checkedBoxes = enabledBoxes.filter(cb => cb.checked);

            if (checkedBoxes.length > 1) {
                const keepBox = checkedBoxes[checkedBoxes.length - 1];
                enabledBoxes.forEach(cb => { if (cb !== keepBox) cb.checked = false; });
            } else if (checkedBoxes.length === 0 && enabledBoxes.length > 0) {
                enabledBoxes[enabledBoxes.length - 1].checked = true;
            }
        }
    }

    function syncActionButtons() {
        const autoEnabled = enableCheckbox.checked;
        startBtn.style.display = autoEnabled ? '' : 'none';
        sendNowBtn.style.display = autoEnabled ? 'none' : '';
        const modeRowEl = document.getElementById('scavenge_mode_row');
        if (modeRowEl) {
            modeRowEl.style.display = optimizeCheckbox.checked ? '' : 'none';
        }
    }

    function applyManualDefaults() {
        const selectableBoxes = levelCheckboxes.filter(cb => !cb.disabled);
        if (selectableBoxes.length > 0) {
            selectableBoxes.forEach(cb => { cb.checked = false; });
            selectableBoxes[selectableBoxes.length - 1].checked = true;
        }
        unitMeta.forEach(({ unit, maxCount }) => {
            const input = document.getElementById('scavenge_config_unit_' + unit);
            if (input) _scavengeSetInputValue(input, maxCount);
        });
    }

    function getCurrentUnits() {
        const units = {}
        unitNames.forEach(unit => {
            const inp = document.getElementById('scavenge_config_unit_' + unit);
            units[unit] = inp ? (parseInt(inp.value, 10) || 0) : 0;
        });
        return units;
    }

    lc0.textContent = t('scavenge.levelLabel');
    const lc1 = levelRow.insertCell(1);
    const levelCheckboxes = [];
    unlockedOptions.forEach((opt, i) => {
        const optAllIdx = allOptions.indexOf(opt);
        const label = document.createElement('label');
        label.style.cssText = 'margin-right:12px;white-space:nowrap;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 'scavenge_config_level_' + (i + 1);
        cb.dataset.levelIndex = String(i + 1);
        cb.dataset.baseId = String(parseInt(opt.dataset.optionId || opt.dataset.option_id || (optAllIdx + 1)));
        cb.dataset.ratio = String(SCAVENGE_TIER_RATIOS[optAllIdx] || 0);
        cb.style.marginRight = '4px';
        if (config.optimizeMode) {
            const saved = config.selectedLevelIndices || [];
            cb.checked = saved.length === 0 || saved.includes(i + 1);
        } else {
            const savedLevel = config.level != null ? config.level : unlockedOptions.length;
            cb.checked = savedLevel === i + 1 || (savedLevel === 0 && i === unlockedOptions.length - 1);
        }
        cb.onchange = () => {
            if (cb.disabled) {
                cb.checked = false;
                return;
            }
            if (!document.getElementById('scavenge_config_optimize').checked) {
                if (!cb.checked) { cb.checked = true; return; }
                levelCheckboxes.forEach(other => { if (other !== cb) other.checked = false; });
            }
            refreshDistributionPreview();
        };
        const titleEl = opt.querySelector('.title');
        label.appendChild(cb);
        label.appendChild(document.createTextNode(titleEl ? titleEl.textContent.trim() : t('scavenge.levelFallback', { level: i + 1 })));
        lc1.appendChild(label);
        levelCheckboxes.push(cb);
    });

    // Calculation mode row — visible only in optimize mode
    const modeRow = tbody.insertRow();
    modeRow.id = 'scavenge_mode_row';
    modeRow.style.display = config.optimizeMode ? '' : 'none';
    const mr0 = modeRow.insertCell(0);
    mr0.style.fontWeight = 'bold';
    mr0.textContent = t('scavenge.modeLabel');
    const mr1 = modeRow.insertCell(1);
    [['balanced', t('scavenge.modeBalanced')], ['fastest', t('scavenge.modeFastest')]].forEach(([val, lbl]) => {
        const label = document.createElement('label');
        label.style.marginRight = '10px';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'scavenge_optimize_mode';
        radio.value = val;
        radio.checked = (config.optimizeCalculationMode || 'balanced') === val;
        radio.style.marginRight = '4px';
        radio.onchange = () => refreshDistributionPreview();
        label.appendChild(radio);
        label.appendChild(document.createTextNode(lbl));
        mr1.appendChild(label);
    });

    // Units configuration row — always visible, inputs disabled when allUnits is checked
    const unitsRow = tbody.insertRow();
    unitsRow.id = 'scavenge_units_row';
    const unitsCell = unitsRow.insertCell(0);
    unitsCell.colSpan = 2;
    unitsCell.style.padding = '0';
    unitsCell.style.paddingTop = '6px';

    const unitsWrapper = document.createElement('div');
    unitsWrapper.className = 'candidate-squad-widget vis';
    unitsWrapper.style.cssText = 'padding: 4px 2px;';

    const unitsTable = document.createElement('table');
    unitsTable.className = 'vis';
    unitsTable.style.cssText = 'width: 100%; font-size: 11px; border-collapse: collapse;';
    const unitsThead = document.createElement('thead');
    const unitsTbody = document.createElement('tbody');
    const imgRow = document.createElement('tr');
    const inputRow = document.createElement('tr');
    const assetBase = typeof image_base !== 'undefined' ? image_base : 'graphic/';

    const troopMeta = unitMeta.filter(({ unit }) => unit !== 'knight');

    troopMeta.forEach(({ unit, maxCount }) => {
        // Header: unit icon
        const th = document.createElement('th');
        th.style.cssText = 'text-align: center; padding: 2px 1px;';
        const img = document.createElement('img');
        img.src = assetBase + 'unit/unit_' + unit + '.webp';
        img.style.cssText = 'display: block; margin: 0 auto;';
        img.title = typeof getUnitDisplayName === 'function' ? getUnitDisplayName(unit) : unit;
        th.appendChild(img);
        imgRow.appendChild(th);

        // Body: input field + max shortcut
        const td = document.createElement('td');
        td.style.cssText = 'text-align: center; padding: 2px 1px; vertical-align: top;';
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.min = '0';
        inp.value = (config.units && config.units[unit] != null) ? config.units[unit].toString() : '0';
        inp.id = 'scavenge_config_unit_' + unit;
        inp.className = 'unitsInput input-nicer';
        inp.style.cssText = 'width: 42px; text-align: center;';
        inp.oninput = () => refreshDistributionPreview();
        td.appendChild(inp);

        td.appendChild(document.createElement('br'));
        const maxLink = document.createElement('a');
        maxLink.href = '#';
        maxLink.className = 'units-entry-all squad-village-required';
        maxLink.dataset.unit = unit;
        maxLink.dataset.allCount = String(maxCount);
        maxLink.textContent = `(${maxCount})`;
        maxLink.style.cssText = 'display: inline-block; margin-top: 2px;';
        maxLink.onclick = event => {
            event.preventDefault();
            const current = parseInt(inp.value, 10) || 0;
            _scavengeSetInputValue(inp, current === maxCount ? '' : maxCount);
        };
        td.appendChild(maxLink);

        inputRow.appendChild(td);
    });

    const allUnitsTh = document.createElement('th');
    allUnitsTh.className = 'squad-village-required';
    allUnitsTh.textContent = t('scavenge.allUnitsLabel');
    imgRow.appendChild(allUnitsTh);

    const allUnitsTd = document.createElement('td');
    allUnitsTd.className = 'squad-village-required';
    allUnitsTd.style.cssText = 'text-align: center; padding: 2px 1px;';
    const fillAllLink = document.createElement('a');
    fillAllLink.href = '#';
    fillAllLink.className = 'fill-all';
    fillAllLink.textContent = t('scavenge.fillAllUnits');
    fillAllLink.onclick = event => {
        event.preventDefault();
        unitMeta.forEach(({ unit, maxCount }) => {
            const input = document.getElementById('scavenge_config_unit_' + unit);
            _scavengeSetInputValue(input, maxCount);
        });
    };
    allUnitsTd.appendChild(fillAllLink);
    inputRow.appendChild(allUnitsTd);

    unitsThead.appendChild(imgRow);
    unitsTbody.appendChild(inputRow);
    unitsTable.appendChild(unitsThead);
    unitsTable.appendChild(unitsTbody);
    unitsWrapper.appendChild(unitsTable);
    unitsCell.appendChild(unitsWrapper);

    table.appendChild(tbody);
    contentDiv.appendChild(table);

    optimizeCheckbox.onchange = () => {
        const isOpt = optimizeCheckbox.checked;
        const autoEnabled = enableCheckbox.checked;
        const modeRowEl = document.getElementById('scavenge_mode_row');
        if (modeRowEl) modeRowEl.style.display = isOpt ? '' : 'none';
        if (!isOpt && autoEnabled) {
            // Switch to single-select: keep only the highest currently-checked level
            const checkedBoxes = levelCheckboxes.filter(cb => cb.checked);
            const keepBox = checkedBoxes[checkedBoxes.length - 1] || levelCheckboxes[levelCheckboxes.length - 1];
            levelCheckboxes.forEach(cb => { cb.checked = cb === keepBox; });
        }
        if (!autoEnabled) applyManualDefaults();
        syncLevelCheckboxState();
        refreshDistributionPreview();
    };

    function getSelectedUnlockedOptsData() {
        const selectedIndices = levelCheckboxes.filter(cb => cb.checked && !cb.disabled).map(cb => parseInt(cb.dataset.levelIndex));
        const allScavOpts = Array.from(document.querySelectorAll('.scavenge-option'));
        let unlockIdx = 0;
        return allScavOpts
            .map((opt, idx) => {
                if (opt.querySelector('.locked-view')) return null;
                unlockIdx++;
                if (!selectedIndices.includes(unlockIdx)) return null;
                return { el: opt, base_id: parseInt(opt.dataset.optionId || opt.dataset.option_id || (idx + 1)), ratio: SCAVENGE_TIER_RATIOS[idx] || 0 };
            })
            .filter(o => o && o.ratio > 0);
    }

    const startBtn = document.createElement('a');
    startBtn.className = 'btn btn-default';
    startBtn.style.marginTop = '8px';
    startBtn.textContent = t('scavenge.saveAndStart');
    startBtn.style.display = enableCheckbox.checked ? '' : 'none';
    startBtn.onclick = async () => {
        const isOptimize = document.getElementById('scavenge_config_optimize').checked;
        const isEnabled = document.getElementById('scavenge_config_enabled').checked;
        const units = getCurrentUnits();

        if (isOptimize) {
            const calcMode = document.querySelector('input[name="scavenge_optimize_mode"]:checked')?.value || 'balanced';
            const unlockedOptsData = getSelectedUnlockedOptsData();
            const selectedLevelIndices = levelCheckboxes.filter(cb => cb.checked && !cb.disabled).map(cb => parseInt(cb.dataset.levelIndex));

            const { distributionByOption } = computeScavengeOptimizedDistribution(units, unlockedOptsData, calcMode);

            saveScavengeConfig({ enabled: isEnabled, level: 0, units, optimizeMode: true, optimizeCalculationMode: calcMode, distributionByOption, selectedLevelIndices });

            refreshDistributionPreview();

            if (typeof showAutoHideBox === 'function') showAutoHideBox(t('scavenge.configurationSaved'), false);
        } else {
            const selectableBoxes = levelCheckboxes.filter(cb => !cb.disabled);
            const selectedCb = selectableBoxes.find(cb => cb.checked) || selectableBoxes[selectableBoxes.length - 1];
            const selectedLevel = selectedCb ? parseInt(selectedCb.dataset.levelIndex) : unlockedOptions.length;
            saveScavengeConfig({ enabled: true, level: selectedLevel, units, optimizeMode: false, distributionByOption: null });
            if (typeof showAutoHideBox === 'function') showAutoHideBox(t('scavenge.configurationSaved'), false);
        }

        if (isEnabled) _scheduleScavengingAuto(0);
        else if (typeof clearPersistedTimeout === 'function') clearPersistedTimeout(_scavengingTimerId());
        refreshAutomationStatus();
    };
    contentDiv.appendChild(startBtn);

    enableCheckbox.onchange = () => {
        syncActionButtons();
        syncLevelCheckboxState();
        if (!enableCheckbox.checked) {
            applyManualDefaults();
            saveScavengeConfig(Object.assign({}, getScavengeConfig(), { enabled: false }));
            if (typeof clearPersistedTimeout === 'function') clearPersistedTimeout(_scavengingTimerId());
        }
        refreshAutomationStatus();
        refreshDistributionPreview();
    };

    syncLevelCheckboxState();
    if (!enableCheckbox.checked) {
        applyManualDefaults();
    }

    const sendNowBtn = document.createElement('a');
    sendNowBtn.className = 'btn btn-default';
    sendNowBtn.style.cssText = 'margin-top:8px;margin-left:6px;';
    sendNowBtn.textContent = t('scavenge.sendNow');
    sendNowBtn.style.display = enableCheckbox.checked ? 'none' : '';
    sendNowBtn.onclick = async () => {
        const originalContent = sendNowBtn.innerHTML;
        sendNowBtn.disabled = true;
        sendNowBtn.innerHTML = '<img src="https://dsbr.innogamescdn.com/asset/f441272cc5/graphic/loading.gif" alt="" style="height:14px;vertical-align:middle;">';

        try {
            const isOptimize = document.getElementById('scavenge_config_optimize').checked;
            const units = getCurrentUnits();
            const isEnabled = document.getElementById('scavenge_config_enabled').checked;
            const useOptimizeMode = isOptimize;

            if (useOptimizeMode) {
                const calcMode = document.querySelector('input[name="scavenge_optimize_mode"]:checked')?.value || 'balanced';
                const unlockedOptsData = getSelectedUnlockedOptsData();
                const selectedLevelIndices = levelCheckboxes.filter(cb => cb.checked && !cb.disabled).map(cb => parseInt(cb.dataset.levelIndex));
                const { distributionByOption } = computeScavengeOptimizedDistribution(units, unlockedOptsData, calcMode);
                saveScavengeConfig({
                    enabled: isEnabled,
                    level: 0,
                    units,
                    optimizeMode: true,
                    optimizeCalculationMode: calcMode,
                    distributionByOption,
                    selectedLevelIndices,
                });
                await sendOptimizedScavengeNow(units, unlockedOptsData, calcMode);
            } else {
                // Manual send: use the current panel values, but do not enable automation.
                const selectableBoxes = levelCheckboxes.filter(cb => !cb.disabled);
                const selectedCb = selectableBoxes[selectableBoxes.length - 1] || null;
                if (!selectedCb) {
                    if (typeof showAutoHideBox === 'function') showAutoHideBox(t('scavenge.noSelectableLevel'), true);
                    return;
                }
                const level = parseInt(selectedCb.dataset.levelIndex);

                const nonZeroUnits = Object.fromEntries(Object.entries(units).filter(([, v]) => v > 0));
                if (!Object.keys(nonZeroUnits).length) {
                    if (typeof showAutoHideBox === 'function') showAutoHideBox(t('scavenge.noUnitsSpecified'), true);
                    return;
                }

                const allScavOpts = Array.from(document.querySelectorAll('.scavenge-option'));
                let targetOpt = null;
                if (level === 0) {
                    const available = allScavOpts.filter(opt => opt.querySelector('.inactive-view .free_send_button'));
                    targetOpt = available[available.length - 1] || null;
                } else {
                    const unlocked = allScavOpts.filter(opt => !opt.querySelector('.locked-view'));
                    targetOpt = unlocked[level - 1] || null;
                }

                if (!targetOpt) {
                    if (typeof showAutoHideBox === 'function') showAutoHideBox(t('scavenge.noOptionFound'), true);
                    return;
                }

                const optionId = parseInt(targetOpt.dataset.optionId || targetOpt.dataset.option_id || (allScavOpts.indexOf(targetOpt) + 1));
                const carryMax = Object.entries(nonZeroUnits).reduce((sum, [unit, count]) => sum + count * (SCAVENGE_UNIT_CARRY[unit] || 0), 0);
                const result = await sendScavengeSquadApi(
                    nonZeroUnits, optionId, carryMax,
                    _getScavengeVillageId(), _scavengingDecisionHash(getScavengeConfig())
                );
                if (result.uncertain || result.paused) return;

                if (result.success) {
                    saveScavengeConfig({ enabled: false, level, units, optimizeMode: false, allUnits: false, distributionByOption: null });
                }
                if (result.returnMs > 0 && isEnabled) {
                    _scheduleScavengingAuto(result.returnMs);
                }
            }
        } finally {
            sendNowBtn.disabled = false;
            sendNowBtn.innerHTML = originalContent;
            refreshAutomationStatus();
        }
    };
    contentDiv.appendChild(sendNowBtn);

    function refreshDistributionPreview() {
        const optimizeEnabled = document.getElementById('scavenge_config_optimize')?.checked;
        const tableDiv = document.getElementById('scavenge_dist_table');
        if (!optimizeEnabled) {
            if (tableDiv) tableDiv.style.display = 'none';
            return;
        }

        const previewUnits = {};
        unitNames.forEach(unit => {
            const inp = document.getElementById('scavenge_config_unit_' + unit);
            previewUnits[unit] = inp ? (parseInt(inp.value, 10) || 0) : 0;
        });
        const calcMode = document.querySelector('input[name="scavenge_optimize_mode"]:checked')?.value || 'balanced';
        const unlockedOptsData = getSelectedUnlockedOptsData();
        const { tableHtml } = computeScavengeOptimizedDistribution(previewUnits, unlockedOptsData, calcMode);
        if (!tableDiv) {
            const newTableDiv = document.createElement('div');
            newTableDiv.id = 'scavenge_dist_table';
            contentDiv.appendChild(newTableDiv);
            newTableDiv.innerHTML = tableHtml;
            return;
        }

        tableDiv.style.display = '';
        tableDiv.innerHTML = tableHtml;
    }

    // Show table on load if optimize mode is already active
    refreshDistributionPreview();
    syncActionButtons();

    panel.appendChild(contentDiv);

    const toggleKey = 'scavenge_panel_collapsed_' + (game_data?.village?.id || '');
    const isCollapsed = localStorage.getItem(toggleKey) === '1';
    if (isCollapsed) {
        contentDiv.style.display = 'none';
        toggleImg.style.transform = 'rotate(0deg)';
        toggleImg.alt = t('button.expand');
        toggleImg.title = t('button.expand');
    } else {
        toggleImg.alt = t('button.collapse');
        toggleImg.title = t('button.collapse');
    }

    header.onclick = () => {
        const isVisible = contentDiv.style.display !== 'none';
        contentDiv.style.display = isVisible ? 'none' : '';
        toggleImg.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(180deg)';
        toggleImg.alt = isVisible ? t('button.expand') : t('button.collapse');
        toggleImg.title = isVisible ? t('button.expand') : t('button.collapse');
        localStorage.setItem(toggleKey, isVisible ? '1' : '0');
    };

    container.insertBefore(panel, container.firstChild);
}

/**
 * Entry point called when the scavenge screen loads.
 * Injects the config panel and starts auto-scavenging if enabled for this village.
 */
function injectAutoScavengingOption() {
    injectScavengeConfigPanel();
    _ensureScavengingAutoWake();
}

/**
 * Main auto-scavenge loop. Selects the target scavenge option based on village config,
 * fills in the troops (all available or specific amounts), and sends via API.
 * If a mission is already in progress, schedules the next check and exits immediately.
 */
async function runAutoScavengingAll() {
    // Skip if a timer is already scheduled and still in the future — avoids redundant API calls on every page visit.
    const existingEndTime = _scavengingScheduledDueAt();
    if (existingEndTime && existingEndTime > Date.now()) {
        console.log('[AutoScavenge] Timer already active, skipping run.');
        return;
    }

    const config = getScavengeConfig();
    const decisionHash = _scavengingDecisionHash(config);

    if (config.optimizeMode) {
        await runOptimizedScavenge();
        return;
    }

    // Resolve target .scavenge-option based on per-village config
    const allOptions = Array.from(document.querySelectorAll('.scavenge-option'));
    let targetOption = null;
    if (config.level === 0) {
        // Auto: highest available (last option with an active free_send_button)
        const available = allOptions.filter(opt => opt.querySelector('.inactive-view .free_send_button'));
        targetOption = available[available.length - 1] || null;
    } else {
        // Specific level index among unlocked options
        const unlocked = allOptions.filter(opt => !opt.querySelector('.locked-view'));
        targetOption = unlocked[config.level - 1] || null;
    }

    const returnTime = targetOption
        ? targetOption.querySelector('.return-countdown')
        : document.querySelector('.return-countdown');

    // If a mission is already in progress, schedule the next check and exit.
    if (returnTime) {
        const waitTime = Math.floor(timeToMilliseconds(returnTime.textContent));
        if (waitTime > 0) {
            const spreadMs = _scavSpreadDelayMs();
            _scheduleScavengingAuto(waitTime + spreadMs);
        }
        return;
    }

    // --- API approach ---
    console.log('[AutoScavenge] runAutoScavengingAll: targetOption:', !!targetOption, '| level:', config.level, '| allUnits:', config.allUnits);
    if (targetOption) {
        // Fill unit inputs via DOM first so we can read the final counts.
        const originalWidget = getOriginalScavengeWidget();
        if (config.allUnits !== false) {
            // Click all units-entry-all except the last (paladin) to populate inputs.
            const unitAllButtons = originalWidget ? originalWidget.querySelectorAll('.units-entry-all') : document.querySelectorAll('.scavenge-option .units-entry-all');
            unitAllButtons.forEach((btn, index) => {
                if (index !== unitAllButtons.length - 1) btn.click();
            });
            await wait(0.1); // allow DOM to reflect updated values
        } else {
            Object.entries(config.units || {}).forEach(([unit, amount]) => {
                const input = document.querySelector(`input[name="${unit}"]`);
                if (input) {
                    input.value = amount.toString();
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        }

        // Read unit counts from the now-filled candidate squad inputs.
        const unitCounts = {};
        const countInputs = originalWidget ? originalWidget.querySelectorAll('input[name]') : document.querySelectorAll('.candidate-squad-widget input[name]');
        countInputs.forEach(inp => {
            const val = parseInt(inp.value, 10) || 0;
            if (val > 0) unitCounts[inp.name] = val;
        });
        console.log('[AutoScavenge] runAutoScavengingAll: unitCounts:', JSON.stringify(unitCounts));

        const carryMax = Object.entries(unitCounts).reduce(
            (sum, [unit, count]) => sum + count * (SCAVENGE_UNIT_CARRY[unit] || 0), 0
        );

        // Derive option_id from the element's data attribute, fall back to 1-based position.
        const optionId = targetOption.dataset.optionId
            || targetOption.dataset.option_id
            || (allOptions.indexOf(targetOption) + 1);
        console.log('[AutoScavenge] runAutoScavengingAll: optionId:', optionId, '| carryMax:', carryMax);

        if (!_scavengingDecisionIsCurrent(_getScavengeVillageId(), decisionHash, 'config-changed-during-dom-read')) return;

        // Write optionId and lastUnitCounts back into scavenge_configs so triggerScavengingAuto
        // can reuse them on the next scheduled call without needing a page redirect.
        const updatedConfig = { ...config, optionId, lastUnitCounts: unitCounts };
        saveScavengeConfig(updatedConfig);

        const result = await sendScavengeSquadApi(
            unitCounts, optionId, carryMax, _getScavengeVillageId(), _scavengingDecisionHash(updatedConfig)
        );
        if (result.uncertain || result.paused) return;
        console.log('[AutoScavenge] runAutoScavengingAll: result — success:', result.success, '| returnMs:', result.returnMs);
        if (result.returnMs > 0) {
            const spreadMs = _scavSpreadDelayMs();
            const totalMs = result.returnMs + spreadMs;
            console.log('[AutoScavenge] runAutoScavengingAll: next run in', Math.round(totalMs / 60000), 'min (incl.', Math.round(spreadMs / 60000), 'min deterministic spread).');
            _scheduleScavengingAuto(totalMs);
        } else if (result.success) {
            console.warn('[AutoScavenge] runAutoScavengingAll: send succeeded but no returnMs — retrying in 5 min.');
            _scheduleScavengingAuto(5 * 60 * 1000);
        } else {
            console.warn('[AutoScavenge] runAutoScavengingAll: send failed with no returnMs — retrying in 30 min.');
            _scheduleScavengingAuto(30 * 60 * 1000);
        }
    } else {
        console.log('[AutoScavenge] runAutoScavengingAll: no targetOption — nothing to send.');
    }

    /* --- LEGACY: DOM click approach — uncomment block below to revert ---
    const startButton = targetOption ? targetOption.querySelector('.inactive-view .free_send_button') : null;
    if (startButton && !returnTime) {
        if (config.allUnits !== false) {
            // Click all units-entry-all except the last (paladin)
            const unitAllButtons = document.querySelectorAll('.units-entry-all');
            unitAllButtons.forEach((btn, index) => {
                if (index !== unitAllButtons.length - 1) btn.click();
            });
        } else {
            // Set specific unit amounts
            Object.entries(config.units || {}).forEach(([unit, amount]) => {
                const input = document.querySelector(`input[name="${unit}"]`);
                if (input) {
                    input.value = amount.toString();
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        }

        startButton.style.color = 'red';
        startButton.click();
        await wait(1);
        const duration = targetOption
            ? targetOption.querySelector('.return-countdown')
            : document.querySelector('.return-countdown');
        if (duration) {
            var waitTime = timeToMilliseconds(duration.textContent);
            if (waitTime > 0) {
                setFunctionOnTimeOut('scavenging-auto', function () {
                    window.location.href = game_data.link_base_pure + 'place&mode=scavenge';
                }, waitTime);
            }
        }
    }
    --- END LEGACY --- */
}


// Not currently in use.
function stopAutoScavenging() {
    const form = document.querySelector('#auto_scavenging_form');
    const unitsInput = Array.from(form.querySelectorAll('input'));

    const unitsInputByName = {};
    unitsInput.forEach(input => {
        unitsInputByName[input.name] = input.value;
    });
}
