// Village Arrows, Navigation Bar

/**
 * Swaps the village ID from a target URL into the current page's URL.
 * This allows "staying" on the same screen (e.g., Stable) while switching villages.
 * @param {string} goToUrl - The URL containing the target village ID (usually from a link).
 * @returns {string} The formatted URL for the current screen with the new village ID.
 */
function getVillageLinkCurrentScreen(goToUrl) {
    try {
        const currentUrl = new URL(window.location.href);
        const targetUrl = new URL(goToUrl, window.location.origin);

        // Get the village ID ('village') from the target URL
        const newVillageId = targetUrl.searchParams.get('village');

        if (newVillageId) {
            // Update the 'village' parameter in the current URL
            currentUrl.searchParams.set('village', newVillageId);

            return currentUrl.toString();
        }

        // Fallback: If no ID found, return the original target
        return goToUrl;
    } catch (e) {
        console.error("Error parsing village URL:", e);
        return goToUrl;
    }
}

/**
 * Navigates to the next village in the list.
 * If at the end of the list, loops back to the first village.
 */
function nextVillage() {
    try {
        const villages = JSON.parse(localStorage.getItem('villages_info') || '[]');

        // 1. Guard clause: Ensure we have villages to navigate to
        if (!villages.length) {
            console.warn("[Navigation] No village information found in localStorage.");
            return;
        }

        // 2. Calculate next index (Loops back to 0 if at the end)
        // Using (index + 1) % length is a clean way to handle the "reset to 0" logic
        const nextIndex = (currentVillageIndex + 1) % villages.length;

        const targetVillage = villages[nextIndex];

        if (targetVillage?.url) {
            // 3. Update global index (optional, depends on your script's state management)
            window.currentVillageIndex = nextIndex;

            // 4. Redirect using the screen-preserving helper
            window.location.href = getVillageLinkCurrentScreen(targetVillage.url);
        }
    } catch (error) {
        console.error("[Navigation] Error during next village transition:", error);
    }
}

/**
 * Navigates to the previous village in the list.
 * If at the start, loops back to the last village.
 */
function previousVillage() {
    try {
        const villages = JSON.parse(localStorage.getItem('villages_info') || '[]');

        if (!villages.length) {
            console.warn("[Navigation] No village list found.");
            return;
        }

        // Calculate previous index with a positive modulo wrap-around
        // (index - 1 + length) % length ensures we never get a negative number
        const prevIndex = (currentVillageIndex - 1 + villages.length) % villages.length;

        const targetVillage = villages[prevIndex];

        if (targetVillage?.url) {
            window.currentVillageIndex = prevIndex;
            window.location.href = getVillageLinkCurrentScreen(targetVillage.url);
        }
    } catch (error) {
        console.error("[Navigation] Error navigating to previous village:", error);
    }
}

/**
 * Injects navigation arrows into the top menu bar.
 * Uses 'insertAdjacentHTML' to preserve existing menu event listeners.
 */
function insertNavigationArrows() {
    if (!settings_cookies.general?.['show__navigation_arrows']) return;

    const menuRow = document.getElementById('menu_row2');
    if (!menuRow) return;

    const htmlToInject = `
        <td class="box-item icon-box separate arrowCell">
            <a id="village_switch_previous" class="village_switch_link" accesskey="a">
                <span class="arrowLeft"></span>
            </a>
        </td>
        <td class="box-item icon-box arrowCell">
            <a id="village_switch_next" class="village_switch_link" accesskey="d">
                <span class="arrowRight"></span>
            </a>
        </td>`;

    // Inject at the beginning of the row without refreshing the whole innerHTML
    menuRow.insertAdjacentHTML('afterbegin', htmlToInject);

    // Attach events
    const prevBtn = document.getElementById('village_switch_previous');
    const nextBtn = document.getElementById('village_switch_next');

    if (prevBtn) prevBtn.onclick = (e) => { e.preventDefault(); previousVillage(); };
    if (nextBtn) nextBtn.onclick = (e) => { e.preventDefault(); nextVillage(); };
}

/**
 * Injects a small dropdown icon into the menu bar to open the village list popup.
 */
function insertListVillagesPopup() {
    if (!settings_cookies.general?.['show__navigation_arrows']) return;

    const menuRow2 = document.getElementById("menu_row2");
    if (!menuRow2) return;

    // Create container cell
    const td = document.createElement("td");
    td.className = "box-item box-item-village-list";

    // Create the toggle icon
    const img = Object.assign(document.createElement("img"), {
        src: "https://dspt.innogamescdn.com/asset/95eda994/graphic//icons/slide_down.png",
        alt: "Open Village List",
        className: "village-list-toggle"
    });

    // Event listener
    img.onclick = (e) => {
        e.stopPropagation();
        if (typeof openVillageListPopup === 'function') {
            openVillageListPopup();
        }
    };

    td.appendChild(img);
    menuRow2.appendChild(td);
}

/**
 * Opens a popup containing a list of all villages for quick navigation.
 */
function openVillageListPopup() {
    const lang = JSON.parse(localStorage.getItem('tw_lang') || '{}');

    // 1. Toggle: If it exists, remove it and stop
    const existing = document.getElementById("group_popup");
    if (existing) {
        existing.closest('.popup_helper_village_list')?.remove();
        return;
    }

    // 2. Create Elements
    const popupHelper = document.createElement("div");
    popupHelper.className = "popup_helper_village_list";

    const popup = Object.assign(document.createElement("div"), {
        id: "group_popup",
        className: "popup_style"
    });

    // 3. Header & Close Logic
    const popupMenu = Object.assign(document.createElement("div"), {
        id: "group_popup_menu",
        className: "popup_menu",
        innerHTML: lang['49f8eff5b37c62212f0b7870b07af7bb'] || "Villages"
    });

    const closeBtn = Object.assign(document.createElement("a"), {
        id: "closelink_group_popup",
        href: "#",
        innerText: "X"
    });

    const closePopup = (e) => {
        if (e) e.preventDefault();
        popupHelper.remove();
    };

    // Close on 'X' click
    closeBtn.onclick = closePopup;

    // Close when clicking the background overlay (outside the popup)
    popupHelper.onclick = (e) => {
        if (e.target === popupHelper) closePopup();
    };

    popupMenu.appendChild(closeBtn);

    // 4. Content and Table
    const popupContent = Object.assign(document.createElement("div"), {
        id: "group_popup_content",
        className: "popup_content"
    });

    const table = Object.assign(document.createElement("table"), {
        id: "group_table",
        className: "vis",
        width: "100%"
    });

    const tbody = document.createElement("tbody");

    // Table Header
    const headerRow = tbody.insertRow();
    const headerTh = document.createElement("th");
    headerTh.colSpan = 2;
    headerTh.textContent = lang['abc63490c815af81276f930216c8d92b'] ?? "Village";
    headerRow.appendChild(headerTh);

    // 5. Populate Villages
    let villagesData = JSON.parse(localStorage.getItem("villages_info") || "[]");

    // Convert to array if it's an object, or default to empty array
    const villagesList = Array.isArray(villagesData)
        ? villagesData
        : Object.values(villagesData);

    villagesList.forEach(village => {
        if (!village) return; // Skip empty entries

        const row = tbody.insertRow();

        const cellName = row.insertCell(0);
        cellName.className = "selected";
        const link = Object.assign(document.createElement("a"), {
            href: getVillageLinkCurrentScreen(village.url),
            className: "select-village",
            textContent: village.name?.trim() || "Unknown"
        });
        cellName.appendChild(link);

        const cellCoords = row.insertCell(1);
        cellCoords.className = "selected village-list-coords";
        cellCoords.textContent = village.coords || "N/A";
    });

    // 6. Assembly
    table.appendChild(tbody);
    popupContent.appendChild(table);
    popup.appendChild(popupMenu);
    popup.appendChild(popupContent);
    popupHelper.appendChild(popup);

    document.body.appendChild(popupHelper);
}

/**
 * Opens a popup to edit the custom navigation bar shortcuts.
 */
function openNavEditorPopup() {
    // 1. Toggle: If the editor already exists, remove it and stop
    const existing = document.querySelector(".popup_helper_editor");
    if (existing) {
        existing.remove();
        return;
    }

    // 2. Create the Overlay (Dark background)
    const popupHelper = Object.assign(document.createElement("div"), {
        className: "popup_helper popup_helper_editor",
        style: "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: block;"
    });

    // 3. Create the Popup Container
    const popup = Object.assign(document.createElement("div"), {
        id: "nav_editor_popup",
        className: "popup_style",
        style: "position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 600px; z-index: 10001; display: block;"
    });

    // 4. Header & Close button logic
    const popupMenu = Object.assign(document.createElement("div"), {
        className: "popup_menu",
        innerHTML: "<strong>Navigation Items</strong>",
        style: "cursor: default;"
    });

    const closeBtn = Object.assign(document.createElement("a"), {
        href: "#",
        innerText: "X",
        style: "float: right; cursor: pointer; font-weight: bold; text-decoration: none;"
    });

    closeBtn.onclick = (e) => {
        e.preventDefault();
        popupHelper.remove();
    };
    popupMenu.appendChild(closeBtn);

    // 5. Content Area
    const popupContent = Object.assign(document.createElement("div"), {
        className: "popup_content",
        style: "padding: 15px; background: #f4e4bc; max-height: 450px; overflow-y: auto;"
    });

    const table = Object.assign(document.createElement("table"), {
        className: "vis",
        style: "width: 100%; border-collapse: collapse;"
    });

    table.innerHTML = `
        <thead>
            <tr>
                <th style="text-align:left;">Name</th>
                <th style="text-align:left;">URL</th>
                <th style="text-align:left;">Icon (URL)</th>
                <th style="width: 30px;"></th>
            </tr>
        </thead>
        <tbody id="nav_editor_body"></tbody>
    `;

    /**
     * Helper to add a new row to the editor table
     */
    const addRow = (item = { name: '', href: '', img: '' }) => {
        const tbody = document.getElementById('nav_editor_body');
        if (!tbody) return;

        const row = tbody.insertRow();
        const deleteText = lang['1063e38cb53d94d386f21227fcd84717'] ?? 'Remove';

        row.innerHTML = `
            <td><input type="text" class="nav-name" value="${item.name}" style="width: 100px; font-size:12px"></td>
            <td><input type="text" class="nav-href" value="${item.href}" style="width: 180px; font-size:12px" placeholder="/game.php?screen=..."></td>
            <td><input type="text" class="nav-img" value="${item.img}" style="width: 180px; font-size:12px" placeholder="ex: unit/att.png"></td>
            <td style="text-align:center;">
                <span class="delete-icon-large hint-toggle" 
                      style="cursor:pointer;" 
                      data-title="${deleteText}">
                </span>
            </td>
        `;

        const deleteBtn = row.querySelector('.delete-icon-large');

        // 1. Click event to remove the row
        deleteBtn.onclick = () => {
            // Important: Hide the tooltip before removing the element from DOM
            // to prevent the tooltip from getting "stuck" on the screen.
            if (typeof toggleTooltip === 'function') toggleTooltip(deleteBtn, false);
            row.remove();
        };

        // 2. Hover events for the Native Tooltip
        if (typeof toggleTooltip === 'function') {
            deleteBtn.onmouseenter = () => toggleTooltip(deleteBtn, true);
            deleteBtn.onmouseleave = () => toggleTooltip(deleteBtn, false);
        }
    };

    popupContent.appendChild(table);

    // 6. Control Buttons (Footer)
    const footer = document.createElement("div");
    footer.style.marginTop = "15px";
    footer.style.display = "flex";
    footer.style.justifyContent = "space-between";

    const addBtn = Object.assign(document.createElement("button"), {
        className: "btn",
        innerText: lang['ee251fffae6371d31aa2d3f958b76353'] ?? 'Add new'
    });
    addBtn.onclick = () => addRow();

    const saveBtn = Object.assign(document.createElement("button"), {
        className: "btn btn-confirm",
        innerText: lang['c9cc8cce247e49bae79f15173ce97354'] ?? 'Save Changes'
    });

    saveBtn.onclick = () => {
        const newItems = [];
        document.querySelectorAll('#nav_editor_body tr').forEach(tr => {
            const name = tr.querySelector('.nav-name').value;
            if (name.trim()) {
                newItems.push({
                    name: name,
                    href: tr.querySelector('.nav-href').value,
                    img: tr.querySelector('.nav-img').value
                });
            }
        });

        // Save data to LocalStorage and refresh page
        localStorage.setItem('nav_shortcuts', JSON.stringify(newItems));
        window.location.reload();
    };

    footer.append(addBtn, saveBtn);
    popupContent.appendChild(footer);

    // 7. Final Assembly
    popup.append(popupMenu, popupContent);
    popupHelper.appendChild(popup);
    document.body.appendChild(popupHelper);

    // Close when clicking the background overlay
    popupHelper.onclick = (e) => {
        if (e.target === popupHelper) popupHelper.remove();
    };

    // Load existing data into the table
    const savedData = JSON.parse(localStorage.getItem('nav_shortcuts') || "[]");
    if (savedData.length > 0) {
        savedData.forEach(item => addRow(item));
    } else {
        // Add one empty row by default if no data exists
        addRow();
    }
}

/**
 * Injects a custom navigation bar (Quickbar) into the game interface.
 */
function injectNavigationBar() {
    if (!settings_cookies.general?.['show__navigation_bar']) return;

    const villageId = game_data.village.id;
    const assetBase = "https://dspt.innogamescdn.com/asset/7fe7ab60/graphic/";

    // 1. Hardcoded Script Functions
    const scriptActions = {

    };

    // 2. Load User Links from LocalStorage
    const customShortcuts = JSON.parse(localStorage.getItem('nav_shortcuts') || "[]");

    // 3. Default Items (Used only if LocalStorage is empty)
    const defaultItems = [
        { name: "Main", img: "buildings/mid/main3.png", href: `/game.php?village=${villageId}&screen=main` },
        { name: "Train", img: "unit/att.png", href: `/game.php?village=${villageId}&screen=train` },
        { name: "Smith", img: "buildings/mid/smith2.png", href: `/game.php?village=${villageId}&screen=smith` }
    ];

    // 4. Merge Logic
    // Convert scripts into list items and combine with user items
    const scriptItems = Object.keys(scriptActions).map(key => ({
        name: key,
        img: scriptActions[key].img,
        actionKey: key
    }));

    const userItems = customShortcuts.length > 0 ? customShortcuts : defaultItems;
    const finalItems = [...userItems, ...scriptItems];

    // --- DOM Construction ---
    const tableHTML = `
        <table id="quickbar_outer" align="center" width="100%" cellspacing="0">
            <tbody>
                <tr><td>
                    <table id="quickbar_inner" style="border-collapse: collapse;" width="100%">
                        <tbody>
                            <tr class="topborder"><td class="left"></td><td class="main"></td><td class="right"></td></tr>
                            <tr>
                                <td class="left"></td>
                                <td id="quickbar_contents" class="main">
                                    <ul id="script_quickbar_ul" class="menu quickbar"></ul>
                                </td>
                                <td class="right" style="padding: 0 5px;">
                                    <img id="nav_edit_icon" src="graphic/plus.png" class="navbar-edit-icon" title="Edit Navigation Bar" style="cursor:pointer">
                                </td>
                            </tr>
                            <tr class="bottomborder"><td class="left"></td><td class="main"></td><td class="right"></td></tr>
                            <tr><td class="shadow" colspan="3"><div class="leftshadow"></div><div class="rightshadow"></div></td></tr>
                        </tbody>
                    </table>
                </td></tr>
            </tbody>
        </table>`;

    const target = document.querySelector('.newStyleOnly');
    if (!target) return;
    target.insertAdjacentHTML('afterend', tableHTML);

    // 5. Populate the UI
    const ul = document.getElementById('script_quickbar_ul');

    finalItems.forEach(item => {
        const li = document.createElement('li');
        li.className = 'quickbar_item';

        const link = Object.assign(document.createElement('a'), {
            className: 'quickbar_link',
            href: item.href || "#"
        });

        // Event Handling: If item has an actionKey, run the script instead of navigating
        if (item.actionKey && scriptActions[item.actionKey]) {
            link.onclick = (e) => {
                e.preventDefault();
                scriptActions[item.actionKey].run();
            };
        }

        const img = Object.assign(document.createElement('img'), {
            className: 'navbar-icon',
            src: item.img.startsWith('http') ? item.img : assetBase + item.img,
            style: "width: 18px; height: 18px; margin-right: 4px; vertical-align: middle;"
        });

        link.append(img, `${item.name}`);
        li.appendChild(link);
        ul.appendChild(li);
    });

    document.getElementById('nav_edit_icon').onclick = openNavEditorPopup;
}

//delete premium promotion
if (settings_cookies.general['remove__premium_promo']) {
    const style = document.createElement("style");
    style.innerHTML = ".premium_account_hint { display: none !important; }";
    document.head.appendChild(style);
}