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

    function isOutsideViewport(element) {
        const rect = element.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        return rect.width <= 0 || rect.height <= 0
            || rect.right <= 0 || rect.left >= viewportWidth
            || rect.bottom <= 0 || rect.top >= viewportHeight;
    }

    function restoreQuestLogPosition(target) {
        const existingPortal = document.getElementById('twpf-pinned-sidebar');
        if (!existingPortal || !questLogOriginalParent) return;

        target.classList.remove('questlog-pin-left');
        questLogOriginalParent.insertBefore(target, questLogOriginalNextSibling);
        existingPortal.remove();
        questLogOriginalParent = null;
        questLogOriginalNextSibling = null;
    }

    function isMainLayoutWithoutSidebarSpace(target) {
        const mainLayout = document.getElementById('main_layout');
        if (!mainLayout) return false;

        const mainLayoutRect = mainLayout.getBoundingClientRect();
        const sidebarRect = target.getBoundingClientRect();
        return mainLayoutRect.left < sidebarRect.width;
    }

    function updateQuestLogPosition(target) {
        if (!target.classList.contains('questlog')) return;

        restoreQuestLogPosition(target);
        const shouldPinLeft = isMainLayoutWithoutSidebarSpace(target)
            || isOutsideViewport(target);
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
        return target;
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
                injectAll();
            }
        });
    }

    window.addEventListener('resize', schedulePositionUpdate);
    window.addEventListener('scroll', schedulePositionUpdate, true);

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
