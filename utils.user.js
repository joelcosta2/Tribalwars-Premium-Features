
//Utils

//GLOBAL VARIABLES
var RIGHT_COLUMN = "rightcolumn";
var CENTER_COLUMN = "leftcolumn";
var LEFT_COLUMN = "script_column";

var default_settings_cookies = {
    widgets: [
        {
            name: 'village_list',
            column: LEFT_COLUMN,
            pos: 0,
            open: true
        },
        {
            name: 'notepad',
            column: LEFT_COLUMN,
            pos: 1,
            open: true
        },
        {
            name: 'building_queue',
            column: LEFT_COLUMN,
            pos: 2,
            open: true
        },
        {
            name: 'recruit_troops',
            column: LEFT_COLUMN,
            pos: 3,
            open: false
        },
    ],
    general: {
        keep_awake: true,
        redirect__train_buildings: false,
        remove__premium_promo: true,
        show__village_list: true,
        show__recruit_troops: false,
        show__navigation_arrows: true,
        show__notepad: true,
        show__building_queue: true,
        show__extra_options_map_hover: true,
        show__outgoingInfo_map: true,
        show__overview_premmium_info: true,
        show__time_storage_full_hover: true,
        show__big_map: false,
        show__auto_scavenging: {
            enabled: false,
            level: 0,
            all: true,
            troops: {
                spears: 0,
                //.....
            }
        },
        show__auto_paladin_train: {
            enabled: false,
            maxLevel: 0,
        },
    }
};

var settings_cookies = JSON.parse(localStorage.getItem('settings_cookies')) || default_settings_cookies;


var widgetsInjectFunctions = {
    'village_list': injectVillagesListWidget,
    'notepad': injectNotepadWidget,
    'building_queue': fetchBuildQueueWidget,
    'recruit_troops': injectRecruitTroopsWidget
};

var currentVillageIndex,
    textSelected,
    isBuildQueueFull = false;

//-----

function prepareLocalStorageItems() {
    if (unsafeWindow.lang) {
        localStorage.setItem('tw_lang', JSON.stringify(unsafeWindow.lang));
    }

    localStorage.setItem('waiting_for_queue', localStorage.getItem('waiting_for_queue') ?? '{}');
    localStorage.setItem('building_queue', localStorage.getItem('building_queue') ?? '[]');
    localStorage.setItem('villages_info', localStorage.getItem('villages_info') ?? '[]');
    localStorage.setItem('full_storage_times', localStorage.getItem('full_storage_times') ?? '[]');
    localStorage.setItem('mapConfig', localStorage.getItem('mapConfig') ?? '{}');
    localStorage.setItem('map_custom_height', localStorage.getItem('map_custom_height') ?? '600');
    localStorage.setItem('map_custom_width', localStorage.getItem('map_custom_width') ?? '900');
    if (typeof TribalWars !== 'undefined') {
        // Store on Tampermonkey storage
        GM_setValue("current_world", game_data?.world);
    }
}

function setCookieCurrentVillage() {
    var villageID = game_data.village?.id,
        villages = JSON.parse(localStorage.getItem('villages_info') || '[]'),
        villgersNum = sizeOfObject(villages);

    for (var i = 0; i < villgersNum; i++) {
        var urlTemp = villages[i].url;
        if (urlTemp.includes(villageID)) {
            currentVillageIndex = i;
            localStorage.setItem('current_village', currentVillageIndex);
            return;
        }
    }
}

function togglePopup(popup) {
    if (popup.style.display === 'none' || !popup.style.display) {
        popup.style.display = 'block';  // Show the popup
    } else {
        popup.style.display = 'none';   // Hide the popup
    }
}

function listenTextAreas() {
    // get all inputs || textareas
    var textAreas = document.getElementsByTagName('textarea');
    var i = 0;
    for (i = 0; i < textAreas.length; i++) {
        textAreas[i].onfocus = function () { textSelected = true };
        textAreas[i].onblur = function () { textSelected = false };
    }
    textAreas = document.getElementsByTagName('input');
    for (i = 0; i < textAreas.length; i++) {
        textAreas[i].onfocus = function () { textSelected = true };
        textAreas[i].onblur = function () { textSelected = false };
    }
}

function defineKeyboardShortcuts() {
    if (settings_cookies.general['show__navigation_arrows']) {
        $(document).keydown(function (evt) {
            if (evt.keyCode == 65 && !textSelected) {
                evt.preventDefault();
                previousVillage();
            }
        });
        $(document).keydown(function (evt) {
            if (evt.keyCode == 68 && !textSelected) {
                evt.preventDefault();
                nextVillage();
            }
        });
    }
}

function sizeOfObject(obj) {
    var size = 0, key;
    for (key in obj) {
        if (obj.hasOwnProperty(key)) size++;
    }
    return size;
}

function createWidgetElement({ identifier, contents, columnToUse, update, extra_name = '', description = '', title = '' }) {
    var columnElement = document.getElementById(columnToUse);

    if (columnElement) {
        var elemId = identifier.toLowerCase().replace(/ /g, '_'); // Obtém o título do elemento
        var elemName = extra_name != '' ? elemId + '_' + extra_name : elemId;
        title = title === '' ? identifier : title;

        // Create a container div
        var containerDiv = document.createElement('div');
        containerDiv.id = 'show_' + elemName;
        containerDiv.className = 'vis moveable widget script_widget';
        containerDiv.setAttribute('data-title', description != '' ? description : title);

        // Create the header with button
        var header = document.createElement('h4');
        header.className = 'head with-button';
        header.textContent = title;
        header.style.minWidth = 'max-content';
        header.style.width = '-webkit-fill-available';
        header.style.cursor = 'pointer';
        header.onclick = function () {
            var content = document.getElementById('widget_content_' + elemName);
            var miniElem = document.getElementById('mini_' + elemName);
            content.style.display = content.style.display === 'none' ? 'block' : 'none';
            if (miniElem.src.includes('minus')) {
                miniElem.src = miniElem.src.replace('minus', 'plus');
                // Encontra o objeto correspondente no array de widgets e atualiza o valor de 'open' para false
                settings_cookies.widgets.find(widget => widget.name === elemName).open = false;
            } else {
                miniElem.src = miniElem.src.replace('plus', 'minus');
                // Encontra o objeto correspondente no array de widgets e atualiza o valor de 'open' para true
                settings_cookies.widgets.find(widget => widget.name === elemName).open = true;
            }
            localStorage.setItem('settings_cookies', JSON.stringify(settings_cookies));
        };

        header.addEventListener('mouseenter', function (event) {
            toggleTooltip(event.target, true);
        });
        header.addEventListener('mouseleave', function (event) {
            toggleTooltip(event.target, false);
        });
        // Create the image for the button
        var buttonImg = document.createElement('img');
        buttonImg.className = 'widget-button';
        buttonImg.src = settings_cookies.widgets.find(widget => widget.name === elemName).open ? 'graphic/minus.png' : 'graphic/plus.png';
        buttonImg.id = 'mini_' + elemName;
        header.appendChild(buttonImg);

        var contentDiv = document.createElement('div');
        contentDiv.id = 'widget_content_' + elemName;
        contentDiv.style.display = settings_cookies.widgets.find(widget => widget.name === elemName).open ? 'block' : 'none';
        contentDiv.appendChild(contents);
        containerDiv.appendChild(header);
        containerDiv.appendChild(contentDiv);
        //if update, remove the current element
        if (update) {
            var currentElement = document.getElementById('show_' + elemName);
            if (currentElement) {
                columnElement.removeChild(currentElement);
            }
        }

        // Verifica se o índice fornecido é válido
        var widgetIndex = settings_cookies.widgets.find(widget => widget.name === elemName).pos;
        var children = columnElement.childNodes;
        if (widgetIndex >= 0 && widgetIndex <= children.length) {
            var refChild = (widgetIndex + 1 === children.length) ? children[widgetIndex] : children[widgetIndex + 1];
            columnElement.insertBefore(containerDiv, refChild);
        } else {
            columnElement.appendChild(containerDiv);
        }
    }

}

function displayWarningPopup(title, message, timeoutDuration = 5000) {
    return new Promise((resolve, reject) => {
        // Create the popup dynamically
        const popupDiv = document.createElement('div');
        popupDiv.classList.add('popup_style', 'borderimage', 'popup_box');
        popupDiv.style.width = '556px';
        popupDiv.style.position = 'absolute';
        popupDiv.style.opacity = '1';
        popupDiv.style.top = '50%';
        popupDiv.style.left = '50%';
        popupDiv.style.transform = 'translate(-50%, -70%)';
        popupDiv.style.display = 'block';

        const popupMenu = document.createElement('div');
        popupMenu.style.fontSize = "17px";
        popupMenu.style.fontWeight = "bold";

        const menuText = document.createElement('a');
        menuText.style.cursor = 'pointer';
        menuText.style.color = 'rgb(0 17 255)';
        menuText.innerText = title;

        popupMenu.appendChild(menuText);

        const popupContent = document.createElement('div');
        popupContent.className = 'popup_content';
        popupContent.style.height = 'auto';
        popupContent.style.overflowY = 'auto';
        popupContent.style.display = 'flex';
        popupContent.style.padding = '0';
        popupContent.style.paddingTop = '10px';

        const table = document.createElement('table');
        table.className = 'vis';
        table.style.width = '100%';

        const tbody = document.createElement('tbody');
        const tr1 = document.createElement('tr');
        const td1 = document.createElement('td');
        const label = document.createElement('label');

        let countdown = timeoutDuration / 1000;
        label.innerText = message + ` It will continue in ${countdown} seconds.`;
        const interval = setInterval(() => {
            label.innerText = message + ` It will continue in ${countdown} seconds.`;
            countdown--;
            if (countdown < 0) {
                clearInterval(interval);
                label.innerText = "It will continue now!";
            }
        }, 1000);

        td1.appendChild(label);
        tr1.appendChild(td1);

        const tr2 = document.createElement('tr');
        const td2 = document.createElement('td');
        td2.colSpan = 2;

        const continueButton = document.createElement('input');
        continueButton.type = 'submit';
        continueButton.value = 'Continue';
        continueButton.className = 'btn';
        continueButton.style.background = '#6bb000';
        continueButton.style.margin = '4px';
        continueButton.addEventListener('click', () => {
            clearTimeout(timeoutId);  // Clear the timeout
            resolve('continue');  // Resolve the promise with 'continue'
            togglePopup(popupDiv);  // Hide the popup
        });

        const cancelButton = document.createElement('input');
        cancelButton.type = 'button';
        cancelButton.value = 'Cancel';
        cancelButton.className = 'btn';
        cancelButton.style.background = '#d02c2c';
        cancelButton.style.margin = '4px';
        cancelButton.addEventListener('click', () => {
            clearTimeout(timeoutId);  // Clear the timeout
            resolve('cancel');  // Resolve the promise with 'cancel'
            togglePopup(popupDiv);  // Hide the popup
        });

        td2.appendChild(continueButton);
        td2.appendChild(cancelButton);
        tr2.appendChild(td2);

        tbody.appendChild(tr1);
        tbody.appendChild(tr2);
        table.appendChild(tbody);

        popupContent.appendChild(table);

        popupDiv.appendChild(popupMenu);
        popupDiv.appendChild(popupContent);

        document.body.appendChild(popupDiv);

        // Set a timeout for user choice
        const timeoutId = setTimeout(() => {
            resolve('timeout');  // Resolve the promise with 'timeout' after timeout
            togglePopup(popupDiv);  // Hide the popup after timeout
        }, timeoutDuration + 1000);
    });
}

function saveColumnOrder() {
    var childDivs = Array.from(document.getElementById('script_column').children);
    var childDivIds = childDivs.map(function (div) {
        return div.id.replace('show_', '');
    });

    childDivIds.forEach(function (id, index) {
        var widget = settings_cookies.widgets.find(function (widget) {
            return widget.name === id;
        });
        if (widget) {
            widget.pos = index;
        }
    });

    var parentIds = [RIGHT_COLUMN, LEFT_COLUMN, CENTER_COLUMN];
    parentIds.forEach(function (parentId) {
        var parentElement = document.getElementById(parentId);
        if (parentElement) {
            var children = parentElement.children;
            for (var i = 0; i < children.length; i++) {
                var childId = children[i].id.replace("show_", "");
                var widgetIndex = settings_cookies.widgets.findIndex(function (widget) {
                    return widget.name === childId;
                });
                if (widgetIndex !== -1) {
                    settings_cookies.widgets[widgetIndex].column = parentId;
                    settings_cookies.widgets[widgetIndex].pos = i;
                }
            }
        }
    });

    localStorage.setItem('settings_cookies', JSON.stringify(settings_cookies));
}

function injectScriptColumn() {
    var overviewtableElement = document.getElementById('overviewtable');
    if (overviewtableElement) {
        var trElement = overviewtableElement.getElementsByTagName('tr')[0];
        var scriptColumn = document.createElement('td');
        scriptColumn.setAttribute('valign', 'top');
        scriptColumn.setAttribute('id', 'script_column');
        scriptColumn.style.width = document.getElementById('rightcolumn').offsetWidth + 'px';
        trElement.insertBefore(scriptColumn, trElement.firstChild);
    }
}

// allows to show/hide tooltip element from TW
// reads info from data-title and data-tooltip-tpl
function toggleTooltip(element, isVisible) {
    var rect = element.getBoundingClientRect();
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    var scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    var elementPosition = {
        top: rect.top + scrollTop,
        left: rect.left + scrollLeft
    };

    var tooltip = document.getElementById('tooltip');
    tooltip.querySelector('.body').style.display = 'none';

    var body = tooltip.getElementsByClassName('body')[0];
    var h3 = tooltip.getElementsByTagName('h3')[0];

    if (isVisible) {
        tooltip.style.display = 'block';
        tooltip.style.top = (Math.ceil(elementPosition.top) + 22) + 'px';
        tooltip.style.left = (Math.ceil(elementPosition.left) + 25) + 'px';
        tooltip.classList.add('tooltip-style');

        const data_title = element.parentNode.getAttribute('data-title') ?? element.getAttribute('data-title');
        const data_tooltip = element.parentNode.getAttribute('data-tooltip-tpl') ?? element.getAttribute('data-tooltip-tpl');

        if (data_title && data_tooltip) {
            h3.innerHTML = data_title;
            h3.style.display = 'block'
            body.innerHTML = data_tooltip;
            body.style.display = 'block'
        } else if (data_title) {
            h3.innerHTML = data_title;
            h3.style.display = 'block'
            body.innerHTML = '';
        } else if (data_tooltip) {
            body.innerHTML = data_tooltip;
            body.style.display = 'block'
            h3.innerHTML = '';
        }
    } else {
        h3.innerHTML = '';
        body.innerHTML = '';
        tooltip.style.display = 'none';
        tooltip.classList.remove('tooltip-style');
    }
}

function toggleTooltipNoText(element, isVisible) {
    var rect = element.getBoundingClientRect();
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    var scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    var elementPosition = {
        top: rect.top + scrollTop,
        left: rect.left + scrollLeft
    };

    var tooltip = document.getElementById('tooltip');
    if (isVisible) {
        tooltip.style.display = 'block';
        tooltip.style.top = (Math.ceil(elementPosition.top) + 22) + 'px';
        tooltip.style.left = (Math.ceil(elementPosition.left) + 25) + 'px';
        tooltip.classList.add('tooltip-style');
    } else {
        tooltip.style.display = 'none';
        tooltip.classList.remove('tooltip-style');
    }
}

function extractBuildTimeFromHTML(stringHTML) {
    const lang = JSON.parse(localStorage.getItem('tw_lang'));
    const stringToday = lang['aea2b0aa9ae1534226518faaefffdaad'];
    const stringTomorrow = lang['57d28d1b211fddbb7a499ead5bf23079'];
    let time;

    if (stringToday && stringTomorrow) {
        const modelosStrings = [stringToday, stringTomorrow];
        let day, hora, minuto, segundo;

        for (const [index, modeloString] of modelosStrings.entries()) {
            // Ajusta a regex para capturar também os segundos (se existirem)
            const regexString = modeloString
                .replace(/\\/g, "\\\\")
                .replace(/%s/, "(\\d{1,2}):(\\d{2})(?::(\\d{2}))?"); // Segundos opcionais

            const regex = new RegExp(regexString);
            const match = stringHTML.match(regex);
            if (match) {
                day = index.toString();
                hora = match[1].toString();
                minuto = match[2].toString();
                segundo = match[3] ? match[3].toString() : "00"; // Se não houver segundos, assume "00"
            }
        }

        if (day && hora && minuto && segundo) {
            time = [day, hora, minuto, segundo];
            return time;
        }
    }

    showAutoHideBox('Error extractBuildTimeFromHTML: ');
    return time;
}

function extractBuildTimestampFromHTML(stringHTML) {
    const lang = JSON.parse(localStorage.getItem('tw_lang'));
    const stringToday = lang['aea2b0aa9ae1534226518faaefffdaad'];
    const stringTomorrow = lang['57d28d1b211fddbb7a499ead5bf23079'];

    if (stringToday && stringTomorrow) {
        const modelosStrings = [stringToday, stringTomorrow];
        let day, hora, minuto, segundo;

        for (const [index, modeloString] of modelosStrings.entries()) {
            const regexString = modeloString
                .replace(/\\/g, "\\\\")
                .replace(/%s/, "(\\d{1,2}):(\\d{2})(?::(\\d{2}))?");

            const regex = new RegExp(regexString);
            const match = stringHTML.match(regex);

            if (match) {
                day = index; // 0 = hoje, 1 = amanhã
                hora = parseInt(match[1]);
                minuto = parseInt(match[2]);
                segundo = match[3] ? parseInt(match[3]) : 0; // Se não houver segundos, assume 0
                break;
            }
        }

        if (day !== undefined && hora !== undefined && minuto !== undefined) {
            const now = new Date();
            now.setHours(hora, minuto, segundo, 0);

            if (day === 1) { // Se for amanhã, adicionar 1 dia
                now.setDate(now.getDate() + 1);
            }

            return now.getTime(); // Retorna o timestamp corrigido
        }
    } else {
        alert('Erro no extractBuildTimestampFromHTML');
        return null;
    }
}

function endTimeToTimer(endtime) {
    var now = Math.floor(Timing.getCurrentServerTime() / 1000);
    var remaining = endtime - now;
    if (remaining <= 0) {
        return null;
    } else {
        var hours = Math.floor(remaining / 3600);
        var minutes = Math.floor((remaining % 3600) / 60);
        var seconds = remaining % 60;
        return [hours.toString().padStart(2, '0'), minutes.toString().padStart(2, '0'), seconds.toString().padStart(2, '0')];
    }
}

function timeToMilliseconds(timeString) {
    var parts = timeString.split(':');

    var hours = parseInt(parts[0], 10) * 60 * 60 * 1000;
    var minutes = parseInt(parts[1], 10) * 60 * 1000;
    var seconds = parseInt(parts[2], 10) * 1000;

    return hours + minutes + seconds;
}

function formatMinutesToTime(minutes) {
    const totalSeconds = Math.round(minutes * 60);

    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function wait(seconds) {
    return new Promise(resolve => {
        setTimeout(resolve, seconds * 1000);
    });
}

var activeTimeouts = {};
function setFunctionOnTimeOut(id, func, timeToRun) {
    if (activeTimeouts[id]) {
        clearTimeout(activeTimeouts[id]);
    }

    // Adiciona até 3 minutos (180000 ms) de aleatoriedade
    let randomExtraTime = Math.random() * 180000;
    let finalTimeToRun = Math.floor(timeToRun + randomExtraTime);

    let endTime = Math.floor(Date.now() + finalTimeToRun);
    localStorage.setItem('endTime_' + id, endTime);
    localStorage.setItem('function_' + id, func.toString());

    activeTimeouts[id] = setTimeout(() => {
        localStorage.removeItem('endTime_' + id);
        localStorage.removeItem('function_' + id);
        func();
        delete activeTimeouts[id];
    }, finalTimeToRun);
}

function restoreTimeouts() {
    //general timeouts
    for (var key in localStorage) {
        if (key.startsWith('endTime_')) {
            var id = key.replace('endTime_', '');

            var endTime = localStorage.getItem(key);
            var remainingTime = parseInt(endTime) - Date.now();

            if (remainingTime > 0) {
                setTimeout(() => {
                    eval('(' + localStorage.getItem('function_' + id) + ')();');
                }, remainingTime);
            } else {
                eval('(' + localStorage.getItem('function_' + id) + ')();');
                localStorage.removeItem('endTime_' + id);
                localStorage.removeItem('function_' + id);
                if (activeTimeouts[id]) {
                    clearTimeout(activeTimeouts[id]);
                }
            }
        }
    }
}

function checkInactivity(minutes) {
    if (TribalWars.getIdleTime() >= minutes * 60 * 1000) {
        showAutoHideBox('Inactivity detected! Reloading page...');
        wait(5);
        location.reload();
    }
}

//Keep quests tabs open
var questButton = document.getElementById('new_quest');
if (questButton) {
    // Guarda a referência da função original
    var originalOnClick = questButton.onclick;

    // Define um novo onclick que chama o original e depois executa o custom
    questButton.onclick = function (event) {
        // Chama a função original (se existir)
        if (originalOnClick) {
            originalOnClick.call(this, event);
        }

        let checkExist = setInterval(function () {
            let questlineLists = document.querySelectorAll('.questline-list');

            if (questlineLists.length > 0) {
                clearInterval(checkExist); // Para o intervalo quando encontrar

                questlineLists.forEach(questlineList => {
                    let listItems = questlineList.querySelectorAll('li');

                    listItems.forEach(li => {
                        let ul = li.closest('ul'); // Encontra o <ul> mais próximo
                        if (ul) {
                            ul.classList.add('opened'); // Adiciona a classe "opened"
                        }
                    });
                });
            }
        }, 500); // Verifica a cada 500ms
    };
}

function startResourceTimerFull(endtime, element) {
    var remaining = endTimeToTimer(endtime);
    if (!remaining) {
        element.textContent = 'END';
        clearInterval(element.dataset.interval);
    } else {
        element.textContent = `${remaining[0]}:${remaining[1]}:${remaining[2]}`;
    }
    element.style.display = "block";
    //element.classList.toggle('not-hidden');
}

function startTimerOnLabel(endtime, element) {
    var now = Math.floor(Timing.getCurrentServerTime() / 1000);
    var remaining = endtime - now;

    if (remaining <= 0) {
        element.textContent = '';
        clearInterval(element.dataset.interval);
    } else {
        var hours = Math.floor(remaining / 3600).toString().padStart(2, '0');
        var minutes = Math.floor((remaining % 3600) / 60).toString().padStart(2, '0');
        var seconds = (remaining % 60).toString().padStart(2, '0');

        var formattedTime = `${hours}:${minutes}:${seconds}`;

        element.textContent = element.textContent.replace(/\d{2}:\d{2}:\d{2}/, formattedTime);
    }
    element.style.display = "block";
}

function getRemainingHours(endtime) {
    var now = Math.floor(Timing.getCurrentServerTime() / 1000);
    var remaining = endtime - now;
    return Math.floor(remaining / 3600);
}

function showAutoHideBox(text, isError = true) {
    let divAutoHideBox = document.querySelector('.autoHideBox');

    if (!divAutoHideBox) {
        divAutoHideBox = document.createElement('div');
        divAutoHideBox.classList.add('autoHideBox', isError ? 'error' : 'success');

        const tooltip = document.getElementById('tooltip');
        if (tooltip) tooltip.parentNode.insertBefore(divAutoHideBox, tooltip.nextSibling);
    }

    const p = document.createElement('p');
    p.textContent = text;
    divAutoHideBox
    divAutoHideBox.appendChild(p);
    divAutoHideBox.classList.toggle(divAutoHideBox.classList.contains('error') ? 'error' : 'success');
    divAutoHideBox.classList.add(isError ? 'error' : 'success');
    clearTimeout(divAutoHideBox.dataset.timeout);
    divAutoHideBox.dataset.timeout = setTimeout(() => divAutoHideBox.remove(), 3000);
}

function injectAttackCalculations() {
    console.log(parseInt(document.querySelector('#command-data-form .village-distance').textContent.match(/(\d+)/), 10));
}

function convertBBCodeToHTML(text) {
    const bbcodeMap = {
        '\\[b\\](.*?)\\[/b\\]': '<strong>$1</strong>',   // [b]negrito[/b] -> <strong>negrito</strong>
        '\\[i\\](.*?)\\[/i\\]': '<em>$1</em>',         // [i]itálico[/i] -> <em>itálico</em>
        '\\[u\\](.*?)\\[/u\\]': '<u>$1</u>',           // [u]sublinhado[/u] -> <u>sublinhado</u>
        '\\[s\\](.*?)\\[/s\\]': '<del>$1</del>',       // [s]riscado[/s] -> <del>riscado</del>
        '\\[url\\](.*?)\\[/url\\]': '<a href="$1" target="_blank">$1</a>' // [url]link[/url] -> <a>
    };

    if (text) {
        for (const bbcode in bbcodeMap) {
            const regex = new RegExp(bbcode, 'gi');
            text = text.replace(regex, bbcodeMap[bbcode]);
        }

        // Tratamento especial para [url=link]Texto[/url]
        text = text.replace(/\[url=(.*?)\](.*?)\[\/url\]/gi, function (match, link, text) {
            if (!link.startsWith("http://") && !link.startsWith("https://")) {
                link = "https://" + link;
            }
            return `<a href="${link}" target="_blank">${text}</a>`;
        });
    }

    return text;
}

async function updateMapInfoVillages(force = false) {
    const STORAGE_KEY = 'map_villages';
    const TIMESTAMP_KEY = 'map_villages_last_update';
    const ONE_HOUR = 60 * 60 * 1000; // 1 hour in milliseconds

    const lastUpdate = localStorage.getItem(TIMESTAMP_KEY);
    const now = Date.now();

    // Check if we already have data and if it's still "fresh" (less than 1 hour old)
    if (!force && (lastUpdate && (now - lastUpdate < ONE_HOUR) && localStorage.getItem(STORAGE_KEY))) {
        console.log("Map villages data is up to date (less than 1h old).");
        return;
    }

    console.log("Updating map villages data...");

    try {
        const response = await fetch(window.location.origin + "/map/village.txt");

        if (!response.ok) throw new Error('Network response was not ok');

        const data = await response.text();

        // Save to localStorage
        localStorage.setItem(STORAGE_KEY, data);
        localStorage.setItem(TIMESTAMP_KEY, now.toString());

        console.log("Map villages updated and saved to localStorage.");
    } catch (error) {
        console.error("Failed to fetch village data:", error);
    }
}

function calculateDistanceToTarget(targetCoords) {
    // 1. Get current village coordinates from game_data
    const currentCoords = game_data.village.coord; // Format: "454|369"

    // 2. Split both strings into X and Y arrays
    const [x1, y1] = currentCoords.split('|').map(Number);
    const [x2, y2] = targetCoords.split('|').map(Number);

    // 3. Apply the Pythagorean theorem: sqrt((x2-x1)^2 + (y2-y1)^2)
    const deltaX = x2 - x1;
    const deltaY = y2 - y1;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // 4. Return formatted to 2 decimal places (standard for TW)
    return parseFloat(distance.toFixed(2));
}

// Get unit info from server and store unit speeds and carry capacity
function storeUnitsInfo() {
    const hasSpeeds = localStorage.getItem('units_speed');
    const hasCarry = localStorage.getItem('units_carry');

    if (hasSpeeds && hasSpeeds !== '{}' && hasCarry && hasCarry !== '{}') {
        return; // already stored, skip fetch
    }

    fetch('/interface.php?func=get_unit_info')
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
 * Launches an attack automatically.
 * Explaining the two-step AJAX process used by TribalWars to prevent botting.
 * * @param {Object} units - Object containing unit counts { spear: 10, ... }
 * @param {string|number} targetId - Internal database ID of the target village
 */
async function launchAttack(units, targetId) {
    try {
        const GD = typeof unsafeWindow !== 'undefined' ? unsafeWindow.game_data : window.game_data;
        if (!GD || !GD.csrf) throw new Error("Game data not found.");

        const csrfToken = GD.csrf;
        const currentVillage = GD.village.id;
        const baseUrl = `https://${window.location.host}/game.php?village=${currentVillage}&screen=place`;

        /**
         * AJAX CALL #1: THE PREPARATION PHASE (ajax=confirm)
         * * PURPOSE: This call asks the server to validate the attack. 
         * The server checks if you have enough troops and if the target is valid.
         * * WHY IT'S NECESSARY: The server does not launch the attack yet. 
         * Instead, it returns a JSON object containing the "Confirmation Dialog" HTML.
         * This HTML contains the unique security tokens (ch and honeypot) required for Step 2.
         */
        console.log("Step 1: Requesting confirmation dialog...");

        let coordX = "", coordY = "";
        const rawFocus = unsafeWindow.TWMap.context._curFocus;
        if (rawFocus) {
            const focusStr = rawFocus.toString();
            coordX = focusStr.substring(0, 3);
            coordY = focusStr.substring(3, 6);
        }

        const step1Data = new URLSearchParams();
        step1Data.append("target", targetId);
        step1Data.append("x", coordX);
        step1Data.append("y", coordY);
        step1Data.append("attack", "1"); // In PT servers, the button internal value is "Atacar" (try for now with 1)
        step1Data.append("h", csrfToken);

        for (const [unit, amount] of Object.entries(units)) {
            step1Data.append(unit, amount);
        }

        const responseStep1 = await fetch(`${baseUrl}&ajax=confirm`, {
            method: "POST",
            body: step1Data,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'TribalWars-Ajax': '1' // Tells the server to return JSON instead of a full page redirect
            }
        });

        const jsonResponse = await responseStep1.json();

        // Check for server-side logic errors (e.g., "Not enough units")
        if (jsonResponse.error) {
            const msg = Array.isArray(jsonResponse.error) ? jsonResponse.error[0] : jsonResponse.error;
            throw new Error(msg);
        }

        // The dialog HTML is stored in response.dialog
        const htmlText = jsonResponse.response.dialog;
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, "text/html");

        /**
         * TOKEN EXTRACTION (The "Secret Sauce")
         * * 'ch': Confirmation Hash. A one-time code generated by the server for this specific attack.
         * 'dynamicInput': A hidden field with a randomized name (e.g. "8219ab..."). 
         * This is a "honeypot" protection; if you don't send this exact name/value pair in Step 2, 
         * the server knows you are a bot and returns "Invalid Command".
         */
        const chInput = doc.querySelector('input[name="ch"]');
        const dynamicInput = doc.querySelector('input[type="hidden"]:not([name="ch"]):not([name="template_id"]):not([name="source_village"])');

        if (!chInput || !dynamicInput) {
            throw new Error("Security tokens (ch/honeypot) were not found in the response.");
        }

        /**
         * AJAX CALL #2: THE EXECUTION PHASE (action=command)
         * * PURPOSE: This is the actual "Confirm" click. It sends the troops out.
         * * WHY IT'S NECESSARY: You must prove to the server that you performed Step 1 
         * by providing the 'ch' hash and the dynamic honeypot token.
         */
        console.log(`Step 2: Executing attack with hash: ${chInput.value}`);

        const step2Data = new URLSearchParams();
        step2Data.append(dynamicInput.name, dynamicInput.value); // Sending the dynamic honeypot
        step2Data.append("ch", chInput.value);                  // Sending the confirmation hash
        step2Data.append("x", coordX);
        step2Data.append("y", coordY);
        step2Data.append("action", "command");                  // The action that actually triggers the movement
        step2Data.append("h", csrfToken);

        for (const [unit, amount] of Object.entries(units)) {
            step2Data.append(unit, amount);
        }

        const responseStep2 = await fetch(`${baseUrl}&action=command&h=${csrfToken}`, {
            method: "POST",
            body: step2Data,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (responseStep2.ok) {
            const successMsg = `Attack successfully sent to ${coordX}|${coordY}!`;
            showAutoHideBox(successMsg, false);
            console.log("%c " + successMsg, "color: green; font-weight: bold;");
        } else {
            throw new Error("The server rejected the final command.");
        }

    } catch (error) {
        if (typeof showAutoHideBox === 'function') {
            showAutoHideBox(error.message, true);
        }
        console.error("Attack Failed:", error.message);
    }
}

function start() {
    var urlPage = document.location.href;
    //check for expired session, automatically select last active world
    if (!urlPage.includes('?session_expired') && typeof game_data != 'undefined') {
        prepareVillageList();
        villageList = localStorage.getItem('villages_info') ? JSON.parse(localStorage.getItem('villages_info')) : [];
        settings_cookies = localStorage.getItem('settings_cookies') ? JSON.parse(localStorage.getItem('settings_cookies')) : settings_cookies;
        listenTextAreas();
        setCookieCurrentVillage();
        addRessourcesHover(localStorage.getItem('full_storage_times') ? JSON.parse(localStorage.getItem('full_storage_times')) : null);
        if (urlPage.includes("screen=overview") && !urlPage.includes("screen=overview_villages")) {
            injectScriptColumn();
            updatePremiumInfoOverview();

            settings_cookies.widgets.forEach(function (widget) {
                var functionName = widgetsInjectFunctions[widget.name];
                if (functionName) {
                    functionName(widget.column);
                }
            });
        } else if (urlPage.split("&")[2] === "mode=scavenge") {
            $(document).ready(function () {
                injectAutoScavengingOption();
            });
        } else if (urlPage.includes("screen=statue")) {
            $(document).ready(function () {
                injectScriptAutoTrainerPaladin();
            });
        } else if (urlPage.includes("&screen=place&target")) {
            $(document).ready(function () {
                injectAttackCalculations();
            });
        }
        insertNavigationArrows();
        insertListVillagesPopup();
        injectNavigationBar();
        defineKeyboardShortcuts();
        injectScriptSettingsPopUp();

        if (settings_cookies.general['keep_awake']) {
            var maxInactiveMin = Math.floor(Math.random() * (10 - 5 + 1)) + 5;
            setInterval(() => checkInactivity(maxInactiveMin), 30000);
        }

        const table = $("#overviewtable");

        if (table.length && table.data("ui-sortable")) {
            const originalSortableUpdate = table.sortable("option", "update");
            table.sortable("option", "update", function () {
                saveColumnOrder(this);
                if (
                    typeof originalSortableUpdate === "function" &&
                    !arguments[1].item[0].classList.contains('script_widget')
                ) {
                    $(this).find('.script_widget').detach();
                    originalSortableUpdate.apply(this, arguments);

                    settings_cookies.widgets.forEach(function (widget) {
                        const functionName = widgetsInjectFunctions[widget.name];
                        if (functionName) {
                            functionName(widget.column);
                        }
                    });
                }
            });
        }

        updateMapInfoVillages();
        storeUnitsInfo();

    } else {
        // get from TM storage
        let lastWorld = GM_getValue("current_world");
        const targetLink = document.querySelector('.world-select[href*="' + lastWorld + '"]');

        if (targetLink) {
            window.location.href = targetLink.href;
        } else {
            console.warn("No last world was found.");
        }
    }
}

//redirect barracks and stable to train screen
if (settings_cookies.general['redirect__train_buildings']) {
    document.addEventListener("click", (event) => {
        const link = event.target.closest("a[href], area[href]");

        if (link) {
            const url = new URL(link.href);
            const screenParam = url.searchParams.get("screen");

            if (screenParam === "barracks" || screenParam === "stable") {
                event.preventDefault();
                url.searchParams.set("screen", "train");
                window.location.href = url.href;
            }
        }
    });
}


/*<----------- Not fully implementeded functions ------------>*/
function autoDailyBonusCollect() {
    //falta conseguir o dia facilmente... posso fazer um fetch para criar a primeira vez e depois conta dai...
    //so tenho de saber o que acontece quando nao recolhe um dia
    if (game_data) {
        fetch(game_data.link_base_pure + "daily_bonus&ajaxaction=open", {
            "headers": {
                "tribalwars-ajax": "1",
                "x-requested-with": "XMLHttpRequest"
            },
            "referrer": game_data.link_base_pure + "info_player&mode=daily_bonus",
            "body": "day=8&from_screen=profile&h=" + game_data.csrf,
            "method": "POST",
            "credentials": "include"
        });
    }
}

function sendScavengeAjax() {
    // falta conseguir as tropas a enviar... se tiver os numeros das settings sao esses
    // se nao tiver, tenho de os arranjar
    // falta ter o nivel a enviar
    if (game_data) {
        const squadRequest = {
            village_id: 14520,
            candidate_squad: {
                unit_counts: {
                    spear: 303,
                    sword: 150,
                    axe: 0,
                    archer: 0,
                    light: 32,
                    marcher: 0,
                    heavy: 0,
                    knight: 0
                },
                carry_max: 12385
            },
            option_id: 3, //NIVEL DISPONIVEL??? guardar na primeira vez que se entra na pagina do scavenger, e so mudar se voltar lá
            use_premium: false
        };

        const requestData = {
            squad_requests: [squadRequest],
            h: game_data.csrf
        };

        // Converte o objeto para um formato adequado para envio
        const body = new URLSearchParams();
        Object.entries(requestData).forEach(([key, value]) => {
            if (Array.isArray(value)) {
                value.forEach((item, index) => {
                    Object.entries(item).forEach(([subKey, subValue]) => {
                        if (typeof subValue === "object") {
                            Object.entries(subValue).forEach(([unitKey, unitValue]) => {
                                body.append(`squad_requests[${index}][${subKey}][unit_counts][${unitKey}]`, unitValue);
                            });
                        } else {
                            body.append(`squad_requests[${index}][${subKey}]`, subValue);
                        }
                    });
                });
            } else {
                body.append(key, value);
            }
        });

        fetch(game_data.link_base_pure + "scavenge_api&ajaxaction=send_squads", {
            headers: {
                "tribalwars-ajax": "1",
                "x-requested-with": "XMLHttpRequest"
            },
            referrer: game_data.link_base_pure + "place&mode=scavenge",
            body: body.toString(),
            method: "POST",
            credentials: "include"
        });
    }
}
