/**
 * TrustOrder Institutional Dispatch Controller (v6.0)
 * Ultra-Premium Fintech & Logistics Interface (Zero AI Tropes, Pure High-Trust Architecture)
 */

let selectedPlatform = 'shopify';
let isLoginMode = false;

document.addEventListener('DOMContentLoaded', () => {
    initAmbientSpotlight();
    initPasswordStrengthMeter();
    initAudioStripController();
    parseQueryParams();
    checkExistingSession();
});

function parseQueryParams() {
    try {
        const params = new URLSearchParams(window.location.search);
        const mode = params.get('mode');
        const phone = params.get('phone');
        const email = params.get('email');
        const name = params.get('name');
        const brand = params.get('brand') || params.get('store');

        if (mode === 'login' && !isLoginMode) {
            toggleAuthMode();
        }

        if (phone && document.getElementById('sellerPhone')) {
            const cleanPhone = phone.replace(/[^\d]/g, '').slice(-10);
            document.getElementById('sellerPhone').value = cleanPhone;
        }

        if (email && document.getElementById('sellerEmail')) {
            document.getElementById('sellerEmail').value = email;
        }

        if (name && document.getElementById('sellerName')) {
            document.getElementById('sellerName').value = name;
        }

        if (brand && document.getElementById('brandName')) {
            document.getElementById('brandName').value = brand;
        }

        if (phone || email) {
            const alertBox = document.getElementById('authAlert');
            if (alertBox) {
                alertBox.className = 'auth-alert success';
                alertBox.style.display = 'block';
                alertBox.innerHTML = `✨ <strong>Allocation Reserved:</strong> Details pre-filled. Create your password to finalize your workspace.`;
            }
        }
    } catch (e) {}
}

/* =========================================================
   1. DYNAMIC AMBIENT SPOTLIGHT ON LEFT PANEL
   ========================================================= */

function initAmbientSpotlight() {
    const terminalPanel = document.getElementById('terminalPanel');
    if (!terminalPanel) return;

    window.addEventListener('mousemove', (e) => {
        const rect = terminalPanel.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        terminalPanel.style.setProperty('--mouse-x', `${mouseX}px`);
        terminalPanel.style.setProperty('--mouse-y', `${mouseY}px`);
    });
}

/* =========================================================
   2. ACOUSTIC AUDIO STRIP DEMO CONTROLLER
   ========================================================= */

let isOccAudioPlaying = true;
function toggleOccAudio() {
    isOccAudioPlaying = !isOccAudioPlaying;
    const soundwave = document.getElementById('occSoundwave');
    const playBtn = document.getElementById('occPlayBtn');
    const caption = document.getElementById('occAudioCaption');

    if (soundwave) {
        const bars = soundwave.querySelectorAll('.occ-sw-bar');
        bars.forEach(b => b.style.animationPlayState = isOccAudioPlaying ? 'running' : 'paused');
    }

    if (playBtn) {
        playBtn.style.background = isOccAudioPlaying ? '#059669' : '#334155';
    }

    if (caption) {
        caption.textContent = isOccAudioPlaying 
            ? '▶ "Haan bhaiya, confirm hai, yellow house plot 42..."' 
            : '⏸ Audio Paused • Click to resume natural call';
    }
}

function initAudioStripController() {
    // Default running
    const soundwave = document.getElementById('occSoundwave');
    if (soundwave) {
        const bars = soundwave.querySelectorAll('.occ-sw-bar');
        bars.forEach(b => b.style.animationPlayState = 'running');
    }
}

/* =========================================================
   3. PASSWORD STRENGTH METER (STRIPE / LINEAR STANDARD)
   ========================================================= */

function initPasswordStrengthMeter() {
    const pwdInput = document.getElementById('sellerPassword');
    const b1 = document.getElementById('pmBar1');
    const b2 = document.getElementById('pmBar2');
    const b3 = document.getElementById('pmBar3');
    const b4 = document.getElementById('pmBar4');
    const label = document.getElementById('pmLabel');

    if (!pwdInput || !b1) return;

    pwdInput.addEventListener('input', () => {
        const val = pwdInput.value;
        let score = 0;

        if (val.length >= 6) score++;
        if (val.length >= 8) score++;
        if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
        if (/[0-9]/.test(val) || /[^A-Za-z0-9]/.test(val)) score++;

        [b1, b2, b3, b4].forEach(b => b.style.background = '#E2E8F0');

        if (val.length === 0) {
            label.textContent = 'Min. 6 characters';
            label.style.color = '#94A3B8';
            return;
        }

        if (score === 1) {
            b1.style.background = '#EF4444';
            label.textContent = 'Weak';
            label.style.color = '#EF4444';
        } else if (score === 2) {
            b1.style.background = '#F59E0B';
            b2.style.background = '#F59E0B';
            label.textContent = 'Fair';
            label.style.color = '#F59E0B';
        } else if (score === 3) {
            b1.style.background = '#10B981';
            b2.style.background = '#10B981';
            b3.style.background = '#10B981';
            label.textContent = 'Good';
            label.style.color = '#10B981';
        } else if (score >= 4) {
            b1.style.background = '#059669';
            b2.style.background = '#059669';
            b3.style.background = '#059669';
            b4.style.background = '#059669';
            label.textContent = 'Strong ✓';
            label.style.color = '#059669';
        }
    });
}

/* =========================================================
   4. PLATFORM SETUP & PASSWORD TOGGLE
   ========================================================= */

function selectPlatform(platform) {
    selectedPlatform = platform;
    const btnShopify = document.getElementById('ptShopify');
    const btnReseller = document.getElementById('ptReseller');
    const shopifyWrap = document.getElementById('shopifyDomainWrap');
    const resellerNote = document.getElementById('resellerNote');

    if (platform === 'shopify') {
        btnShopify.classList.add('active');
        btnReseller.classList.remove('active');
        shopifyWrap.style.display = 'block';
        resellerNote.style.display = 'none';
    } else {
        btnReseller.classList.add('active');
        btnShopify.classList.remove('active');
        shopifyWrap.style.display = 'none';
        resellerNote.style.display = 'block';
    }
}

function togglePasswordVisibility() {
    const input = document.getElementById('sellerPassword');
    const eyeOpen = document.getElementById('eyeIconOpen');
    const eyeClosed = document.getElementById('eyeIconClosed');
    if (!input) return;

    if (input.type === 'password') {
        input.type = 'text';
        if (eyeOpen) eyeOpen.style.display = 'none';
        if (eyeClosed) eyeClosed.style.display = 'block';
    } else {
        input.type = 'password';
        if (eyeOpen) eyeOpen.style.display = 'block';
        if (eyeClosed) eyeClosed.style.display = 'none';
    }
}

/* =========================================================
   5. AUTH MODE TOGGLE (REGISTER <-> SIGN IN)
   ========================================================= */

function toggleAuthMode() {
    isLoginMode = !isLoginMode;

    const toggleLink = document.getElementById('authModeToggle');
    const formHeading = document.getElementById('formHeading');
    const formSubheading = document.getElementById('formSubheading');
    const btnText = document.getElementById('btnSubmitText');
    const switchPrompt = document.getElementById('switchPromptText');
    const forgotLink = document.getElementById('forgotLink');
    const dividerText = document.getElementById('dividerText');

    const rowBrandName = document.getElementById('rowBrandName');
    const groupPhone = document.getElementById('groupPhone');
    const groupPlatform = document.getElementById('groupPlatform');
    const pwdMeterWrap = document.getElementById('pwdMeterWrap');

    if (isLoginMode) {
        formHeading.textContent = 'Sign In to Workspace';
        formSubheading.textContent = 'Access your live dispatch console, orders stream, and billing ledger.';
        btnText.textContent = 'Sign In to Workspace →';
        toggleLink.textContent = 'Create Workspace';
        switchPrompt.textContent = "New to TrustOrder?";
        if (dividerText) dividerText.textContent = 'Or sign in with work email';
        if (forgotLink) forgotLink.style.display = 'block';

        if (rowBrandName) rowBrandName.style.display = 'none';
        if (groupPhone) groupPhone.style.display = 'none';
        if (groupPlatform) groupPlatform.style.display = 'none';
        if (pwdMeterWrap) pwdMeterWrap.style.display = 'none';

        if (document.getElementById('brandName')) document.getElementById('brandName').required = false;
        if (document.getElementById('sellerName')) document.getElementById('sellerName').required = false;
        if (document.getElementById('sellerPhone')) document.getElementById('sellerPhone').required = false;
    } else {
        formHeading.textContent = 'Create your seller workspace';
        formSubheading.textContent = 'Pure Pay-As-You-Go billing. No monthly software retainer. Billed strictly ₹6 per verified order.';
        btnText.textContent = 'Create Workspace — ₹0 Upfront →';
        toggleLink.textContent = 'Sign In';
        switchPrompt.textContent = 'Already have a seller account?';
        if (dividerText) dividerText.textContent = 'Or register with work email';
        if (forgotLink) forgotLink.style.display = 'none';

        if (rowBrandName) rowBrandName.style.display = 'grid';
        if (groupPhone) groupPhone.style.display = 'flex';
        if (groupPlatform) groupPlatform.style.display = 'flex';
        if (pwdMeterWrap) pwdMeterWrap.style.display = 'flex';

        if (document.getElementById('brandName')) document.getElementById('brandName').required = true;
        if (document.getElementById('sellerName')) document.getElementById('sellerName').required = true;
        if (document.getElementById('sellerPhone')) document.getElementById('sellerPhone').required = true;
    }
}

/* =========================================================
   6. SUBMIT FORM & MULTI-TENANT BACKEND BRIDGE
   ========================================================= */

async function handleAuthSubmit(event) {
    event.preventDefault();

    const alertBox = document.getElementById('authAlert');
    const btn = document.getElementById('btnSubmitSignup');
    const btnText = document.getElementById('btnSubmitText');

    alertBox.style.display = 'none';
    btn.disabled = true;
    btnText.textContent = isLoginMode ? 'Signing In...' : 'Initializing Workspace...';

    const email = document.getElementById('sellerEmail').value.trim();
    const password = document.getElementById('sellerPassword').value;
    const brandName = document.getElementById('brandName') ? document.getElementById('brandName').value.trim() : '';
    const name = document.getElementById('sellerName') ? document.getElementById('sellerName').value.trim() : '';
    const phone = document.getElementById('sellerPhone') ? document.getElementById('sellerPhone').value.trim() : '';
    const shopifyDomain = document.getElementById('shopifyDomain') ? document.getElementById('shopifyDomain').value.trim() : '';

    const endpoint = isLoginMode ? '/api/auth/login' : '/api/auth/signup';
    const config = window.TrustOrderConfig || window.ShipveraConfig;
    const apiUrl = (config && typeof config.getApiUrl === 'function')
        ? config.getApiUrl(endpoint)
        : endpoint;

    const payload = isLoginMode ? {
        email,
        password
    } : {
        name,
        brand_name: brandName,
        email,
        phone: phone ? `+91${phone.replace(/[^\d]/g, '').slice(-10)}` : '',
        shopify_domain: shopifyDomain,
        password,
        platform_type: selectedPlatform
    };

    try {
        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.ok && data.success && data.seller) {
            alertBox.className = 'auth-alert success';
            alertBox.style.display = 'block';
            alertBox.innerHTML = `<strong>Workspace Ready:</strong> ${data.seller.brand_name}. Entering console...`;

            localStorage.setItem('trustorder_active_seller', JSON.stringify(data.seller));
            localStorage.setItem('trustorder_active_seller_id', data.seller.id);
            localStorage.setItem('shipvera_active_seller', JSON.stringify(data.seller));
            localStorage.setItem('shipvera_active_seller_id', data.seller.id);

            setTimeout(() => {
                window.location.href = `/dashboard?seller_id=${encodeURIComponent(data.seller.id)}`;
            }, 750);

        } else {
            alertBox.className = 'auth-alert error';
            alertBox.style.display = 'block';
            alertBox.textContent = data.error || 'Authentication failed. Please verify your credentials.';
            btn.disabled = false;
            btnText.textContent = isLoginMode ? 'Sign In to Workspace →' : 'Create Workspace — ₹0 Upfront →';
        }

    } catch (err) {
        alertBox.className = 'auth-alert error';
        alertBox.style.display = 'block';
        alertBox.textContent = `Backend notice: ${err.message}. If the server is restarting, please retry in a few seconds.`;
        btn.disabled = false;
        btnText.textContent = isLoginMode ? 'Sign In to Workspace →' : 'Create Workspace — ₹0 Upfront →';
    }
}

function checkExistingSession() {
    try {
        const active = localStorage.getItem('trustorder_active_seller') || localStorage.getItem('shipvera_active_seller');
        if (active) {
            const seller = JSON.parse(active);
            const alertBox = document.getElementById('authAlert');
            if (alertBox && seller && seller.brand_name) {
                alertBox.className = 'auth-alert success';
                alertBox.style.display = 'block';
                alertBox.innerHTML = `Active workspace: <strong>${seller.brand_name}</strong>. <a href="/dashboard" style="color: var(--oxblood, #6B1228); font-weight: 700; text-decoration: underline;">Open Console →</a>`;
            }
        }
    } catch (e) {}
}

function socialAuthNotice(provider) {
    if (provider === 'Shopify') {
        const shopifyInput = document.getElementById('shopifyDomain');
        if (shopifyInput) {
            shopifyInput.focus();
            const alertBox = document.getElementById('authAlert');
            alertBox.className = 'auth-alert success';
            alertBox.style.display = 'block';
            alertBox.innerHTML = `<strong>Shopify Fast Connect:</strong> Enter your store domain below and choose a password to instantly link TrustOrder's webhook engine.`;
        }
    } else {
        alert(`${provider} Single Sign-On connects with your official ${provider} account. Use email registration to configure your custom COD voice prompts.`);
    }
}
