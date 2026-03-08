(() => {
    if (window.__TWITCH_PIP_BRIDGE_LOADED__) return;
    window.__TWITCH_PIP_BRIDGE_LOADED__ = true;

    if (!window.BridgeUtils) {
        console.error('[Twitch Bridge] BridgeUtils not found! Aborting.');
        return;
    }

    const { ACTIONS, getActiveVideo, enableAutoSwitching } = window.BridgeUtils;

    // -------- CONSTANTS --------

    const VIDEO_STATE_EVENTS = ['play', 'pause', 'volumechange'];

    // -------- PLAYER HELPERS (Twitch-specific) --------
    function setVolume(video, volume) {
        if (!video) return;
        video.volume = volume / 100;
    }

    function findMuteButton(video) {
        if (!video) return null;
        // The standard player has a mute button with an aria label or data-a-target
        return document.querySelector('[data-a-target="player-mute-unmute-button"]');
    }

    // -------- STATE --------

    let lastBroadcastState = null;
    let monitoredVideo = null;

    const monitorState = () => {
        const video = getActiveVideo();
        if (!video) return;

        const pipActive = !!document.pictureInPictureElement;

        // Only attach/re-attach video event listeners while PiP is active.
        if (pipActive && video !== monitoredVideo) {
            if (monitoredVideo) {
                VIDEO_STATE_EVENTS.forEach(evt => monitoredVideo.removeEventListener(evt, monitorState));
            }

            monitoredVideo = video;
            lastBroadcastState = null; // Force update on video change

            VIDEO_STATE_EVENTS.forEach(evt => video.addEventListener(evt, monitorState));
        }

        const playing = !video.paused;
        const volume = Math.round(video.volume * 100);
        const muted = video.muted;

        // Fast shallow comparison — avoids JSON.stringify overhead
        if (lastBroadcastState &&
            lastBroadcastState.playing === playing &&
            lastBroadcastState.volume === volume &&
            lastBroadcastState.muted === muted) {
            return;
        }

        const state = { playing, volume, muted };
        lastBroadcastState = state;
        document.dispatchEvent(new CustomEvent('Twitch_State_Update', { detail: state }));
    };

    // Reset state when PiP enters so the UI gets a fresh update.
    document.addEventListener('enterpictureinpicture', () => {
        lastBroadcastState = null;
        requestAnimationFrame(monitorState);
    });

    // Clean up when PiP exits: detach video event listeners
    document.addEventListener('leavepictureinpicture', () => {
        if (monitoredVideo) {
            VIDEO_STATE_EVENTS.forEach(
                evt => monitoredVideo.removeEventListener(evt, monitorState)
            );
            monitoredVideo = null;
        }
        lastBroadcastState = null;
    });

    if (enableAutoSwitching) {
        enableAutoSwitching(monitorState);
    }

    // -------- CONTROL EVENTS --------

    document.addEventListener('Twitch_Control_Event', (e) => {
        const { action, value, direction } = e.detail || {};
        const video = getActiveVideo();

        // Twitch specific logic: No TOGGLE_LIKE or NAVIGATE_VIDEO here.

        switch (action) {
            case ACTIONS.TOGGLE_PLAY:
                if (video) video.paused ? video.play() : video.pause();
                break;

            case ACTIONS.PAUSE:
                if (video) video.pause();
                break;

            case ACTIONS.REQUEST_PIP:
                (async () => {
                    const v = getActiveVideo();
                    if (!v) return;
                    try {
                        if (document.pictureInPictureElement === v) {
                            await document.exitPictureInPicture();
                        } else {
                            monitorState();
                            if (v.hasAttribute('disablePictureInPicture')) v.removeAttribute('disablePictureInPicture');
                            await v.requestPictureInPicture();
                        }
                    } catch (e) {
                        // Expected: may fail if video is not eligible for PiP (e.g. DRM, removed from DOM)
                    }
                })();
                break;

            case ACTIONS.EXIT_PIP:
                if (document.pictureInPictureElement) document.exitPictureInPicture();
                break;

            case ACTIONS.FOCUS_PIP: {
                const pipVideo = document.pictureInPictureElement;
                if (!pipVideo) break;
                document.exitPictureInPicture().then(() => {
                    setTimeout(() => pipVideo.requestPictureInPicture().catch(() => { }), 100);
                }).catch(() => { });
                break;
            }

            case ACTIONS.SEEK:
                if (video && Number.isFinite(value)) {
                    let newTime = video.currentTime + value;
                    if (Number.isFinite(video.duration)) {
                        newTime = Math.max(0, Math.min(newTime, video.duration));
                    }
                    video.currentTime = newTime;
                }
                break;

            case ACTIONS.MUTE: {
                const muteBtn = findMuteButton(video);
                if (muteBtn) {
                    if (video && !video.muted) {
                        muteBtn.click();
                    }
                } else if (video) {
                    video.muted = true;
                }
                break;
            }

            case ACTIONS.UNMUTE: {
                const muteBtn = findMuteButton(video);
                if (muteBtn) {
                    if (video && video.muted) {
                        muteBtn.click();
                    }
                } else if (video) {
                    video.muted = false;
                }
                break;
            }

            case ACTIONS.SET_VOLUME:
                if (video && Number.isFinite(value)) {
                    const vol = Math.max(0, Math.min(1, value / 100));
                    if (vol > 0 && video.muted) {
                        const muteBtn = findMuteButton(video);
                        if (muteBtn) {
                            muteBtn.click();
                        } else {
                            video.muted = false;
                        }
                    }
                    setVolume(video, Math.round(vol * 100));
                }
                break;

            case ACTIONS.CHECK_STATUS:
                // Force a fresh scan when UI asks for status
                monitorState();
                break;
        }
    });
})();
