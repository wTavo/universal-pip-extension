(function () {
    'use strict';
    const log = PiPLogger.create('Twitch');

    let pipActive = false;
    let currentVideo = null;





    function findActiveVideo() {
        const videos = Array.from(document.querySelectorAll('video'));
        if (videos.length === 0) return null;

        // Sort videos by relevance
        const sortedVideos = videos.sort((a, b) => {
            // Priority 1: Is it playing?
            if (!a.paused && b.paused) return -1;
            if (a.paused && !b.paused) return 1;

            // Priority 2: ReadyState (higher is better)
            if (a.readyState > b.readyState) return -1;
            if (a.readyState < b.readyState) return 1;

            // Priority 3: Is it visible?
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            const visibleA = rectA.width > 0 && rectA.height > 0;
            const visibleB = rectB.width > 0 && rectB.height > 0;
            if (visibleA && !visibleB) return -1;
            if (!visibleA && visibleB) return 1;

            return 0;
        });

        return sortedVideos[0];
    }

    async function togglePiP() {
        const video = findActiveVideo();
        const pipBtn = document.getElementById("twitchPipBtn");

        if (!video) {
            showErrorFeedback(pipBtn, "No se encontró ningún video activo");
            return;
        }

        currentVideo = video;
        monitorVolumeChanges(video);

        if (!pipActive) {
            try {
                // video.muted = false; // Removed to respect user state

                // Prevención INTELIGENTE de pausas
                // Solo prevenir pausa si ocurre INMEDIATAMENTE al ocultar la pestaña (< 500ms)
                let lastHiddenTime = 0;

                document.addEventListener('visibilitychange', () => {
                    if (document.hidden) {
                        lastHiddenTime = Date.now();
                        // Intentar reanudar si se pausó justo al cambiar
                        if (pipActive && video.paused) {
                            video.play().catch(() => { });
                        }
                    }
                });

                const preventAutoPause = () => {
                    // Si el documento está oculto Y la pausa ocurrió hace menos de 500ms del cambio de pestaña
                    if (pipActive && document.hidden && video.paused) {
                        const timeSinceHidden = Date.now() - lastHiddenTime;
                        if (timeSinceHidden < 500) {
                            log.info('Auto-pause prevented (tab hidden detected)');
                            video.play().catch(() => { });
                        }
                    }
                };

                // Escuchar pausa
                video.addEventListener('pause', preventAutoPause);

                // Activar PiP
                await video.requestPictureInPicture();
                pipActive = true;

                if (pipBtn) pipBtn.innerHTML = window.PiPFloatingButton.getActiveIcon();

                // Notificar al background que el PiP está activo
                chrome.runtime.sendMessage({
                    type: 'PIP_ACTIVATED',
                    volume: Math.round(video.volume * 100),
                    muted: video.muted,
                    platform: 'twitch',
                    playing: !video.paused,
                    isLive: !Number.isFinite(video.duration) // Live streams have Infinity duration
                });

                // Request initial state from bridge
                setTimeout(() => {
                    document.dispatchEvent(new CustomEvent('Twitch_Control_Event', {
                        detail: { action: 'CHECK_STATUS' }
                    }));
                }, 200);

                // Initialize navigation/invalidation monitor
                const initialUrl = window.location.href;
                const checkInterval = setInterval(() => {
                    if (!pipActive) {
                        clearInterval(checkInterval);
                        return;
                    }

                    // Case 1: Video element removed from DOM
                    if (!video.isConnected) {
                        log.info('Video element removed from DOM. Exiting PiP.');
                        forcePiPExit(pipBtn);
                        clearInterval(checkInterval);
                        return;
                    }

                    // Case 2: URL changed (Twitch SPA navigation)
                    if (window.location.href !== initialUrl) {
                        log.info('URL changed. Exiting PiP.');
                        forcePiPExit(pipBtn);
                        clearInterval(checkInterval);
                        return;
                    }

                    // Case 3: Video became 0x0
                    const rect = video.getBoundingClientRect();
                    if (rect.width === 0 && rect.height === 0 && !document.pictureInPictureElement) {
                        if (!document.pictureInPictureElement) {
                            log.info('Lost PictureInPictureElement. Resetting state.');
                            forcePiPExit(pipBtn);
                            clearInterval(checkInterval);
                        }
                    }

                }, 1000);

            } catch (error) {
                log.error('Error al activar PiP:', error);
                window.PiPUtils?.showErrorFeedback(pipBtn, `No se pudo activar PiP: ${error.message}`);
            }
        } else {
            forcePiPExit(pipBtn);
        }
    }

    async function forcePiPExit(pipBtn) {
        pipActive = false;
        if (pipBtn) pipBtn.innerHTML = window.PiPFloatingButton.getInactiveIcon();

        if (document.pictureInPictureElement) {
            try {
                await document.exitPictureInPicture();
            } catch (error) {
                log.error('Error exiting PiP:', error);
            }
        }

        chrome.runtime.sendMessage({ type: 'PIP_DEACTIVATED' });
    }

    // Detectar cuando se sale del PiP
    document.addEventListener('leavepictureinpicture', () => {
        pipActive = false;
        const pipBtn = document.getElementById("twitchPipBtn");
        if (pipBtn) pipBtn.innerHTML = window.PiPFloatingButton.getInactiveIcon();

        chrome.runtime.sendMessage({
            type: 'PIP_DEACTIVATED'
        });
    });

    // Seek buffering
    let seekDebounceTimer = null;
    let pendingSeekOffset = 0;

    function isAdPlaying() {
        return !!document.querySelector('[data-a-target="video-ad-label"]') ||
            !!document.querySelector('.video-player__overlay[data-test-selector="ad-banner"]');
    }

    // Monitor ad state
    function startAdMonitor() {
        let lastAdState = false;
        const observer = new MutationObserver(() => {
            const currentAdState = isAdPlaying();
            if (currentAdState !== lastAdState) {
                lastAdState = currentAdState;
                log.info('Ad State Changed:', currentAdState);
                chrome.runtime.sendMessage({
                    type: 'UPDATE_AD_STATE',
                    isAd: currentAdState
                });
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }
    setTimeout(startAdMonitor, 2000);

    // Escuchar comandos del background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'CHANGE_VOLUME') {
            const video = document.pictureInPictureElement || findActiveVideo() || currentVideo;
            if (video) {
                video.volume = message.volume / 100;
            }
            sendResponse({ success: true });
        }
        else if (message.type === 'TOGGLE_MUTE_VIDEO') {
            const video = document.pictureInPictureElement || findActiveVideo() || currentVideo;
            if (video) {
                video.muted = message.muted;
            }
            sendResponse({ success: true });
        }
        else if (message.type === 'SEEK_VIDEO') {
            if (isAdPlaying()) {
                sendResponse({ success: false, reason: "AD_PLAYING" });
                return;
            }

            const video = document.pictureInPictureElement || findActiveVideo() || currentVideo;
            if (video) {
                pendingSeekOffset += message.offset;
                if (seekDebounceTimer) clearTimeout(seekDebounceTimer);
                seekDebounceTimer = setTimeout(() => {
                    if (!video.isConnected) return;
                    if (Number.isFinite(video.duration)) {
                        video.currentTime = Math.max(0, Math.min(video.currentTime + pendingSeekOffset, video.duration));
                    } else {
                        video.currentTime += pendingSeekOffset;
                    }
                    pendingSeekOffset = 0;
                    seekDebounceTimer = null;
                }, 250);
            }
            sendResponse({ success: true });
        }
        else if (message.type === 'PIP_SESSION_STARTED') {
            log.info('PiP session started elsewhere. Pausing all local videos.');
            document.querySelectorAll('video').forEach(v => v.pause());
            sendResponse({ success: true });
        } else if (message.type === 'FOCUS_PIP') {
            const pipVideo = document.pictureInPictureElement;
            if (pipVideo) {
                log.info('Attempting to focus PiP window...');
                document.exitPictureInPicture().then(() => {
                    setTimeout(() => {
                        pipVideo.requestPictureInPicture().catch(err => {
                            log.error('Failed to refocus:', err);
                        });
                    }, 100);
                }).catch(() => { });
            }
            sendResponse({ success: true });
        } else if (message.type === 'EXIT_PIP') {
            if (document.pictureInPictureElement) {
                log.info('Closing PiP window...');
                document.exitPictureInPicture().catch(() => { });
            }
            sendResponse({ success: true });
        }
        else if (message.type === 'VALIDATE_PIP_STATUS') {
            const isActive = !!document.pictureInPictureElement || isSwitchingVideo;
            sendResponse({ success: true, isActive: isActive });
        }
        else if (message.type === 'TOGGLE_PLAY') {
            document.dispatchEvent(new CustomEvent('Twitch_Control_Event', {
                detail: { action: 'TOGGLE_PLAY' }
            }));
            sendResponse({ success: true });
        }
        return false;
    });

    // --- Bridge Injection ---
    function injectBridge() {
        if (document.getElementById('twitch-api-bridge')) return;
        const script = document.createElement('script');
        script.id = 'twitch-api-bridge';
        script.src = chrome.runtime.getURL('platforms/twitch/twitch-api-bridge.js');
        script.onload = function () { this.remove(); };
        (document.head || document.documentElement).appendChild(script);
        log.info('Bridge injected');
    }
    injectBridge();

    // Listen for state updates from the main world bridge script
    document.addEventListener('Twitch_Playback_State', (e) => {
        const { playing } = e.detail || {};
        chrome.runtime.sendMessage({
            type: 'UPDATE_PLAYBACK_STATE',
            playing: !!playing
        }).catch(() => { });
    });

    // --- PiP Button & Selector Ball (via universal manager) ---
    window.PiPFloatingButton?.init({
        id: 'twitchPipBtn',
        text: '',
        storageKey: 'pipBtnPos_Twitch',
        style: {
            background: 'linear-gradient(135deg, #9146FF 0%, #772CE8 100%)',
            zIndex: '2147483647'
        },
        onClick: togglePiP
    });

    // Initialize volume monitoring
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            const video = findActiveVideo();
            if (video) monitorVolumeChanges(video);
        });
    } else {
        const video = findActiveVideo();
        if (video) monitorVolumeChanges(video);
    }





    // Flag to protect against background checks during video swap
    let isSwitchingVideo = false;

    // Detectar cuando cambia el video visible en Twitch
    function setupVideoChangeDetection() {
        const observer = new IntersectionObserver((entries) => {
            if (!pipActive) return;

            entries.forEach(entry => {
                if (entry.isIntersecting && entry.target.tagName === 'VIDEO') {
                    const visibleVideo = entry.target;

                    // Verificar dimensiones para ignorar miniaturas
                    const rect = visibleVideo.getBoundingClientRect();
                    if (rect.width < 300) {
                        return; // Ignorar videos pequeños
                    }

                    // Si el video visible es diferente al que está en PiP
                    if (visibleVideo !== currentVideo && document.pictureInPictureElement) {
                        log.info('Main video changed, updating PiP...');

                        isSwitchingVideo = true; // Protect status

                        // Helper to safely request PiP
                        const safelyRequestPiP = (video) => {
                            video.muted = false;
                            video.requestPictureInPicture().then(() => {
                                log.info('PiP updated to new video');
                                isSwitchingVideo = false; // Reset protection
                                currentVideo = visibleVideo;

                                // Actualizar volumen en el background
                                chrome.runtime.sendMessage({
                                    type: 'SET_VOLUME',
                                    volume: Math.round(visibleVideo.volume * 100)
                                });
                            }).catch(err => {
                                log.error('Failed to update PiP:', err);
                                isSwitchingVideo = false; // Reset on error
                            });
                        };

                        // Direct transfer (Seamless)
                        if (visibleVideo.readyState >= 1) { // HAVE_METADATA
                            safelyRequestPiP(visibleVideo);
                        } else {
                            log.info('New video metadata not loaded. Waiting...');
                            visibleVideo.addEventListener('loadedmetadata', () => {
                                safelyRequestPiP(visibleVideo);
                            }, { once: true });
                        }
                    }
                }
            });
        }, {
            threshold: 0.5 // El video debe estar al menos 50% visible
        });

        // Observar todos los videos
        const observeVideos = () => {
            document.querySelectorAll('video').forEach(video => {
                observer.observe(video);
            });
        };

        observeVideos();

        // Observar nuevos videos
        const mutationObserver = new MutationObserver(() => {
            observeVideos();
        });

        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Iniciar detección
    setupVideoChangeDetection();


    // Monitor volume changes to sync UI
    function monitorVolumeChanges(video) {
        if (!video) return;

        // Update initial state
        chrome.runtime.sendMessage({
            type: 'UPDATE_VOLUME_STATE',
            volume: Math.round(video.volume * 100),
            muted: video.muted
        }).catch(() => { });

        // Remove existing listener if any (to avoid duplicates)
        video.removeEventListener('volumechange', handleVolumeChange);
        video.addEventListener('volumechange', handleVolumeChange);
    }

    function handleVolumeChange(e) {
        const video = e.target;
        chrome.runtime.sendMessage({
            type: 'UPDATE_VOLUME_STATE',
            volume: Math.round(video.volume * 100),
            muted: video.muted
        }).catch(() => { });
    }

})();
