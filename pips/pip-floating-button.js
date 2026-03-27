(function () {
    'use strict';
    const log = typeof PiPLogger !== 'undefined' ? PiPLogger.create('PiPBtn') : { trace() { } };

    if (window.__PIP_FLOATING_BUTTON_LOADED__) return;
    window.__PIP_FLOATING_BUTTON_LOADED__ = true;

    // ---- Shared helpers ----

    /** Fire-and-forget chrome.runtime message — safe against context invalidation. */
    const _send = (type) => { 
        if (window.PiPUtils?.safeSendMessage) {
            const { MSG } = window.PIP_CONSTANTS || {};
            window.PiPUtils.safeSendMessage({ type: MSG?.[type] || type });
        }
    };

    window.PiPFloatingButton = {
        _managedButtons: new Set(),
        _syncInitialized: false,
        _isPipActiveGlobal: false,

        /**
         * Creates and maintains a platform-specific floating PiP button
         * and attaches a selector ball to it.
         *
         * @param {Object} config
         * @param {string}   config.id          - Element ID for the main button
         * @param {string}   config.text        - Initial icon/text (e.g. '')
         * @param {string}   config.storageKey  - localStorage key for position
         * @param {Object}  [config.style]      - Extra CSS for the button
         * @param {Function} config.onClick     - Click handler
         */
        init(config) {
            if (!window.PiPUtils) return;
            const { id, text, storageKey, style = {}, onClick } = config;
            this._managedButtons.add(id);
            this._initGlobalSync();

            const _text = text || this.getInactiveIcon();
            const _title = chrome.i18n.getMessage("pipBtnTitle");
            const _create = () => window.PiPUtils.createFloatingButton({ id, text: _text, title: _title, storageKey, style, onClick });

            // Create the main button (PiPUtils handles drag + position persistence).
            // safeAppendToBody() may defer the append until DOMContentLoaded if body
            // isn't ready yet — poll until the element appears before attaching the ball.
            _create();

            const _onBtnReady = (btn) => {
                this._attachBall(btn);

                // Maintain button in DOM: re-create + re-attach ball if removed.
                // Debounced to avoid thrashing on high-frequency DOM sites (TikTok, YouTube).
                // Lives here in init() so id/_create are always available.
                let _moTimer = null;
                const domObserver = new MutationObserver(() => {
                    if (_moTimer) return;
                    _moTimer = setTimeout(() => {
                        _moTimer = null;
                        if (!document.getElementById(id)) {
                            _create();
                            const newBtn = document.getElementById(id);
                            if (newBtn) this._attachBall(newBtn);
                        }
                    }, 300);
                });
                domObserver.observe(document.documentElement, { childList: true, subtree: true });
                // [Bfcache Fix] Do NOT disconnect on pagehide; let it persist for restoration.
                // MutationObserver will naturally stop firing when page is hidden and resume on pageshow.

            };

            const existing = document.getElementById(id);
            if (existing) { _onBtnReady(existing); return; }

            // Body not ready yet — poll until button appears
            const t = setInterval(() => {
                const b = document.getElementById(id);
                if (b) { clearInterval(t); _onBtnReady(b); }
            }, 50);
            // [Bfcache Fix] Keep polling alive if still searching for body.

        },

        isActive() {
            return this._isPipActiveGlobal || !!document.pictureInPictureElement;
        },

        _initGlobalSync() {
            if (this._syncInitialized) return;
            this._syncInitialized = true;

            const _onMsg = (msg) => {
                const { MSG } = window.PIP_CONSTANTS || {};
                if (msg.type === MSG?.PIP_ACTIVATED || msg.type === MSG?.PIP_SESSION_STARTED) {
                    this._isPipActiveGlobal = true;
                    this._refreshManagedIcons(true);
                } else if (msg.type === MSG?.HIDE_VOLUME_PANEL || msg.type === MSG?.PIP_DEACTIVATED) {
                    this._isPipActiveGlobal = false;
                    this._refreshManagedIcons(false);
                }
            };

            chrome.runtime.onMessage.addListener(_onMsg);

            // Initial sync
            if (window.PiPUtils?.safeSendMessage) {
                const { MSG } = window.PIP_CONSTANTS || {};
                window.PiPUtils.safeSendMessage({ type: MSG?.GET_PIP_STATE || 'GET_PIP_STATE' }, (res) => {
                    if (res?.state?.active) {
                        this._isPipActiveGlobal = true;
                        this._refreshManagedIcons(true);
                    }
                });
            }

            // Visibility sync (compensate for lazy background)
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && window.PiPUtils?.safeSendMessage) {
                    const { MSG } = window.PIP_CONSTANTS || {};
                    window.PiPUtils.safeSendMessage({ type: MSG?.GET_PIP_STATE || 'GET_PIP_STATE' }, (res) => {
                        this._isPipActiveGlobal = !!res?.state?.active;
                        this._refreshManagedIcons(this._isPipActiveGlobal);
                    });
                }
            });
        },

        _refreshManagedIcons(isActive) {
            this._managedButtons.forEach(id => {
                const btn = document.getElementById(id);
                if (!btn) return;

                if (id === 'universalSelectorBtn') {
                    this._updateFallbackState(btn, isActive);
                } else {
                    btn.innerHTML = isActive ? this.getActiveIcon() : this.getInactiveIcon();
                    btn.title = isActive ? chrome.i18n.getMessage("pipBtnExitTitle") : chrome.i18n.getMessage("pipBtnTitle");
                }
            });
        },

        /**
         * Creates and positions the selector ball relative to a parent button.
         * Uses window.PiPSelectorAPI (set by pip-selector-logic.js) for
         * selection-mode integration.
         *
         * @param {HTMLElement} parentBtn - The main floating PiP button
         */
        _attachBall(parentBtn) {
            if (document.getElementById('pipSelectorBall')) return;

            const ball = document.createElement('div');
            ball.id = 'pipSelectorBall';
            ball.title = chrome.i18n.getMessage("pipSelectorTitle");
            ball.innerHTML = `
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                     stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"
                          stroke-dasharray="3 2"></rect>
                    <path d="M12 8v8M8 12h8"></path>
                </svg>
            `;
            ball.style.cssText = `
                position: fixed;
                width: 32px;
                height: 32px;
                background: rgba(0, 0, 0, 0.5);
                backdrop-filter: blur(8px);
                color: white;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                z-index: 2147483647;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                transform: scale(0);
                transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275),
                            opacity 0.2s, background 0.2s;
                opacity: 0;
                pointer-events: none;
                user-select: none;
                border: 1px solid rgba(255, 255, 255, 0.3);
                outline: none;
            `;
            ball.setAttribute('data-pip-ui', 'true');
            document.body.appendChild(ball);

            // ---- Show / hide helpers (used in multiple event handlers below) ----
            const showBall = () => {
                ball.style.opacity = '1';
                ball.style.transform = 'scale(1)';
                ball.style.pointerEvents = 'all';
            };
            const hideBall = () => {
                ball.style.opacity = '0';
                ball.style.transform = 'scale(0)';
                ball.style.pointerEvents = 'none';
            };

            // ---- Position sync (RAF-throttled to avoid layout thrashing on scroll) ----
            let _rafPending = false;
            const syncPosition = () => {
                if (_rafPending) return;
                _rafPending = true;
                requestAnimationFrame(() => {
                    _rafPending = false;
                    if (!ball.isConnected) return;
                    const rect = parentBtn.getBoundingClientRect();
                    ball.style.top = `${rect.top - 20}px`;
                    ball.style.left = `${rect.left + (rect.width / 2) - 16}px`;
                    // position:fixed always has offsetParent===null — check display only.
                    if (parentBtn.style.display === 'none') hideBall();
                });
            };

            const attrObserver = new MutationObserver(syncPosition);
            attrObserver.observe(parentBtn, { attributes: true, attributeFilter: ['style', 'class'] });
            window.addEventListener('scroll', syncPosition, { passive: true, capture: true });
            window.addEventListener('resize', syncPosition, { passive: true });

            // ---- Unified cleanup on pagehide ----
            const onPointerUp = () => {
                setTimeout(() => { if (parentBtn.matches(':hover')) { syncPosition(); showBall(); } }, 50);
            };
            window.addEventListener('pointerup', onPointerUp);
            // [Bfcache Fix] Do NOT disconnect on pagehide; let it persist for restoration.


            // ---- Show when hovering parent ----
            parentBtn.addEventListener('mouseenter', () => { syncPosition(); showBall(); });

            // ---- Hide when neither parent nor ball is hovered (and not selecting) ----
            const tryHide = () => {
                setTimeout(() => {
                    const api = window.PiPSelectorAPI;
                    if (!parentBtn.matches(':hover') && !ball.matches(':hover') && !(api?.isSelecting)) {
                        hideBall();
                    }
                }, 100);
            };
            parentBtn.addEventListener('mouseleave', tryHide);

            // ---- Ball hover styles + hide logic (merged into one mouseleave handler) ----
            ball.addEventListener('mouseenter', () => {
                ball.style.background = 'rgba(0, 0, 0, 0.8)';
                ball.style.transform = 'scale(1.1)';
                ball.style.border = '1px solid rgba(255, 255, 255, 0.8)';
                ball.style.boxShadow = '0 4px 16px rgba(255, 255, 255, 0.2)';
            });
            ball.addEventListener('mouseleave', () => {
                // Reset hover styles immediately
                ball.style.background = 'rgba(0, 0, 0, 0.5)';
                ball.style.border = '1px solid rgba(255, 255, 255, 0.3)';
                ball.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.4)';
                // tryHide decides whether to fully hide after 100ms
                tryHide();
            });

            // ---- Cancel selection if parent button is clicked ----
            parentBtn.addEventListener('click', () => {
                const api = window.PiPSelectorAPI;
                if (api?.isSelecting) { _send('STOP_SELECTION_MODE_GLOBAL'); api.stopSelection(); }
            });

            // ---- Toggle selection mode on ball click ----
            ball.addEventListener('click', (e) => {
                e.stopPropagation();
                const api = window.PiPSelectorAPI;
                if (api?.isSelecting) { api.stopSelection(); } else { _send('ACTIVATE_SELECTION_MODE'); }
            });
        },

        /**
         * Creates the fallback "Universal PiP" button for unsupported domains.
         * Appears in the bottom right corner when a video is present.
         */
        initFallback(config = { storageKey: 'pipBtnPos_Generic' }) {
            this._managedButtons.add('universalSelectorBtn');
            this._initGlobalSync();

            // IFRAME LOGIC: Just notify background if we have video, don't create button
            if (window !== window.top) {
                const checkVids = () => {
                    if (document.querySelector('video')) {
                        _send('VIDEO_DETECTED');
                        return true; // found
                    }
                    return false;
                };

                if (!checkVids()) {
                    let _moTimer = null;
                    const vObs = new MutationObserver(() => {
                        if (_moTimer) return;
                        _moTimer = setTimeout(() => {
                            _moTimer = null;
                            if (checkVids()) vObs.disconnect();
                        }, 2000); // Throttled to 2s to match old intensity but event-driven
                    });
                    vObs.observe(document.documentElement, { childList: true, subtree: true });
                    // [Bfcache Fix] Keep observer alive.

                }
                return;
            }

            // TOP FRAME LOGIC: Create fallback button
            if (document.getElementById('universalSelectorBtn')) return;

            const btn = document.createElement('button');
            btn.id = 'universalSelectorBtn';
            btn.innerHTML = this.getInactiveIcon();
            btn.title = chrome.i18n.getMessage("pipSelectorTitle");
            btn.setAttribute('data-pip-ui', 'true');

            Object.assign(btn.style, {
                position: 'fixed',
                bottom: '25px',
                right: '25px',
                width: '60px',
                height: '60px',
                fontSize: '24px',
                zIndex: '2147483646',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                borderRadius: '50%',
                background: 'rgba(30, 30, 35, 0.5)',
                backdropFilter: 'blur(10px)',
                display: 'none',
                cursor: 'pointer',
                color: 'white',
                opacity: '0.7',
                boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3)',
                outline: 'none',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0',
                userSelect: 'none',
                touchAction: 'none',
                transition: 'box-shadow 0.3s ease, opacity 0.3s ease, transform 0.1s ease'
            });

            btn.addEventListener('mouseenter', () => {
                btn.style.opacity = '1';
                btn.style.boxShadow = '0 0 10px rgba(255, 255, 255, 0.5)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.opacity = '0.7';
                btn.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.3)';
            });

            // PiP active state is stored on btn._pipActive by _updateFallbackState,
            // synced via _initGlobalSync, DOM events, and updateFallbackUI.

            btn.addEventListener('click', () => {
                const api = window.PiPSelectorAPI;
                if (btn._pipActive) {
                    _send('EXIT_PIP');
                    this._updateFallbackState(btn, false);
                } else if (api?.isSelecting) {
                    _send('STOP_SELECTION_MODE_GLOBAL');
                    api.stopSelection();
                    this._updateFallbackState(btn, false);
                } else {
                    _send('ACTIVATE_SELECTION_MODE');
                }
            });

            // Drag support using PiPUtils if available
            if (window.PiPUtils?.makeDraggable) {
                window.PiPUtils.makeDraggable(btn, {
                    onDragEnd: ({ hasMoved }) => {
                        if (hasMoved) {
                            const rect = btn.getBoundingClientRect();
                            const pos = {
                                topPercent: (rect.top / window.innerHeight) * 100,
                                leftPercent: (rect.left / window.innerWidth) * 100
                            };
                            // 1. Local backup
                            localStorage.setItem('global_pip_btn_position', JSON.stringify(pos));
                            // 2. Global save
                            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                                chrome.storage.local.set({ global_pip_btn_position: pos });
                            }
                        }
                    }
                });

                const restorePos = (saved) => {
                    if (saved && typeof saved.topPercent === 'number') {
                        btn.style.top = `${saved.topPercent}%`;
                        btn.style.left = `${saved.leftPercent}%`;
                        btn.style.bottom = 'auto';
                        btn.style.right = 'auto';
                    }
                };

                // Fast local restore
                try {
                    const localSaved = JSON.parse(localStorage.getItem('global_pip_btn_position') || 'null');
                    if (localSaved) restorePos(localSaved);
                } catch (e) { }

                // Global async restore
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.get('global_pip_btn_position', (res) => {
                        if (res && res.global_pip_btn_position) restorePos(res.global_pip_btn_position);
                    });
                }
            }

            window.PiPUtils ? window.PiPUtils.safeAppendToBody(btn) : document.body.appendChild(btn);

            const revealBtn = () => { if (window.__pipUIVisible !== false) btn.style.display = 'flex'; };

            // Observe DOM for video — disconnect once found (no need to keep watching)
            let throttleTimer = null;
            const videoObserver = new MutationObserver(() => {
                if (throttleTimer) return;
                throttleTimer = setTimeout(() => {
                    throttleTimer = null;
                    if (document.querySelector('video')) { revealBtn(); videoObserver.disconnect(); }
                }, 1000);
            });
            videoObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
            // [Bfcache Fix] Keep observer alive.


            if (document.querySelector('video')) revealBtn();

            const onEnterPiP = () => { this._updateFallbackState(btn, true); };
            const onLeavePiP = () => { this._updateFallbackState(btn, false); };
            document.addEventListener('enterpictureinpicture', onEnterPiP);
            document.addEventListener('leavepictureinpicture', onLeavePiP);
            // [Bfcache Fix] Keep PiP events alive.

            window.PiPFloatingButton.updateFallbackUI = (state) => {
                this._updateFallbackState(btn, state);
            };

            // State sync (message listener, initial check, visibilitychange) is
            // handled centrally by _initGlobalSync → _refreshManagedIcons → _updateFallbackState.

            // [Bfcache Fix] CRITICAL: Do NOT remove message listener.
            // If removed, the tab stays dead after bfcache restoration.
            // [Bfcache Fix] Re-sync state when page is restored from memory.
            document.addEventListener('UNIP_BFCACHE_RESTORED', (e) => {
                const state = e.detail?.state;
                if (state?.active) onEnterPiP();
                else onLeavePiP();
            });

            return btn;
        },

        getInactiveIcon() {
            return `
                <svg viewBox="0 0 24 24" width="30" height="30" fill="none" xmlns="http://www.w3.org/2000/svg" style="pointer-events: none;">
                    <style>
                        .pip-outer { stroke: currentColor; stroke-width: 2; rx: 3; fill: rgba(255, 255, 255, 0.05); transition: all 0.3s ease; transform-origin: center; }
                        .pip-inner { fill: currentColor; rx: 2; transition: all 0.4s cubic-bezier(0.2, 1, 0.3, 1); filter: drop-shadow(0 4px 5px rgba(0,0,0,0.4)); transform-origin: center; }
                        button:hover .pip-outer { fill: rgba(255, 255, 255, 0.15); stroke-width: 2.2; }
                        button:hover .pip-inner { transform: translate(1px, 1px) scale(1.1); }
                    </style>
                    <rect class="pip-outer" x="2" y="4" width="20" height="16" />
                    <rect class="pip-inner" x="11" y="11" width="10" height="7" />
                </svg>
            `;
        },

        getActiveIcon() {
            return `
                <svg viewBox="0 0 24 24" width="30" height="30" fill="none" xmlns="http://www.w3.org/2000/svg" style="pointer-events: none;">
                    <style>
                        .pip-outer-active { stroke: currentColor; stroke-width: 2; rx: 3; stroke-dasharray: 4 2; opacity: 0.5; transition: all 0.3s ease; transform-origin: center; }
                        .pip-inner-active { stroke: currentColor; stroke-width: 2; rx: 2; fill: rgba(0,0,0,0.6); transition: all 0.4s cubic-bezier(0.2, 1, 0.3, 1); filter: drop-shadow(0 4px 5px rgba(0,0,0,0.4)); transform-origin: center; }
                        .pip-arrow { stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: all 0.3s ease; transform-origin: center; }
                        button:hover .pip-outer-active { opacity: 0.9; stroke-dashoffset: 6; }
                        button:hover .pip-inner-active { transform: translate(-1px, -1px); fill: rgba(255,255,255,0.15); }
                        button:hover .pip-arrow { transform: translate(-3px, -3px) scale(1.1); stroke: #fff; }
                    </style>
                    <rect class="pip-outer-active" x="2" y="4" width="20" height="16" />
                    <rect class="pip-inner-active" x="13" y="12" width="10" height="8" />
                    <path class="pip-arrow" d="M18 16 L12 10 M12 10 L16 10 M12 10 L12 14" />
                </svg>
            `;
        },

        _updateFallbackState(btn, forceActiveState = null) {
            if (!btn) return;
            const isActive = forceActiveState !== null ? forceActiveState : !!document.pictureInPictureElement;
            btn._pipActive = isActive;
            btn.innerHTML = isActive ? this.getActiveIcon() : this.getInactiveIcon();
            btn.title = isActive ? chrome.i18n.getMessage("pipBtnExitTitle") : chrome.i18n.getMessage("pipSelectorTitle");
            btn.style.background = isActive ? 'rgba(30, 30, 35, 0.9)' : 'rgba(30, 30, 35, 0.7)';
            btn.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.4)';
        }
    };

})();
