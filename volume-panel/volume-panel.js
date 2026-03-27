// Script que se inyecta en TODAS las pestañas para mostrar el panel de control PiP
// Dependency: requires ui-visibility-listener.js to define window.__pipUIVisible for proper nav button visibility sync.

(function () {
    'use strict';
    const log = PiPLogger.create('Panel');

    if (window.__PIP_PANEL_LOADED__) {
        log.warn('Script re-injected. Performing defensive cleanup of previous instance.');
        if (typeof window._pipHideEverything === 'function') {
            try { window._pipHideEverything(); } catch (e) { }
        }
    }
    window.__PIP_PANEL_LOADED__ = true;

    log.info('Control panel script loaded.');

    const STATE = {
        controlPanel: null,
        toggleButton: null,
        isPanelVisible: false,
        isPipActive: false,
        slider: null, // Cached DOM reference
        isUserDraggingVolume: false,
        lastVolumeSent: 0,
        isProgrammaticVolumeUpdate: false,
        currentMuteState: false,
        _ignoreMuteResetUntil: 0,
        preMuteVolume: 100,
        isNavExpanded: true,
        pipState: {}, // Local cache of global PiP state
        isSelectorMode: false,
        isLive: false,
        isHovering: false,
        pendingState: null,
        pipUtilsRetryInterval: null,
        _panelDims: null,
        _destroyed: false,
        sync: {
            onLike: null,
            onFav: null,
            onPlayback: null
        }
    };

    const targetDoc = (window.documentPictureInPicture && window.documentPictureInPicture.window) ? window.documentPictureInPicture.window.document : document;

    const UTILS = {
        dispatchSync: (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail })),

        setupToggleHover: (btn, isActive, icons, getHoverState, setHoverState, updateStyle) => {
            if (btn._pipHoverEnter) btn.removeEventListener('mouseenter', btn._pipHoverEnter);
            if (btn._pipHoverLeave) btn.removeEventListener('mouseleave', btn._pipHoverLeave);

            const onEnter = () => {
                setHoverState(true);
                btn.innerHTML = '';
                btn.appendChild(window.PiPVolumePanelUI.createSVG(isActive() ? icons.broken : icons.base));
                updateStyle();
                btn.style.transform = "translateY(-1px) scale(1.05)";
                btn.style.color = "#ffffff";
            };
            const onLeave = () => {
                setHoverState(false);
                updateStyle();
            };

            btn.addEventListener('mouseenter', onEnter);
            btn.addEventListener('mouseleave', onLeave);
            btn._pipHoverEnter = onEnter;
            btn._pipHoverLeave = onLeave;
        },

        sendMsg: (msg, cb) => {
            if (window.PiPUtils?.safeSendMessage) {
                window.PiPUtils.safeSendMessage(msg, cb);
            } else {
                try {
                    const runtime = (window.chrome && chrome.runtime) ? chrome.runtime : (window.browser && browser.runtime ? browser.runtime : null);
                    if (runtime && runtime.sendMessage) {
                        runtime.sendMessage(msg, (res) => { if (typeof cb === 'function') cb(res); });
                    } else if (typeof cb === 'function') {
                        cb();
                    }
                } catch (e) {
                    log.warn('sendMessage failed', e);
                    if (typeof cb === 'function') cb();
                }
            }
        }
    };

    // Centralized nav-visibility check (was duplicated 3 times with slightly different variable names)
    function canShowNavButtons(stateObj) {
        const s = stateObj || STATE.pipState || {};
        const isGlobalHidden = s.uiVisible === false;
        const isOriginHidden = s.originDomain && s.domainExceptions && s.domainExceptions[s.originDomain] === false;
        return STATE.isNavExpanded && !isGlobalHidden && !isOriginHidden;
    }

    const Handlers = {
        PANEL_PING: (msg, resp) => {
            resp({ alive: true, panelActive: true });
        },

        SHOW_VOLUME_PANEL: (msg, resp) => {
            const state = msg.state || {};
            // Trust the calculated visibility from background if present
            const isVisible = msg.sessionVisible !== undefined ? msg.sessionVisible : (state.uiVisible !== false);

            if (!isVisible) {
                destroyUI();
                return resp({ success: true, ignored: true, reason: 'ui_hidden' });
            }

            STATE._destroyed = false;
            showToggleButton(state);
            resp({ success: true });
        },


        HIDE_VOLUME_PANEL: (msg, resp) => {
            destroyUI();
            resp({ success: true });
        },

        SYNC_SESSION_VISIBILITY: (msg, resp) => {
            const state = msg.state || {};
            const isVisible = msg.visible !== undefined ? msg.visible : (state.uiVisible !== false);

            if (!isVisible) {
                hidePanel();
                return resp({ success: true, overridden: true, reason: 'ui_hidden' });
            }

            showToggleButton(state);
            resp({ success: true });
        },

        UPDATE_MUTE_STATE: (msg, resp) => {
            STATE.currentMuteState = Boolean(msg.muted);
            const slider = STATE.slider;

            if (slider) {
                const inGraceWindow = Date.now() < STATE._ignoreMuteResetUntil;
                if (!inGraceWindow) {
                    if (STATE.currentMuteState) {
                        const val = parseFloat(slider.value);
                        if (val > 0) STATE.preMuteVolume = val;
                        STATE.isProgrammaticVolumeUpdate = true;
                        slider.value = 0;
                        slider.setAttribute('aria-valuenow', '0');
                        STATE.isProgrammaticVolumeUpdate = false;
                        STATE.lastVolumeSent = 0;
                        updateMuteButton(true, 0);
                    } else {
                        const val = parseFloat(slider.value);
                        const restoreVol = val > 0 ? val : STATE.preMuteVolume;
                        STATE.isProgrammaticVolumeUpdate = true;
                        slider.value = restoreVol;
                        slider.setAttribute('aria-valuenow', restoreVol);
                        STATE.isProgrammaticVolumeUpdate = false;
                        STATE.lastVolumeSent = Number(restoreVol);
                        updateMuteButton(false, restoreVol);
                    }
                }
            } else {
                updateMuteButton(msg.muted, 100);
            }
            resp({ success: true });
        },

        SYNC_VOLUME_UI: (msg, resp) => {
            const slider = STATE.slider;
            if (slider && msg.volume !== undefined && !STATE.isUserDraggingVolume && Math.abs(parseFloat(slider.value) - msg.volume) >= 1) {
                STATE.isProgrammaticVolumeUpdate = true;
                slider.value = msg.volume;
                slider.setAttribute('aria-valuenow', msg.volume);
                STATE.isProgrammaticVolumeUpdate = false;
                STATE.lastVolumeSent = Number(msg.volume);
            }

            if (msg.muted !== undefined) {
                STATE.currentMuteState = Boolean(msg.muted);
                const inGraceWindow = Date.now() < STATE._ignoreMuteResetUntil;
                if (STATE.currentMuteState) {
                    if (slider && !STATE.isUserDraggingVolume && !inGraceWindow) {
                        const cv = parseFloat(slider.value);
                        if (cv > 0) STATE.preMuteVolume = cv;
                        STATE.isProgrammaticVolumeUpdate = true;
                        slider.value = 0;
                        slider.setAttribute('aria-valuenow', '0');
                        STATE.isProgrammaticVolumeUpdate = false;
                        STATE.lastVolumeSent = 0;
                    }
                    if (!inGraceWindow) updateMuteButton(true, 0);
                } else {
                    let targetVol = STATE.preMuteVolume;
                    if (msg.volume !== undefined && msg.volume > 0) {
                        targetVol = msg.volume;
                        STATE.preMuteVolume = targetVol;
                    }
                    updateMuteButton(false, slider ? parseFloat(slider.value) : targetVol);
                }
            } else if (msg.volume !== undefined) {
                updateMuteButton(STATE.currentMuteState, msg.volume);
            }
            resp({ success: true });
        },

        SYNC_LIKE_UI: (m, r) => { UTILS.dispatchSync("pip-like-sync", { liked: m.liked }); r({ success: true }); },
        SYNC_FAVORITE_UI: (m, r) => { UTILS.dispatchSync("pip-favorite-sync", { favorited: m.favorited }); r({ success: true }); },
        SYNC_PLAYBACK_UI: (m, r) => { UTILS.dispatchSync("pip-playback-sync", { playing: m.playing }); r({ success: true }); },

        SYNC_TIKTOK_LIVE_UI: (msg, resp) => {
            const isTikTokLive = !!msg.isTikTokLive;
            const hasFavorite = msg.hasFavorite !== false;
            const hideFav = isTikTokLive || !hasFavorite;
            const hideSeek = isTikTokLive;

            // Toggle favorites button visibility
            const likeBtn = targetDoc.getElementById('globalPipNavContainer_like');
            const favBtn = targetDoc.getElementById('globalPipNavContainer_favorite');
            if (likeBtn) likeBtn.style.display = isTikTokLive ? 'none' : 'flex';
            if (favBtn) favBtn.style.display = hideFav ? 'none' : 'flex';

            // Toggle seek buttons and separator visibility
            const seekRow = targetDoc.getElementById('pipSeekButtonsRow');
            const seekSep = targetDoc.getElementById('pipSeekSeparator');
            if (seekRow) seekRow.style.display = hideSeek ? 'none' : 'flex';
            if (seekSep) seekSep.style.display = hideSeek ? 'none' : 'block';

            // Update cached state
            if (STATE.pipState) {
                STATE.pipState.isTikTokLive = isTikTokLive;
                STATE.pipState.hasFavorite = hasFavorite;
            }

            resp({ success: true });
        },

        SYNC_NAV_EXPANDED: (msg, resp) => {
            STATE.isNavExpanded = msg.expanded;
            const btn = targetDoc.getElementById("pipNavCollapseBtn");
            const wrapper = targetDoc.getElementById("pipNavButtonsWrapper");
            if (btn) window.PiPVolumePanelUI.updateNavCollapse(btn, STATE.isNavExpanded);
            if (wrapper) {
                const canShow = canShowNavButtons();

                if (canShow) {
                    wrapper.style.display = "flex";
                    void wrapper.offsetWidth; // Force layout to prevent thrashing
                    wrapper.style.opacity = "1";
                } else {
                    wrapper.style.opacity = "0";
                    setTimeout(() => {
                        if (!canShowNavButtons()) wrapper.style.display = "none";
                    }, 300);
                }
            }
            resp({ success: true });
        },

        SYNC_PIP_STATE: (msg, resp) => {
            if (msg.state) STATE.pipState = msg.state;
            resp({ success: true });
        }
    };

    const _onRuntimeMessage = (message, sender, sendResponse) => {
        const { MSG } = window.PIP_CONSTANTS;
        if (Handlers[message.type]) {
            Handlers[message.type](message, sendResponse);
        } else {
            // Background-only messages or unknown
            const ignored = [
                MSG.TOGGLE_MUTE_VIDEO, MSG.LIKE_VIDEO, MSG.FAVORITE_VIDEO, 
                MSG.NAVIGATE_VIDEO, MSG.CHANGE_VOLUME, MSG.SEEK_VIDEO, 
                MSG.VALIDATE_PIP_STATUS, MSG.PIP_SESSION_STARTED, 
                MSG.SHOW_GLOBAL_PIP_BTN, MSG.EXIT_PIP, MSG.START_SELECTION_MODE, 
                MSG.SYNC_PIP_STATE, MSG.STOP_SELECTION_MODE, MSG.VISIBILITY_PING
            ];
            if (ignored.includes(message.type)) {
                sendResponse({ success: true });
            } else {
                sendResponse({ ignored: true });
            }
        }
    };

    const _runtime = (window.chrome && chrome.runtime) ? chrome.runtime : ((window.browser && browser.runtime) ? browser.runtime : null);
    if (_runtime && _runtime.onMessage) {
        if (window._pipMsgHandler) {
            try { _runtime.onMessage.removeListener(window._pipMsgHandler); } catch (e) { }
        }
        if (!window.__pipPanelRegistered__) {
            _runtime.onMessage.addListener(_onRuntimeMessage);
            window._pipMsgHandler = _onRuntimeMessage;
            window.__pipPanelRegistered__ = true;
        }
    }

    // Expose cleanup globally for re-injection defense
    window._pipHideEverything = selfDestruct;

    function createToggleButton() {
        if (STATE.toggleButton) return STATE.toggleButton;
        if (STATE._destroyed) return null;

        if (!window.PiPUtils) {
            log.warn('PiPUtils not ready. Retrying...');
            let tries = 0;
            if (STATE.pipUtilsRetryInterval) clearInterval(STATE.pipUtilsRetryInterval);
            STATE.pipUtilsRetryInterval = setInterval(() => {
                if (STATE._destroyed || window.PiPUtils || ++tries > 20) {
                    clearInterval(STATE.pipUtilsRetryInterval);
                    STATE.pipUtilsRetryInterval = null;
                    if (STATE._destroyed) return;

                    if (window.PiPUtils && STATE.toggleButton?.getAttribute('data-pip-fallback') === 'true') {
                        window.PiPVolumePanelUI.cleanupElement(STATE.toggleButton);
                        STATE.toggleButton.remove();
                        STATE.toggleButton = null;
                    }

                    const btn = window.PiPUtils ? createToggleButton() : createBasicToggleButtonFallback();
                    if (btn && STATE.pendingState) {
                        showToggleButton(STATE.pendingState);
                        STATE.pendingState = null;
                    }
                }
            }, 250);
            return null;
        }

        const onDragMove = () => {
            if (STATE.isPanelVisible && STATE.controlPanel) updatePanelPosition();
            updateNavPosition();
        };

        STATE.toggleButton = window.PiPVolumePanelUI.createToggleButton(() => {
            STATE.isPanelVisible ? hidePanel() : showPanel();
        }, targetDoc, false);

        window.PiPVolumePanelLayout.setupButtonDrag(STATE.toggleButton, onDragMove, onDragMove);
        STATE._destroyed = false;
        STATE.toggleButton.setAttribute('data-original-display', 'flex');

        let _moRaf = false;
        const observer = new MutationObserver(() => {
            if (_moRaf) return;
            _moRaf = true;
            requestAnimationFrame(() => { _moRaf = false; onDragMove(); });
        });
        observer.observe(STATE.toggleButton, { attributes: true, attributeFilter: ['style', 'class'] });
        STATE.toggleButton._observer = observer;

        return STATE.toggleButton;
    }

    function createBasicToggleButtonFallback() {
        if (STATE.toggleButton) return STATE.toggleButton;
        const onClick = () => STATE.isPanelVisible ? hidePanel() : showPanel();
        STATE.toggleButton = window.PiPVolumePanelUI.createToggleButton(onClick, targetDoc, true);
        STATE.toggleButton._pipClickHandler = onClick;
        targetDoc.body.appendChild(STATE.toggleButton);
        STATE._destroyed = false;
        return STATE.toggleButton;
    }



    function createControlPanel() {
        if (STATE.controlPanel && targetDoc.body.contains(STATE.controlPanel)) return STATE.controlPanel;

        const ui = window.PiPVolumePanelUI.createControlPanelHost(targetDoc);
        STATE.controlPanel = ui.panel;
        STATE.controlPanel.setAttribute('data-original-display', 'flex');

        const stop = () => window.PiPVolumePanelLayout.stopAutoHide();
        const start = () => { if (!STATE.isHovering) window.PiPVolumePanelLayout.startAutoHide(hidePanel); };

        STATE.controlPanel.addEventListener('mouseenter', () => { STATE.isHovering = true; stop(); });
        STATE.controlPanel.addEventListener('mouseleave', () => { STATE.isHovering = false; start(); });

        const volGroup = window.PiPVolumePanelUI.buildVolumeGroup(targetDoc);
        const { volumeContainer, volumeSlider: slider, muteBtn } = volGroup;
        STATE.slider = slider; // Cache DOM reference

        // Throttle for real-time volume relay during drag (no save/log, just audio feedback)
        let _volThrottleTimer = null;
        let _pendingVolume = null;

        slider.addEventListener('input', () => {
            if (STATE.isProgrammaticVolumeUpdate) return;
            const volume = parseFloat(slider.value);
            slider.setAttribute('aria-valuenow', volume);

            if (volume > 0 && STATE.currentMuteState) {
                STATE.currentMuteState = false;
                STATE._ignoreMuteResetUntil = Date.now() + 600;
            }
            updateMuteButton(STATE.currentMuteState, volume);

            // Throttled live relay: updates audio in real-time, max once every 100ms
            _pendingVolume = volume;
            if (!_volThrottleTimer) {
                _volThrottleTimer = setTimeout(() => {
                    if (_pendingVolume !== null) {
                        UTILS.sendMsg({ type: 'SET_VOLUME_LIVE', volume: _pendingVolume });
                        _pendingVolume = null;
                    }
                    _volThrottleTimer = null;
                }, 100);
            }
            start();
        });

        slider.addEventListener('wheel', (e) => {
            e.preventDefault(); e.stopPropagation();
            const cur = Number(slider.value);
            const next = Math.min(100, Math.max(0, cur + (e.deltaY < 0 ? 5 : -5)));
            if (next === cur || Math.abs(next - STATE.lastVolumeSent) < 1) return;

            STATE.isProgrammaticVolumeUpdate = true;
            slider.value = next;
            STATE.isProgrammaticVolumeUpdate = false;

            UTILS.sendMsg({ type: 'SET_VOLUME', volume: next });
            STATE.lastVolumeSent = next;
            updateMuteButton(false, next);
            start();
        }, { passive: false });

        slider.addEventListener('pointerdown', () => { STATE.isUserDraggingVolume = true; stop(); });
        slider.addEventListener('pointerup', () => { STATE.isUserDraggingVolume = false; start(); });
        slider.addEventListener('pointercancel', () => { STATE.isUserDraggingVolume = false; start(); });
        slider.addEventListener('change', () => {
            STATE.isUserDraggingVolume = false;
            // Cancel any pending throttled live relay
            if (_volThrottleTimer) { clearTimeout(_volThrottleTimer); _volThrottleTimer = null; }
            _pendingVolume = null;

            if (!STATE.isProgrammaticVolumeUpdate) {
                const volume = parseFloat(slider.value);
                if (Math.abs(volume - STATE.lastVolumeSent) >= 1) {
                    UTILS.sendMsg({ type: "SET_VOLUME", volume });
                    STATE.lastVolumeSent = volume;
                }
            }
            start();
        });

        STATE.controlPanel.appendChild(volumeContainer);
        STATE.controlPanel.appendChild(window.PiPVolumePanelUI.createSeparator(targetDoc));

        updateMuteButton(STATE.currentMuteState);
        muteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.PiPVolumePanelLayout.animateClick(muteBtn);
            UTILS.sendMsg({ type: 'TOGGLE_MUTE' });
        });
        STATE.controlPanel.appendChild(muteBtn);

        const isTikTokLive = !!STATE.pipState?.isTikTokLive;
        const isTikTok = STATE.pipState?.platform === 'tiktok';
        // For TikTok: always create seek section (so it can be toggled), but hide if live.
        // For other platforms: only create if not selector mode and not live.
        const shouldCreateSeek = isTikTok
            ? !STATE.isSelectorMode
            : (!STATE.isSelectorMode && !isTikTokLive && !STATE.isLive);

        if (shouldCreateSeek) {
            const seekSep = window.PiPVolumePanelUI.createSeparator(targetDoc);
            seekSep.id = 'pipSeekSeparator';
            if (isTikTok && (isTikTokLive || STATE.isLive)) seekSep.style.display = 'none';
            STATE.controlPanel.appendChild(seekSep);

            const seekFeedback = window.PiPVolumePanelUI.buildHUD(targetDoc);
            seekFeedback.id = "pipSeekFeedback";
            const content = targetDoc.createElement('div');
            content.style.position = 'relative';
            STATE.controlPanel.appendChild(content);
            content.appendChild(seekFeedback);

            let accumulatedSeek = 0;
            let feedbackTimer = null;
            const showSeekFeedback = (offset) => {
                accumulatedSeek += offset;
                if (feedbackTimer) clearTimeout(feedbackTimer);
                const isForward = accumulatedSeek > 0;
                const sign = isForward ? "+" : "";
                const color = isForward ? "#4ade80" : "#f43f5e";
                const glow = isForward ? "0 0 12px rgba(74, 222, 128, 0.4)" : "0 0 12px rgba(244, 63, 142, 0.4)";
                window.PiPVolumePanelLayout.showHudMessage(seekFeedback, `${sign}${accumulatedSeek}s`, color, glow);
                feedbackTimer = setTimeout(() => { accumulatedSeek = 0; feedbackTimer = null; }, 1300);
            };

            const rewindBtn = window.PiPVolumePanelUI.buildSeekBtn(targetDoc, window.PiPVolumePanelUI.ICONS.arrowLeft, "Rewind 10s");
            const forwardBtn = window.PiPVolumePanelUI.buildSeekBtn(targetDoc, window.PiPVolumePanelUI.ICONS.arrowRight, "Forward 10s");

            const attachSeek = (btn, offset) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation(); start();
                    window.PiPVolumePanelLayout.animateClick(btn);
                    showSeekFeedback(offset);
                    UTILS.sendMsg({ type: 'SEEK_VIDEO', offset });
                });
            };
            attachSeek(rewindBtn, -10);
            attachSeek(forwardBtn, 10);

            const buttonsRow = targetDoc.createElement("div");
            buttonsRow.id = "pipSeekButtonsRow";
            const seekDisplay = (isTikTok && (isTikTokLive || STATE.isLive)) ? 'none' : 'flex';
            buttonsRow.style.cssText = `display: ${seekDisplay}; flex-direction: column; gap: 8px; justify-content: center; width: 100%; margin-top: 5px; align-items: center;`;
            buttonsRow.appendChild(rewindBtn);
            buttonsRow.appendChild(forwardBtn);
            STATE.controlPanel.appendChild(buttonsRow);
        }

        window.PiPVolumePanelUI.injectSliderStyles(targetDoc);
        targetDoc.body.appendChild(STATE.controlPanel);
        return STATE.controlPanel;
    }

    function updatePanelPosition() {
        window.PiPVolumePanelLayout.updatePanelPosition(STATE.controlPanel, STATE.toggleButton, targetDoc);
    }

    function updateNavPosition() {
        const nav = targetDoc.getElementById("globalPipNavContainer");
        window.PiPVolumePanelLayout.updateNavPosition(nav, STATE.toggleButton, targetDoc);
    }

    function showToggleButton(state = {}) {
        STATE._destroyed = false;
        STATE.pipState = state;
        STATE.isPipActive = true;
        if (!STATE.toggleButton && !createToggleButton()) {
            STATE.pendingState = { ...state };
            return;
        }

        const hasVolume = typeof state.volume === 'number';
        const isMuted = Boolean(state.muted);
        if (STATE.slider && hasVolume) {
            if (isMuted && state.volume > 0) STATE.preMuteVolume = state.volume;
            const displayVolume = isMuted ? 0 : state.volume;

            STATE.isProgrammaticVolumeUpdate = true;
            STATE.slider.value = displayVolume;
            STATE.slider.setAttribute('aria-valuenow', displayVolume);
            STATE.isProgrammaticVolumeUpdate = false;

            STATE.lastVolumeSent = Number(displayVolume);
        }
        STATE.currentMuteState = isMuted;
        updateMuteButton(isMuted, hasVolume ? state.volume : 100);

        STATE.isSelectorMode = state.pipMode === "manual" || !!state.isSelectorMode;
        STATE.isLive = !!state.isLive;
        const isTikTokLive = !!state.isTikTokLive;
        const isTikTok = state.platform === 'tiktok';

        const seekRow = targetDoc.getElementById("pipSeekButtonsRow");
        const separators = targetDoc.querySelectorAll('.pip-separator');
        if (STATE.isSelectorMode || (isTikTok && isTikTokLive)) {
            if (seekRow) seekRow.style.display = "none";
            separators.forEach(s => s.style.display = 'none');
        } else {
            if (seekRow) seekRow.style.display = "flex";
            separators.forEach(s => s.style.display = 'block');
        }

        if (state.navExpanded !== undefined) STATE.isNavExpanded = state.navExpanded;

        const effectiveVisibility = state.sessionVisible ?? state.uiVisible ?? true;
        if (STATE.toggleButton) {
            window.PiPVolumePanelLayout.setVisibility(STATE.toggleButton, effectiveVisibility);
            STATE.toggleButton.setAttribute('aria-expanded', effectiveVisibility ? String(STATE.isPanelVisible) : 'false');
        }

        const navContainerId = "globalPipNavContainer";
        let navContainer = targetDoc.getElementById(navContainerId);
        const currentPlatform = state.platform || 'unknown';
        const currentIsShorts = !!state.isShorts;
        const currentSupportsNav = !!state.supportsNavigation;
        const needsRebuild = navContainer && (
            navContainer.getAttribute('data-platform') !== currentPlatform ||
            navContainer.getAttribute('data-is-shorts') !== String(currentIsShorts) ||
            navContainer.getAttribute('data-supports-nav') !== String(currentSupportsNav)
        );

        if (needsRebuild) {
            cleanupNavSyncListeners();
            window.PiPVolumePanelUI.cleanupElement(navContainer);
            navContainer.remove();
            navContainer = null;
        }

        const supportedPlatforms = ['tiktok', 'youtube', 'twitch', 'instagram'];
        if (!supportedPlatforms.includes(currentPlatform) || STATE.isSelectorMode) {
            if (navContainer) {
                cleanupNavSyncListeners();
                window.PiPVolumePanelUI.cleanupElement(navContainer);
                navContainer.remove();
            }
        } else {
            const isTikTokLive = !!state.isTikTokLive;
            let navUi = null;

            if (!navContainer) {
                navUi = window.PiPVolumePanelUI.buildNavGroup(targetDoc, currentIsShorts);
                navContainer = navUi.container;
                navContainer.setAttribute('data-platform', currentPlatform);
                navContainer.setAttribute('data-is-shorts', String(currentIsShorts));
                navContainer.setAttribute('data-supports-nav', String(currentSupportsNav));
                navContainer.setAttribute('data-original-display', 'flex');

                const arcBtn = navUi.toggleNavBtn;
                const buttonsWrapper = navUi.wrapper;
                window.PiPVolumePanelUI.updateNavCollapse(arcBtn, STATE.isNavExpanded);

                arcBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    STATE.isNavExpanded = !STATE.isNavExpanded;
                    window.PiPVolumePanelUI.updateNavCollapse(arcBtn, STATE.isNavExpanded);

                    if (buttonsWrapper) {
                        const canShow = canShowNavButtons();

                        if (canShow) {
                            buttonsWrapper.style.display = "flex";
                            void buttonsWrapper.offsetWidth; // Force layout
                            buttonsWrapper.style.opacity = "1";
                        } else {
                            buttonsWrapper.style.opacity = "0";
                            setTimeout(() => {
                                if (!canShowNavButtons()) buttonsWrapper.style.display = "none";
                            }, 300);
                        }
                    }
                    UTILS.sendMsg({ type: 'SET_NAV_EXPANDED', expanded: STATE.isNavExpanded });
                });

                buttonsWrapper.style.display = STATE.isNavExpanded ? 'flex' : 'none';
                buttonsWrapper.style.opacity = STATE.isNavExpanded ? '1' : '0';

                const attachNavClick = (btn, direction) => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation(); window.PiPVolumePanelLayout.startAutoHide(hidePanel);
                        window.PiPVolumePanelLayout.animateClick(btn);
                        UTILS.sendMsg({ type: 'NAVIGATE_VIDEO', direction });
                    });
                };
                attachNavClick(navUi.prevBtn, 'prev');
                if (navUi.nextBtn) attachNavClick(navUi.nextBtn, 'next');

                let isLiked = !!state.liked;
                let isLikeHovering = false;
                const likeBtn = navUi.likeBtn;
                const updateLikeStyle = () => window.PiPVolumePanelUI.updateLikeStatus(likeBtn, isLiked, isLikeHovering);
                updateLikeStyle();

                STATE.sync.onLike = (e) => { if (e.detail?.liked !== undefined) { isLiked = e.detail.liked; updateLikeStyle(); } };
                document.addEventListener('pip-like-sync', STATE.sync.onLike);

                UTILS.setupToggleHover(likeBtn, () => isLiked, { base: window.PiPVolumePanelUI.ICONS.likeBase, broken: window.PiPVolumePanelUI.ICONS.likeBroken }, () => isLikeHovering, (v) => isLikeHovering = v, updateLikeStyle);
                likeBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); window.PiPVolumePanelLayout.startAutoHide(hidePanel); isLiked = !isLiked; isLikeHovering = false; updateLikeStyle();
                    window.PiPVolumePanelLayout.animateClick(likeBtn, () => {
                        if (likeBtn.matches(':hover')) {
                            isLikeHovering = true; likeBtn.innerHTML = '';
                            likeBtn.appendChild(window.PiPVolumePanelUI.createSVG(isLiked ? window.PiPVolumePanelUI.ICONS.likeBroken : window.PiPVolumePanelUI.ICONS.likeBase));
                        }
                    });
                    UTILS.sendMsg({ type: 'TOGGLE_LIKE', liked: isLiked });
                });

                const favBtn = navUi.favBtn;
                let isFavorited = !!state.favorited;
                let isFavHovering = false;
                const updateFavStyle = () => window.PiPVolumePanelUI.updateFavoriteStatus(favBtn, isFavorited, isFavHovering);
                updateFavStyle();

                STATE.sync.onFav = (e) => { if (e.detail?.favorited !== undefined) { isFavorited = e.detail.favorited; updateFavStyle(); } };
                document.addEventListener('pip-favorite-sync', STATE.sync.onFav);

                UTILS.setupToggleHover(favBtn, () => isFavorited, { base: window.PiPVolumePanelUI.ICONS.favoriteBase, broken: window.PiPVolumePanelUI.ICONS.favoriteBroken }, () => isFavHovering, (v) => isFavHovering = v, updateFavStyle);
                favBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); window.PiPVolumePanelLayout.startAutoHide(hidePanel); isFavorited = !isFavorited; isFavHovering = false; updateFavStyle();
                    window.PiPVolumePanelLayout.animateClick(favBtn, () => {
                        if (favBtn.matches(':hover')) {
                            isFavHovering = true; favBtn.innerHTML = '';
                            favBtn.appendChild(window.PiPVolumePanelUI.createSVG(isFavorited ? window.PiPVolumePanelUI.ICONS.favoriteBroken : window.PiPVolumePanelUI.ICONS.favoriteBase));
                        }
                    });
                    UTILS.sendMsg({ type: 'TOGGLE_FAVORITE', favorited: isFavorited });
                });

                const playPauseBtn = navUi.playPauseBtn;
                let isPlaying = state.playing ?? true;
                window.PiPVolumePanelUI.updatePlayPauseStatus(playPauseBtn, isPlaying);

                STATE.sync.onPlayback = (e) => { if (e.detail?.playing !== undefined) { isPlaying = e.detail.playing; window.PiPVolumePanelUI.updatePlayPauseStatus(playPauseBtn, isPlaying); } };
                document.addEventListener('pip-playback-sync', STATE.sync.onPlayback);

                playPauseBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); window.PiPVolumePanelLayout.startAutoHide(hidePanel);
                    isPlaying = !isPlaying;
                    window.PiPVolumePanelUI.updatePlayPauseStatus(playPauseBtn, isPlaying);
                    window.PiPVolumePanelLayout.animateClick(playPauseBtn);
                    UTILS.sendMsg({ type: 'TOGGLE_PLAY', playing: isPlaying });
                });

                if (!currentSupportsNav) {
                    navUi.prevBtn.remove();
                    navUi.nextBtn?.remove();
                }
                if (STATE.isSelectorMode) playPauseBtn.remove();
                
                // TikTok dynamic controls: use display:none so they can be restored later.
                // Other platforms continue using .remove() for simplicity if they don't need restoration.
                if (currentPlatform === 'tiktok') {
                    const hideLike = isTikTokLive;
                    const hideFav = isTikTokLive || state.hasFavorite === false;
                    likeBtn.style.display = hideLike ? 'none' : 'flex';
                    favBtn.style.display = hideFav ? 'none' : 'flex';
                } else {
                    if (state.platform === 'twitch') likeBtn.remove();
                    if (state.platform !== 'instagram') favBtn.remove();
                }

                targetDoc.body.appendChild(navContainer);
                requestAnimationFrame(() => updateNavPosition());
            } else {
                // Nav container already exists - update visual state
                const arcBtn = navContainer.querySelector("#pipNavCollapseBtn");
                if (arcBtn) window.PiPVolumePanelUI.updateNavCollapse(arcBtn, STATE.isNavExpanded);

                const buttonsWrapper = navContainer.querySelector("#pipNavButtonsWrapper");
                if (buttonsWrapper) {
                    const canShow = canShowNavButtons();

                    buttonsWrapper.style.display = canShow ? 'flex' : 'none';
                    buttonsWrapper.style.opacity = canShow ? '1' : '0';
                }

                // TikTok: sync dynamic button visibility from current state
                if (state.platform === 'tiktok') {
                    const ttLive = !!state.isTikTokLive;
                    const hasFav = state.hasFavorite !== false;
                    const hideFav = ttLive || !hasFav;
                    
                    const existingLike = navContainer.querySelector('#globalPipNavContainer_like');
                    if (existingLike) existingLike.style.display = ttLive ? 'none' : 'flex';

                    const existingFav = navContainer.querySelector('#globalPipNavContainer_favorite');
                    if (existingFav) existingFav.style.display = hideFav ? 'none' : 'flex';

                    // Note: Seek visibility is handled at the top of showToggleButton now.
                }

                // Sync other UI states
                UTILS.dispatchSync("pip-like-sync", { liked: !!state.liked });
                UTILS.dispatchSync("pip-favorite-sync", { favorited: !!state.favorited });
                UTILS.dispatchSync("pip-playback-sync", { playing: state.playing ?? true });
            }
        }

        if (state.uiVisible !== undefined) {
            [STATE.toggleButton, STATE.controlPanel, targetDoc.getElementById("globalPipNavContainer")].forEach(el => window.PiPVolumePanelLayout.setVisibility(el, state.uiVisible));
        }

        window.PiPVolumePanelLayout.setupViewportListener(() => {
            if (STATE.isPanelVisible && STATE.controlPanel) updatePanelPosition();
            updateNavPosition();
        });
    }

    function showPanel() {
        if (!STATE.controlPanel) createControlPanel();
        STATE.isPanelVisible = true;
        if (STATE.toggleButton) STATE.toggleButton.setAttribute('aria-expanded', 'true');

        Object.assign(STATE.controlPanel.style, { opacity: '0', display: 'flex', visibility: 'visible', pointerEvents: 'none', transition: 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)' });
        window.PiPVolumePanelLayout.startAutoHide(hidePanel);

        const originalTransform = STATE.toggleButton?.style.transform;
        if (STATE.toggleButton) STATE.toggleButton.style.transform = 'none';

        UTILS.sendMsg({ type: "GET_PIP_STATE" }, (res) => {
            if (!res?.state) return;
            const { volume, muted } = res.state;
            if (typeof volume === "number" && STATE.slider) {
                if (muted && volume > 0) STATE.preMuteVolume = volume;
                const displayVolume = muted ? 0 : volume;

                STATE.isProgrammaticVolumeUpdate = true;
                STATE.slider.value = displayVolume;
                STATE.slider.setAttribute('aria-valuenow', displayVolume);
                STATE.isProgrammaticVolumeUpdate = false;
            }
            if (typeof muted === "boolean") { STATE.currentMuteState = muted; updateMuteButton(muted, typeof volume === "number" ? volume : 100); }
        });

        requestAnimationFrame(() => {
            updatePanelPosition();
            STATE.controlPanel.style.opacity = '1';
            STATE.controlPanel.style.pointerEvents = 'all';
            const interactive = STATE.controlPanel.querySelector('button, [role="slider"], [tabindex="0"]');
            if (interactive) interactive.focus();
            if (STATE.toggleButton && originalTransform && originalTransform !== 'none') STATE.toggleButton.style.transform = originalTransform;
        });
    }

    function hidePanel() {
        if (!STATE.controlPanel || !STATE.isPanelVisible) return;
        if (STATE.toggleButton) STATE.toggleButton.focus();
        window.PiPVolumePanelLayout.stopAutoHide();
        STATE.isPanelVisible = false;
        if (STATE.toggleButton) STATE.toggleButton.setAttribute('aria-expanded', 'false');
        Object.assign(STATE.controlPanel.style, { transition: 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), visibility 0s linear 0.3s', opacity: '0', pointerEvents: 'none' });
        requestAnimationFrame(() => { STATE.controlPanel.style.visibility = 'hidden'; });
    }

    function destroyUI() {
        STATE._destroyed = true;
        STATE.isPipActive = false;
        STATE.isPanelVisible = false;

        window.PiPVolumePanelLayout.cleanup();
        if (STATE.pipUtilsRetryInterval) { clearInterval(STATE.pipUtilsRetryInterval); STATE.pipUtilsRetryInterval = null; }

        if (STATE.toggleButton) {
            window.PiPVolumePanelUI.cleanupElement(STATE.toggleButton);
            STATE.toggleButton.remove();
            STATE.toggleButton = null;
        }

        if (STATE.controlPanel) {
            window.PiPVolumePanelUI.cleanupElement(STATE.controlPanel);
            STATE.controlPanel.remove();
            STATE.controlPanel = null;
        }

        STATE.slider = null;

        const nav = targetDoc.getElementById("globalPipNavContainer");
        if (nav) {
            cleanupNavSyncListeners();
            window.PiPVolumePanelUI.cleanupElement(nav);
            nav.remove();
        }

        const injectedStyle = targetDoc.getElementById("globalPipSliderStyle");
        if (injectedStyle) injectedStyle.remove();

        STATE.pendingState = null;
    }

    function selfDestruct() {
        destroyUI();
        if (window._pipMsgHandler && _runtime && _runtime.onMessage) {
            try { _runtime.onMessage.removeListener(_onRuntimeMessage); } catch (e) { }
        }

        window._pipMsgHandler = null;
        window.__PIP_PANEL_LOADED__ = false;
        window.__pipPanelRegistered__ = false;
    }

    function cleanupNavSyncListeners() {
        if (STATE.sync.onLike) { document.removeEventListener('pip-like-sync', STATE.sync.onLike); STATE.sync.onLike = null; }
        if (STATE.sync.onFav) { document.removeEventListener('pip-favorite-sync', STATE.sync.onFav); STATE.sync.onFav = null; }
        if (STATE.sync.onPlayback) { document.removeEventListener('pip-playback-sync', STATE.sync.onPlayback); STATE.sync.onPlayback = null; }
    }

    function updateMuteButton(muted, volume = 100) {
        const muteBtn = targetDoc.getElementById('globalPipMute');
        window.PiPVolumePanelUI.updateMuteButton(muteBtn, muted, volume);
    }

    // ── bfcache restoration handler ──
    document.addEventListener('UNIP_BFCACHE_RESTORED', (e) => {
        const state = e.detail?.state;
        if (!state) return;

        // Ensure UI is updated correctly after restoration
        if (state.active) {
            showToggleButton(state);
        } else {
            destroyUI();
        }
    });

})();