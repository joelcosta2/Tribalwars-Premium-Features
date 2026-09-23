// ==UserScript==
// @name         Tribalwars: Premium Features
// @version      5.0.5
// @description  Feature-rich enhancement suite for TribalWars. Widgets: Village List, Notepad, Extra Build Queue, Recruit Troops. Map: hover details, outgoing command overlay, attack heat-map, custom CTX attack template buttons, large map view. Automation: Auto Daily Bonus collection. UI: Custom Navigation Bar, Navigation Arrows, Visual Building Overview. Settings: full import/export support.
// @author       killwilll
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/i18n/i18n_utils.js
// @resource     i18n_en      https://github.com/joelcosta2/Tribalwars_Script/raw/master/i18n/en.json
// @resource     i18n_pt      https://github.com/joelcosta2/Tribalwars_Script/raw/master/i18n/pt.json
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/emojiMap.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/core_storage.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/core_state.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/core_utils.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/core_widgets.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/core_time.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/core_async.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/core_scheduler.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/mapDataCache.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/bbcode.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/worldGameData.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/buildingsData.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/attackLauncher.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/nativeMemo.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/core_indexeddb.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/pageFetchManager.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/resourcesManager.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/buildingsManager.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/marketTransports.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/commandsManager.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/core_bot_protection.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/core_css.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/core_darkmode.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/core_sidebar.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/core_settings.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/mapSdk.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/ctxCustom.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/widgets/villageArrows.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/widgets/navigationBar.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/utils/reportsManager.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/map/mapHeatOverlay.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/map/map.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/allyReservations.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/map/mapGroups.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/map/mapGroupQuickLinks.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/overview.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/overviewVillages/init.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/overviewVillages/productionTable.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/overviewVillages/troopsTable.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/overviewVillages/commandsTable.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/overviewVillages/marketTable.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/overviewVillages/manualGroups.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/overviewVillages/navigationMenu.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/overviewVillages/quickLinks.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/troopTemplates.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/farmAssistant.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/benefitPossibilities.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/simulator.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/playerProfile.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/villageProfile.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/features/extraNotepad.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/bots/trainerPaladin.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/bots/scavenging.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/bots/dailyBonus.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/bots/buildInstantFree.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/widgets/villageList.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/widgets/notepad.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/widgets/extraBuildQueue.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/widgets/recruitTroops.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/widgets/villageGroups.js
// @require      https://github.com/joelcosta2/Tribalwars_Script/raw/master/widgets/coinMinting.js
// @updateURL    https://github.com/joelcosta2/Tribalwars_Script/raw/master/main.user.js
// @downloadURL  https://github.com/joelcosta2/Tribalwars_Script/raw/master/main.user.js
// @include      https://*.tribalwars.*/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_getResourceText
// @connect      twstats.com
// ==/UserScript==
(function () {
    'use strict';

    function isBotProtectionActive() {
        return Boolean(window.PremiumFeaturesBotProtection && window.PremiumFeaturesBotProtection.isActive());
    }

    if (isBotProtectionActive()) {
        return;
    }

    $(document)
        .off('partial_reload_end.premium_features')
        .on('partial_reload_end.premium_features', function () {
            if (!isBotProtectionActive() && !document.getElementById('mobileContent')) {
                start();
            }
        });

    var villageList;
    async function init() {
        if (isBotProtectionActive()) return;
        await hydrateBuildQueueCache();
        cleanupLegacyStorageFillTimesLocalStorage();
        cleanupLegacyMapCommandsLocalStorage();
        cleanupLegacyRecruitQueueLocalStorage();
        cleanupLegacyReportsLocalStorage();
        await cleanupLegacyNotepadStorage();
        await hydrateNotepadCache();
        await hydrateVillageProfileNotesCache();
        await hydrateReservationsCache();
        cleanupLegacyMapDataLocalStorage();
        await hydrateMapDataCache();
        restoreTimeouts();
        prepareLocalStorageItems();
        if (!document.getElementById('mobileContent')) {
            start();
        }
    }

    setTimeout(() => {
        if (!isBotProtectionActive()) {
            init();
        }
    }, 500);
})();
