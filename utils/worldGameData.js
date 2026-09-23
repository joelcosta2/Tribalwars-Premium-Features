// Cached global (non-village) game data: unit speed/carry + per-world settings.

/**
 * Fetches unit speed and carry capacity from the server API and caches them
 * in localStorage. Skips the fetch if values are already stored.
 */
function storeUnitsInfo() {
    const hasSpeeds = localStorage.getItem('units_speed');
    const hasCarry = localStorage.getItem('units_carry');

    if (hasSpeeds && hasSpeeds !== '{}' && hasCarry && hasCarry !== '{}') {
        return Promise.resolve(); // already stored, skip fetch
    }

    return fetch('/interface.php?func=get_unit_info')
        .then(res => res.text())
        .then(xmlText => {
            const xml = new DOMParser().parseFromString(xmlText, 'text/xml');

            const speeds = {};
            const carry = {};
            const units = [...xml.documentElement.children];

            units.forEach(unit => {
                const unitName = unit.tagName;

                // Extract Speed
                const speedNode = unit.querySelector('speed');
                speeds[unitName] = speedNode ? Number(speedNode.textContent) : null;

                // Extract Carry
                const carryNode = unit.querySelector('carry');
                carry[unitName] = carryNode ? Number(carryNode.textContent) : null;
            });

            localStorage.setItem('units_speed', JSON.stringify(speeds));
            localStorage.setItem('units_carry', JSON.stringify(carry));

            console.log('[TW] Unit data stored:', { speeds, carry });
        })
        .catch(err => {
            console.error('[TW] Failed to fetch unit info', err);
        });
}

/**
 * Fetches world settings from interface.php?func=get_config and caches them in localStorage
 * under 'world_settings_{world}'. Skips the request if settings are already cached.
 * Stores: game_speed, unit_speed, archers, church, watchtower, scavenging, fake_limit, milliseconds,
 * and the world's coin system configuration.
 * @returns {Promise<Object>}
 */
async function fetchAndCacheWorldSettings(force = false) {
    const worldKey = 'world_settings_' + (game_data?.world || window.location.hostname);
    const cached = localStorage.getItem(worldKey);
    if (cached && !force) {
        try {
            const cachedSettings = JSON.parse(cached);
            const hasCoinSettings = Object.prototype.hasOwnProperty.call(cachedSettings, 'coin_enabled') &&
                Object.prototype.hasOwnProperty.call(cachedSettings, 'coin_wood') &&
                Object.prototype.hasOwnProperty.call(cachedSettings, 'coin_stone') &&
                Object.prototype.hasOwnProperty.call(cachedSettings, 'coin_iron');
            if (hasCoinSettings) return cachedSettings;
        } catch (error) {
            console.warn('[WorldSettings] Invalid cache — refetching');
        }
    }

    const defaults = {
        game_speed: 1,
        unit_speed: 1,
        base_production: 60,
        coin_enabled: null,
        coin_wood: null,
        coin_stone: null,
        coin_iron: null
    };
    try {
        const resp = await fetch(window.location.origin + '/interface.php?func=get_config', { credentials: 'include' });
        if (!resp.ok) return defaults;

        const doc = new DOMParser().parseFromString(await resp.text(), 'text/xml');
        const text = tag => doc.querySelector(tag)?.textContent?.trim();
        const toNum = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
        const toBool = v => v === '1';

        const settings = {
            game_speed:  toNum(text('config > speed')) ?? 1,
            unit_speed:  toNum(text('config > unit_speed')) ?? 1,
            base_production: toNum(text('config > game > base_production')) ?? 60,
            archers:     toBool(text('config > game > archer')),
            church:      toBool(text('config > game > church')),
            watchtower:  toBool(text('config > game > watchtower')),
            scavenging:  toBool(text('config > game > scavenging')),
            fake_limit:  toBool(text('config > game > fake_limit')),
            milliseconds: toBool(text('config > commands > millis_arrival')),
            coin_enabled: text('config > snob > gold') === '1',
            coin_wood:    toNum(text('config > snob > coin_wood')),
            coin_stone:   toNum(text('config > snob > coin_stone')),
            coin_iron:    toNum(text('config > snob > coin_iron'))
        };

        localStorage.setItem(worldKey, JSON.stringify(settings));
        console.log('[WorldSettings] Cached for', worldKey, ':', settings);
        return settings;
    } catch (e) {
        console.warn('[WorldSettings] Fetch failed:', e);
        return defaults;
    }
}

/**
 * Returns the cached world game speed, or 1 if not yet fetched.
 * @returns {number}
 */
function getWorldSpeed() {
    try {
        const worldKey = 'world_settings_' + (game_data?.world || window.location.hostname);
        const s = localStorage.getItem(worldKey);
        return s ? (JSON.parse(s).game_speed ?? 1) : 1;
    } catch { return 1; }
}

/**
 * Returns whether this world has the archer unit enabled, or true if not yet cached
 * (avoids hiding the unit before fetchAndCacheWorldSettings() has resolved).
 * @returns {boolean}
 */
function isArchersEnabled() {
    try {
        const worldKey = 'world_settings_' + (game_data?.world || window.location.hostname);
        const s = localStorage.getItem(worldKey);
        return s ? (JSON.parse(s).archers ?? true) : true;
    } catch { return true; }
}
