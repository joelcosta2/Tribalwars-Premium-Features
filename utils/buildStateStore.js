// Local-first Build Queue intent log, per-village build state and fenced reconciliation.
(function (root) {
    'use strict';

    const BUILD_QUEUE_STATE = Object.freeze({
        IDLE: 'IDLE',
        WAITING_SLOT: 'WAITING_SLOT',
        WAITING_RESOURCES: 'WAITING_RESOURCES',
        WAITING_POPULATION: 'WAITING_POPULATION',
        READY: 'READY',
        EXECUTING: 'EXECUTING',
        RECONCILING: 'RECONCILING',
        SOFT_PAUSED: 'SOFT_PAUSED',
        UNCERTAIN: 'UNCERTAIN'
    });
    const BUILD_INSTANT_STATE = Object.freeze({
        IDLE: 'IDLE',
        WAITING_WINDOW: 'WAITING_WINDOW',
        WAITING_FREE_CONFIRMATION: 'WAITING_FREE_CONFIRMATION',
        CHECKING: 'CHECKING',
        EXECUTING: 'EXECUTING',
        STALE: 'STALE',
        SOFT_PAUSED: 'SOFT_PAUSED',
        UNCERTAIN: 'UNCERTAIN'
    });
    const INTENT_VERSION = 2;
    const DEFAULT_EDIT_DEBOUNCE_MS = 800;
    const DEFAULT_FALLBACK_MS = 5 * 60 * 1000;

    function clone(value) {
        if (value == null) return value;
        try {
            return typeof structuredClone === 'function'
                ? structuredClone(value)
                : JSON.parse(JSON.stringify(value));
        } catch (_error) {
            return value;
        }
    }

    function makeLocalId(cryptoObject) {
        if (cryptoObject && typeof cryptoObject.randomUUID === 'function') return cryptoObject.randomUUID();
        return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }

    function storageKeys(storage) {
        const keys = new Set();
        try {
            for (let index = 0; index < Number(storage?.length || 0); index++) {
                const key = storage.key(index);
                if (key != null) keys.add(key);
            }
            Object.keys(storage || {}).forEach(key => keys.add(key));
        } catch (_error) { /* an unavailable store behaves as empty */ }
        return Array.from(keys);
    }

    function safeParse(raw) {
        if (!raw) return null;
        try { return JSON.parse(raw); } catch (_error) { return null; }
    }

    function compareEvents(first, second) {
        return Number(first.createdAt) - Number(second.createdAt) ||
            String(first.actorId).localeCompare(String(second.actorId)) ||
            Number(first.sequence) - Number(second.sequence) ||
            String(first.id).localeCompare(String(second.id));
    }

    function createBuildStateStore(options = {}) {
        const host = options.host || root;
        const storage = options.storage || host.localStorage;
        const queueStorage = options.queueStorage || host.PremiumFeaturesBuildQueueStorage;
        const coordination = options.coordination === undefined
            ? host.PremiumFeaturesCoordination
            : options.coordination;
        const runtime = options.runtime === undefined
            ? host.PremiumFeaturesRuntimeRegistry
            : options.runtime;
        const writeBehind = options.writeBehind === undefined
            ? host.PremiumFeaturesWriteBehind
            : options.writeBehind;
        const clock = options.clock || host;
        const now = options.now || (() => Date.now());
        const hash = options.hash || host.PremiumFeaturesAsync?.stableSnapshotHash || function (value) {
            return JSON.stringify(value);
        };
        const actorId = options.actorId || coordination?.instanceId || makeLocalId(host.crypto);
        const scope = encodeURIComponent(options.scope || coordination?.scope || [
            host.location?.hostname || 'unknown-host',
            host.game_data?.world || 'unknown-world',
            host.game_data?.player?.id || 'unknown-player'
        ].join(':'));
        const eventPrefix = 'twpf_build_queue_event_v2:' + scope + ':';
        const snapshotPrefix = 'twpf_build_queue_intent_v2:' + scope + ':';
        const runtimePrefix = 'twpf_build_state_v1:' + scope + ':';
        const records = options.records || {};
        const listeners = new Set();
        const announcedEventIds = new Set();
        const compactTimers = new Map();
        const seenLimit = Math.max(64, Number(options.seenLimit) || 512);
        const compactDelayMs = Math.max(10, Number(options.compactDelayMs) || 250);
        let sequence = 0;
        let started = false;
        let unsubscribeIntent = null;
        let unsubscribeSnapshot = null;
        let unsubscribeResourceInvalidation = null;
        let unsubscribeInvalidation = null;
        let unsubscribeObservation = null;

        function normalizeVillageId(villageId) {
            const resolved = villageId ?? host.game_data?.village?.id;
            return resolved == null || resolved === '' ? '_no_village' : String(resolved);
        }

        function eventVillagePrefix(villageId) {
            return eventPrefix + encodeURIComponent(normalizeVillageId(villageId)) + ':';
        }

        function eventStorageKey(event) {
            return eventVillagePrefix(event.villageId) + encodeURIComponent(event.id);
        }

        function snapshotStorageKey(villageId) {
            return snapshotPrefix + encodeURIComponent(normalizeVillageId(villageId));
        }

        function runtimeStorageKey(villageId) {
            return runtimePrefix + encodeURIComponent(normalizeVillageId(villageId));
        }

        function readField(field, villageId) {
            return queueStorage?.get?.(field, villageId) ?? null;
        }

        function normalizeItem(item, villageId, index) {
            if (!item) return null;
            if (typeof item === 'string') {
                return {
                    id: 'legacy:' + villageId + ':' + index + ':' + item,
                    buildingId: item,
                    targetLevel: null
                };
            }
            if (!item.buildingId) return null;
            return {
                id: String(item.id || ('legacy:' + villageId + ':' + index + ':' + item.buildingId)),
                buildingId: String(item.buildingId),
                targetLevel: item.targetLevel != null && Number.isFinite(Number(item.targetLevel))
                    ? Number(item.targetLevel)
                    : null,
                addedAt: Number(item.addedAt) || 0
            };
        }

        function initialIntent(villageId) {
            const storedItems = readField('building_queue_items_v2', villageId);
            const legacyQueue = readField('building_queue', villageId) || [];
            const legacyLevels = readField('building_queue_levels', villageId) || [];
            const sourceItems = Array.isArray(storedItems) && storedItems.length
                ? storedItems
                : legacyQueue.map((buildingId, index) => ({
                    id: 'legacy:' + villageId + ':' + index + ':' + buildingId + ':' + (legacyLevels[index] || ''),
                    buildingId,
                    targetLevel: legacyLevels[index] || null,
                    addedAt: 0
                }));
            return {
                queue: sourceItems.map((item, index) => normalizeItem(item, villageId, index)).filter(Boolean),
                revision: Math.max(0, Number(readField('building_queue_revision', villageId)) || 0),
                executionGeneration: Math.max(1, Number(readField('building_queue_execution_generation', villageId)) || 1),
                seenEventIds: []
            };
        }

        function normalizeOfficial(villageId, supplied) {
            const current = supplied || readField('build_state_official_v1', villageId) || {};
            const queue = current.queue || readField('building_queue_active', villageId) || [];
            const levels = current.levels || readField('building_queue_active_levels', villageId) || [];
            const slots = current.slots || readField('building_queue_slots', villageId) || [];
            const maxSlots = Number(current.maxSlots) || (host.game_data?.features?.Premium?.active ? 5 : 2);
            const nextBuildOffers = {};
            Object.keys(current.nextBuildOffers || {}).forEach(function (buildingId) {
                const offer = current.nextBuildOffers[buildingId];
                const level = Number(offer?.level);
                const wood = Number(offer?.wood);
                const stone = Number(offer?.stone);
                const iron = Number(offer?.iron);
                if (!Number.isInteger(level) || level <= 0 || ![wood, stone, iron].every(Number.isFinite)) return;
                nextBuildOffers[String(buildingId)] = {
                    level,
                    wood,
                    stone,
                    iron,
                    pop: Math.max(0, Number(offer.pop) || 0),
                    observedAt: Number(offer.observedAt) || Number(current.fetchedAt) || 0,
                    generation: Math.max(0, Number(offer.generation) || Number(current.generation) || 0),
                    source: offer.source || current.source || 'persisted'
                };
            });
            return {
                queue: Array.isArray(queue) ? queue.slice() : [],
                levels: Array.isArray(levels) ? levels.slice() : [],
                slots: Array.isArray(slots) ? slots.map(Number).filter(Number.isFinite) : [],
                cancelIds: Array.isArray(current.cancelIds)
                    ? current.cancelIds.slice()
                    : (readField('queue_cancelIds', villageId) || []).slice?.() || [],
                // An explicit null from a newer official observation clears an old legacy slot.
                // Nullish coalescing here resurrected completed builds from the legacy mirror.
                nextSlotAt: Number(Object.prototype.hasOwnProperty.call(current, 'nextSlotAt')
                    ? current.nextSlotAt : readField('building_queue_next_slot', villageId)) || null,
                lastSlotAt: Number(Object.prototype.hasOwnProperty.call(current, 'lastSlotAt')
                    ? current.lastSlotAt : readField('building_queue_last_slot', villageId)) || null,
                full: typeof current.full === 'boolean' ? current.full : queue.length >= maxSlots,
                maxSlots,
                currentLevels: Object.assign({}, current.currentLevels || {}),
                nextBuildOffers,
                fetchedAt: Number(current.fetchedAt) || 0,
                generation: Math.max(0, Number(current.generation) || 0),
                source: current.source || 'persisted',
                catalog: current.catalog || readField('build_queue_catalog_v1', villageId) || null,
                instantFree: current.instantFree || null,
                invalidatedBy: current.invalidatedBy || null
            };
        }

        function normalizeResources(villageId, supplied) {
            const current = supplied || readField('build_state_resources_v1', villageId) ||
                readField('village_resources', villageId) || null;
            if (!current) return null;
            if (!['wood', 'stone', 'iron'].every(name => Number.isFinite(Number(current[name])))) return null;
            const normalized = {
                wood: Number(current.wood),
                stone: Number(current.stone),
                iron: Number(current.iron),
                fetchedAt: Number(current.fetchedAt) || 0,
                generation: Math.max(0, Number(current.generation) || 0),
                source: current.source || 'persisted',
                reliableUntil: Number(current.reliableUntil) || null
            };
            if (Number.isFinite(Number(current.pop))) normalized.pop = Number(current.pop);
            if (Number.isFinite(Number(current.popMax))) normalized.popMax = Number(current.popMax);
            if (current.production && ['wood', 'stone', 'iron'].every(name => Number.isFinite(Number(current.production[name])))) {
                normalized.production = {
                    wood: Number(current.production.wood),
                    stone: Number(current.production.stone),
                    iron: Number(current.production.iron)
                };
            }
            return normalized;
        }

        function normalizeExecution(villageId, supplied) {
            const current = supplied || readField('build_queue_execution_v2', villageId) || {};
            return {
                state: Object.values(BUILD_QUEUE_STATE).includes(current.state) ? current.state : BUILD_QUEUE_STATE.IDLE,
                nextDueAt: Number(current.nextDueAt) || null,
                decisionHash: current.decisionHash || null,
                reason: current.reason || null,
                updatedAt: Number(current.updatedAt) || 0,
                uncertain: current.uncertain || null,
                freshness: current.freshness || null,
                diagnostics: clone(current.diagnostics || null)
            };
        }

        function normalizeInstant(supplied) {
            const current = supplied || {};
            return {
                state: Object.values(BUILD_INSTANT_STATE).includes(current.state)
                    ? current.state
                    : BUILD_INSTANT_STATE.IDLE,
                orderId: current.orderId != null ? String(current.orderId) : null,
                availableFrom: Number(current.availableFrom) || null,
                availableTo: Number(current.availableTo) || null,
                nextDueAt: Number(current.nextDueAt) || null,
                checkedOfficialGeneration: Math.max(0, Number(current.checkedOfficialGeneration) || 0),
                confirmationAttempted: Boolean(current.confirmationAttempted),
                snapshotHash: current.snapshotHash || null,
                reason: current.reason || null,
                updatedAt: Number(current.updatedAt) || 0,
                uncertain: current.uncertain || null
            };
        }

        function readIntentSnapshot(villageId) {
            const parsed = safeParse(storage?.getItem?.(snapshotStorageKey(villageId)));
            if (!parsed || parsed.version !== INTENT_VERSION || !Array.isArray(parsed.queue)) return null;
            return {
                queue: parsed.queue.map((item, index) => normalizeItem(item, villageId, index)).filter(Boolean),
                revision: Math.max(0, Number(parsed.revision) || 0),
                executionGeneration: Math.max(1, Number(parsed.executionGeneration) || 1),
                seenEventIds: Array.isArray(parsed.seenEventIds) ? parsed.seenEventIds.slice(-seenLimit) : []
            };
        }

        function readRuntimeSnapshot(villageId) {
            return safeParse(writeBehind?.get?.(runtimeStorageKey(villageId)) ?? storage?.getItem?.(runtimeStorageKey(villageId)));
        }

        function createRecord(villageId) {
            const legacy = initialIntent(villageId);
            const saved = readIntentSnapshot(villageId);
            const intent = saved || legacy;
            if (!saved && (legacy.queue.length > 0 || legacy.revision > 0)) {
                writeImmediate(snapshotStorageKey(villageId), {
                    version: INTENT_VERSION,
                    villageId,
                    queue: legacy.queue,
                    revision: legacy.revision,
                    executionGeneration: legacy.executionGeneration,
                    seenEventIds: [],
                    updatedAt: now()
                });
            }
            const savedRuntime = readRuntimeSnapshot(villageId) || {};
            const record = {
                villageId,
                queue: intent.queue,
                revision: intent.revision,
                executionGeneration: intent.executionGeneration,
                seenEventIds: new Set(intent.seenEventIds || []),
                official: normalizeOfficial(villageId, savedRuntime.official),
                resources: normalizeResources(villageId, savedRuntime.resources),
                execution: normalizeExecution(villageId, savedRuntime.execution),
                instant: normalizeInstant(savedRuntime.instant),
                invalidationReason: savedRuntime.invalidationReason || null,
                inFlight: null
            };
            if (record.queue.length && record.execution.state === BUILD_QUEUE_STATE.IDLE &&
                record.official.full && record.official.nextSlotAt > now()) {
                record.execution = Object.assign({}, record.execution, {
                    state: BUILD_QUEUE_STATE.WAITING_SLOT,
                    nextDueAt: record.official.nextSlotAt + 2000,
                    reason: 'legacy-known-slot'
                });
            }
            return record;
        }

        function listEvents(villageId) {
            const prefix = eventVillagePrefix(villageId);
            return storageKeys(storage)
                .filter(key => key.startsWith(prefix))
                .map(key => safeParse(storage.getItem(key)))
                .filter(event => event && event.version === INTENT_VERSION && event.villageId === villageId)
                .sort(compareEvents);
        }

        function applyEvent(record, event) {
            if (!event?.id || record.seenEventIds.has(event.id)) return false;
            const queue = record.queue.slice();
            if (event.type === 'ADD') {
                const item = normalizeItem(event.item, record.villageId, queue.length);
                if (item && !queue.some(existing => existing.id === item.id)) queue.push(item);
            } else if (event.type === 'REMOVE' || event.type === 'CONSUME') {
                const index = queue.findIndex(item => item.id === event.itemId);
                if (index >= 0) queue.splice(index, 1);
            } else if (event.type === 'MOVE') {
                const index = queue.findIndex(item => item.id === event.itemId);
                if (index >= 0) {
                    const [item] = queue.splice(index, 1);
                    let targetIndex;
                    if (event.beforeItemId != null) {
                        const beforeIndex = queue.findIndex(candidate => candidate.id === event.beforeItemId);
                        targetIndex = beforeIndex >= 0 ? beforeIndex : queue.length;
                    } else if (event.afterItemId != null) {
                        const afterIndex = queue.findIndex(candidate => candidate.id === event.afterItemId);
                        targetIndex = afterIndex >= 0 ? afterIndex + 1 : queue.length;
                    } else {
                        // Legacy v2 MOVE events used a positional index. Keep replay compatibility.
                        targetIndex = Number(event.toIndex) || 0;
                    }
                    targetIndex = Math.max(0, Math.min(queue.length, targetIndex));
                    queue.splice(targetIndex, 0, item);
                }
            } else if (event.type === 'CLEAR') {
                queue.length = 0;
            } else {
                return false;
            }
            if (event.rebase?.buildingId && Number.isFinite(Number(event.rebase.startLevel))) {
                let nextLevel = Number(event.rebase.startLevel);
                for (let index = 0; index < queue.length; index++) {
                    if (queue[index].buildingId !== event.rebase.buildingId) continue;
                    queue[index] = Object.assign({}, queue[index], { targetLevel: nextLevel++ });
                }
            }
            record.queue = queue;
            record.revision += 1;
            record.executionGeneration += 1;
            record.seenEventIds.add(event.id);
            while (record.seenEventIds.size > seenLimit) {
                record.seenEventIds.delete(record.seenEventIds.values().next().value);
            }
            return true;
        }

        function syncLegacyFields(record) {
            const official = record.official || normalizeOfficial(record.villageId);
            const patch = {
                building_queue_items_v2: clone(record.queue),
                building_queue: record.queue.map(item => item.buildingId),
                building_queue_levels: record.queue.map(item => item.targetLevel),
                building_queue_revision: record.revision,
                building_queue_execution_generation: record.executionGeneration,
                build_state_official_v1: clone(official),
                build_state_resources_v1: clone(record.resources),
                build_queue_execution_v2: clone(record.execution),
                building_queue_active: official.queue.slice(),
                building_queue_active_levels: official.levels.slice(),
                building_queue_slots: official.slots.slice(),
                queue_cancelIds: official.cancelIds.slice(),
                build_queue_catalog_v1: clone(official.catalog),
                building_queue_next_slot: official.nextSlotAt || null,
                building_queue_last_slot: official.lastSlotAt || null,
                waiting_for_queue: record.execution.state === BUILD_QUEUE_STATE.WAITING_RESOURCES ||
                    record.execution.state === BUILD_QUEUE_STATE.WAITING_POPULATION
                    ? { buildId: record.queue[0]?.buildingId, earliestPossibleAt: record.execution.nextDueAt }
                    : {}
            };
            queueStorage?.patchMemory?.(patch, record.villageId);
        }

        function persistRuntime(record, immediate) {
            const value = JSON.stringify({
                version: 2,
                official: record.official,
                resources: record.resources,
                execution: record.execution,
                instant: record.instant,
                invalidationReason: record.invalidationReason,
                updatedAt: now()
            });
            if (writeBehind?.set) writeBehind.set(runtimeStorageKey(record.villageId), value, { immediate: !!immediate });
            else if (immediate) storage?.setItem?.(runtimeStorageKey(record.villageId), value);
            else clock.setTimeout(function () { storage?.setItem?.(runtimeStorageKey(record.villageId), value); }, 0);
        }

        function notify(record, change) {
            const publicRecord = get(record.villageId);
            listeners.forEach(listener => {
                try { listener(publicRecord, change); } catch (error) { console.error('[TW BuildState] listener failed', error); }
            });
        }

        function mergeIntentSnapshot(record, snapshot) {
            if (!snapshot || snapshot.revision < record.revision) return false;
            if (snapshot.revision === record.revision && snapshot.executionGeneration < record.executionGeneration) return false;
            record.queue = snapshot.queue.map((item, index) => normalizeItem(item, record.villageId, index)).filter(Boolean);
            record.revision = snapshot.revision;
            record.executionGeneration = snapshot.executionGeneration;
            (snapshot.seenEventIds || []).forEach(id => record.seenEventIds.add(id));
            return true;
        }

        function ensure(villageId, replayEvents = true) {
            const vId = normalizeVillageId(villageId);
            if (!records[vId]) records[vId] = createRecord(vId);
            const record = records[vId];
            let changed = false;
            if (replayEvents) {
                const base = readIntentSnapshot(vId) || initialIntent(vId);
                const rebuilt = {
                    villageId: vId,
                    queue: clone(base.queue),
                    revision: base.revision,
                    executionGeneration: base.executionGeneration,
                    seenEventIds: new Set(base.seenEventIds || [])
                };
                listEvents(vId).forEach(event => applyEvent(rebuilt, event));
                changed = hash(record.queue) !== hash(rebuilt.queue) ||
                    record.revision !== rebuilt.revision ||
                    record.executionGeneration !== rebuilt.executionGeneration;
                record.queue = rebuilt.queue;
                record.revision = rebuilt.revision;
                record.executionGeneration = rebuilt.executionGeneration;
                record.seenEventIds = rebuilt.seenEventIds;
            }
            syncLegacyFields(record);
            if (changed) {
                persistRuntime(record, false);
                scheduleCompaction(vId);
            }
            return record;
        }

        function get(villageId) {
            const record = ensure(villageId);
            return {
                villageId: record.villageId,
                queue: clone(record.queue),
                revision: record.revision,
                executionGeneration: record.executionGeneration,
                official: clone(record.official),
                resources: clone(record.resources),
                execution: clone(record.execution),
                instant: clone(record.instant),
                officialQueue: clone(record.official?.queue || []),
                nextSlotAt: Number(record.official?.nextSlotAt) || null,
                instantFreeAt: Number(record.official?.nextSlotAt)
                    ? Number(record.official.nextSlotAt) - 180000
                    : null,
                fetchedAt: Number(record.official?.fetchedAt) || 0,
                generation: Number(record.official?.generation) || 0,
                parsed: clone(record.official?.catalog || null),
                invalidationReason: clone(record.invalidationReason),
                inFlight: clone(record.inFlight)
            };
        }

        function snapshotValue(record) {
            return {
                version: INTENT_VERSION,
                villageId: record.villageId,
                queue: record.queue,
                revision: record.revision,
                executionGeneration: record.executionGeneration,
                seenEventIds: Array.from(record.seenEventIds).slice(-seenLimit),
                updatedAt: now()
            };
        }

        function writeImmediate(key, value) {
            const serialized = typeof value === 'string' ? value : JSON.stringify(value);
            try {
                if (typeof host.safeLocalStorageSet === 'function') return host.safeLocalStorageSet(key, serialized);
                storage.setItem(key, serialized);
                return true;
            } catch (error) {
                if (typeof host.reportStorageError === 'function') host.reportStorageError(error, 'saving build queue intent');
                else console.warn('[TW BuildState] Intent persistence failed', error);
                return false;
            }
        }

        async function compact(villageId) {
            const vId = normalizeVillageId(villageId);
            const perform = async function (guard) {
                guard?.assertActive?.();
                const record = ensure(vId);
                const events = listEvents(vId);
                events.forEach(event => applyEvent(record, event));
                guard?.assertActive?.();
                const persistedSnapshot = snapshotValue(record);
                writeImmediate(snapshotStorageKey(vId), persistedSnapshot);
                syncLegacyFields(record);
                await queueStorage?.persistVillage?.(vId);
                guard?.assertActive?.();
                // The snapshot was derived from this exact, lease-protected event set.  Events
                // created after the read have different keys and remain for the next compaction.
                events.forEach(event => storage.removeItem(eventStorageKey(event)));
                coordination?.broadcast?.('build-queue-snapshot', persistedSnapshot);
                return persistedSnapshot;
            };
            try {
                if (coordination?.runWithLease) {
                    return await coordination.runWithLease('build-queue-state:' + vId, perform, { ttlMs: 10000 });
                }
                return await perform(null);
            } catch (error) {
                if (error?.code === 'LEASE_UNAVAILABLE' || error?.code === 'LEASE_LOST') {
                    scheduleCompaction(vId, compactDelayMs * 2);
                    return null;
                }
                console.warn('[TW BuildState] Failed to compact village ' + vId, error);
                return null;
            }
        }

        function scheduleCompaction(villageId, delayMs = compactDelayMs) {
            const vId = normalizeVillageId(villageId);
            const key = 'build-state:compact:' + vId;
            if (runtime?.setTimeout) {
                runtime.setTimeout(key, function () { compactTimers.delete(vId); compact(vId); }, delayMs, true);
                compactTimers.set(vId, key);
            } else {
                const previous = compactTimers.get(vId);
                if (previous != null) clock.clearTimeout(previous);
                compactTimers.set(vId, clock.setTimeout(function () {
                    compactTimers.delete(vId);
                    compact(vId);
                }, delayMs));
            }
        }

        function ingestEvent(event, source) {
            if (!event || event.version !== INTENT_VERSION || !event.villageId) return false;
            const record = ensure(event.villageId, true);
            const applied = record.seenEventIds.has(event.id);
            if (!applied || announcedEventIds.has(event.id)) return false;
            announcedEventIds.add(event.id);
            syncLegacyFields(record);
            persistRuntime(record, false);
            scheduleCompaction(record.villageId);
            notify(record, { kind: 'intent', event: clone(event), source: source || 'remote' });
            return applied;
        }

        function ingestSnapshot(snapshot, source) {
            if (!snapshot || snapshot.version !== INTENT_VERSION || !snapshot.villageId) return false;
            const record = ensure(snapshot.villageId);
            if (!mergeIntentSnapshot(record, snapshot)) return false;
            listEvents(record.villageId).forEach(event => applyEvent(record, event));
            syncLegacyFields(record);
            notify(record, { kind: 'snapshot', source: source || 'remote' });
            return true;
        }

        function command(villageId, type, payload = {}) {
            const vId = normalizeVillageId(villageId);
            const record = ensure(vId);
            if (!readIntentSnapshot(vId)) writeImmediate(snapshotStorageKey(vId), snapshotValue(record));
            const event = {
                version: INTENT_VERSION,
                id: actorId + ':' + (++sequence) + ':' + makeLocalId(host.crypto),
                actorId,
                sequence,
                createdAt: now(),
                villageId: vId,
                type
            };
            if (type === 'ADD') {
                event.item = {
                    id: payload.itemId || event.id + ':item',
                    buildingId: String(payload.buildingId),
                    targetLevel: payload.targetLevel != null && Number.isFinite(Number(payload.targetLevel))
                        ? Number(payload.targetLevel)
                        : null,
                    addedAt: event.createdAt
                };
            } else if (type === 'REMOVE' || type === 'CONSUME') {
                event.itemId = payload.itemId;
            } else if (type === 'MOVE') {
                event.itemId = payload.itemId;
                if (payload.beforeItemId != null) event.beforeItemId = String(payload.beforeItemId);
                else if (payload.afterItemId != null) event.afterItemId = String(payload.afterItemId);
                else event.toIndex = Number(payload.toIndex) || 0;
            }
            if (payload.rebase?.buildingId && Number.isFinite(Number(payload.rebase.startLevel))) {
                event.rebase = {
                    buildingId: String(payload.rebase.buildingId),
                    startLevel: Number(payload.rebase.startLevel)
                };
            }
            if (!writeImmediate(eventStorageKey(event), event)) {
                const error = new Error('Could not persist build queue command');
                error.code = 'BUILD_QUEUE_STORAGE_FAILED';
                throw error;
            }
            ingestEvent(event, payload.source || 'local');
            coordination?.broadcast?.('build-queue-intent', event);
            return { event: clone(event), record: get(vId) };
        }

        function add(villageId, buildingId, targetLevel) {
            if (!buildingId) return null;
            return command(villageId, 'ADD', { buildingId, targetLevel });
        }

        function rebaseForUserEdit(record, buildingId) {
            const levels = record.queue
                .filter(item => item.buildingId === buildingId && Number.isFinite(Number(item.targetLevel)))
                .map(item => Number(item.targetLevel));
            return levels.length ? { buildingId, startLevel: Math.min(...levels) } : null;
        }

        function removeAt(villageId, index) {
            const record = ensure(villageId);
            const item = record.queue[Number(index)];
            return item ? command(record.villageId, 'REMOVE', {
                itemId: item.id,
                rebase: rebaseForUserEdit(record, item.buildingId)
            }) : null;
        }

        function removeItem(villageId, itemId) {
            const record = ensure(villageId);
            return record.queue.some(item => item.id === itemId)
                ? command(record.villageId, 'REMOVE', {
                    itemId,
                    rebase: rebaseForUserEdit(record, record.queue.find(item => item.id === itemId)?.buildingId)
                })
                : null;
        }

        function move(villageId, fromIndex, toIndex) {
            const record = ensure(villageId);
            const item = record.queue[Number(fromIndex)];
            if (!item || Number(fromIndex) === Number(toIndex)) return null;
            return command(record.villageId, 'MOVE', {
                itemId: item.id,
                toIndex,
                rebase: rebaseForUserEdit(record, item.buildingId)
            });
        }

        function moveItem(villageId, itemId, relation = {}) {
            const record = ensure(villageId);
            const item = record.queue.find(candidate => candidate.id === String(itemId));
            if (!item) return null;
            const payload = {
                itemId: item.id,
                rebase: rebaseForUserEdit(record, item.buildingId)
            };
            if (relation.beforeItemId != null) payload.beforeItemId = String(relation.beforeItemId);
            else if (relation.afterItemId != null) payload.afterItemId = String(relation.afterItemId);
            else payload.toIndex = Number(relation.toIndex) || 0;
            if (payload.beforeItemId === item.id || payload.afterItemId === item.id) return null;
            return command(record.villageId, 'MOVE', payload);
        }

        function rebaseTargetsFromOffers(record, offers) {
            let changed = false;
            Object.keys(offers || {}).forEach(function (buildingId) {
                let nextLevel = Number(offers[buildingId]?.level);
                if (!Number.isInteger(nextLevel) || nextLevel <= 0) return;
                record.queue = record.queue.map(function (item) {
                    if (item.buildingId !== buildingId) return item;
                    const targetLevel = nextLevel++;
                    if (Number(item.targetLevel) === targetLevel) return item;
                    changed = true;
                    return Object.assign({}, item, { targetLevel });
                });
            });
            if (!changed) return false;
            // targetLevel is derived metadata. Rebase it without changing intentRevision, while
            // bumping executionGeneration so an older worker cannot cross the mutation boundary.
            record.executionGeneration += 1;
            const snapshot = snapshotValue(record);
            writeImmediate(snapshotStorageKey(record.villageId), snapshot);
            coordination?.broadcast?.('build-queue-snapshot', snapshot);
            notify(record, { kind: 'metadata-rebase', source: 'official-next-build-offer' });
            return true;
        }

        function clear(villageId) {
            const record = ensure(villageId);
            return record.queue.length ? command(record.villageId, 'CLEAR') : null;
        }

        function consume(villageId, itemId) {
            const record = ensure(villageId);
            return record.queue.some(item => item.id === itemId)
                ? command(record.villageId, 'CONSUME', { itemId, source: 'executor' })
                : null;
        }

        function updateOfficial(villageId, supplied = {}) {
            const record = ensure(villageId);
            const previous = record.official || normalizeOfficial(record.villageId);
            const next = normalizeOfficial(record.villageId, Object.assign({}, previous, supplied));
            next.fetchedAt = Number(supplied.fetchedAt) || now();
            next.generation = previous.generation + 1;
            if (Object.prototype.hasOwnProperty.call(supplied, 'nextBuildOffers')) {
                Object.keys(next.nextBuildOffers || {}).forEach(function (buildingId) {
                    next.nextBuildOffers[buildingId].generation = next.generation;
                    if (!next.nextBuildOffers[buildingId].observedAt) next.nextBuildOffers[buildingId].observedAt = next.fetchedAt;
                });
            }
            record.official = next;
            const rebased = rebaseTargetsFromOffers(record, supplied.nextBuildOffers || {});
            syncLegacyFields(record);
            if (rebased) {
                Promise.resolve(queueStorage?.persistVillage?.(record.villageId)).catch(function (error) {
                    console.warn('[TW BuildState] Failed to mirror rebased targets', error);
                });
            }
            persistRuntime(record, false);
            notify(record, { kind: 'official' });
            return get(record.villageId);
        }

        function updateCatalog(villageId, catalog) {
            const record = ensure(villageId);
            record.official.catalog = clone(catalog);
            syncLegacyFields(record);
            persistRuntime(record, false);
            return get(record.villageId);
        }

        function updateResources(villageId, supplied) {
            const record = ensure(villageId);
            const previousGeneration = record.resources?.generation || 0;
            const normalized = normalizeResources(record.villageId, supplied);
            if (!normalized) return get(record.villageId);
            normalized.fetchedAt = Number(supplied.fetchedAt) || now();
            normalized.generation = previousGeneration + 1;
            record.resources = normalized;
            syncLegacyFields(record);
            persistRuntime(record, false);
            notify(record, { kind: 'resources' });
            return get(record.villageId);
        }

        function invalidateResources(villageId, reason, shouldBroadcast = true) {
            return invalidate(villageId, ['resources'], reason, shouldBroadcast);
        }

        function invalidate(villageId, fields, reason, shouldBroadcast = true) {
            const record = ensure(villageId);
            const selected = new Set((Array.isArray(fields) ? fields : [fields]).filter(Boolean));
            if (selected.has('resources') && record.resources) {
                record.resources = Object.assign({}, record.resources, {
                    fetchedAt: 0,
                    reliableUntil: null,
                    generation: (record.resources.generation || 0) + 1,
                    invalidatedBy: reason || 'unknown'
                });
            }
            if (selected.has('officialQueue') || selected.has('official') || selected.has('nextSlotAt')) {
                record.official = Object.assign({}, record.official, {
                    fetchedAt: 0,
                    generation: (record.official?.generation || 0) + 1,
                    invalidatedBy: reason || 'unknown'
                });
            }
            if (selected.has('instant') || selected.has('officialQueue') || selected.has('official')) {
                record.instant = Object.assign({}, record.instant, {
                    state: BUILD_INSTANT_STATE.STALE,
                    nextDueAt: null,
                    reason: reason || 'dependency-invalidated',
                    updatedAt: now()
                });
            }
            record.invalidationReason = {
                fields: Array.from(selected),
                reason: reason || 'unknown',
                at: now()
            };
            syncLegacyFields(record);
            persistRuntime(record, false);
            notify(record, { kind: 'invalidated', fields: Array.from(selected), reason });
            if (shouldBroadcast) coordination?.broadcast?.('build-state-invalidated', {
                villageId: record.villageId,
                fields: Array.from(selected),
                reason: reason || 'unknown',
                at: now(),
                source: actorId
            });
            return get(record.villageId);
        }

        function setExecution(villageId, patch, persistImmediately) {
            const record = ensure(villageId);
            record.execution = Object.assign({}, record.execution, patch || {}, { updatedAt: now() });
            syncLegacyFields(record);
            persistRuntime(record, !!persistImmediately);
            notify(record, { kind: 'execution' });
            return get(record.villageId);
        }

        function setInstant(villageId, patch, persistImmediately) {
            const record = ensure(villageId);
            record.instant = Object.assign({}, record.instant, patch || {}, { updatedAt: now() });
            persistRuntime(record, !!persistImmediately);
            notify(record, { kind: 'instant' });
            return get(record.villageId);
        }

        function setInFlight(villageId, inFlight) {
            const record = ensure(villageId);
            record.inFlight = inFlight ? clone(inFlight) : null;
            return get(record.villageId);
        }

        function capture(villageId) {
            const record = ensure(villageId);
            const head = record.queue[0] || null;
            const identity = {
                villageId: record.villageId,
                revision: record.revision,
                executionGeneration: record.executionGeneration,
                headItemId: head?.id || null,
                headBuildingId: head?.buildingId || null,
                headTargetLevel: head?.targetLevel || null,
                officialGeneration: record.official?.generation || 0,
                resourceGeneration: record.resources?.generation || 0
            };
            identity.hash = hash(identity);
            return identity;
        }

        function isCurrent(villageId, captured, options = {}) {
            if (!captured) return false;
            const current = capture(villageId);
            return current.villageId === captured.villageId &&
                current.revision === captured.revision &&
                current.executionGeneration === captured.executionGeneration &&
                current.headItemId === captured.headItemId &&
                (!options.includeObserved || (
                    current.officialGeneration === captured.officialGeneration &&
                    current.resourceGeneration === captured.resourceGeneration
                ));
        }

        function calculateResourceEta(villageId, cost, timestamp = now()) {
            const resources = ensure(villageId).resources;
            if (!resources || !cost || !resources.production || !resources.fetchedAt) return null;
            if (resources.reliableUntil && timestamp > resources.reliableUntil) return null;
            if (Number(cost.pop) > 0 && Number.isFinite(resources.pop) && Number.isFinite(resources.popMax) &&
                resources.popMax - resources.pop < Number(cost.pop)) return null;
            let eta = timestamp;
            for (const name of ['wood', 'stone', 'iron']) {
                const rate = Number(resources.production[name]);
                const elapsedHours = Math.max(0, timestamp - resources.fetchedAt) / 3600000;
                const estimatedNow = Number(resources[name]) + Math.max(0, rate) * elapsedHours;
                const deficit = Math.max(0, Number(cost[name]) - estimatedNow);
                if (deficit > 0 && !(rate > 0)) return null;
                eta = Math.max(eta, timestamp + deficit / Math.max(rate, 1) * 3600000);
            }
            if (resources.reliableUntil && eta > resources.reliableUntil) return null;
            return Number.isFinite(eta) ? Math.ceil(eta) : null;
        }

        function publishObservation(villageId) {
            const record = ensure(villageId);
            coordination?.broadcast?.('build-state-observed', {
                villageId: record.villageId,
                official: clone(record.official),
                resources: clone(record.resources),
                instant: clone(record.instant),
                source: actorId,
                publishedAt: now()
            });
        }

        function listVillageIds() {
            const ids = new Set(Object.keys(records));
            queueStorage?.listVillageIds?.().forEach(id => ids.add(String(id)));
            storageKeys(storage).forEach(key => {
                if (key.startsWith(snapshotPrefix)) {
                    const snapshot = safeParse(storage.getItem(key));
                    if (snapshot?.villageId) ids.add(String(snapshot.villageId));
                } else if (key.startsWith(eventPrefix)) {
                    const event = safeParse(storage.getItem(key));
                    if (event?.villageId) ids.add(String(event.villageId));
                }
            });
            return Array.from(ids);
        }

        function subscribe(listener) {
            listeners.add(listener);
            return function () { listeners.delete(listener); };
        }

        function start() {
            if (started) return;
            started = true;
            unsubscribeIntent = coordination?.subscribe?.('build-queue-intent', event => ingestEvent(event, 'broadcast')) || null;
            unsubscribeSnapshot = coordination?.subscribe?.('build-queue-snapshot', snapshot => ingestSnapshot(snapshot, 'broadcast')) || null;
            unsubscribeResourceInvalidation = coordination?.subscribe?.('build-resource-invalidated', payload => {
                if (payload?.villageId && payload.source !== actorId) invalidateResources(payload.villageId, payload.reason, false);
            }) || null;
            unsubscribeInvalidation = coordination?.subscribe?.('build-state-invalidated', payload => {
                if (payload?.villageId && payload.source !== actorId) {
                    invalidate(payload.villageId, payload.fields || [], payload.reason, false);
                }
            }) || null;
            unsubscribeObservation = coordination?.subscribe?.('build-state-observed', payload => {
                if (!payload?.villageId || payload.source === actorId) return;
                const record = ensure(payload.villageId);
                const incomingOfficialAt = Number(payload.official?.fetchedAt) || 0;
                const incomingResourcesAt = Number(payload.resources?.fetchedAt) || 0;
                if (payload.official && incomingOfficialAt >= Number(record.official?.fetchedAt || 0) &&
                    hash(payload.official) !== hash(record.official)) {
                    updateOfficial(payload.villageId, payload.official);
                }
                if (payload.resources && incomingResourcesAt >= Number(record.resources?.fetchedAt || 0) &&
                    hash(payload.resources) !== hash(record.resources)) {
                    updateResources(payload.villageId, payload.resources);
                }
                if (payload.instant && Number(payload.instant.updatedAt || 0) >= Number(record.instant?.updatedAt || 0) &&
                    hash(payload.instant) !== hash(record.instant)) {
                    record.instant = normalizeInstant(payload.instant);
                    persistRuntime(record, false);
                    notify(record, { kind: 'instant-observed' });
                }
            }) || null;
            listVillageIds().forEach(ensure);
        }

        function stop() {
            started = false;
            unsubscribeIntent?.();
            unsubscribeSnapshot?.();
            unsubscribeResourceInvalidation?.();
            unsubscribeInvalidation?.();
            unsubscribeObservation?.();
            unsubscribeIntent = unsubscribeSnapshot = unsubscribeResourceInvalidation = unsubscribeInvalidation = unsubscribeObservation = null;
        }

        return {
            STATE: BUILD_QUEUE_STATE,
            INSTANT_STATE: BUILD_INSTANT_STATE,
            records,
            start,
            stop,
            ensure,
            get,
            add,
            removeAt,
            removeItem,
            move,
            moveItem,
            clear,
            consume,
            command,
            updateOfficial,
            updateCatalog,
            updateResources,
            invalidateResources,
            invalidate,
            setExecution,
            setInstant,
            setInFlight,
            capture,
            isCurrent,
            calculateResourceEta,
            publishObservation,
            compact,
            listVillageIds,
            subscribe,
            eventCount: function (villageId) { return listEvents(normalizeVillageId(villageId)).length; }
        };
    }

    function createBuildQueueController(options = {}) {
        const store = options.store;
        const scheduler = options.scheduler;
        const runtime = options.runtime || root.PremiumFeaturesRuntimeRegistry || null;
        const coordination = options.coordination || root.PremiumFeaturesCoordination || null;
        const clock = options.clock || root;
        const now = options.now || (() => Date.now());
        const inspect = options.inspect;
        const mutate = options.mutate;
        const getCost = options.getCost;
        const isEnabled = typeof options.isEnabled === 'function' ? options.isEnabled : function () { return true; };
        const resilientRun = options.runResilientTask;
        const editDebounceMs = Math.max(0, Number(options.editDebounceMs) || DEFAULT_EDIT_DEBOUNCE_MS);
        const fallbackMs = Math.max(1000, Number(options.fallbackMs) || DEFAULT_FALLBACK_MS);
        const slotMarginMs = Math.max(0, Number(options.slotMarginMs) || 2000);
        const resourceMarginMs = Math.max(0, Number(options.resourceMarginMs) || 2000);
        const taskPrefix = options.taskPrefix || 'build-queue:reconcile:';
        const handlerName = options.handlerName || null;
        const onInvalidate = options.onInvalidate || function () {};
        const requestCounts = { inspections: 0, mutations: 0 };
        const editSessions = new Map();

        function priority(name) {
            return scheduler?.PRIORITY?.[name] || ({ MANUAL: 1, RECONCILIATION: 2, AUTOMATIC: 3 })[name] || 3;
        }

        function taskKey(villageId) { return taskPrefix + String(villageId); }

        function normalizeCostDecision(villageId, head, record) {
            const resolved = getCost?.(villageId, head, record);
            if (!resolved) return null;
            if (resolved.cost) return resolved;
            return {
                effectiveLevel: Number(head?.targetLevel) || null,
                cost: resolved,
                source: 'LEGACY_COST_CALLBACK',
                authoritative: true,
                observedAt: Number(record.official?.fetchedAt) || 0,
                officialGeneration: Number(record.official?.generation) || 0,
                persistedTargetLevel: Number(head?.targetLevel) || null
            };
        }

        function queueDecisionHash(record) {
            const head = record.queue[0] || null;
            const costDecision = head ? normalizeCostDecision(record.villageId, head, record) : null;
            return (options.hash || root.PremiumFeaturesAsync?.stableSnapshotHash || JSON.stringify)({
                villageId: record.villageId,
                head: head && { id: head.id, buildingId: head.buildingId },
                effectiveLevel: costDecision?.effectiveLevel || null,
                cost: costDecision?.cost ? {
                    wood: Number(costDecision.cost.wood),
                    stone: Number(costDecision.cost.stone),
                    iron: Number(costDecision.cost.iron),
                    pop: Number(costDecision.cost.pop) || 0
                } : null,
                costSource: costDecision?.source || null,
                officialGeneration: record.official?.generation || 0,
                resourceGeneration: record.resources?.generation || 0,
                officialFull: !!record.official?.full,
                nextSlotAt: Number(record.official?.nextSlotAt) || null
            });
        }

        function diagnostics(villageId) {
            const vId = String(villageId);
            const record = store.get(vId);
            const task = scheduler?.describe?.(taskKey(vId)) || null;
            const lease = coordination?.readLease?.('build-queue:' + vId) || null;
            const execution = record.execution || {};
            return Object.assign({}, execution.diagnostics || {}, {
                villageId: vId,
                itemId: record.queue?.[0]?.id || null,
                buildingId: record.queue?.[0]?.buildingId || null,
                persistedTargetLevel: Number(record.queue?.[0]?.targetLevel) || null,
                productionSource: record.resources?.productionSource || record.resources?.source || null,
                ETA: Number(execution.diagnostics?.ETA) || null,
                nextDueAt: Number(execution.nextDueAt) || Number(task?.dueAt) || null,
                schedulerTaskPresent: Boolean(task && task.state !== 'MISSING'),
                schedulerWakeArmed: Boolean(task?.wakeArmed),
                schedulerWakeAt: Number(task?.wakeAt) || null,
                overdueByMs: Number(task?.overdueByMs) || 0,
                executionState: execution.state || BUILD_QUEUE_STATE.IDLE,
                reason: execution.reason || null,
                leaseOwner: lease?.owner || null,
                leaseExpiry: Number(lease?.expiresAt) || null,
                interactionState: runtime?.isInteractionActive?.('build-queue:' + vId) ? 'ACTIVE' : 'INACTIVE',
                hardStop: Boolean(task?.hardStopped),
                hardStopReason: task?.hardStopReason || null,
                softPauseRetryAt: execution.state === BUILD_QUEUE_STATE.SOFT_PAUSED
                    ? Number(execution.nextDueAt) || null
                    : null
            });
        }

        function schedule(villageId, scheduleOptions = {}) {
            const vId = String(villageId);
            const record = store.get(vId);
            const key = taskKey(vId);
            if (!isEnabled(vId)) {
                scheduler?.cancel?.(key, 'build queue disabled');
                store.setExecution(vId, {
                    state: record.execution?.uncertain ? BUILD_QUEUE_STATE.UNCERTAIN : BUILD_QUEUE_STATE.IDLE,
                    nextDueAt: null,
                    reason: 'disabled',
                    decisionHash: queueDecisionHash(record)
                }, true);
                return Promise.resolve({ status: 'DISABLED' });
            }
            if (!record.queue.length) {
                scheduler?.cancel?.(key, 'empty build queue');
                store.setExecution(vId, {
                    state: BUILD_QUEUE_STATE.IDLE,
                    nextDueAt: null,
                    decisionHash: queueDecisionHash(record),
                    reason: 'empty',
                    uncertain: null
                }, true);
                return Promise.resolve({ status: 'IDLE' });
            }
            const requestedDueAt = Number(scheduleOptions.dueAt) || now() + Math.max(0, Number(scheduleOptions.delayMs) || 0);
            const dueMode = scheduleOptions.dueMode || scheduler?.DUE_MODE?.REPLACE || 'REPLACE';
            const existingDueAt = Number(record.execution?.nextDueAt);
            const dueAt = dueMode === 'EARLIEST' && Number.isFinite(existingDueAt)
                ? Math.min(existingDueAt, requestedDueAt)
                : dueMode === 'LATEST' && Number.isFinite(existingDueAt)
                    ? Math.max(existingDueAt, requestedDueAt)
                    : dueMode === 'KEEP' && Number.isFinite(existingDueAt)
                        ? existingDueAt
                        : requestedDueAt;
            const taskPriority = Number(scheduleOptions.priority) || priority('AUTOMATIC');
            store.setExecution(vId, {
                state: scheduleOptions.state || BUILD_QUEUE_STATE.RECONCILING,
                nextDueAt: dueAt,
                decisionHash: queueDecisionHash(record),
                reason: scheduleOptions.reason || 'scheduled',
                freshness: scheduleOptions.requireNetwork ? 'REQUIRED_NETWORK' :
                    scheduleOptions.forceFresh ? 'REQUIRED' : record.execution?.freshness || null
            }, !!scheduleOptions.immediatePersistence);
            const descriptor = {
                key,
                priority: taskPriority,
                dueAt,
                dueMode,
                leaseKey: 'build-queue:' + vId,
                interactionScope: 'build-queue:' + vId,
                generation: record.executionGeneration,
                snapshotHash: store.capture(vId).hash,
                rerunWhileActive: true,
                run: guard => Promise.resolve().then(function () {
                    return reconcile(vId, guard);
                }).catch(function (error) {
                    return recoverWorkerException(vId, error);
                })
            };
            if (handlerName) {
                descriptor.persist = true;
                descriptor.handlerName = handlerName;
                descriptor.args = [vId];
            }
            if (scheduler?.enqueue) {
                // A reconciliation frequently schedules its own successor (next slot, resources,
                // or next head).  Never return that successor's completion Promise to the active
                // task: with scheduler concurrency 1 that would make each wait for the other.
                scheduler.enqueue(descriptor);
                return Promise.resolve({ status: 'SCHEDULED', key, dueAt });
            }
            return Promise.resolve().then(() => reconcile(vId, null));
        }

        function invalidateForEdit(villageId) {
            const vId = String(villageId);
            const record = store.get(vId);
            const dependencyHash = queueDecisionHash(record);
            const dependencyChanged = record.execution?.decisionHash !== dependencyHash;
            let session = editSessions.get(vId);
            if (!session) {
                session = { active: true, dependencyChanged: false, timer: null };
                editSessions.set(vId, session);
                runtime?.beginInteraction?.('build-queue:' + vId);
            }
            session.dependencyChanged = session.dependencyChanged || dependencyChanged;
            const finish = function () {
                const current = editSessions.get(vId);
                if (current !== session) return;
                editSessions.delete(vId);
                runtime?.endInteraction?.('build-queue:' + vId);
                if (!session.dependencyChanged) return;
                onInvalidate(vId);
                schedule(vId, {
                    delayMs: 0,
                    priority: priority('MANUAL'),
                    state: BUILD_QUEUE_STATE.RECONCILING,
                    reason: 'intent-edit-settled',
                    immediatePersistence: false
                });
            };
            if (runtime?.setTimeout) {
                runtime.setTimeout('build-queue:edit-quiet:' + vId, finish, editDebounceMs, true);
            } else if (typeof clock.setTimeout === 'function') {
                if (session.timer != null) clock.clearTimeout(session.timer);
                session.timer = clock.setTimeout(finish, editDebounceMs);
            } else {
                // Deterministic harness/minimal-host fallback: represent the quiet window as a
                // future scheduler occurrence without occupying its cooperative worker slot.
                editSessions.delete(vId);
                if (session.dependencyChanged) {
                    onInvalidate(vId);
                    schedule(vId, {
                        delayMs: editDebounceMs,
                        priority: priority('MANUAL'),
                        state: BUILD_QUEUE_STATE.RECONCILING,
                        reason: 'intent-edit-settled'
                    });
                }
            }
            // A tail-only edit leaves the executable dependency fingerprint unchanged. Preserve
            // WAITING_* and nextDueAt; its local intent revision still fences old mutations.
            return Promise.resolve({
                status: dependencyChanged ? 'EDIT_DEFERRED' : 'LOCAL_ONLY',
                key: taskKey(vId),
                dueAt: record.execution?.nextDueAt || null
            });
        }

        function resourceShortage(resources, cost) {
            if (!resources || !cost) return 'unknown-resources';
            if (resources.wood < cost.wood) return 'insufficient-wood';
            if (resources.stone < cost.stone) return 'insufficient-stone';
            if (resources.iron < cost.iron) return 'insufficient-iron';
            if (Number(cost.pop) > 0) {
                if (!Number.isFinite(resources.pop) || !Number.isFinite(resources.popMax)) return 'unknown-population';
                if (resources.popMax - resources.pop < Number(cost.pop)) return 'insufficient-population';
            }
            return null;
        }

        function activeSignatures(official) {
            return (official?.queue || []).map((buildingId, index) => String(buildingId).replace(/\d+/g, '') + ':' + Number(official.levels?.[index] || 0));
        }

        function countSignature(signatures, target) {
            return signatures.filter(signature => signature === target).length;
        }

        function uncertainWasApplied(record, uncertain) {
            if (!uncertain) return false;
            const target = uncertain.buildingId + ':' + Number(uncertain.targetLevel || 0);
            const currentLevel = Number(record.official?.currentLevels?.[uncertain.buildingId]) || 0;
            if (uncertain.targetLevel && currentLevel >= uncertain.targetLevel) return true;
            return countSignature(activeSignatures(record.official), target) >
                countSignature(uncertain.beforeActive || [], target);
        }

        function scheduleWait(villageId, state, dueAt, reason) {
            return schedule(villageId, {
                dueAt,
                priority: priority('AUTOMATIC'),
                state,
                reason,
                immediatePersistence: true
            });
        }

        function rescheduleStale(villageId, reason) {
            return schedule(villageId, {
                delayMs: editDebounceMs,
                priority: priority('RECONCILIATION'),
                state: BUILD_QUEUE_STATE.RECONCILING,
                reason: reason || 'stale-snapshot'
            });
        }

        function recoverWorkerException(villageId, error) {
            if (error?.code === 'LEASE_LOST' || error?.code === 'LEASE_UNAVAILABLE') throw error;
            const record = store.get(villageId);
            const afterTransmission = !!record.inFlight || record.execution?.state === BUILD_QUEUE_STATE.EXECUTING;
            const retryAt = now() + (afterTransmission ? 30000 : fallbackMs);
            root.PremiumFeaturesDiagnostics?.record?.({
                feature: 'build-queue',
                taskKey: taskKey(villageId),
                villageId,
                status: afterTransmission ? 'UNCERTAIN' : 'SOFT_PAUSE',
                reason: 'worker-exception:' + (error?.message || String(error))
            });
            if (afterTransmission) {
                const uncertain = record.execution?.uncertain || record.inFlight;
                store.setInFlight(villageId, null);
                store.setExecution(villageId, {
                    state: BUILD_QUEUE_STATE.UNCERTAIN,
                    uncertain,
                    nextDueAt: retryAt,
                    reason: 'worker-exception-after-transmission'
                }, true);
                return schedule(villageId, {
                    dueAt: retryAt,
                    priority: priority('RECONCILIATION'),
                    state: BUILD_QUEUE_STATE.UNCERTAIN,
                    reason: 'worker-exception-reconcile',
                    forceFresh: true,
                    immediatePersistence: true
                });
            }
            return schedule(villageId, {
                dueAt: retryAt,
                priority: priority('RECONCILIATION'),
                state: BUILD_QUEUE_STATE.SOFT_PAUSED,
                reason: 'worker-exception-before-transmission',
                immediatePersistence: true
            });
        }

        async function inspectFresh(villageId, captured, guard, forceFresh, requireNetwork) {
            guard?.assertActive?.();
            if (!store.isCurrent(villageId, captured)) return { stale: true };
            requestCounts.inspections++;
            let observed;
            if (resilientRun) {
                const result = await resilientRun({
                    key: 'build-queue-inspect:' + villageId,
                    snapshotHash: captured.hash,
                    run: () => inspect(villageId, { captured, guard, forceFresh: !!forceFresh,
                        requireNetwork: !!requireNetwork })
                });
                if (result.status !== 'SUCCESS') return { stale: false, result };
                observed = result.value;
            } else {
                observed = await inspect(villageId, { captured, guard, forceFresh: !!forceFresh,
                    requireNetwork: !!requireNetwork });
            }
            guard?.assertActive?.();
            if (!store.isCurrent(villageId, captured)) return { stale: true };
            if (!observed?.alreadyStored) {
                if (observed?.official) store.updateOfficial(villageId, observed.official);
                if (observed?.resources) store.updateResources(villageId, observed.resources);
                if (observed?.catalog) store.updateCatalog(villageId, observed.catalog);
            }
            return { stale: false, observed };
        }

        async function reconcile(villageId, guard) {
            const vId = String(villageId);
            let record = store.get(vId);
            if (!record.queue.length) return schedule(vId);

            const decisionHash = queueDecisionHash(record);
            const waitingState = record.execution?.state === BUILD_QUEUE_STATE.WAITING_SLOT ||
                record.execution?.state === BUILD_QUEUE_STATE.WAITING_RESOURCES ||
                record.execution?.state === BUILD_QUEUE_STATE.WAITING_POPULATION ||
                record.execution?.state === BUILD_QUEUE_STATE.SOFT_PAUSED;
            if (waitingState && !['REQUIRED', 'REQUIRED_NETWORK'].includes(record.execution?.freshness) &&
                record.execution.nextDueAt > now() && record.execution.decisionHash === decisionHash) {
                return schedule(vId, {
                    dueAt: record.execution.nextDueAt,
                    state: record.execution.state,
                    reason: record.execution.reason,
                    immediatePersistence: true
                });
            }

            const captured = store.capture(vId);
            guard?.assertActive?.();
            if (!store.isCurrent(vId, captured)) return rescheduleStale(vId, 'stale-before-inspect');
            const requireNetwork = record.execution?.freshness === 'REQUIRED_NETWORK';
            const forceFresh = record.execution?.state === BUILD_QUEUE_STATE.UNCERTAIN ||
                ['REQUIRED', 'REQUIRED_NETWORK'].includes(record.execution?.freshness);
            store.setExecution(vId, {
                state: BUILD_QUEUE_STATE.RECONCILING,
                nextDueAt: null,
                decisionHash: captured.hash,
                reason: 'inspect',
                freshness: null
            });

            const inspected = await inspectFresh(vId, captured, guard, forceFresh, requireNetwork);
            if (inspected.stale) return rescheduleStale(vId, 'stale-after-inspect');
            if (inspected.result) {
                if (inspected.result.status === 'HARD_STOP') return inspected.result;
                const retryAt = Number(inspected.result.retryAt) || now() + fallbackMs;
                return schedule(vId, {
                    dueAt: retryAt,
                    priority: priority('RECONCILIATION'),
                    state: BUILD_QUEUE_STATE.SOFT_PAUSED,
                    reason: 'inspect-soft-pause',
                    immediatePersistence: true
                });
            }
            record = store.get(vId);

            const uncertain = record.execution?.uncertain;
            if (uncertain) {
                if (uncertainWasApplied(record, uncertain)) store.consume(vId, uncertain.itemId);
                store.setExecution(vId, { uncertain: null, state: BUILD_QUEUE_STATE.RECONCILING, reason: 'uncertain-resolved' }, true);
                record = store.get(vId);
                if (!record.queue.length) return schedule(vId);
            }

            const head = record.queue[0];
            const official = record.official || {};
            if (official.full) {
                if (official.nextSlotAt && official.nextSlotAt > now()) {
                    return scheduleWait(vId, BUILD_QUEUE_STATE.WAITING_SLOT, official.nextSlotAt + slotMarginMs, 'official-slot');
                }
                return scheduleWait(vId, BUILD_QUEUE_STATE.WAITING_SLOT, now() + fallbackMs, 'slot-fallback');
            }

            const costDecision = normalizeCostDecision(vId, head, record);
            const diagnostics = {
                itemId: head.id,
                buildingId: head.buildingId,
                persistedTargetLevel: Number(head.targetLevel) || null,
                effectiveNextLevel: costDecision?.effectiveLevel || null,
                costLevel: costDecision?.effectiveLevel || null,
                costSource: costDecision?.source || 'MISSING',
                costAuthoritative: !!costDecision?.authoritative,
                officialGeneration: Number(official.generation) || 0,
                officialFreshness: Number(official.fetchedAt) || 0,
                officialFull: !!official.full,
                resources: record.resources,
                resourceSource: record.resources?.source || null,
                resourceObservedAt: Number(record.resources?.fetchedAt) || 0,
                productionSource: record.resources?.productionSource || record.resources?.source || null
            };
            if (!costDecision?.cost || !costDecision.authoritative) {
                store.setExecution(vId, { diagnostics }, false);
                // A fresh-store shortcut has not contacted the server, so one consolidated
                // authoritative inspection is justified.  If this occurrence already observed
                // DOM/network state and still found no offer, another immediate GET would only
                // repeat the same evidence; retain a future retry instead.
                if (!forceFresh && inspected.observed?.source === 'fresh-store') {
                    return schedule(vId, {
                        delayMs: 0,
                        priority: priority('RECONCILIATION'),
                        state: BUILD_QUEUE_STATE.RECONCILING,
                        reason: 'cost-revalidation',
                        forceFresh: true
                    });
                }
                return schedule(vId, {
                    dueAt: now() + fallbackMs,
                    priority: priority('RECONCILIATION'),
                    state: BUILD_QUEUE_STATE.SOFT_PAUSED,
                    reason: 'cost-unverified',
                    forceFresh: true,
                    immediatePersistence: true
                });
            }
            const cost = costDecision.cost;
            const shortage = resourceShortage(record.resources, cost);
            diagnostics.woodCost = Number(cost.wood);
            diagnostics.stoneCost = Number(cost.stone);
            diagnostics.ironCost = Number(cost.iron);
            diagnostics.popCost = Number(cost.pop) || 0;
            diagnostics.shortage = shortage;
            store.setExecution(vId, { diagnostics }, false);
            if (shortage) {
                const knownCompletionDue = Number(official.nextSlotAt) > now()
                    ? Number(official.nextSlotAt) + slotMarginMs
                    : null;
                const earlierKnownEvent = function (proposedDueAt) {
                    return knownCompletionDue ? Math.min(proposedDueAt, knownCompletionDue) : proposedDueAt;
                };
                if (shortage === 'insufficient-population' || shortage === 'unknown-population') {
                    return scheduleWait(
                        vId,
                        BUILD_QUEUE_STATE.WAITING_POPULATION,
                        earlierKnownEvent(now() + fallbackMs),
                        knownCompletionDue ? shortage + ':known-building-completion' : shortage
                    );
                }
                const eta = store.calculateResourceEta(vId, cost, now());
                if (eta && eta > now()) {
                    diagnostics.ETA = eta;
                    const dueAt = earlierKnownEvent(eta + resourceMarginMs);
                    return scheduleWait(vId, BUILD_QUEUE_STATE.WAITING_RESOURCES, dueAt,
                        dueAt === knownCompletionDue ? shortage + ':known-production-change' : shortage + ':resource-eta');
                }
                const fallbackDueAt = earlierKnownEvent(now() + fallbackMs);
                return scheduleWait(vId, BUILD_QUEUE_STATE.WAITING_RESOURCES, fallbackDueAt,
                    fallbackDueAt === knownCompletionDue ? shortage + ':known-production-change' : shortage + ':resource-fallback');
            }

            const beforeMutation = store.capture(vId);
            guard?.assertActive?.();
            if (!store.isCurrent(vId, beforeMutation, { includeObserved: true })) {
                return rescheduleStale(vId, 'stale-before-mutation');
            }
            if (store.get(vId).inFlight) {
                return schedule(vId, {
                    dueAt: now() + 30000,
                    priority: priority('RECONCILIATION'),
                    state: BUILD_QUEUE_STATE.UNCERTAIN,
                    reason: 'equivalent-mutation-in-flight',
                    forceFresh: true,
                    immediatePersistence: true
                });
            }

            const uncertainRecord = {
                itemId: head.id,
                buildingId: head.buildingId,
                targetLevel: costDecision.effectiveLevel || head.targetLevel,
                beforeActive: activeSignatures(official),
                snapshotHash: beforeMutation.hash,
                startedAt: now()
            };
            store.setExecution(vId, {
                state: BUILD_QUEUE_STATE.READY,
                decisionHash: beforeMutation.hash,
                reason: 'validated'
            });
            store.setInFlight(vId, uncertainRecord);
            let requestStarted = false;
            let result;
            try {
                guard?.assertActive?.();
                if (!store.isCurrent(vId, beforeMutation, { includeObserved: true })) {
                    return rescheduleStale(vId, 'stale-at-mutation-boundary');
                }
                store.setExecution(vId, { state: BUILD_QUEUE_STATE.EXECUTING, reason: 'mutation' }, true);
                requestStarted = true;
                requestCounts.mutations++;
                if (resilientRun) {
                    result = await resilientRun({
                        key: 'build-queue:' + vId,
                        snapshotHash: beforeMutation.hash,
                        mutation: true,
                        leaseKey: 'build-queue:' + vId,
                        run: () => mutate(vId, head, { guard, snapshot: beforeMutation, record })
                    });
                } else {
                    result = { status: 'SUCCESS', value: await mutate(vId, head, { guard, snapshot: beforeMutation, record }) };
                }
                guard?.assertActive?.();
            } catch (error) {
                result = { status: requestStarted ? 'UNCERTAIN' : 'FAILED', failure: { error } };
            } finally {
                store.setInFlight(vId, null);
            }

            if (result?.status === 'UNCERTAIN' || (requestStarted && result?.failure?.error?.code === 'LEASE_LOST')) {
                const retryAt = Number(result.retryAt) || now() + 30000;
                store.setExecution(vId, {
                    state: BUILD_QUEUE_STATE.UNCERTAIN,
                    uncertain: uncertainRecord,
                    nextDueAt: retryAt,
                    decisionHash: beforeMutation.hash,
                    reason: 'mutation-uncertain'
                }, true);
                return schedule(vId, {
                    dueAt: retryAt,
                    priority: priority('RECONCILIATION'),
                    state: BUILD_QUEUE_STATE.UNCERTAIN,
                    reason: 'mutation-uncertain',
                    immediatePersistence: true
                });
            }
            if (result?.status === 'HARD_STOP') return result;
            if (result?.status === 'SOFT_PAUSED' || result?.status === 'FAILED') {
                const retryAt = Number(result.retryAt) || now() + fallbackMs;
                return schedule(vId, {
                    dueAt: retryAt,
                    priority: priority('RECONCILIATION'),
                    state: BUILD_QUEUE_STATE.SOFT_PAUSED,
                    reason: 'mutation-soft-pause',
                    immediatePersistence: true
                });
            }

            const mutation = result?.value || {};
            if (mutation.stale) {
                return schedule(vId, {
                    delayMs: editDebounceMs,
                    priority: priority('RECONCILIATION'),
                    state: BUILD_QUEUE_STATE.RECONCILING,
                    reason: 'mutation-snapshot-changed'
                });
            }
            if (!mutation.alreadyStored) {
                if (mutation.official) store.updateOfficial(vId, mutation.official);
                if (mutation.resources) store.updateResources(vId, mutation.resources);
                if (mutation.catalog) store.updateCatalog(vId, mutation.catalog);
            }
            if (mutation.accepted !== false) {
                if (store.get(vId).queue.some(item => item.id === head.id)) store.consume(vId, head.id);
                store.setExecution(vId, { uncertain: null, state: BUILD_QUEUE_STATE.RECONCILING, reason: 'mutation-confirmed' }, true);
                return schedule(vId, { delayMs: 250, priority: priority('AUTOMATIC'), reason: 'next-head' });
            }

            store.setExecution(vId, { uncertain: null, state: BUILD_QUEUE_STATE.RECONCILING, reason: 'mutation-rejected' }, true);
            record = store.get(vId);
            if (record.official?.full && record.official.nextSlotAt > now()) {
                return scheduleWait(vId, BUILD_QUEUE_STATE.WAITING_SLOT, record.official.nextSlotAt + slotMarginMs, 'rejected-slot');
            }
            const rejectedEta = store.calculateResourceEta(vId, cost, now());
            return scheduleWait(
                vId,
                BUILD_QUEUE_STATE.WAITING_RESOURCES,
                rejectedEta && rejectedEta > now() ? rejectedEta + resourceMarginMs : now() + fallbackMs,
                rejectedEta ? 'rejected-resource-eta' : 'rejected-fallback'
            );
        }

        function bootstrap(villageIds, bootstrapOptions = {}) {
            const ids = new Set([...(villageIds || []), ...store.listVillageIds()]);
            ids.forEach(villageId => {
                const record = store.get(villageId);
                if (!record.queue.length) {
                    scheduler?.cancel?.(taskKey(villageId), 'empty on bootstrap');
                    if (record.execution?.state !== BUILD_QUEUE_STATE.IDLE || record.execution?.nextDueAt || record.execution?.uncertain) {
                        store.setExecution(villageId, {
                            state: BUILD_QUEUE_STATE.IDLE,
                            nextDueAt: null,
                            uncertain: null,
                            decisionHash: queueDecisionHash(record),
                            reason: 'empty-on-bootstrap'
                        }, true);
                    }
                    return;
                }
                const dueAt = record.execution?.nextDueAt > now() ? record.execution.nextDueAt : now();
                schedule(villageId, {
                    dueAt,
                    state: record.execution?.state || BUILD_QUEUE_STATE.RECONCILING,
                    reason: dueAt > now() ? 'restore-known-due' : 'restore-overdue',
                    forceFresh: !!bootstrapOptions.forceFresh,
                    requireNetwork: !!bootstrapOptions.requireNetwork,
                    immediatePersistence: true
                });
            });
        }

        return {
            STATE: BUILD_QUEUE_STATE,
            schedule,
            invalidateForEdit,
            reconcile,
            bootstrap,
            taskKey,
            decisionHash: function (villageId) { return queueDecisionHash(store.get(villageId)); },
            diagnostics,
            stats: function () { return Object.assign({}, requestCounts); }
        };
    }

    root.createBuildStateStore = createBuildStateStore;
    root.createBuildQueueController = createBuildQueueController;
    root.BUILD_QUEUE_STATE = BUILD_QUEUE_STATE;
    if (!root.PremiumFeaturesBuildState && root.localStorage) {
        root.PremiumFeaturesBuildState = createBuildStateStore();
    }
    root.BuildStateStore = root.PremiumFeaturesBuildState?.records || root.BuildStateStore || {};
})(window);

var PremiumFeaturesBuildState = window.PremiumFeaturesBuildState;
var BuildStateStore = window.BuildStateStore;
