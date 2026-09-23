/**
 * Parses and stores a village's rally point command list (screen=place&mode=command), i.e. the
 * per-village equivalent of the premium account's combined "overview_villages&mode=commands"
 * page. Troop composition counts are NOT exposed by this page (only the premium combined view
 * or a per-command info_command fetch has them) and are intentionally left out — only the
 * command type/size icon hints, description and arrival/countdown are available here.
 */

const COMMANDS_FIELD = 'commands';
const COMMANDS_SCHEMA_VERSION = 1;

function commandText(element) {
    return element?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function parseCommandRowIcons(row) {
    return Array.from(row.querySelectorAll('.command_hover_details, .own_command')).map(function (span) {
        return {
            type: span.dataset.commandType || null,
            hint: (span.dataset.iconHint || '').trim(),
            img: span.querySelector('img')?.getAttribute('src') || null
        };
    });
}

function parseCommandRow(row, direction) {
    const icons = parseCommandRowIcons(row);
    const idHolder = row.querySelector('[data-id]');
    const link = row.querySelector('a[href*="screen=info_command"]');
    const cells = row.querySelectorAll('td');
    const countdownSpan = row.querySelector('[data-endtime]');
    const label = commandText(row.querySelector('.quickedit-label'));
    const targetCoords = label.match(/\((\d+\|\d+)\)/)?.[1] || null;

    return {
        id: idHolder?.dataset.id || null,
        direction: direction,
        type: icons[0]?.type || null,
        icons: icons,
        label: label,
        targetCoords: targetCoords,
        href: link?.getAttribute('href') || null,
        arrivalText: commandText(cells[1]),
        // Unix epoch seconds, comparable with Timing.getCurrentServerTime().
        endTimeSec: countdownSpan ? parseInt(countdownSpan.dataset.endtime, 10) || null : null
    };
}

function parseCommandsContainer(container) {
    if (!container) return [];
    const direction = container.dataset.type || 'outgoing';
    return Array.from(container.querySelectorAll('tr.command-row')).map(row => parseCommandRow(row, direction));
}

function parsePlaceCommandsPage(doc, villageId) {
    const containers = Array.from(doc.querySelectorAll('.commands-container[data-type]'));
    const outgoing = containers.filter(c => c.dataset.type === 'outgoing').flatMap(parseCommandsContainer);
    const incoming = containers.filter(c => c.dataset.type === 'incoming').flatMap(parseCommandsContainer);

    return {
        schemaVersion: COMMANDS_SCHEMA_VERSION,
        villageId: villageId == null ? null : String(villageId),
        fetchedAtMs: Date.now(),
        outgoing: outgoing,
        incoming: incoming
    };
}

function storeCommands(villageId, snapshot) {
    const id = String(villageId);
    const storedSnapshot = Object.assign({}, snapshot, { villageId: id });
    bqSet(COMMANDS_FIELD, id, storedSnapshot);
    return storedSnapshot;
}

function fetchAndStoreVillageCommands(villageId) {
    return fetchPlaceCommandPage(villageId).catch(function () {
        return null;
    });
}

/**
 * Instantly drops any cached command whose arrival time has already passed, so the UI doesn't
 * keep showing a stale "0:00:00" row while the confirming fetchAndStoreVillageCommands() request
 * is still in flight. Returns the pruned snapshot, or null if nothing was cached yet.
 * @param {string|number} villageId
 * @returns {Object|null}
 */
function pruneExpiredCommands(villageId) {
    const snapshot = bqGet(COMMANDS_FIELD, villageId);
    if (!snapshot) return null;

    const nowMs = Timing.getCurrentServerTime();
    const isStillPending = command => !command.endTimeSec || command.endTimeSec * 1000 > nowMs;

    return storeCommands(villageId, Object.assign({}, snapshot, {
        outgoing: (snapshot.outgoing || []).filter(isStillPending),
        incoming: (snapshot.incoming || []).filter(isStillPending)
    }));
}

/**
 * Stores the currently displayed village's own command list at no extra request cost whenever
 * the user naturally visits its rally point commands page, mirroring
 * captureCurrentVillageMarketTransports().
 */
function captureCurrentVillageCommands() {
    const isPlaceCommandPage = typeof game_data !== 'undefined' && game_data.screen === 'place' && game_data.mode === 'command';
    const villageId = game_data?.village?.id;
    if (!isPlaceCommandPage || villageId == null) return;
    storeCommands(villageId, parsePlaceCommandsPage(document, villageId));
}
