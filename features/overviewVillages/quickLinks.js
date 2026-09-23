// Second row of the popup: widgets rendered in an overlay instead of a plain navigation link.
const VILLAGE_QUICKLINKS_WIDGETS = [
    { key: 'training', label: t('button.recruit'), img: 'graphic/buildings/barracks.webp', open: openVillageRecruitOverlay },
    { key: 'queue', label: t('buildQueue.title'), iconClass: 'hammer-icon', open: openVillageBuildQueueOverlay }
];

function getOverviewVillagesQuickLinksSetting() {
    return settings_cookies.general['show__overview_villages_quicklinks'];
}

function isOverviewVillagesQuickLinksEnabled() {
    const setting = getOverviewVillagesQuickLinksSetting();
    return typeof setting === 'object' ? !!setting.enabled : !!setting;
}

function getOverviewVillagesQuickLinksMode() {
    const setting = getOverviewVillagesQuickLinksSetting();
    if (!setting || typeof setting !== 'object') return 'custom';
    return setting.source === 'navbar' ? 'navbar' : 'custom';
}

function getOverviewVillagesQuicklinksWidgets() {
    const setting = getOverviewVillagesQuickLinksSetting();
    if (!setting || typeof setting !== 'object') return VILLAGE_QUICKLINKS_WIDGETS;
    return VILLAGE_QUICKLINKS_WIDGETS.filter(function (widget) {
        return setting[widget.key] !== false;
    });
}

function getRenderedQuickbarItems() {
    return Array.from(document.querySelectorAll('#quickbar_contents .quickbar_link')).map(function (link) {
        const icon = link.querySelector('img');
        return {
            label: link.textContent.trim(),
            href: link.href,
            img: icon ? (icon.getAttribute('data-src') || icon.getAttribute('src') || icon.src) : ''
        };
    }).filter(function (item) { return !!item.href; });
}

function rewriteVillageInHref(href, villageId) {
    if (typeof href === 'string' && href.includes('{game}') && typeof getVillageLinkBase === 'function') {
        const suffix = href.replace('{game}', '');
        const base = getVillageLinkBase(villageId);
        return base + (base.endsWith('&') && suffix.startsWith('&') ? suffix.slice(1) : suffix);
    }

    try {
        const url = new URL(href, window.location.origin);
        if (url.searchParams.has('village')) {
            url.searchParams.set('village', villageId);
        }
        return url.toString();
    } catch (e) {
        return href.replace(/([?&])village=\d+/, '$1village=' + villageId);
    }
}

function getOverviewVillagesQuickLinksItems(villageId) {
    if (getOverviewVillagesQuickLinksMode() === 'navbar') {
        const renderedItems = getRenderedQuickbarItems();
        if (renderedItems.length) {
            return renderedItems.map(function (item) {
                return Object.assign({}, item, {
                    href: rewriteVillageInHref(item.href, villageId)
                });
            });
        }
    }

    const setting = getOverviewVillagesQuickLinksSetting();
    const customItems = setting && typeof setting === 'object' && Array.isArray(setting.items)
        ? setting.items
        : [];

    return customItems.filter(function (item) {
        return item && item.label && item.href;
    }).map(function (item) {
        return Object.assign({}, item, {
            href: rewriteVillageInHref(item.href, villageId),
            img: getOverviewQuickLinkImageUrl(item.img)
        });
    });
}

function getOverviewQuickLinkImageUrl(image) {
    if (!image) return 'https://dspt.innogamescdn.com/asset/d4119ec5/graphic/premium_plus.webp';
    if (/^(https?:)?\/\//.test(image)) return image;

    const imagePath = image.replace(/^\/?graphic\//, '');
    return typeof _getNavAssetBase === 'function'
        ? _getNavAssetBase() + imagePath
        : '/graphic/' + imagePath;
}

function appendQuickLinkIcon(container, item) {
    const link = document.createElement('a');
    link.href = item.href;
    link.title = item.label || '';

    const img = document.createElement('img');
    img.src = getOverviewQuickLinkImageUrl(item.img);
    img.style.cssText = 'width:18px; height:18px;';
    link.appendChild(img);

    container.appendChild(link);
}

/**
 * Opens (or toggles closed) a floating popup near anchorEl with quick-navigation icons
 * resolved from the selected source, plus a separate row of widget shortcuts (currently just
 * Recruit) below a horizontal separator. Mirrors the floating popup_style picker pattern used
 * by _openNavIconPicker in navigationBar.js: fixed-position div clamped to the
 * viewport, closed by re-clicking the anchor, picking a building icon, or clicking outside.
 * Picking a widget icon closes this popup and opens its overlay instead.
 * @param {string|number} villageId
 * @param {HTMLElement} anchorEl - The clicked quick-links icon.
 */
function openVillageQuickLinksPopup(villageId, anchorEl) {
    const existing = document.querySelector('.village-quicklinks-popup');
    if (existing) {
        const wasForThisAnchor = existing.__quickLinksAnchor === anchorEl;
        existing.remove();
        if (wasForThisAnchor) return;
    }

    const popup = document.createElement('div');
    popup.className = 'village-quicklinks-popup popup_style';
    popup.style.cssText = 'position:fixed; z-index:20000; display:inline-flex; flex-direction:column; width:max-content; max-width:calc(100vw - 16px);';
    popup.__quickLinksAnchor = anchorEl;

    const content = document.createElement('div');
    content.className = 'popup_content village-quicklinks-content';

    getOverviewVillagesQuickLinksItems(villageId).forEach(function (item) {
        appendQuickLinkIcon(content, item);
    });

    const widgets = getOverviewVillagesQuicklinksWidgets();
    const widgetsContent = document.createElement('div');
    widgetsContent.className = 'popup_content';
    widgetsContent.style.cssText = 'padding:8px; display:flex; gap:6px; justify-content:center; flex-wrap:wrap; width:max-content; max-width:calc(100vw - 32px);';

    widgets.forEach(function (widget) {
        const link = document.createElement('a');
        link.href = '#';
        link.title = widget.label;
        link.addEventListener('click', function (event) {
            event.preventDefault();
            popup.remove();
            widget.open(villageId);
        });

        if (widget.iconClass) {
            const icon = document.createElement('span');
            icon.className = widget.iconClass;
            icon.style.cssText = 'display:inline-block; width:18px; height:18px;';
            link.appendChild(icon);
        } else {
            const img = document.createElement('img');
            img.src = widget.img;
            img.style.cssText = 'width:18px; height:18px;';
            link.appendChild(img);
        }

        widgetsContent.appendChild(link);
    });

    popup.appendChild(content);
    if (widgets.length) {
        const separator = document.createElement('div');
        separator.style.cssText = 'border-top:1px solid #7d510f; margin:0 8px;';
        popup.appendChild(separator);
        popup.appendChild(widgetsContent);
    }
    document.body.appendChild(popup);

    const rect = anchorEl.getBoundingClientRect();
    const popupWidth = popup.getBoundingClientRect().width;
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + popupWidth > window.innerWidth) left = window.innerWidth - popupWidth - 8;
    if (left < 0) left = 4;
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;

    const closeOnOutside = (event) => {
        if (!popup.contains(event.target) && event.target !== anchorEl) {
            popup.remove();
            document.removeEventListener('mousedown', closeOnOutside);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', closeOnOutside), 0);
}

/**
 * Builds a recruit context for a village that ISN'T necessarily the currently loaded page (see
 * createLiveRecruitContext in recruitTroops.js for the sidebar-widget counterpart):
 * resources come from the static villageResourceSnapshots cache (populated by fetchTrainInfo())
 * instead of live DOM, and there's no MutationObserver/village-poll since nothing here ticks.
 * @param {string|number} villageId
 * @param {HTMLElement} containerEl
 * @returns {Object} ctx
 */
function createOverlayRecruitContext(villageId, containerEl) {
    const ctx = {
        villageId,
        linkBase: getVillageLinkBase(villageId),
        containerEl,
        isLive: false,
        pendingDeduction: { wood: 0, stone: 0, iron: 0 },
        calcDebounceTimer: null,
        recruitUncertain: loadRecruitUncertain(villageId),
        recruitMutationState: loadRecruitUncertain(villageId) ? 'UNCERTAIN' : null,
        getResources: () => {
            const snap = villageResourceSnapshots[villageId];
            if (!snap) return null;
            return {
                wood: Math.max(0, snap.wood - ctx.pendingDeduction.wood),
                stone: Math.max(0, snap.stone - ctx.pendingDeduction.stone),
                iron: Math.max(0, snap.iron - ctx.pendingDeduction.iron),
                pop: Math.max(0, snap.popMax - snap.pop)
            };
        },
        deductResources: (cost) => {
            const snap = villageResourceSnapshots[villageId];
            if (!snap) return;
            snap.wood = Math.max(0, snap.wood - cost.wood);
            snap.stone = Math.max(0, snap.stone - cost.stone);
            snap.iron = Math.max(0, snap.iron - cost.iron);
        },
        refreshData: (callback) => fetchTrainInfo(callback, villageId, getVillageLinkBase(villageId), false)
    };
    return ctx;
}

/**
 * Makes an overlay movable by dragging its header, keeping the whole box inside the viewport.
 * Pointer Events cover mouse, touch and stylus without making the overlay content draggable.
 * @param {HTMLElement} box
 * @param {HTMLElement} header
 */
function makeOverlayDraggable(box, header) {
    header.style.cursor = 'grab';
    header.style.touchAction = 'none';

    let dragState = null;

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    header.addEventListener('pointerdown', function (event) {
        if (event.button !== 0 || event.target.closest('a, button, input, textarea, select')) return;

        const rect = box.getBoundingClientRect();
        box.style.transform = 'none';
        box.style.left = rect.left + 'px';
        box.style.top = rect.top + 'px';
        dragState = {
            pointerId: event.pointerId,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            width: rect.width,
            height: rect.height
        };
        header.setPointerCapture(event.pointerId);
        header.style.cursor = 'grabbing';
        event.preventDefault();
    });

    header.addEventListener('pointermove', function (event) {
        if (!dragState || event.pointerId !== dragState.pointerId) return;

        const maxLeft = Math.max(0, window.innerWidth - dragState.width);
        const maxTop = Math.max(0, window.innerHeight - dragState.height);
        box.style.left = clamp(event.clientX - dragState.offsetX, 0, maxLeft) + 'px';
        box.style.top = clamp(event.clientY - dragState.offsetY, 0, maxTop) + 'px';
        event.preventDefault();
    });

    function stopDragging(event) {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
        dragState = null;
        header.style.cursor = 'grab';
    }

    header.addEventListener('pointerup', stopDragging);
    header.addEventListener('pointercancel', stopDragging);
}

function getPopupVillageNavigationList(currentVillageId) {
    let villages = [];
    try {
        villages = JSON.parse(localStorage.getItem('villages_info') || '[]');
    } catch (e) {
        villages = [];
    }

    if (typeof getVillageNavigationList === 'function') {
        villages = getVillageNavigationList(villages);
    }

    const currentId = String(currentVillageId);
    if (!villages.some(village => getVillageNavigationId(village) === currentId)) {
        const currentVillage = { id: currentId, url: 'game.php?village=' + currentId };
        villages = [currentVillage].concat(villages);
    }
    return villages;
}

function createVillagePopupController({ backdrop, header, title, villageId, render }) {
    const titleElement = document.createElement('span');
    const navigationElement = document.createElement('span');
    navigationElement.style.cssText = 'display:inline-flex; align-items:center; gap:4px; margin-left:10px;';

    const previousButton = document.createElement('a');
    previousButton.href = '#';
    previousButton.className = 'village_switch_link';
    previousButton.title = t('villageArrows.previous');
    previousButton.dataset.title = t('villageArrows.previous');
    previousButton.setAttribute('aria-label', t('villageArrows.previous'));
    const previousIcon = document.createElement('span');
    previousIcon.className = 'arrowLeft';
    previousButton.appendChild(previousIcon);

    const nextButton = document.createElement('a');
    nextButton.href = '#';
    nextButton.className = 'village_switch_link';
    nextButton.title = t('villageArrows.next');
    nextButton.dataset.title = t('villageArrows.next');
    nextButton.setAttribute('aria-label', t('villageArrows.next'));
    const nextIcon = document.createElement('span');
    nextIcon.className = 'arrowRight';
    nextButton.appendChild(nextIcon);

    navigationElement.append(previousButton, nextButton);
    header.appendChild(titleElement);
    header.appendChild(navigationElement);

    let currentId = String(villageId);
    let renderToken = 0;
    let previousVillages = [];
    let nextVillages = [];

    function isEditableTarget(target) {
        return target instanceof HTMLInputElement
            || target instanceof HTMLTextAreaElement
            || target instanceof HTMLSelectElement
            || target.isContentEditable;
    }

    function handleKeyboardNavigation(event) {
        if (!backdrop.isConnected || event.defaultPrevented || isEditableTarget(event.target)) return;

        const key = event.key.toLowerCase();
        if (key !== 'a' && key !== 'd') return;

        event.preventDefault();
        event.stopPropagation();
        navigateTo(key === 'a' ? previousVillages[0] : nextVillages[0]);
    }

    document.addEventListener('keydown', handleKeyboardNavigation, true);

    function updateHeader() {
        titleElement.textContent = title + ' \u2014 ' + (typeof getVillageName === 'function' ? getVillageName(currentId) : currentId);
        const villages = getPopupVillageNavigationList(currentId);
        const currentIndex = villages.findIndex(village => getVillageNavigationId(village) === currentId);
        previousVillages = villages.length > 1
            ? [villages[(currentIndex - 1 + villages.length) % villages.length]]
            : [];
        nextVillages = villages.length > 1
            ? [villages[(currentIndex + 1) % villages.length]]
            : [];
        const navigationDisabled = villages.length < 2;
        previousButton.setAttribute('aria-disabled', String(navigationDisabled));
        nextButton.setAttribute('aria-disabled', String(navigationDisabled));
        previousButton.style.pointerEvents = navigationDisabled ? 'none' : '';
        nextButton.style.pointerEvents = navigationDisabled ? 'none' : '';
        previousButton.style.opacity = navigationDisabled ? '0.5' : '';
        nextButton.style.opacity = navigationDisabled ? '0.5' : '';
        previousButton.onclick = (event) => {
            event.preventDefault();
            navigateTo(previousVillages[0]);
        };
        nextButton.onclick = (event) => {
            event.preventDefault();
            navigateTo(nextVillages[0]);
        };
    }

    function navigateTo(village) {
        if (!village) return;
        const nextId = getVillageNavigationId(village);
        if (nextId === currentId) return;
        currentId = nextId;
        renderToken++;
        updateHeader();
        render(currentId, renderToken);
    }

    updateHeader();
    return {
        get villageId() { return currentId; },
        destroy() { document.removeEventListener('keydown', handleKeyboardNavigation, true); },
        isCurrent(villageIdToCheck, token) {
            return backdrop.isConnected && String(villageIdToCheck) === currentId && token === renderToken;
        },
        renderToken: () => renderToken
    };
}

function registerWidgetPopupSidebarShortcuts() {
    if (!window.SidebarIcons) return;

    const setting = settings_cookies.general.show__widget_popup_shortcuts || {};
    const registerShortcut = (id, enabled, title, iconClass, open) => {
        if (enabled) {
            SidebarIcons.register(id, {
                iconClass,
                title,
                ariaLabel: title,
                order: 90,
                onClick: () => open(game_data?.village?.id)
            });
        } else {
            SidebarIcons.remove(id);
        }
    };

    const shortcutsEnabled = setting.enabled !== false;
    registerShortcut('widget-recruit-popup', shortcutsEnabled && setting.training !== false, t('button.recruit'), 'quest sidebar-recruit-icon sidebar-icon-offset', openVillageRecruitOverlay);
    registerShortcut('widget-build-queue-popup', shortcutsEnabled && setting.queue !== false, t('buildQueue.title'), 'quest hammer-icon sidebar-icon-offset', openVillageBuildQueueOverlay);
    let worldSettings = null;
    try {
        worldSettings = JSON.parse(localStorage.getItem('world_settings_' + (game_data?.world || window.location.hostname)) || 'null');
    } catch { }
    registerShortcut('widget-coin-minting-popup', setting.coinMinting !== false && coinMintingCanUse(worldSettings), t('coinMinting.title'), 'quest sidebar-coin-minting-icon sidebar-icon-offset', openCoinMintingPopup);
}

/**
 * Opens a modal overlay showing the shared recruit form (see renderRecruitForm in
 * recruitTroops.js) for the given village, always fetching fresh training data on
 * open. Replaces any existing overlay if one is already open. Triggered from the "widgets" row
 * of openVillageQuickLinksPopup.
 * @param {string|number} villageId
 */
function openVillageRecruitOverlay(villageId) {
    const existingBackdrop = document.querySelector('.village-recruit-overlay-backdrop');
    existingBackdrop?.__villagePopupController?.destroy();
    existingBackdrop?.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'village-recruit-overlay-backdrop';
    backdrop.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:20001; display:block;';

    const box = document.createElement('div');
    box.className = 'popup_style';
    box.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); max-width:95vw; max-height:85vh; overflow-y:auto; z-index:20002; display:block;';

    const header = document.createElement('div');
    header.className = 'popup_menu';
    header.style.cssText = 'font-size:15px; font-weight:bold;';
    const closeX = document.createElement('a');
    closeX.href = '#';
    closeX.textContent = t('button.close');
    closeX.style.cssText = 'float:right; cursor:pointer; font-weight:bold; text-decoration:none; margin-left:15px;';
    let controller;
    closeX.addEventListener('click', function (event) { event.preventDefault(); controller.destroy(); backdrop.remove(); });
    controller = createVillagePopupController({
        backdrop,
        header,
        title: t('button.recruit'),
        villageId,
        render: (nextVillageId, token) => {
            content.replaceChildren(createWidgetLoadingElement('80px'));
            const nextContext = createOverlayRecruitContext(nextVillageId, content);
            nextContext.refreshData(function () {
                if (!controller.isCurrent(nextVillageId, token)) return;
                renderRecruitForm(nextContext);
            });
        }
    });
    backdrop.__villagePopupController = controller;
    header.appendChild(closeX);

    const content = document.createElement('div');
    content.className = 'popup_content';
    content.style.cssText = 'padding:10px;';
    content.appendChild(createWidgetLoadingElement('80px'));

    box.appendChild(header);
    box.appendChild(content);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    makeOverlayDraggable(box, header);

    backdrop.addEventListener('mousedown', function (event) {
        if (event.target === backdrop) { controller.destroy(); backdrop.remove(); }
    });

    controller.renderToken();
    content.replaceChildren(createWidgetLoadingElement('80px'));
    const ctx = createOverlayRecruitContext(controller.villageId, content);
    ctx.refreshData(function () {
        if (!controller.isCurrent(controller.villageId, 0)) return;
        renderRecruitForm(ctx);
    });
}

/**
 * Fetches a fresh /main page for the village and (re)renders the overlay's queue icons + full
 * upgrade-button list (see buildBuildQueueContent/injectAtiveQueueList/injectFakeQueueList in
 * extraBuildQueue.js). Re-run after every add/remove/cancel action inside the
 * overlay so it reflects the server's latest state \u2014 this village isn't the loaded page, so
 * nothing here ticks or refreshes on its own like the sidebar widget does.
 * @param {string|number} villageId
 * @param {HTMLElement} content
 * @param {Function} [isRenderCurrent] - Returns whether the response may update the overlay.
 */
function renderVillageBuildQueueOverlayFromState(villageId, content, isRenderCurrent, doc) {
    if (typeof isRenderCurrent === 'function' && !isRenderCurrent(villageId)) return;
    const catalog = window.PremiumFeaturesBuildState?.get?.(villageId)?.official?.catalog ||
        (typeof createBuildQueueCatalog === 'function' ? createBuildQueueCatalog(doc) : getAllBuildingsImages(doc));
    const availableBuildingsImgs = catalog.availableBuildingsImgs || [];
    const availableBuildingLevels = catalog.availableBuildingLevels || [];
    const allBuildingsImgs = catalog.allBuildingsImgs || [];
    const allAvailableBuildingLevels = catalog.allAvailableBuildingLevels || [];
    const queueBuildIdsActive = bqGet('building_queue_active', villageId) || [];
    const resources = window.PremiumFeaturesBuildState?.get?.(villageId)?.resources || readResourcesFromDoc(doc);

    refreshOverviewVillagesBuildQueueRow(villageId, doc, allBuildingsImgs);
    const onAction = function () {
        renderVillageBuildQueueOverlayFromState(villageId, content, isRenderCurrent, doc);
    };
    const buildQueueElment = document.createElement('td');
    injectAtiveQueueList(queueBuildIdsActive, buildQueueElment, villageId, doc, onAction);
    injectFakeQueueList(queueBuildIdsActive, buildQueueElment, allBuildingsImgs, villageId, doc, resources, onAction);
    const buildDiv = settings_cookies.general['show__building_queue_all']
        ? buildBuildQueueContent(allBuildingsImgs, availableBuildingsImgs, allAvailableBuildingLevels, buildQueueElment, villageId, doc, resources, onAction)
        : buildBuildQueueContent(availableBuildingsImgs, availableBuildingsImgs, availableBuildingLevels, buildQueueElment, villageId, doc, resources, onAction);
    buildDiv.dataset.twpfFreshness = Date.now() - Number(window.PremiumFeaturesBuildState?.get?.(villageId)?.official?.fetchedAt || 0) <= 15000
        ? 'fresh'
        : 'stale';
    content.replaceChildren(buildDiv);
}

function renderVillageBuildQueueOverlay(villageId, content, isRenderCurrent) {
    fetchVillageMainPage(villageId)
        .then(({ doc }) => {
            if (typeof isRenderCurrent === 'function' && !isRenderCurrent(villageId)) return;
            if (typeof observeBuildQueueDocument === 'function') observeBuildQueueDocument(doc, villageId, 'manual-overlay');
            else parseAndStoreQueueState(doc, villageId);
            renderVillageBuildQueueOverlayFromState(villageId, content, isRenderCurrent, doc);
        })
        .catch(() => {
            if (typeof isRenderCurrent === 'function' && !isRenderCurrent(villageId)) return;
            content.textContent = t('overviewVillages.buildQueueLoadError');
        });
}

/**
 * Opens a modal overlay showing the shared build-queue widget content (queue icons + full
 * upgrade-button list, same as the sidebar widget) for the given village, always fetching
 * fresh data on open. Replaces any existing overlay if one is already open. Triggered from the
 * "widgets" row of openVillageQuickLinksPopup. Unlike the read-only overview_villages column,
 * this overlay is fully interactive (add/remove/cancel) since the user opened it deliberately
 * for this specific village.
 * @param {string|number} villageId
 */
function openVillageBuildQueueOverlay(villageId) {
    const existingBackdrop = document.querySelector('.village-buildqueue-overlay-backdrop');
    existingBackdrop?.__villagePopupController?.destroy();
    existingBackdrop?.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'village-buildqueue-overlay-backdrop';
    backdrop.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9000; display:block;';

    const box = document.createElement('div');
    box.className = 'popup_style';
    box.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); max-width:95vw; max-height:85vh; overflow-y:auto; z-index:9001; display:block;';

    const header = document.createElement('div');
    header.className = 'popup_menu';
    header.style.cssText = 'font-size:15px; font-weight:bold;';
    const closeX = document.createElement('a');
    closeX.href = '#';
    closeX.textContent = t('button.close');
    closeX.style.cssText = 'float:right; cursor:pointer; font-weight:bold; text-decoration:none; margin-left:15px;';
    closeX.addEventListener('click', function (event) { event.preventDefault(); controller.destroy(); backdrop.remove(); });
    let controller;
    controller = createVillagePopupController({
        backdrop,
        header,
        title: t('buildQueue.title'),
        villageId,
        render: (nextVillageId, token) => {
            content.replaceChildren(createWidgetLoadingElement('80px'));
            renderVillageBuildQueueOverlay(nextVillageId, content, (renderedVillageId) => {
                if (!controller.isCurrent(renderedVillageId, token)) return false;
                return true;
            });
        }
    });
    backdrop.__villagePopupController = controller;
    header.appendChild(closeX);

    const content = document.createElement('div');
    content.className = 'popup_content';
    content.style.cssText = 'padding:10px;';
    content.appendChild(createWidgetLoadingElement('80px'));

    box.appendChild(header);
    box.appendChild(content);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    makeOverlayDraggable(box, header);

    backdrop.addEventListener('mousedown', function (event) {
        if (event.target === backdrop) { controller.destroy(); backdrop.remove(); }
    });

    renderVillageBuildQueueOverlay(controller.villageId, content, (renderedVillageId) => controller.isCurrent(renderedVillageId, 0));
}

/**
 * Adds a small icon to each village row of #production_table (screen=overview_villages),
 * absolutely positioned against the right edge of the village-name cell. Absolute (not float)
 * so it never wraps onto its own line when the name/relic/support icons already fill the row's
 * width — a float can get pushed down if it doesn't fit on the current line. Clicking it opens
 * a popup with quick links to that village's Main, Market, Train and Academy buildings (see
 * openVillageQuickLinksPopup).
 */
function getOverviewVillagesNotepadText(villageId) {
    try {
        const stored = typeof getNotepadStorage === 'function'
            ? getNotepadStorage()
            : notepadMemoryCache;

        if (Array.isArray(stored)) {
            return stored[Number(villageId)] || '';
        }

        return stored?.[String(villageId)] || '';
    } catch (e) {
        return '';
    }
}

function getOverviewVillagesNotepadTooltipHtml(villageId) {
    const noteText = getOverviewVillagesNotepadText(villageId);

    if (!noteText) {
        return '<div style="color:#aaa;">Sem nota.</div>';
    }

    return '<div style="white-space:pre-wrap;">' + convertBBCodeToHTML(noteText) + '</div>';
}

function appendOverviewVillageQuickLinksIcons(cell, villageId) {
    if (!cell || !isOverviewVillagesQuickLinksEnabled()) return;

    cell.style.position = 'relative';
    cell.style.paddingRight = '34px';

    let noteIcon = cell.querySelector('.overview-notepad-icon');
    if (!noteIcon) {
        noteIcon = document.createElement('span');
        noteIcon.className = 'note-icon village_note overview-notepad-icon';
        noteIcon.style.cssText = 'position:absolute; right:18px; top:50%; transform:translateY(-50%); width:15px; height:15px; cursor:help;';
        cell.appendChild(noteIcon);
    }
    noteIcon.setAttribute('data-tooltip-tpl', getOverviewVillagesNotepadTooltipHtml(villageId));
    if (noteIcon.dataset.quickLinksBound !== 'true') {
        noteIcon.addEventListener('mouseenter', function (event) {
            noteIcon.setAttribute('data-tooltip-tpl', getOverviewVillagesNotepadTooltipHtml(villageId));
            toggleTooltip(event.target, true);
        });
        noteIcon.addEventListener('mouseleave', function (event) {
            toggleTooltip(event.target, false);
        });
        noteIcon.dataset.quickLinksBound = 'true';
    }

    let icon = cell.querySelector('.overview-quicklinks-icon');
    if (!icon) {
        icon = document.createElement('img');
        icon.className = 'overview-quicklinks-icon';
        icon.src = 'graphic/ally_forum.png';
        icon.title = t('overviewVillages.quickAccessBuildings');
        icon.style.cssText = 'position:absolute; right:2px; top:50%; transform:translateY(-50%); width:12px; height:12px; cursor:pointer;';
        cell.appendChild(icon);
    }
    if (icon.dataset.quickLinksBound !== 'true') {
        icon.addEventListener('click', function (event) {
            event.preventDefault();
            openVillageQuickLinksPopup(villageId, icon);
        });
        icon.dataset.quickLinksBound = 'true';
    }
}

function injectOverviewVillagesQuickLinksIcon() {
    if (!isOverviewVillagesQuickLinksEnabled()) return;

    const table = document.getElementById('production_table');
    if (!table) {
        if (!window.overviewVillagesQuickLinksRetry) {
            let attempts = 0;
            const retry = function () {
                window.overviewVillagesQuickLinksRetry = null;
                const readyTable = document.querySelector('#production_table tbody tr .quickedit-vn[data-id]');
                if (readyTable) {
                    injectOverviewVillagesQuickLinksIcon();
                    return;
                }
                if (attempts++ >= 60) return;
                window.overviewVillagesQuickLinksRetry = requestAnimationFrame(retry);
            };
            window.overviewVillagesQuickLinksRetry = requestAnimationFrame(retry);
        }
        return;
    }

    table.querySelectorAll('tbody tr').forEach(function (row) {
        const quickeditVn = row.querySelector('.quickedit-vn[data-id]');
        const villageId = quickeditVn?.getAttribute('data-id');
        const cell = quickeditVn?.closest('td');
        if (!villageId || !cell) return;
        appendOverviewVillageQuickLinksIcons(cell, villageId);
    });
}
