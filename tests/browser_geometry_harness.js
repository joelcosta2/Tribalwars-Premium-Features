'use strict';

// Run with a locally started geckodriver (`geckodriver --port 4444`). No game account or
// external network is involved: this is an actual Firefox layout/style-engine fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.TWPF_PHASE32_BASELINE_DIR || path.resolve(__dirname, '..');
const endpoint = process.env.TWPF_WEBDRIVER_URL || 'http://127.0.0.1:4444';
const expectRegression = process.env.TWPF_EXPECT_REGRESSION === '1';

async function command(method, route, body) {
    const response = await fetch(endpoint + route, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok || payload.value?.error) {
        throw new Error(payload.value?.message || 'WebDriver ' + response.status + ': ' + route);
    }
    return payload.value;
}

const fixture = `
    document.body.innerHTML = '';
    document.body.style.cssText = 'height:2400px;margin:0;background:#f4e4bc';
    const layout = document.createElement('div');
    layout.id = 'main_layout';
    layout.style.marginLeft = '20px';
    const quest = document.createElement('div');
    quest.className = 'questlog';
    quest.style.cssText = 'position:absolute;left:120px;top:100px;width:200px;height:120px;background:#ddd';
    layout.appendChild(quest);
    document.body.appendChild(layout);
    // Reproduce a scrollbar/layout-dependent main-cell margin change. Vertical scroll itself
    // must not move TWPF controls horizontally, even if game layout classes reflow meanwhile.
    window.addEventListener('scroll', () => {
        layout.style.marginLeft = window.scrollY > 0 ? '0px' : '20px';
    });
    const popup = document.createElement('div');
    popup.id = 'settings_popup';
    popup.className = 'script-settings-popup';
    popup.style.display = 'block';
    for (const id of ['settings_save', 'settings_close']) {
        const control = document.createElement('button');
        control.id = id;
        control.textContent = id;
        popup.appendChild(control);
    }
    document.body.appendChild(popup);
    window.GM_addStyle = text => {
        const style = document.createElement('style');
        style.textContent = text;
        document.head.appendChild(style);
    };
    window.requestAnimationFrame = callback => callback();
    eval(arguments[0]);
    eval(arguments[1]);
    SidebarIcons.register('settings', {
        wrapperId: 'settings_popup_button', wrapperClass: 'script-settings-btn',
        createIcon: () => {
            const button = document.createElement('button');
            button.textContent = 'Settings';
            return button;
        }
    });
    return true;
`;

const measure = `
    const ids = ['settings_popup_button', 'settings_save', 'settings_close'];
    const firstSidebarRoot = document.getElementById(ids[0]);
    const x = () => ids.map(id => document.getElementById(id).getBoundingClientRect().x);
    const rows = [x()];
    const roots = [firstSidebarRoot];
    const margins = [getComputedStyle(document.getElementById('main_layout')).marginLeft];
    for (const y of [900, 0, 1200]) {
        window.scrollTo(0, y);
        window.dispatchEvent(new Event('scroll'));
        rows.push(x());
        roots.push(document.getElementById(ids[0]));
        margins.push(getComputedStyle(document.getElementById('main_layout')).marginLeft);
    }
    const currentSidebarRoot = document.getElementById(ids[0]);
    const style = getComputedStyle(currentSidebarRoot);
    return {
        width: window.innerWidth,
        rows,
        margins,
        rootStable: roots.every(root => root === firstSidebarRoot),
        scrollY: window.scrollY,
        outlineColor: style.outlineColor,
        boxShadow: style.boxShadow,
        parentClass: currentSidebarRoot.parentElement?.className || '(detached)'
    };
`;

const mountRecruitShell = `
    window.settings_cookies = { widgets: [{ name: 'recruit_troops', open: true, pos: -1 }] };
    window.t = key => key;
    window.toggleTooltip = () => {};
    window.eval(arguments[0]);
    const column = document.createElement('div');
    column.id = 'twpf_test_column';
    document.body.appendChild(column);
    const loading = document.createElement('div');
    loading.id = 'recruit_loading';
    createWidgetElement({ identifier: 'Recruit', widgetKey: 'recruit', extra_name: 'troops',
        columnToUse: 'twpf_test_column', contents: loading, loading: true });
    window._twpfRecruitRoot = document.getElementById('show_recruit_troops');
    return { mounted: !!window._twpfRecruitRoot?.isConnected };
`;

const completeRecruitRefresh = `
    const before = window._twpfRecruitRoot;
    const wasPresent = !!before?.isConnected;
    const finalContent = document.createElement('div');
    finalContent.id = 'recruit_ready';
    createWidgetElement({ identifier: 'Recruit', widgetKey: 'recruit', extra_name: 'troops',
        columnToUse: 'twpf_test_column', contents: finalContent, loading: false });
    const after = document.getElementById('show_recruit_troops');
    return { wasPresent, sameRoot: before === after, mounted: !!after?.isConnected,
        count: document.querySelectorAll('#show_recruit_troops').length };
`;

async function main() {
    const session = await command('POST', '/session', {
        capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { args: ['-headless'] } } }
    });
    const id = session.sessionId;
    try {
        await command('POST', '/session/' + id + '/url', { url: 'about:blank' });
        const sources = ['utils/core_css.js', 'utils/core_sidebar.js', 'utils/core_widgets.js']
            .map(file => fs.readFileSync(path.join(root, file), 'utf8'));
        await command('POST', '/session/' + id + '/execute/sync', { script: fixture, args: sources.slice(0, 2) });
        const measurements = [];
        for (const width of [1200, 780]) {
            await command('POST', '/session/' + id + '/window/rect', { width, height: 800 });
            measurements.push(await command('POST', '/session/' + id + '/execute/sync', { script: measure, args: [] }));
        }
        const stable = measurements.every(result => result.rootStable &&
            result.rows.every(row => row.every((x, index) => Math.abs(x - result.rows[0][index]) < 0.5)));
        const clean = measurements.every(result => !/rgb\(255,\s*0,\s*255\)/.test(result.outlineColor) &&
            !/rgb\(57,\s*255,\s*20\)/.test(result.boxShadow));
        const shell = await command('POST', '/session/' + id + '/execute/sync', { script: mountRecruitShell, args: [sources[2]] });
        const widget = await command('POST', '/session/' + id + '/execute/sync', { script: completeRecruitRefresh, args: [] });
        console.log(JSON.stringify({ source: path.basename(root), stable, clean, shell, widget, measurements }, null, 2));
        if (expectRegression) {
            assert.equal(stable && clean && widget.sameRoot, false, 'the old source did not reproduce its visual regression');
        } else {
            assert.equal(stable, true, 'Settings controls shifted horizontally during vertical scroll');
            assert.equal(clean, true, 'the generic pink/green diagnostic outline remains');
            assert.equal(shell.mounted && widget.wasPresent && widget.mounted && widget.sameRoot && widget.count === 1,
                true, 'Recruit shell remounted or disappeared during refresh');
        }
    } finally {
        await command('DELETE', '/session/' + id);
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
