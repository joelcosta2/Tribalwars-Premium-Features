

var customCSS = `
.not-hidden {
    display: block;
}

#toggleButton.toggle-on {
    background-color: green;
}

#toggleButton {
    width: 35px;
    height: 18px;
    margin-left: 5px;
    background-color: red;
    border: none;
    border-radius: 15px;
    position: relative;
    cursor: pointer;
}

#toggleButton:before {
    content: '';
    position: absolute;
    top: 3px;
    left: 5px;
    width: 12px;
    height: 12px;
    background-color: white;
    border-radius: 50%;
    transition: transform 0.3s, background-color 0.3s;
}

.toggle-on:before {
    transform: translateX(12px);
}

.warn_90 {
    color: #c61212;
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
    background: rgba(0, 0, 0, 0.2); /* Slight dimming */
    z-index: 999;
}

#group_popup {
    width: 320px;
    position: fixed;
    top: 20%;
    left: 50%;
    transform: translateX(-50%);
    display: block;
    z-index: 1000;
}

#group_popup_content {
    height: 380px;
    overflow-y: auto;
}

.village-list-coords {
    font-weight: bold;
    width: 100px;
    text-align: right;
}

.popup_menu {
    cursor: unset;
}

.popup_menu a#closelink_group_popup {
    float: right;
    cursor: pointer;
    text-decoration: none;
}



/* Custom Settings Styles */

.script-settings-btn {
    cursor: pointer;
    transition: opacity 0.2s ease;
}

.script-settings-btn:hover {
    opacity: 0.7;
}

.script-settings-btn-fixed {
    position: absolute;
    left: -65px;
    top: 39px;
}

.script-settings-icon {
    background-image: url('https://dspt.innogamescdn.com/asset/b56f49d7/graphic/icons/settings.png');
}

.script-settings-popup {
    width: 700px;
    font: inherit;
    opacity: 1;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -70%);
    display: none; /* Hidden by default */
    padding: 10px;
    overflow: hidden;
    z-index: 10000; /* Ensures it stays above other game elements */
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

.script-tab-btn {
    padding: 4px;
    border: 1px solid transparent; /* Prevents layout jump when border appears */
    cursor: pointer;
    background: #f4e4bc;
    flex: 1;
    font: inherit;
}

.script-tab-btn.active {
    background: #c1a264;
    border: 1px solid #7d510f;
}

.script-tab-content {
    display: none;
}

.script-tab-content.active {
    display: block;
}

.script-tab-content {
    display: none;
    margin-top: 10px;
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

.settings-input-cell {
    padding: 0 5px;
}

.extra-setting-row td {
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


/* Custom Map Styles */

.custom-map-ctx-button {
    cursor: pointer;
}
.icon_outgoing_unit {
    width: 18;
    height: 18;
    position: absolute;
    margin-left: 30px;
    z-index: 4;
}


`;
GM_addStyle(customCSS);
