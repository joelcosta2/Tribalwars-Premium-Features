// Shared, village-agnostic recruit form: a "recruit context" (see createLiveRecruitContext in
// this file / createOverlayRecruitContext in overviewVillages.js) captures whatever
// differs between "the currently loaded village" (live DOM resources, sidebar widget) and
// "some other village" (a static fetched snapshot, rendered into a popup/overlay), so
// calculateMaxTroops/submitTroops/disperseTroops/renderRecruitForm below work for either.

/**
 * Persistent context for the sidebar Recruit widget (always the currently loaded village).
 * Recreated only when the displayed village actually changes (see injectRecruitTroopsWidget).
 */
var liveRecruitContext = null;

const RECRUIT_MUTATION_OUTCOME = Object.freeze({
    CONFIRMED: 'CONFIRMED',
    FAILED: 'FAILED',
    UNCERTAIN: 'UNCERTAIN'
});

function setButtonLoadingState(button, isLoading, fallbackLabel) {
    if (!button) return;

    if (isLoading) {
        if (button.dataset.originalContent == null) {
            button.dataset.originalContent = button.innerHTML;
        }
        button.disabled = true;
        button.innerHTML = '<img src="https://dsbr.innogamescdn.com/asset/f441272cc5/graphic/loading.gif" id="" alt="" class="" style="height:14px;vertical-align:middle;">';
        return;
    }

    button.disabled = false;
    button.innerHTML = button.dataset.originalContent || fallbackLabel || button.textContent || '';
    delete button.dataset.originalContent;
}

function readRecruitQueueSnapshot(villageId, units) {
    const queue = bqGet('train_queue_data', villageId) || {};
    return Object.fromEntries(Object.keys(units || {}).map(function (unit) {
        return [unit, Math.max(0, Number(queue[unit]) || 0)];
    }));
}

function recruitUncertainStorageKey(villageId) {
    return 'twpf_recruit_uncertain:' + String(villageId);
}

function loadRecruitUncertain(villageId) {
    try {
        const value = JSON.parse(localStorage.getItem(recruitUncertainStorageKey(villageId)) || 'null');
        return value && typeof value === 'object' && value.units && value.before ? value : null;
    } catch (_error) {
        return null;
    }
}

function setRecruitUncertain(ctx, value) {
    ctx.recruitUncertain = value;
    if (value) localStorage.setItem(recruitUncertainStorageKey(ctx.villageId), JSON.stringify(value));
    else localStorage.removeItem(recruitUncertainStorageKey(ctx.villageId));
}

function classifyRecruitReconciliation(before, after, submittedUnits) {
    const units = Object.keys(submittedUnits || {});
    if (!units.length) return 'UNKNOWN';
    const applied = units.every(function (unit) {
        return (Number(after?.[unit]) || 0) >= (Number(before?.[unit]) || 0) + (Number(submittedUnits[unit]) || 0);
    });
    if (applied) return 'APPLIED';
    // A training queue can drain between the POST and GET. Equal totals do not prove that a
    // transmitted request was rejected; keep the ambiguity instead of authorizing a duplicate.
    return 'UNKNOWN';
}

function recruitMutationError(message, fields) {
    return Object.assign(new Error(message), fields || {});
}

async function executeRecruitMutation(ctx, submittedUnits) {
    const url = `${ctx.linkBase}train&ajaxaction=train&mode=train`;
    if (!ctx?.linkBase || window.PremiumFeaturesBotProtection?.isActive?.()) {
        return { status: RECRUIT_MUTATION_OUTCOME.FAILED, error: recruitMutationError('Recruit unavailable before transmission') };
    }

    const bodyData = new URLSearchParams();
    Object.entries(submittedUnits).forEach(([unit, qty]) => bodyData.append(`units[${unit}]`, qty));
    bodyData.append('h', game_data.csrf);
    let transmitted = false;
    let abortTimer = null;
    try {
        const abortController = typeof AbortController === 'function' ? new AbortController() : null;
        const request = fetch(url, {
            headers: {
                'accept': 'application/json, text/javascript, */*; q=0.01',
                'priority': 'u=1, i',
                'tribalwars-ajax': '1',
                'x-requested-with': 'XMLHttpRequest',
                'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
            },
            referrer: `${ctx.linkBase}train`,
            body: bodyData.toString(),
            method: 'POST',
            credentials: 'include',
            signal: abortController?.signal
        });
        transmitted = true;
        if (abortController) abortTimer = setTimeout(function () { abortController.abort(); }, 15000);
        const response = await (window.PremiumFeaturesDiagnostics?.request
            ? window.PremiumFeaturesDiagnostics.request({
                feature: 'recruit',
                taskKey: 'recruit:' + ctx.villageId,
                villageId: ctx.villageId,
                logicalResource: 'train-queue:' + ctx.villageId,
                method: 'POST',
                reason: 'manual-recruit'
            }, function () { return request; })
            : request);
        if (!response.ok) {
            const error = recruitMutationError('HTTP ' + response.status, {
                status: Number(response.status) || 0,
                url: response.url || url,
                afterTransmission: true
            });
            const failure = window.PremiumFeaturesAsync?.classifyRequestFailure?.(error, { url }) || {};
            if (failure.hardStop) window.triggerPremiumFeaturesHardStop?.(failure);
            return {
                status: [500, 502, 503].includes(Number(response.status))
                    ? RECRUIT_MUTATION_OUTCOME.UNCERTAIN
                    : RECRUIT_MUTATION_OUTCOME.FAILED,
                error
            };
        }

        let payload;
        try {
            payload = await response.json();
        } catch (error) {
            error.afterTransmission = true;
            return { status: RECRUIT_MUTATION_OUTCOME.UNCERTAIN, error };
        }
        const explicitFailure = payload?.error || payload?.response?.error || payload?.success === false || payload?.response?.success === false;
        if (explicitFailure) {
            return { status: RECRUIT_MUTATION_OUTCOME.FAILED, error: recruitMutationError(String(explicitFailure)) };
        }
        if (!payload || typeof payload !== 'object' || !payload.response) {
            return { status: RECRUIT_MUTATION_OUTCOME.UNCERTAIN, error: recruitMutationError('Unrecognized recruit response', { afterTransmission: true }) };
        }
        return { status: RECRUIT_MUTATION_OUTCOME.CONFIRMED, payload };
    } catch (error) {
        if (transmitted) error.afterTransmission = true;
        return {
            status: transmitted ? RECRUIT_MUTATION_OUTCOME.UNCERTAIN : RECRUIT_MUTATION_OUTCOME.FAILED,
            error
        };
    } finally {
        if (abortTimer != null) clearTimeout(abortTimer);
    }
}

function calculateRecruitCost(villageId, submittedUnits) {
    const unitData = bqGet('unit_managers_costs', villageId) || {};
    const totalCost = { wood: 0, stone: 0, iron: 0 };
    Object.entries(submittedUnits).forEach(([unit, qty]) => {
        const costs = unitData[unit] || {};
        totalCost.wood += (costs.wood || 0) * qty;
        totalCost.stone += (costs.stone || 0) * qty;
        totalCost.iron += (costs.iron || 0) * qty;
    });
    return totalCost;
}

function applyRecruitLocalSuccess(ctx, submittedUnits) {
    const totalCost = calculateRecruitCost(ctx.villageId, submittedUnits);
    ctx.deductResources(totalCost);
    ctx.pendingDeduction.wood += totalCost.wood;
    ctx.pendingDeduction.stone += totalCost.stone;
    ctx.pendingDeduction.iron += totalCost.iron;
    return totalCost;
}

async function refreshRecruitStateInPlace(ctx) {
    let data;
    try {
        data = await Promise.resolve(ctx.refreshData());
    } catch (_error) {
        data = null;
    }
    if (data == null) return false;
    ctx.pendingDeduction = { wood: 0, stone: 0, iron: 0 };
    renderRecruitForm(ctx);
    calculateMaxTroops(ctx);
    return true;
}

async function reconcileRecruitMutation(ctx) {
    const uncertain = ctx.recruitUncertain;
    if (!uncertain) return 'NONE';
    ctx.recruitMutationState = 'RECONCILING';
    renderRecruitForm(ctx);
    let data;
    try {
        data = await Promise.resolve(ctx.refreshData());
    } catch (_error) {
        data = null;
    }
    if (data == null) {
        ctx.recruitMutationState = 'UNCERTAIN';
        renderRecruitForm(ctx);
        return 'UNKNOWN';
    }
    const after = readRecruitQueueSnapshot(ctx.villageId, uncertain.units);
    const resolution = classifyRecruitReconciliation(uncertain.before, after, uncertain.units);
    if (resolution === 'APPLIED') {
        setRecruitUncertain(ctx, null);
        ctx.recruitMutationState = null;
    } else if (resolution === 'NOT_APPLIED') {
        setRecruitUncertain(ctx, null);
        ctx.recruitMutationState = null;
    } else {
        ctx.recruitMutationState = 'UNCERTAIN';
    }
    ctx.pendingDeduction = { wood: 0, stone: 0, iron: 0 };
    renderRecruitForm(ctx);
    return resolution;
}

/**
 * Builds the recruit context for the sidebar widget: resources are read live from the page's
 * own #wood/#stone/#iron DOM and game_data.village (this IS the loaded village), and a
 * MutationObserver + village-change poll keep it live/current — see injectRecruitTroopsWidget.
 * @param {string|number} villageId
 * @returns {Object} ctx
 */
function createLiveRecruitContext(villageId) {
    const ctx = {
        villageId,
        linkBase: game_data.link_base_pure,
        containerEl: null,
        isLive: true,
        pendingDeduction: { wood: 0, stone: 0, iron: 0 },
        calcDebounceTimer: null,
        resourceObserver: null,
        villageCheckInterval: null,
        recruitUncertain: loadRecruitUncertain(villageId),
        recruitMutationState: loadRecruitUncertain(villageId) ? 'UNCERTAIN' : null,
        getResources: () => {
            const snapshot = readVillageResourceSnapshot(document);
            if (!snapshot) return null;
            return {
                wood: Math.max(0, snapshot.wood - ctx.pendingDeduction.wood),
                stone: Math.max(0, snapshot.stone - ctx.pendingDeduction.stone),
                iron: Math.max(0, snapshot.iron - ctx.pendingDeduction.iron),
                pop: (game_data.village?.pop_max || 0) - (game_data.village?.pop || 0)
            };
        },
        deductResources: (cost) => {
            ['wood', 'stone', 'iron'].forEach(res => {
                // Update game_data so the tick handler re-renders the correct value on the next tick
                if (game_data.village[res + '_float'] != null) {
                    game_data.village[res + '_float'] = Math.max(0, game_data.village[res + '_float'] - cost[res]);
                    game_data.village[res] = Math.floor(game_data.village[res + '_float']);
                }
                // Update DOM immediately for instant visual feedback
                const el = document.getElementById(res);
                if (el) el.textContent = Math.max(0, (Number(el.textContent.replace(/\D/g, '')) || 0) - cost[res]);
            });
        },
        refreshData: (callback) => fetchTrainInfo(callback, villageId, game_data.link_base_pure, true)
    };
    return ctx;
}

/**
 * Recalculates the maximum affordable quantity for every trainable unit given ctx's current
 * resources and the quantities already typed in other unit inputs (scoped to ctx.containerEl,
 * so a sidebar widget and an overlay for another village never interfere with each other).
 * Updates each input's max attribute and the clickable "(N)" shortcut beside it.
 * @param {Object} ctx
 * @param {string|null} [changedUnit=null] - The unit whose input just changed (unused directly,
 * kept for parity with call sites that pass it for clarity).
 */
function calculateMaxTroops(ctx, changedUnit = null) {
    const container = ctx.containerEl;
    if (!container) return;

    const inputs = Array.from(container.querySelectorAll('[data-unit-input]'));
    const currentQueued = {};
    inputs.forEach(input => { currentQueued[input.dataset.unitInput] = Number(input.value) || 0; });

    const totalResources = ctx.getResources();
    if (!totalResources) {
        inputs.forEach(input => {
            input.removeAttribute('max');
            const maxElement = container.querySelector(`[data-unit-max="${input.dataset.unitInput}"]`);
            if (!maxElement) return;
            maxElement.textContent = '(?)';
            maxElement.onclick = null;
        });
        return;
    }
    const unitData = bqGet('unit_managers_costs', ctx.villageId) || {};

    inputs.forEach(input => {
        const unit = input.dataset.unitInput;
        if (!unitData[unit]) return;
        const costs = unitData[unit];

        // absoluteMax = the true ceiling for THIS unit's input — the highest value it
        // could ever hold given what every OTHER unit's input already committed.
        // It does NOT shrink because of this unit's own typed value, so it's safe to use
        // as the HTML "max" attribute for validation/clamping without fighting the user.
        let absoluteMax = Infinity;

        Object.keys(costs).forEach(resource => {
            if (!(resource in totalResources)) return;
            const cost = costs[resource];
            if (!cost) return;

            // Consumption of every OTHER unit only (excluding this unit's own input)
            let consumptionOthers = 0;
            inputs.forEach(otherInput => {
                const otherUnit = otherInput.dataset.unitInput;
                if (otherUnit === unit) return;
                const otherCosts = unitData[otherUnit];
                if (!otherCosts || !(resource in otherCosts)) return;
                consumptionOthers += currentQueued[otherUnit] * otherCosts[resource];
            });

            const available = totalResources[resource] - consumptionOthers;
            const possible = available > 0 ? Math.floor(available / cost) : 0;
            absoluteMax = Math.min(absoluteMax, possible);
        });

        if (!isFinite(absoluteMax) || absoluteMax < 0) absoluteMax = 0;

        // input.max is the absolute ceiling: never reduced by the unit's own value,
        // so simply typing into this same field never gets clamped back down.
        input.max = absoluteMax;

        // remaining = how many MORE of this unit could still be added on top of what's
        // already typed here. This is what gets displayed in the "(N)" shortcut, so it
        // visibly shrinks both when you type into this unit and when other units consume
        // the shared resource pool.
        const remaining = Math.max(0, absoluteMax - currentQueued[unit]);

        const maxElement = container.querySelector(`[data-unit-max="${unit}"]`);
        if (maxElement) {
            maxElement.textContent = '(' + remaining + ')';
            // Clicking fills the input up to its absolute max (not just the remaining delta),
            // otherwise it would overwrite/discard whatever was already typed.
            maxElement.onclick = () => { input.value = absoluteMax; input.dispatchEvent(new Event('input')); calculateMaxTroops(ctx, unit); };
        }
    });
}

/**
 * Reads all non-zero unit input values from ctx.containerEl, POSTs a train request straight to
 * ctx.linkBase's train endpoint (works for any village — the CSRF token is account-wide, same
 * approach as launchAttack()/other cross-village requests in this script), then always
 * re-fetches and re-renders so the form reflects fresh server-side state.
 * @param {Object} ctx
 */
async function submitTroops(ctx) {
    const container = ctx.containerEl;
    const trainButton = container.querySelector('[data-recruit-btn]');
    const unresolved = ctx.recruitUncertain || loadRecruitUncertain(ctx.villageId);
    if (unresolved) {
        ctx.recruitUncertain = unresolved;
        ctx.recruitMutationState = 'UNCERTAIN';
        setButtonLoadingState(trainButton, true, t('button.recruit'));
        try {
            await reconcileRecruitMutation(ctx);
        } finally {
            setButtonLoadingState(trainButton, false, t('button.recruit'));
        }
        return;
    }

    // Capture units to submit before any async work
    const submittedUnits = {};
    container.querySelectorAll('[data-unit-input]').forEach(input => {
        const qty = Number(input.value) || 0;
        if (qty > 0) submittedUnits[input.dataset.unitInput] = qty;
    });

    if (!Object.keys(submittedUnits).length) return;

    setButtonLoadingState(trainButton, true, t('button.recruit'));
    try {
        await new Promise(requestAnimationFrame);
        const before = readRecruitQueueSnapshot(ctx.villageId, submittedUnits);
        setRecruitUncertain(ctx, { units: submittedUnits, before, at: Date.now(), phase: 'transmitting' });
        const outcome = await executeRecruitMutation(ctx, submittedUnits);
        if (outcome.status === RECRUIT_MUTATION_OUTCOME.CONFIRMED) {
            setRecruitUncertain(ctx, null);
            applyRecruitLocalSuccess(ctx, submittedUnits);
            await refreshRecruitStateInPlace(ctx);
            if (typeof showAutoHideBox === 'function') showAutoHideBox(t('recruit.troopsRecruited'), false);
            if (typeof refreshOverviewVillagesTroopsRow === 'function') refreshOverviewVillagesTroopsRow(ctx.villageId);
        } else if (outcome.status === RECRUIT_MUTATION_OUTCOME.UNCERTAIN) {
            setRecruitUncertain(ctx, { units: submittedUnits, before, at: Date.now() });
            ctx.recruitMutationState = 'UNCERTAIN';
            window.PremiumFeaturesDiagnostics?.record?.({
                feature: 'recruit', taskKey: 'recruit:' + ctx.villageId, villageId: ctx.villageId,
                logicalResource: 'train-queue:' + ctx.villageId, method: 'POST', status: 'UNCERTAIN'
            });
            const resolution = await reconcileRecruitMutation(ctx);
            if (resolution === 'APPLIED') {
                if (ctx.isLive) {
                    ctx.deductResources(calculateRecruitCost(ctx.villageId, submittedUnits));
                    calculateMaxTroops(ctx);
                }
                if (typeof showAutoHideBox === 'function') showAutoHideBox(t('recruit.troopsRecruited'), false);
                if (typeof refreshOverviewVillagesTroopsRow === 'function') refreshOverviewVillagesTroopsRow(ctx.villageId);
            } else if (resolution === 'NOT_APPLIED' && typeof showAutoHideBox === 'function') {
                showAutoHideBox(t('recruit.errorRecruiting'), true);
            }
        } else {
            setRecruitUncertain(ctx, null);
            if (typeof showAutoHideBox === 'function') showAutoHideBox(t('recruit.errorRecruiting'), true);
        }
    } finally {
        setButtonLoadingState(trainButton, false, t('button.recruit'));
    }
}


/**
 * Displays a small popup menu next to the cursor/click position with batch-size
 * options (1, 5, 10, 20, 50, 100). Selecting one calls disperseTroops with that size.
 * Clicking anywhere outside the menu closes it without doing anything.
 * @param {MouseEvent} event - The click event that triggered the menu (used for positioning).
 * @param {Object} ctx
 */
function openDisperseBatchMenu(event, ctx) {
    event.preventDefault();
    event.stopPropagation();

    const existing = document.getElementById('disperse_batch_menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'disperse_batch_menu';
    // Above the recruit overlay's own stacking context (backdrop/box use 20001/20002 in
    // overviewVillages.js) so it's still visible when opened from that popup.
    menu.style.cssText = 'position: fixed; z-index: 20003; background: #f4e4bc; border: 1px solid #7d510f; border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.4); padding: 6px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px;';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';

    [1, 5, 10, 20, 50, 100].forEach(size => {
        const btn = document.createElement('button');
        btn.textContent = String(size);
        btn.className = 'btn btn-default';
        btn.style.cssText = 'padding: 2px 8px; font-size: 11px; cursor: pointer;';
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            closeMenu();
            disperseTroops(ctx, size);
        });
        menu.appendChild(btn);
    });

    document.body.appendChild(menu);

    // Keep the menu fully within the viewport
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = Math.max(0, window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = Math.max(0, window.innerHeight - rect.height - 8) + 'px';

    function closeMenu() {
        menu.remove();
        document.removeEventListener('click', closeMenu);
    }
    // Deferred so the click that opened the menu doesn't immediately close it
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

/**
 * Sends troops to the training queue in interleaved batches of `batchSize` units.
 * Each round sends up to `batchSize` of every unit type that still has remaining
 * quantity, creating an alternating pattern in the training queue.
 * @param {Object} ctx
 * @param {number} [batchSize=1] - How many of each unit to send per batch/request.
 */
async function disperseTroops(ctx, batchSize = 1) {
    const container = ctx.containerEl;
    const unresolved = ctx.recruitUncertain || loadRecruitUncertain(ctx.villageId);
    if (unresolved) {
        ctx.recruitUncertain = unresolved;
        ctx.recruitMutationState = 'UNCERTAIN';
        await reconcileRecruitMutation(ctx);
        return;
    }
    const unitData = bqGet('unit_managers_costs', ctx.villageId) || {};
    const remaining = {};
    container.querySelectorAll('[data-unit-input]').forEach(input => {
        const qty = Number(input.value) || 0;
        if (qty > 0) remaining[input.dataset.unitInput] = qty;
    });

    if (!Object.keys(remaining).length) return;

    const disperseButton = container.querySelector('[data-disperse-btn]');
    setButtonLoadingState(disperseButton, true, t('button.disperse'));
    try {
        await new Promise(requestAnimationFrame);
        const totalCost = { wood: 0, stone: 0, iron: 0 };
    let batchCount = 0;
    let failed = false;
    let refreshedDuringReconciliation = false;
    const expectedQueue = readRecruitQueueSnapshot(ctx.villageId, remaining);

    while (Object.keys(remaining).length > 0 && !failed) {
        const batch = {};
        for (const unit of Object.keys(remaining)) {
            const qty = Math.min(batchSize, remaining[unit]);
            batch[unit] = qty;
            remaining[unit] -= qty;
            if (remaining[unit] <= 0) delete remaining[unit];
        }

        const before = Object.fromEntries(Object.keys(batch).map(unit => [unit, expectedQueue[unit] || 0]));
        setRecruitUncertain(ctx, { units: batch, before, at: Date.now(), phase: 'transmitting', batch: batchCount + 1 });
        const outcome = await executeRecruitMutation(ctx, batch);
        let applied = outcome.status === RECRUIT_MUTATION_OUTCOME.CONFIRMED;
        if (outcome.status === RECRUIT_MUTATION_OUTCOME.UNCERTAIN) {
            setRecruitUncertain(ctx, { units: batch, before, at: Date.now(), batch: batchCount + 1 });
            ctx.recruitMutationState = 'UNCERTAIN';
            const resolution = await reconcileRecruitMutation(ctx);
            refreshedDuringReconciliation = true;
            applied = resolution === 'APPLIED';
            // An ambiguous batch is a hard sequence boundary. Even after a read proves whether it
            // applied, a later batch must be initiated by a new explicit action, never by this loop.
            failed = true;
        }
        if (outcome.status === RECRUIT_MUTATION_OUTCOME.FAILED) {
            setRecruitUncertain(ctx, null);
            failed = true;
        }
        if (outcome.status === RECRUIT_MUTATION_OUTCOME.CONFIRMED) {
            setRecruitUncertain(ctx, null);
            Object.entries(batch).forEach(([unit, qty]) => { expectedQueue[unit] = (expectedQueue[unit] || 0) + qty; });
        }
        if (applied) {
            batchCount++;
            Object.entries(batch).forEach(([unit, qty]) => {
                const costs = unitData[unit] || {};
                totalCost.wood += (costs.wood || 0) * qty;
                totalCost.stone += (costs.stone || 0) * qty;
                totalCost.iron += (costs.iron || 0) * qty;
            });
            if (!failed && Object.keys(remaining).length > 0) await new Promise(r => setTimeout(r, 150));
        }
    }

    if (refreshedDuringReconciliation) {
        if (ctx.isLive) ctx.deductResources(totalCost);
        ctx.pendingDeduction = { wood: 0, stone: 0, iron: 0 };
    } else {
        ctx.deductResources(totalCost);
        ctx.pendingDeduction.wood += totalCost.wood;
        ctx.pendingDeduction.stone += totalCost.stone;
        ctx.pendingDeduction.iron += totalCost.iron;
    }

    if (batchCount > 0 && typeof showAutoHideBox === 'function')
        showAutoHideBox(t(batchCount > 1 ? 'recruit.dispersedInBatches' : 'recruit.dispersedInBatch', { count: batchCount }), false);
    if (failed && typeof showAutoHideBox === 'function')
        showAutoHideBox(t('recruit.disperseStopped'), true);

    // Keeps the overview_villages troops column in sync when dispersed from that page's overlay.
    if (batchCount > 0 && typeof refreshOverviewVillagesTroopsRow === 'function') refreshOverviewVillagesTroopsRow(ctx.villageId);

    calculateMaxTroops(ctx);
        if (!refreshedDuringReconciliation) await refreshRecruitStateInPlace(ctx);
    } finally {
        setButtonLoadingState(disperseButton, false, t('button.disperse'));
    }
}

/**
 * Builds the recruit form (one row per trainable unit present in this village, a Recruit
 * button, and a Disperse button) into ctx.containerEl — shared by the sidebar widget (live
 * context) and the overview_villages recruit overlay (fetched-snapshot context for another
 * village). Elements are scoped via data-attributes (not global ids), so a sidebar widget and
 * an overlay open at the same time never collide.
 * @param {Object} ctx
 */
function renderRecruitForm(ctx) {
    const container = ctx.containerEl;
    container.innerHTML = '';

    const villageId = ctx.villageId;
    const unitCosts = bqGet('unit_managers_costs', villageId) || {};
    const unitMeta = JSON.parse(localStorage.getItem('unit_managers_meta')) || {};
    // Merge village-specific costs (which can vary per village due to items/effects) with
    // the globally shared name/image metadata (which never differs between villages).
    const unitData = {};
    for (const unit in unitCosts) {
        unitData[unit] = Object.assign({}, unitMeta[unit] || {}, unitCosts[unit]);
    }
    const villageUnitCounts = bqGet('village_unit_counts', villageId) || {};
    const queueData = bqGet('train_queue_data', villageId) || {};

    const lang = JSON.parse(localStorage.getItem('tw_lang')) || {};

    const table = document.createElement('table');
    table.className = 'vis';
    table.style.width = '100%';
    const tbody = document.createElement('tbody');

    const canonicalUnitOrder = typeof getOverviewVillagesTroopUnitOrder === 'function'
        ? getOverviewVillagesTroopUnitOrder()
        : [];
    const orderedUnits = canonicalUnitOrder.filter(unit => Object.prototype.hasOwnProperty.call(unitData, unit));
    const additionalUnits = Object.keys(unitData)
        .filter(unit => !canonicalUnitOrder.includes(unit))
        .sort();

    for (const unit of orderedUnits.concat(additionalUnits)) {
        // Only render units available in this village's training buildings
        if (!villageUnitCounts[unit]) continue;

        const info = unitData[unit];
        const row = document.createElement('tr');

        // Unit cell: image + localized name + costs
        const unitCell = document.createElement('td');
        unitCell.style.cssText = 'padding: 3px 6px; vertical-align: middle; min-width: 0;';

        const unitTop = document.createElement('div');
        unitTop.style.cssText = 'display: flex; align-items: center; gap: 4px; white-space: nowrap; flex-wrap: nowrap;';

        const img = document.createElement('img');
        img.src = info.img || ('graphic/unit/unit_' + unit + '.webp');
        img.style.cssText = 'width: 22px; height: 22px; vertical-align: middle;';
        img.alt = unit;

        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'font-size: 12px; white-space: nowrap; display: flex; align-items: center; gap: 2px;';
        nameSpan.textContent = info.name || (unit.charAt(0).toUpperCase() + unit.slice(1));

        // Show current in-village count alongside the unit name (only per-village data)
        if (villageUnitCounts[unit]) {
            const countText = villageUnitCounts[unit]; // Format: "596/596"
            const currentCount = countText.split('/')[1] || countText.split('/')[0] || '0';
            const queueCount = queueData[unit] || 0;

            const countSpan = document.createElement('small');
            countSpan.style.cssText = 'color: #888; font-size: 10px; white-space: nowrap; flex-shrink: 0;';

            // Show count format: (596+queueCount) where queue count is in orange
            if (queueCount > 0) {
                countSpan.innerHTML = '(' + currentCount + '<span style="color: #70a710; font-weight: bold; font-size: 8px">+' + queueCount + '</span>)';
            } else {
                countSpan.textContent = '(' + currentCount + ')';
            }
            nameSpan.appendChild(countSpan);
        }
        unitTop.appendChild(img);
        unitTop.appendChild(nameSpan);
        unitCell.appendChild(unitTop);

        // Resource cost row: wood, stone, iron, population, and build time
        const costDiv = document.createElement('div');
        costDiv.style.cssText = 'display: flex; gap: 5px; flex-wrap: wrap; margin-top: 2px;';
        [['wood', 'wood'], ['stone', 'stone'], ['iron', 'iron'], ['pop', 'population']].forEach(function (pair) {
            const key = pair[0], iconClass = pair[1];
            if (!info[key]) return;
            const span = document.createElement('span');
            span.style.cssText = 'display: flex; align-items: center; gap: 1px; font-size: 10px; color: #555;';
            const icon = document.createElement('span');
            icon.className = 'icon header ' + iconClass;
            icon.style.cssText = 'width: 12px; height: 12px; display: inline-block;';
            const costText = document.createElement('span');
            costText.dataset.costId = unit + '_' + key;
            costText.dataset.base = info[key];
            costText.textContent = info[key];
            span.appendChild(icon);
            span.appendChild(costText);
            costDiv.appendChild(span);
        });
        let tSpan = null;
        if (info.build_time) {
            const ms = info.build_time;
            const h = Math.floor(ms / 3600000);
            const m = Math.floor((ms % 3600000) / 60000);
            const s = Math.floor((ms % 60000) / 1000);
            tSpan = document.createElement('span');
            tSpan.dataset.costId = unit + '_time';
            tSpan.dataset.baseMs = info.build_time;
            tSpan.style.cssText = 'font-size: 10px; color: #888; display: block; text-align: right; margin-top: 2px;';
            tSpan.textContent = h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
        }
        unitCell.appendChild(costDiv);
        row.appendChild(unitCell);

        // Input + max link cell
        const inputCell = document.createElement('td');
        inputCell.style.cssText = 'text-align: right; padding: 3px 6px; white-space: nowrap; vertical-align: middle;';

        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.value = '0';
        input.style.width = '55px';
        input.className = 'train-input train-' + unit;
        input.dataset.unitInput = unit;
        input.addEventListener('change', (function (u) {
            return function () {
                // Clamp to max before recalculating so other units see the correct value
                const max = parseInt(this.max, 10);
                if (!isNaN(max) && Number(this.value) > max) {
                    this.value = max;
                    this.dispatchEvent(new Event('input'));
                }
                calculateMaxTroops(ctx, u);
            };
        }(unit)));

        input.addEventListener('input', (function (u) {
            return function () {
                const qty = Math.max(0, Number(this.value) || 0);
                const displayQty = qty <= 0 ? 1 : qty;
                ['wood', 'stone', 'iron', 'pop'].forEach(function (key) {
                    const el = container.querySelector(`[data-cost-id="${u}_${key}"]`);
                    if (el) el.textContent = parseInt(el.dataset.base, 10) * displayQty;
                });
                const timeEl = container.querySelector(`[data-cost-id="${u}_time"]`);
                if (timeEl && timeEl.dataset.baseMs) {
                    const totalMs = parseInt(timeEl.dataset.baseMs, 10) * displayQty;
                    const th = Math.floor(totalMs / 3600000);
                    const tm = Math.floor((totalMs % 3600000) / 60000);
                    const ts = Math.floor((totalMs % 60000) / 1000);
                    timeEl.textContent = th + ':' + String(tm).padStart(2, '0') + ':' + String(ts).padStart(2, '0');
                }
                // Recalculate max for all units during input to update other units' max in real-time
                if (ctx.calcDebounceTimer) clearTimeout(ctx.calcDebounceTimer);
                ctx.calcDebounceTimer = setTimeout(function () {
                    calculateMaxTroops(ctx, u);
                    ctx.calcDebounceTimer = null;
                }, 150);
            };
        }(unit)));

        const maxLink = document.createElement('a');
        maxLink.dataset.unitMax = unit;
        // onclick is re-assigned by calculateMaxTroops after each recalculation
        maxLink.style.cssText = 'margin-left: 4px; cursor: pointer; font-size: 11px;';
        maxLink.textContent = '(?)';

        inputCell.appendChild(input);
        inputCell.appendChild(maxLink);
        if (tSpan) inputCell.appendChild(tSpan);
        row.appendChild(inputCell);
        tbody.appendChild(row);
    }
    table.appendChild(tbody);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 6px; margin-top: 6px;';

    const trainButton = document.createElement('button');
    trainButton.dataset.recruitBtn = '1';
    trainButton.textContent = (ctx.isLive && lang['e1de43dd18d19451febfc1584ab33767']) || t('button.recruit');
    trainButton.className = 'btn btn-default';
    trainButton.addEventListener('click', () => submitTroops(ctx));

    const disperseButton = document.createElement('button');
    disperseButton.dataset.disperseBtn = '1';
    disperseButton.textContent = t('button.disperse');
    disperseButton.className = 'btn btn-default';
    disperseButton.title = t('recruit.disperseTooltip');
    disperseButton.addEventListener('click', (event) => openDisperseBatchMenu(event, ctx));
    btnRow.appendChild(trainButton);
    btnRow.appendChild(disperseButton);

    container.appendChild(table);
    if (ctx.recruitMutationState) {
        const status = document.createElement('div');
        status.dataset.recruitMutationStatus = ctx.recruitMutationState;
        status.style.cssText = 'margin-top:6px;font-size:11px;color:#7d510f;';
        status.textContent = ctx.recruitMutationState === 'RECONCILING'
            ? t('recruit.reconciling')
            : t('recruit.uncertain');
        container.appendChild(status);
        if (ctx.recruitMutationState === 'UNCERTAIN') {
            trainButton.textContent = t('recruit.reconcileAction');
        } else if (ctx.recruitMutationState === 'RECONCILING') {
            trainButton.disabled = true;
            disperseButton.disabled = true;
        }
    }
    container.appendChild(btnRow);

    calculateMaxTroops(ctx);
}

/**
 * Builds and injects the Recruit Troops widget into the configured column: a thin wrapper
 * around renderRecruitForm() using the sidebar's persistent "live" context (see
 * createLiveRecruitContext), always fetching fresh training data before rendering.
 * Attaches a MutationObserver on the resource counters to keep max values live.
 * Monitors village changes and reinjects with the new village's data when switched.
 */
function injectRecruitTroopsWidget(_column, skipFetch = false) {
    if (!settings_cookies.general['show__recruit_troops']) {
        // Clean up if widget is disabled
        if (liveRecruitContext?.resourceObserver) liveRecruitContext.resourceObserver.disconnect();
        if (liveRecruitContext?.villageCheckInterval) clearInterval(liveRecruitContext.villageCheckInterval);
        return;
    }

    // Always pull fresh training data before rendering so counts/queue never show stale cache
    if (!skipFetch && typeof fetchTrainInfo === 'function') {
        const widgetConfig = settings_cookies.widgets.find(function (w) { return w.name === 'recruit_troops'; });
        const columnToUse = widgetConfig ? widgetConfig.column : LEFT_COLUMN;
        const loadingContainer = document.createElement('div');
        loadingContainer.id = 'recruit_troops_loading';
        loadingContainer.appendChild(createWidgetLoadingElement());
        if (!document.getElementById('show_recruit_troops')) {
            createWidgetElement({ identifier: t('button.recruit'), contents: loadingContainer, columnToUse, update: true, extra_name: 'troops', description: t('recruit.description'), widgetKey: 'recruit', loading: true });
        }
        fetchTrainInfo(() => injectRecruitTroopsWidget(_column, true));
        return;
    }

    const villageId = game_data.village?.id || 'unknown';
    const widgetConfig = settings_cookies.widgets.find(function (w) { return w.name === 'recruit_troops'; });
    const columnToUse = widgetConfig ? widgetConfig.column : LEFT_COLUMN;

    if (!liveRecruitContext || liveRecruitContext.villageId !== villageId) {
        if (liveRecruitContext?.resourceObserver) liveRecruitContext.resourceObserver.disconnect();
        if (liveRecruitContext?.villageCheckInterval) clearInterval(liveRecruitContext.villageCheckInterval);
        liveRecruitContext = createLiveRecruitContext(villageId);
    }

    const container = document.createElement('div');
    liveRecruitContext.containerEl = container;
    renderRecruitForm(liveRecruitContext);

    createWidgetElement({
        identifier: t('button.recruit'),
        contents: container,
        columnToUse,
        update: true,
        extra_name: 'troops',
        description: t('recruit.description'),
        widgetKey: 'recruit'
    });

    // Observe resource element changes to keep max counts live
    if (liveRecruitContext.resourceObserver) liveRecruitContext.resourceObserver.disconnect();
    liveRecruitContext.resourceObserver = new MutationObserver(function () { calculateMaxTroops(liveRecruitContext); });
    ['wood', 'stone', 'iron'].forEach(function (res) {
        const el = document.getElementById(res);
        if (el) liveRecruitContext.resourceObserver.observe(el, { childList: true, characterData: true, subtree: true });
    });

    // Monitor village changes: if player switches villages without page reload,
    // fetch new training data and reinject widget with correct village's data
    if (liveRecruitContext.villageCheckInterval) clearInterval(liveRecruitContext.villageCheckInterval);
    liveRecruitContext.villageCheckInterval = setInterval(function () {
        const currentVillageId = game_data.village?.id || 'unknown';
        if (currentVillageId !== liveRecruitContext.villageId) {
            // Village changed: fetch training data for new village and reinject widget
            if (typeof fetchTrainInfo === 'function') {
                fetchTrainInfo(function () { injectRecruitTroopsWidget(null, true); });
            }
        }
    }, 500);
}
