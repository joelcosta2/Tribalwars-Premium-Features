(function () {
    'use strict';

    if (window.PremiumFeaturesBotProtection) {
        return;
    }

    const state = {
        active: false,
        observer: null,
        hookTimer: null
    };
    const resumeSignalKey = 'twpf_hard_stop_manual_resume_v1:' +
        encodeURIComponent(window.PremiumFeaturesCoordination?.scope ||
            [location.hostname, window.game_data?.world, window.game_data?.player?.id].join(':'));

    function hasBotProtectionMarkers() {
        return Boolean(
            document.querySelector('td.bot-protection-row') ||
            document.getElementById('botprotection_quest') ||
            document.querySelector('.captcha')
        );
    }

    function canResumeAfterHardStop() {
        return Boolean(window.PremiumFeaturesBackgroundScheduler?.stats?.().hardStopped &&
            !state.active && !hasBotProtectionMarkers());
    }

    function rearmBuildQueueAfterHardStop() {
        const rearm = function () {
            if (window.PremiumFeaturesBackgroundScheduler?.stats?.().hardStopped) return;
            const controller = typeof initializeBuildQueueStateInfrastructure === 'function'
                ? initializeBuildQueueStateInfrastructure() : null;
            const store = window.PremiumFeaturesBuildState;
            if (controller && store?.listVillageIds) {
                controller.bootstrap(store.listVillageIds(), { forceFresh: true, requireNetwork: true });
            }
            if (typeof restoreMissingBuildInstantWakes === 'function') restoreMissingBuildInstantWakes();
        };
        const hydration = window.PremiumFeaturesHydration?.buildQueue;
        if (hydration?.status === 'PENDING' && hydration.promise) {
            hydration.promise.then(rearm).catch(error => console.warn('[TW] Build Queue recovery deferred:', error));
        } else if (hydration?.status !== 'FAILED') {
            rearm();
        }
    }

    function resumeAfterHardStop(fromManualSignal = false) {
        if (!canResumeAfterHardStop()) return false;
        // Coordination can have been stopped by the detector. Restore ownership before allowing
        // the scheduler to dispatch any overdue task; every worker still runs its own final gate.
        window.PremiumFeaturesCoordination?.start?.();
        if (typeof markBuildInstantHardStopRecovery === 'function') markBuildInstantHardStopRecovery();
        window.PremiumFeaturesBackgroundScheduler?.restorePersistedTasks?.();
        if (typeof restoreTimeouts === 'function') restoreTimeouts({ missingOnly: true });
        if (typeof restoreScavengingAutoWakes === 'function') restoreScavengingAutoWakes();
        if (window.PremiumFeaturesBackgroundScheduler?.clearHardStop?.() === false) return false;
        rearmBuildQueueAfterHardStop();
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: 'bot-protection', status: 'MANUAL_RESUME', reason: fromManualSignal ? 'another-tab' : 'user-action'
        });
        if (!fromManualSignal) {
            try { localStorage.setItem(resumeSignalKey, String(Date.now()) + ':' +
                String(window.PremiumFeaturesCoordination?.instanceId || 'local')); }
            catch (error) { console.warn('[TW] Could not signal manual recovery to other tabs:', error); }
        }
        window.refreshHardStopRecoveryControl?.();
        return true;
    }

    function stopHookTimer() {
        if (state.hookTimer) {
            clearInterval(state.hookTimer);
            state.hookTimer = null;
        }
    }

    function stopObserver() {
        if (state.observer) {
            state.observer.disconnect();
            state.observer = null;
        }
    }

    function shouldDisableFeaturesOnDetection() {
        return getSetting('antiBot__disableOnDetection') !== false;
    }

    function blockPremiumFeatures() {
        if (!shouldDisableFeaturesOnDetection()) return;
        if (state.active) return;
        state.active = true;
        console.warn('Bot protection detected. Aborting script execution.');
        stopHookTimer();
        stopObserver();
        $(document).off('partial_reload_end.premium_features');
        window.PremiumFeaturesBackgroundScheduler?.hardStop?.({ source: 'bot-protection' });
        window.PremiumFeaturesCoordination?.broadcast?.('hard-stop', { source: 'bot-protection' });
        window.PremiumFeaturesCoordination?.stop?.();
        window.refreshHardStopRecoveryControl?.();
    }

    function hookBotProtection() {
        if (window.BotProtect && typeof window.BotProtect.show === 'function' && !window.BotProtect.__premiumHooked) {
            const originalShow = window.BotProtect.show.bind(window.BotProtect);
            window.BotProtect.show = function (stateValue) {
                blockPremiumFeatures();
                return originalShow(stateValue);
            };
            window.BotProtect.__premiumHooked = true;
            return true;
        }

        return false;
    }

    function watchForBotProtection() {
        if (!shouldDisableFeaturesOnDetection()) {
            stopHookTimer();
            stopObserver();
            return;
        }

        if (state.active) return;

        if (hasBotProtectionMarkers()) {
            blockPremiumFeatures();
            return;
        }

        if (hookBotProtection()) {
            stopHookTimer();
        } else if (!state.hookTimer) {
            state.hookTimer = setInterval(() => {
                if (hookBotProtection()) {
                    stopHookTimer();
                }
            }, 250);
        }

        if (!state.observer && document.body && window.MutationObserver) {
            state.observer = new MutationObserver(() => {
                if (hasBotProtectionMarkers()) {
                    blockPremiumFeatures();
                }
            });
            state.observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
    }

    window.PremiumFeaturesBotProtection = {
        isActive() {
            return state.active;
        },
        hasCurrentMarkers: hasBotProtectionMarkers,
        canResumeAfterHardStop,
        resumeAfterHardStop,
        watch() {
            watchForBotProtection();
        },
        block() {
            blockPremiumFeatures();
        }
    };

    const onManualResumeSignal = function (event) {
        if (event.key === resumeSignalKey && event.newValue) resumeAfterHardStop(true);
    };
    if (window.PremiumFeaturesRuntimeRegistry?.addEventListener) {
        window.PremiumFeaturesRuntimeRegistry.addEventListener(
            'bot-protection:manual-resume-storage', window, 'storage', onManualResumeSignal
        );
    } else {
        window.addEventListener?.('storage', onManualResumeSignal);
    }

    window.PremiumFeaturesCoordination?.subscribe?.('hard-stop', function () {
        window.PremiumFeaturesBackgroundScheduler?.hardStop?.({ source: 'remote-hard-stop' });
        window.PremiumFeaturesCoordination?.stop?.();
        blockPremiumFeatures();
    });

    if (document.body) {
        watchForBotProtection();
    } else {
        document.addEventListener('DOMContentLoaded', watchForBotProtection, { once: true });
    }
})();
