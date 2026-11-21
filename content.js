// AI Studio Helpers: "Delete from here" + "Go to top"
(() => {
    'use strict';

    const MENU_BTN_ID = 'custom-delete-from-here-btn';
    const GO_TOP_BTN_ID = 'custom-go-to-top-btn';
    const GO_TOP_STYLE_ID = 'custom-go-to-top-style';

    // Selectors (update here if Google changes the UI)
    const SELECTORS = {
        // Delete from here
        turn: 'ms-chat-turn',
        turnOptionsBtn: 'ms-chat-turn-options button',
        menuContent: 'div.mat-mdc-menu-content',
        menuItem: 'button[role="menuitem"], button.mat-mdc-menu-item',
        icon: '.material-symbols-outlined, mat-icon',
        backdrop: '.cdk-overlay-backdrop',

        // Go to top
        toolbarRight: 'ms-playground-toolbar .toolbar-right, ms-toolbar .toolbar-right',
        scrollContainer: 'ms-autoscroll-container, .virtual-scroll-container',
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

    let lastClickedTurn = null;
    let isDeleting = false;
    let observedToolbar = null;
    let toolbarSyncQueued = false;
    let lastPathname = window.location.pathname;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const isVisible = (el) => !!el && el.isConnected && el.getClientRects().length > 0;

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
    // Feature 2: Go to top
    // =========================================================================

    function ensureGoToTopStyles() {
        if (document.getElementById(GO_TOP_STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = GO_TOP_STYLE_ID;
        style.textContent = `
            #${GO_TOP_BTN_ID} {
                flex: 0 0 auto;
            }
            #${GO_TOP_BTN_ID} > .ms-button-icon-symbol,
            #${GO_TOP_BTN_ID} .material-symbols-outlined {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                line-height: 1;
                pointer-events: none;
                user-select: none;
            }
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
            #${GO_TOP_BTN_ID}:not([data-cloned-native="1"]):hover {
                background-color: light-dark(rgba(60, 64, 67, 0.05), rgba(255, 255, 255, 0.1));
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function isScrollableElement(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
        const overflowY = getComputedStyle(el).overflowY;
        return (
            (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
            el.scrollHeight > el.clientHeight + 1
        );
    }

    function getChatScrollContainers() {
        const containers = new Set();

        for (const el of document.querySelectorAll(SELECTORS.scrollContainer)) {
            if (isScrollableElement(el)) containers.add(el);
        }

        if (containers.size === 0) {
            const firstTurn = document.querySelector(SELECTORS.turn);
            let el = firstTurn ? firstTurn.parentElement : null;
            while (el && el !== document.documentElement) {
                if (isScrollableElement(el)) {
                    containers.add(el);
                    break;
                }
                el = el.parentElement;
            }
        }

        return Array.from(containers);
    }

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
            if (el.id === GO_TOP_BTN_ID || !isVisible(el)) continue;

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

    function createGoToTopFromNative(refBtn) {
        const btn = refBtn.cloneNode(true);
        btn.id = GO_TOP_BTN_ID;
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
            btn.setAttribute('iconname', 'arrow_upward');
        }
        btn.setAttribute('aria-label', 'Go to top');
        btn.setAttribute('title', 'Go to top');

        const iconEl = btn.querySelector(SELECTORS.icon);
        if (iconEl && !iconEl.querySelector('svg') && iconEl.classList.contains('material-symbols-outlined')) {
            iconEl.textContent = 'arrow_upward'; // Alternative: 'vertical_align_top'
            if (iconEl.hasAttribute('fonticon')) {
                iconEl.setAttribute('fonticon', 'arrow_upward');
            }
        } else {
            const replacement = document.createElement('span');
            replacement.className = 'material-symbols-outlined notranslate ms-button-icon-symbol';
            replacement.setAttribute('aria-hidden', 'true');
            replacement.textContent = 'arrow_upward'; // Alternative: 'vertical_align_top'

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
            scrollToChatTop();
        });

        return btn;
    }

    function createFallbackGoToTopButton() {
        const btn = document.createElement('button');
        btn.id = GO_TOP_BTN_ID;
        btn.type = 'button';
        btn.className = 'mat-mdc-tooltip-trigger ms-button-borderless ms-button-icon';
        btn.setAttribute('ms-button', '');
        btn.setAttribute('variant', 'icon-borderless');
        btn.setAttribute('iconname', 'arrow_upward');
        btn.setAttribute('aria-label', 'Go to top');
        btn.setAttribute('title', 'Go to top');

        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined notranslate ms-button-icon-symbol';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = 'arrow_upward'; // Alternative: 'vertical_align_top'
        btn.appendChild(icon);

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            scrollToChatTop();
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
            if (el.id === GO_TOP_BTN_ID) continue;
            const icon = el.querySelector(SELECTORS.icon);
            if (icon && ANCHOR_ICONS.has(icon.textContent.trim())) {
                matches.push(el);
            }
        }

        let leftmostAnchor = null;
        let leftmostX = Infinity;

        for (const el of matches) {
            if (el.id === GO_TOP_BTN_ID || !isVisible(el)) continue;
            const direct = getDirectChild(toolbarRight, el);
            if (!direct || direct.id === GO_TOP_BTN_ID) continue;

            const x = el.getBoundingClientRect().left;
            if (x < leftmostX) {
                leftmostX = x;
                leftmostAnchor = direct;
            }
        }

        return leftmostAnchor;
    }

    const toolbarObserver = new MutationObserver(() => {
        scheduleGoToTopSync();
    });

    function scheduleGoToTopSync() {
        if (toolbarSyncQueued) return;
        toolbarSyncQueued = true;
        requestAnimationFrame(() => {
            toolbarSyncQueued = false;
            ensureGoToTopButton();
        });
    }

    function ensureGoToTopButton() {
        ensureGoToTopStyles();

        const toolbarRight = findVisibleToolbarRight();
        const existing = document.getElementById(GO_TOP_BTN_ID);

        if (!toolbarRight || !isChatToolbar(toolbarRight)) {
            if (existing) existing.remove();
            if (observedToolbar) {
                toolbarObserver.disconnect();
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
        }

        const refBtn = findNativeIconButton(toolbarRight);
        let btn = existing;

        if (!btn) {
            btn = refBtn ? createGoToTopFromNative(refBtn) : createFallbackGoToTopButton();
        } else if (btn.dataset.clonedNative !== '1' && refBtn) {
            const upgraded = createGoToTopFromNative(refBtn);
            btn.replaceWith(upgraded);
            btn = upgraded;
        }

        const anchor = findToolbarInsertAnchor(toolbarRight);

        const alreadyInPlace = anchor
            ? btn.parentElement === toolbarRight && btn.nextElementSibling === anchor
            : btn.parentElement === toolbarRight && toolbarRight.firstElementChild === btn;

        if (alreadyInPlace) return;

        if (anchor) {
            toolbarRight.insertBefore(btn, anchor);
        } else {
            toolbarRight.prepend(btn);
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

        // 2. Keep "Go to top" synced when navigating or if toolbar re-mounts
        const pathChanged = window.location.pathname !== lastPathname;
        if (pathChanged) lastPathname = window.location.pathname;

        const goTopBtn = document.getElementById(GO_TOP_BTN_ID);
        if (
            pathChanged ||
            !goTopBtn ||
            !goTopBtn.isConnected ||
            !observedToolbar ||
            !observedToolbar.isConnected
        ) {
            scheduleGoToTopSync();
        }
    });

    function init() {
        ensureGoToTopButton();
        mainObserver.observe(document.body, { childList: true, subtree: true });
        window.addEventListener('popstate', scheduleGoToTopSync);
    }

    if (document.body) {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();