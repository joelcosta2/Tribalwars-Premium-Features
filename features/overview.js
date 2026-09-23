// Load the infoOverview object from localStorage, initialising any missing properties with empty strings
var infoOverview = JSON.parse(localStorage.getItem("infoOverview")) || {};

infoOverview.storage = infoOverview.storage || "";
infoOverview.wood = infoOverview.wood || "";
infoOverview.stone = infoOverview.stone || "";
infoOverview.iron = infoOverview.iron || "";
infoOverview.stable = infoOverview.stable || "";
infoOverview.barracks = infoOverview.barracks || "";
infoOverview.garage = infoOverview.garage || "";
infoOverview.smith = infoOverview.smith || "";
infoOverview.main = infoOverview.main || "";
infoOverview.statue = infoOverview.statue || "";
infoOverview.wall = infoOverview.wall || "";
infoOverview.farm = infoOverview.farm || "";


/**
 * Fetches storage fill times from the storage screen and injects a countdown onto the
 * storage tile. Also caches the times in localStorage and triggers resource hovers.
 * @param {Function} [callback] - Called after cache is updated with storage times.
 * @returns {number} Unix timestamp (seconds) of whichever resource fills first, or 0.
 */
function getStorageTime(callback) {
    let minTime = 0;

    const storageCapacity = document.querySelector('#storage');
    if (storageCapacity) {
        localStorage.setItem('storage_capacity', storageCapacity.textContent);
    }

    if (game_data) {
        $.ajax({
            url: game_data.link_base_pure + 'storage',
            method: "GET",
            success: function (data) {
                var spans = $(data).find("span[data-endtime]");
                var fullStorageTimes = {
                    wood: $(spans[0]).attr("data-endtime"),
                    stone: $(spans[1]).attr("data-endtime"),
                    iron: $(spans[2]).attr("data-endtime")
                };
                const villageId = game_data.village?.id || 'unknown';
                localStorage.setItem(`full_storage_times_${villageId}`, JSON.stringify(fullStorageTimes));

                //hovers resources
                addRessourcesHover(fullStorageTimes);
                
                if (fullStorageTimes) {
                    minTime = Math.min(...Object.values(fullStorageTimes));
                    var now = Math.floor(Timing.getCurrentServerTime() / 1000);
                    var remaining = minTime - now;
                    
                    if(remaining) {
                        var hours = Math.floor(remaining / 3600).toString().padStart(2, '0');
                        var minutes = Math.floor((remaining % 3600) / 60).toString().padStart(2, '0');
                        var seconds = (remaining % 60).toString().padStart(2, '0');
                        
                        addToVisualLabelExtra('storage', `${hours}:${minutes}:${seconds}`, true, minTime);
                    }
                }

                // Call callback after cache is updated
                if (typeof callback === 'function') callback(minTime);
            }
        });
    } else {
        // If setting is disabled, call callback immediately
        if (typeof callback === 'function') callback(minTime);
    }
    return minTime; // Returns the timestamp of whichever resource fills first
}

/**
 * Attaches mouse-enter/leave listeners to resource elements (wood/stone/iron) so
 * that hovering shows a fill-time countdown in the TW native tooltip.
 * @param {Object|null} fullStorageTimes - Map of resource id to Unix timestamp (seconds).
 */
function addRessourcesHover(fullStorageTimes) {
    if (fullStorageTimes) {
        Object.keys(fullStorageTimes).forEach(resourceId => {
            var element = document.getElementById(resourceId);
            if (element) {
                var parentInfoBox = element.parentElement;
                var iconBox = parentInfoBox.previousElementSibling;

                var tooltip = document.getElementById("tooltip");
                if (tooltip) {
                    var bodyElement = tooltip.querySelector(".body");
                    if (bodyElement) {
                        // Clear existing polling interval before creating a new one
                        if (parentInfoBox.dataset.interval) {
                            clearInterval(parseInt(parentInfoBox.dataset.interval));
                        }
                        parentInfoBox.dataset.interval = setInterval(function () {
                            const resourceHover = localStorage.getItem('resourceHover');
                            if (resourceHover) {
                                const villageId = game_data.village?.id || 'unknown';
                                const latestTimes = JSON.parse(localStorage.getItem(`full_storage_times_${villageId}`)) || {};
                                startResourceTimerFull(parseInt(latestTimes[resourceHover]), bodyElement);
                            }
                        }, 500);

                        // Only bind event listeners once per element to avoid duplicates
                        if (parentInfoBox.dataset.hoverBound) return;
                        parentInfoBox.dataset.hoverBound = '1';

                        parentInfoBox.addEventListener("mouseenter", function () {
                            const villageId = game_data.village?.id || 'unknown';
                            const latestTimes = JSON.parse(localStorage.getItem(`full_storage_times_${villageId}`)) || {};
                            startResourceTimerFull(parseInt(latestTimes[resourceId]), bodyElement);
                            localStorage.setItem('resourceHover', resourceId);
                        });
                        iconBox.addEventListener("mouseenter", function () {
                            const villageId = game_data.village?.id || 'unknown';
                            const latestTimes = JSON.parse(localStorage.getItem(`full_storage_times_${villageId}`)) || {};
                            startResourceTimerFull(parseInt(latestTimes[resourceId]), bodyElement);
                            localStorage.setItem('resourceHover', resourceId);
                        });
                        parentInfoBox.addEventListener("mouseleave", function () {
                            localStorage.setItem('resourceHover', '');
                        });
                        iconBox.addEventListener("mouseleave", function () {
                            localStorage.setItem('resourceHover', '');
                        });
                    }
                }
            }
        });
    }
}

/**
 * Reads the wood fill time from localStorage and injects a production-rate + countdown
 * sub-label onto the wood tile.
 * @returns {Object} { perHour, fullEndTime } or {} if data is unavailable.
 */
function getWoodInfo() {
    const villageId = game_data.village?.id || 'unknown';
    const storageFullTime = JSON.parse(localStorage.getItem(`full_storage_times_${villageId}`));
    if (storageFullTime) {
        const fullTime = storageFullTime['wood'];
        if (fullTime) {
            var remaining = endTimeToTimer(fullTime);
            if(remaining) {
                const wood = document.getElementById('wood');
                let production;
                if (wood?.hasAttribute('data-title')) {
                    production = wood.getAttribute('data-title').match(/\d+/g);
                    const labelVisual = production + '/h\n' + `${remaining[0]}:${remaining[1]}:${remaining[2]}`;;
                    if (production) addToVisualLabelExtra('wood', labelVisual , true, fullTime);
                }
                return {perHour: production, fullEndTime: '0'}; //get value from label?
            } 
        }
    }
    return {};
}

/**
 * Same as getWoodInfo but for stone.
 * @returns {Object}
 */
function getStoneInfo() {
    const villageId = game_data.village?.id || 'unknown';
    const storageFullTime = JSON.parse(localStorage.getItem(`full_storage_times_${villageId}`));
    if (storageFullTime) {
        const fullTime = storageFullTime['stone'];
        if (fullTime) {
            var remaining = endTimeToTimer(fullTime);
            if(remaining) {
                const stone = document.getElementById('stone');
                let production;
                if (stone?.hasAttribute('data-title')) {
                    production = stone.getAttribute('data-title').match(/\d+/g);
                    const labelVisual = production + '/h\n' + `${remaining[0]}:${remaining[1]}:${remaining[2]}`;;
                    if (production) addToVisualLabelExtra('stone', labelVisual , true, fullTime);
                }

                return {perHour: production, fullEndTime: '0'}; //get value from label?
            }
        }
    }
    return {};
}

/**
 * Same as getWoodInfo but for iron.
 * @returns {Object}
 */
function getIronInfo() {
    const villageId = game_data.village?.id || 'unknown';
    const storageFullTime = JSON.parse(localStorage.getItem(`full_storage_times_${villageId}`));
    if (storageFullTime) {
        const fullTime = storageFullTime['iron'];
        if (fullTime) {
            var remaining = endTimeToTimer(fullTime);

            if(remaining) {
                const iron = document.getElementById('iron');
                let production;
                if (iron?.hasAttribute('data-title')) {
                    production = iron.getAttribute('data-title').match(/\d+/g);
                    const labelVisual = production + '/h\n' + `${remaining[0]}:${remaining[1]}:${remaining[2]}`;
                    if (production) addToVisualLabelExtra('iron', labelVisual , true, fullTime);
                }

                return {perHour: production, fullEndTime: '0'}; //get value from label?
            }
        }
    }
    return {};
}

/**
 * Stub for smith timer. Not yet implemented.
 * @returns {string}
 */
function getSmithTime() {
    return t('overview.stubSmithTime');
}

/**
 * Reads active building queue finish times from localStorage and injects a countdown
 * on the main building tile showing when the last queued build completes.
 * @returns {string}
 */
function getMainQueueTime() {
    const building_queue_next_slot = parseInt(bqGet('building_queue_next_slot'));
    const building_queue_last_slot = parseInt(bqGet('building_queue_last_slot'));
    
    if (building_queue_next_slot || building_queue_last_slot) {
        var lastSlot = Math.floor((building_queue_last_slot ? building_queue_last_slot  : building_queue_next_slot) / 1000);
        var remaining = endTimeToTimer(lastSlot);
        let labelVisual;
        
        if(remaining) {
            labelVisual = `${remaining[0]}:${remaining[1]}:${remaining[2]}`;
            addToVisualLabelExtra('main', labelVisual, true, lastSlot);
        }
    }
    return t('overview.stubLastBuild');
}

/**
 * Stub for wall timer. Not yet implemented.
 * @returns {string}
 */
function getWallTime() {
    return t('overview.stubLastBuild');
}

/**
 * Fetches the market page and injects an "available/total" merchant count label
 * onto the market building tile.
 * @returns {string}
 */
function getMarketInfo() {
    if (game_data) {
        $.ajax({
            url: game_data.link_base_pure + 'market',
            method: "GET",
            success: function (data) {
                const market_merchant_available_count = $(data).find("#market_merchant_available_count").text();
                const market_merchant_total_count = $(data).find("#market_merchant_total_count").text();
                if(market_merchant_available_count && market_merchant_total_count)
                addToVisualLabelExtra('market', `${market_merchant_available_count}\/${market_merchant_total_count}`);
            }
        })
    }
    return t('overview.stubLastBuild');
}

/**
 * Reads the auto-scavenge return time from localStorage and injects a countdown
 * on the rally point (place) tile.
 * @returns {string}
 */
function getPlaceInfo() {
    const villageId = String(game_data?.village?.id || '');
    const endTime_scavenging = villageId
        ? localStorage.getItem('endTime_scavenging-auto:' + villageId)
        : null;
    if (endTime_scavenging) {
        // Compute remaining time until the scavenging mission returns
        var endTime = Math.floor(endTime_scavenging / 1000);
        var remaining = endTimeToTimer(endTime);
        let labelVisual;
        
        if(remaining) {
            labelVisual = `${remaining[0]}:${remaining[1]}:${remaining[2]}`;
            addToVisualLabelExtra('place', labelVisual, true, endTime);
        }
    }
    return t('overview.stubLastBuild');
}

/**
 * Reads the paladin training end time from the cached localStorage key 'statue_knight_endtime'
 * and injects a countdown on the statue tile. If the cache is missing or expired, fetches
 * the statue page to get the current data-endtime and refreshes the cache.
 * The cache is also updated whenever the user visits the statue page directly
 * (see injectScriptAutoTrainerPaladin in trainerPaladin.js).
 * @returns {string}
 */
function getStatueInfo() {
    const cachedEndTime = parseInt(localStorage.getItem('statue_knight_endtime'), 10);
    const nowSec = Math.floor(Date.now() / 1000);

    if (cachedEndTime && cachedEndTime > nowSec) {
        // Cache still valid — inject label without a network request
        const remaining = endTimeToTimer(cachedEndTime);
        if (remaining) {
            addToVisualLabelExtra('statue', `${remaining[0]}:${remaining[1]}:${remaining[2]}`, true, cachedEndTime);
        }
        return t('overview.stubLastBuild');
    }

    // Cache expired or missing — fetch the statue page to read the live training countdown
    if (game_data) {
        $.ajax({
            url: game_data.link_base_pure + 'statue',
            method: 'GET',
            success: function (data) {
                const endtimeAttr = $(data).find('#knight_activity span[data-endtime]').attr('data-endtime');
                if (endtimeAttr) {
                    const endTime = parseInt(endtimeAttr, 10);
                    localStorage.setItem('statue_knight_endtime', endTime);
                    const remaining = endTimeToTimer(endTime);
                    if (remaining) {
                        addToVisualLabelExtra('statue', `${remaining[0]}:${remaining[1]}:${remaining[2]}`, true, endTime);
                    }
                }
            }
        });
    }
    return t('overview.stubLastBuild');
}

/**
 * Takes an array of barracks training finish timestamps and injects a countdown
 * for the last queued unit onto the barracks tile.
 * @param {number[]} barrracksTimes - UTC epoch timestamps in ms.
 * @returns {string}
 */
function getBarracksTime(barrracksTimes) {
    if (barrracksTimes && barrracksTimes.length) {
        var lastTrain = Math.floor(barrracksTimes[barrracksTimes.length - 1] / 1000);
        var remaining = endTimeToTimer(lastTrain);
        let labelVisual;
        
        if(remaining) {
            labelVisual = `${remaining[0]}:${remaining[1]}:${remaining[2]}`;
            addToVisualLabelExtra('barracks', labelVisual, true, lastTrain);
        }
    }
    return t('overview.stubQueueEmpty');
}

/**
 * Same as getBarracksTime but for the stable.
 * @param {number[]} stableTimes
 * @returns {string}
 */
function getStableTime(stableTimes) {
    if (stableTimes && stableTimes.length) {
        var lastTrain = Math.floor(stableTimes[stableTimes.length - 1] / 1000);
        var remaining = endTimeToTimer(lastTrain);
        let labelVisual;
        
        if(remaining) {
            labelVisual = `${remaining[0]}:${remaining[1]}:${remaining[2]}`;
            addToVisualLabelExtra('stable', labelVisual, true, lastTrain);
        }
    }
    return t('overview.stubQueueEmpty');
}

/**
 * Same as getBarracksTime but for the garage.
 * @param {number[]} garageTimes
 * @returns {string}
 */
function getGarageTime(garageTimes) {
    if (garageTimes && garageTimes.length) {
        var lastTrain = Math.floor(garageTimes[garageTimes.length - 1] / 1000);
        var remaining = endTimeToTimer(lastTrain);
        let labelVisual;
        
        if(remaining) {
            labelVisual = `${remaining[0]}:${remaining[1]}:${remaining[2]}`;
            addToVisualLabelExtra('garage', labelVisual, true, lastTrain);
        }
    }
    return t('overview.stubQueueEmpty');
}

/**
 * Stub for farm info. Not yet implemented.
 * @returns {string}
 */
function getFarmInfo() {
    return ''
}

/**
 * Reads the active building queue and the fake (pending) queue from localStorage
 * and updates the "+N" order-level overlay on each matching building tile.
 */
function setOngoingBuildingLevels() {
    var buildingQueueActive = bqGet('building_queue_active');
    var buildIds = buildingQueueActive ? buildingQueueActive.map(item => item.replace(/[0-9]/g, '')) : [];
    var fakeBuildingQueue = bqGet('building_queue');
    var fakeBuildIds = fakeBuildingQueue ? fakeBuildingQueue.map(item => item?.replace(/[0-9]/g, '')) : [];

    document.querySelectorAll('.order-level, [id^="order_level_"]').forEach(el => {
        el.textContent = '';
        el.style.fontWeight = '';
        el.style.color = '';
    });
    Object.keys(infoOverview).forEach(key => {
        let count = buildIds.filter(id => id === key).length;
        let fakeCount = fakeBuildIds.filter(id => id === key).length;
        if (count > 0) addToVisualLevelLabel(key, count);
        if (fakeCount > 0) addToVisualLevelLabel(key, fakeCount, true);
    });
}

/**
 * Parses unit recruitment costs, images, localised names, and in-village counts
 * from the training page HTML and persists the result (via bqSet).
 *
 * Costs and build times CAN vary per village (e.g. items/effects that boost
 * recruitment speed or discount resources), so they are stored per-village as the
 * 'unit_managers_costs' field. Only the localized name and image (which
 * never differ between villages) are stored globally as 'unit_managers_meta'.
 * @param {string} data - Raw HTML of the training screen.
 * @param {string} [villageId] - Defaults to the currently loaded village.
 */
function storeAvailableUnitsCosts(data, villageId = game_data.village?.id || 'unknown') {
    let unitCosts = {};
    $(data).find(".recruit_req").each(function(index, reqEl) {
        $(reqEl).find('span').each(function(i, span) {
            let match = span.id.match(/^([a-z]+)_\d+_cost_([a-z_]+)$/);
            if (match) {
                let unitType = match[1];
                let resource = match[2];
    
                if (!unitCosts[unitType]) {
                    unitCosts[unitType] = {};
                }
                if (resource !== 'time') {
                    let costValue = parseFloat(span.textContent.replace('.', '')) || 0;
                    unitCosts[unitType][resource] = costValue;
                } else {
                    unitCosts[unitType].build_time = timeToMilliseconds(span.textContent);
                }
            }
        });
    
        let unitTypeFromId = reqEl.id.split('_')[0];
        if (game_data.units[unitTypeFromId]) {
            unitCosts[unitTypeFromId].requirements_met = game_data.units[unitTypeFromId].requirements_met || false;
        }
    });

    // Also store localized name and image src from each unit row (truly global, never
    // varies per village) in a separate map so it doesn't get mixed with village-specific costs.
    let unitMeta = {};
    $(data).find('tr.row_a, tr.row_b').each(function(_, row) {
        const link = $(row).find('a.unit_link');
        if (!link.length) return;
        const unitType = link.data('unit');
        if (!unitType || !unitCosts[unitType]) return;

        unitMeta[unitType] = {};
        const img = link.find('img');
        if (img.length) unitMeta[unitType].img = img.attr('src');

        // Localized name: last text node inside the link element
        const linkEl = link[0];
        for (let i = linkEl.childNodes.length - 1; i >= 0; i--) {
            const node = linkEl.childNodes[i];
            if (node.nodeType === 3 && node.textContent.trim()) {
                unitMeta[unitType].name = node.textContent.trim();
                break;
            }
        }
    });

    // Merge into this village's existing costs. Units not present in this fetch (e.g. a
    // building not built yet) are preserved from previous fetches for this same village.
    const existingCosts = bqGet('unit_managers_costs', villageId) || {};
    const mergedCosts = Object.assign({}, existingCosts);
    for (const unit in unitCosts) {
        mergedCosts[unit] = Object.assign({}, existingCosts[unit] || {}, unitCosts[unit]);
    }
    bqSet('unit_managers_costs', villageId, mergedCosts);

    // Merge global name/image metadata across all villages (safe to accumulate, never changes).
    const existingMeta = JSON.parse(localStorage.getItem('unit_managers_meta')) || {};
    const mergedMeta = Object.assign({}, existingMeta);
    for (const unit in unitMeta) {
        mergedMeta[unit] = Object.assign({}, existingMeta[unit] || {}, unitMeta[unit]);
    }
    localStorage.setItem('unit_managers_meta', JSON.stringify(mergedMeta));

    // Also store per-village unit counts (per-village specific data)
    storeVillageUnitCounts(data, villageId);
}

/**
 * Extracts in-village unit counts (X/Y format) from the training page
 * and stores them per-village in localStorage.
 * @param {string} data - Raw HTML of the training screen.
 * @param {string} [villageId] - Defaults to the currently loaded village.
 */
function storeVillageUnitCounts(data, villageId = game_data.village?.id || 'unknown') {
    const unitCounts = {};
    
    $(data).find('tr.row_a, tr.row_b').each(function(_, row) {
        const link = $(row).find('a.unit_link');
        if (!link.length) return;
        const unitType = link.data('unit');
        if (!unitType) return;

        // In-village count from 3rd column (format "X/Y")
        const tds = $(row).find('td');
        if (tds.length >= 3) {
            const countText = $(tds[2]).text().trim();
            if (countText && countText.includes('/')) {
                unitCounts[unitType] = countText;
            }
        }
    });

    // Merge onto existing counts — /train never lists Paladin/Nobleman/Militia (see
    // parseSpecialUnitCounts in overviewVillages.js), so overwriting wholesale
    // would wipe those 3 back to absent/0 every time this village's recruit widget refreshes.
    const existingCounts = bqGet('village_unit_counts', villageId) || {};
    bqSet('village_unit_counts', villageId, Object.assign({}, existingCounts, unitCounts));
}

/**
 * Parses the current training queue for barracks, stable, and garage.
 * Aggregates and stores total unit counts per unit type in localStorage.
 * Format: { spear: 152, sword: 100, axe: 69, ... }
 * @param {string} data - Raw HTML of the training screen.
 * @param {string} [villageId] - Defaults to the currently loaded village.
 * @param {boolean} [renderOverview=false] - Whether to render queue icons on the current overview.
 */
function storeTrainQueueData(data, villageId = game_data.village?.id || 'unknown', renderOverview = false) {
    const queueCounts = {};
    const queueCountsByBuilding = {};

    ['barracks', 'stable', 'garage'].forEach(function (building) {
        queueCountsByBuilding[building] = {};
        $(data).find('#trainqueue_wrap_' + building + ' tr').each(function (_, row) {
            // Find the unit sprite div which has class like "unit_sprite unit_sprite_smaller spear"
            const spriteDiv = $(row).find('div.unit_sprite_smaller');
            if (!spriteDiv.length) return;

            // Extract unit type from classes (e.g., "spear", "sword", "axe", etc)
            let unitType = null;
            const classes = spriteDiv.attr('class').split(/\s+/);
            for (let cls of classes) {
                // Skip common class names, unit type will be a single word like spear, sword, etc
                if (cls !== 'unit_sprite' && cls !== 'unit_sprite_smaller' && cls !== '') {
                    unitType = cls;
                    break;
                }
            }
            if (!unitType) return;

            // Extract count from text like "69 Bárbaros" or "1 Lanceiro"
            const cellText = $(row).find('td').first().text().trim();
            const countMatch = cellText.match(/^(\d+)\s+/);
            if (!countMatch) return;

            const count = parseInt(countMatch[1], 10);
            queueCounts[unitType] = (queueCounts[unitType] || 0) + count;
            queueCountsByBuilding[building][unitType] = (queueCountsByBuilding[building][unitType] || 0) + count;
        });
    });

    bqSet('train_queue_data', villageId, queueCounts);
    if (renderOverview) renderTrainingQueueIcons(queueCountsByBuilding);
}

/**
 * Renders one unit icon per queued unit type in the matching non-visual summary cell.
 * The tooltip value is the total quantity queued for that unit in the building.
 * @param {Object} queueCountsByBuilding - Queue totals grouped by building and unit type.
 */
function renderTrainingQueueIcons(queueCountsByBuilding) {
    Object.entries({ barracks: 'barracks', stable: 'stable', garage: 'garage' }).forEach(function ([building, rowBuilding]) {
        const cell = document.querySelector(`#l_${rowBuilding} td.building_extra`);
        if (!cell) return;

        cell.querySelectorAll('.non-visual-training-icon').forEach(icon => icon.remove());
        Object.entries(queueCountsByBuilding[building] || {}).forEach(function ([unitType, total]) {
            if (total <= 0) return;

            const image = document.createElement('img');
            image.className = 'non-visual-training-icon';
            image.src = `/graphic/unit/unit_${unitType}.webp`;
            image.alt = unitType;
            image.setAttribute('data-title', String(total));
            cell.appendChild(image);
        });
    });

    if (typeof UI !== 'undefined' && typeof UI.ToolTip === 'function') {
        UI.ToolTip($('#show_summary .non-visual-training-icon'));
    }
}

/**
 * Parses the wood/stone/iron/population snapshot from a fetched game page (any screen's header
 * carries these) and caches it via resourcesManager.js's setVillageResources, keyed by villageId.
 * Since this isn't necessarily the loaded page, the values are a static snapshot, not a
 * live-ticking one.
 * @param {string} data - Raw HTML of any game.php page.
 * @param {string} villageId
 */
function storeVillageResourceSnapshot(data, villageId) {
    const snapshot = readVillageResourceSnapshot(data);
    if (!snapshot) return;
    setVillageResources(villageId, snapshot);
}

// In-flight requests keyed by villageId so concurrent callers (overview info panel + Recruit
// Troops widget) requesting the same village share one request instead of firing duplicates
// (mirrors storageOverviewFetchPromises in overviewVillages.js).
var trainInfoFetchPromises = {};

/**
 * Fetches the training screen and extracts queue finish times for all training buildings,
 * updates building tile labels, and caches unit costs, queue data, and a resource snapshot.
 * @param {Function} [callback] - Called with the raw response HTML after processing completes.
 * @param {string} [villageId] - Defaults to the currently loaded village.
 * @param {string} [linkBase] - Defaults to the currently loaded village's link base.
 * @param {boolean} [updateTiles=true] - Whether to update the overview page's own building tile
 * countdowns — only meaningful when villageId is the page actually loaded; set to false when
 * fetching a DIFFERENT village's data (e.g. from another village's recruit overlay).
 */
function fetchTrainInfo(callback, villageId = game_data?.village?.id || 'unknown', linkBase = game_data?.link_base_pure, updateTiles = true) {
    if (!game_data) return;

    if (trainInfoFetchPromises[villageId]) {
        trainInfoFetchPromises[villageId].then(function (data) {
            if (typeof callback === 'function') callback(data);
        });
        return trainInfoFetchPromises[villageId];
    }

    const promise = new Promise(function (resolve) {
        $.ajax({
            url: linkBase + 'train',
            method: "GET",
            timeout: 15000,
            success: function (data) {
                try {
                if (updateTiles) {
                    let barrracksTimes = [],
                        stableTimes = [],
                        garageTimes = [];
                    // Collect barracks training finish times. extractBuildTimestampFromHTML handles
                    // "today"/"tomorrow" phrasing as well as the explicit date TW shows for entries
                    // finishing more than a day out (long queues), returning null for unrelated cells.
                    $(data).find("#trainqueue_wrap_barracks td").each(function () {
                        const text = $(this).text().trim();
                        const timestamp = extractBuildTimestampFromHTML(text);
                        if (timestamp) {
                            barrracksTimes.push(timestamp)
                        }
                    });
                    getBarracksTime(barrracksTimes);

                    // Collect stable training finish times
                    $(data).find("#trainqueue_wrap_stable td").each(function () {
                        const text = $(this).text().trim();
                        const timestamp = extractBuildTimestampFromHTML(text);
                        if (timestamp) {
                            stableTimes.push(timestamp)
                        }
                    });
                    getStableTime(stableTimes)

                    // Collect garage training finish times
                    $(data).find("#trainqueue_wrap_garage td").each(function () {
                        const text = $(this).text().trim();
                        const timestamp = extractBuildTimestampFromHTML(text);
                        if (timestamp) {
                            garageTimes.push(timestamp)
                        }
                    });
                    getGarageTime(garageTimes);
                }

                // Extract and store unit recruitment costs, queue data, and resource snapshot
                storeAvailableUnitsCosts(data, villageId);
                storeTrainQueueData(data, villageId, updateTiles);
                storeVillageResourceSnapshot(data, villageId);
                resolve(data);
                } catch (error) {
                    console.error('[TW] Could not parse train state', error);
                    resolve(null);
                }
            },
            error: function () {
                // Resolve (not reject) so the in-flight entry clears and future fetches aren't blocked
                resolve(null);
            }
        });
    }).finally(function () { delete trainInfoFetchPromises[villageId]; });

    trainInfoFetchPromises[villageId] = promise;
    promise.then(function (data) {
        if (typeof callback === 'function') callback(data);
    });
    return promise;
}

/**
 * Orchestrates all overview info gathering when the overview page loads.
 * Calls each building's info function and persists the results to localStorage.
 */
function updatePremiumInfoOverview() {
    ensureNonVisualSummaryCells();
    updateNonVisualBuildIcons();

    const show__overview_premium_info = settings_cookies.general['show__overview_premium_info'];

    if (show__overview_premium_info) {
        // Single fetch: sets storage plus wood/stone/iron once it resolves (was 2 separate storage calls)
        getStorageTime(function(minTime) {
            infoOverview.storage = minTime;
            infoOverview.wood = getWoodInfo();
            infoOverview.stone = getStoneInfo();
            infoOverview.iron = getIronInfo();
            localStorage.setItem("infoOverview", JSON.stringify(infoOverview));
        });

        infoOverview.garage = getGarageTime();
        infoOverview.smith = getSmithTime();
        infoOverview.main = getMainQueueTime();
        infoOverview.wall = getWallTime();
        infoOverview.market = getMarketInfo();
        infoOverview.place = getPlaceInfo();
        infoOverview.statue = getStatueInfo();
        infoOverview.farm = getFarmInfo();

        fetchTrainInfo();

        localStorage.setItem("infoOverview", JSON.stringify(infoOverview));
    }
}

/**
 * Adds the premium summary's extra-information column to non-premium building rows.
 * Existing cells are preserved so native premium content is not disturbed.
 */
function ensureNonVisualSummaryCells() {
    document.querySelectorAll('#show_summary tr[id^="l_"]').forEach(function (row) {
        const firstCell = row.querySelector('td');
        if (!firstCell || firstCell.style.width !== '20px') {
            const buildCell = document.createElement('td');
            buildCell.style.width = '20px';
            row.insertBefore(buildCell, firstCell || null);
        }

        const buildingCell = row.querySelector('td:nth-child(2)');
        if (buildingCell) buildingCell.style.whiteSpace = 'nowrap';

        if (!row.querySelector('td.building_extra')) {
            const cell = document.createElement('td');
            cell.className = 'building_extra';
            row.appendChild(cell);
        }
    });
}

/**
 * Adds the native-style upgrade icon to summary rows whose next level is available.
 * Availability is read from the visible build buttons on the current village's main page.
 */
function updateNonVisualBuildIcons() {
    const villageId = game_data?.village?.id;
    if (!villageId || typeof fetchVillageMainPage !== 'function') return;

    fetchVillageMainPage(villageId).then(function (result) {
        const mainDocument = result.doc;
        document.querySelectorAll('#show_summary tr[id^="l_"]').forEach(function (row) {
            const buildingId = row.id.slice(2);
            const buildCell = row.querySelector('td');
            if (!buildCell) return;

            const existingIcon = buildCell.querySelector('.premium-build-icon');
            if (existingIcon) existingIcon.remove();

            const mainRow = mainDocument.querySelector('#main_buildrow_' + buildingId);
            const buildButton = Array.from(mainRow?.querySelectorAll('.btn-build') || [])
                .find(button => button.style.display !== 'none');
            if (!buildButton) return;

            const upgradeLink = document.createElement('a');
            upgradeLink.className = 'upgrade_level premium-build-icon';
            upgradeLink.id = 'upgrade_level_' + buildingId;
            upgradeLink.href = '#';
            upgradeLink.onclick = function (event) {
                event.preventDefault();
                if (typeof setBuildQueueButtonLoading === 'function') {
                    setBuildQueueButtonLoading(upgradeLink, true);
                }
                if (typeof addToBuildQueue === 'function') {
                    addToBuildQueue(buildingId, villageId, upgradeLink);
                }
                return false;
            };

            const dataTitle = buildButton.getAttribute('data-title') ||
                (typeof createResourceElementsString === 'function'
                    ? createResourceElementsString(
                        buildingId,
                        parseInt(buildButton.dataset.levelNext, 10),
                        villageId
                    )
                    : '');
            if (dataTitle) upgradeLink.setAttribute('data-title', dataTitle);

            const image = document.createElement('img');
            image.src = 'graphic/overview/build.webp';
            image.alt = t('buildQueue.level', { level: buildButton.dataset.levelNext || '' });
            upgradeLink.appendChild(image);
            buildCell.appendChild(upgradeLink);
        });

        if (typeof UI !== 'undefined' && typeof UI.ToolTip === 'function') {
            UI.ToolTip($('#show_summary .premium-build-icon'));
        }
    }).catch(function () {
        // A failed refresh leaves the stable empty cells in place and no stale icons.
    });
}

/**
 * Injects (or replaces) a countdown or text sub-label inside the named building's visual tile.
 * Clears any existing interval before starting a new one to prevent timer leaks.
 * @param {string} buildingName - CSS class suffix of the target tile (e.g. 'main', 'barracks').
 * @param {string} newTextContent - Initial text to display.
 * @param {boolean} [isTimer=false] - If true, starts a live countdown from endtime.
 * @param {number} [endtime=0] - Unix timestamp in seconds for the countdown target.
 */
function addToVisualLabelExtra(buildingName, newTextContent, isTimer = false, endtime = 0) {
    const nonVisualTextContent = ['wood', 'stone', 'iron'].includes(buildingName)
        ? String(newTextContent).split('\n').pop()
        : newTextContent;
    addToNonVisualLabelExtra(buildingName, nonVisualTextContent, isTimer, endtime);

    const labelStorage = document.getElementsByClassName(`visual-label-${buildingName}`)[0];

    if (labelStorage) {
        const labelContent = labelStorage.querySelector('a');

        if (labelContent) {
            // Remove previously injected div and clear its interval to avoid duplicates
            const existing = labelContent.querySelector('.visual-label-extra');
            if (existing) {
                if (labelContent.dataset.interval) {
                    clearInterval(parseInt(labelContent.dataset.interval, 10));
                    delete labelContent.dataset.interval;
                }
                existing.remove();
            }

            const div = document.createElement('div');
            div.className = 'visual-label-extra';
            div.style.whiteSpace = 'pre-line';
            div.textContent = newTextContent;
            div.style.fontSize = "9px";
        
            labelContent.appendChild(div);

            if (isTimer && endtime > 0) {
                labelContent.dataset.interval = setInterval(function () {
                    startTimerOnLabel(endtime, div);
                }, 500); // Update every 500 ms
            }
        }
    }
}

/**
 * Injects a countdown or text sub-label into the matching non-visual summary row.
 * @param {string} buildingName - ID suffix of the target summary row.
 * @param {string} newTextContent - Initial text to display.
 * @param {boolean} [isTimer=false] - If true, starts a live countdown from endtime.
 * @param {number} [endtime=0] - Unix timestamp in seconds for the countdown target.
 */
function addToNonVisualLabelExtra(buildingName, newTextContent, isTimer = false, endtime = 0) {
    const row = document.querySelector(`#l_${buildingName}`);
    if (!row) return;

    let cell = row.querySelector('td.building_extra');
    if (!cell) {
        cell = document.createElement('td');
        cell.className = 'building_extra';
        row.appendChild(cell);
    }

    let extra = cell.querySelector('.non-visual-label-extra');
    if (extra) {
        if (extra.dataset.interval) {
            clearInterval(parseInt(extra.dataset.interval, 10));
            delete extra.dataset.interval;
        }
    } else {
        extra = document.createElement('strong');
        extra.className = 'non-visual-label-extra';
        extra.style.fontWeight = 'bold';
        cell.appendChild(extra);
    }

    extra.textContent = newTextContent;

    if (isTimer && endtime > 0) {
        extra.dataset.interval = setInterval(function () {
            startTimerOnLabel(endtime, extra);
        }, 500);
    }
}

/**
 * Appends a "+N" indicator to the order-level element of a building tile.
 * @param {string} buildingName - CSS class suffix of the target tile.
 * @param {number} level - Number of queued upgrades to display.
 * @param {boolean} fakeQueue - If true, colours the indicator orange (fake/pending queue).
 */
function addToVisualLevelLabel(buildingName, level, fakeQueue) {
    const nonVisualOrderLevel = document.querySelector(`#order_level_${buildingName}`);
    if (nonVisualOrderLevel) {
        nonVisualOrderLevel.textContent = nonVisualOrderLevel.textContent + `+${level}`;
        nonVisualOrderLevel.style.fontWeight = "bold";
        if (fakeQueue) {
            nonVisualOrderLevel.style.color = "orange";
        }
    }

    const labelStorage = document.querySelector(`.visual-label-${buildingName}`);
    if (labelStorage) {
        const orderLevel = labelStorage.querySelector('.order-level');
        if (orderLevel) {
            orderLevel.textContent = orderLevel.textContent + `+${level}`;
            if (fakeQueue) {
                orderLevel.style.color = "orange";
            }
        }
    }
}
