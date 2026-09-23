/**
 * Free "Farm Assistant" page (screen=am_farm_twp) — recreates the Premium am_farm screen's
 * markup (same native classes: loot_assistant_templates, plunder_list, farm_icon, unit-item, ...)
 * using cached data plus a place-page troop refresh: attack reports (world_reports /
 * TWPFMapReports), the same 3 "show on map" troop templates used by the map's quick-attack
 * buttons (troopTemplates.js / features/map/map.js), per-village troop counts (troopsTable.js) and
 * the cached village.txt index (core_utils.js). No custom CSS — relies entirely on the game's
 * own stylesheet classes.
 */

const FARM_ASSISTANT_PAGE_SIZE_KEY = 'farm_twp_page_size';
const FARM_ASSISTANT_DEFAULT_PAGE_SIZE = 15;
const FARM_ASSISTANT_SEND_COOLDOWN_MS = 4000;
const FARM_ASSISTANT_REPORT_DELETE_BATCH_SIZE = 12;
const FARM_ASSISTANT_REPORT_DELETE_DELAY_SECONDS = 1;
const FARM_ASSISTANT_FILTERS_KEY = 'farm_assistant_filters_v1';
const FARM_ASSISTANT_MAP_ATTACKS_STORAGE_PREFIX = 'twpf_farm_assistant_map_attacks_v1';
const FARM_ASSISTANT_TEMPLATE_C_MODE_KEY = 'farm_assistant_template_c_mode_v1';
const FARM_ASSISTANT_AUTO_UNITS_KEY = 'farm_assistant_auto_units_v2';
const FARM_ASSISTANT_AUTO_UNIT_DEFAULTS = {
    spear: true,
    sword: true,
    axe: false,
    archer: false,
    light: true,
    marcher: true,
    heavy: true,
    knight: false
};
const FARM_ASSISTANT_TEMPLATE_SLOTS = [
    { key: 'a', translationKey: 'farmAssistant.templateA' },
    { key: 'b', translationKey: 'farmAssistant.templateB' },
    { key: 'c', translationKey: 'farmAssistant.templateC' }
];

// Units offered in the loot_assistant_templates editor (matches the native table, minus catapult).
const FARM_ASSISTANT_TEMPLATE_UNITS = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'knight'];
// Units shown in the units_home "Availability" table (matches native table: no siege units).
const FARM_ASSISTANT_AVAILABILITY_UNITS = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'knight'];

let _farmAssistantTargets = [];
let _farmAssistantAllTargets = [];
let _farmAssistantPage = 0;
let _farmAssistantSort = { order: 'date', dir: 'desc' };
let _farmAssistantAttackCounts = {};
let _farmAssistantFilters = {};
let _farmAssistantReportDeleteRunning = false;
let _farmAssistantReportDeletePageCount = 0;
let _farmAssistantReportDeleteForm = null;
let _farmAssistantReportPageSnapshot = null;
let _farmAssistantReportPageCountPromise = null;
let _farmAssistantTemplateCMode = 'auto';
const _farmAssistantAutomaticCompositions = {};

function getFarmAssistantAttackReportsUrl(from) {
    return `${game_data.link_base_pure}report&mode=attack&group_id=0&from=${from}`;
}

function parseFarmAssistantReportPage(html) {
    const documentFragment = new DOMParser().parseFromString(html, 'text/html');
    const form = documentFragment.querySelector('form[action*="process_reports"]');
    const reports = Array.from(documentFragment.querySelectorAll('.report-title[data-id]')).map(title => {
        const row = title.closest('tr');
        const label = title.querySelector('.quickedit-label');
        const dateElement = row?.querySelectorAll('.nowrap')[1];
        return {
            id: title.dataset.id,
            date: dateElement?.textContent.trim() || '',
            label: label?.textContent.trim() || ''
        };
    }).filter(report => report.id && report.date);

    const offsets = Array.from(documentFragment.querySelectorAll('.paged-nav-item'))
        .map(link => new URL(link.href, window.location.href).searchParams.get('from'))
        .filter(from => from !== null)
        .map(from => parseInt(from, 10))
        .filter(Number.isFinite);

    return {
        reports,
        offsets,
        form: form ? {
            action: new URL(form.action, window.location.href).href,
            hash: form.querySelector('input[name="h"]')?.value || '',
            from: form.querySelector('input[name="from"]')?.value || '0',
            numReports: form.querySelector('input[name="num_reports"]')?.value || String(reports.length),
            currentGroupId: form.querySelector('input[name="current_group_id"]')?.value || '0',
            deleteValue: form.querySelector('input[name="del"]')?.value || 'Delete'
        } : null
    };
}

async function getFarmAssistantReportPageCount() {
    if (_farmAssistantReportPageSnapshot) return _farmAssistantReportPageSnapshot;
    if (_farmAssistantReportPageCountPromise) return _farmAssistantReportPageCountPromise;

    _farmAssistantReportPageCountPromise = (async () => {
        const html = await fetchWithRetry429({
            url: getFarmAssistantAttackReportsUrl(0),
            type: 'GET',
            cache: false
        });
        const page = parseFarmAssistantReportPage(html);
        const maxOffset = Math.max(0, ...page.offsets);
        const snapshot = {
            pageCount: Math.floor(maxOffset / FARM_ASSISTANT_REPORT_DELETE_BATCH_SIZE) + 1,
            form: page.form,
            firstPageHtml: html
        };
        _farmAssistantReportPageSnapshot = snapshot;
        return snapshot;
    })().finally(() => {
        _farmAssistantReportPageCountPromise = null;
    });

    return _farmAssistantReportPageCountPromise;
}

function clearFarmAssistantReportPageSnapshot() {
    _farmAssistantReportPageSnapshot = null;
    _farmAssistantReportPageCountPromise = null;
    _farmAssistantReportDeletePageCount = 0;
    _farmAssistantReportDeleteForm = null;
}

function setFarmAssistantReportDeleteStatus(text, isError) {
    const status = document.getElementById('farm_assistant_report_delete_status');
    if (!status) return;
    status.textContent = text;
    status.classList.toggle('error', !!isError);
}

async function deleteFarmAssistantReportBatch(reportIds, formData, pageOffset) {
    const data = {
        h: formData.hash,
        from: String(pageOffset),
        num_reports: formData.numReports,
        current_group_id: formData.currentGroupId,
        del: formData.deleteValue
    };
    reportIds.forEach(id => { data[`id_${id}`] = 'on'; });

    const response = await fetchWithRetry429({
        url: formData.action,
        type: 'POST',
        data,
        cache: false
    }, { maxRetries: 2, baseDelayMs: 2000 });

    if (typeof response !== 'string' || response.length === 0) {
        throw new Error('Empty response');
    }
}

async function removeFarmAssistantReportsFromLocalCache(reportIds) {
    if (window.TWPFMapReports?.removeByIds) {
        await window.TWPFMapReports.removeByIds(reportIds);
        return;
    }

    const localReports = await reportGetAll();
    const ids = new Set(reportIds.map(id => String(id)));
    await Promise.all(localReports
        .filter(report => ids.has(String(report.id)))
        .map(report => reportRemove(report.coords)));
}

async function prepareFarmAssistantReportDeletion() {
    if (_farmAssistantReportDeleteRunning) return;
    _farmAssistantReportDeleteRunning = true;
    const button = document.getElementById('farm_assistant_report_delete_toggle');
    if (button) button.disabled = true;

    try {
        setFarmAssistantReportDeleteStatus(t('farmAssistant.reportDeleteCollecting'), false);
        const result = await getFarmAssistantReportPageCount();
        if (!result.form?.action || !result.form.hash) throw new Error('Report form unavailable');

        _farmAssistantReportDeletePageCount = result.pageCount;
        _farmAssistantReportDeleteForm = result.form;
        const panel = document.getElementById('farm_assistant_report_delete_panel');
        const pageCountInput = document.getElementById('farm_assistant_report_delete_pages');
        if (pageCountInput) {
            pageCountInput.max = String(result.pageCount);
            pageCountInput.value = String(result.pageCount);
        }
        if (panel) panel.style.display = '';
        setFarmAssistantReportDeleteStatus(t('farmAssistant.reportDeletePageCount', { total: result.pageCount }), false);
    } catch (error) {
        console.error('[Farm Assistant] Failed to count report pages:', error);
        setFarmAssistantReportDeleteStatus(t('farmAssistant.reportDeleteError'), true);
    } finally {
        _farmAssistantReportDeleteRunning = false;
        if (button) button.disabled = false;
    }
}

async function deleteOldFarmAssistantReports(pageCount) {
    if (_farmAssistantReportDeleteRunning) return;
    _farmAssistantReportDeleteRunning = true;
    const button = document.getElementById('farm_assistant_report_delete_submit');
    if (button) button.disabled = true;

    try {
        const totalPages = _farmAssistantReportDeletePageCount;
        const formData = _farmAssistantReportDeleteForm;
        if (!formData?.action || !formData.hash || !totalPages) throw new Error('Report page count unavailable');

        if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > totalPages) {
            setFarmAssistantReportDeleteStatus(t('farmAssistant.reportDeleteInvalidPageCount', { total: totalPages }), true);
            return;
        }

        _farmAssistantReportDeleteRunning = false;
        if (button) button.disabled = false;
        UI.ConfirmationBox(
            t('farmAssistant.reportDeleteConfirm', { pages: pageCount }),
            [{
                text: t('button.ok'),
                confirm: true,
                callback: function () {
                    runFarmAssistantReportDeletion(pageCount, totalPages, formData);
                }
            }],
            'tw_delete_farm_assistant_reports',
            false,
            true
        );
        return;
    } catch (error) {
        console.error('[Farm Assistant] Failed to collect old reports:', error);
        setFarmAssistantReportDeleteStatus(t('farmAssistant.reportDeleteError'), true);
    } finally {
        _farmAssistantReportDeleteRunning = false;
        if (button) button.disabled = false;
    }
}

async function runFarmAssistantReportDeletion(pageCount, totalPages, formData) {
    if (_farmAssistantReportDeleteRunning) return;
    _farmAssistantReportDeleteRunning = true;
    const button = document.getElementById('farm_assistant_report_delete_submit');
    if (button) button.disabled = true;

    let deleted = 0;
    let failed = 0;
    const firstPageSnapshot = _farmAssistantReportPageSnapshot;
    try {
        for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
            const pageOffset = (totalPages - 1 - pageIndex) * FARM_ASSISTANT_REPORT_DELETE_BATCH_SIZE;
            try {
                const html = pageOffset === 0 && firstPageSnapshot?.firstPageHtml
                    ? firstPageSnapshot.firstPageHtml
                    : await fetchWithRetry429({
                        url: getFarmAssistantAttackReportsUrl(pageOffset),
                        type: 'GET',
                        cache: false
                    });
                const page = parseFarmAssistantReportPage(html);
                const reportIds = page.reports.map(report => report.id);
                if (reportIds.length > 0) {
                    await deleteFarmAssistantReportBatch(reportIds, page.form || formData, pageOffset);
                    await removeFarmAssistantReportsFromLocalCache(reportIds);
                    deleted += reportIds.length;
                }
            } catch (error) {
                console.error('[Farm Assistant] Failed to delete report batch:', error);
                failed += 1;
                setFarmAssistantReportDeleteStatus(t('farmAssistant.reportDeleteFailed', { deleted, failed }), true);
                break;
            }
            setFarmAssistantReportDeleteStatus(t('farmAssistant.reportDeleteProgress', {
                deleted,
                total: pageCount
            }), false);
            if (pageIndex + 1 < pageCount) await wait(FARM_ASSISTANT_REPORT_DELETE_DELAY_SECONDS);
        }

        renderFarmAssistantTable();
        setFarmAssistantReportDeleteStatus(t('farmAssistant.reportDeleteComplete', {
            pages: pageCount,
            deleted,
            failed
        }), failed > 0);
    } catch (error) {
        console.error('[Farm Assistant] Failed to delete reports:', error);
        setFarmAssistantReportDeleteStatus(t('farmAssistant.reportDeleteError'), true);
    } finally {
        clearFarmAssistantReportPageSnapshot();
        _farmAssistantReportDeleteRunning = false;
        if (button) button.disabled = false;
    }
}

function registerFarmAssistantSidebarIcon() {
    if (getSetting('show__local_farm_assistant') !== true) return;
    if (!window.SidebarIcons) return;

    SidebarIcons.register('farm-assistant', {
        order: 10,
        iconClass: 'quest sidebar-farm-assistant-icon sidebar-icon-offset',
        title: t('farmAssistant.title'),
        onClick: function () {
            window.location.href = `${game_data.link_base_pure}am_farm_twp`;
        }
    });
}

registerFarmAssistantSidebarIcon();

function getFarmAssistantFiltersKey() {
    const world = game_data?.world || window.location.hostname || 'unknown_world';
    const player = game_data?.player?.id || 'unknown_player';
    return `${FARM_ASSISTANT_FILTERS_KEY}_${world}_${player}`;
}

function getFarmAssistantFilters() {
    try {
        const stored = JSON.parse(localStorage.getItem(getFarmAssistantFiltersKey()) || '{}');
        return {
            onlyThisVillage: stored.onlyThisVillage === true,
            includeAttacked: stored.includeAttacked !== false,
            fullLosses: stored.fullLosses === true,
            partialLosses: stored.partialLosses === true,
            fullHauls: stored.fullHauls === true
        };
    } catch {
        return { onlyThisVillage: false, includeAttacked: true, fullLosses: false, partialLosses: false, fullHauls: false };
    }
}

function saveFarmAssistantFilters() {
    localStorage.setItem(getFarmAssistantFiltersKey(), JSON.stringify(_farmAssistantFilters));
}

function getFarmAssistantTemplateCModeKey() {
    const world = game_data?.world || window.location.hostname || 'unknown_world';
    const player = game_data?.player?.id || 'unknown_player';
    return `${FARM_ASSISTANT_TEMPLATE_C_MODE_KEY}_${world}_${player}`;
}

function getFarmAssistantTemplateCMode() {
    return localStorage.getItem(getFarmAssistantTemplateCModeKey()) === 'manual' ? 'manual' : 'auto';
}

function setFarmAssistantTemplateCMode(mode) {
    _farmAssistantTemplateCMode = mode === 'manual' ? 'manual' : 'auto';
    localStorage.setItem(getFarmAssistantTemplateCModeKey(), _farmAssistantTemplateCMode);
}

function getFarmAssistantAutoUnitsKey() {
    const world = game_data?.world || window.location.hostname || 'unknown_world';
    const player = game_data?.player?.id || 'unknown_player';
    return `${FARM_ASSISTANT_AUTO_UNITS_KEY}_${world}_${player}`;
}

function getFarmAssistantAutoUnits() {
    const availableUnits = getFarmAssistantAvailabilityUnits();
    try {
        const stored = JSON.parse(localStorage.getItem(getFarmAssistantAutoUnitsKey()) || '{}');
        return availableUnits.reduce((selected, unit) => {
            if (unit === 'spy') {
                selected[unit] = true;
                return selected;
            }
            selected[unit] = stored[unit] === undefined
                ? FARM_ASSISTANT_AUTO_UNIT_DEFAULTS[unit] === true
                : stored[unit] === true;
            return selected;
        }, {});
    } catch {
        return availableUnits.reduce((selected, unit) => {
            selected[unit] = unit === 'spy' || FARM_ASSISTANT_AUTO_UNIT_DEFAULTS[unit] === true;
            return selected;
        }, {});
    }
}

function saveFarmAssistantAutoUnits(selectedUnits) {
    localStorage.setItem(getFarmAssistantAutoUnitsKey(), JSON.stringify(selectedUnits));
}

function farmAssistantTargetMatchesFilters(target) {
    const filters = _farmAssistantFilters;
    const report = target.report;
    if (filters.onlyThisVillage && String(report.sourceVillageId || '') !== String(game_data.village.id)) return false;
    if (!filters.includeAttacked && target.attackCount > 0) return false;
    if (report.losses === 'full' && !filters.fullLosses) return false;
    if (report.losses === 'partial' && !filters.partialLosses) return false;
    if (filters.fullHauls && !(report.loot && Number(report.loot.popLooted) >= Number(report.loot.popTotal))) return false;
    return true;
}

function formatFarmAssistantReportDate(date) {
    const rawDate = String(date || '').trim();
    const lowerDate = rawDate.toLowerCase();
    const isTodayLabel = lowerDate.includes('today') || lowerDate.includes('hoje');
    const parsedTime = rawDate.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
    let isToday = isTodayLabel;

    if (!isToday && window.TWPFMapReports?.convertDateToISO) {
        const timestamp = new Date(window.TWPFMapReports.convertDateToISO(rawDate) || 0).getTime();
        const reportDate = new Date(timestamp);
        const currentDate = new Date();
        isToday = timestamp > 0
            && reportDate.getFullYear() === currentDate.getFullYear()
            && reportDate.getMonth() === currentDate.getMonth()
            && reportDate.getDate() === currentDate.getDate();
    }

    return isToday && parsedTime
        ? t('farmAssistant.today') + ' ' + parsedTime[1]
        : rawDate;
}

function applyFarmAssistantFilters() {
    _farmAssistantTargets = _farmAssistantAllTargets.filter(farmAssistantTargetMatchesFilters);
    sortFarmAssistantTargets();
    _farmAssistantPage = 0;
    renderFarmAssistantTable();
}

function parseFarmAssistantPlaceTroopCounts(doc) {
    const rows = Array.from(doc.querySelectorAll('#units_home tbody tr'));
    const homeRow = rows.find(row =>
        row.querySelectorAll('td').length && !row.querySelector('td a[href*="screen=info_village"]')
    );
    const totalRow = rows.find(row => row.querySelector('th') && row.querySelector('[class*="unit-item-"]'));
    if (!homeRow || !totalRow) return {};

    const counts = {};
    homeRow.querySelectorAll('[class*="unit-item-"]').forEach(homeCell => {
        const unitClass = Array.from(homeCell.classList).find(className => className.startsWith('unit-item-'));
        if (!unitClass) return;

        const unit = unitClass.slice('unit-item-'.length);
        const home = parseInt(homeCell.dataset.unitCount || '0', 10);
        const totalCell = totalRow.querySelector('.' + unitClass);
        const total = parseInt(totalCell?.dataset.unitCount || String(home), 10);
        if (Number.isFinite(home) && Number.isFinite(total)) counts[unit] = `${home}/${total}`;
    });

    return counts;
}

function fetchAndStoreFarmAssistantTroopCounts(villageId) {
    return fetchWithRetry429({
        url: getVillageLinkBase(villageId) + 'place&mode=units&display=units',
        type: 'GET',
        cache: false
    }).then(function (data) {
        const freshCounts = parseFarmAssistantPlaceTroopCounts(
            new DOMParser().parseFromString(data, 'text/html')
        );
        if (Object.keys(freshCounts).length === 0) return false;

        const existingCounts = bqGet('village_unit_counts', villageId) || {};
        bqSet('village_unit_counts', villageId, Object.assign({}, existingCounts, freshCounts));
        return true;
    }).catch(function () {
        return false;
    });
}

function setFarmAssistantLoading(indicatorId, isLoading) {
    const indicator = document.getElementById(indicatorId);
    if (!indicator) return;

    indicator.hidden = !isLoading;
    indicator.setAttribute('aria-busy', String(isLoading));
}

/**
 * Entry point, called by the screen=am_farm_twp dispatch branch in utils/core_utils.js.
 */
function injectFarmAssistantPage() {
    const container = document.getElementById('content_value');
    if (!container) return;

    _farmAssistantSort = getFarmAssistantSortState();
    _farmAssistantFilters = getFarmAssistantFilters();
    _farmAssistantTemplateCMode = getFarmAssistantTemplateCMode();
    container.innerHTML = renderFarmAssistantSkeleton();
    bindFarmAssistantSkeletonEvents();
    renderFarmAssistantTemplatesTable();
    renderFarmAssistantTroopsTable();
    setFarmAssistantLoading('farm_assistant_reports_loading', true);
    loadFarmAssistantTargets().finally(function () {
        setFarmAssistantLoading('farm_assistant_reports_loading', false);
    });

    const villageId = game_data.village.id;
    setFarmAssistantLoading('farm_assistant_troops_loading', true);
    fetchAndStoreFarmAssistantTroopCounts(villageId)
        .then(function (updated) {
            if (!updated || String(game_data.village.id) !== String(villageId)) return;
            renderFarmAssistantTroopsTable();
            renderFarmAssistantTable();
        })
        .finally(function () {
            setFarmAssistantLoading('farm_assistant_troops_loading', false);
        });
}

function getFarmAssistantTemplateUnits() {
    return FARM_ASSISTANT_TEMPLATE_UNITS.filter(unit => isArchersEnabled() || (unit !== 'archer' && unit !== 'marcher'));
}

function getFarmAssistantMapStorageKey() {
    const world = game_data?.world || window.location.hostname || 'unknown_world';
    const player = game_data?.player?.id || 'unknown_player';
    return `${FARM_ASSISTANT_MAP_ATTACKS_STORAGE_PREFIX}_${world}_${player}`;
}

function normalizeFarmAssistantMapSlot(slot) {
    if (!slot || typeof slot !== 'object' || !slot.units || typeof slot.units !== 'object') return null;

    const units = {};
    Object.keys(slot.units).forEach(unit => {
        const amount = parseInt(slot.units[unit], 10);
        if (Number.isFinite(amount) && amount > 0) units[unit] = amount;
    });

    return Object.keys(units).length > 0
        ? { name: String(slot.name || ''), units }
        : null;
}

function getFarmAssistantMapSlots() {
    try {
        const raw = localStorage.getItem(getFarmAssistantMapStorageKey());
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return FARM_ASSISTANT_TEMPLATE_SLOTS.map(() => null);
        return FARM_ASSISTANT_TEMPLATE_SLOTS.map((slot, index) => normalizeFarmAssistantMapSlot(parsed[index]));
    } catch {
        return FARM_ASSISTANT_TEMPLATE_SLOTS.map(() => null);
    }
}

function saveFarmAssistantMapSlots(unitsA, unitsB, unitsC) {
    const normalizeUnits = units => Object.keys(units || {}).reduce((result, unit) => {
        const amount = parseInt(units[unit], 10);
        if (Number.isFinite(amount) && amount > 0) result[unit] = amount;
        return result;
    }, {});

    const unitsBySlot = { a: unitsA, b: unitsB, c: unitsC };
    const slots = FARM_ASSISTANT_TEMPLATE_SLOTS.map(slot => normalizeFarmAssistantMapSlot({
        name: t(slot.translationKey),
        units: normalizeUnits(unitsBySlot[slot.key])
    }));

    localStorage.setItem(getFarmAssistantMapStorageKey(), JSON.stringify(slots));
}

function getFarmAssistantAvailabilityUnits() {
    return FARM_ASSISTANT_AVAILABILITY_UNITS.filter(unit => isArchersEnabled() || (unit !== 'archer' && unit !== 'marcher'));
}

function getFarmAssistantPageSize() {
    return parseInt(localStorage.getItem(FARM_ASSISTANT_PAGE_SIZE_KEY), 10) || FARM_ASSISTANT_DEFAULT_PAGE_SIZE;
}

function getFarmAssistantSortState() {
    const params = new URLSearchParams(window.location.search);
    const order = params.get('order');
    const dir = params.get('dir');
    return (order === 'date' || order === 'distance') && (dir === 'asc' || dir === 'desc')
        ? { order, dir }
        : { order: 'date', dir: 'desc' };
}

function sortFarmAssistantTargets() {
    _farmAssistantTargets.sort((left, right) => {
        const leftTime = new Date(window.TWPFMapReports.convertDateToISO(left.report.date) || 0).getTime();
        const rightTime = new Date(window.TWPFMapReports.convertDateToISO(right.report.date) || 0).getTime();
        const leftValues = _farmAssistantSort.order === 'distance'
            ? [left.distance, leftTime]
            : [leftTime, left.distance];
        const rightValues = _farmAssistantSort.order === 'distance'
            ? [right.distance, rightTime]
            : [rightTime, right.distance];
        const direction = _farmAssistantSort.dir === 'desc' ? -1 : 1;

        for (let index = 0; index < leftValues.length; index++) {
            if (leftValues[index] !== rightValues[index]) {
                return (leftValues[index] - rightValues[index]) * direction;
            }
        }

        return String(left.coords).localeCompare(String(right.coords));
    });
}

function getFarmAssistantSortLink(order) {
    const isActive = _farmAssistantSort.order === order;
    const direction = isActive
        ? (_farmAssistantSort.dir === 'desc' ? 'asc' : 'desc')
        : order === 'date' ? 'desc' : 'asc';
    return `${game_data.link_base_pure}am_farm_twp&order=${order}&dir=${direction}`;
}

function escapeFarmAssistantAttribute(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
}

function renderFarmAssistantSkeleton() {
    return `
        <h3>${escapeHtml(t('farmAssistant.title'))}</h3>
        <div class="vis">
            <h4>${escapeHtml(t('farmAssistant.templatesHeading'))}</h4>
            <div>
                <form id="farm_assistant_templates_form">
                    <table class="vis loot_assistant_templates" width="100%">
                        <tbody id="farm_assistant_templates_body"></tbody>
                    </table>
                </form>
            </div>
        </div>
        <div class="vis">
            <div id="farm_assistant_troops_wrapper"></div>
        </div>
        <div id="am_widget_Farm" data-widget="Farm" class="am_widget vis spaced">
            <h4>${escapeHtml(t('farmAssistant.targetsHeading'))} <span id="farm_assistant_reports_loading" hidden aria-busy="false"><img src="${_getNavAssetBase()}loading.gif" width="16" height="16" alt="${escapeHtml(t('common.loading'))}"></span></h4>
            <div class="body">
                <div id="plunder_list_filters" style="display:inline-block; background-color:#f4e4bc; margin:2px 2px 0 2px;">
                    <div style="float:left;">
                        <span>
                            <input type="checkbox" id="all_village_checkbox"${_farmAssistantFilters.onlyThisVillage ? ' checked' : ''}>
                            <label for="all_village_checkbox">${escapeHtml(t('farmAssistant.filterOnlyThisVillage'))}</label>
                        </span>
                        <br>
                        <span>
                            <input type="checkbox" id="attacked_checkbox"${_farmAssistantFilters.includeAttacked ? ' checked' : ''}>
                            <label for="attacked_checkbox">${escapeHtml(t('farmAssistant.filterIncludeAttacked'))}</label>
                        </span>
                    </div>
                    <div style="float:left; padding-left:10px;">
                        <span>
                            <input type="checkbox" id="full_losses_checkbox"${_farmAssistantFilters.fullLosses ? ' checked' : ''}>
                            <label for="full_losses_checkbox">${escapeHtml(t('farmAssistant.filterFullLosses'))}</label>
                        </span>
                        <br>
                        <span>
                            <input type="checkbox" id="partial_losses_checkbox"${_farmAssistantFilters.partialLosses ? ' checked' : ''}>
                            <label for="partial_losses_checkbox">${escapeHtml(t('farmAssistant.filterPartialLosses'))}</label>
                        </span>
                    </div>
                    <span style="float:left">
                        <input type="checkbox" id="full_hauls_checkbox"${_farmAssistantFilters.fullHauls ? ' checked' : ''}>
                        <label for="full_hauls_checkbox">${escapeHtml(t('farmAssistant.filterFullHauls'))}</label>
                    </span>
                </div>
                <div id="farm_assistant_nav_top" style="width:100%;"></div>
                <table id="plunder_list" style="width:100%;">
                    <thead id="farm_assistant_thead"></thead>
                    <tbody id="farm_assistant_rows"></tbody>
                </table>
                <div id="farm_assistant_nav_bottom" style="width:100%;">
                    <div id="farm_assistant_nav_bottom_pages"></div>
                    <form id="farm_assistant_pagesize_form">
                        <table class="vis">
                            <tbody>
                                <tr>
                                    <th colspan="2">${escapeHtml(t('farmAssistant.pageSizeLabel'))}</th>
                                    <td><input id="farm_assistant_page_size_input" type="text" value="${getFarmAssistantPageSize()}" style="width: 50px" name="page_size"></td>
                                    <td><input type="submit" value="${escapeHtml(t('farmAssistant.changeButton'))}" class="btn"></td>
                                </tr>
                            </tbody>
                        </table>
                    </form>
                    <button id="farm_assistant_report_delete_toggle" type="button" class="btn">${escapeHtml(t('farmAssistant.reportDeleteButton'))}</button>
                    <div id="farm_assistant_report_delete_panel" style="display:none;">
                        <form id="farm_assistant_report_delete_form">
                            <label for="farm_assistant_report_delete_pages">${escapeHtml(t('farmAssistant.reportDeletePagesLabel'))}</label>
                            <input id="farm_assistant_report_delete_pages" type="number" min="1" step="1" name="pages" required>
                            <button id="farm_assistant_report_delete_submit" type="submit" class="btn btn-cancel">${escapeHtml(t('farmAssistant.reportDeleteSubmit'))}</button>
                        </form>
                        <p id="farm_assistant_report_delete_status" aria-live="polite"></p>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function bindFarmAssistantSkeletonEvents() {
    document.getElementById('farm_assistant_templates_form')?.addEventListener('submit', handleFarmAssistantTemplatesSave);

    document.getElementById('farm_assistant_report_delete_toggle')?.addEventListener('click', function () {
        prepareFarmAssistantReportDeletion();
    });

    document.getElementById('farm_assistant_report_delete_form')?.addEventListener('submit', function (event) {
        event.preventDefault();
        const pageCount = parseInt(document.getElementById('farm_assistant_report_delete_pages')?.value, 10);
        deleteOldFarmAssistantReports(pageCount);
    });

    document.getElementById('farm_assistant_pagesize_form')?.addEventListener('submit', function (event) {
        event.preventDefault();
        const value = parseInt(document.getElementById('farm_assistant_page_size_input').value, 10);
        const pageSize = Number.isFinite(value) && value > 0 ? value : FARM_ASSISTANT_DEFAULT_PAGE_SIZE;
        localStorage.setItem(FARM_ASSISTANT_PAGE_SIZE_KEY, String(pageSize));
        _farmAssistantPage = 0;
        renderFarmAssistantTable();
    });

    ['all_village_checkbox', 'attacked_checkbox', 'full_losses_checkbox', 'partial_losses_checkbox', 'full_hauls_checkbox'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', function (event) {
            _farmAssistantFilters = {
                ..._farmAssistantFilters,
                onlyThisVillage: document.getElementById('all_village_checkbox').checked,
                includeAttacked: document.getElementById('attacked_checkbox').checked,
                fullLosses: document.getElementById('full_losses_checkbox').checked,
                partialLosses: document.getElementById('partial_losses_checkbox').checked,
                fullHauls: document.getElementById('full_hauls_checkbox').checked
            };
            saveFarmAssistantFilters();
            applyFarmAssistantFilters();
        });
    });
}

/**
 * Binds native TW tooltip behaviour (toggleTooltip) to any [data-title] element under root —
 * required because these elements are injected after page load, unlike server-rendered markup.
 */
function bindFarmAssistantTooltips(root) {
    root.querySelectorAll('[data-title], [data-tooltip-tpl]').forEach(el => {
        if (el.dataset.tooltipBound === '1') return;
        el.dataset.tooltipBound = '1';
        el.addEventListener('mouseenter', function () { toggleTooltip(el, true); });
        el.addEventListener('mouseleave', function () { toggleTooltip(el, false); });
    });
}

/**
 * Reads the up-to-3 templates flagged "show on map" as [templateA, templateB, templateC].
 */
function getFarmAssistantTemplateSlots() {
    return getFarmAssistantMapSlots();
}

/**
 * Persists the 3 editable slots back into the same storage used by the map's quick-attack buttons.
 */
function saveFarmAssistantTemplateSlots(unitsA, unitsB, unitsC) {
    saveFarmAssistantMapSlots(unitsA, unitsB, unitsC);
}

function renderFarmAssistantTemplatesTable() {
    const container = document.getElementById('farm_assistant_templates_body');
    if (!container) return;

    const units = getFarmAssistantTemplateUnits();
    const templates = getFarmAssistantTemplateSlots();
    const cIsAutomatic = _farmAssistantTemplateCMode === 'auto';

    function unitHeaderCell(unit) {
        const icon = _getNavAssetBase() + 'unit/unit_' + unit + '.webp';
        return `<th style="text-align:center" width="35"><div><a href="#" class="unit_link" data-unit="${unit}" onclick="return false;"><img src="${icon}" data-title="${escapeHtml(getUnitDisplayName(unit))}"></a></div></th>`;
    }

    function unitInputCell(unit, slot, template) {
        const value = template?.units?.[unit] || 0;
        const disabled = slot === 'c' && cIsAutomatic ? ' disabled' : '';
        return `<td align="center"><input type="text" class="farm-assistant-template-unit-input" data-slot="${slot}" data-unit="${unit}" size="3" value="${value}"${disabled}></td>`;
    }

    container.innerHTML = FARM_ASSISTANT_TEMPLATE_SLOTS.map((slot, index) => `
        <tr>
            <td class="template_farm_icon" rowspan="2" align="center" width="10%"><a class="farm_icon farm_icon_${slot.key}${slot.key === 'c' && cIsAutomatic ? ' farm_icon_disabled start_locked' : ''}${slot.key === 'c' ? ' farm-assistant-template-c-toggle' : ''} decoration" href="#" data-mode="${slot.key === 'c' ? _farmAssistantTemplateCMode : ''}" data-title="${escapeFarmAssistantAttribute(t(slot.key === 'c' && cIsAutomatic ? 'farmAssistant.templateCAutoTitle' : slot.key === 'c' ? 'farmAssistant.templateCManualTitle' : slot.translationKey))}" onclick="return false;"></a></td>
            ${units.map(unitHeaderCell).join('')}
            <th style="text-align:center" width="10%"><span class="icon header resources" data-title="${escapeHtml(t('common.resources'))}"></span></th>
            ${index === 0 ? `<td rowspan="6" width="15%" align="center"><div class="vis_item"><input class="btn" type="submit" value="${escapeHtml(t('button.save'))}"></div></td>` : ''}
        </tr>
        <tr>
            ${units.map(unit => unitInputCell(unit, slot.key, templates[index])).join('')}
            <td style="text-align:center" id="farm_assistant_template_total_${slot.key}">0</td>
        </tr>
    `).join('');

    bindFarmAssistantTooltips(container);
    container.querySelector('.farm-assistant-template-c-toggle')?.addEventListener('click', function (event) {
        event.preventDefault();
        setFarmAssistantTemplateCMode(_farmAssistantTemplateCMode === 'auto' ? 'manual' : 'auto');
        renderFarmAssistantTemplatesTable();
        renderFarmAssistantTable();
    });
    FARM_ASSISTANT_TEMPLATE_SLOTS.forEach(slot => updateFarmAssistantTemplateTotal(slot.key));

    container.querySelectorAll('.farm-assistant-template-unit-input').forEach(input => {
        input.addEventListener('input', function () {
            updateFarmAssistantTemplateTotal(input.dataset.slot);
        });
    });
}

/**
 * Recomputes the template's total carry capacity (the "resources" column) from units_carry —
 * this is the value we already have a way to calculate, unlike a real server-side loot estimate.
 */
function updateFarmAssistantTemplateTotal(slot) {
    const carry = JSON.parse(localStorage.getItem('units_carry') || '{}');
    let total = 0;
    document.querySelectorAll('.farm-assistant-template-unit-input[data-slot="' + slot + '"]').forEach(input => {
        total += (parseInt(input.value, 10) || 0) * (carry[input.dataset.unit] || 0);
    });
    const totalCell = document.getElementById('farm_assistant_template_total_' + slot);
    if (totalCell) totalCell.textContent = total;
}

function readFarmAssistantTemplateFormUnits(slot) {
    const units = {};
    document.querySelectorAll('.farm-assistant-template-unit-input[data-slot="' + slot + '"]').forEach(input => {
        units[input.dataset.unit] = parseInt(input.value, 10) || 0;
    });
    return units;
}

function handleFarmAssistantTemplatesSave(event) {
    event.preventDefault();
    saveFarmAssistantTemplateSlots(
        readFarmAssistantTemplateFormUnits('a'),
        readFarmAssistantTemplateFormUnits('b'),
        readFarmAssistantTemplateFormUnits('c')
    );
    renderFarmAssistantTemplatesTable();
    renderFarmAssistantTable();
    if (typeof UI !== 'undefined' && UI.SuccessMessage) UI.SuccessMessage(t('farmAssistant.templatesSaved'));
}

function renderFarmAssistantTroopsTable() {
    const container = document.getElementById('farm_assistant_troops_wrapper');
    if (!container) return;

    const units = getFarmAssistantAvailabilityUnits();
    const counts = bqGet('village_unit_counts', game_data.village.id) || {};
    const selectedUnits = getFarmAssistantAutoUnits();

    container.innerHTML = `
        <table id="units_home" style="width:100%">
            <tbody>
                <tr>
                    <th class="vis"><h4>${escapeHtml(t('farmAssistant.troopsHeading'))}</h4></th>
                    ${units.map(unit => {
                        const icon = _getNavAssetBase() + 'unit/unit_' + unit + '.webp';
                        const checkbox = unit === 'spy'
                            ? ''
                            : `<input type="checkbox" name="${unit}" data-title="${escapeFarmAssistantAttribute(t('farmAssistant.autoUnitTitle'))}"${selectedUnits[unit] ? ' checked="checked"' : ''}>`;
                        return `<th style="width:50px;text-align:center" class="fm_unit" data-title="${escapeHtml(getUnitDisplayName(unit))}"><img src="${icon}" class="" data-title="">${checkbox}</th>`;
                    }).join('')}
                </tr>
                <tr>
                    <td>${escapeHtml(t('farmAssistant.thisVillage'))}</td>
                    ${units.map(unit => {
                        const count = parseInt(String(counts[unit] || '0').split('/')[0], 10) || 0;
                        return `<td style="text-align:center" data-unit-count="${count}" class="unit-item unit-item-${unit}${count === 0 ? ' hidden' : ''}" id="${unit}">${count}</td>`;
                    }).join('')}
                </tr>
            </tbody>
        </table>
    `;
    bindFarmAssistantTooltips(container);
    container.querySelectorAll('#units_home input[type="checkbox"]').forEach(input => {
        input.addEventListener('change', function () {
            const updatedUnits = getFarmAssistantAutoUnits();
            updatedUnits[input.name] = input.checked;
            saveFarmAssistantAutoUnits(updatedUnits);
            renderFarmAssistantTable();
        });
    });
}

/**
 * Returns the "x|y" coords of every village the player currently owns, to filter them out of
 * the target list (attack reports should never point at your own villages, but defensive anyway).
 */
function getFarmAssistantOwnVillageCoords() {
    let villages = [];
    try {
        villages = JSON.parse(localStorage.getItem('villages_info') || '[]');
    } catch {
        villages = [];
    }
    return new Set(villages.map(village => village.coords).filter(Boolean));
}

/**
 * Resolves a stored report into a renderable farm target, or null if the target village
 * can no longer be resolved from the cached village.txt index (e.g. data not fetched yet).
 */
function resolveFarmAssistantTarget(report) {
    const [x, y] = (report.coords || '').split('|');
    if (!x || !y) return null;

    const village = getCachedVillageByCoords(x, y);
    if (!village) return null;

    return {
        report,
        coords: report.coords,
        village,
        distance: calculateDistanceToTarget(report.coords),
        attackCount: _farmAssistantAttackCounts[String(village.id)] || 0
    };
}

function setFarmAssistantTargetsFromReports(reports, ownCoords) {
    _farmAssistantAllTargets = (reports || [])
        .filter(report => report?.coords && !ownCoords.has(report.coords))
        .map(resolveFarmAssistantTarget)
        .filter(Boolean);

    _farmAssistantSort = getFarmAssistantSortState();
    applyFarmAssistantFilters();
}

async function hydrateFarmAssistantReports(reports) {
    if (!window.TWPFMapReports?.hydrateFullReport) return;

    const reportsToRefresh = (reports || [])
        .filter(Boolean)
        .filter(report => !window.TWPFMapReports.isFullReportData?.(report));

    for (let index = 0; index < reportsToRefresh.length; index += 3) {
        await Promise.all(reportsToRefresh.slice(index, index + 3).map(report =>
            window.TWPFMapReports.hydrateFullReport(report)
        ));
    }
}

async function loadFarmAssistantTargets() {
    if (typeof fetchAndCacheWorldSettings === 'function') await fetchAndCacheWorldSettings();
    clearFarmAssistantReportPageSnapshot();
    const reportPageCountPromise = getFarmAssistantReportPageCount().catch(error => {
        console.error('[Farm Assistant] Failed to discover report pages during load:', error);
        return null;
    });
    const ownCoords = getFarmAssistantOwnVillageCoords();
    const reports = window.TWPFMapReports
        ? (window.TWPFMapReports.getAll() || await window.TWPFMapReports.hydrate())
        : await reportGetAll();

    setFarmAssistantTargetsFromReports(reports, ownCoords);
    _farmAssistantPage = 0;

    const syncResult = window.TWPFMapReports
        ? await window.TWPFMapReports.sync()
        : { changed: false };
    const ongoingAttacks = typeof getQuickFarmAttacksBySourceVillage === 'function'
        ? await getQuickFarmAttacksBySourceVillage(game_data.village.id)
        : [];
    _farmAssistantAttackCounts = (ongoingAttacks || []).reduce((counts, attack) => {
        if (attack.status !== 'ongoing' || !attack.targetVillageId) return counts;
        const targetVillageId = String(attack.targetVillageId);
        counts[targetVillageId] = (counts[targetVillageId] || 0) + 1;
        return counts;
    }, {});

    const syncedReports = window.TWPFMapReports
        ? (window.TWPFMapReports.getAll() || reports)
        : reports;
    await hydrateFarmAssistantReports(syncedReports);
    const hydratedReports = window.TWPFMapReports
        ? (window.TWPFMapReports.getAll() || syncedReports)
        : syncedReports;
    setFarmAssistantTargetsFromReports(hydratedReports, ownCoords);

    await reportPageCountPromise;

    if (syncResult?.changed) _farmAssistantPage = 0;
    renderFarmAssistantTable();
}

/**
 * Slowest unit's minutes-per-tile among the template's units with a count > 0, used to
 * estimate the travel duration for this template to a given distance.
 */
function getFarmAssistantTemplateDurationMinutes(units, distance) {
    const unitSpeeds = JSON.parse(localStorage.getItem('units_speed') || '{}');
    let slowest = 0;
    Object.keys(units || {}).forEach(unit => {
        if (units[unit] > 0 && unitSpeeds[unit] > slowest) slowest = unitSpeeds[unit];
    });
    return slowest > 0 ? slowest * distance : null;
}

function getFarmAssistantAvailableTroops() {
    const counts = bqGet('village_unit_counts', game_data.village.id) || {};
    const selectedUnits = getFarmAssistantAutoUnits();
    return getFarmAssistantAvailabilityUnits().filter(unit => selectedUnits[unit]).reduce((available, unit) => {
        const count = parseInt(String(counts[unit] || '0').split('/')[0], 10) || 0;
        if (count > 0) available[unit] = count;
        return available;
    }, {});
}

function getFarmAssistantAutomaticResourceTotal(target, travelMinutes) {
    const report = target?.report;
    const expected = report?.hasSpy && window.TWPFMapReports?.getExpectedResources
        ? window.TWPFMapReports.getExpectedResources(report, travelMinutes / 60)
        : null;
    const resources = expected || report?.spyDiscover || report?.loot;
    if (!resources) return null;

    const total = ['wood', 'stone', 'iron'].reduce((sum, resource) => sum + (Number(resources[resource]) || 0), 0);
    return total > 0 ? total : null;
}

function buildFarmAssistantAutomaticCandidate(target, resourceTotal, maxSpeed) {
    const available = getFarmAssistantAvailableTroops();
    const speeds = JSON.parse(localStorage.getItem('units_speed') || '{}');
    const carry = JSON.parse(localStorage.getItem('units_carry') || '{}');
    const spySpeed = Number(speeds.spy);
    if (!available.spy || spySpeed <= 0 || spySpeed > maxSpeed) return null;

    const spyCarry = Number(carry.spy) || 0;
    const units = { spy: 1 };
    const candidates = Object.keys(available)
        .filter(unit => unit !== 'spy' && Number(speeds[unit]) > 0 && Number(speeds[unit]) <= maxSpeed && Number(carry[unit]) > 0)
        .sort((left, right) => Number(carry[right]) - Number(carry[left]) || Number(speeds[left]) - Number(speeds[right]));
    let remaining = Math.max(0, resourceTotal - spyCarry);

    candidates.forEach(unit => {
        if (remaining <= 0) return;
        const amount = Math.min(available[unit], Math.ceil(remaining / Number(carry[unit])));
        if (amount > 0) {
            units[unit] = amount;
            remaining -= amount * Number(carry[unit]);
        }
    });

    // Not enough troops to cover the full expected loot: still send everything available
    // rather than leaving Template C locked, as long as at least one attack unit is included.
    const durationMinutes = getFarmAssistantTemplateDurationMinutes(units, target.distance);
    return durationMinutes !== null && Object.keys(units).length > 1
        ? { units, capacity: resourceTotal - remaining, durationMinutes, full: remaining <= 0 }
        : null;
}

function calculateFarmAssistantAutomaticComposition(target) {
    const speeds = JSON.parse(localStorage.getItem('units_speed') || '{}');
    const availableSpeeds = Object.keys(getFarmAssistantAvailableTroops())
        .map(unit => Number(speeds[unit]))
        .filter(speed => speed > 0);
    if (availableSpeeds.length === 0) return null;

    let resourceTotal = getFarmAssistantAutomaticResourceTotal(target, 0);
    if (!resourceTotal) return null;

    let best = null;
    const speedLimits = [...new Set(availableSpeeds)].sort((left, right) => left - right);
    for (let iteration = 0; iteration < 3; iteration += 1) {
        const candidates = speedLimits
            .map(speed => buildFarmAssistantAutomaticCandidate(target, resourceTotal, speed))
            .filter(Boolean)
            .map(candidate => Object.assign(candidate, {
                score: resourceTotal / Math.max(candidate.durationMinutes * 2, 1)
            }));
        // Full-loot candidates always outrank partial (best-effort) ones; among partial candidates
        // prefer whichever carries the most of the expected loot.
        best = candidates.sort((left, right) => (right.full - left.full)
            || (right.capacity - left.capacity)
            || right.score - left.score
            || Object.keys(left.units).length - Object.keys(right.units).length
            || left.durationMinutes - right.durationMinutes)[0] || null;
        if (!best) return null;

        const updatedResourceTotal = getFarmAssistantAutomaticResourceTotal(target, best.durationMinutes);
        if (!updatedResourceTotal || updatedResourceTotal === resourceTotal) break;
        resourceTotal = updatedResourceTotal;
    }

    return best ? { name: t('farmAssistant.templateC'), units: best.units, full: best.full } : null;
}

function getFarmAssistantAutomaticCompositionKey(target) {
    const available = getFarmAssistantAvailableTroops();
    const availabilityKey = Object.keys(available).sort().map(unit => `${unit}:${available[unit]}`).join(',');
    return `${target.coords}_${target.report.id}_${target.report.date}_${availabilityKey}`;
}

function getFarmAssistantAutomaticComposition(target) {
    const key = getFarmAssistantAutomaticCompositionKey(target);
    const cached = _farmAssistantAutomaticCompositions[key];
    if (!cached) {
        _farmAssistantAutomaticCompositions[key] = { status: 'pending' };
        Promise.resolve().then(() => {
            const units = calculateFarmAssistantAutomaticComposition(target);
            _farmAssistantAutomaticCompositions[key] = units
                ? { status: 'ready', template: units }
                : { status: 'unavailable' };
            renderFarmAssistantTable();
        });
        return null;
    }
    return cached.status === 'ready' ? cached.template : null;
}

function hasEnoughTroopsForTemplate(template) {
    const counts = bqGet('village_unit_counts', game_data.village.id) || {};
    return Object.keys(template.units || {}).every(unit => {
        const needed = template.units[unit] || 0;
        if (needed <= 0) return true;
        const available = parseInt(String(counts[unit] || '0').split('/')[0], 10) || 0;
        return available >= needed;
    });
}

/**
 * Builds the rich data-tooltip-tpl content, mirroring the native farm_icon tooltip format
 * (unit icons + counts, total carry, travel duration).
 */
function buildFarmAssistantTemplateTooltip(template, distance) {
    const carry = JSON.parse(localStorage.getItem('units_carry') || '{}');
    let totalCarry = 0;
    let html = '';

    getFarmAssistantTemplateUnits().forEach(unit => {
        const amount = template.units?.[unit] || 0;
        if (amount > 0) {
            html += `<img src="${_getNavAssetBase()}unit/unit_${unit}.webp" title="" alt="" />${amount}<br />`;
            totalCarry += amount * (carry[unit] || 0);
        }
    });
    html += `<img src="${_getNavAssetBase()}res.png" title="${escapeHtml(t('common.resources'))}" />${totalCarry}<br />`;

    const durationMinutes = getFarmAssistantTemplateDurationMinutes(template.units, distance);
    if (durationMinutes !== null) {
        html += escapeHtml(t('farmAssistant.duration', { time: formatMinutesToTime(durationMinutes) }));
    }
    if (template.full === false) {
        html += '<br />' + escapeHtml(t('farmAssistant.templateCAutoPartial'));
    }
    return html;
}

function renderFarmAssistantTemplateButton(target, template, slot) {
    const isAutomatic = slot === 'c' && _farmAssistantTemplateCMode === 'auto';
    const automaticTemplate = isAutomatic ? getFarmAssistantAutomaticComposition(target) : null;
    const effectiveTemplate = isAutomatic ? automaticTemplate : template;
    if (!effectiveTemplate && !isAutomatic) return '';

    const status = isAutomatic
        ? _farmAssistantAutomaticCompositions[getFarmAssistantAutomaticCompositionKey(target)]?.status
        : null;
    const enoughTroops = effectiveTemplate && hasEnoughTroopsForTemplate(effectiveTemplate);
    const disabledClasses = !effectiveTemplate || !enoughTroops ? ' farm_icon_disabled start_locked' : '';
    const tooltip = effectiveTemplate
        ? buildFarmAssistantTemplateTooltip(effectiveTemplate, target.distance)
        : status === 'pending'
            ? t('farmAssistant.templateCAutoCalculating')
            : t('farmAssistant.templateCAutoUnavailable');

    // farm_icon/farm_icon_a/farm_icon_b/farm_icon_c are native classes built for absolutely-positioned map
    // overlay buttons — pinned back to static/inline-block here so they sit side by side in a cell.
    return `<a href="#" class="farm-assistant-send-btn farm_village_${target.village.id} farm_icon farm_icon_${slot}${disabledClasses}"
        style="position:static;display:inline-block;vertical-align:middle;"
        data-coords="${escapeHtml(target.coords)}" data-village-id="${escapeHtml(target.village.id)}" data-slot="${slot}"
        data-auto="${isAutomatic ? '1' : '0'}" data-tooltip-tpl="${escapeFarmAssistantAttribute(tooltip)}"></a>`;
}

function renderFarmAssistantTheadOnce() {
    const thead = document.getElementById('farm_assistant_thead');
    if (!thead || thead.dataset.built === '1') return;
    thead.dataset.built = '1';

    thead.innerHTML = `
        <tr>
            <th rowspan="2"><img src="${_getNavAssetBase()}delete_small.webp"></th>
            <th rowspan="2">&nbsp;</th>
            <th rowspan="2">&nbsp;</th>
            <th rowspan="2">${escapeHtml(t('common.village'))}</th>
            <th rowspan="2"><a href="${getFarmAssistantSortLink('date')}">${escapeHtml(t('farmAssistant.columnTime'))}</a></th>
            <th colspan="3" class="center" rowspan="2"><span class="icon header ressources" data-title="${escapeHtml(t('farmAssistant.resourcesHeaderTitle'))}"></span></th>
            <th rowspan="2"><img src="${_getNavAssetBase()}buildings/wall.webp" data-title="${escapeHtml(t('farmAssistant.wallHeaderTitle'))}"></th>
            <th rowspan="2"><a href="${getFarmAssistantSortLink('distance')}"><img src="${_getNavAssetBase()}rechts.webp" data-title="${escapeHtml(t('farmAssistant.columnDistance'))}"></a></th>
            <th rowspan="2" colspan="1"><img src="${_getNavAssetBase()}questionmark.webp" class="questionmark-tooltip" data-title="${escapeHtml(t('farmAssistant.sendHeaderTitle'))}"></th>
        </tr>
        <tr></tr>
    `;
    bindFarmAssistantTooltips(thead);
}

function renderFarmAssistantRow(target, rowIndex) {
    const { report, village, coords, distance, attackCount } = target;
    const templates = getFarmAssistantTemplateSlots();
    const expectedResources = report.hasSpy
        ? window.TWPFMapReports?.getExpectedResources?.(report)
        : null;
    const displayedResources = expectedResources || report.spyDiscover;

    const maxLootCell = (() => {
        if (!report.loot || report.loot.popTotal == null || report.loot.popLooted == null) return '<td></td>';
        const isFull = Number(report.loot.popLooted) >= Number(report.loot.popTotal);
        const title = isFull ? t('farmAssistant.lootFull') : t('farmAssistant.lootPartial');
        return `<td><img src="${_getNavAssetBase()}max_loot/${isFull ? 1 : 0}.webp" data-title="${escapeHtml(title)}"></td>`;
    })();

    const safeWarehouseCapacity = report.hasSpy && window.TWPFMapReports?.getSafeWarehouseCapacity
        ? window.TWPFMapReports.getSafeWarehouseCapacity(report.spyBuildingLevels?.storage)
        : null;
    const formatResourceValue = resource => {
        const value = Number(displayedResources?.[resource]) || 0;
        const warningThreshold = safeWarehouseCapacity === null ? null : safeWarehouseCapacity * 0.9;
        const warningClass = warningThreshold !== null && value > warningThreshold ? ' class="warn_90"' : '';
        return `<span${warningClass}>${escapeHtml(String(value))}</span>`;
    };
    const resourcesCell = displayedResources
        ? `<td style="text-align: center;" colspan="3"><span class="icon wood"></span>${formatResourceValue('wood')} <span class="icon stone"></span>${formatResourceValue('stone')} <span class="icon iron"></span>${formatResourceValue('iron')}</td>`
        : `<td style="text-align: center;" colspan="3"><span data-title="${escapeHtml(t('farmAssistant.resourcesUnknownTooltip'))}">${escapeHtml(t('farmAssistant.resourcesUnknown'))}</span></td>`;

    return `<tr id="farm_assistant_village_${village.id}" class="${rowIndex % 2 === 0 ? 'row_a' : 'row_b'}">
        <td><a href="#" class="farm-assistant-delete-btn" data-coords="${escapeHtml(coords)}" data-title="${escapeHtml(t('farmAssistant.deleteTitle'))}"><img src="${_getNavAssetBase()}delete_small.webp"></a></td>
        <td>${report.dot ? `<img src="${report.dot.src}" data-title="${escapeHtml(report.dot.title)}">` : ''}</td>
        ${maxLootCell}
        <td><a href="${game_data.link_base_pure}report&mode=all&view=${report.id}" target="_blank" rel="noopener noreferrer">(${village.x}|${village.y}) ${escapeHtml(village.continent)}${attackCount > 0 ? ` <img src="/graphic/command/attack.png" width="16" height="16" data-title="${escapeHtml(t('farmAssistant.ongoingAttacks'))}"> (${attackCount})` : ''}</a></td>
        <td>${escapeHtml(formatFarmAssistantReportDate(report.date))}</td>
        ${resourcesCell}
        <td style="text-align: center;">${report.hasSpy ? escapeHtml(String(report.wallLevel ?? 0)) : '?'}</td>
        <td>${distance}</td>
        <td style="white-space:nowrap;text-align:center;">${FARM_ASSISTANT_TEMPLATE_SLOTS.map((slot, index) => renderFarmAssistantTemplateButton(target, templates[index], slot.key)).join('')}</td>
    </tr>`;
}

function renderFarmAssistantPageNav(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const pageSize = getFarmAssistantPageSize();
    const totalPages = Math.max(1, Math.ceil(_farmAssistantTargets.length / pageSize));

    let items = '';
    for (let page = 0; page < totalPages; page++) {
        items += page === _farmAssistantPage
            ? `<strong class="paged-nav-item"> &gt;${page + 1}&lt; </strong>`
            : `<a href="#" class="paged-nav-item farm-assistant-page-link" data-page="${page}">${page + 1}</a> `;
    }

    container.innerHTML = `<table style="width:100%;"><tbody><tr><td align="center" colspan="12">${items}</td></tr></tbody></table>`;
    container.querySelectorAll('.farm-assistant-page-link').forEach(link => {
        link.addEventListener('click', function (event) {
            event.preventDefault();
            _farmAssistantPage = parseInt(link.dataset.page, 10) || 0;
            renderFarmAssistantTable();
        });
    });
}

function renderFarmAssistantTable() {
    renderFarmAssistantTheadOnce();

    const tbody = document.getElementById('farm_assistant_rows');
    if (!tbody) return;

    const pageSize = getFarmAssistantPageSize();
    const totalPages = Math.max(1, Math.ceil(_farmAssistantTargets.length / pageSize));
    _farmAssistantPage = Math.min(_farmAssistantPage, totalPages - 1);

    const pageItems = _farmAssistantTargets.slice(_farmAssistantPage * pageSize, (_farmAssistantPage + 1) * pageSize);

    tbody.innerHTML = pageItems.length === 0
        ? `<tr><td align="center" colspan="12">${escapeHtml(t('farmAssistant.emptyTargets'))}</td></tr>`
        : pageItems.map((target, index) => renderFarmAssistantRow(target, index)).join('');

    bindFarmAssistantTooltips(tbody);
    bindFarmAssistantRowEvents(tbody);
    renderFarmAssistantPageNav('farm_assistant_nav_top');
    renderFarmAssistantPageNav('farm_assistant_nav_bottom_pages');
}

function bindFarmAssistantRowEvents(tbody) {
    tbody.querySelectorAll('.farm-assistant-delete-btn').forEach(button => {
        button.addEventListener('click', async function (event) {
            event.preventDefault();
            if (!confirm(t('farmAssistant.deleteConfirm'))) return;
            const coords = button.dataset.coords;
            await reportRemove(coords);
            window.TWPFMapReports?.notifyUpdated();
            _farmAssistantAllTargets = _farmAssistantAllTargets.filter(target => target.coords !== coords);
            _farmAssistantTargets = _farmAssistantTargets.filter(target => target.coords !== coords);
            renderFarmAssistantTable();
        });
    });

    tbody.querySelectorAll('.farm-assistant-send-btn').forEach(button => {
        button.addEventListener('click', async function (event) {
            event.preventDefault();
            if (button.classList.contains('farm_icon_disabled')) return;
            await handleFarmAssistantSend(button);
        });
    });
}

function updateFarmAssistantTroopCounts(units) {
    const villageId = game_data.village.id;
    const counts = bqGet('village_unit_counts', villageId);
    if (!counts) return;

    const updatedCounts = Object.assign({}, counts);
    Object.keys(units).forEach(unit => {
        if (updatedCounts[unit] == null) return;

        const rawCount = String(updatedCounts[unit]);
        const parts = rawCount.split('/');
        const available = parseInt(parts[0], 10);
        const sent = parseInt(units[unit], 10) || 0;
        if (!Number.isFinite(available)) return;

        const remaining = Math.max(0, available - sent);
        updatedCounts[unit] = parts.length > 1 ? remaining + '/' + parts[1] : remaining;
    });

    bqSet('village_unit_counts', villageId, updatedCounts);
}

async function handleFarmAssistantSend(button) {
    if (window.PremiumFeaturesBotProtection?.isActive()) return;

    const slotIndex = FARM_ASSISTANT_TEMPLATE_SLOTS.findIndex(slot => slot.key === button.dataset.slot);
    const target = _farmAssistantAllTargets.find(item => item.coords === button.dataset.coords);
    const template = slotIndex >= 0
        ? button.dataset.auto === '1' && target
            ? getFarmAssistantAutomaticComposition(target)
            : getFarmAssistantTemplateSlots()[slotIndex]
        : null;
    if (!template) return;

    const units = {};
    Object.keys(template.units || {}).forEach(unit => {
        if (template.units[unit] > 0) units[unit] = template.units[unit];
    });
    if (Object.keys(units).length === 0) return;

    const baseline = typeof getQuickFarmAttackReportBaseline === 'function'
        ? getQuickFarmAttackReportBaseline(button.dataset.coords)
        : {};

    const originalBackgroundImage = button.style.backgroundImage;
    button.classList.add('farm_icon_disabled', 'start_locked');
    button.style.backgroundImage = 'url(https://dsbr.innogamescdn.com/asset/f441272cc5/graphic/loading.gif)';
    button.style.cursor = 'wait';
    button.style.pointerEvents = 'none';
    button.setAttribute('aria-label', t('common.loading'));
    try {
        const attackSucceeded = await launchAttack(units, button.dataset.villageId, button.dataset.coords);
        if (attackSucceeded) {
            updateFarmAssistantTroopCounts(units);
            if (button.dataset.auto === '1' && target) {
                delete _farmAssistantAutomaticCompositions[getFarmAssistantAutomaticCompositionKey(target)];
            }
            renderFarmAssistantTroopsTable();
            renderFarmAssistantTable();

            if (typeof recordQuickFarmAttack === 'function') {
                recordQuickFarmAttack({
                    sourceVillageId: game_data.village.id,
                    targetVillageId: button.dataset.villageId,
                    targetCoords: button.dataset.coords,
                    units,
                    previousReportId: baseline.previousReportId,
                    previousReportAtMs: baseline.previousReportAtMs,
                    templateName: template.name,
                    templateSlot: button.dataset.slot,
                    origin: 'farm-assistant-screen',
                    playerId: game_data.player?.id,
                    world: game_data.world
                }).then(() => {
                    const target = _farmAssistantAllTargets.find(item => String(item.village.id) === String(button.dataset.villageId));
                    if (!target) return;
                    target.attackCount = (target.attackCount || 0) + 1;
                    applyFarmAssistantFilters();
                });
            }
        }
    } finally {
        button.style.backgroundImage = originalBackgroundImage;
        button.style.cursor = '';
        button.style.pointerEvents = '';
        button.removeAttribute('aria-label');
        setTimeout(() => {
            if (hasEnoughTroopsForTemplate(template)) button.classList.remove('farm_icon_disabled', 'start_locked');
        }, FARM_ASSISTANT_SEND_COOLDOWN_MS);
    }
}
