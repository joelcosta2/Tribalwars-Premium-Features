// Global settings/state: settings_cookies schema, getters/setters, and localStorage bootstrap.
// Depends on utils/core_storage.js (safeLocalStorageSet).

//GLOBAL VARIABLES
var RIGHT_COLUMN = "rightcolumn";
var CENTER_COLUMN = "leftcolumn";
var LEFT_COLUMN = "script_column";

var default_settings_cookies = {
    widgets: [
        {
            name: 'village_list',
            column: LEFT_COLUMN,
            pos: 0,
            open: true
        },
        {
            name: 'notepad',
            column: LEFT_COLUMN,
            pos: 1,
            open: true
        },
        {
            name: 'building_queue',
            column: LEFT_COLUMN,
            pos: 2,
            open: true
        },
        {
            name: 'recruit_troops',
            column: LEFT_COLUMN,
            pos: 3,
            open: false
        },
        {
            name: 'village_groups',
            column: LEFT_COLUMN,
            pos: 4,
            open: true
        },
    ],
    general: {
        language: 'pt',
        keep_awake: true,
        redirect__train_buildings: false,
        remove__premium_promo: true,
        antiBot__disableOnDetection: true,
        show__village_list: true,
        show__recruit_troops: false,
        show__navigation_arrows: true,
        show__widget_popup_shortcuts: {
            enabled: true,
            training: true,
            queue: true,
            coinMinting: true
        },
        show__notepad: true,
        show__building_queue: true,
        show__village_groups: true,
        show__map_hover_info: {
            enabled: true,
            morale: true,
            lastAttack: true,
            troopDistance: true,
            reservation: true,
            ownVillageInfo: true
        },
        show__outgoingInfo_map: true,
        show__overview_premium_info: true,
        show__soft_dark_mode: false,
        show__big_map: false,
        show__overview_villages_queue: true,
        show__overview_villages_troops: {
            enabled: true,
            auto: false,
            mode: 'full'
        },
        show__overview_villages_quicklinks: {
            enabled: true,
            source: 'custom',
            queue: true,
            training: true,
            items: []
        },
        show__heatmap_reports: { enabled: false, mode: 'resources' },
        show__map_ctx_buttons: {
            enabled: true,
            attackButtons: true,
            reservation: true,
            mapGroup: true
        },
        show__auto_daily_bonus: false,
        show__auto_build_instant_free: false,
        show__auto_paladin_train: {
            enabled: false,
            maxLevel: 30,
        },
        show__player_profile_stats: true,
    }
};

var settings_cookies = JSON.parse(localStorage.getItem('settings_cookies')) || default_settings_cookies;

/**
 * Reads a general setting, resolving the boolean-vs-{enabled,...} shape ambiguity.
 * Use this (not a direct settings_cookies.general[name] read) whenever a setting might be the
 * nested {enabled,...} shape (most show__* toggles with sub-options) — plain booleans/numbers
 * are safe to read directly since there's no ambiguity to resolve for them.
 * @param {string} name - Key in settings_cookies.general.
 */
function getSetting(name) {
    var value = settings_cookies.general[name];
    return typeof value === 'object' && value !== null ? value.enabled : value;
}

function isMapContextButtonEnabled(option) {
    var setting = settings_cookies.general.show__map_ctx_buttons;
    if (typeof setting !== 'object' || setting === null) return setting !== false;
    return setting.enabled !== false && (!option || setting[option] !== false);
}

function isMapHoverInfoEnabled(option) {
    var setting = settings_cookies.general.show__map_hover_info;
    if (typeof setting !== 'object' || setting === null) return setting !== false;
    return setting.enabled !== false && (!option || setting[option] !== false);
}

/**
 * Writes a simple (non-nested) general setting and persists it to localStorage.
 * @param {string} name - Key in settings_cookies.general.
 * @param {*} value - New value to store.
 */
function setSetting(name, value) {
    settings_cookies.general[name] = value;
    safeLocalStorageSet('settings_cookies', JSON.stringify(settings_cookies));
}


var widgetsInjectFunctions = {
    'village_list': injectVillagesListWidget,
    'notepad': injectNotepadWidget,
    'building_queue': fetchBuildQueueWidget,
    'recruit_troops': injectRecruitTroopsWidget,
    'village_groups': injectVillageGroupsWidget
};

var currentVillageIndex;

/**
 * Initialises required localStorage keys with defaults and migrates saved settings
 * to include any new keys added since the user last saved.
 */
function prepareLocalStorageItems(options = {}) {
    if (unsafeWindow.lang) {
        safeLocalStorageSet('tw_lang', JSON.stringify(unsafeWindow.lang));
    }

    // The per-village IndexedDB mirror must be hydrated before any bqGet/bqSet access. Settings
    // and other synchronous defaults can safely be prepared earlier for a fast UI shell.
    if (!options.skipBuildQueue) prepareBuildQueueStorageDefaults();
    safeLocalStorageSet('villages_info', localStorage.getItem('villages_info') ?? '[]');
    safeLocalStorageSet('full_storage_times', localStorage.getItem('full_storage_times') ?? '[]');
    safeLocalStorageSet('mapConfig', localStorage.getItem('mapConfig') ?? '{}');
    safeLocalStorageSet('map_custom_height', localStorage.getItem('map_custom_height') ?? '600');
    safeLocalStorageSet('map_custom_width', localStorage.getItem('map_custom_width') ?? '900');
    safeLocalStorageSet('scavenge_configs', localStorage.getItem('scavenge_configs') ?? '{}');

    // Migrate settings: ensure any new default widgets/general keys are present in saved settings
    let settingsMigrated = false;
    const legacyMapCtxSettingKey = 'show__ctx_attack_buttons';
    const legacyMapHoverSettingKey = 'show__extra_options_map_hover';
    const legacyReservationSettingKey = 'show__ally_reservations';
    const mapCtxSettingKey = 'show__map_ctx_buttons';
    if (settings_cookies.general[legacyMapCtxSettingKey] !== undefined) {
        if (settings_cookies.general[mapCtxSettingKey] === undefined) {
            settings_cookies.general[mapCtxSettingKey] = settings_cookies.general[legacyMapCtxSettingKey];
        }
        delete settings_cookies.general[legacyMapCtxSettingKey];
        settingsMigrated = true;
    }
    if (settings_cookies.general[legacyReservationSettingKey] !== undefined) {
        if (settings_cookies.general[mapCtxSettingKey] === undefined) {
            settings_cookies.general[mapCtxSettingKey] = Object.assign({}, default_settings_cookies.general[mapCtxSettingKey]);
        }
        if (typeof settings_cookies.general[mapCtxSettingKey] === 'object' && settings_cookies.general[mapCtxSettingKey] !== null) {
            settings_cookies.general[mapCtxSettingKey].reservation = settings_cookies.general[legacyReservationSettingKey] !== false;
        }
        delete settings_cookies.general[legacyReservationSettingKey];
        settingsMigrated = true;
    }
    if (settings_cookies.general[legacyMapHoverSettingKey] !== undefined) {
        if (settings_cookies.general.show__map_hover_info === undefined) {
            settings_cookies.general.show__map_hover_info = settings_cookies.general[legacyMapHoverSettingKey];
        }
        delete settings_cookies.general[legacyMapHoverSettingKey];
        settingsMigrated = true;
    }
    const legacyTroopAutoSettingKey = 'show__overview_villages_troops_auto';
    if (settings_cookies.general[legacyTroopAutoSettingKey] !== undefined) {
        const troopSetting = settings_cookies.general.show__overview_villages_troops;
        const legacyTroopAuto = settings_cookies.general[legacyTroopAutoSettingKey];
        const autoEnabled = typeof legacyTroopAuto === 'object'
            ? legacyTroopAuto.enabled !== false
            : legacyTroopAuto !== false;
        const autoMode = typeof legacyTroopAuto === 'object' && legacyTroopAuto.mode === 'place'
            ? 'place'
            : 'full';
        if (typeof troopSetting !== 'object' || troopSetting === null) {
            settings_cookies.general.show__overview_villages_troops = {
                enabled: troopSetting !== false,
                auto: autoEnabled,
                mode: autoMode
            };
        } else {
            if (troopSetting.auto === undefined) troopSetting.auto = autoEnabled;
            if (troopSetting.mode === undefined) troopSetting.mode = autoMode;
        }
        delete settings_cookies.general[legacyTroopAutoSettingKey];
        settingsMigrated = true;
    }
    default_settings_cookies.widgets.forEach(function (defaultWidget) {
        if (!settings_cookies.widgets.find(function (w) { return w.name === defaultWidget.name; })) {
            settings_cookies.widgets.push(Object.assign({}, defaultWidget));
            settingsMigrated = true;
        }
    });
    Object.keys(default_settings_cookies.general).forEach(function (key) {
        if (key === 'show__overview_villages_quicklinks' && typeof settings_cookies.general[key] !== 'object') {
            settings_cookies.general[key] = {
                enabled: !!settings_cookies.general[key],
                source: 'custom'
            };
            settingsMigrated = true;
            return;
        }

        if (key === 'show__map_ctx_buttons') {
            const ctxSetting = settings_cookies.general[key];
            if (typeof ctxSetting !== 'object' || ctxSetting === null) {
                settings_cookies.general[key] = {
                    enabled: ctxSetting !== false,
                    attackButtons: true,
                    reservation: true,
                    mapGroup: true
                };
                settingsMigrated = true;
            } else {
                ['attackButtons', 'reservation', 'mapGroup'].forEach(function (subSetting) {
                    if (ctxSetting[subSetting] === undefined) {
                        ctxSetting[subSetting] = true;
                        settingsMigrated = true;
                    }
                });
                if (ctxSetting.enabled === undefined) {
                    ctxSetting.enabled = true;
                    settingsMigrated = true;
                }
            }
            return;
        }

        if (key === 'show__map_hover_info') {
            const hoverSetting = settings_cookies.general[key];
            if (typeof hoverSetting !== 'object' || hoverSetting === null) {
                settings_cookies.general[key] = {
                    enabled: hoverSetting !== false,
                    morale: true,
                    lastAttack: true,
                    troopDistance: true
                };
                settingsMigrated = true;
            } else {
                ['morale', 'lastAttack', 'troopDistance'].forEach(function (subSetting) {
                    if (hoverSetting[subSetting] === undefined) {
                        hoverSetting[subSetting] = true;
                        settingsMigrated = true;
                    }
                });
                if (hoverSetting.enabled === undefined) {
                    hoverSetting.enabled = true;
                    settingsMigrated = true;
                }
            }
            return;
        }

        if (key === 'show__overview_villages_troops') {
            const troopSetting = settings_cookies.general[key];
            if (typeof troopSetting !== 'object' || troopSetting === null) {
                settings_cookies.general[key] = {
                    enabled: troopSetting !== false,
                    auto: false,
                    mode: 'full'
                };
                settingsMigrated = true;
            } else {
                if (troopSetting.enabled === undefined) {
                    troopSetting.enabled = true;
                    settingsMigrated = true;
                }
                if (troopSetting.auto === undefined) {
                    troopSetting.auto = false;
                    settingsMigrated = true;
                }
                if (troopSetting.mode === undefined) {
                    troopSetting.mode = 'full';
                    settingsMigrated = true;
                }
            }
            return;
        }

        if (settings_cookies.general[key] === undefined) {
            settings_cookies.general[key] = default_settings_cookies.general[key];
            settingsMigrated = true;
        }
    });

    if (settings_cookies.general.show__overview_villages_quicklinks && typeof settings_cookies.general.show__overview_villages_quicklinks === 'object') {
        if (settings_cookies.general.show__overview_villages_quicklinks.enabled === undefined) {
            settings_cookies.general.show__overview_villages_quicklinks.enabled = true;
            settingsMigrated = true;
        }
        if (!settings_cookies.general.show__overview_villages_quicklinks.source) {
            settings_cookies.general.show__overview_villages_quicklinks.source = 'custom';
            settingsMigrated = true;
        }
        ['queue', 'training'].forEach(function (widgetKey) {
            if (settings_cookies.general.show__overview_villages_quicklinks[widgetKey] === undefined) {
                settings_cookies.general.show__overview_villages_quicklinks[widgetKey] = true;
                settingsMigrated = true;
            }
        });
        if (!Array.isArray(settings_cookies.general.show__overview_villages_quicklinks.items)) {
            settings_cookies.general.show__overview_villages_quicklinks.items = [];
            settingsMigrated = true;
        }
    }

    if (!settings_cookies.general.show__widget_popup_shortcuts || typeof settings_cookies.general.show__widget_popup_shortcuts !== 'object') {
        settings_cookies.general.show__widget_popup_shortcuts = { enabled: true, training: true, queue: true, coinMinting: true };
        settingsMigrated = true;
    } else {
        if (settings_cookies.general.show__widget_popup_shortcuts.enabled === undefined) {
            settings_cookies.general.show__widget_popup_shortcuts.enabled = true;
            settingsMigrated = true;
        }
        ['training', 'queue', 'coinMinting'].forEach(function (shortcutKey) {
            if (settings_cookies.general.show__widget_popup_shortcuts[shortcutKey] === undefined) {
                settings_cookies.general.show__widget_popup_shortcuts[shortcutKey] = true;
                settingsMigrated = true;
            }
        });
    }

    const paladinSetting = settings_cookies.general.show__auto_paladin_train;
    if (!paladinSetting || typeof paladinSetting !== 'object') {
        settings_cookies.general.show__auto_paladin_train = {
            enabled: paladinSetting === true,
            maxLevel: 30
        };
        settingsMigrated = true;
    } else {
        if (typeof paladinSetting.enabled !== 'boolean') {
            paladinSetting.enabled = false;
            settingsMigrated = true;
        }
        if (!Number.isInteger(Number(paladinSetting.maxLevel)) || Number(paladinSetting.maxLevel) <= 0) {
            paladinSetting.maxLevel = 30;
            settingsMigrated = true;
        }
    }

    // Remove legacy Resource Dashboard data from older saved settings/storage.
    const legacyWidgetName = ['resource', 'dashboard'].join('_');
    const legacySettingKey = ['show', 'resource', 'dashboard'].join('__');
    const legacyResourcesKey = ['villages', 'resources'].join('_');

    const legacyWidgetIndex = settings_cookies.widgets.findIndex(function (widget) {
        return widget.name === legacyWidgetName;
    });
    if (legacyWidgetIndex !== -1) {
        settings_cookies.widgets.splice(legacyWidgetIndex, 1);
        settingsMigrated = true;
    }
    if (settings_cookies.general[legacySettingKey] !== undefined) {
        delete settings_cookies.general[legacySettingKey];
        settingsMigrated = true;
    }

    if (localStorage.getItem(legacyResourcesKey) !== null) {
        localStorage.removeItem(legacyResourcesKey);
    }

    // Remove dead settings keys that were never read anywhere (antiBot cache/offline-mode were
    // never implemented; scavenging/map-groups manage their own separate storage keys instead).
    ['antiBot__offlineMode', 'antiBot__cacheIntervals', 'show__auto_scavenging', 'show__custom_map_groups'].forEach(function (deadKey) {
        if (settings_cookies.general[deadKey] !== undefined) {
            delete settings_cookies.general[deadKey];
            settingsMigrated = true;
        }
    });

    if (settingsMigrated) {
        localStorage.setItem('settings_cookies', JSON.stringify(settings_cookies));
    }

    if (typeof TribalWars !== 'undefined') {
        // Store on Tampermonkey storage
        GM_setValue("current_world", game_data?.world);
    }
}

function prepareBuildQueueStorageDefaults() {
    bqSet('waiting_for_queue', undefined, bqGet('waiting_for_queue') ?? {});
    bqSet('building_queue', undefined, bqGet('building_queue') ?? []);
}

/**
 * Finds the current village in the villages_info list and stores its index
 * in localStorage as 'current_village'.
 */
function setCookieCurrentVillage() {
    var villageID = game_data.village?.id,
        villages = JSON.parse(localStorage.getItem('villages_info') || '[]'),
        villgersNum = sizeOfObject(villages);

    for (var i = 0; i < villgersNum; i++) {
        var urlTemp = villages[i].url;
        if (urlTemp.includes(villageID)) {
            currentVillageIndex = i;
            localStorage.setItem('current_village', currentVillageIndex);
            return;
        }
    }
}
