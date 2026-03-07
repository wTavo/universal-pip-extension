window.netflixAPI = (() => {
    // Robust Netflix Player Discovery
    const getPlayer = () => {
        try {
            // Path 1: Modern Netflix (Cadmium / AppContext)
            if (window.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer) {
                const videoPlayer = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
                const sessionId = videoPlayer.getAllPlayerSessionIds().find(id => videoPlayer.getVideoPlayerBySessionId(id));
                return videoPlayer.getVideoPlayerBySessionId(sessionId);
            }

            // Path 2: Legacy / Alternative
            const app = window.netflix?.appContext?.state?.playerApp;
            if (app?.getAPI) return app.getAPI().videoPlayer;

        } catch (e) {
            console.warn('[Netflix PiP API] Discovery error:', e);
        }
        return null;
    };

    return {
        seek: (offsetSeconds) => {
            const player = getPlayer();
            if (player) {
                const currentTime = player.getCurrentTime();
                const dest = currentTime + (offsetSeconds * 1000); // ms
                player.seek(dest);
                // Seek successful
            } else {
                console.error('[Netflix PiP API] Player NOT found. Seek aborted.');
            }
        }
    };
})();

// Listen for commands from Content Script
window.addEventListener('message', (event) => {
    // Security check: only accept from self
    if (event.source !== window || !event.data || event.data.type !== 'NETFLIX_PIP_SEEK_COMMAND') return;

    try {
        window.netflixAPI.seek(event.data.offset);
    } catch (e) {
        console.error('[Netflix PiP API] Seek execution failed:', e);
    }
});

// Bridge loaded silently
