(function () {
    'use strict';

    function isSoftDarkModeEnabled() {
        if (typeof settings_cookies === 'undefined' || !settings_cookies || !settings_cookies.general) {
            return false;
        }
        return settings_cookies.general['show__soft_dark_mode'] !== false;
    }

    if (!isSoftDarkModeEnabled()) {
        return;
    }

    var softDarkModeCss = `
:root {
    --pf-dark-bg-main: #2b241d;
    --pf-dark-bg-alt: #342b22;
    --pf-dark-bg-soft: #3d3328;
    --pf-dark-border: #7c5a29;
    --pf-dark-text: #eadfc8;
    --pf-dark-text-muted: #d6c8ab;
    --pf-dark-link: #e6be76;
    --pf-dark-link-hover: #ffd694;
}

body {
    color: var(--pf-dark-text) !important;
}

hr {
    border-top: 1px solid #5e4a2b !important;
    border-bottom: 1px solid #5e4a2b !important;
}

a {
    color: var(--pf-dark-link) !important;
}

a:hover {
    color: var(--pf-dark-link-hover) !important;
}

#inner-border,
.maincell,
.content-border,
.post,
.quest,
.forum,
#forum_box,
#message,
.script-settings-popup,
#group_popup {
    background-color: var(--pf-dark-bg-main) !important;
    color: var(--pf-dark-text) !important;
}

#inner-border td,
.widget-content,
.widget-content > div,
.popup_box_content,
#tooltip,
#inline_popup_main,
#inline_popup,
table#popup_box table,
td.popup_box_content table,
div#forum_box table,
div.containerBorder table,
div.spoiler div {
    background-color: var(--pf-dark-bg-alt) !important;
    color: var(--pf-dark-text) !important;
}

th,
h4,
div.vis h4,
div.row h4,
.vis > h4,
#content_value th {
    color: #f2e7d3 !important;
    background-color: #6f5838 !important;
    background-image: none !important;
    border-bottom: 1px solid #8c6b39 !important;
}

div.vis {
    border: 1px solid var(--pf-dark-border) !important;
    box-shadow: 1px 1px 3px rgba(0, 0, 0, 0.45) !important;
}

.vis td,
.vis_item,
.overview_table .nohover,
.vis .row_a > td,
.vis.alternating-rows tr:nth-child(even) td,
.vis .row_b > td,
.vis.alternating-rows tr:nth-child(odd) td,
.vis .units_away > td,
.lit .lit-item {
    color: var(--pf-dark-text) !important;
}

.vis td,
.vis_item,
.overview_table .nohover,
.vis .units_away > td {
    background: var(--pf-dark-bg-alt) !important;
}

.vis .row_a > td,
.vis.alternating-rows tr:nth-child(even) td {
    background: #3a3026 !important;
}

.vis .row_b > td,
.vis.alternating-rows tr:nth-child(odd) td {
    background: #473a2d !important;
}

.vis .selected,
.vis .selected > td,
.overview_table .selected > td,
tr.selected td {
    background: #5a452c !important;
}

.server_info,
.small,
#content_value,
#content_value p,
#content_value td,
#content_value li,
#content_value label,
#content_value h2,
#content_value h3 {
    color: var(--pf-dark-text-muted) !important;
}

input[type="text"],
input[type="search"],
input[type="password"],
textarea,
select,
.ui-autocomplete {
    background-color: var(--pf-dark-bg-soft) !important;
    color: var(--pf-dark-text) !important;
    border: 1px solid var(--pf-dark-border) !important;
}

.ui-menu-item {
    color: var(--pf-dark-text) !important;
}

.ui-menu-item:hover {
    background-color: #51412f !important;
    color: #fff4df !important;
}

.quickbar {
    background-color: #2f271f !important;
    border-color: #5f4828 !important;
}

.quickbar li,
#quickbar_inner .main {
    background-color: #3a3025 !important;
    background-image: none !important;
}

#footer,
.chat-header,
.chat-contacts,
.chat-body,
.chat-body div,
.chat-popover,
.chat-footer,
.chat-input {
    background: #2e261f !important;
    color: var(--pf-dark-text) !important;
}

.warn_90 {
    color: #ffb86c !important;
}
`;

    GM_addStyle(softDarkModeCss);
})();
