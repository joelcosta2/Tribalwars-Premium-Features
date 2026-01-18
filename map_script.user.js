
var coords, mapPopUpBody;

/**
 * Fetches outgoing commands from the overview page and stores them in localStorage.
 * Updates map icons if the relevant setting is enabled.
 */
async function getOutgoingCommandsFromOverview() {
    const { general } = settings_cookies;

    // Early exit if features are disabled
    if (!general['show__extra_options_map_hover'] && !general['show__outgoingInfo_map']) {
        return;
    }

    try {
        const response = await fetch(game_data.link_base_pure + 'overview');
        const htmlText = await response.text();

        // Parse the HTML response
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        const outgoingTable = doc.querySelector('#commands_outgoings');

        // Handle case where no outgoing commands exist
        if (!outgoingTable) {
            localStorage.setItem('outgoing_units_saved', JSON.stringify([]));
            return;
        }

        const commandRows = outgoingTable.querySelectorAll('.command-row');
        const outgoing_units = Array.from(commandRows).map(row => {
            const villageLabel = row.querySelector('.quickedit-label');
            const hoverDetails = row.querySelectorAll('.command_hover_details img');

            // Extract unit names from image sources
            const unitList = Array.from(hoverDetails)
                .map(img => {
                    const match = img.src.match(/\/([^/]+)\.(?:png|webp)$/);
                    return match ? match[1] : null;
                })
                .filter(Boolean); // Remove null values

            return {
                // Extract coordinates from village name (e.g., "Village (500|500)")
                name: villageLabel?.innerText.match(/\((.*?)\)/)?.[1] || "",
                imgs: unitList.join(',')
            };
        });

        // Save processed data
        localStorage.setItem('outgoing_units_saved', JSON.stringify(outgoing_units));

        // Trigger map update if enabled
        if (general['show__outgoingInfo_map'] && typeof mapReady === 'function') {
            await mapReady();
            addOutgoingIcons();
        }

    } catch (error) {
        console.error("[Outgoing Commands] Failed to fetch overview data:", error);
    }
}

/**
 * Promisified version of the map waiter.
 */
const mapReady = () => new Promise((resolve) => {
    const check = setInterval(() => {
        if (document.querySelector("[id^='map_village_']")) {
            clearInterval(check);
            resolve();
        }
    }, 200);
    // Timeout after 10 seconds to avoid memory leaks
    setTimeout(() => { clearInterval(check); resolve(); }, 10000);
});

/**
 * Renders outgoing unit icons directly onto the map based on saved command data.
 */
function addOutgoingIcons() {
    const savedData = localStorage.getItem('outgoing_units_saved');
    if (!savedData) return;

    const outgoingCommands = JSON.parse(savedData);
    const mapContainer = document.getElementById('map_container');
    if (!mapContainer) return;

    // Remove existing icons to prevent duplicates during map re-renders
    document.querySelectorAll('.icon_outgoing_unit').forEach(el => el.remove());

    outgoingCommands.forEach(command => {
        // Formats "500|500" to "500500" to match TWMap.villages keys
        const villageCoords = command.name.replace('|', '');
        const villageInfo = TWMap.villages[villageCoords];

        if (!villageInfo) return;

        const villageElement = document.getElementById(`map_village_${villageInfo.id}`);
        if (!villageElement) return;

        const { top, left } = villageElement.style;
        const icons = command.imgs.split(',').filter(Boolean);

        // Use a fragment to batch DOM injections for better performance
        const fragment = document.createDocumentFragment();

        icons.forEach((icon, index) => {
            const iconId = `icon-${villageCoords}-${icon}`;

            // Skip if icon already exists (extra safety)
            if (document.getElementById(iconId)) return;

            const farmIcon = document.createElement("img");
            farmIcon.id = iconId;
            // Using a more stable asset path
            farmIcon.src = `/graphic/command/${icon}.png`;
            farmIcon.classList.add('icon_outgoing_unit');

            // Style properties
            Object.assign(farmIcon.style, {
                position: 'absolute',
                top: top,
                left: `${parseInt(left) - (index * 18)}px`, // Slightly tighter spacing
                zIndex: '10',
                pointerEvents: 'none' // Ensures icons don't block map clicks
            });

            fragment.appendChild(farmIcon);
        });

        // Batch insert before the village element
        villageElement.parentNode.insertBefore(fragment, villageElement);
    });
}

async function getReportsList() {
    if (!settings_cookies.general?.['show__extra_options_map_hover']) return;

    const storedData = localStorage.getItem('reports_list');
    const storedReports = storedData ? JSON.parse(storedData) : [];
    const reportsMap = new Map(storedReports.map(report => [report.coords, report]));

    const groupIds = [0, 7600];
    const allNewReports = [];

    try {
        // We use a standard for...of loop here on purpose.
        // This ensures group 7600 only starts after group 0 is completely finished.
        for (const id of groupIds) {
            const newReports = await fetchAllReports(id);
            allNewReports.push(...newReports);

            // Optional: Add a small 200ms rest between groups for extra safety
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        allNewReports.forEach(report => {
            const existingReport = reportsMap.get(report.coords);
            if (!existingReport || isNewer(report.date, existingReport.date)) {
                reportsMap.set(report.coords, report);
            }
        });

        localStorage.setItem('reports_list', JSON.stringify([...reportsMap.values()]));
    } catch (err) {
        console.error("[Report Manager] Error syncing reports:", err);
    }
}

/**
 * Fetches all reports for a group sequentially to prevent server rate-limiting.
 * @param {number} groupId - The ID of the report group.
 * @returns {Promise<Array>} List of extracted reports.
 */
async function fetchAllReports(groupId) {
    const firstPageData = await fetchReportsPage(groupId, 0);
    if (!firstPageData) return [];

    const parser = new DOMParser();
    const doc = parser.parseFromString(firstPageData, 'text/html');

    // Calculate total pages based on navigation items
    const navItems = doc.querySelectorAll('.paged-nav-item');
    const totalPages = navItems.length + 1;

    // Start with reports from the first page
    let allReports = extractReports(doc);

    // Fetch subsequent pages one by one (Sequential)
    // TribalWars uses increments of 12 for the 'from' parameter
    for (let i = 1; i < totalPages; i++) {
        const offset = i * 12;
        const pageData = await fetchReportsPage(groupId, offset);

        if (pageData) {
            const pageDoc = parser.parseFromString(pageData, 'text/html');
            const pageReports = extractReports(pageDoc);
            allReports.push(...pageReports);
        }

        // Add a small safety delay (throttle) between requests
        // 200ms is usually enough to stay under the radar
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    return allReports;
}

/**
 * Fetches a specific page of reports using the native Fetch API.
 * @param {number} groupId - The ID of the report group.
 * @param {number} from - The starting offset for pagination.
 * @returns {Promise<string|null>} The HTML content of the page or null on failure.
 */
async function fetchReportsPage(groupId, from) {
    const url = `${game_data.link_base_pure}report&mode=attack&group_id=${groupId}&from=${from}`;

    try {
        const response = await fetch(url);

        // Check if the request was successful (status 200-299)
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Return the HTML as text to be parsed by DOMParser in the calling function
        return await response.text();
    } catch (error) {
        console.error(`[Report Manager] Failed to fetch reports from ${url}:`, error);
        return null;
    }
}

/**
 * Extracts report data from a parsed DOM element.
 * @param {HTMLElement|Document} doc - The element containing the report list.
 * @returns {Array} List of extracted report objects.
 */
function extractReports(doc) {
    const reports = [];
    const reportLabels = doc.querySelectorAll('.quickedit-label');

    reportLabels.forEach(label => {
        // Use .closest() to find the table row containing this report
        const row = label.closest('tr');
        const title = label.closest('.report-title');
        if (!row) return;

        const reportId = title.getAttribute('data-id');
        const labelText = label.textContent;

        // Optimized Regex: Extracts the last (xxx|yyy) coordinates found in the text
        const coordsMatch = labelText.match(/\((\d{1,3}\|\d{1,3})\)(?=[^\(]*$)/);

        if (coordsMatch && reportId) {
            // Scope the search to the current row for better performance
            const dateElement = row.querySelectorAll('.nowrap')[1];

            if (dateElement) {
                reports.push({
                    id: reportId,
                    coords: coordsMatch[1],
                    date: dateElement.innerText.trim()
                });
            }
        }
    });

    return reports;
}

/**
 * Compares two date strings to determine if the first is more recent.
 * @param {string} date1 - The new report date string.
 * @param {string} date2 - The existing report date string from storage.
 * @returns {boolean} True if date1 is strictly newer than date2.
 */
function isNewer(date1, date2) {
    // If we don't have an existing date to compare against, the new one is "newer"
    if (!date2) return true;
    if (!date1) return false;

    // Convert to timestamps (milliseconds) for faster numeric comparison
    const time1 = new Date(convertDateToISO(date1)).getTime();
    const time2 = new Date(convertDateToISO(date2)).getTime();

    // Handle invalid date cases (NaN)
    if (isNaN(time1)) return false;
    if (isNaN(time2)) return true;

    return time1 > time2;
}

/**
 * Converts TribalWars date strings to ISO format.
 * Handles standard "Month DD, HH:MM" and relative "today/yesterday at HH:MM".
 * @param {string} dateStr - Raw date string from the game.
 * @returns {string|null} ISO 8601 string or null if parsing fails.
 */
function convertDateToISO(dateStr) {
    if (!dateStr) return null;

    const now = new Date();
    const targetDate = new Date();
    const lowerDate = dateStr.toLowerCase();

    // 1. Handle relative dates: "today at 12:00" or "yesterday at 12:00"
    if (lowerDate.includes(':') && (lowerDate.includes('today') || lowerDate.includes('yesterday'))) {
        const timeMatch = dateStr.match(/(\d{1,2}):(\d{2})/);
        if (!timeMatch) return null;

        if (lowerDate.includes('yesterday')) {
            targetDate.setDate(now.getDate() - 1);
        }
        targetDate.setHours(parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10), 0, 0);
    }
    // 2. Handle standard format: "mar. 14, 17:56"
    else {
        const parts = dateStr.match(/([a-z]{3})\.?\s+(\d+),\s+(\d{1,2}):(\d{2})/i);
        if (!parts) return null;

        const monthMap = {
            jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
            jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
        };

        const monthAbbr = parts[1].toLowerCase().replace('.', '');
        const month = monthMap[monthAbbr];
        const day = parseInt(parts[2], 10);
        const hour = parseInt(parts[3], 10);
        const minute = parseInt(parts[4], 10);

        // setFullYear(year, monthIndex, day)
        targetDate.setFullYear(now.getFullYear(), month, day);
        targetDate.setHours(hour, minute, 0, 0);

        // Year Wrap-around: If the report is "Dec 31" but it's currently Jan 1st, 
        // the report belongs to last year.
        if (targetDate > now) {
            targetDate.setFullYear(now.getFullYear() - 1);
        }
    }

    return targetDate.toISOString();
}

/**
 * Injects report data (last attack date, loot, and spy results) into the Map Popup.
 * @param {Object} report - The report object containing date and HTML strings.
 */
function insertReportData(report) {
    if (!mapPopUpBody) return;

    // 1. Cleanup: Remove existing "Last Attack" info to prevent row stacking
    const existingEntry = document.getElementById("info_last_attack");
    if (existingEntry) existingEntry.remove();

    // 2. Create the main "Last Attack" row
    const lastAttackRow = document.createElement('tr');
    lastAttackRow.id = "info_last_attack";

    // Use textContent for the labels to ensure clean rendering
    const header = document.createElement('th');
    header.textContent = '↓ Last Attack:';

    const data = document.createElement('td');
    data.textContent = report.date;

    lastAttackRow.append(header, data);
    mapPopUpBody.appendChild(lastAttackRow);

    // 3. Helper to parse and inject cached HTML rows (Loot/Discovery)
    const injectCachedRow = (htmlString) => {
        if (!htmlString) return;

        // Use DOMParser to safely extract the table row from the saved string
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<table>${htmlString}</table>`, 'text/html');
        const row = doc.querySelector('tr');

        if (row) {
            // Apply a class for potential custom CSS styling
            row.classList.add('premium-report-row');
            mapPopUpBody.appendChild(row);
        }
    };

    injectCachedRow(report.attackLootResults);
    injectCachedRow(report.attackLootDiscoverResults);
}

function getReportInfoToMap() {
    if (settings_cookies.general['show__extra_options_map_hover']) {
        var reports_list = localStorage.getItem('reports_list') ? JSON.parse(localStorage.getItem('reports_list')) : null;
        var outgoing_units_saved = localStorage.getItem('outgoing_units_saved') ? JSON.parse(localStorage.getItem('outgoing_units_saved')) : null;

        if (reports_list) {
            for (var i = 0; i < reports_list.length; i++) {
                var report = reports_list[i];

                if ((report.coords).includes(coords)) {
                    // Se já tem os dados salvos, usa-os diretamente
                    if (report.attackLootResults || report.attackLootDiscoverResults) {
                        insertReportData(report);
                    } else {
                        // Caso contrário, faz o fetch e armazena os dados
                        $.ajax({
                            'url': '/game.php?screen=report&view=' + report.id,
                            'type': 'GET',
                            'success': function (data) {
                                var tempElement = document.createElement('div');
                                tempElement.innerHTML = data;

                                // Criar linha com a data do último ataque
                                var tr = document.createElement('tr');
                                tr.id = "info_last_attack";
                                var th = document.createElement('th');
                                th.innerHTML = '↓ Last Attack:  ';
                                var td = document.createElement('td');
                                td.innerHTML = report.date;
                                tr.appendChild(th);
                                tr.appendChild(td);
                                mapPopUpBody.appendChild(tr);

                                // Coletar informações do loot
                                var attackLootResults = tempElement.querySelector('#attack_results tr');
                                if (attackLootResults) {
                                    attackLootResults.querySelectorAll('th')[0].innerHTML += ' (' + attackLootResults.querySelectorAll('td')[1].textContent + ')';
                                    attackLootResults.removeChild(attackLootResults.querySelectorAll('td')[1]);
                                    mapPopUpBody.appendChild(attackLootResults);

                                    // Armazena os dados no report
                                    report.attackLootResults = attackLootResults.outerHTML;
                                }

                                // Coletar informações do espionagem
                                var attackLootDiscoverResults = tempElement.querySelectorAll('#attack_spy_resources tr');
                                attackLootDiscoverResults = attackLootDiscoverResults[attackLootDiscoverResults.length - 1]
                                if (attackLootDiscoverResults) {
                                    mapPopUpBody.appendChild(attackLootDiscoverResults);

                                    // Armazena os dados no report
                                    report.attackLootDiscoverResults = attackLootDiscoverResults.outerHTML;
                                }

                                // Atualiza localStorage com as novas informações
                                localStorage.setItem('reports_list', JSON.stringify(reports_list));
                            }
                        });
                    }
                    break;
                }
            }
        }

        if (outgoing_units_saved) {
            outgoing_units_saved.forEach(function (unit) {
                if ((unit.name).includes(coords)) {
                    var tdElement = document.createElement('td');
                    tdElement.id = "info_outgoing_units";
                    var span1Element = document.createElement('span');
                    span1Element.className = 'icon-container';
                    var icons = unit.imgs.split(',');
                    icons.forEach(function (icon) {
                        if (icon !== '') {
                            var img1Element = document.createElement('img');
                            img1Element.src = 'https://dspt.innogamescdn.com/asset/7fe7ab60/graphic/command/' + icon + '.png';
                            img1Element.alt = '';
                            span1Element.appendChild(img1Element);
                        }
                    })
                    tdElement.appendChild(span1Element);

                    var popUpTitle = mapPopUpBody.querySelector('th');
                    popUpTitle.insertBefore(span1Element, popUpTitle.firstChild);
                }
            })
        }
    }
}

/**
 * Adjusts the TribalWars map size based on user input and persists settings.
 * Handles the teardown and re-initialization of the TWMap object.
 */
function setMapSize() {
    const mapWrap = document.getElementById('map_wrap');
    if (!mapWrap) return;

    // 1. Gather all necessary DOM elements once
    const elements = {
        map: document.getElementById('map'),
        container: document.getElementById('map_container'),
        boundary: document.getElementById('map_go_home_boundary'),
        coordY: document.getElementById('map_coord_y_wrap'),
        coordX: document.getElementById('map_coord_x_wrap'),
        heightInput: document.querySelector('#map_custom_height'),
        widthInput: document.querySelector('#map_custom_width')
    };

    // 2. Handle Configuration Persistence
    const storedConfig = JSON.parse(localStorage.getItem('mapConfig')) || {};

    // Save original dimensions only if they don't exist yet
    if (!storedConfig.originalWidth) {
        const firstImg = elements.map.querySelector('img');
        Object.assign(storedConfig, {
            originalWidth: elements.map.style.width || 'auto',
            originalHeight: elements.map.style.height || 'auto',
            originalMapImgWidth: firstImg?.style.width || 'auto',
            originalMapImgHeight: firstImg?.style.height || 'auto'
        });
        localStorage.setItem('mapConfig', JSON.stringify(storedConfig));
    }

    // 3. Update Custom Dimensions in Storage
    const newHeight = elements.heightInput?.value || localStorage.getItem('map_custom_height');
    const newWidth = elements.widthInput?.value || localStorage.getItem('map_custom_width');

    localStorage.setItem('map_custom_height', newHeight);
    localStorage.setItem('map_custom_width', newWidth);

    const mapHeightPx = `${newHeight}px`;
    const mapWidthPx = `${newWidth}px`;

    // 4. Apply Styles efficiently
    const resizeTargets = [mapWrap, elements.map, elements.coordX];
    resizeTargets.forEach(el => { if (el) el.style.width = mapWidthPx; });

    [mapWrap, elements.map, elements.coordY].forEach(el => { if (el) el.style.height = mapHeightPx; });

    // Reset image scaling to prevent distortion on larger maps
    elements.map.querySelectorAll('img').forEach(img => {
        Object.assign(img.style, { width: 'auto', height: 'auto' });
    });

    // 5. Re-initialize Game Map
    // We remove elements that TWMap.init() will recreate
    elements.container?.remove();
    elements.boundary?.remove();

    // Set internal game map size (grid blocks) and restart engine
    TWMap.size = [15, 15]; // Expanded grid for larger custom maps
    TWMap.init();

    // 6. Focus Update
    // Using a short timeout to ensure the DOM has settled after TWMap.init()
    setTimeout(() => {
        if (typeof TWMap.focusSubmit === 'function') {
            TWMap.focusSubmit();
        }
    }, 100);
}

/**
 * Injects UI controls for the Large Map feature into the game's map configuration table.
 */
function createBigMapOption() {
    const mapConfigTable = document.querySelectorAll('#map_config .vis')[1];
    if (!mapConfigTable) return;

    const tbody = mapConfigTable.querySelector('tbody');
    const targetRow = tbody.querySelectorAll('tr')[1];

    // Helper to create the checkbox row
    const createCheckboxRow = () => {
        const tr = document.createElement('tr');

        const tdCheckbox = document.createElement('td');
        const input = Object.assign(document.createElement('input'), {
            type: 'checkbox',
            id: 'show_biggermap',
            checked: settings_cookies.general['show__big_map']
        });

        input.onclick = () => {
            const isEnabled = !settings_cookies.general['show__big_map'];
            settings_cookies.general['show__big_map'] = isEnabled;
            localStorage.setItem('settings_cookies', JSON.stringify(settings_cookies));

            isEnabled ? setMapSize() : location.reload();
        };

        const tdLabel = Object.assign(document.createElement('td'), { colSpan: 2 });
        // Ensure the label has no background so the orange from the TR shows through
        tdLabel.style.background = 'none';

        const label = Object.assign(document.createElement('label'), {
            textContent: ' Show Large Map',
            htmlFor: 'show_biggermap'
        });

        tdCheckbox.appendChild(input);
        tdLabel.appendChild(label);
        tr.append(tdCheckbox, tdLabel);
        return tr;
    };

    // Helper to create the input row with debouncing
    const createSizeRow = () => {
        const tr = document.createElement('tr');

        // Internal helper for numeric inputs
        const createInput = (id, labelText) => {
            const td = Object.assign(document.createElement('td'), { className: 'nowrap' });
            const label = document.createTextNode(labelText);
            const input = Object.assign(document.createElement('input'), {
                type: 'number',
                id: id,
                value: localStorage.getItem(id) || 600,
                step: 100
            });
            input.style.width = '60px';

            // Debounce logic: prevents setMapSize from firing on every keypress
            let timeout;
            input.oninput = () => {
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    if (settings_cookies.general['show__big_map']) setMapSize();
                }, 400);
            };

            td.append(label, input);
            return td;
        };

        tr.append(
            createInput('map_custom_height', 'Height: '),
            createInput('map_custom_width', ' Width: ')
        );
        return tr;
    };

    // Injection
    const rowToggle = createCheckboxRow();
    const rowInputs = createSizeRow();

    if (targetRow) {
        tbody.insertBefore(rowToggle, targetRow);
        tbody.insertBefore(rowInputs, targetRow);
    } else {
        tbody.append(rowToggle, rowInputs);
    }
}

// Simple cache to store the last result and avoid repeated heavy regex operations
let _villageCache = { coord: null, id: null };

/**
 * Retrieves a village ID based on "X|Y" coordinates from the cached map data.
 * @param {string} coords - Format: "500|500"
 * @returns {string|null} The village ID or null if not found.
 */
function getVillageIDByCoord(coords) {
    if (!coords) return null;

    // 1. Check if we just looked this up (Performance optimization)
    if (_villageCache.coord === coords) {
        return _villageCache.id;
    }

    const rawData = localStorage.getItem('map_villages');
    if (!rawData) {
        console.error("[Map Data] map_villages not found in localStorage.");
        return null;
    }

    // 2. Prepare the coordinate for matching: "457|370" -> "457,370"
    const [x, y] = coords.split('|');
    if (!x || !y) return null;
    const formattedCoord = `${x},${y}`;

    /**
     * Regex Optimization: 
     * [^,]+ matches village name characters (non-commas) faster than .*?
     * ^(\d+) captures ID at start of line
     */
    const regex = new RegExp(`^(\\d+),[^,]+,${formattedCoord},`, 'm');
    const match = rawData.match(regex);

    if (match && match[1]) {
        const villageId = match[1];

        // Update cache for the next call
        _villageCache = { coord: coords, id: villageId };
        return villageId;
    }

    console.warn(`[Map Data] Village not found: ${coords}`);
    updateMapInfoVillages(true);
    return null;
}

let lastFocusId = -1;

/**
 * Monitors the map's context menu focus.
 * When a village is selected, it updates the target data and troop templates.
 */
function startMapContextWatcher() {
    setInterval(() => {
        // Access TWMap context
        const currentFocus = TWMap?.context?._curFocus;

        // Only proceed if the focus has changed and is a valid village
        if (currentFocus !== undefined && currentFocus !== lastFocusId) {
            lastFocusId = currentFocus;
            if (currentFocus !== -1) {
                const villageId = getVillageIDByCoord(coords);

                GM_setValue('target_village', villageId)

                const distance = calculateDistanceToTarget(coords);
                GM_setValue("target_distance", distance);

                initializeTroopTemplates(villageId);
            }
        }
    }, 200); // Checks 5 times per second
}

/**
 * Fetches and initializes troop templates for a specific target village.
 * Simulates opening the rally point command window to get template data.
 * @param {string|number} targetID - The ID of the target village.
 */
async function initializeTroopTemplates(targetID) {
    if (!targetID) return;

    // Remove existing "fake" buttons before re-rendering to avoid UI clutter
    document.querySelectorAll('.fake-farm-assistant-button').forEach(el => el.remove());

    const url = `${window.location.origin}${game_data.link_base_pure}place&ajax=command&target=${targetID}`;

    try {
        // 1. Modern fetch instead of $.ajax for better async handling
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const data = await response.json();
        const htmlContent = data.dialog;

        if (!htmlContent) {
            console.warn("[Templates] No dialog content returned.");
            return;
        }

        // 2. Extract TroopTemplates JSON string
        // The regex looks for the object assigned to TroopTemplates.current
        const templateMatch = htmlContent.match(/TroopTemplates\.current\s*=\s*({.*?});/);

        if (templateMatch?.[1]) {
            const templatesData = JSON.parse(templateMatch[1]);

            // Sync with game's global object
            TroopTemplates.current = templatesData;

            // 3. Re-bind template selection event (scoped cleanup)
            const $selectTemplate = $(".evt-select-template");
            $selectTemplate.off('change').on('change', function () {
                TroopTemplates.useTemplate(this);
            });

            // 4. Generate buttons for each template found
            const templatesArray = Object.values(templatesData);

            templatesArray.forEach((template, index) => {
                // We pass the template object and index to the button creator
                if (typeof addFakeFarmAssistantButton === 'function') {
                    addFakeFarmAssistantButton(template, index);
                }
            });

            console.log(`[Templates] Initialized ${templatesArray.length} templates for target ${targetID}`);
        } else {
            console.warn("[Templates] Could not find TroopTemplates in the response dialog.");
        }
    } catch (error) {
        console.error("[Templates] Critical error during initialization:", error);
    }
}

if (typeof TWMap !== 'undefined') {
    //initiate target_village as 0
    GM_setValue("target_village", 0);
    getOutgoingCommandsFromOverview();
    createBigMapOption();
    if (settings_cookies.general['show__extra_options_map_hover']) {
        var originalHandleMouseMove = TWMap.popup.handleMouseMove;
        getReportsList();
        TWMap.popup.handleMouseMove = function (e) {
            TWMap.popup.extraInfo = true;
            originalHandleMouseMove.call(this, e);
            var villageHoverCoords = TWMap.map.coordByEvent(e);
            coords = villageHoverCoords.join('|');
            var mapPopupElement = document.getElementById('map_popup');
            mapPopUpBody = mapPopupElement.getElementsByTagName('tbody')[0];

            var tr = document.createElement('tr');
            tr.className = 'nowrap';
            tr.id = 'map_popup_extra';

            if (mapPopUpBody && !mapPopUpBody.querySelector('#map_popup_extra')) {
                mapPopUpBody.appendChild(tr);
                document.querySelectorAll("#info_last_attack, #info_outgoing_units").forEach(el => el.remove());
                getReportInfoToMap();
            }
        };
    }
    if (settings_cookies.general['show__big_map']) {
        setMapSize();
    }
    if (settings_cookies.general['show__outgoingInfo_map']) {
        if (TWMap.map) {
            //on map drag move
            var originalMapOnMove = TWMap.map.handler.onMovePixel;
            TWMap.map.handler.onMovePixel = async function (e, a) {
                originalMapOnMove.call(this, e, a);
                await mapReady();
                addOutgoingIcons();
            }
        }
    }

    startMapContextWatcher();
}


// TODO: testing new ctx button on map
function addFakeFarmAssistantButton(template, index) {
    const ctxButtons = document.getElementById("map-ctx-buttons");
    const referenceElement = document.getElementById("mp_att"); // use mp_att as reference, since we just want this new ctx for villages that we can attack

    //remove previous buttons
    if (index === 0) document.querySelectorAll('.custom-map-ctx-button').forEach(element => element.remove());

    if (!ctxButtons) {
        console.warn("Elemento #map-ctx-buttons não encontrado.");
        return;
    }

    if (!referenceElement) {
        console.warn("Elemento #mp_info não encontrado.");
        return;
    }

    // create ctx button for map
    const newButton = document.createElement("a");
    newButton.className = "mp custom-map-ctx-button";
    newButton.id = "mp_farm_f" + index;
    newButton.style.borderRadius = '5px';
    newButton.setAttribute("data-tooltip-tpl", generateTemplateTooltipData(template));

    if (index === 0) {
        newButton.style.backgroundImage = 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAJcEhZcwAAGdYAABnWARjRyu0AAAAHdElNRQfqAQMDLBh8xVm7AAAFgUlEQVRIx3WWW29cVxXHf2ufc+YSj2cmzsWxUydpEmKTtFVSoSDRVCnl8sBDJITKE4+Iz8Gn4QXxgEClUkPaQAotkCKaRCo0jiXbcWzsiT32nDm3vdfi4Th2QGJt7X2W9sP6/9detyOP//l3G639kVbUo/lUsKVFLE0RQETACQCyfxggL5T6qEUc1ungzl1ArryGdHtgRhzU8dndv5J+tcabzVmORtCY7lLGEWUZcCY1kBzaExHMALF9MIPSEz3fIlpZJllaJHn3e0TTp4iLnRGDRyl3/vQlg0ueH3//MqNZx6hyRK/Os5PEIHJgX5CXsOobBKgq3OoGnftP6Dz4giTLmPjhe8Rbt29zYm2Vr/XaxCcq0vk+i/eXuZA0uDA1ZLkZ86SdMI7dgReCII7DZzKBWLBXj7PezDn9wZf0HzwgnDpN9KOJ1s/jfMS1d8/AZMnniyU3bv2UMx0h2lnnaJYzlabsZSOKnYzesKQ5HFPs7bEblZS+oKhy8iojK1P24sB2usWxxSHlzi5xsbEOrmLx6SrPBx7rdPjbw3/x7evfoJ8O8M/XaVQRX28eobFwlKmzbardER/eXWfU6OFih+0vVSX3OXvtMXN+TOvpKnFVlngrmHw65o1LF9HEuPfJB9xrtnj74rcot96nd6XN7KUGzd4YXAoMSUfbpHlMlMh+NAxvnqzKGBR77JY5jojYq+IxFk52mO4I0hTeqob84c6v+djf4ux0xMU31xHnsBAj5lA/4sRwl/A8YanXoIoAU7wG9oo9siKnLD0+CsSqCihRFON8ikscr3SFb2brfHTnt/z7vKPnVmlExsJbZxESNKRMphlXnm2zNE74c6/Bs6YQgifNh2ilBK8ElNiCYWid12WGOCESx/muMn72mN/c7/LLnde4cWmNBR2BNLEwJox2idrK5coxO4z4bDLm0wkl9wUuCOoDQQKxmYEppoZ6j5Q54oQYWOgHBtmAzze3Sa53MVsHK1HNCOMUyx1qjl4B303hbKK8P2EsBUFDQCMlNlPUDFQhgPhw0B6aMVyfCkTLf2H8sA3fOYZphWmOhgp8hUQOAGcwnwemdyruFRHeBzTW2oPMlE8mE1p9iBoRuLpaAbQfMXYwrxmEDFyEhILlxHjSd8SNwwJUg1AqxUBoh5p4bGpkAp9ONij6RpzEuMgh+/3M1GAcOONSjBwsAitYSeAf/RjXdAdpqkGoKmgVwk2MllntgVpdJEEVCSA4aoRDaqoBdIw5wTRgJlhQLBw2PFOFYKCgWsc1VjVUDA2GBqUSUAwn9SO50nCjCpIAoURUICiWOWSvQl1UgwKqNVFVV+sG7gV7DfU2VXwIVKr4PHDlwYj3Ol0uvT6Feo/6imTC8c61GX7wFDrLGZUaISjqw4FXqobVMVDMlKoIhFLryMaCmGGjwIl2yq2fGVErq9NYoNFUbv5kwMnbyke/d4SZBg6DYIRCCSWHACVA4fE7BWXb0VDDJYI50FLZWC/5+FcZEu9PMgA84rbZfCyU5SRWehSwSqlyI9nxSOnxCHHW7RIPd0iWM7bbTTTUqeciUK/cHTl+94uASB33l0dN4qD1OrjUgwmhUoo9pb+cExUVWa9LXM4vEK2sMLsy5lkD0tmYpO2IYsHMKOZa+JONfeNwoBh4AU2EeOjRYFSZ4dYqTq9keHFE8/PER65eY+3RI6ZXlzn3VcrSdpPx0QRp7M9iQMzx/yTfVgTFKqWxXXF+s+B4pTy/cJFzb1wlPj43x9qNt9m8/SFzgy0m1jIG6zmlE/TFn8WB1DlvL9+YIUDLjOPBmIqEzVMzHLv5DsdmZoi7k5PMXb7CF+mYjYcPaW1uMF0UBED/h+1/m5aXPkaMYEeabMzM0r96jVfm5+lMHOE/CMFU5I0vyHoAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDEtMDNUMDM6NDQ6MTUrMDA6MDAaLZjXAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTAxLTAzVDAzOjQ0OjE1KzAwOjAwa3AgawAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wMS0wM1QwMzo0NDoyNCswMDowMBSdDeMAAAAASUVORK5CYII=)'
    } else {
        //number 2
        newButton.style.backgroundImage = 'url(data:image/png;base64,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)'
    }

    newButton.onmouseover = function () {
        toggleTooltip(newButton, true)
    }

    newButton.onmouseleave = function () {
        toggleTooltip(newButton, false)
    }

    newButton.onclick = async function fetchData() {
        try {
            // 1. Define the list of game units to extract from the template
            const unitTypes = game_data.units;

            // 2. Build the units object dynamically
            const unitsToLaunch = {};

            unitTypes.forEach(unit => {
                // Convert string value from template to integer
                const amount = parseInt(template[unit], 10);

                // Only add to the request if amount is greater than 0
                if (amount > 0) {
                    unitsToLaunch[unit] = amount;
                }
            });

            // 3. Get target from GM_getValue (Tampermonkey storage)
            const targetId = GM_getValue("target_village");

            if (!targetId) {
                throw new Error("Target village ID not found in storage.");
            }

            console.log(`Launching attack from template '${template.name}' on target ${targetId}`);

            // 4. Call the previously defined launch function
            await launchAttack(unitsToLaunch, targetId);

        } catch (error) {
            console.warn("Error sending attack:", error);
        }
    };

    let syncInterval = null;

    /**
     * Synchronizes the position, display, and opacity of CTX button
     * with the referenceElement (mp_att).
     */
    function updateBasedOnReference(index) {
        const ref = referenceElement;
        const btn = newButton;

        // Safety check: exit if elements are missing
        if (!ref || !btn) return;

        // Use getComputedStyle to read the actual rendered state (even during animations)
        const refStyle = window.getComputedStyle(ref);

        // Sync visibility properties
        btn.style.display = refStyle.display;
        btn.style.visibility = refStyle.visibility;
        btn.style.opacity = refStyle.opacity;

        // Logic for hidden vs visible state
        if (refStyle.display === 'none' || refStyle.opacity === '0') {
            // Disable interactions if invisible to prevent accidental clicks
            btn.style.pointerEvents = 'none';
        } else {
            btn.style.pointerEvents = 'auto';

            // Use getBoundingClientRect for precise screen coordinates
            // This is much more "fireproof" than reading style.left/top
            const rect = ref.getBoundingClientRect();

            // Calculate position relative to the button's offset parent
            const parentRect = ref.offsetParent.getBoundingClientRect();

            // Apply calculated position with your specific offsets
            if (index === 0) {
                btn.style.left = `${(rect.left - parentRect.left) + 32}px`;
                btn.style.top = `${(rect.top - parentRect.top) - 15}px`;
            } else {
                btn.style.left = `${(rect.left - parentRect.left) + 32}px`;
                btn.style.top = `${(rect.top - parentRect.top) + 53}px`;
            }
        }
    }

    /**
     * MutationObserver to watch for attribute changes
     */
    const observer = new MutationObserver(() => {
        // Immediate sync when a change is detected
        updateBasedOnReference(index);

        // "Insurance Policy": jQuery animations (fadeIn/fadeOut) update the style attribute 
        // many times per second. We force a sync at 60fps for 500ms to "stick" to the animation.
        if (syncInterval) clearInterval(syncInterval);

        let duration = 0;
        syncInterval = setInterval(() => {
            updateBasedOnReference(index);
            duration += 16; // Approximately 1 frame at 60fps

            // Stop the loop after 500ms (typical duration of a TW fade effect)
            if (duration > 500) {
                clearInterval(syncInterval);
                syncInterval = null;
            }
        }, 16);
    });

    // Observe style, class, and hidden attributes
    observer.observe(referenceElement, {
        attributes: true,
        attributeFilter: ["style", "class", "hidden"]
    });

    // Initial synchronization
    updateBasedOnReference(index);

    // Parent monitoring: if the referenceElement is completely removed from the DOM
    // (common in dynamic UI refreshes), we need to know.
    if (referenceElement.parentElement) {
        const parentObserver = new MutationObserver((mutations) => {
            for (let mutation of mutations) {
                const removed = Array.from(mutation.removedNodes);
                if (removed.includes(referenceElement)) {
                    console.warn("Reference element was removed from DOM. Sync stopped.");
                    // You might want to re-initialize your logic here if the element is recreated
                }
            }
        });
        parentObserver.observe(referenceElement.parentElement, { childList: true });
    }

    function generateTemplateTooltipData(template) {
        let tooltipHtml = "";
        const units = game_data.units;

        // Load data from storage
        const unitSpeeds = JSON.parse(localStorage.getItem('units_speed') || '{}');
        const unitCarry = JSON.parse(localStorage.getItem('units_carry') || '{}');

        let slowestUnitSpeed = 0;
        let totalCarry = 0;
        let hasVariableCarry = false; // To track if 'use_all' is used

        units.forEach(unit => {
            const value = parseInt(template[unit], 10) || 0;
            const isUseAll = template.use_all && template.use_all.includes(unit);

            if (value > 0 || isUseAll) {
                const iconUrl = `https://dspt.innogamescdn.com/asset/95eda994/graphic/unit/unit_${unit}.png`;
                const displayValue = isUseAll ? "All" : value;

                tooltipHtml += `<img src="${iconUrl}" alt="${unit}" /> ${displayValue}<br />`;

                // Track slowest unit
                if (unitSpeeds[unit] && unitSpeeds[unit] > slowestUnitSpeed) {
                    slowestUnitSpeed = unitSpeeds[unit];
                }

                // Calculate Carry
                if (unitCarry[unit]) {
                    if (isUseAll) {
                        hasVariableCarry = true;
                    } else {
                        totalCarry += value * unitCarry[unit];
                    }
                }
            }
        });

        // ---- Carry Capacity Display ----
        const carryDisplay = hasVariableCarry ? `${totalCarry}+` : totalCarry;
        tooltipHtml += `
            <img src="https://dspt.innogamescdn.com/asset/95eda994/graphic/res.png" title="Resources" />
            ${carryDisplay}<br />
        `;

        // ---- Distance time calculation ----
        let distanceTimeText = "--:--:--";
        const targetDist = GM_getValue("target_distance");

        if (slowestUnitSpeed > 0 && targetDist) {
            const totalMinutes = slowestUnitSpeed * targetDist;
            distanceTimeText = formatMinutesToTime(totalMinutes);
        }

        tooltipHtml += `
            <span style="line-height: 20px;">
                ${distanceTimeText}
            </span>
        `;

        return tooltipHtml;
    }

    //Adds new button
    ctxButtons.appendChild(newButton);
}
