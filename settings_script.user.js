

// Settings PopUp
function saveScriptSettings() {
    var allSettings = document.querySelectorAll('input[type="checkbox"], input[type="number"]');

    for (var i = 0; i < allSettings.length; i++) {
        var settingName = allSettings[i].name;
        var settingValue = allSettings[i].type === "checkbox" ? allSettings[i].checked : parseInt(allSettings[i].value, 10);

        var parts = settingName.split("__");

        // Verifica se a configuração tem extraSettings
        var settingConfig = availableSettings.find(s => s.name === parts[0] + (parts[1] ? "__" + parts[1] : ""));
        var hasExtraSettings = settingConfig && settingConfig.extraSettings;

        if (parts.length === 3) {
            // Exemplo: show__auto_paladin_train__level
            var parentKey = parts.slice(0, -1).join("__");
            var childKey = parts[2];

            if (!settings_cookies.general[parentKey] || typeof settings_cookies.general[parentKey] !== "object") {
                settings_cookies.general[parentKey] = {};
            }

            settings_cookies.general[parentKey][childKey] = settingValue;

        } else if (hasExtraSettings) {
            // Se tiver extraSettings, salva como "enabled"
            if (!settings_cookies.general[settingName] || typeof settings_cookies.general[settingName] !== "object") {
                settings_cookies.general[settingName] = {};
            }
            settings_cookies.general[settingName]["enabled"] = settingValue;
        } else {
            // Configurações simples (exemplo: "show__overview_premmium_info")
            settings_cookies.general[settingName] = settingValue;
        }
    }

    // Remove chaves vazias (caso algo tenha sido criado errado)
    Object.keys(settings_cookies.general).forEach(key => {
        if (key === "" || settings_cookies.general[key] === undefined) {
            delete settings_cookies.general[key];
        }
    });

    // Salva no localStorage mantendo toda a estrutura original
    localStorage.setItem('settings_cookies', JSON.stringify(settings_cookies));
    location.reload();
}

/**
 * Injects the script settings button into the UI.
 * Priority: QuestLog > MainCell Absolute Position.
 * @param {HTMLElement} maincell - The game's main content container.
 */
function injectScriptSettingsButtom(maincell) {
    const questLog = document.querySelector('.questlog');

    // Create the button container
    const btn = document.createElement('div');
    btn.id = 'settings_popup_button';
    btn.classList.add('script-settings-btn');

    // Create the icon (using game class 'quest' + our custom class)
    const icon = document.createElement('div');
    icon.className = 'quest script-settings-icon';
    btn.appendChild(icon);

    // Single click handler
    btn.onclick = () => {
        const popup = document.getElementById('settings_popup');
        if (typeof togglePopup === 'function') {
            togglePopup(popup);
        }
    };

    if (questLog) {
        // Option A: Inside the quest log (standard layout)
        questLog.appendChild(btn);
    } else if (maincell?.children[0]) {
        // Option B: Absolute positioning (fallback layout)
        btn.classList.add('script-settings-btn-fixed');
        maincell.children[0].appendChild(btn);
    }
}

/**
 * Injects the settings popup by assembling components from helper functions.
 */
function injectScriptSettingsPopUp() {
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
    // Append header and navigation first
    container.append(header, tabNavigation);

    // Append all content areas
    tabContents.forEach(content => container.appendChild(content));

    // Append the final save button
    container.appendChild(saveButton);

    // 4. Final injection into the DOM
    wrapper.appendChild(container);
    document.body.appendChild(wrapper);
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
    header.textContent = 'Script Settings';

    const closeLink = document.createElement('a');
    closeLink.classList.add('script-popup-close');
    closeLink.textContent = 'X';

    // Toggle logic: Switches between 'none' and 'block'
    closeLink.onclick = (e) => {
        e.preventDefault();
        const isHidden = popup.style.display === 'none';
        popup.style.display = isHidden ? 'block' : 'none';
    };

    header.appendChild(closeLink);
    return header;
}

function createTabNavigation() {
    var tabNav = document.createElement('div');
    tabNav.id = 'tabNav';
    Object.assign(tabNav.style, {
        display: 'flex',
        justifyContent: 'space-around'
    });
    return tabNav;
}

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

        cellLabel.classList.add('settings-label-cell');
        cellLabel.textContent = setting.label;

        const labelWrapper = document.createElement('label');
        const checkbox = Object.assign(document.createElement('input'), {
            type: 'checkbox',
            name: setting.name,
            checked: typeof settings_cookies.general[setting.name] === 'object'
                ? settings_cookies.general[setting.name].enabled
                : !!settings_cookies.general[setting.name]
        });

        labelWrapper.append(checkbox, document.createTextNode(` ${setting.description}`));
        cellInput.appendChild(labelWrapper);
        cellInput.classList.add('settings-input-cell');

        // 2. Handle Extra Settings (Sub-rows)
        if (setting.extraSettings) {
            Object.keys(setting.extraSettings).forEach(extraKey => {
                const extraData = setting.extraSettings[extraKey];
                const extraRow = table.insertRow();
                extraRow.classList.add('extra-setting-row');

                const exCell1 = extraRow.insertCell(0);
                const exCell2 = extraRow.insertCell(1);

                exCell1.textContent = extraData.label;

                const extraInput = Object.assign(document.createElement('input'), {
                    type: extraData.type,
                    name: `${setting.name}__${extraKey}`,
                    value: settings_cookies.general[setting.name]?.[extraKey] ?? extraData.default
                });

                exCell2.appendChild(extraInput);
            });
        }
    });

    tabContent.appendChild(table);
    return tabContent;
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
        value: 'Save Changes',
        className: 'btn btn-save-settings' // Combine native and custom classes
    });

    // Handle saving logic
    saveButton.onclick = (e) => {
        e.preventDefault(); // Prevent accidental form submission/page reload
        if (typeof saveScriptSettings === 'function') {
            saveScriptSettings();
        }
    };

    saveButtonDiv.appendChild(saveButton);
    return saveButtonDiv;
}

var availableSettings = [
    // General / Utility
    { "name": "keep_awake", "label": "Keep Awake", "description": "Automatically refreshes the page after 5 minutes of inactivity to prevent timeout." },
    { "name": "redirect__train_buildings", "label": "Smart Training Redirect", "description": "Directly opens the recruitment screen when clicking on training-related buildings." },
    { "name": "show__navigation_arrows", "label": "Village Navigation Arrows", "description": "Adds arrows to the UI for faster switching between your villages." },

    // Overview Widgets
    { "name": "show__village_list", "label": "Village List Widget", "description": "Displays a quick-access list of your villages on the overview screen." },
    { "name": "show__recruit_troops", "label": "Recruitment Widget", "description": "Enables a troop recruitment panel on the overview page (Experimental)." },
    { "name": "show__notepad", "label": "Village Notepad", "description": "Adds a village-specific notepad for personalized notes and reminders." },
    { "name": "show__building_queue", "label": "Construction Manager", "description": "Manage your building queue and upgrades directly from the overview screen." },
    { "name": "show__building_queue_all", "label": "Enhanced Queue Info", "description": "Shows all potential upgrades, including those limited by resources. Supports local fake queues." },

    // Map Enhancements
    { "name": "show__extra_options_map_hover", "label": "Advanced Map Hover", "description": "Reveals detailed village information when hovering over the map." },
    { "name": "show__outgoingInfo_map", "label": "Map Command Overlay", "description": "Displays outgoing command icons directly on the map." },

    // UI / Premium Features
    { "name": "show__overview_premmium_info", "label": "Visual Building Overview", "description": "Provides a graphical overview of building levels, similar to Premium Account features." },
    { "name": "show__navigation_bar", "label": "Custom Navigation Bar", "description": "Adds a specialized navigation bar at the top of the screen for easier access." },
    { "name": "show__time_storage_full_hover", "label": "Storage Timer", "description": "Shows the exact time remaining until your storage is full when hovering over resources." },

    // Automation
    { "name": "show__auto_scavenging", "label": "Auto-Scavenger", "description": "Automatically manages and sends scavenging runs. (Requires active browser tab)." },
    {
        "name": "show__auto_paladin_train", "label": "Auto-Paladin Trainer", "description": "Automatically manages paladin training tasks. (Requires active browser tab).",
        "extraSettings": {
            "maxLevel": { "label": "Train until level:", "type": "number", "default": 30 },
        }
    },

    // Cleanup
    { "name": "remove__premium_promo", "label": "Hide Premium Ads", "description": "Removes all premium promotional banners and intrusive advertisements from the interface." }
];

/**
 * Groups setting names into categories for tabbed navigation.
 * Each key represents a tab name in the settings popup.
 */
function getSettingsGroups() {
    return {
        "Widgets": [
            "show__village_list",
            "show__recruit_troops",
            "show__notepad",
            "show__building_queue",
            "show__building_queue_all"
        ],
        "Map": [
            "show__extra_options_map_hover",
            "show__outgoingInfo_map"
        ],
        "UI & UX": [
            "show__navigation_arrows",
            "show__time_storage_full_hover",
            "show__overview_premmium_info",
            "show__navigation_bar"
        ],
        "Automation": [
            "show__auto_scavenging",
            "show__auto_paladin_train"
        ],
        "General": [
            "keep_awake",
            "redirect__train_buildings",
            "remove__premium_promo"
        ]
    };
}

