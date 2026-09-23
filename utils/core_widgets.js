// DOM/UI helpers: widget containers, tooltips, keyboard shortcuts, native widget drag/drop persistence.
// Depends on utils/core_state.js (settings_cookies for widget open/collapsed + column persistence).

var textSelected;

/**
 * Toggles a DOM element's visibility between 'block' and 'none'.
 * @param {HTMLElement} popup
 */
function togglePopup(popup) {
    if (popup.style.display === 'none' || !popup.style.display) {
        popup.style.display = 'block';  // Show the popup
    } else {
        popup.style.display = 'none';   // Hide the popup
    }
}

/**
 * Tracks focus on all textarea and input elements so keyboard shortcuts
 * can be suppressed while the user is typing.
 */
function listenTextAreas() {
    // Track focus state for all textareas and inputs
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

/**
 * Returns whether a keyboard event originated in an editable form control.
 * Event-time detection also covers controls created after page initialisation.
 * @param {EventTarget|null} target
 * @returns {boolean}
 */
function isEditableKeyboardTarget(target) {
    if (!target || typeof target.matches !== 'function') return false;
    return target.matches('input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]') ||
        Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]'));
}

/**
 * Registers A/D keyboard shortcuts for cycling between villages.
 * Only active when the navigation arrows setting is enabled and no editable field has focus.
 */
function defineKeyboardShortcuts() {
    $(document).off('keydown.premium_features_navigation');
    if (settings_cookies.general['show__navigation_arrows']) {
        $(document).on('keydown.premium_features_navigation', function (evt) {
            if (textSelected || isEditableKeyboardTarget(evt.target)) return;

            if (evt.keyCode == 65) {
                evt.preventDefault();
                previousVillage();
            } else if (evt.keyCode == 68) {
                evt.preventDefault();
                nextVillage();
            }
        });
    }
}

function createWidgetLoadingElement(minHeight = '44px') {
    var loading = document.createElement('div');
    loading.className = 'premium-features-widget-loading';
    loading.setAttribute('aria-busy', 'true');
    loading.style.cssText = 'display:flex;align-items:center;justify-content:center;min-height:' + minHeight + ';width:100%;';

    var image = document.createElement('img');
    image.src = '/graphic/throbber.gif';
    image.alt = t('common.loading');
    image.setAttribute('data-title', t('common.loading'));
    loading.appendChild(image);
    return loading;
}

function setWidgetLoading(container, isLoading, minHeight = '44px') {
    if (!container) return;
    if (isLoading) container.replaceChildren(createWidgetLoadingElement(minHeight));
    else container.replaceChildren();
    container.setAttribute('aria-busy', String(isLoading));
}

/**
 * Updates a widget without replacing its outer node. The stable root prevents an asynchronous
 * refresh from creating a visible remove/insert gap and keeps the widget's layout position and
 * collapsed state intact.
 */
function patchExistingWidget(currentElement, replacement, contents, elemName, title, description, loading) {
    if (!currentElement) return null;
    const currentContent = document.getElementById('widget_content_' + elemName);
    const currentHeader = Array.from(currentElement.children || []).find(function (child) {
        return String(child.tagName || '').toLowerCase() === 'h4';
    });
    if (!currentContent || !currentHeader) {
        currentElement.replaceWith(replacement);
        return replacement;
    }

    currentElement.className = replacement.className;
    currentElement.setAttribute('data-title', description || title);
    const headerButton = document.getElementById('mini_' + elemName);
    const titleNodes = Array.from(currentHeader.childNodes || []).filter(function (node) {
        return node !== headerButton && node.nodeType === 3;
    });
    if (titleNodes.length) {
        titleNodes[0].textContent = title;
        titleNodes.slice(1).forEach(function (node) { currentHeader.removeChild(node); });
    } else {
        currentHeader.insertBefore(document.createTextNode(title), headerButton || currentHeader.firstChild || null);
    }
    currentHeader.setAttribute('data-title', description || title);
    currentContent.replaceChildren(contents);
    currentContent.setAttribute('aria-busy', String(loading));
    return currentElement;
}

/**
 * Builds a collapsible widget container and inserts it into the specified column
 * at the position saved in settings_cookies. Replaces the existing widget if update is true.
 * @param {Object} options
 */
function createWidgetElement({ identifier, contents, columnToUse, update, extra_name = '', description = '', title = '', widgetKey = '', loading = false }) {
    var columnElement = document.getElementById(columnToUse);

    if (columnElement) {
        // widgetKey must stay language-independent (matches settings_cookies.widgets[].name);
        // identifier is only for display and may be a translated string.
        var elemId = widgetKey || identifier.toLowerCase().replace(/ /g, '_');
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
                settings_cookies.widgets.find(widget => widget.name === elemName).open = false; // Persist collapsed state
            } else {
                miniElem.src = miniElem.src.replace('plus', 'minus');
                settings_cookies.widgets.find(widget => widget.name === elemName).open = true; // Persist expanded state
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
        contentDiv.setAttribute('aria-busy', String(loading));
        contentDiv.appendChild(contents);
        containerDiv.appendChild(header);
        containerDiv.appendChild(contentDiv);
        // A partial reload may reconcile the same logical widget again. Patch the existing root
        // in place so no duplicate UI survives and async refreshes never expose a blank interval.
        var currentElement = document.getElementById('show_' + elemName);
        if (currentElement) {
            const patched = patchExistingWidget(
                currentElement,
                containerDiv,
                contents,
                elemName,
                title,
                description,
                loading
            );
            if (patched.parentNode !== columnElement) columnElement.appendChild(patched);
            return patched;
        }

        // Insert at the saved position if valid, otherwise append to the column
        var widgetIndex = settings_cookies.widgets.find(widget => widget.name === elemName).pos;
        var children = columnElement.childNodes;
        if (widgetIndex >= 0 && widgetIndex <= children.length) {
            var refChild = (widgetIndex + 1 === children.length) ? children[widgetIndex] : children[widgetIndex + 1];
            columnElement.insertBefore(containerDiv, refChild);
        } else {
            columnElement.appendChild(containerDiv);
        }
        return containerDiv;
    }

    return null;
}

/**
 * Reads the current DOM position of all widgets and persists their column assignment
 * and position index to settings_cookies.
 */
function saveColumnOrder() {
    var scriptColumn = document.getElementById(LEFT_COLUMN);
    var childDivs = scriptColumn ? Array.from(scriptColumn.children) : [];
    var childDivIds = childDivs.map(function (div) {
        return div.id.replace('show_', '');
    });

    childDivs.forEach(function (child) {
        rememberNativeWidgetScriptPosition(child);
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

var NATIVE_WIDGET_POSITIONS_KEY = 'native_widget_positions';
var nativeWidgetDragOrigin = null;

function rememberNativeWidgetPosition(item) {
    if (!item || item.classList.contains('script_widget') || !item.parentNode?.id || item.parentNode.id === LEFT_COLUMN) {
        return;
    }

    var positions = JSON.parse(localStorage.getItem(NATIVE_WIDGET_POSITIONS_KEY) || '{}');
    positions[item.id] = {
        column: item.parentNode.id,
        pos: Array.from(item.parentNode.children).indexOf(item)
    };
    localStorage.setItem(NATIVE_WIDGET_POSITIONS_KEY, JSON.stringify(positions));
}

function rememberNativeWidgetScriptPosition(item) {
    if (!item || item.classList.contains('script_widget') || item.parentNode?.id !== LEFT_COLUMN) {
        return;
    }

    var positions = JSON.parse(localStorage.getItem(NATIVE_WIDGET_POSITIONS_KEY) || '{}');
    positions[item.id] = Object.assign({}, positions[item.id], {
        scriptPos: Array.from(item.parentNode.children).indexOf(item)
    });
    localStorage.setItem(NATIVE_WIDGET_POSITIONS_KEY, JSON.stringify(positions));
}

function restoreNativeWidgetsInScriptColumn() {
    var scriptColumn = document.getElementById(LEFT_COLUMN);
    if (!scriptColumn) return;

    var positions = JSON.parse(localStorage.getItem(NATIVE_WIDGET_POSITIONS_KEY) || '{}');
    Object.keys(positions)
        .filter(function (id) {
            return positions[id].scriptPos !== undefined;
        })
        .sort(function (firstId, secondId) {
            return positions[firstId].scriptPos - positions[secondId].scriptPos;
        })
        .forEach(function (id) {
            var item = document.getElementById(id);
            if (!item || item.classList.contains('script_widget')) return;

            var targetIndex = Math.max(0, Math.min(positions[id].scriptPos, scriptColumn.children.length));
            scriptColumn.insertBefore(item, scriptColumn.children[targetIndex] || null);
        });
}

function restoreNativeWidgetPosition(item) {
    if (!item || item.classList.contains('script_widget')) return;

    var positions = JSON.parse(localStorage.getItem(NATIVE_WIDGET_POSITIONS_KEY) || '{}');
    var savedPosition = positions[item.id];
    var targetColumn = savedPosition && document.getElementById(savedPosition.column);
    if (!targetColumn) return;

    var targetIndex = Math.max(0, Math.min(savedPosition.pos, targetColumn.children.length));
    var referenceChild = targetColumn.children[targetIndex];
    if (referenceChild !== item) {
        targetColumn.insertBefore(item, referenceChild || null);
    }
}

/**
 * Prepends a script_column <td> to the overview table to house custom widgets.
 */
function injectScriptColumn() {
    var overviewtableElement = document.getElementById('overviewtable');
    if (overviewtableElement && !document.getElementById('script_column')) {
        var trElement = overviewtableElement.getElementsByTagName('tr')[0];
        var scriptColumn = document.createElement('td');
        scriptColumn.setAttribute('valign', 'top');
        scriptColumn.setAttribute('id', 'script_column');
        scriptColumn.style.width = document.getElementById('rightcolumn').offsetWidth + 'px';
        trElement.insertBefore(scriptColumn, trElement.firstChild);
    }
}

/**
 * Shows or hides the TW native tooltip, positioned next to the target element.
 * Reads content from data-title (header) and data-tooltip-tpl (body) attributes.
 * @param {HTMLElement} element
 * @param {boolean} isVisible
 */
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
        tooltip.style.pointerEvents = 'none'; // never steal hover from the element it's anchored to (avoids show/hide flicker on overlap)
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

/**
 * Displays a transient notification bar that auto-removes after 3 seconds.
 * @param {string} text
 * @param {boolean} [isError=true] - Uses error styling; pass false for success.
 */
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
