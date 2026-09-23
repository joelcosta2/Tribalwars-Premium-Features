
/**
 * Fetches outgoing commands from the overview page and stores them in localStorage.
 * Updates map icons if the relevant setting is enabled.
 */
async function getOutgoingCommandsFromOverview() {
    const { general } = settings_cookies;
    // Early exit if features are disabled
    if (!isMapHoverInfoEnabled() && !general['show__outgoingInfo_map']) {
        return;
    }
    const outgoingRetryAt = Number(localStorage.getItem('outgoing_commands_retry_at')) || 0;
    if (outgoingRetryAt > Date.now()) {
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: 'outgoing', logicalResource: 'outgoing', status: 'SOFT_PAUSE', reason: 'outgoing-backoff'
        });
        if (general['show__outgoingInfo_map'] && typeof mapReady === 'function') {
            await mapReady();
            addOutgoingIcons();
        }
        return;
    }

    // Time-gate survives full reloads. A command created by this mod invalidates it explicitly.
    const OUTGOING_TTL_MS = 3 * 60 * 1000;
    _outgoingCommandsLastFetch = Math.max(
        _outgoingCommandsLastFetch,
        Number(localStorage.getItem('outgoing_commands_fetched_at')) || 0
    );
    const invalidatedAt = Number(localStorage.getItem('outgoing_commands_invalidated_at')) || 0;
    if (_outgoingCommandsLastFetch >= invalidatedAt && (Date.now() - _outgoingCommandsLastFetch) < OUTGOING_TTL_MS) {
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: 'outgoing', logicalResource: 'outgoing', status: 'CACHE_HIT', reason: 'outgoing-ttl'
        });
        if (general['show__outgoingInfo_map'] && typeof mapReady === 'function') {
            await mapReady();
            addOutgoingIcons();
        }
        return;
    }
    if (general['show__outgoingInfo_map'] && localStorage.getItem('outgoing_units_saved')) {
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: 'outgoing', logicalResource: 'outgoing', status: 'STALE_HIT', reason: 'outgoing-swr'
        });
        mapReady().then(addOutgoingIcons).catch(() => {});
    }

    const execute = async function () {
      try {
        const latestFetchedAt = Number(localStorage.getItem('outgoing_commands_fetched_at')) || 0;
        const latestInvalidatedAt = Number(localStorage.getItem('outgoing_commands_invalidated_at')) || 0;
        if (latestFetchedAt >= latestInvalidatedAt && Date.now() - latestFetchedAt < OUTGOING_TTL_MS) {
            _outgoingCommandsLastFetch = latestFetchedAt;
            window.PremiumFeaturesDiagnostics?.record?.({
                feature: 'outgoing', logicalResource: 'outgoing', status: 'CACHE_HIT', reason: 'lease-wait-ttl-recheck'
            });
            return;
        }
        const url = game_data.link_base_pure + 'overview';
        const request = () => fetch(url);
        const response = await (window.PremiumFeaturesDiagnostics?.request
            ? window.PremiumFeaturesDiagnostics.request({
                feature: 'outgoing', logicalResource: 'outgoing', method: 'GET', reason: 'ttl-expired'
            }, request)
            : request());
        if (!response.ok) {
            const error = new Error('HTTP ' + response.status);
            error.status = response.status;
            error.url = response.url || url;
            throw error;
        }
        const htmlText = await response.text();
        localStorage.removeItem('outgoing_commands_retry_at');
        localStorage.removeItem('outgoing_commands_failure_count');

        // Parse the HTML response
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        const outgoingTable = doc.querySelector('#commands_outgoings');

        if (!outgoingTable) {
            localStorage.setItem('outgoing_units_saved', JSON.stringify([]));
            localStorage.setItem('outgoing_commands_detailed', JSON.stringify([]));
            _outgoingCommandsCache = [];
            _outgoingCommandsDetailedCache = [];
            _outgoingCommandsLastFetch = Date.now();
            localStorage.setItem('outgoing_commands_fetched_at', String(_outgoingCommandsLastFetch));
            return;
        }

        const commandRows = outgoingTable.querySelectorAll('.command-row');
        const outgoingUnitsMap = new Map();
        const outgoingCommandsDetailed = [];
        Array.from(commandRows).forEach(row => {
            const villageLabel = row.querySelector('.quickedit-label');
            const hoverDetails = row.querySelectorAll('.command_hover_details img');
            const unitList = Array.from(hoverDetails).map(img => {
                const match = img.src.match(/\/([^/]+)\.(?:png|webp)$/);
                return match ? match[1] : null;
            }).filter(Boolean);
            const labelText = villageLabel?.innerText.trim() || '';
            const villageCoords = labelText.match(/\((.*?)\)/)?.[1] || '';
            if (!villageCoords) return;
            const commandType = row.querySelector('.command_hover_details[data-command-type]')?.dataset.commandType;
            const existing = outgoingUnitsMap.get(villageCoords) || {
                name: villageCoords,
                imgs: [],
                commandTypes: { attack: 0, return: 0 }
            };
            existing.imgs.push(...unitList);
            if (commandType === 'attack' || commandType === 'return') {
                existing.commandTypes[commandType]++;
            }
            outgoingUnitsMap.set(villageCoords, existing);

            // Per-command detail for the map popup's "Own commands" table — kept separate from
            // the aggregated map above (which only drives the map icon overlay).
            const endtimeSpan = row.querySelector('span[data-endtime]');
            const arrivalCell = endtimeSpan?.closest('td')?.previousElementSibling;
            outgoingCommandsDetailed.push({
                targetCoords: villageCoords,
                sourceLabel: labelText.replace(/\(.*?\)/, '').trim(),
                icons: unitList,
                endtime: endtimeSpan ? parseInt(endtimeSpan.dataset.endtime, 10) : null,
                arrivalText: arrivalCell ? arrivalCell.textContent.replace(/\s+/g, ' ').trim() : ''
            });
        });

        const outgoing_units = Array.from(outgoingUnitsMap.values()).map(entry => ({
            name: entry.name,
            imgs: entry.imgs.join(','),
            commandTypes: entry.commandTypes
        }));
        localStorage.setItem('outgoing_units_saved', JSON.stringify(outgoing_units));
        localStorage.setItem('outgoing_commands_detailed', JSON.stringify(outgoingCommandsDetailed));
        _outgoingCommandsLastFetch = Date.now();
        localStorage.setItem('outgoing_commands_fetched_at', String(_outgoingCommandsLastFetch));
        localStorage.removeItem('outgoing_commands_invalidated_at');
        _outgoingCommandsCache = outgoing_units;
        _outgoingCommandsDetailedCache = outgoingCommandsDetailed;
        if (general['show__outgoingInfo_map'] && typeof mapReady === 'function') {
            await mapReady();
            addOutgoingIcons();
        }
    } catch (error) {
        console.error('[Outgoing Commands] Failed to fetch overview data:', error);
        const failure = window.PremiumFeaturesAsync?.classifyRequestFailure?.(error, {
            url: error?.url || game_data.link_base_pure + 'overview'
        }) || {};
        if (failure.transient) {
            const backoffMs = [30000, 60000, 120000, 300000, 600000];
            const count = (Number(localStorage.getItem('outgoing_commands_failure_count')) || 0) + 1;
            localStorage.setItem('outgoing_commands_failure_count', String(count));
            localStorage.setItem('outgoing_commands_retry_at', String(Date.now() + backoffMs[Math.min(count - 1, backoffMs.length - 1)]));
            window.PremiumFeaturesDiagnostics?.record?.({
                feature: 'outgoing', logicalResource: 'outgoing', status: 'SOFT_PAUSE', reason: 'outgoing-fetch-failed'
            });
        }
    }
    };
    const coalesced = () => window.PremiumFeaturesSingleFlight?.run
        ? window.PremiumFeaturesSingleFlight.run('outgoing', execute)
        : execute();
    const scheduler = window.PremiumFeaturesBackgroundScheduler;
    if (scheduler?.enqueue) {
        return scheduler.enqueue({
            key: 'outgoing:sync',
            priority: scheduler.PRIORITY?.REFRESH || 4,
            dueMode: scheduler.DUE_MODE?.EARLIEST || 'EARLIEST',
            leaseKey: 'outgoing',
            rerunWhileActive: true,
            run: coalesced
        });
    }
    return coalesced();
}

function invalidateOutgoingCommandsCache(reason) {
    const at = Date.now();
    _outgoingCommandsLastFetch = 0;
    localStorage.setItem('outgoing_commands_invalidated_at', String(at));
    window.PremiumFeaturesCoordination?.broadcast?.('logical-resource-invalidated', {
        logicalResource: 'outgoing', reason: reason || 'known-command-change', at
    });
}

let _mapReadyPromise = null;
const mapReady = () => {
    if (document.querySelector("[id^='map_village_']")) return Promise.resolve();
    if (_mapReadyPromise) return _mapReadyPromise;
    _mapReadyPromise = new Promise(resolve => {
        let settled = false;
        let timeout = null;
        const finish = function () {
            if (settled) return;
            settled = true;
            clearInterval(check);
            if (timeout !== null) clearTimeout(timeout);
            resolve();
        };
        const check = setInterval(() => {
            if (document.querySelector("[id^='map_village_']")) finish();
        }, 200);
        timeout = setTimeout(finish, 10000);
    }).finally(() => { _mapReadyPromise = null; });
    return _mapReadyPromise;
};

function addOutgoingIcons() {
    if (_outgoingCommandsCache === null) {
        const raw = localStorage.getItem('outgoing_units_saved');
        if (!raw) return;
        _outgoingCommandsCache = JSON.parse(raw);
    }
    const mapContainer = document.getElementById('map_container');
    if (!mapContainer) return;
    document.querySelectorAll('.outgoing_units_overlay').forEach(el => el.remove());

    _outgoingCommandsCache.forEach(command => {
        const villageCoords = command.name.replace('|', '');
        const villageInfo = TWMap.villages[villageCoords];
        if (!villageInfo) return;
        const villageElement = document.getElementById(`map_village_${villageInfo.id}`);
        if (!villageElement?.parentNode) return;

        const commandTypes = command.commandTypes || {};
        const visibleTypes = ['attack', 'return'].filter(type => Number(commandTypes[type]) > 0);
        if (!visibleTypes.length) return;

        const iconSize = 16;
        const iconGap = 1;
        const overlayWidth = visibleTypes.length * iconSize + (visibleTypes.length - 1) * iconGap;
        const top = parseFloat(villageElement.style.top);
        const left = parseFloat(villageElement.style.left);
        if (!Number.isFinite(top) || !Number.isFinite(left)) return;

        const fragment = document.createDocumentFragment();

        visibleTypes.forEach(type => {
            const cell = document.createElement('div');
            cell.className = 'outgoing_command_marker';
            cell.dataset.commandType = type;
            Object.assign(cell.style, { position: 'relative', width: `${iconSize}px`, height: `${iconSize}px` });
            const icon = document.createElement('img');
            icon.src = `/graphic/map/${type}.png`;
            icon.alt = '';
            Object.assign(icon.style, { width: `${iconSize}px`, height: `${iconSize}px`, display: 'block' });
            cell.appendChild(icon);
            const count = Number(commandTypes[type]);
            if (count > 1) {
                const badge = document.createElement('span');
                badge.textContent = `${count}x`;
                Object.assign(badge.style, {
                    position: 'absolute', top: '-4px', right: '-7px', padding: '0 2px', minWidth: '12px',
                    height: '11px', lineHeight: '11px', fontSize: '9px', fontWeight: 'bold', textAlign: 'center',
                    color: '#fff', background: 'rgba(0,0,0,0.75)', borderRadius: '6px',
                    boxShadow: '0 0 0 1px rgba(255,255,255,0.35)'
                });
                cell.appendChild(badge);
            }
            fragment.appendChild(cell);
        });

        const overlay = document.createElement('div');
        overlay.id = `outgoing_overlay_${villageCoords}`;
        overlay.className = 'outgoing_units_overlay';
        Object.assign(overlay.style, {
            position: 'absolute',
            top: `${top + 1}px`,
            left: `${left + (villageElement.offsetWidth || 32) - overlayWidth - 1}px`,
            zIndex: '10',
            pointerEvents: 'none',
            display: 'flex',
            gap: `${iconGap}px`,
            width: `${overlayWidth}px`,
            height: `${iconSize}px`,
            alignItems: 'start'
        });
        overlay.appendChild(fragment);
        villageElement.parentNode.insertBefore(overlay, villageElement);
    });
}

function addReservationIcons() {
    if (typeof reservationsGetAll !== 'function') return;

    document.querySelectorAll('.reservation_map_overlay').forEach(el => el.remove());

    const reservations = reservationsGetAll();
    if (!reservations) return;

    Object.values(reservations).forEach(reservation => {
        const villageInfo = TWMap.villages?.[reservation.coords?.replace('|', '')];
        if (!villageInfo) return;

        const villageElement = document.getElementById(`map_village_${villageInfo.id}`);
        if (!villageElement?.parentNode) return;

        const top = parseFloat(villageElement.style.top);
        const left = parseFloat(villageElement.style.left);
        if (!Number.isFinite(top) || !Number.isFinite(left)) return;

        const overlay = document.createElement('div');
        overlay.className = 'reservation_map_overlay';
        Object.assign(overlay.style, {
            position: 'absolute',
            top: `${top + 17}px`,
            left: `${left}px`,
            width: '18px',
            height: '18px',
            zIndex: '4',
            pointerEvents: 'none'
        });

        const icon = document.createElement('img');
        const isMine = String(reservation.reservingPlayerId) === String(game_data?.player?.id);
        icon.src = `/graphic/map/${isMine ? 'reserved_player' : 'reserved_ally'}.png`;
        icon.alt = '';
        Object.assign(icon.style, { width: '18px', height: '18px', display: 'block' });
        overlay.appendChild(icon);
        villageElement.parentNode.insertBefore(overlay, villageElement);
    });
}

/**
 * Renders a dedicated barracks icon for attacks sent through the farm assistant.
 * This keeps the normal outgoing-command icons untouched.
 */
function addFarmAttackIcons() {
    const savedData = Array.from(_farmAttackCoordsSet);
    if (!savedData.length) return;

    const farmAttackCoords = savedData;
    const mapContainer = document.getElementById('map_container');
    if (!mapContainer) return;

    // Remove standalone overlays and any previously appended barracks icons
    document.querySelectorAll('.farm_attack_overlay').forEach(el => el.remove());
    document.querySelectorAll('.farm_attack_img').forEach(el => el.remove());

    farmAttackCoords.forEach(coords => {
        const villageCoords = coords.replace('|', '');
        const villageInfo = TWMap.villages[villageCoords];
        if (!villageInfo) return;

        const villageElement = document.getElementById(`map_village_${villageInfo.id}`);
        if (!villageElement) return;

        const farmIcon = document.createElement('img');
        farmIcon.src = _getNavAssetBase() + 'buildings/barracks.webp';
        farmIcon.alt = '';
        farmIcon.className = 'farm_attack_img';
        Object.assign(farmIcon.style, { width: '15px', height: '15px', display: 'block' });

        const existingOverlay = document.getElementById(`outgoing_overlay_${villageCoords}`);
        if (existingOverlay) {
            // Slot into the existing icon grid — no positional overlap
            existingOverlay.appendChild(farmIcon);
        } else {
            // No outgoing overlay yet — create a standalone one with the same grid layout
            const { top, left } = villageElement.style;
            const overlay = document.createElement('div');
            overlay.id = `outgoing_overlay_${villageCoords}`;
            overlay.className = 'farm_attack_overlay';
            Object.assign(overlay.style, {
                position: 'absolute',
                top,
                left,
                zIndex: '11',
                pointerEvents: 'none',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 15px)',
                gridAutoRows: '15px',
                gap: '1px',
                width: 'max-content',
                alignItems: 'start'
            });
            overlay.appendChild(farmIcon);
            villageElement.parentNode.insertBefore(overlay, villageElement);
        }
    });
}

/**
 * Rebuilds the attack-report heatmap as MapSdk squares (one per attacked coordinate),
 * replacing the previous DOM-dot overlay. Called only when the reports cache changes —
 * MapSdk auto-redraws newly panned-into sectors on its own, so this never needs to run
 * on every map drag.
 * Intensity = 70% frequency weight + 30% recency weight over a 14-day window.
 */
function rebuildReportHeatmapMapSdkElements() {
    return window.TWPFMapReports?.rebuild();
}

/**
 * Fetches attack reports from the server for the default and "all" groups,
 * merges them with any previously stored data (keeping the most recent per coordinate),
 * and saves the result to localStorage.
 */
async function getReportsList() {
    if (!window.TWPFMapReports || !isMapHoverInfoEnabled('lastAttack')) return;
    return window.TWPFMapReports.sync();
}

/**
 * Synchronizes attack reports when the map is entered, so the heatmap does not
 * depend on a later village hover to discover newer reports.
 */
async function syncMapReportsOnLoad() {
    const reportsManager = window.TWPFMapReports;
    if (!reportsManager) return;
    if (!reportsManager.isEnabled?.() && !isMapHoverInfoEnabled('lastAttack')) return;

    const syncResult = await reportsManager.sync();
    if (syncResult?.changed || reportsManager.needsInitialBuild?.()) {
        await reportsManager.rebuild?.();
    }
}

/**
 * Builds a "<th>label</th><td>icon+value icon+value icon+value</td>" row for a wood/stone/iron
 * amounts object. Returns null if amounts is missing (nothing to show).
 * @param {string} labelText
 * @param {{wood:number, stone:number, iron:number}|null} amounts
 * @returns {HTMLTableRowElement|null}
 */
function createResourceAmountsRow(labelText, amounts) {
    if (!amounts) return null;
    const row = document.createElement('tr');
    row.classList.add('premium-report-row');
    const th = document.createElement('th');
    th.textContent = labelText;
    const td = document.createElement('td');
    ['wood', 'stone', 'iron'].forEach(res => {
        const icon = document.createElement('span');
        icon.className = 'icon header ' + res;
        icon.style.marginRight = '2px';
        td.appendChild(icon);
        td.appendChild(document.createTextNode(String(amounts[res]) + ' '));
    });
    row.append(th, td);
    return row;
}

/**
 * Injects report data (last attack date, loot, and spy results) into the Map Popup.
 * @param {Object} report - The report record (see reportGet/reportSet shape in
 * utils/core_indexeddb.js), with `loot`/`spyDiscover` populated once fetchedFull is true.
 */
function insertReportData(report, popUpBody) {
    if (!popUpBody) return;

    // 1. Cleanup: Remove existing "Last Attack" info to prevent row stacking
    const existingEntry = document.getElementById("info_last_attack");
    if (existingEntry) existingEntry.remove();

    // 2. Create the main "Last Attack" row
    const lastAttackRow = document.createElement('tr');
    lastAttackRow.id = "info_last_attack";

    // Use textContent for the labels to ensure clean rendering
    const header = document.createElement('th');
    header.textContent = t('map.lastAttack');

    const data = document.createElement('td');
    if (report.dot) {
        const dotImg = document.createElement('img');
        dotImg.src = report.dot.src;
        dotImg.title = report.dot.title;
        dotImg.style.cssText = 'vertical-align:middle;margin-right:4px;';
        data.appendChild(dotImg);
    }
    data.appendChild(document.createTextNode(report.date));

    lastAttackRow.append(header, data);
    popUpBody.appendChild(lastAttackRow);

    // 3. Loot/spy-discovery rows, rendered from structured numbers (not cached HTML)
    const lootLabel = report.loot
        ? t('map.loot') + ' (' + report.loot.popLooted + '/' + report.loot.popTotal + ')'
        : t('map.loot');
    const lootRow = createResourceAmountsRow(lootLabel, report.loot);
    if (lootRow) popUpBody.appendChild(lootRow);

    const spyRow = createResourceAmountsRow(t('map.discoveredResources'), report.spyDiscover);
    if (spyRow) popUpBody.appendChild(spyRow);
}

/**
 * Injects a "reserved by / expires" row for a village reserved via the ally-reservations
 * planner (features/allyReservations.js) — replicates the premium map popup's own reservation
 * display using our non-premium reservation tracking instead.
 * @param {Object} tgtVillage - Village object from TWMap.villages (needs `.id`).
 * @param {HTMLElement} popUpBody
 */
function insertReservationInfoRow(tgtVillage, popUpBody) {
    if (!popUpBody || typeof getReservationForVillage !== 'function') return;

    const reservation = getReservationForVillage(tgtVillage?.id);
    if (!reservation) return;

    const row = document.createElement('tr');
    row.id = 'info_reservation';
    const th = document.createElement('th');
    th.textContent = t('map.reservationLabel');
    const td = document.createElement('td');
    td.textContent = t('map.reservation.reservedBy', {
        name: reservation.reservingPlayerName || '?',
        date: reservation.expiresAtText || '?'
    });
    row.append(th, td);
    popUpBody.appendChild(row);
}

const OWN_VILLAGE_DATA_TTL_MS = 5 * 60 * 1000;
const OWN_VILLAGE_HOVER_INTENT_MS = 500;
let _ownVillageHoverIntentTimer = null;
const _ownVillageFetchInFlight = new Set();

/**
 * True when the troop or building snapshot for this village is missing or older than the TTL.
 * @param {string|number} villageId
 * @returns {boolean}
 */
function isOwnVillageDataStale(villageId) {
    const troopsFetchedAt = Number(bqGet('troop_place_fetched_at', villageId) || 0);
    const buildingsStale = typeof isVillageBuildingLevelsStale === 'function'
        ? isVillageBuildingLevelsStale(villageId, OWN_VILLAGE_DATA_TTL_MS)
        : true;
    return (Date.now() - troopsFetchedAt >= OWN_VILLAGE_DATA_TTL_MS) || buildingsStale;
}

/**
 * Debounced (hover-intent) active refresh of an own village's troops/buildings/resources, so
 * the map popup reflects near-live data instead of whatever another feature happened to cache.
 * Only fires network requests once the popup has stayed on the same village for
 * OWN_VILLAGE_HOVER_INTENT_MS, and only if that village's data is actually stale — a quick
 * sweep across many own villages never triggers a request per village.
 * @param {Object} tgtVillage - Village object from TWMap.villages (needs `.id`).
 */
function scheduleOwnVillageRefresh(tgtVillage) {
    clearTimeout(_ownVillageHoverIntentTimer);
    if (!tgtVillage?.id || !isOwnVillageDataStale(tgtVillage.id) || _ownVillageFetchInFlight.has(tgtVillage.id)) return;

    _ownVillageHoverIntentTimer = setTimeout(() => {
        if (TWMap.popup._currentVillage !== tgtVillage.id || _ownVillageFetchInFlight.has(tgtVillage.id)) return;
        _ownVillageFetchInFlight.add(tgtVillage.id);

        Promise.all([
            typeof fetchAndStoreVillageTroopCounts === 'function'
                ? fetchAndStoreVillageTroopCounts(tgtVillage.id, { mode: 'place' })
                : Promise.resolve(),
            typeof fetchAndStoreVillageBuildingLevels === 'function'
                ? fetchAndStoreVillageBuildingLevels(tgtVillage.id)
                : Promise.resolve()
        ]).finally(() => {
            _ownVillageFetchInFlight.delete(tgtVillage.id);
            // Popup may have moved to a different village (or closed) while we waited.
            if (TWMap.popup._currentVillage !== tgtVillage.id) return;
            const liveBody = document.getElementById('map_popup')?.querySelector('tbody');
            if (liveBody) insertOwnVillageDetailsRows(tgtVillage, liveBody);
        });
    }, OWN_VILLAGE_HOVER_INTENT_MS);
}

/**
 * Builds a bordered icon+value table (same visual style as the native troops/buildings tables
 * in the premium popup: alternating #F8F4E8/#DED3B9 cell backgrounds, icon row on top, value
 * row below) instead of a generic CSS grid — matches the original markup far more closely.
 * @param {Array<{icon:string, title:string, valueHtml:string}>} items
 * @returns {HTMLTableElement|null}
 */
function createBorderedIconValueTable(items) {
    if (!items || !items.length) return null;
    const table = document.createElement('table');
    table.style.cssText = 'border:1px solid #DED3B9';
    table.width = '100%';
    table.cellPadding = 0;
    table.cellSpacing = 0;

    const iconRow = document.createElement('tr');
    iconRow.className = 'center';
    const valueRow = document.createElement('tr');
    valueRow.className = 'center';

    items.forEach((item, index) => {
        const bg = index % 2 === 0 ? '#F8F4E8' : '#DED3B9';

        const iconTd = document.createElement('td');
        iconTd.style.cssText = `padding:2px;background-color:${bg}`;
        const img = document.createElement('img');
        img.src = item.icon;
        img.title = item.title;
        iconTd.appendChild(img);
        iconRow.appendChild(iconTd);

        const valueTd = document.createElement('td');
        valueTd.style.cssText = `padding:2px;background-color:${bg}`;
        valueTd.innerHTML = item.valueHtml || '';
        valueRow.appendChild(valueTd);
    });

    table.append(iconRow, valueRow);
    return table;
}

/**
 * Renders resources/population/trader/troops/buildings/note rows for the player's own village,
 * replicating the premium map popup's own-village panel as closely as possible in both content
 * AND layout (resources inline table, population+trader sharing one row, bordered troops/
 * buildings tables) from actively-refreshed local caches (see scheduleOwnVillageRefresh for the
 * fetch side). Shows a throbber while data is stale — never mixes fresh and stale numbers.
 * @param {Object} tgtVillage - Village object from TWMap.villages (needs `.id`).
 * @param {HTMLElement} popUpBody
 */
function insertOwnVillageDetailsRows(tgtVillage, popUpBody) {
    document.querySelectorAll('.info-own-village-row').forEach(el => el.remove());
    if (!popUpBody || !tgtVillage?.id || !isMapHoverInfoEnabled('ownVillageInfo')) return;

    const villageId = tgtVillage.id;
    const assetBase = _getNavAssetBase();
    const appendRow = row => { if (row) { row.classList.add('info-own-village-row'); popUpBody.appendChild(row); } };

    if (isOwnVillageDataStale(villageId)) {
        const loadingRow = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 2;
        const throbber = document.createElement('img');
        throbber.src = '/graphic/throbber.gif';
        throbber.alt = t('common.loading');
        td.appendChild(throbber);
        loadingRow.appendChild(td);
        appendRow(loadingRow);
    } else {
        const resources = getVillageResources(villageId);
        if (resources) {
            // Single inline table (wood/stone/iron/total), matching #info_resources_row's
            // nested <table> in the native premium popup.
            const resourcesRow = document.createElement('tr');
            const resourcesTd = document.createElement('td');
            resourcesTd.colSpan = 2;
            const resourcesTable = document.createElement('table');
            resourcesTable.cellPadding = 0;
            resourcesTable.className = 'nowrap';
            const resourcesTr = document.createElement('tr');
            const total = (resources.wood || 0) + (resources.stone || 0) + (resources.iron || 0);
            [
                ['wood', t('common.wood'), resources.wood],
                ['stone', t('common.clay'), resources.stone],
                ['iron', t('common.iron'), resources.iron],
                ['ressources', t('common.resources'), total]
            ].forEach(([cls, title, value]) => {
                const cell = document.createElement('td');
                const icon = document.createElement('span');
                icon.className = 'icon header ' + cls;
                icon.title = title;
                cell.append(icon, document.createTextNode(String(value)));
                resourcesTr.appendChild(cell);
            });
            resourcesTable.appendChild(resourcesTr);
            resourcesTd.appendChild(resourcesTable);
            resourcesRow.appendChild(resourcesTd);
            appendRow(resourcesRow);
        }

        // Population + trader share a single row (two <td>s), same as the native popup.
        const merchants = bqGet('market_transports', villageId)?.status?.merchants;
        const hasPop = resources && Number.isFinite(resources.pop) && Number.isFinite(resources.popMax);
        const hasMerchants = merchants && (merchants.available != null || merchants.total != null);
        if (hasPop || hasMerchants) {
            const popTraderRow = document.createElement('tr');
            const popTd = document.createElement('td');
            if (hasPop) {
                const popIcon = document.createElement('img');
                popIcon.src = assetBase + 'face.webp';
                popIcon.style.cssText = 'vertical-align:middle;margin-right:4px';
                popTd.append(popIcon, document.createTextNode(`${resources.pop}/${resources.popMax}`));
            }
            const traderTd = document.createElement('td');
            if (hasMerchants) {
                const traderIcon = document.createElement('img');
                traderIcon.src = assetBase + 'overview/trader.webp';
                traderIcon.style.cssText = 'vertical-align:middle;margin-right:4px';
                traderTd.append(traderIcon, document.createTextNode(`${merchants.available ?? '-'}/${merchants.total ?? '-'}`));
            }
            popTraderRow.append(popTd, traderTd);
            appendRow(popTraderRow);
        }

        // Troops: bordered table, all trackable unit types, "total<br>(home)" per cell —
        // matches the native popup's unit_count_home layout.
        const troopCounts = bqGet('village_unit_counts', villageId);
        if (troopCounts) {
            const unitOrder = typeof getOverviewVillagesTroopUnitOrder === 'function'
                ? getOverviewVillagesTroopUnitOrder()
                : Object.keys(troopCounts);
            const troopItems = unitOrder.map(unit => {
                const [homeStr, totalStr] = String(troopCounts[unit] || '0/0').split('/');
                const home = parseInt(homeStr, 10) || 0;
                const total = parseInt(totalStr, 10) || home;
                return {
                    icon: assetBase + 'unit/unit_' + unit + '.webp',
                    title: getUnitDisplayName(unit),
                    valueHtml: total > 0 ? `${total}<br><span class="unit_count_home">(${home})</span>` : ''
                };
            });
            const troopsTable = createBorderedIconValueTable(troopItems);
            if (troopsTable) {
                const troopsRow = document.createElement('tr');
                const troopsTd = document.createElement('td');
                troopsTd.colSpan = 2;
                troopsTd.appendChild(troopsTable);
                troopsRow.appendChild(troopsTd);
                appendRow(troopsRow);
            }
        }

        // Buildings: bordered table, one column per building found in the fetched screen=main.
        const buildingLevels = getVillageBuildingLevels(villageId);
        if (buildingLevels) {
            const buildingItems = Object.keys(buildingLevels).map(buildingId => ({
                icon: assetBase + 'buildings/' + buildingId + '.webp',
                title: getBuildingDisplayName(buildingId, document),
                valueHtml: String(buildingLevels[buildingId])
            }));
            const buildingsTable = createBorderedIconValueTable(buildingItems);
            if (buildingsTable) {
                const buildingsRow = document.createElement('tr');
                const buildingsTd = document.createElement('td');
                buildingsTd.colSpan = 2;
                buildingsTd.appendChild(buildingsTable);
                buildingsRow.appendChild(buildingsTd);
                appendRow(buildingsRow);
            }
        }
    }

    // Notepad note — <hr> + label + content in one cell, matching the native "Bloco de notas:" row.
    const note = notepadGetAll()[String(villageId)];
    if (note) {
        const noteRow = document.createElement('tr');
        const noteTd = document.createElement('td');
        noteTd.colSpan = 2;
        noteTd.appendChild(document.createElement('hr'));
        const label = document.createElement('u');
        label.textContent = t('map.notepadNote') + ':';
        noteTd.appendChild(label);
        const noteDiv = document.createElement('div');
        noteDiv.style.whiteSpace = 'pre-wrap';
        noteDiv.innerHTML = convertBBCodeToHTML(note);
        noteTd.appendChild(noteDiv);
        noteRow.appendChild(noteTd);
        appendRow(noteRow);
    }
}

/**
 * Injects report data (last attack, loot, outgoing units) into the active map popup
 * for the village currently under the cursor. Fetches and caches full report details
 * on first access via fetch.
 */
function isMapPopupStillShowingVillage(village) {
    const popup = document.getElementById('map_popup');
    return Boolean(village && TWMap?.popup?._currentVillage === village.id && popup?.isConnected &&
        popup.style.display !== 'none');
}

async function hydrateReportForCurrentMapHover(report, village, popupBody) {
    if (!isMapPopupStillShowingVillage(village)) {
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: 'reports', logicalResource: 'report:' + String(report?.id || ''),
            status: 'SKIPPED', reason: 'hover-ended-before-start'
        });
        return null;
    }
    const hydrated = await window.TWPFMapReports.hydrateFullReport(report);
    // Do not cancel an in-flight immutable report read; simply discard visual work if the user
    // has moved to another village by the time it settles.
    if (hydrated && isMapPopupStillShowingVillage(village)) insertReportData(hydrated, popupBody);
    return hydrated;
}

async function getReportInfoToMap(currentCoords, currentPopUpBody) {
    if (!isMapHoverInfoEnabled()) return;
    clearTimeout(_moraleHoverIntentTimer);

    // --- Morale (server-authoritative via the game's calculate_morale API) ---
    // The formula-based approach is unreliable: it ignores whether morale is enabled
    // in this world, and misses the time-based component. The API is the ground truth.
    document.getElementById('info_morale')?.remove();
    const tgtCoords = currentCoords.replace('|', '');
    const tgtVillage = TWMap?.villages?.[tgtCoords];
    // Own villages (including ones just conquered) shouldn't show morale or old
    // enemy-report data — the village's current owner is what matters, not who
    // owned it when the report was generated.
    const isOwnVillage = tgtVillage?.owner === game_data?.player?.id.toString();

    // --- Reservation (via features/allyReservations.js, not native premium data) ---
    document.getElementById('info_reservation')?.remove();
    if (isMapHoverInfoEnabled('reservation') && !isOwnVillage) {
        insertReservationInfoRow(tgtVillage, currentPopUpBody);
    }

    // --- Own village details (resources/population/buildings/troops/trader/note) ---
    document.querySelectorAll('.info-own-village-row').forEach(el => el.remove());
    if (isOwnVillage) {
        insertOwnVillageDetailsRows(tgtVillage, currentPopUpBody);
        scheduleOwnVillageRefresh(tgtVillage);
    }

    if (isMapHoverInfoEnabled('morale') && tgtVillage?.owner && !isOwnVillage) {
        const defPoints = TWMap.players?.[tgtVillage.owner]?.points;
        const defName   = TWMap.players?.[tgtVillage.owner]?.name || '';
        const ownerId   = tgtVillage.owner;

        if (defPoints > 0) {
            // Helper: inject the morale row into the popup.
            // Uses a live DOM query instead of the captured currentPopUpBody reference —
            // the game rebuilds #map_popup innerHTML ~100ms after hover (popup server data),
            // which detaches the original tbody before the morale POST resolves.
            // TWMap.popup._currentVillage guards against injecting into a different village's popup.
            const injectMoraleRow = (morale) => {
                document.getElementById('info_morale')?.remove();
                if (!isMapPopupStillShowingVillage(tgtVillage)) return;
                const liveBody = document.getElementById('map_popup')?.querySelector('tbody');
                if (!liveBody) return;
                const color = morale >= 90 ? '#4caf50' : morale >= 70 ? '#ff9800' : morale >= 50 ? '#ff5722' : '#f44336';
                const moraleRow = document.createElement('tr');
                moraleRow.id = 'info_morale';
                const moraleTh = document.createElement('th');
                moraleTh.textContent = t('map.morale');
                const moraleTd = document.createElement('td');
                moraleTd.textContent = `${morale}%`;
                moraleTd.style.cssText = `color:${color};font-weight:bold`;
                moraleRow.append(moraleTh, moraleTd);
                liveBody.appendChild(moraleRow);
            };

            _moraleHoverIntentTimer = setTimeout(async () => {
                if (!isMapPopupStillShowingVillage(tgtVillage)) {
                    window.PremiumFeaturesDiagnostics?.record?.({
                        feature: 'morale', logicalResource: 'morale:' + ownerId,
                        status: 'SKIPPED', reason: 'hover-ended-before-start'
                    });
                    return;
                }
                try {
                    const morale = await getMoraleForOwner(ownerId, defName, defPoints);
                    if (morale != null) injectMoraleRow(morale);
                } catch (error) {
                    console.warn('[Morale] API call failed:', error);
                }
            }, MORALE_HOVER_INTENT_MS);
        }
    }

    const reports_list = window.TWPFMapReports
        ? await window.TWPFMapReports.hydrate()
        : [];

    if (isMapHoverInfoEnabled('lastAttack') && reports_list && !isOwnVillage) {
        for (let i = 0; i < reports_list.length; i++) {
            const report = reports_list[i];

            if (report.coords.includes(currentCoords)) {
                await hydrateReportForCurrentMapHover(report, tgtVillage, currentPopUpBody);
                break;
            }
        }
    }

    // --- Travel time: all units, compact grid (icons row + H:MM times row) ---
    document.getElementById('info_travel_time')?.remove();
    if (isMapHoverInfoEnabled('troopDistance') && typeof calculateDistanceToTarget === 'function' && game_data?.units) {
        if (_unitSpeedsCache === null) {
            _unitSpeedsCache = JSON.parse(localStorage.getItem('units_speed') || '{}');
        }
        const unitSpeeds = _unitSpeedsCache;
        const distance = calculateDistanceToTarget(currentCoords);
        const units = game_data.units.filter(u => unitSpeeds[u] > 0 && unitSpeeds[u] * distance >= 1);

        if (units.length > 0 && distance > 0) {
            const assetBase = _getNavAssetBase();
            const travelRow = document.createElement('tr');
            travelRow.id = 'info_travel_time';
            const travelTd = document.createElement('td');
            travelTd.colSpan = 2;
            travelTd.style.padding = '3px 0';

            const grid = document.createElement('div');
            grid.style.cssText = `display:grid;grid-template-columns:repeat(${units.length},1fr);gap:2px;text-align:center`;

            // Row 1: unit icons
            units.forEach(unit => {
                const img = document.createElement('img');
                img.src = `${assetBase}unit/unit_${unit}.webp`;
                img.title = getUnitDisplayName(unit);
                img.style.cssText = 'width:16px;height:16px;display:block;margin:0 auto';
                grid.appendChild(img);
            });

            // Row 2: H:MM travel times — hover each cell for full H:MM:SS
            units.forEach(unit => {
                const totalMins = unitSpeeds[unit] * distance;
                const h = Math.floor(totalMins / 60);
                const m = Math.floor(totalMins % 60);
                const span = document.createElement('span');
                span.textContent = `${h}:${String(m).padStart(2, '0')}`;
                span.title = typeof formatMinutesToTime === 'function' ? formatMinutesToTime(totalMins) : '';
                span.style.cssText = 'font-size:9px;display:block';
                grid.appendChild(span);
            });

            travelTd.appendChild(grid);
            travelRow.appendChild(travelTd);
            currentPopUpBody.appendChild(travelRow);
        }
    }

    document.getElementById('info_outgoing_commands_table')?.remove();
    if (isMapHoverInfoEnabled('lastAttack')) {
        insertOutgoingCommandsTable(currentCoords, currentPopUpBody);
    }
}

/**
 * Renders a mini "Own commands" table (icons + source + absolute arrival + countdown) for every
 * own outgoing command heading to the currently hovered village — replicates the premium map
 * popup's own commands list, replacing the old title-icon-only version.
 * @param {string} currentCoords
 * @param {HTMLElement} currentPopUpBody
 */
function insertOutgoingCommandsTable(currentCoords, currentPopUpBody) {
    if (_outgoingCommandsDetailedCache === null) {
        const raw = localStorage.getItem('outgoing_commands_detailed');
        if (raw) _outgoingCommandsDetailedCache = JSON.parse(raw);
    }
    const commands = (_outgoingCommandsDetailedCache || []).filter(cmd => cmd.targetCoords === currentCoords);
    if (!commands.length) return;

    const wrapperRow = document.createElement('tr');
    wrapperRow.id = 'info_outgoing_commands_table';
    const wrapperTd = document.createElement('td');
    wrapperTd.colSpan = 2;

    const table = document.createElement('table');
    table.className = 'vis';
    table.style.width = '100%';

    const headRow = document.createElement('tr');
    const headLabels = [
        t('map.ownCommandsIncoming', { count: commands.length }),
        t('map.arrival'),
        t('map.arrivesIn')
    ];
    headLabels.forEach(label => {
        const th = document.createElement('th');
        th.textContent = label;
        headRow.appendChild(th);
    });
    table.appendChild(headRow);

    commands.forEach(cmd => {
        const row = document.createElement('tr');

        const iconsTd = document.createElement('td');
        (cmd.icons || []).forEach(icon => {
            const img = document.createElement('img');
            img.src = _getNavAssetBase() + 'command/' + icon + '.png';
            img.alt = '';
            iconsTd.appendChild(img);
        });
        iconsTd.appendChild(document.createTextNode(' ' + cmd.sourceLabel));

        const arrivalTd = document.createElement('td');
        arrivalTd.textContent = cmd.arrivalText || '';

        const countdownTd = document.createElement('td');
        const remaining = cmd.endtime && typeof endTimeToTimer === 'function' ? endTimeToTimer(cmd.endtime) : null;
        countdownTd.textContent = remaining ? remaining.join(':') : '';

        row.append(iconsTd, arrivalTd, countdownTd);
        table.appendChild(row);
    });

    wrapperTd.appendChild(table);
    wrapperRow.appendChild(wrapperTd);
    currentPopUpBody.appendChild(wrapperRow);
}

/**
 * Adjusts the TribalWars map size based on user input and persists settings.
 * Handles the teardown and re-initialization of the TWMap object.
 */
function setMapSize() {
    const mapWrap = document.getElementById('map_wrap');
    if (!mapWrap) return;

    // 1. Gather all necessary DOM elements once
    const elements = {
        map: document.getElementById('map'),
        container: document.getElementById('map_container'),
        boundary: document.getElementById('map_go_home_boundary'),
        coordY: document.getElementById('map_coord_y_wrap'),
        coordX: document.getElementById('map_coord_x_wrap'),
        heightInput: document.querySelector('#map_custom_height'),
        widthInput: document.querySelector('#map_custom_width')
    };

    // 2. Handle Configuration Persistence
    const storedConfig = JSON.parse(localStorage.getItem('mapConfig')) || {};

    // Save original dimensions only if they don't exist yet
    if (!storedConfig.originalWidth) {
        const firstImg = elements.map.querySelector('img');
        Object.assign(storedConfig, {
            originalWidth: elements.map.style.width || 'auto',
            originalHeight: elements.map.style.height || 'auto',
            originalMapImgWidth: firstImg?.style.width || 'auto',
            originalMapImgHeight: firstImg?.style.height || 'auto'
        });
        localStorage.setItem('mapConfig', JSON.stringify(storedConfig));
    }

    // 3. Update Custom Dimensions in Storage
    const newHeight = elements.heightInput?.value || localStorage.getItem('map_custom_height');
    const newWidth = elements.widthInput?.value || localStorage.getItem('map_custom_width');

    localStorage.setItem('map_custom_height', newHeight);
    localStorage.setItem('map_custom_width', newWidth);

    const mapHeightPx = `${newHeight}px`;
    const mapWidthPx = `${newWidth}px`;

    // 4. Apply Styles efficiently
    const resizeTargets = [mapWrap, elements.map, elements.coordX];
    resizeTargets.forEach(el => { if (el) el.style.width = mapWidthPx; });

    [mapWrap, elements.map, elements.coordY].forEach(el => { if (el) el.style.height = mapHeightPx; });

    // Reset image scaling to prevent distortion on larger maps
    elements.map.querySelectorAll('img').forEach(img => {
        Object.assign(img.style, { width: 'auto', height: 'auto' });
    });

    // 5. Re-initialize Game Map
    // We remove elements that TWMap.init() will recreate
    elements.container?.remove();
    elements.boundary?.remove();

    // TWMap.init() creates a fresh FreeMap + mover + click-to-jump handler for #map/#minimap
    // but never removes the previous ones — jQuery's .click() stacks handlers, so the stale
    // one (whose own mover never saw this drag, so its moveDirty guard wrongly passes) still
    // fires TWMap.focus() with stale coords on minimap-drag-release, causing a coord "snap".
    // Strip the leftovers so init() re-creates exactly one of each.
    document.getElementById('map_mover')?.remove();
    document.getElementById('minimap_mover')?.remove();
    $('#map, #minimap').off('click');

    // Set internal game map size (grid blocks) and restart engine
    TWMap.size = [15, 15]; // Expanded grid for larger custom maps
    TWMap.init();
    // TWMap.init() doesn't recompute minimap_offset for the new #map size on its own —
    // without this, minimap drag miscalculates its target and snaps to the wrong coord.
    if (typeof TWMap.scaleMinimap === 'function') {
        TWMap.scaleMinimap();
    }

    // 6. Focus Update
    // Using a short timeout to ensure the DOM has settled after TWMap.init()
    setTimeout(() => {
        if (typeof TWMap.focusSubmit === 'function') {
            TWMap.focusSubmit();
        }
    }, 100);
}

/**
 * Injects UI controls for the Large Map feature into the game's map configuration table.
 */
function createBigMapOption() {
    const mapConfig = document.getElementById('map_config');
    const mapSearch = document.getElementById('map_search');
    if (!mapConfig || !mapSearch) return;

    // Helper to create the checkbox row
    const createCheckboxRow = () => {
        const tr = document.createElement('tr');

        const tdCheckbox = document.createElement('td');
        const input = Object.assign(document.createElement('input'), {
            type: 'checkbox',
            id: 'show_biggermap',
            checked: settings_cookies.general['show__big_map']
        });

        input.onclick = () => {
            const isEnabled = !settings_cookies.general['show__big_map'];
            settings_cookies.general['show__big_map'] = isEnabled;
            safeLocalStorageSet('settings_cookies', JSON.stringify(settings_cookies));

            isEnabled ? setMapSize() : location.reload();
        };

        const tdLabel = Object.assign(document.createElement('td'), { colSpan: 2 });

        const label = Object.assign(document.createElement('label'), {
            textContent: ' ' + t('map.showLargeMap'),
            htmlFor: 'show_biggermap'
        });

        tdCheckbox.appendChild(input);
        tdLabel.appendChild(label);
        tr.append(tdCheckbox, tdLabel);
        return tr;
    };

    // Helper to create the input row with debouncing
    const createSizeRow = () => {
        const tr = document.createElement('tr');

        // Internal helper for numeric inputs
        const createInput = (id, labelText) => {
            const td = Object.assign(document.createElement('td'), { className: 'nowrap' });
            const label = document.createTextNode(labelText);
            const input = Object.assign(document.createElement('input'), {
                type: 'number',
                id: id,
                value: localStorage.getItem(id) || 600,
                step: 100
            });
            input.style.width = '60px';

            // Debounce logic: prevents setMapSize from firing on every keypress
            let timeout;
            input.oninput = () => {
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    if (settings_cookies.general['show__big_map']) setMapSize();
                }, 400);
            };

            td.append(label, input);
            return td;
        };

        tr.append(
            createInput('map_custom_height', t('map.height') + ': '),
            createInput('map_custom_width', ' ' + t('map.width') + ': ')
        );
        return tr;
    };

    const mapOptionsTable = document.createElement('table');
    mapOptionsTable.className = 'vis';
    mapOptionsTable.style.cssText = 'border-spacing:0px;border-collapse:collapse;';
    mapOptionsTable.width = '100%';

    const tbody = document.createElement('tbody');
    const headerRow = document.createElement('tr');
    const headerCell = document.createElement('th');
    headerCell.colSpan = 3;
    headerCell.textContent = t('map.options');
    headerRow.appendChild(headerCell);
    tbody.appendChild(headerRow);

    // Injection
    const rowToggle = createCheckboxRow();
    const rowInputs = createSizeRow();

    tbody.append(rowToggle, rowInputs);
    mapOptionsTable.appendChild(tbody);
    mapConfig.insertBefore(mapOptionsTable, mapSearch);
}

// In-memory set of coords attacked via the farm assistant this session.
// Intentionally not persisted — icons are temporary and reset on page refresh.
const _farmAttackCoordsSet = new Set();

// In-memory caches for localStorage data read on every map drag.
// Avoids repeated JSON.parse(localStorage.getItem(...)) on each onMovePixel call.
// Updated whenever the underlying data is written.
let _outgoingCommandsCache = null;

// Per-command detail (endtime/arrival/source) backing the map popup's "Own commands" table —
// parallel to _outgoingCommandsCache, which stays aggregated for the map icon overlay.
let _outgoingCommandsDetailedCache = null;

// Persisted TTL prevents a full/partial reload from manufacturing a refresh reason.
let _outgoingCommandsLastFetch = Number(localStorage.getItem('outgoing_commands_fetched_at')) || 0;

// Batches icon refreshes so several sectors spawning during one drag gesture trigger a
// single rebuild instead of one per sector.
let _mapIconsRefreshScheduled = false;
function scheduleMapIconsRefresh() {
    if (_mapIconsRefreshScheduled) return;
    _mapIconsRefreshScheduled = true;
    setTimeout(() => {
        _mapIconsRefreshScheduled = false;
        if (settings_cookies.general['show__outgoingInfo_map']) addOutgoingIcons();
        addFarmAttackIcons();
        addReservationIcons();
    }, 0);
}

// Cache for unit speed data — set once at startup, safe to hold in memory.
let _unitSpeedsCache = null;

const MORALE_CACHE_TTL_MS = 10 * 60 * 1000;
const MORALE_BACKOFF_MS = [30000, 60000, 120000, 300000, 600000];
const MORALE_HOVER_INTENT_MS = 250;
let _moraleHoverIntentTimer = null;
let _moraleCacheEntries = [];
try { _moraleCacheEntries = JSON.parse(localStorage.getItem('twpf_morale_cache_v1') || '[]'); } catch (_error) { /* empty */ }
const _moraleCache = new Map(Array.isArray(_moraleCacheEntries) ? _moraleCacheEntries : []);

function persistMoraleCache() {
    const serialized = JSON.stringify(Array.from(_moraleCache.entries()).slice(-100));
    if (window.PremiumFeaturesWriteBehind?.set) {
        window.PremiumFeaturesWriteBehind.set('twpf_morale_cache_v1', serialized);
    } else {
        localStorage.setItem('twpf_morale_cache_v1', serialized);
    }
}

async function getMoraleForOwner(ownerId, defenderName, defenderPoints) {
    const logicalKey = 'morale:' + String(ownerId);
    const cached = _moraleCache.get(String(ownerId));
    if (cached && Number(cached.failedUntil || 0) > Date.now()) {
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: 'morale', logicalResource: logicalKey, status: 'SOFT_PAUSE', reason: 'morale-backoff'
        });
        return cached.value ?? null;
    }
    if (cached && Date.now() - Number(cached.fetchedAt || 0) < MORALE_CACHE_TTL_MS) {
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: 'morale', logicalResource: logicalKey, status: 'CACHE_HIT', reason: 'morale-ttl'
        });
        return cached.value;
    }
    const load = async function () {
        const body = new URLSearchParams({
            attacker_points: game_data.player.points,
            defender_name: defenderName || '',
            defender_points: defenderName ? '' : defenderPoints,
            days_played: 0,
            perspective: 'attacker',
            h: game_data.csrf
        });
        const url = `${game_data.link_base_pure}place&ajax=calculate_morale&type=morale`;
        const run = () => fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: body.toString()
        });
        const response = await (window.PremiumFeaturesDiagnostics?.request
            ? window.PremiumFeaturesDiagnostics.request({
                feature: 'morale', logicalResource: logicalKey, method: 'POST', reason: 'hover-intent'
            }, run)
            : run());
        if (!response.ok) {
            const responseError = new Error(`HTTP ${response.status}`);
            responseError.status = response.status;
            responseError.url = response.url || url;
            throw responseError;
        }
        const morale = (await response.json())?.morale;
        if (morale == null) return null;
        _moraleCache.set(String(ownerId), { value: morale, fetchedAt: Date.now() });
        persistMoraleCache();
        return morale;
    };
    const scheduledLoad = function () {
        const scheduler = window.PremiumFeaturesBackgroundScheduler;
        if (!scheduler?.enqueue) return load();
        return scheduler.enqueue({
            key: 'manual:' + logicalKey,
            priority: scheduler.PRIORITY?.MANUAL || 1,
            dueMode: scheduler.DUE_MODE?.EARLIEST || 'EARLIEST',
            run: load
        }).then(result => {
            if (result?.status !== 'COMPLETED') throw result?.error || new Error('Morale task did not complete');
            return result.value;
        });
    };
    const loadWithSoftPause = function () {
        return scheduledLoad().catch(error => {
            const failure = window.PremiumFeaturesAsync?.classifyRequestFailure?.(error, {
                url: error?.url || `${game_data.link_base_pure}place&ajax=calculate_morale&type=morale`
            }) || {};
            if (failure.transient) {
                const latest = _moraleCache.get(String(ownerId)) || {};
                const failureCount = Number(latest.failureCount || 0) + 1;
                _moraleCache.set(String(ownerId), {
                    value: latest.value ?? null,
                    fetchedAt: Number(latest.fetchedAt) || 0,
                    failureCount,
                    failedUntil: Date.now() + MORALE_BACKOFF_MS[Math.min(failureCount - 1, MORALE_BACKOFF_MS.length - 1)]
                });
                persistMoraleCache();
                window.PremiumFeaturesDiagnostics?.record?.({
                    feature: 'morale', logicalResource: logicalKey, status: 'SOFT_PAUSE', reason: 'morale-request-failed'
                });
            }
            throw error;
        });
    };
    return window.PremiumFeaturesSingleFlight?.run
        ? window.PremiumFeaturesSingleFlight.run(logicalKey, loadWithSoftPause)
        : loadWithSoftPause();
}

// Map-based LRU cache for village ID lookups (max 10 entries)
const _villageCache = new Map();
const _VILLAGE_CACHE_MAX = 150;

// Maps TribalWars unit codes to their translated display names, reusing the
// navIcon.* keys already defined for navigationBar.js's icon picker.
const UNIT_NAME_KEYS = {
    spear: 'navIcon.spear', sword: 'navIcon.sword', axe: 'navIcon.axe', archer: 'navIcon.archer',
    spy: 'navIcon.scout', light: 'navIcon.lightCavalry', marcher: 'navIcon.mountedArcher',
    heavy: 'navIcon.heavyCavalry', ram: 'navIcon.ram', catapult: 'navIcon.catapult',
    knight: 'navIcon.paladin', snob: 'navIcon.noble', militia: 'navIcon.militia'
};
function getUnitDisplayName(unit) {
    return UNIT_NAME_KEYS[unit] ? t(UNIT_NAME_KEYS[unit]) : unit;
}

/**
 * Retrieves a village ID based on "X|Y" coordinates from the cached map data.
 * @param {string} coords - Format: "500|500"
 * @returns {string|null} The village ID or null if not found.
 */
function getVillageIDByCoord(coords) {
    if (!coords) return null;

    // 1. Check cache (LRU: re-insert on hit to mark as most recently used)
    if (_villageCache.has(coords)) {
        const id = _villageCache.get(coords);
        _villageCache.delete(coords);
        _villageCache.set(coords, id);
        return id;
    }

    const rawData = mapDataGetRaw('map_villages');
    if (!rawData) {
        console.error("[Map Data] map_villages not found in cache.");
        return null;
    }

    // 2. Prepare the coordinate for matching: "457|370" -> "457,370"
    const [x, y] = coords.split('|');
    if (!x || !y) return null;
    const formattedCoord = `${x},${y}`;

    /**
     * Regex Optimization: 
     * [^,]+ matches village name characters (non-commas) faster than .*?
     * ^(\d+) captures ID at start of line
     */
    const regex = new RegExp(`^(\\d+),[^,]+,${formattedCoord},`, 'm');
    const match = rawData.match(regex);

    if (match && match[1]) {
        const villageId = match[1];

        // LRU eviction: remove oldest entry if at capacity
        if (_villageCache.size >= _VILLAGE_CACHE_MAX) {
            _villageCache.delete(_villageCache.keys().next().value);
        }
        _villageCache.set(coords, villageId);
        return villageId;
    }

    console.warn(`[Map Data] Village not found: ${coords}`);
    updateMapInfoVillages();
    return null;
}

let lastFocusId = -1;
let _farmContextRenderToken = 0;
const _farmContextButtons = new Map();
let _farmContextSyncFrame = null;
let _farmContextObserver = null;

const FARM_CONTEXT_SLOT_OFFSETS = [
    { left: -64, top: 0 },
    { left: 64, top: 0 },
    { left: 0, top: -32 },
    { left: 0, top: 32 },
    { left: -64, top: 32 },
    { left: 64, top: 32 }
];

function getFarmContextButtonPosition(index, fallbackElement) {
    const offset = FARM_CONTEXT_SLOT_OFFSETS[index];
    const left = parseFloat(fallbackElement?.style.left);
    const top = parseFloat(fallbackElement?.style.top);
    if (!offset || !Number.isFinite(left) || !Number.isFinite(top)) return null;

    // mp_info is the stable centre anchor. Never derive positions from the
    // native button grid: that grid is rebuilt asynchronously during a jump.
    const centerX = left + (fallbackElement.offsetWidth || 32) / 2;
    const centerY = top + (fallbackElement.offsetHeight || 32) / 2;
    return {
        left: centerX - 12 + offset.left,
        top: centerY - 12 + offset.top
    };
}

function syncFarmContextButtons() {
    _farmContextSyncFrame = null;
    const referenceElement = document.getElementById('mp_info');
    const referenceStyle = referenceElement ? window.getComputedStyle(referenceElement) : null;
    const isHidden = !referenceStyle || referenceStyle.display === 'none' || referenceStyle.opacity === '0';

    _farmContextButtons.forEach((buttonData, button) => {
        if (!button.isConnected) {
            _farmContextButtons.delete(button);
            return;
        }

        if (isHidden) {
            button.style.display = referenceStyle?.display || 'none';
            button.style.visibility = referenceStyle?.visibility || 'hidden';
            button.style.opacity = referenceStyle?.opacity || '0';
            button.style.pointerEvents = 'none';
            return;
        }

        button.style.display = referenceStyle.display;
        button.style.visibility = referenceStyle.visibility;
        button.style.opacity = referenceStyle.opacity;
        button.style.pointerEvents = 'auto';

        const position = getFarmContextButtonPosition(buttonData.index, referenceElement);
        if (!position) return;
        button.style.left = `${position.left}px`;
        button.style.top = `${position.top}px`;
    });
}

function scheduleFarmContextSync() {
    if (_farmContextSyncFrame !== null) return;
    _farmContextSyncFrame = requestAnimationFrame(syncFarmContextButtons);
}

function registerFarmContextButton(button, index, isBarbarian) {
    _farmContextButtons.set(button, { index, isBarbarian });
    scheduleFarmContextSync();
}

function clearFarmContextButtons() {
    _farmContextButtons.forEach((_buttonData, button) => button.remove());
    _farmContextButtons.clear();
    if (_farmContextSyncFrame !== null) {
        cancelAnimationFrame(_farmContextSyncFrame);
        _farmContextSyncFrame = null;
    }
}

function startFarmContextSync() {
    if (_farmContextObserver || typeof MutationObserver === 'undefined') return;
    _farmContextObserver = new MutationObserver((mutations) => {
        if (mutations.some(mutation => !mutation.target.closest?.('.fake-farm-assistant-button'))) {
            scheduleFarmContextSync();
        }
    });
    _farmContextObserver.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden']
    });
}

function shouldShowFarmContextButtons(village) {
    const ownerId = village?.owner;
    if (ownerId === undefined || ownerId === null || String(ownerId) === '0') return true;
    if (String(ownerId) === String(game_data?.player?.id)) return false;

    const ownAllyId = game_data?.player?.ally?.id
        ?? game_data?.player?.ally_id
        ?? game_data?.player?.ally;
    if (!ownAllyId) return true;

    const player = TWMap.players?.[ownerId] || getCachedPlayerById(ownerId);
    const villageAllyId = village.ally_id
        ?? village.allyId
        ?? player?.ally_id
        ?? player?.allyId;
    return !villageAllyId || String(villageAllyId) !== String(ownAllyId);
}

/**
 * Monitors the map's context menu focus.
 * When a village is selected, it updates the target data and troop templates.
 * Uses event-driven overrides on TWMap.context.spawn/hide instead of setInterval polling.
 */
function startMapContextWatcher() {
    if (!isMapContextButtonEnabled('attackButtons')) return;
    startFarmContextSync();
    const _origSpawn = TWMap.context.spawn.bind(TWMap.context);
    TWMap.context.spawn = function(village, x, y) {
        // Hide our buttons before the game repositions mp_att — prevents them from
        // visibly jumping from the previous village's position to the new one.
        clearFarmContextButtons();
        _origSpawn(village, x, y);
        const newFocus = 1000 * x + y;
        if (newFocus !== lastFocusId) {
            lastFocusId = newFocus;
            const renderToken = ++_farmContextRenderToken;
            if (!shouldShowFarmContextButtons(village)) return;
            const focusCoords = `${x}|${y}`;
            GM_setValue('target_village', village.id);
            GM_setValue('target_distance', calculateDistanceToTarget(focusCoords));
            initializeTroopTemplates(village.id, parseInt(village.owner, 10) === 0, renderToken);
        }
    };

    const _origHide = TWMap.context.hide.bind(TWMap.context);
    TWMap.context.hide = function() {
        _origHide();
        ++_farmContextRenderToken;
        clearFarmContextButtons();
        lastFocusId = -1;
    };
}

const FARM_ASSISTANT_MAP_SLOT_DESCRIPTORS = [
    { key: 'a', index: 0, buttonIndex: 2, translationKey: 'farmAssistant.templateA' },
    { key: 'b', index: 1, buttonIndex: 3, translationKey: 'farmAssistant.templateB' },
    { key: 'c', index: 2, buttonIndex: 4, translationKey: 'farmAssistant.templateC' }
];

/**
 * Initializes the three Farm Assistant quick attack buttons for a target village.
 * @param {string|number} targetID - The ID of the target village.
 */
function initializeTroopTemplates(targetID, isBarbarian = false, renderToken = _farmContextRenderToken) {
    if (!targetID) return;

    if (renderToken !== _farmContextRenderToken) return;
    clearFarmContextButtons();

    const slots = typeof getFarmAssistantMapSlots === 'function'
        ? getFarmAssistantMapSlots()
        : [null, null];

    slots.forEach((slot, index) => {
        if (!slot) return;
        if (index === 2 && typeof getFarmAssistantTemplateCMode === 'function'
            && getFarmAssistantTemplateCMode() === 'auto') return;
        const descriptor = FARM_ASSISTANT_MAP_SLOT_DESCRIPTORS[index];
        if (!descriptor) return;
        const template = {
            id: 'farm_assistant_' + descriptor.key,
            player_id: String(game_data?.player?.id || 'farm_assistant'),
            name: slot.name || t(descriptor.translationKey),
            units: slot.units || {}
        };

        (game_data.units || []).forEach(unit => {
            template[unit] = String(parseInt(slot.units?.[unit], 10) || 0);
        });
        addFakeFarmAssistantButton(template, descriptor.buttonIndex, isBarbarian, descriptor);
    });
}

if (typeof TWMap !== 'undefined') {
    const mapContainerForIntent = document.getElementById('map_container');
    if (mapContainerForIntent && window.PremiumFeaturesRuntimeRegistry?.addEventListener) {
        window.PremiumFeaturesRuntimeRegistry.addEventListener(
            'map:hover-intent-cancel',
            mapContainerForIntent,
            'mouseleave',
            function () {
                clearTimeout(_moraleHoverIntentTimer);
                clearTimeout(_ownVillageHoverIntentTimer);
            }
        );
    }
    // Hide native Farm Assistant context buttons if the feature is not active for this account
    if (!game_data.features?.FarmAssistent?.active) {
        const style = document.createElement('style');
        style.textContent = '#mp_farm_a, #mp_farm_b, .farmassistant-tooltip { display: none !important; }';
        document.head.appendChild(style);
    }

    //initiate target_village as 0
    GM_setValue("target_village", 0);
    getOutgoingCommandsFromOverview();
    createBigMapOption();
    // Check for new reports on every map page entry, independently of map display settings.
    syncMapReportsOnLoad();
    if (isMapHoverInfoEnabled()) {
        var originalHandleMouseMove = TWMap.popup.handleMouseMove;
        TWMap.popup.handleMouseMove = function (e) {
            TWMap.popup.extraInfo = true;
            originalHandleMouseMove.call(this, e);
            var villageHoverCoords = TWMap.map.coordByEvent(e);
            const currentCoords = villageHoverCoords.join('|');
            var mapPopupElement = document.getElementById('map_popup');
            const currentPopUpBody = mapPopupElement.getElementsByTagName('tbody')[0];

            var tr = document.createElement('tr');
            tr.className = 'nowrap';
            tr.id = 'map_popup_extra';

            if (currentPopUpBody && !currentPopUpBody.querySelector('#map_popup_extra')) {
                currentPopUpBody.appendChild(tr);
                document.querySelectorAll("#info_last_attack, #info_outgoing_units, #info_travel_time, #info_morale, #info_reservation, #info_outgoing_commands_table, .info-own-village-row").forEach(el => el.remove());
                getReportInfoToMap(currentCoords, currentPopUpBody);
            }
        };
    }
    if (settings_cookies.general['show__big_map']) {
        setMapSize();
    }
    if (settings_cookies.general['show__outgoingInfo_map']
        || window.TWPFMapReports?.isEnabled()
        || typeof reservationsGetAll === 'function') {
        if (TWMap.mapHandler) {
            // Fires only when a sector actually spawns (far rarer than onMovePixel's per-pixel
            // drag events) — chains after any other spawnSector wrapper (e.g. MapSdk's own).
            var _previousSpawnSector = TWMap.mapHandler.spawnSector;
            TWMap.mapHandler.spawnSector = function (data, sector) {
                _previousSpawnSector.call(this, data, sector);
                scheduleMapIconsRefresh();
                if (window.TWPFMapReports?.isEnabled() && window.TWPFMapReports.needsInitialBuild?.()) {
                    window.TWPFMapReports.notifyUpdated();
                }
            }
        }
    }

    if (typeof reservationsGetAll === 'function') {
        mapReady().then(addReservationIcons);
    }

    if (isMapContextButtonEnabled('attackButtons')) {
        startMapContextWatcher();
    }
}


/**
 * Creates and injects a custom attack button into the map context menu for a given troop template.
 * @param {Object} template - A TroopTemplate object.
 * @param {number} index - Zero-based index; index 0 also clears buttons from the previous village.
 */
function addFakeFarmAssistantButton(template, index, isBarbarian = false, slotDescriptor = null) {
    const ctxButtons = document.getElementById("map-ctx-buttons");

    //remove previous buttons
    if (index === 0) {
        clearFarmContextButtons();
    }

    if (!ctxButtons) {
        console.warn("[MapCTX] #map-ctx-buttons not found.");
        return;
    }

    // create ctx button for map
    const newButton = document.createElement("a");
    newButton.className = "mp custom-map-ctx-button fake-farm-assistant-button";
    newButton.id = "mp_farm_f" + (index - 2);
    newButton.style.borderRadius = '5px';
    const isLoading = !template;
    if (isLoading) {
        newButton.style.backgroundImage = 'url(https://dsbr.innogamescdn.com/asset/f441272cc5/graphic/loading.gif)';
        newButton.style.cursor = 'wait';
        newButton.style.pointerEvents = 'none';
        newButton.setAttribute('aria-label', t('common.loading'));
    } else {
        newButton.setAttribute("data-tooltip-tpl", generateTemplateTooltipData(template));
    }

    const descriptor = slotDescriptor || FARM_ASSISTANT_MAP_SLOT_DESCRIPTORS[index - 2];
    if (descriptor?.key === 'a') {
        newButton.style.backgroundImage = 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAJcEhZcwAAGdYAABnWARjRyu0AAAAHdElNRQfqAQMDLBh8xVm7AAAFgUlEQVRIx3WWW29cVxXHf2ufc+YSj2cmzsWxUydpEmKTtFVSoSDRVCnl8sBDJITKE4+Iz8Gn4QXxgEClUkPaQAotkCKaRCo0jiXbcWzsiT32nDm3vdfi4Th2QGJt7X2W9sP6/9detyOP//l3G639kVbUo/lUsKVFLE0RQETACQCyfxggL5T6qEUc1ungzl1ArryGdHtgRhzU8dndv5J+tcabzVmORtCY7lLGEWUZcCY1kBzaExHMALF9MIPSEz3fIlpZJllaJHn3e0TTp4iLnRGDRyl3/vQlg0ueH3//MqNZx6hyRK/Os5PEIHJgX5CXsOobBKgq3OoGnftP6Dz4giTLmPjhe8Rbt29zYm2Vr/XaxCcq0vk+i/eXuZA0uDA1ZLkZ86SdMI7dgReCII7DZzKBWLBXj7PezDn9wZf0HzwgnDpN9KOJ1s/jfMS1d8/AZMnniyU3bv2UMx0h2lnnaJYzlabsZSOKnYzesKQ5HFPs7bEblZS+oKhy8iojK1P24sB2usWxxSHlzi5xsbEOrmLx6SrPBx7rdPjbw3/x7evfoJ8O8M/XaVQRX28eobFwlKmzbardER/eXWfU6OFih+0vVSX3OXvtMXN+TOvpKnFVlngrmHw65o1LF9HEuPfJB9xrtnj74rcot96nd6XN7KUGzd4YXAoMSUfbpHlMlMh+NAxvnqzKGBR77JY5jojYq+IxFk52mO4I0hTeqob84c6v+djf4ux0xMU31xHnsBAj5lA/4sRwl/A8YanXoIoAU7wG9oo9siKnLD0+CsSqCihRFON8ikscr3SFb2brfHTnt/z7vKPnVmlExsJbZxESNKRMphlXnm2zNE74c6/Bs6YQgifNh2ilBK8ElNiCYWid12WGOCESx/muMn72mN/c7/LLnde4cWmNBR2BNLEwJox2idrK5coxO4z4bDLm0wkl9wUuCOoDQQKxmYEppoZ6j5Q54oQYWOgHBtmAzze3Sa53MVsHK1HNCOMUyx1qjl4B303hbKK8P2EsBUFDQCMlNlPUDFQhgPhw0B6aMVyfCkTLf2H8sA3fOYZphWmOhgp8hUQOAGcwnwemdyruFRHeBzTW2oPMlE8mE1p9iBoRuLpaAbQfMXYwrxmEDFyEhILlxHjSd8SNwwJUg1AqxUBoh5p4bGpkAp9ONij6RpzEuMgh+/3M1GAcOONSjBwsAitYSeAf/RjXdAdpqkGoKmgVwk2MllntgVpdJEEVCSA4aoRDaqoBdIw5wTRgJlhQLBw2PFOFYKCgWsc1VjVUDA2GBqUSUAwn9SO50nCjCpIAoURUICiWOWSvQl1UgwKqNVFVV+sG7gV7DfU2VXwIVKr4PHDlwYj3Ol0uvT6Feo/6imTC8c61GX7wFDrLGZUaISjqw4FXqobVMVDMlKoIhFLryMaCmGGjwIl2yq2fGVErq9NYoNFUbv5kwMnbyke/d4SZBg6DYIRCCSWHACVA4fE7BWXb0VDDJYI50FLZWC/5+FcZEu9PMgA84rbZfCyU5SRWehSwSqlyI9nxSOnxCHHW7RIPd0iWM7bbTTTUqeciUK/cHTl+94uASB33l0dN4qD1OrjUgwmhUoo9pb+cExUVWa9LXM4vEK2sMLsy5lkD0tmYpO2IYsHMKOZa+JONfeNwoBh4AU2EeOjRYFSZ4dYqTq9keHFE8/PER65eY+3RI6ZXlzn3VcrSdpPx0QRp7M9iQMzx/yTfVgTFKqWxXXF+s+B4pTy/cJFzb1wlPj43x9qNt9m8/SFzgy0m1jIG6zmlE/TFn8WB1DlvL9+YIUDLjOPBmIqEzVMzHLv5DsdmZoi7k5PMXb7CF+mYjYcPaW1uMF0UBED/h+1/m5aXPkaMYEeabMzM0r96jVfm5+lMHOE/CMFU5I0vyHoAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDEtMDNUMDM6NDQ6MTUrMDA6MDAaLZjXAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTAxLTAzVDAzOjQ0OjE1KzAwOjAwa3AgawAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wMS0wM1QwMzo0NDoyNCswMDowMBSdDeMAAAAASUVORK5CYII=)'
    } else {
        // Subsequent templates (index > 0) use a different icon
        newButton.style.backgroundImage = 'url(data:image/png;base64,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)'
    }

    newButton.classList.add('farm_icon', 'farm_icon_' + (descriptor?.key || 'a'));
    if (!isLoading) newButton.style.backgroundImage = '';

    newButton.onmouseover = function () {
        toggleTooltip(newButton, true)
    }

    newButton.onmouseleave = function () {
        toggleTooltip(newButton, false)
    }

    newButton.onclick = async function fetchData() {
        if (isLoading) return;
        const originalBackgroundImage = newButton.style.backgroundImage;
        // Capture focus synchronously at click time — lastFocusId can change
        // during the async launchAttack() if the user moves focus elsewhere.
        const focusAtClick = lastFocusId;
        try {
            newButton.style.backgroundImage = 'url(https://dsbr.innogamescdn.com/asset/f441272cc5/graphic/loading.gif)';

            // 1. Define the list of game units to extract from the template
            const unitTypes = game_data.units;

            // 2. Build the units object dynamically
            const unitsToLaunch = {};

            unitTypes.forEach(unit => {
                // Convert string value from template to integer
                const amount = parseInt(template[unit], 10);

                // Only add to the request if amount is greater than 0
                if (amount > 0) {
                    unitsToLaunch[unit] = amount;
                }
            });

            // 3. Get target from GM_getValue (Tampermonkey storage)
            const targetId = GM_getValue("target_village");

            if (!targetId) {
                throw new Error("Target village ID not found in storage.");
            }

            console.log(`Launching attack from template '${template.name}' on target ${targetId}`);

            const focusStr = focusAtClick > 0 ? focusAtClick.toString().padStart(6, '0') : '';
            const targetCoords = focusStr
                ? focusStr.substring(0, 3) + '|' + focusStr.substring(3, 6)
                : '';
            const baseline = targetCoords && typeof getQuickFarmAttackReportBaseline === 'function'
                ? getQuickFarmAttackReportBaseline(targetCoords)
                : {};

            // 4. Call the previously defined launch function
            const attackSucceeded = await launchAttack(unitsToLaunch, targetId);

            // 5. Only update map icons if the attack was actually sent.
            // Use focusAtClick (captured before the await) — not lastFocusId,
            // which may have changed while the request was in flight.
            if (attackSucceeded) {
                if (targetCoords) {
                    // Add a temporary barracks icon to show the attack was sent.
                    // This is replaced by real outgoing-command icons on next page load.
                    _farmAttackCoordsSet.add(targetCoords);
                    if (typeof addFarmAttackIcons === 'function') addFarmAttackIcons();
                }

                if (typeof recordQuickFarmAttack === 'function') {
                    recordQuickFarmAttack({
                        sourceVillageId: game_data.village.id,
                        targetVillageId: targetId,
                        targetCoords,
                        units: unitsToLaunch,
                        previousReportId: baseline.previousReportId,
                        previousReportAtMs: baseline.previousReportAtMs,
                        templateName: template.name,
                        templateSlot: descriptor?.key || 'a',
                        origin: 'map-context',
                        playerId: game_data.player?.id,
                        world: game_data.world
                    });
                }
            }

        } catch (error) {
            console.warn("Error sending attack:", error);
        } finally {
            newButton.style.backgroundImage = originalBackgroundImage;
        }
    };

    registerFarmContextButton(newButton, index, isBarbarian);

    /**
     * Builds the HTML tooltip content for a troop template button.
     * Shows unit icons, counts, total carry capacity, and travel time to the target.
     * @param {Object} template - A TroopTemplate object.
     * @returns {string} HTML string for use in data-tooltip-tpl.
     */
    function generateTemplateTooltipData(template) {
        let tooltipHtml = "";
        const units = game_data.units;

        // Load data from storage
        const unitSpeeds = JSON.parse(localStorage.getItem('units_speed') || '{}');
        const unitCarry = JSON.parse(localStorage.getItem('units_carry') || '{}');

        let slowestUnitSpeed = 0;
        let totalCarry = 0;
        let hasVariableCarry = false; // To track if 'use_all' is used

        units.forEach(unit => {
            const value = parseInt(template[unit], 10) || 0;
            const isUseAll = template.use_all && template.use_all.includes(unit);

            if (value > 0 || isUseAll) {
                const iconUrl = `${_getNavAssetBase()}unit/unit_${unit}.webp`;
                const displayValue = isUseAll ? t('common.all') : value;

                tooltipHtml += `<img src="${iconUrl}" alt="${getUnitDisplayName(unit)}" /> ${displayValue}<br />`;

                // Track slowest unit
                if (unitSpeeds[unit] && unitSpeeds[unit] > slowestUnitSpeed) {
                    slowestUnitSpeed = unitSpeeds[unit];
                }

                // Calculate Carry
                if (unitCarry[unit]) {
                    if (isUseAll) {
                        hasVariableCarry = true;
                    } else {
                        totalCarry += value * unitCarry[unit];
                    }
                }
            }
        });

        // ---- Carry Capacity Display ----
        const carryDisplay = hasVariableCarry ? `${totalCarry}+` : totalCarry;
        tooltipHtml += `
            <img src="${_getNavAssetBase()}res.png" title="${t('common.resources')}" />
            ${carryDisplay}<br />
        `;

        // ---- Distance time calculation ----
        let distanceTimeText = "--:--:--";
        const targetDist = GM_getValue("target_distance");

        if (slowestUnitSpeed > 0 && targetDist) {
            const totalMinutes = slowestUnitSpeed * targetDist;
            distanceTimeText = formatMinutesToTime(totalMinutes);
        }

        tooltipHtml += `
            <span style="line-height: 20px;">
                ${distanceTimeText}
            </span>
        `;

        return tooltipHtml;
    }

    // Append the new CTX button to the map context menu
    ctxButtons.appendChild(newButton);
}
