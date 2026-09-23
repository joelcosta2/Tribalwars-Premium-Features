function getOverviewVillagesDataSource(table) {
    const villages = [];

    function getColumnIndex(orderParam) {
        const link = table.querySelector('th a[href*="order=' + orderParam + '"]');
        const headerRow = link?.closest('tr');
        return link && headerRow ? Array.from(headerRow.cells).indexOf(link.closest('th')) : -1;
    }

    const pointsColumnIndex = getColumnIndex('points');
    const farmColumnIndex = getColumnIndex('pop');

    table.querySelectorAll('tbody tr').forEach(function (row) {
        const villageElement = row.querySelector('.quickedit-vn[data-id]');
        if (!villageElement) return;

        const label = row.querySelector('.quickedit-label');
        const labelText = label?.textContent?.trim() || '';
        const coords = labelText.match(/\((\d{1,3}\|\d{1,3})\)/)?.[1] || '--|--';
        const name = (label?.dataset.text || labelText.replace(/\s*\(\d{1,3}\|\d{1,3}\)\s*/, '')).trim();
        villages.push({
            id: villageElement.dataset.id,
            name: name || 'Village ' + villageElement.dataset.id,
            coords,
            pointsText: pointsColumnIndex >= 0 ? row.cells[pointsColumnIndex]?.textContent.trim() || '' : '',
            farmText: farmColumnIndex >= 0 ? row.cells[farmColumnIndex]?.textContent.trim() || '' : '',
            pointsHtml: pointsColumnIndex >= 0 ? row.cells[pointsColumnIndex]?.innerHTML || '' : '',
            farmHtml: farmColumnIndex >= 0 ? row.cells[farmColumnIndex]?.innerHTML || '' : ''
        });
    });

    return villages;
}

function createOverviewVillagesTable(headers, renderRows) {
    const table = document.createElement('table');
    table.className = 'vis bordered-table';
    table.style.width = '100%';

    const thead = table.createTHead();
    const headerRow = thead.insertRow();
    headers.forEach(function (header) {
        const cell = document.createElement('th');
        cell.textContent = header;
        headerRow.appendChild(cell);
    });

    const tbody = table.createTBody();
    renderRows.forEach(function (renderRow, index) {
        const row = tbody.insertRow();
        row.className = 'nowrap ' + (index % 2 ? 'row_b' : 'row_a');
        renderRow(row);
    });

    return table;
}

function getOverviewVillagesTroopActionLink(villageId, mode) {
    return getVillageLinkBase(villageId) + 'place' + (mode ? '&mode=' + mode : '');
}

function applyOverviewVillagesTroopsFilter(table, filter) {
    const rowType = filter === 'all' ? null : filter;
    table.dataset.activeFilter = filter;
    table.querySelectorAll('tbody[data-village-id]').forEach(function (villageBody) {
        const rows = Array.from(villageBody.querySelectorAll('tr[data-troop-row]'));
        rows.forEach(function (row) {
            row.hidden = rowType !== null && row.dataset.troopRow !== rowType;
        });
        // rowSpan on the identity cell only reaches visible rows, so it must follow the filter to stay on screen.
        const identityCell = villageBody.querySelector('.troops-overview-identity-cell');
        const visibleRows = rows.filter(row => !row.hidden);
        const targetRow = visibleRows[0];
        if (identityCell && targetRow) {
            identityCell.rowSpan = visibleRows.length;
            if (targetRow.firstElementChild !== identityCell) targetRow.insertBefore(identityCell, targetRow.firstElementChild);
        }
    });
}

function createOverviewVillagesTroopsFilterMenu(table) {
    const filters = [
        { id: 'all', key: 'all' },
        { id: 'own', key: 'own' },
        { id: 'home', key: 'home' },
        { id: 'away', key: 'away' },
        { id: 'transit', key: 'transit' },
        { id: null, key: 'defense', disabled: true },
        { id: null, key: 'support', disabled: true }
    ];
    const menu = document.createElement('table');
    menu.className = 'vis modemenu';
    menu.style.cssText = 'width:100%;margin-bottom:6px;';
    const row = menu.insertRow();
    filters.forEach(function (filter) {
        const cell = row.insertCell();
        cell.style.textAlign = 'center';
        if (filter.id === overviewVillagesTabsState.troopsFilter) cell.classList.add('selected');
        const link = document.createElement('a');
        link.href = '#';
        link.textContent = t('overviewVillages.troopFilter.' + filter.key);
        if (filter.disabled) {
            link.style.opacity = '0.5';
            link.title = t('common.notAvailable');
        }
        link.addEventListener('click', function (event) {
            event.preventDefault();
            if (filter.disabled) return;
            overviewVillagesTabsState.troopsFilter = filter.id;
            Array.from(row.cells).forEach(item => item.classList.remove('selected'));
            cell.classList.add('selected');
            applyOverviewVillagesTroopsFilter(table, filter.id);
        });
        cell.appendChild(link);
    });
    return menu;
}

function renderOverviewVillagesTroopsTable(panel, context) {
    const unitOrder = getOverviewVillagesTroopUnitOrder();
    const table = document.createElement('table');
    table.id = 'units_table';
    table.className = 'vis bordered-table overview_table';
    table.style.width = '100%';
    const headerRow = table.createTHead().insertRow();
    [t('overviewVillages.village'), t('overviewVillages.troopRows'), ...unitOrder, t('overviewVillages.troopActions')]
        .forEach(function (header) {
            const cell = document.createElement('th');
            cell.textContent = header;
            headerRow.appendChild(cell);
        });
    appendOverviewVillagesRefreshIcon(headerRow.cells[0], t('overviewVillages.refreshAllTroops'), function (refreshIcon) {
        refreshAllVillagesTroopCounts(table, refreshIcon);
    });
    unitOrder.forEach(function (unit, index) {
        replaceOverviewVillagesTroopHeader(headerRow.cells[index + 2], unit);
    });

    context.villages.forEach(function (village, villageIndex) {
        const villageBody = table.createTBody();
        villageBody.dataset.villageId = String(village.id);
        villageBody.className = 'row_marker ' + (villageIndex % 2 ? 'row_b' : 'row_a');
        if (String(game_data?.village?.id) === String(village.id)) villageBody.classList.add('selected');
        TROOP_OVERVIEW_ROWS.forEach(function (rowType, rowIndex) {
            const row = villageBody.insertRow();
            row.className = 'nowrap';
            row.dataset.villageId = String(village.id);
            row.dataset.troopRow = rowType;
            if (rowIndex === 0) {
                const identityCell = appendVillageIdentityCell(row, village);
                identityCell.classList.add('troops-overview-identity-cell');
                identityCell.rowSpan = TROOP_OVERVIEW_ROWS.length;
            }
            const labelCell = row.insertCell();
            labelCell.textContent = t('overviewVillages.troopRow.' + rowType);
            labelCell.className = 'troops-overview-row-label-cell'
                + (rowType === 'total' ? ' troops-overview-row-label' : '');
            unitOrder.forEach(function (unit) {
                const cell = row.insertCell();
                cell.className = 'troops-overview-cell';
                cell.dataset.unit = unit;
                cell.dataset.rowType = rowType;
                if (typeof renderTroopsOverviewCell === 'function') renderTroopsOverviewCell(cell, village.id, unit, rowType);
                else cell.textContent = '0';
            });
            // Every row gets its own action cell (no rowSpan) so any single filtered row still has actions on the right.
            const actionCell = row.insertCell();
            actionCell.className = 'troops-overview-actions';
            if (rowType === 'own' || rowType === 'transit') {
                const commandLink = document.createElement('a');
                commandLink.href = getOverviewVillagesTroopActionLink(village.id);
                commandLink.textContent = t('overviewVillages.troopActionCommands');
                actionCell.appendChild(commandLink);
            } else {
                const troopsLink = document.createElement('a');
                troopsLink.href = getOverviewVillagesTroopActionLink(village.id, 'units');
                troopsLink.textContent = t('overviewVillages.troopActionTroops');
                actionCell.appendChild(troopsLink);
            }
        });
    });
    panel.appendChild(createOverviewVillagesTroopsFilterMenu(table));
    panel.appendChild(table);
    applyOverviewVillagesTroopsFilter(table, overviewVillagesTabsState.troopsFilter);
}

function renderOverviewVillagesCustomTable(tabId, isInitialRender = false) {
    const host = overviewVillagesTabsState.host;
    const nativeTable = overviewVillagesTabsState.table;
    const panel = host?.querySelector('.overview-villages-tab-panel');
    if (!host || !nativeTable || !panel) return;

    updateOverviewVillagesVisibleState();
    filterOverviewVillagesProductionTable(nativeTable);

    if (tabId === 'production') {
        nativeTable.style.display = '';
        panel.hidden = true;
        if (typeof injectOverviewVillagesQuickLinksIcon === 'function') injectOverviewVillagesQuickLinksIcon();
        if (typeof refreshOverviewVillagesActiveTab === 'function') refreshOverviewVillagesActiveTab();
        return;
    }

    nativeTable.style.display = 'none';
    panel.hidden = false;
    panel.replaceChildren();
    const tab = overviewVillagesTabsState.tabs.find(item => item.id === tabId);
    if (tab) tab.render(panel, { villages: getOverviewVillagesVisibleVillages() });
    if (typeof refreshOverviewVillagesActiveTab === 'function') refreshOverviewVillagesActiveTab(isInitialRender);
}

function filterOverviewVillagesProductionTable(table) {
    const visibleVillageIds = new Set(
        getOverviewManualGroupVillages(overviewVillagesTabsState.villages).map(village => String(village.id))
    );
    table.querySelectorAll('tbody tr').forEach(function (row) {
        const villageElement = row.querySelector('.quickedit-vn[data-id]');
        if (villageElement) row.hidden = !visibleVillageIds.has(String(villageElement.dataset.id));
    });
}

function refreshOverviewVillagesGroupFilter() {
    const menuHost = document.getElementById('overview-villages-group-menu');
    if (!menuHost) return;
    menuHost.replaceChildren(createOverviewManualGroupMenu(
        overviewVillagesTabsState.villages,
        refreshOverviewVillagesGroupFilter
    ));
    renderOverviewVillagesCustomTable(overviewVillagesTabsState.activeTabId, true);
}

function renderOverviewVillagesGroupMenu() {
    const menuHost = document.getElementById('overview-villages-group-menu');
    if (!menuHost) return;
    menuHost.replaceChildren(createOverviewManualGroupMenu(
        overviewVillagesTabsState.villages,
        refreshOverviewVillagesGroupFilter
    ));
}

function getOverviewVillagesTabs() {
    return [
        { id: 'production', label: t('overviewVillages.tabProduction') },
        { id: 'troops', label: t('overviewVillages.tabTroops'), render: renderOverviewVillagesTroopsTable },
        { id: 'commands', label: t('overviewVillages.tabCommands'), render: renderOverviewVillagesCommandsTable },
        { id: 'market', label: t('overviewVillages.tabMarket'), render: renderOverviewVillagesMarketTable },
        { id: 'manual-groups', label: t('overviewVillages.tabManualGroups'), render: renderOverviewVillagesManualGroupsTable }
    ];
}

function getOverviewVillagesTabUrl(tabId) {
    const url = new URL(game_data.link_base_pure + 'overview_villages', window.location.href);
    url.searchParams.set('overview_tab', tabId);
    return url.href;
}

function getOverviewVillagesLastTabStorageKey() {
    const world = game_data?.world || window.location.hostname || 'unknown_world';
    const player = game_data?.player?.id || 'unknown_player';
    return 'twpf_overview_villages_last_tab_' + world + '_' + player;
}

function injectOverviewVillagesTopbarMenu() {
    if (typeof isPremiumAccount === 'function' && isPremiumAccount()) return;

    const topTable = document.getElementById('topTable');
    if (!topTable) return;

    const overviewLinks = Array.from(topTable.querySelectorAll('a[href]')).filter(function (link) {
        const screen = new URL(link.href, window.location.href).searchParams.get('screen');
        return screen === 'overview' || screen === 'overview_villages';
    });

    overviewLinks.forEach(function (overviewLink) {
        const menuItem = overviewLink.closest('td.menu-item, td.box-item');
        if (!menuItem || menuItem.querySelector(':scope > .overview-villages-topbar-menu')) return;

        const menu = document.createElement('table');
        menu.className = 'menu_column overview-villages-topbar-menu';
        menu.setAttribute('cellspacing', '0');
        const body = menu.createTBody();

        getOverviewVillagesTabs().forEach(function (tab) {
            const row = body.insertRow();
            const cell = row.insertCell();
            cell.className = 'menu-column-item';
            const link = document.createElement('a');
            link.href = getOverviewVillagesTabUrl(tab.id);
            link.textContent = tab.label;
            cell.appendChild(link);
        });

        const bottomRow = body.insertRow();
        const bottomCell = bottomRow.insertCell();
        bottomCell.className = 'bottom';
        bottomCell.innerHTML = '<div class="corner"></div><div class="decoration"></div>';
        menuItem.appendChild(menu);
    });
}

function injectOverviewVillagesNavigationMenu() {
    if (typeof game_data === 'undefined' || game_data.screen !== 'overview_villages') return;

    const nativeTable = document.getElementById('production_table');
    if (!nativeTable || document.getElementById('overview-villages-custom-view')) return;

    overviewVillagesTabsState.villages = getOverviewVillagesDataSource(nativeTable);
    updateOverviewVillagesVisibleState();

    const host = document.createElement('div');
    host.id = 'overview-villages-custom-view';
    host.style.overflowX = 'auto';

    const menu = document.createElement('table');
    menu.id = 'overview_menu';
    menu.className = 'vis modemenu';
    menu.setAttribute('width', '100%');
    menu.setAttribute('role', 'tablist');
    const menuRow = menu.insertRow();
    const panel = document.createElement('div');
    panel.id = 'overview-villages-tab-panel';
    panel.className = 'overview-villages-tab-panel';
    panel.setAttribute('role', 'tabpanel');

    overviewVillagesTabsState.tabs = getOverviewVillagesTabs();

    const groupMenu = document.createElement('div');
    groupMenu.id = 'overview-villages-group-menu';

    overviewVillagesTabsState.tabs.forEach(function (tab) {
        const cell = menuRow.insertCell();
        cell.style.textAlign = 'center';
        const link = document.createElement('a');
        link.href = '#';
        link.textContent = tab.label;
        link.setAttribute('role', 'tab');
        link.setAttribute('aria-selected', 'false');
        link.setAttribute('aria-controls', panel.id);
        link.addEventListener('click', function (event) {
            event.preventDefault();
            overviewVillagesTabsState.activeTabId = tab.id;
            localStorage.setItem(getOverviewVillagesLastTabStorageKey(), tab.id);
            const url = new URL(window.location.href);
            url.searchParams.set('overview_tab', tab.id);
            window.history.replaceState(null, '', url.href);
            menu.querySelectorAll('td').forEach(item => item.classList.remove('selected'));
            cell.classList.add('selected');
            menu.querySelectorAll('[role="tab"]').forEach(item => item.setAttribute('aria-selected', 'false'));
            link.setAttribute('aria-selected', 'true');
            renderOverviewVillagesCustomTable(tab.id);
        });
        cell.appendChild(link);
    });

    menu.style.marginBottom = '6px';
    groupMenu.style.marginBottom = '6px';
    host.appendChild(menu);
    host.appendChild(groupMenu);
    host.appendChild(panel);
    nativeTable.parentNode.insertBefore(host, nativeTable);
    renderOverviewVillagesGroupMenu();
    overviewVillagesTabsState.host = host;
    overviewVillagesTabsState.table = nativeTable;

    const requestedTab = new URLSearchParams(window.location.search).get('overview_tab');
    const storedTab = localStorage.getItem(getOverviewVillagesLastTabStorageKey());
    const initialTab = overviewVillagesTabsState.tabs.some(tab => tab.id === requestedTab)
        ? requestedTab
        : overviewVillagesTabsState.tabs.some(tab => tab.id === storedTab)
            ? storedTab
            : 'production';
    localStorage.setItem(getOverviewVillagesLastTabStorageKey(), initialTab);
    const initialTabIndex = overviewVillagesTabsState.tabs.findIndex(tab => tab.id === initialTab);
    overviewVillagesTabsState.activeTabId = initialTab;
    menuRow.cells[initialTabIndex].classList.add('selected');
    menuRow.cells[initialTabIndex].querySelector('[role="tab"]').setAttribute('aria-selected', 'true');
    renderOverviewVillagesCustomTable(initialTab, true);
}
