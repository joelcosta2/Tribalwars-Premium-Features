// Feature: Map Group Quick Links
// Adds a "quick add" link to the info_player / info_ally / info_village pages, placed right after
// the native TWStats external-link row, so the current player/tribe/village can be added to a
// Custom Map Group (mapGroups.js) without leaving the page or opening the full manage popup.
// Reuses mapGroups.js's globals: loadCustomMapGroups(), saveCustomMapGroups(),
// hexToRgbString(), renderGroupForm() — must load after that file.

const QUICK_ADD_ROW_ID = 'twpf_quick_add_row';
const QUICK_ADD_LINK_ID = 'twpf_quick_add_map_group_link';
const MAP_GROUP_CTX_BUTTON_ID = 'mp_invite';

/**
 * Resolves the value to store in a group's `values` array for the current page, matching the
 * same field each `matchType` uses in villageMatchesGroup().
 * @param {'players'|'tribes'|'villages'} matchType
 * @returns {string|null}
 */
function getQuickAddSubject(matchType) {
    if (matchType === 'players') {
        return document.querySelector('#content_value > h2')?.textContent?.replace(/\s+/g, ' ').trim() || null;
    }

    if (matchType === 'tribes') {
        const allyName = document.querySelector('#content_value > h2')?.textContent?.replace(/\s+/g, ' ').trim();
        if (!allyName) return null;

        let tag = (typeof getCachedAllyByName === 'function' ? getCachedAllyByName(allyName) : null)?.tag;

        if (!tag) {
            // Cache miss fallback: on the properties table the "Sigla" row structurally follows "Nome da tribo".
            const rows = document.querySelector('#content_value table.vis')?.querySelectorAll(':scope > tbody > tr');
            tag = rows?.[2]?.querySelectorAll('td')[1]?.textContent?.trim();
        }

        return tag || null;
    }

    if (matchType === 'villages') {
        const table = document.getElementById('embedmap_village')?.closest('table.vis');
        return Array.from(table?.querySelectorAll('td') || [])
            .map(td => td.textContent.trim())
            .find(text => /^\d{1,3}\|\d{1,3}$/.test(text)) || null;
    }

    return null;
}

/**
 * Entry point: injects the quick-add link into the native external-links row on the current page.
 * No-op if the subject can't be resolved or the native anchor row isn't found.
 * @param {'players'|'tribes'|'villages'} matchType
 */
function injectMapGroupQuickAddLink(matchType) {
    const value = getQuickAddSubject(matchType);
    if (!value) return;

    const anchorRow = document.querySelector('#content_value a[target="_blank"][href*="twstats.com"]')?.closest('tr');
    if (!anchorRow) return;

    document.getElementById(QUICK_ADD_ROW_ID)?.remove();

    const row = document.createElement('tr');
    row.id = QUICK_ADD_ROW_ID;

    const td = document.createElement('td');
    td.colSpan = 2;

    const link = document.createElement('a');
    link.id = QUICK_ADD_LINK_ID;
    link.href = '#';
    link.innerHTML = '<span class="action-icon-container"><span class="icon header map"></span></span> ' + escapeHtml(t('map.quickAddLinkLabel'));
    link.onclick = function (e) {
        e.preventDefault();
        openMapGroupQuickAddPopup(matchType, value);
    };

    td.appendChild(link);
    row.appendChild(td);
    anchorRow.after(row);
}

// Cached popup element, created lazily on first open.
let _mapGroupQuickAddPopup = null;

/**
 * Creates (once) the quick-add popup, reusing the script's popup CSS classes for visual
 * consistency with the manage-groups popup in mapGroups.js.
 * @returns {HTMLElement}
 */
function getOrCreateMapGroupQuickAddPopup() {
    if (_mapGroupQuickAddPopup) return _mapGroupQuickAddPopup;

    const popup = document.createElement('div');
    popup.id = 'map_group_quick_add_popup';
    popup.classList.add('popup_style', 'borderimage', 'popup_box', 'script-settings-popup');
    popup.style.display = 'none';
    popup.style.width = '480px';

    const header = document.createElement('div');
    header.className = 'script-popup-header';

    const titleText = document.createElement('span');
    titleText.id = 'map_group_quick_add_popup_title';

    const closeLink = document.createElement('a');
    closeLink.className = 'script-popup-close';
    closeLink.textContent = t('button.close');
    closeLink.onclick = (e) => { e.preventDefault(); popup.style.display = 'none'; };

    header.append(titleText, closeLink);

    const body = document.createElement('div');
    body.id = 'map_group_quick_add_popup_body';
    body.style.marginTop = '10px';

    popup.append(header, body);
    document.body.appendChild(popup);

    $(document).off('keydown.map_group_quick_add_popup').on('keydown.map_group_quick_add_popup', function (e) {
        if (e.key !== 'Escape') return;
        if (popup.style.display !== 'none') popup.style.display = 'none';
    });
    $(document).off('mousedown.map_group_quick_add_popup').on('mousedown.map_group_quick_add_popup', function (e) {
        if (popup.style.display === 'none') return;
        if (!popup.contains(e.target) && e.target.id !== QUICK_ADD_LINK_ID && e.target.id !== MAP_GROUP_CTX_BUTTON_ID) popup.style.display = 'none';
    });

    _mapGroupQuickAddPopup = popup;
    return popup;
}

/**
 * Opens the quick-add popup for the given subject, refreshing the group list every time.
 * @param {'players'|'tribes'|'villages'} matchType
 * @param {string} value
 */
function openMapGroupQuickAddPopup(matchType, value) {
    const popup = getOrCreateMapGroupQuickAddPopup();
    popup.querySelector('#map_group_quick_add_popup_title').textContent = t('map.quickAddPopupTitle');
    renderQuickAddGroupList(popup.querySelector('#map_group_quick_add_popup_body'), matchType, value);
    popup.style.display = 'block';
}

/**
 * Renders one button per group matching `matchType`, plus a "+ New" control, into `container`.
 * @param {Element} container
 * @param {'players'|'tribes'|'villages'} matchType
 * @param {string} value
 */
function renderQuickAddGroupList(container, matchType, value) {
    container.innerHTML = '';
    const normalizedValue = value.trim().toLowerCase();
    const groups = loadCustomMapGroups().filter(g => g.matchType === matchType);

    if (!groups.length) {
        const empty = document.createElement('p');
        empty.textContent = t('map.noGroupsYet');
        container.appendChild(empty);
    } else {
        groups.forEach(group => {
            const alreadyAdded = (group.values || []).some(v => String(v).trim().toLowerCase() === normalizedValue);

            const btn = document.createElement('a');
            btn.className = 'btn';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.marginBottom = '4px';

            const swatch = document.createElement('span');
            Object.assign(swatch.style, {
                width: '12px', height: '12px', display: 'inline-block', marginRight: '6px',
                backgroundColor: hexToRgbString(group.color), border: '1px solid #7d510f'
            });

            btn.append(swatch, document.createTextNode(group.name + (alreadyAdded ? ' \u2713' : '')));
            btn.onclick = (e) => { e.preventDefault(); toggleValueInGroup(group, value, container, matchType); };

            container.appendChild(btn);
        });
    }

    const newGroupBtn = document.createElement('a');
    newGroupBtn.className = 'btn';
    newGroupBtn.style.display = 'inline-block';
    newGroupBtn.style.marginTop = '8px';
    newGroupBtn.textContent = t('button.new');
    newGroupBtn.onclick = (e) => { e.preventDefault(); renderQuickAddNewGroupForm(container, matchType, value); };

    container.appendChild(newGroupBtn);
}

/**
 * Adds `value` to `group.values`, or removes it if already present (click = toggle membership).
 * Persists the change and re-renders the list in place — the popup stays open either way.
 * @param {Object} group
 * @param {string} value
 * @param {Element} container
 * @param {'players'|'tribes'|'villages'} matchType
 */
function toggleValueInGroup(group, value, container, matchType, rerender = () => renderQuickAddGroupList(container, matchType, value)) {
    const normalizedValue = value.trim().toLowerCase();
    const groups = loadCustomMapGroups();
    const target = groups.find(g => g.id === group.id);
    if (!target) return;

    const alreadyAdded = (target.values || []).some(v => String(v).trim().toLowerCase() === normalizedValue);
    if (alreadyAdded) {
        target.values = target.values.filter(v => String(v).trim().toLowerCase() !== normalizedValue);
        saveCustomMapGroups(groups);
        UI.SuccessMessage(t('map.quickAddRemoved', { group: escapeHtml(target.name) }));
    } else {
        target.values = [...(target.values || []), value];
        saveCustomMapGroups(groups);
        UI.SuccessMessage(t('map.quickAddSuccess', { group: escapeHtml(target.name) }));
    }

    rerender();
}

/**
 * Replaces the group list with the same full add-group form used by the manage-groups popup
 * (mapGroups.js's renderGroupForm), pre-selecting the current matchType/value.
 * @param {Element} container
 * @param {'players'|'tribes'|'villages'} matchType
 * @param {string} value
 */
function renderQuickAddNewGroupForm(container, matchType, value) {
    renderGroupForm(container, {
        defaultMatchType: matchType,
        defaultValues: [value],
        onSaved: (groups) => {
            const created = groups[groups.length - 1];
            UI.SuccessMessage(t('map.quickAddSuccess', { group: escapeHtml(created.name) }));
            renderQuickAddGroupList(container, matchType, value);
        },
        onCancel: () => renderQuickAddGroupList(container, matchType, value)
    });
}

/**
 * Resolves the subjects that can be stored for a village selected in the map context.
 * Unowned villages are coordinate-only, which covers barbarian and bonus villages.
 * @param {Object} village
 * @param {number} x
 * @param {number} y
 * @returns {Array<{matchType:'players'|'tribes'|'villages', value:string}>}
 */
function getMapContextSubjects(village, x, y) {
    const subjects = [{ matchType: 'villages', value: `${x}|${y}` }];
    if (String(village?.owner) === '0') return subjects;

    const playerName = TWMap.players?.[village?.owner]?.name?.trim();
    if (playerName) subjects.push({ matchType: 'players', value: playerName });

    const tribeTag = TWMap.allies?.[village?.ally_id]?.tag?.trim();
    if (tribeTag) subjects.push({ matchType: 'tribes', value: tribeTag });

    return subjects;
}

/**
 * Resolves the same group subjects for a native .village_anchor context outside the map.
 * Coordinates remain available even when the map data caches are cold.
 * @param {{ownerId:string, x:number, y:number, coords:string}} context
 * @returns {Array<{matchType:'players'|'tribes'|'villages', value:string}>}
 */
function getExternalContextSubjects(context) {
    if (context.x === null || context.y === null) return [];

    const subjects = [{ matchType: 'villages', value: context.coords }];
    const cachedVillage = getCachedVillageByCoords(context.x, context.y);
    const ownerId = cachedVillage?.ownerId || context.ownerId;
    const player = getCachedPlayerById(ownerId);
    if (player?.name) subjects.push({ matchType: 'players', value: player.name.trim() });

    const ally = getCachedAllyById(player?.allyId);
    if (ally?.tag) subjects.push({ matchType: 'tribes', value: ally.tag.trim() });
    return subjects;
}

registerCtxCustomAction({
    id: 'map-groups',
    slot: 2,
    title: t('map.contextGroupsButtonTitle'),
    className: 'custom-map-ctx-button',
    spriteClass: 'mp_invite',
    onClick: context => {
        const popup = getOrCreateMapGroupQuickAddPopup();
        popup.querySelector('#map_group_quick_add_popup_title').textContent = t('map.contextGroupsPopupTitle');
        renderMapContextGroupList(popup.querySelector('#map_group_quick_add_popup_body'), getExternalContextSubjects(context));
        popup.style.display = 'block';
    }
});

/**
 * Renders all subject sections for a map-context village into the existing quick-add popup.
 * @param {Element} container
 * @param {Array<{matchType:string, value:string}>} subjects
 */
function renderMapContextGroupList(container, subjects) {
    container.innerHTML = '';

    subjects.forEach(({ matchType, value }) => {
        const section = document.createElement('div');
        section.style.marginBottom = '10px';

        const heading = document.createElement('strong');
        heading.textContent = t(`map.matchType${matchType[0].toUpperCase()}${matchType.slice(1)}`);
        section.appendChild(heading);

        const groups = loadCustomMapGroups().filter(group => group.matchType === matchType);
        if (!groups.length) {
            const empty = document.createElement('p');
            empty.textContent = t('map.noGroupsYet');
            empty.style.margin = '4px 0';
            section.appendChild(empty);
        } else {
            const normalizedValue = value.trim().toLowerCase();
            groups.forEach(group => {
                const alreadyAdded = (group.values || []).some(groupValue => String(groupValue).trim().toLowerCase() === normalizedValue);
                const btn = document.createElement('a');
                btn.className = 'btn';
                btn.style.display = 'flex';
                btn.style.alignItems = 'center';
                btn.style.marginTop = '4px';

                const swatch = document.createElement('span');
                Object.assign(swatch.style, {
                    width: '12px', height: '12px', display: 'inline-block', marginRight: '6px',
                    backgroundColor: hexToRgbString(group.color), border: '1px solid #7d510f'
                });

                btn.append(swatch, document.createTextNode(group.name + (alreadyAdded ? ' \u2713' : '')));
                btn.onclick = (e) => {
                    e.preventDefault();
                    toggleValueInGroup(group, value, container, matchType, () => rerenderMapContextGroupList(container, subjects));
                };
                section.appendChild(btn);
            });
        }

        const newGroupBtn = document.createElement('a');
        newGroupBtn.className = 'btn';
        newGroupBtn.style.display = 'inline-block';
        newGroupBtn.style.marginTop = '6px';
        newGroupBtn.textContent = t('button.new');
        newGroupBtn.onclick = (e) => {
            e.preventDefault();
            renderGroupForm(container, {
                defaultMatchType: matchType,
                defaultValues: [value],
                onSaved: (groups) => {
                    const created = groups[groups.length - 1];
                    UI.SuccessMessage(t('map.quickAddSuccess', { group: escapeHtml(created.name) }));
                    rerenderMapContextGroupList(container, subjects);
                },
                onCancel: () => rerenderMapContextGroupList(container, subjects)
            });
        };
        section.appendChild(newGroupBtn);
        container.appendChild(section);
    });
}

function rerenderMapContextGroupList(container, subjects) {
    renderMapContextGroupList(container, subjects);
    if (_mapGroupQuickAddPopup) _mapGroupQuickAddPopup.style.display = 'block';
}

/**
 * Opens the existing quick-add popup for a map-context village.
 * @param {Object} village
 * @param {number} x
 * @param {number} y
 */
function openMapContextGroupPopup(village, x, y) {
    const popup = getOrCreateMapGroupQuickAddPopup();
    popup.querySelector('#map_group_quick_add_popup_title').textContent = t('map.contextGroupsPopupTitle');
    renderMapContextGroupList(popup.querySelector('#map_group_quick_add_popup_body'), getMapContextSubjects(village, x, y));
    popup.style.display = 'block';
}

let _mapGroupContextWatcherStarted = false;

function getMapGroupContextPosition(nativeFavorite) {
    if (nativeFavorite?.style.left && nativeFavorite?.style.top && nativeFavorite.style.display !== 'none') {
        return { left: nativeFavorite.style.left, top: nativeFavorite.style.top };
    }

    const mpInfo = document.getElementById('mp_info');
    if (!mpInfo?.style.left || !mpInfo?.style.top) return null;
    return { left: `${parseFloat(mpInfo.style.left) + 61}px`, top: mpInfo.style.top };
}

/**
 * Reuses the native invitation anchor as the map Groups context button.
 * Native favorite/invitation behavior is blocked; the custom popup owns the click.
 */
function startMapGroupContextWatcher() {
    if (_mapGroupContextWatcherStarted || typeof TWMap === 'undefined' || !TWMap.context) return;
    _mapGroupContextWatcherStarted = true;

    const previousSpawn = TWMap.context.spawn.bind(TWMap.context);
    TWMap.context.spawn = function (village, x, y) {
        previousSpawn(village, x, y);

        const ctxButton = document.getElementById(MAP_GROUP_CTX_BUTTON_ID);
        if (!isMapContextButtonEnabled('mapGroup')) {
            if (ctxButton) {
                ctxButton.style.display = 'none';
                ctxButton.style.opacity = '0';
            }
            return;
        }

        const nativeFavorites = [document.getElementById('mp_fav'), document.getElementById('mp_unfav')];
        const nativeFavorite = nativeFavorites.find(anchor => anchor?.style.display !== 'none') || nativeFavorites[0];
        const position = getMapGroupContextPosition(nativeFavorite);
        if (!ctxButton || !position) return;

        $(ctxButton).off('click.mapGroupContext');
        nativeFavorites.forEach(anchor => {
            if (anchor) {
                anchor.style.display = 'none';
                anchor.style.opacity = '0';
            }
        });
        ctxButton.style.left = position.left;
        ctxButton.style.top = position.top;
        ctxButton.style.display = 'block';
        ctxButton.style.opacity = '1';
        const contextButtonTitle = t('map.contextGroupsButtonTitle');
        ctxButton.setAttribute('data-title', contextButtonTitle);
        ctxButton.tooltipText = contextButtonTitle;
        $(ctxButton).triggerHandler('tooltip_content_change');
        $(ctxButton).on('click.mapGroupContext', function (event) {
            event.preventDefault();
            event.stopImmediatePropagation();
            openMapContextGroupPopup(village, x, y);
            return false;
        });
    };

    const previousHide = TWMap.context.hide.bind(TWMap.context);
    TWMap.context.hide = function () {
        previousHide();
        const ctxButton = document.getElementById(MAP_GROUP_CTX_BUTTON_ID);
        if (ctxButton) {
            $(ctxButton).off('click.mapGroupContext');
            ctxButton.style.display = 'none';
            ctxButton.style.opacity = '0';
        }
        if (_mapGroupQuickAddPopup) _mapGroupQuickAddPopup.style.display = 'none';
    };
}

if (typeof TWMap !== 'undefined' && getSetting('show__map_group_quicklinks') !== false && isMapContextButtonEnabled('mapGroup')) startMapGroupContextWatcher();
