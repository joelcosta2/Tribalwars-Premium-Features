
// Build Extra List

/**
 * Returns a unique timeout identifier for the building queue of the given (or current) village.
 * @param {string|number} [villageId] - Village id. Defaults to the currently loaded village.
 * @returns {string}
 */
function getBuildQueueTimeoutId(villageId) {
    const vId = villageId || game_data?.village?.id;
    return 'building_queue_' + (vId || '');
}

/**
 * Returns the maximum number of simultaneous active build queue slots.
 * Premium accounts support up to 15; free accounts support 2.
 * Premium status is account-wide, so this is valid for any village.
 * @returns {number}
 */
function getMaxBuildQueueSize() {
    return game_data?.features?.Premium?.active ? 5 : 2;
}

/**
 * Builds the game.php base URL (ending right before the screen name) for an arbitrary village,
 * derived from the current game_data.link_base_pure by swapping the village id. This lets the
 * script perform requests (fetch main page, upgrade a building, etc.) for any village belonging
 * to the account, regardless of which village is currently loaded/displayed in the browser tab.
 * The session CSRF token (game_data.csrf / window.csrf_token) is account-wide, not village-scoped,
 * so it remains valid for these cross-village requests.
 * @param {string|number} [villageId] - Target village id. Defaults to the currently loaded village.
 * @returns {string}
 */
function getVillageLinkBase(villageId) {
    const currentId = game_data?.village?.id;
    if (!villageId || villageId == currentId) return game_data.link_base_pure;
    return game_data.link_base_pure.replace(/village=\d+/, 'village=' + villageId);
}

/**
 * Returns the ids of every village known for this account, parsed from villages_info.
 * @returns {string[]}
 */
function getAllVillageIds() {
    const villages = JSON.parse(localStorage.getItem('villages_info') || '[]');
    return villages
        .map(v => (v.url.match(/village=(\d+)/) || [])[1])
        .filter(Boolean);
}

/**
 * Returns the display name for a village id, looked up from villages_info.
 * Falls back to the raw id if the name isn't known.
 * @param {string|number} villageId
 * @returns {string}
 */
function getVillageName(villageId) {
    const villages = JSON.parse(localStorage.getItem('villages_info') || '[]');
    const match = villages.find(v => (v.url.match(/village=(\d+)/) || [])[1] == villageId);
    return match?.name || String(villageId);
}

// Per-village "is the real build queue full?" flags. Replaces the old single global boolean,
// which caused villages to read/overwrite each other's full/not-full state.
var isBuildQueueFullByVillage = {};

/**
 * Returns whether the real (server-side) build queue is currently full for the given village.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 * @returns {boolean}
 */
function isVillageQueueFull(villageId) {
    const vId = villageId || game_data?.village?.id;
    return !!isBuildQueueFullByVillage[vId];
}

/**
 * Sets the "build queue full" flag for the given village.
 * @param {string|number} villageId
 * @param {boolean} value
 */
function setVillageQueueFull(villageId, value) {
    const vId = villageId || game_data?.village?.id;
    isBuildQueueFullByVillage[vId] = value;
}

// Prevents concurrent triggers (restored timeout, early-resource check, timers, polling) from
// racing each other and sending duplicate upgrade requests for the same village's queue head.
var buildQueueRequestInFlightByVillage = {};

function getBuildingMaxLevel(buildId) {
    try {
        const levels = JSON.parse(localStorage.getItem('buildings_data') || '{}')[buildId];
        const numericLevels = Object.keys(levels || {})
            .map(level => parseInt(level, 10))
            .filter(level => !isNaN(level));
        return numericLevels.length ? Math.max(...numericLevels) : null;
    } catch (error) {
        return null;
    }
}

function getNextBuildLevel(buildId, villageId, includeNewEntry = true) {
    const vId = villageId || game_data?.village?.id;
    const levelInfo = bqGet('nextLevelBuildsQueueInfo', vId) || {};
    const activeQueue = bqGet('building_queue_active', vId) || [];
    const waitingQueue = bqGet('building_queue', vId) || [];
    const currentLevel = Number(levelInfo[buildId]?.currentLevel) || 0;
    const activeCount = activeQueue.filter(id => id.replace(/\d+/g, '') === buildId).length;
    const waitingCount = waitingQueue.filter(id => id === buildId).length;
    return currentLevel + activeCount + waitingCount + (includeNewEntry ? 1 : 0);
}

function isBuildLevelAtMaximum(buildId, targetLevel) {
    const maxLevel = getBuildingMaxLevel(buildId);
    return maxLevel !== null && Number(targetLevel) > maxLevel;
}

function showBuildMaximumMessage(villageId, buildId) {
    showAutoHideBox('[' + getVillageName(villageId) + '] ' + t('buildQueue.maxLevelReached', { name: getBuildingDisplayName(buildId, document) }), false);
}

function setBuildQueueButtonLoading(button, isLoading) {
    if (!button) return;

    if (isLoading) {
        if (button.dataset.originalContent == null) {
            button.dataset.originalContent = button.innerHTML;
        }
        button.dataset.originalPointerEvents = button.style.pointerEvents;
        button.setAttribute('aria-busy', 'true');
        button.style.pointerEvents = 'none';
        button.innerHTML = '<img src="https://dsbr.innogamescdn.com/asset/f441272cc5/graphic/loading.gif" alt="" style="height:14px;vertical-align:middle;">';
        return;
    }

    button.removeAttribute('aria-busy');
    button.style.pointerEvents = button.dataset.originalPointerEvents || '';
    button.innerHTML = button.dataset.originalContent || '';
    delete button.dataset.originalContent;
    delete button.dataset.originalPointerEvents;
}

/**
 * Fetches a village's main-building page. Delegates to pageFetchManager.js's fetchMainPage,
 * which dedupes concurrent requests for the same village (shared with
 * utils/buildingsManager.js:fetchAndStoreVillageBuildingLevels).
 * @param {string|number} villageId
 * @returns {Promise<{doc: Document, html: string}>}
 */
function fetchVillageMainPage(villageId) {
    return fetchMainPage(villageId).catch(function () {
        throw new Error('Failed to fetch village ' + villageId + ' main page');
    });
}

/**
 * Reads wood/stone/iron/population amounts from a parsed HTML document (e.g. a fetched village
 * page). The pop labels are part of the game's shared header, present on every screen.
 * @param {Document} doc
 * @returns {{wood: number, stone: number, iron: number, pop: number, popMax: number}|null}
 */
function readResourcesFromDoc(doc) {
    return readVillageResourceSnapshot(doc);
}

/**
 * Checks whether the given resource snapshot covers a build's full cost, including free
 * population (farm space) — not just wood/stone/iron. Population is only enforced when known.
 * @param {{wood:number, stone:number, iron:number, pop?:number, popMax?:number}|null} resources
 * @param {{wood:number, stone:number, iron:number, pop?:number}|null} buildInfo
 * @returns {boolean}
 */
function hasEnoughForBuild(resources, buildInfo) {
    if (!resources || !buildInfo) return false;
    if (resources.wood < buildInfo.wood || resources.stone < buildInfo.stone || resources.iron < buildInfo.iron) return false;
    if (buildInfo.pop && typeof resources.pop === 'number' && typeof resources.popMax === 'number') {
        return (resources.popMax - resources.pop) >= buildInfo.pop;
    }
    return true;
}

/**
 * Reads wood/stone/iron amounts directly from the live DOM. Only valid for the currently
 * displayed village — returns null for any other village id.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 * @returns {{wood: number, stone: number, iron: number, pop: number, popMax: number}|null}
 */
function readCurrentVillageDomResources(villageId) {
    const vId = villageId || game_data?.village?.id;
    if (vId != game_data?.village?.id) return null;
    return readVillageResourceSnapshot(document);
}

// Static id -> navIcon i18n key fallback for building names. .visual-label-X (see
// getBuildingDisplayName) only exists in the live DOM of screen=overview — never on screen=main,
// whether live or fetched/parsed, which is what the build-queue list is actually rendered from.
const BUILDING_NAME_KEYS = {
    main: 'mainBuilding', barracks: 'barracks', stable: 'stable', garage: 'workshop',
    church: 'church', church_f: 'church', watchtower: 'watchtower', snob: 'academy',
    smith: 'smithy', place: 'rallyPoint', statue: 'statue', market: 'market',
    wood: 'wood', stone: 'clayPit', iron: 'ironMine', farm: 'farm',
    storage: 'warehouse', hide: 'hidingPlace', wall: 'wall'
};

/**
 * Resolves a building's localized display name: prefers the live overview screen's visual-label
 * tooltip (richest, matches the game's own exact wording) and falls back to this script's own
 * navIcon.* translations, then the raw id, so names still resolve when doc has no such element
 * (any fetched/parsed snapshot, e.g. screen=main, used by the overview_villages build-queue popup).
 * @param {string} buildId
 * @param {Document} doc
 * @returns {string}
 */
function getBuildingDisplayName(buildId, doc) {
    return doc.querySelector('.visual-label-' + buildId)?.getAttribute('data-title')
        || (BUILDING_NAME_KEYS[buildId] && t('navIcon.' + BUILDING_NAME_KEYS[buildId]))
        || buildId;
}

/**
 * Builds the active-queue header + full upgradeable-buildings list as a standalone DOM
 * fragment (not inserted anywhere) — shared by the sidebar widget (injectBuildQueue) and the
 * overview_villages build-queue overlay (openVillageBuildQueueOverlay in
 * overviewVillages.js), which renders it for a village that isn't the loaded page.
 * @param {string[]} availableBuildingsImgs - Image URLs of buildings that can currently be upgraded.
 * @param {string[]} buildingImgs - Image URLs used to determine if a building can be queued.
 * @param {number[]} availableBuildingLevels - Current level of each building in availableBuildingsImgs.
 * @param {HTMLElement} buildQueueElment - Pre-built TD element containing the active/fake queue icons.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 * @param {Document} [doc=document] - Where building name labels are read from (the village's own
 * fetched /main page for another village, or the live page for the current one).
 * @param {{wood:number, stone:number, iron:number}} [resources] - Resource snapshot for cost
 * warnings; defaults to live DOM (only valid when villageId is the currently loaded village).
 * @param {Function} [onAction] - Called after an upgrade button is clicked (fire-and-forget —
 * the underlying AJAX call has no promise, so callers should re-render shortly after too).
 * @returns {HTMLElement} Container div with both tables.
 */
function buildBuildQueueContent(availableBuildingsImgs, buildingImgs, availableBuildingLevels, buildQueueElment, villageId, doc = document, resources, onAction) {
    const vId = villageId || game_data?.village?.id;

    //Create the extra build queue table
    var extraBuildQueueTable = document.createElement('table');
    extraBuildQueueTable.id = 'build_queue_table_' + vId;
    extraBuildQueueTable.className = 'vis bordered-table';
    extraBuildQueueTable.setAttribute('width', '100%');
    extraBuildQueueTable.style.verticalAlign = 'middle';

    var tbody = document.createElement('tbody');
    var tr = document.createElement('tr');
    tr.appendChild(buildQueueElment);
    tbody.appendChild(tr);
    extraBuildQueueTable.appendChild(tbody);

    // Create the builds list table
    var buildsListTable = document.createElement('table');
    buildsListTable.className = 'vis bordered-table';
    buildsListTable.id = 'auto-construckt_' + vId;
    buildsListTable.style.verticalAlign = 'middle';
    buildsListTable.style.width = '100%';

    //Create the table with all available builds
    const buildingQueue = bqGet('building_queue', vId) || [];
    const buildingActiveQueue = bqGet('building_queue_active', vId) || [];
    availableBuildingsImgs.forEach(function (url, index) {
        var buildId = url.match(/([^/]+?)(?=\d+\.\w+$)/)[1];
        var buildLvel = url.match(/([^/]+?)(?=\.\w+$)/)[1];
        var row = document.createElement('tr');
        row.id = 'main_buildrow_' + index;

        // get next level
        let nextLevel = parseInt(availableBuildingLevels[index]) + 1;
        const queuedBuilding = buildingQueue.filter(id => id === buildId).length;
        const activeQueuedCount = buildingActiveQueue.filter(id => id.replace(/\d+/g, '') === buildId).length;
        nextLevel += queuedBuilding || 0;
        nextLevel += activeQueuedCount || 0;

        if (isBuildLevelAtMaximum(buildId, nextLevel)) return;

        const canAddToQueue = buildingImgs.includes(url);

        var cell = document.createElement('td');
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.padding = '0';

        var imgLink = document.createElement('a');
        imgLink.href = getVillageLinkBase(vId) + '' + buildId;
        var img = document.createElement('img');
        img.className = 'bmain_list_img';
        img.style.marginRight = '3px';
        img.src = url;
        img.loading = 'lazy';
        img.setAttribute('data-title', buildLvel);
        imgLink.appendChild(img);
        cell.appendChild(imgLink);

        var textLink = document.createElement('a');
        textLink.href = getVillageLinkBase(vId) + '' + buildId;
        textLink.textContent = getBuildingDisplayName(buildId, doc);
        cell.appendChild(textLink);

        var br = document.createElement('br');
        cell.appendChild(br);

        // Create the link for upgrading the building
        var upgradeLink = document.createElement('a');
        upgradeLink.className = canAddToQueue ? 'btn btn-build' : 'btn evt-cancel-btn btn-confirm-no';
        upgradeLink.setAttribute('data-building', (buildId + nextLevel));
        upgradeLink.setAttribute('data-level-next', nextLevel);

        upgradeLink.id = 'main_buildlink_' + buildId + '_' + nextLevel;
        upgradeLink.style.width = '-webkit-fill-available';
        upgradeLink.style.margin = '0';
        upgradeLink.style.setProperty('font-size', '11px', 'important');
        upgradeLink.style.padding = '1px 3px';
        upgradeLink.textContent = t('buildQueue.level', { level: nextLevel });
        upgradeLink.onclick = function () {
            if (upgradeLink.getAttribute('aria-busy') === 'true') return;
            setBuildQueueButtonLoading(upgradeLink, true);
            if (typeof toggleTooltip === 'function') toggleTooltip(upgradeLink, false);
            addToBuildQueue(buildId, vId, upgradeLink);
            if (onAction) onAction();
        }

        upgradeLink.addEventListener('mouseenter', function (event) {
            toggleTooltip(event.target, true);
        });
        upgradeLink.addEventListener('mouseleave', function (event) {
            toggleTooltip(event.target, false);
        });

        var upgradeCell = document.createElement('td');
        const dataTitle = canAddToQueue ?
            t('buildQueue.addToQueue') :
            t('buildQueue.addToWaitingQueue');
        const dataText = createResourceElementsString(buildId, nextLevel, vId, resources);
        upgradeCell.setAttribute('data-title', dataTitle);
        upgradeCell.setAttribute('data-tooltip-tpl', dataText);
        upgradeCell.appendChild(upgradeLink);

        row.appendChild(cell);
        row.appendChild(upgradeCell);
        buildsListTable.appendChild(row);
    });
    var extraBuildDiv = document.createElement('div');

    extraBuildDiv.appendChild(extraBuildQueueTable);
    extraBuildDiv.appendChild(buildsListTable);

    return extraBuildDiv;
}

/**
 * Renders the extra building queue widget into the sidebar: thin wrapper around
 * buildBuildQueueContent() for the currently loaded village.
 * @param {string[]} availableBuildingsImgs - Image URLs of buildings that can currently be upgraded.
 * @param {string[]} buildingImgs - Image URLs used to determine if a building can be queued.
 * @param {number[]} availableBuildingLevels - Current level of each building in availableBuildingsImgs.
 * @param {HTMLElement} buildQueueElment - Pre-built TD element containing the active/fake queue icons.
 * @param {boolean} [update=false] - If true, replaces an existing widget instead of inserting a new one.
 */
function injectBuildQueue(availableBuildingsImgs, buildingImgs, availableBuildingLevels, buildQueueElment, update = false) {
    const widgetConfig = settings_cookies.widgets.find(widget => widget.name === 'building_queue');
    const columnToUse = widgetConfig?.column ?? LEFT_COLUMN;
    const extraBuildDiv = buildBuildQueueContent(availableBuildingsImgs, buildingImgs, availableBuildingLevels, buildQueueElment, game_data?.village?.id, document);

    createWidgetElement({ identifier: t('buildQueue.title'), contents: extraBuildDiv, columnToUse, update, extra_name: '', description: '', widgetKey: 'building_queue' });
}

/**
 * Parses active queue slots and building cost/level data out of a village's main-building
 * page and persists them (via bqSet), scoped to the given village. Shared by the current
 * village's widget rendering (getCurrentQueueListElement) and background processing of other
 * villages (refreshBackgroundVillageQueue) — this function never touches the DOM widget.
 * @param {Document} tempElement - Parsed HTML document of the main building screen.
 * @param {string|number} villageId - Village this page belongs to.
 * @returns {{queueBuildIdsActive: string[], queueBuildLevelsActive: number[]}}
 */
function parseAndStoreQueueState(tempElement, villageId) {
    var queueBuildIdsActive = [];
    var cancelButtons = tempElement.querySelectorAll('.btn-cancel');
    var dateNextSlot, dateLastSlot;

    //Get times from the cancel buttons row and check if the queue is full
    const maxQueueSize = getMaxBuildQueueSize();
    setVillageQueueFull(villageId, cancelButtons.length >= maxQueueSize);

    if (cancelButtons.length > 0) {
        const allSlotTimestamps = Array.from(cancelButtons).map(btn =>
            extractBuildTimestampFromHTML(btn.parentElement.parentElement.children[3].textContent)
        );
        bqSet('building_queue_slots', villageId, allSlotTimestamps);

        dateNextSlot = allSlotTimestamps[0];
        bqSet('building_queue_next_slot', villageId, dateNextSlot);

        if (cancelButtons.length >= 2) {
            dateLastSlot = allSlotTimestamps[allSlotTimestamps.length - 1];
            bqSet('building_queue_last_slot', villageId, dateLastSlot);
        } else {
            bqRemove('building_queue_last_slot', villageId);
        }
        setCancelBuildIds(cancelButtons, villageId);
    } else {
        setVillageQueueFull(villageId, false);
        bqRemove('building_queue_next_slot', villageId);
        bqRemove('building_queue_slots', villageId);
    }

    var queueBuildLevelsActive = [];
    cancelButtons.forEach(function (element) {
        const row = element.parentElement.parentElement;
        queueBuildIdsActive.push(row.querySelector('.lit-item > img').src.split('/').pop().replace(/\.[^/.]+$/, ''));
        // Extract actual building level from .lit-item text content — last number is language-agnostic
        // e.g. "Ferreiro\nN\u00edvel 19" → 19
        const litText = row.querySelector('.lit-item')?.textContent || '';
        const lvlMatch = litText.trim().match(/(\d+)\s*$/);
        queueBuildLevelsActive.push(lvlMatch ? parseInt(lvlMatch[1], 10) : 0);
    })

    // Store current building levels and actual next-level build time (HTML-sourced, includes
    // world-speed + main-building bonus). Costs (wood/stone/iron/pop) come from buildings_data on demand.
    const buildingLevelsInfo = {};
    tempElement.querySelectorAll("[id^='main_buildrow_']").forEach(row => {
        const buildId = row.id.replace("main_buildrow_", "");
        const tds = row.querySelectorAll("td");
        if (tds.length > 2) {
            // Level from span text content (same as getAllBuildingsImages) — the image filename
            // uses a visual tier number (0-4), NOT the actual building level
            const span = tds[0]?.querySelector('span');
            const lvlMatch = span?.textContent.match(/\d+/);
            const currentLevel = lvlMatch ? parseInt(lvlMatch[0], 10) : 0;
            // Server-rendered time for the next level (exact: includes world speed + main building bonus)
            const nextLevelTimeStr = tds[4]?.innerText.trim() || '';
            buildingLevelsInfo[buildId] = { currentLevel, nextLevelTimeStr };
        }

        const serverCost = getServerBuildCost(tempElement, buildId);
        if (serverCost) updateCachedBuildCost(buildId, serverCost);
    });

    bqSet('nextLevelBuildsQueueInfo', villageId, buildingLevelsInfo);
    bqSet('building_queue_active', villageId, queueBuildIdsActive);
    bqSet('building_queue_active_levels', villageId, queueBuildLevelsActive);

    return { queueBuildIdsActive, queueBuildLevelsActive };
}

/**
 * Parses the main building page HTML for the CURRENTLY DISPLAYED village, persists queue/cost
 * state (via parseAndStoreQueueState), and returns a TD element containing the
 * rendered queue icons. Only meaningful for the currently loaded village — other villages have
 * no DOM widget to render into (see refreshBackgroundVillageQueue for those).
 * @param {Document} tempElement - Parsed HTML document of the main building screen.
 * @param {string[]} allBuildingsImgs - All building image URLs (used for fake queue icons).
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 * @returns {HTMLElement} TD element with active and fake queue icons injected.
 */
function getCurrentQueueListElement(tempElement, allBuildingsImgs, villageId) {
    const vId = villageId || game_data?.village?.id;
    var buildQueueElment = document.createElement('td');

    const { queueBuildIdsActive } = parseAndStoreQueueState(tempElement, vId);

    // inject active real queue
    injectAtiveQueueList(queueBuildIdsActive, buildQueueElment, vId, document)
    // inject waiting fake queue
    injectFakeQueueList(queueBuildIdsActive, buildQueueElment, allBuildingsImgs, vId, document);

    return buildQueueElment;
}

/**
 * Reads the server-calculated cost for the next upgrade from a main page response.
 * The data-cost attributes are preferable to translated text and already include the
 * world's current rules and modifiers.
 * @param {Document} doc - Parsed main page response.
 * @param {string} buildId - Building identifier.
 * @returns {{level:number, wood:number, stone:number, iron:number, pop:number}|null}
 */
function getServerBuildCost(doc, buildId) {
    const row = doc.querySelector('#main_buildrow_' + buildId);
    if (!row) return null;

    const levelLink = row.querySelector('a[data-level-next]');
    const level = Number(levelLink?.getAttribute('data-level-next'));
    const getCost = selector => {
        const value = Number(row.querySelector(selector)?.getAttribute('data-cost'));
        return Number.isFinite(value) && value >= 0 ? value : null;
    };
    const wood = getCost('.cost_wood[data-cost]');
    const stone = getCost('.cost_stone[data-cost]');
    const iron = getCost('.cost_iron[data-cost]');
    const popText = row.querySelector('.population')?.parentElement?.textContent || '';
    const popMatch = popText.match(/\d+/);
    const pop = popMatch ? Number(popMatch[0]) : 0;

    if (!Number.isInteger(level) || level <= 0 || wood === null || stone === null || iron === null) {
        return null;
    }

    return { level, wood, stone, iron, pop };
}

/**
 * Updates one cached building level with costs supplied by the game server.
 * @param {string} buildId - Building identifier.
 * @param {{level:number, wood:number, stone:number, iron:number, pop:number}} serverCost
 * @returns {boolean} Whether the cached cost changed.
 */
function updateCachedBuildCost(buildId, serverCost) {
    const allBuildingsData = JSON.parse(localStorage.getItem('buildings_data') || '{}');
    const currentCost = allBuildingsData[buildId]?.[serverCost.level];
    if (currentCost &&
        currentCost.wood === serverCost.wood &&
        currentCost.stone === serverCost.stone &&
        currentCost.iron === serverCost.iron &&
        currentCost.pop === serverCost.pop) {
        return false;
    }

    allBuildingsData[buildId] = allBuildingsData[buildId] || {};
    allBuildingsData[buildId][serverCost.level] = {
        ...currentCost,
        wood: serverCost.wood,
        stone: serverCost.stone,
        iron: serverCost.iron,
        pop: serverCost.pop
    };
    localStorage.setItem('buildings_data', JSON.stringify(allBuildingsData));
    return true;
}

/**
 * Builds an HTML string showing resource icons and costs for the next level of a building.
 * Used as tooltip content on upgrade buttons.
 * @param {string} buildId - Building identifier (e.g. 'barracks', 'wall').
 * @param {number} nextLevel
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 * @param {{wood:number, stone:number, iron:number}} [resources] - Resource amounts to compare
 * costs against for the insufficient-resource warning; defaults to live DOM (only valid when
 * villageId is the currently loaded village — see readCurrentVillageDomResources).
 * @returns {string} HTML string, or empty string if data is unavailable.
 */
function createResourceElementsString(buildId, nextLevel, villageId, resources) {
    const vId = villageId || game_data?.village?.id;
    const allBuildingsData = JSON.parse(localStorage.getItem('buildings_data') || '{}');
    const buildInfo = allBuildingsData[buildId]?.[nextLevel];
    if (!buildInfo) return '';

    const res = resources || readCurrentVillageDomResources(vId) || { wood: 0, stone: 0, iron: 0 };
    const currentWood = res.wood;
    const currentStone = res.stone;
    const currentIron = res.iron;

    // Build time:
    // - Immediate next level: use server-rendered time from HTML (exact — includes world speed + main building bonus)
    // - Deeper queue levels: TWStats base time / worldSpeed * main building reduction factor
    //   Factor table (% of base time) per main building level, index 0 = not built (100%):
    const MAIN_BUILDING_FACTORS = [
        1, 0.95, 0.91, 0.86, 0.82, 0.78, 0.75, 0.71, 0.68, 0.64, 0.61,
        0.58, 0.56, 0.53, 0.51, 0.48, 0.46, 0.44, 0.42, 0.40, 0.38,
        0.36, 0.34, 0.33, 0.31, 0.30, 0.28, 0.27, 0.26, 0.24, 0.23
    ];
    const levelsInfo = bqGet('nextLevelBuildsQueueInfo', vId) || {};
    const levelEntry = levelsInfo[buildId];
    let timeStr = '';
    if (levelEntry?.nextLevelTimeStr && nextLevel === levelEntry.currentLevel + 1) {
        // Exact time from the last server-rendered page
        timeStr = levelEntry.nextLevelTimeStr;
    } else if (buildInfo.timeSec) {
        // Approximation for deeper levels: apply main building reduction
        const mainLevel = Math.min(
            levelsInfo['main']?.currentLevel ?? parseInt(game_data?.village?.buildings?.main || '0'),
            30
        );
        const mainFactor = MAIN_BUILDING_FACTORS[mainLevel] ?? 1;
        timeStr = formatMinutesToTime(Math.round(buildInfo.timeSec / getWorldSpeed() * mainFactor) / 60);
    }

    function createSpan(className, value, warn) {
        const span = document.createElement("span");
        span.className = `icon header ${className}`;
        span.style.margin = '0';
        const textNode = document.createTextNode(` ${value}`);
        const wrapper = document.createElement("span");
        if (warn) wrapper.className = 'warn';
        wrapper.appendChild(span);
        wrapper.appendChild(textNode);
        wrapper.style.marginRight = '1px';
        return wrapper.outerHTML;
    }

    const hasPopData = typeof res.pop === 'number' && typeof res.popMax === 'number';
    const popWarn = hasPopData && (res.popMax - res.pop) < buildInfo.pop;

    return (`<div>` +
        createSpan("wood", buildInfo.wood, currentWood < buildInfo.wood) +
        createSpan("stone", buildInfo.stone, currentStone < buildInfo.stone) +
        createSpan("iron", buildInfo.iron, currentIron < buildInfo.iron) +
        `<div>` +
        createSpan("time", timeStr) +
        (buildInfo.pop ? createSpan("population", buildInfo.pop, popWarn) : '') +
        `</div>` +
        `</div>`
    );
}

/**
 * Injects icons for buildings currently in the real (server-side) build queue.
 * Each icon shows a rich live-countdown tooltip (building name, costs, finish time,
 * cancel hint) and opens a confirmation dialog before cancelling.
 * @param {string[]} queueBuildIdsActive - Ordered list of building ids in the active queue.
 * @param {HTMLElement} buildQueueElment - Container TD to append the icons into.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 * @param {Document} [doc=document] - Where building name labels are read from.
 * @param {Function} [onAction] - Called once the cancel request settles (success or failure).
 */
function injectAtiveQueueList(queueBuildIdsActive, buildQueueElment, villageId, doc = document, onAction) {
    const vId = villageId || game_data?.village?.id;
    if (queueBuildIdsActive.length) {
        queueBuildIdsActive.forEach(function (id, index) {
            const buildingId = id.replace(/[0-9]/g, '');
            const buildingName = doc.querySelector('.visual-label-' + buildingId)?.getAttribute('data-title') || buildingId;

            var anchor = document.createElement('a');
            anchor.className = '';
            anchor.style.display = 'inline-flex';
            anchor.style.alignItems = 'center';
            anchor.setAttribute('data-title', `<b>${buildingName}</b>`);

            function fmtMs(ms) {
                if (ms <= 0) return null;
                const s = Math.floor((ms / 1000) % 60);
                const m = Math.floor((ms / 1000 / 60) % 60);
                const h = Math.floor((ms / 1000 / 60 / 60) % 24);
                const d = Math.floor(ms / 1000 / 60 / 60 / 24);
                return (d > 0 ? d + 'd ' : '') + (h > 0 ? h + 'h ' : '') + (m > 0 ? m + 'm ' : '') + s + 's';
            }

            function buildTooltipBody() {
                const now = Date.now();
                const allSlots = (bqGet('building_queue_slots', vId) || []).map(Number);

                let timeHtml = '';
                if (index === 0) {
                    const fmt = fmtMs((allSlots[0] || 0) - now);
                    timeHtml = fmt
                        ? `<div style="margin-top:3px;border-top:1px solid #c1a264;padding-top:3px;">${t('buildQueue.finishesIn', { time: fmt })}</div>`
                        : `<div style="margin-top:3px;color:#aaa;">${t('buildQueue.finishingSoon')}</div>`;
                } else {
                    const startFmt = fmtMs((allSlots[index - 1] || 0) - now);
                    const endFmt = fmtMs((allSlots[index] || 0) - now);
                    timeHtml = (startFmt ? `<div style="margin-top:3px;border-top:1px solid #c1a264;padding-top:3px;">${t('buildQueue.startsIn', { time: startFmt })}</div>` : '')
                        + (endFmt ? `<div>${t('buildQueue.finishesIn', { time: endFmt })}</div>` : `<div style="color:#aaa;">${t('buildQueue.finishingSoon')}</div>`);
                }

                const cancelHint = `<div style="margin-top:4px;border-top:1px solid #c1a264;padding-top:3px;color:#e06060;">${t('buildQueue.clickToCancel')}</div>`;
                return timeHtml + cancelHint;
            }

            function updateCountdown(event) {
                anchor.setAttribute('data-tooltip-tpl', buildTooltipBody());
                toggleTooltip(event.target, true);
                event.target.countdownTimeout = setTimeout(() => updateCountdown(event), 1000);
            }

            anchor.style.border = '1px solid #7d510f';

            anchor.onclick = function () {
                if (typeof toggleTooltip === 'function') toggleTooltip(span, false);
                clearTimeout(span.countdownTimeout);
                const tooltipEl = document.getElementById('tooltip');
                if (tooltipEl) tooltipEl.style.display = 'none';
                UI.ConfirmationBox(
                    t('buildQueue.cancelConfirm', { name: escapeHtml(buildingName) }),
                    [{
                        text: t('button.ok'),
                        callback: function () { removeFromActiveBuildQueue(index, vId).then(() => { if (onAction) onAction(); }); },
                        confirm: true
                    }],
                    'tw_cancel_active_build_' + index,
                    false,
                    true
                );
            };

            var span = document.createElement('span');
            span.className = 'icon header village active_queue';
            span.style.backgroundImage = 'url(https://dspt.innogamescdn.com/asset/95eda994/graphic/buildings/mid/' + id + '.png)';
            span.style.backgroundPosition = '0px 0px';
            span.style.backgroundSize = 'contain';
            span.style.backgroundRepeat = 'no-repeat';
            span.style.width = '24px';
            span.style.marginRight = '4px';
            span.style.position = 'relative';
            span.style.display = 'inline-block';
            span.style.cursor = 'pointer';

            span.addEventListener('mouseenter', function (event) {
                anchor.setAttribute('data-tooltip-tpl', buildTooltipBody());
                toggleTooltip(event.target, true);
                updateCountdown(event);
            });
            span.addEventListener('mouseleave', function (event) {
                toggleTooltip(event.target, false);
                clearTimeout(event.target.countdownTimeout);
            });

            var progressBar = document.createElement('div');
            progressBar.style.position = 'absolute';
            progressBar.style.bottom = '0';
            progressBar.style.left = '0';
            progressBar.style.width = '100%';
            progressBar.style.height = '4px';
            progressBar.style.backgroundColor = '#4caf50';

            span.appendChild(progressBar);
            anchor.appendChild(span);
            buildQueueElment.appendChild(anchor);
        });
    }
}

/**
 * Injects icons for buildings waiting in the local (fake) queue, i.e. queued by the script
 * but not yet submitted to the server. Each icon allows removal on click.
 * The first item's tooltip shows a live countdown to the next retry attempt;
 * subsequent items show their position in the queue.
 * @param {string[]} queueBuildIdsActive - Active queue ids, used to calculate click offset.
 * @param {HTMLElement} buildQueueElment - Container TD to append the icons into.
 * @param {string[]} allBuildingsImgs - All building image URLs, used to resolve the icon src.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 * @param {Document} [doc=document] - Where building name labels are read from.
 * @param {{wood:number, stone:number, iron:number}} [resources] - Passed through to
 * createResourceElementsString for the cost tooltip.
 * @param {Function} [onAction] - Called right after a waiting item is removed (synchronous).
 */
function injectFakeQueueList(queueBuildIdsActive, buildQueueElment, allBuildingsImgs, villageId, doc = document, resources, onAction) {
    const vId = villageId || game_data?.village?.id;
    var queueBuildIds = bqGet('building_queue', vId) || [];
    if (!queueBuildIds.length) return;

    // Scheduled time (ms epoch) when addToBuildQueue() will next fire for this village
    const scheduledEndTime = parseInt(localStorage.getItem('endTime_' + getBuildQueueTimeoutId(vId))) || 0;
    // Target levels stored at queue-add time (building_queue_levels mirrors building_queue)
    const fakeQueueLevels = bqGet('building_queue_levels', vId) || [];

    queueBuildIds.forEach(function (id, fakeIndex) {
        const buildingName = doc.querySelector('.visual-label-' + id)?.getAttribute('data-title') || id;

        var anchor = document.createElement('a');
        anchor.className = '';
        anchor.style.display = 'inline-flex';
        anchor.style.alignItems = 'center';
        anchor.setAttribute('data-title', `<b>${buildingName}</b>`);
        anchor.style.border = '1px solid #7d510f';
        anchor.onclick = function () {
            if (typeof toggleTooltip === 'function') toggleTooltip(span, false);
            clearTimeout(span.countdownTimeout);
            const tooltipEl = document.getElementById('tooltip');
            if (tooltipEl) tooltipEl.style.display = 'none';
            var index = Array.from(this.parentElement.children).indexOf(this);
            removeFromBuildQueue(index - queueBuildIdsActive.length, vId);
            if (onAction) onAction();
        }

        const _fakeTargetLevel = fakeQueueLevels[fakeIndex] || 0;
        const costHtml = createResourceElementsString(id, _fakeTargetLevel, vId, resources) || '';

        // Builds tooltip body: resource costs + time info line
        function buildTooltipBody() {
            let timeHtml = '';
            if (fakeIndex === 0 && scheduledEndTime > 0) {
                const remaining = scheduledEndTime - Date.now();
                if (remaining > 0) {
                    const s = Math.floor((remaining / 1000) % 60);
                    const m = Math.floor((remaining / 1000 / 60) % 60);
                    const h = Math.floor((remaining / 1000 / 60 / 60) % 24);
                    const d = Math.floor(remaining / 1000 / 60 / 60 / 24);
                    const fmt = (d > 0 ? d + 'd ' : '') + (h > 0 ? h + 'h ' : '') + (m > 0 ? m + 'm ' : '') + s + 's';
                    timeHtml = `<div style="margin-top:3px;border-top:1px solid #c1a264;padding-top:3px;color:#888;">${t('buildQueue.nextAttemptIn', { time: fmt })}</div>`;
                } else {
                    timeHtml = `<div style="margin-top:3px;color:#aaa;">${t('buildQueue.retryingSoon')}</div>`;
                }
            } else if (fakeIndex > 0) {
                timeHtml = `<div style="margin-top:3px;border-top:1px solid #c1a264;padding-top:3px;color:#aaa;">${t('buildQueue.positionInQueue', { position: fakeIndex + 1 })}</div>`;
            }
            const removeHint = `<div style="margin-top:4px;border-top:1px solid #c1a264;padding-top:3px;color:#e06060;">${t('buildQueue.clickToRemove')}</div>`;
            return costHtml + timeHtml + removeHint;
        }

        anchor.setAttribute('data-tooltip-tpl', buildTooltipBody());

        var span = document.createElement('span');
        span.className = 'icon header village';
        span.style.backgroundImage = 'url(' + allBuildingsImgs.find(el => new RegExp('/' + id + '\\d+\\.').test(el)) + ')';
        //span.style.backgroundImage = 'url(https://dspt.innogamescdn.com/asset/95eda994/graphic/buildings/mid/' + id + '.png)'
        span.style.backgroundPosition = '0px 0px';
        span.style.backgroundSize = 'contain';
        span.style.backgroundRepeat = 'no-repeat';
        span.style.width = '24px';
        span.style.marginRight = '4px';
        span.style.position = 'relative';
        span.style.display = 'inline-block';
        span.style.cursor = 'pointer';

        var progressBar = document.createElement('div');
        progressBar.style.position = 'absolute';
        progressBar.style.bottom = '0';
        progressBar.style.left = '0';
        progressBar.style.width = '100%';
        progressBar.style.height = '4px';
        progressBar.style.backgroundColor = 'orange';

        span.appendChild(progressBar);

        span.addEventListener('mouseenter', function (event) {
            anchor.setAttribute('data-tooltip-tpl', buildTooltipBody());
            toggleTooltip(event.target, true);
            // Live countdown for the first waiting item only
            if (fakeIndex === 0 && scheduledEndTime > 0) {
                function updateCountdown() {
                    anchor.setAttribute('data-tooltip-tpl', buildTooltipBody());
                    toggleTooltip(event.target, true);
                    event.target.countdownTimeout = setTimeout(updateCountdown, 1000);
                }
                event.target.countdownTimeout = setTimeout(updateCountdown, 1000);
            }
        });
        span.addEventListener('mouseleave', function (event) {
            toggleTooltip(event.target, false);
            clearTimeout(event.target.countdownTimeout);
        });

        anchor.appendChild(span);
        buildQueueElment.appendChild(anchor);
    });
}

/**
 * Entry point for rendering the building queue widget from raw main-screen HTML of the
 * CURRENTLY DISPLAYED village. Parses the HTML, extracts building data, builds the queue
 * element, injects the widget, and decides the next automatic queue action.
 * @param {string} mainElement - Raw HTML string of the main building page.
 * @param {boolean} update - If true, replaces the existing widget in the DOM.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 */
function injectQueues(mainElement, update, villageId) {
    const vId = villageId || game_data?.village?.id;
    if (mainElement) {
        const parser = new DOMParser();
        const tempElement = parser.parseFromString(mainElement, 'text/html');

        var { availableBuildingsImgs, availableBuildingLevels, allBuildingsImgs, allAvailableBuildingLevels } = getAllBuildingsImages(tempElement);
        var buildQueueElment = getCurrentQueueListElement(tempElement, allBuildingsImgs, vId);

        if (settings_cookies.general['show__building_queue_all']) {
            injectBuildQueue(allBuildingsImgs, availableBuildingsImgs, allAvailableBuildingLevels, buildQueueElment, update);
        } else {
            injectBuildQueue(availableBuildingsImgs, availableBuildingsImgs, availableBuildingLevels, buildQueueElment, update);
        }
        setOngoingBuildingLevels();
        scheduleCompletionNotification(vId);
        // Refresh the main building's visual-label-extra with the updated queue end time.
        if (typeof getMainQueueTime === 'function') getMainQueueTime();
        // After fresh data: if a slot is free and there's a waiting item, decide immediately.
        decideNextQueueAction(vId, readCurrentVillageDomResources(vId));
    }
}

/**
 * Shared decision logic: given a village's current queue/resource state, either promotes the
 * next waiting item immediately (resources available and a slot is free) or (re)schedules the
 * next automatic check. Used both for the currently displayed village (from injectQueues, with
 * live DOM resources) and for background villages (from refreshBackgroundVillageQueue, with
 * resources parsed from a freshly fetched page).
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 * @param {{wood:number, stone:number, iron:number}|null} [resources] - Known current resources.
 */
function decideNextQueueAction(villageId, resources) {
    const vId = villageId || game_data?.village?.id;
    const _bq = bqGet('building_queue', vId) || [];
    const _wfq = bqGet('waiting_for_queue', vId) || {};
    if (!_bq.length) return;

    if (!isVillageQueueFull(vId) && !_wfq.buildId) {
        // Slot free, not already waiting for resources — compare costs against known resources now.
        const waitingBuildId = _bq[0];
        const _allBuildingsData = JSON.parse(localStorage.getItem('buildings_data') || '{}');
        const _fakeQueueLevels = bqGet('building_queue_levels', vId) || [];
        const buildInfo = _allBuildingsData[waitingBuildId]?.[_fakeQueueLevels[0] || 0];
        const hasResources = hasEnoughForBuild(resources, buildInfo);
        if (hasResources) {
            addToBuildQueue(undefined, vId); // resources available — promote immediately
        } else {
            updateBuildQueueTimers(vId); // not enough resources (or unknown) — maintain scheduled retry
        }
    } else {
        updateBuildQueueTimers(vId); // queue full or already waiting for resources
    }
}

/**
 * Scans the buildings table and returns categorised image URL and level arrays.
 * Separates buildings that are currently upgradeable from the full building list.
 * @param {Document} tempElement - Parsed HTML document of the main building screen.
 * @returns {{ availableBuildingsImgs: string[], availableBuildingLevels: string[], allBuildingsImgs: string[], allAvailableBuildingLevels: string[] }}
 */
function getAllBuildingsImages(tempElement) {
    var buildingsElement = tempElement.querySelector('#buildings');
    var allBuildingsImgs = [], availableBuildingsImgs = [], allAvailableBuildingLevels = [], availableBuildingLevels = [];
    if (buildingsElement) {
        var trs = buildingsElement.querySelectorAll('tr');
        trs.forEach(function (tr) {
            if (tr.id !== '') {
                var tds = tr.querySelectorAll('td');
                if (tds.length > 2) {
                    var buildButtons = tr.querySelector('.btn-build');
                    if (buildButtons) {
                        const span = tds[0].querySelector('span');
                        const lvl = span ? (span.textContent.match(/\d+/) || ['0']) : null;
                        const a = tds[0].querySelector('a');

                        //get lvls and images for available buildings only
                        if (buildButtons.style.display !== 'none') {
                            if (lvl) availableBuildingLevels.push(lvl[0]);
                            if (a && lvl) availableBuildingsImgs.push(a.querySelector('img').src);
                        }
                        //get lvls and images for all buildings
                        if (lvl) allAvailableBuildingLevels.push(lvl[0]);
                        if (a && lvl) allBuildingsImgs.push(a.querySelector('img').src);
                    }
                }
            }
        });
    }

    return { availableBuildingsImgs, availableBuildingLevels, allBuildingsImgs, allAvailableBuildingLevels };
}

/**
 * Extracts the server-side order ids from cancel buttons and stores them (via bqSet)
 * so they can be used later to cancel active queue slots.
 * @param {NodeList} cancelButtons - Cancel button elements from the active build queue rows.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 */
function setCancelBuildIds(cancelButtons, villageId) {
    var ids = [];
    cancelButtons.forEach(btn => {
        var id = new URLSearchParams(new URL(btn.href).search).get('id');
        if (id) ids.push(id);
    });
    bqSet('queue_cancelIds', villageId, ids);
}

/**
 * Adds a building to the queue or immediately upgrades it if a slot is free.
 * If called without an id, attempts to promote the first waiting entry in the fake queue.
 * @param {string} [build_id] - Building id to queue. Omit to process the next queued item.
 * @param {string|number} [villageId] - Village to act on. Defaults to the currently loaded village.
 */
function addToBuildQueue(build_id, villageId, actionButton) {
    const vId = villageId || game_data?.village?.id;
    const isCurrent = vId == game_data?.village?.id;
    if (build_id) {
        const targetLevel = getNextBuildLevel(build_id, vId);
        if (isBuildLevelAtMaximum(build_id, targetLevel)) {
            setBuildQueueButtonLoading(actionButton, false);
            showBuildMaximumMessage(vId, build_id);
            return;
        }
        if (!isVillageQueueFull(vId) && !(bqGet('waiting_for_queue', vId) || {}).buildId) {
            callUpgradeBuilding(build_id, vId, actionButton);
        } else {
            var building_queue = bqGet('building_queue', vId) || [];
            // Compute and store the actual target level for this new queue entry
            building_queue.push(build_id);
            bqSet('building_queue', vId, building_queue);
            var _bql = bqGet('building_queue_levels', vId) || [];
            _bql.push(targetLevel);
            bqSet('building_queue_levels', vId, _bql);

            updateBuildQueueTimers(vId);

            // No cached page to patch anymore — always fetch a fresh copy for the current village.
            if (isCurrent) fetchBuildQueueWidget(true, function () { setBuildQueueButtonLoading(actionButton, false); });
            else setBuildQueueButtonLoading(actionButton, false);
            showAutoHideBox('[' + getVillageName(vId) + '] ' + t('buildQueue.addedToWaitingQueue'), false);
        }
    } else {
        const building_queue = bqGet('building_queue', vId) || [];
        const waitingFor = bqGet('waiting_for_queue', vId) || {};
        if (!isVillageQueueFull(vId) && building_queue.length) {
            const waitingBuildId = building_queue[0];
            const queuedTargetLevel = bqGet('building_queue_levels', vId)?.[0] || getNextBuildLevel(waitingBuildId, vId, false);
            if (isBuildLevelAtMaximum(waitingBuildId, queuedTargetLevel)) {
                building_queue.shift();
                bqSet('building_queue', vId, building_queue);
                const queuedLevels = bqGet('building_queue_levels', vId) || [];
                queuedLevels.shift();
                bqSet('building_queue_levels', vId, queuedLevels);
                clearVillageBuildQueueTimeout(vId);
                bqSet('waiting_for_queue', vId, {});
                showBuildMaximumMessage(vId, waitingBuildId);
                if (isCurrent) fetchBuildQueueWidget(true);
                return;
            }
            // If a build was waiting for resources, the timer just fired meaning resources should now be available.
            // Clear the waiting state so callUpgradeBuilding can proceed normally.
            if (waitingFor.buildId) {
                bqSet('waiting_for_queue', vId, {});
            }
            callUpgradeBuilding(building_queue[0], vId);
        }
    }
}

/**
 * Removes an entry from the local (fake) waiting queue by index and refreshes the widget.
 * If the removed item was first in line, its associated timeout is also cleared.
 * @param {number} build_index - Zero-based index into the fake queue array.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 */
function removeFromBuildQueue(build_index, villageId) {
    const vId = villageId || game_data?.village?.id;
    var building_queue = bqGet('building_queue', vId);
    building_queue.splice(build_index, 1);
    bqSet('building_queue', vId, building_queue);
    var _bqlRemove = bqGet('building_queue_levels', vId) || [];
    _bqlRemove.splice(build_index, 1);
    bqSet('building_queue_levels', vId, _bqlRemove);

    if (build_index === 0) {
        clearVillageBuildQueueTimeout(vId);
        bqSet('waiting_for_queue', vId, {});
    }
    // No cached page to patch anymore — always fetch a fresh copy for the current village.
    fetchBuildQueueWidget(true);
    showAutoHideBox('[' + getVillageName(vId) + '] ' + t('buildQueue.removedFromWaitingQueue'), false);
}

/**
 * Cancels an active (server-side) build queue slot by index and refreshes the widget.
 * @param {number} build_index - Zero-based index into the active queue array.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 */
async function removeFromActiveBuildQueue(build_index, villageId) {
    const vId = villageId || game_data?.village?.id;
    const cancelIds = bqGet('queue_cancelIds', vId);
    try {
        const cancelResponse = await callRemoveFromActiveBuildingQueue(cancelIds[build_index], vId);

        var building_active_queue = bqGet('building_queue_active', vId);
        building_active_queue.splice(build_index, 1);
        bqSet('building_queue_active', vId, building_active_queue);
        var _activeLevels = bqGet('building_queue_active_levels', vId) || [];
        _activeLevels.splice(build_index, 1);
        bqSet('building_queue_active_levels', vId, _activeLevels);
        setVillageQueueFull(vId, building_active_queue.length >= getMaxBuildQueueSize());

        // No cached page to patch anymore — always fetch a fresh copy.
        fetchBuildQueueWidget(true);
    } catch (error) {
        showAutoHideBox('[' + getVillageName(vId) + '] ' + t('buildQueue.errorRemoving'), error);
        console.error('Error removing building:', error);
    }
}

/**
 * Sends a GET request to upgrade the given building. Handles both success (slot freed)
 * and error (insufficient resources or full queue) cases, updating the fake queue accordingly.
 * Works for the currently displayed village (refreshes the DOM widget) as well as any other
 * account village (updates its persisted state only — there's no widget to refresh for it).
 * @param {string|null} id - Building id to upgrade, or null to trigger a queue cleanup.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 */
function callUpgradeBuilding(id, villageId, actionButton) {
    const vId = villageId || game_data?.village?.id;
    const isCurrent = vId == game_data?.village?.id;
    if (id) {
        const queuedBuilds = bqGet('building_queue', vId) || [];
        const targetLevel = queuedBuilds[0] === id
            ? (bqGet('building_queue_levels', vId) || [])[0] || getNextBuildLevel(id, vId, false)
            : getNextBuildLevel(id, vId);
        if (isBuildLevelAtMaximum(id, targetLevel)) {
            setBuildQueueButtonLoading(actionButton, false);
            showBuildMaximumMessage(vId, id);
            return;
        }
        if (buildQueueRequestInFlightByVillage[vId]) return; // another trigger already has a request in transit
        buildQueueRequestInFlightByVillage[vId] = true;
        setBuildQueueButtonLoading(actionButton, true);
        $.ajax({
            'url': getVillageLinkBase(vId) + 'main&action=upgrade_building&id=' + id + '&type=main&h=' + game_data.csrf,
            'type': 'GET',
            'complete': function () {
                delete buildQueueRequestInFlightByVillage[vId];
                setBuildQueueButtonLoading(actionButton, false);
            },
            'success': function (data) {
                const parser = new DOMParser();
                const tempElement = parser.parseFromString(data, 'text/html');
                var main = tempElement.querySelector('#building_wrapper');
                var isError = tempElement.querySelector('.error_box');
                var building_queue = bqGet('building_queue', vId) || [];
                const wasFromQueue = building_queue[0] === id;
                const villageTag = '[' + getVillageName(vId) + '] ';

                if (isError !== null || !main) {
                    // Detect full queue from the response HTML in case the cached flag is stale
                    const queueFullInResponse = tempElement.querySelectorAll('.btn-cancel').length >= getMaxBuildQueueSize();
                    const serverCost = getServerBuildCost(tempElement, id);
                    if (serverCost) {
                        updateCachedBuildCost(id, serverCost);
                    }
                    // Error: item was NOT removed — if it came from a direct click (not queue), add to front
                    if (!wasFromQueue) {
                        building_queue.unshift(id);
                        var _bqlErr = bqGet('building_queue_levels', vId) || [];
                        _bqlErr.unshift(targetLevel);
                        bqSet('building_queue_levels', vId, _bqlErr);
                        bqSet('building_queue', vId, building_queue);
                    } else if (wasFromQueue) {
                        const _bqlErr = bqGet('building_queue_levels', vId) || [];
                        if (_bqlErr.length) {
                            _bqlErr[0] = targetLevel;
                            bqSet('building_queue_levels', vId, _bqlErr);
                        }
                    }
                    var missingRessourceBuildRow = tempElement.querySelector('#main_buildrow_' + id + ' .inactive');
                    var timeAvailable = missingRessourceBuildRow ? extractBuildTimeFromHTML(missingRessourceBuildRow.textContent) : null;

                    if (timeAvailable) {
                        showAutoHideBox(villageTag + t('buildQueue.addedToQueueAt', { day: timeAvailable[0] == '0' ? t('common.today') : t('common.tomorrow'), time: timeAvailable[1] + ':' + timeAvailable[2] }));
                        bqSet('waiting_for_queue', vId, { buildId: id, time: timeAvailable });
                        updateBuildQueueTimers(vId);
                    } else if (isVillageQueueFull(vId) || queueFullInResponse) {
                        showAutoHideBox(villageTag + t('buildQueue.queueFull'), false);
                        bqSet('waiting_for_queue', vId, { buildId: id });
                        updateBuildQueueTimers(vId);
                    } else {
                        // Countdown timer in DOM — can't parse exact time. Retry in ~1 min.
                        showAutoHideBox(villageTag + t('buildQueue.retryingResources'), false);
                        bqSet('waiting_for_queue', vId, { buildId: id });
                        scheduleVillageAddToBuildQueue(vId, 60 * 1000);
                    }
                    startBuildQueueResourcePolling(vId);
                    if (isCurrent) {
                        injectQueues(data, true, vId);
                    } else {
                        parseAndStoreQueueState(tempElement, vId);
                    }
                } else {
                    // Success: only now shift if item was at queue[0], then clear waiting state
                    if (wasFromQueue) {
                        building_queue.shift();
                        bqSet('building_queue', vId, building_queue);
                        var _bqlShift = bqGet('building_queue_levels', vId) || [];
                        _bqlShift.shift();
                        bqSet('building_queue_levels', vId, _bqlShift);
                    }
                    bqSet('waiting_for_queue', vId, {});
                    showAutoHideBox(villageTag + t('buildQueue.buildSentToQueue'), false);
                    if (isCurrent) {
                        injectQueues(data, true, vId); // updates building_queue_next_slot via bqSet
                    } else {
                        parseAndStoreQueueState(tempElement, vId);
                        scheduleCompletionNotification(vId);
                    }
                    // Schedule the next waiting item now that the first one was promoted
                    if (building_queue.length) {
                        updateBuildQueueTimers(vId);
                    }
                }
            }
        });
    } else {
        // Reset: remove any null entries that may have been left in the queue
        var building_queue = bqGet('building_queue', vId) || [];
        building_queue = building_queue.filter(item => item !== null);
        bqSet('building_queue', vId, building_queue);
        bqRemove('building_queue_levels', vId);
        bqRemove('building_queue_next_slot', vId);

        showAutoHideBox('[' + getVillageName(vId) + '] ' + t('buildQueue.invalidQueueReset'), true);
        if (isCurrent) fetchBuildQueueWidget(true);
    }
}

/**
 * Sends a POST request to cancel a specific active build order on the server.
 * @param {string} idToRemove - Server-side order id to cancel.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 * @returns {Promise<void>} Resolves on success, rejects on HTTP error.
 */
function callRemoveFromActiveBuildingQueue(idToRemove, villageId) {
    const vId = villageId || game_data?.village?.id;
    return new Promise((resolve, reject) => {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', getVillageLinkBase(villageId) + 'main&ajaxaction=cancel_order&type=main', true);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
        xhr.setRequestHeader('Tribalwars-Ajax', '1');
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        if (data?.response?.success) {
                            showAutoHideBox('[' + getVillageName(vId) + '] ' + t('buildQueue.activeBuildCancelled'), false);
                            resolve(data.response);
                        } else {
                            reject(new Error('Server reported cancel failure'));
                        }
                    } catch (e) {
                        // JSON parse failed — treat as success, no response data
                        showAutoHideBox('[' + getVillageName(vId) + '] ' + t('buildQueue.activeBuildCancelled'), false);
                        resolve(null);
                    }
                } else {
                    showAutoHideBox('[' + getVillageName(vId) + '] ' + t('buildQueue.errorRemoving'), xhr.status, xhr.statusText);
                    reject(new Error('HTTP error: ' + xhr.status));
                }
            }
        };

        var body = 'id=' + idToRemove + '&destroy=0&h=' + game_data.csrf;
        xhr.send(body);
    });
}

/**
 * Clears any pending scheduled timeout (in-memory and persisted) for a village's build queue.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 */
function clearVillageBuildQueueTimeout(villageId) {
    const bqId = getBuildQueueTimeoutId(villageId);
    localStorage.removeItem('function_' + bqId);
    localStorage.removeItem('handler_' + bqId);
    localStorage.removeItem('endTime_' + bqId);
    if (activeTimeouts[bqId]) {
        clearTimeout(activeTimeouts[bqId]);
        delete activeTimeouts[bqId];
    }
}

/**
 * Schedules addToBuildQueue() to run for a specific village after waitTime ms, surviving page
 * reloads/village switches. Uses setHandlerOnTimeOut (villageId passed as a plain JSON arg, not
 * baked into eval'd code) since eval/new Function were found to be unreliable across some of
 * Tampermonkey's execution contexts (CSP blocks them outright there).
 * @param {string|number} villageId
 * @param {number} waitTime - Delay in milliseconds.
 */
function scheduleVillageAddToBuildQueue(villageId, waitTime) {
    setHandlerOnTimeOut(getBuildQueueTimeoutId(villageId), 'addToBuildQueue', [undefined, villageId], waitTime);
}

/**
 * Schedules a background refresh (refreshBackgroundVillageQueue) for a specific village after
 * waitTime ms. Used as a fallback when the exact next-slot time couldn't be parsed. Same
 * handler-registry rationale as scheduleVillageAddToBuildQueue.
 * @param {string|number} villageId
 * @param {number} waitTime - Delay in milliseconds.
 */
function scheduleVillageQueueRefresh(villageId, waitTime) {
    setHandlerOnTimeOut(getBuildQueueTimeoutId(villageId) + '_refresh', 'refreshBackgroundVillageQueue', [villageId], waitTime);
}

// Registered so setHandlerOnTimeOut/restoreTimeouts (core_utils.user.js) can call these by name
// after a reload, without ever needing eval/new Function.
if (typeof registerTimeoutHandler === 'function') {
    registerTimeoutHandler('addToBuildQueue', addToBuildQueue);
    registerTimeoutHandler('refreshBackgroundVillageQueue', refreshBackgroundVillageQueue);
}

/**
 * Schedules the next automatic queue action via setTimeout, for the given (or current) village.
 * If a build is waiting for resources, schedules for when resources become available.
 * Otherwise, schedules for when the next active build slot finishes.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 */
function updateBuildQueueTimers(villageId) {
    const vId = villageId || game_data?.village?.id;
    // Schedule the next automatic queue trigger
    var building_queue = bqGet('building_queue', vId) || [];
    var waiting_for_queue = bqGet('waiting_for_queue', vId) || {};
    if (waiting_for_queue.time) {
        // Build is waiting for resources — schedule for when resources become available
        var nextTimeDate = waiting_for_queue.time;
        var targetEpoch = twWallClockToEpochMs(
            parseInt(nextTimeDate[1]),
            parseInt(nextTimeDate[2]),
            parseInt(nextTimeDate[3] || '0'),
            parseInt(nextTimeDate[0])
        );
        var waitTime = targetEpoch - Date.now();
        if (waitTime > 0) {
            scheduleVillageAddToBuildQueue(vId, waitTime);
        } else {
            addToBuildQueue(undefined, vId);
        }
    } else {
        // Build is waiting for an active slot to free up
        if (building_queue.length) {
            const rawSlot = parseInt(bqGet('building_queue_next_slot', vId));
            if (!isNaN(rawSlot) && rawSlot > 0) {
                var waitTime = rawSlot - Date.now();
                if (waitTime > 0) {
                    scheduleVillageAddToBuildQueue(vId, waitTime);
                } else {
                    addToBuildQueue(undefined, vId);
                }
            } else {
                // Slot time not parseable (e.g. different server locale) —
                // if queue is known free, try to promote now; otherwise poll every 5 min.
                if (!isVillageQueueFull(vId)) {
                    addToBuildQueue(undefined, vId);
                } else {
                    console.warn('[TW BuildQueue] building_queue_next_slot not parseable for village ' + vId + ', refreshing in 5 min');
                    scheduleVillageQueueRefresh(vId, 5 * 60 * 1000);
                }
            }
        }
    }
}

/**
 * Checks whether current in-page resource counts already cover the cost of the
 * waiting build. If so, cancels the scheduled timeout and triggers the build immediately.
 * Called on DOM resource updates to catch early availability without waiting for the timer.
 * Only meaningful for the currently displayed village (relies on live DOM values).
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 */
function checkEarlyBuildOpportunity(villageId) {
    const vId = villageId || game_data?.village?.id;
    const waitingFor = bqGet('waiting_for_queue', vId) || {};
    if (!waitingFor.buildId) return;
    if (isVillageQueueFull(vId)) return;
    // Guard against stale in-memory flag on page load: check the persisted active queue
    const _activeQueue = bqGet('building_queue_active', vId) || [];
    if (_activeQueue.length >= 2) return;

    const _allBuildingsData = JSON.parse(localStorage.getItem('buildings_data') || '{}');
    const _fakeQueueLevels = bqGet('building_queue_levels', vId) || [];
    const buildInfo = _allBuildingsData[waitingFor.buildId]?.[_fakeQueueLevels[0] || 0];
    if (!buildInfo) return;

    const resources = readCurrentVillageDomResources(vId);
    if (!resources) return;

    if (hasEnoughForBuild(resources, buildInfo)) {
        clearVillageBuildQueueTimeout(vId);
        const buildId = waitingFor.buildId;
        bqSet('waiting_for_queue', vId, {});
        showAutoHideBox('[' + getVillageName(vId) + '] ' + t('buildQueue.resourcesAvailableEarly'), false);
        callUpgradeBuilding(buildId, vId);
    }
}

// Per-village lists of pending completion-notification setTimeout ids. Replaces the old single
// global array, which was cleared on every call and could wipe out other villages' timeouts.
var buildCompletionTimeoutsByVillage = {};

/**
 * Schedules a notification + refresh for when each active build slot finishes, for the given
 * (or current) village. Called every time that village's queue state is (re)parsed so timestamps
 * stay fresh. For the currently displayed village this refreshes the visible widget; for any
 * other village it triggers a background-only refresh (no DOM widget exists for it).
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 */
function scheduleCompletionNotification(villageId) {
    const vId = villageId || game_data?.village?.id;
    const isCurrent = vId == game_data?.village?.id;

    (buildCompletionTimeoutsByVillage[vId] || []).forEach(t => clearTimeout(t));
    const timeouts = [];

    const _storedSlots = bqGet('building_queue_slots', vId) || [];
    const slots = _storedSlots.length > 0
        ? _storedSlots.map(Number)
        : [
            parseInt(bqGet('building_queue_next_slot', vId)),
            parseInt(bqGet('building_queue_last_slot', vId))
          ];

    slots.forEach(function (slot) {
        if (isNaN(slot) || slot <= 0) return;
        const msUntil = slot - Date.now();
        if (msUntil > 0) {
            timeouts.push(setTimeout(function () {
                showAutoHideBox('[' + getVillageName(vId) + '] ' + t('buildQueue.buildComplete'), false);
                // Delay fetch by 2s to give the server time to process the completion
                setTimeout(function () {
                    if (isCurrent) {
                        fetchBuildQueueWidget(true);
                    } else {
                        refreshBackgroundVillageQueue(vId);
                    }
                }, 2000);
            }, msUntil));
        }
    });

    buildCompletionTimeoutsByVillage[vId] = timeouts;

    // Re-arm the instant-free bot with updated queue timing (building_queue_next_slot just updated)
    if (typeof checkAndScheduleBuildInstantFree === 'function') checkAndScheduleBuildInstantFree(vId);
}

/**
 * Fetches a village's queue/resource state in the background (via AJAX) and re-evaluates the
 * next queue action, WITHOUT touching any DOM widget — used to keep other villages' build
 * queues progressing while a different village is displayed in the tab.
 * @param {string|number} villageId
 */
async function refreshBackgroundVillageQueue(villageId) {
    const isCurrent = villageId == game_data?.village?.id;
    if (isCurrent) {
        // The village is now the one displayed — use the normal DOM-refresh path instead.
        fetchBuildQueueWidget(true);
        return;
    }
    try {
        const { doc } = await fetchVillageMainPage(villageId);
        parseAndStoreQueueState(doc, villageId);
        scheduleCompletionNotification(villageId);
        const resources = readResourcesFromDoc(doc);
        decideNextQueueAction(villageId, resources);
    } catch (e) {
        console.warn('[TW BuildQueue] Failed to refresh background village ' + villageId, e);
        scheduleVillageQueueRefresh(villageId, 5 * 60 * 1000);
    }
}

// Per-village resource-polling interval ids. Replaces the old single global interval, which
// prevented a second village from ever starting its own polling loop.
var buildQueueResourcePollIntervalsByVillage = {};

/**
 * Starts a periodic check (every 3 minutes) that reads the waiting village's resource counters
 * and compares them against the waiting build's cost. If resources are sufficient, triggers the
 * build immediately. For the currently displayed village, resources are read from the live DOM
 * (no network needed); for any other village, a lightweight background page fetch is used.
 * Stops automatically once the build fires or the waiting entry is cleared.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 */
function startBuildQueueResourcePolling(villageId) {
    const vId = villageId || game_data?.village?.id;
    const waitingFor = bqGet('waiting_for_queue', vId) || {};
    if (!waitingFor.buildId || buildQueueResourcePollIntervalsByVillage[vId]) return;

    buildQueueResourcePollIntervalsByVillage[vId] = setInterval(async () => {
        const waiting = bqGet('waiting_for_queue', vId) || {};
        if (!waiting.buildId) {
            clearInterval(buildQueueResourcePollIntervalsByVillage[vId]);
            delete buildQueueResourcePollIntervalsByVillage[vId];
            return;
        }

        if (isVillageQueueFull(vId)) return;

        const isCurrent = vId == game_data?.village?.id;
        let resources;
        if (isCurrent) {
            resources = readCurrentVillageDomResources(vId);
        } else {
            try {
                const { doc } = await fetchVillageMainPage(vId);
                resources = readResourcesFromDoc(doc);
            } catch (e) {
                return;
            }
        }
        if (!resources) return;

        const _allBuildingsData = JSON.parse(localStorage.getItem('buildings_data') || '{}');
        const _fakeQueueLevels = bqGet('building_queue_levels', vId) || [];
        const buildInfo = _allBuildingsData[waiting.buildId]?.[_fakeQueueLevels[0] || 0];
        if (!buildInfo) return;

        if (hasEnoughForBuild(resources, buildInfo)) {
            clearInterval(buildQueueResourcePollIntervalsByVillage[vId]);
            delete buildQueueResourcePollIntervalsByVillage[vId];
            clearVillageBuildQueueTimeout(vId);
            const buildId = waiting.buildId;
            bqSet('waiting_for_queue', vId, {});
            showAutoHideBox('[' + getVillageName(vId) + '] ' + t('buildQueue.resourcesAvailableNow'), false);
            callUpgradeBuilding(buildId, vId);
            // callUpgradeBuilding refreshes the widget (current village) or the background state (others)
        }
    }, 3 * 60 * 1000);
}

/**
 * Fetches the main building page and re-renders the building queue widget for the CURRENTLY
 * DISPLAYED village. Also starts resource polling if a build is waiting for resources.
 * @param {boolean} [update=false] - If true, replaces the existing widget element.
 */
function fetchBuildQueueWidget(update = false, onComplete) {
    if (settings_cookies.general['show__building_queue']) {
        const initialColumn = typeof update === 'string' ? update : null;
        const shouldReplace = initialColumn ? false : update;
        if (initialColumn) {
            const loadingContainer = document.createElement('div');
            loadingContainer.id = 'building_queue_loading';
            loadingContainer.appendChild(createWidgetLoadingElement());
            createWidgetElement({ identifier: t('buildQueue.title'), contents: loadingContainer, columnToUse: initialColumn, update: false, description: t('buildQueue.description'), widgetKey: 'building_queue', loading: true });
        }
        startBuildQueueResourcePolling();
        fetchMainPage().then(function ({ html }) {
            injectQueues(html, initialColumn ? true : shouldReplace);
        }).catch(function () {
        }).finally(function () {
            if (onComplete) onComplete();
        });
    }
}

/**
 * Safety-net sweep: periodically re-checks every other village's build queue state via a
 * lightweight AJAX fetch, so queues keep progressing even if a precise timer drifts or is lost
 * (e.g. the tab was closed/reloaded around when a timer should have fired). Skips the currently
 * displayed village, which is already kept fresh by the live widget. Idempotent — safe to call
 * multiple times, only ever starts one interval. Also re-arms the instant-free timer for every
 * village from cached data (no extra fetch), catching ones with no local fake/waiting queue.
 */
var backgroundQueueSweepInterval = null;
function initBackgroundVillageQueueSweep() {
    if (backgroundQueueSweepInterval) return;
    backgroundQueueSweepInterval = setInterval(() => {
        const currentId = game_data?.village?.id;
        getAllVillageIds().forEach(vId => {
            if (vId == currentId) return;
            if (typeof checkAndScheduleBuildInstantFree === 'function') checkAndScheduleBuildInstantFree(vId);
            const hasQueue = (bqGet('building_queue', vId) || []).length > 0;
            const waiting = (bqGet('waiting_for_queue', vId) || {}).buildId;
            if (hasQueue || waiting) {
                refreshBackgroundVillageQueue(vId);
            }
        });
    }, 10 * 60 * 1000);
}
