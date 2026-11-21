// AI Studio Helpers: "Delete from here" + "Search text" + "Go to top"
(() => {
    'use strict';

    const MENU_BTN_ID = 'custom-delete-from-here-btn';
    const SEARCH_BTN_ID = 'custom-chat-search-btn';
    const SEARCH_PANEL_ID = 'custom-chat-search-panel';
    const SEARCH_STYLE_ID = 'custom-chat-search-style';
    const GO_TOP_BTN_ID = 'custom-go-to-top-btn';
    const TOOLBAR_STYLE_ID = 'custom-toolbar-buttons-style';

    const SEARCH_MATCH_HIGHLIGHT = 'custom-chat-search-match';
    const SEARCH_ACTIVE_HIGHLIGHT = 'custom-chat-search-active';
    const SEARCH_MARK_ATTR = 'data-custom-search-mark';
    const MAX_SEARCH_MATCHES = 3000;

    // Selectors (update here if Google changes the UI)
    const SELECTORS = {
        // Delete from here
        turn: 'ms-chat-turn',
        turnOptionsBtn: 'ms-chat-turn-options button',
        menuContent: 'div.mat-mdc-menu-content',
        menuItem: 'button[role="menuitem"], button.mat-mdc-menu-item',
        icon: '.material-symbols-outlined, mat-icon',
        backdrop: '.cdk-overlay-backdrop',

        // Toolbar buttons (Search text & Go to top)
        toolbarRight: 'ms-playground-toolbar .toolbar-right, ms-toolbar .toolbar-right',
        scrollContainer: 'ms-autoscroll-container, ms-virtual-scroll-container, .virtual-scroll-container',
        scrollbarButtons: 'ms-prompt-scrollbar button[aria-controls], ms-items-scrollbar button[aria-controls]',
        toolbarAnchor: [
            'ms-share-button',
            'ms-share-prompt-button',
            'ms-compare-button',
            'ms-new-chat-button',
            'button[data-test-compare]',
            'button[data-test-clear="outside"]',
            'button[aria-label*="Share" i]',
            'button[aria-label*="Compare" i]',
            'button[aria-label*="New chat" i]',
            'button[aria-label*="Clear chat" i]',
            'button[iconname="share"]',
            'button[iconname="ios_share"]',
            'button[iconname="compare_arrows"]',
            'button[iconname="add"]',
            'a[href*="/prompts/new_chat"]',
            '[data-test-id*="share" i]',
            '[data-test-id*="compare" i]',
            '[data-test-id*="new-chat" i]'
        ].join(', ')
    };

    const ANCHOR_ICONS = new Set([
        'share',
        'ios_share',
        'compare_arrows',
        'add',
        'add_comment',
        'chat_add_on'
    ]);

    const SEARCH_EXCLUDED_TAGS = new Set([
        'SCRIPT',
        'STYLE',
        'NOSCRIPT',
        'SVG',
        'BUTTON',
        'TEXTAREA',
        'INPUT',
        'SELECT',
        'MAT-ICON',
        'MS-CHAT-TURN-OPTIONS'
    ]);

    const SEARCH_EXCLUDED_SELECTOR = [
        '.material-symbols-outlined',
        '.material-icons',
        '.turn-footer',
        '.actions',
        '.author-label',
        '.cdk-visually-hidden',
        '.sr-only',
        '.visually-hidden',
        '.katex-mathml',
        '.MathJax_Assistive_MathML',
        'ms-thought-chunk mat-expansion-panel-header',
        '[hidden]'
    ].join(', ');

    const BLOCK_DISPLAY_VALUES = new Set([
        'block',
        'flex',
        'grid',
        'list-item',
        'table',
        'table-row',
        'table-cell',
        'table-caption',
        'flow-root'
    ]);

    const SUPPORTS_CSS_HIGHLIGHT =
        typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';

    let lastClickedTurn = null;
    let isDeleting = false;
    let observedToolbar = null;
    let toolbarSyncQueued = false;
    let lastPathname = window.location.pathname;

    // Search state
    let isSearchOpen = false;
    let searchPanel = null;
    let searchInput = null;
    let searchCountEl = null;
    let searchCaseBtn = null;
    let searchPrevBtn = null;
    let searchNextBtn = null;
    let searchCaseSensitive = false;
    let lastSearchQuery = '';
    let lastExecutedQuery = '';
    let lastExecutedCaseSensitive = false;
    let hasExecutedSearch = false;
    let searchMatches = [];
    let searchMatchesTruncated = false;
    let activeMatchIndex = -1;
    let currentNavToken = 0;
    let currentScanToken = 0;
    let isScanningChat = false;
    let isApplyingFallbackMarks = false;
    let fallbackMarks = [];
    let toolbarResizeObserver = null;
    let observedScrollContainer = null;
    let scrollRefreshTimer = null;

    // Virtual-scroll turn cache (persists across search closes within the same chat)
    let turnKeySeq = 0;
    let cachedTurnsByKey = new Map();
    let cachedTurnList = [];
    let hasCompletedFullScan = false;
    let chatCacheDirty = true;
    let lastScrollbarCount = -1;
    let lastDomTurnCount = -1;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

    const isVisible = (el) => !!el && el.isConnected && el.getClientRects().length > 0;

    const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    function waitForElement(selector, timeoutMs = 1500) {
        return new Promise((resolve) => {
            const existing = document.querySelector(selector);
            if (existing) return resolve(existing);

            const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) {
                    observer.disconnect();
                    resolve(el);
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeoutMs);
        });
    }

    async function waitUntil(fn, timeoutMs = 2000, intervalMs = 50) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (fn()) return true;
            await sleep(intervalMs);
        }
        return false;
    }

    // =========================================================================
    // Feature 1: Delete from here
    // =========================================================================

    function findNativeDeleteButton(menuEl) {
        const items = menuEl.querySelectorAll(SELECTORS.menuItem);
        for (const item of items) {
            if (item.id === MENU_BTN_ID) continue;
            const icon = item.querySelector(SELECTORS.icon);
            if (
                icon &&
                (icon.textContent.trim() === 'delete' || icon.getAttribute('fonticon') === 'delete')
            ) {
                return item;
            }
            if (/\bDelete\b/i.test(item.textContent)) return item;
        }
        return null;
    }

    function createDeleteFromHereButton(nativeDeleteBtn) {
        const customBtn = nativeDeleteBtn.cloneNode(true);
        customBtn.id = MENU_BTN_ID;
        customBtn.removeAttribute('jsaction');
        customBtn.removeAttribute('jslog');

        const walker = document.createTreeWalker(customBtn, NodeFilter.SHOW_TEXT);
        let replaced = false;
        let node;

        while ((node = walker.nextNode())) {
            if (node.parentElement && node.parentElement.closest(SELECTORS.icon)) {
                continue;
            }
            if (node.nodeValue.trim().length > 0) {
                node.nodeValue = node.nodeValue.replace(/\S[\s\S]*\S|\S/, 'Delete from here');
                replaced = true;
                break;
            }
        }

        if (!replaced) {
            const fallbackSpan = document.createElement('span');
            fallbackSpan.className = 'mat-mdc-menu-item-text';
            fallbackSpan.textContent = 'Delete from here';
            customBtn.appendChild(fallbackSpan);
        }

        customBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const targetTurn = lastClickedTurn;
            lastClickedTurn = null;
            handleDeleteFromHere(targetTurn);
        });

        return customBtn;
    }

    // Track which chat turn's three-dots button the user clicked
    document.addEventListener(
        'click',
        (e) => {
            if (!e.isTrusted || isDeleting) return;

            const optionsBtn = e.target.closest(SELECTORS.turnOptionsBtn);
            if (optionsBtn) {
                lastClickedTurn = optionsBtn.closest(SELECTORS.turn);
            } else if (!e.target.closest('.cdk-overlay-container')) {
                lastClickedTurn = null;
            }

            // Invalidate search turn cache if user runs/sends a prompt or clicks delete in menu
            if (
                e.target.closest('run-button, button[aria-label="Run"], button[type="submit"]') ||
                (e.target.closest(SELECTORS.menuItem) &&
                    /\bDelete\b/i.test(e.target.closest(SELECTORS.menuItem).textContent))
            ) {
                invalidateChatCache(false);
            }
        },
        true
    );

    // Delete the selected turn and every subsequent turn (bottom-up)
    async function handleDeleteFromHere(targetTurn) {
        if (!targetTurn || isDeleting) return;

        // Close the currently open menu cleanly first
        const backdrop = document.querySelector(SELECTORS.backdrop);
        if (backdrop) backdrop.click();
        await waitUntil(() => !document.querySelector(SELECTORS.menuContent), 1000);

        const allTurns = Array.from(document.querySelectorAll(SELECTORS.turn));
        const targetIndex = allTurns.indexOf(targetTurn);
        if (targetIndex === -1) return;

        // Use `targetIndex` to include this message, or `targetIndex + 1` to keep it and delete everything after it
        const turnsToDelete = allTurns.slice(targetIndex);

        isDeleting = true;
        invalidateChatCache(true);
        try {
            for (let i = turnsToDelete.length - 1; i >= 0; i--) {
                const turn = turnsToDelete[i];

                if (!document.body.contains(turn)) continue;

                const optBtn = turn.querySelector(SELECTORS.turnOptionsBtn);
                if (!optBtn) continue;

                turn.scrollIntoView({ block: 'center', behavior: 'instant' });
                turn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                optBtn.click();

                const menu = await waitForElement(SELECTORS.menuContent, 1500);
                if (!menu) continue;

                const deleteBtn = findNativeDeleteButton(menu);
                if (!deleteBtn) {
                    const bd = document.querySelector(SELECTORS.backdrop);
                    if (bd) bd.click();
                    continue;
                }

                deleteBtn.click();

                await waitUntil(
                    () => !document.body.contains(turn) && !document.querySelector(SELECTORS.menuContent),
                    2000
                );
                await sleep(100);
            }
        } finally {
            isDeleting = false;
        }
    }

    // =========================================================================
    // Scroll & Toolbar Shared Helpers (Feature 2 + Feature 3)
    // =========================================================================

    function isVerticallyScrollable(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
        const overflowY = getComputedStyle(el).overflowY;
        if (el === document.scrollingElement) {
            return overflowY !== 'hidden' && el.scrollHeight > el.clientHeight + 1;
        }
        return (
            (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
            el.scrollHeight > el.clientHeight + 1
        );
    }

    function isHorizontallyScrollable(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
        const overflowX = getComputedStyle(el).overflowX;
        if (el === document.scrollingElement) {
            return overflowX !== 'hidden' && el.scrollWidth > el.clientWidth + 1;
        }
        return (
            (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') &&
            el.scrollWidth > el.clientWidth + 1
        );
    }

    function getChatScrollContainers() {
        const containers = new Set();

        const firstTurn = document.querySelector(SELECTORS.turn);
        if (firstTurn) {
            let el = firstTurn.parentElement;
            while (el && el !== document.documentElement) {
                if (isVerticallyScrollable(el)) {
                    containers.add(el);
                }
                el = el.parentElement;
            }
        }

        for (const el of document.querySelectorAll(SELECTORS.scrollContainer)) {
            if (el.closest('ms-navbar, ms-navbar-v2')) continue;
            if (isVerticallyScrollable(el)) containers.add(el);
        }

        return Array.from(containers);
    }

    function getPrimaryChatScrollContainer() {
        const firstTurn = document.querySelector(SELECTORS.turn);
        if (firstTurn) {
            // Walk up from an actual chat turn so we always get the container that scrolls turns
            let el = firstTurn.parentElement;
            while (el && el !== document.documentElement) {
                if (isVerticallyScrollable(el)) {
                    return el;
                }
                el = el.parentElement;
            }
            for (const el2 of document.querySelectorAll(SELECTORS.scrollContainer)) {
                if (el2.contains(firstTurn) && isVisible(el2)) {
                    return el2;
                }
            }
        }

        const containers = getChatScrollContainers();
        return containers.length > 0 ? containers[0] : null;
    }

    function ensureToolbarButtonStyles() {
        if (document.getElementById(TOOLBAR_STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = TOOLBAR_STYLE_ID;
        style.textContent = `
            #${SEARCH_BTN_ID},
            #${GO_TOP_BTN_ID} {
                flex: 0 0 auto;
            }
            #${SEARCH_BTN_ID} > .ms-button-icon-symbol,
            #${SEARCH_BTN_ID} .material-symbols-outlined,
            #${GO_TOP_BTN_ID} > .ms-button-icon-symbol,
            #${GO_TOP_BTN_ID} .material-symbols-outlined {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                line-height: 1;
                pointer-events: none;
                user-select: none;
            }
            #${SEARCH_BTN_ID}:not([data-cloned-native="1"]),
            #${GO_TOP_BTN_ID}:not([data-cloned-native="1"]) {
                position: relative;
                box-sizing: border-box;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 32px;
                height: 32px;
                min-width: 32px;
                min-height: 32px;
                padding: 0;
                margin: 0;
                border: none;
                border-radius: 50%;
                background: transparent;
                color: inherit;
                cursor: pointer;
            }
            #${SEARCH_BTN_ID}:not([data-cloned-native="1"]):hover,
            #${GO_TOP_BTN_ID}:not([data-cloned-native="1"]):hover {
                background-color: light-dark(rgba(60, 64, 67, 0.05), rgba(255, 255, 255, 0.1));
            }
            #${SEARCH_BTN_ID}[data-search-open="1"] {
                background-color: light-dark(rgba(26, 115, 232, 0.12), rgba(138, 180, 248, 0.2));
                color: light-dark(#1a73e8, #8ab4f8);
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function findNativeIconButton(toolbarRight) {
        const selectors = [
            'button[data-test-clear="outside"]',
            'button[data-test-compare]',
            'button[iconname="more_vert"]',
            'button.ms-button-icon'
        ];
        const seen = new Set();
        const candidates = [];

        for (const sel of selectors) {
            for (const el of toolbarRight.querySelectorAll(sel)) {
                if (!seen.has(el)) {
                    seen.add(el);
                    candidates.push(el);
                }
            }
        }

        let fallback = null;
        for (const el of candidates) {
            if (el.id === GO_TOP_BTN_ID || el.id === SEARCH_BTN_ID || !isVisible(el)) continue;

            const rect = el.getBoundingClientRect();
            if (rect.height < 24 || rect.height > 48 || Math.abs(rect.width - rect.height) > 4) {
                continue;
            }

            const iconEl = el.querySelector(SELECTORS.icon);
            const iconText = iconEl ? iconEl.textContent.trim() : '';
            if (el.textContent.trim() !== iconText) continue;

            const isFontIcon = Boolean(iconEl && !iconEl.querySelector('svg') && iconText.length > 0);
            const isDisabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
            const isActive =
                el.getAttribute('aria-pressed') === 'true' ||
                el.classList.contains('active') ||
                el.classList.contains('selected');

            if (!isDisabled && !isActive && isFontIcon) {
                return el;
            }
            if (!fallback) {
                fallback = el;
            }
        }
        return fallback;
    }

    function createToolbarButtonFromNative(refBtn, { id, iconName, label, onClick }) {
        const btn = refBtn.cloneNode(true);
        btn.id = id;
        btn.type = 'button';
        btn.dataset.clonedNative = '1';

        const attrsToRemove = [
            'disabled',
            'aria-disabled',
            'aria-expanded',
            'aria-haspopup',
            'aria-controls',
            'aria-pressed',
            'aria-describedby',
            'cdk-describedby-host',
            'jsaction',
            'jslog',
            'tabindex',
            'style'
        ];
        for (const attr of attrsToRemove) {
            btn.removeAttribute(attr);
        }
        for (const attr of Array.from(btn.attributes)) {
            if (attr.name.startsWith('data-test')) {
                btn.removeAttribute(attr.name);
            }
        }

        btn.classList.remove(
            'mat-mdc-button-disabled',
            'ms-button-disabled',
            'cdk-focused',
            'cdk-mouse-focused',
            'cdk-keyboard-focused',
            'cdk-program-focused',
            'active',
            'selected'
        );

        if (btn.hasAttribute('iconname')) {
            btn.setAttribute('iconname', iconName);
        }
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);

        const iconEl = btn.querySelector(SELECTORS.icon);
        if (iconEl && !iconEl.querySelector('svg') && iconEl.classList.contains('material-symbols-outlined')) {
            iconEl.textContent = iconName;
            if (iconEl.hasAttribute('fonticon')) {
                iconEl.setAttribute('fonticon', iconName);
            }
        } else {
            const replacement = document.createElement('span');
            replacement.className = 'material-symbols-outlined notranslate ms-button-icon-symbol';
            replacement.setAttribute('aria-hidden', 'true');
            replacement.textContent = iconName;

            if (iconEl) {
                for (const attr of iconEl.attributes) {
                    if (attr.name.startsWith('_ngcontent-') || attr.name.startsWith('_nghost-')) {
                        replacement.setAttribute(attr.name, attr.value);
                    }
                }
                iconEl.replaceWith(replacement);
            } else {
                btn.appendChild(replacement);
            }
        }

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
        });

        return btn;
    }

    function createFallbackToolbarButton({ id, iconName, label, onClick }) {
        const btn = document.createElement('button');
        btn.id = id;
        btn.type = 'button';
        btn.className = 'mat-mdc-tooltip-trigger ms-button-borderless ms-button-icon';
        btn.setAttribute('ms-button', '');
        btn.setAttribute('variant', 'icon-borderless');
        btn.setAttribute('iconname', iconName);
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);

        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined notranslate ms-button-icon-symbol';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = iconName;
        btn.appendChild(icon);

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
        });

        return btn;
    }

    function findVisibleToolbarRight() {
        const toolbars = document.querySelectorAll(SELECTORS.toolbarRight);
        for (const tb of toolbars) {
            if (isVisible(tb)) return tb;
        }
        return null;
    }

    function isChatToolbar(toolbarRight) {
        if (!toolbarRight) return false;
        if (/\/prompts(\/|$)/.test(window.location.pathname)) return true;
        if (document.querySelector(SELECTORS.scrollContainer)) return true;
        return Boolean(toolbarRight.querySelector(SELECTORS.toolbarAnchor));
    }

    function getDirectChild(parent, descendant) {
        let node = descendant;
        while (node && node.parentElement !== parent) {
            node = node.parentElement;
        }
        return node && node.parentElement === parent ? node : null;
    }

    function findToolbarInsertAnchor(toolbarRight) {
        const matches = Array.from(toolbarRight.querySelectorAll(SELECTORS.toolbarAnchor));

        for (const el of toolbarRight.querySelectorAll('button, a')) {
            if (el.id === GO_TOP_BTN_ID || el.id === SEARCH_BTN_ID) continue;
            const icon = el.querySelector(SELECTORS.icon);
            if (icon && ANCHOR_ICONS.has(icon.textContent.trim())) {
                matches.push(el);
            }
        }

        let leftmostAnchor = null;
        let leftmostX = Infinity;

        for (const el of matches) {
            if (el.id === GO_TOP_BTN_ID || el.id === SEARCH_BTN_ID || !isVisible(el)) continue;
            const direct = getDirectChild(toolbarRight, el);
            if (!direct || direct.id === GO_TOP_BTN_ID || direct.id === SEARCH_BTN_ID) continue;

            const x = el.getBoundingClientRect().left;
            if (x < leftmostX) {
                leftmostX = x;
                leftmostAnchor = direct;
            }
        }

        return leftmostAnchor;
    }

    const toolbarObserver = new MutationObserver(() => {
        scheduleToolbarSync();
    });

    function scheduleToolbarSync() {
        if (toolbarSyncQueued) return;
        toolbarSyncQueued = true;
        requestAnimationFrame(() => {
            toolbarSyncQueued = false;
            ensureToolbarButtons();
        });
    }

    function syncSearchToolbarBtnState(searchBtn) {
        if (!searchBtn) return;
        searchBtn.setAttribute('aria-expanded', isSearchOpen ? 'true' : 'false');
        if (isSearchOpen) {
            searchBtn.dataset.searchOpen = '1';
        } else {
            searchBtn.removeAttribute('data-search-open');
        }
    }

    function ensureToolbarButton(refBtn, existing, config) {
        let btn = existing;
        if (!btn) {
            btn = refBtn
                ? createToolbarButtonFromNative(refBtn, config)
                : createFallbackToolbarButton(config);
        } else if (btn.dataset.clonedNative !== '1' && refBtn) {
            const upgraded = createToolbarButtonFromNative(refBtn, config);
            btn.replaceWith(upgraded);
            btn = upgraded;
        }
        return btn;
    }

    function ensureToolbarButtons() {
        ensureToolbarButtonStyles();

        const toolbarRight = findVisibleToolbarRight();
        const existingSearchBtn = document.getElementById(SEARCH_BTN_ID);
        const existingGoTopBtn = document.getElementById(GO_TOP_BTN_ID);

        if (!toolbarRight || !isChatToolbar(toolbarRight)) {
            if (existingSearchBtn) existingSearchBtn.remove();
            if (existingGoTopBtn) existingGoTopBtn.remove();
            if (isSearchOpen) closeSearchPanel();
            if (observedToolbar) {
                toolbarObserver.disconnect();
                if (toolbarResizeObserver) toolbarResizeObserver.disconnect();
                observedToolbar = null;
            }
            return;
        }

        if (observedToolbar !== toolbarRight) {
            toolbarObserver.disconnect();
            observedToolbar = toolbarRight;
            toolbarObserver.observe(toolbarRight, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class', 'hidden']
            });

            if (typeof ResizeObserver === 'function') {
                if (!toolbarResizeObserver) {
                    toolbarResizeObserver = new ResizeObserver(() => {
                        if (isSearchOpen) positionSearchPanel(observedToolbar);
                    });
                } else {
                    toolbarResizeObserver.disconnect();
                }
                toolbarResizeObserver.observe(toolbarRight);
            }
        }

        const refBtn = findNativeIconButton(toolbarRight);

        const searchBtn = ensureToolbarButton(refBtn, existingSearchBtn, {
            id: SEARCH_BTN_ID,
            iconName: 'search',
            label: 'Search text',
            onClick: toggleSearchPanel
        });
        syncSearchToolbarBtnState(searchBtn);

        const goTopBtn = ensureToolbarButton(refBtn, existingGoTopBtn, {
            id: GO_TOP_BTN_ID,
            iconName: 'arrow_upward', // Alternative: 'vertical_align_top'
            label: 'Go to top',
            onClick: scrollToChatTop
        });

        const anchor = findToolbarInsertAnchor(toolbarRight);

        const alreadyInPlace = anchor
            ? searchBtn.parentElement === toolbarRight &&
              goTopBtn.parentElement === toolbarRight &&
              searchBtn.nextElementSibling === goTopBtn &&
              goTopBtn.nextElementSibling === anchor
            : searchBtn.parentElement === toolbarRight &&
              goTopBtn.parentElement === toolbarRight &&
              toolbarRight.firstElementChild === searchBtn &&
              searchBtn.nextElementSibling === goTopBtn;

        if (!alreadyInPlace) {
            if (anchor) {
                toolbarRight.insertBefore(goTopBtn, anchor);
                toolbarRight.insertBefore(searchBtn, goTopBtn);
            } else {
                toolbarRight.prepend(goTopBtn);
                toolbarRight.prepend(searchBtn);
            }
        }

        if (isSearchOpen) {
            positionSearchPanel(toolbarRight);
        }
    }

    // =========================================================================
    // Feature 2: Go to top
    // =========================================================================

    function scrollToChatTop() {
        // Change behavior to 'instant' if you prefer immediate jumping over smooth scrolling
        const containers = getChatScrollContainers();
        if (containers.length > 0) {
            for (const container of containers) {
                container.scrollTo({ top: 0, behavior: 'smooth' });
            }
            return;
        }

        const firstTurn = document.querySelector(SELECTORS.turn);
        if (firstTurn) {
            firstTurn.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    // =========================================================================
    // Feature 3: Search text (with full-chat virtual-scroll indexing)
    // =========================================================================

    function invalidateChatCache(clearData = false) {
        hasCompletedFullScan = false;
        chatCacheDirty = true;
        if (clearData) {
            cachedTurnsByKey.clear();
            cachedTurnList = [];
            lastScrollbarCount = -1;
            lastDomTurnCount = -1;
        }
    }

    function ensureSearchStyles() {
        if (document.getElementById(SEARCH_STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = SEARCH_STYLE_ID;
        style.textContent = `
            #${SEARCH_PANEL_ID} {
                position: fixed;
                top: 56px;
                right: 16px;
                z-index: 1000;
                box-sizing: border-box;
                display: none;
                align-items: center;
                gap: 4px;
                width: min(360px, calc(100vw - 24px));
                padding: 6px 8px 6px 12px;
                border-radius: 12px;
                background-color: light-dark(#ffffff, #1e1f20);
                color: light-dark(#1f1f1f, #e3e3e3);
                border: 1px solid light-dark(rgba(0, 0, 0, 0.14), rgba(255, 255, 255, 0.16));
                box-shadow: light-dark(0 4px 16px rgba(0, 0, 0, 0.14), 0 6px 20px rgba(0, 0, 0, 0.45));
                font-family: inherit;
                font-size: 13px;
            }
            #${SEARCH_PANEL_ID}.is-open {
                display: flex;
            }
            #${SEARCH_PANEL_ID} input.custom-search-input {
                flex: 1 1 auto;
                min-width: 0;
                border: none;
                outline: none;
                background: transparent;
                color: inherit;
                font: inherit;
                font-size: 13px;
                line-height: 20px;
                padding: 2px 0;
                margin: 0;
            }
            #${SEARCH_PANEL_ID} input.custom-search-input::placeholder {
                color: light-dark(rgba(0, 0, 0, 0.45), rgba(255, 255, 255, 0.45));
            }
            #${SEARCH_PANEL_ID} .custom-search-count {
                flex: 0 0 auto;
                font-size: 12px;
                font-variant-numeric: tabular-nums;
                white-space: nowrap;
                padding: 0 4px;
                user-select: none;
                color: light-dark(rgba(0, 0, 0, 0.6), rgba(255, 255, 255, 0.65));
            }
            #${SEARCH_PANEL_ID} .custom-search-count.is-empty {
                color: light-dark(#c5221f, #f28b82);
            }
            #${SEARCH_PANEL_ID} .custom-search-divider {
                flex: 0 0 auto;
                width: 1px;
                height: 18px;
                margin: 0 2px;
                background-color: light-dark(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.14));
            }
            #${SEARCH_PANEL_ID} button.custom-search-icon-btn,
            #${SEARCH_PANEL_ID} button.custom-search-case-btn {
                flex: 0 0 auto;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                box-sizing: border-box;
                border: none;
                padding: 0;
                margin: 0;
                background: transparent;
                color: inherit;
                cursor: pointer;
                user-select: none;
            }
            #${SEARCH_PANEL_ID} button.custom-search-case-btn {
                width: 26px;
                height: 26px;
                border-radius: 6px;
                font-family: inherit;
                font-size: 12px;
                font-weight: 600;
                letter-spacing: -0.02em;
                opacity: 0.72;
            }
            #${SEARCH_PANEL_ID} button.custom-search-case-btn:hover {
                opacity: 1;
                background-color: light-dark(rgba(60, 64, 67, 0.08), rgba(255, 255, 255, 0.12));
            }
            #${SEARCH_PANEL_ID} button.custom-search-case-btn[aria-pressed="true"] {
                opacity: 1;
                background-color: light-dark(rgba(26, 115, 232, 0.14), rgba(138, 180, 248, 0.22));
                color: light-dark(#1a73e8, #8ab4f8);
            }
            #${SEARCH_PANEL_ID} button.custom-search-icon-btn {
                width: 28px;
                height: 28px;
                border-radius: 50%;
            }
            #${SEARCH_PANEL_ID} button.custom-search-icon-btn:hover:not(:disabled) {
                background-color: light-dark(rgba(60, 64, 67, 0.08), rgba(255, 255, 255, 0.12));
            }
            #${SEARCH_PANEL_ID} button.custom-search-icon-btn:disabled {
                opacity: 0.36;
                cursor: default;
            }
            #${SEARCH_PANEL_ID} .material-symbols-outlined {
                font-size: 18px;
                line-height: 1;
                pointer-events: none;
            }

            ::highlight(${SEARCH_MATCH_HIGHLIGHT}) {
                background-color: light-dark(rgba(255, 213, 79, 0.65), rgba(250, 204, 21, 0.34));
                color: light-dark(#111827, #fef9c3);
            }
            ::highlight(${SEARCH_ACTIVE_HIGHLIGHT}) {
                background-color: light-dark(#ff9800, #fb923c);
                color: #111111;
            }

            mark[${SEARCH_MARK_ATTR}] {
                background-color: light-dark(rgba(255, 213, 79, 0.65), rgba(250, 204, 21, 0.34));
                color: light-dark(#111827, #fef9c3);
                border-radius: 2px;
                padding: 0;
            }
            mark[${SEARCH_MARK_ATTR}="active"] {
                background-color: light-dark(#ff9800, #fb923c);
                color: #111111;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function createPanelIconButton(iconName, label, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'custom-search-icon-btn';
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);

        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined notranslate';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = iconName;
        btn.appendChild(icon);

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
        });

        return btn;
    }

    function buildSearchPanel() {
        if (searchPanel && searchPanel.isConnected) return searchPanel;

        ensureSearchStyles();

        const panel = document.createElement('div');
        panel.id = SEARCH_PANEL_ID;
        panel.setAttribute('role', 'search');
        panel.setAttribute('aria-label', 'Search current chat');

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'custom-search-input';
        input.placeholder = 'Search text...';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('aria-label', 'Search text');

        const countEl = document.createElement('span');
        countEl.className = 'custom-search-count';
        countEl.setAttribute('aria-live', 'polite');

        const caseBtn = document.createElement('button');
        caseBtn.type = 'button';
        caseBtn.className = 'custom-search-case-btn';
        caseBtn.textContent = 'Aa';
        caseBtn.setAttribute('aria-label', 'Match case');
        caseBtn.setAttribute('title', 'Match case');
        caseBtn.setAttribute('aria-pressed', searchCaseSensitive ? 'true' : 'false');

        const divider = document.createElement('span');
        divider.className = 'custom-search-divider';
        divider.setAttribute('aria-hidden', 'true');

        const prevBtn = createPanelIconButton(
            'keyboard_arrow_up',
            'Previous match (Shift+Enter)',
            () => {
                if (isQueryDirty() && input.value.trim()) {
                    runSearch({ jumpToLast: true });
                } else {
                    jumpToPrevMatch();
                }
            }
        );
        const nextBtn = createPanelIconButton(
            'keyboard_arrow_down',
            'Next match (Enter)',
            () => {
                if (isQueryDirty() && input.value.trim()) {
                    runSearch({ jump: true });
                } else {
                    jumpToNextMatch();
                }
            }
        );
        const closeBtn = createPanelIconButton('close', 'Close (Esc)', closeSearchPanel);

        // Search only when user presses Enter (not on every typed character)
        input.addEventListener('input', () => {
            lastSearchQuery = input.value;
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();

                if (isScanningChat) return;

                if (!hasExecutedSearch || isQueryDirty()) {
                    runSearch({ jump: true, jumpToLast: e.shiftKey });
                } else if (e.shiftKey) {
                    jumpToPrevMatch();
                } else {
                    jumpToNextMatch();
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeSearchPanel();
            }
        });

        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeSearchPanel();
            }
        });

        caseBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            searchCaseSensitive = !searchCaseSensitive;
            caseBtn.setAttribute('aria-pressed', searchCaseSensitive ? 'true' : 'false');
            if (hasExecutedSearch && input.value.trim() && !isQueryDirty({ ignoreCase: true })) {
                runSearch({ jump: true });
            }
            input.focus();
        });

        panel.append(input, countEl, caseBtn, divider, prevBtn, nextBtn, closeBtn);
        document.body.appendChild(panel);

        searchPanel = panel;
        searchInput = input;
        searchCountEl = countEl;
        searchCaseBtn = caseBtn;
        searchPrevBtn = prevBtn;
        searchNextBtn = nextBtn;

        return panel;
    }

    function isQueryDirty({ ignoreCase = false } = {}) {
        if (!searchInput) return false;
        if (searchInput.value !== lastExecutedQuery) return true;
        if (!ignoreCase && searchCaseSensitive !== lastExecutedCaseSensitive) return true;
        return false;
    }

    function positionSearchPanel(toolbarRight = findVisibleToolbarRight()) {
        if (!searchPanel || !isSearchOpen) return;

        if (toolbarRight && isVisible(toolbarRight)) {
            const rect = toolbarRight.getBoundingClientRect();
            const top = Math.max(48, Math.round(rect.bottom + 8));
            const panelWidth = searchPanel.offsetWidth || 360;
            const maxRight = Math.max(12, window.innerWidth - panelWidth - 12);
            const right = Math.min(Math.max(12, Math.round(window.innerWidth - rect.right)), maxRight);
            searchPanel.style.top = `${top}px`;
            searchPanel.style.right = `${right}px`;
        } else {
            searchPanel.style.top = '56px';
            searchPanel.style.right = '16px';
        }
    }

    function attachScrollHighlightListener() {
        const container = getPrimaryChatScrollContainer();
        if (observedScrollContainer === container) return;
        if (observedScrollContainer) {
            observedScrollContainer.removeEventListener('scroll', onChatScrollForHighlights);
        }
        observedScrollContainer = container;
        if (observedScrollContainer) {
            observedScrollContainer.addEventListener('scroll', onChatScrollForHighlights, {
                passive: true
            });
        }
    }

    function detachScrollHighlightListener() {
        clearTimeout(scrollRefreshTimer);
        if (observedScrollContainer) {
            observedScrollContainer.removeEventListener('scroll', onChatScrollForHighlights);
            observedScrollContainer = null;
        }
    }

    function onChatScrollForHighlights() {
        if (!isSearchOpen || isScanningChat || searchMatches.length === 0) return;
        clearTimeout(scrollRefreshTimer);
        scrollRefreshTimer = setTimeout(() => {
            if (!isSearchOpen || isScanningChat || searchMatches.length === 0) return;
            if (!SUPPORTS_CSS_HIGHLIGHT) return;
            refreshLiveRangesForMountedTurns();
            applyVisibleHighlights();
        }, 120);
    }

    function openSearchPanel() {
        const panel = buildSearchPanel();
        isSearchOpen = true;
        panel.classList.add('is-open');
        positionSearchPanel();
        syncSearchToolbarBtnState(document.getElementById(SEARCH_BTN_ID));
        attachScrollHighlightListener();

        if (lastSearchQuery) {
            searchInput.value = lastSearchQuery;
        }
        updateSearchUI();

        searchInput.focus();
        searchInput.select();
    }

    function closeSearchPanel() {
        currentNavToken++;
        currentScanToken++;
        isScanningChat = false;
        isSearchOpen = false;
        detachScrollHighlightListener();

        if (searchPanel) {
            searchPanel.classList.remove('is-open');
        }
        clearSearchResults();

        const btn = document.getElementById(SEARCH_BTN_ID);
        syncSearchToolbarBtnState(btn);
    }

    function toggleSearchPanel() {
        if (isSearchOpen) {
            closeSearchPanel();
        } else {
            openSearchPanel();
        }
    }

    // Close search bar when clicking anywhere outside it (except Search button & scrollbars)
    document.addEventListener(
        'pointerdown',
        (e) => {
            if (!isSearchOpen) return;
            const target = e.target;
            if (!(target instanceof Node)) return;
            if (searchPanel && searchPanel.contains(target)) return;

            const searchBtn = document.getElementById(SEARCH_BTN_ID);
            if (searchBtn && searchBtn.contains(target)) return;

            if (target instanceof Element) {
                const rect = target.getBoundingClientRect();
                if (
                    (target.clientWidth > 0 && e.clientX > rect.left + target.clientWidth) ||
                    (target.clientHeight > 0 && e.clientY > rect.top + target.clientHeight)
                ) {
                    return;
                }
            }

            closeSearchPanel();
        },
        true
    );

    // Track keyboard Enter in prompt box to invalidate cached turns when a new prompt is sent
    document.addEventListener(
        'keydown',
        (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                const target = e.target;
                if (
                    target instanceof HTMLTextAreaElement &&
                    !target.closest(`#${SEARCH_PANEL_ID}`) &&
                    target.closest('ms-prompt-box, .prompt-box-container, ms-chunk-editor, footer')
                ) {
                    invalidateChatCache(false);
                }
            }
        },
        true
    );

    function collectTurnText(turn) {
        let fullText = '';
        const segments = [];

        const appendSeparator = () => {
            if (fullText.length > 0 && fullText[fullText.length - 1] !== '\n') {
                fullText += '\n';
            }
        };

        const walk = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const value = node.nodeValue;
                if (!value) return;
                const start = fullText.length;
                fullText += value;
                segments.push({ node, start, end: fullText.length });
                return;
            }

            if (node.nodeType !== Node.ELEMENT_NODE) return;

            const tag = node.tagName;
            if (SEARCH_EXCLUDED_TAGS.has(tag)) return;
            if (node.hasAttribute(SEARCH_MARK_ATTR)) {
                for (let child = node.firstChild; child; child = child.nextSibling) {
                    walk(child);
                }
                return;
            }
            if (node.matches(SEARCH_EXCLUDED_SELECTOR)) return;

            const display = getComputedStyle(node).display;
            const isExpansionContent = node.classList.contains('mat-expansion-panel-content');
            if (display === 'none' && !isExpansionContent) return;

            if (tag === 'BR') {
                appendSeparator();
                return;
            }

            const isBlock = isExpansionContent || BLOCK_DISPLAY_VALUES.has(display);
            if (isBlock) appendSeparator();

            for (let child = node.firstChild; child; child = child.nextSibling) {
                walk(child);
            }

            if (isBlock) appendSeparator();
        };

        walk(turn);
        return { fullText, segments };
    }

    function isTurnEmptyPlaceholder(turn) {
        if (!turn || !turn.isConnected) return true;
        // Must check real message text rather than UI chrome like "User" or "more_vert"
        const { fullText } = collectTurnText(turn);
        if (fullText.trim().length > 0) return false;
        return !turn.querySelector('ms-file-chunk, ms-image-chunk, img, video, audio, canvas');
    }

    function findSegmentForStart(segments, pos) {
        let lo = 0;
        let hi = segments.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            const seg = segments[mid];
            if (pos < seg.start) {
                hi = mid - 1;
            } else if (pos >= seg.end) {
                lo = mid + 1;
            } else {
                return seg;
            }
        }
        return null;
    }

    function findSegmentForEnd(segments, pos) {
        let lo = 0;
        let hi = segments.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            const seg = segments[mid];
            if (pos <= seg.start) {
                hi = mid - 1;
            } else if (pos > seg.end) {
                lo = mid + 1;
            } else {
                return seg;
            }
        }
        return null;
    }

    function findLiveMatchesInTurn(turn, query, caseSensitive) {
        const results = [];
        if (!turn || isTurnEmptyPlaceholder(turn) || !query || !query.trim()) return results;

        const { fullText, segments } = collectTurnText(turn);
        if (!fullText || segments.length === 0) return results;

        const regex = new RegExp(escapeRegExp(query), caseSensitive ? 'g' : 'gi');
        let m;
        while ((m = regex.exec(fullText)) !== null) {
            if (m[0].length === 0) {
                regex.lastIndex++;
                continue;
            }
            const startPos = m.index;
            const endPos = startPos + m[0].length;
            const startSeg = findSegmentForStart(segments, startPos);
            const endSeg = findSegmentForEnd(segments, endPos);

            if (startSeg && endSeg) {
                const range = document.createRange();
                range.setStart(startSeg.node, startPos - startSeg.start);
                range.setEnd(endSeg.node, endPos - endSeg.start);
                results.push({ range, offset: startPos, length: m[0].length });
            }
        }
        return results;
    }

    function getScrollbarTurnOrderMap() {
        const map = new Map();
        const navButtons = document.querySelectorAll(SELECTORS.scrollbarButtons);
        navButtons.forEach((btn, idx) => {
            const id = btn.getAttribute('aria-controls');
            if (id) map.set(id, idx);
        });
        return map;
    }

    function getExistingTurnKey(turn) {
        if (!turn) return null;
        if (turn.id) return `id:${turn.id}`;
        return turn.dataset?.customTurnKey || null;
    }

    function resolveTurnKey(turn, fullText, turnTop, turnMap) {
        if (turn.id) return `id:${turn.id}`;
        if (turn.dataset?.customTurnKey) return turn.dataset.customTurnKey;

        // If a virtual scroller re-created a node without id in the overlap zone, reuse key
        const recent = Array.from(turnMap.values()).slice(-10);
        for (let i = recent.length - 1; i >= 0; i--) {
            const entry = recent[i];
            if (
                !entry.turnId &&
                entry.turnEl !== turn &&
                !entry.turnEl?.isConnected &&
                entry.fullText === fullText &&
                Math.abs(entry.turnTop - turnTop) < 350
            ) {
                turn.dataset.customTurnKey = entry.key;
                return entry.key;
            }
        }

        const key = `ct-${++turnKeySeq}`;
        turn.dataset.customTurnKey = key;
        return key;
    }

    function needsFullVirtualScan(scrollContainer) {
        if (!scrollContainer) return false;

        const turns = Array.from(document.querySelectorAll(SELECTORS.turn));
        const scrollbarCount = document.querySelectorAll(SELECTORS.scrollbarButtons).length;
        const renderedCount = turns.filter((t) => !isTurnEmptyPlaceholder(t)).length;

        if (!hasCompletedFullScan || chatCacheDirty) {
            if (turns.some((t) => isTurnEmptyPlaceholder(t))) return true;
            if (scrollbarCount > renderedCount) return true;
            if (scrollContainer.scrollHeight > scrollContainer.clientHeight * 1.25) return true;
            return false;
        }

        if (lastScrollbarCount !== -1 && scrollbarCount !== lastScrollbarCount) return true;
        if (lastDomTurnCount !== -1 && turns.length !== lastDomTurnCount) return true;

        for (const t of turns) {
            if (!isTurnEmptyPlaceholder(t)) {
                const key = getExistingTurnKey(t);
                if (!key || !cachedTurnsByKey.has(key)) return true;
            }
        }

        return false;
    }

    function syncMountedTurnsIntoCache(scrollContainer) {
        const cRect = scrollContainer ? scrollContainer.getBoundingClientRect() : null;
        const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
        const scrollbarOrder = getScrollbarTurnOrderMap();
        const turns = Array.from(document.querySelectorAll(SELECTORS.turn));

        for (let i = 0; i < turns.length; i++) {
            const turn = turns[i];
            if (isTurnEmptyPlaceholder(turn)) continue;

            const { fullText } = collectTurnText(turn);
            const tRect = turn.getBoundingClientRect();
            const turnTop = cRect ? tRect.top - cRect.top + scrollTop : i * 100;
            const key = resolveTurnKey(turn, fullText, turnTop, cachedTurnsByKey);

            const existing = cachedTurnsByKey.get(key);
            const order =
                turn.id && scrollbarOrder.has(turn.id)
                    ? scrollbarOrder.get(turn.id)
                    : existing
                      ? existing.order
                      : turnTop;

            if (existing) {
                existing.fullText = fullText;
                existing.turnTop = turnTop;
                existing.turnId = turn.id || existing.turnId;
                existing.turnEl = turn;
                existing.order = order;
            } else {
                cachedTurnsByKey.set(key, {
                    key,
                    turnId: turn.id || null,
                    turnEl: turn,
                    turnTop,
                    order,
                    seq: cachedTurnsByKey.size,
                    fullText
                });
            }
        }

        cachedTurnList = Array.from(cachedTurnsByKey.values()).sort((a, b) => {
            if (a.turnId && b.turnId && scrollbarOrder.has(a.turnId) && scrollbarOrder.has(b.turnId)) {
                return scrollbarOrder.get(a.turnId) - scrollbarOrder.get(b.turnId);
            }
            if (Math.abs(a.turnTop - b.turnTop) > 1) return a.turnTop - b.turnTop;
            return a.seq - b.seq;
        });
    }

    async function waitForViewportTurnsToMount(scrollContainer, scanToken) {
        await nextFrame();
        if (scanToken !== currentScanToken) return;

        const start = Date.now();
        while (Date.now() - start < 600) {
            if (scanToken !== currentScanToken) return;

            const cRect = scrollContainer.getBoundingClientRect();
            const turns = document.querySelectorAll(SELECTORS.turn);
            let hasRenderedInView = false;
            let hasEmptyInView = false;

            for (const t of turns) {
                const r = t.getBoundingClientRect();
                if (r.bottom < cRect.top - 40 || r.top > cRect.bottom + 40) continue;
                if (isTurnEmptyPlaceholder(t)) {
                    hasEmptyInView = true;
                } else {
                    hasRenderedInView = true;
                }
            }

            if (hasRenderedInView && !hasEmptyInView) {
                await nextFrame();
                return;
            }
            if (!hasEmptyInView && Date.now() - start >= 120) {
                return;
            }
            await sleep(25);
        }
    }

    async function waitForSpecificTurnToMount(turn, scanToken) {
        if (!turn) return false;
        const start = Date.now();
        while (Date.now() - start < 700) {
            if (scanToken !== currentScanToken) return false;
            if (!turn.isConnected || !isTurnEmptyPlaceholder(turn)) {
                await nextFrame();
                return true;
            }
            await sleep(25);
        }
        return false;
    }

    function updateScanProgress(done, total, scrollContainer) {
        if (!searchCountEl) return;
        let pct;
        if (total > 0) {
            pct = Math.min(99, Math.round((done / total) * 100));
        } else {
            const denom = Math.max(1, scrollContainer.scrollHeight);
            pct = Math.min(
                99,
                Math.round(((scrollContainer.scrollTop + scrollContainer.clientHeight) / denom) * 100)
            );
        }
        searchCountEl.classList.remove('is-empty');
        searchCountEl.textContent = `Scanning ${pct}%`;
    }

    async function scanEntireChat(scrollContainer, scanToken) {
        isScanningChat = true;
        const savedScrollTop = scrollContainer.scrollTop;
        const turnMap = new Map();
        const capturedElements = new WeakSet();
        const attemptedElements = new WeakSet();
        const scrollbarOrder = getScrollbarTurnOrderMap();
        let seqCounter = 0;

        const captureAllRenderedInDom = () => {
            const cRect = scrollContainer.getBoundingClientRect();
            const turns = Array.from(document.querySelectorAll(SELECTORS.turn));
            let lowestRenderedBottom = -Infinity;

            for (const turn of turns) {
                if (isTurnEmptyPlaceholder(turn)) continue;

                capturedElements.add(turn);
                const r = turn.getBoundingClientRect();
                const turnTop = r.top - cRect.top + scrollContainer.scrollTop;
                const { fullText } = collectTurnText(turn);
                const key = resolveTurnKey(turn, fullText, turnTop, turnMap);
                const existing = turnMap.get(key);

                if (existing) {
                    existing.fullText = fullText;
                    existing.turnTop = turnTop;
                    existing.turnId = turn.id || existing.turnId;
                    existing.turnEl = turn;
                } else {
                    const order =
                        turn.id && scrollbarOrder.has(turn.id)
                            ? scrollbarOrder.get(turn.id)
                            : seqCounter;
                    turnMap.set(key, {
                        key,
                        turnId: turn.id || null,
                        turnEl: turn,
                        turnTop,
                        order,
                        seq: seqCounter++,
                        fullText
                    });
                }

                if (r.bottom > lowestRenderedBottom) {
                    lowestRenderedBottom = r.bottom;
                }
            }

            return { turns, lowestRenderedBottom };
        };

        try {
            // Always start from the very top so top-most turns mount cleanly
            scrollContainer.scrollTo({ top: 0, behavior: 'instant' });
            await waitForViewportTurnsToMount(scrollContainer, scanToken);
            if (scanToken !== currentScanToken || !isSearchOpen) {
                scrollContainer.scrollTo({ top: savedScrollTop, behavior: 'instant' });
                return null;
            }

            // Phase 1: Deterministically visit every DOM-resident ms-chat-turn in exact order
            for (let safety = 0; safety < 1500; safety++) {
                if (scanToken !== currentScanToken || !isSearchOpen) {
                    scrollContainer.scrollTo({ top: savedScrollTop, behavior: 'instant' });
                    return null;
                }

                const { turns } = captureAllRenderedInDom();
                const expectedTotal = Math.max(turns.length, scrollbarOrder.size);
                updateScanProgress(turnMap.size, expectedTotal, scrollContainer);

                const nextTurn = turns.find(
                    (t) => !capturedElements.has(t) && !attemptedElements.has(t)
                );
                if (!nextTurn) break;

                attemptedElements.add(nextTurn);

                const cRect = scrollContainer.getBoundingClientRect();
                const tRect = nextTurn.getBoundingClientRect();
                const targetTop =
                    scrollContainer.scrollTop +
                    (tRect.top - cRect.top) -
                    Math.max(40, cRect.height * 0.25);
                const maxTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
                const clampedTop = Math.max(0, Math.min(maxTop, targetTop));

                scrollContainer.scrollTo({ top: clampedTop, behavior: 'instant' });
                await waitForSpecificTurnToMount(nextTurn, scanToken);

                if (scanToken !== currentScanToken || !isSearchOpen) {
                    scrollContainer.scrollTo({ top: savedScrollTop, behavior: 'instant' });
                    return null;
                }

                captureAllRenderedInDom();
            }

            // Phase 2: If a sliding-window virtualizer didn't keep all shells in DOM, sweep down too
            const afterPhase1Turns = document.querySelectorAll(SELECTORS.turn).length;
            const totalExpected = scrollbarOrder.size;
            if (totalExpected > turnMap.size || (afterPhase1Turns > 0 && turnMap.size < afterPhase1Turns)) {
                scrollContainer.scrollTo({ top: 0, behavior: 'instant' });
                await waitForViewportTurnsToMount(scrollContainer, scanToken);

                for (let step = 0; step < 800; step++) {
                    if (scanToken !== currentScanToken || !isSearchOpen) {
                        scrollContainer.scrollTo({ top: savedScrollTop, behavior: 'instant' });
                        return null;
                    }

                    const { lowestRenderedBottom } = captureAllRenderedInDom();
                    updateScanProgress(turnMap.size, totalExpected, scrollContainer);

                    const cRect = scrollContainer.getBoundingClientRect();
                    const maxScrollTop = Math.max(
                        0,
                        scrollContainer.scrollHeight - scrollContainer.clientHeight
                    );
                    if (scrollContainer.scrollTop >= maxScrollTop - 2) break;

                    const viewportStep = Math.max(220, Math.floor(scrollContainer.clientHeight * 0.65));
                    const jumpPast =
                        lowestRenderedBottom > cRect.bottom + 80
                            ? scrollContainer.scrollTop +
                              (lowestRenderedBottom - cRect.top) -
                              Math.floor(scrollContainer.clientHeight * 0.25)
                            : scrollContainer.scrollTop + viewportStep;

                    const nextTop = Math.min(
                        maxScrollTop,
                        Math.max(scrollContainer.scrollTop + viewportStep, jumpPast)
                    );
                    if (nextTop <= scrollContainer.scrollTop + 1) break;

                    scrollContainer.scrollTo({ top: nextTop, behavior: 'instant' });
                    await waitForViewportTurnsToMount(scrollContainer, scanToken);
                }
            }

            if (scanToken !== currentScanToken || !isSearchOpen) {
                scrollContainer.scrollTo({ top: savedScrollTop, behavior: 'instant' });
                return null;
            }

            const finalOrder = getScrollbarTurnOrderMap();
            cachedTurnsByKey = turnMap;
            cachedTurnList = Array.from(turnMap.values()).sort((a, b) => {
                if (a.turnId && b.turnId && finalOrder.has(a.turnId) && finalOrder.has(b.turnId)) {
                    return finalOrder.get(a.turnId) - finalOrder.get(b.turnId);
                }
                return a.seq - b.seq;
            });
            cachedTurnList.forEach((entry, i) => {
                entry.order = i;
            });

            hasCompletedFullScan = true;
            chatCacheDirty = false;
            lastScrollbarCount = document.querySelectorAll(SELECTORS.scrollbarButtons).length;
            lastDomTurnCount = document.querySelectorAll(SELECTORS.turn).length;

            return savedScrollTop;
        } finally {
            isScanningChat = false;
        }
    }

    function findLiveTurnElement(matchOrRecord) {
        if (matchOrRecord.turnId) {
            const byId = document.getElementById(matchOrRecord.turnId);
            if (byId) return byId;
        }
        if (matchOrRecord.turnElement && matchOrRecord.turnElement.isConnected) {
            return matchOrRecord.turnElement;
        }
        if (matchOrRecord.turnEl && matchOrRecord.turnEl.isConnected) {
            return matchOrRecord.turnEl;
        }
        if (matchOrRecord.turnKey && !matchOrRecord.turnKey.startsWith('id:')) {
            const safeKey = CSS.escape(matchOrRecord.turnKey);
            const byAttr = document.querySelector(`${SELECTORS.turn}[data-custom-turn-key="${safeKey}"]`);
            if (byAttr) return byAttr;
        }
        return null;
    }

    function findMatchesFromTurnList(turnList, query, caseSensitive) {
        const matches = [];
        let truncated = false;

        if (!query || !query.trim()) return { matches, truncated };

        const regex = new RegExp(escapeRegExp(query), caseSensitive ? 'g' : 'gi');

        for (const turnRec of turnList) {
            const text = turnRec.fullText;
            if (!text) continue;

            const liveTurn = findLiveTurnElement(turnRec);
            const liveTurnMatches =
                liveTurn && !isTurnEmptyPlaceholder(liveTurn)
                    ? findLiveMatchesInTurn(liveTurn, query, caseSensitive)
                    : null;

            regex.lastIndex = 0;
            let occIndex = 0;
            let m;
            while ((m = regex.exec(text)) !== null) {
                if (m[0].length === 0) {
                    regex.lastIndex++;
                    continue;
                }

                const liveMatch =
                    liveTurnMatches && occIndex < liveTurnMatches.length
                        ? liveTurnMatches[occIndex]
                        : null;

                matches.push({
                    turnKey: turnRec.key,
                    turnOrder: turnRec.order,
                    turnId: turnRec.turnId,
                    turnTop: turnRec.turnTop,
                    turnElement: liveTurn || turnRec.turnEl || null,
                    matchOffsetInTurn: m.index,
                    matchLength: m[0].length,
                    occurrenceInTurn: occIndex,
                    range: liveMatch ? liveMatch.range : null,
                    marks: null
                });

                occIndex++;
                if (matches.length >= MAX_SEARCH_MATCHES) {
                    truncated = true;
                    return { matches, truncated };
                }
            }
        }

        return { matches, truncated };
    }

    function refreshLiveRangesForMountedTurns() {
        if (!lastExecutedQuery || !lastExecutedQuery.trim() || searchMatches.length === 0) return;

        const matchesByTurn = new Map();
        for (const match of searchMatches) {
            const liveTurn = findLiveTurnElement(match);
            if (!liveTurn || isTurnEmptyPlaceholder(liveTurn)) {
                match.range = null;
                continue;
            }
            match.turnElement = liveTurn;
            if (match.range && match.range.startContainer.isConnected) {
                continue;
            }
            let list = matchesByTurn.get(liveTurn);
            if (!list) {
                list = [];
                matchesByTurn.set(liveTurn, list);
            }
            list.push(match);
        }

        for (const [turnEl, turnMatches] of matchesByTurn) {
            const liveResults = findLiveMatchesInTurn(
                turnEl,
                lastExecutedQuery,
                lastExecutedCaseSensitive
            );
            for (const match of turnMatches) {
                let resolved = null;
                if (match.occurrenceInTurn < liveResults.length) {
                    resolved = liveResults[match.occurrenceInTurn];
                } else if (liveResults.length > 0) {
                    resolved = liveResults.reduce((best, cur) =>
                        Math.abs(cur.offset - match.matchOffsetInTurn) <
                        Math.abs(best.offset - match.matchOffsetInTurn)
                            ? cur
                            : best
                    );
                }
                match.range = resolved ? resolved.range : null;
            }
        }
    }

    function clearFallbackMarks() {
        if (fallbackMarks.length === 0) return;

        isApplyingFallbackMarks = true;
        try {
            const parents = new Set();
            for (const mark of fallbackMarks) {
                const parent = mark.parentNode;
                if (!parent) continue;
                parents.add(parent);
                while (mark.firstChild) {
                    parent.insertBefore(mark.firstChild, mark);
                }
                mark.remove();
            }
            for (const parent of parents) {
                if (parent.isConnected) parent.normalize();
            }
        } finally {
            fallbackMarks = [];
            isApplyingFallbackMarks = false;
        }
    }

    function clearHighlights() {
        if (SUPPORTS_CSS_HIGHLIGHT) {
            CSS.highlights.delete(SEARCH_MATCH_HIGHLIGHT);
            CSS.highlights.delete(SEARCH_ACTIVE_HIGHLIGHT);
        }
        clearFallbackMarks();
    }

    function applyFallbackMarks(matches) {
        const liveMatches = matches.filter((m) => m.range && m.range.startContainer.isConnected);
        if (liveMatches.length === 0) return;

        const slices = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

        for (const match of liveMatches) {
            match.marks = [];
            const { startContainer, startOffset, endContainer, endOffset } = match.range;

            if (startContainer === endContainer) {
                if (startContainer.nodeType === Node.TEXT_NODE && endOffset > startOffset) {
                    slices.push({ node: startContainer, start: startOffset, end: endOffset, match });
                }
                continue;
            }

            walker.currentNode = startContainer;
            let node = startContainer;
            while (node) {
                if (node.nodeType === Node.TEXT_NODE) {
                    const s = node === startContainer ? startOffset : 0;
                    const e = node === endContainer ? endOffset : node.nodeValue.length;
                    if (e > s) {
                        slices.push({ node, start: s, end: e, match });
                    }
                }
                if (node === endContainer) break;
                node = walker.nextNode();
            }
        }

        isApplyingFallbackMarks = true;
        try {
            for (let i = slices.length - 1; i >= 0; i--) {
                const { node, start, end, match } = slices[i];
                if (!node.isConnected || start >= node.nodeValue.length) continue;

                const clampedEnd = Math.min(end, node.nodeValue.length);
                if (clampedEnd <= start) continue;

                let targetNode = node;
                if (start > 0) {
                    targetNode = targetNode.splitText(start);
                }
                if (clampedEnd - start < targetNode.nodeValue.length) {
                    targetNode.splitText(clampedEnd - start);
                }

                const mark = document.createElement('mark');
                mark.setAttribute(SEARCH_MARK_ATTR, 'match');
                targetNode.parentNode.insertBefore(mark, targetNode);
                mark.appendChild(targetNode);

                match.marks.unshift(mark);
                fallbackMarks.push(mark);
            }
        } finally {
            isApplyingFallbackMarks = false;
        }
    }

    function applyVisibleHighlights() {
        clearHighlights();

        if (SUPPORTS_CSS_HIGHLIGHT) {
            const allHighlight = new Highlight();
            allHighlight.priority = 1;
            let hasAny = false;
            for (const match of searchMatches) {
                if (match.range && match.range.startContainer.isConnected) {
                    allHighlight.add(match.range);
                    hasAny = true;
                }
            }
            if (hasAny) {
                CSS.highlights.set(SEARCH_MATCH_HIGHLIGHT, allHighlight);
            }
            updateActiveHighlightOnly();
        } else {
            applyFallbackMarks(searchMatches);
            updateActiveHighlightOnly();
        }
    }

    function updateActiveHighlightOnly() {
        const activeMatch =
            activeMatchIndex >= 0 && activeMatchIndex < searchMatches.length
                ? searchMatches[activeMatchIndex]
                : null;

        if (SUPPORTS_CSS_HIGHLIGHT) {
            if (activeMatch && activeMatch.range && activeMatch.range.startContainer.isConnected) {
                const activeHighlight = new Highlight(activeMatch.range);
                activeHighlight.priority = 2;
                CSS.highlights.set(SEARCH_ACTIVE_HIGHLIGHT, activeHighlight);
            } else {
                CSS.highlights.delete(SEARCH_ACTIVE_HIGHLIGHT);
            }
            return;
        }

        for (const mark of fallbackMarks) {
            mark.setAttribute(SEARCH_MARK_ATTR, 'match');
        }
        if (activeMatch && activeMatch.marks) {
            for (const mark of activeMatch.marks) {
                mark.setAttribute(SEARCH_MARK_ATTR, 'active');
            }
        }
    }

    function clearSearchResults() {
        clearHighlights();
        searchMatches = [];
        searchMatchesTruncated = false;
        activeMatchIndex = -1;
        lastExecutedQuery = '';
        hasExecutedSearch = false;
        updateSearchUI();
    }

    function updateSearchUI() {
        if (!searchCountEl || !searchPrevBtn || !searchNextBtn) return;

        if (!hasExecutedSearch || !lastExecutedQuery.trim()) {
            searchCountEl.textContent = '';
            searchCountEl.classList.remove('is-empty');
        } else {
            const total = searchMatches.length;
            const current = activeMatchIndex >= 0 ? activeMatchIndex + 1 : 0;
            const suffix = searchMatchesTruncated ? '+' : '';
            searchCountEl.textContent = `${current} / ${total}${suffix}`;
            searchCountEl.classList.toggle('is-empty', total === 0);
        }

        const total = searchMatches.length;
        searchPrevBtn.disabled = total === 0 || isScanningChat;
        searchNextBtn.disabled = total === 0 || isScanningChat;
    }

    function getMatchTargetElement(match) {
        if (match.marks && match.marks.length > 0 && match.marks[0].isConnected) {
            return match.marks[0];
        }
        if (!match.range || !match.range.startContainer.isConnected) return null;
        const container = match.range.startContainer;
        return container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
    }

    function getMatchTargetRect(match, fallbackEl) {
        if (match.marks && match.marks.length > 0 && match.marks[0].isConnected) {
            const rect = match.marks[0].getBoundingClientRect();
            if (rect.width > 0 || rect.height > 0) return rect;
        } else if (match.range && match.range.startContainer.isConnected) {
            const rects = match.range.getClientRects();
            for (const r of rects) {
                if (r.width > 0 || r.height > 0) return r;
            }
            const rect = match.range.getBoundingClientRect();
            if (rect.width > 0 || rect.height > 0) return rect;
        }
        return fallbackEl ? fallbackEl.getBoundingClientRect() : null;
    }

    function scrollMatchIntoView(match) {
        const targetEl = getMatchTargetElement(match);
        const rect = getMatchTargetRect(match, targetEl);
        if (!targetEl || !rect) return;

        let virtualTop = rect.top;
        let virtualBottom = rect.bottom;
        let virtualLeft = rect.left;
        let virtualRight = rect.right;
        let centerY = rect.top + rect.height / 2;
        let centerX = rect.left + rect.width / 2;

        const ancestors = [];
        let el = targetEl;
        while (el) {
            ancestors.push(el);
            el = el.parentElement;
        }
        if (document.scrollingElement && !ancestors.includes(document.scrollingElement)) {
            ancestors.push(document.scrollingElement);
        }

        for (const container of ancestors) {
            const canScrollY = isVerticallyScrollable(container);
            const canScrollX = isHorizontallyScrollable(container);
            if (!canScrollY && !canScrollX) continue;

            const isRoot = container === document.scrollingElement;
            const cRect = isRoot
                ? {
                      top: 0,
                      bottom: window.innerHeight,
                      left: 0,
                      right: window.innerWidth,
                      width: window.innerWidth,
                      height: window.innerHeight
                  }
                : container.getBoundingClientRect();

            let nextTop = container.scrollTop;
            let nextLeft = container.scrollLeft;
            let appliedDy = 0;
            let appliedDx = 0;

            if (canScrollY && cRect.height > 0) {
                const padY = Math.min(72, Math.max(16, cRect.height * 0.18));
                const comfortTop = cRect.top + padY;
                const comfortBottom = cRect.bottom - padY;

                if (virtualTop < comfortTop || virtualBottom > comfortBottom) {
                    const dy = centerY - (cRect.top + cRect.height / 2);
                    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
                    nextTop = Math.max(0, Math.min(maxTop, container.scrollTop + dy));
                    appliedDy = nextTop - container.scrollTop;
                }
            }

            if (canScrollX && cRect.width > 0) {
                const padX = Math.min(32, Math.max(8, cRect.width * 0.1));
                const comfortLeft = cRect.left + padX;
                const comfortRight = cRect.right - padX;

                if (virtualLeft < comfortLeft || virtualRight > comfortRight) {
                    const dx = centerX - (cRect.left + cRect.width / 2);
                    const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
                    nextLeft = Math.max(0, Math.min(maxLeft, container.scrollLeft + dx));
                    appliedDx = nextLeft - container.scrollLeft;
                }
            }

            if (Math.abs(appliedDy) >= 1 || Math.abs(appliedDx) >= 1) {
                if (isRoot) {
                    window.scrollTo({ top: nextTop, left: nextLeft, behavior: 'smooth' });
                } else {
                    container.scrollTo({ top: nextTop, left: nextLeft, behavior: 'smooth' });
                }
                virtualTop -= appliedDy;
                virtualBottom -= appliedDy;
                centerY -= appliedDy;
                virtualLeft -= appliedDx;
                virtualRight -= appliedDx;
                centerX -= appliedDx;
            }
        }
    }

    async function waitForTurnToRender(turn, navToken) {
        if (!turn) return false;
        const ok = await waitUntil(() => {
            if (navToken !== currentNavToken) return true;
            return !turn.isConnected || !isTurnEmptyPlaceholder(turn);
        }, 1200, 25);
        if (ok && navToken === currentNavToken) {
            await nextFrame();
            await sleep(40);
        }
        return ok;
    }

    async function ensureMatchMounted(match, navToken) {
        let liveTurn = findLiveTurnElement(match);
        if (liveTurn && !isTurnEmptyPlaceholder(liveTurn) && match.range && match.range.startContainer.isConnected) {
            return liveTurn;
        }

        const scrollContainer = getPrimaryChatScrollContainer();

        // 1. If turn shell is in DOM, bring it directly into scrollContainer's view
        if (liveTurn) {
            if (scrollContainer) {
                const cRect = scrollContainer.getBoundingClientRect();
                const tRect = liveTurn.getBoundingClientRect();
                const targetTop =
                    scrollContainer.scrollTop +
                    (tRect.top - cRect.top) -
                    Math.max(40, cRect.height * 0.25);
                scrollContainer.scrollTo({ top: Math.max(0, targetTop), behavior: 'instant' });
            } else {
                liveTurn.scrollIntoView({ block: 'center', behavior: 'instant' });
            }
            await waitForTurnToRender(liveTurn, navToken);
            if (navToken !== currentNavToken) return null;
            if (liveTurn.isConnected && !isTurnEmptyPlaceholder(liveTurn)) {
                return liveTurn;
            }
        }

        // 2. If turn has a native scrollbar button, click it to jump natively
        if (match.turnId) {
            const navBtn = document.querySelector(
                `ms-prompt-scrollbar button[aria-controls="${CSS.escape(match.turnId)}"], ` +
                    `ms-items-scrollbar button[aria-controls="${CSS.escape(match.turnId)}"]`
            );
            if (navBtn) {
                navBtn.click();
                await sleep(60);
                if (navToken !== currentNavToken) return null;
                liveTurn = findLiveTurnElement(match);
                if (liveTurn) {
                    await waitForTurnToRender(liveTurn, navToken);
                    if (navToken !== currentNavToken) return null;
                    if (!isTurnEmptyPlaceholder(liveTurn)) return liveTurn;
                }
            }
        }

        // 3. Scroll directly to the cached Y offset and nudge if virtual heights shifted
        if (scrollContainer) {
            const approxTop = Math.max(0, match.turnTop - scrollContainer.clientHeight * 0.35);
            scrollContainer.scrollTo({ top: approxTop, behavior: 'instant' });
            await nextFrame();
            await sleep(40);

            for (let attempt = 0; attempt < 12; attempt++) {
                if (navToken !== currentNavToken) return null;

                liveTurn = findLiveTurnElement(match);
                if (liveTurn) {
                    const cRect = scrollContainer.getBoundingClientRect();
                    const tRect = liveTurn.getBoundingClientRect();
                    if (tRect.bottom < cRect.top || tRect.top > cRect.bottom) {
                        const targetTop =
                            scrollContainer.scrollTop +
                            (tRect.top - cRect.top) -
                            Math.max(40, cRect.height * 0.25);
                        scrollContainer.scrollTo({ top: Math.max(0, targetTop), behavior: 'instant' });
                    }
                    await waitForTurnToRender(liveTurn, navToken);
                    if (navToken !== currentNavToken) return null;
                    if (liveTurn.isConnected && !isTurnEmptyPlaceholder(liveTurn)) {
                        return liveTurn;
                    }
                }

                const mounted = Array.from(document.querySelectorAll(SELECTORS.turn));
                const orders = mounted
                    .map((t) => cachedTurnsByKey.get(getExistingTurnKey(t))?.order)
                    .filter((o) => typeof o === 'number');

                if (orders.length > 0 && typeof match.turnOrder === 'number') {
                    const minOrd = Math.min(...orders);
                    const maxOrd = Math.max(...orders);
                    const step = Math.max(250, Math.floor(scrollContainer.clientHeight * 0.65));

                    if (match.turnOrder < minOrd) {
                        scrollContainer.scrollTo({
                            top: Math.max(0, scrollContainer.scrollTop - step),
                            behavior: 'instant'
                        });
                        await sleep(45);
                        continue;
                    }
                    if (match.turnOrder > maxOrd) {
                        scrollContainer.scrollTo({
                            top: Math.min(scrollContainer.scrollHeight, scrollContainer.scrollTop + step),
                            behavior: 'instant'
                        });
                        await sleep(45);
                        continue;
                    }
                }

                // Fallback: match by exact turn text if node lost its ID/key
                const expectedText = cachedTurnsByKey.get(match.turnKey)?.fullText;
                if (expectedText) {
                    for (const t of mounted) {
                        if (!isTurnEmptyPlaceholder(t) && collectTurnText(t).fullText === expectedText) {
                            return t;
                        }
                    }
                }
                break;
            }
        }

        return liveTurn && !isTurnEmptyPlaceholder(liveTurn) ? liveTurn : null;
    }

    async function goToMatch(index) {
        if (searchMatches.length === 0) return;

        const navToken = ++currentNavToken;
        const wrappedIndex = ((index % searchMatches.length) + searchMatches.length) % searchMatches.length;
        activeMatchIndex = wrappedIndex;

        updateSearchUI();

        const match = searchMatches[wrappedIndex];

        // Mount & resolve live range if the match is currently off-screen / virtualized
        if (!match.range || !match.range.startContainer.isConnected) {
            const mountedTurn = await ensureMatchMounted(match, navToken);
            if (navToken !== currentNavToken || !mountedTurn) return;

            match.turnElement = mountedTurn;
            if (!SUPPORTS_CSS_HIGHLIGHT) clearFallbackMarks();
            refreshLiveRangesForMountedTurns();
            applyVisibleHighlights();
        } else {
            if (!SUPPORTS_CSS_HIGHLIGHT && fallbackMarks.length === 0) {
                applyVisibleHighlights();
            } else {
                updateActiveHighlightOnly();
            }
        }

        if (navToken !== currentNavToken) return;

        const targetEl = getMatchTargetElement(match);
        if (!targetEl) return;

        const panel = targetEl.closest('mat-expansion-panel');
        const header = panel ? panel.querySelector(':scope > mat-expansion-panel-header') : null;
        if (header && header.getAttribute('aria-expanded') === 'false') {
            header.click();
            await waitUntil(() => {
                if (navToken !== currentNavToken) return true;
                if (header.getAttribute('aria-expanded') !== 'true') return false;
                const r = getMatchTargetRect(match, targetEl);
                return Boolean(r && (r.width > 0 || r.height > 0));
            }, 600, 30);
            if (navToken !== currentNavToken) return;
            await sleep(220);
            if (navToken !== currentNavToken) return;
        }

        scrollMatchIntoView(match);
    }

    function jumpToNextMatch() {
        if (searchMatches.length === 0) return;
        const nextIndex = activeMatchIndex < 0 ? 0 : activeMatchIndex + 1;
        goToMatch(nextIndex);
    }

    function jumpToPrevMatch() {
        if (searchMatches.length === 0) return;
        const prevIndex = activeMatchIndex < 0 ? searchMatches.length - 1 : activeMatchIndex - 1;
        goToMatch(prevIndex);
    }

    async function runSearch({ jump = true, jumpToLast = false } = {}) {
        const query = searchInput ? searchInput.value : '';
        lastSearchQuery = query;

        clearHighlights();

        if (!query || !query.trim()) {
            clearSearchResults();
            return;
        }

        const scanToken = ++currentScanToken;
        lastExecutedQuery = query;
        lastExecutedCaseSensitive = searchCaseSensitive;
        hasExecutedSearch = true;

        const scrollContainer = getPrimaryChatScrollContainer();
        let savedScrollTopBeforeScan = null;

        if (scrollContainer && needsFullVirtualScan(scrollContainer)) {
            searchPrevBtn.disabled = true;
            searchNextBtn.disabled = true;
            savedScrollTopBeforeScan = await scanEntireChat(scrollContainer, scanToken);
            if (scanToken !== currentScanToken || !isSearchOpen) return;
        } else {
            syncMountedTurnsIntoCache(scrollContainer);
            lastScrollbarCount = document.querySelectorAll(SELECTORS.scrollbarButtons).length;
            lastDomTurnCount = document.querySelectorAll(SELECTORS.turn).length;
        }

        const { matches, truncated } = findMatchesFromTurnList(
            cachedTurnList,
            query,
            searchCaseSensitive
        );

        searchMatches = matches;
        searchMatchesTruncated = truncated;

        if (matches.length === 0) {
            activeMatchIndex = -1;
            if (scrollContainer && savedScrollTopBeforeScan !== null) {
                scrollContainer.scrollTo({ top: savedScrollTopBeforeScan, behavior: 'instant' });
            }
            updateSearchUI();
            return;
        }

        const targetIndex = jumpToLast ? matches.length - 1 : 0;
        activeMatchIndex = jump || jumpToLast ? targetIndex : -1;

        applyVisibleHighlights();
        updateSearchUI();

        if ((jump || jumpToLast) && activeMatchIndex >= 0) {
            await goToMatch(activeMatchIndex);
        }
    }

    // =========================================================================
    // Observers & Init
    // =========================================================================

    const mainObserver = new MutationObserver(() => {
        // 1. Inject "Delete from here" into chat turn menu overlay
        if (!isDeleting && lastClickedTurn) {
            const menu = document.querySelector(SELECTORS.menuContent);
            if (menu && !document.getElementById(MENU_BTN_ID)) {
                const nativeDeleteBtn = findNativeDeleteButton(menu);
                if (nativeDeleteBtn) {
                    const customBtn = createDeleteFromHereButton(nativeDeleteBtn);
                    nativeDeleteBtn.after(customBtn);
                }
            }
        }

        // 2. Keep "Search text" + "Go to top" synced when navigating or if toolbar re-mounts
        const pathChanged = window.location.pathname !== lastPathname;
        if (pathChanged) {
            const prevPathname = lastPathname;
            lastPathname = window.location.pathname;
            if (!prevPathname.endsWith('/new_chat')) {
                invalidateChatCache(true);
                if (isSearchOpen) closeSearchPanel();
            } else {
                invalidateChatCache(false);
            }
        }

        const searchBtn = document.getElementById(SEARCH_BTN_ID);
        const goTopBtn = document.getElementById(GO_TOP_BTN_ID);
        if (
            pathChanged ||
            !searchBtn ||
            !searchBtn.isConnected ||
            !goTopBtn ||
            !goTopBtn.isConnected ||
            !observedToolbar ||
            !observedToolbar.isConnected
        ) {
            scheduleToolbarSync();
        }
    });

    function init() {
        ensureToolbarButtons();
        mainObserver.observe(document.body, { childList: true, subtree: true });
        window.addEventListener('popstate', () => {
            invalidateChatCache(true);
            if (isSearchOpen) closeSearchPanel();
            scheduleToolbarSync();
        });
        window.addEventListener('resize', () => {
            if (isSearchOpen) positionSearchPanel();
        });
    }

    if (document.body) {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();