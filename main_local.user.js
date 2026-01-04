// ==UserScript==
// @name         Tribalwars: Premiun Features
// @version      4.10.0
// @description    Advanced TribalWars tools: Multi-Village Navigation Arrows; Sidebar with Village List, Notepad, and Infinite Build Queue (Experimental); Enhanced Map with custom sizes, outgoing unit icons, and direct template attacks; Automated Scavenging & Paladin Training; Premium UI features for non-premium users.
// @author         killwilll
// @require      file://C:\{YOUR_PATH}\Tribalwars_Script\utils.user.js
// @require      file://C:\{YOUR_PATH}\Tribalwars_Script\custom_css.user.js
// @require      file://C:\{YOUR_PATH}\Tribalwars_Script\settings_script.user.js
// @require      file://C:\{YOUR_PATH}\Tribalwars_Script\navigationArrows_script.user.js
// @require      file://C:\{YOUR_PATH}\Tribalwars_Script\map_script.user.js
// @require      file://C:\{YOUR_PATH}\Tribalwars_Script\overviewPremiumInfo.user.js
// @require      file://C:\{YOUR_PATH}\Tribalwars_Script\bot_trainerPaladin.user.js
// @require      file://C:\{YOUR_PATH}\Tribalwars_Script\bot_scavenging.user.js
// @require      file://C:\{YOUR_PATH}\Tribalwars_Script\widget_villageList.user.js
// @require      file://C:\{YOUR_PATH}\Tribalwars_Script\widget_notepad.user.js
// @require      file://C:\{YOUR_PATH}\Tribalwars_Script\widget_extraBuildQueue.user.js
// @require      file://C:\{YOUR_PATH}\Tribalwars_Script\widget_recruitTroops.user.js
// @updateURL    file://C:\{YOUR_PATH}\Tribalwars_Script\1main.user.js
// @downloadURL  file://C:\{YOUR_PATH}\Tribalwars_Script\1main.user.js
// @include      https://*.tribalwars.*/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant GM_setValue
// @grant GM_getValue
// ==/UserScript==
(function () {
    'use strict';
    init();
    var villageList;
    function init() {
        restoreTimeouts();
        prepareLocalStorageItems();
        if (!document.getElementById('mobileContent')) {
            start();
        }
    }
})();