

var customCSS = `
.warn_90 {
    color: #c61212;
}

.farm_icon_c:hover {
    cursor: pointer;
}

.village-duration, .village-caries, .village-arrive {
    display: block;
    margin-top: 0px;
    font-size: 87%;
    line-height: 11px;
}

/* Navigation */
.navbar-icon {
    width: 18px;
    height: 18px;
    max-width: 18px;
    max-height: 18px;
    vertical-align: middle;
    margin-right: 4px;
}

.navbar-edit-icon {
    cursor: pointer;
    width: 18px;
    height: 18px;
    float: right;
}

#quickbar_contents.main {
    padding: 2px 5px;
}

.arrowCell {
    white-space: nowrap;
}

.village_switch_link {
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 0 5px;
}

.arrowLeft, .arrowRight {
    cursor: pointer;
    display: inline-block;
    width: 14px;
    height: 22px;
}

.village-list-toggle {
    cursor: pointer;
    width: 18px;
    height: 18px;
    max-width: 18px;
    max-height: 18px;
    float: right;
    transition: transform 0.2s ease;
}

.village-list-toggle:hover {
    transform: scale(1.1);
}

.box-item-village-list {
    padding-right: 3px;
}

.popup_helper_village_list {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 999;
}

#group_popup {
    width: 320px;
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: block;
    max-height: 90vh;
    overflow: hidden;
    z-index: 1000;
    pointer-events: auto;
}

#group_popup_content {
    max-height: calc(90vh - 80px);
    overflow-y: auto;
}

.village-list-coords {
    font-weight: bold;
    width: 100px;
    text-align: right;
}

.popup_menu {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: unset;
}

.popup_menu a#closelink_group_popup {
    float: right;
    cursor: pointer;
    text-decoration: none;
}



/* Custom Settings Styles */

.sidebar-icon {
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.2s ease;
}

.sidebar-icon-fixed {
    position: absolute;
    left: -65px;
    top: 39px;
}

.script-settings-btn-fixed {
    position: absolute;
    left: -65px;
    top: 39px;
}

.script-settings-icon {
    background-image: url('https://dspt.innogamescdn.com/asset/b56f49d7/graphic/icons/settings.png');
}

.sidebar-farm-assistant-icon {
    background-image: url('/graphic/icons/farm_assistent.png');
}

.sidebar-recruit-icon {
    background-image: url('/graphic/buildings/barracks.webp');
}

.sidebar-coin-minting-icon {
    background-size: auto !important;
    background-color: #E9D0A9 !important;
    background: url('/graphic/gold.webp') center / contain no-repeat;
}

.sidebar-coin-minting-icon:hover {
    background-color: #F9E0B9 !important;
}

.hammer-icon {
    background-size: 18px;
}

.sidebar-icon-offset {
    margin-top: 5px;
    margin-bottom: 5px;
}

/* Keeps the sidebar visible when the layout has insufficient space */
.questlog-pin-left {
    position: fixed !important;
    top: 55px !important;
    left: 5px !important;
    z-index: 12000 !important;
}

.questlog-pin-left > .sidebar-icon {
    position: relative !important;
    z-index: 12001 !important;
}

.twpf-pinned-sidebar {
    position: fixed !important;
    top: 55px !important;
    left: 5px !important;
    z-index: 30000 !important;
    display: flex;
    flex-direction: column;
    align-items: center;
}

.script-settings-popup {
    width: 880px;
    max-width: 95vw;
    font: inherit;
    opacity: 1;
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: none; /* Hidden by default */
    padding: 10px;
    max-height: 90vh;
    overflow-y: auto;
    z-index: 99999; /* Ensures it stays above other game elements */
}

.script-popup-header {
    font-size: 17px;
    font-weight: bold;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 5px;
    border-bottom: 1px solid #dec58a; /* Optional: adds a nice separator */
}

.script-popup-close {
    cursor: pointer;
    font-size: 18px;
    font-weight: bold;
    text-decoration: none;
    color: inherit;
}

.script-popup-close:hover {
    color: #804000; /* Changes color slightly on hover */
}

.script-settings-body {
    display: flex;
    align-items: stretch;
    gap: 15px;
    margin-top: 10px;
    height: min(480px, 60vh); /* Fixed so switching tabs never resizes the popup */
}

/* Left sidebar tab list */
.script-tab-sidebar {
    display: flex;
    flex-direction: column;
    flex: 0 0 170px;
    width: 170px;
    background: #f4e4bc;
    border: 1px solid #dec58a;
    border-radius: 4px;
    overflow-y: auto;
}

.script-tab-btn {
    padding: 10px 12px;
    border: none;
    border-left: 3px solid transparent;
    cursor: pointer;
    background: transparent;
    color: #603000;
    text-align: left;
    font-size: 15px;
}

.script-tab-btn:hover {
    background: #ecdcb5;
}

.script-tab-btn.active {
    background: #c1a264;
    border-left: 3px solid #804000;
    color: #3a2205;
    font-weight: bold;
}

.script-tab-content {
    display: none;
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding-right: 5px;
}

.script-tab-content.active {
    display: block;
}

.settings-table {
    width: 100%;
    border-collapse: collapse;
}

.settings-table td {
    padding: 8px;
}

.settings-label-cell {
    font-weight: bold;
    width: 30%; /* Balanced width for labels */
}

.twpf-settings-help-link {
    display: inline-flex;
    width: 8px;
    height: 8px;
    align-items: center;
    justify-content: center;
    margin-left: 4px;
    font-size: 7px;
    line-height: 8px;
    font-weight: bold;
    text-decoration: none;
}

.twpf-settings-help-link img {
    width: 10px;
    height: 10px;
}

.settings-table .setting-disabled {
    opacity: 0.55;
}

.settings-input-cell {
    padding: 0 5px;
}

.extra-setting-row td {
    padding: 4px;
    padding-left: 25px;
    font-size: 0.9em;
    color: #555;
}

#saveButtonDiv {
    text-align: center;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid #dec58a; /* Consistent with tab navigation separator */
}

.btn-save-settings {
    padding: 8px 16px !important; /* Ensure custom padding overrides defaults */
    font-size: 14px;
    cursor: pointer;
}

.custom-quicklinks-settings-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
}

.village-quicklinks-content {
    padding: 8px;
    display: flex;
    gap: 6px;
    justify-content: center;
    flex-wrap: wrap;
    width: max-content;
    max-width: calc(100vw - 32px);
    border-radius: 8px 8px 0 0;
}

.custom-quicklink-settings-item {
    width: 28px;
    height: 28px;
    padding: 3px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border: 1px solid #9b7a3d;
    background: #f4e4bc;
    color: #603000;
    font-size: 18px;
    line-height: 1;
}

.custom-quicklink-settings-item:hover {
    background: #ecdcb5;
}

.custom-quicklink-settings-item img {
    width: 20px;
    height: 20px;
    object-fit: contain;
}

.custom-quicklink-editor-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100000;
    background: rgba(0, 0, 0, 0.5);
}

.custom-quicklink-editor-popup {
    position: fixed;
    top: 50%;
    left: 50%;
    width: 360px;
    max-width: calc(100vw - 24px);
    transform: translate(-50%, -50%);
    z-index: 1;
}

.custom-quicklink-editor-close {
    float: right;
    cursor: pointer;
    font-weight: bold;
    text-decoration: none;
}

.custom-quicklink-editor-content {
    padding: 10px;
}

.custom-quicklink-editor-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-bottom: 8px;
}

.custom-quicklink-editor-field input {
    box-sizing: border-box;
    width: 100%;
}

.custom-quicklink-editor-icon-controls {
    display: flex;
    align-items: center;
    gap: 4px;
}

.custom-quicklink-editor-icon-controls input {
    flex: 1;
}

.custom-quicklink-editor-preview,
.custom-quicklink-editor-picker {
    width: 24px;
    height: 24px;
    object-fit: contain;
}

.custom-quicklink-editor-picker {
    cursor: pointer;
}

.custom-quicklink-editor-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 10px;
}

.custom-quicklink-editor-delete {
    margin-left: auto;
}


/* Scavenge bot config panel */
#scavenge_bot_config div.vis {
    margin: 0;
}


/* Custom Map Styles */

.custom-map-ctx-button {
    cursor: pointer;
}
.ctx-custom {
    width: 24px;
    height: 24px;
    z-index: 11950;
}
.ctx-custom.mp_lock {
    background-position: -48px 0;
}
.ctx-custom.mp_unlock {
    background-position: -216px 0;
}
.ctx-custom.mp_invite {
    background-position: -384px 0;
}
.reservation-ctx-disabled {
    opacity: .45 !important;
    filter: grayscale(1);
    pointer-events: none;
    cursor: not-allowed;
}
.icon_outgoing_unit {
    width: 15px;
    height: 15px;
    position: absolute;
    z-index: 4;
}


/* TWStats history table (feature_playerProfile) */
:root {
    --status-green: #84c47a;
    --status-red: #f47a6a;
    --status-orange: #f0a560;
}

[data-twstats-history] .g {
    color: var(--status-green);
    font-weight: bold;
}
[data-twstats-history] .r {
    color: var(--status-red);
    font-weight: bold;
}
[data-twstats-history] .o {
    color: var(--status-orange);
    font-weight: bold;
}

/* screen=memo tab-bar: native tabs don't show a pointer cursor/hover feedback by default */
#tab-bar .memo-tab {
    cursor: pointer;
}
#tab-bar .memo-tab:hover {
    opacity: 0.8;
}

/* Extra memo note-type tabs on screen=memo */
.extra-memo-type-tabs {
    margin: 8px 0;
}
.extra-memo-type-tabs .modemenu {
    clear: both;
    margin-bottom: 0;
}
.extra-memo-type-tabs .modemenu td {
    cursor: pointer;
}
.extra-memo-type-tabs .modemenu td:hover {
    opacity: 0.8;
}
.extra-memo-type-panel {
    display: none;
}
.extra-memo-type-panel.active {
    display: block;
}
.extra-memo-backup-actions {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 6px;
}

`;
GM_addStyle(customCSS);
