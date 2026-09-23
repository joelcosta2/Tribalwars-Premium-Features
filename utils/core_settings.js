
var availableSettings = [
    // Overview Widgets
    { "name": "show__village_list", "label": t('settings.villageListLabel'), "description": t('settings.villageListDesc'), "group": t('settings.groupWidgets') },
    { "name": "show__recruit_troops", "label": t('settings.recruitTroopsLabel'), "description": t('settings.recruitTroopsDesc'), "group": t('settings.groupWidgets') },
    { "name": "show__notepad", "label": t('settings.notepadLabel'), "description": t('settings.notepadDesc'), "group": t('settings.groupWidgets') },
    { "name": "show__building_queue", "label": t('settings.buildingQueueLabel'), "description": t('settings.buildingQueueDesc'), "group": t('settings.groupWidgets') },
    { "name": "show__village_groups", "label": t('settings.villageGroupsLabel'), "description": t('settings.villageGroupsDesc'), "group": t('settings.groupWidgets') },

    // Overview Villages Premium Features
    { "name": "show__overview_villages_queue", "label": t('settings.overviewVillagesQueueLabel'), "description": t('settings.overviewVillagesQueueDesc'), "group": t('settings.groupOverviewVillages') },
    {
        "name": "show__overview_villages_troops",
        "label": t('settings.overviewVillagesTroopsLabel'),
        "description": t('settings.overviewVillagesTroopsDesc'),
        "group": t('settings.groupOverviewVillages'),
        "extraSettings": {
            "auto": {
                "label": t('settings.overviewVillagesTroopsAutoLabel'),
                "desc": t('settings.overviewVillagesTroopsAutoDesc'),
                "type": "checkbox",
                "default": false
            },
            "mode": {
                "label": t('settings.overviewVillagesTroopsAutoModeLabel'),
                "type": "select",
                "default": "full",
                "options": [
                    { "value": "full", "label": t('settings.overviewVillagesTroopsAutoModeFull') },
                    { "value": "place", "label": t('settings.overviewVillagesTroopsAutoModePlace') }
                ]
            }
        }
    },
    {
        "name": "show__overview_villages_quicklinks",
        "label": t('settings.overviewVillagesQuicklinksLabel'),
        "description": t('settings.overviewVillagesQuicklinksDesc'),
        "group": t('settings.groupOverviewVillages'),
        "extraSettings": {
            "queue": {
                "label": t('settings.overviewVillagesQuicklinksQueueLabel'),
                "desc": t('settings.overviewVillagesQuicklinksQueueDesc'),
                "type": "checkbox",
                "default": true
            },
            "training": {
                "label": t('settings.overviewVillagesQuicklinksTrainingLabel'),
                "desc": t('settings.overviewVillagesQuicklinksTrainingDesc'),
                "type": "checkbox",
                "default": true
            },
            "source": {
                "label": t('settings.overviewVillagesQuicklinksSourceLabel'),
                "type": "select",
                "default": "navbar",
                "options": [
                    { "value": "navbar", "label": t('settings.overviewVillagesQuicklinksSourceNavbar') },
                    { "value": "custom", "label": t('settings.overviewVillagesQuicklinksSourceCustom') }
                ]
            },
            "items": {
                "label": t('settings.overviewVillagesQuicklinksItemsLabel'),
                "type": "custom_quicklinks"
            }
        }
    },

    // Map Enhancements
    {
        "name": "show__map_ctx_buttons",
        "label": t('settings.mapCtxButtonsLabel'),
        "description": t('settings.mapCtxButtonsDesc'),
        "group": t('settings.groupMap'),
        "extraSettings": {
            "attackButtons": {
                "label": t('settings.mapCtxButtonsAttackLabel'),
                "desc": t('settings.mapCtxButtonsAttackDesc'),
                "type": "checkbox",
                "default": true,
                "helpLink": {
                    "href": "place&mode=templates",
                    "icon": "/graphic/help.png",
                    "title": t('settings.mapCtxButtonsTemplatesHelp')
                }
            },
            "reservation": { "label": t('settings.mapCtxButtonsReservationLabel'), "desc": t('settings.mapCtxButtonsReservationDesc'), "type": "checkbox", "default": true },
            "mapGroup": { "label": t('settings.mapCtxButtonsMapGroupLabel'), "desc": t('settings.mapCtxButtonsMapGroupDesc'), "type": "checkbox", "default": true }
        }
    },
    {
        "name": "show__map_hover_info",
        "label": t('settings.villageHoverInfoLabel'),
        "description": t('settings.villageHoverInfoDesc'),
        "group": t('settings.groupMap'),
        "extraSettings": {
            "morale": { "label": t('settings.villageHoverInfoMoraleLabel'), "desc": t('settings.villageHoverInfoMoraleDesc'), "type": "checkbox", "default": true },
            "lastAttack": { "label": t('settings.villageHoverInfoLastAttackLabel'), "desc": t('settings.villageHoverInfoLastAttackDesc'), "type": "checkbox", "default": true },
            "troopDistance": { "label": t('settings.villageHoverInfoTroopDistanceLabel'), "desc": t('settings.villageHoverInfoTroopDistanceDesc'), "type": "checkbox", "default": true }
        }
    },
    { "name": "show__outgoingInfo_map", "label": t('settings.mapCommandOverlayLabel'), "description": t('settings.mapCommandOverlayDesc'), "group": t('settings.groupMap') },
    {
        "name": "show__heatmap_reports",
        "label": t('settings.heatmapReportsLabel'),
        "description": t('settings.heatmapReportsDesc'),
        "group": t('settings.groupMap'),
        "extraSettings": {
            "mode": {
                "label": t('settings.heatmapModeLabel'),
                "desc": t('settings.heatmapModeDesc'),
                "type": "select",
                "default": "resources",
                "options": [
                    { "value": "resources", "label": t('settings.heatmapModeResources') },
                    { "value": "time", "label": t('settings.heatmapModeTime') }
                ]
            }
        }
    },
    // UI / Premium Features
    { "name": "show__navigation_arrows", "label": t('settings.navigationArrowsLabel'), "description": t('settings.navigationArrowsDesc'), "group": t('settings.groupUiUx') },
    {
        "name": "show__widget_popup_shortcuts",
        "label": t('settings.widgetPopupShortcutsLabel'),
        "description": t('settings.widgetPopupShortcutsDesc'),
        "group": t('settings.groupUiUx'),
        "extraSettings": {
            "training": { "label": t('settings.widgetPopupShortcutsTrainingLabel'), "desc": t('settings.widgetPopupShortcutsTrainingDesc'), "type": "checkbox", "default": true },
            "queue": { "label": t('settings.widgetPopupShortcutsQueueLabel'), "desc": t('settings.widgetPopupShortcutsQueueDesc'), "type": "checkbox", "default": true },
            "coinMinting": { "label": t('settings.widgetPopupShortcutsCoinMintingLabel'), "desc": t('settings.widgetPopupShortcutsCoinMintingDesc'), "type": "checkbox", "default": false, "disabled": true } //only widget for now
        }
    },
    { "name": "show__overview_premium_info", "label": t('settings.extraOverviewInfoLabel'), "description": t('settings.extraOverviewInfoDesc'), "group": t('settings.groupUiUx') },
    { "name": "show__player_profile_stats", "label": t('settings.playerProfileStatsLabel'), "description": t('settings.playerProfileStatsDesc'), "group": t('settings.groupUiUx') },
    { "name": "show__navigation_bar", "label": t('settings.navigationBarLabel'), "description": t('settings.navigationBarDesc'), "group": t('settings.groupUiUx') },
    // dark mode started but not finished, so disabled for now until it is fully implemented
    { "name": "show__soft_dark_mode", "label": t('settings.softDarkModeLabel'), "description": t('settings.softDarkModeDesc'), "group": t('settings.groupUiUx'), disabled: true},

    // Automation
    { "name": "show__building_queue_all", "label": t('settings.buildingQueueAllLabel'), "description": t('settings.buildingQueueAllDesc'), "group": t('settings.groupAutomation') },
    { "name": "show__auto_daily_bonus", "label": t('settings.autoDailyBonusLabel'), "description": t('settings.autoDailyBonusDesc'), "group": t('settings.groupAutomation') },
    { "name": "show__auto_build_instant_free", "label": t('settings.autoBuildInstantFreeLabel'), "description": t('settings.autoBuildInstantFreeDesc'), "group": t('settings.groupAutomation') },
    {
        "name": "show__auto_paladin_train", "label": t('settings.autoPaladinTrainLabel'), "description": t('settings.autoPaladinTrainDesc'), "group": t('settings.groupAutomation'),
        "extraSettings": {
            "maxLevel": { "label": t('settings.autoPaladinTrainLevelLabel'), "type": "number", "default": 30 },
        }
    },

    // Anti-Bot Protection settings
    { "name": "antiBot__disableOnDetection", "label": t('settings.antibotDisableOnDetectionLabel'), "description": t('settings.antibotDisableOnDetectionDesc'), "group": t('settings.groupAntiBot') },

    // General / Utility
    { "name": "keep_awake", "label": t('settings.keepAwakeLabel'), "description": t('settings.keepAwakeDesc'), "group": t('settings.groupGeneral') },
    { "name": "redirect__train_buildings", "label": t('settings.redirectTrainBuildingsLabel'), "description": t('settings.redirectTrainBuildingsDesc'), "group": t('settings.groupGeneral') },
    { "name": "remove__premium_promo", "label": t('settings.hidePremiumAdsLabel'), "description": t('settings.hidePremiumAdsDesc'), "group": t('settings.groupGeneral') }, {
        "name": "language", "label": t('settings.language'), "description": t('settings.languageDesc'), "type": "select", "group": t('settings.groupGeneral'),
        "options": [
            { "value": "en", "label": "English" },
            { "value": "pt", "label": "Portugu\u00eas" }
        ]
    },
];

/**
 * Fixed tab display order; each setting declares its own group via availableSettings[].group.
 */
var SETTINGS_GROUPS_ORDER = [
    t('settings.groupWidgets'),
    t('settings.groupOverviewVillages'),
    t('settings.groupMap'),
    t('settings.groupUiUx'),
    t('settings.groupAutomation'),
    t('settings.groupAntiBot'),
    t('settings.groupGeneral')
];


/**
 * Serialises the current settings_cookies object to JSON and triggers a browser download.
 */
function exportSettings() {
    const data = JSON.stringify(settings_cookies, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tw_script_settings.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Opens a file picker for a JSON file, validates its structure,
 * writes it to localStorage as settings_cookies, and reloads the page.
 */
function importSettings() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const imported = JSON.parse(event.target.result);
                if (typeof imported !== 'object' || !imported.general || !imported.widgets) {
                    throw new Error('Invalid structure');
                }
                safeLocalStorageSet('settings_cookies', JSON.stringify(imported));
                location.reload();
            } catch (_e) {
                alert(t('settings.invalidFile'));
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

/**
 * Reads all checkbox and number inputs from the settings popup and writes their
 * values back into settings_cookies, then persists to localStorage and reloads.
 * Handles three storage shapes:
 *   - Three-part name (e.g. show__auto_paladin_train__maxLevel) → nested object key
 *   - Two-part name with extraSettings                          → stored as { enabled: value }
 *   - Two-part name with extraSettings type=select              → stored as { enabled: value, source: value }
 *   - Simple name                                               → stored as boolean/number
 */
function saveScriptSettings() {
    var allSettings = document.querySelectorAll('input[type="checkbox"], input[type="number"], select');

    for (var i = 0; i < allSettings.length; i++) {
        var settingName = allSettings[i].name;
        var settingValue;
            if (allSettings[i].tagName === 'SELECT') {
            settingValue = allSettings[i].value;
        } else {
            settingValue = allSettings[i].type === "checkbox" ? allSettings[i].checked : parseInt(allSettings[i].value, 10);
        }

        var parts = settingName.split("__");

        // Check if the setting has extra sub-settings
        var settingConfig = availableSettings.find(s => s.name === parts[0] + (parts[1] ? "__" + parts[1] : ""));
        var hasExtraSettings = settingConfig && settingConfig.extraSettings;

        if (parts.length === 3) {
            // Three-part key: e.g. show__auto_paladin_train__maxLevel
            var parentKey = parts.slice(0, -1).join("__");
            var childKey = parts[2];

            if (!settings_cookies.general[parentKey] || typeof settings_cookies.general[parentKey] !== "object") {
                settings_cookies.general[parentKey] = {};
            }

            settings_cookies.general[parentKey][childKey] = settingValue;

        } else if (hasExtraSettings) {
            // Two-part key with extra settings: save the top-level checkbox as "enabled"
            if (!settings_cookies.general[settingName] || typeof settings_cookies.general[settingName] !== "object") {
                settings_cookies.general[settingName] = {};
            }
            settings_cookies.general[settingName]["enabled"] = settingValue;
        } else {
            // Simple boolean/number setting: e.g. "show__overview_premium_info"
            settings_cookies.general[settingName] = settingValue;
        }
    }

    // Remove any empty or undefined keys that may have been created in error
    Object.keys(settings_cookies.general).forEach(key => {
        if (key === "" || settings_cookies.general[key] === undefined) {
            delete settings_cookies.general[key];
        }
    });

    // Persist the full settings object to localStorage, then reload
    safeLocalStorageSet('settings_cookies', JSON.stringify(settings_cookies));
    location.reload();
}

/**
 * Injects the script settings button into the UI.
 * Priority: QuestLog > MainCell Absolute Position.
 * @param {HTMLElement} maincell - The game's main content container.
 */
function injectScriptSettingsButtom(maincell) {
    if (!window.SidebarIcons) return;

    SidebarIcons.register('settings', {
        wrapperId: 'settings_popup_button',
        wrapperClass: 'script-settings-btn',
        iconClass: 'quest script-settings-icon sidebar-icon-offset',
        title: t('settings.title'),
        onClick: () => {
            const popup = document.getElementById('settings_popup');
            refreshHardStopRecoveryControl();
            if (typeof togglePopup === 'function') {
                togglePopup(popup);
            }
        }
    });

}

/**
 * Injects the settings popup by assembling components from helper functions.
 */
function injectScriptSettingsPopUp() {
    document.getElementById('settings_popup_button')?.remove();
    document.getElementById('settings_popup')?.remove();
    document.querySelector('.script-settings-popup-wrapper')?.remove();

    // 1. Initialize the entry button
    const maincell = document.getElementsByClassName('maincell')[0];
    if (maincell) {
        injectScriptSettingsButtom(maincell);
    }
    // 2. Create UI components
    const wrapper = document.createElement('div');
    const container = createPopupContainer();
    const header = createPopupHeader(container);
    const tabNavigation = createTabNavigation();

    // Deconstruct tab data
    const { tabContents } = createTabs(tabNavigation);
    const saveButton = createSaveButton();

    // 3. Assemble the hierarchy
    // Sidebar tabs + content panels sit side by side below the header
    const body = document.createElement('div');
    body.classList.add('script-settings-body');
    body.appendChild(tabNavigation);
    tabContents.forEach(content => body.appendChild(content));

    container.append(header, body);
    container.appendChild(saveButton);

    // 4. Final injection into the DOM
    wrapper.classList.add('script-settings-popup-wrapper');
    wrapper.appendChild(container);
    document.body.appendChild(wrapper);

    // Close on ESC key
    $(document).off('keydown.script_settings_popup').on('keydown.script_settings_popup', function (e) {
        if (e.key !== 'Escape') return;
        const p = document.getElementById('settings_popup');
        if (p && p.style.display !== 'none') p.style.display = 'none';
    });

    // Close on click outside the settings popup
    $(document).off('mousedown.script_settings_popup').on('mousedown.script_settings_popup', function (e) {
        const p = document.getElementById('settings_popup');
        if (!p || p.style.display === 'none') return;
        if (e.target.closest('.custom-quicklink-editor-backdrop, .nav-icon-picker-popup')) return;
        if (!p.contains(e.target) && !e.target.closest('#settings_popup_button')) p.style.display = 'none';
    });
}

/**
 * Creates the main container for the settings popup.
 * Appearance and positioning are handled via CSS classes.
 */
function createPopupContainer() {
    const popup = document.createElement('div');

    // TribalWars native classes + our custom class
    popup.classList.add('popup_style', 'borderimage', 'popup_box', 'script-settings-popup');

    popup.id = 'settings_popup';

    return popup;
}

/**
 * Creates the header for the settings popup with a title and close button.
 * @param {HTMLElement} popup - The parent popup element to toggle.
 */
function createPopupHeader(popup) {
    const header = document.createElement('div');
    header.classList.add('script-popup-header');
    header.textContent = t('settings.title');

    const closeLink = document.createElement('a');
    closeLink.classList.add('script-popup-close');
    closeLink.textContent = t('button.close');

    // Toggle logic: Switches between 'none' and 'block'
    closeLink.onclick = (e) => {
        e.preventDefault();
        const isHidden = popup.style.display === 'none';
        popup.style.display = isHidden ? 'block' : 'none';
    };

    header.appendChild(closeLink);
    return header;
}

/**
 * Creates the left sidebar tab navigation container.
 * Tabs are appended to this element by createTabs().
 */
function createTabNavigation() {
    var tabNav = document.createElement('div');
    tabNav.id = 'tabNav';
    tabNav.classList.add('script-tab-sidebar');
    return tabNav;
}

/**
 * Creates all tab buttons and their corresponding content areas from the settings groups,
 * appends the buttons to tabNav, and returns both arrays for cross-reference.
 * @param {HTMLElement} tabNav - The navigation container to append tab buttons to.
 * @returns {{ tabButtons: HTMLElement[], tabContents: HTMLElement[] }}
 */
function createTabs(tabNav) {
    var tabButtons = [];
    var tabContents = [];

    var settingsGroups = getSettingsGroups();

    Object.keys(settingsGroups).forEach((groupName, index) => {
        var tabButton = createTabButton(groupName, index, tabButtons, tabContents);
        var tabContent = createTabContent(groupName, index);

        tabButtons.push(tabButton);
        tabContents.push(tabContent);

        tabNav.appendChild(tabButton);
    });

    return { tabButtons, tabContents };
}

/**
 * Creates an individual tab button.
 * @param {string} groupName - The label for the tab.
 * @param {number} index - The index of the tab (0 for default active).
 * @param {Array} tabButtons - Array of all buttons for state management.
 * @param {Array} tabContents - Array of all content divs for state management.
 */
function createTabButton(groupName, index, tabButtons, tabContents) {
    const tabButton = document.createElement('button');
    const safeId = groupName.replace(/\s/g, "_");

    tabButton.textContent = groupName;
    tabButton.id = `tabButton_${safeId}`;
    tabButton.classList.add('script-tab-btn');

    // Set initial state
    if (index === 0) {
        tabButton.classList.add('active');
    }

    tabButton.onclick = () => {
        // 1. Reset all buttons and contents
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));

        // 2. Set current button to active
        tabButton.classList.add('active');

        // 3. Find and show corresponding content
        const activeContent = document.getElementById(`tabContent_${safeId}`);
        if (activeContent) {
            activeContent.classList.add('active');
        }
    };

    return tabButton;
}

/**
 * Creates the content area for a specific tab, including setting rows.
 */
function createTabContent(groupName, index) {
    const safeId = groupName.replace(/\s/g, "_");
    const tabContent = document.createElement('div');
    tabContent.id = `tabContent_${safeId}`;
    tabContent.classList.add('script-tab-content');

    // Initial visibility state based on index
    if (index === 0) tabContent.classList.add('active');

    const table = document.createElement('table');
    table.classList.add('vis', 'settings-table');

    const settingsGroups = getSettingsGroups();
    const currentGroup = settingsGroups[groupName] || [];

    // Filter and build rows
    availableSettings.forEach(setting => {
        if (!currentGroup.includes(setting.name)) return;

        // 1. Create Main Setting Row
        const row = table.insertRow();
        const cellLabel = row.insertCell(0);
        const cellInput = row.insertCell(1);

        if (setting.disabled) row.classList.add('setting-disabled');

        cellLabel.classList.add('settings-label-cell');
        cellLabel.textContent = setting.label;

        // Select-type setting (e.g. language): plain dropdown, no checkbox/extraSettings
        if (setting.type === 'select') {
            const select = document.createElement('select');
            select.name = setting.name;
            select.disabled = !!setting.disabled;
            (setting.options || []).forEach(opt => {
                const optionEl = document.createElement('option');
                optionEl.value = opt.value;
                optionEl.textContent = opt.label;
                if (settings_cookies.general[setting.name] === opt.value) optionEl.selected = true;
                select.appendChild(optionEl);
            });

            const description = document.createElement('small');
            description.style.cssText = 'display:block;color:#555;margin-top:2px;';
            description.textContent = setting.description;

            cellInput.append(select, description);
            cellInput.classList.add('settings-input-cell');
            return;
        }

        var parentCheckbox = null;
        var childControls = [];

        if (setting.type === 'section') {
            const description = document.createElement('small');
            description.style.cssText = 'display:block;color:#555;margin-top:2px;';
            description.textContent = setting.description;

            cellInput.appendChild(description);
            cellInput.classList.add('settings-input-cell');
        } else {
            const labelWrapper = document.createElement('label');
            const checkbox = Object.assign(document.createElement('input'), {
                type: 'checkbox',
                name: setting.name,
                disabled: !!setting.disabled,
                checked: typeof settings_cookies.general[setting.name] === 'object'
                    ? settings_cookies.general[setting.name].enabled
                    : !!settings_cookies.general[setting.name]
            });
            parentCheckbox = checkbox;

            labelWrapper.append(checkbox, document.createTextNode(` ${setting.description}`));
            cellInput.appendChild(labelWrapper);
            cellInput.classList.add('settings-input-cell');
        }

        // 2. Handle Extra Settings (Sub-rows)
        if (setting.extraSettings) {
            Object.keys(setting.extraSettings).forEach(extraKey => {
                const extraData = setting.extraSettings[extraKey];
                const extraRow = table.insertRow();
                extraRow.classList.add('extra-setting-row');

                const exCell1 = extraRow.insertCell(0);
                const exCell2 = extraRow.insertCell(1);

                if (extraData.type === 'select') {
                    exCell1.textContent = extraData.label;
                    appendSettingHelpLink(exCell1, extraData.helpLink);
                    if (extraData.desc) {
                        const extraDescription = document.createElement('small');
                        extraDescription.style.cssText = 'display:block;color:#555;margin-top:2px;';
                        extraDescription.textContent = extraData.desc;
                        exCell1.appendChild(extraDescription);
                    }

                    const extraSelect = document.createElement('select');
                    extraSelect.name = `${setting.name}__${extraKey}`;
                    const extraSelectDisabled = !!setting.disabled || !!extraData.disabled;
                    extraSelect.disabled = extraSelectDisabled;
                    childControls.push({ element: extraSelect, disabled: extraSelectDisabled });
                    (extraData.options || []).forEach(opt => {
                        const optionEl = document.createElement('option');
                        optionEl.value = opt.value;
                        optionEl.textContent = opt.label;
                        if ((settings_cookies.general[setting.name]?.[extraKey] ?? extraData.default) === opt.value) optionEl.selected = true;
                        extraSelect.appendChild(optionEl);
                    });
                    exCell2.appendChild(extraSelect);
                    if (extraData.type === 'select' && setting.name === 'show__overview_villages_quicklinks' && extraKey === 'source') {
                        extraSelect.addEventListener('change', function () {
                            const customRow = table.querySelector('.custom-quicklinks-settings-row');
                            if (customRow) customRow.style.display = extraSelect.value === 'custom' ? '' : 'none';
                        });
                    }
                } else if (extraData.type === 'custom_quicklinks') {
                    exCell1.textContent = extraData.label;
                    const quicklinksGrid = renderCustomQuicklinksSettings();
                    exCell2.appendChild(quicklinksGrid);
                    quicklinksGrid.querySelectorAll('button').forEach(function (button) {
                        childControls.push({ element: button, disabled: !!setting.disabled || !!extraData.disabled });
                    });
                    extraRow.classList.add('custom-quicklinks-settings-row');
                    const quicklinksSetting = settings_cookies.general.show__overview_villages_quicklinks;
                    extraRow.style.display = quicklinksSetting?.source === 'custom' ? '' : 'none';
                } else {
                    const extraInput = document.createElement('input');
                    extraInput.type = extraData.type;
                    extraInput.name = `${setting.name}__${extraKey}`;
                    const worldKey = 'world_settings_' + (game_data?.world || window.location.hostname);
                    let worldSettings = null;
                    try { worldSettings = JSON.parse(localStorage.getItem(worldKey) || 'null'); } catch { }
                    const coinMintingUnsupported = setting.name === 'show__widget_popup_shortcuts' &&
                        extraKey === 'coinMinting' && !(worldSettings?.coin_enabled === true &&
                            [worldSettings.coin_wood, worldSettings.coin_stone, worldSettings.coin_iron]
                                .every(value => Number.isFinite(value) && value > 0));
                    const extraInputDisabled = !!setting.disabled || !!extraData.disabled || coinMintingUnsupported;
                    extraInput.disabled = extraInputDisabled;
                    childControls.push({ element: extraInput, disabled: extraInputDisabled });
                    if (extraData.type === 'checkbox') {
                        extraInput.checked = settings_cookies.general[setting.name]?.[extraKey] ?? extraData.default ?? true;
                        exCell1.textContent = extraData.label;
                        const extraLabel = document.createElement('label');
                        extraLabel.append(extraInput, document.createTextNode(extraData.desc || ''));
                        exCell2.appendChild(extraLabel);
                        appendSettingHelpLink(exCell2, extraData.helpLink);
                    } else {
                        extraInput.value = settings_cookies.general[setting.name]?.[extraKey] ?? extraData.default;
                        exCell1.textContent = extraData.label;
                        appendSettingHelpLink(exCell1, extraData.helpLink);
                        if (extraData.desc) {
                            const extraDescription = document.createElement('small');
                            extraDescription.style.cssText = 'display:block;color:#555;margin-top:2px;';
                            extraDescription.textContent = extraData.desc;
                            exCell1.appendChild(extraDescription);
                        }
                        exCell2.appendChild(extraInput);
                    }
                }
            });
        }

        if (parentCheckbox && setting.extraSettings) {
            const updateChildControls = function () {
                childControls.forEach(function (control) {
                    control.element.disabled = control.disabled || !parentCheckbox.checked;
                });
                const customRow = table.querySelector('.custom-quicklinks-settings-row');
                if (customRow && setting.name === 'show__overview_villages_quicklinks') {
                    customRow.style.opacity = parentCheckbox.checked ? '' : '0.55';
                }
            };
            parentCheckbox.addEventListener('change', updateChildControls);
            updateChildControls();
        }
    });

    tabContent.appendChild(table);
    return tabContent;
}

function getCustomQuicklinksItems() {
    const setting = settings_cookies.general.show__overview_villages_quicklinks;
    if (!setting || typeof setting !== 'object' || !Array.isArray(setting.items)) return [];
    return setting.items;
}

function getQuicklinkImageUrl(image) {
    if (!image) return '';
    return image.startsWith('http') ? image : (typeof _getNavAssetBase === 'function' ? _getNavAssetBase() + image : image);
}

function renderCustomQuicklinksSettings() {
    const grid = document.createElement('div');
    grid.className = 'custom-quicklinks-settings-grid';

    getCustomQuicklinksItems().forEach(function (item, index) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'custom-quicklink-settings-item';
        button.title = item.label || t('settings.overviewVillagesQuicklinksEdit');

        if (item.img) {
            const image = document.createElement('img');
            image.src = getQuicklinkImageUrl(item.img);
            image.alt = item.label || '';
            button.appendChild(image);
        } else {
            button.textContent = '+';
        }
        button.addEventListener('click', function () {
            openCustomQuicklinkEditor(index);
        });
        grid.appendChild(button);
    });

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'custom-quicklink-settings-item custom-quicklink-settings-add';
    addButton.textContent = '+';
    addButton.title = t('settings.overviewVillagesQuicklinksAdd');
    addButton.addEventListener('click', function () {
        openCustomQuicklinkEditor(-1);
    });
    grid.appendChild(addButton);
    return grid;
}

function refreshCustomQuicklinksSettings() {
    const row = document.querySelector('.custom-quicklinks-settings-row');
    if (!row) return;
    const cell = row.cells[1];
    if (!cell) return;
    cell.replaceChildren(renderCustomQuicklinksSettings());
}

function openCustomQuicklinkEditor(itemIndex) {
    document.querySelector('.custom-quicklink-editor-backdrop')?.remove();

    const items = getCustomQuicklinksItems();
    const item = itemIndex >= 0 ? items[itemIndex] : { label: '', href: '', img: '' };
    if (!item) return;

    const backdrop = document.createElement('div');
    backdrop.className = 'custom-quicklink-editor-backdrop';
    const closeEditor = function () {
        document.removeEventListener('keydown', closeOnEscape);
        backdrop.remove();
    };
    const closeOnEscape = function (event) {
        if (event.key === 'Escape') closeEditor();
    };
    document.addEventListener('keydown', closeOnEscape);

    const popup = document.createElement('div');
    popup.className = 'popup_style custom-quicklink-editor-popup';
    popup.style.display = 'block';

    const header = document.createElement('div');
    header.className = 'popup_menu';
    header.textContent = itemIndex >= 0
        ? t('settings.overviewVillagesQuicklinksEdit')
        : t('settings.overviewVillagesQuicklinksAdd');

    const close = document.createElement('a');
    close.href = '#';
    close.textContent = t('button.close');
    close.className = 'custom-quicklink-editor-close';
    close.addEventListener('click', function (event) {
        event.preventDefault();
        closeEditor();
    });
    header.appendChild(close);

    const content = document.createElement('div');
    content.className = 'popup_content custom-quicklink-editor-content';
    const form = document.createElement('form');

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.value = item.label || '';
    labelInput.placeholder = t('settings.overviewVillagesQuicklinksTitlePlaceholder');

    const hrefInput = document.createElement('input');
    hrefInput.type = 'text';
    hrefInput.value = item.href || '';
    hrefInput.placeholder = t('settings.overviewVillagesQuicklinksUrlPlaceholder');

    const imgInput = document.createElement('input');
    imgInput.type = 'text';
    imgInput.value = item.img || '';
    imgInput.placeholder = t('settings.overviewVillagesQuicklinksIconPlaceholder');

    const imgPreview = document.createElement('img');
    imgPreview.className = 'custom-quicklink-editor-preview';
    const updatePreview = function () {
        imgPreview.src = getQuicklinkImageUrl(imgInput.value.trim());
        imgPreview.style.display = imgInput.value.trim() ? '' : 'none';
    };
    updatePreview();
    imgInput.addEventListener('input', updatePreview);

    function appendField(label, input) {
        const field = document.createElement('label');
        field.className = 'custom-quicklink-editor-field';
        field.append(document.createTextNode(label), input);
        form.appendChild(field);
    }
    appendField(t('settings.overviewVillagesQuicklinksTitleLabel'), labelInput);
    appendField(t('settings.overviewVillagesQuicklinksUrlLabel'), hrefInput);

    const iconField = document.createElement('label');
    iconField.className = 'custom-quicklink-editor-field';
    iconField.append(document.createTextNode(t('settings.overviewVillagesQuicklinksIconLabel')));
    const iconControls = document.createElement('span');
    iconControls.className = 'custom-quicklink-editor-icon-controls';
    iconControls.append(imgPreview, imgInput);
    const pickerButton = document.createElement('img');
    pickerButton.src = getQuicklinkImageUrl('icons/slide_down.png');
    pickerButton.alt = t('nav.selectIcon');
    pickerButton.title = t('nav.selectIcon');
    pickerButton.className = 'custom-quicklink-editor-picker';
    pickerButton.addEventListener('click', function () {
        if (typeof _openNavIconPicker !== 'function') return;
        _openNavIconPicker(imgInput, pickerButton, updatePreview);
        const picker = document.querySelector('.nav-icon-picker-popup');
        if (picker) picker.style.zIndex = '100001';
    });
    iconControls.appendChild(pickerButton);
    iconField.appendChild(iconControls);
    form.appendChild(iconField);

    const actions = document.createElement('div');
    actions.className = 'custom-quicklink-editor-actions';
    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.className = 'btn btn-confirm';
    saveButton.textContent = t('button.saveChanges');
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn';
    cancelButton.textContent = t('button.cancel');
    cancelButton.addEventListener('click', closeEditor);
    actions.append(saveButton, cancelButton);

    if (itemIndex >= 0) {
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'btn custom-quicklink-editor-delete';
        deleteButton.textContent = t('button.remove');
        deleteButton.addEventListener('click', function () {
            items.splice(itemIndex, 1);
            refreshCustomQuicklinksSettings();
            closeEditor();
        });
        actions.appendChild(deleteButton);
    }

    form.addEventListener('submit', function (event) {
        event.preventDefault();
        const label = labelInput.value.trim();
        const href = hrefInput.value.trim();
        if (!label || !href) return;
        const newItem = { label, href, img: imgInput.value.trim() };
        if (itemIndex >= 0) items[itemIndex] = newItem;
        else items.push(newItem);
        refreshCustomQuicklinksSettings();
        closeEditor();
    });

    form.appendChild(actions);
    content.appendChild(form);
    popup.append(header, content);
    backdrop.appendChild(popup);
    document.body.appendChild(backdrop);
    backdrop.addEventListener('mousedown', function (event) {
        if (event.target === backdrop) closeEditor();
    });
}

function appendSettingHelpLink(labelCell, helpLink) {
    if (!helpLink || !helpLink.href) return;

    const link = document.createElement('a');
    link.className = 'twpf-settings-help-link';
    link.href = helpLink.href.charAt(0) === '/'
        ? helpLink.href
        : game_data.link_base_pure + helpLink.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    if (helpLink.icon) {
        const icon = document.createElement('img');
        icon.src = helpLink.icon;
        icon.alt = '';
        link.appendChild(icon);
    }
    link.title = helpLink.title || '';
    link.setAttribute('aria-label', helpLink.title || 'Help');
    labelCell.appendChild(link);
}

/**
 * Creates the Save button container and the submit input.
 * Styling is managed via the #saveButtonDiv and .btn-save-settings classes.
 */
function createSaveButton() {
    const saveButtonDiv = document.createElement('div');
    saveButtonDiv.id = 'saveButtonDiv';

    const saveButton = Object.assign(document.createElement('input'), {
        type: 'submit',
        value: t('button.saveChanges'),
        className: 'btn btn-save-settings'
    });
    saveButton.onclick = (e) => {
        e.preventDefault();
        if (typeof saveScriptSettings === 'function') {
            saveScriptSettings();
        }
    };

    const exportButton = Object.assign(document.createElement('input'), {
        type: 'button',
        value: t('button.export'),
        className: 'btn'
    });
    exportButton.onclick = () => exportSettings();

    const importButton = Object.assign(document.createElement('input'), {
        type: 'button',
        value: t('button.import'),
        className: 'btn'
    });
    importButton.onclick = () => importSettings();

    saveButtonDiv.append(saveButton, exportButton, importButton);
    const recovery = document.createElement('div');
    recovery.id = 'twpf_hard_stop_recovery';
    recovery.style.display = 'none';
    const status = document.createElement('span');
    status.id = 'twpf_hard_stop_status';
    const resume = Object.assign(document.createElement('input'), {
        type: 'button',
        value: t('settings.resumeAutomations'),
        className: 'btn'
    });
    resume.id = 'twpf_hard_stop_resume';
    resume.onclick = function () {
        window.PremiumFeaturesBotProtection?.resumeAfterHardStop?.();
        refreshHardStopRecoveryControl();
    };
    recovery.append(status, resume);
    saveButtonDiv.appendChild(recovery);
    refreshHardStopRecoveryControl(recovery);
    return saveButtonDiv;
}

function refreshHardStopRecoveryControl(element) {
    const recovery = element || document.getElementById('twpf_hard_stop_recovery');
    if (!recovery) return;
    const hardStopped = !!window.PremiumFeaturesBackgroundScheduler?.stats?.().hardStopped;
    recovery.style.display = hardStopped ? '' : 'none';
    if (!hardStopped) return;
    const canResume = !!window.PremiumFeaturesBotProtection?.canResumeAfterHardStop?.();
    const status = recovery.querySelector?.('#twpf_hard_stop_status') || document.getElementById('twpf_hard_stop_status');
    const button = recovery.querySelector?.('#twpf_hard_stop_resume') || document.getElementById('twpf_hard_stop_resume');
    if (status) status.textContent = t('settings.hardStopStatus');
    if (button) button.style.display = canResume ? '' : 'none';
}

window.refreshHardStopRecoveryControl = refreshHardStopRecoveryControl;

/**
 * Groups setting names into categories for tabbed navigation, derived from
 * each setting's own `group` field so membership only needs to be declared once.
 * Each key represents a tab name in the settings popup.
 */
function getSettingsGroups() {
    var groups = {};
    SETTINGS_GROUPS_ORDER.forEach(groupName => groups[groupName] = []);

    availableSettings.forEach(setting => {
        if (!groups[setting.group]) groups[setting.group] = [];
        groups[setting.group].push(setting.name);
    });

    return groups;
}
