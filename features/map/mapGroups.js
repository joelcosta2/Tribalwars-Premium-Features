// Custom Map Village Color Groups
// Lets non-premium accounts recolor arbitrary villages on the world map by defining
// named groups (matched by village coordinates, player names or tribe tags), managed
// from a popup opened through a new row injected into the native #map_legend.

const _CUSTOM_MAP_GROUPS_STORAGE_PREFIX = 'twpf_custom_map_groups_v1';

/**
 * Returns the localStorage key for this account's custom map groups, scoped per world+player
 * so groups don't leak across different accounts/worlds sharing the same browser profile.
 */
function getCustomMapGroupsStorageKey() {
    const world = game_data?.world || window.location.hostname || 'unknown_world';
    const player = game_data?.player?.id || 'unknown_player';
    return `${_CUSTOM_MAP_GROUPS_STORAGE_PREFIX}_${world}_${player}`;
}

// In-memory cache of the parsed groups array; null until first load.
let _customMapGroupsCache = null;
// Lowercased/trimmed value Set per group id, rebuilt whenever groups change — keeps matching O(1).
let _customMapGroupsLookup = new Map();

// Fixed shape sizes (tile units unless noted) — tweak here to adjust every group at once.
const MAP_GROUP_SHAPE_SIZES = {
    circle: 0.5,
    square: 1,
    indicator: 0.1,
    iconMap: 20,
    iconMini: 10,
    // Square drawn on the minimap for circle/square/indicator shapes when showOnMinimap is on.
    minimapSquare: 1
};

// Fixed border/fill styling — tweak here to adjust every group's shape look at once.
const MAP_GROUP_SHAPE_STYLE = {
    strokeWidth: 1,
    strokeWidthMini: 0,
    fillOpacity: 0.35,
    indicatorStrokeColor: '#000000',
    indicatorStrokeWidth: 1,
    indicatorFillOpacity: 0.9
};

/**
 * Default MapSdk drawing config for a group: no shape selected, minimap mirroring off.
 */
function defaultMapSdkConfig() {
    return { shape: 'none', value: '', url: '', showOnMinimap: false };
}

/**
 * Fills in any missing mapSdk fields, migrating groups saved with the older per-shape
 * checkbox format (independent enable+size per shape) down to a single selected shape.
 */
function normalizeGroup(group) {
    const existing = group.mapSdk || {};
    const isLegacyFormat = existing.circle || existing.square || existing.indicator || existing.text || existing.icon;

    if (isLegacyFormat) {
        const shape = ['circle', 'square', 'indicator', 'text', 'icon'].find(key => existing[key]?.enabled) || 'none';
        group.mapSdk = {
            shape,
            value: existing.text?.value || '',
            url: existing.icon?.url || '',
            showOnMinimap: !!existing[shape]?.showOnMinimap
        };
    } else {
        group.mapSdk = Object.assign(defaultMapSdkConfig(), existing);
    }
    return group;
}

/**
 * Loads (and caches) the ordered list of custom map groups. Array order is priority:
 * the first active group that matches a village wins.
 * @returns {Array<{id:string, name:string, color:string, active:boolean, matchType:'villages'|'players'|'tribes', values:string[], mapSdk:object}>}
 */
function loadCustomMapGroups() {
    if (_customMapGroupsCache) return _customMapGroupsCache;

    let groups = [];
    try {
        const raw = localStorage.getItem(getCustomMapGroupsStorageKey());
        const parsed = raw ? JSON.parse(raw) : [];
        groups = Array.isArray(parsed) ? parsed : [];
    } catch {
        groups = [];
    }

    groups = groups.map(normalizeGroup);

    _customMapGroupsCache = groups;
    rebuildCustomMapGroupsLookup(groups);
    return groups;
}

/**
 * Persists the groups array and refreshes every dependent piece of UI/state:
 * the match lookup, the legend row and the actual village colors on the map.
 * @param {Array} groups
 */
function saveCustomMapGroups(groups) {
    _customMapGroupsCache = groups;
    localStorage.setItem(getCustomMapGroupsStorageKey(), JSON.stringify(groups));
    rebuildCustomMapGroupsLookup(groups);
    renderCustomMapGroupsLegend();
    applyCustomMapGroupColors();
    rebuildCustomMapGroupsMapSdkElements();
}

/**
 * Rebuilds the per-group normalized (lowercase, trimmed) value Sets used for matching.
 * @param {Array} groups
 */
function rebuildCustomMapGroupsLookup(groups) {
    _customMapGroupsLookup = new Map();
    groups.forEach(group => {
        const set = new Set((group.values || []).map(v => String(v).trim().toLowerCase()).filter(Boolean));
        _customMapGroupsLookup.set(group.id, set);
    });
}

/**
 * Converts a "#rrggbb" hex string into a CSS rgb(...) string.
 * @param {string} hex
 * @returns {string}
 */
function hexToRgbString(hex) {
    const clean = (hex || '').replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16) || 0;
    const g = parseInt(clean.substring(2, 4), 16) || 0;
    const b = parseInt(clean.substring(4, 6), 16) || 0;
    return `rgb(${r},${g},${b})`;
}

/**
 * Converts an rgb(...) color string into a translucent rgba(...) string.
 * @param {string} rgb
 * @param {number} alpha
 * @returns {string}
 */
function rgbToRgbaString(rgb, alpha = 0.35) {
    const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
    if (!match) return rgb;
    return `rgba(${match[1]},${match[2]},${match[3]},${alpha})`;
}

/**
 * Checks whether a village matches a single group's coordinate/player/tribe values.
 * @param {Object} village - A TWMap.villages entry (has owner, ally_id, xy, ...).
 * @param {Object} group
 * @returns {boolean}
 */
function villageMatchesGroup(village, group) {
    const values = _customMapGroupsLookup.get(group.id);
    if (!values || !values.size) return false;

    if (group.matchType === 'villages') {
        const x = Math.floor(village.xy / 1000);
        const y = village.xy % 1000;
        return values.has(`${x}|${y}`);
    }
    if (group.matchType === 'players') {
        const ownerName = TWMap.players?.[village.owner]?.name;
        return !!ownerName && values.has(ownerName.trim().toLowerCase());
    }
    if (group.matchType === 'tribes') {
        const tag = TWMap.allies?.[village.ally_id]?.tag;
        return !!tag && values.has(tag.trim().toLowerCase());
    }
    return false;
}

/**
 * Resolves the first active group (priority = array order) that matches a village, or null.
 * @param {Object} village
 * @returns {Object|null}
 */
function resolveFirstMatchingGroup(village) {
    for (const group of loadCustomMapGroups()) {
        if (group.active && villageMatchesGroup(village, group)) return group;
    }
    return null;
}

function hasEnabledMapSdkShape(group) {
    return group.mapSdk.shape && group.mapSdk.shape !== 'none';
}

// Cache of loaded Image objects per icon URL, shared across all groups/villages.
const _mapGroupIconCache = new Map();

function getCachedMapGroupIcon(url) {
    if (_mapGroupIconCache.has(url)) return _mapGroupIconCache.get(url);
    const image = new Image();
    image.onload = () => MapSdk.redraw();
    image.src = url;
    _mapGroupIconCache.set(url, image);
    return image;
}

/**
 * Pushes MapSdk elements for one coordinate's selected shape into the global MapSdk arrays,
 * tagged with the owning group id for later cleanup/dedupe. Only one shape per group.
 */
function pushMapSdkElementsForGroup(x, y, group) {
    const sdk = group.mapSdk;
    if (!hasEnabledMapSdkShape(group)) return;

    const stroke = hexToRgbString(group.color);
    const translucentFill = rgbToRgbaString(stroke, MAP_GROUP_SHAPE_STYLE.fillOpacity);
    const opaqueFill = rgbToRgbaString(stroke, MAP_GROUP_SHAPE_STYLE.indicatorFillOpacity);
    const tag = { _twpfGroupId: group.id };
    const translucentStyling = {
        main: { fillStyle: translucentFill, strokeStyle: stroke, lineWidth: MAP_GROUP_SHAPE_STYLE.strokeWidth },
        mini: { fillStyle: translucentFill, strokeStyle: stroke, lineWidth: MAP_GROUP_SHAPE_STYLE.strokeWidthMini }
    };
    // Borderless, fully opaque — used for the fixed-size square mirrored onto the minimap.
    const minimapSquareStyling = { mini: { fillStyle: stroke } };

    if (sdk.shape === 'circle') {
        MapSdk.circles.push({
            ...tag, x, y, radius: MAP_GROUP_SHAPE_SIZES.circle,
            styling: translucentStyling, drawOnMap: true, drawOnMini: false
        });
    } else if (sdk.shape === 'square') {
        pushMapGroupSquarePolygon(tag, x, y, MAP_GROUP_SHAPE_SIZES.square, translucentStyling, true, false);
    } else if (sdk.shape === 'indicator') {
        // Mimics the native color chip: an opaque circle nested exactly into the tile's corner.
        MapSdk.circles.push({
            ...tag, x, y, radius: MAP_GROUP_SHAPE_SIZES.indicator, anchor: 'cornerFit',
            styling: {
                main: { fillStyle: opaqueFill, strokeStyle: MAP_GROUP_SHAPE_STYLE.indicatorStrokeColor, lineWidth: MAP_GROUP_SHAPE_STYLE.indicatorStrokeWidth },
                mini: { fillStyle: opaqueFill, strokeStyle: MAP_GROUP_SHAPE_STYLE.indicatorStrokeColor, lineWidth: MAP_GROUP_SHAPE_STYLE.indicatorStrokeWidth }
            },
            drawOnMap: true, drawOnMini: false
        });
    } else if (sdk.shape === 'text') {
        MapSdk.texts.push({
            ...tag, x, y, text: sdk.value || group.name,
            color: '#ffffff', font: '11px Arial', miniFont: '9px Arial',
            drawOnMap: true, drawOnMini: sdk.showOnMinimap
        });
    } else if (sdk.shape === 'icon' && sdk.url) {
        MapSdk.icons.push({
            ...tag, x, y, img: getCachedMapGroupIcon(sdk.url),
            mapSize: MAP_GROUP_SHAPE_SIZES.iconMap, miniSize: MAP_GROUP_SHAPE_SIZES.iconMini,
            drawOnMap: true, drawOnMini: sdk.showOnMinimap
        });
    }

    // circle/square/indicator mirror onto the minimap as a fixed-size square instead of their own shape.
    if (sdk.showOnMinimap && ['circle', 'square', 'indicator'].includes(sdk.shape)) {
        pushMapGroupSquarePolygon(tag, x, y, MAP_GROUP_SHAPE_SIZES.minimapSquare, minimapSquareStyling, false, true);
    }
}

function pushMapGroupSquarePolygon(tag, x, y, size, styling, drawOnMap, drawOnMini) {
    const right = x + size;
    const bottom = y + size;
    MapSdk.polygons.push({
        ...tag, coords: [{ x, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }], anchor: 'topLeft',
        styling, drawOnMap, drawOnMini
    });
}

/**
 * Builds MapSdk elements directly from a 'villages' matchType group's stored coordinates —
 * no dependency on TWMap.villages, since the coordinate list is already fully known.
 */
function buildMapSdkElementsForGroup(group) {
    (group.values || []).forEach(value => {
        const match = String(value).trim().match(/^(\d{1,3})\|(\d{1,3})$/);
        if (!match) return;
        pushMapSdkElementsForGroup(Number(match[1]), Number(match[2]), group);
    });
}

function stripCustomMapGroupSdkElements() {
    ['circles', 'polygons', 'texts', 'icons'].forEach(collection => {
        MapSdk[collection] = MapSdk[collection].filter(element => !element._twpfGroupId);
    });
}

// Coordinate+group keys already drawn — avoids duplicate elements across rebuilds/reactive adds.
let _mapGroupDrawnSdkKeys = new Set();

/**
 * Fully rebuilds every MapSdk element owned by custom map groups, then triggers one redraw.
 * 'villages' matchType groups are built eagerly; 'players'/'tribes' groups are resolved from
 * whatever villages are currently known in TWMap.villages (more arrive reactively while panning).
 */
function rebuildCustomMapGroupsMapSdkElements() {
    if (typeof MapSdk === 'undefined' || typeof TWMap === 'undefined') return;

    stripCustomMapGroupSdkElements();
    _mapGroupDrawnSdkKeys = new Set();

    loadCustomMapGroups()
        .filter(group => group.active && group.matchType === 'villages' && hasEnabledMapSdkShape(group))
        .forEach(buildMapSdkElementsForGroup);

    Object.values(TWMap.villages || {}).forEach(village => {
        const group = resolveFirstMatchingGroup(village);
        if (!group || group.matchType === 'villages' || !hasEnabledMapSdkShape(group)) return;

        const x = Math.floor(village.xy / 1000);
        const y = village.xy % 1000;
        const key = `${group.id}_${x}_${y}`;
        if (_mapGroupDrawnSdkKeys.has(key)) return;

        _mapGroupDrawnSdkKeys.add(key);
        pushMapSdkElementsForGroup(x, y, group);
    });

    MapSdk.redraw();
}

// Batches reactive redraws so panning through several newly-discovered villages triggers
// a single MapSdk.redraw() instead of one per village.
let _pendingMapSdkRedraw = false;
let _mapSdkRedrawScheduled = false;

function scheduleMapSdkRedraw() {
    _pendingMapSdkRedraw = true;
    if (_mapSdkRedrawScheduled) return;

    _mapSdkRedrawScheduled = true;
    setTimeout(() => {
        _mapSdkRedrawScheduled = false;
        if (_pendingMapSdkRedraw) {
            _pendingMapSdkRedraw = false;
            MapSdk.redraw();
        }
    }, 0);
}

/**
 * Reactively adds MapSdk elements for a single village as it's discovered (e.g. while panning),
 * for 'players'/'tribes' matchType groups only — 'villages' groups are already fully built.
 */
function applyMapSdkElementForVillage(village) {
    if (typeof MapSdk === 'undefined') return;

    const group = resolveFirstMatchingGroup(village);
    if (!group || group.matchType === 'villages' || !hasEnabledMapSdkShape(group)) return;

    const x = Math.floor(village.xy / 1000);
    const y = village.xy % 1000;
    const key = `${group.id}_${x}_${y}`;
    if (_mapGroupDrawnSdkKeys.has(key)) return;

    _mapGroupDrawnSdkKeys.add(key);
    pushMapSdkElementsForGroup(x, y, group);
    scheduleMapSdkRedraw();
}

// Set once installMapHighlighterHook() runs; lets us repaint with native colors on demand.
let _origColorVillage = null;

/**
 * Wraps MapHighlighter.colorVillage so every native recolor (initial load, drag redraw,
 * hover-driven refresh) also runs our MapSdk shape resolution for that village.
 */
function installMapHighlighterHook() {
    if (typeof MapHighlighter === 'undefined' || _origColorVillage) return;

    _origColorVillage = MapHighlighter.colorVillage.bind(MapHighlighter);
    MapHighlighter.colorVillage = function (village) {
        _origColorVillage(village);
        applyMapSdkElementForVillage(village);
    };
}

/**
 * Re-runs the MapSdk shape resolution for every currently loaded village.
 * Relies on the MapHighlighter.colorVillage wrapper above to do the actual work.
 */
function applyCustomMapGroupColors() {
    if (typeof TWMap === 'undefined' || typeof MapHighlighter === 'undefined' || !TWMap.villages) return;
    Object.values(TWMap.villages).forEach(village => MapHighlighter.colorVillage(village));
}

/**
 * Repaints every loaded village using ONLY the native color logic, bypassing our override.
 * Used when the master toggle is switched off.
 */
function restoreNativeMapColors() {
    if (!_origColorVillage || !TWMap?.villages) return;
    Object.values(TWMap.villages).forEach(village => _origColorVillage(village));
}

const CUSTOM_MAP_GROUPS_LEGEND_ROW_ID = 'map_legend_custom_groups_row';

/**
 * (Re)builds the custom-groups row inside the native #map_legend table: one swatch+name
 * per group (click toggles visibility) plus a button that opens the manage popup.
 * Safe to call repeatedly — removes and recreates the row each time.
 */
function renderCustomMapGroupsLegend() {
    const legendBody = document.querySelector('#map_legend table tbody');
    document.getElementById(CUSTOM_MAP_GROUPS_LEGEND_ROW_ID)?.remove();
    if (!legendBody) return;

    const tr = document.createElement('tr');
    tr.className = 'nowrap';
    tr.id = CUSTOM_MAP_GROUPS_LEGEND_ROW_ID;

    const tdLabel = document.createElement('td');
    tdLabel.className = 'small';
    tdLabel.valign = 'top';
    tdLabel.textContent = t('map.groupsLegendLabel') + ':';

    const tdEntries = document.createElement('td');

    loadCustomMapGroups().forEach(group => {
        const entry = document.createElement('div');
        entry.className = 'map_legend';
        entry.dataset.id = group.id;
        entry.dataset.active = group.active ? '1' : '0';
        entry.style.cursor = 'pointer';
        entry.title = t('map.clickToToggleGroup');
        if (!group.active) entry.style.opacity = '0.4';

        const swatch = document.createElement('div');
        swatch.style.backgroundColor = hexToRgbString(group.color);

        const span = document.createElement('span');
        span.textContent = group.name;

        entry.append(swatch, document.createTextNode(' '), span);
        entry.onclick = () => {
            group.active = !group.active;
            saveCustomMapGroups(loadCustomMapGroups());
        };

        tdEntries.appendChild(entry);
    });

    const manageBtn = document.createElement('a');
    manageBtn.id = 'map_groups_manage_btn';
    manageBtn.className = 'btn';
    manageBtn.style.marginLeft = '4px';
    manageBtn.textContent = t('map.manageGroups');
    manageBtn.onclick = (e) => { e.preventDefault(); openMapGroupsPopup(); };
    tdEntries.appendChild(manageBtn);

    tr.append(tdLabel, tdEntries);
    legendBody.appendChild(tr);
}

// Cached popup element, created lazily on first open.
let _mapGroupsPopup = null;
// Id of the group currently being edited in the form, or null when adding a new one.
let _mapGroupsEditingId = null;

/**
 * Creates (once) the manage-groups popup and appends it to <body>.
 * Reuses the script's own popup CSS classes for visual consistency with the settings popup.
 * @returns {HTMLElement}
 */
function getOrCreateMapGroupsPopup() {
    if (_mapGroupsPopup) return _mapGroupsPopup;

    const popup = document.createElement('div');
    popup.id = 'map_groups_popup';
    popup.classList.add('popup_style', 'borderimage', 'popup_box', 'script-settings-popup');
    popup.style.display = 'none';
    popup.style.width = '480px';

    const header = document.createElement('div');
    header.className = 'script-popup-header';
    header.textContent = t('map.manageGroups');

    const closeLink = document.createElement('a');
    closeLink.className = 'script-popup-close';
    closeLink.textContent = t('button.close');
    closeLink.onclick = (e) => { e.preventDefault(); popup.style.display = 'none'; };
    header.appendChild(closeLink);

    const listContainer = document.createElement('div');
    listContainer.id = 'map_groups_list_container';

    const addButton = document.createElement('a');
    addButton.className = 'btn';
    addButton.textContent = t('button.addNew');
    addButton.style.display = 'inline-block';
    addButton.style.marginTop = '10px';
    addButton.onclick = (e) => { e.preventDefault(); openMapGroupsForm(null); };

    const formContainer = document.createElement('div');
    formContainer.id = 'map_groups_form_container';
    formContainer.style.display = 'none';
    formContainer.style.marginTop = '10px';
    formContainer.style.paddingTop = '10px';
    formContainer.style.borderTop = '1px solid #dec58a';

    popup.append(header, listContainer, addButton, formContainer);
    document.body.appendChild(popup);

    // Escape / click-outside to close — scoped to this popup, independent from the settings popup.
    $(document).off('keydown.map_groups_popup').on('keydown.map_groups_popup', function (e) {
        if (e.key !== 'Escape') return;
        if (popup.style.display !== 'none') popup.style.display = 'none';
    });
    $(document).off('mousedown.map_groups_popup').on('mousedown.map_groups_popup', function (e) {
        if (popup.style.display === 'none') return;
        if (!popup.contains(e.target) && !e.target.closest('#map_groups_manage_btn')) popup.style.display = 'none';
    });

    _mapGroupsPopup = popup;
    return popup;
}

/**
 * Opens the manage-groups popup, refreshing the group list every time.
 */
function openMapGroupsPopup() {
    const popup = getOrCreateMapGroupsPopup();
    renderMapGroupsList();
    popup.querySelector('#map_groups_form_container').style.display = 'none';
    popup.style.display = 'block';
}

/**
 * Renders the list of existing groups (reorder/toggle/edit/delete controls) into the popup.
 */
function renderMapGroupsList() {
    const container = document.getElementById('map_groups_list_container');
    if (!container) return;
    container.innerHTML = '';

    const groups = loadCustomMapGroups();
    if (!groups.length) {
        const empty = document.createElement('p');
        empty.textContent = t('map.noGroupsYet');
        container.appendChild(empty);
        return;
    }

    const table = document.createElement('table');
    table.className = 'vis';
    table.style.width = '100%';
    const tbody = document.createElement('tbody');

    const matchTypeLabels = {
        villages: t('map.matchTypeVillages'),
        players: t('map.matchTypePlayers'),
        tribes: t('map.matchTypeTribes')
    };

    groups.forEach((group, index) => {
        const row = document.createElement('tr');
        row.draggable = true;
        row.style.cursor = 'grab';

        row.ondragstart = (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', group.id);
            row.style.opacity = '0.5';
        };
        row.ondragend = () => {
            row.style.opacity = '';
            row.style.cursor = 'grab';
        };
        row.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            row.style.outline = '2px solid #7d510f';
        };
        row.ondragleave = () => { row.style.outline = ''; };
        row.ondrop = (e) => {
            e.preventDefault();
            row.style.outline = '';
            const draggedId = e.dataTransfer.getData('text/plain');
            const draggedIndex = groups.findIndex(item => item.id === draggedId);
            if (draggedIndex < 0 || draggedIndex === index) return;

            const [draggedGroup] = groups.splice(draggedIndex, 1);
            groups.splice(draggedIndex < index ? index - 1 : index, 0, draggedGroup);
            saveCustomMapGroups(groups);
            renderMapGroupsList();
        };

        const tdDragHandle = document.createElement('td');
        tdDragHandle.style.width = '20px';
        tdDragHandle.style.textAlign = 'center';
        const dragHandle = document.createElement('span');
        dragHandle.textContent = '\u2630';
        dragHandle.title = t('map.dragToReorder');
        dragHandle.style.cursor = 'grab';
        dragHandle.style.fontSize = '16px';
        tdDragHandle.appendChild(dragHandle);

        const tdActive = document.createElement('td');
        const activeCheckbox = Object.assign(document.createElement('input'), {
            type: 'checkbox',
            checked: group.active
        });
        activeCheckbox.draggable = false;
        activeCheckbox.onclick = () => { group.active = activeCheckbox.checked; saveCustomMapGroups(groups); };
        tdActive.appendChild(activeCheckbox);

        const tdColor = document.createElement('td');
        const swatch = document.createElement('div');
        Object.assign(swatch.style, {
            width: '16px', height: '16px', display: 'inline-block',
            backgroundColor: hexToRgbString(group.color), border: '1px solid #7d510f'
        });
        tdColor.appendChild(swatch);

        const tdName = document.createElement('td');
        tdName.textContent = group.name;

        const tdType = document.createElement('td');
        tdType.textContent = matchTypeLabels[group.matchType] || group.matchType;

        const tdActions = document.createElement('td');
        tdActions.style.whiteSpace = 'nowrap';

        const editBtn = document.createElement('a');
        editBtn.className = 'btn';
        editBtn.draggable = false;
        editBtn.textContent = t('button.edit');
        editBtn.style.marginRight = '4px';
        editBtn.onclick = (e) => { e.preventDefault(); openMapGroupsForm(group.id); };

        const deleteBtn = document.createElement('a');
        deleteBtn.className = 'btn';
        deleteBtn.draggable = false;
        deleteBtn.textContent = t('button.remove');
        deleteBtn.onclick = (e) => {
            e.preventDefault();
            UI.ConfirmationBox(
                t('map.confirmDeleteGroup', { name: escapeHtml(group.name) }),
                [{
                    text: t('button.ok'),
                    callback: function () {
                        saveCustomMapGroups(loadCustomMapGroups().filter(g => g.id !== group.id));
                        renderMapGroupsList();
                    },
                    confirm: true
                }],
                'tw_delete_map_group_' + group.id,
                false,
                true
            );
        };

        tdActions.append(editBtn, deleteBtn);
        row.append(tdActive, tdColor, tdName, tdType, tdActions, tdDragHandle);
        tbody.appendChild(row);
    });

    table.appendChild(tbody);
    container.appendChild(table);
}

/**
 * Builds the full add/edit group form (name, color, match type, values, shape, shape value,
 * minimap toggle) into `formContainer`, wiring Save/Cancel to the given callbacks. Shared by the
 * manage-groups popup (openMapGroupsForm) and mapGroupQuickLinks.js's "New" flow, so both
 * places offer the exact same set of fields.
 * @param {Element} formContainer
 * @param {{group?: Object|null, defaultMatchType?: string, defaultValues?: string[], onSaved: (groups:Array) => void, onCancel: () => void}} options
 */
function renderGroupForm(formContainer, options) {
    const { group = null, defaultMatchType = 'villages', defaultValues = [], onSaved, onCancel } = options;
    // Working copy so mapSdk field edits only take effect once "Save" is clicked.
    const formMapSdk = normalizeGroup(group ? { mapSdk: JSON.parse(JSON.stringify(group.mapSdk)) } : {}).mapSdk;

    formContainer.innerHTML = '';
    formContainer.style.display = 'block';

    const table = document.createElement('table');
    table.className = 'vis settings-table';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.style.width = '95%';
    nameInput.value = group?.name || '';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = group?.color || '#ff0000';

    const typeSelect = document.createElement('select');
    [
        { value: 'villages', label: t('map.matchTypeVillages') },
        { value: 'players', label: t('map.matchTypePlayers') },
        { value: 'tribes', label: t('map.matchTypeTribes') }
    ].forEach(opt => {
        const option = Object.assign(document.createElement('option'), { value: opt.value, textContent: opt.label });
        typeSelect.appendChild(option);
    });
    typeSelect.value = group?.matchType || defaultMatchType;

    const valuesTextarea = document.createElement('textarea');
    valuesTextarea.style.width = '95%';
    valuesTextarea.rows = 5;
    valuesTextarea.value = (group?.values || defaultValues).join('\n');

    const valuesHelp = document.createElement('small');
    valuesHelp.style.display = 'block';
    valuesHelp.style.color = '#555';

    const valuesHelpKeys = { villages: 'valuesHelpVillages', players: 'valuesHelpPlayers', tribes: 'valuesHelpTribes' };
    const updateValuesHelp = () => { valuesHelp.textContent = t('map.' + valuesHelpKeys[typeSelect.value]); };
    typeSelect.onchange = updateValuesHelp;
    updateValuesHelp();

    const addFormRow = (labelKey, input) => {
        const row = document.createElement('tr');
        const tdLabel = Object.assign(document.createElement('td'), { className: 'settings-label-cell', textContent: t(labelKey) });
        const tdInput = document.createElement('td');
        tdInput.className = 'settings-input-cell';
        tdInput.appendChild(input);
        row.append(tdLabel, tdInput);
        table.appendChild(row);
    };

    addFormRow('map.groupName', nameInput);
    addFormRow('map.groupColor', colorInput);
    addFormRow('map.groupMatchType', typeSelect);

    const valuesRow = document.createElement('tr');
    const valuesLabelTd = Object.assign(document.createElement('td'), { className: 'settings-label-cell', textContent: t('map.groupValues') });
    const valuesInputTd = document.createElement('td');
    valuesInputTd.className = 'settings-input-cell';
    valuesInputTd.append(valuesTextarea, valuesHelp);
    valuesRow.append(valuesLabelTd, valuesInputTd);
    table.appendChild(valuesRow);

    const shapeSelect = document.createElement('select');
    [
        { value: 'none', label: t('map.shapeNone') },
        { value: 'circle', label: t('map.groupCircleEnabled') },
        { value: 'square', label: t('map.groupSquareEnabled') },
        { value: 'indicator', label: t('map.groupIndicatorEnabled') },
        { value: 'text', label: t('map.groupTextEnabled') },
        { value: 'icon', label: t('map.groupIconEnabled') }
    ].forEach(opt => {
        const option = Object.assign(document.createElement('option'), { value: opt.value, textContent: opt.label });
        shapeSelect.appendChild(option);
    });
    shapeSelect.value = formMapSdk.shape;
    addFormRow('map.groupShape', shapeSelect);

    const textInput = (value, placeholder, onChange, width = '200px') => {
        const el = document.createElement('input');
        Object.assign(el, { type: 'text', value, placeholder: placeholder || '' });
        el.style.width = width;
        el.oninput = () => onChange(el.value);
        return el;
    };

    // Shown only for the 'text'/'icon' shapes — circle/square/indicator need no extra value.
    const shapeValueRow = document.createElement('tr');
    const shapeValueLabelTd = document.createElement('td');
    shapeValueLabelTd.className = 'settings-label-cell';
    const shapeValueInputTd = document.createElement('td');
    shapeValueInputTd.className = 'settings-input-cell';
    shapeValueRow.append(shapeValueLabelTd, shapeValueInputTd);

    const renderShapeValueInput = () => {
        shapeValueLabelTd.textContent = '';
        shapeValueInputTd.innerHTML = '';
        shapeValueRow.style.display = 'none';

        if (shapeSelect.value === 'text') {
            shapeValueRow.style.display = '';
            shapeValueLabelTd.textContent = t('map.groupTextEnabled');
            shapeValueInputTd.appendChild(textInput(formMapSdk.value, t('map.groupName'), v => formMapSdk.value = v));
        } else if (shapeSelect.value === 'icon') {
            shapeValueRow.style.display = '';
            shapeValueLabelTd.textContent = t('map.groupIconUrl');
            shapeValueInputTd.appendChild(textInput(formMapSdk.url, t('map.groupIconUrl'), v => formMapSdk.url = v));
        }
    };
    shapeSelect.onchange = () => { formMapSdk.shape = shapeSelect.value; renderShapeValueInput(); };
    renderShapeValueInput();
    table.appendChild(shapeValueRow);

    const minimapRow = document.createElement('tr');
    const minimapLabelTd = Object.assign(document.createElement('td'), { className: 'settings-label-cell', textContent: t('map.groupShowOnMinimap') });
    const minimapInputTd = document.createElement('td');
    minimapInputTd.className = 'settings-input-cell';
    const minimapCheckbox = Object.assign(document.createElement('input'), { type: 'checkbox', checked: formMapSdk.showOnMinimap });
    minimapCheckbox.onchange = () => { formMapSdk.showOnMinimap = minimapCheckbox.checked; };
    minimapInputTd.appendChild(minimapCheckbox);
    minimapRow.append(minimapLabelTd, minimapInputTd);
    table.appendChild(minimapRow);

    const saveBtn = document.createElement('a');
    saveBtn.className = 'btn';
    saveBtn.style.marginRight = '6px';
    saveBtn.textContent = t('button.save');
    saveBtn.onclick = (e) => {
        e.preventDefault();
        const name = nameInput.value.trim();
        if (!name) return;

        const values = valuesTextarea.value.split('\n').map(v => v.trim()).filter(Boolean);
        const groups = loadCustomMapGroups();

        if (group) {
            const existing = groups.find(g => g.id === group.id);
            Object.assign(existing, { name, color: colorInput.value, matchType: typeSelect.value, values, mapSdk: formMapSdk });
        } else {
            groups.push({ id: 'group_' + Date.now(), name, color: colorInput.value, active: true, matchType: typeSelect.value, values, mapSdk: formMapSdk });
        }

        saveCustomMapGroups(groups);
        onSaved(groups);
    };

    const cancelBtn = document.createElement('a');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = t('button.cancel');
    cancelBtn.onclick = (e) => { e.preventDefault(); onCancel(); };

    formContainer.append(table, saveBtn, cancelBtn);
}

/**
 * Shows the manage-popup's add/edit form pre-filled for the given group id, or empty for a new
 * group.
 * @param {string|null} groupId
 */
function openMapGroupsForm(groupId) {
    _mapGroupsEditingId = groupId;
    const group = groupId ? loadCustomMapGroups().find(g => g.id === groupId) : null;
    const formContainer = document.getElementById('map_groups_form_container');

    renderGroupForm(formContainer, {
        group,
        onSaved: () => { renderMapGroupsList(); formContainer.style.display = 'none'; },
        onCancel: () => { formContainer.style.display = 'none'; }
    });
}

if (typeof TWMap !== 'undefined' && getSetting('show__map_groups_overlay') !== false) {
    installMapHighlighterHook();

    mapReady().then(() => {
        renderCustomMapGroupsLegend();
        applyCustomMapGroupColors();
        rebuildCustomMapGroupsMapSdkElements();
    });

    if (TWMap.map) {
        // Chain after whatever handler is already assigned (e.g. map.js's own
        // wrapper) instead of replacing it, so both files' drag-repaint logic keeps running.
        const _previousOnMovePixel = TWMap.map.handler.onMovePixel;
        TWMap.map.handler.onMovePixel = function (e, a) {
            _previousOnMovePixel.call(this, e, a);
            applyCustomMapGroupColors();
        };
    }
}
