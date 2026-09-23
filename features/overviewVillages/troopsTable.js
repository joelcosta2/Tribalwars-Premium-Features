const TROOP_UNIT_ORDER = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];
const TROOP_CACHE_TTL_MS = 30 * 60 * 1000;

function getOverviewVillagesTroopUnitOrder() {
    return TROOP_UNIT_ORDER.filter(unit => isArchersEnabled() || (unit !== 'archer' && unit !== 'marcher'));
}

function getOverviewVillagesTroopMetadata() {
    try {
        return JSON.parse(localStorage.getItem('unit_managers_meta') || '{}');
    } catch (error) {
        return {};
    }
}

function replaceOverviewVillagesTroopHeader(cell, unit) {
    if (!cell) return;
    const unitMeta = getOverviewVillagesTroopMetadata();
    cell.textContent = '';
    cell.className = 'troops-overview-header troops-overview-header-' + unit;
    cell.style.cssText = 'white-space:nowrap;text-align:center;position:relative;';

    const img = document.createElement('img');
    img.src = unitMeta[unit]?.img || ('graphic/unit/unit_' + unit + '.webp');
    img.alt = unit;
    img.style.cssText = 'width:18px;height:18px;vertical-align:middle;';
    img.setAttribute('data-title', `<b>${escapeHtml(unitMeta[unit]?.name || unit)}</b>`);
    img.addEventListener('mouseenter', function (event) { toggleTooltip(event.target, true); });
    img.addEventListener('mouseleave', function (event) { toggleTooltip(event.target, false); });
    cell.appendChild(img);
}

const TROOP_OVERVIEW_CACHE_KEY = 'overview_village_troop_counts_v3';
const TROOP_PLACE_FETCHED_AT_KEY = 'troop_place_fetched_at_v3';
const TROOP_OVERVIEW_ROWS = ['own', 'home', 'away', 'transit', 'total'];

function getOverviewVillagesTroopCounts(villageId) {
    return bqGet(TROOP_OVERVIEW_CACHE_KEY, villageId) || {};
}

function renderTroopsOverviewCell(cell, villageId, unit, rowType) {
    const counts = getOverviewVillagesTroopCounts(villageId);
    const value = counts[rowType]?.[unit] ?? 0;
    cell.style.textAlign = 'center';
    cell.style.color = '';
    cell.style.minHeight = '';
    cell.removeAttribute('aria-busy');
    cell.textContent = String(value);
    cell.style.fontWeight = rowType === 'total' ? 'bold' : '';
}

function setOverviewVillageTroopLoading(table, villageId, loading) {
    const villageRows = table.querySelectorAll('tr[data-village-id="' + villageId + '"]');
    // Anchor on the first row the active filter actually shows, not always "own", so the
    // spinner (and its rowSpan) never lands inside a hidden row.
    const visibleRows = Array.from(villageRows).filter(row => !row.hidden);
    const firstRow = visibleRows[0] || villageRows[0];
    const troopCells = firstRow ? firstRow.querySelectorAll('.troops-overview-cell') : [];
    if (!firstRow || !troopCells.length) return;

    const existingLoading = firstRow.querySelector('.troops-overview-village-loading');
    if (loading) {
        if (existingLoading) return;
        const loadingCell = document.createElement('td');
        loadingCell.className = 'troops-overview-village-loading';
        loadingCell.rowSpan = visibleRows.length || TROOP_OVERVIEW_ROWS.length;
        loadingCell.colSpan = troopCells.length;
        loadingCell.style.textAlign = 'center';
        loadingCell.appendChild(createOverviewVillagesTableLoadingElement('24px'));
        // Insert before the actions cell (not appendChild) so actions stay pinned on the right during loading.
        const actionCell = firstRow.querySelector('.troops-overview-actions');
        if (actionCell) firstRow.insertBefore(loadingCell, actionCell);
        else firstRow.appendChild(loadingCell);
        villageRows.forEach(function (row) {
            row.querySelectorAll('.troops-overview-cell').forEach(function (cell) {
                cell.setAttribute('aria-busy', 'true');
                cell.style.display = 'none';
            });
        });
        return;
    }

    existingLoading?.remove();
    villageRows.forEach(function (row) {
        row.querySelectorAll('.troops-overview-cell').forEach(function (cell) {
            cell.removeAttribute('aria-busy');
            cell.style.display = '';
        });
    });
}
const PLACE_UNIT_TYPES = TROOP_UNIT_ORDER.concat('militia');

/**
 * Parses the five overview rows from a village's rally point troops page.
 * @param {Document} doc - Parsed HTML of screen=place&mode=units&display=units.
 * @returns {Object} Unit counts grouped as own, home, away, transit, and total.
 */
function parsePlaceUnitCounts(doc) {
    const homeRow = Array.from(doc.querySelectorAll('#units_home tbody tr')).find(row =>
        row.querySelectorAll('td').length && !row.querySelector('input[type="checkbox"]')
    );
    const homeTotalRow = Array.from(doc.querySelectorAll('#units_home tbody tr')).find(row =>
        row.querySelector('th')?.textContent.trim().toLowerCase().includes('total')
    );

    function sumUnitCellsInRows(rows, unit) {
        let total = 0;
        rows.forEach(row => {
            row.querySelectorAll('td.unit-item-' + unit).forEach(cell => {
                total += parseInt(cell.dataset.unitCount || '0', 10);
            });
        });
        return total;
    }

    function getUnitDataRows(table) {
        return Array.from(table?.querySelectorAll('tbody tr') || []).filter(row =>
            row.querySelector('td.unit-item')
        );
    }

    const transitRows = getUnitDataRows(doc.querySelector('#units_transit'));
    const awayRows = getUnitDataRows(doc.querySelector('#units_away'));

    const result = { own: {}, home: {}, away: {}, transit: {}, total: {} };
    PLACE_UNIT_TYPES.forEach(function (unit) {
        const own = parseInt(homeRow?.querySelector('.unit-item-' + unit)?.dataset.unitCount || '0', 10);
        const home = parseInt(homeTotalRow?.querySelector('.unit-item-' + unit)?.dataset.unitCount || '0', 10);
        const transit = sumUnitCellsInRows(transitRows, unit);
        const away = sumUnitCellsInRows(awayRows, unit);

        result.own[unit] = own;
        result.home[unit] = home;
        result.away[unit] = away;
        result.transit[unit] = transit;
        result.total[unit] = home + away + transit;
    });

    return result;
}

/**
 * Fetches a village's rally point troops page and returns its in-village/total counts
 * (see parsePlaceUnitCounts). Only used by the overview_villages troops column — the sidebar
 * recruit widget never needs the place-only breakdown. Also stores a resource snapshot from
 * the same fetched page (the resource header bar is present on every screen), at no extra
 * request cost.
 * @param {string|number} villageId
 * @returns {Promise<Object|null>} Resolves to null on failure (merge is skipped by the caller).
 */
function fetchSpecialUnitCounts(villageId) {
    return fetchWithRetry429({
        url: getVillageLinkBase(villageId) + 'place&mode=units&display=units',
        type: 'GET',
        cache: false
    }).then(function (data) {
        const doc = new DOMParser().parseFromString(data, 'text/html');
        setVillageResources(villageId, readVillageResourceSnapshot(doc));
        return parsePlaceUnitCounts(doc);
    }).catch(function () { return null; });
}

/**
 * Fetches a single village's rally point page and stores its location-aware unit counts.
 * @param {string|number} villageId
 * @returns {Promise<void>} Resolves once stored (never rejects — a failed village is skipped).
 */
function fetchAndStoreVillageTroopCounts(villageId, { mode = 'full' } = {}) {
    return fetchSpecialUnitCounts(villageId).then(function (placeCounts) {
        if (placeCounts) {
            bqSet(TROOP_OVERVIEW_CACHE_KEY, villageId, placeCounts);
            bqSet(TROOP_PLACE_FETCHED_AT_KEY, villageId, Date.now());
        }
    });
}

function getOverviewVillagesTroopAutoSetting() {
    const setting = settings_cookies.general?.show__overview_villages_troops;
    return { alwaysUpdate: setting === true || setting?.alwaysUpdate === true };
}

function shouldAutoRefreshOverviewVillagesTroops(villageId, alwaysUpdate) {
    if (alwaysUpdate) return true;
    const fetchedAt = Number(bqGet(TROOP_PLACE_FETCHED_AT_KEY, villageId) || 0);
    return !fetchedAt || Date.now() - fetchedAt >= TROOP_CACHE_TTL_MS;
}

function autoRefreshOverviewVillagesTroops(table, villages, forceRefresh = false) {
    const visibleIds = new Set(villages.map(village => String(village.id)));
    const rows = Array.from(table.querySelectorAll('tbody tr[data-village-id]')).filter(row => {
        const villageId = row.dataset.villageId;
        return villageId && visibleIds.has(String(villageId));
    });
    const state = overviewVillagesTabsState.refreshState.troops;
    const rowsToFetch = rows.filter(row => {
        if (row.dataset.troopRow !== TROOP_OVERVIEW_ROWS[0]) return false;
        const villageId = row.dataset.villageId;
        const id = String(villageId);
        return shouldAutoRefreshOverviewVillagesTroops(
            villageId,
            forceRefresh || getOverviewVillagesTroopAutoSetting().alwaysUpdate
        )
            && !state.completed.has(id)
            && !state.inFlight.has(id);
    });
        return runWithConcurrencyLimit(rowsToFetch, function (row) {
        const villageId = row.dataset.villageId;
        setOverviewVillageTroopLoading(table, villageId, true);
        const request = fetchAndStoreVillageTroopCounts(villageId, { mode: 'place' }).then(function () {
            setOverviewVillageTroopLoading(table, villageId, false);
            state.completed.add(String(villageId));
            const currentTable = overviewVillagesTabsState.host?.querySelector('#units_table') || table;
            const currentVillageRows = currentTable.querySelectorAll('tr[data-village-id="' + villageId + '"]');
            currentVillageRows.forEach(function (villageRow) {
                villageRow.querySelectorAll('.troops-overview-cell').forEach(function (cell) {
                    renderTroopsOverviewCell(cell, villageId, cell.dataset.unit, cell.dataset.rowType);
                });
            });
        }).finally(function () {
            state.inFlight.delete(String(villageId));
        });
        state.inFlight.set(String(villageId), request);
        return request;
    }, { concurrency: 1, minDelay: 100, maxDelay: 500 });
}

function refreshOverviewVillagesTroops(villages, forceRefresh = false) {
    const table = overviewVillagesTabsState.host?.querySelector('#units_table');
    if (!table) return Promise.resolve();
    return autoRefreshOverviewVillagesTroops(table, villages || getOverviewVillagesVisibleVillages(), forceRefresh);
}

/**
 * Refreshes troop counts for every village row in the table, one village at a time, waiting a
 * random 100-500ms between each request so all the AJAX calls aren't fired at once. Each cell
 * shows "…" while its own fetch is pending and re-renders as soon as it completes. The trigger
 * icon is disabled/dimmed for the duration of the whole sweep.
 * @param {HTMLElement} table
 * @param {HTMLElement} triggerIcon
 */
function refreshAllVillagesTroopCounts(table, triggerIcon) {
    if (triggerIcon.dataset.refreshing === 'true') return;
    triggerIcon.dataset.refreshing = 'true';
    triggerIcon.style.opacity = '0.4';
    triggerIcon.style.pointerEvents = 'none';

    const visibleIds = new Set(getOverviewVillagesVisibleVillages().map(village => String(village.id)));
    const alwaysUpdate = getOverviewVillagesTroopAutoSetting().alwaysUpdate;
    const rows = Array.from(table.querySelectorAll('tbody tr[data-village-id]')).filter(row => {
        const villageId = row.dataset.villageId;
        return row.dataset.troopRow === TROOP_OVERVIEW_ROWS[0]
            && visibleIds.has(String(villageId))
            && shouldAutoRefreshOverviewVillagesTroops(villageId, alwaysUpdate);
    });

    runWithConcurrencyLimit(rows, function (row) {
        const villageId = row.dataset.villageId;
        const villageRows = table.querySelectorAll('tr[data-village-id="' + villageId + '"]');
        setOverviewVillageTroopLoading(table, villageId, true);

        return fetchAndStoreVillageTroopCounts(villageId, { mode: 'place' }).then(function () {
            setOverviewVillageTroopLoading(table, villageId, false);
            villageRows.forEach(function (villageRow) {
                villageRow.querySelectorAll('.troops-overview-cell').forEach(function (cell) {
                    renderTroopsOverviewCell(cell, villageId, cell.dataset.unit, cell.dataset.rowType);
                });
            });
        });
    }, { concurrency: 1, minDelay: 100, maxDelay: 500 }).then(function () {
        triggerIcon.dataset.refreshing = 'false';
        triggerIcon.style.opacity = '';
        triggerIcon.style.pointerEvents = '';
    });
}

/**
 * Re-fetches and re-renders a single village's troop columns in #production_table — used after
 * training troops via the quick-links Recruit overlay (see submitTroops/disperseTroops in
 * recruitTroops.js) so the overview row doesn't show stale counts until the next
 * manual "\u21bb" refresh or full page load. No-ops if the table or that village's row aren't
 * present (e.g. not on the overview_villages page, or the column is disabled).
 * @param {string|number} villageId
 */
function refreshOverviewVillagesTroopsRow(villageId) {
    const table = overviewVillagesTabsState.host?.querySelector('#units_table');
    if (!table) return;

    const rows = table.querySelectorAll('tr[data-village-id="' + villageId + '"]');
    if (!rows.length) return;
    setOverviewVillageTroopLoading(table, villageId, true);

    fetchAndStoreVillageTroopCounts(villageId, { mode: 'place' }).then(function () {
        setOverviewVillageTroopLoading(table, villageId, false);
        rows.forEach(function (row) {
            row.querySelectorAll('.troops-overview-cell').forEach(function (cell) {
                renderTroopsOverviewCell(cell, villageId, cell.dataset.unit, cell.dataset.rowType);
            });
        });
    });
}



