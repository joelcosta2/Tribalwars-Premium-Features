// Centralizes same-origin game-page fetches: one function per page, shared by every feature
// that needs data from it, so concurrent callers for the same page/village reuse a single HTTP
// request instead of firing duplicates (see duplicate_ajax_calls_analysis for the prior bugs).

const _pageFetchInFlight = new Map();

/**
 * Returns the shared in-flight promise for `cacheKey`, starting (and caching) a new
 * fetchWithRetry429 request if none is pending.
 * @param {string} cacheKey - Unique per page+village, e.g. 'train:12345'.
 * @param {string} url
 * @returns {Promise<string>} Raw response text.
 */
function fetchPageOnce(cacheKey, url) {
    if (_pageFetchInFlight.has(cacheKey)) return _pageFetchInFlight.get(cacheKey);
    const promise = fetchWithRetry429({ url: url, type: 'GET', cache: false })
        .finally(function () { _pageFetchInFlight.delete(cacheKey); });
    _pageFetchInFlight.set(cacheKey, promise);
    return promise;
}

/**
 * Fetches a village's screen=main page. Shared by the build-queue widget (queue/timer parsing,
 * see widgets/extraBuildQueue.js:fetchVillageMainPage) and building-level tracking (see
 * utils/buildingsManager.js:fetchAndStoreVillageBuildingLevels), so both draw from one request.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 * @returns {Promise<{doc: Document, html: string}>}
 */
function fetchMainPage(villageId) {
    const vId = villageId || game_data?.village?.id;
    return fetchPageOnce('main:' + vId, getVillageLinkBase(vId) + 'main').then(function (html) {
        return { doc: new DOMParser().parseFromString(html, 'text/html'), html: html };
    });
}

/**
 * Fetches a village's screen=train page and stores everything extractable from it in one pass:
 * unit recruit costs/metadata, per-village unit counts, training-queue totals, and a resource
 * snapshot and training finish times — shared by the overview info panel
 * (features/overview.js:fetchTrainInfo) and the overview_villages troops column
 * (features/overviewVillages/troopsTable.js).
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 * @param {{updateTiles?: boolean}} [options] - Kept for call-site compatibility; rendering is
 * handled by the feature after it reads the stored snapshot.
 * @returns {Promise<void>} Resolves after the page has been parsed and persisted.
 */
function fetchTrainPage(villageId, { updateTiles = false } = {}) {
    const vId = villageId || game_data?.village?.id || 'unknown';
    return fetchPageOnce('train:' + vId, getVillageLinkBase(vId) + 'train').then(function (html) {
        storeAvailableUnitsCosts(html, vId);
        storeTrainQueueData(html, vId);
        storeVillageResourceSnapshot(html, vId);
        storeTrainFinishTimes(vId, parseTrainFinishTimes(html));
    });
}

function parseTrainFinishTimes(data) {
    const finishTimes = { barracks: [], stable: [], garage: [], fetchedAt: Date.now() };
    ['barracks', 'stable', 'garage'].forEach(function (building) {
        $(data).find('#trainqueue_wrap_' + building + ' td').each(function () {
            const timestamp = extractBuildTimestampFromHTML($(this).text().trim());
            if (timestamp) finishTimes[building].push(timestamp);
        });
    });
    return finishTimes;
}

/**
 * Fetches a village's screen=storage page and stores its wood/stone/iron fill end-times, shared
 * by the overview info panel (features/overview.js:getStorageTime) and the overview_villages
 * storage-hover column (features/overviewVillages/productionTable.js:fetchVillageStorageTimes).
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 * @returns {Promise<void>} Resolves after the page has been parsed and persisted.
 */
function fetchStoragePage(villageId) {
    const vId = villageId || game_data?.village?.id || 'unknown';
    return fetchPageOnce('storage:' + vId, getVillageLinkBase(vId) + 'storage').then(function (html) {
        const spans = $(html).find('span[data-endtime]');
        const times = {
            wood: parseInt($(spans[0]).attr('data-endtime')) || 0,
            stone: parseInt($(spans[1]).attr('data-endtime')) || 0,
            iron: parseInt($(spans[2]).attr('data-endtime')) || 0
        };
        storeStorageFillTimes(vId, times);
    });
}

/**
 * Fetches a village's screen=market&mode=transports page (a superset of the plain market page:
 * also carries merchant availability) and stores the full transport snapshot, shared by the
 * overview info panel (features/overview.js:getMarketInfo) and
 * utils/marketTransports.js:fetchAndStoreVillageMarketTransports.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 * @returns {Promise<Object>} The stored market_transports snapshot (see storeMarketTransports).
 */
function fetchMarketPage(villageId) {
    const vId = villageId || game_data?.village?.id || 'unknown';
    return fetchPageOnce('market:' + vId, getVillageLinkBase(vId) + 'market&mode=transports').then(function (html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        storeMarketTransports(vId, parseMarketTransportsPage(doc, vId));
    });
}

/**
 * Fetches a village's screen=place&mode=command page and stores its outgoing/incoming rally
 * point commands, delegating parsing to utils/commandsManager.js's own helpers.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 * @returns {Promise<void>} Resolves after the commands snapshot has been parsed and persisted.
 */
function fetchPlaceCommandPage(villageId) {
    const vId = villageId || game_data?.village?.id || 'unknown';
    return fetchPageOnce('place-command:' + vId, getVillageLinkBase(vId) + 'place&mode=command').then(function (html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        storeCommands(vId, parsePlaceCommandsPage(doc, vId));
    });
}

/**
 * Fetches the screen=overview_villages page, optionally with a `mode` query param. The production
 * mode is parsed and persisted by resourcesManager.js; other modes continue to return raw HTML.
 * @param {string} [mode] - e.g. 'prod'. Omit for the plain village-list page.
 * @returns {Promise<string|void>} Raw response HTML, or void for the persisted production mode.
 */
function fetchOverviewVillagesPage(mode) {
    const url = game_data.link_base_pure + 'overview_villages' + (mode ? '&mode=' + mode : '');
    return fetchPageOnce('overview_villages:' + (mode || 'plain'), url).then(function (html) {
        if (mode === 'prod') {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            storeOverviewVillagesData(doc);
            return;
        }
        return html;
    });
}
