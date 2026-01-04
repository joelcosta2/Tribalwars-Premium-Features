
var coords, mapPopUpBody;
function getOutgoingCommandsFromOverview() {
    if (settings_cookies.general['show__extra_options_map_hover'] || settings_cookies.general['show__outgoingInfo_map']) {
        $.ajax({
            'url': game_data.link_base_pure + 'overview',
            'type': 'GET',
            'success': function (data) {
                var outgoing_units = [];
                var tempElement = document.createElement('div');
                tempElement.innerHTML = data;
                var outgoingTable = tempElement.querySelector('#commands_outgoings');
                if (outgoingTable) {
                    var outgoing_unitsElement = outgoingTable.querySelectorAll('.command-row');
                    if (outgoing_unitsElement.length > 0) {
                        outgoing_unitsElement.forEach(function (element) {
                            var outgoing_units_temp = {};

                            var villageName = element.querySelector('.quickedit-label');
                            var text = villageName.innerText;
                            outgoing_units_temp.name = text.match(/\((.*?)\)/)?.[1];
                            outgoing_units_temp.imgs = '';

                            // Ensure 'element' exists before querying
                            const hover_details = element?.querySelectorAll('.command_hover_details') ?? [];

                            hover_details.forEach((iconElem) => {
                                const img = iconElem.querySelector('img');

                                // 1. Check if img exists and has a src
                                if (img?.src) {
                                    // 2. Use a safer Regex match with a fallback
                                    const match = img.src.match(/\/([^/]+)\.(?:png|webp)$/);

                                    if (match && match[1]) {
                                        const unitName = match[1];

                                        // 3. Clean logic for joining strings
                                        // This prevents issues with empty strings and leading/trailing commas
                                        outgoing_units_temp.imgs = outgoing_units_temp.imgs
                                            ? `${unitName},${outgoing_units_temp.imgs}`
                                            : unitName;
                                    }
                                }
                            });

                            outgoing_units.push(outgoing_units_temp);
                        })
                        localStorage.setItem('outgoing_units_saved', JSON.stringify(outgoing_units));

                        // Espera até que os elementos do mapa carreguem antes de adicionar os ícones
                        if (settings_cookies.general['show__outgoingInfo_map']) {
                            waitForMapElements(addOutgoingIcons);
                        }
                    }
                } else {
                    localStorage.setItem('outgoing_units_saved', JSON.stringify([]));
                }
            }
        });
    }
}

function waitForMapElements(callback) {
    let checkExist = setInterval(() => {
        // Verifica se pelo menos uma aldeia foi carregada no mapa
        let firstVillage = document.querySelector("[id^='map_village_']");
        if (firstVillage) {
            clearInterval(checkExist); // Para a verificação
            callback(); // Chama a função para adicionar os ícones
        }
    }, 500); // Verifica a cada 500ms
}

function addOutgoingIcons() {
    let outgoingCommands = JSON.parse(localStorage.getItem('outgoing_units_saved')) || [];

    outgoingCommands.forEach(command => {
        let villageCoords = command.name.replace('|', ''); // Remove o "|"
        let villageInfo = TWMap.villages[villageCoords];

        if (!villageInfo) {
            return;
        }

        let villageElement = document.getElementById(`map_village_${villageInfo.id}`);

        if (!villageElement) {
            return;
        }

        // Obtém a posição do ícone original
        let { top, left } = villageElement.style;

        //Add icons
        var icons = command.imgs.split(',');
        icons.forEach(function (icon, index) {
            let farmIcon = document.createElement("img");
            farmIcon.id = `${villageCoords}-${icon}-img`
            farmIcon.src = `https://dspt.innogamescdn.com/asset/7fe7ab60/graphic/command/${icon}.png`;
            farmIcon.classList.add('icon_outgoing_unit')
            farmIcon.width = 18;
            farmIcon.height = 18;
            farmIcon.style.position = "absolute";
            farmIcon.style.top = top;
            farmIcon.style.left = (parseInt(left) - index * 20) + "px";
            farmIcon.style.marginLeft = '30px';
            farmIcon.style.zIndex = 4;

            // Adiciona o ícone antes da aldeia no DOM
            var currentImg = document.getElementById(`${villageCoords}-${icon}-img`);
            if (!currentImg) {
                villageElement.parentNode.insertBefore(farmIcon, villageElement);
            }
        })
    });
}

async function getReportsList() {
    if (!settings_cookies.general['show__extra_options_map_hover']) return;

    let storedReports = localStorage.getItem('reports_list') ? JSON.parse(localStorage.getItem('reports_list')) : [];

    // Criar um mapa para armazenar o relatório mais recente por coordenada
    let reportsMap = new Map();
    storedReports.forEach(report => {
        reportsMap.set(report.coords, report);
    });

    let groupIds = [0, 7600]; // IDs dos grupos de relatórios
    let allNewReports = [];

    for (let groupId of groupIds) {
        let newReports = await fetchAllReports(groupId);
        allNewReports.push(...newReports);
    }

    // Atualizar o mapa com os novos relatórios
    allNewReports.forEach(report => {
        let existingReport = reportsMap.get(report.coords);
        if (!existingReport || isNewer(report.date, existingReport.date)) {
            reportsMap.set(report.coords, report);
        }
    });

    // Converter de volta para array e salvar no localStorage
    let updatedReports = Array.from(reportsMap.values());
    localStorage.setItem('reports_list', JSON.stringify(updatedReports));
}

async function fetchAllReports(groupId) {
    let pages = 0;
    let firstPageData = await fetchReportsPage(groupId, 0);
    if (!firstPageData) return [];

    let tempElement = document.createElement('div');
    tempElement.innerHTML = firstPageData;

    pages = tempElement.querySelectorAll('.paged-nav-item').length + 1;

    let newReports = extractReports(tempElement);

    let requests = [];
    for (let i = 12; i < pages * 12; i += 12) {
        requests.push(fetchReportsPage(groupId, i));
    }

    let results = await Promise.all(requests);
    results.forEach(data => {
        let tempEl = document.createElement('div');
        tempEl.innerHTML = data;
        newReports.push(...extractReports(tempEl));
    });

    return newReports;
}

function fetchReportsPage(groupId, from) {
    return new Promise((resolve, reject) => {
        $.ajax({
            url: game_data.link_base_pure + `report&mode=attack&group_id=${groupId}&from=${from}`,
            type: 'GET',
            success: resolve,
            error: reject
        });
    });
}

function extractReports(tempElement) {
    let reports = [];
    let reportLabels = tempElement.querySelectorAll('.quickedit-label');

    reportLabels.forEach(label => {
        let reportId = label.parentElement.getAttribute('data-id');

        let tempReport = {
            coords: (label.innerHTML).match(/\(([^)]+)\)[^\(]*$/)[1],
            date: tempElement.querySelector('.report-' + reportId).querySelector('tr > .nowrap').innerText,
            id: reportId
        };

        reports.push(tempReport);
    });

    return reports;
}

// Função para comparar datas e determinar qual é mais recente
function isNewer(date1, date2) {
    let d1 = new Date(convertDateToISO(date1));
    let d2 = new Date(convertDateToISO(date2));

    return d1 > d2;
}

// Função para converter formato de data para ISO (YYYY-MM-DD HH:MM) para comparação
function convertDateToISO(dateStr) {
    let parts = dateStr.match(/([a-z]{3})\. (\d+), (\d+):(\d+)/i); // Exemplo: "mar. 14, 17:56"
    let monthMap = {
        "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
        "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12
    };

    if (!parts) return null;

    let month = monthMap[parts[1].toLowerCase()];
    let day = parseInt(parts[2], 10);
    let hour = parseInt(parts[3], 10);
    let minute = parseInt(parts[4], 10);
    let currentYear = new Date().getFullYear(); // Assume o ano atual

    let isoString = `${currentYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

    return isoString;
}

function insertReportData(report) {
    var tr = document.createElement('tr');
    tr.id = "info_last_attack";
    var th = document.createElement('th');
    th.innerHTML = '↓Last Attack:  ';
    var td = document.createElement('td');
    td.innerHTML = report.date;
    tr.appendChild(th);
    tr.appendChild(td);
    mapPopUpBody.appendChild(tr);

    if (report.attackLootResults) {
        const tempTable = document.createElement('table');
        tempTable.innerHTML = report.attackLootResults;
        const extractedElement = tempTable.querySelector('tr');
        mapPopUpBody.appendChild(extractedElement);
    }

    if (report.attackLootDiscoverResults) {
        const tempTable = document.createElement('table');
        tempTable.innerHTML = report.attackLootDiscoverResults;
        const extractedElement = tempTable.querySelector('tr');
        mapPopUpBody.appendChild(extractedElement);
    }
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
                                th.innerHTML = '↓Last Attack:  ';
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
                                var attackLootDiscoverResults = tempElement.querySelector('#attack_spy_resources tr');
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

function setMapSize() {
    var mapWrap = document.getElementById('map_wrap');
    if (mapWrap) {
        var map = document.getElementById('map');
        var extraMapContainer = document.getElementById('map_container');
        var goHomeBoundarie = document.getElementById('map_go_home_boundary');
        var coordYWrap = document.getElementById('map_coord_y_wrap');
        var coordXWrap = document.getElementById('map_coord_x_wrap');

        // Recupera as configurações originais salvas do localStorage
        var storedMapConfig = JSON.parse(localStorage.getItem('mapConfig')) || {};
        if (!storedMapConfig.originalWidth || !storedMapConfig.originalHeight) {
            storedMapConfig.originalWidth = map.style.width || 'auto';
            storedMapConfig.originalHeight = map.style.height || 'auto';
        }

        var mapImages = document.querySelectorAll('#map img');
        mapImages.forEach(function (img) {
            if (!storedMapConfig.originalMapImgWidth || !storedMapConfig.originalMapImgHeight) {
                storedMapConfig.originalMapImgWidth = img.style.width || 'auto';
                storedMapConfig.originalMapImgHeight = img.style.height || 'auto';
            }
        });

        // Salva as configurações iniciais no localStorage
        localStorage.setItem('mapConfig', JSON.stringify(storedMapConfig));

        const mapHeightInput = document.querySelector('#map_custom_height');
        const mapWidthInput = document.querySelector('#map_custom_width');

        if (mapHeightInput.value != localStorage.getItem('map_custom_height')) {
            localStorage.setItem('map_custom_height', mapHeightInput.value);
        }
        if (mapWidthInput.value != localStorage.getItem('map_custom_width')) {
            localStorage.setItem('map_custom_width', mapWidthInput.value);
        }

        const mapHeight = localStorage.getItem('map_custom_height') + 'px';
        const mapWidth = localStorage.getItem('map_custom_width') + 'px';

        // Define os novos tamanhos
        mapWrap.style.width = mapWidth;
        mapWrap.style.height = mapHeight;
        map.style.width = mapWidth;
        map.style.height = mapHeight;
        coordYWrap.style.height = mapHeight;
        coordXWrap.style.width = mapWidth;

        mapImages.forEach(function (img) {
            img.style.width = 'auto';
            img.style.height = 'auto';
        });

        // Remove o container antigo e recria o mapa
        extraMapContainer.remove();
        goHomeBoundarie.remove(); //it will generate again
        TWMap.size = [9, 9];
        TWMap.init();

        wait(1).then(() => {
            // Captura a parte do hash da URL (depois do #)
            const hash = window.location.hash.substring(1); // Remove o #

            TWMap.focusSubmit();
        });

    }
}

function createBigMapOption() {
    const tr = document.createElement('tr');
    tr.style.background = '#e27f26 !important';

    //option to enable big map
    const tdCheckbox = document.createElement('td');
    const inputCheckbox = document.createElement('input');
    inputCheckbox.type = 'checkbox';
    inputCheckbox.name = 'show_biggermap';
    inputCheckbox.id = 'show_biggermap';
    inputCheckbox.checked = settings_cookies.general['show__big_map'];
    inputCheckbox.onclick = function () {
        settings_cookies.general['show__big_map'] = !settings_cookies.general['show__big_map'];
        localStorage.setItem('settings_cookies', JSON.stringify(settings_cookies));
        if (settings_cookies.general['show__big_map']) {
            setMapSize();
        } else {
            location.reload();
        }
    };
    tdCheckbox.appendChild(inputCheckbox);

    const tdLabel = document.createElement('td');
    tdLabel.colSpan = 2;
    tdLabel.style.background = 'none';
    const label = document.createElement('label');
    label.setAttribute('for', 'show_biggermap');
    label.textContent = 'Show Large Map';
    tdLabel.appendChild(label);

    tr.appendChild(tdCheckbox);
    tr.appendChild(tdLabel);

    //option to set map size
    let trMapSize = document.createElement("tr");
    let td1 = document.createElement("td");
    td1.classList.add("nowrap");
    let td2 = document.createElement("td");
    td2.classList.add("nowrap");

    let labelHeight = document.createTextNode("Height: ");
    let inputHeight = document.createElement("input");
    inputHeight.type = "number";
    inputHeight.name = "x";
    inputHeight.id = "map_custom_height";
    inputHeight.value = localStorage.getItem('map_custom_height');
    inputHeight.setAttribute('step', '100');
    inputHeight.style.width = "50px";
    inputHeight.oninput = function () {
        if (settings_cookies.general['show__big_map']) {
            setMapSize();
        }
        //save value
    }

    let labelWidth = document.createTextNode(" Width: ");
    let inputWidth = document.createElement("input");
    inputWidth.type = "number";
    inputWidth.name = "y";
    inputWidth.id = "map_custom_width";
    inputWidth.value = localStorage.getItem('map_custom_width');
    inputWidth.setAttribute('step', '100');
    inputWidth.style.width = "50px";
    inputWidth.oninput = function () {
        if (settings_cookies.general['show__big_map']) {
            setMapSize();
        }
        //save value
    }
    td1.appendChild(labelHeight);
    td1.appendChild(inputHeight);
    td2.appendChild(labelWidth);
    td2.appendChild(inputWidth);
    trMapSize.appendChild(td1);
    trMapSize.appendChild(td2);

    const visTables = document.querySelectorAll('#map_config .vis');

    if (visTables.length > 1) {
        const tbody = visTables[1].querySelector('tbody');
        if (tbody) {
            const secondTr = tbody.querySelectorAll('tr')[1];
            if (secondTr) {
                tbody.insertBefore(tr, secondTr);
            } else {
                tbody.appendChild(tr);
            }
            tbody.insertBefore(trMapSize, secondTr);
        }
    }
}

function getVillageIDByCoord(coords) {
    const rawData = localStorage.getItem('map_villages');
    if (!rawData) {
        console.error("Map data not found in localStorage.");
        return null;
    }

    // Convert "457|370" into "457,370"
    const formattedCoord = coords.replace('|', ',');

    /**
     * Regex Breakdown:
     * ^        -> Start of a line (using 'm' flag for multiline)
     * (\d+)    -> Group 1: Captures the Village ID (digits)
     * ,.*?,    -> Skips the village name (everything between the next two commas)
     * ${formattedCoord} -> Matches the X,Y pair exactly
     */
    const regex = new RegExp(`^(\\d+),.*?,${formattedCoord},`, 'm');

    const match = rawData.match(regex);

    if (match && match[1]) {
        return match[1]; // Returns the ID string
    }

    console.warn(`Village not found for coordinates: ${coords}`);
    return null;
}

let lastFocusId = -1;

// Look for new target
function startMapContextWatcher() {
    setInterval(() => {
        const currentFocus = TWMap.context._curFocus;

        // Check if the focus changed and is not -1
        if (currentFocus !== lastFocusId) {
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

async function initializeTroopTemplates(targetID) {
    try {
        // 1. Wait for the AJAX call to finish and get the response
        const data = await $.ajax({
            'url': window.location.origin + game_data.link_base_pure + "place&ajax=command&target=" + targetID,
            'type': 'GET'
        });

        // 2. Extract and parse the data
        const htmlContent = data.dialog;

        // Get TroopTemplate
        const match = htmlContent.match(/TroopTemplates\.current\s*=\s*({.*?});/);

        if (match && match[1]) {
            const templatesData = JSON.parse(match[1]);
            TroopTemplates.current = templatesData;
            $(".evt-select-template").off('change').on('change', function () {
                TroopTemplates.useTemplate(this);
            });
            const templatesArray = Object.values(TroopTemplates.current);

            templatesArray.forEach((template, index) => {
                addFakeFarmAssistantButton(template, index);
            });

        } else {
            console.warn("No TroopTemplates found in the response.");
        }
    } catch (error) {
        console.error("AJAX or Parsing error:", error);
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
            TWMap.map.handler.onMovePixel = function (e, a) {
                originalMapOnMove.call(this, e, a);
                waitForMapElements(addOutgoingIcons);
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
        newButton.style.backgroundImage = 'url(data:image/png;base64,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)'
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
