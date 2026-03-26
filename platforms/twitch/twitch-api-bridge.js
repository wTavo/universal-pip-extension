(() => {
    if (window.__TWITCH_PIP_BRIDGE_LOADED__) return;
    window.__TWITCH_PIP_BRIDGE_LOADED__ = true;

    if (!window.BridgeUtils) {
        console.error('[Twitch Bridge] BridgeUtils not found! Aborting.');
        return;
    }

    const { ACTIONS, getActiveVideo, enableAutoSwitching, handleRequestPip, handleFocusPip, handleMuteUnmute, handleSetVolume } = window.BridgeUtils;

    // -------- CONSTANTS --------

    const VIDEO_STATE_EVENTS = ['play', 'pause', 'volumechange'];

    const SELECTORS = {
        MUTE_BTN: '[data-a-target="player-mute-unmute-button"]',
        LIVE_BADGE: '.live-indicator, [data-a-target="player-overlay-live-indicator"]'
    };

    // -------- PLAYER HELPERS (Twitch-specific) --------
    function setVolume(video, volume) {
        if (!video) return;
        video.volume = volume / 100;
    }

    function findMuteButton(video) {
        return document.querySelector(SELECTORS.MUTE_BTN);
    }

    function detectIsLive(video) {
        if (!video) return false;
        const durationIsLive = video.duration === Infinity || !Number.isFinite(video.duration);
        const hasLiveBadge = !!document.querySelector(SELECTORS.LIVE_BADGE);
        return durationIsLive || hasLiveBadge;
    }

    // -------- STATE --------

    let lastBroadcastState = null;
    let monitoredVideo = null;

    const monitorState = () => {
        const video = getActiveVideo();
        if (!video) return;

        const pipActive = !!document.pictureInPictureElement;

        if (pipActive && video !== monitoredVideo) {
            if (monitoredVideo) {
                VIDEO_STATE_EVENTS.forEach(evt => monitoredVideo.removeEventListener(evt, monitorState));
            }
            monitoredVideo = video;
            lastBroadcastState = null;
            VIDEO_STATE_EVENTS.forEach(evt => video.addEventListener(evt, monitorState));
        }

        // Ownership filter
        const currentPiP = document.pictureInPictureElement;
        if (currentPiP && video !== currentPiP) return;

        // Filter: Only ignore 'pause' during navigation to prevent flickering.
        // 'Play' events are ALWAYS trusted as they signal a successful landing.
        const playing = !video.paused;
        const isNavigating = window.BridgeUtils.isNavigating && window.BridgeUtils.isNavigating();
        if (isNavigating && !playing) return;

        const volume = Math.round(video.volume * 100);
        const muted = video.muted;
        const isLive = detectIsLive(video);

        if (lastBroadcastState &&
            lastBroadcastState.playing === playing &&
            lastBroadcastState.volume === volume &&
            lastBroadcastState.muted === muted &&
            lastBroadcastState.isLive === isLive) {
            return;
        }

        const state = { playing, volume, muted, isLive };
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

    function handleTogglePlay(video) {
        if (video) video.paused ? video.play() : video.pause();
    }

    function handleRequestPipLocal() {
        return handleRequestPip({
            getVideo: getActiveVideo,
            preSync: () => monitorState()
        });
    }

    function handleMuteLocal(video, shouldMute) {
        handleMuteUnmute(video, shouldMute, findMuteButton);
    }

    function handleSetVolumeLocal(video, value) {
        handleSetVolume(video, value, setVolume, handleMuteLocal);
    }



    document.addEventListener('Twitch_Control_Event', (e) => {
        const { action, value } = e.detail || {};
        const video = getActiveVideo();

        switch (action) {
            case ACTIONS.TOGGLE_PLAY: handleTogglePlay(video); break;
            case ACTIONS.PAUSE: if (video) video.pause(); break;
            case ACTIONS.REQUEST_PIP: handleRequestPipLocal(); break;
            case ACTIONS.EXIT_PIP: if (document.pictureInPictureElement) document.exitPictureInPicture(); break;
            case ACTIONS.FOCUS_PIP: handleFocusPip(); break;
            case ACTIONS.SEEK:
                if (video && Number.isFinite(value)) {
                    video.currentTime = Math.max(0, Math.min(video.currentTime + value, video.duration || Infinity));
                }
                break;
            case ACTIONS.MUTE: handleMuteLocal(video, true); break;
            case ACTIONS.UNMUTE: handleMuteLocal(video, false); break;
            case ACTIONS.SET_VOLUME: handleSetVolumeLocal(video, value); break;
            case ACTIONS.CHECK_STATUS: monitorState(); break;
        }
    });
})();
