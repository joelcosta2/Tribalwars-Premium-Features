// Village profile notes, stored independently from the main village notepad.

function getVillageProfileNoteId() {
    const villageId = new URLSearchParams(window.location.search).get('id');
    return villageId || game_data?.village?.id || null;
}

function getVillageProfileRightColumn() {
    return document.querySelector('#content_value > table > tbody > tr > td:nth-child(2)');
}

function renderVillageProfileNote(container, villageId) {
    const body = container.querySelector('#village_profile_note_body');
    const editLink = container.querySelector('#village_profile_note_edit');
    const viewRow = container.querySelector('#village_profile_note_view');
    const note = villageProfileNoteGet(villageId);
    body.innerHTML = note ? convertBBCodeToHTML(note) : '';
    body.style.whiteSpace = 'pre-wrap';
    if (note) resolveNotepadBBCodeLinks(body);
    viewRow.style.display = note ? '' : 'none';
    editLink.textContent = note ? t('button.edit') : t('button.new');
}

function openVillageProfileNoteEditor(container, villageId) {
    const textarea = container.querySelector('#village_profile_note_text');
    textarea.value = villageProfileNoteGet(villageId);
    BBCodes.target = { 0: textarea };
    listenTextAreas();
    container.querySelector('#village_profile_note_view').style.display = 'none';
    container.querySelector('#village_profile_note_editor').style.display = '';
    textarea.focus();
}

function closeVillageProfileNoteEditor(container) {
    container.querySelector('#village_profile_note_editor').style.display = 'none';
    container.querySelector('#village_profile_note_view').style.display = '';
}

function buildVillageProfileNote(villageId) {
    const container = document.createElement('div');
    container.id = 'village_profile_note';
    container.style.marginBottom = '10px';

    const table = document.createElement('table');
    table.className = 'vis';
    table.width = '100%';

    const headerRow = document.createElement('tr');
    const heading = document.createElement('th');
    heading.textContent = t('villageProfile.noteTitle');

    const editLink = document.createElement('a');
    editLink.id = 'village_profile_note_edit';
    editLink.href = '#';
    editLink.className = 'btn float_right';
    editLink.addEventListener('click', event => {
        event.preventDefault();
        openVillageProfileNoteEditor(container, villageId);
    });
    heading.appendChild(editLink);
    headerRow.appendChild(heading);
    table.appendChild(headerRow);

    const view = document.createElement('div');
    view.style.padding = '5px';

    const body = document.createElement('div');
    body.id = 'village_profile_note_body';
    body.style.marginBottom = '5px';
    view.appendChild(body);
    const viewCell = document.createElement('td');
    viewCell.appendChild(view);
    const viewRow = document.createElement('tr');
    viewRow.id = 'village_profile_note_view';
    viewRow.appendChild(viewCell);
    table.appendChild(viewRow);

    const editor = document.createElement('div');
    editor.id = 'village_profile_note_editor_content';
    editor.style.padding = '5px';

    editor.appendChild(buildBBCodeButtonsToolbar('village_profile_'));

    const textarea = document.createElement('textarea');
    textarea.id = 'village_profile_note_text';
    textarea.rows = 8;
    textarea.style.width = '100%';
    textarea.placeholder = t('villageProfile.notePlaceholder');
    editor.appendChild(textarea);

    const saveButton = document.createElement('input');
    saveButton.type = 'button';
    saveButton.className = 'btn';
    saveButton.value = t('button.save');
    saveButton.style.marginTop = '5px';
    saveButton.addEventListener('click', async () => {
        await villageProfileNoteSet(villageId, textarea.value);
        renderVillageProfileNote(container, villageId);
        closeVillageProfileNoteEditor(container);
    });
    editor.appendChild(saveButton);

    const cancelButton = document.createElement('input');
    cancelButton.type = 'button';
    cancelButton.className = 'btn';
    cancelButton.value = t('button.cancel');
    cancelButton.style.marginTop = '5px';
    cancelButton.addEventListener('click', () => closeVillageProfileNoteEditor(container));
    editor.appendChild(cancelButton);

    const editorCell = document.createElement('td');
    editorCell.appendChild(editor);
    const editorRow = document.createElement('tr');
    editorRow.id = 'village_profile_note_editor';
    editorRow.style.display = 'none';
    editorRow.appendChild(editorCell);
    table.appendChild(editorRow);
    container.appendChild(table);
    renderVillageProfileNote(container, villageId);
    return container;
}

function injectVillageProfileNote() {
    const villageId = getVillageProfileNoteId();
    const rightColumn = getVillageProfileRightColumn();
    if (!villageId || !rightColumn) return;

    const existing = document.getElementById('village_profile_note');
    const hydration = window.PremiumFeaturesHydration?.villageProfileNotes;
    if (existing) {
        if (hydration?.status !== 'PENDING') {
            renderVillageProfileNote(existing, String(villageId));
            const editLink = existing.querySelector('#village_profile_note_edit');
            if (editLink) {
                editLink.removeAttribute('aria-disabled');
                editLink.style.pointerEvents = '';
            }
        }
        return;
    }

    const container = buildVillageProfileNote(String(villageId));
    rightColumn.insertBefore(container, rightColumn.firstChild);
    if (hydration?.status === 'PENDING') {
        const editLink = container.querySelector('#village_profile_note_edit');
        if (editLink) {
            editLink.setAttribute('aria-disabled', 'true');
            editLink.style.pointerEvents = 'none';
        }
        if (!hydration.villageProfileRefreshRegistered) {
            hydration.villageProfileRefreshRegistered = true;
            hydration.promise.then(injectVillageProfileNote);
        }
    }
}
