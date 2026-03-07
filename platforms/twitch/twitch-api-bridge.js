(() => {
    'use strict';

    const ACTIONS = {
        TOGGLE_PLAY: 'TOGGLE_PLAY',
        CHECK_STATUS: 'CHECK_STATUS'
    };

    // Monitor Playback state
    let lastPlaybackState = null;

    function monitorPlaybackStatus() {
        const video = document.querySelector('video');
        if (!video) return;

        const isPlaying = !video.paused;
        if (isPlaying !== lastPlaybackState) {
            lastPlaybackState = isPlaying;
            document.dispatchEvent(new CustomEvent('Twitch_Playback_State', {
                detail: { playing: isPlaying }
            }));
        }
    }

    // Poll for playback changes
    setInterval(monitorPlaybackStatus, 300);

    // Listen for control events from the content script
    document.addEventListener('Twitch_Control_Event', (e) => {
        const { action } = e.detail || {};
        const video = document.querySelector('video');

        if (!video) return;

        switch (action) {
            case ACTIONS.TOGGLE_PLAY:
                if (video.paused) video.play().catch(() => { });
                else video.pause();
                break;

            case ACTIONS.CHECK_STATUS:
                monitorPlaybackStatus();
                break;
        }
    });

    // Bridge loaded silently
})();
