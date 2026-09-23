// Bounded, local-only diagnostics for cache/scheduler/request decisions.
(function (root) {
    'use strict';

    function createLocalDiagnostics(options = {}) {
        const capacity = Math.max(20, Number(options.capacity) || 400);
        const now = options.now || (() => Date.now());
        const entries = [];
        const counters = Object.create(null);
        let sequence = 0;

        function tabId() {
            return root.PremiumFeaturesCoordination?.tabId || options.tabId || 'uncoordinated';
        }

        function record(fields = {}) {
            const status = String(fields.status || fields.event || fields.outcome || 'INFO').toUpperCase();
            const entry = Object.assign({
                sequence: ++sequence,
                timestamp: now(),
                tabId: tabId(),
                status
            }, fields, { status });
            entries.push(entry);
            if (entries.length > capacity) entries.splice(0, entries.length - capacity);
            counters[status] = (counters[status] || 0) + 1;
            if (status === 'COALESCED' || (status === 'SKIPPED' && /duplicate|lease-unavailable/i.test(String(entry.reason || '')))) {
                counters.PREVENTED_DUPLICATES = (counters.PREVENTED_DUPLICATES || 0) + 1;
            }
            if (status === 'SKIPPED' && /stale|generation/i.test(String(entry.reason || ''))) {
                counters.DISCARDED_STALE_CALLBACKS = (counters.DISCARDED_STALE_CALLBACKS || 0) + 1;
            }
            return entry;
        }

        function request(fields, run) {
            const startedAt = now();
            record(Object.assign({}, fields, { status: 'NETWORK' }));
            return Promise.resolve().then(run).then(value => {
                record(Object.assign({}, fields, {
                    status: 'NETWORK_COMPLETE',
                    duration: Math.max(0, now() - startedAt),
                    httpStatus: Number(value?.status) || undefined
                }));
                return value;
            }, error => {
                record(Object.assign({}, fields, {
                    status: 'NETWORK_FAILED',
                    duration: Math.max(0, now() - startedAt),
                    httpStatus: Number(error?.status ?? error?.response?.status) || undefined
                }));
                throw error;
            });
        }

        return {
            record,
            request,
            getEntries: () => entries.slice(),
            getCounters: () => Object.assign({}, counters),
            clear: function () {
                entries.length = 0;
                Object.keys(counters).forEach(key => delete counters[key]);
            },
            capacity
        };
    }

    root.createLocalDiagnostics = createLocalDiagnostics;
    root.PremiumFeaturesDiagnostics = root.PremiumFeaturesDiagnostics || createLocalDiagnostics();
})(window);

var PremiumFeaturesDiagnostics = window.PremiumFeaturesDiagnostics;
