/**
 * Registry and renderer for icons injected into the game's lateral sidebar.
 * Features register an item once; repeated start() calls safely re-render it.
 */
(function () {
    'use strict';

    const registeredIcons = new Map();
    let questLogOriginalParent = null;
    let questLogOriginalNextSibling = null;

    function getSidebarTarget() {
        const questLog = document.querySelector('.questlog');
        if (questLog) return questLog;

        return document.querySelector('.maincell')?.children[0] || null;
    }

    function isOutsideHorizontalViewport(element) {
        const rect = element.getBoundingClientRect();
        const viewportWidth = window.innerWidth;

        return rect.width <= 0 || rect.height <= 0
            || rect.right <= 0 || rect.left >= viewportWidth;
    }

    function isMainLayoutWithoutSidebarSpace() {
        const mainLayout = document.getElementById('main_layout');
        if (!mainLayout) return false;

        const styles = window.getComputedStyle(mainLayout);
        return parseFloat(styles.marginLeft) === 0;
    }

    function updateQuestLogPosition(target) {
        if (!target.classList.contains('questlog')) return;

        const shouldPinLeft = isMainLayoutWithoutSidebarSpace()
            || isOutsideHorizontalViewport(target);
        target.classList.toggle('questlog-pin-left', shouldPinLeft);
    }

    function getRenderTarget(target) {
        const pinned = target.classList.contains('questlog-pin-left');
        const existingPortal = document.getElementById('twpf-pinned-sidebar');

        if (!pinned) {
            existingPortal?.remove();
            if (questLogOriginalParent) {
                questLogOriginalParent.insertBefore(target, questLogOriginalNextSibling);
                questLogOriginalParent = null;
                questLogOriginalNextSibling = null;
            }
            return target;
        }

        if (existingPortal) return target;

        const portal = document.createElement('div');
        portal.id = 'twpf-pinned-sidebar';
        portal.className = 'twpf-pinned-sidebar';
        questLogOriginalParent = target.parentNode;
        questLogOriginalNextSibling = target.nextSibling;
        document.body.appendChild(portal);
        portal.appendChild(target);
        return portal;
    }

    let positionUpdatePending = false;

    function schedulePositionUpdate() {
        if (positionUpdatePending) return;
        positionUpdatePending = true;

        window.requestAnimationFrame(() => {
            positionUpdatePending = false;
            const target = getSidebarTarget();
            if (target) {
                updateQuestLogPosition(target);
                // Moving the existing quest-log node between its normal parent and the fixed portal
                // keeps every icon (including Settings) at a stable horizontal position. Recreating
                // all icons on every scroll caused needless DOM churn and transient state loss.
                getRenderTarget(target);
            }
        });
    }

    // A vertical scroll cannot make more horizontal room for the sidebar. Repositioning on
    // scroll could move the Settings control between its normal parent and the fixed portal,
    // and also used to remount icons. A real viewport/layout resize remains the relevant signal.
    window.addEventListener('resize', schedulePositionUpdate);

    function createIconElement(config) {
        if (typeof config.createIcon === 'function') {
            return config.createIcon();
        }

        const icon = document.createElement(config.iconTag || 'div');
        if (config.iconClass) icon.className = config.iconClass;
        if (config.iconSrc) {
            icon.src = config.iconSrc;
            if (config.iconAlt !== undefined) icon.alt = config.iconAlt;
        }
        return icon;
    }

    function renderIcon(id, config, target) {
        const item = document.createElement('div');
        item.id = config.wrapperId || `sidebar-icon-${id}`;
        item.className = `sidebar-icon ${config.wrapperClass || ''}`.trim();
        item.dataset.sidebarIcon = id;
        if (!target.classList.contains('questlog')) {
            item.classList.add('sidebar-icon-fixed');
        }
        if (config.title) item.title = config.title;
        if (config.ariaLabel) item.setAttribute('aria-label', config.ariaLabel);
        item.appendChild(createIconElement(config));

        if (typeof config.onClick === 'function') {
            item.addEventListener('click', config.onClick);
        }

        Array.from(document.querySelectorAll('[data-sidebar-icon]'))
            .filter(element => element.dataset.sidebarIcon === id)
            .forEach(element => element.remove());
        target.appendChild(item);
    }

    function injectAll() {
        const target = getSidebarTarget();
        if (!target) return false;

        updateQuestLogPosition(target);
        const renderTarget = getRenderTarget(target);
        const icons = Array.from(registeredIcons.entries())
            .sort(([, first], [, second]) => (first.order || 0) - (second.order || 0));

        icons.forEach(([id, config]) => renderIcon(id, config, renderTarget));
        return true;
    }

    window.SidebarIcons = {
        register(id, config) {
            if (!id || !config) return;
            registeredIcons.set(id, config);
            injectAll();
        },

        remove(id) {
            registeredIcons.delete(id);
            Array.from(document.querySelectorAll('[data-sidebar-icon]'))
                .find(element => element.dataset.sidebarIcon === id)?.remove();
        },

        injectAll
    };
})();
