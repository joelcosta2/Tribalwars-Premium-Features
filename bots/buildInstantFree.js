// Bot: Auto Build Instant Free
// Completes the active building upgrade for free during the last 3-minute window.
// TribalWars allows free instant completion when ≤ 3 minutes remain on the active build.
//
// Flow:
//   1. checkAndScheduleBuildInstantFree(villageId) — called on page load (current village) and
//      after every queue refresh (current or background village). Reads building_queue_next_slot
//      (real epoch ms, no jitter) via bqGet, derives the free-window start time, and
//      arms a persistent (reload-surviving) timer via setHandlerOnTimeOut, with a narrow 15-60s
//      jitter (not the default 3-min bot-jitter) so it can't fire past the 3-min window's close.
//   2. When the timer fires: fetchAndExecuteBuildInstantFree(_, villageId) fetches that village's
//      screen=main, finds .btn-instant-free, extracts the orderId, and calls the API.
//   3. buildInstantFreeApiCall(orderId, villageId) — performs the free-complete GET request.
//
// Multi-village note: timers are scheduled with setHandlerOnTimeOut (core_utils.user.js), which
// persists {handlerName, args} as plain JSON and dispatches via a registry on restore — NOT
// eval/new Function, which were found to be unreliable across some of Tampermonkey's execution
// contexts (a strict CSP blocks them outright there, silently breaking every scheduled timer).
// fetchAndExecuteBuildInstantFree/buildInstantFreeApiCall are registered via
// registerTimeoutHandler near the bottom of this file.
//
// Integration points (called externally):
//   • start() in core_utils.user.js → checkAndScheduleBuildInstantFree()
//   • scheduleCompletionNotification(villageId) in extraBuildQueue.js (after a build
//     finishes, for the current OR any background village) → checkAndScheduleBuildInstantFree(villageId)
//     to re-arm for that village's next queued build.

// ─── Constants ────────────────────────────────────────────────────────────────

/** Seconds the free-complete window is open before the build would finish naturally. */
const BUILD_INSTANT_FREE_WINDOW_SEC = 180; // 3 minutes

// Deliberately narrower than the default 0-3min bot-jitter, since the window above is also 3 min.
const BUILD_INSTANT_FREE_JITTER_MIN_MS = 15000;
const BUILD_INSTANT_FREE_JITTER_MAX_MS = 60000;

// ─── Public entry point ────────────────────────────────────────────────────────

/**
 * Schedules fetchAndExecuteBuildInstantFree() to run for a specific village once its free-window
 * opens, surviving page reloads/village switches. Uses setHandlerOnTimeOut (villageId passed as
 * a plain JSON arg, not baked into eval'd code) since eval/new Function were found to be
 * unreliable across some of Tampermonkey's execution contexts (CSP blocks them outright there).
 * @param {string|number} villageId
 * @param {number} waitTime - Delay in milliseconds.
 */
function scheduleVillageInstantFreeCheck(villageId, waitTime) {
    setHandlerOnTimeOut('build_instant_free_' + villageId, 'instantFreeCheck', [undefined, villageId], waitTime, BUILD_INSTANT_FREE_JITTER_MIN_MS, BUILD_INSTANT_FREE_JITTER_MAX_MS);
}

/**
 * Schedules the exact API call for the moment the free-complete window opens (used when the
 * initial timer fired slightly early). Same rationale as scheduleVillageInstantFreeCheck.
 * @param {string|number} villageId
 * @param {number} orderId
 * @param {number} waitTime - Delay in milliseconds.
 */
function scheduleVillageInstantFreeApiCall(villageId, orderId, waitTime) {
    setHandlerOnTimeOut('build_instant_free_' + villageId, 'instantFreeApiCall', [orderId, villageId], waitTime, BUILD_INSTANT_FREE_JITTER_MIN_MS, BUILD_INSTANT_FREE_JITTER_MAX_MS);
}

/**
 * Derives the free-window start from building_queue_next_slot (already stored in real
 * epoch ms by the widget) and arms a persistent, reload-surviving timer for the given village.
 *
 * Call this:
 *   • on every page load (from start(), for the currently displayed village)
 *   • after each build completes, for the current OR any background village
 *     (from scheduleCompletionNotification(villageId))
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 */
function checkAndScheduleBuildInstantFree(villageId) {
    if (!settings_cookies?.general?.show__auto_build_instant_free) return;

    const vId = villageId || game_data?.village?.id;
    if (!vId) return;

    const nextSlotMs = parseInt(bqGet('building_queue_next_slot', vId), 10);

    if (!nextSlotMs || isNaN(nextSlotMs)) {
        _clearBuildInstantFreeTimeout(vId);
        return;
    }

    const freeWindowStartMs = nextSlotMs - BUILD_INSTANT_FREE_WINDOW_SEC * 1000;
    const now = Date.now();
    const msUntilWindow = freeWindowStartMs - now;

    _clearBuildInstantFreeTimeout(vId);

    if (msUntilWindow > 0) {
        scheduleVillageInstantFreeCheck(vId, msUntilWindow);
    } else if (now < nextSlotMs) {
        fetchAndExecuteBuildInstantFree(nextSlotMs, vId);
    }
    // else: build already completed — nothing to do
}

/**
 * Arms the instant-free timer for every known village on script load. Without this, only the
 * currently displayed village gets (re)armed by start() — a background village with an active
 * server-side build but no local fake/waiting queue entry is never picked up by the periodic
 * background sweep either (it only watches fake/waiting queues), so its free window would be
 * missed entirely until the user happens to visit that village's page.
 */
function initInstantFreeForAllVillages() {
    if (!settings_cookies?.general?.show__auto_build_instant_free) return;
    if (typeof getAllVillageIds !== 'function') return;
    getAllVillageIds().forEach(vId => checkAndScheduleBuildInstantFree(vId));
}

// ─── Core execution ────────────────────────────────────────────────────────────

/**
 * Fetches the given village's screen=main, verifies the free-complete button is present and
 * active, extracts the orderId, then calls the API.
 *
 * @param {number} expectedCompletionMs - epoch ms when the build was expected to finish.
 *   Used as a sanity guard to detect if a different build is now active.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 */
async function fetchAndExecuteBuildInstantFree(expectedCompletionMs, villageId) {
    const vId = villageId || game_data?.village?.id;
    let doc;
    try {
        ({ doc } = await fetchMainPage(vId));
    } catch (e) {
        console.error('[BuildInstantFree] Fetch exception:', e);
        return;
    }

    // Find the instant-free button
    const freeBtn = doc.querySelector('.btn-instant-free');
    if (!freeBtn) {
        console.warn('[BuildInstantFree] .btn-instant-free not found for village ' + vId + ' — build already complete or no active build.');
        checkAndScheduleBuildInstantFree(vId);
        return;
    }

    const availableFromMs = parseInt(freeBtn.getAttribute('data-available-from'), 10) * 1000;
    const availableToMs   = parseInt(freeBtn.getAttribute('data-available-to'),   10) * 1000;
    const now             = Date.now();

    // Extract orderId from onclick: "return BuildingMain.change_order(462717, 'BuildInstantFree', 0)"
    const onclickAttr = freeBtn.getAttribute('onclick') || '';
    const orderIdMatch = onclickAttr.match(/change_order\((\d+)/);
    if (!orderIdMatch) {
        console.error('[BuildInstantFree] Could not extract orderId from onclick:', onclickAttr);
        return;
    }
    const orderId = parseInt(orderIdMatch[1], 10);

    if (now < availableFromMs) {
        // Slight timing offset — re-schedule for exact open moment
        const remaining = availableFromMs - now;
        scheduleVillageInstantFreeApiCall(vId, orderId, remaining);
        return;
    }

    if (now >= availableToMs) {
        console.warn('[BuildInstantFree] Window already closed for village ' + vId + ' (build completed naturally). Re-arming...');
        checkAndScheduleBuildInstantFree(vId);
        return;
    }

    await buildInstantFreeApiCall(orderId, vId);
}

// ─── API call ─────────────────────────────────────────────────────────────────

/**
 * Executes the free instant-complete for the given build order, in the given (or current) village.
 * GET game.php?...&screen=main&ajaxaction=build_order_reduce&h={csrf}&id={orderId}&destroy=0
 *
 * @param {number} orderId - The build order ID from the button onclick attribute.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 */
async function buildInstantFreeApiCall(orderId, villageId) {
    const vId  = villageId || game_data?.village?.id;
    const csrf = game_data?.csrf;

    if (!vId || !csrf) {
        console.error('[BuildInstantFree] Missing villageId or csrf — cannot call the API.');
        return;
    }

    const linkBase = typeof getVillageLinkBase === 'function' ? getVillageLinkBase(vId) : game_data.link_base_pure;
    const url = linkBase
        + 'main&ajaxaction=build_order_reduce'
        + '&h=' + csrf
        + '&id=' + orderId
        + '&destroy=0';

    try {
        const resp = await fetch(url, {
            method: 'GET',
            headers: {
                'accept': 'application/json, text/javascript, */*; q=0.01',
                'tribalwars-ajax': '1',
                'x-requested-with': 'XMLHttpRequest',
            },
            credentials: 'include',
        });

        if (!resp.ok) {
            console.error('[BuildInstantFree] HTTP error:', resp.status, resp.statusText);
            return;
        }

        await resp.json();
        const isCurrent = vId == game_data?.village?.id;
        const villageName = typeof getVillageName === 'function' ? getVillageName(vId) : vId;
        const completedMsg = '[' + villageName + '] ' + t('buildQueue.instantFreeCompleted');
        showAutoHideBox(completedMsg, false);

        // Refresh the queue widget/state and re-arm for the next queued build
        setTimeout(() => {
            if (isCurrent && typeof fetchBuildQueueWidget === 'function') {
                fetchBuildQueueWidget(true);
            } else if (!isCurrent && typeof refreshBackgroundVillageQueue === 'function') {
                refreshBackgroundVillageQueue(vId);
            } else {
                checkAndScheduleBuildInstantFree(vId);
            }
        }, 1000);
    } catch (e) {
        console.error('[BuildInstantFree] Error in API call:', e);
    }
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Clears any pending persisted instant-free timer for the given (or current) village.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 */
function _clearBuildInstantFreeTimeout(villageId) {
    const vId = villageId || game_data?.village?.id;
    const id = 'build_instant_free_' + vId;
    localStorage.removeItem('function_' + id);
    localStorage.removeItem('handler_' + id);
    localStorage.removeItem('endTime_' + id);
    if (typeof activeTimeouts !== 'undefined' && activeTimeouts[id]) {
        clearTimeout(activeTimeouts[id]);
        delete activeTimeouts[id];
    }
}

// Registered so setHandlerOnTimeOut/restoreTimeouts (core_utils.user.js) can call these by name
// after a reload, without ever needing eval/new Function.
if (typeof registerTimeoutHandler === 'function') {
    registerTimeoutHandler('instantFreeCheck', fetchAndExecuteBuildInstantFree);
    registerTimeoutHandler('instantFreeApiCall', buildInstantFreeApiCall);
}

