// Feature: Ally Reservations map CTX buttons
// Syncs the tribe's village-reservation planner (screen=ally&mode=reservations — includes both
// tribe and NAP-partner reservations, i.e. the "all" group) into IndexedDB every hour, then on
// the map's context menu reuses the game's own (otherwise dormant) #mp_lock/#mp_unlock anchors:
// shows #mp_lock when a village isn't reserved, swaps to an enabled #mp_unlock when reserved by
// the current player, or a disabled #mp_unlock (never clickable) when reserved by someone else.
// Create/remove use the reservation planner's own form endpoints (POST action=new_reservation /
// action=submit&delete_claims), NOT the native ajaxaction=toggle_reserve_village used by
// VillageContext/the native map ctx button — that one requires Premium.
// Storage lives in utils/core_indexeddb.js (reservationSet/Remove/GetAll/ReplaceAll,
// hydrateReservationsCache). Reuses extractBuildTimestampFromHTML() (utils/core_utils.js) to
// parse the reservation planner's expiry text, since it's rendered by the same Format.date()
// templates as build/train queue timers.

const ALLY_RESERVATIONS_TTL_MS = 60 * 60 * 1000;
const ALLY_RESERVATIONS_LAST_FETCH_KEY = 'ally_reservations_last_fetch';

/**
 * Extracts a reservation record from a single `<tr id="reservation_ID">` row.
 * Column order: [village anchor, points, target owner, reserving player, expiry, actions].
 * @param {HTMLTableRowElement} row
 * @returns {*|null} Null if the row doesn't have the expected shape (defensive against markup changes).
 */
function parseReservationRow(row) {
    const villageAnchor = row.querySelector('.village_anchor');
    const villageLink = villageAnchor?.querySelector('a');
    const villageId = villageAnchor?.dataset.id;
    const coordsMatch = villageLink?.textContent.match(/\((\d{1,3}\|\d{1,3})\)/);
    if (!villageId || !coordsMatch) return null;

    const reservingLink = row.cells[3]?.querySelector('a[href*="screen=info_player"]');
    if (!reservingLink) return null;

    // Read the raw attribute (not the resolved .href property) — the document is detached
    // (built via DOMParser), so property resolution isn't guaranteed against the right base URL.
    const reservingIdMatch = (reservingLink.getAttribute('href') || '').match(/[?&]id=(\d+)/);
    const expiresAtText = row.cells[4]?.textContent.trim() || '';

    return {
        reservationId: row.id.replace('reservation_', ''),
        villageId,
        coords: coordsMatch[1],
        targetPlayerId: villageAnchor.dataset.player,
        reservingPlayerId: reservingIdMatch ? reservingIdMatch[1] : null,
        reservingPlayerName: reservingLink.textContent.trim(),
        expiresAtText,
        expiresAtMs: expiresAtText ? extractBuildTimestampFromHTML(expiresAtText) : null
    };
}

/**
 * Fetches one page of the reservation planner as raw HTML.
 * @param {number} page
 * @returns {Promise<string|null>}
 */
async function fetchReservationsPage(page) {
    const url = `${game_data.link_base_pure}ally&mode=reservations&group_id=all&filter=&sort=expires_at&order=ASC&page=${page}`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.text();
    } catch (error) {
        console.error(`[Ally Reservations] Failed to fetch page ${page}:`, error);
        return null;
    }
}

/**
 * Fetches every page of the reservation planner sequentially (200ms throttle between requests,
 * same pattern as map.js's fetchAllReports) and returns all rows keyed by village id.
 * @returns {Promise<Map<string, *>>}
 */
async function fetchAllReservations() {
    const reservationsMap = new Map();
    const parser = new DOMParser();

    const firstPageHtml = await fetchReservationsPage(1);
    if (!firstPageHtml) return reservationsMap;

    const firstDoc = parser.parseFromString(firstPageHtml, 'text/html');
    const totalPages = firstDoc.querySelectorAll('.paged-nav-item').length + 1;

    firstDoc.querySelectorAll('tr[id^="reservation_"]').forEach(row => {
        const record = parseReservationRow(row);
        if (record) reservationsMap.set(record.villageId, record);
    });

    for (let page = 2; page <= totalPages; page++) {
        await new Promise(resolve => setTimeout(resolve, 200));
        const pageHtml = await fetchReservationsPage(page);
        if (!pageHtml) continue;

        parser.parseFromString(pageHtml, 'text/html')
            .querySelectorAll('tr[id^="reservation_"]')
            .forEach(row => {
                const record = parseReservationRow(row);
                if (record) reservationsMap.set(record.villageId, record);
            });
    }

    return reservationsMap;
}

/**
 * Resyncs the local reservation cache from the reservation planner, gated by a 1h TTL so a
 * page reload within the hour doesn't refetch. No-ops outside a tribe (screen=ally requires one).
 * @param {boolean} [force]
 */
async function syncAllyReservations(force = false) {
    if (!game_data.player.ally) return;

    const lastFetch = parseInt(localStorage.getItem(ALLY_RESERVATIONS_LAST_FETCH_KEY) || '0', 10);
    if (!force && (Date.now() - lastFetch) < ALLY_RESERVATIONS_TTL_MS) return;

    try {
        const reservationsMap = await fetchAllReservations();
        const asObject = {};
        reservationsMap.forEach((record, villageId) => { asObject[villageId] = record; });
        await reservationsReplaceAll(asObject);
        localStorage.setItem(ALLY_RESERVATIONS_LAST_FETCH_KEY, String(Date.now()));
    } catch (error) {
        console.error('[Ally Reservations] Sync failed:', error);
    }
}

/**
 * @param {string|number} villageId
 * @returns {*|null}
 */
function getReservationForVillage(villageId) {
    return reservationsGetAll()[String(villageId)] || null;
}

function isReservationCacheHydrating() {
    return window.PremiumFeaturesHydration?.reservations?.status === 'PENDING';
}

/**
 * Submits a new reservation the same way the reservation planner's own "Reservar esta aldeia"
 * form does (POST action=new_reservation, target_type=coord). Returns the response HTML (the
 * planner's own page) so the caller can check for an `.error_box` (e.g. already reserved).
 * @param {number|string} x
 * @param {number|string} y
 * @returns {Promise<string>}
 */
async function submitNewReservation(x, y) {
    const url = `${game_data.link_base_pure}ally&mode=reservations&action=new_reservation&group_id=all&filter=`;
    const body = new URLSearchParams();
    body.append('x[]', x);
    body.append('y[]', y);
    body.append('target_type', 'coord');
    body.append('input', `${x}|${y}`);
    body.append('h', game_data.csrf);

    const response = await fetch(url, { method: 'POST', body });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
}

/**
 * Submits a reservation deletion the same way the planner's own batch-delete checkbox form does
 * (POST action=submit&delete_claims, one or more `ids[]`).
 * @param {string|number} reservationId
 * @returns {Promise<string>}
 */
async function submitDeleteReservation(reservationId) {
    const url = `${game_data.link_base_pure}ally&mode=reservations&action=submit&group_id=all&filter=`;
    const body = new URLSearchParams();
    body.append('ids[]', reservationId);
    body.append('delete_claims', '1');
    body.append('h', game_data.csrf);

    const response = await fetch(url, { method: 'POST', body });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
}

/**
 * @param {string} html A reservation planner page response.
 * @returns {string|null} The error text (e.g. "Um aliado já reservou X!"), or null on success.
 */
function extractReservationPlannerError(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.querySelector('.error_box .content')?.textContent.trim() || null;
}

function isReservationCooldownError(error) {
    return /cooldown|não pode fazer outra reserva/i.test(error || '');
}

/**
 * Looks up the reservation id for a village among the CURRENT player's own reservations only
 * (group_id=creator_id) — capped at a handful per account (the planner enforces a small limit),
 * so this always fits on a single page, unlike the full tribe+partners list.
 * @param {string|number} villageId
 * @returns {Promise<string|null>}
 */
async function findOwnReservationId(villageId) {
    const url = `${game_data.link_base_pure}ally&mode=reservations&group_id=creator_id&filter=${game_data.player.id}`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        const row = Array.from(doc.querySelectorAll('tr[id^="reservation_"]'))
            .find(r => r.querySelector('.village_anchor')?.dataset.id === String(villageId));
        return row ? row.id.replace('reservation_', '') : null;
    } catch (error) {
        console.error('[Ally Reservations] Failed to look up own reservation id for village ' + villageId, error);
        return null;
    }
}

/**
 * Reserves a village via the planner's own form endpoint and updates the local cache
 * optimistically on success. Re-renders the ctx buttons in place afterwards either way.
 * @param {{id:string|number, owner:string|number}} village
 * @param {number} x
 * @param {number} y
 */
async function reserveVillage(village, x, y) {
    try {
        const html = await submitNewReservation(x, y);
        const error = extractReservationPlannerError(html);
        if (error) {
            UI.ErrorMessage(error);
            // A cooldown means nothing changed on the server; avoid refetching every page.
            if (!isReservationCooldownError(error)) {
                // Someone may have grabbed it since our last sync — refresh before re-rendering.
                await syncAllyReservations(true);
            }
            updateReservationCtxButtons(village, x, y);
            return;
        }

        // The planner's response doesn't cleanly expose the new reservation id/expiry from this
        // page alone (it may land on a different page of the paginated list) — left null until
        // the next hourly sync (or findOwnReservationId, on unreserve) backfills them.
        const record = {
            reservationId: null,
            villageId: String(village.id),
            coords: `${x}|${y}`,
            targetPlayerId: String(village.owner),
            reservingPlayerId: String(game_data.player.id),
            reservingPlayerName: game_data.player.name,
            expiresAtText: null,
            expiresAtMs: null
        };
        await reservationSet(village.id, record);
        UI.SuccessMessage(t('map.reservation.created'));
        updateReservationCtxButtons(village, x, y);
        if (typeof addReservationIcons === 'function') addReservationIcons();
    } catch (error) {
        console.error('[Ally Reservations] Reserve failed for village ' + village.id, error);
    }
}

/**
 * Removes the current player's own reservation on a village, resolving the reservation id first
 * if it isn't cached yet (e.g. right after reserveVillage(), which doesn't get one back).
 * @param {{id:string|number, owner:string|number}} village
 * @param {*} reservation Cached reservation record for this village (must be the player's own).
 * @param {number} x
 * @param {number} y
 */
async function unreserveVillage(village, reservation, x, y) {
    try {
        const reservationId = reservation.reservationId || await findOwnReservationId(village.id);
        if (!reservationId) {
            console.warn('[Ally Reservations] Could not resolve reservation id for village ' + village.id);
            return;
        }
        await submitDeleteReservation(reservationId);
        await reservationRemove(village.id);
        UI.SuccessMessage(t('map.reservation.removed'));
        updateReservationCtxButtons(village, x, y);
        if (typeof addReservationIcons === 'function') addReservationIcons();
    } catch (error) {
        console.error('[Ally Reservations] Unreserve failed for village ' + village.id, error);
    }
}

/**
 * Computes the lock/unlock button position relative to `#mp_info` (always repositioned by
 * native code on every context spawn, for both own/other villages) — recomputed fresh on every
 * call rather than trusting a previous value, since native never positions `#mp_lock` itself on
 * this account/world. Offset by 60px (icon width + one extra button slot) so it doesn't sit on
 * top of `#mp_info` or the native button immediately to its right.
 * @returns {{left: string, top: string}}
 */
function computeReservationCtxPosition() {
    const mpInfo = document.getElementById('mp_info');
    if (!mpInfo?.style.left || !mpInfo?.style.top) return null;
    return { left: `${parseFloat(mpInfo.style.left) - 61}px`, top: mpInfo.style.top };
}

/**
 * Shows/hides/rewires the native #mp_lock/#mp_unlock anchors for the currently focused village,
 * based on the local reservation cache. Own villages never show either button. Position is
 * always recomputed via computeReservationCtxPosition() (never cached), the same way the
 * farm-assist ctx buttons in map.js recalculate on every context spawn.
 * @param {{id:string|number, owner:string|number}} village
 * @param {number} x
 * @param {number} y
 */
function updateReservationCtxButtons(village, x, y) {
    const mpLock = document.getElementById('mp_lock');
    const mpUnlock = document.getElementById('mp_unlock');
    if (!mpLock || !mpUnlock) {
        console.warn('[Ally Reservations] #mp_lock/#mp_unlock not found in DOM — nothing to render.');
        return;
    }

    if (!isMapContextButtonEnabled('reservation')) {
        mpLock.style.display = 'none';
        mpLock.style.opacity = '0';
        mpUnlock.style.display = 'none';
        mpUnlock.style.opacity = '0';
        return;
    }

    $(mpLock).off('click.allyReservations');
    $(mpUnlock).off('click.allyReservations');
    mpUnlock.classList.remove('reservation-ctx-disabled');

    const reservationHydration = window.PremiumFeaturesHydration?.reservations;
    if (isReservationCacheHydrating()) {
        // An empty in-memory cache during hydration is not proof that a village is unreserved.
        // Hide both mutations until its own cache is ready; re-render only if this same village
        // is still the active context when the promise settles.
        mpLock.dataset.twpfReservationVillageId = String(village.id);
        mpLock.style.display = 'none';
        mpUnlock.style.display = 'none';
        reservationHydration.pendingMapContext = { village, x, y, element: mpLock };
        if (!reservationHydration.mapContextRefreshRegistered) {
            reservationHydration.mapContextRefreshRegistered = true;
            reservationHydration.promise.then(function () {
                const pending = reservationHydration.pendingMapContext;
                reservationHydration.pendingMapContext = null;
                if (pending?.element?.isConnected &&
                    pending.element.dataset.twpfReservationVillageId === String(pending.village.id)) {
                    updateReservationCtxButtons(pending.village, pending.x, pending.y);
                }
            });
        }
        return;
    }
    mpLock.dataset.twpfReservationVillageId = String(village.id);

    if (String(village.owner) === String(game_data.player.id)) {
        mpLock.style.display = 'none';
        mpLock.style.opacity = '0';
        mpUnlock.style.display = 'none';
        mpUnlock.style.opacity = '0';
        return;
    }

    const reservation = getReservationForVillage(village.id);
    const position = computeReservationCtxPosition();

    if (!reservation) {
        mpUnlock.style.display = 'none';
        mpUnlock.style.opacity = '0';
        // Force-show #mp_lock ourselves instead of trusting native state — some
        // worlds/accounts never render it natively even though the ajaxaction still works.
        if (position) {
            mpLock.style.left = position.left;
            mpLock.style.top = position.top;
        }
        mpLock.style.display = 'block';
        mpLock.style.opacity = '1';
        $(mpLock).on('click.allyReservations', e => {
            e.preventDefault();
            UI.ConfirmationBox(
                t('map.reservation.reserveConfirm', { coords: `${x}|${y}` }),
                [{
                    text: t('button.ok'),
                    callback: function () {
                        setReservationCtxLoading(mpLock, true);
                        reserveVillage(village, x, y)
                            .finally(() => setReservationCtxLoading(mpLock, false));
                    },
                    confirm: true
                }],
                'tw_reserve_village_' + village.id,
                false,
                true
            );
        });
        return;
    }

    mpLock.style.display = 'none';
    mpLock.style.opacity = '0';

    if (position) {
        mpUnlock.style.left = position.left;
        mpUnlock.style.top = position.top;
    }
    mpUnlock.style.display = 'block';
    mpUnlock.style.opacity = '1';

    const isMine = String(reservation.reservingPlayerId) === String(game_data.player.id);
    if (isMine) {
        mpUnlock.setAttribute('data-title', t('map.reservation.unlockMine'));
        $(mpUnlock).on('click.allyReservations', e => {
            e.preventDefault();
            UI.ConfirmationBox(
                t('map.reservation.removeConfirm', { coords: `${x}|${y}` }),
                [{
                    text: t('button.ok'),
                    callback: function () {
                        setReservationCtxLoading(mpUnlock, true);
                        unreserveVillage(village, reservation, x, y)
                            .finally(() => setReservationCtxLoading(mpUnlock, false));
                    },
                    confirm: true
                }],
                'tw_unreserve_village_' + village.id,
                false,
                true
            );
        });
    } else {
        mpUnlock.classList.add('reservation-ctx-disabled');
        mpUnlock.setAttribute('data-title', t('map.reservation.reservedBy', {
            name: reservation.reservingPlayerName || '?',
            date: reservation.expiresAtText || '?'
        }));
    }
}

/**
 * Renders the reservation action in a native VillageContext menu outside the map.
 * @param {{villageId:string, ownerId:string, x:number, y:number, coords:string}} context
 * @param {HTMLAnchorElement} element
 * @returns {boolean}
 */
function renderExternalReservationCtxAction(context, element) {
    if (!game_data.player.ally || !context.villageId || context.x === null || context.y === null) return false;

    if (isReservationCacheHydrating()) {
        const hydration = window.PremiumFeaturesHydration.reservations;
        if (!hydration.contextRefreshRegistered) {
            hydration.contextRefreshRegistered = true;
            hydration.promise.then(function () {
                if (typeof refreshCtxCustom === 'function') refreshCtxCustom();
            });
        }
        return false;
    }

    const village = { id: context.villageId, owner: context.ownerId };
    const reservation = getReservationForVillage(context.villageId);
    element.classList.remove('reservation-ctx-disabled', 'mp_lock', 'mp_unlock');

    if (String(context.ownerId) === String(game_data.player.id)) return false;

    if (!reservation) {
        element.title = t('map.reservation.reserveButton');
        element.classList.add('mp_lock');
        return true;
    }

    const isMine = String(reservation.reservingPlayerId) === String(game_data.player.id);
    element.classList.add('mp_unlock');
    element.title = isMine ? t('map.reservation.unlockMine') : t('map.reservation.reservedBy', {
        name: reservation.reservingPlayerName || '?',
        date: reservation.expiresAtText || '?'
    });
    if (!isMine) element.classList.add('reservation-ctx-disabled');
    return true;
}

function setReservationCtxLoading(element, isLoading) {
    if (!element) return;
    element.setAttribute('aria-busy', String(isLoading));
    element.style.pointerEvents = isLoading ? 'none' : '';
    element.style.opacity = isLoading ? '0.6' : '';
    element.style.backgroundImage = isLoading
        ? 'url(https://dsbr.innogamescdn.com/asset/f441272cc5/graphic/loading.gif)'
        : '';
}

function handleExternalReservationCtxAction(context, element) {
    if (!game_data.player.ally || context.x === null || context.y === null) return;
    if (isReservationCacheHydrating()) return;

    const village = { id: context.villageId, owner: context.ownerId };
    const reservation = getReservationForVillage(context.villageId);
    if (!reservation) {
        UI.ConfirmationBox(
            t('map.reservation.reserveConfirm', { coords: context.coords }),
            [{
                text: t('button.ok'),
                callback: function () {
                    setReservationCtxLoading(element, true);
                    reserveVillage(village, context.x, context.y)
                        .finally(() => {
                            setReservationCtxLoading(element, false);
                            refreshCtxCustom();
                        });
                },
                confirm: true
            }],
            'tw_reserve_village_' + context.villageId,
            false,
            true
        );
    } else if (String(reservation.reservingPlayerId) === String(game_data.player.id)) {
        UI.ConfirmationBox(
            t('map.reservation.removeConfirm', { coords: context.coords }),
            [{
                text: t('button.ok'),
                callback: function () {
                    setReservationCtxLoading(element, true);
                    unreserveVillage(village, reservation, context.x, context.y)
                        .finally(() => {
                            setReservationCtxLoading(element, false);
                            refreshCtxCustom();
                        });
                },
                confirm: true
            }],
            'tw_unreserve_village_' + context.villageId,
            false,
            true
        );
    }
}

if (isMapContextButtonEnabled('reservation') && typeof registerCtxCustomAction === 'function') {
    registerCtxCustomAction({
        id: 'reservations',
        slot: 1,
        title: t('map.reservation.reserveButton'),
        className: 'reservation-ctx-button',
        spriteClass: 'mp_lock',
        render: renderExternalReservationCtxAction,
        onClick: handleExternalReservationCtxAction
    });
}

/**
 * Chain-safe wrap of TWMap.context.spawn/hide — independent of map.js's own
 * startMapContextWatcher(), since this feature can be toggled on/off separately.
 */
function startReservationContextWatcher() {
    const _prevSpawn = TWMap.context.spawn.bind(TWMap.context);
    TWMap.context.spawn = function (village, x, y) {
        _prevSpawn(village, x, y);
        updateReservationCtxButtons(village, x, y);
    };

    const _prevHide = TWMap.context.hide.bind(TWMap.context);
    TWMap.context.hide = function () {
        _prevHide();
        const mpLock = document.getElementById('mp_lock');
        const mpUnlock = document.getElementById('mp_unlock');
        if (mpLock) $(mpLock).off('click.allyReservations');
        if (mpUnlock) {
            $(mpUnlock).off('click.allyReservations');
            mpUnlock.classList.remove('reservation-ctx-disabled');
            mpUnlock.style.display = 'none';
            mpUnlock.style.opacity = '0';
        }
    };
}

if (typeof TWMap !== 'undefined' && isMapContextButtonEnabled('reservation')) {
    syncAllyReservations();
    startReservationContextWatcher();
}
