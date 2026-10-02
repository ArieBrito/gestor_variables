/* Iconos Google (Material Symbols Outlined).
 *
 * Reemplaza en pantalla los emojis/símbolos por iconos de Google sin tocar la lógica de la app:
 *  - El texto del DOM no cambia hasta que este script lo sustituye, y las flechas de expandir/colapsar
 *    (▸ ▾ ▼ ▶) se conservan como texto (app.js compara su textContent); solo se dibujan como icono con CSS.
 *  - Un MutationObserver convierte también lo que app.js crea dinámicamente (avisos, filas, modales).
 *  - Si la fuente de iconos no carga (sin internet), no se muestra nada raro: los iconos quedan ocultos
 *    y el texto de los botones sigue siendo legible.
 */
(function () {
    'use strict';

    // símbolo → nombre del icono (https://fonts.google.com/icons)
    var ICONS = {
        '🔑': 'key', '🚪': 'logout', '🌙': 'dark_mode', '☀': 'light_mode',
        '📊': 'table_chart', '👥': 'group', '🕘': 'history', '📋': 'content_copy',
        '🔍': 'search', '🔎': 'search', '📤': 'upload_file', '📁': 'folder_zip', '📄': 'description',
        '➕': 'add', '🗑': 'delete', '📥': 'download', '⚙': 'settings', '🔄': 'refresh',
        '↩': 'undo', '💡': 'lightbulb', '✓': 'check', '✕': 'close', '✅': 'check_circle',
        '❌': 'cancel', '⚠': 'warning', '←': 'arrow_back', '→': 'arrow_forward', '●': 'fiber_manual_record',
        '✏': 'edit', '💾': 'save', '🔒': 'lock', '🔓': 'lock_open', 'ℹ': 'info'
    };
    var CHEVRON_LEFT = '◀', CHEVRON_RIGHT = '▶';
    var CHEV_SINGLE = { '▸': 'right', '▶': 'right', '▾': 'down', '▼': 'down', '▲': 'up', '◀': 'left' };

    var keys = Object.keys(ICONS).map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    // emoji (+ selector de variación opcional), o flechas ◀ ▶ dentro de texto más largo
    var RE = new RegExp('(' + keys.join('|') + '|' + CHEVRON_LEFT + '|' + CHEVRON_RIGHT + ')\\uFE0F?', 'g');
    var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, OPTION: 1, SELECT: 1, PRE: 1, TITLE: 1, CODE: 1 };

    function iconName(sym) {
        if (sym === CHEVRON_LEFT) return 'chevron_left';
        if (sym === CHEVRON_RIGHT) return 'chevron_right';
        return ICONS[sym];
    }

    function skipNode(n) {
        for (var p = n.parentNode; p && p.nodeType === 1; p = p.parentNode) {
            if (SKIP[p.tagName] || p.classList.contains('mi') || p.hasAttribute('data-no-icons')) return true;
        }
        return false;
    }

    function makeIcon(name, solo) {
        var s = document.createElement('span');
        s.className = 'mi' + (solo ? ' mi-solo' : '');
        s.setAttribute('aria-hidden', 'true');
        s.textContent = name;
        return s;
    }

    function processText(node) {
        var text = node.nodeValue;
        if (!text) return;
        var trimmed = text.trim();

        // Flecha suelta (expandir/colapsar): se conserva el texto y se marca el padre para dibujarla con CSS
        if (CHEV_SINGLE[trimmed] && node.parentNode && node.parentNode.nodeType === 1) {
            node.parentNode.setAttribute('data-chev', CHEV_SINGLE[trimmed]);
            return;
        }
        if (node.parentNode && node.parentNode.nodeType === 1 && node.parentNode.hasAttribute('data-chev') && trimmed) {
            node.parentNode.removeAttribute('data-chev');
        }
        RE.lastIndex = 0;
        if (!RE.test(text)) return;
        if (skipNode(node)) return;

        var parent = node.parentNode;
        var solo = trimmed.replace(/️/g, '').length <= 2 && parent.childNodes.length === 1;
        var frag = document.createDocumentFragment();
        var last = 0, m;
        RE.lastIndex = 0;
        while ((m = RE.exec(text)) !== null) {
            if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            frag.appendChild(makeIcon(iconName(m[1]), solo));
            last = RE.lastIndex;
            // se come el espacio que seguía al emoji (el margen lo pone el CSS)
            if (text.charAt(last) === ' ') last++;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        parent.replaceChild(frag, node);
    }

    function walk(root) {
        if (!root) return;
        if (root.nodeType === 3) { processText(root); return; }
        if (root.nodeType !== 1 || SKIP[root.tagName]) return;
        var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        var nodes = [], n;
        while ((n = w.nextNode())) nodes.push(n);
        nodes.forEach(processText);
    }

    var busy = false;
    function start() {
        walk(document.body);
        new MutationObserver(function (muts) {
            if (busy) return;
            busy = true;
            try {
                muts.forEach(function (mu) {
                    if (mu.type === 'characterData') processText(mu.target);
                    else mu.addedNodes.forEach(walk);
                });
            } finally { busy = false; }
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    // Mostrar iconos solo cuando la fuente está lista (evita ver "search" / "delete" como texto)
    function markReady() { document.documentElement.classList.add('icons-ready'); }
    if (document.fonts && document.fonts.load) {
        document.fonts.load('20px "Material Symbols Outlined"', 'check').then(function (f) { if (f && f.length) markReady(); }, function () {});
        document.fonts.ready.then(function () {
            if (document.fonts.check('20px "Material Symbols Outlined"', 'check')) markReady();
        });
    } else markReady();

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
