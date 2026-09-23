// Runtime lifecycle registry and consolidated localStorage write-behind.
(function (root) {
    'use strict';

    function createRuntimeRegistry(options = {}) {
        const clock = options.clock || root;
        const eventListeners = new Map();
        const intervals = new Map();
        const timeouts = new Map();
        const observers = new Map();
        const featureClaims = new Map();
        const oncePromises = new Map();
        const interactions = new Map();
        const interactionListeners = new Set();
        let generation = 1;
        let reconcilePending = false;

        function addEventListener(key, target, type, handler, listenerOptions) {
            if (!key || !target || typeof target.addEventListener !== 'function') return null;
            if (eventListeners.has(key)) return eventListeners.get(key).handler;
            target.addEventListener(type, handler, listenerOptions);
            eventListeners.set(key, { target, type, handler, options: listenerOptions });
            return handler;
        }

        function removeEventListener(key) {
            const entry = eventListeners.get(key);
            if (!entry) return false;
            entry.target.removeEventListener(entry.type, entry.handler, entry.options);
            eventListeners.delete(key);
            return true;
        }

        function setLogicalInterval(key, callback, delayMs) {
            if (intervals.has(key)) return intervals.get(key);
            const timer = clock.setInterval(callback, delayMs);
            intervals.set(key, timer);
            return timer;
        }

        function clearLogicalInterval(key) {
            if (!intervals.has(key)) return false;
            clock.clearInterval(intervals.get(key));
            intervals.delete(key);
            return true;
        }

        function setLogicalTimeout(key, callback, delayMs, replace = true) {
            if (timeouts.has(key)) {
                if (!replace) return timeouts.get(key);
                clock.clearTimeout(timeouts.get(key));
            }
            const timer = clock.setTimeout(function () {
                if (timeouts.get(key) !== timer) return;
                timeouts.delete(key);
                callback();
            }, Math.max(0, Number(delayMs) || 0));
            timeouts.set(key, timer);
            return timer;
        }

        function clearLogicalTimeout(key) {
            if (!timeouts.has(key)) return false;
            clock.clearTimeout(timeouts.get(key));
            timeouts.delete(key);
            return true;
        }

        function setObserver(key, factory, replace = false) {
            if (observers.has(key)) {
                if (!replace) return observers.get(key);
                clearObserver(key);
            }
            const observer = factory();
            if (observer) observers.set(key, observer);
            return observer || null;
        }

        function clearObserver(key) {
            const observer = observers.get(key);
            if (!observer) return false;
            if (typeof observer.disconnect === 'function') observer.disconnect();
            observers.delete(key);
            return true;
        }

        function claimFeature(key, targetGeneration = generation) {
            if (featureClaims.get(key) === targetGeneration) return false;
            featureClaims.set(key, targetGeneration);
            return true;
        }

        function onceAsync(key, factory) {
            if (oncePromises.has(key)) return oncePromises.get(key);
            const promise = Promise.resolve().then(factory).catch(function (error) {
                oncePromises.delete(key);
                throw error;
            });
            oncePromises.set(key, promise);
            return promise;
        }

        function advanceGeneration() {
            generation += 1;
            return generation;
        }

        function requestReconcile(reason, callback) {
            if (reconcilePending) return false;
            reconcilePending = true;
            Promise.resolve().then(function () {
                reconcilePending = false;
                advanceGeneration(reason);
                callback(generation);
            });
            return true;
        }

        function beginInteraction(scope) {
            const key = String(scope || 'global');
            interactions.set(key, (interactions.get(key) || 0) + 1);
            interactionListeners.forEach(function (listener) {
                try { listener(key, true); } catch (error) { console.error('[TW Runtime] Interaction listener failed', error); }
            });
        }

        function endInteraction(scope) {
            const key = String(scope || 'global');
            const remaining = (interactions.get(key) || 0) - 1;
            if (remaining > 0) interactions.set(key, remaining);
            else interactions.delete(key);
            interactionListeners.forEach(function (listener) {
                try { listener(key, remaining > 0); } catch (error) { console.error('[TW Runtime] Interaction listener failed', error); }
            });
        }

        function isInteractionActive(scope) {
            return (interactions.get(String(scope || 'global')) || 0) > 0;
        }

        function onInteractionChange(listener) {
            if (typeof listener !== 'function') return function () {};
            interactionListeners.add(listener);
            return function () { interactionListeners.delete(listener); };
        }

        function installInteractionTracking(target) {
            if (!target) return;
            const scopesByElement = typeof WeakMap === 'function' ? new WeakMap() : null;
            function resolveScope(element) {
                const scoped = element?.closest?.('[data-twpf-interaction-scope]');
                return scoped?.getAttribute('data-twpf-interaction-scope') || 'ui-editing';
            }
            addEventListener('runtime:interaction-focusin', target, 'focusin', function (event) {
                const element = event.target;
                if (!element?.matches?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
                if (scopesByElement?.has(element)) return;
                const scope = resolveScope(element);
                if (scopesByElement) scopesByElement.set(element, scope);
                beginInteraction(scope);
            }, true);
            addEventListener('runtime:interaction-focusout', target, 'focusout', function (event) {
                const element = event.target;
                const scope = scopesByElement?.get(element) || resolveScope(element);
                scopesByElement?.delete(element);
                endInteraction(scope);
            }, true);
        }

        function stats() {
            return {
                generation,
                listeners: eventListeners.size,
                observers: observers.size,
                intervals: intervals.size,
                timeouts: timeouts.size,
                claimedFeatures: featureClaims.size
            };
        }

        function disposeAll() {
            Array.from(eventListeners.keys()).forEach(removeEventListener);
            Array.from(intervals.keys()).forEach(clearLogicalInterval);
            Array.from(timeouts.keys()).forEach(clearLogicalTimeout);
            Array.from(observers.keys()).forEach(clearObserver);
            interactions.clear();
            interactionListeners.clear();
        }

        return {
            addEventListener,
            removeEventListener,
            setInterval: setLogicalInterval,
            clearInterval: clearLogicalInterval,
            setTimeout: setLogicalTimeout,
            clearTimeout: clearLogicalTimeout,
            setObserver,
            clearObserver,
            claimFeature,
            onceAsync,
            currentGeneration: function () { return generation; },
            advanceGeneration,
            requestReconcile,
            beginInteraction,
            endInteraction,
            isInteractionActive,
            onInteractionChange,
            installInteractionTracking,
            stats,
            disposeAll
        };
    }

    function createWriteBehindStore(options = {}) {
        const storage = options.storage || root.localStorage;
        const clock = options.clock || root;
        const delayMs = Math.max(0, Number(options.delayMs) || 100);
        const pending = new Map();
        let flushTimer = null;

        function flush() {
            if (flushTimer !== null) {
                clock.clearTimeout(flushTimer);
                flushTimer = null;
            }
            const writes = Array.from(pending.entries());
            pending.clear();
            writes.forEach(function ([key, operation]) {
                try {
                    if (operation.remove) storage.removeItem(key);
                    else if (typeof safeLocalStorageSet === 'function') safeLocalStorageSet(key, operation.value);
                    else storage.setItem(key, operation.value);
                } catch (error) {
                    if (typeof reportStorageError === 'function') reportStorageError(error, 'flushing ' + key);
                    else console.warn('[TW WriteBehind] Failed to flush ' + key, error);
                }
            });
        }

        function scheduleFlush() {
            if (flushTimer !== null) return;
            flushTimer = clock.setTimeout(flush, delayMs);
        }

        function set(key, value, writeOptions = {}) {
            const serialized = typeof value === 'string' ? value : JSON.stringify(value);
            if (writeOptions.immediate) {
                pending.delete(key);
                if (typeof safeLocalStorageSet === 'function') safeLocalStorageSet(key, serialized);
                else storage.setItem(key, serialized);
                return;
            }
            pending.set(key, { value: serialized, remove: false });
            scheduleFlush();
        }

        function remove(key, writeOptions = {}) {
            if (writeOptions.immediate) {
                pending.delete(key);
                storage.removeItem(key);
                return;
            }
            pending.set(key, { remove: true });
            scheduleFlush();
        }

        function get(key) {
            const operation = pending.get(key);
            if (operation) return operation.remove ? null : operation.value;
            return storage.getItem(key);
        }

        return { set, remove, get, flush, pendingCount: function () { return pending.size; } };
    }

    root.createRuntimeRegistry = createRuntimeRegistry;
    root.createWriteBehindStore = createWriteBehindStore;
    if (!root.PremiumFeaturesRuntimeRegistry) {
        root.PremiumFeaturesRuntimeRegistry = createRuntimeRegistry();
    }
    if (!root.PremiumFeaturesWriteBehind) {
        root.PremiumFeaturesWriteBehind = createWriteBehindStore();
        root.PremiumFeaturesRuntimeRegistry.addEventListener(
            'write-behind:pagehide', root, 'pagehide', root.PremiumFeaturesWriteBehind.flush
        );
    }
})(window);

var RuntimeRegistry = window.PremiumFeaturesRuntimeRegistry;
var WriteBehindStorage = window.PremiumFeaturesWriteBehind;
