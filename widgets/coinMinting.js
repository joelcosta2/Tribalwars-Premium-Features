// Coin minting widget

var coinMintingState = {
    popup: null,
    opening: false,
    loading: false,
    academyByVillage: {},
    academyRequests: {},
    academyDataByVillage: {},
    renderedVillages: []
};

function getCoinMintingWorldKey() {
    return 'coin_minting_academies_' + (game_data?.world || window.location.hostname);
}

function getCoinMintingAcademies() {
    try {
        const stored = JSON.parse(localStorage.getItem(getCoinMintingWorldKey()) || '[]');
        return new Set(Array.isArray(stored) ? stored.map(String) : []);
    } catch {
        return new Set();
    }
}

function saveCoinMintingAcademy(villageId) {
    const academies = getCoinMintingAcademies();
    academies.add(String(villageId));
    localStorage.setItem(getCoinMintingWorldKey(), JSON.stringify(Array.from(academies)));
}

async function fetchCoinMintingVillages() {
    await refreshOverviewVillagesResources();
    let cached;
    try {
        cached = JSON.parse(localStorage.getItem('villages_info') || '[]');
    } catch {
        cached = [];
    }
    return (Array.isArray(cached) ? cached : []).map(village => {
        const url = new URL(village.url, window.location.origin);
        const id = url.searchParams.get('village');
        return id ? {
            id: String(id),
            name: village.name || id,
            url: url.toString(),
            resources: getVillageResources(id)
        } : null;
    }).filter(Boolean);
}

function coinMintingAcademyStateFromDocument(doc) {
    const heading = Array.from(doc.querySelectorAll('h2, h3, .caption'))
        .map(element => element.textContent.replace(/\s+/g, ' ').trim())
        .find(text => /academia|academy|akademie/i.test(text));
    if (!heading) return 'unknown';
    if (/não\s+constru|not\s+built|nicht\s+gebaut/i.test(heading)) return 'absent';
    if (/(nível|level|stufe)\s*\d+/i.test(heading)) return 'built';
    return 'unknown';
}

function coinMintingNumber(element) {
    const value = (element?.textContent || '').replace(/\D/g, '');
    return value ? Number(value) : null;
}

function coinMintingAcademyDataFromDocument(doc) {
    const state = coinMintingAcademyStateFromDocument(doc);
    if (state !== 'built') return { state };
    const cost = {
        wood: coinMintingNumber(doc.querySelector('#coin_cost_wood .value')),
        stone: coinMintingNumber(doc.querySelector('#coin_cost_stone .value')),
        iron: coinMintingNumber(doc.querySelector('#coin_cost_iron .value'))
    };
    const maxCoins = coinMintingNumber(doc.querySelector('#coin_mint_fill_max'));
    const resources = {
        wood: coinMintingNumber(doc.querySelector('#wood')),
        stone: coinMintingNumber(doc.querySelector('#stone')),
        iron: coinMintingNumber(doc.querySelector('#iron'))
    };
    const storage = coinMintingNumber(doc.querySelector('#storage'));
    return { state, cost, maxCoins, resources, storage };
}

async function fetchCoinMintingAcademyPage(url) {
    const maxRetries = 2;
    for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
        const response = await fetch(url, { credentials: 'include' });
        if (response.status !== 429 || retryCount === maxRetries) return response;
        const fallbackMs = 1000 * Math.pow(2, retryCount);
        const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'), fallbackMs);
        await wait(retryAfterMs / 1000);
    }
}

async function fetchCoinMintingAcademy(villageId, forceFetch = false) {
    const id = String(villageId);
    const known = getCoinMintingAcademies();
    if (known.has(id) && !forceFetch) return { state: 'built' };
    if (coinMintingState.academyRequests[id]) return coinMintingState.academyRequests[id];

    coinMintingState.academyRequests[id] = fetchCoinMintingAcademyPage(getVillageLinkBase(id) + 'snob&mode=train')
        .then(response => {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.text();
        })
        .then(html => coinMintingAcademyDataFromDocument(new DOMParser().parseFromString(html, 'text/html')))
        .then(data => {
            coinMintingState.academyByVillage[id] = data.state;
            if (data.state === 'built') {
                saveCoinMintingAcademy(id);
                coinMintingState.academyDataByVillage[id] = data;
            }
            return data;
        })
        .catch(() => {
            coinMintingState.academyByVillage[id] = 'unknown';
            return { state: 'unknown' };
        })
        .finally(() => {
            delete coinMintingState.academyRequests[id];
        });
    return coinMintingState.academyRequests[id];
}

function coinMintingCanUse(settings) {
    return settings?.coin_enabled === true &&
        [settings.coin_wood, settings.coin_stone, settings.coin_iron].every(value => Number.isFinite(value) && value > 0);
}

function coinMintingText(key, fallback) {
    try { return t(key); } catch { return fallback; }
}

function closeCoinMintingPopup() {
    coinMintingState.popup?.remove();
    coinMintingState.popup = null;
    coinMintingState.renderRows = null;
}

function createCoinMintingActionCell(position, onMint, onSelect) {
    const cell = document.createElement('td');
    cell.colSpan = 3;
    const mintButton = document.createElement('input');
    mintButton.type = 'button';
    mintButton.className = 'mint_multi_button btn';
    mintButton.value = coinMintingText('coinMinting.mintGold', 'Mint gold coins');
    mintButton.addEventListener('click', onMint);
    cell.appendChild(mintButton);

    const selected = document.createElement('span');
    selected.id = 'selectedBunches_' + position;
    selected.textContent = '0';
    cell.append(' (', selected, ' x ');
    const gold = document.createElement('img');
    gold.src = '/graphic/gold.webp';
    gold.alt = '';
    gold.className = '';
    gold.setAttribute('data-title', '');
    cell.append(gold, ')');

    const controls = document.createElement('td');
    const amount = document.createElement('select');
    amount.name = 'coin_amount';
    amount.className = 'coin_amount';
    [2, 1, 0, -1].forEach(value => {
        const option = document.createElement('option');
        option.value = String(value);
        option.textContent = value === -1 ? coinMintingText('coinMinting.max', 'Maximum') + ' -1x' : value + 'x';
        amount.appendChild(option);
    });
    const selectButton = document.createElement('input');
    selectButton.type = 'button';
    selectButton.className = 'btn';
    selectButton.value = coinMintingText('coinMinting.select', 'Select');
    selectButton.addEventListener('click', () => onSelect(amount.value));
    controls.append(amount, selectButton);
    return [cell, controls];
}

function createCoinMintingResourceValue(value) {
    const container = document.createElement('span');
    const formatted = String(value ?? '?').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    formatted.split('.').forEach((part, index) => {
        if (index > 0) container.appendChild(Object.assign(document.createElement('span'), { className: 'grey', textContent: '.' }));
        container.appendChild(document.createTextNode(part));
    });
    return container;
}

function createCoinMintingSelect(village, maxCoins) {
    const select = document.createElement('select');
    select.id = 'id_' + village.id;
    select.name = 'id_' + village.id;
    select.className = 'select_coins';
    select.dataset.villageId = village.id;
    for (let amount = 0; amount <= maxCoins; amount++) {
        const option = document.createElement('option');
        option.value = String(amount);
        if (amount === 0) {
            option.textContent = '- ' + coinMintingText('coinMinting.none', 'none') + ' -';
        } else {
            const cost = village.coinMintingData?.cost || {
                wood: coinMintingState.settings?.coin_wood || 0,
                stone: coinMintingState.settings?.coin_stone || 0,
                iron: coinMintingState.settings?.coin_iron || 0
            };
            const wood = amount * cost.wood;
            const stone = amount * cost.stone;
            const iron = amount * cost.iron;
            option.textContent = amount + 'x (' + wood + ', ' + stone + ', ' + iron + ')';
        }
        select.appendChild(option);
    }
    return select;
}

function updateCoinMintingSelectionCount() {
    const selected = Array.from(coinMintingState.popup.querySelectorAll('select.select_coins'))
        .reduce((total, select) => total + (parseInt(select.value, 10) || 0), 0);
    coinMintingState.popup.querySelectorAll('[id^="selectedBunches_"]').forEach(element => {
        element.textContent = String(selected);
    });
}

async function mintCoinsFromVillages(villages, settings, button, status) {
    if (coinMintingState.loading) return;
    const inputs = Array.from(coinMintingState.popup.querySelectorAll('select[data-village-id]'));
    const selected = inputs.map(input => ({ id: input.dataset.villageId, amount: parseInt(input.value, 10) || 0 }))
        .filter(item => item.amount > 0);
    if (!selected.length) {
        status.textContent = coinMintingText('coinMinting.selectVillage', 'Select at least one coin.');
        return;
    }

    const villagesById = new Map(villages.map(village => [village.id, village]));
    const selectedWithCurrentResources = selected.map(item => ({
        ...item,
        resources: villagesById.get(item.id)?.coinMintingData?.resources,
        cost: villagesById.get(item.id)?.coinMintingData?.cost
    }));
    if (selectedWithCurrentResources.some(item => !item.resources ||
        item.amount > Math.floor(Math.min(
            item.resources.wood / item.cost.wood,
            item.resources.stone / item.cost.stone,
            item.resources.iron / item.cost.iron
        )))) {
        status.textContent = coinMintingText('coinMinting.insufficientResources', 'There are not enough resources.');
        return;
    }

    coinMintingState.loading = true;
    button.disabled = true;
    status.textContent = coinMintingText('common.loading', 'Loading\u2026');
    try {
        const body = new URLSearchParams();
        selected.forEach(item => body.append('villages[' + item.id + ']', String(item.amount)));
        const response = await fetch(getVillageLinkBase(game_data.village.id) + 'snob&ajaxaction=coin_multi&h=' + encodeURIComponent(game_data.csrf), {
            method: 'POST', credentials: 'include', body,
            headers: { 'TribalWars-Ajax': '1', 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const result = await response.json();
        if (result.error) throw new Error(Array.isArray(result.error) ? result.error[0] : result.error);
        status.textContent = result.message || coinMintingText('coinMinting.success', 'Coins minted successfully.');
        invalidateVillageResources(selected.map(item => item.id));
        await runWithConcurrencyLimit(selected, async item => {
            const village = villagesById.get(item.id);
            const data = await fetchCoinMintingAcademy(item.id, true);
            if (data.state === 'built' && village) {
                village.coinMintingData = data;
                coinMintingState.academyDataByVillage[item.id] = data;
            }
        }, { concurrency: 2 });
        if (typeof coinMintingState.renderRows === 'function') coinMintingState.renderRows();
    } catch (error) {
        status.textContent = error.message || coinMintingText('coinMinting.errorMinting', 'Could not mint coins.');
    } finally {
        coinMintingState.loading = false;
        button.disabled = false;
    }
}

async function renderCoinMintingTable(villages, settings) {
    const table = coinMintingState.popup.querySelector('table');
    const status = coinMintingState.popup.querySelector('.coin-minting-status');
    coinMintingState.settings = settings;
    coinMintingState.renderedVillages = [];
    coinMintingState.academyDataByVillage = {};
    const knownVillages = villages.filter(village => getCoinMintingAcademies().has(village.id));
    const unknownVillages = villages.filter(village => !getCoinMintingAcademies().has(village.id));
    let completed = 0;
    const total = villages.length;
    let pendingKnownVillages = knownVillages.length;

    function renderRows() {
        const eligibleVillages = villages.filter(village => coinMintingState.academyDataByVillage[village.id]);
        coinMintingState.renderedVillages = eligibleVillages;
        table.innerHTML = '';
        table.id = 'coin_overview_table';
        table.className = 'vis overview_table';
        table.width = '100%';
        const mint = button => mintCoinsFromVillages(eligibleVillages, settings, button, status);
        const selectAll = value => {
            coinMintingState.popup.querySelectorAll('select.select_coins').forEach(select => {
                const max = select.options.length - 1;
                select.value = String(value === '-1' ? max : Math.min(Number(value), max));
            });
            updateCoinMintingSelectionCount();
        };
        const topActions = table.insertRow();
        createCoinMintingActionCell('top', () => mint(topActions.cells[0].querySelector('.mint_multi_button')), selectAll)
            .forEach(cell => topActions.appendChild(cell));
        const header = table.insertRow();
        [t('common.village'), t('common.resources'), coinMintingText('coinMinting.storage', 'Storage'), coinMintingText('coinMinting.quantity', 'Select quantity')].forEach(label => {
            const cell = document.createElement('th'); cell.textContent = label; header.appendChild(cell);
        });
        eligibleVillages.forEach(village => {
            const academy = coinMintingState.academyDataByVillage[village.id];
        const row = table.insertRow();
        const villageCell = row.insertCell();
        const villageLink = document.createElement('a');
        villageLink.href = village.url;
        villageLink.textContent = village.name;
        villageCell.appendChild(villageLink);
        const resourcesCell = row.insertCell();
        resourcesCell.className = 'nowrap resources';
        ['wood', 'stone', 'iron'].forEach(resource => {
            const value = document.createElement('span');
            value.className = 'res ' + resource;
            value.appendChild(createCoinMintingResourceValue(academy.resources?.[resource]));
            resourcesCell.appendChild(value);
            resourcesCell.appendChild(document.createTextNode(' '));
        });
        const storageCell = row.insertCell();
        storageCell.textContent = academy.storage == null ? '?' : String(academy.storage);
        const inputCell = row.insertCell();
        const select = createCoinMintingSelect(village, academy.maxCoins || 0);
        select.addEventListener('change', updateCoinMintingSelectionCount);
        inputCell.appendChild(select);
        });
        if (pendingKnownVillages > 0) {
            const loadingRow = table.insertRow();
            const loadingCell = loadingRow.insertCell();
            loadingCell.colSpan = 4;
            loadingCell.appendChild(createWidgetLoadingElement('30px'));
        }
        const bottomActions = table.insertRow();
        createCoinMintingActionCell('bottom', () => mint(bottomActions.cells[0].querySelector('.mint_multi_button')), selectAll)
            .forEach(cell => bottomActions.appendChild(cell));
        coinMintingState.popup.querySelectorAll('.mint_multi_button').forEach(button => { button.disabled = !eligibleVillages.length; });
        updateCoinMintingSelectionCount();
    }

    coinMintingState.renderRows = renderRows;
    renderRows();
    runWithConcurrencyLimit([...knownVillages, ...unknownVillages], async village => {
        const wasKnown = knownVillages.includes(village);
        const data = await fetchCoinMintingAcademy(village.id, true);
        completed++;
        if (wasKnown) pendingKnownVillages--;
        if (data.state === 'built') {
            village.coinMintingData = data;
            coinMintingState.academyDataByVillage[village.id] = data;
        }
        if (coinMintingState.popup) {
            renderRows();
        }
        if (completed === total && coinMintingState.popup && !coinMintingState.renderedVillages.length) {
            const info = document.createElement('div');
            info.className = 'info_box coin-minting-no-academy';
            info.textContent = coinMintingText('coinMinting.noAcademy', 'No village has an Academy built.');
            coinMintingState.popup.insertBefore(info, table);
        }
    }, { concurrency: 2 });
}

async function openCoinMintingPopup() {
    const shortcutSetting = settings_cookies.general.show__widget_popup_shortcuts;
    if (shortcutSetting?.enabled === false || shortcutSetting?.coinMinting === false) return;
    if (coinMintingState.opening) return;
    if (coinMintingState.popup) { closeCoinMintingPopup(); return; }
    coinMintingState.opening = true;
    try {
        const settings = await fetchAndCacheWorldSettings();
        if (!coinMintingCanUse(settings)) {
            showAutoHideBox(coinMintingText('coinMinting.unsupportedWorld', 'This world does not support coin minting.'), true);
            return;
        }

        const backdrop = document.createElement('div');
        backdrop.className = 'coin-minting-overlay-backdrop';
        backdrop.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:20001; display:block;';

        const popup = document.createElement('div');
        popup.className = 'popup_style';
        popup.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); width:760px; max-width:95vw; max-height:85vh; overflow-y:auto; z-index:20002; display:block;';

        const header = document.createElement('div');
        header.className = 'popup_menu';
        header.style.cssText = 'font-size:15px; font-weight:bold;';
        header.appendChild(document.createTextNode(coinMintingText('coinMinting.title', 'Mint coins')));
        const close = document.createElement('a');
        close.href = '#';
        close.textContent = t('button.close');
        close.style.cssText = 'float:right; cursor:pointer; font-weight:bold; text-decoration:none; margin-left:15px;';
        close.onclick = event => { event.preventDefault(); closeCoinMintingPopup(); };
        header.appendChild(close);

        const content = document.createElement('div');
        content.className = 'popup_content';
        content.style.cssText = 'padding:10px;';
        const status = document.createElement('p');
        status.className = 'coin-minting-status';
        const table = document.createElement('table');
        content.append(table, status);
        popup.append(header, content);
        backdrop.appendChild(popup);
        document.body.appendChild(backdrop);
        coinMintingState.popup = backdrop;
        if (typeof makeOverlayDraggable === 'function') makeOverlayDraggable(popup, header);
        backdrop.addEventListener('mousedown', event => {
            if (event.target === backdrop) closeCoinMintingPopup();
        });
        const villages = await fetchCoinMintingVillages();
        if (!coinMintingState.popup) return;
        await renderCoinMintingTable(villages, settings);
    } catch (error) {
        if (coinMintingState.popup) {
            coinMintingState.popup.querySelector('.coin-minting-status').textContent = error.message || coinMintingText('coinMinting.errorVillages', 'Could not load villages.');
        } else {
            showAutoHideBox(error.message || coinMintingText('coinMinting.errorVillages', 'Could not load villages.'), true);
        }
    } finally {
        coinMintingState.opening = false;
    }
}

