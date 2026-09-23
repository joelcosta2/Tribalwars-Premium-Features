// Centralized building-level snapshots for all villages (screen=main), mirrors resourcesManager.js.

const VILLAGE_BUILDING_LEVELS_FIELD = 'village_building_levels';
const VILLAGE_BUILDINGS_FETCHED_AT_FIELD = 'village_buildings_fetched_at';

/**
 * Reads building id -> level pairs from a village's #buildings table (screen=main). The
 * building id is read from each row's icon filename rather than row position/order, since the
 * level number itself lives in a sibling <span>, not the filename.
 * @param {Document} doc
 * @returns {{[buildingId:string]: number}|null}
 */
function parseVillageBuildingLevels(doc) {
    const buildingsElement = doc?.querySelector?.('#buildings');
    if (!buildingsElement) return null;

    const levels = {};
    buildingsElement.querySelectorAll('tr').forEach(tr => {
        if (!tr.id) return;
        const tds = tr.querySelectorAll('td');
        if (tds.length <= 2) return;

        const img = tds[0].querySelector('img');
        const buildingMatch = img?.src.match(/buildings\/(?:big|mid|small)\/([a-z_]+)\d*\.(?:png|webp)/i);
        const levelMatch = tds[0].querySelector('span')?.textContent.match(/\d+/);
        if (buildingMatch && levelMatch) levels[buildingMatch[1]] = parseInt(levelMatch[0], 10);
    });

    return Object.keys(levels).length ? levels : null;
}

/**
 * Fetches a village's main-building page and persists its building levels, plus a resource
 * snapshot fallback (the resource header bar is present on every game page, this one included).
 * @param {string|number} villageId
 * @returns {Promise<{[buildingId:string]: number}|null>} Resolves to null on failure/no data.
 */
function fetchAndStoreVillageBuildingLevels(villageId) {
    return fetchVillageMainPage(villageId).then(result => {
        const { doc } = result;
        if (!result.buildStateObservation && typeof observeBuildQueueDocument === 'function') {
            result.buildStateObservation = observeBuildQueueDocument(doc, villageId, 'building-levels');
        }
        const levels = parseVillageBuildingLevels(doc);
        if (levels) {
            bqSet(VILLAGE_BUILDING_LEVELS_FIELD, villageId, levels);
            bqSet(VILLAGE_BUILDINGS_FETCHED_AT_FIELD, villageId, Date.now());
        }
        setVillageResources(villageId, readVillageResourceSnapshot(doc));
        return levels;
    }).catch(() => null);
}

/**
 * @param {string|number} villageId
 * @returns {{[buildingId:string]: number}|null}
 */
function getVillageBuildingLevels(villageId) {
    return bqGet(VILLAGE_BUILDING_LEVELS_FIELD, villageId);
}

/**
 * @param {string|number} villageId
 * @param {number} ttlMs
 * @returns {boolean}
 */
function isVillageBuildingLevelsStale(villageId, ttlMs) {
    const fetchedAt = Number(bqGet(VILLAGE_BUILDINGS_FETCHED_AT_FIELD, villageId) || 0);
    return !fetchedAt || Date.now() - fetchedAt >= ttlMs;
}
