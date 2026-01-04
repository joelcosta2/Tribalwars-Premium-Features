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
        existing.closest('.popup_helper')?.remove();
        return;
    }

    // 2. Create Elements
    const popupHelper = document.createElement("div");
    popupHelper.className = "popup_helper";

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
 * Injects a custom navigation bar (Quickbar) into the game interface.
 */
function injectNavigationBar() {
    if (!settings_cookies.general?.['show__navigation_bar']) return;

    const tw_lang = JSON.parse(localStorage.getItem('tw_lang') || '{}');
    const villageId = game_data.village.id;

    // Define Navigation Items
    const navItems = {
        "Main": { img: "buildings/mid/main3.png", href: `/game.php?village=${villageId}&screen=main` },
        "Recruitment": { img: "unit/att.png", href: `/game.php?village=${villageId}&screen=train` },
        "Smith": { img: "buildings/mid/smith2.png", href: `/game.php?village=${villageId}&screen=smith` },
        "Place": { img: "buildings/mid/place1.png", href: `/game.php?village=${villageId}&screen=place` },
        [tw_lang["52e136b31c4cc30c8f3d9eeb8dc56013"] || "Scavenge"]: {
            img: "scavenging/options/3.png",
            href: `/game.php?village=${villageId}&screen=place&mode=scavenge`
        },
        "Del Misc Reports": {
            img: "delete.png",
            run: async () => {
                try {
                    const url = `${game_data.link_base_pure}report&action=del_all&mode=other&h=${game_data.csrf}`;
                    const res = await fetch(url, { credentials: "include" });
                    showAutoHideBox(res.ok ? 'Misc reports deleted' : 'Error deleting reports', !res.ok);
                } catch (e) { showAutoHideBox('Network Error', true); }
            }
        },
        "Quests": {
            img: "quests_new/quest_icon.png",
            run: () => Questlines.showDialog(0, 'main-tab')
        }
    };

    // Construct the Table Shell using Template Literals
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
                                    <img id="nav_edit_icon" src="graphic/plus.png" class="navbar-edit-icon" title="Edit Navigation Bar">
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

    // Populate List Items
    const ul = document.getElementById('script_quickbar_ul');
    const assetBase = "https://dspt.innogamescdn.com/asset/7fe7ab60/graphic/";

    Object.entries(navItems).forEach(([name, data], index) => {
        const li = document.createElement('li');
        li.className = 'quickbar_item';

        const link = Object.assign(document.createElement('a'), {
            className: 'quickbar_link',
            href: data.href || "#"
        });

        if (data.run) {
            link.onclick = (e) => { e.preventDefault(); data.run(); };
        }

        const img = Object.assign(document.createElement('img'), {
            className: 'navbar-icon',
            src: data.img.startsWith('http') ? data.img : assetBase + data.img
        });

        link.append(img, name);
        li.appendChild(link);
        ul.appendChild(li);
    });

    // Attach Edit Event
    document.getElementById('nav_edit_icon').onclick = () => alert("TBD - Edit logic");
}

//delete premium promotion
if (settings_cookies.general['remove__premium_promo']) {
    const style = document.createElement("style");
    style.innerHTML = ".premium_account_hint { display: none !important; }";
    document.head.appendChild(style);
}