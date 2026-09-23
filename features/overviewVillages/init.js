// Shared helpers and page-level state for the overview villages feature.

function formatQueueRemaining(ms) {
	if (!ms || ms <= 0) return null;
	const s = Math.floor((ms / 1000) % 60);
	const m = Math.floor((ms / 1000 / 60) % 60);
	const h = Math.floor((ms / 1000 / 60 / 60) % 24);
	const d = Math.floor(ms / 1000 / 60 / 60 / 24);
	return (d > 0 ? d + 'd ' : '') + (h > 0 ? h + 'h ' : '') + (m > 0 ? m + 'm ' : '') + s + 's';
}

function createOverviewVillagesLoadingImage() {
	const image = document.createElement('img');
	image.alt = '';
	image.src = 'https://dsbr.innogamescdn.com/asset/d624386d/graphic/loading2.gif';
	image.style.cssText = 'vertical-align: middle;';
	return image;
}

function createOverviewVillagesTableLoadingElement(minHeight) {
	const loading = document.createElement('div');
	loading.style.cssText = 'display:flex;align-items:center;justify-content:center;' +
		(minHeight ? 'min-height:' + minHeight + ';' : '') + 'width:100%;';
	loading.appendChild(createOverviewVillagesLoadingImage());
	return loading;
}

function attachLiveQueueTooltip(anchor, hoverTarget, headerHtml, getBodyHtml) {
	anchor.setAttribute('data-title', headerHtml);
	anchor.setAttribute('data-tooltip-tpl', getBodyHtml());

	function updateCountdown(event) {
		anchor.setAttribute('data-tooltip-tpl', getBodyHtml());
		toggleTooltip(event.target, true);
		event.target.countdownTimeout = setTimeout(() => updateCountdown(event), 1000);
	}

	hoverTarget.addEventListener('mouseenter', function (event) {
		anchor.setAttribute('data-tooltip-tpl', getBodyHtml());
		toggleTooltip(event.target, true);
		updateCountdown(event);
	});
	hoverTarget.addEventListener('mouseleave', function (event) {
		toggleTooltip(event.target, false);
		clearTimeout(event.target.countdownTimeout);
	});
}

function getOverviewVillagesColumnIndex(table, orderParam) {
	const headerCells = Array.from(table.querySelectorAll('thead th'));
	return headerCells.findIndex(th => !!th.querySelector(`a[href*="order=${orderParam}"]`));
}

function appendOverviewVillagesRefreshIcon(cell, title, onClick) {
	const refreshIcon = document.createElement('a');
	refreshIcon.href = '#';
	refreshIcon.title = title;
	refreshIcon.setAttribute('aria-label', title);
	refreshIcon.style.cssText = 'float:right;text-decoration:none;cursor:pointer;font-size:12px;';
	refreshIcon.textContent = '\u21bb';
	refreshIcon.addEventListener('click', function (event) {
		event.preventDefault();
		onClick(refreshIcon);
	});
	cell.appendChild(refreshIcon);
}

function appendVillageIdentityCell(row, village, existingCell) {
	const nativeRow = overviewVillagesTabsState.table?.querySelector(
		'.quickedit-vn[data-id="' + village.id + '"]'
	)?.closest('tr');
	const nativeCell = nativeRow?.querySelector('.quickedit-vn[data-id]')?.closest('td');
	const cell = existingCell || row.insertCell();

	if (nativeCell) {
		const identity = nativeCell.cloneNode(true);
		if (existingCell) cell.append(...identity.childNodes);
		else cell.replaceChildren(...identity.childNodes);
		cell.className = nativeCell.className;
		cell.style.cssText = nativeCell.style.cssText;
		if (typeof appendOverviewVillageQuickLinksIcons === 'function') {
			appendOverviewVillageQuickLinksIcons(cell, village.id);
		}
		return cell;
	}

	if (existingCell) cell.appendChild(document.createTextNode(village.name));
	else cell.textContent = village.name;
	if (typeof appendOverviewVillageQuickLinksIcons === 'function') {
		appendOverviewVillageQuickLinksIcons(cell, village.id);
	}
	return cell;
}

const overviewVillagesTabsState = {
	activeTabId: 'production',
	troopsFilter: 'all',
	filterRevision: 0,
	host: null,
	table: null,
	tabs: [],
	villages: [],
	visibleVillageIds: new Set(),
	refreshState: {
		production: { completed: new Set(), inFlight: new Map() },
		commands: { completed: new Set(), inFlight: new Map() },
		market: { completed: new Set(), inFlight: new Map() },
		troops: { completed: new Set(), inFlight: new Map() }
	}
};

function getOverviewVillagesVisibleVillages() {
	return typeof getOverviewManualGroupVillages === 'function'
		? getOverviewManualGroupVillages(overviewVillagesTabsState.villages)
		: overviewVillagesTabsState.villages.slice();
}

function updateOverviewVillagesVisibleState() {
	overviewVillagesTabsState.visibleVillageIds = new Set(
		getOverviewVillagesVisibleVillages().map(village => String(village.id))
	);
	overviewVillagesTabsState.filterRevision += 1;
	return overviewVillagesTabsState.visibleVillageIds;
}

function isOverviewVillageVisible(villageId) {
	return overviewVillagesTabsState.visibleVillageIds.has(String(villageId));
}

function getOverviewVillagesRefreshCandidates(domain, villages, force) {
	const state = overviewVillagesTabsState.refreshState[domain];
	if (!state) return villages;
	return villages.filter(function (village) {
		const id = String(village.id);
		return isOverviewVillageVisible(id) && (force || !state.completed.has(id)) && !state.inFlight.has(id);
	});
}

function runOverviewVillagesRefresh(domain, villages, fetchVillage, options) {
	const state = overviewVillagesTabsState.refreshState[domain];
	if (!state || typeof fetchVillage !== 'function') return Promise.resolve();
	const force = options?.force === true;
	const candidates = getOverviewVillagesRefreshCandidates(domain, villages, force);
	const requests = candidates.map(function (village) {
		const id = String(village.id);
		const request = Promise.resolve().then(() => fetchVillage(village)).then(function (result) {
			state.completed.add(id);
			return result;
		}).finally(function () {
			state.inFlight.delete(id);
		});
		state.inFlight.set(id, request);
		return request;
	});
	return Promise.all(requests);
}

function refreshOverviewVillagesActiveTab(forceTroopsRefresh = false) {
	const villages = getOverviewVillagesVisibleVillages();
	if (overviewVillagesTabsState.activeTabId === 'production' && typeof refreshOverviewVillagesBuildQueue === 'function') {
		return refreshOverviewVillagesBuildQueue(villages);
	}
	if (overviewVillagesTabsState.activeTabId === 'troops' && typeof refreshOverviewVillagesTroops === 'function') {
		return refreshOverviewVillagesTroops(villages, forceTroopsRefresh);
	}
	if (overviewVillagesTabsState.activeTabId === 'commands' && typeof refreshOverviewVillagesCommands === 'function') {
		return refreshOverviewVillagesCommands(villages);
	}
	if (overviewVillagesTabsState.activeTabId === 'market' && typeof refreshOverviewVillagesMarket === 'function') {
		return refreshOverviewVillagesMarket(villages);
	}
	return Promise.resolve();
}

/**
 * Initializes the overview villages feature after all context modules have loaded.
 */
function initOverviewVillages() {
	if (typeof game_data === 'undefined' || game_data.screen !== 'overview_villages') return;

	if (typeof injectOverviewVillagesNavigationMenu === 'function') injectOverviewVillagesNavigationMenu();
	if (typeof injectOverviewVillagesBuildQueueColumn === 'function') injectOverviewVillagesBuildQueueColumn();
	if (typeof injectOverviewVillagesStorageHover === 'function') injectOverviewVillagesStorageHover();
	if (typeof injectOverviewVillagesQuickLinksIcon === 'function') injectOverviewVillagesQuickLinksIcon();
}
