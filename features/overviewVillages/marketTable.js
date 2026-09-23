function formatMarketResources(resources) {
    if (!resources || typeof resources !== 'object') return '-';
    return ['wood', 'stone', 'iron'].filter(function (resource) {
        return resources[resource] != null;
    }).map(function (resource) {
        return resource + ': ' + resources[resource];
    }).join(' / ') || '-';
}

function formatMarketTransports(transports) {
    if (!Array.isArray(transports) || !transports.length) return t('overviewVillages.noTransports');
    return transports.map(function (transport) {
        const destination = transport.villageName || transport.coords || t('overviewVillages.unknownVillage');
        const timing = [transport.arrivalText, transport.remainingText].filter(Boolean).join(' / ');
        const merchants = transport.merchants == null ? '' : ' | ' + t('overviewVillages.merchants') + ': ' + transport.merchants;
        return destination + ': ' + formatMarketResources(transport.resources) + merchants + (timing ? ' | ' + timing : '');
    }).join('\n');
}

function formatMarketLimit(limit) {
    if (!limit) return '-';
    return (limit.resource || '-') + ': ' + (limit.amount ?? '-');
}

function renderOverviewVillagesMarketRow(row, village) {
    const snapshot = typeof bqGet === 'function' && typeof MARKET_TRANSPORTS_FIELD !== 'undefined'
        ? bqGet(MARKET_TRANSPORTS_FIELD, village.id)
        : null;
    row.replaceChildren();
    appendVillageIdentityCell(row, village);
    row.insertCell().textContent = formatMarketTransports(snapshot?.outgoing);
    row.insertCell().textContent = formatMarketTransports(snapshot?.incoming);
    const merchants = snapshot?.status?.merchants;
    row.insertCell().textContent = merchants && (merchants.available != null || merchants.total != null)
        ? (merchants.available ?? '-') + ' / ' + (merchants.total ?? '-')
        : '-';
    row.insertCell().textContent = snapshot?.status?.maxTransport ?? '-';
    const limits = snapshot?.status?.exchangeLimits;
    row.insertCell().textContent = limits
        ? t('overviewVillages.incoming') + ': ' + formatMarketLimit(limits.incoming) + '\n' +
            t('overviewVillages.outgoing') + ': ' + formatMarketLimit(limits.outgoing)
        : '-';
}

function setOverviewVillagesMarketRowLoading(row) {
    Array.from(row.cells).slice(1).forEach(function (cell) {
        cell.replaceChildren(createOverviewVillagesLoadingImage());
        cell.style.textAlign = 'center';
        cell.style.color = '#999';
    });
}

function refreshAllVillagesMarketTransports(table, triggerIcon, villages) {
    if (triggerIcon.dataset.refreshing === 'true') return;
    triggerIcon.dataset.refreshing = 'true';
    triggerIcon.style.opacity = '0.4';
    triggerIcon.style.pointerEvents = 'none';

    const rows = Array.from(table.tBodies[0]?.rows || []);
    const rowsToFetch = villages.map(function (village) {
        const row = rows.find(item => item.querySelector('.quickedit-vn[data-id="' + village.id + '"]'));
        if (row) setOverviewVillagesMarketRowLoading(row);
        return { village, row };
    });

    runWithConcurrencyLimit(rowsToFetch, function ({ village, row }) {
        return fetchAndStoreVillageMarketTransports(village.id).then(function () {
            if (row) renderOverviewVillagesMarketRow(row, village);
        });
    }, { concurrency: 1, minDelay: 100, maxDelay: 500 }).then(function () {
        table.querySelectorAll('tbody td:nth-child(2), tbody td:nth-child(3), tbody td:nth-child(6)').forEach(function (cell) {
            cell.style.whiteSpace = 'pre-line';
        });
    }).finally(function () {
        triggerIcon.dataset.refreshing = 'false';
        triggerIcon.style.opacity = '';
        triggerIcon.style.pointerEvents = '';
    });
}

function refreshOverviewVillagesMarket(villages) {
    const state = overviewVillagesTabsState.refreshState.market;
    const candidates = getOverviewVillagesRefreshCandidates('market', villages, false);
    if (!candidates.length) return Promise.resolve();

    return runWithConcurrencyLimit(candidates, function (village) {
        const id = String(village.id);
        const request = fetchAndStoreVillageMarketTransports(id).then(function (result) {
            state.completed.add(id);
            return result;
        }).finally(function () {
            state.inFlight.delete(id);
        });
        state.inFlight.set(id, request);
        return request;
    }, { concurrency: 1, minDelay: 100, maxDelay: 500 }).then(function () {
        if (overviewVillagesTabsState.activeTabId === 'market') {
            renderOverviewVillagesCustomTable('market');
        }
    });
}

function renderOverviewVillagesMarketTableElement(villages) {
    const headers = [
        t('overviewVillages.village'),
        t('overviewVillages.outgoing'),
        t('overviewVillages.incoming'),
        t('overviewVillages.merchants'),
        t('overviewVillages.maxTransport'),
        t('overviewVillages.exchangeLimits')
    ];
    const rows = villages.map(function (village) {
        return function (row) {
            renderOverviewVillagesMarketRow(row, village);
        };
    });
    const table = createOverviewVillagesTable(headers, rows);
    appendOverviewVillagesRefreshIcon(table.querySelector('thead th'), t('overviewVillages.refreshAllMarket'), function (refreshIcon) {
        refreshAllVillagesMarketTransports(table, refreshIcon, villages);
    });
    table.querySelectorAll('tbody td:nth-child(2), tbody td:nth-child(3), tbody td:nth-child(6)').forEach(function (cell) {
        cell.style.whiteSpace = 'pre-line';
    });
    return table;
}

function renderOverviewVillagesMarketTable(panel, context) {
    panel.appendChild(renderOverviewVillagesMarketTableElement(context.villages));
}
