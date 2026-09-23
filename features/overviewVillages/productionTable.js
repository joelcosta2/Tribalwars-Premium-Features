function renderActiveQueueIcons(cell, villageId, doc) {
    const queueBuildIdsActive = bqGet('building_queue_active', villageId) || [];
    if (!queueBuildIdsActive.length) return;

    const slots = (bqGet('building_queue_slots', villageId) || []).map(Number);

    queueBuildIdsActive.forEach(function (id, index) {
        const buildingId = id.replace(/[0-9]/g, '');
        const buildingName = doc.querySelector('.visual-label-' + buildingId)?.getAttribute('data-title') || buildingId;

        function getBodyHtml() {
            const now = Date.now();
            if (index === 0) {
                const fmt = formatQueueRemaining((slots[0] || 0) - now);
                return fmt
                    ? `<div style="margin-top:3px;border-top:1px solid #c1a264;padding-top:3px;">${t('buildQueue.finishesIn', { time: fmt })}</div>`
                    : `<div style="margin-top:3px;color:#aaa;">${t('buildQueue.finishingSoon')}</div>`;
            }
            const startFmt = formatQueueRemaining((slots[index - 1] || 0) - now);
            const endFmt = formatQueueRemaining((slots[index] || 0) - now);
            return (startFmt ? `<div style="margin-top:3px;border-top:1px solid #c1a264;padding-top:3px;">${t('buildQueue.startsIn', { time: startFmt })}</div>` : '')
                + (endFmt ? `<div>${t('buildQueue.finishesIn', { time: endFmt })}</div>` : `<div style="color:#aaa;">${t('buildQueue.finishingSoon')}</div>`);
        }

        var anchor = document.createElement('a');
        anchor.style.display = 'inline-flex';
        anchor.style.border = '1px solid #7d510f';

        var span = document.createElement('span');
        span.className = 'icon header village active_queue';
        span.style.backgroundImage = 'url(https://dspt.innogamescdn.com/asset/95eda994/graphic/buildings/mid/' + id + '.png)';
        span.style.backgroundPosition = '0px 0px';
        span.style.backgroundSize = 'contain';
        span.style.backgroundRepeat = 'no-repeat';
        span.style.width = '20px';
        span.style.height = '20px';
        span.style.marginRight = '3px';
        span.style.position = 'relative';
        span.style.display = 'inline-block';

        var progressBar = document.createElement('div');
        progressBar.style.position = 'absolute';
        progressBar.style.bottom = '0';
        progressBar.style.left = '0';
        progressBar.style.width = '100%';
        progressBar.style.height = '3px';
        progressBar.style.backgroundColor = '#4caf50';
        span.appendChild(progressBar);

        anchor.appendChild(span);
        cell.appendChild(anchor);

        attachLiveQueueTooltip(anchor, span, `<b>${escapeHtml(buildingName)}</b>`, getBodyHtml);
    });
}

/**
 * Renders the WAITING (fake/local, not yet submitted to the server) queue items for a village:
 * one icon per item, orange progress bar, tooltip shows "Next attempt in" (first item, live
 * countdown to the script's next retry) or "Position N in waiting queue" (further items) — same
 * colour/logic as the per-village widget's injectFakeQueueList.
 * @param {HTMLElement} cell
 * @param {string|number} villageId
 * @param {string[]} allBuildingsImgs - All building image URLs from this village's main page (for icons at the correct level).
 * @param {Document} doc
 */
function renderFakeQueueIcons(cell, villageId, allBuildingsImgs, doc) {
    const queueBuildIds = bqGet('building_queue', villageId) || [];
    if (!queueBuildIds.length) return;

    // Scheduled time (ms epoch) when addToBuildQueue() will next fire for this village
    const scheduledEndTime = parseInt(localStorage.getItem('endTime_' + getBuildQueueTimeoutId(villageId))) || 0;

    queueBuildIds.forEach(function (id, fakeIndex) {
        const buildingName = doc.querySelector('.visual-label-' + id)?.getAttribute('data-title') || id;

        function getBodyHtml() {
            if (fakeIndex === 0 && scheduledEndTime > 0) {
                const fmt = formatQueueRemaining(scheduledEndTime - Date.now());
                return fmt
                    ? `<div style="margin-top:3px;border-top:1px solid #c1a264;padding-top:3px;color:#888;">${t('buildQueue.nextAttemptIn', { time: fmt })}</div>`
                    : `<div style="margin-top:3px;color:#aaa;">${t('buildQueue.retryingSoon')}</div>`;
            }
            if (fakeIndex > 0) {
                return `<div style="margin-top:3px;border-top:1px solid #c1a264;padding-top:3px;color:#aaa;">${t('buildQueue.positionInQueue', { position: fakeIndex + 1 })}</div>`;
            }
            return '';
        }

        var anchor = document.createElement('a');
        anchor.style.display = 'inline-flex';
        anchor.style.border = '1px solid #7d510f';

        var span = document.createElement('span');
        span.className = 'icon header village';
        const matchedImg = allBuildingsImgs.find(el => new RegExp('/' + id + '\\d+\\.').test(el));
        span.style.backgroundImage = 'url(' + (matchedImg || ('https://dspt.innogamescdn.com/asset/95eda994/graphic/buildings/mid/' + id + '.png')) + ')';
        span.style.backgroundPosition = '0px 0px';
        span.style.backgroundSize = 'contain';
        span.style.backgroundRepeat = 'no-repeat';
        span.style.width = '20px';
        span.style.height = '20px';
        span.style.marginRight = '3px';
        span.style.position = 'relative';
        span.style.display = 'inline-block';

        var progressBar = document.createElement('div');
        progressBar.style.position = 'absolute';
        progressBar.style.bottom = '0';
        progressBar.style.left = '0';
        progressBar.style.width = '100%';
        progressBar.style.height = '3px';
        progressBar.style.backgroundColor = 'orange';
        span.appendChild(progressBar);

        anchor.appendChild(span);
        cell.appendChild(anchor);

        attachLiveQueueTooltip(anchor, span, `<b>${escapeHtml(buildingName)}</b>`, getBodyHtml);
    });
}

/**
 * Fills a table cell (already appended to a row of #production_table) with a compact summary
 * of a village's build queue: active (green) items followed by waiting/fake (orange) items,
 * each a small building icon with a live-countdown hover tooltip. Shows a dash if both queues
 * are empty. Building names/icons are resolved from `doc`, the village's own fetched
 * main-building page, since the overview_villages page itself has no building label DOM to
 * read from.
 * @param {HTMLElement} cell
 * @param {string|number} villageId
 * @param {Document} doc - Parsed main-building page HTML for this village.
 * @param {string[]} allBuildingsImgs - All building image URLs from this village's main page.
 */
function renderBuildQueueOverviewCell(cell, villageId, doc, allBuildingsImgs) {
    cell.innerHTML = '';
    cell.style.color = '';
    cell.style.display = '';
    cell.style.minHeight = '';
    cell.removeAttribute('aria-busy');

    const hasActive = (bqGet('building_queue_active', villageId) || []).length > 0;
    const hasWaiting = (bqGet('building_queue', villageId) || []).length > 0;

    if (!hasActive && !hasWaiting) {
        cell.textContent = '\u2013';
        cell.style.textAlign = 'center';
        cell.style.color = '#999';
        return;
    }

    cell.style.textAlign = 'left';
    cell.style.display = 'grid';
    cell.style.gridTemplateColumns = 'repeat(3, auto)'; // max 3 items per line
    cell.style.gap = '2px 0';
    cell.style.justifyContent = 'start';
    renderActiveQueueIcons(cell, villageId, doc);
    renderFakeQueueIcons(cell, villageId, allBuildingsImgs, doc);
    applyBuildQueueOverviewCollapse(cell);
}

/**
 * Re-renders a single village's Build Queue cell in #production_table using already-fetched
 * doc/allBuildingsImgs — used after the quick-links Build Queue overlay adds/removes/cancels an
 * item (see renderVillageBuildQueueOverlay), so the overview row doesn't show stale state until
 * the next full refresh. No-ops if the table or that village's row/cell aren't present (e.g. not
 * on the overview_villages page, or the column is disabled).
 * @param {string|number} villageId
 * @param {Document} doc - Parsed main-building page HTML for this village.
 * @param {string[]} allBuildingsImgs - All building image URLs from this village's main page.
 */
function refreshOverviewVillagesBuildQueueRow(villageId, doc, allBuildingsImgs) {
    const table = document.getElementById('production_table');
    if (!table) return;

    const row = table.querySelector('.quickedit-vn[data-id="' + villageId + '"]')?.closest('tr');
    const cell = row?.querySelector('.build-queue-overview-cell');
    if (!cell) return;

    renderBuildQueueOverviewCell(cell, villageId, doc, allBuildingsImgs);
}

/**
 * Whether build-queue cells show every row (true) or are clipped to just the first row of 3
 * icons (false, default). Shared across all rows, toggled via the header icon.
 */
let buildQueueOverviewExpanded = false;

/**
 * Clips a build-queue cell to a single 3-icon row (overflow hidden) when collapsed, or shows
 * the full queue when expanded, per the current `buildQueueOverviewExpanded` state.
 * @param {HTMLElement} cell
 */
function applyBuildQueueOverviewCollapse(cell) {
    if (buildQueueOverviewExpanded) {
        cell.style.maxHeight = '';
        cell.style.overflow = '';
    } else {
        cell.style.maxHeight = '22px'; // one row of icons
        cell.style.overflow = 'hidden';
    }
}

/**
 * Adds a "Build Queue" column to the multi-village table (#production_table) on the
 * screen=overview_villages page, showing each village's active build queue at a glance.
 * Only runs when the account has more than one village (that page/table is meaningless
 * otherwise). For every village row, fetches its main-building page in the background to
 * get fresh queue state (persisted via parseAndStoreQueueState, same mechanism used by the
 * per-village widget and the background sweep), then renders the summary cell.
 */
function refreshOverviewVillagesBuildQueue(villages) {
    const table = document.getElementById('production_table');
    if (!table) return Promise.resolve();
    const state = overviewVillagesTabsState.refreshState.production;
    const visibleVillages = villages || getOverviewVillagesVisibleVillages();
    const candidates = getOverviewVillagesRefreshCandidates('production', visibleVillages, false);
    const rowsToFetch = candidates.map(function (village) {
        const row = table.querySelector('.quickedit-vn[data-id="' + village.id + '"]')?.closest('tr');
        const cell = row?.querySelector('.build-queue-overview-cell');
        if (!cell) return null;
        cell.replaceChildren(createOverviewVillagesLoadingImage());
        cell.setAttribute('aria-busy', 'true');
        return { villageId: String(village.id), cell };
    }).filter(Boolean);

    return runWithConcurrencyLimit(rowsToFetch, function ({ villageId, cell }) {
        const request = fetchVillageMainPage(villageId)
            .then(({ doc }) => {
                parseAndStoreQueueState(doc, villageId);
                if (typeof scheduleCompletionNotification === 'function') scheduleCompletionNotification(villageId);
                const { allBuildingsImgs } = getAllBuildingsImages(doc);
                renderBuildQueueOverviewCell(cell, villageId, doc, allBuildingsImgs);
            })
            .catch(() => {
                cell.innerHTML = '?';
                cell.removeAttribute('aria-busy');
                cell.style.textAlign = 'center';
                cell.style.color = '#c33';
            })
            .finally(() => state.inFlight.delete(villageId));
        state.inFlight.set(villageId, request);
        return request.then(() => state.completed.add(villageId));
    }, { concurrency: 2, minDelay: 100, maxDelay: 250 });
}

function injectOverviewVillagesBuildQueueColumn() {
    if (!settings_cookies.general['show__overview_villages_queue']) return;
    if (!game_data?.player?.villages || game_data.player.villages < 2) return;

    const table = document.getElementById('production_table');
    if (!table) return;

    const headerRow = table.querySelector('thead tr');
    if (!headerRow || headerRow.querySelector('.build-queue-overview-header')) return;

    const th = document.createElement('th');
    th.className = 'build-queue-overview-header';
    th.style.position = 'relative';
    th.style.textAlign = 'center';
    th.textContent = t('buildQueue.title');

    const toggleIcon = document.createElement('img');
    toggleIcon.style.cssText = 'position:absolute;top:2px;left:2px;width:12px;height:12px;cursor:pointer;';
    toggleIcon.src = 'https://dspt.innogamescdn.com/asset/95eda994/graphic//icons/slide_down.png';
    toggleIcon.alt = t('overviewVillages.showFullQueue');
    toggleIcon.title = t('overviewVillages.showFullQueue');
    toggleIcon.addEventListener('click', function (event) {
        event.preventDefault();
        buildQueueOverviewExpanded = !buildQueueOverviewExpanded;
        toggleIcon.src = 'https://dspt.innogamescdn.com/asset/95eda994/graphic//icons/slide_' + (buildQueueOverviewExpanded ? 'up' : 'down') + '.png';
        toggleIcon.alt = buildQueueOverviewExpanded ? t('overviewVillages.showOneRow') : t('overviewVillages.showFullQueue');
        toggleIcon.title = buildQueueOverviewExpanded ? t('overviewVillages.showOneRow') : t('overviewVillages.showFullQueue');
        table.querySelectorAll('.build-queue-overview-cell').forEach(applyBuildQueueOverviewCollapse);
    });
    th.appendChild(toggleIcon);
    headerRow.appendChild(th);

    table.querySelectorAll('tbody tr').forEach(function (row) {
        const villageId = row.querySelector('.quickedit-vn[data-id]')?.getAttribute('data-id');
        if (!villageId) return;

        const cell = document.createElement('td');
        cell.className = 'build-queue-overview-cell';
        cell.appendChild(createOverviewVillagesLoadingImage());
        cell.setAttribute('aria-busy', 'true');
        cell.style.textAlign = 'center';
        row.appendChild(cell);

    });

    if (overviewVillagesTabsState.activeTabId === 'production') refreshOverviewVillagesBuildQueue();
}

// Fixed column order for the per-unit troop columns (screen=overview_villages), matches the
// game's own unit ordering (also used by navigationBar.js's icon picker).
const storageOverviewTimesCache = {};

/**
 * Fetches a village's /storage page and extracts its wood/stone/iron fill end-times, by
 * delegating to pageFetchManager.js's fetchStoragePage (shared with
 * features/overview.js:getStorageTime, dedupes concurrent requests for the same village).
 * Only cached in-memory here (storageOverviewTimesCache) — never re-read from localStorage —
 * which is what enforces this feature's own same-page-load-only refresh rule.
 * @param {string|number} villageId
 * @returns {Promise<Object|null>} { wood, stone, iron } end-times, or null on failure.
 */
function fetchVillageStorageTimes(villageId) {
    if (storageOverviewTimesCache[villageId]) return Promise.resolve(storageOverviewTimesCache[villageId]);

    return fetchStoragePage(villageId).then(function () {
        const times = getStorageFillTimes(villageId);
        storageOverviewTimesCache[villageId] = times;
        return times;
    }).catch(function () { return null; });
}

/**
 * Binds hover behaviour to a village's storage-capacity cell: on mouseenter, shows the native
 * tooltip (same card used by the build queue column) with a live per-second countdown to when
 * each resource fills up, fetching the data on first hover (or reusing this page's cache on
 * subsequent hovers of the same village — see storageOverviewTimesCache).
 * @param {HTMLElement} cell
 * @param {string|number} villageId
 */
function attachStorageOverviewHover(cell, villageId) {
    cell.style.cursor = 'help';
    cell.setAttribute('data-title', '<b>' + t('overviewVillages.storageHeader') + '</b>');

    const RESOURCE_LABELS = { wood: t('common.wood'), stone: t('common.clay'), iron: t('common.iron') };

    function getBodyHtml() {
        const times = storageOverviewTimesCache[villageId];
        if (!times) return '<div style="color:#aaa;">' + t('common.loading') + '</div>';

        return Object.keys(RESOURCE_LABELS).map(function (res) {
            const remainingSeconds = Math.max(0, Math.floor((times[res] * 1000 - Timing.getCurrentServerTime()) / 1000));
            return { res, remainingSeconds };
        }).sort((first, second) => first.remainingSeconds - second.remainingSeconds).map(function ({ res, remainingSeconds }, index) {
            const days = Math.floor(remainingSeconds / 86400);
            const hours = Math.floor((remainingSeconds % 86400) / 3600);
            const minutes = Math.floor((remainingSeconds % 3600) / 60);
            const seconds = remainingSeconds % 60;
            const hasDays = days > 0;
            const hasHours = hasDays || hours > 0;
            const hasMinutes = hasHours || minutes > 0;
            const formatTimePart = (value, unit, show) => show ? (unit === 'd' ? String(value) : String(value).padStart(2, '0')) + unit : '';
            const style = index === 0 ? 'margin-top:3px;border-top:1px solid #c1a264;padding-top:3px;' : '';
            const timeStyle = 'display:grid;grid-template-columns:repeat(4,auto);gap:0 5px;justify-content:end;text-align:right;white-space:nowrap;vertical-align:middle;';
            const unitStyle = 'min-width:18px;';
            const timeHtml = `<span style="${timeStyle}"><b style="${unitStyle}">${formatTimePart(days, 'd', hasDays)}</b><b style="${unitStyle}">${formatTimePart(hours, 'h', hasHours)}</b><b style="${unitStyle}">${formatTimePart(minutes, 'm', hasMinutes)}</b><b style="${unitStyle}">${formatTimePart(seconds, 's', remainingSeconds > 0)}</b></span>`;
            const valueHtml = remainingSeconds > 0 ? timeHtml : '<span class="warn" style="grid-column:2 / span 4;text-align:right;">' + t('common.full') + '</span>';
            const iconHtml = `<span class="icon ${res}" title="${RESOURCE_LABELS[res]}"></span>`;
            return `<div style="${style}display:grid;grid-template-columns:18px auto;align-items:center;column-gap:8px;vertical-align:middle;">${iconHtml}${valueHtml}</div>`;
        }).join('');
    }

    function updateCountdown(event) {
        cell.setAttribute('data-tooltip-tpl', getBodyHtml());
        toggleTooltip(event.target, true);
        cell.countdownTimeout = setTimeout(() => updateCountdown(event), 1000);
    }

    cell.addEventListener('mouseenter', function (event) {
        if (!isOverviewVillageVisible(villageId)) return;
        cell.setAttribute('data-tooltip-tpl', getBodyHtml());
        toggleTooltip(event.target, true);
        updateCountdown(event);

        fetchVillageStorageTimes(villageId).then(function () {
            cell.setAttribute('data-tooltip-tpl', getBodyHtml());
        });
    });
    cell.addEventListener('mouseleave', function (event) {
        toggleTooltip(event.target, false);
        clearTimeout(cell.countdownTimeout);
    });
}

/**
 * Adds hover-to-fetch storage fill-time tooltips to the native "Armaz\u00e9m" (storage capacity)
 * column of #production_table on screen=overview_villages. No data is fetched up-front — only on
 * first hover per village (see fetchVillageStorageTimes/attachStorageOverviewHover).
 */
function injectOverviewVillagesStorageHover() {
    if (!game_data?.player?.villages || game_data.player.villages < 2) return;

    const table = document.getElementById('production_table');
    if (!table) return;

    const columnIndex = getOverviewVillagesColumnIndex(table, 'storage_max');
    if (columnIndex === -1) return;

    table.querySelectorAll('tbody tr').forEach(function (row) {
        const villageId = row.querySelector('.quickedit-vn[data-id]')?.getAttribute('data-id');
        if (!villageId) return;

        const cell = row.children[columnIndex];
        if (!cell || cell.dataset.storageHoverBound) return;
        cell.dataset.storageHoverBound = '1';

        attachStorageOverviewHover(cell, villageId);
    });
}

