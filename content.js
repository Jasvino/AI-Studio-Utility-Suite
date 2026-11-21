(() => {
    'use strict';

    const MENU_BTN_ID = 'custom-delete-from-here-btn';

    // Selectors (update here if Google changes the UI)
    const SELECTORS = {
        turn: 'ms-chat-turn',
        turnOptionsBtn: 'ms-chat-turn-options button',
        menuContent: 'div.mat-mdc-menu-content',
        menuItem: 'button[role="menuitem"], button.mat-mdc-menu-item',
        icon: '.material-symbols-outlined, mat-icon',
        backdrop: '.cdk-overlay-backdrop'
    };

    let lastClickedTurn = null;
    let isDeleting = false;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

    // 1. Track which chat turn's three-dots button the user clicked
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

    // 2. Watch for the Angular Material menu overlay and inject right below Delete
    const menuObserver = new MutationObserver(() => {
        if (isDeleting || !lastClickedTurn) return;

        const menu = document.querySelector(SELECTORS.menuContent);
        if (!menu || document.getElementById(MENU_BTN_ID)) return;

        const nativeDeleteBtn = findNativeDeleteButton(menu);
        if (!nativeDeleteBtn) return;

        const customBtn = createDeleteFromHereButton(nativeDeleteBtn);
        nativeDeleteBtn.after(customBtn);
    });

    if (document.body) {
        menuObserver.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            menuObserver.observe(document.body, { childList: true, subtree: true });
        });
    }

    // 3. Delete the selected turn and every subsequent turn (bottom-up)
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
})();