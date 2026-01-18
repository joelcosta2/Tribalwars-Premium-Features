// ==UserScript==
// @name         Tribalwars: Premium Features
// @version      4.10.1
// @description  Advanced TribalWars tools: Multi-Village Navigation Arrows; Sidebar with Village List, Notepad, and Infinite Build Queue (Experimental); Enhanced Map with custom sizes, outgoing unit icons, and direct template attacks; Automated Scavenging & Paladin Training; Premium UI features for non-premium users.
// @author       killwilll
// @require     file://C:\Users\joelc\Documents\GitHub_Repos\Tribalwars_Script\Tribalwars_Script\utils.user.js
// @require     file://C:\Users\joelc\Documents\GitHub_Repos\Tribalwars_Script\Tribalwars_Script\custom_css.user.js
// @require     file://C:\Users\joelc\Documents\GitHub_Repos\Tribalwars_Script\Tribalwars_Script\settings_script.user.js
// @require     file://C:\Users\joelc\Documents\GitHub_Repos\Tribalwars_Script\Tribalwars_Script\navigationArrows_script.user.js
// @require     file://C:\Users\joelc\Documents\GitHub_Repos\Tribalwars_Script\Tribalwars_Script\map_script.user.js
// @require     file://C:\Users\joelc\Documents\GitHub_Repos\Tribalwars_Script\Tribalwars_Script\overviewPremiumInfo.user.js
// @require     file://C:\Users\joelc\Documents\GitHub_Repos\Tribalwars_Script\Tribalwars_Script\bot_trainerPaladin.user.js
// @require     file://C:\Users\joelc\Documents\GitHub_Repos\Tribalwars_Script\Tribalwars_Script\bot_scavenging.user.js
// @require     file://C:\Users\joelc\Documents\GitHub_Repos\Tribalwars_Script\Tribalwars_Script\widget_villageList.user.js
// @require     file://C:\Users\joelc\Documents\GitHub_Repos\Tribalwars_Script\Tribalwars_Script\widget_notepad.user.js
// @require     file://C:\Users\joelc\Documents\GitHub_Repos\Tribalwars_Script\Tribalwars_Script\widget_extraBuildQueue.user.js
// @require     file://C:\Users\joelc\Documents\GitHub_Repos\Tribalwars_Script\Tribalwars_Script\widget_recruitTroops.user.js
// @require     file://C:\Users\joelc\Documents\GitHub_Repos\Tribalwars_Script\Tribalwars_Script\building_main.js
// @updateURL   file://C:\Users\joelc\Documents\GitHub_Repos\Tribalwars_Script\Tribalwars_Script\main_local.user.js
// @downloadURL file://C:\Users\joelc\Documents\GitHub_Repos\Tribalwars_Script\Tribalwars_Script\main_local.user.js
// @include      https://*.tribalwars.*/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant GM_setValue
// @grant GM_getValue
// @allFrames    true
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

        // No hCaptcha, o ID do quadrado para clicar costuma ser "checkbox" ou "anchor"
        var checkExist = setInterval(function () {
            var box = document.getElementById('checkbox') || document.getElementById('anchor');
            if (box) {
                box.click();
                console.log("hCaptcha clicado!");
                clearInterval(checkExist);
            }
        }, 500);

    }
})();