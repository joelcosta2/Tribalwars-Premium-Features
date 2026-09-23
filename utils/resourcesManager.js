// Centralized resource snapshots for all villages.

const VILLAGE_RESOURCES_FIELD = 'village_resources';
const RESOURCES_OVERVIEW_LAST_FETCH_KEY = 'resources_overview_last_fetch_at';
const RESOURCES_OVERVIEW_TTL_MS = 15 * 60 * 1000;

var villageResourcesMemoryCache = {};
var resourcesOverviewFetchPromise = null;

function normalizeResourceVillageId(villageId) {
    const resolvedId = villageId ?? game_data?.village?.id;
    return resolvedId == null || resolvedId === '' ? null : String(resolvedId);
}

function normalizeResourceSnapshot(snapshot) {
    if (!snapshot || !['wood', 'stone', 'iron'].every(resource => Number.isFinite(Number(snapshot[resource])))) {
        return null;
    }

    const normalized = {
        wood: Number(snapshot.wood),
        stone: Number(snapshot.stone),
        iron: Number(snapshot.iron),
        fetchedAt: Number.isFinite(Number(snapshot.fetchedAt)) ? Number(snapshot.fetchedAt) : Date.now()
    };
    // pop/popMax are optional (only present when the source page carries a population header).
    if (Number.isFinite(Number(snapshot.pop))) normalized.pop = Number(snapshot.pop);
    if (Number.isFinite(Number(snapshot.popMax))) normalized.popMax = Number(snapshot.popMax);
    return normalized;
}

/**
 * Reads all resource cells from the visible production table page.
 * @param {Document|string} source
 * @returns {Array<{villageId:string, snapshot:{wood:number, stone:number, iron:number}}>}
 */
function parseOverviewVillagesResources(source) {
    const doc = typeof source === 'string'
        ? new DOMParser().parseFromString(source, 'text/html')
        : source;
    if (!doc || typeof doc.querySelectorAll !== 'function') return [];

    const villages = [];
    doc.querySelectorAll('#production_table tbody tr').forEach(row => {
        const villageElement = row.querySelector('.quickedit-vn[data-id]');
        const villageId = villageElement?.dataset?.id;
        if (!villageId) return;

        const wood = row.querySelector('.res.wood');
        const stone = row.querySelector('.res.stone');
        const iron = row.querySelector('.res.iron');
        if (!wood || !stone || !iron) return;

        const readAmount = element => parseInt(element.textContent.replace(/\D/g, '') || '0', 10);
        villages.push({
            villageId: String(villageId),
            snapshot: normalizeResourceSnapshot({
                wood: readAmount(wood),
                stone: readAmount(stone),
                iron: readAmount(iron)
            })
        });
    });

    return villages;
}

function parseOverviewVillagesList(source) {
    const doc = typeof source === 'string'
        ? new DOMParser().parseFromString(source, 'text/html')
        : source;
    if (!doc || typeof doc.querySelectorAll !== 'function') return [];

    const villages = [];
    const seenVillageIds = new Set();
    doc.querySelectorAll('#production_table tbody tr .quickedit-vn[data-id]').forEach(villageElement => {
        const villageId = String(villageElement.dataset.id || '');
        const link = villageElement.querySelector('.quickedit-content > a');
        const label = villageElement.querySelector('.quickedit-label');
        if (!villageId || !link || !label || seenVillageIds.has(villageId)) return;

        const villageUrl = new URL(link.href, window.location.origin);
        if (villageUrl.searchParams.get('village') !== villageId) return;

        const labelText = label.textContent || '';
        const coordsMatch = labelText.match(/\((\d{1,3}\|\d{1,3})\)/);
        if (!coordsMatch) return;

        const name = (label.dataset.text || labelText.slice(0, coordsMatch.index)).trim();
        if (!name) return;

        seenVillageIds.add(villageId);
        villages.push({ name, url: villageUrl.toString(), coords: coordsMatch[1] });
    });

    return villages;
}

/**
 * Returns the latest persisted snapshot, or null when this village has never been observed.
 * @param {string|number} villageId
 * @returns {{wood:number, stone:number, iron:number, fetchedAt:number}|null}
 */
function getVillageResources(villageId) {
    const normalizedVillageId = normalizeResourceVillageId(villageId);
    if (!normalizedVillageId) return null;
    return villageResourcesMemoryCache[normalizedVillageId]
        || bqGet(VILLAGE_RESOURCES_FIELD, normalizedVillageId)
        || null;
}

/**
 * Stores one resource snapshot in the shared per-village IndexedDB record.
 * @param {string|number} villageId
 * @param {{wood:number, stone:number, iron:number, fetchedAt?:number}} snapshot
 * @returns {boolean} Whether the snapshot was accepted.
 */
function setVillageResources(villageId, snapshot) {
    const normalizedVillageId = normalizeResourceVillageId(villageId);
    const normalizedSnapshot = normalizeResourceSnapshot(snapshot);
    if (!normalizedVillageId || !normalizedSnapshot) return false;

    villageResourcesMemoryCache[normalizedVillageId] = normalizedSnapshot;
    bqSet(VILLAGE_RESOURCES_FIELD, normalizedVillageId, normalizedSnapshot);
    return true;
}

function invalidateVillageResources(villageIds) {
    (Array.isArray(villageIds) ? villageIds : [villageIds]).forEach(villageId => {
        const normalizedVillageId = normalizeResourceVillageId(villageId);
        if (!normalizedVillageId) return;
        delete villageResourcesMemoryCache[normalizedVillageId];
    });
}

/**
 * Parses and stores the resource header from an individual village page.
 * @param {Document|string} source
 * @param {string|number} villageId
 * @returns {{wood:number, stone:number, iron:number, fetchedAt:number}|null}
 */
function storeVillageResourcesFromPage(source, villageId) {
    const snapshot = readVillageResourceSnapshot(source);
    if (!setVillageResources(villageId, snapshot)) return null;
    return getVillageResources(villageId);
}

function updateVillagesInfo(villages) {
    if (!villages.length) return;
    try {
        const existing = JSON.parse(localStorage.getItem('villages_info') || '[]');
        const knownVillages = Array.isArray(existing) ? existing : [];
        const byId = new Map(knownVillages.map(village => {
            const id = new URL(village.url, window.location.origin).searchParams.get('village');
            return [String(id), village];
        }));
        villages.forEach(village => {
            const id = new URL(village.url, window.location.origin).searchParams.get('village');
            byId.set(String(id), village);
        });
        safeLocalStorageSet('villages_info', JSON.stringify(Array.from(byId.values())));
    } catch (error) {
        console.warn('[TW Resources] Failed to update villages_info', error);
    }
}

/**
 * Parses and persists the current overview page. Only rows present in the supplied document
 * are updated, so this also works when the overview is paginated.
 * @param {Document|string} source
 * @returns {Array<{villageId:string, snapshot:Object}>}
 */
function storeOverviewVillagesData(source) {
    const resources = parseOverviewVillagesResources(source);
    resources.forEach(item => setVillageResources(item.villageId, item.snapshot));
    updateVillagesInfo(parseOverviewVillagesList(source));
    return resources;
}

function getResourcesOverviewLastFetchAt() {
    const timestamp = Number(localStorage.getItem(RESOURCES_OVERVIEW_LAST_FETCH_KEY));
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function refreshOverviewVillagesResources({ force = false } = {}) {
    if (resourcesOverviewFetchPromise) return resourcesOverviewFetchPromise;

    if (!game_data?.link_base_pure) return Promise.resolve([]);
    if (!force && Date.now() - getResourcesOverviewLastFetchAt() < RESOURCES_OVERVIEW_TTL_MS) {
        return Promise.resolve([]);
    }

    resourcesOverviewFetchPromise = fetchOverviewVillagesPage('prod').then(() => {
        const resources = [];
        safeLocalStorageSet(RESOURCES_OVERVIEW_LAST_FETCH_KEY, String(Date.now()));
        return resources;
    }).catch(error => {
        console.warn('[TW Resources] Failed to refresh overview_villages', error);
        return [];
    }).finally(() => {
        resourcesOverviewFetchPromise = null;
    });

    return resourcesOverviewFetchPromise;
}