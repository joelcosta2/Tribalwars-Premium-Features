//Utils

/**
 * Reads the current resource quantities from a TribalWars page or parsed page response.
 * The returned values are a point-in-time snapshot; callers that need live values must
 * call this again after the game updates the header.
 * @param {Document|string} source
 * @returns {{wood:number, stone:number, iron:number, pop:number|undefined, popMax:number|undefined}|null}
 */
function readVillageResourceSnapshot(source) {
    const doc = typeof source === 'string'
        ? new DOMParser().parseFromString(source, 'text/html')
        : source;
    if (!doc || typeof doc.querySelector !== 'function') return null;

    const resourceElements = {
        wood: doc.querySelector('#wood'),
        stone: doc.querySelector('#stone'),
        iron: doc.querySelector('#iron')
    };
    if (Object.values(resourceElements).some(element => !element)) return null;

    const readAmount = element => parseInt(element.textContent.replace(/\D/g, '') || '0', 10);
    const popElement = doc.querySelector('#pop_current_label');
    const popMaxElement = doc.querySelector('#pop_max_label');

    return {
        wood: readAmount(resourceElements.wood),
        stone: readAmount(resourceElements.stone),
        iron: readAmount(resourceElements.iron),
        pop: popElement ? readAmount(popElement) : undefined,
        popMax: popMaxElement ? readAmount(popMaxElement) : undefined
    };
}

/**
 * Returns the number of own enumerable properties in an object.
 * @param {Object} obj
 * @returns {number}
 */
function sizeOfObject(obj) {
    var size = 0, key;
    for (key in obj) {
        if (obj.hasOwnProperty(key)) size++;
    }
    return size;
}

/**
 * Reloads the page if TW's idle timer exceeds the threshold (keep_awake feature).
 * @param {number} minutes - Inactivity threshold in minutes.
 */
async function checkInactivity(minutes) {
    return runKeepAwakeCheck(minutes);
}

function _keepAwakeLeaseActive() {
    const coordinator = window.PremiumFeaturesCoordination;
    if (!coordinator?.readLease) return true;
    const lease = coordinator.readLease('keep-awake');
    return Boolean(lease && lease.owner === coordinator.tabId &&
        lease.instanceId === coordinator.instanceId && lease.expiresAt > Date.now());
}

function _deferKeepAwakeForLease(handlerName, minutes) {
    const coordinator = window.PremiumFeaturesCoordination;
    const lease = coordinator?.readLease?.('keep-awake');
    const dueAt = Math.max(Date.now() + 1000, Number(lease?.expiresAt) + 50 || 0);
    setHandlerOnTimeOut(
        handlerName === 'keepAwakeConfirmation' ? 'keep-awake-confirm' : 'keep-awake',
        handlerName,
        [Number(minutes) || 8],
        dueAt - Date.now()
    );
    window.PremiumFeaturesDiagnostics?.record?.({
        feature: 'keep-awake', taskKey: 'keep-awake', status: 'LEASE',
        reason: 'lease-deferred', dueAt
    });
    return { status: 'WAITING_LEASE', dueAt };
}

function scheduleKeepAwakeCheck(minutes = 8) {
    if (!settings_cookies?.general?.keep_awake) {
        if (typeof clearPersistedTimeout === 'function') clearPersistedTimeout('keep-awake');
        if (typeof clearPersistedTimeout === 'function') clearPersistedTimeout('keep-awake-confirm');
        return { status: 'DISABLED' };
    }
    const thresholdMs = Math.max(1, Number(minutes) || 8) * 60 * 1000;
    const idleMs = Math.max(0, Number(TribalWars?.getIdleTime?.()) || 0);
    const waitMs = Math.max(1000, thresholdMs - idleMs);
    setHandlerOnTimeOut('keep-awake', 'keepAwakeCheck', [Number(minutes) || 8], waitMs);
    return { status: 'SCHEDULED', dueAt: Date.now() + waitMs };
}

async function runKeepAwakeCheck(minutes = 8) {
    if (!settings_cookies?.general?.keep_awake) {
        if (typeof clearPersistedTimeout === 'function') clearPersistedTimeout('keep-awake');
        return { status: 'DISABLED' };
    }
    if (!_keepAwakeLeaseActive()) return _deferKeepAwakeForLease('keepAwakeCheck', minutes);
    const thresholdMs = Math.max(1, Number(minutes) || 8) * 60 * 1000;
    if ((Number(TribalWars?.getIdleTime?.()) || 0) < thresholdMs) {
        return scheduleKeepAwakeCheck(minutes);
    }
    showAutoHideBox(t('core.inactivityReload'));
    setHandlerOnTimeOut('keep-awake-confirm', 'keepAwakeConfirmation', [Number(minutes) || 8], 5000);
    return { status: 'CONFIRMATION_SCHEDULED', dueAt: Date.now() + 5000 };
}

async function runKeepAwakeConfirmation(minutes = 8) {
    if (!settings_cookies?.general?.keep_awake) {
        if (typeof clearPersistedTimeout === 'function') clearPersistedTimeout('keep-awake-confirm');
        return { status: 'DISABLED' };
    }
    if (!_keepAwakeLeaseActive()) return _deferKeepAwakeForLease('keepAwakeConfirmation', minutes);
    const thresholdMs = Math.max(1, Number(minutes) || 8) * 60 * 1000;
    if ((Number(TribalWars?.getIdleTime?.()) || 0) < thresholdMs) {
        return scheduleKeepAwakeCheck(minutes);
    }
    const scheduler = window.PremiumFeaturesBackgroundScheduler;
    if (scheduler?.hasPendingHigherPriority?.(scheduler.PRIORITY?.HOUSEKEEPING || 5)) {
        setHandlerOnTimeOut('keep-awake-confirm', 'keepAwakeConfirmation', [Number(minutes) || 8], 5000);
        return { status: 'DEFERRED_FOR_BACKGROUND_WORK', dueAt: Date.now() + 5000 };
    }
    if (!_keepAwakeLeaseActive()) return _deferKeepAwakeForLease('keepAwakeConfirmation', minutes);
    location.reload();
    return { status: 'RELOADING' };
}

// Auto-expand all quest group lists when the quest panel is opened
var questButton = document.getElementById('new_quest');
if (questButton) {
    // Store a reference to the original onclick handler
    var originalOnClick = questButton.onclick;

    // Override onclick to call the original first, then auto-expand quest groups
    questButton.onclick = function (event) {
        // Call the original handler if it exists
        if (originalOnClick) {
            originalOnClick.call(this, event);
        }

        let checkExist = setInterval(function () {
            let questlineLists = document.querySelectorAll('.questline-list');

            if (questlineLists.length > 0) {
                clearInterval(checkExist); // Stop polling once the quest lists are found

                questlineLists.forEach(questlineList => {
                    let listItems = questlineList.querySelectorAll('li');

                    listItems.forEach(li => {
                        let ul = li.closest('ul'); // Find the nearest parent <ul>
                        if (ul) {
                            ul.classList.add('opened'); // Force the quest group open
                        }
                    });
                });
            }
        }, 500); // Poll every 500 ms until the lists appear
    };
}

/**
 * Stub for attack-distance injection on the place screen. Not fully implemented.
 */
function injectAttackCalculations() {
    console.log(parseInt(document.querySelector('#command-data-form .village-distance').textContent.match(/(\d+)/), 10));
}

/**
 * Main entry point called after all scripts load. Detects server timezone, initialises
 * settings, runs page-specific feature injection, and restores persisted timeouts.
 */
function start() {
    const runtime = window.PremiumFeaturesRuntimeRegistry;
    const startGeneration = runtime?.currentGeneration?.() || 1;
    if (runtime && !runtime.claimFeature('core:start', startGeneration)) return;

    var urlPage = document.location.href;
    // Check for expired session and auto-redirect to the last active world if so
    if (!urlPage.includes('?session_expired') && typeof game_data != 'undefined') {
        // Premium Compat: active Premium accounts are allowed; conflicts are controlled per feature in Settings.
        serverTimezoneOffsetMs = detectServerTimezoneOffsetMs();
        const coordinator = window.PremiumFeaturesCoordination;
        const registerBackground = function (key, run, options) {
            if (coordinator?.registerBackgroundTask) {
                coordinator.registerBackgroundTask(key, run, Object.assign({ reconcile: true }, options));
            } else {
                Promise.resolve().then(run).catch(error => console.error('[TW] Background task failed:', key, error));
            }
        };
        registerBackground('world-settings', async function (guard) {
            guard?.assertActive?.();
            await fetchAndCacheWorldSettings();
        }, { priority: BACKGROUND_TASK_PRIORITY.REFRESH, leaseKey: 'world-data-refresh' });
        // Map player/ally TTL checks consult the hydrated raw cache. Register these jobs only
        // after that feature-specific hydration settles; otherwise a slow cache load would look
        // like a cache miss and create redundant GETs. The scheduler slot is not held meanwhile.
        const registerMapBackground = function () {
            if ((runtime?.currentGeneration?.() || 1) !== startGeneration) return;
            registerBackground('map-villages', function (guard) {
                guard?.assertActive?.();
                return updateMapInfoVillages();
            }, { priority: BACKGROUND_TASK_PRIORITY.REFRESH, leaseKey: 'world-data-refresh', delayMs: 0 });
            registerBackground('map-players', function (guard) {
                guard?.assertActive?.();
                return updateMapInfoPlayers();
            }, { priority: BACKGROUND_TASK_PRIORITY.REFRESH, leaseKey: 'world-data-refresh', delayMs: 1000 });
            registerBackground('map-allies', function (guard) {
                guard?.assertActive?.();
                return updateMapInfoAllies();
            }, { priority: BACKGROUND_TASK_PRIORITY.REFRESH, leaseKey: 'world-data-refresh', delayMs: 2000 });
        };
        const mapHydration = window.PremiumFeaturesHydration?.mapData;
        if (mapHydration?.status === 'PENDING' && mapHydration.promise) {
            mapHydration.promise.then(registerMapBackground).catch(function (error) {
                console.error('[TW] Could not register map refresh work', error);
            });
        } else {
            registerMapBackground();
        }
        prepareVillageList();
        villageList = localStorage.getItem('villages_info') ? JSON.parse(localStorage.getItem('villages_info')) : [];
        settings_cookies = localStorage.getItem('settings_cookies') ? JSON.parse(localStorage.getItem('settings_cookies')) : settings_cookies;
        listenTextAreas();
        setCookieCurrentVillage();
        if (window.PremiumFeaturesHydration?.buildQueue?.status !== 'PENDING' &&
            window.PremiumFeaturesHydration?.buildQueue?.status !== 'FAILED' &&
            typeof checkEarlyBuildOpportunity === 'function') checkEarlyBuildOpportunity();
        if (typeof captureCurrentVillageMarketTransports === 'function') captureCurrentVillageMarketTransports();
        // Arms every known village's instant-free timer, not just the current one — re-arming is
        // idempotent (each call clears its own previous timeout first), so this is safe to run even
        // on screens where the widget will also call checkAndScheduleBuildInstantFree() moments later.
        const buildQueueHydration = window.PremiumFeaturesHydration?.buildQueue;
        const registerBuildInstantTimers = function () {
            if ((runtime?.currentGeneration?.() || 1) !== startGeneration) return;
            registerBackground('build-instant-timers', function (guard) {
                guard?.assertActive?.();
                if (typeof initInstantFreeForAllVillages === 'function') initInstantFreeForAllVillages();
                else if (typeof checkAndScheduleBuildInstantFree === 'function') checkAndScheduleBuildInstantFree();
            }, { priority: BACKGROUND_TASK_PRIORITY.AUTOMATIC, leaseKey: 'build-instant-timers' });
        };
        if (buildQueueHydration?.status === 'PENDING' && buildQueueHydration.promise) {
            buildQueueHydration.promise.then(registerBuildInstantTimers);
        } else registerBuildInstantTimers();
        if (typeof injectOverviewVillagesTopbarMenu === 'function') {
            injectOverviewVillagesTopbarMenu();
        }
        // Periodic safety-net sweep so other villages' build queues keep progressing while this
        // tab has a different village displayed.
        const registerBuildQueueBackground = function () {
            if ((runtime?.currentGeneration?.() || 1) !== startGeneration) return;
            if (window.PremiumFeaturesHydration?.buildQueue?.status === 'FAILED') return;
            registerBackground('build-queue-sweep', function (guard) {
                guard?.assertActive?.();
                if (typeof initBackgroundVillageQueueSweep === 'function') initBackgroundVillageQueueSweep();
            }, { priority: BACKGROUND_TASK_PRIORITY.AUTOMATIC, leaseKey: 'build-queue-sweep' });
        };
        if (buildQueueHydration?.status === 'PENDING' && buildQueueHydration.promise) {
            buildQueueHydration.promise.then(registerBuildQueueBackground).catch(function (error) {
                console.error('[TW] Could not register build queue work after hydration', error);
            });
        } else {
            registerBuildQueueBackground();
        }
        addRessourcesHover(localStorage.getItem('full_storage_times') ? JSON.parse(localStorage.getItem('full_storage_times')) : null);
        if (urlPage.includes("screen=overview") && !urlPage.includes("screen=overview_villages")) {
            injectScriptColumn();
            updatePremiumInfoOverview();

            const overviewSortable = $("#overviewtable");
            if (overviewSortable.length && overviewSortable.data("ui-sortable")) {
                const sortableOptions = overviewSortable.sortable("option");
                const connectedColumns = sortableOptions.connectWith ? String(sortableOptions.connectWith).split(",").map(function (selector) {
                    return selector.trim();
                }).filter(Boolean) : [];
                const overviewConnectWith = connectedColumns.concat("#script_column").join(", ");
                overviewSortable.sortable("option", "connectWith", overviewConnectWith);

                const scriptColumn = $("#script_column");
                if (scriptColumn.length && !scriptColumn.data("ui-sortable")) {
                    scriptColumn.sortable(Object.assign({}, sortableOptions, {
                        connectWith: connectedColumns.concat("#overviewtable").join(", "),
                        update: undefined
                    }));
                }
            }

            settings_cookies.widgets.forEach(function (widget) {
                var functionName = widgetsInjectFunctions[widget.name];
                if (functionName) {
                    functionName(widget.column);
                }
            });
            restoreNativeWidgetsInScriptColumn();
        } else if (urlPage.includes("screen=overview_villages")) {
            if (typeof initOverviewVillages === 'function') initOverviewVillages();
        } else if (urlPage.includes("mode=scavenge")) {
            waitForScavengeWidget(injectAutoScavengingOption);
        } else if (urlPage.includes("screen=statue")) {
            $(document).ready(function () {
                injectScriptAutoTrainerPaladin();
            });
        } else if (urlPage.includes('&screen=place&target')) {
            $(document).ready(function () {
                injectAttackCalculations();
            });
        } else if (urlPage.includes('screen=place') && urlPage.includes('mode=command')) {
            $(document).ready(function () {
                if (typeof injectCustomTroopTemplatesFeature === 'function') injectCustomTroopTemplatesFeature();
            });
        } else if (urlPage.includes('screen=place') && urlPage.includes('mode=sim')) {
            $(document).ready(function () {
                if (typeof injectSimulatorPrefill === 'function') injectSimulatorPrefill();
            });
        } else if (urlPage.includes('screen=place') && urlPage.includes('mode=templates')) {
            $(document).ready(function () {
                if (typeof injectCustomTroopTemplatesFeature === 'function') injectCustomTroopTemplatesFeature();
            });
        } else if (urlPage.includes('screen=report') && urlPage.includes('view=')) {
            $(document).ready(function () {
                if (typeof injectReportToSimulatorButton === 'function') injectReportToSimulatorButton();
            });
        } else if (urlPage.includes('screen=train')) {
            $(document).ready(function () {
                injectTrainSectionToggles();
            });
        } else if (urlPage.includes('screen=memo')) {
            $(document).ready(function () {
                if (typeof injectExtraMemoFeature === 'function') injectExtraMemoFeature();
            });
        } else if (urlPage.includes('screen=info_player')) {
            $(document).ready(function () {
                if (settings_cookies.general['show__player_profile_stats'] && typeof injectPlayerProfileTWStats === 'function') injectPlayerProfileTWStats();
                if (typeof injectMapGroupQuickAddLink === 'function') injectMapGroupQuickAddLink('players');
            });
        } else if (urlPage.includes('screen=info_ally')) {
            $(document).ready(function () {
                if (typeof injectMapGroupQuickAddLink === 'function') injectMapGroupQuickAddLink('tribes');
            });
        } else if (urlPage.includes('screen=info_village')) {
            $(document).ready(function () {
                if (typeof injectVillageProfileNote === 'function') injectVillageProfileNote();
                if (typeof injectMapGroupQuickAddLink === 'function') injectMapGroupQuickAddLink('villages');
            });
        } else if (urlPage.includes('screen=am_farm_twp')) {
            $(document).ready(function () {
                if (typeof injectFarmAssistantPage === 'function') injectFarmAssistantPage();
            });
        }
        insertNavigationArrows();
        insertListVillagesPopup();
        injectNavigationBar();
        defineKeyboardShortcuts();
        if (!document.getElementById('settings_popup')) injectScriptSettingsPopUp();
        if (typeof registerWidgetPopupSidebarShortcuts === 'function') registerWidgetPopupSidebarShortcuts();

        if (settings_cookies.general['keep_awake']) {
            const maxInactiveMin = 8;
            runtime?.clearInterval?.('keep-awake:check');
            registerBackground('keep-awake', function (guard) {
                guard?.assertActive?.();
                return scheduleKeepAwakeCheck(maxInactiveMin);
            }, { priority: BACKGROUND_TASK_PRIORITY.HOUSEKEEPING, leaseKey: 'keep-awake' });
        } else if (runtime) {
            runtime.clearInterval('keep-awake:check');
            if (typeof clearPersistedTimeout === 'function') clearPersistedTimeout('keep-awake');
            if (typeof clearPersistedTimeout === 'function') clearPersistedTimeout('keep-awake-confirm');
        }

        const table = $("#overviewtable");

        if (table.length && table.data("ui-sortable") && !table.data('twpf-sortable-wrapped')) {
            table.data('twpf-sortable-wrapped', true);
            const originalSortableUpdate = table.sortable("option", "update");
            const originalSortableStart = table.sortable("option", "start");
            table.sortable("option", "start", function () {
                const draggedItem = arguments[1]?.item?.[0];
                nativeWidgetDragOrigin = draggedItem?.parentNode?.id || null;
                rememberNativeWidgetPosition(draggedItem);
                if (typeof originalSortableStart === "function") {
                    originalSortableStart.apply(this, arguments);
                }
            });
            table.sortable("option", "update", function () {
                const movedItem = arguments[1]?.item?.[0];
                const movedToScriptColumn = movedItem?.parentNode?.id === LEFT_COLUMN;
                const movedFromScriptColumn = nativeWidgetDragOrigin === LEFT_COLUMN;
                if (movedToScriptColumn) {
                    rememberNativeWidgetScriptPosition(movedItem);
                }
                if (movedFromScriptColumn && !movedToScriptColumn) {
                    restoreNativeWidgetPosition(movedItem);
                }
                saveColumnOrder(this);
                if (
                    typeof originalSortableUpdate === "function" &&
                    !movedToScriptColumn &&
                    !movedItem?.classList.contains('script_widget')
                ) {
                    $(this).find('.script_widget').detach();
                    originalSortableUpdate.apply(this, arguments);

                    settings_cookies.widgets.forEach(function (widget) {
                        const functionName = widgetsInjectFunctions[widget.name];
                        if (functionName) {
                            functionName(widget.column);
                        }
                    });
                }
                nativeWidgetDragOrigin = null;
            });

            const scriptColumn = $("#script_column");
            if (scriptColumn.length && scriptColumn.data("ui-sortable")) {
                const originalScriptStart = scriptColumn.sortable("option", "start");
                scriptColumn.sortable("option", "start", function () {
                    const draggedItem = arguments[1]?.item?.[0];
                    nativeWidgetDragOrigin = draggedItem?.parentNode?.id || LEFT_COLUMN;
                    if (typeof originalScriptStart === "function") {
                        originalScriptStart.apply(this, arguments);
                    }
                });
                    scriptColumn.sortable("option", "update", function () {
                        saveColumnOrder(this);
                        nativeWidgetDragOrigin = null;
                    });
            }
        }

        registerBackground('static-game-data', async function (guard) {
            guard?.assertActive?.();
            await storeUnitsInfo();
            guard?.assertActive?.();
            await fetchAndCacheBuildingsData();
        }, { priority: BACKGROUND_TASK_PRIORITY.REFRESH, leaseKey: 'static-game-data' });

        registerBackground('daily-bonus', function (guard) {
            guard?.assertActive?.();
            return checkAndScheduleDailyBonus();
        }, { priority: BACKGROUND_TASK_PRIORITY.AUTOMATIC, leaseKey: 'daily-bonus' });

        registerBackground('paladin', function (guard) {
            guard?.assertActive?.();
            return checkAndSchedulePaladinTrainer();
        }, { priority: BACKGROUND_TASK_PRIORITY.AUTOMATIC, leaseKey: 'paladin' });

    } else {
        //TODO: fix this
        // ter uma espera de 10min pra tentar novamente, caso o user esteja a usar noutro dispositivo, ou caso o user esteja a fazer login no jogo, e o script tente redirecionar para o mundo antes do user estar logado
        // get from TM storage
        let lastWorld = GM_getValue("current_world");
        const targetLink = document.querySelector('.world-select[href*="' + lastWorld + '"]');

        if (targetLink) {
            window.location.href = targetLink.href;
        } else {
            console.warn("No last world was found.");
        }
    }
}

/**
 * Adds a collapse/expand toggle button to each training section (.current_prod_wrapper)
 * on the screen=train page. State persists in localStorage per building.
 */
function injectTrainSectionToggles() {
    const toggleKey = 'train_section_collapsed';
    const collapsed = JSON.parse(localStorage.getItem(toggleKey) || '{}');

    document.querySelectorAll('.current_prod_wrapper').forEach(wrapper => {
        // Identify this section by its inner replace_* div id (e.g. 'barracks', 'stable')
        const replaceDiv = wrapper.querySelector('[id^="replace_"]');
        if (!replaceDiv) return;
        const sectionId = replaceDiv.id.replace('replace_', '');

        // Find the heading row inside the first vis table (the "next unit" row)
        const firstTable = replaceDiv.querySelector('table.vis');
        if (!firstTable) return;
        const headRow = firstTable.querySelector('tr');
        if (!headRow) return;

        // Don't inject twice
        if (headRow.querySelector('.train-section-toggle')) return;

        const isCollapsed = !!collapsed[sectionId];

        // Content to toggle: everything except the first table (i.e. the queue div + footnote)
        const toggleTargets = Array.from(replaceDiv.children).filter(el => el !== firstTable);
        toggleTargets.forEach(el => { el.style.display = isCollapsed ? 'none' : ''; });

        // Build toggle button cell
        const th = document.createElement('th');
        th.style.cssText = 'width:24px;text-align:center;padding:0;background:none';

        const btn = document.createElement('img');
        btn.className = 'train-section-toggle';
        btn.src = `graphic/${isCollapsed ? 'plus' : 'minus'}.png`;
        btn.style.cssText = 'cursor:pointer;display:block;margin:0 auto;';
        btn.title = isCollapsed ? t('button.expand') : t('button.collapse');

        btn.onclick = () => {
            const nowCollapsed = btn.src.includes('minus');
            toggleTargets.forEach(el => { el.style.display = nowCollapsed ? 'none' : ''; });
            btn.src = `graphic/${nowCollapsed ? 'plus' : 'minus'}.png`;
            btn.title = nowCollapsed ? t('button.expand') : t('button.collapse');
            const state = JSON.parse(localStorage.getItem(toggleKey) || '{}');
            if (nowCollapsed) state[sectionId] = 1; else delete state[sectionId];
            localStorage.setItem(toggleKey, JSON.stringify(state));
        };

        th.appendChild(btn);

        // Building name: prefer localized title from overview visual-label, fall back to capitalised id
        const buildingName = document.querySelector('.visual-label-' + sectionId)?.getAttribute('data-title')
            || (sectionId.charAt(0).toUpperCase() + sectionId.slice(1));

        const nameTh = document.createElement('th');
        nameTh.style.cssText = 'text-align:left;padding:0 4px;font-weight:bold;';
        nameTh.textContent = buildingName;

        headRow.prepend(nameTh);
        headRow.prepend(th);
    });
}

// Intercept Barracks/Stable link clicks and redirect to the unified training screen
if (settings_cookies.general['redirect__train_buildings']) {
    document.addEventListener("click", (event) => {
        const link = event.target.closest("a[href], area[href]");

        if (link) {
            const url = new URL(link.href);
            const screenParam = url.searchParams.get("screen");

            if (screenParam === "barracks" || screenParam === "stable") {
                event.preventDefault();
                url.searchParams.set("screen", "train");
                window.location.href = url.href;
            }
        }
    });
}
