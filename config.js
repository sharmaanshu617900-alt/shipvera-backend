/**
 * TrustOrder Configuration & Cloud Backend Bridge
 * Connects Frontend Dashboard & Landing Page to Render / Cloud Backend
 */

(function (window) {
    const STORAGE_KEY = 'TRUSTORDER_BACKEND_URL';
    const LEGACY_STORAGE_KEY = 'SHIPVERA_BACKEND_URL';
    const DEFAULT_RENDER_URL = 'https://trustorder-backend.onrender.com';

    /**
     * Resolve the active backend base URL
     * Priority:
     * 1. Explicitly saved URL in localStorage (e.g., user's custom Render URL)
     * 2. If running on Render or any server serving the frontend, use window.location.origin
     * 3. Default fallback: DEFAULT_RENDER_URL
     */
    function getBackendBaseUrl() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
            if (saved && saved.trim()) {
                return saved.trim().replace(/\/+$/, '');
            }
        } catch (e) {
            console.warn('[CONFIG] localStorage not accessible:', e);
        }

        // If running directly on a live web server (e.g. deployed on Render directly or custom domain)
        if (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http')) {
            const host = window.location.hostname;
            // If running on render or a custom domain serving backend & frontend together
            if (host.includes('onrender.com') || (window.location.port === '3000' && host === 'localhost')) {
                return window.location.origin.replace(/\/+$/, '');
            }
        }

        return DEFAULT_RENDER_URL;
    }

    /**
     * Construct absolute API endpoint URL
     * @param {string} endpoint - e.g. '/api/orders'
     * @returns {string} - e.g. 'https://trustorder-backend.onrender.com/api/orders'
     */
    function getApiUrl(endpoint) {
        const base = getBackendBaseUrl();
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
        return `${base}${cleanEndpoint}`;
    }

    /**
     * Set and persist the backend URL
     * @param {string} url - Base URL of Render backend
     */
    function setBackendUrl(url) {
        if (!url || !url.trim()) {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(LEGACY_STORAGE_KEY);
            return DEFAULT_RENDER_URL;
        }
        let clean = url.trim().replace(/\/+$/, '');
        if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
            clean = 'https://' + clean;
        }
        localStorage.setItem(STORAGE_KEY, clean);
        localStorage.setItem(LEGACY_STORAGE_KEY, clean);
        return clean;
    }

    /**
     * Test connection to /api/health
     * @param {string} targetUrl - Optional specific URL to test
     * @returns {Promise<{ ok: boolean, latencyMs: number, data?: any, error?: string }>}
     */
    async function pingBackend(targetUrl) {
        const base = (targetUrl && targetUrl.trim()) ? targetUrl.trim().replace(/\/+$/, '') : getBackendBaseUrl();
        const healthUrl = `${base}/api/health`;
        const start = performance.now();

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout for cold starts

            const res = await fetch(healthUrl, {
                method: 'GET',
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            });
            clearTimeout(timeoutId);

            const latencyMs = Math.round(performance.now() - start);

            if (!res.ok) {
                return {
                    ok: false,
                    latencyMs,
                    error: `Server responded with HTTP ${res.status} ${res.statusText}`
                };
            }

            const data = await res.json();
            return {
                ok: true,
                latencyMs,
                data
            };
        } catch (err) {
            const latencyMs = Math.round(performance.now() - start);
            let errMsg = err.message || 'Network request failed';
            if (err.name === 'AbortError') {
                errMsg = 'Request timed out (Backend might be in Render Cold-Start sleep mode, warming up takes ~30-50s)';
            }
            return {
                ok: false,
                latencyMs,
                error: errMsg
            };
        }
    }

    const configObj = {
        STORAGE_KEY,
        LEGACY_STORAGE_KEY,
        DEFAULT_RENDER_URL,
        getBackendBaseUrl,
        getApiUrl,
        setBackendUrl,
        pingBackend
    };

    // Expose globally under both names for compatibility
    window.TrustOrderConfig = configObj;
    window.ShipveraConfig = configObj;

    // Helper alias
    window.getApiUrl = getApiUrl;

})(window);
