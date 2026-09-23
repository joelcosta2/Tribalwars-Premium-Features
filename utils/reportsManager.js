/**
 * Owns attack-report fetching, caching, parsing, and persistence.
 * Rendering integrations consume the public window.TWPFMapReports API.
 */
(function () {
    const REPORTS_FETCH_TTL_MS = 15 * 60 * 1000;
    const REPORTS_PRUNE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
    const REPORT_DETAIL_NEGATIVE_TTL_MS = 60 * 1000;
    const REPORTS_BACKOFF_MS = [30000, 60000, 120000, 300000, 600000];
    const REQUEST_DELAY_MS = 200;
    const REPORTS_GROUP_ID = 0;
    const DEFAULT_HIDDEN_RESOURCE_BUILDING_LEVEL = 0;
    const MAX_WAREHOUSE_CAPACITY = 400000;
    const SAFE_WAREHOUSE_CAPACITY_RATIO = 0.9;
    const RESOURCE_PRODUCTION_BY_LEVEL = [
        10, 30, 35, 41, 47, 55, 64, 74, 86, 100, 117,
        136, 158, 184, 214, 249, 289, 337, 391, 455, 530,
        616, 717, 833, 969, 1127, 1311, 1525, 1774, 2063, 2400
    ];
    let reportsCache = null;
    let syncPromise = null;
    let fullReportPromises = new Map();
    const fullReportNegativeCache = new Map();

    function delay() {
        return new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
    }

    function getAll() {
        return reportsCache;
    }

    async function hydrate() {
        if (reportsCache === null) reportsCache = await reportGetAll();
        return reportsCache;
    }

    function getMode() {
        const setting = settings_cookies.general?.show__heatmap_reports;
        if (!setting) return 'resources';
        return typeof setting === 'object' ? setting.mode || 'resources' : 'resources';
    }

    function isEnabled() {
        const setting = settings_cookies.general?.show__heatmap_reports;
        return typeof setting === 'object' ? !!setting.enabled : !!setting;
    }

    function isOwnVillage(coords) {
        const key = String(coords || '').replace('|', '');
        const village = TWMap?.villages?.[key];
        return village && String(village.owner) === String(game_data?.player?.id);
    }

    function resourceTotal(resources) {
        if (!resources) return 0;
        return ['wood', 'stone', 'iron'].reduce((total, resource) => total + (Number(resources[resource]) || 0), 0);
    }

    function classifyResources(report) {
        const discoveredTotal = resourceTotal(report.spyDiscover);
        if (report.spyDiscover && discoveredTotal > 0) {
            if (discoveredTotal >= 10000) return { color: '#43a047', label: 'high' };
            if (discoveredTotal >= 2000) return { color: '#fbc02d', label: 'medium' };
            return { color: '#ef5350', label: 'low' };
        }
        if (!report.loot || report.loot.popTotal == null || report.loot.popLooted == null) return null;
        return Number(report.loot.popLooted) < Number(report.loot.popTotal)
            ? { color: '#8b0000', label: 'empty' }
            : { color: '#ef6c00', label: 'possible' };
    }

    function classifyTime(report) {
        const timestamp = new Date(convertDateToISO(report.date) || 0).getTime();
        if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
        const age = Date.now() - timestamp;
        if (age < 0 || age > 3 * 24 * 60 * 60 * 1000) return null;
        if (age <= 12 * 60 * 60 * 1000) return { color: '#d32f2f', label: 'red' };
        if (age <= 24 * 60 * 60 * 1000) return { color: '#fbc02d', label: 'yellow' };
        return { color: '#43a047', label: 'green' };
    }

    async function sync(options = {}) {
        const retryAt = Number(localStorage.getItem('reports_soft_pause_until')) || 0;
        if (!options.force && retryAt > Date.now()) {
            window.PremiumFeaturesDiagnostics?.record?.({
                feature: 'reports', taskKey: 'reports-sync', logicalResource: 'reports-list',
                status: 'SOFT_PAUSE', reason: 'reports-backoff'
            });
            return { changed: false, newReports: [], groupId: null, retryAt };
        }
        const scheduler = window.PremiumFeaturesBackgroundScheduler;
        if (!options.scheduled && scheduler?.enqueue) {
            const scheduled = await scheduler.enqueue({
                key: 'reports:sync',
                priority: scheduler.PRIORITY?.REFRESH || 4,
                dueMode: scheduler.DUE_MODE?.EARLIEST || 'EARLIEST',
                leaseKey: 'reports-sync',
                rerunWhileActive: true,
                run: function () { return sync(Object.assign({}, options, { scheduled: true })); }
            });
            return scheduled?.value || { changed: false, newReports: [], groupId: null };
        }
        if (syncPromise) {
            window.PremiumFeaturesDiagnostics?.record?.({
                feature: 'reports', taskKey: 'reports-sync', logicalResource: 'reports-list',
                status: 'COALESCED', reason: 'sync-in-flight'
            });
            return syncPromise;
        }
        syncPromise = (async () => {
            const storedReports = await hydrate();
            const lastFetch = parseInt(localStorage.getItem('reports_last_fetch') || '0', 10);
            if (!options.force && lastFetch > 0 && Date.now() - lastFetch < REPORTS_FETCH_TTL_MS) {
                window.PremiumFeaturesDiagnostics?.record?.({
                    feature: 'reports', taskKey: 'reports-sync', logicalResource: 'reports-list',
                    status: 'CACHE_HIT', reason: 'reports-ttl'
                });
                return { changed: false, newReports: [], groupId: null };
            }

            const firstPageData = await fetchReportsPage(0);
            if (!firstPageData) return { changed: false, newReports: [], groupId: null };
            const knownIds = new Set(storedReports.map(report => report.id));
            const fetchedReports = await fetchAllReports(knownIds, firstPageData);
            const newReports = fetchedReports.reports;

            const reportsMap = new Map(storedReports.map(report => [report.coords, report]));
            const changedCoords = new Set();
            const effectiveNewReports = [];
            newReports.forEach(report => {
                const existing = reportsMap.get(report.coords);
                if (!existing || isNewer(report.date, existing.date)) {
                    reportsMap.set(report.coords, report);
                    changedCoords.add(report.coords);
                    effectiveNewReports.push(report);
                }
            });

            const pruneThreshold = Date.now() - REPORTS_PRUNE_AGE_MS;
            const removedCoords = [];
            for (const [coords, report] of reportsMap) {
                const timestamp = new Date(convertDateToISO(report.date) || 0).getTime();
                if (timestamp > 0 && timestamp < pruneThreshold) {
                    reportsMap.delete(coords);
                    removedCoords.push(coords);
                }
            }

            reportsCache = [...reportsMap.values()];
            await Promise.all([
                ...[...changedCoords].filter(coords => reportsMap.has(coords)).map(coords => reportSet(coords, reportsMap.get(coords))),
                ...removedCoords.map(coords => reportRemove(coords))
            ]);
            if (fetchedReports.complete) localStorage.setItem('reports_last_fetch', String(Date.now()));
            if (typeof reconcileQuickFarmAttacks === 'function' && typeof getQuickFarmAttacksBySourceVillage === 'function') {
                const sourceVillageId = game_data?.village?.id;
                if (sourceVillageId != null) {
                    const attacks = await getQuickFarmAttacksBySourceVillage(sourceVillageId);
                    await reconcileQuickFarmAttacks(attacks, reportsCache);
                }
            }
            // So the heatmap can classify newly-synced reports without waiting for a village hover.
            if (effectiveNewReports.length > 0 && isEnabled() && getMode() === 'resources') {
                await hydrateReportsForHeatmap(effectiveNewReports);
            }
            notifyUpdated();
            return { changed: changedCoords.size > 0, newReports: effectiveNewReports, groupId: REPORTS_GROUP_ID };
        })().catch(error => {
            console.error('[Report Manager] Error syncing reports:', error);
            return { changed: false, newReports: [], groupId: null };
        }).finally(() => {
            syncPromise = null;
        });
        return syncPromise;
    }

    async function fetchAllReports(knownIds = new Set(), firstPageData = null) {
        const firstPage = firstPageData || await fetchReportsPage(0);
        if (!firstPage) return { reports: [], complete: false };
        const parser = new DOMParser();
        const doc = parser.parseFromString(firstPage, 'text/html');
        const totalPages = doc.querySelectorAll('.paged-nav-item').length + 1;
        let allReports = extractReports(doc);
        if (knownIds.size > 0 && allReports.some(report => knownIds.has(report.id))) {
            return { reports: allReports, complete: true };
        }
        let complete = true;
        for (let page = 1; page < totalPages; page++) {
            const pageData = await fetchReportsPage(page * 12);
            if (!pageData) {
                complete = false;
                break; // the task is now soft-paused; never walk into immediate retries
            }
            const pageReports = extractReports(parser.parseFromString(pageData, 'text/html'));
            allReports.push(...pageReports);
            if (knownIds.size > 0 && pageReports.some(report => knownIds.has(report.id))) break;
            await delay();
        }
        return { reports: allReports, complete };
    }

    async function fetchReportsPage(from) {
        const url = `${game_data.link_base_pure}report&mode=attack&group_id=${REPORTS_GROUP_ID}&from=${from}`;
        try {
            const run = () => fetch(url, { cache: 'no-store' });
            const response = await (window.PremiumFeaturesDiagnostics?.request
                ? window.PremiumFeaturesDiagnostics.request({
                    feature: 'reports', taskKey: 'reports-sync', logicalResource: 'reports-page:' + from,
                    method: 'GET', reason: 'reports-sync'
                }, run)
                : run());
            if (!response.ok) {
                const responseError = new Error(`HTTP error! status: ${response.status}`);
                responseError.status = response.status;
                responseError.url = response.url || url;
                throw responseError;
            }
            const text = await response.text();
            localStorage.removeItem('reports_soft_pause_until');
            localStorage.removeItem('reports_failure_count');
            return text;
        } catch (error) {
            console.error(`[Report Manager] Failed to fetch reports from ${url}:`, error);
            const failure = window.PremiumFeaturesAsync?.classifyRequestFailure?.(error, { url }) || {};
            if (failure.transient) {
                const count = (Number(localStorage.getItem('reports_failure_count')) || 0) + 1;
                const delayMs = REPORTS_BACKOFF_MS[Math.min(count - 1, REPORTS_BACKOFF_MS.length - 1)];
                localStorage.setItem('reports_failure_count', String(count));
                localStorage.setItem('reports_soft_pause_until', String(Date.now() + delayMs));
                window.PremiumFeaturesDiagnostics?.record?.({
                    feature: 'reports', taskKey: 'reports-sync', logicalResource: 'reports-list',
                    status: 'SOFT_PAUSE', reason: 'reports-fetch-failed'
                });
            }
            return null;
        }
    }

    function extractReports(doc) {
        const reports = [];
        doc.querySelectorAll('.quickedit-label').forEach(label => {
            const row = label.closest('tr');
            const title = label.closest('.report-title');
            const coordsMatch = label.textContent.match(/\((\d{1,3}\|\d{1,3})\)(?=[^\(]*$)/);
            const dateElement = row?.querySelectorAll('.nowrap')[1];
            const reportId = title?.getAttribute('data-id');
            if (!row || !coordsMatch || !dateElement || !reportId) return;
            const dotImg = row.querySelector('.report-subject img[src*="dots/"]');
            reports.push({ id: reportId, coords: coordsMatch[1], date: dateElement.innerText.trim(), dot: dotImg ? { src: dotImg.src, title: dotImg.getAttribute('data-title') || '' } : null });
        });
        return reports;
    }

    function isNewer(date1, date2) {
        if (!date2) return true;
        if (!date1) return false;
        const time1 = new Date(convertDateToISO(date1)).getTime();
        const time2 = new Date(convertDateToISO(date2)).getTime();
        if (isNaN(time1)) return false;
        if (isNaN(time2)) return true;
        return time1 > time2;
    }

    function convertDateToISO(dateStr) {
        if (!dateStr) return null;
        const now = new Date();
        const targetDate = new Date();
        const lowerDate = dateStr.toLowerCase();
        const isToday = lowerDate.includes('today') || lowerDate.includes('hoje');
        const isYesterday = lowerDate.includes('yesterday') || lowerDate.includes('ontem');
        if (lowerDate.includes(':') && (isToday || isYesterday)) {
            const timeMatch = dateStr.match(/(\d{1,2}):(\d{2})/);
            if (!timeMatch) return null;
            targetDate.setTime(twWallClockToEpochMs(parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10), 0, isYesterday ? -1 : 0));
        } else {
            const parts = dateStr.match(/([a-z]{3})\.?\s+(\d+),\s+(?:(\d{4})\s+)?(\d{1,2}):(\d{2})/i);
            if (!parts) return null;
            const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11, fev: 1, abr: 3, mai: 4, ago: 7, set: 8, out: 9, dez: 11 };
            const month = monthMap[parts[1].toLowerCase().replace('.', '')];
            const year = parts[3] ? parseInt(parts[3], 10) : now.getFullYear();
            let epochMs = Date.UTC(year, month, parseInt(parts[2], 10)) + parseInt(parts[4], 10) * 3600000 + parseInt(parts[5], 10) * 60000 - serverTimezoneOffsetMs;
            if (!parts[3] && epochMs > Timing.getCurrentServerTime()) epochMs = Date.UTC(year - 1, month, parseInt(parts[2], 10)) + parseInt(parts[4], 10) * 3600000 + parseInt(parts[5], 10) * 60000 - serverTimezoneOffsetMs;
            targetDate.setTime(epochMs);
        }
        return targetDate.toISOString();
    }

    function extractResourceAmounts(container) {
        if (!container) return null;
        const amounts = { wood: 0, stone: 0, iron: 0 };
        let found = false;
        ['wood', 'stone', 'iron'].forEach(resource => {
            const icon = container.querySelector('.icon.header.' + resource);
            if (!icon) return;
            found = true;
            const wrapper = icon.closest('.nowrap') || icon.parentElement;
            amounts[resource] = parseInt((wrapper?.textContent || '').replace(/\D/g, ''), 10) || 0;
        });
        return found ? amounts : null;
    }

    function extractReportAttackFacts(doc) {
        const sourceVillageId = doc.querySelector('#attack_info_att .village_anchor[data-id]')?.getAttribute('data-id') || null;
        const unitsTable = doc.getElementById('attack_info_att_units');
        const rows = unitsTable?.querySelectorAll('tbody > tr') || [];
        const quantityRow = Array.from(rows).find(row => /quantidade|quantity/i.test(row.textContent));
        const lossesRow = Array.from(rows).find(row => /perdas|losses/i.test(row.textContent));
        let losses = null;
        if (quantityRow && lossesRow) {
            const quantities = Array.from(quantityRow.querySelectorAll('[data-unit-count]'))
                .reduce((total, cell) => total + (parseInt(cell.dataset.unitCount || '0', 10) || 0), 0);
            const lost = Array.from(lossesRow.querySelectorAll('[data-unit-count]'))
                .reduce((total, cell) => total + (parseInt(cell.dataset.unitCount || '0', 10) || 0), 0);
            losses = lost === quantities && quantities > 0 ? 'full' : lost > 0 ? 'partial' : 'none';
        }
        return { sourceVillageId, losses };
    }

    function extractSpyWallLevel(doc) {
        const tables = doc.querySelectorAll('#attack_spy_buildings_left, #attack_spy_buildings_right');
        for (const table of tables) {
            for (const row of table.querySelectorAll('tr')) {
                if (!row.querySelector('img[src*="wall.webp"], img[src*="wall.png"]')) continue;
                const cells = row.querySelectorAll('td');
                const level = parseInt(cells[1]?.textContent.trim() || '', 10);
                if (Number.isFinite(level)) return level;
            }
        }
        return 0;
    }

    function extractSpyBuildingLevels(doc) {
        const element = doc.getElementById('attack_spy_building_data');
        if (element?.value) {
            try {
                const buildings = JSON.parse(element.value);
                const levels = {};
                buildings.forEach(building => {
                    if (['wood', 'stone', 'iron', 'storage'].includes(building.id)) {
                        const level = parseInt(building.level, 10);
                        if (Number.isFinite(level) && level >= 0) {
                            if (building.id === 'storage') levels.storage = level;
                            else levels[building.id] = level;
                        }
                    }
                });
                if (Object.keys(levels).length > 0) {
                    return {
                        wood: levels.wood ?? DEFAULT_HIDDEN_RESOURCE_BUILDING_LEVEL,
                        stone: levels.stone ?? DEFAULT_HIDDEN_RESOURCE_BUILDING_LEVEL,
                        iron: levels.iron ?? DEFAULT_HIDDEN_RESOURCE_BUILDING_LEVEL,
                        storage: levels.storage ?? null
                    };
                }
            } catch {
                // Fall back to the visible spy building tables below.
            }
        }

        const levels = {};
        doc.querySelectorAll('#attack_spy_buildings_left tr, #attack_spy_buildings_right tr').forEach(row => {
            const image = row.querySelector('img[src*="/buildings/"], img[data-src*="/buildings/"]');
            const imageUrl = image?.getAttribute('src') || image?.getAttribute('data-src') || '';
            const match = imageUrl.match(/\/buildings\/(wood|stone|iron)\.(?:webp|png|gif)/i);
            if (!match) {
                const storageMatch = imageUrl.match(/\/buildings\/(storage|warehouse)\.(?:webp|png|gif)/i);
                if (!storageMatch) return;
                const storageCells = row.querySelectorAll('td');
                const storageLevel = parseInt(storageCells[1]?.textContent.trim() || '', 10);
                if (Number.isFinite(storageLevel) && storageLevel >= 0) levels.storage = storageLevel;
                return;
            }
            const cells = row.querySelectorAll('td');
            const level = parseInt(cells[1]?.textContent.trim() || '', 10);
            if (Number.isFinite(level) && level >= 0) levels[match[1].toLowerCase()] = level;
        });
        return {
            wood: levels.wood ?? DEFAULT_HIDDEN_RESOURCE_BUILDING_LEVEL,
            stone: levels.stone ?? DEFAULT_HIDDEN_RESOURCE_BUILDING_LEVEL,
            iron: levels.iron ?? DEFAULT_HIDDEN_RESOURCE_BUILDING_LEVEL,
            storage: levels.storage ?? null
        };
    }

    function getWarehouseCapacity(level) {
        const storageLevel = Number(level);
        if (!Number.isFinite(storageLevel) || storageLevel < 1) return null;
        return Math.min(MAX_WAREHOUSE_CAPACITY, Math.floor(1000 * Math.pow(1.2296, storageLevel - 1)));
    }

    function getSafeWarehouseCapacity(level) {
        const capacity = getWarehouseCapacity(level);
        return capacity === null ? null : Math.floor(capacity * SAFE_WAREHOUSE_CAPACITY_RATIO);
    }

    function getExpectedResources(report, travelTimeHours = 0) {
        if (!report?.hasSpy || !report.spyBuildingLevels || !report.spyDiscover) {
            console.log('[Report] Expected resources unavailable:', {
                id: report?.id,
                hasSpy: report?.hasSpy,
                spyBuildingLevels: report?.spyBuildingLevels,
                spyDiscover: report?.spyDiscover,
                loot: report?.loot
            });
            return null;
        }

        const worldKey = 'world_settings_' + (game_data?.world || window.location.hostname);
        let settings = {};
        try {
            settings = JSON.parse(localStorage.getItem(worldKey) || '{}');
        } catch {
            settings = {};
        }
        const worldSpeed = Number(settings.game_speed ?? settings.speed ?? 1) || 1;
        const reportTime = new Date(convertDateToISO(report.date) || 0).getTime();
        if (!Number.isFinite(reportTime) || reportTime <= 0) return null;

        const totalHours = Math.max(0, (Date.now() - reportTime) / 3600000) + Math.max(0, Number(travelTimeHours) || 0);
        const warehouseCapacity = getSafeWarehouseCapacity(report.spyBuildingLevels.storage);
        return ['wood', 'stone', 'iron'].reduce((resources, resource) => {
            const level = Number(report.spyBuildingLevels[resource]) || 0;
            const baseHourly = RESOURCE_PRODUCTION_BY_LEVEL[level] || 0;
            const hourly = Math.round(baseHourly * worldSpeed);
            const projected = Math.floor((Number(report.spyDiscover?.[resource]) || 0) + hourly * totalHours);
            resources[resource] = warehouseCapacity === null
                ? projected
                : Math.min(warehouseCapacity, projected);
            return resources;
        }, {});
    }

    function hasFullReportData(report) {
        const fields = ['loot', 'spyDiscover', 'spyBuildingLevels', 'wallLevel', 'hasSpy', 'sourceVillageId', 'losses'];
        return report?.fetchedFull === true
            && fields.every(field => Object.prototype.hasOwnProperty.call(report, field))
            && (!report.hasSpy || (report.spyBuildingLevels && report.spyBuildingLevels.storage != null));
    }

    // Bounded to just the reports this sync cycle found new/changed, not the whole cache.
    async function hydrateReportsForHeatmap(reports) {
        const pending = reports.filter(report => report?.coords && !isOwnVillage(report.coords) && !hasFullReportData(report));
        for (let index = 0; index < pending.length; index++) {
            await hydrateFullReport(pending[index], { insideScheduler: true });
            if (index + 1 < pending.length) await delay();
        }
    }

    async function hydrateFullReport(report, options = {}) {
        if (!report) return report;
        if (hasFullReportData(report)) {
            window.PremiumFeaturesDiagnostics?.record?.({
                feature: 'reports', logicalResource: 'report:' + report.id,
                status: 'CACHE_HIT', reason: 'immutable-report-detail'
            });
            return report;
        }
        const reportKey = String(report.id || '');
        if (Number(fullReportNegativeCache.get(reportKey) || 0) > Date.now()) {
            window.PremiumFeaturesDiagnostics?.record?.({
                feature: 'reports', logicalResource: 'report:' + reportKey,
                status: 'SKIPPED', reason: 'negative-cache'
            });
            return null;
        }
        console.log('[Report] Fetching full report:', report.id);
        if (fullReportPromises.has(reportKey)) {
            window.PremiumFeaturesDiagnostics?.record?.({
                feature: 'reports', logicalResource: 'report:' + reportKey,
                status: 'COALESCED', reason: 'detail-in-flight'
            });
            return fullReportPromises.get(reportKey);
        }
        const promise = (async () => {
            try {
                const url = '/game.php?screen=report&view=' + encodeURIComponent(report.id);
                const request = () => fetchWithRetry429({ url, type: 'GET', cache: false });
                const load = () => window.PremiumFeaturesDiagnostics?.request
                    ? window.PremiumFeaturesDiagnostics.request({
                        feature: 'reports', logicalResource: 'report:' + reportKey,
                        method: 'GET', reason: 'report-detail'
                    }, request)
                    : request();
                let data;
                const scheduler = window.PremiumFeaturesBackgroundScheduler;
                if (!options.insideScheduler && scheduler?.enqueue) {
                    const scheduled = await scheduler.enqueue({
                        key: 'manual:report:' + reportKey,
                        priority: scheduler.PRIORITY?.MANUAL || 1,
                        dueMode: scheduler.DUE_MODE?.EARLIEST || 'EARLIEST',
                        run: load
                    });
                    if (scheduled?.status !== 'COMPLETED') throw scheduled?.error || new Error('Report detail task did not complete');
                    data = scheduled.value;
                } else {
                    data = await load();
                }
                const tempDoc = new DOMParser().parseFromString(data, 'text/html');
                const attackFacts = extractReportAttackFacts(tempDoc);
                report.loot = null;
                report.spyDiscover = null;
                report.spyBuildingLevels = null;
                report.sourceVillageId = attackFacts.sourceVillageId;
                report.losses = attackFacts.losses;
                const lootRow = Array.from(tempDoc.querySelectorAll('#attack_results tr')).find(row => row.querySelector('.icon.header.wood, .icon.header.stone, .icon.header.iron'));
                if (lootRow) {
                    const cells = lootRow.querySelectorAll('td');
                    const resourceCellIndex = Array.from(cells).findIndex(cell => cell.querySelector('.icon.header.wood, .icon.header.stone, .icon.header.iron'));
                    const resourceCell = resourceCellIndex >= 0 ? cells[resourceCellIndex] : null;
                    report.loot = extractResourceAmounts(resourceCell);
                    if (report.loot) {
                        const popParts = (cells[resourceCellIndex + 1]?.textContent || '').split('/').map(value => parseInt(value.replace(/\D/g, ''), 10) || 0);
                        report.loot.popLooted = popParts[0] || 0;
                        report.loot.popTotal = popParts[1] || 0;
                    }
                }
                const spyTable = tempDoc.getElementById('attack_spy_resources');
                report.hasSpy = Boolean(spyTable || tempDoc.querySelector('#attack_spy_buildings_left, #attack_spy_buildings_right'));
                report.spyBuildingLevels = report.hasSpy ? extractSpyBuildingLevels(tempDoc) : null;
                if (spyTable) {
                    spyTable.querySelectorAll('tr').forEach(row => {
                        if (row.querySelector('.relic-quality-shoddy, [class*="relic-quality"], [class*="inline-relic"]')) row.remove();
                    });
                    report.spyDiscover = extractResourceAmounts(spyTable) || { wood: 0, stone: 0, iron: 0 };
                }
                report.wallLevel = extractSpyWallLevel(tempDoc);
                report.fetchedFull = !report.hasSpy || !!report.spyBuildingLevels;
                report.fetchedFullAt = Date.now();
                console.log('[Report] Full report extracted:', {
                    id: report.id,
                    hasSpy: report.hasSpy,
                    spyDiscover: report.spyDiscover,
                    spyBuildingLevels: report.spyBuildingLevels,
                    loot: report.loot,
                    fetchedFull: report.fetchedFull
                });
                if (reportsCache === null) await hydrate();
                const index = reportsCache.findIndex(item => item.coords === report.coords);
                if (index >= 0) reportsCache[index] = report;
                await reportSet(report.coords, report);
                notifyUpdated();
                return report;
            } catch (error) {
                console.error('[Report] Failed to fetch report:', error);
                fullReportNegativeCache.set(reportKey, Date.now() + REPORT_DETAIL_NEGATIVE_TTL_MS);
                return null;
            } finally {
                fullReportPromises.delete(reportKey);
            }
        })();
        fullReportPromises.set(reportKey, promise);
        return promise;
    }

    function notifyUpdated() {
        if (typeof window.TWPFMapReports?.rebuild === 'function' && window.TWPFMapReports.rebuild !== rebuild) {
            window.TWPFMapReports.rebuild();
        }
    }

    function rebuild() {
        return window.TWPFMapReports?.rebuildHeatmap?.();
    }

    async function removeByIds(reportIds) {
        const removed = await reportRemoveByIds(reportIds);
        const removedIds = new Set(removed.map(report => String(report.id || '')));
        if (reportsCache) {
            reportsCache = reportsCache.filter(report => !removedIds.has(String(report.id || '')));
        }
        return removed;
    }

    window.TWPFMapReports = {
        getAll,
        hydrate,
        sync,
        hydrateFullReport,
        isFullReportData: hasFullReportData,
        notifyUpdated,
        removeByIds,
        needsInitialBuild: () => false,
        getMode,
        isEnabled,
        classifyResources,
        classifyTime,
        convertDateToISO,
        isOwnVillage,
        getWarehouseCapacity,
        getSafeWarehouseCapacity,
        getExpectedResources,
        rebuild
    };
})();
