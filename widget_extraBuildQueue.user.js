
// Build Extra List
function injectBuildQueue(availableBuildingsImgs, buildingImgs, availableBuildingLevels, buildQueueElment, update = false) {
    //Create the extra build queue table
    var extraBuildQueueTable = document.createElement('table');
    const columnToUse = settings_cookies.widgets.find(widget => widget.name === 'building_queue').column;
    extraBuildQueueTable.id = 'build_queue_table';
    extraBuildQueueTable.className = 'vis bordered-table';
    extraBuildQueueTable.setAttribute('width', '100%');
    extraBuildQueueTable.style.verticalAlign = 'middle';

    var tbody = document.createElement('tbody');
    var tr = document.createElement('tr');
    tr.appendChild(buildQueueElment);
    tbody.appendChild(tr);
    extraBuildQueueTable.appendChild(tbody);

    // Create the builds list table
    var buildsListTable = document.createElement('table');
    buildsListTable.className = 'vis bordered-table';
    buildsListTable.id = 'auto-construckt';
    buildsListTable.style.verticalAlign = 'middle';
    buildsListTable.style.width = '100%';

    //Create the table with all available builds
    availableBuildingsImgs.forEach(function (url, index) {
        var buildId = url.match(/([^\/]+?)(?=\d+\.\w+$)/)[1];
        var buildLvel = url.match(/([^\/]+?)(?=\.\w+$)/)[1];
        var row = document.createElement('tr');
        row.id = 'main_buildrow_' + index;

        // get next level
        let nextLevel = parseInt(availableBuildingLevels[index]) + 1;
        const buildingQueue = JSON.parse(localStorage.getItem('building_queue')) || [];
        const buildingActiveQueue = JSON.parse(localStorage.getItem('building_queue_active')) || [];
        const queuedBuilding = buildingQueue.filter(id => id === buildId).length;
        const activeQueuedCount = buildingActiveQueue.filter(id => id.replace(/\d+/g, '') === buildId).length;
        nextLevel += queuedBuilding || 0;
        nextLevel += activeQueuedCount || 0;

        const canAddToQueue = buildingImgs.includes(url) && buildingQueue.length === 0;

        var cell = document.createElement('td');
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.padding = '0';

        var imgLink = document.createElement('a');
        imgLink.href = game_data.link_base_pure + '' + buildId;
        var img = document.createElement('img');
        img.className = 'bmain_list_img';
        img.style.marginRight = '3px';
        img.src = url;
        img.loading = 'lazy';
        img.setAttribute('data-title', buildLvel);
        imgLink.appendChild(img);
        cell.appendChild(imgLink);

        var textLink = document.createElement('a');
        textLink.href = game_data.link_base_pure + '' + buildId;
        textLink.textContent = document.querySelector('.visual-label-' + buildId)?.getAttribute('data-title');
        cell.appendChild(textLink);

        var br = document.createElement('br');
        cell.appendChild(br);

        // Create the link for upgrading the building
        var upgradeLink = document.createElement('a');
        upgradeLink.className = canAddToQueue ? 'btn btn-build' : 'btn evt-cancel-btn btn-confirm-no';
        upgradeLink.setAttribute('data-building', (buildId + nextLevel));
        upgradeLink.setAttribute('data-level-next', nextLevel);

        upgradeLink.id = 'main_buildlink_' + buildId + '_' + nextLevel;
        upgradeLink.style.width = '-webkit-fill-available';
        upgradeLink.style.margin = '0';
        upgradeLink.style.fontSize = '11px !important';
        upgradeLink.style.padding = '1px 3px';
        upgradeLink.textContent = 'Level ' + nextLevel;
        upgradeLink.onclick = function () {
            addToBuildQueue(buildId);
        }

        upgradeLink.addEventListener('mouseenter', function (event) {
            toggleTooltip(event.target, true);
        });
        upgradeLink.addEventListener('mouseleave', function (event) {
            toggleTooltip(event.target, false);
        });

        var upgradeCell = document.createElement('td');
        const dataText = canAddToQueue ?
            'Add to queue' + createResourceElementsString(buildId) :
            'Add to waiting queue' + (!queuedBuilding ? createResourceElementsString(buildId) : '<div>no info, build alreday in waiting queue</div>');
        upgradeCell.setAttribute('data-title', dataText);
        upgradeCell.appendChild(upgradeLink);

        row.appendChild(cell);
        row.appendChild(upgradeCell);
        buildsListTable.appendChild(row);
    });
    var extraBuildDiv = document.createElement('div');

    extraBuildDiv.appendChild(extraBuildQueueTable);
    extraBuildDiv.appendChild(buildsListTable);

    createWidgetElement({ identifier: 'Building Queue', contents: extraBuildDiv, columnToUse, update, extra_name: '', description: '' });
}

function getCurrentQueueListElement(tempElement, allBuildingsImgs) {
    var buildQueueElment = document.createElement('td');
    var queueBuildIdsActive = [];
    var cancelButtons = tempElement.querySelectorAll('.btn-cancel');
    var dateNextSlot, dateLastSlot;

    //Get times from the cancel buttons row and check if the queue is full
    if (cancelButtons.length == 2) {
        isBuildQueueFull = true;

        dateNextSlot = extractBuildTimestampFromHTML(cancelButtons[0].parentElement.parentElement.children[3].textContent);
        dateLastSlot = extractBuildTimestampFromHTML(cancelButtons[1].parentElement.parentElement.children[3].textContent);

        localStorage.setItem('building_queue_next_slot', dateNextSlot);
        localStorage.setItem('building_queue_last_slot', dateLastSlot);
        setCancelBuildIds(cancelButtons);
    } else if (cancelButtons.length == 1) {
        isBuildQueueFull = false;

        dateNextSlot = extractBuildTimestampFromHTML(cancelButtons[0].parentElement.parentElement.children[3].textContent);
        localStorage.setItem('building_queue_next_slot', dateNextSlot);
        localStorage.removeItem('building_queue_last_slot');
        setCancelBuildIds(cancelButtons);
    } else {
        isBuildQueueFull = false;
        localStorage.setItem('building_queue_next_slot', 0);
    }

    cancelButtons.forEach(function (element) {
        queueBuildIdsActive.push(element.parentElement.parentElement.querySelector('.lit-item > img').src.split('/').pop().replace(/\.[^/.]+$/, ''));
    })


    //MUDAR DE SITIO
    const buildingsData = {};
    tempElement.querySelectorAll("[id^='main_buildrow_']").forEach(row => {
        const buildId = row.id.replace("main_buildrow_", "");
        const tds = row.querySelectorAll("td");

        if (tds.length > 2) {
            const wood = parseInt(row.querySelector(".cost_wood")?.getAttribute("data-cost") || "0", 10);
            const stone = parseInt(row.querySelector(".cost_stone")?.getAttribute("data-cost") || "0", 10);
            const iron = parseInt(row.querySelector(".cost_iron")?.getAttribute("data-cost") || "0", 10);
            const time = tds[4]?.innerText.trim() || "";
            const population = tds[5]?.innerText.trim() || "";

            buildingsData[buildId] = { wood, stone, iron, time, population };
        }
    });

    localStorage.setItem('nextLevelBuildsQueueInfo', JSON.stringify(buildingsData))
    localStorage.setItem('building_queue_active', JSON.stringify(queueBuildIdsActive))

    // inject active real queue
    injectAtiveQueueList(queueBuildIdsActive, buildQueueElment)
    // inject waiting fake queue
    injectFakeQueueList(queueBuildIdsActive, buildQueueElment, allBuildingsImgs);

    return buildQueueElment;
}

function createResourceElementsString(buildId) {
    const storedData = localStorage.getItem('nextLevelBuildsQueueInfo');
    if (!storedData) return '';

    const buildingsData = JSON.parse(storedData);
    const buildInfo = buildingsData[buildId];
    if (!buildInfo) return '';

    function createSpan(className, value) {
        const span = document.createElement("span");
        span.className = `icon header ${className}`;
        span.style.margin = '0';
        const textNode = document.createTextNode(` ${value}`);
        const wrapper = document.createElement("span"); // Wrapper para manter estrutura correta
        wrapper.appendChild(span);
        wrapper.appendChild(textNode);
        wrapper.style.marginRight = '1px';

        return wrapper.outerHTML;
    }

    return (`<div>` +
        createSpan("wood", buildInfo.wood) +
        createSpan("stone", buildInfo.stone) +
        createSpan("iron", buildInfo.iron) +
        `<div>` +
        createSpan("time", buildInfo.time) +
        (buildInfo.population ? createSpan("population", buildInfo.population) : '') +
        `</div>` +
        `</div>`
    );
}

// inject active real queue
function injectAtiveQueueList(queueBuildIdsActive, buildQueueElment) {
    if (queueBuildIdsActive.length) {
        queueBuildIdsActive.forEach(function (id, index) {
            var anchor = document.createElement('a');
            anchor.className = '';
            anchor.style.display = 'inline-flex';
            anchor.setAttribute('data-title', `<span class='warn_90'>Cancel build</span>`);

            function updateCountdown(event) {
                const now = Date.now();
                //const remainingTime = (index == 0 ? parseInt(localStorage.getItem('building_queue_next_slot')) : parseInt(localStorage.getItem('building_queue_last_slot'))) - now;
                const remainingTime = parseInt(localStorage.getItem('building_queue_next_slot')) - now;

                if (remainingTime <= 0) {
                    anchor.setAttribute('data-title', 'Construção concluída!');
                    return; // Para a contagem quando chegar a zero
                }

                const seconds = Math.floor((remainingTime / 1000) % 60);
                const minutes = Math.floor((remainingTime / 1000 / 60) % 60);
                const hours = Math.floor((remainingTime / 1000 / 60 / 60) % 24);
                const days = Math.floor(remainingTime / 1000 / 60 / 60 / 24);

                const formattedCountdown =
                    (days > 0 ? `${days}d ` : '') +
                    (hours > 0 ? `${hours}h ` : '') +
                    (minutes > 0 ? `${minutes}m ` : '') +
                    `${seconds}s`;

                if (index == 0) {
                    anchor.setAttribute('data-title', `<span class='warn_90'>Cancel build</span></br> ${formattedCountdown}`);
                } else {
                    anchor.setAttribute('data-title', `<span class='warn_90'>Cancel build</span></br> Starts in ${formattedCountdown}`);
                }
                toggleTooltip(event.target, true);

                event.target.countdownTimeout = setTimeout(() => updateCountdown(event), 1000);
            }

            anchor.style.border = '1px solid #7d510f';

            anchor.onclick = function () {
                removeFromActiveBuildQueue(index);
            }

            var span = document.createElement('span');
            span.className = 'icon header village active_queue';
            span.style.backgroundImage = 'url(https://dspt.innogamescdn.com/asset/95eda994/graphic/buildings/mid/' + id + '.png)'
            span.style.backgroundPosition = '0px 0px';
            span.style.backgroundSize = 'contain';
            span.style.backgroundRepeat = 'no-repeat';
            span.style.width = '24px';
            span.style.marginRight = '4px';
            span.style.position = 'relative';
            span.style.display = 'inline-block';
            span.style.cursor = 'pointer';

            span.addEventListener('mouseenter', function (event) {
                toggleTooltip(event.target, true);
                updateCountdown(event)
            });
            span.addEventListener('mouseleave', function (event) {
                toggleTooltip(event.target, false);
                clearTimeout(event.target.countdownTimeout);
            });


            var progressBar = document.createElement('div');
            progressBar.style.position = 'absolute';
            progressBar.style.bottom = '0';
            progressBar.style.left = '0';
            progressBar.style.width = '100%';
            progressBar.style.height = '4px';
            progressBar.style.backgroundColor = '#4caf50';

            span.appendChild(progressBar);
            anchor.appendChild(span);
            buildQueueElment.appendChild(anchor);
        });
    }
}

function injectFakeQueueList(queueBuildIdsActive, buildQueueElment, allBuildingsImgs) {
    var queueBuildIds = JSON.parse(localStorage.getItem('building_queue') || '[]');
    if (queueBuildIds.length) {
        queueBuildIds.forEach(function (id) {
            var anchor = document.createElement('a');
            anchor.className = '';
            anchor.style.display = 'inline-flex';
            anchor.setAttribute('data-title', 'Remove from queue');
            anchor.style.border = '1px solid #7d510f';
            anchor.onclick = function () {
                var index = Array.from(this.parentElement.children).indexOf(this);
                removeFromBuildQueue(index - queueBuildIdsActive.length);
            }

            var span = document.createElement('span');
            span.className = 'icon header village';
            span.style.backgroundImage = 'url(' + allBuildingsImgs.find(element => element.includes(id)) + ')';
            //span.style.backgroundImage = 'url(https://dspt.innogamescdn.com/asset/95eda994/graphic/buildings/mid/' + id + '.png)'
            span.style.backgroundPosition = '0px 0px';
            span.style.backgroundSize = 'contain';
            span.style.backgroundRepeat = 'no-repeat';
            span.style.width = '24px';
            span.style.marginRight = '4px';
            span.style.position = 'relative';
            span.style.display = 'inline-block';
            span.style.cursor = 'pointer';

            var progressBar = document.createElement('div');
            progressBar.style.position = 'absolute';
            progressBar.style.bottom = '0';
            progressBar.style.left = '0';
            progressBar.style.width = '100%';
            progressBar.style.height = '4px';
            progressBar.style.backgroundColor = 'orange';

            span.appendChild(progressBar);

            span.addEventListener('mouseenter', function (event) {
                toggleTooltip(event.target, true);
            });
            span.addEventListener('mouseleave', function (event) {
                toggleTooltip(event.target, false);
            });


            anchor.appendChild(span);
            buildQueueElment.appendChild(anchor);
        });
    }
}

function injectQueues(mainElement, update) {
    if (mainElement) {
        const parser = new DOMParser();
        const tempElement = parser.parseFromString(mainElement, 'text/html');

        localStorage.setItem('last_main_page', mainElement);
        var { availableBuildingsImgs, availableBuildingLevels, allBuildingsImgs, allAvailableBuildingLevels } = getAllBuildingsImages(tempElement);
        var buildQueueElment = getCurrentQueueListElement(tempElement, allBuildingsImgs);

        if (settings_cookies.general['show__building_queue_all']) {
            injectBuildQueue(allBuildingsImgs, availableBuildingsImgs, allAvailableBuildingLevels, buildQueueElment, update);
        } else {
            injectBuildQueue(availableBuildingsImgs, availableBuildingsImgs, availableBuildingLevels, buildQueueElment, update);
        }
        setOngoingBuildingLevels();
    }
}

function getAllBuildingsImages(tempElement) {
    var buildingsElement = tempElement.querySelector('#buildings');
    var allBuildingsImgs = [], availableBuildingsImgs = [], allAvailableBuildingLevels = [], availableBuildingLevels = [];
    if (buildingsElement) {
        var trs = buildingsElement.querySelectorAll('tr');
        trs.forEach(function (tr) {
            if (tr.id !== '') {
                var tds = tr.querySelectorAll('td');
                if (tds.length > 2) {
                    var buildButtons = tr.querySelector('.btn-build');
                    if (buildButtons) {
                        //get lvls and images for available buildings only
                        if (buildButtons.style.display !== 'none') {
                            var span = tds[0].querySelector('span'), lvl;
                            if (span) {
                                lvl = span.textContent.match(/\d+/);
                                if (lvl) {
                                    availableBuildingLevels.push(lvl[0]);
                                }
                            }
                            var a = tds[0].querySelector('a');
                            if (a && lvl) {
                                availableBuildingsImgs.push(a.querySelector('img').src);
                            }
                        }
                        //get lvls and images for all buildings
                        var span = tds[0].querySelector('span'), lvl;
                        if (span) {
                            lvl = span.textContent.match(/\d+/);
                            if (lvl) {
                                allAvailableBuildingLevels.push(lvl[0]);
                            }
                        }
                        var a = tds[0].querySelector('a');
                        if (a && lvl) {
                            allBuildingsImgs.push(a.querySelector('img').src);
                        }
                    }
                }
            }
        });
    }

    return { availableBuildingsImgs, availableBuildingLevels, allBuildingsImgs, allAvailableBuildingLevels };
}

function setCancelBuildIds(cancelButtons) {
    var ids = [];
    cancelButtons.forEach(btn => {
        var id = new URLSearchParams(new URL(btn.href).search).get('id');
        if (id) ids.push(id);
    });
    localStorage.setItem('queue_cancelIds', JSON.stringify(ids));
}

function addToBuildQueue(build_id) {
    if (build_id) {
        if (!isBuildQueueFull && !JSON.parse(localStorage.getItem('waiting_for_queue')).buildId) {
            callUpgradeBuilding(build_id);
        } else {
            var building_queue = JSON.parse(localStorage.getItem('building_queue') || '[]');
            building_queue.push(build_id)
            localStorage.setItem('building_queue', JSON.stringify(building_queue));

            updateBuildQueueTimers();

            const mainElement = localStorage.getItem('last_main_page');
            if (mainElement) {
                injectQueues(mainElement, true);
            } else {
                fetchBuildQueueWidget(true);
            }
            showAutoHideBox('Build added to fake queue', false);
        }
    } else {
        var building_queue = JSON.parse(localStorage.getItem('building_queue'));
        callUpgradeBuilding(building_queue[0]);
    }
}

function removeFromBuildQueue(build_index) {
    var building_queue = JSON.parse(localStorage.getItem('building_queue'));
    building_queue.splice(build_index, 1);
    localStorage.setItem('building_queue', JSON.stringify(building_queue));

    if (build_index === 0) {
        localStorage.removeItem('function_building_queue');
        localStorage.removeItem('endTime_building_queue');
        localStorage.setItem('waiting_for_queue', JSON.stringify({}));
    }
    const mainElement = localStorage.getItem('last_main_page');
    if (mainElement) {
        injectQueues(mainElement, true);
    } else {
        fetchBuildQueueWidget(true);
    }
    showAutoHideBox('Build removed from fake queue', false);
}

async function removeFromActiveBuildQueue(build_index) {
    const cancelIds = JSON.parse(localStorage.getItem('queue_cancelIds'));
    try {
        await callRemoveFromActiveBuildingQueue(cancelIds[build_index]);  // Wait for the promise to resolve

        var building_active_queue = JSON.parse(localStorage.getItem('building_queue_active'));
        building_active_queue.splice(build_index, 1);
        localStorage.setItem('building_queue_active', JSON.stringify(building_active_queue));

        if (build_index === 0) {
            localStorage.setItem('building_queue_active', JSON.stringify({}));
        }

        const mainElement = localStorage.getItem('last_main_page');
        if (mainElement) {
            injectQueues(mainElement, true);
        } else {
            fetchBuildQueueWidget(true);
        }
    } catch (error) {
        showAutoHideBox('Error removing building:', error);
        console.error('Error removing building:', error);
    }
}

function callUpgradeBuilding(id) {
    $.ajax({
        'url': game_data.link_base_pure + 'main&action=upgrade_building&id=' + id + '&type=main&h=' + game_data.csrf,
        'type': 'GET',
        'success': function (data) {
            const parser = new DOMParser();
            const tempElement = parser.parseFromString(data, 'text/html');
            var main = tempElement.querySelector('#building_wrapper');

            var isError = tempElement.querySelector('.error_box');
            var building_queue = JSON.parse(localStorage.getItem('building_queue') || '[]');
            building_queue.shift();
            localStorage.setItem('building_queue', JSON.stringify(building_queue || []));
            localStorage.setItem('waiting_for_queue', JSON.stringify({}));
            if (isError !== null || !main) {
                var missingRessourceBuildRow = tempElement.querySelector('#main_buildrow_' + id + ' .inactive');
                if (missingRessourceBuildRow) {
                    var timeAvailable = extractBuildTimeFromHTML(missingRessourceBuildRow.textContent);
                }

                if (timeAvailable) {
                    showAutoHideBox('Added to queue at ' + (timeAvailable[0] == '0' ? 'Today' : 'Tomorrow') + ' @ ' + timeAvailable[1] + ':' + timeAvailable[2]);
                    if (timeAvailable[0]) {
                        var waiting_for_queue_temp = { buildId: id, time: timeAvailable };

                        localStorage.setItem('waiting_for_queue', JSON.stringify(waiting_for_queue_temp));
                        building_queue = JSON.parse(localStorage.getItem('building_queue'));
                        building_queue.unshift(id);
                        localStorage.setItem('building_queue', JSON.stringify(building_queue));
                    }
                } else {
                    showAutoHideBox('Just added? What happenend?', true);
                    building_queue = JSON.parse(localStorage.getItem('building_queue'));
                    building_queue.unshift(id);
                    if (building_queue) localStorage.setItem('building_queue', JSON.stringify(building_queue));
                }
                updateBuildQueueTimers();
                injectQueues(data, true);
            } else {
                showAutoHideBox('Build added to queue', false);
                injectQueues(data, true);
            }
        }
    });
}

function callRemoveFromActiveBuildingQueue(idToRemove) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', game_data.link_base_pure + 'main&ajaxaction=cancel_order&type=main', true);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
    xhr.setRequestHeader('Tribalwars-Ajax', '1');
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

    xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                showAutoHideBox('Build removed from queue', false);
            } else {
                showAutoHideBox('Error removing building:', xhr.status, xhr.statusText);
            }
        }
    };

    var body = 'id=' + idToRemove + '&destroy=0&h=' + game_data.csrf;
    xhr.send(body);
}

function updateBuildQueueTimers() {
    //Timeouts Extra Queue
    var building_queue = JSON.parse(localStorage.getItem('building_queue') || '[]');
    var waiting_for_queue = JSON.parse(localStorage.getItem('waiting_for_queue') || '{}');
    if (waiting_for_queue.time) {
        //build waiting with missing ressources, .time is the time for the available ressources
        var nextTimeDate = waiting_for_queue.time;
        var addToQueueDate = new Date();
        addToQueueDate.setDate(addToQueueDate.getDate() + parseInt(nextTimeDate[0]));
        addToQueueDate.setHours(parseInt(nextTimeDate[1]), parseInt(nextTimeDate[2]));
        var waitTime = (addToQueueDate.getTime() - Date.now());
        if (waitTime > 0) {
            setFunctionOnTimeOut('building_queue', addToBuildQueue, waitTime);
        } else {
            addToBuildQueue();
        }
    } else {
        //build waiting for the next slot available
        if (building_queue.length) {
            var nextTimeDate = new Date(parseInt(localStorage.getItem('building_queue_next_slot')));
            var waitTime = (nextTimeDate.getTime() - Date.now());
            if (waitTime > 0) {
                setFunctionOnTimeOut('building_queue', addToBuildQueue, waitTime);
            } else {
                addToBuildQueue();
            }
        }
    }
}

updateBuildQueueTimers();

function fetchBuildQueueWidget(update = false) {
    if (settings_cookies.general['show__building_queue']) {
        $.ajax({
            'url': game_data.link_base_pure + 'main',
            'type': 'GET',
            'success': function (data) {
                injectQueues(data, update);
            }
        });
    }
}