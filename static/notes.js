// запросы к серверу
async function api(url, method = 'GET', body) {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) {
        window.location.href = 'index.html';
        return new Promise(() => {});
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
    return data;
}

// разрешены только обычные теги
const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'BR', 'DIV', 'P', 'SPAN']);
// для безопасной обработки текста
function sanitize(html) {
    
    const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
    (function clean(node) {
        [...node.childNodes].forEach(child => {
            if (child.nodeType === Node.TEXT_NODE) return;
            if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); return; }
            if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED'].includes(child.tagName)) {
                child.remove();
                return;
            }
            clean(child);
            if (ALLOWED_TAGS.has(child.tagName)) {
                [...child.attributes].forEach(a => child.removeAttribute(a.name));
            } else {
                child.replaceWith(...child.childNodes); 
            }
        });
    })(doc.body);
    return doc.body.innerHTML;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function stripHtml(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    return doc.body.textContent || '';
}

function isEmptyContent(html) {
    if (!html) return true;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent.trim() === '' && !doc.body.querySelector('ul,ol');
}

function formatDate(ts) {
    return new Date(ts).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

// авторизованный пользователь
api('/api/me').then(({ user }) => {
    document.getElementById('userLabel').textContent = user.name || user.email || '';
});

// тема
if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-theme');
}
document.getElementById('themeToggle').addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark-theme');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
});

// состояние
let notes = [];
let trash = [];
let editingId = null;

const notesGrid = document.getElementById('notesGrid');
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const noteForm = document.getElementById('noteForm');
const noteTitle = document.getElementById('noteTitle');
const noteContent = document.getElementById('noteContent');
const searchInput = document.getElementById('searchInput');
const trashOverlay = document.getElementById('trashOverlay');
const trashList = document.getElementById('trashList');

// загрузка данных с сервера
async function loadNotes() {
    notes = (await api('/api/notes')).notes;
    renderNotes(searchInput.value);
}

async function loadTrash() {
    trash = (await api('/api/trash')).notes;
    renderTrash();
}

// ---------- render ----------
function renderNotes(filter = '') {
    const q = filter.toLowerCase().trim();
    const filtered = notes.filter(n =>
        n.title.toLowerCase().includes(q) ||
        stripHtml(n.content).toLowerCase().includes(q)
    );

    if (filtered.length === 0) {
        notesGrid.innerHTML = `<div class="empty-state">
            ${q ? 'Ничего не найдено. Попробуйте по-другому' : 'Заметок пока нет. Создайте вашу первую заметку!'}
        </div>`;
        return;
    }

    notesGrid.innerHTML = filtered.map(note => `
        <div class="note-card" data-id="${escapeHtml(note.id)}">
            <h3>${escapeHtml(note.title)}</h3>
            <div class="note-content">${sanitize(note.content)}</div>
            <span class="note-date">${formatDate(note.updatedAt)}</span>
            <div class="note-actions">
                <button type="button" class="btn-change" data-action="edit">Изменить</button>
                <button type="button" class="btn-delete" data-action="delete">Удалить</button>
            </div>
        </div>
    `).join('');
}

function renderTrash() {
    if (trash.length === 0) {
        trashList.innerHTML = '<div class="trash-empty">Корзина пуста</div>';
        return;
    }

    trashList.innerHTML = trash.map(note => `
        <div class="trash-item" data-id="${escapeHtml(note.id)}">
            <h4>${escapeHtml(note.title)}</h4>
            <div class="trash-content">${sanitize(note.content)}</div>
            <div class="trash-date">Удалено: ${formatDate(note.deletedAt)}</div>
            <div class="trash-item-actions">
                <button type="button" class="btn-restore" data-action="restore">Восстановить</button>
                <button type="button" class="btn-forever" data-action="forever">Удалить навсегда</button>
            </div>
        </div>
    `).join('');
}

// действие(редактирование, создание, удаление)
function openEditor(id) {
    editingId = id;
    if (id) {
        const note = notes.find(n => n.id === id);
        if (!note) return;
        modalTitle.textContent = 'Редактировать заметку';
        noteTitle.value = note.title;
        noteContent.innerHTML = sanitize(note.content);
    } else {
        modalTitle.textContent = 'Новая заметка';
        noteForm.reset();
        noteContent.innerHTML = '';
    }
    modalOverlay.classList.remove('hidden');
    noteTitle.focus();

    resetHistory();
}

async function moveToTrash(id) {
    try {
        await api(`/api/notes/${id}`, 'DELETE');
        await loadNotes();
    } catch (err) {
        alert(err.message);
    }
}

async function restoreNote(id) {
    try {
        await api(`/api/trash/${id}/restore`, 'POST');
        await loadNotes();
        await loadTrash();
    } catch (err) {
        alert(err.message);
    }
}

async function deleteForever(id) {
    if (!confirm('Удалить заметку навсегда?')) return;
    try {
        await api(`/api/trash/${id}`, 'DELETE');
        await loadTrash();
    } catch (err) {
        alert(err.message);
    }
}

notesGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    const card = e.target.closest('.note-card');
    if (!btn || !card) return;
    const id = Number(card.dataset.id);
    if (btn.dataset.action === 'edit') openEditor(id);
    if (btn.dataset.action === 'delete') moveToTrash(id);
});

trashList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    const item = e.target.closest('.trash-item');
    if (!btn || !item) return;
    const id = Number(item.dataset.id);
    if (btn.dataset.action === 'restore') restoreNote(id);
    if (btn.dataset.action === 'forever') deleteForever(id);
});

document.getElementById('addNoteBtn').addEventListener('click', () => openEditor(null));

// инструменты форматирования
// --- Локальная история для отмены (чтобы не трогать поиск) ---
let editorHistory = [];
let historyIndex = -1;

function resetHistory() {
    editorHistory = [noteContent.innerHTML];
    historyIndex = 0;
}

// Сохраняем историю при вводе
noteContent.addEventListener('input', () => {
    if (isEmptyContent(noteContent.innerHTML)) noteContent.innerHTML = '';
    
    if (editorHistory[historyIndex] === noteContent.innerHTML) return;
    editorHistory = editorHistory.slice(0, historyIndex + 1);
    editorHistory.push(noteContent.innerHTML);
    historyIndex++;
});

// Обработчик кнопок
document.querySelectorAll('.fmt-btn').forEach(btn => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
        const cmd = btn.getAttribute('data-cmd');
        if (!cmd) return;

        e.preventDefault();
        e.stopPropagation();
        noteContent.focus({ preventScroll: true });

        if (cmd === 'undo') {
            // Локальная отмена (только внутри заметки)
            if (historyIndex > 0) {
                historyIndex--;
                noteContent.innerHTML = editorHistory[historyIndex];
            }
        } else {
            // Обычное форматирование (Ж, К, П, списки)
            document.execCommand(cmd, false, null);
            
            if (editorHistory[historyIndex] !== noteContent.innerHTML) {
                editorHistory = editorHistory.slice(0, historyIndex + 1);
                editorHistory.push(noteContent.innerHTML);
                historyIndex++;
            }
        }
    });
});

// --- Ловушка фокуса в модалке (Tab больше не уйдёт в поиск) ---
modalOverlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusable = modalOverlay.querySelectorAll('button, input, [contenteditable="true"]');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
});


noteContent.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
});

// возврат
noteContent.addEventListener('input', () => {
    if (isEmptyContent(noteContent.innerHTML)) noteContent.innerHTML = '';
});

// сохранение
noteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = noteTitle.value.trim();
    const content = sanitize(noteContent.innerHTML).trim();

    if (!title) { noteTitle.focus(); return; }
    if (isEmptyContent(content)) {
        alert('Введите текст заметки.');
        noteContent.focus();
        return;
    }

    try {
        if (editingId) {
            await api(`/api/notes/${editingId}`, 'PUT', { title, content });
        } else {
            await api('/api/notes', 'POST', { title, content });
        }
    } catch (err) {
        alert(err.message);
        return;
    }

    closeModal();
    loadNotes();
});

// модалка
function closeModal() {
    modalOverlay.classList.add('hidden');
    noteForm.reset();
    noteContent.innerHTML = '';
    editingId = null;
}

function closeTrash() {
    trashOverlay.classList.add('hidden');
}

document.getElementById('cancelBtn').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
        const hasText = noteTitle.value.trim() !== '' || noteContent.innerHTML.trim() !== '';
        if (hasText && !confirm('Закрыть без сохранения? Текст будет потерян.')) return;
        closeModal();
    }
});

document.getElementById('trashBtn').addEventListener('click', async () => {
    try {
        await loadTrash();
        trashOverlay.classList.remove('hidden');
    } catch (err) {
        alert(err.message);
    }
});
document.getElementById('closeTrashBtn').addEventListener('click', closeTrash);
trashOverlay.addEventListener('click', (e) => {
    if (e.target === trashOverlay) closeTrash();
});

document.getElementById('clearTrashBtn').addEventListener('click', async () => {
    if (trash.length === 0) return;
    if (!confirm('Очистить корзину? Все заметки будут удалены навсегда.')) return;
    try {
        await api('/api/trash', 'DELETE');
        await loadTrash();
    } catch (err) {
        alert(err.message);
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!modalOverlay.classList.contains('hidden')) closeModal();
    if (!trashOverlay.classList.contains('hidden')) closeTrash();
});

// поиск и выход
searchInput.addEventListener('input', (e) => renderNotes(e.target.value));

document.getElementById('logoutButton').addEventListener('click', async () => {
    if (!confirm('Выйти из аккаунта?')) return;
    await api('/api/logout', 'POST').catch(() => {});
    window.location.href = 'index.html';
});

loadNotes().catch(err => alert(err.message));
