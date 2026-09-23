// ==UserScript==
// @name         Tribal Wars - Manual Scavenging
// @namespace    tribalwars-premium-features
// @version      1.0.0
// @description  Calcula e envia tropas para os scavengers selecionados num clique. Nao possui auto-scavenge.
// @author       Tribalwars Premium Features
// @match        https://*.tribalwars.*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * Instalacao:
 * 1. Crie um novo script no Tampermonkey.
 * 2. Cole este ficheiro completo e guarde.
 * 3. Abra uma aldeia em game.php?screen=place&mode=scavenge.
 *
 * Utilizacao:
 * - Escolha os niveis e as tropas.
 * - Com "Distribuir por varios niveis" ativo, o preview calcula a distribuicao.
 * - Clique em "Calcular e enviar" para enviar os niveis livres, do maior para o menor.
 * - O script nao cria timers, nao guarda configuracoes e nao volta a enviar sozinho.
 *
 * Este script depende apenas do widget nativo da pagina e dos dados/API nativos do jogo.
 */
(function () {
    'use strict';

    const PANEL_ID = 'standalone_scavenge_panel';
    const UNIT_CARRY = {
        spear: 25, sword: 15, axe: 10, archer: 10,
        spy: 0, light: 80, marcher: 50, heavy: 50,
        ram: 0, catapult: 0, knight: 100, snob: 0
    };
    const UNIT_ORDER = ['spear', 'sword', 'axe', 'archer', 'light', 'marcher', 'heavy', 'knight'];
    const TIER_RATIOS = [0.10, 0.25, 0.50, 0.75];

    function getWorldSpeed() {
        const value = Number(window.game_data?.world_speed || window.game_data?.speed || 1);
        return Number.isFinite(value) && value > 0 ? value : 1;
    }

    function getWidget() {
        return Array.from(document.querySelectorAll('.candidate-squad-widget'))
            .find(widget => !widget.closest('#' + PANEL_ID));
    }

    function getUnitMeta() {
        const widget = getWidget();
        if (!widget) return [];
        return Array.from(widget.querySelectorAll('input[name]')).map(input => {
            const attr = input.getAttribute('data-all-count') || input.getAttribute('data-all_count') || input.dataset.allCount;
            let count = Number.parseInt(attr, 10);
            if (!Number.isFinite(count) || count < 0) {
                const link = widget.querySelector('.units-entry-all[data-unit="' + input.name + '"]');
                const match = link?.textContent?.match(/\d+/);
                count = match ? Number.parseInt(match[0], 10) : 0;
            }
            return { unit: input.name, maxCount: count };
        }).filter(item => item.unit);
    }

    function setInputValue(input, value) {
        if (!input) return;
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function duration(capacity, ratio) {
        const factor = Math.pow(getWorldSpeed(), -0.55);
        return capacity <= 0
            ? 1800 * factor
            : (Math.pow(Math.pow(capacity, 2) * 100 * Math.pow(ratio, 2), 0.45) + 1800) * factor;
    }

    function capacityForLambda(lambda, ratio) {
        if (lambda <= 0) return Infinity;
        const factor = Math.pow(getWorldSpeed(), -0.55);
        const a = factor * Math.pow(100 * ratio * ratio, 0.45);
        const b = 1800 * factor;
        const d = (360 * ratio + Math.sqrt(Math.pow(360 * ratio, 2) + 4 * lambda * 3240 * ratio * b)) / (2 * lambda);
        return d <= b ? 0 : Math.pow((d - b) / a, 10 / 9);
    }

    function optimizeBalanced(totalCapacity, tiers) {
        if (!tiers.length || totalCapacity <= 0) return tiers.map(() => 0);
        const factor = Math.pow(getWorldSpeed(), -0.55);
        let low = 0;
        let high = Math.max(...tiers.map(tier => 2 * tier.ratio / factor));
        for (let index = 0; index < 100; index += 1) {
            const middle = (low + high) / 2;
            const capacity = tiers.reduce((sum, tier) => sum + capacityForLambda(middle, tier.ratio), 0);
            if (capacity > totalCapacity) low = middle;
            else high = middle;
        }
        const lambda = (low + high) / 2;
        return tiers.map(tier => {
            const capacity = capacityForLambda(lambda, tier.ratio);
            return Number.isFinite(capacity) ? Math.max(0, capacity) : totalCapacity;
        });
    }

    function capacityForDuration(time, ratio) {
        const factor = Math.pow(getWorldSpeed(), -0.55);
        const inner = time / factor - 1800;
        return inner <= 0 ? 0 : Math.sqrt(Math.max(0, Math.pow(inner, 1 / 0.45) / (100 * ratio * ratio)));
    }

    function optimizeFastest(totalCapacity, tiers) {
        if (!tiers.length || totalCapacity <= 0) return tiers.map(() => 0);
        const factor = Math.pow(getWorldSpeed(), -0.55);
        let low = 1800 * factor;
        let high = low + 1;
        let guard = 0;
        while (tiers.reduce((sum, tier) => sum + capacityForDuration(high, tier.ratio), 0) < totalCapacity && guard++ < 200) high *= 2;
        for (let index = 0; index < 100; index += 1) {
            const middle = (low + high) / 2;
            const capacity = tiers.reduce((sum, tier) => sum + capacityForDuration(middle, tier.ratio), 0);
            if (capacity < totalCapacity) low = middle;
            else high = middle;
        }
        const time = (low + high) / 2;
        return tiers.map(tier => capacityForDuration(time, tier.ratio));
    }

    function distributeTroops(unitCounts, tiers, targets, totalCapacity) {
        const fractions = targets.map(target => totalCapacity > 0 ? target / totalCapacity : 0);
        const result = {};
        UNIT_ORDER.forEach(unit => {
            const count = unitCounts[unit] || 0;
            result[unit] = new Array(tiers.length).fill(0);
            if (!count || !tiers.length) return;
            const raw = fractions.map(fraction => count * fraction);
            const floors = raw.map(Math.floor);
            const remainder = count - floors.reduce((sum, value) => sum + value, 0);
            const order = raw.map((_, index) => index).sort((a, b) => (raw[b] - floors[b]) - (raw[a] - floors[a]));
            floors.forEach((value, index) => { result[unit][index] = value; });
            for (let index = 0; index < remainder; index += 1) result[unit][order[index]] += 1;
        });
        return result;
    }

    function calculateDistribution(unitCounts, tiers, mode) {
        const totalCapacity = UNIT_ORDER.reduce((sum, unit) => sum + (unitCounts[unit] || 0) * (UNIT_CARRY[unit] || 0), 0);
        if (!totalCapacity || !tiers.length) return {};
        const targets = mode === 'fastest'
            ? optimizeFastest(totalCapacity, tiers)
            : optimizeBalanced(totalCapacity, tiers);
        const split = distributeTroops(unitCounts, tiers, targets, totalCapacity);
        const distribution = {};
        tiers.forEach((tier, tierIndex) => {
            const units = {};
            let carryMax = 0;
            UNIT_ORDER.forEach(unit => {
                const count = split[unit]?.[tierIndex] || 0;
                if (count > 0) {
                    units[unit] = count;
                    carryMax += count * (UNIT_CARRY[unit] || 0);
                }
            });
            if (Object.keys(units).length) distribution[tier.baseId] = { units, carryMax };
        });
        return distribution;
    }

    function getOptions() {
        return Array.from(document.querySelectorAll('.scavenge-option')).map((element, index) => ({
            element,
            index,
            locked: Boolean(element.querySelector('.locked-view')),
            running: Boolean(element.querySelector('.return-countdown')),
            baseId: Number.parseInt(element.dataset.optionId || element.dataset.option_id || String(index + 1), 10),
            ratio: TIER_RATIOS[index] || 0
        }));
    }

    function getSelectedOptions(levelCheckboxes) {
        const selected = new Set(levelCheckboxes.filter(input => input.checked).map(input => Number(input.dataset.optionIndex)));
        return getOptions().filter(option => !option.locked && selected.has(option.index) && option.ratio > 0)
            .map(option => ({ baseId: option.baseId, ratio: option.ratio, index: option.index, element: option.element }));
    }

    function formatDuration(seconds) {
        if (!seconds) return '-';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainder = Math.round(seconds % 60);
        return [hours, minutes, remainder].map(value => String(value).padStart(2, '0')).join(':');
    }

    function renderPreview(target, units, tiers, mode) {
        if (!tiers.length) {
            target.innerHTML = '<p style="color:#d66;">Nao existem niveis selecionados.</p>';
            return;
        }
        const totalCapacity = UNIT_ORDER.reduce((sum, unit) => sum + (units[unit] || 0) * (UNIT_CARRY[unit] || 0), 0);
        if (!totalCapacity) {
            target.innerHTML = '<p style="color:#d66;">Indique pelo menos uma tropa com capacidade.</p>';
            return;
        }
        const targets = mode === 'fastest' ? optimizeFastest(totalCapacity, tiers) : optimizeBalanced(totalCapacity, tiers);
        const split = distributeTroops(units, tiers, targets, totalCapacity);
        const visibleUnits = UNIT_ORDER.filter(unit => (units[unit] || 0) > 0);
        let html = '<table class="vis" style="width:100%;font-size:11px;margin-top:8px"><tr><th>Nivel</th>';
        visibleUnits.forEach(unit => { html += '<th>' + unit + '</th>'; });
        html += '<th>Capacidade</th><th>Recursos</th><th>Duracao</th></tr>';
        tiers.forEach((tier, index) => {
            let capacity = 0;
            visibleUnits.forEach(unit => { capacity += (split[unit]?.[index] || 0) * (UNIT_CARRY[unit] || 0); });
            html += '<tr><td><b>' + (tier.index + 1) + '</b></td>';
            visibleUnits.forEach(unit => { html += '<td>' + (split[unit]?.[index] || 0) + '</td>'; });
            html += '<td>' + capacity + '</td><td>' + Math.round(capacity * tier.ratio) + '</td><td>' + formatDuration(duration(capacity, tier.ratio)) + '</td></tr>';
        });
        target.innerHTML = html + '</table>';
    }

    function extractVillageData(html) {
        const scripts = Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('script'));
        const text = scripts.map(script => script.textContent || '').find(value => value.includes('var village = {'));
        if (!text) return null;
        const start = text.indexOf('var village = {') + 'var village = '.length;
        let depth = 0;
        let end = start;
        for (; end < text.length; end += 1) {
            if (text[end] === '{') depth += 1;
            if (text[end] === '}') {
                depth -= 1;
                if (depth === 0) break;
            }
        }
        try { return JSON.parse(text.slice(start, end + 1)); } catch (error) {
            console.error('[ManualScavenge] Village data parse failed', error);
            return null;
        }
    }

    async function getFreshVillage() {
        const url = window.game_data?.link_base_pure;
        if (!url) throw new Error('URL da pagina de scavenging indisponivel.');
        const response = await fetch(url + 'place&mode=scavenge', { credentials: 'include' });
        if (!response.ok) throw new Error('Nao foi possivel atualizar o estado dos scavengers.');
        const village = extractVillageData(await response.text());
        if (!village) throw new Error('Nao foi possivel ler o estado dos scavengers.');
        return village;
    }

    async function sendSquad(units, optionId, carryMax) {
        const villageId = window.game_data?.village?.id;
        const csrf = window.game_data?.csrf;
        const url = window.game_data?.link_base_pure;
        if (!villageId || !csrf || !url) throw new Error('Dados da aldeia ou sessao indisponiveis.');
        const params = new URLSearchParams();
        params.set('squad_requests[0][village_id]', villageId);
        Object.entries(units).forEach(([unit, count]) => params.set('squad_requests[0][candidate_squad][unit_counts][' + unit + ']', count));
        params.set('squad_requests[0][candidate_squad][carry_max]', carryMax);
        params.set('squad_requests[0][option_id]', optionId);
        params.set('squad_requests[0][use_premium]', 'false');
        params.set('h', csrf);
        const response = await fetch(url + 'scavenge_api&ajaxaction=send_squads', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'tribalwars-ajax': '1', 'x-requested-with': 'XMLHttpRequest' },
            body: params.toString(),
            credentials: 'include'
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        const result = data?.response?.squad_responses?.[0];
        return result?.success === true ? { success: true } : { success: false, error: result?.error || 'O servidor recusou o envio.' };
    }

    async function sendSelected(distribution, status, button) {
        button.disabled = true;
        status.textContent = 'A atualizar os niveis...';
        try {
            const village = await getFreshVillage();
            const states = Object.values(village.options || {});
            const ids = Object.keys(distribution).map(Number).sort((a, b) => b - a);
            const sent = [];
            const skipped = [];
            const failed = [];
            for (const optionId of ids) {
                const state = states.find(option => Number(option.base_id) === optionId);
                if (!state || state.is_locked || state.scavenging_squad) {
                    skipped.push(optionId);
                    continue;
                }
                const result = await sendSquad(distribution[optionId].units, optionId, distribution[optionId].carryMax);
                if (result.success) sent.push(optionId);
                else failed.push(optionId + ': ' + result.error);
            }
            status.innerHTML = '<b>Concluido.</b> Enviados: ' + (sent.join(', ') || 'nenhum') +
                '. Ignorados/ocupados: ' + (skipped.join(', ') || 'nenhum') +
                '. Falhas: ' + (failed.join(', ') || 'nenhuma') + '.';
        } catch (error) {
            status.textContent = 'Erro: ' + error.message;
        } finally {
            button.disabled = false;
        }
    }

    function injectPanel() {
        if (document.getElementById(PANEL_ID)) return;
        const container = document.querySelector('.scavenge-screen-main-widget');
        if (!container) return;
        const meta = getUnitMeta();
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.className = 'vis';
        panel.style.cssText = 'width:100%;margin-bottom:8px;';
        panel.innerHTML = '<h4 class="head">Scavenging manual</h4>';
        const content = document.createElement('div');
        content.style.padding = '6px';
        const options = getOptions();
        const levelRow = document.createElement('div');
        levelRow.innerHTML = '<b>Niveis:</b> ';
        const levelInputs = [];
        options.forEach(option => {
            if (option.locked) return;
            const label = document.createElement('label');
            label.style.cssText = 'margin-right:12px;white-space:nowrap;';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = true;
            input.dataset.optionIndex = String(option.index);
            input.style.marginRight = '4px';
            label.append(input, document.createTextNode(String(option.index + 1)));
            levelRow.appendChild(label);
            levelInputs.push(input);
        });
        content.appendChild(levelRow);

        const settings = document.createElement('div');
        settings.style.marginTop = '6px';
        settings.innerHTML = '<label><input id="manual_scavenge_optimize" type="checkbox" checked> Distribuir por varios niveis</label> ' +
            '<label style="margin-left:12px"><input name="manual_scavenge_mode" type="radio" value="balanced" checked> Balanced</label> ' +
            '<label><input name="manual_scavenge_mode" type="radio" value="fastest"> Fastest</label>';
        content.appendChild(settings);

        const unitsTable = document.createElement('table');
        unitsTable.className = 'vis';
        unitsTable.style.cssText = 'width:100%;font-size:11px;margin-top:6px;';
        const head = document.createElement('tr');
        const values = document.createElement('tr');
        const inputs = {};
        meta.filter(item => item.unit !== 'knight').forEach(item => {
            const th = document.createElement('th');
            th.textContent = item.unit;
            const td = document.createElement('td');
            td.style.textAlign = 'center';
            const input = document.createElement('input');
            input.type = 'number'; input.min = '0'; input.value = item.maxCount; input.style.width = '48px';
            inputs[item.unit] = input;
            const max = document.createElement('a');
            max.href = '#'; max.textContent = ' (' + item.maxCount + ')';
            max.onclick = event => { event.preventDefault(); setInputValue(input, Number(input.value) === item.maxCount ? 0 : item.maxCount); refresh(); };
            input.oninput = refresh;
            td.append(input, max); head.appendChild(th); values.appendChild(td);
        });
        unitsTable.append(head, values);
        content.appendChild(unitsTable);
        const fill = document.createElement('button');
        fill.type = 'button'; fill.textContent = 'Preencher todas'; fill.style.marginTop = '6px';
        fill.onclick = () => { meta.forEach(item => { if (inputs[item.unit]) setInputValue(inputs[item.unit], item.maxCount); }); refresh(); };
        content.appendChild(fill);
        const preview = document.createElement('div');
        content.appendChild(preview);
        const send = document.createElement('button');
        send.type = 'button'; send.textContent = 'Calcular e enviar'; send.style.marginTop = '8px';
        const status = document.createElement('div');
        status.style.cssText = 'margin-top:6px;font-size:11px;';
        content.append(send, status);
        panel.appendChild(content);
        container.insertBefore(panel, container.firstChild);

        function getUnits() {
            return Object.fromEntries(Object.entries(inputs).map(([unit, input]) => [unit, Math.max(0, Number.parseInt(input.value, 10) || 0)]));
        }
        function getTiers() { return getSelectedOptions(levelInputs); }
        function refresh() {
            const optimize = document.getElementById('manual_scavenge_optimize').checked;
            const tiers = getTiers();
            if (!optimize) { preview.innerHTML = '<p style="margin-top:6px;">Modo de nivel unico ativo.</p>'; return; }
            const mode = panel.querySelector('input[name="manual_scavenge_mode"]:checked').value;
            renderPreview(preview, getUnits(), tiers, mode);
        }
        levelInputs.forEach(input => { input.onchange = refresh; });
        settings.querySelector('#manual_scavenge_optimize').onchange = refresh;
        settings.querySelectorAll('input[name="manual_scavenge_mode"]').forEach(input => { input.onchange = refresh; });
        send.onclick = async () => {
            const units = getUnits();
            const tiers = getTiers();
            const optimize = settings.querySelector('#manual_scavenge_optimize').checked;
            const nonZero = Object.fromEntries(Object.entries(units).filter(([, count]) => count > 0));
            if (!Object.keys(nonZero).length) { status.textContent = 'Indique pelo menos uma tropa.'; return; }
            if (!tiers.length) { status.textContent = 'Selecione pelo menos um nivel desbloqueado.'; return; }
            let distribution;
            if (optimize) {
                const mode = panel.querySelector('input[name="manual_scavenge_mode"]:checked').value;
                distribution = calculateDistribution(units, tiers, mode);
            } else {
                const target = tiers[tiers.length - 1];
                const carryMax = Object.entries(nonZero).reduce((sum, [unit, count]) => sum + count * (UNIT_CARRY[unit] || 0), 0);
                distribution = { [target.baseId]: { units: nonZero, carryMax } };
            }
            if (!Object.keys(distribution).length) { status.textContent = 'Nao foi possivel calcular uma distribuicao.'; return; }
            await sendSelected(distribution, status, send);
        };
        refresh();
    }

    function isScavengePage() {
        const params = new URLSearchParams(window.location.search);
        return params.get('screen') === 'place' && params.get('mode') === 'scavenge';
    }

    function start() {
        if (!isScavengePage()) return;
        if (document.querySelector('.scavenge-screen-main-widget')) injectPanel();
        else {
            const observer = new MutationObserver(() => {
                if (document.querySelector('.scavenge-screen-main-widget')) {
                    observer.disconnect();
                    injectPanel();
                }
            });
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        }
    }

    start();
})();
