(function () {
    'use strict';
    const log = PiPLogger.create('Netflix');

    // --- UI Listeners and state handled by PiPFloatingButton manager ---
    let currentVideo = null;

    // Inject internal script for Netflix API access (Bypasses CSP)
    function injectNetflixAPI() {
        if (document.getElementById('netflix-pip-api-injection')) return;

        const script = document.createElement('script');
        script.id = 'netflix-pip-api-injection';
        script.src = chrome.runtime.getURL('platforms/netflix/netflix-api-bridge.js');
        (document.head || document.documentElement).appendChild(script);
        log.info('API Bridge injected.');
    }

    // Inject immediately
    injectNetflixAPI();

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
        const pipBtn = document.getElementById("netflixPipBtn");

        if (!video) {
            showErrorFeedback(pipBtn, "No se encontró ningún video activo");
            return;
        }

        currentVideo = video;
        monitorVolumeChanges(video);
        const isActive = window.PiPFloatingButton?.isActive?.();

        if (!isActive) {
            try {
                video.muted = false;

                // Prevención de pausas y restauración de estado
                let lastHiddenTime = 0;
                let userIntendedPause = video.paused;

                // Ventanas de inmunidad (Symmetric Immunity)
                let ignorePausesUntil = 0; // Protege el estado PLAY
                let enforcePauseUntil = 0; // Protege el estado PAUSE

                document.addEventListener('visibilitychange', () => {
                    if (document.hidden) {
                        lastHiddenTime = Date.now();
                    } else {
                        // Al volver a la pestaña (visible)
                        // CONFIANZA TOTAL EN EL ESTADO ACTUAL:
                        // Si el video está pausado ahora mismo, es porque así le dio el usuario (o el script).
                        // Si está reproduciendo, es porque así está.

                        if (video.paused) {
                            // Caso 1: Está pausado. Queremos que SIGA pausado.
                            log.info('State is PAUSED. Enforcing pause immunity.');
                            userIntendedPause = true;
                            enforcePauseUntil = Date.now() + 500;
                            // Ejecutar un pause extra por si acaso
                            video.pause();
                        } else {
                            // Caso 2: Está reproduciendo. Queremos que SIGA reproduciendo.
                            log.info('State is PLAYING. Enforcing play immunity.');
                            userIntendedPause = false;
                            ignorePausesUntil = Date.now() + 500;
                        }
                    }
                });

                const handlePause = () => {
                    if (!pipActive) return;

                    // INMUNIDAD PLAY: Si estamos protegiendo el Play, bloquear pausas
                    if (Date.now() < ignorePausesUntil) {
                        log.info('Blocking auto-pause (Play Immunity)');
                        video.play().catch(() => { });
                        return;
                    }

                    // Si está oculto y ocurre justo después de ocultarse (auto-pausa del navegador)
                    if (document.hidden) {
                        const timeSinceHidden = Date.now() - lastHiddenTime;
                        if (timeSinceHidden < 500) {
                            log.info('Auto-pause prevented (tab hidden detected)');
                            video.play().catch(() => { });
                            return;
                        }
                    }

                    // Si llegamos aquí, es una pausa manual
                    userIntendedPause = true;
                    log.info('Manual pause detected');
                };

                const handlePlay = () => {
                    // INMUNIDAD PAUSE: Si estamos protegiendo el Pause, bloquear plays
                    if (Date.now() < enforcePauseUntil) {
                        log.info('Blocking auto-play (Pause Immunity)');
                        video.pause();
                        return;
                    }

                    if (document.hidden) {
                        userIntendedPause = false;
                        return;
                    }

                    if (userIntendedPause && !document.hidden) {
                        // Asumimos que es el auto-play al enfocar, no liberamos el flag
                        return;
                    }

                    userIntendedPause = false;
                };

                // Escuchar eventos
                video.addEventListener('pause', handlePause);
                video.addEventListener('play', handlePlay);

                // Activar PiP
                await video.requestPictureInPicture();
                // Icon update handled globally

                // Initialize navigation/invalidation monitor
                const initialUrl = window.location.href;
                const checkInterval = setInterval(() => {
                    const isActive = window.PiPFloatingButton?.isActive?.();
                    if (!isActive) {
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

                    // Case 2: URL changed (SPA navigation)
                    if (window.location.href !== initialUrl) {
                        log.info('URL changed. Exiting PiP.');
                        forcePiPExit(pipBtn);
                        clearInterval(checkInterval);
                        return;
                    }

                    // Case 3: Video became 0x0 (hidden by SPA)
                    const rect = video.getBoundingClientRect();
                    if (rect.width === 0 && rect.height === 0 && !document.pictureInPictureElement) {
                        if (!document.pictureInPictureElement) {
                            log.info('Lost PictureInPictureElement. Resetting state.');
                            forcePiPExit(pipBtn);
                            clearInterval(checkInterval);
                        }
                    }

                }, 1000);

                // Notificar al background que el PiP está activo
                chrome.runtime.sendMessage({
                    type: 'PIP_ACTIVATED',
                    muted: video.muted,
                    playing: !video.paused,
                    platform: 'netflix'
                });

            } catch (error) {
                log.error('Error al activar PiP:', error);
                window.PiPUtils?.showErrorFeedback(pipBtn, `No se pudo activar PiP: ${error.message}`);
            }
        } else {
            forcePiPExit(pipBtn);
        }
    }

    async function forcePiPExit(pipBtn) {
        // Icon update handled globally

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
        // Handled globally
        chrome.runtime.sendMessage({
            type: 'PIP_DEACTIVATED'
        });
    });


    // Seek buffering to prevent glitches
    let seekDebounceTimer = null;
    let pendingSeekOffset = 0;

    // Escuchar comandos del background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        log.debug('Received command:', message.type);

        if (message.type === 'CHANGE_VOLUME') {
            const video = document.querySelector('video');
            if (video) {
                video.volume = message.volume / 100;
                log.debug('Volume changed to:', message.volume);
            }
            sendResponse({ success: true });
        }
        else if (message.type === 'TOGGLE_MUTE_VIDEO') {
            const video = document.querySelector('video');
            if (video) {
                video.muted = message.muted;
                log.debug('Muted:', message.muted);
            }
            sendResponse({ success: true });
        }
        else if (message.type === 'SEEK_VIDEO') {
            const isAdPlaying = () => false;

            if (isAdPlaying()) {
                sendResponse({ success: false, reason: "AD_PLAYING" });
                return;
            }

            // Accumulate offset (Debounce)
            pendingSeekOffset += message.offset;

            if (seekDebounceTimer) clearTimeout(seekDebounceTimer);

            seekDebounceTimer = setTimeout(() => {
                const offset = pendingSeekOffset;
                pendingSeekOffset = 0;
                seekDebounceTimer = null;

                log.debug(`Sending seek command for ${offset}s via Page API`);

                // Dispatch message to Page Script
                window.postMessage({
                    type: 'NETFLIX_PIP_SEEK_COMMAND',
                    offset: offset
                }, '*');

            }, 250);

            sendResponse({ success: true });
        }

        return false; // Respuesta síncrona
    });

    // Flag to protect against background checks during video swap
    let isSwitchingVideo = false;

    // Detectar cuando cambia el video visible en Netflix
    function setupVideoChangeDetection() {
        const observer = new IntersectionObserver((entries) => {
            const isActive = window.PiPFloatingButton?.isActive?.();
            if (!isActive) return;

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

        // Observar videos existentes
        observeVideos();

        // Observar nuevos videos que se agreguen
        const mutationObserver = new MutationObserver(() => {
            observeVideos();
        });

        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Iniciar detección de cambios de video
    setupVideoChangeDetection();

    // --- PiP Button & Selector Ball (via universal manager) ---
    window.PiPFloatingButton?.init({
        id: 'netflixPipBtn',
        text: '',
        storageKey: 'pipBtnPos_Netflix',
        style: {
            background: 'linear-gradient(45deg, #090909ff, #c81111ff)',
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


    // Listen for volume control messages from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'CHANGE_VOLUME') {
            const video = findActiveVideo() || currentVideo || document.querySelector('video');
            if (video) {
                video.volume = message.volume / 100;
                log.debug('Volume changed to:', message.volume);
                sendResponse({ success: true });
            }
        } else if (message.type === 'TOGGLE_MUTE_VIDEO') {
            const video = findActiveVideo() || currentVideo || document.querySelector('video');
            if (video) {
                video.muted = message.muted;
                log.debug('Mute toggled:', message.muted);
                sendResponse({ success: true });
            }
        } else if (message.type === 'PIP_SESSION_STARTED') {
            log.info('PiP session started elsewhere. Pausing playback.');
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
        } else if (message.type === 'VALIDATE_PIP_STATUS') {
            const isActive = !!document.pictureInPictureElement || isSwitchingVideo;
            sendResponse({ success: true, isActive: isActive });
        }
    });

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