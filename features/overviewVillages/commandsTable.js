/**
 * "Commands" tab (overview_villages) — replicates the premium account's combined
 * "overview_villages&mode=commands" command list as closely as possible: ONE flat table (not
 * one row per village) merging every selected village's outgoing/incoming commands, with the
 * same command-icons + label + origin village + arrival columns and type filter tabs (Todos os
 * comandos/Ataques/Suporte/Retornar) as the native page, fetched per-village via
 * screen=place&mode=command (see utils/commandsManager.js). Troop composition counts are not
 * available from that page (see commandsManager.js) so those columns are replaced with a single
 * live countdown column instead.
 */

// Villages currently being auto-refetched after one of their commands expired (avoids duplicate concurrent fetches).
const commandsAutoRefreshInFlight = new Set();

function commandMatchesTypeFilter(command, filter) {
    if (filter === 'all') return true;
    if (filter === 'attack') return command.type === 'attack';
    if (filter === 'support') return command.type === 'support';
    if (filter === 'return') return command.type === 'return' || command.type === 'back' || command.type === 'other_back';
    return true;
}

function getOverviewVillagesCombinedCommands(villages) {
    const combined = [];
    villages.forEach(function (village) {
        const snapshot = typeof bqGet === 'function' && typeof COMMANDS_FIELD !== 'undefined'
            ? bqGet(COMMANDS_FIELD, village.id)
            : null;
        if (!snapshot) return;
        ['outgoing', 'incoming'].forEach(function (direction) {
            (snapshot[direction] || []).forEach(function (command) {
                combined.push(Object.assign({}, command, { village: village }));
            });
        });
    });
    combined.sort(function (a, b) {
        return (a.endTimeSec ?? Infinity) - (b.endTimeSec ?? Infinity);
    });
    return combined;
}

function createCommandRowIcons(icons) {
    const container = document.createElement('span');
    container.style.cssText = 'display:inline-flex;align-items:center;gap:1px;vertical-align:middle;';
    (icons || []).forEach(function (icon) {
        if (!icon.img) return;
        const img = document.createElement('img');
        img.src = icon.img;
        img.alt = '';
        img.style.cssText = 'width:16px;height:16px;';
        if (icon.hint) img.title = icon.hint;
        container.appendChild(img);
    });
    return container;
}

// Matches the native rally point countdown format (h:mm:ss, unpadded hours), not formatQueueRemaining's "1d 2h 3m 4s".
function formatCommandCountdown(ms) {
    if (ms == null || ms <= 0) return '0:00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function createCommandOriginLink(village) {
    const link = document.createElement('a');
    link.href = game_data.link_base_pure + 'info_village&id=' + village.id;
    link.textContent = village.name + ' (' + village.coords + ')';
    return link;
}

function createCommandTableRow(command, index) {
    const row = document.createElement('tr');
    row.className = 'nowrap ' + (index % 2 ? 'row_b' : 'row_a');
    row.dataset.commandType = command.type || '';
    row.dataset.villageId = command.village.id;
    if (command.endTimeSec) row.dataset.endTimeSec = command.endTimeSec;

    const commandCell = row.insertCell();
    commandCell.style.whiteSpace = 'nowrap';
    commandCell.appendChild(createCommandRowIcons(command.icons));
    const label = document.createElement('a');
    label.href = command.href || '#';
    label.textContent = command.label || '-';
    label.style.marginLeft = '3px';
    commandCell.appendChild(label);

    const originCell = row.insertCell();
    originCell.className = 'command-origin-cell';
    originCell.style.whiteSpace = 'nowrap';
    originCell.appendChild(createCommandOriginLink(command.village));
    if (commandsAutoRefreshInFlight.has(String(command.village.id))) appendCommandsLoadingIcon(originCell);

    const arrivalCell = row.insertCell();
    arrivalCell.style.whiteSpace = 'nowrap';
    arrivalCell.textContent = command.arrivalText || '-';

    const countdownCell = row.insertCell();
    countdownCell.className = 'command-countdown-cell';
    countdownCell.style.whiteSpace = 'nowrap';
    const remainingMs = command.endTimeSec ? command.endTimeSec * 1000 - Timing.getCurrentServerTime() : null;
    countdownCell.textContent = remainingMs != null ? formatCommandCountdown(remainingMs) : '-';

    return row;
}

function appendCommandsLoadingIcon(originCell) {
    if (originCell.querySelector('.commands-loading-icon')) return;
    const icon = createOverviewVillagesLoadingImage();
    icon.className = 'commands-loading-icon';
    icon.style.marginLeft = '4px';
    originCell.appendChild(icon);
}

/**
 * Prunes a village's expired commands from the cache for instant feedback, then confirms/
 * reconciles with the server in the background (fetchAndStoreVillageCommands) once it's the
 * only in-flight request for that village.
 * @param {string} villageId
 * @param {HTMLElement} table
 * @param {Array} villages
 */
function scheduleCommandAutoRefresh(villageId, table, villages) {
    if (commandsAutoRefreshInFlight.has(villageId)) return;
    if (table.dataset.refreshingAll === 'true') return;

    commandsAutoRefreshInFlight.add(villageId);
    pruneExpiredCommands(villageId);
    renderOverviewVillagesCommandsBody(table, villages);

    fetchAndStoreVillageCommands(villageId).finally(function () {
        commandsAutoRefreshInFlight.delete(villageId);
        renderOverviewVillagesCommandsBody(table, villages);
    });
}

/**
 * Ticks every second while the table stays on screen: updates every visible countdown cell, and
 * triggers scheduleCommandAutoRefresh() the moment a row's arrival time passes. Self-clears once
 * the table is removed from the DOM (e.g. the user switched to a different tab), so no external
 * cleanup wiring is needed.
 * @param {HTMLElement} table
 * @param {Array} villages
 */
function startOverviewVillagesCommandsCountdown(table, villages) {
    const intervalId = setInterval(function () {
        if (!table.isConnected) {
            clearInterval(intervalId);
            return;
        }

        const expiredVillageIds = new Set();
        Array.from(table.tBodies[0]?.rows || []).forEach(function (row) {
            if (!row.dataset.endTimeSec) return;
            const remainingMs = parseInt(row.dataset.endTimeSec, 10) * 1000 - Timing.getCurrentServerTime();
            const countdownCell = row.querySelector('.command-countdown-cell');
            if (countdownCell) countdownCell.textContent = formatCommandCountdown(remainingMs);
            if (remainingMs <= 0) expiredVillageIds.add(row.dataset.villageId);
        });
        expiredVillageIds.forEach(villageId => scheduleCommandAutoRefresh(villageId, table, villages));
    }, 1000);
}

function applyOverviewVillagesCommandsFilter(table, filter) {
    Array.from(table.tBodies[0]?.rows || []).forEach(function (row) {
        if (!row.dataset.commandType && row.cells.length === 1) return; // empty-state row, never hidden
        row.hidden = !commandMatchesTypeFilter({ type: row.dataset.commandType }, filter);
    });
}

function renderOverviewVillagesCommandsBody(table, villages) {
    const commands = getOverviewVillagesCombinedCommands(villages);
    const tbody = table.tBodies[0];
    tbody.replaceChildren();

    const headerLabel = table.tHead?.querySelector('.commands-header-label');
    if (headerLabel) headerLabel.textContent = t('overviewVillages.command') + ' (' + commands.length + ')';

    if (!commands.length) {
        const emptyRow = tbody.insertRow();
        const emptyCell = emptyRow.insertCell();
        emptyCell.colSpan = 4;
        emptyCell.style.cssText = 'text-align:center;color:#999;';
        emptyCell.textContent = t('overviewVillages.noCommands');
        return;
    }

    commands.forEach(function (command, index) {
        tbody.appendChild(createCommandTableRow(command, index));
    });
    applyOverviewVillagesCommandsFilter(table, table.dataset.activeFilter || 'all');
}

function createOverviewVillagesCommandsFilterMenu(table) {
    const filters = [
        { id: 'all', label: t('overviewVillages.commandsFilterAll') },
        { id: 'attack', label: t('overviewVillages.commandsFilterAttacks') },
        { id: 'support', label: t('overviewVillages.commandsFilterSupport') },
        { id: 'return', label: t('overviewVillages.commandsFilterReturn') }
    ];

    const menu = document.createElement('table');
    menu.className = 'vis modemenu';
    menu.style.cssText = 'width:100%;margin-bottom:6px;';
    const row = menu.insertRow();

    filters.forEach(function (filter) {
        const cell = row.insertCell();
        cell.style.textAlign = 'center';
        if (filter.id === 'all') cell.classList.add('selected');
        const link = document.createElement('a');
        link.href = '#';
        link.textContent = filter.label;
        link.addEventListener('click', function (event) {
            event.preventDefault();
            table.dataset.activeFilter = filter.id;
            Array.from(row.cells).forEach(item => item.classList.remove('selected'));
            cell.classList.add('selected');
            applyOverviewVillagesCommandsFilter(table, filter.id);
        });
        cell.appendChild(link);
    });

    return menu;
}

function setOverviewVillagesCommandsLoading(table) {
    const tbody = table.tBodies[0];
    tbody.replaceChildren();
    const row = tbody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 4;
    cell.appendChild(createOverviewVillagesTableLoadingElement('40px'));
}

function refreshAllVillagesCommands(table, triggerIcon, villages) {
    if (triggerIcon.dataset.refreshing === 'true') return;
    triggerIcon.dataset.refreshing = 'true';
    table.dataset.refreshingAll = 'true';
    triggerIcon.style.opacity = '0.4';
    triggerIcon.style.pointerEvents = 'none';
    setOverviewVillagesCommandsLoading(table);

    runWithConcurrencyLimit(villages, function (village) {
        return fetchAndStoreVillageCommands(village.id);
    }, { concurrency: 1, minDelay: 100, maxDelay: 500 }).then(function () {
        renderOverviewVillagesCommandsBody(table, villages);
    }).finally(function () {
        triggerIcon.dataset.refreshing = 'false';
        table.dataset.refreshingAll = 'false';
        triggerIcon.style.opacity = '';
        triggerIcon.style.pointerEvents = '';
    });
}

function refreshOverviewVillagesCommands(villages) {
    const state = overviewVillagesTabsState.refreshState.commands;
    const candidates = getOverviewVillagesRefreshCandidates('commands', villages, false);
    if (!candidates.length) return Promise.resolve();

    return runWithConcurrencyLimit(candidates, function (village) {
        const id = String(village.id);
        const request = fetchAndStoreVillageCommands(id).then(function (result) {
            state.completed.add(id);
            return result;
        }).finally(function () {
            state.inFlight.delete(id);
        });
        state.inFlight.set(id, request);
        return request;
    }, { concurrency: 1, minDelay: 100, maxDelay: 500 }).then(function () {
        if (overviewVillagesTabsState.activeTabId === 'commands') {
            renderOverviewVillagesCustomTable('commands');
        }
    });
}

function renderOverviewVillagesCommandsTableElement(villages) {
    const table = document.createElement('table');
    table.className = 'vis overview_table';
    table.style.width = '100%';
    table.dataset.activeFilter = 'all';

    const thead = table.createTHead();
    const headerRow = thead.insertRow();
    [
        t('overviewVillages.command'),
        t('overviewVillages.originVillage'),
        t('overviewVillages.arrival'),
        t('overviewVillages.arrivesIn')
    ].forEach(function (headerText, index) {
        const th = document.createElement('th');
        if (index === 0) {
            const label = document.createElement('span');
            label.className = 'commands-header-label';
            label.textContent = headerText;
            th.appendChild(label);
        } else {
            th.textContent = headerText;
        }
        headerRow.appendChild(th);
    });
    table.createTBody();

    appendOverviewVillagesRefreshIcon(headerRow.cells[0], t('overviewVillages.refreshAllCommands'), function (refreshIcon) {
        refreshAllVillagesCommands(table, refreshIcon, villages);
    });

    renderOverviewVillagesCommandsBody(table, villages);
    startOverviewVillagesCommandsCountdown(table, villages);

    const wrapper = document.createElement('div');
    wrapper.appendChild(createOverviewVillagesCommandsFilterMenu(table));
    wrapper.appendChild(table);
    return wrapper;
}

function renderOverviewVillagesCommandsTable(panel, context) {
    panel.appendChild(renderOverviewVillagesCommandsTableElement(context.villages));
}
