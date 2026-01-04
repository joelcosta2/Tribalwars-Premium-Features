// Village Arrows, Navigation Bar
function getVillageLinkCurrentScreen(goToUrl) {
    var str = document.location.href,
        temp = str.indexOf("="),
        temp2 = str.indexOf("&", temp),
        urlFirst = str.slice(0, temp + 1),
        urlLast = str.slice(temp2);

    temp = goToUrl.indexOf("=");
    temp2 = goToUrl.indexOf("&", temp);
    var villagenumber = goToUrl.slice(temp + 1, temp2);
    var FINALURL = urlFirst + villagenumber + urlLast;

    return FINALURL;
}

function nextVillage() {
    var goToUrl,
        villages = JSON.parse(localStorage.getItem('villages_info') || '[]');
    if (villages) {
        if (villages[currentVillageIndex + 1]) {
            goToUrl = villages[currentVillageIndex + 1].url;
        } else {
            goToUrl = villages[0].url;
        }
    }
    document.location.href = getVillageLinkCurrentScreen(goToUrl);
}

function previousVillage() {
    var goToUrl,
        villages = JSON.parse(localStorage.getItem('villages_info') || '[]');
    if (villages) {
        if (villages[currentVillageIndex - 1]) {
            goToUrl = villages[currentVillageIndex - 1].url;
        } else {
            goToUrl = villages[sizeOfObject(villages) - 1].url;
        }
    }
    document.location.href = getVillageLinkCurrentScreen(goToUrl);
}

function insertNavigationArrows() {
    if (settings_cookies.general['show__navigation_arrows']) {
        var menu_row1_container = document.getElementById('menu_row2');
        var htmlToInject = '<td class="box-item icon-box separate arrowCell"><a id="village_switch_previous" class="village_switch_link" accesskey="a"><span class="arrowLeft" style="cursor:pointer;"> </span></a></td><td class="box-item icon-box arrowCell"><a id="village_switch_next" class="village_switch_link" accesskey="d"><span class="arrowRight" style="cursor:pointer;"> </span></a></td>';

        if (menu_row1_container) menu_row1_container.innerHTML = htmlToInject + menu_row1_container?.innerHTML;

        var leftArrowContainer = document.getElementById('village_switch_previous');
        if (leftArrowContainer) leftArrowContainer.onclick = function () { previousVillage() };

        var rightArrowContainer = document.getElementById('village_switch_next');
        if (rightArrowContainer) rightArrowContainer.onclick = function () { nextVillage() };
    }
}

function insertListVillagesPopup() {
    if (settings_cookies.general['show__navigation_arrows']) {
        var menuRow2 = document.getElementById("menu_row2");

        if (menuRow2) {
            var td = document.createElement("td");
            td.className = "box-item";
            td.style.paddingRight = "3px";

            var img = document.createElement("img");
            img.src = "https://dspt.innogamescdn.com/asset/95eda994/graphic//icons/slide_down.png";
            img.alt = "Open Village List";
            img.style.cursor = "pointer";
            img.style.width = "18px";
            img.style.height = "18px";
            img.style.maxWidth = "18px";
            img.style.maxHeight = "18px";
            img.style.float = "right";

            // Adicionar evento de clique para abrir o popup
            img.addEventListener("click", function () {
                openVillageListPopup();
            });

            td.appendChild(img);
            menuRow2.appendChild(td);
        }
    }
}

function openVillageListPopup() {
    const lang = JSON.parse(localStorage.getItem('tw_lang'));

    // Remover o popup se já existir
    var existingPopup = document.getElementById("group_popup");
    if (existingPopup) {
        existingPopup.remove();
        return;
    }

    // Criar o container principal
    var popupHelper = document.createElement("div");
    popupHelper.className = "popup_helper";

    var popup = document.createElement("div");
    popup.id = "group_popup";
    popup.className = "popup_style";
    popup.style.width = "320px";
    popup.style.position = "fixed";
    popup.style.top = "165.75px";
    popup.style.left = "493.648px";
    popup.style.display = "block";
    popup.style.zIndex = "1000"; // Para garantir que fique acima de outros elementos

    // Criar o cabeçalho do popup
    var popupMenu = document.createElement("div");
    popupMenu.id = "group_popup_menu";
    popupMenu.className = "popup_menu";
    popupMenu.innerHTML = lang['49f8eff5b37c62212f0b7870b07af7bb'];

    var closeLink = document.createElement("a");
    closeLink.id = "closelink_group_popup";
    closeLink.href = "#";
    closeLink.innerText = "X";
    closeLink.style.float = "right";
    closeLink.style.cursor = "pointer";

    // Evento para fechar o popup
    closeLink.addEventListener("click", function (e) {
        e.preventDefault();
        popup.remove();
    });

    popupMenu.appendChild(closeLink);
    popup.appendChild(popupMenu);

    // Criar o conteúdo do popup
    var popupContent = document.createElement("div");
    popupContent.id = "group_popup_content";
    popupContent.className = "popup_content";
    popupContent.style.height = "380px";
    popupContent.style.overflowY = "auto";

    /*// Criar o formulário
    var form = document.createElement("form");
    form.id = "select_group_box";
    form.action = "/game.php?village=15844&screen=groups&ajax=load_villages_from_group&mode=overview";
    form.method = "POST";

    var hiddenInput = document.createElement("input");
    hiddenInput.type = "hidden";
    hiddenInput.name = "mode";
    hiddenInput.value = "overview";

    form.appendChild(hiddenInput);

    var label = document.createElement("p");
    label.style.margin = "0 0 10px 0";
    label.style.fontWeight = "bold";
    label.innerHTML = 'Grupos:';

    var select = document.createElement("select");
    select.id = "group_id";
    select.name = "group_id";
    select.style.marginLeft = "3px";

    var options = [
        { value: "16606", text: "Ofensiva completa" },
        { value: "16607", text: "Ataque a chegar" },
        { value: "16608", text: "Contém nobre" },
        { value: "0", text: "todos", selected: true }
    ];

    options.forEach(optionData => {
        var option = document.createElement("option");
        option.value = optionData.value;
        option.textContent = optionData.text;
        if (optionData.selected) option.selected = true;
        select.appendChild(option);
    });

    label.appendChild(select);
    form.appendChild(label);
    popupContent.appendChild(form);*/

    // Criar tabela de aldeias
    var tableContainer = document.createElement("div");
    tableContainer.id = "group_list_content";
    tableContainer.style.overflow = "auto";
    tableContainer.style.height = "340px";

    var table = document.createElement("table");
    table.id = "group_table";
    table.className = "vis";
    table.width = "100%";
    table.cellPadding = "5";
    table.cellSpacing = "0";

    var tbody = document.createElement("tbody");

    var headerRow = document.createElement("tr");
    var headerTh = document.createElement("th");
    headerTh.className = "group_label";
    headerTh.colSpan = "2";
    headerTh.textContent =  lang['abc63490c815af81276f930216c8d92b'] ?? "Village";

    headerRow.appendChild(headerTh);
    tbody.appendChild(headerRow);
    table.appendChild(tbody);
    tableContainer.appendChild(table);

    // Obter dados do localStorage
    var villagesInfo = JSON.parse(localStorage.getItem("villages_info")) || {};
    
    // Criar dinamicamente as linhas das aldeias
    Object.keys(villagesInfo).forEach(index => {
        var village = villagesInfo[index];

        var villageRow = document.createElement("tr");

        var villageTd1 = document.createElement("td");
        villageTd1.className = "selected";

        var villageLink = document.createElement("a");
        villageLink.href = getVillageLinkCurrentScreen(village.url);
        villageLink.className = "select-village";
        villageLink.textContent = village.name.trim();

        villageTd1.appendChild(villageLink);

        var villageTd2 = document.createElement("td");
        villageTd2.style.fontWeight = "bold";
        villageTd2.style.width = "100px";
        villageTd2.style.textAlign = "right";
        villageTd2.className = "selected";
        villageTd2.textContent = village.coords ? village.coords : "N/A"; // Aqui pode ser ajustado para exibir coordenadas se disponíveis

        villageRow.appendChild(villageTd1);
        villageRow.appendChild(villageTd2);
        tbody.appendChild(villageRow);
    });

    table.appendChild(tbody);
    tableContainer.appendChild(table);
    popupContent.appendChild(tableContainer);
    popup.appendChild(popupContent);
    popupHelper.appendChild(popup);

    document.body.appendChild(popupHelper);
}

function injectNavigationBar() {
    if (settings_cookies.general['show__navigation_bar']) {
        const tw_lang = JSON.parse(localStorage.getItem('tw_lang'));
        // Objeto com os links e imagens
        var urlsObject = {
            "Main": {
                img: "https://dspt.innogamescdn.com/asset/7fe7ab60/graphic/buildings/mid/main3.png",
                href: "/game.php?village=" + game_data.village.id + "&screen=main"
            },
            "Recruitment": {
                img: "https://dspt.innogamescdn.com/asset/243a567d/graphic/unit/att.png",
                href: "/game.php?village=" + game_data.village.id + "&screen=train"
            },
            "Smith": {
                img: "https://dspt.innogamescdn.com/asset/7fe7ab60/graphic/buildings/mid/smith2.png",
                href: "/game.php?village=" + game_data.village.id + "&screen=smith"
            },
            "Place": {
                img: "https://dspt.innogamescdn.com/asset/7fe7ab60/graphic/buildings/mid/place1.png",
                href: "/game.php?village=" + game_data.village.id + "&screen=place"
            },
            [String(tw_lang["52e136b31c4cc30c8f3d9eeb8dc56013"])]: {
                img: "https://dspt.innogamescdn.com/asset/7fe7ab60/graphic/scavenging/options/3.png",
                href: "/game.php?village=" + game_data.village.id + "&screen=place&mode=scavenge"
            },
            "Del Misc Reports": {
                img: "https://dspt.innogamescdn.com/asset/243a567d/graphic/delete.png",
                run: async function() {
                    try {
                        const response = await fetch(game_data.link_base_pure + "report&action=del_all&mode=other&h=" + game_data.csrf, {
                            "headers": {
                                "priority": "u=0, i",
                                "sec-ch-ua": "\"Not A(Brand\";v=\"8\", \"Chromium\";v=\"132\", \"Microsoft Edge\";v=\"132\"",
                                "sec-ch-ua-platform": "\"Windows\""
                            },
                            "referrer": game_data.link_base_pure + "report&mode=other",
                            "credentials": "include"
                        });
                
                        if (!response.ok) {
                            throw new Error(`Erro na requisição: ${response.status} ${response.statusText}`);
                        }
                
                        showAutoHideBox('Misc reports deleted', false);
                    } catch (error) {
                        showAutoHideBox('Error deleting misc reports', true);
                    }
                }
            },
            "Quests": {
                img: "https://dsen.innogamescdn.com/asset/243a567d/graphic/quests_new/quest_icon.png",
                run: function() {
                    Questlines.showDialog(0, 'main-tab');
                }
            }
        };

        // Seleciona o elemento com a classe 'maincell'
        const mainCell = document.querySelector('.maincell');

        // Criar tabela principal
        const tableOuter = document.createElement('table');
        tableOuter.id = 'quickbar_outer';
        tableOuter.align = 'center';
        tableOuter.width = '100%';
        tableOuter.cellSpacing = '0';

        // Criar tbody
        const tbodyOuter = document.createElement('tbody');
        const trOuter = document.createElement('tr');
        const tdOuter = document.createElement('td');

        // Criar tabela interna
        const tableInner = document.createElement('table');
        tableInner.id = 'quickbar_inner';
        tableInner.style.borderCollapse = 'collapse';
        tableInner.width = '100%';

        // Criar tbody interno
        const tbodyInner = document.createElement('tbody');

        // Criar a linha superior
        const trTopBorder = document.createElement('tr');
        trTopBorder.className = 'topborder';
        ['left', 'main', 'right'].forEach(cls => {
            const td = document.createElement('td');
            td.className = cls;
            trTopBorder.appendChild(td);
        });

        // Criar a linha de conteúdo
        const trContent = document.createElement('tr');
        const tdLeft = document.createElement('td');
        tdLeft.className = 'left';
        const tdMain = document.createElement('td');
        tdMain.id = 'quickbar_contents';
        tdMain.className = 'main';
        const tdRight = document.createElement('td');
        tdRight.className = 'right';
        tdRight.style.padding = '0 5px';

        // Criar o ícone de edição no lado direito
        const editIcon = document.createElement('img');
        editIcon.src = "https://pt106.tribalwars.com.pt/graphic/plus.png";
        editIcon.alt = "Edit";
        editIcon.style.cursor = "pointer";
        editIcon.style.width = "18px";
        editIcon.style.height = "18px";
        editIcon.style.maxWidth = "18px";
        editIcon.style.maxHeight = "18px";
        editIcon.style.float = "right"; // Mantém o ícone o mais à direita possível
        editIcon.title = "Edit Navigation Bar";
        editIcon.addEventListener("click", function () {
            alert("TBD - implement edit navigation items"); // Aqui podes substituir pelo código de edição real
        });

        // Adicionar o ícone na célula da direita
        tdRight.appendChild(editIcon);

        // Criar a lista UL
        const quickbarUL = document.createElement('ul');
        quickbarUL.className = 'menu quickbar';

        // Adicionar os itens dinamicamente
        let hotkeyIndex = 1;
        for (const [name, data] of Object.entries(urlsObject)) {
            const listItem = document.createElement('li');
            listItem.className = 'quickbar_item';
            listItem.setAttribute('data-hotkey', hotkeyIndex++);
        
            const span = document.createElement('span');
            const link = document.createElement('a');
            link.className = 'quickbar_link';
        
            if (data.href) {
                link.href = data.href;
            } else if (data.run) {
                link.href = "#"; // Adiciona um link "falso" para parecer clicável
                link.addEventListener("click", (e) => {
                    e.preventDefault(); // Evita navegação para "#"
                    data.run(); // Executa a função
                });
            }
        
            const img = document.createElement('img');
            img.className = 'quickbar_image';
            img.src = data.img;
            img.alt = '';
            img.style.width = "18px";
            img.style.height = "18px";
            img.style.maxWidth = "18px";
            img.style.maxHeight = "18px";
        
            link.appendChild(img);
            link.appendChild(document.createTextNode(name));
        
            span.appendChild(link);
            listItem.appendChild(span);
            quickbarUL.appendChild(listItem);
        }
        

        // Adicionar a UL na célula central
        tdMain.appendChild(quickbarUL);

        // Criar a linha inferior
        const trBottomBorder = document.createElement('tr');
        trBottomBorder.className = 'bottomborder';
        ['left', 'main', 'right'].forEach(cls => {
            const td = document.createElement('td');
            td.className = cls;
            trBottomBorder.appendChild(td);
        });

        // Criar sombra
        const trShadow = document.createElement('tr');
        const tdShadow = document.createElement('td');
        tdShadow.className = 'shadow';
        tdShadow.colSpan = '3';

        const divLeftShadow = document.createElement('div');
        divLeftShadow.className = 'leftshadow';
        const divRightShadow = document.createElement('div');
        divRightShadow.className = 'rightshadow';

        tdShadow.appendChild(divLeftShadow);
        tdShadow.appendChild(divRightShadow);
        trShadow.appendChild(tdShadow);

        // Montar estrutura da tabela interna
        trContent.appendChild(tdLeft);
        trContent.appendChild(tdMain);
        trContent.appendChild(tdRight);
        tbodyInner.appendChild(trTopBorder);
        tbodyInner.appendChild(trContent);
        tbodyInner.appendChild(trBottomBorder);
        tbodyInner.appendChild(trShadow);
        tableInner.appendChild(tbodyInner);

        // Montar estrutura da tabela externa
        tdOuter.appendChild(tableInner);
        trOuter.appendChild(tdOuter);
        tbodyOuter.appendChild(trOuter);
        tableOuter.appendChild(tbodyOuter);

        const newStyleOnlyElement = document.querySelector('.newStyleOnly');
        if (newStyleOnlyElement) {
            newStyleOnlyElement.insertAdjacentElement('afterend', tableOuter);
        }
    }
}

//delete premium promotion
if (settings_cookies.general['remove__premium_promo']) {
    const style = document.createElement("style"); 
    style.innerHTML = ".premium_account_hint { display: none !important; }"; 
    document.head.appendChild(style);
}