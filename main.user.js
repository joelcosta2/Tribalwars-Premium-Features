// ==UserScript==
// @name         Tribalwars: Premium Features [Premium Compat]
// @version      5.3.7
// @description  Feature-rich enhancement suite for TribalWars. Widgets: Village List, Notepad, Extra Build Queue, Recruit Troops. Map: hover details, outgoing command overlay, attack heat-map, custom CTX attack template buttons, large map view. Automation: Auto Daily Bonus collection. UI: Custom Navigation Bar, Navigation Arrows, Visual Building Overview. Settings: full import/export support.
// @author       killwilll
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/i18n/i18n_utils.js?v=5.3.2
// @resource     i18n_en      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/i18n/en.json?v=5.3.7
// @resource     i18n_pt      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/i18n/pt.json?v=5.3.7
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/emojiMap.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_storage.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_runtime.js?v=5.3.3
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_diagnostics.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_coordination.js?v=5.3.3
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_state.js?v=5.3.5
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_utils.js?v=5.3.6
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_widgets.js?v=5.3.5
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_time.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_async.js?v=5.3.3
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_scheduler.js?v=5.3.7
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/mapDataCache.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/bbcode.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/worldGameData.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/buildingsData.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/attackLauncher.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/nativeMemo.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_indexeddb.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/buildStateStore.js?v=5.3.7
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/resourcesManager.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/buildingsManager.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/marketTransports.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_bot_protection.js?v=5.3.7
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_css.js?v=5.3.5
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_darkmode.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_sidebar.js?v=5.3.5
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_settings.js?v=5.3.7
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/mapSdk.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/ctxCustom.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/villageArrows.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/navigationBar.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/reportsManager.js?v=5.3.3
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/map/mapHeatOverlay.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/map/map.js?v=5.3.3
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/allyReservations.js?v=5.3.5
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/map/mapGroups.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/map/mapGroupQuickLinks.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overview.js?v=5.3.6
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/init.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/productionTable.js?v=5.3.7
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/troopsTable.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/marketTable.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/manualGroups.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/navigationMenu.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/quickLinks.js?v=5.3.5
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/troopTemplates.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/farmAssistant.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/simulator.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/playerProfile.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/villageProfile.js?v=5.3.5
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/extraNotepad.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/bots/trainerPaladin.js?v=5.3.3
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/bots/scavenging.js?v=5.3.7
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/bots/dailyBonus.js?v=5.3.3
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/bots/buildInstantFree.js?v=5.3.7
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/villageList.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/notepad.js?v=5.3.5
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/extraBuildQueue.js?v=5.3.7
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/recruitTroops.js?v=5.3.5
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/villageGroups.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/coinMinting.js?v=5.3.2
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

    const runtime = window.PremiumFeaturesRuntimeRegistry;
    const bootStartedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const hydration = window.PremiumFeaturesHydration || {};
    window.PremiumFeaturesHydration = hydration;

    function monotonicNow() {
        return typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
    }

    function recordBoot(status, stage, fields) {
        window.PremiumFeaturesDiagnostics?.record?.(Object.assign({
            feature: 'bootstrap',
            taskKey: 'core:boot',
            status,
            stage
        }, fields || {}));
    }

    function measureBootStage(stage, run) {
        const startedAt = monotonicNow();
        recordBoot('BOOT_STAGE_START', stage);
        return Promise.resolve().then(run).then(function (value) {
            recordBoot('BOOT_STAGE_END', stage, { durationMs: Math.max(0, monotonicNow() - startedAt) });
            return value;
        }, function (error) {
            recordBoot('BOOT_STAGE_END', stage, {
                durationMs: Math.max(0, monotonicNow() - startedAt),
                outcome: 'FAILED',
                reason: String(error?.message || error)
            });
            throw error;
        });
    }

    function registerFeatureHydration(key, stage, run, dependency) {
        const entry = hydration[key] || { status: 'PENDING', promise: null, error: null };
        hydration[key] = entry;
        if (entry.promise) return entry;
        entry.promise = Promise.resolve(dependency).then(function () {
            return measureBootStage(stage, run);
        }).then(function (value) {
            entry.status = 'READY';
            return value;
        }, function (error) {
            entry.status = 'FAILED';
            entry.error = error;
            recordBoot('BOOT_STAGE_ISOLATED_FAILURE', stage, { reason: String(error?.message || error) });
            return null;
        });
        return entry;
    }

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
                runtime.requestReconcile('partial-reload', function () {
                    init().then(function () {
                        beginFeatureHydration();
                        mountUi('partial-reload');
                    }).catch(function (error) {
                        console.error('[TW] Partial reload reconcile failed', error);
                    });
                });
            }
        });

    var villageList;
    function init() {
        return runtime.onceAsync('core:boot', async function () {
            if (isBotProtectionActive()) return;
            await measureBootStage('prepareLocalStorageItems', function () {
                prepareLocalStorageItems({ skipBuildQueue: true });
            });
            beginFeatureHydration();
            mountEarlyUiShell();
            cleanupLegacyRecruitQueueLocalStorage();
            cleanupLegacyReportsLocalStorage();
            restoreTimeouts();
            if (typeof restoreScavengingAutoWakes === 'function') restoreScavengingAutoWakes();
            runtime.installInteractionTracking(document);
            window.PremiumFeaturesCoordination?.start?.();
            window.PremiumFeaturesBackgroundScheduler?.start?.();
        });
    }

    function beginFeatureHydration() {
        return runtime.onceAsync('core:feature-hydration', function () {
            const buildQueue = registerFeatureHydration('buildQueue', 'hydrateBuildQueueCache', function () {
                return Promise.resolve(hydrateBuildQueueCache()).then(function () {
                    prepareBuildQueueStorageDefaults();
                });
            });
            const notepadCleanup = registerFeatureHydration(
                'notepadCleanup',
                'cleanupLegacyNotepadStorage',
                cleanupLegacyNotepadStorage
            );
            const entries = [
                buildQueue,
                notepadCleanup,
                registerFeatureHydration('notepad', 'hydrateNotepadCache', hydrateNotepadCache, notepadCleanup.promise),
                registerFeatureHydration('villageProfileNotes', 'hydrateVillageProfileNotesCache', hydrateVillageProfileNotesCache),
                registerFeatureHydration('reservations', 'hydrateReservationsCache', hydrateReservationsCache),
                registerFeatureHydration('mapData', 'hydrateMapDataCache', function () {
                    cleanupLegacyMapDataLocalStorage();
                    return hydrateMapDataCache();
                })
            ];
            return Promise.all(entries.map(function (entry) { return entry.promise; })).then(function () {
                recordBoot('BOOT_COMPLETE', 'optional-hydration', {
                    durationMs: Math.max(0, monotonicNow() - bootStartedAt)
                });
            });
        });
    }

    function mountUi(reason) {
        if (document.getElementById('mobileContent')) return;
        const startedAt = monotonicNow();
        start();
        recordBoot('BOOT_START_COMPLETE', 'start', {
            reason: reason || 'initial',
            durationMs: Math.max(0, monotonicNow() - startedAt),
            sinceUserscriptMs: Math.max(0, monotonicNow() - bootStartedAt)
        });
    }

    function mountEarlyUiShell() {
        if (document.getElementById('mobileContent') || isBotProtectionActive()) return;
        if (document.location.href.includes('screen=overview') && !document.location.href.includes('screen=overview_villages')) {
            injectScriptColumn();
            const villageListConfig = settings_cookies.widgets.find(function (widget) { return widget.name === 'village_list'; });
            if (villageListConfig && settings_cookies.general.show__village_list) {
                injectVillagesListWidget(villageListConfig.column);
            }
            const notepadConfig = settings_cookies.widgets.find(function (widget) { return widget.name === 'notepad'; });
            if (notepadConfig && settings_cookies.general.show__notepad) {
                injectNotepadWidget(notepadConfig.column);
            }
            const recruitConfig = settings_cookies.widgets.find(function (widget) { return widget.name === 'recruit_troops'; });
            if (recruitConfig && settings_cookies.general.show__recruit_troops) {
                const loading = document.createElement('div');
                loading.id = 'recruit_troops_loading';
                loading.appendChild(createWidgetLoadingElement());
                createWidgetElement({
                    identifier: t('button.recruit'), contents: loading, columnToUse: recruitConfig.column,
                    widgetKey: 'recruit', extra_name: 'troops', loading: true
                });
            }
            const buildQueueConfig = settings_cookies.widgets.find(function (widget) { return widget.name === 'building_queue'; });
            if (buildQueueConfig && settings_cookies.general.show__building_queue) {
                const loading = document.createElement('div');
                loading.id = 'building_queue_loading';
                loading.appendChild(createWidgetLoadingElement());
                createWidgetElement({
                    identifier: t('buildQueue.title'), contents: loading, columnToUse: buildQueueConfig.column,
                    widgetKey: 'building_queue', loading: true
                });
            }
        }
        if (!document.getElementById('settings_popup')) injectScriptSettingsPopUp();
        recordBoot('BOOT_UI_MOUNT', 'early-shell', {
            sinceUserscriptMs: Math.max(0, monotonicNow() - bootStartedAt)
        });
    }

    let bootRequested = false;
    function bootNow() {
        if (bootRequested || isBotProtectionActive()) return;
        bootRequested = true;
        recordBoot('BOOT_STAGE_END', 'userscript-to-init', {
            durationMs: Math.max(0, monotonicNow() - bootStartedAt)
        });
        init().then(function () {
            // Publish every feature-specific hydration promise before mounting. Widgets that depend
            // on one can render a stable shell and fill it when that one promise settles; unrelated
            // caches never hold the global UI hostage.
            mountUi('initial');
        }).catch(function (error) {
            console.error('[TW] Boot failed', error);
        });
    }

    window.PremiumFeaturesBootLifecycle = {
        init,
        beginFeatureHydration,
        mountUi,
        mountEarlyUiShell,
        bootNow,
        hydration
    };

    recordBoot('BOOT_START', 'userscript');
    if (document.readyState === 'loading') {
        runtime.addEventListener('core:boot-dom-ready', document, 'DOMContentLoaded', bootNow, { once: true });
    } else {
        Promise.resolve().then(bootNow);
    }
})();
