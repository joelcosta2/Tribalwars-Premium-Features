// Carrega o objeto do localStorage ou cria um novo garantindo que todas as propriedades existam
var infoOverview = JSON.parse(localStorage.getItem("infoOverview")) || {};

infoOverview.storage = infoOverview.storage || "";
infoOverview.wood = infoOverview.wood || "";
infoOverview.stone = infoOverview.stone || "";
infoOverview.iron = infoOverview.iron || "";
infoOverview.stable = infoOverview.stable || "";
infoOverview.barracks = infoOverview.barracks || "";
infoOverview.garage = infoOverview.garage || "";
infoOverview.smith = infoOverview.smith || "";
infoOverview.main = infoOverview.main || "";
infoOverview.statue = infoOverview.statue || "";
infoOverview.wall = infoOverview.wall || "";
infoOverview.farm = infoOverview.farm || "";


//por agora ja faz fetch dos tempos dos materiais, guarda na local storaage e aplica os hovers
function getStorageTime() {
    let minTime = 0;

    const storageCapacity = document.querySelector('#storage');
    localStorage.setItem('storage_capacity', storageCapacity.textContent)

    if (settings_cookies.general['show__time_storage_full_hover'] && game_data) {
        $.ajax({
            url: game_data.link_base_pure + 'storage',
            method: "GET",
            success: function (data) {
                var spans = $(data).find("span[data-endtime]");
                var fullStorageTimes = {
                    wood: $(spans[0]).attr("data-endtime"),
                    stone: $(spans[1]).attr("data-endtime"),
                    iron: $(spans[2]).attr("data-endtime")
                };
                localStorage.setItem('full_storage_times', JSON.stringify(fullStorageTimes));

                //hovers resources
                addRessourcesHover(fullStorageTimes);
                
                if (fullStorageTimes) {
                    minTime = Math.min(...Object.values(fullStorageTimes));
                    var now = Math.floor(Timing.getCurrentServerTime() / 1000);
                    var remaining = minTime - now;
                    
                    if(remaining) {
                        var hours = Math.floor(remaining / 3600).toString().padStart(2, '0');
                        var minutes = Math.floor((remaining % 3600) / 60).toString().padStart(2, '0');
                        var seconds = (remaining % 60).toString().padStart(2, '0');
                        
                        addToVisualLabelExtra('storage', `${hours}:${minutes}:${seconds}`, true, minTime);
                    }
                }
            }
        });
    }
    return minTime; //"Tempo calculado para o recurso mais cheio"
}

function addRessourcesHover(fullStorageTimes) {
    if (fullStorageTimes) {
        Object.keys(fullStorageTimes).forEach(resourceId => {
            var element = document.getElementById(resourceId);
            if (element) {
                var parentInfoBox = element.parentElement;
                var iconBox = parentInfoBox.previousElementSibling;
                
                var tooltip = document.getElementById("tooltip");
                if (tooltip) {
                    var bodyElement = tooltip.querySelector(".body");
                    if (bodyElement) {
                        parentInfoBox.dataset.interval = setInterval(function () {
                            const resourceHover = localStorage.getItem('resourceHover');
                            if (resourceHover) {
                                startResourceTimerFull(parseInt(fullStorageTimes[resourceHover]), bodyElement);
                            } else {
                                //bodyElement.style.display = "none";
                            }
                        }, 500);
                        
                        parentInfoBox.addEventListener("mouseenter", function () {
                            startResourceTimerFull(parseInt(fullStorageTimes[resourceId]), bodyElement);
                            localStorage.setItem('resourceHover', resourceId);
                        });
                        iconBox.addEventListener("mouseenter", function () {
                            startResourceTimerFull(parseInt(fullStorageTimes[resourceId]), bodyElement);
                            localStorage.setItem('resourceHover', resourceId);
                        });

                        parentInfoBox.addEventListener("mouseleave", function () {
                            localStorage.setItem('resourceHover', '');
                        });
                        iconBox.addEventListener("mouseleave", function () {
                            localStorage.setItem('resourceHover', '');
                        });
                    }
                }
            }
        });
    }
}

function getWoodInfo() {
    const storageFullTime = JSON.parse(localStorage.getItem('full_storage_times'));
    if (storageFullTime) {
        const fullTime = storageFullTime['wood'];
        if (fullTime) {
            var remaining = endTimeToTimer(fullTime);
            if(remaining) {
                const wood = document.getElementById('wood');
                let production;
                if (wood?.hasAttribute('data-title')) {
                    production = wood.getAttribute('data-title').match(/\d+/g);
                    const labelVisual = production + '/h\n' + `${remaining[0]}:${remaining[1]}:${remaining[2]}`;;
                    if (production) addToVisualLabelExtra('wood', labelVisual , true, fullTime);
                }
                return {perHour: production, fullEndTime: '0'}; //get value from label?
            } 
        }
    }
    return {};
}

function getStoneInfo() {
    const storageFullTime = JSON.parse(localStorage.getItem('full_storage_times'));
    if (storageFullTime) {
        const fullTime = storageFullTime['stone'];
        if (fullTime) {
            var remaining = endTimeToTimer(fullTime);
            if(remaining) {
                const stone = document.getElementById('stone');
                let production;
                if (stone?.hasAttribute('data-title')) {
                    production = stone.getAttribute('data-title').match(/\d+/g);
                    const labelVisual = production + '/h\n' + `${remaining[0]}:${remaining[1]}:${remaining[2]}`;;
                    if (production) addToVisualLabelExtra('stone', labelVisual , true, fullTime);
                }

                return {perHour: production, fullEndTime: '0'}; //get value from label?
            }
        }
    }
    return {};
}

function getIronInfo() {
    const storageFullTime = JSON.parse(localStorage.getItem('full_storage_times'));
    if (storageFullTime) {
        const fullTime = storageFullTime['iron'];
        if (fullTime) {
            var remaining = endTimeToTimer(fullTime);

            if(remaining) {
                const iron = document.getElementById('iron');
                let production;
                if (iron?.hasAttribute('data-title')) {
                    production = iron.getAttribute('data-title').match(/\d+/g);
                    const labelVisual = production + '/h\n' + `${remaining[0]}:${remaining[1]}:${remaining[2]}`;
                    if (production) addToVisualLabelExtra('iron', labelVisual , true, fullTime);
                }

                return {perHour: production, fullEndTime: '0'}; //get value from label?
            }
        }
    }
    return {};
}

function getSmithTime() {
    return "2 horas para pesquisa";
}

function getMainQueueTime() {
    const building_queue_next_slot = parseInt(localStorage.getItem('building_queue_next_slot'));
    const building_queue_last_slot = parseInt(localStorage.getItem('building_queue_last_slot'));
    
    if (building_queue_next_slot || building_queue_last_slot) {
        var lastSlot = Math.floor((building_queue_last_slot ? building_queue_last_slot  : building_queue_next_slot) / 1000);
        var remaining = endTimeToTimer(lastSlot);
        let labelVisual;
        
        if(remaining) {
            labelVisual = `${remaining[0]}:${remaining[1]}:${remaining[2]}`;
            addToVisualLabelExtra('main', labelVisual, true, lastSlot);
        }
    }
    return "Última construção em 5 horas";
}

function getWallTime() {
    return "Última construção em 5 horas";
}

function getMarketInfo() {
    if (game_data) {
        $.ajax({
            url: game_data.link_base_pure + 'market',
            method: "GET",
            success: function (data) {
                const market_merchant_available_count = $(data).find("#market_merchant_available_count").text();
                const market_merchant_total_count = $(data).find("#market_merchant_total_count").text();
                if(market_merchant_available_count && market_merchant_total_count)
                addToVisualLabelExtra('market', `${market_merchant_available_count}\/${market_merchant_total_count}`);
            }
        })
    }
    return "Última construção em 5 horas";
}

function getPlaceInfo() {
    const endTime_scavenging = localStorage.getItem('endTime_scavenging-auto');
    if (endTime_scavenging) {
        //get all timmings
        var endTime = Math.floor(endTime_scavenging / 1000);
        var remaining = endTimeToTimer(endTime);
        let labelVisual;
        
        if(remaining) {
            labelVisual = `${remaining[0]}:${remaining[1]}:${remaining[2]}`;
            addToVisualLabelExtra('place', labelVisual, true, endTime);
        }
    }
    return "Última construção em 5 horas";
}

function getStatueInfo() {
    const endTime_paladin = localStorage.getItem('endTime_auto_trainer_paladin');
    if (endTime_paladin) {
        //get all timmings
        var endTime = Math.floor(endTime_paladin / 1000);
        var remaining = endTimeToTimer(endTime);
        const labelVisual = `${remaining[0]}:${remaining[1]}:${remaining[2]}`;
        
        addToVisualLabelExtra('statue', labelVisual, true, endTime);

    }
    return "Última construção em 5 horas";
}

function getBarracksTime(barrracksTimes) {
    if (barrracksTimes && barrracksTimes.length) {
        var lastTrain = Math.floor(barrracksTimes[barrracksTimes.length - 1] / 1000);
        var remaining = endTimeToTimer(lastTrain);
        let labelVisual;
        
        if(remaining) {
            labelVisual = `${remaining[0]}:${remaining[1]}:${remaining[2]}`;
            addToVisualLabelExtra('barracks', labelVisual, true, lastTrain);
        }
    }
    return "30 minutos para terminar";
}

function getStableTime(stableTimes) {
    if (stableTimes && stableTimes.length) {
        var lastTrain = Math.floor(stableTimes[stableTimes.length - 1] / 1000);
        var remaining = endTimeToTimer(lastTrain);
        let labelVisual;
        
        if(remaining) {
            labelVisual = `${remaining[0]}:${remaining[1]}:${remaining[2]}`;
            addToVisualLabelExtra('stable', labelVisual, true, lastTrain);
        }
    }
    return "30 minutos para terminar";
}

function getGarageTime(garageTimes) {
    if (garageTimes && garageTimes.length) {
        var lastTrain = Math.floor(garageTimes[garageTimes.length - 1] / 1000);
        var remaining = endTimeToTimer(lastTrain);
        let labelVisual;
        
        if(remaining) {
            labelVisual = `${remaining[0]}:${remaining[1]}:${remaining[2]}`;
            addToVisualLabelExtra('stable', labelVisual, true, lastTrain);
        }
    }
    return "30 minutos para terminar";
}

function getFarmInfo() {
    return ''
}

function setOngoingBuildingLevels() {
    var buildingQueueActive = JSON.parse(localStorage.getItem("building_queue_active"));
    var buildIds = buildingQueueActive ? buildingQueueActive.map(item => item.replace(/[0-9]/g, '')) : [];
    var fakeBuildingQueue = JSON.parse(localStorage.getItem("building_queue"));
    var fakeBuildIds = fakeBuildingQueue ? fakeBuildingQueue.map(item => item?.replace(/[0-9]/g, '')) : [];

    document.querySelectorAll('.order-level').forEach(el => el.textContent = '');
    Object.keys(infoOverview).forEach(key => {
        let count = buildIds.filter(id => id === key).length;
        let fakeCount = fakeBuildIds.filter(id => id === key).length;
        if (count > 0) addToVisualLevelLabel(key, count);
        if (fakeCount > 0) addToVisualLevelLabel(key, fakeCount, true);
    });
}

function storeAvailableUnitsCosts(data) {
    let unitCosts = {};
    $(data).find(".recruit_req").each(function(index, reqEl) {
        $(reqEl).find('span').each(function(i, span) {
            let match = span.id.match(/^([a-z]+)_\d+_cost_([a-z_]+)$/);
            if (match) {
                let unitType = match[1]; // Nome da unidade (spear, sword, etc.)
                let resource = match[2]; // Tipo de recurso (wood, stone, iron, pop)
    
                // Garante que a unidade tenha um objeto antes de adicionar custos
                if (!unitCosts[unitType]) {
                    unitCosts[unitType] = {};
                }
                if (resource !== 'time') {
                    let costValue = parseFloat(span.textContent.replace('.', '')) || 0;
                    unitCosts[unitType][resource] = costValue;
                } else {
                    unitCosts[unitType].build_time = timeToMilliseconds(span.textContent);
                }
            }
        });
    
        // Adiciona informações adicionais, se existirem
        let unitTypeFromId = reqEl.id.split('_')[0];
        if (game_data.units[unitTypeFromId]) {
            unitCosts[unitTypeFromId].requirements_met = game_data.units[unitTypeFromId].requirements_met || false;
        }
    });
    localStorage.setItem('unit_managers_costs', JSON.stringify(unitCosts));
}

function fetchTrainInfo() {
    if (game_data) {
        $.ajax({
            url: game_data.link_base_pure + 'train',
            method: "GET",
            success: function (data) {
                const lang = JSON.parse(localStorage.getItem('tw_lang'));
                const stringToday = lang['aea2b0aa9ae1534226518faaefffdaad'];
                const stringTomorrow = lang['57d28d1b211fddbb7a499ead5bf23079'];
                const todayString = stringToday?.replace('%s', '\\d{1,2}:\\d{2}');
                const tomorrowString = stringTomorrow?.replace('%s', '\\d{1,2}:\\d{2}');
                const regex = new RegExp(`${todayString}|${tomorrowString}`, 'i');
                let barrracksTimes = [],
                    stableTimes = [],
                    garageTimes = [];
                //get all timmings barracks
                $(data).find("#trainqueue_wrap_barracks td").each(function () {
                    const text = $(this).text().trim();
                    if (regex.test(text)) {
                        barrracksTimes.push(extractBuildTimestampFromHTML(text))
                    }
                });
                getBarracksTime(barrracksTimes);

                //get all timmings stable
                $(data).find("#trainqueue_wrap_stable td").each(function () {
                    const text = $(this).text().trim();
                    if (regex.test(text)) {
                        stableTimes.push(extractBuildTimestampFromHTML(text))
                    }
                });
                getStableTime(stableTimes)

                //get all timmings gaarage
                $(data).find("#trainqueue_wrap_garage td").each(function () {
                    const text = $(this).text().trim();
                    if (regex.test(text)) {
                        garageTimes.push(extractBuildTimestampFromHTML(text))
                    }
                });
                getStableTime(garageTimes);

                //get all available units costs:
                storeAvailableUnitsCosts(data);
                }
        })
    }
}

function updatePremiumInfoOverview() {
    const show__overview_premmium_info = settings_cookies.general['show__overview_premmium_info'];

    if (show__overview_premmium_info) {
        infoOverview.storage = getStorageTime();
        infoOverview.wood = getWoodInfo();
        infoOverview.stone = getStoneInfo();
        infoOverview.iron = getIronInfo();
        infoOverview.garage = getGarageTime();
        infoOverview.smith = getSmithTime();
        infoOverview.main = getMainQueueTime();
        infoOverview.wall = getWallTime();
        infoOverview.market = getMarketInfo();
        infoOverview.place = getPlaceInfo();
        infoOverview.statue = getStatueInfo();
        infoOverview.farm = getFarmInfo();
        //setOngoingBuildingLevels();

        fetchTrainInfo();

        //infoOverview.stable = getStableTime();
        //infoOverview.barracks = getBarracksTime();

        localStorage.setItem("infoOverview", JSON.stringify(infoOverview));
    }
}

function addToVisualLabelExtra(buildingName, newTextContent, isTimer = false, endtime = 0) {
    const labelStorage = document.getElementsByClassName(`visual-label-${buildingName}`)[0];

    if (labelStorage) {
        const labelContent = labelStorage.querySelector('a');

        if (labelContent) {
            const div = document.createElement('div');
            div.style.whiteSpace = 'pre-line';
            div.textContent = newTextContent;
            div.style.fontSize = "9px";
        
            labelContent.appendChild(div);

            if (isTimer && endtime > 0) {
                labelContent.dataset.interval = setInterval(function () {
                    startTimerOnLabel(endtime, div);
                }, 500); // Atualiza a cada 500ms
            }
        }
    }
}

function addToVisualLevelLabel(buildingName, level, fakeQueue) {
    const labelStorage = document.querySelector(`.visual-label-${buildingName}`);
    if (labelStorage) {
        const orderLevel = labelStorage.querySelector('.order-level');
        if (orderLevel) {
            orderLevel.textContent = orderLevel.textContent + `+${level}`;
            if (fakeQueue) {
                orderLevel.style.color = "orange";
            }
        }
    }
}

