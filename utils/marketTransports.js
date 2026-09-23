/**
 * Parses and stores the market transport snapshot for one source village.
 * The page does not expose reliable absolute timestamps, so arrival and remaining times are
 * intentionally kept as the localized display strings returned by the game.
 */

const MARKET_TRANSPORTS_FIELD = 'market_transports';
const MARKET_TRANSPORTS_SCHEMA_VERSION = 1;

function marketText(element) {
    return element?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function marketNumber(element) {
    const digits = marketText(element).replace(/[^0-9]/g, '');
    return digits ? parseInt(digits, 10) : null;
}

function parseMarketResourceCell(cell) {
    const resources = {};
    if (!cell) return resources;

    ['wood', 'stone', 'iron'].forEach(function (resource) {
        const icon = cell.querySelector('.icon.header.' + resource);
        if (!icon) return;
        const amount = marketNumber(cell);
        if (amount !== null) resources[resource] = amount;
    });
    return resources;
}

function parseMarketVillageLink(cell) {
    const link = cell?.querySelector('a[href*="screen=info_village"]');
    if (!link) return { villageId: null, villageName: null, coords: null };

    const href = link.getAttribute('href') || '';
    const villageId = (href.match(/[?&]id=(\d+)/) || [])[1] || null;
    const linkText = marketText(link);
    const coordsMatch = linkText.match(/\((\d+\|\d+)\)/);
    const villageName = coordsMatch ? linkText.slice(0, coordsMatch.index).trim() : linkText || null;

    return {
        villageId: villageId,
        villageName: villageName,
        coords: coordsMatch ? coordsMatch[1] : null
    };
}

function findMarketTransportTable(doc, headingPattern) {
    return Array.from(doc.querySelectorAll('h3')).reduce(function (match, heading) {
        if (match || !headingPattern.test(marketText(heading))) return match;
        return heading.nextElementSibling?.matches('table') ? heading.nextElementSibling : null;
    }, null);
}

function parseMarketTransportRows(table, direction) {
    if (!table) return [];
    const rows = Array.from(table.querySelectorAll('tr')).filter(function (row) {
        return row.querySelectorAll('td').length > 0;
    });
    const headers = Array.from(table.querySelectorAll('tr:first-child th')).map(marketText);
    const resourceIndex = headers.findIndex(header => /mercadorias|goods/i.test(header));
    const merchantIndex = headers.findIndex(header => /comerciantes|merchants/i.test(header));
    const arrivalIndex = headers.findIndex(header => /chegada|arrival/i.test(header));
    const remainingIndex = headers.findIndex(header => /chega em|remaining|arrives/i.test(header));

    return rows.map(function (row) {
        const cells = Array.from(row.querySelectorAll('td'));
        const location = parseMarketVillageLink(cells[0]);
        const firstCellText = marketText(cells[0]);
        const transport = {
            direction: direction,
            villageId: location.villageId,
            villageName: location.villageName,
            coords: location.coords,
            resources: parseMarketResourceCell(cells[resourceIndex >= 0 ? resourceIndex : 1]),
            arrivalText: marketText(cells[arrivalIndex >= 0 ? arrivalIndex : direction === 'outgoing' ? 3 : 2]),
            remainingText: marketText(cells[remainingIndex >= 0 ? remainingIndex : direction === 'outgoing' ? 4 : 3])
        };

        if (merchantIndex >= 0) transport.merchants = marketNumber(cells[merchantIndex]);
        if (direction === 'outgoing') {
            transport.kind = /retorno|return/i.test(firstCellText) ? 'return' : 'delivery';
        }
        return transport;
    });
}

function parseMarketExchangeLimit(cell) {
    const icon = cell?.querySelector('.icon.header.wood, .icon.header.stone, .icon.header.iron');
    if (!icon) return null;
    const resource = ['wood', 'stone', 'iron'].find(type => icon.classList.contains(type));
    return resource ? { resource: resource, amount: marketNumber(cell) } : null;
}

function parseMarketTransportsStatus(doc) {
    const status = {
        merchants: {
            available: marketNumber(doc.querySelector('#market_merchant_available_count')),
            total: marketNumber(doc.querySelector('#market_merchant_total_count'))
        },
        maxTransport: marketNumber(doc.querySelector('#market_merchant_max_transport')),
        exchangeLimits: { incoming: null, outgoing: null }
    };
    const statusTables = Array.from(doc.querySelectorAll('#market_status_bar table'));
    const limitCells = statusTables[1]?.querySelectorAll('th') || [];
    Array.from(limitCells).forEach(function (cell) {
        const limit = parseMarketExchangeLimit(cell);
        if (/entrada|incoming/i.test(marketText(cell))) status.exchangeLimits.incoming = limit;
        if (/saída|saida|outgoing/i.test(marketText(cell))) status.exchangeLimits.outgoing = limit;
    });
    return status;
}

function parseMarketTransportsPage(doc, villageId) {
    const outgoingTable = findMarketTransportTable(doc, /seus transportes|your transports/i);
    const incomingTable = findMarketTransportTable(doc, /transportes em chegada|incoming transports/i);
    return {
        schemaVersion: MARKET_TRANSPORTS_SCHEMA_VERSION,
        villageId: villageId == null ? null : String(villageId),
        fetchedAtMs: Date.now(),
        status: parseMarketTransportsStatus(doc),
        outgoing: parseMarketTransportRows(outgoingTable, 'outgoing'),
        incoming: parseMarketTransportRows(incomingTable, 'incoming')
    };
}

function storeMarketTransports(villageId, snapshot) {
    const id = String(villageId);
    const storedSnapshot = Object.assign({}, snapshot, { villageId: id });
    bqSet(MARKET_TRANSPORTS_FIELD, id, storedSnapshot);
    return storedSnapshot;
}

/**
 * Fetches and stores a village's market transport snapshot by delegating to pageFetchManager.js's
 * fetchMarketPage (shared with features/overview.js:getMarketInfo, dedupes concurrent requests
 * for the same village).
 * @param {string|number} villageId
 * @returns {Promise<void|null>} Resolves after storage, or null on failure.
 */
function fetchAndStoreVillageMarketTransports(villageId) {
    return fetchMarketPage(villageId).catch(function () {
        return null;
    });
}

function captureCurrentVillageMarketTransports() {
    const pageUrl = typeof document !== 'undefined' ? document.location.href : '';
    const isMarketTransportsPage = typeof game_data !== 'undefined' && game_data.screen === 'market' &&
        (game_data.mode === 'transports' || (pageUrl.includes('screen=market') && pageUrl.includes('mode=transports')));
    const villageId = game_data.village?.id;
    if (villageId == null) return;
    if (isMarketTransportsPage) {
        storeMarketTransports(villageId, parseMarketTransportsPage(document, villageId));
    }
}
