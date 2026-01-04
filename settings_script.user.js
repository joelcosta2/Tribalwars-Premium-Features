

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

function injectScriptSettingsButtom(maincell) {
    var questLogElem = document.getElementsByClassName('questlog');

    if (questLogElem) {
        var settingsPopupButton = document.createElement('div');
        settingsPopupButton.id = 'settings_popup_button';
        settingsPopupButton.onclick = function () {
            togglePopup(document.getElementById('settings_popup'));
        };

        var questIcon = document.createElement('div');
        questIcon.className = 'quest';
        questIcon.style.backgroundImage = 'url(https://dspt.innogamescdn.com/asset/b56f49d7/graphic/icons/settings.png)';

        questIcon.addEventListener('mouseover', () => questIcon.style.opacity = '0.7');
        questIcon.addEventListener('mouseleave', () => questIcon.style.opacity = '1');

        settingsPopupButton.appendChild(questIcon);
        questLogElem[0]?.appendChild(settingsPopupButton);
    } else {
        var settingsPopupButton = document.createElement('div');
        settingsPopupButton.id = 'settings_popup_button';
        settingsPopupButton.style.position = 'absolute';
        settingsPopupButton.style.top = '5px';
        settingsPopupButton.style.left = '-65px';
        settingsPopupButton.style.top = '39px';
        settingsPopupButton.onclick = function () {
            togglePopup(document.getElementById('settings_popup'));
        };

        var questIcon = document.createElement('div');
        questIcon.className = 'quest';
        questIcon.style.backgroundImage = 'url(https://dspt.innogamescdn.com/asset/b56f49d7/graphic/icons/settings.png)';

        settingsPopupButton.appendChild(questIcon);
        maincell.children[0].appendChild(settingsPopupButton);
    }
}

function injectScriptSettingsPopUp() {
    var maincell = document.getElementsByClassName('maincell')[0];
    injectScriptSettingsButtom(maincell);

    var popupHelperDiv = document.createElement('div');
    var popupStyleDiv = createPopupContainer();
    var popupMenuDiv = createPopupHeader(popupStyleDiv);
    var tabNavDiv = createTabNavigation();

    var { tabButtons, tabContents } = createTabs(tabNavDiv);
    var saveButtonDiv = createSaveButton();

    popupStyleDiv.appendChild(popupMenuDiv);
    popupStyleDiv.appendChild(tabNavDiv);
    tabContents.forEach(content => popupStyleDiv.appendChild(content));
    popupStyleDiv.appendChild(saveButtonDiv);

    popupHelperDiv.appendChild(popupStyleDiv);
    document.body.appendChild(popupHelperDiv);
}

function createPopupContainer() {
    var popup = document.createElement('div');
    popup.classList.add('popup_style', 'borderimage', 'popup_box');
    popup.id = 'settings_popup';
    Object.assign(popup.style, {
        width: '700px',
        font: 'inherit',
        opacity: '1',
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -70%)',
        display: 'none',
        padding: '10px',
        overflow: 'hidden'
    });
    return popup;
}

function createPopupHeader(popup) {
    var header = document.createElement('div');
    Object.assign(header.style, {
        fontSize: "17px",
        fontWeight: "bold",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        paddingBottom: "5px"
    });
    header.textContent = 'Script Settings';

    var closeLink = document.createElement('a');
    closeLink.onclick = function () {
        popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
    };
    Object.assign(closeLink.style, {
        cursor: 'pointer',
        fontSize: "18px",
        fontWeight: "bold"
    });
    closeLink.textContent = 'X';

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

function createTabButton(groupName, index, tabButtons, tabContents) {
    var tabButton = document.createElement('button');
    tabButton.textContent = groupName;
    tabButton.id = `tabButton_${groupName.replace(/\s/g, "_")}`;

    Object.assign(tabButton.style, {
        padding: '0',
        border: 'none',
        cursor: 'pointer',
        padding: '4px',
        background: index === 0 ? '#c1a264' : '#f4e4bc',
        border: index === 0 ? '1px solid #7d510f' : 'none',
        flex: '1'
    });

    tabButton.onclick = function () {
        tabButtons.forEach(btn => {
            btn.style.background = '#f4e4bc';
            btn.style.border = 'none';
        });

        tabContents.forEach(content => {
            content.style.display = 'none';
        });

        tabButton.style.background = '#c1a264';
        tabButton.style.border = '1px solid #7d510f';

        let activeContent = document.getElementById(`tabContent_${groupName.replace(/\s/g, "_")}`);
        if (activeContent) {
            activeContent.style.display = 'block';
        }
    };

    return tabButton;
}

function createTabContent(groupName, index) {
    var tabContent = document.createElement('div');
    tabContent.id = `tabContent_${groupName.replace(/\s/g, "_")}`;
    tabContent.style.display = index === 0 ? 'block' : 'none';

    var tableElement = document.createElement('table');
    tableElement.classList.add('vis');
    tableElement.style.width = '100%';

    var settingsGroups = getSettingsGroups();

    availableSettings.forEach(function (setting) {
        if (settingsGroups[groupName].includes(setting.name)) {
            var row = tableElement.insertRow();
            var cell1 = row.insertCell(0);
            var cell2 = row.insertCell(1);

            cell1.textContent = setting.label;
            cell1.style.fontWeight = 'bold';
            cell1.style.padding = '8px';

            var label = document.createElement('label');
            var input = document.createElement('input');
            input.type = 'checkbox';
            input.name = setting.name;
            input.checked = typeof settings_cookies.general[setting.name] === 'object'
                ? settings_cookies.general[setting.name].enabled
                : settings_cookies.general[setting.name];

            label.appendChild(input);
            label.appendChild(document.createTextNode(setting.description));

            cell2.appendChild(label);
            cell2.style.padding = '0 5px';

            // Se houver extraSettings, adicionamos dinamicamente
            if (setting.extraSettings) {
                Object.keys(setting.extraSettings).forEach(extraKey => {
                    let extraRow = tableElement.insertRow();
                    let extraCell1 = extraRow.insertCell(0);
                    let extraCell2 = extraRow.insertCell(1);

                    extraCell1.textContent = setting.extraSettings[extraKey].label;

                    let extraInput = document.createElement('input');
                    extraInput.type = setting.extraSettings[extraKey].type;
                    extraInput.name = `${setting.name}__${extraKey}`;

                    let savedValue = settings_cookies.general[setting.name]?.[extraKey];
                    extraInput.value = savedValue !== undefined ? savedValue : setting.extraSettings[extraKey].default;

                    extraCell2.appendChild(extraInput);
                });
            }
        }
    });

    tabContent.appendChild(tableElement);
    return tabContent;
}

function createSaveButton() {
    var saveButtonDiv = document.createElement('div');
    saveButtonDiv.id = 'saveButtonDiv';
    Object.assign(saveButtonDiv.style, {
        textAlign: 'center',
        marginTop: '10px'
    });

    var saveButton = document.createElement('input');
    saveButton.type = 'submit';
    saveButton.value = 'Save Changes';
    saveButton.className = 'btn';
    Object.assign(saveButton.style, {
        padding: '8px 16px',
        fontSize: '14px',
        cursor: 'pointer'
    });

    saveButton.onclick = function () {
        saveScriptSettings();
    };

    saveButtonDiv.appendChild(saveButton);
    return saveButtonDiv;
}

var availableSettings = [
    { "name": "keep_awake", "label": "Keep Awake", "description": "Refreshes the page after 5 minutes of inactivity." },
    { "name": "redirect__train_buildings", "label": "Redirect Train Buildings", "description": "All buildings used for training purposes redirect directly to the train screen." },
    { "name": "show__navigation_arrows", "label": "Use Navigation Arrows", "description": "Enables navigation arrows for easier switch between villages." },

    { "name": "show__village_list", "label": "Village List Widget", "description": "Display the village list widget on the overview screen." },
    { "name": "show__recruit_troops", "label": "Recruitment Widget", "description": "Display a widget to recruit troops on overview page (NOT FULLY IMPLEMENTED)" },
    { "name": "show__notepad", "label": "Notepad Widget", "description": "Display a notepad widget for taking notes (per village)." },
    { "name": "show__building_queue", "label": "Building Queue Widget", "description": "Display the building queue and available upgrades on the overview page. Allows adding/removing buildings to the queue from the overview screen." },
    { "name": "show__building_queue_all", "label": "All Buildings in Queue", "description": "Display all buildings in the queue, including those that cannot be upgraded due to a lack of resources or a full queue and allows to use the fake building queue. Requires the browser to be open. (IN TESTING)" },

    { "name": "show__extra_options_map_hover", "label": "Show Extra Map Hover Info", "description": "Display additional info when hovering over a village on the map." },
    { "name": "show__outgoingInfo_map", "label": "Show Outgoing Commands Info", "description": "Display additional info about outgoing units per village." },

    { "name": "show__overview_premmium_info", "label": "Display Premium overview information", "description": "Display additional premium information for buildings, similar to what we get with premium (graphical overview)" },
    { "name": "show__navigation_bar", "label": "Navigation Bar", "description": "Display the navigation bar at the top of the screen." },
    { "name": "show__time_storage_full_hover", "label": "Show Time Until Full Storage on Hover", "description": "Display the remaining time until storage is full when hovering over a resource." },

    { "name": "show__auto_scavenging", "label": "Enable Auto Scavenging", "description": "Automatically manages scavenging tasks. Requires the browser to be open." },
    {
        "name": "show__auto_paladin_train", "label": "Enable Auto Paladin Training", "description": "Automatically trains paladins. Requires the browser to be open.",
        "extraSettings": {
            "maxLevel": { "label": "Train Paladin until level:", "type": "number", "default": 0 },
        }
    },

    { "name": "remove__premium_promo", "label": "Remove Premium Promos", "description": "Removes premium promotional content from all pages." }
    // Add more settings as needed
];

function getSettingsGroups() {
    return {
        "Widgets": ["show__village_list", "show__recruit_troops", "show__notepad", "show__building_queue", "show__building_queue_all"],
        "UI Enhancements": ["show__navigation_arrows", "show__time_storage_full_hover", "show__overview_premmium_info", "show__navigation_bar"],
        "Map Options": ["show__extra_options_map_hover", "show__outgoingInfo_map"],
        "Automation": ["show__auto_scavenging", "show__auto_paladin_train"],
        "Other": ["keep_awake", "remove__premium_promo", "redirect__train_buildings"]
    };
}

