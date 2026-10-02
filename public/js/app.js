
console.log('Gestor de Variables iniciado.');

// ============================================================
// VARIABLES GLOBALES
// ============================================================

const previewItemsPerPage = 5;
const _MAX_POLLING_FAILURES = 5;
const _CHILDREN_CACHE_TTL_MS = 5 * 60 * 1000;
let _lastMessageCount = 0;
let allFolderData = [];
let totalParents = 0;
let parentsPerPage = 5;
let currentParentPage = 1;
let sortField = 'id';
let sortDir = 'asc';
let totalRecords = 0;
let totalPages = 1;
let isLoading = false;
let previewToken = null;
let currentUploadToken = null;
let originalData = [];
let filteredData = [];
let currentSort = [];
let currentFileToUpload = null;
let allPreviewData = [];
let previewCurrentPage = 1;
let currentPage = 1;
let itemsPerPage = 10;
let _currentOtraOpcionCancelCallback = null;
let _previousSelectValue = null;
let folderPreviewData = [];
let folderGlobalMetadata = null;
let currentZipFilename = null;
let isProcessing = false;
let overwriteSet = new Set();
let currentSearchTerm = '';
let _resizeData = null;
let _previewAllExpanded = false;
let _childPage = {};  
let allExpanded = false;
let _searchDebounceTimer2 = null;
let _zipPollingInterval = null;
let _currentZipSession = 0;
let _currentTaskId = null;
let _consecutivePollingFailures = 0;
let _childrenCacheByParent = {};
let _autoScrollRAF = null;
let _autoScrollSpeed = 0;
let _isResizingColumn = false;
let _flowStack = [];
let _flowForwardStack = [];

const COLUMN_WIDTHS = {
    id: '80px',
    proceso: '160px',
    eje: '160px',
    tema: '180px',
    nombre: '280px',
    cobertura: '160px',
    periodicidad: '160px',
    liga_web: '190px',
    fuente: '160px',
    año: '110px',
    valor: '130px',
    estado: '160px'
};

// ============================================================
// FUNCIONES DE UTILIDAD GENERAL
// ============================================================

function getElementsByParentHash(container, parentHash) {
    if (!container) {
        console.warn('⚠️ getElementsByParentHash: container es nulo');
        return [];
    }
    if (parentHash === undefined || parentHash === null) {
        console.warn('⚠️ getElementsByParentHash: parentHash es nulo o indefinido');
        return [];
    }
    const hashStr = String(parentHash);
    console.log(`🔍 Buscando elementos con parentHash: ${hashStr.substring(0, 80)}...`);
    const elements = Array.from(container.querySelectorAll('tr')).filter(tr => {
        const trHash = tr.dataset.parentHash;
        return trHash === hashStr;
    });
    console.log(`   → Encontrados ${elements.length} elementos.`);
    if (elements.length === 0) {
        const allHashes = Array.from(container.querySelectorAll('tr')).map(tr => tr.dataset.parentHash).filter(Boolean);
        console.warn(`   ⚠️ No se encontraron coincidencias. Hashes disponibles (primeros 5):`, allHashes.slice(0, 5));
    }
    return elements;
}

function showSpinner(show) {
    const spinner = document.getElementById('loadingSpinner');
    if (spinner) spinner.style.display = show ? 'flex' : 'none';
}

function formatNumero(val) {
    if (val === undefined || val === null || val === '') return '';
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    return num.toLocaleString('es-MX', { maximumFractionDigits: 2 });
}

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function autoResize(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
}

function autoResizeModal(el) {
    autoResize(el);
}

function togglePasswordField(inputId, buttonEl) {
    const input = document.getElementById(inputId);
    if (!input || !buttonEl) return;
    const open = buttonEl.querySelector('.eye-open');
    const closed = buttonEl.querySelector('.eye-closed');
    if (input.type === 'password') {
        input.type = 'text';
        if (open) open.style.display = 'none';
        if (closed) closed.style.display = 'block';
    } else {
        input.type = 'password';
        if (open) open.style.display = 'block';
        if (closed) closed.style.display = 'none';
    }
}

function syncRowHeights(tr) {
    if (!tr) return;
    const cells = tr.querySelectorAll('td');
    if (cells.length === 0) return;
    let maxHeight = 0;
    cells.forEach(td => {
        td.style.height = 'auto';
        td.style.minHeight = 'auto';
        const h = td.scrollHeight;
        if (h > maxHeight) maxHeight = h;
    });
    if (maxHeight < 28) maxHeight = 28;
    cells.forEach(td => {
        td.style.height = maxHeight + 'px';
        td.style.minHeight = maxHeight + 'px';
    });
    tr.style.height = maxHeight + 'px';
    tr.querySelectorAll('textarea.edit-control').forEach(ta => {
        ta.style.height = (maxHeight - 4) + 'px';
    });
}

function adjustPreviewRowHeights(row) {
    if (!row) return;
    const cells = row.querySelectorAll('td');
    if (cells.length === 0) return;
    cells.forEach(td => {
        td.style.height = 'auto';
        td.style.minHeight = 'auto';
    });
    row.style.height = 'auto';
    const firstTd = cells[0];
    const style = getComputedStyle(firstTd);
    const tdPadding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    let maxHeight = 0;
    cells.forEach(td => {
        const control = td.querySelector('textarea.preview-edit') || td.querySelector('div.preview-edit');
        if (control) {
            control.style.height = 'auto';
            void control.offsetHeight;
            const contentHeight = control.scrollHeight;
            const totalHeight = contentHeight + tdPadding;
            if (totalHeight > maxHeight) maxHeight = totalHeight;
        } else {
            const h = td.scrollHeight;
            if (h > maxHeight) maxHeight = h;
        }
    });
    if (maxHeight < 28) maxHeight = 28;
    const finalHeight = maxHeight + 2;
    cells.forEach(td => {
        td.style.height = finalHeight + 'px';
        td.style.minHeight = finalHeight + 'px';
    });
    row.style.height = finalHeight + 'px';
    row.querySelectorAll('textarea.preview-edit, div.preview-edit').forEach(ctrl => {
        ctrl.style.height = '100%';
        ctrl.style.minHeight = '100%';
    });
}

// ============================================================
// TOAST Y MODALES
// ============================================================

function showToast(msg, isError = false) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.background = isError ? '#C81045' : '#176B61';
    toast.style.color = '#FFFFFF';
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, 5000);
}

function _flashRow(tr, kind) {
    if (!tr) return;
    const cls = kind === 'success' ? 'flash-success' : 'flash-highlight';
    tr.classList.remove('flash-highlight', 'flash-success');
    void tr.offsetWidth; // reflow
    tr.classList.add(cls);
    setTimeout(() => tr.classList.remove(cls), 1600);
}

function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.style.display = 'flex';

    const content = modal.querySelector('.modal-content.draggable');
    if (content) {
        content.style.animation = 'none';
        content.style.transition = 'none';
        content.style.position = 'fixed';
        content.style.transform = 'translate(-50%, -50%)';
        content.style.top = '50%';
        content.style.left = '50%';
        content.style.margin = '0';
        console.log(`🔄 openModal: ${id} centrado directamente`);
    }
}

/**
 * Cancela cualquier polling de ZIP activo y notifica al backend (best-effort).
 * Es idempotente: llamarla mil veces no hace daño.
 */
function _cancelZipPolling() {
    if (_zipPollingInterval) {
        clearTimeout(_zipPollingInterval);
        clearInterval(_zipPollingInterval);   // defensivo: por si quedó un setInterval viejo
        console.log('🛑 _cancelZipPolling: timer limpiado');
        _zipPollingInterval = null;
    }
    if (_currentTaskId) {
        const tid = _currentTaskId;
        _currentTaskId = null;
        // Notificar al backend para que deje de acumular mensajes (fire-and-forget)
        fetch(`/api/cancel-task/${tid}`, { method: 'POST' })
            .then(r => r.json().catch(() => ({})))
            .then(d => console.log(`🛑 Backend cancel-task ${tid}:`, d))
            .catch(err => console.warn('⚠️ No se pudo notificar cancelación al backend:', err));
    }
}


/* ============================================================
   CIERRE DE MODALES: ESC vs CANCELAR
   - ESC: closeModal(id)  → cierra SIN limpiar
   - X / Cancelar: cancelXModal() → limpia y luego cierra
   ============================================================ */

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'none';
    // ⚠️ NO limpiamos aquí. Si el usuario pulsó ESC, quiere poder
    // volver a abrir y encontrar su estado intacto.
    if (id === 'modalFolderUpload') {
        // Solo detenemos el polling para no dejar timers colgando.
        // El estado visual del modal se conserva.
        if (_zipPollingInterval) {
            console.log('⏸️ closeModal(Folder): pausando polling (sin reset)');
            // NO llamamos _cancelZipPolling() para no perder _currentTaskId.
            // Si el usuario vuelve a abrir, resumeTaskPolling() lo retoma.
        }
    }
}

/* ---------- Reset del modal CSV ---------- */
function resetCsvModal() {
    console.log('🧹 resetCsvModal: limpiando estado del modal CSV');
    const input = document.getElementById('csvFileInputModal');
    if (input) input.value = '';

    const previewDiv = document.getElementById('uploadDataPreview');
    if (previewDiv) { previewDiv.style.display = 'none'; previewDiv.innerHTML = ''; }

    const previewMessages = document.getElementById('uploadPreviewMessages');
    if (previewMessages) { previewMessages.style.display = 'none'; previewMessages.innerHTML = ''; }

    const controls = document.getElementById('csvPreviewControls');
    if (controls) controls.style.display = 'none';

    const pagination = document.getElementById('paginationControls');
    if (pagination) pagination.style.display = 'none';

    const confirmBtn = document.getElementById('confirmUploadBtn');
    if (confirmBtn) confirmBtn.disabled = true;

    const chk1 = document.getElementById('selectAllDuplicatesForOverwrite');
    if (chk1) chk1.checked = false;
    const chk2 = document.getElementById('selectAllNonDuplicates');
    if (chk2) chk2.checked = false;
    const catalogMsg = document.getElementById('csvNewCatalogMessage');
    if (catalogMsg) catalogMsg.style.display = 'none';

    allPreviewData = [];
    currentFileToUpload = null;
    previewCurrentPage = 1;
    console.log('✅ resetCsvModal: listo');
}

/* ---------- Reset del modal Discovery (selección de variables) ---------- */
function resetDiscoveryModal() {
    console.log('🧹 resetDiscoveryModal: limpiando estado de discovery');
    _discoveryResults = [];
    _discoverySessionId = null;
    const listEl = document.getElementById('discoveryList');
    if (listEl) listEl.innerHTML = '';
    const summaryEl = document.getElementById('discoverySummary');
    if (summaryEl) summaryEl.textContent = '';
    const countEl = document.getElementById('discoverySelectedCount');
    if (countEl) countEl.textContent = '';
}

/* ---------- Botones X y Cancelar ---------- */
function cancelCsvModal() {
    resetCsvModal();
    closeModal('modalConfirmUpload');
}

function cancelFolderModal() {
    _cancelZipPolling();
    resetFolderModal();
    closeModal('modalFolderUpload');
}

function cancelDiscoveryModal() {
    resetDiscoveryModal();
    closeModal('modalDiscoverVariables');
}

// ============================================================
// MENÚ DE USUARIO
// ============================================================

function toggleUserMenu() {
    const menu = document.getElementById('userDropdownMenu');
    if (menu.style.display === 'block') {
        menu.style.display = 'none';
    } else {
        menu.style.display = 'block';
    }
}

// Cerrar menú al hacer clic fuera
document.addEventListener('click', function(e) {
    const wrapper = document.querySelector('.user-menu-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
        document.getElementById('userDropdownMenu').style.display = 'none';
    }
});

function changeOwnPassword() {
    const modal = document.getElementById('modalChangeOwnPassword');
    const p1 = document.getElementById('ownNewPassword');
    const p2 = document.getElementById('ownConfirmPassword');
    if (p1) { p1.value = ''; p1.type = 'password'; }
    if (p2) { p2.value = ''; p2.type = 'password'; }
    // Resetear iconos del ojo
    modal.querySelectorAll('.password-toggle-btn').forEach(btn => {
        const open = btn.querySelector('.eye-open');
        const closed = btn.querySelector('.eye-closed');
        if (open) open.style.display = 'block';
        if (closed) closed.style.display = 'none';
    });
    document.getElementById('userDropdownMenu').style.display = 'none';
    modal.style.display = 'flex';
}

async function confirmChangeOwnPassword() {
    const p1 = document.getElementById('ownNewPassword');
    const p2 = document.getElementById('ownConfirmPassword');
    const newPass = (p1?.value || '').trim();
    const confirmPass = (p2?.value || '').trim();

    if (newPass.length < 6) {
        showToast('⚠️ La contraseña debe tener al menos 6 caracteres', true);
        return;
    }
    if (newPass !== confirmPass) {
        showToast('⚠️ Las contraseñas no coinciden', true);
        return;
    }

    const btn = document.getElementById('btnConfirmOwnPassword');
    btn.disabled = true;
    try {
        const resp = await fetch('/api/change-own-password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: newPass })
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
            showToast('✅ Contraseña actualizada');
            closeModal('modalChangeOwnPassword');
        } else {
            showToast('❌ ' + (data.error || 'No se pudo actualizar'), true);
        }
    } catch (e) {
        showToast('Error de conexión', true);
    } finally {
        btn.disabled = false;
    }
}

// ============================================================
// REDIMENSIONAMIENTO DE COLUMNAS
// ============================================================

function initColumnResize(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    // Quitar manejadores previos para evitar duplicados
    table.removeEventListener('mousedown', _resizeMouseDown);
    table.addEventListener('mousedown', _resizeMouseDown);
}

function _resizeMouseDown(e) {
    const target = e.target;
    if (!target.classList.contains('resize-handle')) return;
    const th = target.closest('th');
    if (!th) return;
    const table = th.closest('table');
    const colIndex = th.cellIndex;
    const startX = e.clientX;
    const startWidth = th.offsetWidth;
    _resizeData = { table, colIndex, startX, startWidth };
    _isResizingColumn = true;
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', _resizeMouseMove);
    document.addEventListener('mouseup', _resizeMouseUp);
    e.preventDefault();
    e.stopPropagation();
}

function _resizeMouseMove(e) {
    if (!_resizeData) return;
    const dx = e.clientX - _resizeData.startX;
    const newWidth = Math.max(50, _resizeData.startWidth + dx);
    const colIndex = _resizeData.colIndex;
    const table = _resizeData.table;
    // Aplicar a todas las filas (incluyendo el thead)
    const rows = table.querySelectorAll('tr');
    rows.forEach(row => {
        const cell = row.cells[colIndex];
        if (cell) {
            cell.style.width = newWidth + 'px';
            cell.style.minWidth = newWidth + 'px';
            cell.style.maxWidth = newWidth + 'px';
        }
    });
}

function _resizeMouseUp() {
    document.removeEventListener('mousemove', _resizeMouseMove);
    document.removeEventListener('mouseup', _resizeMouseUp);
    _resizeData = null;
    document.body.style.cursor = '';
    // ⚠️ NO soltamos el flag sincrónicamente: el navegador dispara un 'click'
    // justo después del mouseup, y ese click burbujea hasta el <th>.
    // Dejamos el flag activo unos ms para que el click lo vea.
    setTimeout(() => { _isResizingColumn = false; }, 60);
}

// Agregar handles de redimensionamiento a los ths de una tabla
function addResizeHandles(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const ths = table.querySelectorAll('th');
    ths.forEach(th => {
        if (th.querySelector('.resize-handle')) return;
        const handle = document.createElement('span');
        handle.className = 'resize-handle';
        th.appendChild(handle);
    });
    initColumnResize(tableId);
}

// ============================================================
// NAVEGACIÓN POR VISTAS Y SIDEBAR
// ============================================================

function switchView(view, linkElement) {
    document.querySelectorAll('.view-container').forEach(el => el.classList.remove('active'));
    const targetView = document.getElementById('view-' + view);
    if (targetView) targetView.classList.add('active');

    const labelMap = {
        'variables': '📊 Variables',
        'users': '👥 Usuarios',
        'history': '🕘 Cargas'
    };
    const labelEl = document.getElementById('currentViewLabel');
    if (labelEl) labelEl.textContent = labelMap[view] || view;

    document.querySelectorAll('#viewDropdownMenu a').forEach(a => a.classList.remove('active'));
    if (linkElement && linkElement.closest('#viewDropdownMenu')) {
        linkElement.classList.add('active');
    }

    const menu = document.getElementById('viewDropdownMenu');
    if (menu) menu.style.display = 'none';

    closeSidebar();
    document.querySelectorAll('.sidebar-item').forEach(item => item.classList.remove('active'));
    if (linkElement && linkElement.closest('.sidebar')) {
        linkElement.classList.add('active');
    } else {
        const item = document.querySelector(`.sidebar-item[data-view="${view}"]`);
        if (item) item.classList.add('active');
    }

    if (view === 'users') {
        // Salir del modo edición al entrar a la vista
        _userEditMode = false;
        _userEditDirty = {};
        updateUserEditUI();
        loadUsers();
    } else if (view === 'history') {
        loadHistory();
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
    const menuBtn = document.getElementById('menuToggleBtn');
    if (menuBtn) menuBtn.classList.remove('active');
}

function toggleViewMenu() {
    const menu = document.getElementById('viewDropdownMenu');
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

// ============================================================
// FUNCIONES DE LA TABLA PRINCIPAL (loadData, renderTable, etc.)
// ============================================================

async function loadData(page = 1, pageSize = itemsPerPage, sort = sortField, dir = sortDir, search = currentSearchTerm) {
    _clearSelection();
    // 1) Guardar qué padres están expandidos AHORA (antes de re-renderizar).
    const expandedIds = new Set();
    document.querySelectorAll('#dataTable tbody tr.parent-row').forEach(tr => {
        const btn = tr.querySelector('.expand-btn');
        if (btn && (btn.textContent === '▾' || btn.textContent === '▼')) {
            const pid = tr.dataset.id;
            if (pid) expandedIds.add(pid);
        }
    });

    showSpinner(true);
    try {
        const url = `/api/variables?page=${page}&page_size=${pageSize}&sort_field=${sort}&sort_dir=${dir}&search=${encodeURIComponent(search)}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('Error al cargar datos');
        const json = await resp.json();
        totalRecords = json.total || 0;
        const totalPages = json.total_pages || 1;
        document.getElementById('totalPagesSpan').textContent = totalPages;
        document.getElementById('pageInput').value = page;
        document.getElementById('pageInfo').textContent = `Mostrando ${json.data.length} padres de ${totalRecords}`;
        renderTable(json.data);
        updatePaginationButtons(page, totalPages);
        setTimeout(() => addResizeHandles('dataTable'), 50);

        // 2) Re-expandir padres que estaban abiertos y siguen en la página.
        if (expandedIds.size > 0) {
            json.data.forEach(parent => {
                if (expandedIds.has(parent.id)) {
                    const expandBtn = document.querySelector(
                        `#dataTable tbody tr.parent-row[data-id="${parent.id}"] .expand-btn`
                    );
                    if (expandBtn && (expandBtn.textContent === '▸' || expandBtn.textContent === '▶')) {
                        expandBtn.click();
                    }
                }
            });
        }

        // 3) Si hay búsqueda, auto-expandir los padres con hijos que coinciden.
        if (search && search.trim() !== '') {
            json.data.forEach(parent => {
                if (parent._matching_children && parent._matching_children.length > 0) {
                    const expandBtn = document.querySelector(
                        `#dataTable tbody tr.parent-row[data-id="${parent.id}"] .expand-btn`
                    );
                    if (expandBtn && (expandBtn.textContent === '▸' || expandBtn.textContent === '▶')) {
                        expandBtn.click();
                    }
                }
            });
        }
    } catch (e) {
        showToast('Error al cargar datos: ' + e.message, true);
    } finally {
        showSpinner(false);
    }
}

function renderTable(parents) {
    const tbody = document.querySelector('#dataTable tbody');
    tbody.innerHTML = '';
    if (!parents || parents.length === 0) {
        const colCount = (window.COLUMN_DEFINITIONS || []).length + 2;
        tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center; padding:30px 20px; color:var(--text-muted); font-size:1.1rem;">No hay variables</td></tr>`;
        return;
    }
    const colDefs = window.COLUMN_DEFINITIONS || [];
    console.log(`🔍 renderTable: ${parents.length} padres a renderizar`);

    parents.forEach((parent, idx) => {
        const tr = document.createElement('tr');
        tr.dataset.id = parent.id;
        tr.dataset.hash = parent._hash || `parent_${idx}`;
        tr.classList.add('parent-row');

        // --- Drag & drop para agrupar ---
        tr.draggable = true;
        tr.addEventListener('dragstart', function(e) {
            handleRowDragStart(e, parent.id, tr);
        });
        tr.addEventListener('dragover', function(e) {
            if (!window._draggedRowIds || window._draggedRowIds.length === 0) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            tr.classList.add('drag-over-row');
        });
        tr.addEventListener('dragleave', function() {
            tr.classList.remove('drag-over-row');
        });
        tr.addEventListener('drop', function(e) {
            handleRowDrop(e, parent.id, tr);
        });
        tr.addEventListener('dragend', function() {
            document.querySelectorAll('#dataTable tr.dragging-row').forEach(r => r.classList.remove('dragging-row'));
            document.querySelectorAll('#dataTable tr.drag-over-row').forEach(r => r.classList.remove('drag-over-row'));
            window._draggedRowIds = null;
        });
        // prefetch de hijos al hacer hover sobre la fila padre
        tr.addEventListener('mouseenter', function() {
            const pid = String(this.dataset.id);
            if (!pid) return;
            const cacheKey = `${pid}|0|100|${currentSearchTerm || ''}`;
            if (_childrenCacheByParent[cacheKey]) return;

            clearTimeout(this._prefetchTimer);
            this._prefetchTimer = setTimeout(() => {
                const searchQS = currentSearchTerm && currentSearchTerm.trim()
                    ? `&search=${encodeURIComponent(currentSearchTerm.trim())}` : '';
                fetch(`/api/variables/${pid}/children?offset=0&limit=100${searchQS}`)
                    .then(r => r.ok ? r.json() : null)
                    .then(data => {
                        if (!data) return;
                        _childrenCacheByParent[cacheKey] = {
                            children: data.children || [],
                            total: data.total || 0,
                            ts: Date.now()
                        };
                        console.log(`♻️ Prefetch hijos de ${pid}: ${data.children?.length || 0}`);
                    })
                    .catch(() => {});
            }, 250);
        });

        // ============================================================
        // Columna 1: expandir — flecha ▸ / ▾
        // ============================================================
        const tdExpand = document.createElement('td');
        tdExpand.style.cssText = 'text-align:center; vertical-align:top; padding:6px 4px;';
        const expandBtn = document.createElement('span');
        expandBtn.className = 'expand-btn';
        expandBtn.textContent = '▸';   // ← cambio: ▶ → ▸
        expandBtn.dataset.parentId = parent.id;
        expandBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleChildren(this.dataset.parentId, this);
        });
        tdExpand.appendChild(expandBtn);
        tr.appendChild(tdExpand);

        // ============================================================
        // Columna 2: checkbox
        // ============================================================
        const tdCheck = document.createElement('td');
        tdCheck.style.cssText = 'text-align:center; vertical-align:top; padding:6px 4px;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'row-checkbox';
        cb.dataset.id = parent.id;
        cb.style.marginTop = '4px';
        // Restaurar estado si ya estaba seleccionado
        if (_selectedIds.has(String(parent.id))) cb.checked = true;
        cb.addEventListener('change', function () {
            const pid = String(this.dataset.id);
            const isChecked = this.checked;
            _syncCheckboxToSet(this);

            // Sincronizar hijos VISIBLES (barato)
            document.querySelectorAll(
                `#dataTable tbody tr.child-row[data-parent-id="${pid}"] input.row-checkbox`
            ).forEach(childCb => {
                childCb.checked = isChecked;
                _syncCheckboxToSet(childCb);
            });

            // Sincronización con TODOS los hijos (vía API) — solo si no es drag-select
            if (!_dragSelectActive) {
                if (isChecked) _selectAllChildrenOf(pid);
                else _deselectAllChildrenOf(pid);
            }
        });
        tdCheck.appendChild(cb);
        tr.appendChild(tdCheck);

        // ============================================================
        // Resto de columnas
        // ============================================================
        colDefs.forEach(col => {
            const td = document.createElement('td');
            const width = COLUMN_WIDTHS[col.keyName] || 'auto';
            td.style.cssText = `width:${width}; min-width:${width}; max-width:${width}; padding:2px 4px; vertical-align:top;`;
            let val = parent[col.keyName] !== undefined ? String(parent[col.keyName]) : '';

            // nombre en minúsculas PERO capitalizado al inicio y tras cada guion
            if (col.keyName === 'nombre' && val) {
                val = val.toLowerCase();
                // Capitaliza primera letra y después de " - " (guion rodeado de espacios)
                val = val.replace(/(^|\s-\s+)([a-záéíóúñü])/gi, (m, p1, p2) => p1 + p2.toUpperCase());
                // También capitaliza tras guion simple sin espacios al inicio de palabra
                val = val.replace(/(?<=\s-\s)([a-záéíóúñü])/gi, (m) => m.toUpperCase());
            }
            if (col.keyName === 'valor' && val !== '' && !isNaN(val)) val = formatNumero(val);
            if (['proceso','eje','tema'].includes(col.keyName) && val.trim() === '') {
                val = 'Asignar manualmente';
            }
            const control = createEditableControl(col, val, parent.id);
            td.appendChild(control);
            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });
    requestAnimationFrame(() => {
        document.querySelectorAll('#dataTable tbody tr').forEach(tr => syncRowHeights(tr));
    });
}

function createEditableControl(colDef, value, rowId) {
    const key = colDef.keyName;
    const isReadonly = colDef.readonly || false;
    const isSelect = colDef.type === 'select' && colDef.options && colDef.options.length > 0;

    if (isSelect && !isReadonly) {
        const wrap = document.createElement('div');
        wrap.className = 'select-wrap';

        const display = document.createElement('div');
        display.className = 'select-display';
        const hasValue = value && String(value).trim() !== '' && value !== 'Asignar manualmente';
        display.textContent = hasValue ? value : (value === 'Asignar manualmente' ? value : 'Seleccionar...');
        if (!hasValue && value !== 'Asignar manualmente') display.style.color = 'var(--text-muted)';

        const select = document.createElement('select');
        select.dataset.col = key;
        select.dataset.rowId = rowId;

        const optDefault = document.createElement('option');
        optDefault.value = '';
        optDefault.textContent = 'Seleccionar...';
        select.appendChild(optDefault);
        colDef.options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt;
            option.textContent = opt;
            if (opt === value) option.selected = true;
            select.appendChild(option);
        });
        const optOther = document.createElement('option');
        optOther.value = '__otra__';
        optOther.textContent = '+ Otra…';
        select.appendChild(optOther);

        select.addEventListener('change', async function(e) {
            if (this.value === '__otra__') {
                openOtraOpcionModal(key, rowId);
                this.value = '';
                return;
            }
            const newVal = this.value;
            display.textContent = newVal || 'Seleccionar...';
            display.style.color = '';

            // determinar si es padre, actualizar hijos en vivo y mostrar spinner
            const tr = this.closest('tr');
            const isParent = tr && tr.classList.contains('parent-row');
            const rowIdStr = String(rowId);

            if (isParent && tr) {
                // Spinner sobre la fila padre
                tr.classList.add('row-updating');
                const sp = document.createElement('div');
                sp.className = 'row-update-spinner';
                tr.appendChild(sp);

                // Actualizar DOM de hijos VISIBLES inmediatamente
                document.querySelectorAll(`#dataTable tbody tr.child-row[data-parent-id="${rowIdStr}"]`).forEach(childTr => {
                    const cell = childTr.querySelector(`[data-col="${key}"]`);
                    if (!cell) return;
                    if (cell.tagName === 'SELECT') {
                        cell.value = newVal;
                        const wrap = cell.closest('.select-wrap');
                        const disp = wrap ? wrap.querySelector('.select-display') : null;
                        if (disp) { disp.textContent = newVal || 'Seleccionar...'; disp.style.color = ''; }
                    } else if (cell.tagName === 'INPUT' || cell.tagName === 'TEXTAREA') {
                        cell.value = newVal;
                    }
                });

                // Refrescar caché de hijos
                Object.keys(_childrenCacheByParent).forEach(k => {
                    if (k.startsWith(rowIdStr + '|')) {
                        _childrenCacheByParent[k].children.forEach(c => { c[key] = newVal; });
                    }
                });
            }

            try {
                await updateCell(rowId, key, newVal);
                if (isParent && tr) _flashRow(tr, 'success');
            } finally {
                if (tr) {
                    tr.classList.remove('row-updating');
                    const sp = tr.querySelector('.row-update-spinner');
                    if (sp) sp.remove();
                }
            }
        });

        wrap.appendChild(display);
        wrap.appendChild(select);
        return wrap;
    } else if (key === 'nombre' || key === 'liga_web' || key === 'fuente') {
        const textarea = document.createElement('textarea');
        textarea.className = 'edit-control';
        textarea.dataset.col = key;
        textarea.dataset.rowId = rowId;
        textarea.value = value;
        textarea.rows = 1;
        textarea.style.overflow = 'hidden';
        textarea.addEventListener('input', function() { autoResize(this); updateCell(rowId, key, this.value); });
        if (isReadonly) { textarea.disabled = true; textarea.classList.add('read-only-input'); }
        setTimeout(() => autoResize(textarea), 0);
        return textarea;
    } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'edit-control';
        input.dataset.col = key;
        input.dataset.rowId = rowId;
        input.value = value;
        if (isReadonly) {
            input.disabled = true;
            input.classList.add('read-only-input');
            input.style.cssText = 'width:100%; padding:2px 4px; font-size:0.8em; background:transparent; border:none; color:var(--text-main); display:block; margin:0;';
        } else {
            input.addEventListener('change', function() { updateCell(rowId, key, this.value); });
        }
        return input;
    }
}

async function updateCell(rowId, col, value) {
    try {
        const resp = await fetch(`/api/variables/${rowId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [col]: value })
        });
        if (!resp.ok) {
            const err = await resp.json();
            showToast('Error al actualizar: ' + (err.error || ''), true);
        } else {
            showToast('✅ Actualizado');
        }
    } catch (e) {
        showToast('Error de conexión', true);
    }
}

let _parentChildrenPage = {};  // { parentId: page }

async function toggleChildren(parentId, btn) {
    const isExpanded = btn.textContent === '▾' || btn.textContent === '▼';
    if (isExpanded) {
        // Colapsar
        document.querySelectorAll(`#dataTable tr.child-row[data-parent-id="${parentId}"]`).forEach(r => r.remove());
        document.querySelectorAll(`#dataTable tr.child-pagination-row[data-parent-id="${parentId}"]`).forEach(r => r.remove());
        btn.textContent = '▸';
        return;
    }
    // Expandir (por defecto en la página guardada o 1)
    const page = _parentChildrenPage[parentId] || 1;
    await loadChildrenForParentTable(parentId, btn, page);
}

async function loadChildrenForParentTable(parentId, btn, page) {
    const parentRow = document.querySelector(`#dataTable tr[data-id="${parentId}"]`);
    if (!parentRow) { console.warn(`⚠️ No se encontró la fila padre ${parentId}`); return; }
    if (btn.dataset.loading === 'true') return;
    btn.dataset.loading = 'true';

    // Eliminar hijos y paginación previos
    document.querySelectorAll(`#dataTable tr.child-row[data-parent-id="${parentId}"]`).forEach(r => r.remove());
    document.querySelectorAll(`#dataTable tr.child-pagination-row[data-parent-id="${parentId}"]`).forEach(r => r.remove());

    const limit = 100;
    if (!page || page < 1) page = 1;
    const offset = (page - 1) * limit;

    // cache por (parentId, offset, search)
    const cacheKey = `${parentId}|${offset}|${limit}|${currentSearchTerm || ''}`;
    const now = Date.now();
    const cached = _childrenCacheByParent[cacheKey];
    let children, total, totalPages;

    if (cached && (now - cached.ts) < _CHILDREN_CACHE_TTL_MS) {
        children = cached.children;
        total = cached.total;
        totalPages = Math.max(1, Math.ceil(total / limit));
        console.log(
            `♻️ loadChildrenForParentTable: cache HIT parent=${parentId} ` +
            `search='${(currentSearchTerm || '').substring(0, 40)}...' ` +
            `→ ${children.length} filas (total=${total})`
        );
    } else {
        try {
            const searchQS = currentSearchTerm && currentSearchTerm.trim()
                ? `&search=${encodeURIComponent(currentSearchTerm.trim())}` : '';
            const resp = await fetch(`/api/variables/${parentId}/children?offset=${offset}&limit=${limit}${searchQS}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            children = data.children || [];
            total = data.total || 0;
            totalPages = Math.max(1, Math.ceil(total / limit));
            _childrenCacheByParent[cacheKey] = { children, total, ts: now };
            console.log(`📥 loadChildrenForParentTable: ${children.length} hijos cargados desde API`);
        } catch (e) {
            console.error('❌ Error en loadChildrenForParentTable:', e);
            showToast('Error al cargar hijos: ' + e.message, true);
            btn.dataset.loading = 'false';
            return;
        }
    }

    _parentChildrenPage[parentId] = page;

    if (children.length === 0) {
        showToast('Este padre no tiene hijos.');
        btn.textContent = '▸';
        btn.dataset.loading = 'false';
        return;
    }

    const colDefs = window.COLUMN_DEFINITIONS || [];
    const fragment = document.createDocumentFragment();

    children.forEach(child => {
        const tr = document.createElement('tr');
        tr.className = 'child-row';
        tr.dataset.parentId = parentId;
        tr.dataset.id = child.id;
        tr.dataset.hash = child._hash || `child_${child.id}`;

        tr.draggable = true;
        tr.addEventListener('dragstart', function(e) { handleRowDragStart(e, child.id, tr); });
        tr.addEventListener('dragover', function(e) {
            if (!window._draggedRowIds || window._draggedRowIds.length === 0) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            tr.classList.add('drag-over-row');
        });
        tr.addEventListener('dragleave', function() { tr.classList.remove('drag-over-row'); });
        tr.addEventListener('drop', function(e) { handleRowDrop(e, child.id, tr); });
        tr.addEventListener('dragend', function() {
            document.querySelectorAll('#dataTable tr.dragging-row').forEach(r => r.classList.remove('dragging-row'));
            document.querySelectorAll('#dataTable tr.drag-over-row').forEach(r => r.classList.remove('drag-over-row'));
            window._draggedRowIds = null;
        });

        const td1 = document.createElement('td');
        td1.style.cssText = 'width:56px; min-width:56px; max-width:56px; padding-left:24px; vertical-align:top;';
        td1.innerHTML = '&nbsp;';
        tr.appendChild(td1);

        const td2 = document.createElement('td');
        td2.style.cssText = 'width:90px; min-width:90px; max-width:90px; text-align:center; vertical-align:top; padding:6px 4px;';
        const cbChild = document.createElement('input');
        cbChild.type = 'checkbox';
        cbChild.className = 'row-checkbox';
        cbChild.dataset.id = child.id;
        cbChild.style.marginTop = '4px';
        if (_selectedIds.has(String(child.id))) cbChild.checked = true;
        cbChild.addEventListener('change', function () { _syncCheckboxToSet(this); });
        td2.appendChild(cbChild);
        tr.appendChild(td2);

        colDefs.forEach(col => {
            const td = document.createElement('td');
            const width = COLUMN_WIDTHS[col.keyName] || 'auto';
            td.style.cssText = `width:${width}; min-width:${width}; max-width:${width}; padding:2px 4px; vertical-align:top;`;
            let val = (child[col.keyName] !== undefined && child[col.keyName] !== null) ? String(child[col.keyName]) : '';
            if (col.keyName === 'nombre' && val) {
                val = val.toLowerCase();
                val = val.replace(/(^|\s-\s+)([a-záéíóúñü])/gi, (m, p1, p2) => p1 + p2.toUpperCase());
            }
            if (col.keyName === 'valor' && val !== '' && !isNaN(val)) val = formatNumero(val);
            if (['proceso','eje','tema'].includes(col.keyName) && val.trim() === '') {
                val = 'Asignar manualmente';
            }
            const control = createEditableControl(col, val, child.id);
            td.appendChild(control);
            tr.appendChild(td);
        });

        fragment.appendChild(tr);
    });

    if (totalPages > 1) {
        const pagTr = document.createElement('tr');
        pagTr.className = 'child-pagination-row';
        pagTr.dataset.parentId = parentId;
        const pagTd = document.createElement('td');
        pagTd.colSpan = 2 + colDefs.length;
        pagTd.style.cssText = 'text-align:center; padding:8px; background:var(--selection-gray);';

        const prevBtn = document.createElement('button');
        prevBtn.className = 'btn btn-outline';
        prevBtn.textContent = '◀ Mostrar las anteriores 100 filas';
        prevBtn.disabled = page <= 1;
        prevBtn.style.marginRight = '10px';
        prevBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            loadChildrenForParentTable(parentId, btn, page - 1);
        });

        const info = document.createElement('span');
        info.textContent = ` Página ${page} de ${totalPages} (${total} filas) `;
        info.style.margin = '0 10px';
        info.style.fontSize = '0.85em';

        const nextBtn = document.createElement('button');
        nextBtn.className = 'btn btn-outline';
        nextBtn.textContent = 'Mostrar las siguientes 100 filas ▶';
        nextBtn.disabled = page >= totalPages;
        nextBtn.style.marginLeft = '10px';
        nextBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            loadChildrenForParentTable(parentId, btn, page + 1);
        });

        pagTd.appendChild(prevBtn);
        pagTd.appendChild(info);
        pagTd.appendChild(nextBtn);
        pagTr.appendChild(pagTd);
        fragment.appendChild(pagTr);
    }

    parentRow.parentNode.insertBefore(fragment, parentRow.nextSibling);
    btn.textContent = '▾';
    btn.dataset.loading = 'false';

    requestAnimationFrame(() => {
        document.querySelectorAll(`#dataTable tr.child-row[data-parent-id="${parentId}"]`).forEach(row => syncRowHeights(row));
        syncRowHeights(parentRow);
    });
}

// ============================================================
// PAGINACIÓN Y BÚSQUEDA
// ============================================================

function goToPage(page) {
    let p = parseInt(page);
    if (isNaN(p) || p < 1) p = 1;
    const totalPages = parseInt(document.getElementById('totalPagesSpan').textContent) || 1;
    if (p > totalPages) p = totalPages;
    currentPage = p;
    loadData(currentPage, itemsPerPage, sortField, sortDir, currentSearchTerm);
}

function nextPage() {
    const totalPages = parseInt(document.getElementById('totalPagesSpan').textContent) || 1;
    if (currentPage < totalPages) goToPage(currentPage + 1);
}

function prevPage() {
    if (currentPage > 1) goToPage(currentPage - 1);
}

function changeItemsPerPage(val) {
    itemsPerPage = parseInt(val) || 10;
    currentPage = 1;
    loadData(currentPage, itemsPerPage, sortField, sortDir, currentSearchTerm);
}

function updatePaginationButtons(page, totalPages) {
    document.getElementById('prevPageBtnTable').disabled = (page <= 1);
    document.getElementById('nextPageBtnTable').disabled = (page >= totalPages);
}

// ============================================================
// BÚSQUEDA CON DEBOUNCE 
// ============================================================

function handleSearchKeydown(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        triggerSearch();
    }
}

function triggerSearch() {
    const input = document.getElementById('searchInput');
    if (!input) return;
    const val = input.value.trim();
    currentSearchTerm = val;
    currentPage = 1;
    console.log(`🔍 triggerSearch: buscando '${val}'`);
    hideSuggestions();
    loadData(currentPage, itemsPerPage, sortField, sortDir, val);
}

// Compat: por si algo viejo la llama
function handleSearch() { triggerSearch(); }

async function fetchSuggestions(q) {
    try {
        if (!q || q.length < 2) return;
        console.log(`🔍 fetchSuggestions: q='${q}'`);
        const resp = await fetch(`/api/search-suggestions?q=${encodeURIComponent(q)}`);
        if (!resp.ok) {
            console.warn('⚠️ fetchSuggestions: respuesta no OK', resp.status);
            return;
        }
        const data = await resp.json();
        const suggestions = data.suggestions || [];
        console.log(`   → ${suggestions.length} sugerencias recibidas:`, suggestions);
        renderSuggestions(suggestions);
    } catch (e) {
        console.warn('⚠️ Error al obtener sugerencias:', e);
    }
}

// ============================================================
// AUTOCOMPLETADO DE BÚSQUEDA
// ============================================================
let _searchDebounceTimer = null;
let _suggestionsContainer = null;

function initSearchAutocomplete() {
    const input = document.getElementById('searchInput');
    if (!input) {
        console.warn('⚠️ initSearchAutocomplete: no se encontró #searchInput');
        return;
    }
    if (input.dataset.autocompleteInitialized === 'true') return;
    input.dataset.autocompleteInitialized = 'true';

    // ✅ FIX #2: adjuntar el dropdown a .search-wrapper (overflow: visible),
    // NO a .search-input-group (overflow: hidden → recortaba el dropdown).
    const wrapper = input.closest('.search-wrapper') || input.parentElement;
    if (!wrapper) {
        console.warn('⚠️ initSearchAutocomplete: no se encontró contenedor');
        return;
    }
    wrapper.style.position = 'relative';
    console.log('🔍 initSearchAutocomplete: dropdown se adjuntará a',
                wrapper.className || wrapper.tagName);

    // Eliminar dropdown previo si existía (por si se re-inicializa).
    const prev = document.getElementById('searchSuggestionsDropdown');
    if (prev) prev.remove();

    const dropdown = document.createElement('div');
    dropdown.id = 'searchSuggestionsDropdown';
    dropdown.style.cssText = `
        position: absolute;
        top: calc(100% + 2px);
        left: 0;
        right: 0;
        background: var(--panel-bg, #ffffff);
        color: var(--text-main, #212529);
        border: 1px solid var(--border, #DEE2E6);
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        max-height: 320px;
        overflow-y: auto;
        z-index: 99999;
        display: none;
    `;
    wrapper.appendChild(dropdown);
    _suggestionsContainer = dropdown;

    input.addEventListener('input', function() {
        const q = this.value.trim();
        clearTimeout(_searchDebounceTimer);
        if (q.length < 2) {
            hideSuggestions();
            return;
        }
        _searchDebounceTimer = setTimeout(() => fetchSuggestions(q), 180);
    });

    input.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') hideSuggestions();
    });

    document.addEventListener('click', function(e) {
        if (!wrapper.contains(e.target)) hideSuggestions();
    });

    console.log('✅ initSearchAutocomplete: listo (wrapper=' +
                (wrapper.className || wrapper.tagName) + ')');
}

function hideSuggestions() {
    if (_suggestionsContainer) {
        _suggestionsContainer.style.display = 'none';
    }
}

function renderSuggestions(suggestions) {
    if (!_suggestionsContainer) {
        console.warn('⚠️ renderSuggestions: _suggestionsContainer es null');
        return;
    }
    if (!suggestions || suggestions.length === 0) {
        hideSuggestions();
        return;
    }
    let html = '';
    suggestions.forEach(s => {
        const safe = String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        html += `<div class="search-suggestion-item"
                      data-value="${safe.replace(/"/g, '&quot;')}"
                      style="padding:8px 12px; cursor:pointer; font-size:0.85em;
                             border-bottom:1px solid var(--border, #DEE2E6);
                             color: var(--text-main, #212529);">
            🔎 ${safe}
        </div>`;
    });
    _suggestionsContainer.innerHTML = html;
    _suggestionsContainer.style.display = 'block';
    console.log(`✅ renderSuggestions: mostrando ${suggestions.length} sugerencias`);

    _suggestionsContainer.querySelectorAll('.search-suggestion-item').forEach(item => {
        item.addEventListener('click', function() {
            const val = this.dataset.value;
            const input = document.getElementById('searchInput');
            if (input) input.value = val;
            hideSuggestions();
            currentSearchTerm = val;
            currentPage = 1;
            loadData(currentPage, itemsPerPage, sortField, sortDir, val);
        });
        item.addEventListener('mouseenter', function() {
            this.style.background = 'var(--selection-gray, #E9ECEF)';
        });
        item.addEventListener('mouseleave', function() {
            this.style.background = '';
        });
    });
}

// ============================================================
// ORDENACIÓN (sencilla, pero con soporte para múltiple)
// ============================================================

function sortTable(field, event) {
    const shift = event && event.shiftKey;
    if (!shift) {
        // Orden simple: si es el mismo campo, invertir; si no, asc
        if (sortField === field) {
            sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
        } else {
            sortField = field;
            sortDir = 'asc';
        }
        currentSort = [{ key: field, dir: sortDir }];
    } else {
        // Orden múltiple: añadir o quitar criterio
        const idx = currentSort.findIndex(s => s.key === field);
        if (idx === -1) {
            currentSort.push({ key: field, dir: 'asc' });
        } else {
            // Si ya está, invertir dirección o quitar
            if (currentSort[idx].dir === 'asc') {
                currentSort[idx].dir = 'desc';
            } else {
                currentSort.splice(idx, 1);
            }
        }
        if (currentSort.length === 0) {
            currentSort = [{ key: 'id', dir: 'asc' }];
        }
        sortField = currentSort[0].key;
        sortDir = currentSort[0].dir;
    }
    currentPage = 1;
    loadData(currentPage, itemsPerPage, sortField, sortDir, currentSearchTerm);
    renderHeaders();
}

function renderHeaders() {
    const hr = document.getElementById('headerRow');
    if (!hr) return;
    while (hr.children.length > 2) {
        hr.removeChild(hr.lastChild);
    }

    // Primera columna: expand-all
    const firstTh = hr.children[0];
    if (firstTh) {
        firstTh.style.width = '56px';
        firstTh.style.minWidth = '56px';
        firstTh.style.maxWidth = '56px';
        firstTh.style.textAlign = 'center';
        firstTh.style.verticalAlign = 'middle';
    }

    //  Segunda columna "Seleccionar" a 140px, centrada
    const thTitle = hr.children[1];
    if (thTitle) {
        thTitle.style.width = '140px';
        thTitle.style.minWidth = '140px';
        thTitle.style.maxWidth = '140px';
        thTitle.style.textAlign = 'center';
        thTitle.style.verticalAlign = 'middle';
        thTitle.style.cursor = 'pointer';
        thTitle.style.userSelect = 'none';
        thTitle.innerHTML = '<span id="masterSelectLabelTable" title="Seleccionar/deseleccionar todas las filas de la página">Seleccionar</span>';
        thTitle.onclick = function (e) {
            // ✅ FIX #1: si venimos de un resize, ignorar el click fantasma.
            if (_isResizingColumn) {
                console.log('🖱️ renderHeaders: click ignorado (venía de un resize)');
                return;
            }
            // ✅ FIX #1b: si el click tocó directamente el handle, ignorar.
            if (e.target && e.target.closest && e.target.closest('.resize-handle')) {
                return;
            }
            e.stopPropagation();
            _toggleMasterSelect();
        };
    }

    const colDefs = window.COLUMN_DEFINITIONS || [];
    colDefs.forEach(col => {
        const th = document.createElement('th');
        th.dataset.sortField = col.keyName;
        const sortIdx = currentSort.findIndex(s => s.key === col.keyName);
        const isActive = sortIdx !== -1;
        const dir = isActive ? currentSort[sortIdx].dir : '';
        const orderNum = isActive ? sortIdx + 1 : '';
        th.innerHTML = `<div class="th-content">
            <span class="th-label">${escapeHtml(col.displayName)}</span>
            <div class="sort-indicators">
                <span class="tri-up" onclick="sortTable('${col.keyName}', event)">▲</span>
                <span class="tri-down" onclick="sortTable('${col.keyName}', event)">▼</span>
                ${orderNum ? `<span class="sort-order">${orderNum}</span>` : ''}
            </div>
        </div>`;
        if (isActive) {
            th.classList.add(dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
        }
        const width = COLUMN_WIDTHS[col.keyName] || 'auto';
        th.style.width = width;
        th.style.minWidth = width;
        th.style.maxWidth = width;
        hr.appendChild(th);
    });
    setTimeout(() => addResizeHandles('dataTable'), 20);
}

// ============================================================
// ACCIONES SOBRE FILAS
// ============================================================

async function confirmAddRow() {
    const newRow = {
        proceso: '', eje: '', tema: '',
        nombre: 'Nueva variable',
        institucion: '', cobertura: '', periodicidad: '',
        liga_web: '', fuente: '',
        año: new Date().getFullYear().toString(),
        estado: '', valor: ''
    };
    try {
        const resp = await fetch('/api/variables', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newRow)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            throw new Error(data.error || `HTTP ${resp.status}`);
        }
        showToast('✅ Fila creada');
        setTimeout(() => {
            const tr = document.querySelector(`#dataTable tbody tr.parent-row[data-id="${data.data?.id}"]`);
            if (tr) _flashRow(tr, 'success');
        }, 400);
        // Recargamos respetando la página actual
        loadData(currentPage, itemsPerPage, sortField, sortDir, currentSearchTerm);
    } catch (e) {
        showToast('Error: ' + e.message, true);
    }
}

async function duplicateSelected() {
    const ids = getSelectedIds();
    if (ids.length === 0) { showToast('Selecciona al menos una fila.'); return; }
    try {
        const resp = await fetch('/api/variables/bulk-duplicate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Error');
        showToast(`✅ Duplicadas ${data.inserted.length} filas`);
        setTimeout(() => {
            (data.inserted || []).forEach(r => {
                const tr = document.querySelector(`#dataTable tbody tr.parent-row[data-id="${r.id}"]`);
                if (tr) _flashRow(tr, 'success');
            });
        }, 400);

        loadData(currentPage, itemsPerPage, sortField, sortDir, currentSearchTerm);
    } catch (e) {
        showToast('Error: ' + e.message, true);
    }
}

function _toggleMasterSelect() {
    const checkboxes = document.querySelectorAll('#dataTable tbody input.row-checkbox');
    if (checkboxes.length === 0) return;
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    const targetState = !allChecked;
    const parentsToSync = new Set();
    checkboxes.forEach(cb => {
        cb.checked = targetState;
        _syncCheckboxToSet(cb);
        const tr = cb.closest('tr');
        if (tr && tr.classList.contains('parent-row')) {
            parentsToSync.add(String(cb.dataset.id));
        }
    });
    // Sincronización de TODOS los hijos de cada padre visible
    parentsToSync.forEach(pid => {
        if (targetState) _selectAllChildrenOf(pid);
        else _deselectAllChildrenOf(pid);
    });
    const label = document.getElementById('masterSelectLabelTable');
    if (label) label.textContent = targetState ? 'Deseleccionar' : 'Seleccionar';
}

async function deleteSelectedRows() {
    const ids = getSelectedIds();
    if (ids.length === 0) { showToast('Selecciona al menos una fila.'); return; }
    if (!confirm(`¿Eliminar ${ids.length} fila(s)?`)) return;

    try {
        showSpinner(true);
        const resp = await fetch('/api/variables/bulk-delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Error');

        showToast(`✅ Eliminadas ${data.deleted} filas`);

        // ✅ FIX #5: invalidar TODO el caché de hijos.
        // Sin esto, al reexpandir un padre aún veríamos los hijos eliminados
        // porque loadChildrenForParentTable servía del caché.
        _childrenCacheByParent = {};

        // Limpiar selección y refrescar la tabla — SÍ o SÍ, incluso si
        // el usuario tenía un padre expandido con hijos visibles.
        _clearSelection();
        await loadData(currentPage, itemsPerPage, sortField, sortDir, currentSearchTerm);
    } catch (e) {
        showToast('Error: ' + e.message, true);
    } finally {
        showSpinner(false);
        document.querySelectorAll('#dataTable tr.dragging-row')
            .forEach(r => r.classList.remove('dragging-row'));
    }
}

function getSelectedIds() {
    const checkboxes = document.querySelectorAll('#dataTable tbody input.row-checkbox:checked');
    return Array.from(checkboxes).map(cb => cb.dataset.id);
}

// ============================================================
// DESCARGA CSV
// ============================================================

function downloadCSV() {
    window.location.href = '/api/download';
}

// ============================================================
// HISTORIAL DE CARGAS
// ============================================================

async function loadHistory() {
    const tbody = document.getElementById('historyListBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">Cargando...</td></tr>';
    try {
        const resp = await fetch('/api/upload-history');
        if (!resp.ok) throw new Error('Error al cargar historial');
        const data = await resp.json();
        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">No hay cargas registradas.</td></tr>';
            return;
        }
        let html = '';
        data.forEach(item => {
            const fecha = new Date(item.fecha).toLocaleString();
            const estadoClass = item.estado === 'completado' ? 'status-success' : (item.estado === 'error' ? 'status-error' : 'status-pending');
            html += `<tr>
                <td>${escapeHtml(fecha)}</td>
                <td>${escapeHtml(item.archivo || '')}</td>
                <td>${item.filas_agregadas || 0}</td>
                <td class="${estadoClass}">${escapeHtml(item.estado || 'desconocido')}</td>
            </tr>`;
        });
        tbody.innerHTML = html;
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--danger);">Error: ${escapeHtml(e.message)}</td></tr>`;
    }
}

// ============================================================
// MODELOS ML
// ============================================================

async function retrainModels() {
    if (!confirm('¿Reentrenar modelos con los datos actuales?')) return;
    try {
        showSpinner(true);
        const resp = await fetch('/api/retrain-models', { method: 'POST' });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Error al reentrenar');
        showToast('✅ ' + data.message);
        if (data.report) {
            console.log('Reporte de entrenamiento:', data.report);
        }
    } catch (e) {
        showToast('Error: ' + e.message, true);
    } finally {
        showSpinner(false);
    }
}

async function rollbackModels() {
    if (!confirm('¿Restaurar modelos anteriores (backup)?')) return;
    try {
        const resp = await fetch('/api/rollback-models', { method: 'POST' });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Error');
        showToast('✅ ' + data.message);
    } catch (e) {
        showToast('Error: ' + e.message, true);
    }
}

// ============================================================
// EXPANDIR/COLAPSAR TODOS (en tabla principal)
// ============================================================

function toggleAllParents() {
    const btns = document.querySelectorAll('#dataTable tbody .expand-btn');
    if (btns.length === 0) return;
    const newState = !allExpanded;
    allExpanded = newState;

    btns.forEach(btn => {
        if (newState) {
            // Expandir solo si estaba colapsado (símbolo ▸)
            if (btn.textContent === '▸' || btn.textContent === '▶') btn.click();
        } else {
            // Colapsar solo si estaba expandido (símbolo ▾ o ▼)
            if (btn.textContent === '▾' || btn.textContent === '▼') btn.click();
        }
    });

    const expandAllBtn = document.querySelector('#headerRow th:first-child .expand-all-btn');
    if (expandAllBtn) {
        expandAllBtn.textContent = newState ? '▾' : '▸';   // ✅ usa símbolos pequeños como preview
        expandAllBtn.classList.toggle('expanded', newState);
    }
}

// ============================================================
// MODALES DE "OTRA OPCIÓN" Y SUGERENCIAS (con cancelación)
// ============================================================

let _currentOtraCallback = null;

function openOtraOpcionModal(colKey, rowId) {
    const modal = document.getElementById('modalOtraOpcion');
    const input = document.getElementById('otraOpcionInput');
    const title = document.getElementById('modalOtraTitle');
    const label = document.getElementById('modalOtraLabel');
    title.textContent = `Nuevo valor para "${colKey}"`;
    label.textContent = `Ingrese el nuevo valor para la columna "${colKey}"`;
    input.value = '';
    modal.style.display = 'flex';
    _currentOtraCallback = { colKey, rowId, previousValue: null }; // se actualizará al abrir
    // Guardar el valor actual del select (si existe)
    const select = document.querySelector(`select[data-col="${colKey}"][data-rowid="${rowId}"]`);
    if (select) {
        _currentOtraCallback.previousValue = select.value;
    }
    document.getElementById('btnConfirmOtra').onclick = confirmOtraOpcion;
}

function confirmOtraOpcion() {
    const input = document.getElementById('otraOpcionInput');
    const value = input.value.trim();
    if (!value) { showToast('Ingresa un valor válido.'); return; }
    const { colKey, rowId, previousValue } = _currentOtraCallback;
    fetch(`/api/catalog/${colKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'inserted' || data.status === 'already_exists') {
            const finalValue = data.value || value;
            updateCell(rowId, colKey, finalValue);
            loadData(currentPage, itemsPerPage, sortField, sortDir, currentSearchTerm);
            showToast(`✅ Valor "${finalValue}" agregado al catálogo`);
        } else if (data.status === 'suggestion') {
            showSuggestionModal(data.suggested_value, value, rowId, colKey);
        } else {
            showToast('Error al agregar: ' + (data.error || ''), true);
        }
    })
    .catch(e => showToast('Error de conexión', true));
    closeModal('modalOtraOpcion');
}

function showSuggestionModal(suggested, original, rowId, colKey) {
    const modal = document.getElementById('modalSuggestion');
    document.getElementById('suggestionMessage').textContent =
        `¿Quieres usar "${suggested}" en lugar de "${original}"?`;
    modal.style.display = 'flex';
    document.getElementById('btnAcceptSuggestion').onclick = function() {
        updateCell(rowId, colKey, suggested);
        loadData(currentPage, itemsPerPage, sortField, sortDir, currentSearchTerm);
        closeModal('modalSuggestion');
        showToast(`✅ Usado "${suggested}"`);
    };
    document.getElementById('btnDeclineSuggestion').onclick = function() {
        fetch(`/api/catalog/${colKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: original })
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'inserted' || data.status === 'already_exists') {
                updateCell(rowId, colKey, original);
                loadData(currentPage, itemsPerPage, sortField, sortDir, currentSearchTerm);
                showToast(`✅ Usado "${original}"`);
            } else {
                showToast('Error al agregar', true);
            }
        })
        .catch(e => showToast('Error de conexión', true));
        closeModal('modalSuggestion');
    };
}

// Cancelación del modal "Otra opción" restaurando valor anterior
function handleCloseOtraOpcionModal() {
    if (_currentOtraCallback && _currentOtraCallback.previousValue !== null) {
        const { colKey, rowId, previousValue } = _currentOtraCallback;
        const select = document.querySelector(`select[data-col="${colKey}"][data-rowid="${rowId}"]`);
        if (select) {
            select.value = previousValue;
        }
    }
    _currentOtraCallback = null;
    closeModal('modalOtraOpcion');
}

// ============================================================
// PREVISUALIZACIÓN DE CSV Y ZIP (funciones auxiliares)
// ============================================================

function updateSelectAllCheckbox(containerId, isZip, forOverwrite) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const checkboxes = container.querySelectorAll('.action-checkbox');
    let allChecked = true;
    checkboxes.forEach(cb => {
        if (!cb.checked) allChecked = false;
    });
    const masterId = isZip ? 'selectAllDuplicatesForOverwriteZip' : 'selectAllDuplicatesForOverwrite';
    const master = document.getElementById(masterId);
    if (master) master.checked = allChecked;
}

async function toggleAllNonDuplicates(checkbox, isZip) {
    const isChecked = checkbox.checked;
    console.log(`🔄 toggleAllNonDuplicates (isZip=${isZip}, checked=${isChecked})`);

    let token = null;
    if (isZip) {
        token = previewToken;
    }

    let fullData = [];
    if (isZip) {
        if (!token) {
            console.warn('⚠️ No hay token para ZIP');
            return;
        }
        try {
            console.log(`📡 Solicitando todos los datos para token ${token.substring(0,8)}...`);
            const resp = await fetch('/api/preview-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: token })
            });
            if (!resp.ok) {
                console.error('❌ Error al obtener todos los datos:', await resp.text());
                return;
            }
            const data = await resp.json();
            fullData = data.data || [];
            console.log(`📊 Obtenidos ${fullData.length} datos completos para ZIP`);

            // fusionar las _action ya modificadas localmente, en lugar de reemplazar
            if (folderPreviewData && Array.isArray(folderPreviewData) && folderPreviewData.length > 0) {
                const actionMap = {};
                folderPreviewData.forEach(r => {
                    if (r && r._hash && r._action !== undefined) {
                        actionMap[r._hash] = r._action;
                    }
                });
                let merged = 0;
                fullData.forEach(r => {
                    if (r && r._hash && actionMap[r._hash] !== undefined) {
                        r._action = actionMap[r._hash];
                        merged++;
                    }
                });
                console.log(`🔀 toggleAllNonDuplicates: fusionadas ${merged} acciones previas`);
            }
            folderPreviewData = fullData;
        } catch (e) {
            console.error('❌ Error en fetch:', e);
            return;
        }
    } else {
        fullData = allPreviewData || [];
        console.log(`📊 Usando allPreviewData (${fullData.length} filas)`);
    }

    if (!fullData || !Array.isArray(fullData) || fullData.length === 0) {
        console.warn('⚠️ No hay datos completos para toggleAllNonDuplicates');
        return;
    }

    // aplicar SOLO a filas no duplicadas
    let affectedCount = 0;
    fullData.forEach(row => {
        if (row._is_duplicate) return;
        row._action = isChecked ? 'insert' : 'ignore';
        affectedCount++;
    });
    console.log(`✅ ${affectedCount} filas no duplicadas actualizadas a '${isChecked ? 'insert' : 'ignore'}'`);

    // Re-renderizar la página actual
    if (isZip) {
        const currentPage = currentParentPage || 1;
        const pageSize = parentsPerPage || 5;
        await loadPreviewPage(token, currentPage, pageSize);
    } else {
        renderPreviewTable('uploadDataPreview', allPreviewData, false, false, null);
    }
}

function updateSelectAllNonDuplicatesCheckbox(containerId, isZip) {
    const fullData = isZip ? folderPreviewData : allPreviewData;
    if (!fullData || !Array.isArray(fullData)) {
        // Fallback a los checkboxes visibles
        const container = document.getElementById(containerId);
        if (!container) return;
        const nonDupCheckboxes = container.querySelectorAll('.action-checkbox:not(.duplicate-row-preview)');
        const allChecked = Array.from(nonDupCheckboxes).every(cb => cb.checked);
        const masterId = isZip ? 'selectAllNonDuplicatesForOverwriteZip' : 'selectAllNonDuplicates';
        const master = document.getElementById(masterId);
        if (master) master.checked = allChecked;
        return;
    }

    // Evaluar sobre todos los datos: solo los no duplicados
    const nonDupRows = fullData.filter(row => !row._is_duplicate);
    const allInsert = nonDupRows.every(row => row._action === 'insert' || row._action === 'overwrite');
    const masterId = isZip ? 'selectAllNonDuplicatesForOverwriteZip' : 'selectAllNonDuplicates';
    const master = document.getElementById(masterId);
    if (master) {
        master.checked = allInsert;
        console.log(`   📌 updateSelectAllNonDuplicatesCheckbox: ${masterId} -> ${allInsert}`);
    }
}

// ============================================================
// MANEJO DE SUBIDA DE CSV
// ============================================================

function handleFileUploadModal(input) {
    const file = input.files[0];
    if (!file) return;
    currentFileToUpload = file;
    const reader = new FileReader();
    reader.onload = function(e) {
        const content = e.target.result;
        showCsvPreview(content, file.name);
    };
    reader.readAsText(file, 'UTF-8');
}

function showCsvPreview(csvContent, filename) {
    const previewDiv = document.getElementById('uploadDataPreview');
    const previewMessages = document.getElementById('uploadPreviewMessages');
    const controls = document.getElementById('csvPreviewControls');
    const pagination = document.getElementById('paginationControls');
    const confirmBtn = document.getElementById('confirmUploadBtn');

    previewDiv.style.display = 'block';
    previewMessages.style.display = 'block';
    controls.style.display = 'block';

    const formData = new FormData();
    const blob = new Blob([csvContent], { type: 'text/csv' });
    formData.append('file', blob, filename);

    showSpinner(true);
    fetch('/api/upload?preview=true', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        showSpinner(false);
        if (data.error) {
            showToast('Error: ' + data.error, true);
            return;
        }
        previewMessages.innerHTML = data.messages.map(m => `<div>${escapeHtml(m)}</div>`).join('');

        allPreviewData = data.preview_data || [];

        // marcar todos los NO duplicados como 'insert' por defecto
        let _noDupCSV = 0;
        allPreviewData.forEach(r => {
            if (!r._is_duplicate) { r._action = 'insert'; _noDupCSV++; }
            else { r._action = 'ignore'; }
        });
        console.log(`✅ CSV: marcados ${_noDupCSV} no duplicados como 'insert'`);

        // renderizar la tabla de previsualización
        previewCurrentPage = 1;
        renderPreviewTable('uploadDataPreview', allPreviewData, false, false, null);

        // habilitar botón de confirmar
        confirmBtn.disabled = false;
        confirmBtn.onclick = confirmUpload;

        // Detectar valores nuevos en catálogo
        const hasNew = allPreviewData.some(row => row._nuevo_en_catalogo && Object.keys(row._nuevo_en_catalogo).length > 0);
        document.getElementById('csvNewCatalogMessage').style.display = hasNew ? 'block' : 'none';

        // Activar visualmente el master "Seleccionar todos los no duplicados"
        setTimeout(() => {
            const master = document.getElementById('selectAllNonDuplicates');
            if (master) master.checked = true;
        }, 100);

        // Añadir handles de redimensionamiento en la previsualización
        setTimeout(() => addResizeHandles('uploadDataPreview'), 100);
    })
    .catch(err => {
        showSpinner(false);
        showToast('Error al procesar el archivo: ' + err.message, true);
    });
}

async function confirmUpload() {
    const confirmBtn = document.getElementById('confirmUploadBtn');
    confirmBtn.disabled = true;
    showSpinner(true);

    const container = document.getElementById('uploadDataPreview');
    const checkboxes = container.querySelectorAll('.action-checkbox');
    const actions = [];
    checkboxes.forEach(cb => {
        const row = cb.closest('tr');
        if (!row) return;
        const hash = cb.dataset.hash;
        const isChecked = cb.checked;
        const rowData = allPreviewData.find(r => r._hash === hash);
        if (!rowData) return;
        const action = isChecked ? (rowData._is_duplicate ? 'overwrite' : 'insert') : 'ignore';
        actions.push({
            original_csv_index: rowData.original_csv_index,
            action: action,
            data: rowData.data,
            _is_duplicate: rowData._is_duplicate,
            _supabase_matching_id: rowData._supabase_matching_id,
            _hash: rowData._hash,
            _is_parent: rowData._is_parent || false,
            _parent_id: rowData._parent_id || null,
            _parent_hash: rowData._parent_hash || null
        });
    });

    const formData = new FormData();
    formData.append('file', currentFileToUpload);
    formData.append('actions_for_rows', JSON.stringify(actions));

    try {
        const resp = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        const data = await resp.json();
        if (resp.ok) {
            showToast(data.message || 'Carga completada');
            closeModal('modalConfirmUpload');
            resetCsvModal();
            loadData(currentPage, itemsPerPage, sortField, sortDir, currentSearchTerm);
            loadHistory();
        } else {
            showToast('Error: ' + (data.error || ''), true);
        }
    } catch (e) {
        showToast('Error de conexión: ' + e.message, true);
    } finally {
        showSpinner(false);
        confirmBtn.disabled = false;
    }
}

// ============================================================
// MANEJO DE SUBIDA DE ZIP (CARPETA)
// ============================================================

function handleZipUpload(input) {
    const file = input.files[0];
    if (!file) return;

    _cancelZipPolling();
    _currentZipSession++;
    const sessionId = _currentZipSession;
    console.log(`🆕 handleZipUpload: sesión #${sessionId} iniciada para '${file.name}'`);

    currentZipFilename = file.name;

    // 🪜 FLOW: resetear pila y marcar 'upload' + 'discovery' como pasos
    _flowReset();
    _flowPush('upload');
    _flowPush('discovery');

    // Fase 1: discovery (rápido)
    _runDiscovery(file)
        .then(() => {
            if (sessionId !== _currentZipSession) return;
            openModal('modalDiscoverVariables');
            _flowUpdateButtons();
        })
        .catch(() => {
            // Si el discovery falla, sacamos 'discovery' de la pila
            if (_flowStack[_flowStack.length - 1] === 'discovery') {
                _flowStack.pop();
            }
            _flowUpdateButtons();
        });
}

// ============================================================
// DISCOVERY DE VARIABLES (nuevo flujo ZIP)
// ============================================================

let _discoveryResults = [];
let _discoverySessionId = null;

async function _runDiscovery(zipFile) {
    const formData = new FormData();
    formData.append('file', zipFile);

    showSpinner(true);
    try {
        const resp = await fetch('/api/discover-variables', {
            method: 'POST',
            body: formData
        });
        const data = await resp.json();
        if (!resp.ok || data.error) {
            throw new Error(data.error || `HTTP ${resp.status}`);
        }
        _discoveryResults = data.discovery || [];
        _discoverySessionId = data.session_id;
        console.log(`🔎 Discovery: ${_discoveryResults.length} archivos, sesión ${_discoverySessionId}`);
        renderDiscoveryUI();
    } catch (e) {
        showToast('Error al descubrir variables: ' + e.message, true);
        throw e;
    } finally {
        showSpinner(false);
    }
}

// ============================================================
// DISCOVERY — render con grupos colapsables + buscador en vivo
// ============================================================

function renderDiscoveryUI() {
    const listEl = document.getElementById('discoveryList');
    const summaryEl = document.getElementById('discoverySummary');
    if (!listEl) return;

    // ---- Asegurar que existe el buscador (una sola vez) ----
    let searchWrap = document.getElementById('discoverySearchWrap');
    if (!searchWrap) {
        searchWrap = document.createElement('div');
        searchWrap.id = 'discoverySearchWrap';
        searchWrap.innerHTML = `
            <input type="text" id="discoverySearchInput"
                   placeholder="Buscar variable por descripción, columna o archivo..."
                   autocomplete="off" spellcheck="false">
        `;
        listEl.parentNode.insertBefore(searchWrap, listEl);
        const inp = document.getElementById('discoverySearchInput');
        if (inp) {
            inp.addEventListener('input', function () {
                _filterDiscoveryItems(this.value.trim());
            });
        }
    }

    if (!_discoveryResults.length) {
        listEl.innerHTML = '<p style="color:var(--text-muted);">No se encontraron variables en los diccionarios.</p>';
        summaryEl.textContent = '';
        return;
    }

    let totalVars = 0;
    let totalAgg = 0;
    let html = '';

    _discoveryResults.forEach((group, gi) => {
        const vars = group.variables || [];
        totalVars += vars.length;
        const aggCount = vars.filter(v => v.is_aggregation_candidate && v.is_numeric && !v.is_grouping).length;
        totalAgg += aggCount;

        const groupLabel = group.display_file_name || group.data_file;
        const showFileName = group.display_file_name && group.display_file_name !== group.data_file;

        // ---------- Header del grupo (colapsable) ----------
        html += `<div class="discovery-group" data-gi="${gi}">`;
        html += `<div class="discovery-group-header" data-gi="${gi}">`;
        html += `<span class="discovery-group-toggle">▸</span>`;
        html += `<input type="checkbox" class="discovery-group-cb" data-gi="${gi}" title="Seleccionar/desmarcar todas las de agregación del grupo">`;
        html += `<span class="discovery-group-title">📄 ${escapeHtml(groupLabel)}</span>`;
        if (showFileName) {
            html += `<span class="discovery-group-file">[${escapeHtml(group.data_file)}]</span>`;
        }
        html += `<span class="discovery-group-count">(${aggCount} de ${vars.length})</span>`;
        html += `</div>`;

        // ---------- Body del grupo (variables) ----------
        html += `<div class="discovery-group-body" style="display:none;">`;

        vars.forEach((v, vi) => {
            const disabled = !v.is_numeric || v.is_grouping;
            const checked = (v.is_aggregation_candidate && v.is_numeric && !v.is_grouping) ? 'checked' : '';

            let badge = '';
            if (v.is_grouping) {
                badge = '<span style="color:var(--text-muted); font-size:0.8em;">[grupo]</span>';
            } else if (v.is_aggregation_candidate && v.is_numeric) {
                badge = '<span style="color:var(--success); font-size:0.8em;">[agregación]</span>';
            } else if (v.is_numeric) {
                badge = '<span style="color:var(--text-muted); font-size:0.8em;">[numérica]</span>';
            } else {
                badge = '<span style="color:var(--text-muted); font-size:0.8em;">[no numérica]</span>';
            }

            const primaryLabel = v.description || v.dictionary_name || v.column;
            const secondaryLabel = v.column;

            // Texto para búsqueda: descripción + columna + nombre diccionario (todo normalizado)
            const searchText = [
                v.description || '',
                v.column || '',
                v.dictionary_name || '',
            ].join(' ').toLowerCase();

            html += `
              <label class="discovery-item"
                     data-gi="${gi}"
                     data-vi="${vi}"
                     data-search="${escapeHtml(searchText)}"
                     style="opacity:${disabled ? '0.5' : '1'}; cursor:${disabled ? 'not-allowed' : 'pointer'};">
                <input type="checkbox"
                       class="discovery-cb"
                       data-gi="${gi}"
                       data-vi="${vi}"
                       data-is-agg="${(v.is_aggregation_candidate && v.is_numeric && !v.is_grouping) ? 'true' : 'false'}"
                       ${checked}
                       ${disabled ? 'disabled' : ''}>
                <div style="flex:1; min-width:0;">
                  <div style="font-size:0.9em; color:var(--text-main); font-weight:500; word-break:break-word;">
                    ${escapeHtml(primaryLabel)} ${badge}
                  </div>
                  <div style="font-family:monospace; font-size:0.72em; color:var(--text-muted); margin-top:2px; word-break:break-all;">
                    ${escapeHtml(secondaryLabel)}
                  </div>
                </div>
              </label>`;
        });

        html += `</div>`;   // .discovery-group-body
        html += `</div>`;   // .discovery-group
    });

    listEl.innerHTML = html;
    summaryEl.textContent = `Total: ${totalVars} columnas, ${totalAgg} candidatas a agregación.`;

    // ---------- Handlers ----------

    // 1) Click en header (excepto el checkbox) → colapsar/expandir
    listEl.querySelectorAll('.discovery-group-header').forEach(hdr => {
        hdr.addEventListener('click', function (e) {
            // Si el click fue en el checkbox, no colapsar.
            if (e.target && e.target.classList && e.target.classList.contains('discovery-group-cb')) {
                return;
            }
            const gi = this.dataset.gi;
            const group = listEl.querySelector(`.discovery-group[data-gi="${gi}"]`);
            if (!group) return;
            const body = group.querySelector('.discovery-group-body');
            const toggle = group.querySelector('.discovery-group-toggle');
            if (!body || !toggle) return;
            const isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : '';
            toggle.textContent = isOpen ? '▸' : '▾';
        });
    });

    // 2) Checkbox de grupo → marca/desmarca TODAS las de agregación del grupo.
    //    Se usa el evento 'change' (NO 'click' con preventDefault) para que el
    //    navegador gestione correctamente el ciclo:
    //      unchecked → checked
    //      checked   → unchecked
    //      indeterminate → checked    (el navegador limpia indeterminate solo)
    listEl.querySelectorAll('.discovery-group-cb').forEach(gcb => {
        gcb.addEventListener('change', function (e) {
            e.stopPropagation();   // no colapsar el grupo al hacer click en el checkbox
            const gi = this.dataset.gi;
            const newState = this.checked;   // el navegador ya hizo el toggle

            // ✅ SOLO tocar las candidatas de agregación (data-is-agg="true")
            listEl.querySelectorAll(
                `.discovery-cb[data-gi="${gi}"][data-is-agg="true"]:not(:disabled)`
            ).forEach(cb => { cb.checked = newState; });

            _updateDiscoveryCount();
        });
    });

    // 3) Change de cada checkbox → actualizar contador
    listEl.querySelectorAll('.discovery-cb').forEach(cb => {
        cb.addEventListener('change', _updateDiscoveryCount);
    });

    // 4) Click en el label del item → toggle del checkbox
    listEl.querySelectorAll('label.discovery-item').forEach(label => {
        label.addEventListener('click', function (e) {
            if (e.target && e.target.type === 'checkbox') return;
            const cb = this.querySelector('input.discovery-cb');
            if (!cb || cb.disabled) return;
            e.preventDefault();
            cb.checked = !cb.checked;
            _updateDiscoveryCount();
        });
    });
}

function _collapseAllDiscoveryGroups() {
    const listEl = document.getElementById('discoveryList');
    if (!listEl) return;
    listEl.querySelectorAll('.discovery-group').forEach(group => {
        const body = group.querySelector('.discovery-group-body');
        const toggle = group.querySelector('.discovery-group-toggle');
        if (body) body.style.display = 'none';
        if (toggle) toggle.textContent = '▸';
    });
}

function _expandAllDiscoveryGroups() {
    const listEl = document.getElementById('discoveryList');
    if (!listEl) return;
    listEl.querySelectorAll('.discovery-group').forEach(group => {
        if (group.style.display === 'none') return;   // respetar filtro
        const body = group.querySelector('.discovery-group-body');
        const toggle = group.querySelector('.discovery-group-toggle');
        if (body) body.style.display = '';
        if (toggle) toggle.textContent = '▾';
    });
}

/**
 * Filtra items según la búsqueda. Afecta también a los grupos:
 *   - Un grupo se oculta si NINGÚN item coincide.
 *   - Si hay búsqueda activa, los grupos con coincidencias se expanden.
 *   - Si no hay búsqueda, se colapsan todos.
 */
function _filterDiscoveryItems(q) {
    const listEl = document.getElementById('discoveryList');
    if (!listEl) return;

    // Normalizar término: sin acentos, lower
    const normQ = (q || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

    const groups = listEl.querySelectorAll('.discovery-group');
    let visibleGroups = 0;
    let visibleItems = 0;

    groups.forEach(group => {
        const items = group.querySelectorAll('.discovery-item');
        let visibleCount = 0;

        items.forEach(item => {
            if (!normQ) {
                item.style.display = '';
                visibleCount++;
                return;
            }
            const raw = item.dataset.search || '';
            const norm = raw.normalize('NFD').replace(/[̀-ͯ]/g, '');
            if (norm.includes(normQ)) {
                item.style.display = '';
                visibleCount++;
            } else {
                item.style.display = 'none';
            }
        });

        if (normQ && visibleCount === 0) {
            group.style.display = 'none';
        } else {
            group.style.display = '';
            visibleGroups++;
            visibleItems += visibleCount;
        }
    });

    if (normQ) {
        // Búsqueda activa: expandir todos los grupos visibles
        _expandAllDiscoveryGroups();
        console.log(`🔍 _filterDiscoveryItems: q='${q}' → ${visibleGroups} grupos, ${visibleItems} items visibles`);
    } else {
        _collapseAllDiscoveryGroups();
    }
}

function _updateDiscoveryCount() {
    const n = document.querySelectorAll('.discovery-cb:checked').length;
    const el = document.getElementById('discoverySelectedCount');
    if (el) el.textContent = `${n} seleccionada(s)`;

    // Sincronizar estado de checkboxes de grupo
    const listEl = document.getElementById('discoveryList');
    if (!listEl) return;

    listEl.querySelectorAll('.discovery-group-cb').forEach(gcb => {
        const gi = gcb.dataset.gi;

        // ✅ MISMO selector que el handler del grupo: SOLO candidatas de agregación
        const children = listEl.querySelectorAll(
            `.discovery-cb[data-gi="${gi}"][data-is-agg="true"]:not(:disabled)`
        );

        if (children.length === 0) {
            gcb.checked = false;
            gcb.indeterminate = false;
            return;
        }

        const checkedCount = Array.from(children).filter(c => c.checked).length;

        if (checkedCount === 0) {
            // Ninguna marcada → sin palomita, sin guion
            gcb.checked = false;
            gcb.indeterminate = false;
        } else if (checkedCount === children.length) {
            // Todas marcadas → palomita ✅
            gcb.checked = true;
            gcb.indeterminate = false;
        } else {
            // Algunas marcadas → guion "-" (indeterminate)
            gcb.checked = false;
            gcb.indeterminate = true;
        }
    });
}

function discoverySelectAllAggregations(state) {
    document.querySelectorAll('.discovery-cb').forEach(cb => {
        if (cb.disabled) return;
        if (state === true) {
            // ⚡ "Todas las de agregación": solo las que tengan data-is-agg="true".
            if (cb.dataset.isAgg === 'true') {
                cb.checked = true;
            }
        } else {
            // "Ninguna": desmarcar TODAS las que no estén deshabilitadas.
            cb.checked = false;
        }
    });
    _updateDiscoveryCount();
}

async function confirmDiscoveryAndProcess() {
    const selected = [];
    document.querySelectorAll('.discovery-cb:checked').forEach(cb => {
        const gi = parseInt(cb.dataset.gi);
        const vi = parseInt(cb.dataset.vi);
        const group = _discoveryResults[gi];
        const variable = group.variables[vi];
        selected.push({ data_file: group.data_file, column: variable.column });
    });

    if (!selected.length) {
        showToast('Selecciona al menos una variable.', true);
        return;
    }

    const sessionId = _discoverySessionId;
    closeModal('modalDiscoverVariables');

    // 🪜 FLOW: avanzamos a 'preview'
    _flowPush('preview');

    await _startZipProcessing(sessionId, selected);
}

async function _startZipProcessing(sessionId, selectedVariables) {
    const progressDiv = document.getElementById('zipProgress');
    const progressFill = document.getElementById('zipProgressFill');
    const progressText = document.getElementById('zipProgressText');
    const logDiv = document.getElementById('folderLogMessages');
    const logContent = document.getElementById('folderLogContent');
    const previewContainer = document.getElementById('zipPreviewContainer');
    const confirmBtn = document.getElementById('confirmFolderBtn');

    // Aseguramos el modal de carpeta abierto
    openModal('modalFolderUpload');

    logContent.innerHTML = 'Iniciando procesamiento...';
    logDiv.style.display = 'block';
    previewContainer.style.display = 'none';
    confirmBtn.disabled = true;
    progressDiv.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = 'Enviando selección...';
    _lastMessageCount = 0;

    const currentSession = _currentZipSession;
    const formData = new FormData();
    formData.append('session_id', sessionId);
    formData.append('selected_variables', JSON.stringify(selectedVariables));

    try {
        const resp = await fetch('/api/process-folder-async', {
            method: 'POST',
            body: formData
        });
        const data = await resp.json();
        if (!resp.ok || data.error) {
            throw new Error(data.error || `HTTP ${resp.status}`);
        }
        if (currentSession !== _currentZipSession) {
            console.log(`⚠️ _startZipProcessing: sesión cambió; descartando`);
            return;
        }
        pollTaskStatus(
            data.task_id,
            currentSession,
            progressFill,
            progressText,
            logContent,
            previewContainer,
            confirmBtn
        );
    } catch (e) {
        showToast('Error al procesar: ' + e.message, true);
        progressDiv.style.display = 'none';
    }
}

function pollTaskStatus(taskId, sessionId, progressFill, progressText, logContent, previewContainer, confirmBtn) {
    // Limpiar cualquier timer previo (por si acaso).
    if (_zipPollingInterval) {
        clearTimeout(_zipPollingInterval);
        clearInterval(_zipPollingInterval);
        _zipPollingInterval = null;
    }
    _currentTaskId = taskId;
    _consecutivePollingFailures = 0;

    // Ocultar banner de error previo si lo hubiera.
    const bannerEl = document.getElementById('zipPollingErrorBanner');
    if (bannerEl) bannerEl.classList.remove('visible');

    console.log(`⏱️ pollTaskStatus: arrancando polling para task=${taskId}, sesión=#${sessionId}`);

    const POLL_INTERVAL_MS = 2000;
    const MAX_BACKOFF_MS = 30000;

    const _scheduleNext = (delayMs) => {
        _zipPollingInterval = setTimeout(_tick, delayMs);
    };

    const _tick = async () => {
        // ─── Guardia de sesión ───
        if (sessionId !== _currentZipSession) {
            console.log(`🛑 pollTaskStatus: sesión #${sessionId} expirada (activa: #${_currentZipSession}), deteniendo`);
            if (_zipPollingInterval) {
                clearTimeout(_zipPollingInterval);
                _zipPollingInterval = null;
            }
            return;
        }

        try {
            const resp = await fetch(`/api/task-status/${taskId}`);

            if (!resp.ok) {
                if (resp.status === 404) {
                    // La task ya no existe (expiró o el proceso se reinició).
                    // No tiene sentido reintentar.
                    console.warn(`⚠️ pollTaskStatus: task ${taskId} no existe (HTTP 404); deteniendo.`);
                    if (_zipPollingInterval) {
                        clearTimeout(_zipPollingInterval);
                        _zipPollingInterval = null;
                    }
                    _currentTaskId = null;
                    showToast('La tarea ya expiró o fue cancelada en el servidor.', true);
                    return;
                }
                // Otros errores HTTP (500, 502, 503...) → tratados como transitorios.
                throw new Error(`HTTP ${resp.status}`);
            }

            const data = await resp.json();

            // Segunda guardia: pudo cambiar la sesión mientras esperábamos.
            if (sessionId !== _currentZipSession) {
                console.log(`🛑 pollTaskStatus: sesión #${sessionId} cambió durante el await; abortando tick`);
                if (_zipPollingInterval) {
                    clearTimeout(_zipPollingInterval);
                    _zipPollingInterval = null;
                }
                return;
            }

            // ✅ Fetch exitoso → resetear contador de fallos.
            _consecutivePollingFailures = 0;

            // ---------------- Mensajes ----------------
            if (data.messages && Array.isArray(data.messages)) {
                const logDiv = document.getElementById('folderLogMessages');
                const wasAtBottom = logDiv
                    ? (logDiv.scrollHeight - logDiv.scrollTop - logDiv.clientHeight) < 40
                    : true;

                logContent.innerHTML = data.messages.join('<br>');

                if (wasAtBottom && logDiv) {
                    requestAnimationFrame(() => {
                        logDiv.scrollTop = logDiv.scrollHeight;
                    });
                }

                const newMessages = data.messages.slice(_lastMessageCount);
                if (newMessages.length > 0) {
                    console.log('📝 Nuevos mensajes:');
                    newMessages.forEach(msg => console.log(`   ${msg}`));
                    _lastMessageCount = data.messages.length;
                }
            }

            // ---------------- Estado: pending / running ----------------
            if (data.status === 'pending' || data.status === 'running') {
                progressFill.style.width = data.progress + '%';
                progressText.textContent = `Procesando... ${data.progress}%`;
                _scheduleNext(POLL_INTERVAL_MS);
                return;
            }

            // ---------------- Estados terminales: cancelamos timer ----------------
            if (_zipPollingInterval) {
                clearTimeout(_zipPollingInterval);
                _zipPollingInterval = null;
            }

            if (data.status === 'cancelled') {
                console.log(`🛑 pollTaskStatus: task ${taskId} marcada como cancelada en backend`);
                _currentTaskId = null;
                return;
            }

            if (data.status === 'completed') {
                _currentTaskId = null;

                // Tercera guardia antes de tocar el DOM.
                if (sessionId !== _currentZipSession) {
                    console.log(`🛑 pollTaskStatus: sesión #${sessionId} cambió antes de renderizar; descartando resultado`);
                    return;
                }

                progressFill.style.width = '100%';
                progressText.textContent = 'Completado';
                const result = data.result;
                if (result && result.preview_token) {
                    previewToken = result.preview_token;
                    folderPreviewData = [];
                    totalParents = result.total_parents || 0;
                    currentParentPage = 1;
                    previewContainer.style.display = 'block';
                    console.log(`✅ Token de previsualización: ${previewToken}, Total padres: ${totalParents}`);

                    try {
                        const allResp = await fetch('/api/preview-all', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ token: previewToken })
                        });
                        if (allResp.ok) {
                            const allData = await allResp.json();

                            // Cuarta guardia: si el usuario ya empezó otra carga, descartar.
                            if (sessionId !== _currentZipSession) {
                                console.log(`🛑 pollTaskStatus: sesión #${sessionId} cambió tras preview-all; descartando`);
                                return;
                            }

                            folderPreviewData = allData.data || [];
                            console.log(`📦 pollTaskStatus: precargados ${folderPreviewData.length} filas`);

                            let _noDupZIP = 0;
                            folderPreviewData.forEach(r => {
                                if (!r._is_duplicate) { r._action = 'insert'; _noDupZIP++; }
                                else { r._action = 'ignore'; }
                            });
                            console.log(`✅ ZIP: marcados ${_noDupZIP} no duplicados como 'insert'`);
                            setTimeout(() => {
                                const master = document.getElementById('selectAllNonDuplicatesForOverwriteZip');
                                if (master) master.checked = true;
                            }, 100);
                        }
                    } catch (e) {
                        console.warn('⚠️ No se pudieron precargar todos los datos:', e);
                    }

                    loadPreviewPage(previewToken, 1, parentsPerPage);
                    confirmBtn.disabled = false;
                    confirmBtn.onclick = confirmFolderUpload;
                } else {
                    showToast('No se generaron datos para previsualizar.', true);
                }
                return;
            }

            if (data.status === 'error') {
                _currentTaskId = null;
                showToast('Error en el procesamiento: ' + (data.error || ''), true);
                progressFill.style.width = '100%';
                progressText.textContent = 'Error';
                console.error('❌ Error en tarea:', data.error);
                return;
            }

            // Estado desconocido: reprogramar como si fuera pending (defensivo).
            console.warn(`⚠️ pollTaskStatus: estado desconocido '${data.status}', reprogramando.`);
            _scheduleNext(POLL_INTERVAL_MS);

        } catch (e) {
            _consecutivePollingFailures++;
            console.warn(`⚠️ pollTaskStatus: fallo #${_consecutivePollingFailures}/${_MAX_POLLING_FAILURES} consultando task ${taskId}: ${e.message}`);

            if (_consecutivePollingFailures === 1) {
                // Aviso al usuario solo la primera vez.
                showToast('⚠️ Se perdió conexión con el servidor. Reintentando…');
            }

            if (_consecutivePollingFailures >= _MAX_POLLING_FAILURES) {
                // Umbral alcanzado: paramos y mostramos banner persistente.
                console.error(`❌ pollTaskStatus: ${_MAX_POLLING_FAILURES} fallos consecutivos; deteniendo polling.`);
                if (_zipPollingInterval) {
                    clearTimeout(_zipPollingInterval);
                    _zipPollingInterval = null;
                }
                // ⚠️ _currentTaskId NO se limpia: el botón "Reanudar" lo necesita.
                const bn = document.getElementById('zipPollingErrorBanner');
                if (bn) {
                    bn.classList.add('visible');
                    const infoSpan = document.getElementById('zipPollingErrorInfo');
                    if (infoSpan) {
                        infoSpan.textContent =
                            `⚠️ Se perdió conexión con el servidor (${_MAX_POLLING_FAILURES} intentos fallidos). ` +
                            `El análisis puede seguir corriendo. Último error: ${e.message}`;
                    }
                }
                progressText.textContent = 'Sin conexión — pendiente de reanudar';
                showToast('⚠️ No se pudo contactar al servidor. Usa el botón "Reanudar" en el modal.', true);
                return;
            }

            // Backoff exponencial: 2s, 4s, 8s, 16s, 30s (cap).
            const delay = Math.min(
                POLL_INTERVAL_MS * Math.pow(2, _consecutivePollingFailures - 1),
                MAX_BACKOFF_MS
            );
            console.log(`⏱️ pollTaskStatus: reprogramando intento en ${(delay / 1000).toFixed(1)}s`);
            _scheduleNext(delay);
        }
    };

    // Arrancar el primer tick de inmediato.
    _scheduleNext(0);
}

function resumeTaskPolling() {
    if (!_currentTaskId) {
        showToast('No hay tarea pendiente para reanudar.', true);
        return;
    }

    // Si el modal está cerrado, lo abrimos para que el usuario vea el progreso.
    const modal = document.getElementById('modalFolderUpload');
    if (modal && modal.style.display !== 'flex') {
        openModal('modalFolderUpload');
    }

    console.log(`🔄 resumeTaskPolling: reanudando polling para task=${_currentTaskId}, sesión=#${_currentZipSession}`);

    // Ocultar banner y resetear contador.
    const banner = document.getElementById('zipPollingErrorBanner');
    if (banner) banner.classList.remove('visible');
    _consecutivePollingFailures = 0;

    // Recuperar los handles del DOM que necesita pollTaskStatus.
    const progressFill = document.getElementById('zipProgressFill');
    const progressText = document.getElementById('zipProgressText');
    const logContent = document.getElementById('folderLogContent');
    const previewContainer = document.getElementById('zipPreviewContainer');
    const confirmBtn = document.getElementById('confirmFolderBtn');

    // Reutilizamos el mismo task_id y la sesión actual.
    pollTaskStatus(
        _currentTaskId,
        _currentZipSession,
        progressFill,
        progressText,
        logContent,
        previewContainer,
        confirmBtn
    );
}


async function confirmFolderUpload() {
    if (!previewToken) {
        showToast('No hay token de previsualización.', true);
        return;
    }

    const confirmBtn = document.getElementById('confirmFolderBtn');
    confirmBtn.disabled = true;
    showSpinner(true);

    // ------------------------------------------------------------------
    // 1) Recolectar TODOS los hashes marcados desde folderPreviewData
    //    (fuente de verdad). El DOM solo tiene la página actual; los
    //    padres de otras páginas y los hijos aún no expandidos NO están
    //    en el DOM, así que NO podemos confiar en querySelectorAll.
    // ------------------------------------------------------------------
    const selectedHashes = [];
    if (folderPreviewData && Array.isArray(folderPreviewData)) {
        folderPreviewData.forEach(r => {
            if (!r) return;
            if (r._action === 'insert' || r._action === 'overwrite') {
                if (r._hash) selectedHashes.push(r._hash);
            }
        });
    }

    // Fallback defensivo: si por alguna razón folderPreviewData está vacío,
    // usamos los checkboxes visibles (última red de seguridad).
    if (selectedHashes.length === 0) {
        const container = document.getElementById('zipPreviewTable');
        if (container) {
            container.querySelectorAll('.action-checkbox:checked').forEach(cb => {
                if (cb.dataset.hash) selectedHashes.push(cb.dataset.hash);
            });
        }
    }

    console.log(`📤 confirmFolderUpload: enviando ${selectedHashes.length} hashes seleccionados`);

    if (selectedHashes.length === 0) {
        showToast('⚠️ No has seleccionado ninguna fila para confirmar.', true);
        confirmBtn.disabled = false;
        showSpinner(false);
        return;
    }

    try {
        const resp = await fetch('/api/confirm-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: previewToken,
                selected_hashes: selectedHashes
            })
        });
        const data = await resp.json();
        if (resp.ok) {
            showToast(data.message || 'Carga completada');
            closeModal('modalFolderUpload');
            resetFolderModal();
            loadData(currentPage, itemsPerPage, sortField, sortDir, currentSearchTerm);
            loadHistory();
        } else {
            showToast('Error: ' + (data.error || ''), true);
        }
    } catch (e) {
        showToast('Error de conexión: ' + e.message, true);
    } finally {
        showSpinner(false);
        confirmBtn.disabled = false;
    }
}

// ============================================================
// RESET DEL MODAL DE CARPETA (ZIP)
// ============================================================
function resetFolderModal() {
    console.log('🧹 resetFolderModal: limpiando estado del modal ZIP');
    _cancelZipPolling();

    const zipInput = document.getElementById('zipFileInput');
    if (zipInput) zipInput.value = '';

    const logDiv = document.getElementById('folderLogMessages');
    if (logDiv) logDiv.style.display = 'none';

    const logContent = document.getElementById('folderLogContent');
    if (logContent) logContent.innerHTML = '';

    const previewContainer = document.getElementById('zipPreviewContainer');
    if (previewContainer) previewContainer.style.display = 'none';

    const previewTable = document.getElementById('zipPreviewTable');
    if (previewTable) previewTable.innerHTML = '';

    const confirmBtn = document.getElementById('confirmFolderBtn');
    if (confirmBtn) confirmBtn.disabled = true;

    const progressDiv = document.getElementById('zipProgress');
    if (progressDiv) progressDiv.style.display = 'none';

    const progressFill = document.getElementById('zipProgressFill');
    if (progressFill) progressFill.style.width = '0%';

    const progressText = document.getElementById('zipProgressText');
    if (progressText) progressText.textContent = 'Procesando...';

    const rowCount = document.getElementById('rowCount');
    if (rowCount) rowCount.textContent = '';
    const pollingBanner = document.getElementById('zipPollingErrorBanner');
    if (pollingBanner) pollingBanner.classList.remove('visible');
    _consecutivePollingFailures = 0;

    // Reset de variables globales
    previewToken = null;
    folderPreviewData = [];
    totalParents = 0;
    currentParentPage = 1;
    parentsPerPage = 5;
    _childPage = {};
    _previewAllExpanded = false;
    _lastMessageCount = 0;
    allFolderData = [];
    overwriteSet = new Set();

    // 🪜 FLOW: limpiar la pila
    _flowReset();

    console.log(`✅ resetFolderModal: estado limpiado (sesión actual sigue en #${_currentZipSession})`);
}

// ============================================================
// PREVISUALIZACIÓN DE TABLAS (para CSV y ZIP) - COMPLETA
// ============================================================

function renderPreviewTable(containerId, pageData, isZip = false, disablePagination = false, allData = null) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error('Contenedor no encontrado:', containerId);
        return;
    }

    if (!pageData || !Array.isArray(pageData)) {
        pageData = [];
    }

    if (pageData.length === 0) {
        container.innerHTML = '<p>No hay datos para esta página.</p>';
        if (!disablePagination) {
            const controlsId = isZip ? 'zipPaginationControls' : 'paginationControls';
            const controls = document.getElementById(controlsId);
            if (controls) controls.style.display = 'flex';
        }
        const rowCountSpan = document.getElementById('rowCount');
        if (rowCountSpan) rowCountSpan.textContent = '0 padres (0 filas totales)';
        return;
    }

    let fullData = allData;
    if (!fullData || !Array.isArray(fullData)) {
        fullData = pageData;
    }

    // Construir mapa de hijos
    const childrenMap = {};
    const parents = [];
    fullData.forEach(row => {
        if (row._is_parent) {
            parents.push(row);
        } else if (row._is_child) {
            const pHash = row._parent_hash;
            if (!childrenMap[pHash]) childrenMap[pHash] = [];
            childrenMap[pHash].push(row);
        }
    });
    window._previewChildrenMap = window._previewChildrenMap || {};
    window._previewChildrenMap[containerId] = childrenMap;

    const columnDefs = window.COLUMN_DEFINITIONS || [];

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');

    const headerRow = _buildPreviewHeader(columnDefs, containerId, isZip);
    thead.appendChild(headerRow);
    table.appendChild(thead);

    pageData.forEach(rowInfo => {
        const isParent = rowInfo._is_parent === true;
        const row = _buildPreviewRow(rowInfo, isParent, containerId, isZip, pageData, fullData);
        tbody.appendChild(row);
    });

    table.appendChild(tbody);
    container.innerHTML = '';
    container.appendChild(table);

    // Añadir handles de redimensionamiento
    setTimeout(() => {
        addResizeHandles(containerId);
    }, 50);

    if (!disablePagination) {
        const controlsId = isZip ? 'zipPaginationControls' : 'paginationControls';
        const controls = document.getElementById(controlsId);
        if (controls) controls.style.display = 'flex';
        const rowCountSpan = document.getElementById('rowCount');
        if (rowCountSpan) {
            rowCountSpan.textContent = `${parents.length} padres (${fullData.length} filas totales)`;
        }
        previewUpdateControls(containerId, isZip, parents.length);
    }

    // Auto-ajuste de altura después de renderizar
    const visibleRows = container.querySelectorAll('tbody tr:not(.hidden)');
    requestAnimationFrame(() => {
        visibleRows.forEach(row => adjustPreviewRowHeights(row));
    });
}

function _buildPreviewHeader(columnDefs, containerId, isZip) {
    const trHead = document.createElement('tr');
    const expandWidth = '40px';
    const thExpand = document.createElement('th');
    thExpand.style.cssText = `width:${expandWidth}; min-width:${expandWidth}; max-width:${expandWidth}; text-align:center; vertical-align:middle;`;
    const icon = _previewAllExpanded ? '▾' : '▸';
    thExpand.innerHTML = `<span class="expand-all-btn" onclick="toggleAllPreviewParents('${containerId}')" style="font-size:1.2em;cursor:pointer;">${icon}</span>`;
    trHead.appendChild(thExpand);

    // ✅ FIX: en lugar de checkbox, texto "Seleccionar" clickeable
    const actionWidth = '90px';
    const thCheck = document.createElement('th');
    thCheck.className = 'preview-th-select';
    thCheck.style.cssText = `width:${actionWidth}; min-width:${actionWidth}; max-width:${actionWidth}; text-align:center; vertical-align:middle; cursor:pointer; user-select:none;`;
    thCheck.innerHTML = `<span id="masterSelectLabel_${containerId}" style="font-weight:600;font-size:0.8em;" onclick="toggleAllPreviewCheckboxesFromText('${containerId}', ${isZip})">Seleccionar</span>`;
    trHead.appendChild(thCheck);

    columnDefs.forEach(col => {
        if (col.keyName === 'id') return;
        const th = document.createElement('th');
        const width = COLUMN_WIDTHS[col.keyName] || 'auto';
        th.style.cssText = `width:${width}; min-width:${width}; max-width:${width};`;
        th.textContent = col.displayName;
        trHead.appendChild(th);
    });
    return trHead;
}

// ✅ NUEVA: Alterna todos los checkboxes desde el texto "Seleccionar"
function toggleAllPreviewCheckboxesFromText(containerId, isZip) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const checkboxes = container.querySelectorAll('.action-checkbox');
    if (checkboxes.length === 0) return;
    // Si TODOS están marcados → desmarcar. Si no → marcar todos.
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    const targetState = !allChecked;

    checkboxes.forEach(cb => {
        cb.checked = targetState;
        const hash = cb.dataset.hash;
        if (hash) {
            const fullData = isZip ? folderPreviewData : allPreviewData;
            const row = fullData.find(r => r._hash === hash);
            if (row) {
                row._action = targetState ? (row._is_duplicate ? 'overwrite' : 'insert') : 'ignore';
            }
        }
    });
    updateSelectAllNonDuplicatesCheckbox(containerId, isZip);
    // Actualizar el texto del botón
    const label = document.getElementById(`masterSelectLabel_${containerId}`);
    if (label) label.textContent = targetState ? 'Deseleccionar' : 'Seleccionar';
}

// ✅ Helper seguro para buscar filas por data-attr (evita romper selectores CSS
// cuando el valor contiene comillas, corchetes, comas, etc.)
function findRowsByDataAttr(container, attrName, attrValue) {
    if (!container) return [];
    if (attrValue === undefined || attrValue === null) return [];
    const strValue = String(attrValue);
    return Array.from(container.querySelectorAll('tr')).filter(tr => {
        return tr.dataset[attrName] === strValue;
    });
}

function _buildPreviewRow(rowInfo, isParent, containerId, isZip, pageData, fullData) {
    const rowData = rowInfo.data || rowInfo;
    const isDup = rowInfo._is_duplicate || false;
    const checked = (rowInfo._action === 'insert' || rowInfo._action === 'overwrite');
    const hasNew = rowInfo._nuevo_en_catalogo && Object.keys(rowInfo._nuevo_en_catalogo).length > 0;
    const cls = (isDup ? 'duplicate-row-preview' : '') + (hasNew ? ' has-new-catalog' : '');
    const hash = rowInfo._hash;

    const tr = document.createElement('tr');
    tr.className = `${cls} parent-row`;
    tr.dataset.idx = rowInfo.original_csv_index;
    tr.dataset.hash = hash;

    // ----- Columna de expansión -----
    const tdExpand = document.createElement('td');
    tdExpand.style.cssText = 'width:40px; min-width:40px; max-width:40px; text-align:center; vertical-align:middle; padding:2px 4px;';
    if (isParent) {
        const btn = document.createElement('span');
        btn.className = 'expand-btn';
        btn.textContent = '▸';
        btn.dataset.parentHash = hash;
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const parentHash = this.dataset.parentHash;
            const containerEl = document.getElementById(containerId);
            console.log(`🖱️ Clic en expandir para parentHash: ${parentHash.substring(0, 60)}...`);

            if (this.textContent === '▼') {
                console.log(`   ▶ Colapsando...`);
                const childRows = getElementsByParentHash(containerEl, parentHash);
                childRows.forEach(row => row.remove());
                // ✅ FIX: usar helper seguro en lugar de querySelectorAll con atributo
                const pagRows = findRowsByDataAttr(containerEl, 'parentHash', parentHash)
                    .filter(r => r.classList.contains('pagination-row'));
                pagRows.forEach(r => r.remove());
                this.textContent = '▶';
                return;
            }
            console.log(`   ▶ Expandiendo...`);
            const saved = _childPage[parentHash];
            const startPage = (saved && saved.page) ? saved.page : 1;
            console.log(`   📄 Usando página guardada: ${startPage}`);
            loadChildrenForParent(parentHash, containerId, this, startPage);
        });
        tdExpand.appendChild(btn);
    } else {
        tdExpand.innerHTML = '&nbsp;';
        tdExpand.style.paddingLeft = '20px';
    }
    tr.appendChild(tdExpand);

    // ----- Columna checkbox -----
    const tdCheck = document.createElement('td');
    tdCheck.style.cssText = 'text-align:center; padding:2px 4px; vertical-align:middle;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'action-checkbox';
    cb.dataset.hash = hash;
    cb.dataset.iszip = isZip;
    if (checked) cb.checked = true;
    cb.addEventListener('change', function () {
        const parentHash = this.dataset.hash;
        const isChecked = this.checked;
        console.log(`🔁 Cambio en checkbox del padre ${parentHash.substring(0, 40)}... -> ${isChecked ? 'marcado' : 'desmarcado'}`);

        // 1. Sincronizar hijos ya cargados (visibles)
        // ✅ FIX: usar helper seguro
        const containerEl = document.getElementById(containerId);
        const childRows = findRowsByDataAttr(containerEl, 'parentHash', parentHash);
        childRows.forEach(childRow => {
            const childCb = childRow.querySelector('.action-checkbox');
            if (childCb) {
                childCb.checked = isChecked;
                const childHash = childCb.dataset.hash;
                const childData = pageData.find(r => r._hash === childHash);
                if (childData) {
                    childData._action = isChecked ? (childData._is_duplicate ? 'overwrite' : 'insert') : 'ignore';
                }
            }
        });

        // 2. Sincronizar hijos NO cargados
        const fullDataRef = isZip ? folderPreviewData : allPreviewData;
        if (fullDataRef && Array.isArray(fullDataRef)) {
            fullDataRef.forEach(row => {
                if (row._is_child && row._parent_hash === parentHash) {
                    row._action = isChecked ? (row._is_duplicate ? 'overwrite' : 'insert') : 'ignore';
                    const childRowEl = findRowsByDataAttr(containerEl, 'hash', row._hash)[0];
                    if (childRowEl) {
                        const cbChild = childRowEl.querySelector('.action-checkbox');
                        if (cbChild) cbChild.checked = isChecked;
                    }
                }
            });
        }

        // 3. Actualizar el padre en los datos de la página actual
        const parentData = pageData.find(r => r._hash === parentHash);
        if (parentData) {
            parentData._action = isChecked ? (parentData._is_duplicate ? 'overwrite' : 'insert') : 'ignore';
        }

        // 4. Actualizar checkbox maestro no-duplicados
        updateSelectAllNonDuplicatesCheckbox(containerId, isZip);

        // 5. Actualizar checkbox maestro "Seleccionar todos"
        const masterCb = document.getElementById(`masterCheckbox_${containerId}`);
        if (masterCb) {
            const allCheckboxes = containerEl.querySelectorAll('.action-checkbox');
            const allChecked = Array.from(allCheckboxes).every(c => c.checked);
            masterCb.checked = allChecked;
        }
    });
    tdCheck.appendChild(cb);
    tr.appendChild(tdCheck);

    // ----- Columnas de datos -----
    const columnDefs = window.COLUMN_DEFINITIONS || [];
    columnDefs.forEach(col => {
        if (col.keyName === 'id') return;
        const td = document.createElement('td');
        const width = COLUMN_WIDTHS[col.keyName] || 'auto';
        td.style.cssText = `width:${width}; min-width:${width}; max-width:${width}; padding:2px; vertical-align:top;`;
        let val = (rowData[col.keyName] !== undefined && rowData[col.keyName] !== null) ? String(rowData[col.keyName]) : '';
        if (col.keyName === 'valor' && val !== '' && !isNaN(val)) val = formatNumero(val);

        const isSelect = col.type === 'select' && col.options && col.options.length > 0;
        if (isSelect) {
            const containerDiv = document.createElement('div');
            containerDiv.className = 'select-wrap';
            const displayDiv = document.createElement('div');
            displayDiv.className = 'select-display preview-edit';
            displayDiv.textContent = val || 'Seleccionar...';
            const select = document.createElement('select');
            select.className = 'preview-edit';
            const tempVal = rowInfo._temp_new_values && rowInfo._temp_new_values[col.keyName] ? rowInfo._temp_new_values[col.keyName] : null;
            let htmlOpts = '<option value="">-seleccionar-</option>';
            col.options.forEach(o => {
                const selected = (o === val || o === tempVal);
                htmlOpts += `<option value="${escapeHtml(o)}" ${selected ? 'selected' : ''}>${escapeHtml(o)}</option>`;
            });
            htmlOpts += '<option value="_OTRA_">+ Otra…</option>';
            select.innerHTML = htmlOpts;
            if (tempVal && !col.options.includes(tempVal)) {
                select.value = tempVal;
                displayDiv.textContent = tempVal;
                displayDiv.style.color = 'orange';
                if (!rowInfo._nuevo_en_catalogo) rowInfo._nuevo_en_catalogo = {};
                rowInfo._nuevo_en_catalogo[col.keyName] = true;
            }
            select.dataset.col = col.keyName;
            select.dataset.hash = hash;
            select.addEventListener('change', function () {
                if (this.value === '_OTRA_') {
                    openPreviewOtraOpcion(col, rowInfo, isZip);
                    this.value = '';
                    return;
                }
                const newVal = this.value;
                const colKey = col.keyName;
                rowData[colKey] = newVal;
                displayDiv.textContent = newVal || 'Seleccionar...';

                if (isParent) {
                    const parentHash = hash;
                    const fullDataRef = isZip ? folderPreviewData : allPreviewData;
                    if (fullDataRef && Array.isArray(fullDataRef)) {
                        fullDataRef.forEach(childRow => {
                            if (childRow._is_child && childRow._parent_hash === parentHash) {
                                if (!childRow.data) childRow.data = {};
                                childRow.data[colKey] = newVal;
                                const childRowEl = findRowsByDataAttr(containerEl, 'hash', childRow._hash)[0];
                                if (childRowEl) {
                                    const childSelect = childRowEl.querySelector(`select[data-col="${colKey}"]`);
                                    if (childSelect) childSelect.value = newVal;
                                    const childDisplay = childRowEl.querySelector(`div[data-display="${colKey}"]`);
                                    if (childDisplay) childDisplay.textContent = newVal;
                                }
                            }
                        });
                    }
                }

                if (col.options.includes(newVal)) {
                    if (rowInfo._nuevo_en_catalogo) delete rowInfo._nuevo_en_catalogo[colKey];
                } else {
                    if (!rowInfo._nuevo_en_catalogo) rowInfo._nuevo_en_catalogo = {};
                    rowInfo._nuevo_en_catalogo[colKey] = true;
                }
                renderPreviewTable(containerId, pageData, isZip, false, fullDataRef);
            });

            containerDiv.appendChild(displayDiv);
            containerDiv.appendChild(select);
            td.appendChild(containerDiv);
        } else {
            const textarea = document.createElement('textarea');
            textarea.className = 'preview-edit';
            textarea.value = val;
            textarea.style.cssText = 'width:100%; min-height:24px; padding:2px 4px; border:none; background:transparent; font-family:inherit; font-size:0.8em; resize:none; outline:none;';
            if (['proceso', 'eje', 'tema'].includes(col.keyName) && val.trim() === '') {
                textarea.placeholder = 'Asignar manualmente';
            }
            textarea.dataset.col = col.keyName;
            textarea.dataset.hash = hash;
            textarea.addEventListener('input', function () {
                rowData[col.keyName] = this.value;
                autoResize(this);
                const parentRowEl = this.closest('tr');
                if (parentRowEl) adjustPreviewRowHeights(parentRowEl);
            });
            td.appendChild(textarea);
        }
        tr.appendChild(td);
    });

    return tr;
}

// Carga de hijos para un padre en la previsualización
async function loadChildrenForParent(parentHash, containerId, btn, page = 1) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error('❌ loadChildrenForParent: Contenedor no encontrado:', containerId);
        showToast('Error interno: contenedor no encontrado.', true);
        return;
    }
    if (!page || page < 1) page = 1;
    if (btn.dataset.loading === 'true') return;
    btn.dataset.loading = 'true';

    console.log(`🚀 loadChildrenForParent: parentHash=${String(parentHash).substring(0, 60)}..., page=${page}`);

    try {
        const token = previewToken;
        if (!token) {
            console.error('❌ loadChildrenForParent: Token no disponible.');
            showToast('Token no disponible.', true);
            btn.dataset.loading = 'false';
            return;
        }

        const limit = 100;
        const offset = (page - 1) * limit;

        const resp = await fetch('/api/preview-children', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: token,
                parent_hash: parentHash,
                offset: offset,
                limit: limit
            })
        });
        if (!resp.ok) {
            const errText = await resp.text();
            console.error(`❌ loadChildrenForParent: Error en API (${resp.status}): ${errText}`);
            throw new Error(`Error al cargar hijos: ${resp.status}`);
        }

        const data = await resp.json();
        const children = data.children || [];
        const total = data.total || 0;
        const totalPages = Math.ceil(total / limit) || 1;

        // Fusionar _action guardados
        if (folderPreviewData && Array.isArray(folderPreviewData) && folderPreviewData.length > 0) {
            const actionMap = {};
            folderPreviewData.forEach(r => { if (r && r._hash) actionMap[r._hash] = r._action; });
            let fusedCount = 0;
            children.forEach(c => {
                if (c && c._hash && actionMap[c._hash] !== undefined) {
                    c._action = actionMap[c._hash];
                    fusedCount++;
                }
            });
            console.log(`🔀 loadChildrenForParent: fusionadas ${fusedCount}/${children.length} acciones en hijos`);
        }

        _childPage[parentHash] = { page, totalPages };

        // ✅ FIX: eliminar hijos existentes con helper seguro
        const existingChildren = findRowsByDataAttr(container, 'parentHash', parentHash)
            .filter(r => r.classList.contains('child-row-preview'));
        existingChildren.forEach(row => row.remove());

        // ✅ FIX: eliminar filas de paginación con helper seguro
        const existingPagination = findRowsByDataAttr(container, 'parentHash', parentHash)
            .filter(r => r.classList.contains('pagination-row'));
        existingPagination.forEach(row => row.remove());

        const fragment = document.createDocumentFragment();

        if (total === 0) {
            const msgRow = document.createElement('tr');
            msgRow.className = 'child-row-preview info-row';
            msgRow.dataset.parentHash = parentHash;
            const td = document.createElement('td');
            td.colSpan = container.querySelector('tr').cells.length;
            td.textContent = 'Este padre no tiene hijos.';
            td.style.textAlign = 'center';
            td.style.fontStyle = 'italic';
            msgRow.appendChild(td);
            fragment.appendChild(msgRow);
            btn.textContent = '▶';
            btn.dataset.loading = 'false';
            return;
        }

        children.forEach((childInfo) => {
            const childRow = createPreviewChildRow(childInfo, parentHash, containerId, true);
            fragment.appendChild(childRow);
        });

        if (totalPages > 1) {
            const paginationRow = document.createElement('tr');
            paginationRow.className = 'pagination-row';
            paginationRow.dataset.parentHash = parentHash;
            const td = document.createElement('td');
            td.colSpan = container.querySelector('tr').cells.length;
            td.style.textAlign = 'center';
            td.style.padding = '8px 0';

            const prevBtn = document.createElement('button');
            prevBtn.className = 'btn btn-outline';
            prevBtn.textContent = '◀ Anterior';
            prevBtn.disabled = page <= 1;
            prevBtn.style.marginRight = '10px';
            prevBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (page - 1 >= 1) loadChildrenForParent(parentHash, containerId, btn, page - 1);
            });

            const pageInfo = document.createElement('span');
            pageInfo.textContent = ` Página ${page} de ${totalPages} `;
            pageInfo.style.margin = '0 10px';

            const nextBtn = document.createElement('button');
            nextBtn.className = 'btn btn-outline';
            nextBtn.textContent = 'Siguiente ▶';
            nextBtn.disabled = page >= totalPages;
            nextBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (page + 1 <= totalPages) loadChildrenForParent(parentHash, containerId, btn, page + 1);
            });

            td.appendChild(prevBtn);
            td.appendChild(pageInfo);
            td.appendChild(nextBtn);
            paginationRow.appendChild(td);
            fragment.appendChild(paginationRow);
        }

        // ✅ FIX: encontrar el parent row con helper seguro
        const parentRow = findRowsByDataAttr(container, 'hash', parentHash)[0];
        if (parentRow) {
            parentRow.parentNode.insertBefore(fragment, parentRow.nextSibling);
        } else {
            const tbody = container.querySelector('tbody');
            if (tbody) tbody.appendChild(fragment);
        }

        btn.textContent = '▼';
        btn.dataset.loading = 'false';
        console.log(`✅ loadChildrenForParent finalizado para página ${page}`);

        requestAnimationFrame(() => {
            const newRows = findRowsByDataAttr(container, 'parentHash', parentHash);
            newRows.forEach(row => adjustPreviewRowHeights(row));
            if (parentRow) adjustPreviewRowHeights(parentRow);
        });
    } catch (e) {
        console.error('❌ Error en loadChildrenForParent:', e);
        showToast('Error al cargar hijos: ' + e.message, true);
        btn.dataset.loading = 'false';
    }
}

function createPreviewChildRow(childInfo, parentHash, containerId, isZip) {
    const tr = document.createElement('tr');
    tr.className = 'child-row-preview';
    tr.dataset.parentHash = parentHash;
    tr.dataset.hash = childInfo._hash;

    const rowData = childInfo.data || childInfo;
    const isDup = childInfo._is_duplicate || false;
    const checked = (childInfo._action === 'insert' || childInfo._action === 'overwrite');
    if (isDup) tr.classList.add('duplicate-row-preview');

    const columnDefs = window.COLUMN_DEFINITIONS || [];

    // Columna de expansión (vacía para hijos)
    const tdExpand = document.createElement('td');
    tdExpand.style.cssText = 'width:40px; min-width:40px; max-width:40px; padding-left:20px;';
    tdExpand.innerHTML = '&nbsp;';
    tr.appendChild(tdExpand);

    // Columna checkbox
    const tdCheck = document.createElement('td');
    tdCheck.style.cssText = 'text-align:center; padding:2px 4px; vertical-align:middle;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'action-checkbox';
    cb.dataset.hash = childInfo._hash;
    cb.dataset.iszip = isZip;
    if (checked) cb.checked = true;
    // Evento change para actualizar la acción del hijo
    cb.addEventListener('change', function() {
        const hash = this.dataset.hash;
        const isChecked = this.checked;
        // Buscar en los datos completos y actualizar _action
        const fullData = isZip ? folderPreviewData : allPreviewData;
        if (fullData) {
            const row = fullData.find(r => r._hash === hash);
            if (row) {
                row._action = isChecked ? (row._is_duplicate ? 'overwrite' : 'insert') : 'ignore';
            }
        }
        // Actualizar el checkbox del padre si todos los hijos están marcados (opcional)
        updateSelectAllNonDuplicatesCheckbox(containerId, isZip);
    });
    tdCheck.appendChild(cb);
    tr.appendChild(tdCheck);

    // Columnas de datos (omitir ID) – ahora con controles editables
    columnDefs.forEach(col => {
        if (col.keyName === 'id') return;
        const td = document.createElement('td');
        const width = COLUMN_WIDTHS[col.keyName] || 'auto';
        td.style.cssText = `width:${width}; min-width:${width}; max-width:${width}; padding:2px 4px; vertical-align:top;`;
        let val = (rowData[col.keyName] !== undefined && rowData[col.keyName] !== null) ? String(rowData[col.keyName]) : '';
        if (col.keyName === 'valor' && val !== '' && !isNaN(val)) val = formatNumero(val);

        const isSelect = col.type === 'select' && col.options && col.options.length > 0;
        if (isSelect) {
            // Select con display div
            const containerDiv = document.createElement('div');
            containerDiv.style.position = 'relative';
            containerDiv.style.width = '100%';
            containerDiv.style.cursor = 'pointer';
            const displayDiv = document.createElement('div');
            displayDiv.className = 'preview-edit';
            displayDiv.textContent = val || 'Seleccionar...';
            displayDiv.style.cssText = 'width:100%; min-height:28px; padding:2px 4px; border:1px solid transparent; background:transparent; font-family:inherit; font-size:0.8em; color:var(--text-main);';
            displayDiv.dataset.display = col.keyName;  // <-- para sincronización
            const select = document.createElement('select');
            select.className = 'preview-edit';
            select.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; opacity:0; cursor:pointer;';
            const tempVal = childInfo._temp_new_values && childInfo._temp_new_values[col.keyName] ? childInfo._temp_new_values[col.keyName] : null;
            let htmlOpts = '<option value="">-seleccionar-</option>';
            col.options.forEach(o => {
                const selected = (o === val || o === tempVal);
                htmlOpts += `<option value="${escapeHtml(o)}" ${selected ? 'selected' : ''}>${escapeHtml(o)}</option>`;
            });
            htmlOpts += '<option value="_OTRA_">+ Otra…</option>';
            select.innerHTML = htmlOpts;
            if (tempVal && !col.options.includes(tempVal)) {
                select.value = tempVal;
                displayDiv.textContent = tempVal;
                displayDiv.style.color = 'orange';
                if (!childInfo._nuevo_en_catalogo) childInfo._nuevo_en_catalogo = {};
                childInfo._nuevo_en_catalogo[col.keyName] = true;
            }
            select.dataset.col = col.keyName;
            select.dataset.hash = childInfo._hash;
            select.addEventListener('change', function(e) {
                if (this.value === '_OTRA_') {
                    openPreviewOtraOpcion(col, childInfo, isZip);
                    this.value = '';
                    return;
                }
                const newVal = this.value;
                const colKey = col.keyName;
                rowData[colKey] = newVal;
                displayDiv.textContent = newVal || 'Seleccionar...';
                // Actualizar catálogo
                if (col.options.includes(newVal)) {
                    if (childInfo._nuevo_en_catalogo) delete childInfo._nuevo_en_catalogo[colKey];
                } else {
                    if (!childInfo._nuevo_en_catalogo) childInfo._nuevo_en_catalogo = {};
                    childInfo._nuevo_en_catalogo[colKey] = true;
                }
                // Re-renderizar la página actual para reflejar cambios en los selects
                const fullData = isZip ? folderPreviewData : allPreviewData;
                const pageData = isZip ? window._currentPageParents : allPreviewData;
                renderPreviewTable(containerId, pageData, isZip, false, fullData);
            });
            containerDiv.appendChild(displayDiv);
            containerDiv.appendChild(select);
            td.appendChild(containerDiv);
            if (childInfo._nuevo_en_catalogo && childInfo._nuevo_en_catalogo[col.keyName]) {
                const warnSpan = document.createElement('span');
                warnSpan.textContent = ' ⚠️';
                warnSpan.style.color = 'orange';
                warnSpan.title = 'Valor nuevo en catálogo';
                td.appendChild(warnSpan);
            }
        } else {
            // Textarea
            const textarea = document.createElement('textarea');
            textarea.className = 'preview-edit';
            textarea.value = val;
            textarea.style.cssText = 'width:100%; min-height:28px; padding:2px 4px; border:none; background:transparent; font-family:inherit; font-size:0.8em; resize:none; outline:none;';
            if (['proceso','eje','tema'].includes(col.keyName) && val.trim() === '') {
                textarea.placeholder = 'Asignar manualmente';
            }
            textarea.dataset.col = col.keyName;
            textarea.dataset.hash = childInfo._hash;
            textarea.addEventListener('input', function() {
                rowData[col.keyName] = this.value;
                autoResize(this);
                const parentRow = this.closest('tr');
                if (parentRow) adjustPreviewRowHeights(parentRow);
            });
            td.appendChild(textarea);
        }
        tr.appendChild(td);
    });

    return tr;
}

function toggleAllPreviewParents(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.warn(`⚠️ toggleAllPreviewParents: Contenedor ${containerId} no encontrado.`);
        return;
    }
    const allParentRows = container.querySelectorAll('tbody tr.parent-row');
    if (allParentRows.length === 0) {
        console.log(`ℹ️ toggleAllPreviewParents: No hay padres en ${containerId}.`);
        return;
    }

    _previewAllExpanded = !_previewAllExpanded;
    const newState = _previewAllExpanded ? 'expand' : 'collapse';
    const icon = _previewAllExpanded ? '▾' : '▸';
    console.log(`🔄 toggleAllPreviewParents: Estado = ${newState} (${allParentRows.length} padres)`);

    const expandBtn = container.querySelector('.expand-all-btn');
    if (expandBtn) expandBtn.textContent = icon;

    allParentRows.forEach((parentRow, index) => {
        const btn = parentRow.querySelector('.expand-btn');
        if (!btn) return;
        const parentHash = btn.dataset.parentHash;
        if (!parentHash) return;

        if (newState === 'expand') {
            if (btn.textContent === '▸') {
                console.log(`   ▶ Expandiendo padre ${index+1}/${allParentRows.length}: ${parentHash.substring(0, 40)}...`);
                const saved = _childPage[parentHash];
                const startPage = (saved && saved.page) ? saved.page : 1;
                loadChildrenForParent(parentHash, containerId, btn, startPage);
            } else {
                console.log(`   ⏭️ Padre ${index+1} ya expandido.`);
            }
        } else {
            if (btn.textContent === '▼') {
                console.log(`   ▼ Colapsando padre ${index+1}: ${parentHash.substring(0, 40)}...`);
                const childRows = getElementsByParentHash(container, parentHash);
                childRows.forEach(row => row.remove());
                btn.textContent = '▶';
            }
        }
    });
    requestAnimationFrame(() => {
        allParentRows.forEach(row => adjustPreviewRowHeights(row));
    });
}

function toggleAllPreviewCheckboxes(master, containerId, isZip) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const checkboxes = container.querySelectorAll('.action-checkbox');
    const checked = master.checked;
    checkboxes.forEach(cb => {
        cb.checked = checked;
        const hash = cb.dataset.hash;
        if (hash) {
            const row = allFolderData.find(r => r._hash === hash);
            if (row) {
                row._action = checked ? (row._is_duplicate ? 'overwrite' : 'insert') : 'ignore';
                if (row._is_duplicate) {
                    if (checked) overwriteSet.add(hash);
                    else overwriteSet.delete(hash);
                }
            }
        }
    });
    updateSelectAllNonDuplicatesCheckbox(containerId, isZip);
}

// ============================================================
// FUNCIONES PARA "OTRA OPCIÓN" EN PREVISUALIZACIÓN
// ============================================================

function openPreviewOtraOpcion(colDef, rowInfo, isZip) {
    const modal = document.getElementById('modalOtraOpcion');
    const input = document.getElementById('otraOpcionInput');
    const title = document.getElementById('modalOtraTitle');
    const label = document.getElementById('modalOtraLabel');
    title.textContent = `Agregar ${colDef.displayName}`;
    label.textContent = `Ingrese el nuevo valor para "${colDef.displayName}"`;
    input.value = '';
    modal.style.display = 'flex';
    // Guardar valor anterior del select
    const select = document.querySelector(`#${isZip ? 'zipPreviewTable' : 'uploadDataPreview'} select[data-col="${colDef.keyName}"][data-hash="${rowInfo._hash}"]`);
    _previousSelectValue = select ? select.value : '';
    _currentOtraCallback = { colDef, rowInfo, isZip, previousValue: _previousSelectValue };
    document.getElementById('btnConfirmOtra').onclick = confirmPreviewOtraOpcion;
}

function confirmPreviewOtraOpcion() {
    const input = document.getElementById('otraOpcionInput');
    const value = input.value.trim();
    if (!value) { showToast('Ingresa un valor válido.'); return; }
    const { colDef, rowInfo, isZip } = _currentOtraCallback;
    const colKey = colDef.keyName;

    fetch(`/api/catalog/${colKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'inserted' || data.status === 'already_exists') {
            const finalValue = data.value || value;
            if (!colDef.options.includes(finalValue)) {
                colDef.options.push(finalValue);
                colDef.options.sort();
            }
            rowInfo._temp_new_values = rowInfo._temp_new_values || {};
            rowInfo._temp_new_values[colKey] = finalValue;
            if (!rowInfo._nuevo_en_catalogo) rowInfo._nuevo_en_catalogo = {};
            rowInfo._nuevo_en_catalogo[colKey] = true;
            const targetData = isZip ? folderPreviewData : allPreviewData;
            const containerId = isZip ? 'zipPreviewTable' : 'uploadDataPreview';
            renderPreviewTable(containerId, targetData, isZip, false, null);
            showToast(`✅ Valor "${finalValue}" agregado al catálogo`);
        } else if (data.status === 'suggestion') {
            showSuggestionModalPreview(data.suggested_value, value, rowInfo, colDef, isZip);
        } else {
            showToast('Error al agregar: ' + (data.error || ''), true);
        }
    })
    .catch(e => showToast('Error de conexión', true));
    closeModal('modalOtraOpcion');
}

function showSuggestionModalPreview(suggested, original, rowInfo, colDef, isZip) {
    const modal = document.getElementById('modalSuggestion');
    document.getElementById('suggestionMessage').textContent =
        `¿Quieres usar "${suggested}" en lugar de "${original}"?`;
    modal.style.display = 'flex';
    document.getElementById('btnAcceptSuggestion').onclick = function() {
        if (!colDef.options.includes(suggested)) {
            colDef.options.push(suggested);
            colDef.options.sort();
        }
        rowInfo._temp_new_values = rowInfo._temp_new_values || {};
        rowInfo._temp_new_values[colDef.keyName] = suggested;
        if (!rowInfo._nuevo_en_catalogo) rowInfo._nuevo_en_catalogo = {};
        rowInfo._nuevo_en_catalogo[colDef.keyName] = true;
        const targetData = isZip ? folderPreviewData : allPreviewData;
        const containerId = isZip ? 'zipPreviewTable' : 'uploadDataPreview';
        renderPreviewTable(containerId, targetData, isZip, false, null);
        closeModal('modalSuggestion');
        showToast(`✅ Usado "${suggested}"`);
    };
    document.getElementById('btnDeclineSuggestion').onclick = function() {
        fetch(`/api/catalog/${colDef.keyName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: original })
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'inserted' || data.status === 'already_exists') {
                const finalValue = data.value || original;
                if (!colDef.options.includes(finalValue)) {
                    colDef.options.push(finalValue);
                    colDef.options.sort();
                }
                rowInfo._temp_new_values = rowInfo._temp_new_values || {};
                rowInfo._temp_new_values[colDef.keyName] = finalValue;
                if (!rowInfo._nuevo_en_catalogo) rowInfo._nuevo_en_catalogo = {};
                rowInfo._nuevo_en_catalogo[colDef.keyName] = true;
                const targetData = isZip ? folderPreviewData : allPreviewData;
                const containerId = isZip ? 'zipPreviewTable' : 'uploadDataPreview';
                renderPreviewTable(containerId, targetData, isZip, false, null);
                showToast(`✅ Usado "${finalValue}"`);
            } else {
                showToast('Error al agregar', true);
            }
        })
        .catch(e => showToast('Error de conexión', true));
        closeModal('modalSuggestion');
    };
}

// ============================================================
// PREVISUALIZACIÓN DE PÁGINAS (para ZIP)
// ============================================================

async function loadPreviewPage(token, page, pageSize) {
    console.log(`⏱️ loadPreviewPage: token=${token ? token.substring(0,8) : 'null'}, page=${page}, pageSize=${pageSize}`);
    try {
        const resp = await fetch('/api/preview-page', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, page, page_size: pageSize })
        });
        if (!resp.ok) {
            console.error(`❌ loadPreviewPage: HTTP ${resp.status}`);
            showToast('Error al cargar página de previsualización.');
            return;
        }
        const data = await resp.json();
        let pageData = data.preview_data;
        if (!pageData || !Array.isArray(pageData)) pageData = [];

        //  fusionar _action guardados en folderPreviewData
        if (folderPreviewData && Array.isArray(folderPreviewData) && folderPreviewData.length > 0) {
            const actionMap = {};
            folderPreviewData.forEach(r => {
                if (r && r._hash) actionMap[r._hash] = r._action;
            });
            let fusedCount = 0;
            pageData.forEach(r => {
                if (r && r._hash && actionMap[r._hash] !== undefined) {
                    r._action = actionMap[r._hash];
                    fusedCount++;
                }
            });
            console.log(`🔀 loadPreviewPage: fusionadas ${fusedCount}/${pageData.length} acciones en padres`);
        } else {
            console.log(`ℹ️ loadPreviewPage: folderPreviewData vacío, sin fusión`);
        }

        totalParents = data.total_rows || 0;
        currentParentPage = page;
        parentsPerPage = pageSize;
        previewCurrentPage = page;

        window._currentPageParents = pageData;

        renderPreviewTable('zipPreviewTable', pageData, true, true, null);

        const rc = document.getElementById('rowCount');
        if (rc) rc.textContent = `${pageData.length} padres (total ${totalParents})`;

        previewUpdateControls('zipPreviewTable', true, totalParents);
    } catch (e) {
        console.error('❌ Error en loadPreviewPage:', e);
        showToast('Error de conexión: ' + e.message);
    }
}

function previewUpdateControls(containerId, isZip, totalParentsInPage) {
    const totalParentsGlobal = totalParents;
    const pageSize = parentsPerPage || 5;
    const totalPages = Math.ceil(totalParentsGlobal / pageSize) || 1;
    let currentPage = currentParentPage || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    currentParentPage = currentPage;

    const controlsId = isZip ? 'zipPaginationControls' : 'paginationControls';
    const prevBtn = document.getElementById(isZip ? 'zipPrevPageBtn' : 'prevPageBtn');
    const nextBtn = document.getElementById(isZip ? 'zipNextPageBtn' : 'nextPageBtn');
    const controls = document.getElementById(controlsId);
    if (!controls) return;
    controls.style.display = 'flex';
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

    const pageInput = document.getElementById(isZip ? 'zipPageInput' : 'previewPageInput');
    if (pageInput) {
        pageInput.value = currentPage;
        pageInput.min = 1;
        pageInput.max = totalPages;
    }
    const totalSpan = document.getElementById(isZip ? 'zipTotalPages' : 'previewTotalPages');
    if (totalSpan) totalSpan.textContent = totalPages;
}

function goToPreviewPage(page, containerId, isZip) {
    const token = previewToken || window._previewToken;
    if (!token) {
        showToast('⚠️ No hay token de previsualización.', true);
        return;
    }
    let p = parseInt(page);
    if (isNaN(p) || p < 1) p = 1;
    const totalPages = Math.ceil(totalParents / parentsPerPage) || 1;
    if (p > totalPages) p = totalPages;
    if (p !== currentParentPage) {
        loadPreviewPage(token, p, parentsPerPage);
    }
}

function previewPrevPage(containerId, isZip) {
    const token = previewToken || window._previewToken;
    if (!token) return;
    const newPage = (currentParentPage || 1) - 1;
    if (newPage >= 1) {
        loadPreviewPage(token, newPage, parentsPerPage);
    }
}

function previewNextPage(containerId, isZip) {
    const token = previewToken || window._previewToken;
    if (!token) return;
    const totalPages = Math.ceil(totalParents / parentsPerPage) || 1;
    const newPage = (currentParentPage || 1) + 1;
    if (newPage <= totalPages) {
        loadPreviewPage(token, newPage, parentsPerPage);
    }
}

// ============================================================
// GESTIÓN DE USUARIOS (para vista)
// ============================================================

async function loadCurrentUser() {
    try {
        const res = await fetch('/api/current-user');
        if (res.ok) {
            const data = await res.json();
            if (data && data.username) {
                const usernameEl = document.getElementById('currentUsername');
                if (usernameEl) usernameEl.textContent = data.username;
                window._currentUserId = data.id;
                const adminLink = document.getElementById('adminUsersLink');
                if (adminLink) {
                    adminLink.style.display = data.rol === 'admin' ? 'block' : 'none';
                }
            }
        }
    } catch (e) {
        console.warn('Error cargando usuario actual:', e);
    }
}

let _userEditMode = false;
let _usersSnapshot = [];   // copia original para poder cancelar
let _userEditDirty = {};   // {user_id: {username, rol, password}}

function toggleUserEditMode() {
    if (_userEditMode) {
        // Está en modo edición → guardar cambios
        saveAllUserEdits();
    } else {
        _userEditMode = true;
        _userEditDirty = {};
        loadUsers();
    }
    updateUserEditUI();
}

function updateUserEditUI() {
    const btn = document.getElementById('userEditToggleBtn');
    const label = document.getElementById('userEditToggleLabel');
    const cancelBtn = document.getElementById('userEditCancelBtn');
    if (!btn || !label) return;
    if (_userEditMode) {
        btn.classList.remove('btn-outline');
        btn.classList.add('btn-success');
        label.textContent = 'Terminar edición';
        if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    } else {
        btn.classList.remove('btn-success');
        btn.classList.add('btn-outline');
        label.textContent = 'Editar';
        if (cancelBtn) cancelBtn.style.display = 'none';
    }
}

function cancelUserEdits() {
    _userEditMode = false;
    _userEditDirty = {};
    updateUserEditUI();
    loadUsers();
}

function _markUserDirty(userId, field, value) {
    if (!userId) return;
    if (!_userEditDirty[userId]) _userEditDirty[userId] = {};
    _userEditDirty[userId][field] = value;
    console.log(`✏️ user ${userId} campo '${field}' = '${field === 'password' ? '***' : value}'`);
}

async function saveAllUserEdits() {
    const ids = Object.keys(_userEditDirty);
    if (ids.length === 0) {
        // Sin cambios: cerrar el modo edición y repintar la tabla en modo lectura.
        _userEditMode = false;
        _userEditDirty = {};
        updateUserEditUI();
        await loadUsers();   // ✅ FIX: forzar re-render para quitar los inputs
        return;
    }

    const payload = [];
    for (const uid of ids) {
        const changes = _userEditDirty[uid];
        if ('password' in changes && changes.password !== '') {
            if (changes.password.length < 6) {
                showToast(`⚠️ La contraseña de ${changes.username || uid} debe tener al menos 6 caracteres`, true);
                return;
            }
        }
        const item = { id: uid };
        if ('username' in changes && changes.username) item.username = changes.username;
        if ('rol' in changes && changes.rol) item.rol = changes.rol;
        if ('password' in changes && changes.password) item.password = changes.password;
        if (Object.keys(item).length > 1) payload.push(item);
    }

    if (payload.length === 0) {
        _userEditMode = false;
        _userEditDirty = {};
        updateUserEditUI();
        await loadUsers();
        return;
    }

    showSpinner(true);
    let okCount = 0, failCount = 0;
    for (const item of payload) {
        try {
            const resp = await fetch(`/api/users/${item.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item)
            });
            if (resp.ok) okCount++;
            else failCount++;
        } catch (e) { failCount++; }
    }
    showSpinner(false);

    _userEditMode = false;
    _userEditDirty = {};
    updateUserEditUI();
    await loadUsers();

    if (failCount === 0) {
        showToast(`✅ ${okCount} usuario(s) actualizado(s)`);
    } else {
        showToast(`⚠️ ${okCount} OK, ${failCount} con error`, true);
    }
}

async function loadUsers() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">Cargando...</td></tr>';

    // Mostrar/ocultar la columna de contraseña según el modo
    const pwdHeader = document.getElementById('usersPasswordHeader');
    if (pwdHeader) pwdHeader.style.display = _userEditMode ? '' : 'none';

    try {
        const res = await fetch('/api/users');
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Error al cargar usuarios');
        }
        const users = await res.json();
        _usersSnapshot = users.slice();

        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">No hay usuarios registrados.</td></tr>';
            return;
        }

        const editing = _userEditMode;
        let html = '';

        users.forEach(u => {
            const isCurrent = (u.id === window._currentUserId);
            const disabledSelf = isCurrent ? 'disabled' : '';

            if (editing) {
                html += `
                    <tr data-userid="${escapeHtml(u.id)}">
                        <td style="padding: 8px 10px;">
                            <input type="text"
                                   class="user-edit-input"
                                   data-userid="${escapeHtml(u.id)}"
                                   data-field="username"
                                   value="${escapeHtml(u.username)}"
                                   autocomplete="off"
                                   autocapitalize="off"
                                   spellcheck="false"
                                   ${isCurrent ? 'disabled title="No puedes cambiar tu propio nombre de usuario"' : ''}>
                            ${isCurrent ? ' <span style="font-size:0.7rem; color:var(--primary);">(tú)</span>' : ''}
                        </td>
                        <td style="padding: 8px 10px;">
                            <select class="user-rol-select"
                                    data-userid="${escapeHtml(u.id)}"
                                    ${disabledSelf}>
                                <option value="user" ${u.rol === 'user' ? 'selected' : ''}>Usuario</option>
                                <option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>Administrador</option>
                            </select>
                        </td>
                        <td style="padding: 8px 10px;">
                            <div class="password-field-wrapper">
                                <input type="password"
                                       class="user-edit-input"
                                       data-userid="${escapeHtml(u.id)}"
                                       data-field="password"
                                       placeholder="Nueva contraseña (vacío = sin cambio)"
                                       autocomplete="new-password"
                                       ${isCurrent ? 'disabled title="Usa el menú de usuario para cambiar tu propia contraseña"' : ''}>
                                <button type="button" class="password-toggle-btn"
                                        data-toggle-target="1"
                                        aria-label="Mostrar/ocultar">
                                    <svg class="eye-open" viewBox="0 0 24 24">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                        <circle cx="12" cy="12" r="3"/>
                                    </svg>
                                    <svg class="eye-closed" style="display:none;" viewBox="0 0 24 24">
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                                        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
                                        <line x1="1" y1="1" x2="23" y2="23"/>
                                    </svg>
                                </button>
                            </div>
                        </td>
                        <td style="padding: 8px 10px; text-align: center;">
                            ${!isCurrent ? `<button class="btn btn-danger user-delete-btn" data-userid="${escapeHtml(u.id)}" data-username="${escapeHtml(u.username)}" style="padding: 4px 12px; font-size: 0.8rem;">🗑️</button>` : '<span style="color:var(--text-muted); font-size:0.8rem;">—</span>'}
                        </td>
                    </tr>
                `;
            } else {
                html += `
                    <tr data-userid="${escapeHtml(u.id)}">
                        <td style="padding: 8px 10px;">${escapeHtml(u.username)} ${isCurrent ? ' <span style="font-size:0.7rem; color:var(--primary);">(tú)</span>' : ''}</td>
                        <td style="padding: 8px 10px;">
                            <select class="user-rol-select" data-userid="${escapeHtml(u.id)}" ${disabledSelf}>
                                <option value="user" ${u.rol === 'user' ? 'selected' : ''}>Usuario</option>
                                <option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>Administrador</option>
                            </select>
                        </td>
                        <td style="padding: 8px 10px; text-align: center;">
                            ${!isCurrent ? `<button class="btn btn-danger user-delete-btn" data-userid="${escapeHtml(u.id)}" data-username="${escapeHtml(u.username)}" style="padding: 4px 12px; font-size: 0.8rem;">🗑️</button>` : '<span style="color:var(--text-muted); font-size:0.8rem;">—</span>'}
                        </td>
                    </tr>
                `;
            }
        });

        tbody.innerHTML = html;
        _bindUsersTableEvents(tbody);

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--danger);">Error: ${escapeHtml(e.message)}</td></tr>`;
    }
}

/**
 * Bindea TODOS los eventos de la tabla de usuarios usando
 * event delegation. Evita handlers inline (que se rompían con
 * IDs con caracteres raros) y evita que el navegador dispare
 * autofill/popups de email alias.
 */
function _bindUsersTableEvents(tbody) {
    // 1) Inputs de username y password → _markUserDirty
    tbody.querySelectorAll('input.user-edit-input').forEach(input => {
        input.addEventListener('input', function () {
            const uid = this.dataset.userid;
            const field = this.dataset.field;
            if (uid && field) _markUserDirty(uid, field, this.value);
        });
        // Fallback por si `input` no dispara con autofill
        input.addEventListener('change', function () {
            const uid = this.dataset.userid;
            const field = this.dataset.field;
            if (uid && field) _markUserDirty(uid, field, this.value);
        });
    });

    // 2) Select de rol → _markUserDirty en modo edición, o PUT directo en modo normal
    tbody.querySelectorAll('select.user-rol-select').forEach(sel => {
        sel.addEventListener('change', async function () {
            const userId = this.dataset.userid;
            const newRol = this.value;
            if (_userEditMode) {
                _markUserDirty(userId, 'rol', newRol);
                return;
            }
            try {
                const resp = await fetch(`/api/users/${userId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rol: newRol })
                });
                const data = await resp.json().catch(() => ({}));
                if (resp.ok) {
                    showToast('✅ Rol actualizado');
                    loadUsers();
                } else {
                    showToast('❌ Error: ' + (data.error || ''), true);
                }
            } catch (e) {
                showToast('Error de conexión', true);
            }
        });
    });

    // 3) Botón del ojo (toggle password) — event delegation dentro de la tabla
    tbody.querySelectorAll('.password-toggle-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const wrapper = this.closest('.password-field-wrapper');
            if (!wrapper) return;
            const input = wrapper.querySelector('input');
            if (!input) return;
            const open = this.querySelector('.eye-open');
            const closed = this.querySelector('.eye-closed');
            if (input.type === 'password') {
                input.type = 'text';
                if (open) open.style.display = 'none';
                if (closed) closed.style.display = 'block';
            } else {
                input.type = 'password';
                if (open) open.style.display = 'block';
                if (closed) closed.style.display = 'none';
            }
        });
    });

    // 4) Botones de eliminar
    tbody.querySelectorAll('.user-delete-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const uid = this.dataset.userid;
            const uname = this.dataset.username || '';
            deleteUser(uid, uname);
        });
    });
}

async function createUser() {
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value.trim();
    const rol = document.getElementById('newRol').value;
    if (!username || !password) {
        showToast('⚠️ Completa usuario y contraseña');
        return;
    }
    if (password.length < 6) {
        showToast('⚠️ La contraseña debe tener al menos 6 caracteres');
        return;
    }
    try {
        const res = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, rol })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`✅ Usuario "${username}" creado`);
            document.getElementById('newUsername').value = '';
            document.getElementById('newPassword').value = '';
            loadUsers();
        } else {
            showToast('❌ Error: ' + (data.error || ''));
        }
    } catch(e) {
        showToast('Error de conexión');
    }
}

function changePassword(userId, username) {
    const newPass = prompt(`Nueva contraseña para "${username}" (mínimo 6 caracteres):`);
    if (newPass === null) return;
    if (newPass.length < 6) {
        showToast('⚠️ La contraseña debe tener al menos 6 caracteres');
        return;
    }
    if (!confirm(`¿Estás seguro de cambiar la contraseña de "${username}"?`)) return;
    fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPass })
    })
    .then(res => res.json())
    .then(data => {
        if (res.ok) {
            showToast('✅ Contraseña actualizada');
        } else {
            showToast('❌ Error: ' + (data.error || ''));
        }
    })
    .catch(() => showToast('Error de conexión'));
}

async function deleteUser(userId, username) {
    if (!confirm(`¿Eliminar al usuario "${username}"? Esta acción no se puede deshacer.`)) return;

    try {
        console.log(`🗑️ deleteUser: enviando DELETE para ${userId} (${username})`);
        const resp = await fetch(`/api/users/${userId}`, {
            method: 'DELETE',
            headers: { 'Accept': 'application/json' }
        });

        let data = {};
        try { data = await resp.json(); } catch (_) { /* respuesta sin cuerpo */ }

        if (resp.ok) {
            console.log(`✅ deleteUser: ${username} eliminado correctamente`, data);
            showToast(`✅ Usuario "${username}" eliminado`);
            await loadUsers();   // Refrescar la tabla inmediatamente
        } else {
            console.warn(`⚠️ deleteUser: HTTP ${resp.status}`, data);
            showToast('❌ Error al eliminar: ' + (data.error || `HTTP ${resp.status}`), true);
        }
    } catch (e) {
        console.error('❌ deleteUser: excepción', e);
        showToast('❌ Error de conexión: ' + e.message, true);
    }
}

async function deleteAllData() {
    if (!confirm('¿Estás seguro de que quieres eliminar TODOS los datos de la base de datos? Esta acción no se puede deshacer.')) return;
    if (!confirm('Confirmación final: ¿Eliminar todas las variables?')) return;
    try {
        const response = await fetch('/api/variables/delete-all', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        if (response.ok) {
            showToast(`✅ ${data.deleted} registros eliminados.`);
            await loadData();
        } else {
            showToast('❌ Error: ' + (data.error || 'No se pudo eliminar'));
        }
    } catch (e) {
        showToast('Error de conexión: ' + e.message);
    }
}

// ============================================================
// MODO OSCURO
// ============================================================

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDark ? 'true' : 'false');
    const btn = document.getElementById('darkModeToggle');
    if (btn) btn.textContent = isDark ? '☀️' : '🌙';
}

// ============================================================
// ============================================================
// ESTADO DE SELECCIÓN 
// ============================================================
let _selectedIds = new Set();
let _parentChildIdsMap = {};

function _clearSelection() {
    _selectedIds.clear();
    _parentChildIdsMap = {};
}

function _syncCheckboxToSet(cb) {
    if (!cb || !cb.dataset.id) return;
    const id = String(cb.dataset.id);
    if (cb.checked) _selectedIds.add(id);
    else _selectedIds.delete(id);
}

function getSelectedIds() {
    // Añadimos también lo que esté marcado en el DOM (por si el Set se desincronizó)
    document.querySelectorAll('#dataTable tbody input.row-checkbox:checked').forEach(cb => {
        if (cb.dataset.id) _selectedIds.add(String(cb.dataset.id));
    });
    return Array.from(_selectedIds);
}

// ============================================================
// CARGA DE TODOS LOS HIJOS DE UN PADRE (vía API, paginado)
// ============================================================
async function _fetchAllChildrenIds(parentId) {
    const ids = [];
    let offset = 0;
    const limit = 1000;
    let safety = 0;
    while (safety < 30) {
        let resp;
        try {
            resp = await fetch(`/api/variables/${parentId}/children?offset=${offset}&limit=${limit}`);
        } catch (e) {
            console.warn('⚠️ _fetchAllChildrenIds fetch error:', e);
            break;
        }
        if (!resp.ok) break;
        const data = await resp.json();
        const children = data.children || [];
        children.forEach(c => { if (c.id) ids.push(String(c.id)); });
        if (children.length < limit) break;
        offset += limit;
        safety++;
    }
    return ids;
}

async function _selectAllChildrenOf(parentId) {
    try {
        const ids = await _fetchAllChildrenIds(parentId);
        _parentChildIdsMap[parentId] = new Set(ids);
        ids.forEach(id => _selectedIds.add(id));
        // Marcar visualmente los hijos ya cargados
        document.querySelectorAll(
            `#dataTable tbody tr.child-row[data-parent-id="${parentId}"] input.row-checkbox`
        ).forEach(cb => { cb.checked = true; });
        console.log(`✅ _selectAllChildrenOf(${parentId}): ${ids.length} hijos seleccionados`);
    } catch (e) {
        console.warn('⚠️ _selectAllChildrenOf error:', e);
    }
}

function _deselectAllChildrenOf(parentId) {
    const ids = _parentChildIdsMap[parentId];
    if (ids) ids.forEach(id => _selectedIds.delete(id));
    delete _parentChildIdsMap[parentId];
    document.querySelectorAll(
        `#dataTable tbody tr.child-row[data-parent-id="${parentId}"] input.row-checkbox`
    ).forEach(cb => { cb.checked = false; });
}

// ============================================================
// DRAG-SELECT (mousedown sobre la columna de checkbox)
// ============================================================
let _dragSelectActive = false;
let _dragSelectTarget = null;
let _dragSelectVisited = null;   // Set de checkboxes ya tocados
let _dragSelectParentsVisited = null; // Set de parentIds tocados

function initDragSelect() {
    const tbody = document.querySelector('#dataTable tbody');
    if (!tbody || tbody.dataset.dragSelectInit === '1') return;
    tbody.dataset.dragSelectInit = '1';

    tbody.addEventListener('mousedown', function (e) {
        if (_isResizingColumn || _resizeData) return;
        const td = e.target.closest('td');
        if (!td) return;
        if (td.cellIndex !== 1) return;
        const cb = td.querySelector('input.row-checkbox');
        if (!cb) return;

        e.preventDefault();
        _dragSelectActive = true;
        _dragSelectTarget = !cb.checked;
        _dragSelectVisited = new Set();
        _dragSelectParentsVisited = new Set();
        _applyDragToCheckbox(cb);
    });

    tbody.addEventListener('click', function (e) {
        if (e.target && e.target.matches && e.target.matches('input.row-checkbox')) {
            e.preventDefault();
        }
    });

    tbody.addEventListener('mouseover', function (e) {
        if (!_dragSelectActive || _isResizingColumn) return;
        const tr = e.target.closest('tr');
        if (!tr) return;
        const cb = tr.querySelector('input.row-checkbox');
        if (!cb || _dragSelectVisited.has(cb)) return;
        _applyDragToCheckbox(cb);
    });

    document.addEventListener('mouseup', function () {
        if (!_dragSelectActive) return;
        _dragSelectActive = false;
        _dragSelectTarget = null;
        const parentsToSync = _dragSelectParentsVisited ? Array.from(_dragSelectParentsVisited) : [];
        _dragSelectVisited = null;
        _dragSelectParentsVisited = null;
        parentsToSync.forEach(pid => {
            const cb = document.querySelector(`#dataTable tbody tr.parent-row[data-id="${pid}"] input.row-checkbox`);
            if (!cb) return;
            if (cb.checked) _selectAllChildrenOf(pid);
            else _deselectAllChildrenOf(pid);
        });
    });

    document.addEventListener('dragstart', function (e) {
        if (_dragSelectActive) e.preventDefault();
    });
}

function _applyDragToCheckbox(cb) {
    if (!_dragSelectVisited) _dragSelectVisited = new Set();
    if (!_dragSelectParentsVisited) _dragSelectParentsVisited = new Set();
    const willBeChecked = _dragSelectTarget;
    cb.checked = willBeChecked;
    _dragSelectVisited.add(cb);

    // Actualizar Set fuente de verdad
    _syncCheckboxToSet(cb);

    // Sincronizar hijos visibles si es un padre
    const tr = cb.closest('tr');
    if (tr && tr.classList.contains('parent-row')) {
        const pid = String(cb.dataset.id);
        _dragSelectParentsVisited.add(pid);
        document.querySelectorAll(
            `#dataTable tbody tr.child-row[data-parent-id="${pid}"] input.row-checkbox`
        ).forEach(childCb => {
            childCb.checked = willBeChecked;
            _syncCheckboxToSet(childCb);
            _dragSelectVisited.add(childCb);
        });
    }
}


// ============================================================
// AUTO-SCROLL DURANTE DRAG DE FILAS (#4 — versión robusta)
// ============================================================
function _getScrollTarget() {
    // `document.scrollingElement` es lo correcto; cae a body si no existe.
    return document.scrollingElement || document.documentElement || document.body;
}

function _updateAutoScrollSpeed(clientY) {
    const EDGE = 120;                 // px desde el borde superior/inferior
    const MAX_SPEED = 26;             // px por frame
    const vh = window.innerHeight;

    if (clientY < EDGE) {
        _autoScrollSpeed = -Math.max(4, (EDGE - clientY) / EDGE * MAX_SPEED);
    } else if (clientY > vh - EDGE) {
        _autoScrollSpeed = Math.max(4, (clientY - (vh - EDGE)) / EDGE * MAX_SPEED);
    } else {
        _autoScrollSpeed = 0;
    }
}

function _startAutoScrollLoop() {
    if (_autoScrollRAF) return;
    const scrollEl = _getScrollTarget();
    const step = () => {
        if (_autoScrollSpeed !== 0) {
            const before = scrollEl.scrollTop;
            scrollEl.scrollTop = before + _autoScrollSpeed;
            // Si ya no se puede mover más en esa dirección, pará el loop
            // (evita RAFs zombis infinitos).
            if (scrollEl.scrollTop === before) {
                _autoScrollRAF = null;
                return;
            }
            _autoScrollRAF = requestAnimationFrame(step);
        } else {
            _autoScrollRAF = null;
        }
    };
    _autoScrollRAF = requestAnimationFrame(step);
}

function _stopAutoScroll() {
    _autoScrollSpeed = 0;
    if (_autoScrollRAF) {
        cancelAnimationFrame(_autoScrollRAF);
        _autoScrollRAF = null;
    }
}

// Listeners globales (una sola vez).
if (!window._autoScrollListenersAdded) {
    window._autoScrollListenersAdded = true;

    // Reacciona a ambos eventos: dragover Y mousemove. El segundo captura
    // el caso “mouse quieto en el borde” (dragover deja de dispararse).
    const _handleScrollUpdate = (e) => {
        if (!window._draggedRowIds || window._draggedRowIds.length === 0) return;
        _updateAutoScrollSpeed(e.clientY);
        if (_autoScrollSpeed !== 0) _startAutoScrollLoop();
    };

    document.addEventListener('dragover', _handleScrollUpdate, true);
    document.addEventListener('mousemove', _handleScrollUpdate, true);

    document.addEventListener('dragend', _stopAutoScroll);
    document.addEventListener('drop', _stopAutoScroll);
    document.addEventListener('mouseup', _stopAutoScroll);
}

function handleRowDragStart(e, rowId, tr) {
    const selectedIds = getSelectedIds();
    let idsToDrag;
    if (selectedIds.includes(String(rowId))) idsToDrag = selectedIds.slice();
    else idsToDrag = [String(rowId)];
    if (idsToDrag.length === 0) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', JSON.stringify(idsToDrag)); } catch (err) {}
    tr.classList.add('dragging-row');
    window._draggedRowIds = idsToDrag;

    // Activar hints de borde + auto-scroll
    const card = document.getElementById('dropZone');
    if (card) card.classList.add('drag-row-active');
    _startAutoScrollLoop();
}

function handleRowDrop(e, targetId, targetTr) {
    e.preventDefault();
    _stopAutoScroll();
    const card = document.getElementById('dropZone');
    if (card) card.classList.remove('drag-row-active');
    if (targetTr) targetTr.classList.remove('drag-over-row');

    let ids = window._draggedRowIds;
    if (!ids) {
        try { ids = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
    }
    window._draggedRowIds = null;
    if (!Array.isArray(ids) || ids.length === 0) return;

    // Detectar drop en borde superior/inferior de la tabla → desparentar
    const edge = _detectEdgeDrop(e.clientY, card);
    if (edge) {
        const confirmMsg = `¿Convertir ${ids.length} fila(s) en fila(s) padre?`;
        if (!confirm(confirmMsg)) {
            document.querySelectorAll('#dataTable tr.dragging-row').forEach(r => r.classList.remove('dragging-row'));
            return;
        }
        unparentIds(ids);
        return;
    }

    if (ids.includes(String(targetId))) {
        showToast('⚠️ No puedes agrupar una fila dentro de sí misma', true);
        return;
    }

    const count = ids.length;
    if (!confirm(`¿Agrupar ${count} fila(s) en fila ${targetId}?`)) {
        document.querySelectorAll('#dataTable tr.dragging-row').forEach(r => r.classList.remove('dragging-row'));
        return;
    }
    groupRows(targetId, ids);
}

function _detectEdgeDrop(clientY, cardEl) {
    if (!cardEl) return false;
    const rect = cardEl.getBoundingClientRect();
    const EDGE_PX = 44;
    if (clientY < rect.top + EDGE_PX) return 'top';
    if (clientY > rect.bottom - EDGE_PX) return 'bottom';
    return null;
}

// variante de unparentSelected que recibe ids directamente
async function unparentIds(ids) {
    if (!ids || ids.length === 0) { showToast('Selecciona al menos una fila.', true); return; }
    try {
        showSpinner(true);
        const resp = await fetch('/api/variables/group', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parent_id: null, child_ids: ids })
        });
        const data = await resp.json();
        if (resp.ok) {
            showToast(`✅ ${data.updated} fila(s) convertidas en padre`);
            _clearSelection();
            // ✅ FIX #5: invalidar TODO el caché de hijos — no sólo el padre.
            _childrenCacheByParent = {};
            await loadData(currentPage, itemsPerPage, sortField, sortDir, currentSearchTerm);
        } else {
            showToast('Error: ' + (data.error || ''), true);
        }
    } catch (err) {
        showToast('Error de conexión: ' + err.message, true);
    } finally {
        showSpinner(false);
        document.querySelectorAll('#dataTable tr.dragging-row').forEach(r => r.classList.remove('dragging-row'));
    }
}

async function groupRows(parentId, childIds) {
    try {
        showSpinner(true);
        const resp = await fetch('/api/variables/group', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parent_id: parentId, child_ids: childIds })
        });
        const data = await resp.json();
        if (resp.ok) {
            showToast(`✅ ${data.updated} fila(s) agrupadas en ${parentId}`);

            // Invalidar TODO el caché de hijos: el cambio puede afectar a varios padres.
            _childrenCacheByParent = {};

            await loadData(currentPage, itemsPerPage, sortField, sortDir, currentSearchTerm);

            // Brillo verde sobre el padre destino
            setTimeout(() => {
                const tr = document.querySelector(`#dataTable tbody tr.parent-row[data-id="${parentId}"]`);
                if (tr) _flashRow(tr, 'success');
            }, 350);
        } else {
            showToast('Error: ' + (data.error || ''), true);
        }
    } catch (err) {
        showToast('Error de conexión: ' + err.message, true);
    } finally {
        showSpinner(false);
        document.querySelectorAll('#dataTable tr.dragging-row').forEach(r => r.classList.remove('dragging-row'));
    }
}

async function unparentSelected() {
    const ids = getSelectedIds();
    if (ids.length === 0) {
        showToast('Selecciona al menos una fila.', true);
        return;
    }
    if (!confirm(`¿Convertir ${ids.length} fila(s) en fila(s) padre?`)) return;
    try {
        showSpinner(true);
        const resp = await fetch('/api/variables/group', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parent_id: null, child_ids: ids })
        });
        const data = await resp.json();
        if (resp.ok) {
            showToast(`✅ ${data.updated} fila(s) convertidas en padre`);
            _clearSelection();
            loadData(currentPage, itemsPerPage, sortField, sortDir, currentSearchTerm);
        } else {
            showToast('Error: ' + (data.error || ''), true);
        }
    } catch (err) {
        showToast('Error de conexión: ' + err.message, true);
    } finally {
        showSpinner(false);
    }
}

// ============================================================
// INICIALIZACIÓN Y EVENTOS
// ============================================================

window.onload = async () => {
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
        const btn = document.getElementById('darkModeToggle');
        if (btn) btn.textContent = '☀️';
    } else {
        const btn = document.getElementById('darkModeToggle');
        if (btn) btn.textContent = '🌙';
    }

    currentSearchTerm = '';
    currentPage = 1;
    itemsPerPage = parseInt(document.getElementById('itemsPerPageSelect').value) || 10;
    sortField = 'id';
    sortDir = 'asc';
    currentSort = [{ key: 'id', dir: 'asc' }];

    renderHeaders();

    await loadData(currentPage, itemsPerPage, sortField, sortDir, '');
    setTimeout(() => {
        document.querySelectorAll('#dataTable tbody tr').forEach(tr => syncRowHeights(tr));
        addResizeHandles('dataTable');
    }, 500);
    document.getElementById('itemsPerPageSelect').value = itemsPerPage;
    await loadHistory();
    await loadCurrentUser();

    // ---------- Listeners del menú hamburguesa y sidebar ----------
    const menuBtn = document.getElementById('menuToggleBtn');
    if (menuBtn && !menuBtn._listenerAdded) {
        menuBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleSidebar();
            this.classList.toggle('active');
        });
        menuBtn._listenerAdded = true;
    }
    const closeBtn = document.getElementById('closeSidebarBtn');
    if (closeBtn && !closeBtn._listenerAdded) {
        closeBtn.addEventListener('click', () => {
            closeSidebar();
            document.getElementById('menuToggleBtn')?.classList.remove('active');
        });
        closeBtn._listenerAdded = true;
    }
    const overlay = document.getElementById('sidebarOverlay');
    if (overlay && !overlay._listenerAdded) {
        overlay.addEventListener('click', () => {
            closeSidebar();
            document.getElementById('menuToggleBtn')?.classList.remove('active');
        });
        overlay._listenerAdded = true;
    }
    // -------------------------------------------------------------------

    const prevCsvBtn = document.getElementById('prevPageBtn');
    const nextCsvBtn = document.getElementById('nextPageBtn');
    if (prevCsvBtn) {
        prevCsvBtn.addEventListener('click', function() {
            previewPrevPage('uploadDataPreview', false);
        });
    }
    if (nextCsvBtn) {
        nextCsvBtn.addEventListener('click', function() {
            previewNextPage('uploadDataPreview', false);
        });
    }

    const zipPrevBtn = document.getElementById('zipPrevPageBtn');
    const zipNextBtn = document.getElementById('zipNextPageBtn');
    if (zipPrevBtn) {
        zipPrevBtn.addEventListener('click', function() {
            const newPage = (currentParentPage || 1) - 1;
            if (newPage >= 1) {
                goToPreviewPage(newPage, 'zipPreviewTable', true);
            }
        });
    }
    if (zipNextBtn) {
        zipNextBtn.addEventListener('click', function() {
            const totalPages = Math.ceil(totalParents / parentsPerPage) || 1;
            const newPage = (currentParentPage || 1) + 1;
            if (newPage <= totalPages) {
                goToPreviewPage(newPage, 'zipPreviewTable', true);
            }
        });
    }

    const zipPageInput = document.getElementById('zipPageInput');
    if (zipPageInput && !zipPageInput._listenerAdded) {
        zipPageInput.addEventListener('change', function() {
            const newPage = parseInt(this.value);
            const totalPages = Math.ceil(totalParents / parentsPerPage) || 1;
            if (!isNaN(newPage) && newPage >= 1 && newPage <= totalPages) {
                goToPreviewPage(newPage, 'zipPreviewTable', true);
            } else {
                this.value = currentParentPage;
            }
        });
        zipPageInput._listenerAdded = true;
    }

    document.addEventListener('keydown', e => {
        if (document.getElementById('modalChangeOwnPassword').style.display === 'flex') {
            closeModal('modalChangeOwnPassword');
        }
        if (e.key === 'Escape') {
            // ⚠️ El orden importa: cerramos primero el modal que está ENCIMA.
            // modalDiscoverVariables se abre DESPUÉS de modalFolderUpload
            // (queda apilado encima), así que debe cerrarse PRIMERO.
            if (document.getElementById('modalOtraOpcion').style.display === 'flex') {
                handleCloseOtraOpcionModal();
            } else if (document.getElementById('modalSuggestion').style.display === 'flex') {
                const btn = document.getElementById('btnDeclineSuggestion');
                if (btn) btn.click();
                closeModal('modalSuggestion');
            } else if (document.getElementById('modalDiscoverVariables').style.display === 'flex') {
                closeModal('modalDiscoverVariables');
            } else if (document.getElementById('modalConfirmUpload').style.display === 'flex') {
                closeModal('modalConfirmUpload');
            } else if (document.getElementById('modalFolderUpload').style.display === 'flex') {
                closeModal('modalFolderUpload');
            }
        }
    });

    const activeView = document.querySelector('.view-container.active');
    if (activeView) {
        const viewId = activeView.id.replace('view-', '');
        const item = document.querySelector(`.sidebar-item[data-view="${viewId}"]`);
        if (item) {
            document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
        }
    }

    setupDragDrop();
    document.addEventListener('dragend', () => {
        const card = document.getElementById('dropZone');
        if (card) card.classList.remove('drag-row-active');
        document.querySelectorAll('#dataTable tr.drag-over-row, #dataTable tr.dragging-row')
            .forEach(r => r.classList.remove('drag-over-row', 'dragging-row'));
    });
    initSearchAutocomplete();
    initDragSelect();

    const firstTh = document.querySelector('#headerRow th:first-child');
    if (firstTh) {
        const expandAllBtn = document.createElement('span');
        expandAllBtn.className = 'expand-all-btn';
        expandAllBtn.textContent = '▸';
        expandAllBtn.title = 'Expandir/Colapsar todos los padres';
        expandAllBtn.addEventListener('click', toggleAllParents);
        firstTh.appendChild(expandAllBtn);
    }
};

function setupDragDrop() {
    // ---------- Helper: asegurar overlay interno en un modal ----------
    function _ensureModalOverlay(contentEl, text) {
        let ov = contentEl.querySelector('.modal-drop-overlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.className = 'modal-drop-overlay';
            contentEl.appendChild(ov);
        }
        ov.textContent = text;
        return ov;
    }

    // ---------- Helper: overlay "Soltar archivo" SOLO para arrastres de archivos ----------
    // Bug corregido: el overlay se activaba con cualquier arrastre (texto, filas, selección) y, al no
    // dispararse "dragleave"/"drop" en el modal, se quedaba tapando la ventana. Ahora:
    //  - solo reacciona si el arrastre trae archivos (dataTransfer.types incluye 'Files');
    //  - usa un contador de profundidad (dragenter/dragleave de hijos ya no lo apagan a medias);
    //  - se apaga con drop, dragend, salida de la ventana, Escape y cualquier movimiento del mouse
    //    (el mouse no se mueve "normalmente" durante un arrastre real, así que nunca queda pegado).
    function _bindFileDragOverlay(content, overlay) {
        let depth = 0;
        const hasFiles = (e) => !!(e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files'));
        const hide = () => { depth = 0; overlay.classList.remove('active'); };
        content.addEventListener('dragenter', (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            depth++;
            overlay.classList.add('active');
        }, false);
        content.addEventListener('dragover', (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            overlay.classList.add('active');
        }, false);
        content.addEventListener('dragleave', (e) => {
            if (!hasFiles(e)) return;
            depth = Math.max(0, depth - 1);
            if (depth === 0 || !content.contains(e.relatedTarget)) hide();
        }, false);
        content.addEventListener('drop', (e) => {
            if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); }
            hide();
        }, false);
        ['dragend', 'mousemove', 'mousedown', 'keydown'].forEach((evt) => {
            document.addEventListener(evt, () => { if (overlay.classList.contains('active')) hide(); }, true);
        });
        window.addEventListener('blur', () => { if (overlay.classList.contains('active')) hide(); });
        document.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) hide(); }, true);
        document.addEventListener('drop', hide, true);
    }

    // ---------- 1) Zona principal (tabla) ----------
    const dropZone = document.getElementById('dropZone');
    if (dropZone && dropZone.dataset.dropInit !== '1') {
        dropZone.dataset.dropInit = '1';

        // distinguir file drag vs row drag
        function _isFileDrag(e) {
            if (window._draggedRowIds && window._draggedRowIds.length > 0) return false;
            if (!e.dataTransfer || !e.dataTransfer.types) return false;
            return Array.from(e.dataTransfer.types).includes('Files');
        }

        ['dragenter', 'dragover', 'dragleave'].forEach(evt => {
            dropZone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); }, false);
        });
        dropZone.addEventListener('dragenter', e => {
            if (_isFileDrag(e)) dropZone.classList.add('drag-over');
        }, false);
        dropZone.addEventListener('dragover', e => {
            if (_isFileDrag(e)) dropZone.classList.add('drag-over');
        }, false);
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        }, false);
        ['dragend', 'mousemove', 'keydown'].forEach((evt) => {
            document.addEventListener(evt, () => dropZone.classList.remove('drag-over'), true);
        });

        dropZone.addEventListener('drop', e => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');

            // ==============================================================
            // ✅ FIX #3: si estamos arrastrando FILAS, detectar borde aquí.
            // Antes, soltar sobre el borde (sin estar sobre un <tr>) nunca
            // llegaba a handleRowDrop y por eso el desparentado no ocurría.
            // ==============================================================
            if (window._draggedRowIds && window._draggedRowIds.length > 0) {
                const edge = _detectEdgeDrop(e.clientY, dropZone);
                if (edge) {
                    const ids = window._draggedRowIds.slice();
                    window._draggedRowIds = null;
                    _stopAutoScroll();
                    dropZone.classList.remove('drag-row-active');
                    if (confirm(`¿Convertir ${ids.length} fila(s) en fila(s) padre?`)) {
                        unparentIds(ids);
                    }
                }
                // Si no fue en el borde, dejar que el drop del <tr> lo maneje.
                return;
            }

            // File drop (CSV/ZIP)
            const file = e.dataTransfer.files[0];
            if (!file) return;
            if (file.name.endsWith('.csv')) {
                openModal('modalConfirmUpload');
                const input = document.getElementById('csvFileInputModal');
                const dt = new DataTransfer();
                dt.items.add(file);
                input.files = dt.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (file.name.endsWith('.zip')) {
                openModal('modalFolderUpload');
                const input = document.getElementById('zipFileInput');
                const dt = new DataTransfer();
                dt.items.add(file);
                input.files = dt.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
                showToast('⚠️ Solo se permiten archivos CSV o ZIP.');
            }
        }, false);
    }

    // ---------- 2) Modal CSV ----------
    const csvModal = document.getElementById('modalConfirmUpload');
    if (csvModal && csvModal.dataset.dropInit !== '1') {
        csvModal.dataset.dropInit = '1';
        const content = csvModal.querySelector('.modal-content.draggable') || csvModal;
        const overlay = _ensureModalOverlay(content, 'Soltar CSV para importar');

        _bindFileDragOverlay(content, overlay);
        content.addEventListener('drop', e => {
            overlay.classList.remove('active');
            const file = e.dataTransfer.files[0];
            if (!file) return;
            if (file.name.endsWith('.csv')) {
                const input = document.getElementById('csvFileInputModal');
                const dt = new DataTransfer();
                dt.items.add(file);
                input.files = dt.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (file.name.endsWith('.zip')) {
                console.log('📦 ZIP soltado en modal CSV → redirigiendo al modal ZIP');
                closeModal('modalConfirmUpload');
                openModal('modalFolderUpload');
                const input = document.getElementById('zipFileInput');
                const dt = new DataTransfer();
                dt.items.add(file);
                input.files = dt.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
                showToast('⚠️ Solo se permiten CSV o ZIP.');
            }
        }, false);
    }

    // ---------- 3) Modal ZIP ----------
    const zipModal = document.getElementById('modalFolderUpload');
    if (zipModal && zipModal.dataset.dropInit !== '1') {
        zipModal.dataset.dropInit = '1';
        const content = zipModal.querySelector('.modal-content.draggable') || zipModal;
        const overlay = _ensureModalOverlay(content, 'Soltar ZIP para importar');

        _bindFileDragOverlay(content, overlay);
        content.addEventListener('drop', e => {
            overlay.classList.remove('active');
            const file = e.dataTransfer.files[0];
            if (!file) return;
            if (file.name.endsWith('.zip')) {
                console.log('📦 ZIP soltado en modal ZIP → procesando discovery');
                const input = document.getElementById('zipFileInput');
                const dt = new DataTransfer();
                dt.items.add(file);
                input.files = dt.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (file.name.endsWith('.csv')) {
                showToast('⚠️ Este modal es para ZIP. Usa "Importar CSV".');
            } else {
                showToast('⚠️ Solo se permiten archivos ZIP.');
            }
        }, false);
    }

        // ---------- 4) Refuerzo: drop a nivel document (cubre modales abiertos tarde) ----------
    if (!window._globalDropBound) {
        window._globalDropBound = true;

        document.addEventListener('dragover', function (e) {
            // Identificar si estamos sobre un modal abierto
            const csvModal = document.getElementById('modalConfirmUpload');
            const zipModal = document.getElementById('modalFolderUpload');
            const anyOpen =
                (csvModal && csvModal.style.display === 'flex') ||
                (zipModal && zipModal.style.display === 'flex');
            if (!anyOpen) return;
            if (!e.dataTransfer || !e.dataTransfer.types) return;
            if (!Array.from(e.dataTransfer.types).includes('Files')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        }, true);

        document.addEventListener('drop', function (e) {
            const csvModal = document.getElementById('modalConfirmUpload');
            const zipModal = document.getElementById('modalFolderUpload');
            const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (!file) return;

            // CSV -> al modal de CSV
            if (file.name.endsWith('.csv') && csvModal && csvModal.style.display === 'flex') {
                e.preventDefault();
                e.stopPropagation();
                const input = document.getElementById('csvFileInputModal');
                const dt = new DataTransfer();
                dt.items.add(file);
                input.files = dt.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('📥 CSV soltado (refuerzo global) → disparado change');
                return;
            }

            // ZIP -> al modal de ZIP
            if (file.name.endsWith('.zip') && zipModal && zipModal.style.display === 'flex') {
                e.preventDefault();
                e.stopPropagation();
                const input = document.getElementById('zipFileInput');
                const dt = new DataTransfer();
                dt.items.add(file);
                input.files = dt.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('📥 ZIP soltado (refuerzo global) → disparado change');
                return;
            }
        }, true);
    }
}

// ============================================================
// ARRASTRE Y REDIMENSIONAMIENTO DE MODALES
// ============================================================

function makeResizable(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    const content = modal.querySelector('.modal-content.draggable');
    if (!content) return;

    let corner = content.querySelector('.resize-handle-corner');
    if (!corner) {
        corner = document.createElement('div');
        corner.className = 'resize-handle-corner';
        content.appendChild(corner);
    }
    if (corner.dataset.resizeInit === 'true') return;
    corner.dataset.resizeInit = 'true';

    let isResizing = false;
    let startX, startY, startWidth, startHeight;

    corner.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = content.getBoundingClientRect();
        startWidth = rect.width;
        startHeight = rect.height;
        console.log('🔧 Resize inicio:', { startWidth, startHeight });
        document.addEventListener('mousemove', onResize);
        document.addEventListener('mouseup', stopResize);
    });

    function onResize(e) {
        if (!isResizing) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const newWidth = Math.max(420, startWidth + dx);
        const newHeight = Math.max(320, startHeight + dy);
        content.style.width = newWidth + 'px';
        content.style.height = newHeight + 'px';
        content.style.maxWidth = 'none';
        content.style.maxHeight = 'none';
    }

    function stopResize() {
        isResizing = false;
        document.removeEventListener('mousemove', onResize);
        document.removeEventListener('mouseup', stopResize);
    }
}

function makeDraggable(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    const content = modal.querySelector('.modal-content.draggable');
    if (!content) return;
    const header = content.querySelector('.modal-header');
    if (!header) return;
    header.classList.add('drag-handle');

    makeResizable(modalId);

    if (header.dataset.dragInit === 'true') return;
    header.dataset.dragInit = 'true';

    let isDragging = false;
    let offsetX, offsetY;

    header.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.closest('.close-button')) return;
        isDragging = true;
        const rect = content.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        // Fijar posición actual con left/top (abandona transform para evitar saltos)
        content.style.position = 'fixed';
        content.style.transform = 'none';
        content.style.margin = '0';
        content.style.left = rect.left + 'px';
        content.style.top = rect.top + 'px';
        console.log('✋ Drag inicio desde:', { left: rect.left, top: rect.top });
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', stopDrag);
        e.preventDefault();
    });

    function onDrag(e) {
        if (!isDragging) return;
        content.style.left = (e.clientX - offsetX) + 'px';
        content.style.top = (e.clientY - offsetY) + 'px';
    }

    function stopDrag() {
        isDragging = false;
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
    }
}

// Inicializar solo UNA VEZ (el DOMContentLoaded puede tardar en ejecutarse)
document.addEventListener('DOMContentLoaded', function () {
    setTimeout(() => {
        makeDraggable('modalConfirmUpload');
        makeDraggable('modalFolderUpload');
        makeDraggable('modalDiscoverVariables');
        console.log('✅ Modales inicializados con drag + resize');
    }, 300);
});

// ============================================================
// FLOW NAV — Botones atrás/adelante entre modales del flujo ZIP
// ============================================================

function _flowPush(step) {
    if (!step) return;
    if (_flowStack.length === 0 || _flowStack[_flowStack.length - 1] !== step) {
        _flowStack.push(step);
        _flowForwardStack = [];   // Avanzar invalida el forward
        console.log(`🪜 _flowPush: '${step}' → pila =`, _flowStack.slice());
    }
    _flowUpdateButtons();
}

function _flowReset() {
    if (_flowStack.length > 0) {
        console.log('🪜 _flowReset: limpiando pila del flujo');
    }
    _flowStack = [];
    _flowForwardStack = [];
    _flowUpdateButtons();
}

function _flowUpdateButtons() {
    const canBack = _flowStack.length > 1;
    const canForward = _flowForwardStack.length > 0;

    // Actualizar AMBAS barras (Discover y Folder)
    ['flowNavButtonsDiscovery', 'flowNavButtonsFolder'].forEach(id => {
        const bar = document.getElementById(id);
        if (!bar) return;
        if (!canBack && !canForward) {
            bar.style.display = 'none';
        } else {
            bar.style.display = 'inline-flex';
        }
    });

    ['flowBackBtnDiscovery', 'flowBackBtnFolder'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = !canBack;
    });
    ['flowForwardBtnDiscovery', 'flowForwardBtnFolder'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = !canForward;
    });
}

function _flowShowStep(step) {
    // 1) Cerrar TODOS los modales del flujo
    ['modalFolderUpload', 'modalDiscoverVariables'].forEach(id => {
        const m = document.getElementById(id);
        if (m) m.style.display = 'none';
    });

    // 2) Abrir el modal correcto y ajustar visibilidad interna
    if (step === 'upload') {
        openModal('modalFolderUpload');
        const pc = document.getElementById('zipPreviewContainer');
        if (pc) pc.style.display = 'none';
        const logDiv = document.getElementById('folderLogMessages');
        if (logDiv) logDiv.style.display = 'none';
        const progDiv = document.getElementById('zipProgress');
        if (progDiv) progDiv.style.display = 'none';
        const banner = document.getElementById('zipPollingErrorBanner');
        if (banner) banner.classList.remove('visible');
    } else if (step === 'discovery') {
        openModal('modalDiscoverVariables');
    } else if (step === 'preview') {
        openModal('modalFolderUpload');
        const pc = document.getElementById('zipPreviewContainer');
        if (pc) pc.style.display = 'block';
        const logDiv = document.getElementById('folderLogMessages');
        if (logDiv) logDiv.style.display = 'block';
        const progDiv = document.getElementById('zipProgress');
        if (progDiv) progDiv.style.display = 'block';
    }

    // 3) Actualizar el estado de habilitado/deshabilitado de ambas barras
    _flowUpdateButtons();
    console.log(`🪜 _flowShowStep: mostrando '${step}'`);
}

function navigateFlowBack() {
    if (_flowStack.length <= 1) return;
    const current = _flowStack.pop();
    _flowForwardStack.push(current);
    const prev = _flowStack[_flowStack.length - 1];
    console.log(`🪜 navigateFlowBack: '${current}' → '${prev}'`);
    _flowShowStep(prev);
    _flowUpdateButtons();
}

function navigateFlowForward() {
    if (_flowForwardStack.length === 0) return;
    const next = _flowForwardStack.pop();
    _flowStack.push(next);
    console.log(`🪜 navigateFlowForward: → '${next}'`);
    _flowShowStep(next);
    _flowUpdateButtons();
}

// Exponer funciones globalmente para el HTML
window.loadData = loadData;
window.loadHistory = loadHistory;
window.loadCurrentUser = loadCurrentUser;
window.renderHeaders = renderHeaders;
window.handleSearch = handleSearch;
window.goToPage = goToPage;
window.nextPage = nextPage;
window.prevPage = prevPage;
window.changeItemsPerPage = changeItemsPerPage;
window.toggleDarkMode = toggleDarkMode;
window.retrainModels = retrainModels;
window.rollbackModels = rollbackModels;
window.deleteAllData = deleteAllData;
window.confirmAddRow = confirmAddRow;
window.duplicateSelected = duplicateSelected;
window.deleteSelectedRows = deleteSelectedRows;
window.downloadCSV = downloadCSV;
window.openModal = openModal;
window.closeModal = closeModal;
window.handleZipUpload = handleZipUpload;
window.confirmFolderUpload = confirmFolderUpload;
window.handleFileUploadModal = handleFileUploadModal;
window.confirmUpload = confirmUpload;
window.toggleAllParents = toggleAllParents;
window.toggleAllPreviewParents = toggleAllPreviewParents;
window.updateSelectAllCheckbox = updateSelectAllCheckbox;
window.toggleAllNonDuplicates = toggleAllNonDuplicates;
window.handleCloseOtraOpcionModal = handleCloseOtraOpcionModal;
window.autoResizeModal = autoResizeModal;
window.switchView = switchView;
window.toggleSidebar = toggleSidebar;
window.toggleViewMenu = toggleViewMenu;
window.goToPreviewPage = goToPreviewPage;
window.previewPrevPage = previewPrevPage;
window.previewNextPage = previewNextPage;
window.loadPreviewPage = loadPreviewPage;
window.toggleUserMenu = toggleUserMenu;
window.changeOwnPassword = changeOwnPassword;
window.sortTable = sortTable;
window.resetFolderModal = resetFolderModal;
window.initSearchAutocomplete = initSearchAutocomplete;
window.toggleAllPreviewCheckboxesFromText = toggleAllPreviewCheckboxesFromText;
window.resumeTaskPolling = resumeTaskPolling;
window.handleSearchKeydown = handleSearchKeydown;
window.triggerSearch = triggerSearch;
window.initDragSelect = initDragSelect;
window.groupRows = groupRows;
window.unparentSelected = unparentSelected;
window.getSelectedIds = getSelectedIds;
window.toggleUserEditMode = toggleUserEditMode;
window.cancelUserEdits = cancelUserEdits;
window.saveAllUserEdits = saveAllUserEdits;
window._markUserDirty = _markUserDirty;
window.togglePasswordField = togglePasswordField;
window.confirmChangeOwnPassword = confirmChangeOwnPassword;
window.navigateFlowBack = navigateFlowBack;
window.navigateFlowForward = navigateFlowForward;
window._flowReset = _flowReset;
