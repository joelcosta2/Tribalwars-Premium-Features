// IndexedDB-backed storage — localStorage has a small per-origin quota that becomes a real
// ceiling once an account has many villages/reports; IndexedDB does not.

const TW_DB_NAME = 'tw_premium_features';
const BUILD_QUEUE_STORE_NAME = 'build_queue';
const WORLD_REPORTS_STORE_NAME = 'world_reports';
const VILLAGE_NOTEPAD_STORE_NAME = 'village_notepad';
const VILLAGE_PROFILE_NOTES_STORE_NAME = 'village_profile_notes';
const MAP_DATA_STORE_NAME = 'map_data';
const ALLY_RESERVATIONS_STORE_NAME = 'ally_reservations';
const QUICK_FARM_ATTACKS_STORE_NAME = 'quick_farm_ongoing_attacks';

var twDbPromise = null;
// One entry per village: { [villageId]: { building_queue, building_queue_active, ... } }
var buildQueueMemoryCache = {};
// One entry per village: { [villageId]: noteText }
var notepadMemoryCache = {};
// One entry per village profile: { [villageId]: noteText }
var villageProfileNotesMemoryCache = {};
// One entry per map/*.txt dump: { 'map_villages': rawText, 'map_players': rawText, 'map_allies': rawText }
var mapDataMemoryCache = {};
// One entry per reserved village: { [villageId]: { reservationId, villageId, coords, targetPlayerId, reservingPlayerId, reservingPlayerName, expiresAtMs } }
var allyReservationsMemoryCache = {};

/**
 * Returns the canonical cache/IndexedDB key for a village.
 * IndexedDB treats numeric and string keys as different values, so village ids
 * must use one type at every storage boundary.
 * @param {string|number} [villageId]
 * @returns {string}
 */
function normalizeBuildQueueVillageId(villageId) {
    const resolvedId = villageId ?? game_data?.village?.id;
    return resolvedId == null || resolvedId === '' ? '_no_village' : String(resolvedId);
}

/**
 * Opens (or returns the cached open) shared IndexedDB database used by all script features.
 * Creates any object store that doesn't exist yet — safe for both fresh installs and upgrades
 * from an earlier version that only had `build_queue`.
 * @returns {Promise<IDBDatabase>}
 */
function openTwDb() {
    if (twDbPromise) return twDbPromise;
    twDbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB unavailable'));
            return;
        }
        const request = indexedDB.open(TW_DB_NAME, 7);
        request.onupgradeneeded = function () {
            const db = request.result;
            if (!db.objectStoreNames.contains(BUILD_QUEUE_STORE_NAME)) {
                db.createObjectStore(BUILD_QUEUE_STORE_NAME);
            }
            if (!db.objectStoreNames.contains(WORLD_REPORTS_STORE_NAME)) {
                db.createObjectStore(WORLD_REPORTS_STORE_NAME);
            }
            if (!db.objectStoreNames.contains(VILLAGE_NOTEPAD_STORE_NAME)) {
                db.createObjectStore(VILLAGE_NOTEPAD_STORE_NAME);
            }
            if (!db.objectStoreNames.contains(VILLAGE_PROFILE_NOTES_STORE_NAME)) {
                db.createObjectStore(VILLAGE_PROFILE_NOTES_STORE_NAME);
            }
            if (!db.objectStoreNames.contains(MAP_DATA_STORE_NAME)) {
                db.createObjectStore(MAP_DATA_STORE_NAME);
            }
            if (!db.objectStoreNames.contains(ALLY_RESERVATIONS_STORE_NAME)) {
                db.createObjectStore(ALLY_RESERVATIONS_STORE_NAME);
            }
            if (!db.objectStoreNames.contains(QUICK_FARM_ATTACKS_STORE_NAME)) {
                const store = db.createObjectStore(QUICK_FARM_ATTACKS_STORE_NAME, { keyPath: 'id' });
                store.createIndex('sourceVillageKey', 'sourceVillageKey', { unique: false });
                store.createIndex('status', 'status', { unique: false });
                store.createIndex('sentAtMs', 'sentAtMs', { unique: false });
                store.createIndex('targetVillageId', 'targetVillageId', { unique: false });
            }
        };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
    });
    return twDbPromise;
}

function createQuickFarmAttackId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'qfa_' + Date.now() + '_' + Math.random().toString(36).slice(2);
}

/**
 * Shared boilerplate for every single-key store/delete helper below (idbSet, reportSet,
 * notepadSet, ...): opens the request-building callback against the given store, resolves once
 * the request settles, and reports (never throws) any failure via reportStorageError. Also
 * catches a rejected openTwDb() (e.g. IndexedDB unavailable) the same way.
 * @param {string} storeName
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest} buildRequest
 * @param {string} context - Passed to reportStorageError, e.g. 'saving notepad for village 123'.
 * @returns {Promise<void>} Never rejects.
 */
function performIdbWrite(storeName, mode, buildRequest, context) {
    return openTwDb().then(db => new Promise(resolve => {
        const request = buildRequest(db.transaction(storeName, mode).objectStore(storeName));
        request.onsuccess = function () { resolve(); };
        request.onerror = function () { resolve(request.error); };
    })).then(error => {
        if (error) reportStorageError(error, context);
    }).catch(e => reportStorageError(e, context));
}

/**
 * Shared boilerplate for hydrate*Cache() functions: fetches every key+value from storeName in
 * parallel, then calls populate(keys, values) once both requests settle. Logs and resolves
 * (never rejects) on any IndexedDB failure.
 * @param {string} storeName
 * @param {string} logLabel - Used in the console.warn message on failure, e.g. '[TW Notepad]'.
 * @param {(keys: Array, values: Array) => void} populate
 * @returns {Promise<void>}
 */
function hydrateStoreToCache(storeName, logLabel, populate) {
    return openTwDb().then(db => new Promise(resolve => {
        const store = db.transaction(storeName, 'readonly').objectStore(storeName);
        const keysRequest = store.getAllKeys();
        const valuesRequest = store.getAll();
        let pending = 2;
        let keys, values;
        function done() {
            pending--;
            if (pending === 0) {
                populate(keys || [], values || []);
                resolve();
            }
        }
        keysRequest.onsuccess = function () { keys = keysRequest.result; done(); };
        keysRequest.onerror = done;
        valuesRequest.onsuccess = function () { values = valuesRequest.result; done(); };
        valuesRequest.onerror = done;
    })).catch(e => console.warn(logLabel + ' hydrate failed', e));
}

/**
 * Shared boilerplate for *ReplaceAll() functions: clears storeName then bulk-writes every entry
 * in normalizedEntries (already validated/filtered by the caller, and already applied to the
 * in-memory cache). Logs and resolves (never rejects) on any IndexedDB failure.
 * @param {string} storeName
 * @param {{[key:string]: *}} normalizedEntries
 * @param {string} contextLabel - Passed to reportStorageError on a mid-transaction failure.
 * @param {string} logLabel - Used in the console.warn message on a promise-chain failure.
 * @returns {Promise<void>}
 */
function replaceAllInStore(storeName, normalizedEntries, contextLabel, logLabel) {
    return openTwDb().then(db => new Promise(resolve => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);

        tx.oncomplete = function () { resolve(); };
        tx.onerror = function (event) {
            reportStorageError(event.target.error, contextLabel);
            resolve();
        };

        const clearRequest = store.clear();
        clearRequest.onsuccess = function () {
            Object.entries(normalizedEntries).forEach(([key, value]) => {
                store.put(value, key);
            });
        };
        clearRequest.onerror = function () { resolve(); };
    })).catch(e => console.warn(logLabel + ' replaceAll failed', e));
}

/**
 * Persists a successful quick-farm attack without affecting the attack result if storage fails.
 * The record is intentionally created at the call site, where template and origin metadata exist.
 * @param {Object} attack
 * @returns {Promise<void>}
 */
function recordQuickFarmAttack(attack) {
    const world = String(attack?.world || game_data?.world || window.location.hostname || 'unknown_world');
    const playerId = String(attack?.playerId || game_data?.player?.id || 'unknown_player');
    const sourceVillageId = String(attack?.sourceVillageId || game_data?.village?.id || 'unknown_village');
    const targetVillageId = String(attack?.targetVillageId || '');
    const units = Object.keys(attack?.units || {}).reduce((result, unit) => {
        const amount = parseInt(attack.units[unit], 10);
        if (Number.isFinite(amount) && amount > 0) result[unit] = amount;
        return result;
    }, {});
    const sentAtMs = Number.isFinite(attack?.sentAtMs) ? attack.sentAtMs : Date.now();
    const baseline = attack?.previousReportId
        ? { previousReportId: attack.previousReportId, previousReportAtMs: attack.previousReportAtMs }
        : getQuickFarmAttackReportBaseline(targetCoords);
    const record = {
        id: createQuickFarmAttackId(),
        sourceVillageKey: world + '|' + playerId + '|' + sourceVillageId,
        sourceVillageId,
        targetVillageId,
        targetCoords: String(attack?.targetCoords || ''),
        units,
        sentAtMs,
        previousReportId: String(baseline.previousReportId || ''),
        previousReportAtMs: Number.isFinite(baseline.previousReportAtMs) ? baseline.previousReportAtMs : null,
        status: 'ongoing',
        origin: String(attack?.origin || 'unknown'),
        templateSlot: String(attack?.templateSlot || 'unknown'),
        templateName: String(attack?.templateName || ''),
        world,
        playerId
    };

    return performIdbWrite(QUICK_FARM_ATTACKS_STORE_NAME, 'readwrite',
        store => store.put(record),
        'saving quick-farm attack record');
}

function updateQuickFarmAttackStatus(attackId, status, extraFields = {}) {
    return openTwDb().then(db => new Promise(resolve => {
        const transaction = db.transaction(QUICK_FARM_ATTACKS_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(QUICK_FARM_ATTACKS_STORE_NAME);
        let updated = false;
        transaction.oncomplete = function () { resolve(updated); };
        transaction.onerror = function (event) {
            reportStorageError(event.target.error, 'updating quick-farm attack status');
            resolve(false);
        };
        const request = store.get(attackId);
        request.onsuccess = function () {
            const attack = request.result;
            if (!attack) {
                return;
            }
            store.put(Object.assign({}, attack, extraFields, { status }));
            updated = true;
        };
        request.onerror = function () { updated = false; };
    })).catch(() => false);
}

function getQuickFarmAttackReportBaseline(coords) {
    const reportsManager = window.TWPFMapReports;
    const report = reportsManager?.getAll?.()?.find(item => item.coords === coords);
    if (!report || !reportsManager.convertDateToISO) return {};

    const reportAtMs = new Date(reportsManager.convertDateToISO(report.date) || 0).getTime();
    return {
        previousReportId: String(report.id || ''),
        previousReportAtMs: Number.isFinite(reportAtMs) && reportAtMs > 0 ? reportAtMs : null
    };
}

async function reconcileQuickFarmAttacks(attacks, reports) {
    const reportsByCoords = new Map((reports || []).filter(report => report?.coords).map(report => [report.coords, report]));
    const reconciled = [];

    const ongoingAttacks = (attacks || [])
        .filter(attack => attack.status === 'ongoing' && attack.targetCoords && attack.previousReportId)
        .sort((left, right) => left.sentAtMs - right.sentAtMs);

    for (const attack of ongoingAttacks) {
        const report = reportsByCoords.get(attack.targetCoords);
        if (!report || String(report.id || '') === String(attack.previousReportId)) continue;

        const reportAtMs = new Date(window.TWPFMapReports?.convertDateToISO(report.date) || 0).getTime();
        if (!Number.isFinite(reportAtMs) || reportAtMs <= attack.sentAtMs) continue;

        const completed = await updateQuickFarmAttackStatus(attack.id, 'completed', {
            completedReportId: String(report.id || ''),
            completedAtMs: Date.now()
        });
        if (completed) {
            attack.status = 'completed';
            attack.completedReportId = String(report.id || '');
            reconciled.push(attack.id);
        }
    }

    return reconciled;
}

function getQuickFarmAttacksBySourceVillage(sourceVillageId, world, playerId) {
    const resolvedWorld = String(world || game_data?.world || window.location.hostname || 'unknown_world');
    const resolvedPlayerId = String(playerId || game_data?.player?.id || 'unknown_player');
    const sourceVillageKey = resolvedWorld + '|' + resolvedPlayerId + '|' + String(sourceVillageId);

    return openTwDb().then(db => new Promise(resolve => {
        const request = db.transaction(QUICK_FARM_ATTACKS_STORE_NAME, 'readonly')
            .objectStore(QUICK_FARM_ATTACKS_STORE_NAME)
            .index('sourceVillageKey')
            .getAll(sourceVillageKey);
        request.onsuccess = function () {
            resolve((request.result || []).sort((left, right) => left.sentAtMs - right.sentAtMs));
        };
        request.onerror = function () { resolve([]); };
    })).catch(() => []);
}

/**
 * Writes a village's whole record to the build-queue IndexedDB store.
 * @param {string|number} villageId
 * @param {*} record
 * @returns {Promise<void>} Never rejects — persistence failures are logged, not thrown.
 */
function idbSet(villageId, record) {
    const normalizedVillageId = normalizeBuildQueueVillageId(villageId);
    return performIdbWrite(BUILD_QUEUE_STORE_NAME, 'readwrite',
        store => store.put(record, normalizedVillageId),
        'saving build queue for village ' + normalizedVillageId);
}

/**
 * Synchronous read of one field from a village's in-memory build-queue record — mirrors
 * localStorage.getItem's null-when-absent semantics so call sites need minimal changes.
 * @param {string} field - e.g. 'building_queue', 'waiting_for_queue'.
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 * @returns {*} The stored value (array/object/number/etc), or null if absent.
 */
function bqGet(field, villageId) {
    const vId = normalizeBuildQueueVillageId(villageId);
    return buildQueueMemoryCache[vId]?.[field] ?? null;
}

/**
 * Synchronous write of one field into a village's in-memory build-queue record, persisting the
 * whole updated record to IndexedDB in the background (write-behind — callers don't wait).
 * IndexedDB uses the structured clone algorithm, so values are stored natively — no need to
 * JSON.stringify arrays/objects before passing them in (that was a localStorage-only concern).
 * @param {string} field
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 * @param {*} value - Any structured-clonable value (array, object, number, string, etc).
 */
function bqSet(field, villageId, value) {
    const vId = normalizeBuildQueueVillageId(villageId);
    if (!buildQueueMemoryCache[vId]) buildQueueMemoryCache[vId] = {};
    buildQueueMemoryCache[vId][field] = value;
    idbSet(vId, buildQueueMemoryCache[vId]);
}

/**
 * Removes one field from a village's in-memory build-queue record, persisting the change.
 * @param {string} field
 * @param {string|number} [villageId] - Defaults to the currently loaded village.
 */
function bqRemove(field, villageId) {
    const vId = normalizeBuildQueueVillageId(villageId);
    if (!buildQueueMemoryCache[vId]) return;
    delete buildQueueMemoryCache[vId][field];
    idbSet(vId, buildQueueMemoryCache[vId]);
}

/**
 * Applies several per-village fields to the synchronous cache without issuing one IndexedDB
 * transaction per field.  Build Queue v2 uses this while replaying its durable local event log;
 * legacy bqSet/bqRemove callers keep their original immediate write-behind behaviour.
 * @param {Object} fields
 * @param {string|number} [villageId]
 * @returns {Object} The updated in-memory record.
 */
function bqPatchMemory(fields, villageId) {
    const vId = normalizeBuildQueueVillageId(villageId);
    const current = buildQueueMemoryCache[vId] || {};
    buildQueueMemoryCache[vId] = Object.assign({}, current, fields || {});
    return buildQueueMemoryCache[vId];
}

/**
 * Persists one coherent snapshot of a village record.  The value is cloned before the async
 * IndexedDB open/transaction so a later in-memory edit cannot change what this flush commits.
 * @param {string|number} [villageId]
 * @returns {Promise<void>}
 */
function bqPersistVillage(villageId) {
    const vId = normalizeBuildQueueVillageId(villageId);
    const current = buildQueueMemoryCache[vId] || {};
    let snapshot;
    try {
        snapshot = typeof structuredClone === 'function'
            ? structuredClone(current)
            : JSON.parse(JSON.stringify(current));
    } catch (_error) {
        snapshot = Object.assign({}, current);
    }
    return idbSet(vId, snapshot);
}

/** Applies a coherent multi-field patch and optionally persists it as one record write. */
function bqPatch(fields, villageId, options = {}) {
    const record = bqPatchMemory(fields, villageId);
    if (options.persist !== false) bqPersistVillage(villageId);
    return record;
}

window.PremiumFeaturesBuildQueueStorage = Object.assign(
    window.PremiumFeaturesBuildQueueStorage || {},
    {
        get: bqGet,
        patchMemory: bqPatchMemory,
        patch: bqPatch,
        persistVillage: bqPersistVillage,
        listVillageIds: function () { return Object.keys(buildQueueMemoryCache); },
        getRecord: function (villageId) {
            return buildQueueMemoryCache[normalizeBuildQueueVillageId(villageId)] || null;
        }
    }
);

/**
 * Loads every village's persisted build-queue record into the in-memory cache. Must complete
 * before any bqGet/bqSet call site runs (called once at boot, before restoreTimeouts()/start()).
 * @returns {Promise<void>} Resolves even if IndexedDB is unavailable (cache just stays empty).
 */
function hydrateBuildQueueCache() {
    return hydrateStoreToCache(BUILD_QUEUE_STORE_NAME, '[TW BuildQueue]', (keys, values) => {
        keys.forEach((villageId, index) => {
            const normalizedVillageId = normalizeBuildQueueVillageId(villageId);
            buildQueueMemoryCache[normalizedVillageId] = values[index];
        });
        migrateBuildQueueRecordsToNative();
    });
}

// Fields that used to be JSON.stringify'd before being stored (a leftover from the original
// localStorage-based implementation). Used by migrateBuildQueueRecordsToNative() below.
const BUILD_QUEUE_JSON_FIELDS = [
    'building_queue', 'building_queue_levels', 'building_queue_active',
    'building_queue_active_levels', 'building_queue_slots', 'nextLevelBuildsQueueInfo',
    'waiting_for_queue', 'queue_cancelIds'
];

/**
 * One-time, self-guarding migration: converts any legacy JSON-string field values (stored back
 * when this module still mirrored localStorage's string-only API) into their real parsed form,
 * then persists the migrated record back to IndexedDB. Safe to call on every hydration —
 * already-migrated fields simply aren't strings anymore, so they're skipped. Delete this (and
 * its call in hydrateBuildQueueCache) once confirmed no legacy string-encoded records remain.
 */
function migrateBuildQueueRecordsToNative() {
    Object.keys(buildQueueMemoryCache).forEach(villageId => {
        const record = buildQueueMemoryCache[villageId];
        if (!record) return;
        let changed = false;
        BUILD_QUEUE_JSON_FIELDS.forEach(field => {
            if (typeof record[field] === 'string') {
                try {
                    record[field] = JSON.parse(record[field]);
                    changed = true;
                } catch (e) {
                    console.warn('[TW BuildQueue] Failed to migrate field ' + field + ' for village ' + villageId, e);
                }
            }
        });
        if (changed) idbSet(villageId, record);
    });
}

// Prefixes of legacy per-village recruit/troops localStorage keys, now stored as
// unit_managers_costs/village_unit_counts/train_queue_data fields on the same per-village
// record used by the build queue (via bqGet/bqSet — these accessors aren't build-queue-only
// anymore, just generic per-village field storage). `unit_managers_meta` is NOT included here —
// it's global (not per-village) and stays on localStorage.
const RECRUIT_QUEUE_CLEANUP_FLAG = 'idb_rq_cleanup_v1_done';
const LEGACY_RECRUIT_QUEUE_KEY_PREFIXES = [
    'unit_managers_costs_', 'village_unit_counts_', 'train_queue_data_'
];

/**
 * One-time cleanup: deletes every legacy per-village recruit/troops localStorage key now that
 * this data lives in IndexedDB. Not a migration/copy (data is cheap to regenerate from the next
 * /train page visit) — just reclaims space. Guarded so it only ever runs once. Delete this (and
 * its call in init()) once confirmed no legacy keys remain.
 */
function cleanupLegacyRecruitQueueLocalStorage() {
    if (localStorage.getItem(RECRUIT_QUEUE_CLEANUP_FLAG)) return;
    Object.keys(localStorage).forEach(key => {
        if (LEGACY_RECRUIT_QUEUE_KEY_PREFIXES.some(prefix => key.startsWith(prefix))) {
            localStorage.removeItem(key);
        }
    });
    localStorage.setItem(RECRUIT_QUEUE_CLEANUP_FLAG, '1');
}

/**
 * Writes a single world coordinate's report record to the world_reports IndexedDB store.
 * @param {string} coords
 * @param {*} record
 * @returns {Promise<void>} Never rejects — persistence failures are logged, not thrown.
 */
function reportSet(coords, record) {
    return performIdbWrite(WORLD_REPORTS_STORE_NAME, 'readwrite',
        store => store.put(record, coords),
        'saving report for ' + coords);
}

/**
 * Deletes a single world coordinate's report record (used by the 30-day pruning pass).
 * @param {string} coords
 * @returns {Promise<void>} Never rejects.
 */
function reportRemove(coords) {
    return performIdbWrite(WORLD_REPORTS_STORE_NAME, 'readwrite',
        store => store.delete(coords),
        'deleting report for ' + coords);
}

/**
 * Removes cached reports only when their stored report ID is in the confirmed ID set.
 * The store is keyed by coordinates, so deleting by coordinates alone could remove a
 * newer report that replaced the report deleted on the server.
 * @param {Iterable<string|number>} reportIds
 * @returns {Promise<Array>} The records removed from IndexedDB.
 */
function reportRemoveByIds(reportIds) {
    const ids = new Set(Array.from(reportIds || [], id => String(id)));
    if (ids.size === 0) return Promise.resolve([]);

    return openTwDb().then(db => new Promise(resolve => {
        const removed = [];
        const transaction = db.transaction(WORLD_REPORTS_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(WORLD_REPORTS_STORE_NAME);
        const request = store.openCursor();

        request.onsuccess = function (event) {
            const cursor = event.target.result;
            if (!cursor) return;
            if (ids.has(String(cursor.value?.id || ''))) {
                removed.push(cursor.value);
                cursor.delete();
            }
            cursor.continue();
        };
        request.onerror = function () { resolve([]); };
        transaction.oncomplete = function () { resolve(removed); };
        transaction.onerror = function () { resolve([]); };
    })).catch(() => []);
}

/**
 * Reads every stored report record. Each record has `coords` denormalized into its own value,
 * so no key-pairing is needed (unlike hydrateBuildQueueCache, which stores fields without ids).
 * @returns {Promise<Array>} Resolves to [] if unavailable — never rejects.
 */
function reportGetAll() {
    return openTwDb().then(db => new Promise(resolve => {
        const request = db.transaction(WORLD_REPORTS_STORE_NAME, 'readonly').objectStore(WORLD_REPORTS_STORE_NAME).getAll();
        request.onsuccess = function () { resolve(request.result || []); };
        request.onerror = function () { resolve([]); };
    })).catch(() => []);
}

// Legacy localStorage key holding the report list array (replaced by the world_reports store).
// `reports_last_fetch` is a tiny global timestamp, not per-coord — deliberately left untouched.
const REPORTS_CLEANUP_FLAG = 'idb_reports_cleanup_v1_done';

/**
 * One-time cleanup: deletes the old `reports_list` localStorage key now that report data lives
 * in IndexedDB, keyed by coordinate. Not a migration/copy — cached attack reports are cheap to
 * resync. Guarded so it only ever runs once. Delete this (and its call in init()) once confirmed
 * no legacy key remains.
 */
function cleanupLegacyReportsLocalStorage() {
    if (localStorage.getItem(REPORTS_CLEANUP_FLAG)) return;
    localStorage.removeItem('reports_list');
    localStorage.setItem(REPORTS_CLEANUP_FLAG, '1');
}

const NOTEPAD_CLEANUP_FLAG = 'idb_notepad_cleanup_v1_done';

/**
 * Returns the full in-memory notepad cache, keyed by village id.
 * @returns {{[villageId: string]: string}}
 */
function notepadGetAll() {
    return notepadMemoryCache;
}

function villageProfileNoteGet(villageId) {
    return villageProfileNotesMemoryCache[String(villageId)] ?? '';
}

function villageProfileNoteGetAll() {
    return villageProfileNotesMemoryCache;
}

function villageProfileNoteSet(villageId, noteText) {
    const vId = String(villageId);
    if (noteText == null || noteText === '') {
        delete villageProfileNotesMemoryCache[vId];
        return performIdbWrite(VILLAGE_PROFILE_NOTES_STORE_NAME, 'readwrite',
            store => store.delete(vId),
            'deleting village profile note for village ' + vId);
    }

    villageProfileNotesMemoryCache[vId] = noteText;
    return performIdbWrite(VILLAGE_PROFILE_NOTES_STORE_NAME, 'readwrite',
        store => store.put(noteText, vId),
        'saving village profile note for village ' + vId);
}

/**
 * Replaces every village profile note with the provided map and persists the full replacement.
 * @param {{[villageId: string]: string}} nextNotes
 * @returns {Promise<void>} Never rejects.
 */
function villageProfileNoteReplaceAll(nextNotes) {
    const normalizedNotes = {};
    Object.keys(nextNotes || {}).forEach(villageId => {
        const noteText = nextNotes[villageId];
        if (typeof noteText === 'string' && noteText !== '') {
            normalizedNotes[String(villageId)] = noteText;
        }
    });

    Object.keys(villageProfileNotesMemoryCache).forEach(key => delete villageProfileNotesMemoryCache[key]);
    Object.assign(villageProfileNotesMemoryCache, normalizedNotes);

    return replaceAllInStore(VILLAGE_PROFILE_NOTES_STORE_NAME, normalizedNotes, 'replacing village profile notes', '[TW VillageProfile]');
}

function hydrateVillageProfileNotesCache() {
    return hydrateStoreToCache(VILLAGE_PROFILE_NOTES_STORE_NAME, '[TW VillageProfile]', (keys, values) => {
        villageProfileNotesMemoryCache = {};
        keys.forEach((villageId, index) => {
            if (values[index] != null && values[index] !== '') {
                villageProfileNotesMemoryCache[String(villageId)] = values[index];
            }
        });
    });
}

/**
 * Reads one notepad entry from the in-memory cache.
 * @param {string|number} [villageId]
 * @returns {string}
 */
function notepadGet(villageId) {
    const vId = villageId || game_data?.village?.id || '_no_village';
    return notepadMemoryCache[vId] ?? '';
}

/**
 * Writes one village note to the cache and IndexedDB.
 * @param {string|number} villageId
 * @param {string} noteText
 * @returns {Promise<void>} Never rejects.
 */
function notepadSet(villageId, noteText) {
    const vId = String(villageId);
    if (noteText == null || noteText === '') {
        return notepadDelete(vId);
    }
    notepadMemoryCache[vId] = noteText;
    return performIdbWrite(VILLAGE_NOTEPAD_STORE_NAME, 'readwrite',
        store => store.put(noteText, vId),
        'saving notepad for village ' + vId);
}

/**
 * Deletes one village note from the cache and IndexedDB.
 * @param {string|number} villageId
 * @returns {Promise<void>} Never rejects.
 */
function notepadDelete(villageId) {
    const vId = String(villageId);
    delete notepadMemoryCache[vId];
    return performIdbWrite(VILLAGE_NOTEPAD_STORE_NAME, 'readwrite',
        store => store.delete(vId),
        'deleting notepad for village ' + vId);
}

/**
 * Replaces every notepad entry with the provided map and persists the full replacement.
 * @param {{[villageId: string]: string}} nextNotes
 * @returns {Promise<void>} Never rejects.
 */
function notepadReplaceAll(nextNotes) {
    const normalizedNotes = {};
    Object.keys(nextNotes || {}).forEach(villageId => {
        const noteText = nextNotes[villageId];
        if (typeof noteText === 'string' && noteText !== '') {
            normalizedNotes[String(villageId)] = noteText;
        }
    });

    Object.keys(notepadMemoryCache).forEach(key => delete notepadMemoryCache[key]);
    Object.assign(notepadMemoryCache, normalizedNotes);

    return replaceAllInStore(VILLAGE_NOTEPAD_STORE_NAME, normalizedNotes, 'replacing notepad data', '[TW Notepad]');
}

/**
 * Hydrates the in-memory notepad cache from IndexedDB.
 * @returns {Promise<void>} Resolves even if IndexedDB is unavailable.
 */
function hydrateNotepadCache() {
    return hydrateStoreToCache(VILLAGE_NOTEPAD_STORE_NAME, '[TW Notepad]', (keys, values) => {
        Object.keys(notepadMemoryCache).forEach(key => delete notepadMemoryCache[key]);
        keys.forEach((villageId, index) => {
            const noteText = values[index];
            if (noteText != null && noteText !== '') {
                notepadMemoryCache[villageId] = noteText;
            }
        });
    });
}

/**
 * One-time cleanup for the legacy localStorage-backed notepad key.
 * @returns {Promise<void>} Resolves even if IndexedDB is unavailable.
 */
function cleanupLegacyNotepadStorage() {
    if (localStorage.getItem(NOTEPAD_CLEANUP_FLAG)) return Promise.resolve();
    localStorage.removeItem('vilagges_notepad');
    return openTwDb().then(db => new Promise(resolve => {
        const request = db.transaction(VILLAGE_NOTEPAD_STORE_NAME, 'readwrite').objectStore(VILLAGE_NOTEPAD_STORE_NAME).clear();
        request.onsuccess = function () {
            localStorage.setItem(NOTEPAD_CLEANUP_FLAG, '1');
            resolve();
        };
        request.onerror = function () {
            localStorage.setItem(NOTEPAD_CLEANUP_FLAG, '1');
            resolve();
        };
    })).catch(e => {
        console.warn('[TW Notepad] cleanupLegacyNotepadStorage failed', e);
        localStorage.setItem(NOTEPAD_CLEANUP_FLAG, '1');
    });
}

/**
 * Synchronous read of a cached map/*.txt raw-text dump from the in-memory cache — mirrors
 * localStorage.getItem's empty-string-when-absent semantics for drop-in replacement.
 * @param {string} key - e.g. 'map_villages', 'map_players', 'map_allies'.
 * @returns {string}
 */
function mapDataGetRaw(key) {
    return mapDataMemoryCache[key] || '';
}

/**
 * Writes a map/*.txt raw-text dump to the in-memory cache and IndexedDB (these dumps can be
 * several MB for large worlds — too big for localStorage's quota, hence IndexedDB here).
 * @param {string} key
 * @param {string} text
 * @returns {Promise<void>} Never rejects — persistence failures are logged, not thrown.
 */
function mapDataSet(key, text) {
    mapDataMemoryCache[key] = text;
    return performIdbWrite(MAP_DATA_STORE_NAME, 'readwrite',
        store => store.put(text, key),
        'saving map data ' + key);
}

/**
 * Hydrates the in-memory map-data cache from IndexedDB. Must complete before any
 * mapDataGetRaw() call site runs (called once at boot, before start()).
 * @returns {Promise<void>} Resolves even if IndexedDB is unavailable.
 */
function hydrateMapDataCache() {
    return hydrateStoreToCache(MAP_DATA_STORE_NAME, '[TW MapData]', (keys, values) => {
        keys.forEach((key, index) => { mapDataMemoryCache[key] = values[index]; });
    });
}

const MAP_DATA_CLEANUP_FLAG = 'idb_map_data_cleanup_v1_done';

/**
 * One-time cleanup: deletes the legacy localStorage-backed map_villages/map_players/map_allies
 * raw-text keys (the original cause of the QuotaExceededError) now that this data lives in
 * IndexedDB. The small *_last_update timestamp keys are left untouched. Not a migration/copy —
 * these dumps are cheap to refetch from the server. Guarded so it only ever runs once.
 */
function cleanupLegacyMapDataLocalStorage() {
    if (localStorage.getItem(MAP_DATA_CLEANUP_FLAG)) return;
    ['map_villages', 'map_players', 'map_allies'].forEach(key => localStorage.removeItem(key));
    localStorage.setItem(MAP_DATA_CLEANUP_FLAG, '1');
}

/**
 * Returns the full in-memory ally-reservations cache, keyed by village id.
 * @returns {{[villageId: string]: {reservationId, villageId, coords, targetPlayerId, reservingPlayerId, reservingPlayerName, expiresAtMs}}}
 */
function reservationsGetAll() {
    return allyReservationsMemoryCache;
}

/**
 * Writes a single village's reservation record to the cache and IndexedDB — used for the
 * optimistic update right after the user reserves a village via the map context menu.
 * @param {string|number} villageId
 * @param {*} record
 * @returns {Promise<void>} Never rejects.
 */
function reservationSet(villageId, record) {
    const vId = String(villageId);
    allyReservationsMemoryCache[vId] = record;
    return performIdbWrite(ALLY_RESERVATIONS_STORE_NAME, 'readwrite',
        store => store.put(record, vId),
        'saving reservation for village ' + vId);
}

/**
 * Deletes a single village's reservation record from the cache and IndexedDB — used for the
 * optimistic update right after the user unreserves a village via the map context menu.
 * @param {string|number} villageId
 * @returns {Promise<void>} Never rejects.
 */
function reservationRemove(villageId) {
    const vId = String(villageId);
    delete allyReservationsMemoryCache[vId];
    return performIdbWrite(ALLY_RESERVATIONS_STORE_NAME, 'readwrite',
        store => store.delete(vId),
        'deleting reservation for village ' + vId);
}

/**
 * Replaces every cached reservation with the provided map and persists the full replacement —
 * used after each hourly full resync of the tribe's reservations list.
 * @param {{[villageId: string]: *}} nextReservations
 * @returns {Promise<void>} Never rejects.
 */
function reservationsReplaceAll(nextReservations) {
    const normalized = {};
    Object.keys(nextReservations || {}).forEach(villageId => {
        normalized[String(villageId)] = nextReservations[villageId];
    });

    Object.keys(allyReservationsMemoryCache).forEach(key => delete allyReservationsMemoryCache[key]);
    Object.assign(allyReservationsMemoryCache, normalized);

    return replaceAllInStore(ALLY_RESERVATIONS_STORE_NAME, normalized, 'replacing reservation data', '[TW Reservations]');
}

/**
 * Hydrates the in-memory ally-reservations cache from IndexedDB.
 * @returns {Promise<void>} Resolves even if IndexedDB is unavailable.
 */
function hydrateReservationsCache() {
    return hydrateStoreToCache(ALLY_RESERVATIONS_STORE_NAME, '[TW Reservations]', (keys, values) => {
        Object.keys(allyReservationsMemoryCache).forEach(key => delete allyReservationsMemoryCache[key]);
        keys.forEach((villageId, index) => { allyReservationsMemoryCache[villageId] = values[index]; });
    });
}
