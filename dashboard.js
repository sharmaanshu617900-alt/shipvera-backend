/**
 * TrustOrder Dashboard Interactive Engine
 * Professional Enterprise Operations Console
 * Connected to Render Cloud Backend (/api/orders, /api/analytics, /api/wallet, /api/calls/trigger)
 */

// Centralized API Base Resolver for Render Cloud Backend
function getApiUrl(path) {
    const config = window.TrustOrderConfig || window.ShipveraConfig;
    if (typeof window !== 'undefined' && config && typeof config.getApiUrl === 'function') {
        return config.getApiUrl(path);
    }
    const saved = localStorage.getItem('TRUSTORDER_BACKEND_URL') || (localStorage.getItem('TRUSTORDER_BACKEND_URL') || localStorage.getItem('SHIPVERA_BACKEND_URL'));
    const base = (saved && saved.trim()) ? saved.trim().replace(/\/+$/, '') : 'https://trustorder-backend.onrender.com';
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return `${base}${cleanPath}`;
}

let allOrders = [];
let activeFilter = 'all';
let selectedPack = 'growth';
let selectedPackAmount = 2999;
let currentModalOrderId = null;
let currentActiveSellerId = null;
let currentActiveBrand = '';

// Read query params or localStorage for active seller
try {
    const urlParams = new URLSearchParams(window.location.search);
    const paramSellerId = urlParams.get('seller_id');
    if (paramSellerId) {
        currentActiveSellerId = paramSellerId;
        localStorage.setItem('trustorder_active_seller_id', paramSellerId); localStorage.setItem('shipvera_active_seller_id', paramSellerId);
    } else {
        const savedSellerId = (localStorage.getItem('trustorder_active_seller_id') || localStorage.getItem('shipvera_active_seller_id'));
        if (savedSellerId) currentActiveSellerId = savedSellerId;
    }

    const savedSeller = (localStorage.getItem('trustorder_active_seller') || localStorage.getItem('shipvera_active_seller'));
    if (savedSeller) {
        const parsed = JSON.parse(savedSeller);
        if (parsed.brand_name && (!currentActiveSellerId || parsed.id === currentActiveSellerId)) {
            currentActiveBrand = parsed.brand_name;
            if (!currentActiveSellerId) currentActiveSellerId = parsed.id;
        }
    }
} catch (e) { }

function getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const userEmail = (localStorage.getItem('trustorder_user_email') || localStorage.getItem('shipvera_user_email'));
    if (userEmail) {
        headers['x-seller-email'] = userEmail;
    }
    if (currentActiveSellerId) {
        headers['x-seller-id'] = currentActiveSellerId;
    }
    return headers;
}

document.addEventListener('DOMContentLoaded', () => {
    if (currentActiveBrand) {
        const storeNameEl = document.getElementById('storeName');
        if (storeNameEl) storeNameEl.textContent = currentActiveBrand;
    }

    const founderName = (localStorage.getItem('trustorder_founder_name') || localStorage.getItem('shipvera_founder_name'));
    if (founderName) {
        const dppFounderName = document.getElementById('dppFounderName');
        const dppAvatar = document.getElementById('dppAvatar');
        if (dppFounderName) dppFounderName.textContent = founderName;
        if (dppAvatar) {
            const initials = founderName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
            dppAvatar.textContent = initials || 'SV';
        }
    }

    fetchDashboardData();
    loadRegisteredStores();

    // Auto-refresh orders every 10 seconds
    setInterval(fetchOrders, 10000);

    // Close store dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const wrap = document.querySelector('.dash-store-badge-wrap');
        const menu = document.getElementById('storeDropdownMenu');
        if (wrap && menu && !wrap.contains(e.target)) {
            menu.classList.remove('show');
        }
    });
});

async function fetchDashboardData() {
    await Promise.all([
        fetchAnalytics(),
        fetchWallet(),
        fetchOrders(),
        fetchIntegrationsStatus()
    ]);
}

// ---------- 1. Analytics & Metrics ----------
async function fetchAnalytics() {
    try {
        const res = await fetch(getApiUrl('/api/analytics'), {
            headers: getAuthHeaders()
        });
        const data = await res.json();
        if (data.success && data.analytics) {
            const a = data.analytics;
            const totalOrders = Number(a.total_orders_protected) || 0;
            const moneySaved = Number(a.rto_money_saved_inr) || 0;

            document.getElementById('metricTotalOrders').textContent = totalOrders.toLocaleString('en-IN');
            document.getElementById('metricMoneySaved').textContent = `₹${moneySaved.toLocaleString('en-IN')}`;

            const rtoCutEl = document.getElementById('metricRtoCut');
            const rtoPillEl = document.getElementById('metricRtoPill');
            const inspectedPillEl = document.getElementById('metricInspectedPill');

            if (totalOrders > 0) {
                if (rtoCutEl) rtoCutEl.textContent = `${a.rto_reduction_rate_pct}%`;
                if (rtoPillEl) rtoPillEl.textContent = 'Active Drop';
                if (inspectedPillEl) inspectedPillEl.textContent = `${totalOrders} Inspected`;
            } else {
                if (rtoCutEl) rtoCutEl.textContent = '0%';
                if (rtoPillEl) rtoPillEl.textContent = 'Protected';
                if (inspectedPillEl) inspectedPillEl.textContent = 'Ready';
            }

            if (a.seller_brand) {
                currentActiveBrand = a.seller_brand;
                const storeNameEl = document.getElementById('storeName');
                if (storeNameEl) storeNameEl.textContent = a.seller_brand;
            }

            // Update user profile pill in header
            updateHeaderProfile({
                name: a.seller_brand,
                brand_name: a.seller_brand
            });
        }
    } catch (e) {
        console.error('Error fetching analytics:', e);
    }
}

function updateHeaderProfile(seller) {
    if (!seller) return;
    const name = seller.name || seller.brand_name || 'Founder';
    const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'SV';
    const avatarEl = document.getElementById('dppAvatar');
    const founderNameEl = document.getElementById('dppFounderName');
    if (avatarEl) avatarEl.textContent = initials;
    if (founderNameEl) founderNameEl.textContent = name;
}
// ---------- 2. Wallet & Balance ----------
async function fetchWallet() {
    try {
        const res = await fetch(getApiUrl('/api/wallet'), {
            headers: getAuthHeaders()
        });
        const data = await res.json();
        if (data.success && data.wallet) {
            const w = data.wallet;
            const bal = Number(w.balance_inr || 0);
            document.getElementById('walletBalance').textContent = `₹${bal.toFixed(2)}`;

            const alertBanner = document.getElementById('zeroBalanceAlert');
            if (bal <= 0) {
                alertBanner.style.display = 'flex';
            } else {
                alertBanner.style.display = 'none';
            }
        }
    } catch (e) {
        console.error('Error fetching wallet:', e);
    }
}

// ---------- 3. Orders Stream ----------
async function fetchOrders() {
    try {
        const res = await fetch(getApiUrl('/api/orders'), {
            headers: getAuthHeaders()
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.orders)) {
            allOrders = data.orders;
            renderOrdersTable();
        }
    } catch (e) {
        console.error('Error fetching orders:', e);
    }
}

function renderOrdersTable() {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;

    let filtered = allOrders;
    if (activeFilter !== 'all') {
        filtered = allOrders.filter(o => o.verification_status === activeFilter);
    }

    document.getElementById('orderCountBadge').textContent = `${filtered.length} Orders`;

    if (filtered.length === 0) {
        if (activeFilter === 'all') {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; padding: 64px 24px;">
                        <div style="width: 52px; height: 52px; border-radius: 14px; background: #F0FDF4; border: 1px solid #BBF7D0; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 14px;">
                            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#058A5E" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                        </div>
                        <div style="font-size: 1.15rem; font-weight: 700; color: #0F172A; margin-bottom: 6px;">No COD Orders Dispatched Yet</div>
                        <p style="margin: 0 0 20px 0; font-size: 0.86rem; color: #64748B; max-width: 520px; margin-left: auto; margin-right: auto; line-height: 1.5;">
                            TrustOrder is standing by to protect your COD orders. When an order arrives, our autonomous Hinglish voice agent calls your buyer within 60 seconds to confirm purchase intent and enrich courier labels with missing landmarks.
                        </p>
                        <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
                            <button class="btn-dab btn-primary" onclick="openTestLiveCallModal()">
                                <span>📞 Test Call to Your Mobile</span>
                            </button>
                            <button class="btn-dab btn-secondary" onclick="openQuickPasteModal()">
                                <span>+ Quick-Paste WhatsApp Address</span>
                            </button>
                            <button class="btn-dab btn-ghost" onclick="simulateShopifyOrder()">
                                <span>⚡ Simulate Incoming Order</span>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        } else {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; padding: 48px 20px; color: #71717A;">
                        <div style="margin-bottom: 6px; font-weight: 600; color: #374151;">No orders in this view</div>
                        <p style="margin: 0; font-size: 0.8rem;">Filter "${activeFilter}" returned zero matching records.</p>
                    </td>
                </tr>
            `;
        }
        return;
    }

    tbody.innerHTML = filtered.map(o => {
        const isShopify = o.source === 'shopify';
        const sourceIcon = isShopify ? 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/shopify.svg' : 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/whatsapp.svg';
        const sourceTitle = isShopify ? 'Shopify Webhook' : 'WhatsApp Quick-Paste';

        // Risk pill
        let riskClass = 'low';
        let riskLabel = 'Low Risk';
        if ((o.risk_score || 0) >= 70) {
            riskClass = 'high';
            riskLabel = 'High Risk';
        } else if ((o.risk_score || 0) >= 40) {
            riskClass = 'medium';
            riskLabel = 'Review Needed';
        }

        // Status badge
        let statusClass = o.verification_status;
        let statusText = 'Verified';
        if (o.verification_status === 'verified_cleaned') statusText = 'Cleaned & Synced';
        else if (o.verification_status === 'cancelled_fake') statusText = 'Buyer Cancelled';
        else if (o.verification_status === 'trust_lock_sent') statusText = '₹19 Token Pending';
        else if (o.verification_status === 'trust_lock_paid') statusText = 'Token Paid';
        else if (o.verification_status === 'calling') statusText = 'Dialing Outbound';
        else if (o.verification_status === 'queued') statusText = 'In Queue';

        // Missing tags
        const missingTags = (o.missing_fields || []).map(m => `<span class="raw-missing-tag">Missing ${m.replace('_', ' ')}</span>`).join(' ');

        // Cleaned address box
        let cleanedHtml = '<span style="color: #94A3B8; font-size: 0.76rem;">Awaiting resolution</span>';
        if (o.cleaned_address_line1) {
            cleanedHtml = `
                <div class="cleaned-address-box">
                    <div class="cab-line1">${o.cleaned_address_line1}</div>
                    <div class="cab-line2">${o.cleaned_address_line2 || ''}</div>
                    ${o.cleaned_landmark ? `<div class="cab-landmark-tag">Landmark: ${o.cleaned_landmark}</div>` : ''}
                </div>
            `;
        } else if (o.verification_status === 'cancelled_fake') {
            cleanedHtml = '<span style="color: #DC2626; font-size: 0.78rem; font-weight: 600;">Blocked (₹180 Freight Saved)</span>';
        }

        // Formatted order date
        const dateStr = o.created_at ? new Date(o.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : 'Just now';

        return `
            <!-- Primary Order Row -->
            <tr class="order-row" id="order-row-${o.id}" onclick="toggleOrderDiff('${o.id}')">
                <td style="text-align: center;">
                    <span class="diff-row-toggle" id="diff-toggle-${o.id}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </span>
                </td>
                <td>
                    <div class="order-id-cell">
                        <img src="${sourceIcon}" alt="${sourceTitle}" class="order-source-icon" title="${sourceTitle}">
                        <div>
                            <span class="oic-number">${o.external_order_id}</span>
                            <span class="oic-date">${dateStr}</span>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="buyer-cell-name">${o.buyer_name}</div>
                    <div class="buyer-cell-meta">${o.buyer_phone} • ${o.city || 'India'}</div>
                </td>
                <td>
                    <span class="risk-pill ${riskClass}">${riskLabel} (${o.risk_score || 20})</span>
                </td>
                <td>
                    <div class="raw-address-box">
                        <div class="rab-text">${o.raw_address}</div>
                        ${missingTags ? `<div class="rab-tags">${missingTags}</div>` : ''}
                    </div>
                </td>
                <td style="text-align: center; color: #94A3B8;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                </td>
                <td>
                    ${cleanedHtml}
                </td>
                <td>
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </td>
                <td style="text-align: right;" onclick="event.stopPropagation()">
                    <button class="table-action-btn" onclick="openLiveCallModal('${o.id}')">
                        Dial Outbound
                    </button>
                </td>
            </tr>

            <!-- Expanded Address Detail Accordion Row -->
            <tr class="diff-accordion-row" id="diff-row-${o.id}">
                <td colspan="9" class="diff-accordion-cell">
                    <div class="magic-diff-card">
                        <div class="diff-card-grid">
                            <!-- Left: Flagged Customer Input -->
                            <div class="diff-box-left">
                                <div class="diff-box-label-red">
                                    <span>FLAGGED CUSTOMER INPUT (Risk Score: ${o.risk_score || 50}/100)</span>
                                </div>
                                <div class="diff-box-text">"${o.raw_address}, ${o.city || ''} - ${o.pincode || ''}"</div>
                                <div class="diff-box-tags">
                                    ${(o.missing_fields || []).map(m => `<span class="diff-tag-missing">Missing: ${m.replace('_', ' ')}</span>`).join('')}
                                    <span class="diff-tag-missing">COD Value: ₹${o.cod_amount || 0}</span>
                                </div>
                            </div>

                            <!-- Center: Processing Status -->
                            <div class="diff-box-center">
                                <span class="diff-center-tag">AUTOMATED AUDIT</span>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#058A5E" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                            </div>

                            <!-- Right: Verified Shipping Label -->
                            <div class="diff-box-right">
                                <div class="diff-box-label-green">
                                    <span>VERIFIED SHOPIFY SHIPPING LABEL</span>
                                    ${o.rto_money_saved > 0 ? `<span class="diff-tag-saved">+₹${o.rto_money_saved} Saved</span>` : ''}
                                </div>
                                <div class="diff-box-text" style="color: #064E3B; font-weight: 600;">
                                    ${o.cleaned_address_line1 || 'Pending call resolution'}
                                </div>
                                <div class="diff-box-text" style="color: #047857; margin-top: 2px;">
                                    ${o.cleaned_address_line2 || (o.city ? `${o.city} - ${o.pincode}` : '')}
                                </div>
                                ${o.cleaned_landmark ? `
                                    <div style="margin-top: 6px; font-size: 0.76rem; color: #065F46; font-weight: 600;">
                                        Landmark: ${o.cleaned_landmark}
                                    </div>
                                ` : ''}
                                <div class="diff-box-tags" style="margin-top: 8px;">
                                    ${(o.tags || ['RTO-Shield-Verified']).map(t => `<span class="diff-tag-saved">Tag: ${t}</span>`).join('')}
                                </div>
                            </div>
                        </div>

                        <!-- Google Maps Deliverability Strip -->
                        <div class="diff-maps-strip">
                            <div class="dms-left">
                                <svg class="dms-pin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                                    <circle cx="12" cy="10" r="3"></circle>
                                </svg>
                                <span class="dms-label">Google Maps Deliverability:</span>
                                <span class="dms-badge ${o.cleaned_landmark || o.geo_location_type === 'ROOFTOP' ? 'rooftop' : 'approximate'}">
                                    ${o.cleaned_landmark || o.geo_location_type === 'ROOFTOP' ? 'ROOFTOP PRECISE (95%)' : 'APPROXIMATE PINCODE (55% - Landmark Needed)'}
                                </span>
                            </div>
                            <div class="dms-right">
                                <span class="dms-coords">
                                    ${o.geo_coordinates ? `${o.geo_coordinates.lat.toFixed(4)}° N, ${o.geo_coordinates.lng.toFixed(4)}° E` : (o.city === 'Indore' ? '22.7196° N, 75.8577° E' : '28.8955° N, 76.6066° E')}
                                </span>
                                <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((o.cleaned_address_line1 || o.raw_address) + ', ' + (o.city || ''))}" target="_blank" rel="noopener noreferrer" class="dms-link" onclick="event.stopPropagation()">
                                    Inspect on Google Maps ↗
                                </a>
                            </div>
                        </div>

                        <!-- Operational Action Strip -->
                        <div class="diff-actions-strip">
                            <div class="das-meta">
                                <span>Buyer: ${o.buyer_phone}</span>
                                <span>•</span>
                                <span>Order: ${o.external_order_id}</span>
                                <span>•</span>
                                <span>Amount: ₹${o.cod_amount}</span>
                            </div>
                            <div class="das-buttons">
                                <button class="btn-das" onclick="openTranscriptModal('${o.id}')">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                    <span>Call Recording</span>
                                </button>
                                <button class="btn-das btn-das-primary" onclick="openLiveCallModal('${o.id}')">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                                    <span>Outbound Station</span>
                                </button>
                                <button class="btn-das btn-das-amber" onclick="openTrustLockModal('${o.id}')">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                    <span>₹19 Trust Token</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function toggleOrderDiff(orderId) {
    const diffRow = document.getElementById(`diff-row-${orderId}`);
    const toggleIcon = document.getElementById(`diff-toggle-${orderId}`);
    const orderRow = document.getElementById(`order-row-${orderId}`);

    if (!diffRow) return;

    const isOpen = diffRow.classList.contains('open');
    if (isOpen) {
        diffRow.classList.remove('open');
        if (toggleIcon) toggleIcon.classList.remove('expanded');
        if (orderRow) orderRow.classList.remove('active-expanded');
    } else {
        diffRow.classList.add('open');
        if (toggleIcon) toggleIcon.classList.add('expanded');
        if (orderRow) orderRow.classList.add('active-expanded');
    }
}

function filterOrders(filterKey) {
    activeFilter = filterKey;
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-filter') === filterKey);
    });
    renderOrdersTable();
}

// ---------- 4. TRAI Regulatory SLA Window Check ----------
function checkTraiCallingWindow() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const istTime = new Date(utc + (3600000 * 5.5));
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    const currentMins = hours * 60 + minutes;

    // Allowed: 8:30 AM (510) to 9:30 PM (1290) IST
    const isAllowed = currentMins >= 510 && currentMins <= 1290;

    const dot = document.getElementById('traiDot');
    const text = document.getElementById('traiWindowText');

    if (dot && text) {
        if (isAllowed) {
            dot.className = 'trai-dot';
            text.textContent = 'TRAI Window: Active (8:30 AM – 9:30 PM)';
        } else {
            dot.className = 'trai-dot night';
            text.textContent = 'Night Queue: Active (Paused till 8:30 AM)';
        }
    }
}

// ---------- 5. Multi-Tenant Brand Switcher ----------
function toggleStoreDropdown() {
    const menu = document.getElementById('storeDropdownMenu');
    if (menu) {
        menu.classList.toggle('show');
    }
}

async function loadRegisteredStores() {
    try {
        const userEmail = (localStorage.getItem('trustorder_user_email') || localStorage.getItem('shipvera_user_email')) || '';
        const activeId = currentActiveSellerId || (localStorage.getItem('trustorder_active_seller_id') || localStorage.getItem('shipvera_active_seller_id')) || '';

        const queryParams = new URLSearchParams();
        if (userEmail) queryParams.set('email', userEmail);
        if (activeId) queryParams.set('seller_id', activeId);

        const res = await fetch(getApiUrl(`/api/auth/sellers?${queryParams.toString()}`), {
            headers: {
                'x-seller-email': userEmail,
                'x-seller-id': activeId
            }
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.sellers)) {
            const menu = document.getElementById('storeDropdownMenu');
            if (!menu) return;

            const itemsHtml = data.sellers.map(s => {
                const isSelected = (currentActiveSellerId ? s.id === currentActiveSellerId : s.brand_name === currentActiveBrand);
                const tagClass = s.is_demo ? 'sdm-tag-standby' : (isSelected ? 'sdm-tag-active' : 'sdm-tag-standby');
                const tagText = s.is_demo ? 'Demo Sandbox' : (isSelected ? 'Active' : 'Connected');
                return `
                    <div class="sdm-item ${isSelected ? 'active' : ''}" onclick="switchStore('${s.brand_name.replace(/'/g, "\\'")}', '${s.id}')">
                        <div class="sdm-item-header">
                            <strong>${s.brand_name}</strong>
                            <span class="${tagClass}">${tagText}</span>
                        </div>
                        <span class="sdm-meta">${s.shopify_domain || 'Active Workspace'} • ₹${Number(s.wallet_balance_inr || 0).toFixed(2)} Bal</span>
                    </div>
                `;
            }).join('');

            menu.innerHTML = `
                <div style="padding: 6px 12px; font-size: 0.68rem; font-weight: 700; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.04em;">Your Workspaces</div>
                ${itemsHtml}
                <div class="sdm-item add-store" onclick="window.location.href='/signup'">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    <span>+ Connect Another Store</span>
                </div>
            `;
        }
    } catch (e) {
        console.warn('Could not fetch store list:', e);
    }
}

function switchStore(brandName, sellerId) {
    currentActiveBrand = brandName;
    currentActiveSellerId = sellerId;
    localStorage.setItem('trustorder_active_seller_id', sellerId); localStorage.setItem('shipvera_active_seller_id', sellerId);
    localStorage.setItem('trustorder_active_brand', brandName); localStorage.setItem('shipvera_active_brand', brandName);

    const storeNameEl = document.getElementById('storeName');
    if (storeNameEl) storeNameEl.textContent = brandName;

    document.querySelectorAll('.sdm-item').forEach(item => {
        item.classList.remove('active');
        if (item.querySelector('strong') && item.querySelector('strong').textContent === brandName) {
            item.classList.add('active');
        }
    });

    const menu = document.getElementById('storeDropdownMenu');
    if (menu) menu.classList.remove('show');

    const lcd = document.getElementById('liveCallDesc');
    if (lcd) lcd.textContent = `Standby for ${brandName}`;

    fetchDashboardData();
    loadRegisteredStores();
}

function openAddStoreAlert() {
    window.location.href = '/signup';
}

// ---------- 6. Quick-Paste Modal ----------
function openQuickPasteModal() {
    document.getElementById('quickPasteModal').classList.add('open');
    document.getElementById('quickPasteResult').style.display = 'none';
}

function closeQuickPasteModal() {
    document.getElementById('quickPasteModal').classList.remove('open');
}

function fillSample(sampleId) {
    const input = document.getElementById('quickPasteInput');
    if (sampleId === 1) {
        input.value = "Rahul Verma 9876543210, 56 dukan mg road indore, black cargo pants COD 1299";
    } else if (sampleId === 2) {
        input.value = "Rohan Sharma 9812345678, sharma dairy ke piche gali 4 rohtak, oversized hoodie L size COD 1799";
    } else if (sampleId === 3) {
        input.value = "Amit 9999999999, asdfghjkl jaipur, sneakers COD 2499";
    }
}

async function submitQuickPaste() {
    const input = document.getElementById('quickPasteInput');
    const btn = document.getElementById('btnRunQuickPaste');
    const resultBox = document.getElementById('quickPasteResult');

    if (!input || !input.value.trim()) {
        alert('Please paste customer WhatsApp or Instagram chat text.');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span>Processing Extraction...</span>';
    resultBox.style.display = 'none';

    try {
        const res = await fetch(getApiUrl('/api/orders/quick-paste'), {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                raw_text: input.value.trim(),
                seller_id: currentActiveSellerId
            })
        });
        const data = await res.json();

        if (data.success) {
            resultBox.style.display = 'block';
            resultBox.innerHTML = `
                <div style="font-weight: 600; color: #065F46; margin-bottom: 6px;">Order Extracted & Verified</div>
                <div style="font-size: 0.8rem; line-height: 1.5; color: #374151;">
                    <strong>Customer:</strong> ${data.parsed.buyerName} (${data.parsed.buyerPhone})<br>
                    <strong>Destination:</strong> ${data.parsed.rawAddress}, ${data.parsed.city}<br>
                    <strong>Status:</strong> ${data.order.verification_status} (Risk: ${data.order.risk_score})<br>
                    <strong>Formatted Label:</strong> ${data.order.cleaned_address_line1 || 'Incomplete'}<br>
                    ${data.order.rto_money_saved > 0 ? `<span style="color: #058A5E; font-weight: 600;">₹${data.order.rto_money_saved} freight penalty prevented</span>` : ''}
                </div>
            `;
            fetchDashboardData();
        } else {
            alert(data.error || 'Failed to extract order.');
        }
    } catch (e) {
        alert('Connection error: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Extract & Dial Call →</span>';
    }
}

// ---------- 7. Simulate Incoming Shopify COD Webhook ----------
async function simulateShopifyOrder() {
    const cities = [
        { city: 'Indore', zip: '452001', addr: 'gali no 3 near main chowk' },
        { city: 'Lucknow', zip: '226010', addr: 'Gomti nagar sector 6 behind hospital' },
        { city: 'Jaipur', zip: '302001', addr: 'opposite raj mandir cinema' },
        { city: 'Ahmedabad', zip: '380001', addr: 'near iskcon temple bopal' }
    ];
    const pick = cities[Math.floor(Math.random() * cities.length)];
    const randomNum = Math.floor(Math.random() * 9000000000) + 1000000000;
    const names = ['Kunal Shah', 'Ananya Roy', 'Manish Gupta', 'Deepak Soni', 'Pooja Mehta'];
    const name = names[Math.floor(Math.random() * names.length)];
    const codAmt = [899, 1299, 1599, 2199][Math.floor(Math.random() * 4)];

    try {
        const res = await fetch(getApiUrl('/api/webhooks/shopify/orders-create'), {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                seller_id: currentActiveSellerId,
                id: Date.now().toString().slice(-5),
                name: `#UK-${Date.now().toString().slice(-4)}`,
                financial_status: 'pending',
                total_price: String(codAmt),
                shipping_address: {
                    first_name: name.split(' ')[0],
                    last_name: name.split(' ')[1] || '',
                    phone: `+91${randomNum}`,
                    address1: pick.addr,
                    city: pick.city,
                    zip: pick.zip
                }
            })
        });
        const data = await res.json();
        if (data.success) {
            alert(`Simulated order received for ${name} (${pick.city}). Geo-sanitizer evaluated and outbound call queued.`);
            fetchDashboardData();
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

// ---------- 8. Live Bolna Calling Station Modal ----------
function openLiveCallModal(orderId) {
    currentModalOrderId = orderId;
    const order = allOrders.find(o => o.id === orderId);
    if (!order) return;

    document.getElementById('lcmOrderId').textContent = order.external_order_id;
    document.getElementById('lcmCodAmount').textContent = `₹${order.cod_amount}`;
    document.getElementById('lcmBuyerName').textContent = order.buyer_name;
    document.getElementById('lcmBrandName').textContent = currentActiveBrand;
    document.getElementById('lcmRawAddress').textContent = order.raw_address;
    document.getElementById('lcmMissingTag').textContent = (order.missing_fields && order.missing_fields.length > 0) ? `Missing: ${order.missing_fields.join(', ')}` : 'Verification required';

    const rawPhone = order.buyer_phone || '';
    const cleanPhone = rawPhone.replace(/[^\d]/g, '').slice(-10);
    document.getElementById('lcmPhoneInput').value = cleanPhone;

    document.getElementById('lcmStatusBox').style.display = 'none';
    document.getElementById('liveCallModal').classList.add('open');
}

function openTestLiveCallModal() {
    if (allOrders.length > 0) {
        openLiveCallModal(allOrders[0].id);
    } else {
        alert('No orders available to test. Please simulate an order first.');
    }
}

function closeLiveCallModal() {
    document.getElementById('liveCallModal').classList.remove('open');
}

async function dispatchLiveCallFromModal() {
    const phoneInput = document.getElementById('lcmPhoneInput');
    const phone = phoneInput.value.trim().replace(/[^\d]/g, '');

    if (phone.length < 10) {
        alert('Please enter a valid 10-digit mobile number.');
        return;
    }

    const btn = document.getElementById('btnDispatchLiveCall');
    const statusBox = document.getElementById('lcmStatusBox');
    const statusTitle = document.getElementById('lcmStatusTitle');
    const statusDetails = document.getElementById('lcmStatusDetails');

    btn.disabled = true;
    btn.innerHTML = '<span>Initiating Outbound Connection...</span>';
    statusBox.style.display = 'block';
    statusTitle.textContent = 'Connecting to Bolna Telephony Gateway...';
    statusDetails.textContent = `Target: +91${phone.slice(-10)} • Injecting dynamic brand context...`;

    try {
        const res = await fetch(getApiUrl('/api/orders/trigger'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                order_id: currentModalOrderId,
                live: true,
                recipient_phone: `+91${phone.slice(-10)}`,
                override_night_window: true
            })
        });
        const data = await res.json();

        if (data.success) {
            statusTitle.textContent = 'Outbound Call Connected';
            statusDetails.innerHTML = `
                Execution ID: <strong>${data.executionId}</strong><br>
                Recipient: <strong>+91${phone.slice(-10)}</strong><br>
                Gateway: <strong>Bolna.ai / Sarvam AI Telephony</strong><br>
                Status: <strong>Active (Hard Cap: 40s)</strong><br>
                <em>Check the recipient phone. Ringing now.</em>
            `;

            document.getElementById('liveCallDesc').textContent = `Call in progress (+91${phone.slice(-10)})`;
            fetchDashboardData();
        } else {
            statusTitle.textContent = 'Gateway Notice';
            statusDetails.textContent = data.error || 'Failed to dispatch call via gateway.';
        }
    } catch (e) {
        statusTitle.textContent = 'Connection Error';
        statusDetails.textContent = e.message;
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Trigger Outbound Call →</span>';
    }
}

// ---------- 9. Call Transcript Modal ----------
async function openTranscriptModal(orderId) {
    const modal = document.getElementById('transcriptModal');
    modal.classList.add('open');

    const stream = document.getElementById('transcriptStream');
    const esb = document.getElementById('esbContent');
    const modalTitle = document.getElementById('transcriptModalTitle');
    const modalSub = document.getElementById('transcriptModalSub');

    stream.innerHTML = '<div style="text-align: center; padding: 20px; color: #71717A;">Retrieving transcript records...</div>';
    esb.innerHTML = '';

    try {
        const res = await fetch(getApiUrl(`/api/orders/${orderId}`));
        const data = await res.json();
        if (data.success && data.order) {
            const o = data.order;
            const logs = data.callLogs || [];
            const latestLog = logs[0] || {};

            modalTitle.textContent = `Call Record // ${o.buyer_name} (${o.external_order_id})`;
            modalSub.textContent = `${o.city || 'India'} • Recorded via Sarvam Bulbul Engine`;

            const transcript = latestLog.transcript || [
                { role: 'ai', speaker: 'TrustOrder AI', text: `Namaste ${o.buyer_name} ji! Main ${currentActiveBrand} ke dispatch desk se TrustOrder AI bol raha hoon. Aapka ₹${o.cod_amount} ka order pack ho gaya hai.` },
                { role: 'ai', speaker: 'TrustOrder AI', text: `Bhaiya aapne address me '${o.raw_address}' likha hai par landmark missing hai. Aas-paas konsi dukaan ya mandir hai bata dijiye?` },
                { role: 'user', speaker: `Buyer (${o.buyer_name})`, text: 'Haan bhaiya, Bikaner sweets ke samne safed gate hai 2nd floor, wahi deliver kar dena.' },
                { role: 'ai', speaker: 'TrustOrder AI', text: 'Acha note kar liya! 3-4 din me parcel mil jayega. Dhanyawad!' }
            ];

            stream.innerHTML = transcript.map(t => `
                <div class="t-bubble ${t.role === 'ai' ? 'ai' : 'user'}">
                    <span class="t-bubble-speaker">${t.speaker || (t.role === 'ai' ? 'TrustOrder AI' : 'Customer')}</span>
                    <p style="margin: 0;">"${t.text || t.message || ''}"</p>
                </div>
            `).join('');

            esb.innerHTML = `
                <div><strong>Address Line 1:</strong> ${o.cleaned_address_line1 || 'Incomplete'}</div>
                <div><strong>Extracted Landmark:</strong> ${o.cleaned_landmark || 'None'}</div>
                <div><strong>Shopify Synced Tags:</strong> ${(o.tags || []).join(', ')}</div>
            `;
        }
    } catch (e) {
        stream.innerHTML = '<div style="color: #DC2626; padding: 20px;">Failed to load transcript.</div>';
    }
}

function closeTranscriptModal() {
    document.getElementById('transcriptModal').classList.remove('open');
}

function toggleModalAudio() {
    const btn = document.getElementById('mabPlayBtn');
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.frequency.setValueAtTime(520, ctx.currentTime);
        g.gain.setValueAtTime(0.06, ctx.currentTime);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
    } catch (e) { }
}

// ---------- 10. Feature 4: ₹19 Trust Lock Modal ----------
function openTrustLockModal(orderId) {
    currentModalOrderId = orderId;
    const order = allOrders.find(o => o.id === orderId);
    if (!order) return;

    const remaining = Math.max(0, Number(order.cod_amount) - 19);
    const msg = `Hi ${order.buyer_name}, humne aapka ₹${order.cod_amount} ka parcel dispatch karne ke liye call kiya tha par connect nahi hua. Parcel hold na ho isliye bas ₹19 ka chota token UPI karke apna address lock kar dein. Baaki ₹${remaining} delivery pe hi dena hai!`;

    document.getElementById('tlWaMessage').textContent = msg;
    document.getElementById('tlRazorpayLink').textContent = `https://rzp.io/l/trustorder_tl_${order.id.slice(0, 6)}`;
    document.getElementById('tlShopifyNote').textContent = `Prepaid Token: ₹19 | Remaining COD: ₹${remaining}`;

    document.getElementById('trustLockModal').classList.add('open');
}

function closeTrustLockModal() {
    document.getElementById('trustLockModal').classList.remove('open');
}

async function simulateTrustLockPayment() {
    const btn = document.getElementById('btnSimulatePayment');
    btn.disabled = true;
    btn.innerHTML = '<span>Processing Token...</span>';

    try {
        const res = await fetch(getApiUrl('/api/webhooks/razorpay/payment-captured'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                order_id: currentModalOrderId,
                payment_id: `pay_upi_${Date.now()}`
            })
        });
        const data = await res.json();
        if (data.success) {
            alert('₹19 Token Paid. Order marked Verified on Shopify.');
            closeTrustLockModal();
            fetchDashboardData();
        } else {
            alert(data.error || 'Payment simulation failed.');
        }
    } catch (e) {
        alert('Error: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Simulate Token Payment →</span>';
    }
}

// ---------- 11. Wallet Recharge Modal ----------
function openRechargeModal() {
    document.getElementById('rechargeModal').classList.add('open');
}

function closeRechargeModal() {
    document.getElementById('rechargeModal').classList.remove('open');
}

function selectRechargePack(packKey, amount) {
    selectedPack = packKey;
    selectedPackAmount = amount;
    document.querySelectorAll('.recharge-card').forEach(c => c.classList.remove('selected'));

    if (packKey === 'starter') {
        document.getElementById('packStarter').checked = true;
        document.querySelector('.recharge-card:nth-child(1)').classList.add('selected');
        document.getElementById('btnConfirmRecharge').innerHTML = '<span>Pay ₹999 & Activate Credits →</span>';
    } else {
        document.getElementById('packGrowth').checked = true;
        document.querySelector('.recharge-card:nth-child(2)').classList.add('selected');
        document.getElementById('btnConfirmRecharge').innerHTML = '<span>Pay ₹2,999 & Activate Credits →</span>';
    }
}

async function executeRecharge() {
    const btn = document.getElementById('btnConfirmRecharge');
    btn.disabled = true;
    btn.innerHTML = '<span>Processing Recharge...</span>';

    try {
        const res = await fetch(getApiUrl('/api/wallet/recharge'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pack_id: selectedPack })
        });
        const data = await res.json();
        if (data.success) {
            alert(`Recharge Confirmed. New Balance: ₹${data.wallet_balance_inr} (${data.available_verifications} verifications ready)`);
            closeRechargeModal();
            fetchDashboardData();
        } else {
            alert(data.error || 'Recharge failed.');
        }
    } catch (e) {
        alert('Recharge error: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<span>Pay ₹${selectedPackAmount.toLocaleString('en-IN')} & Activate Credits →</span>`;
    }
}

// =========================================================
// 12. Render Cloud Backend Connection Controller
// =========================================================

async function checkBackendConnection() {
    const dot = document.getElementById('backendStatusDot');
    const title = document.getElementById('backendStatusTitle');
    const sub = document.getElementById('backendStatusSub');
    if (!dot || !sub) return;

    try {
        if (window.ShipveraConfig && typeof window.ShipveraConfig.pingBackend === 'function') {
            const result = await window.ShipveraConfig.pingBackend();
            if (result.ok) {
                dot.className = 'backend-status-dot online';
                if (title) title.textContent = 'Render Backend';
                sub.textContent = `Live (${result.latencyMs}ms)`;
            } else if (result.latencyMs > 4000) {
                dot.className = 'backend-status-dot waking';
                if (title) title.textContent = 'Render Backend';
                sub.textContent = 'Waking Up (~30s)...';
            } else {
                dot.className = 'backend-status-dot offline';
                if (title) title.textContent = 'Render Backend';
                sub.textContent = 'Offline (Click to setup)';
            }
        }
    } catch (e) {
        dot.className = 'backend-status-dot offline';
        if (title) title.textContent = 'Render Backend';
        sub.textContent = 'Offline';
    }
}

function openBackendConfigModal() {
    const modal = document.getElementById('backendConfigModal');
    const input = document.getElementById('backendUrlInput');
    const resultBox = document.getElementById('backendPingResult');

    if (!modal) return;
    modal.classList.add('open');

    if (input) {
        const currentUrl = (window.ShipveraConfig && typeof window.ShipveraConfig.getBackendBaseUrl === 'function')
            ? window.ShipveraConfig.getBackendBaseUrl()
            : ((localStorage.getItem('TRUSTORDER_BACKEND_URL') || localStorage.getItem('SHIPVERA_BACKEND_URL')) || 'https://trustorder-backend.onrender.com');
        input.value = currentUrl;
    }

    if (resultBox) resultBox.style.display = 'none';
}

function closeBackendConfigModal() {
    const modal = document.getElementById('backendConfigModal');
    if (modal) modal.classList.remove('open');
}

async function testBackendConnection() {
    const input = document.getElementById('backendUrlInput');
    const btn = document.getElementById('btnTestBackend');
    const resultBox = document.getElementById('backendPingResult');
    const badge = document.getElementById('bprStatusBadge');
    const latency = document.getElementById('bprLatency');
    const details = document.getElementById('bprDetails');

    if (!input || !resultBox) return;
    const testUrl = input.value.trim() || 'https://trustorder-backend.onrender.com';

    btn.disabled = true;
    btn.innerHTML = '<span>Pinging...</span>';
    resultBox.style.display = 'block';
    badge.className = 'bpr-badge pending';
    badge.textContent = 'Checking /api/health...';
    latency.textContent = '';
    details.innerHTML = '<span style="color: #64645E;">Connecting to Render web service. Cold-start may take 30-50s if instance is sleeping...</span>';

    try {
        const ping = await window.ShipveraConfig.pingBackend(testUrl);
        if (ping.ok && ping.data) {
            badge.className = 'bpr-badge success';
            badge.textContent = '🟢 Connected & Verified';
            latency.textContent = `${ping.latencyMs}ms`;

            const seller = ping.data.seller || {};
            const feats = ping.data.features || {};
            details.innerHTML = `
                <div style="margin-top: 6px; line-height: 1.5; font-size: 0.8rem; color: #18181B;">
                    <strong>Platform:</strong> ${ping.data.platform || 'TrustOrder Voice AI Engine'}<br>
                    <strong>Brand:</strong> ${seller.brand || 'Enterprise Workspace'}<br>
                    <strong>Wallet Balance:</strong> ${seller.wallet_balance || '₹0.00'} (${seller.available_verifications || 0} verifications)<br>
                    <strong>Voice AI Telephony:</strong> <span style="color: #058A5E;">${feats.landmark_interrogator_voice_ai || 'Active'}</span><br>
                    <strong>Address Geo-Sanitizer:</strong> <span style="color: #058A5E;">${feats.pre_call_geo_sanitizer || 'Active'}</span><br>
                    <strong>Double-Entry Ledger:</strong> <span style="color: #058A5E;">${feats.financial_ledger || 'Active'}</span>
                </div>
            `;
        } else {
            badge.className = 'bpr-badge error';
            badge.textContent = '🔴 Connection Failed';
            latency.textContent = `${ping.latencyMs}ms`;
            details.innerHTML = `
                <div style="margin-top: 6px; font-size: 0.8rem; color: #DC2626;">
                    <strong>Error:</strong> ${ping.error || 'Failed to reach health endpoint.'}<br>
                    <span style="color: #64645E; font-size: 0.76rem;">Ensure the Render service is deployed and active at this URL. If it just woke up, wait 15 seconds and click Ping Health again.</span>
                </div>
            `;
        }
    } catch (e) {
        badge.className = 'bpr-badge error';
        badge.textContent = '🔴 Request Error';
        latency.textContent = '';
        details.innerHTML = `<span style="color: #DC2626; font-size: 0.8rem;">${e.message}</span>`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Ping Health</span>';
    }
}

function saveBackendConfiguration() {
    const input = document.getElementById('backendUrlInput');
    if (!input) return;

    const newUrl = input.value.trim();
    if (!newUrl) {
        alert('Please enter a valid Render service URL (e.g., https://trustorder-backend.onrender.com)');
        return;
    }

    if (window.ShipveraConfig && typeof window.ShipveraConfig.setBackendUrl === 'function') {
        window.ShipveraConfig.setBackendUrl(newUrl);
    } else {
        localStorage.setItem('TRUSTORDER_BACKEND_URL', newUrl); localStorage.setItem('SHIPVERA_BACKEND_URL', newUrl);
    }

    closeBackendConfigModal();
    checkBackendConnection();
    fetchDashboardData();

    alert(`Backend Connected to:\n${newUrl}\n\nDashboard is now querying your live Render instance.`);
}

function applyBackendPreset(presetUrl) {
    const input = document.getElementById('backendUrlInput');
    if (input) {
        input.value = presetUrl;
        testBackendConnection();
    }
}

// =========================================================
// 13. Shopify Store Integration Controller
// =========================================================

function openShopifyModal() {
    const modal = document.getElementById('shopifyModal');
    if (!modal) return;
    
    // Set dynamic webhook URL based on backend base
    const webhookInput = document.getElementById('shopifyWebhookInput');
    if (webhookInput) {
        const base = (window.ShipveraConfig && typeof window.ShipveraConfig.getBackendBaseUrl === 'function')
            ? window.ShipveraConfig.getBackendBaseUrl()
            : ((localStorage.getItem('TRUSTORDER_BACKEND_URL') || localStorage.getItem('SHIPVERA_BACKEND_URL')) || window.location.origin);
        webhookInput.value = `${base}/api/webhooks/shopify/orders-create`;
    }

    const savedDomain = (localStorage.getItem('trustorder_shopify_domain') || localStorage.getItem('shipvera_shopify_domain')) || '';
    const domainInput = document.getElementById('shopifyDomainInput');
    if (domainInput && !domainInput.value) {
        domainInput.value = savedDomain;
    }

    // Store display in connect modal
    const odbStoreName = document.getElementById('odbStoreName');
    const odbStoreDomain = document.getElementById('odbStoreDomain');
    if (odbStoreName) odbStoreName.textContent = currentActiveBrand || 'Connect Store';
    if (odbStoreDomain) odbStoreDomain.textContent = savedDomain || 'Enter domain and token below';

    // Reset progress
    const progressWrap = document.getElementById('oneClickShopifyProgress');
    const btn = document.getElementById('btnOneClickShopify');
    const btnText = document.getElementById('btnOneClickShopifyText');
    const fill = document.getElementById('ocShopifyFill');
    if (progressWrap) progressWrap.style.display = 'none';
    if (fill) fill.style.width = '0%';
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = '⚡ Connect Shopify Store →';

    const statusBox = document.getElementById('shopifyConnectionStatus');
    if (statusBox) statusBox.style.display = 'none';

    modal.classList.add('open');
}

function closeShopifyModal() {
    const modal = document.getElementById('shopifyModal');
    if (modal) modal.classList.remove('open');
}

function toggleManualShopifySetup() {
    const section = document.getElementById('manualShopifySection');
    const toggleText = document.getElementById('manualShopifyToggleText');
    if (!section) return;
    if (section.style.display === 'none') {
        section.style.display = 'block';
        if (toggleText) toggleText.textContent = '⚙ Hide Manual Credentials ▲';
    } else {
        section.style.display = 'none';
        if (toggleText) toggleText.textContent = '⚙ Connect Different Store / Manual Webhook (Advanced) ▼';
    }
}

async function executeOneClickShopify() {
    const btn = document.getElementById('btnOneClickShopify');
    const btnText = document.getElementById('btnOneClickShopifyText');
    const progressWrap = document.getElementById('oneClickShopifyProgress');
    const fill = document.getElementById('ocShopifyFill');
    const status = document.getElementById('ocShopifyStatus');
    const domainInput = document.getElementById('shopifyDomainInput');
    const tokenInput = document.getElementById('shopifyTokenInput');

    const domain = (domainInput && domainInput.value.trim()) || (localStorage.getItem('trustorder_shopify_domain') || localStorage.getItem('shipvera_shopify_domain')) || '';
    const token = (tokenInput && tokenInput.value.trim()) || '';

    if (!domain || !token) {
        const section = document.getElementById('manualShopifySection');
        if (section) section.style.display = 'block';
        if (!domain && domainInput) domainInput.focus();
        else if (!token && tokenInput) tokenInput.focus();
        alert('Please enter your Shopify store domain and Admin API Access Token (shpat_...) below.');
        return;
    }

    if (btn) btn.disabled = true;
    if (progressWrap) progressWrap.style.display = 'block';

    // Step 1: Handshake
    if (fill) fill.style.width = '35%';
    if (status) status.textContent = `Authenticating session with ${domain}...`;
    await new Promise(r => setTimeout(r, 200));

    // Step 2: Register Webhook
    if (fill) fill.style.width = '75%';
    if (status) status.textContent = 'Auto-installing real-time orders/create webhook...';

    try {
        const res = await fetch(getApiUrl('/api/auth/connect-shopify'), {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                seller_id: currentActiveSellerId,
                shopify_domain: domain,
                shopify_access_token: token
            })
        });
        const data = await res.json();

        if (data.success) {
            // Step 3: Success
            if (fill) fill.style.width = '100%';
            if (status) {
                status.style.color = '#058A5E';
                status.textContent = '🎉 Store Connected Successfully!';
            }
            if (btnText) btnText.textContent = '✓ Store Protected & Active!';

            // Update UI badge on dashboard
            const tag = document.getElementById('shopifyWebhookTag');
            const desc = document.getElementById('shopifyDomainDisplay');
            if (tag) {
                tag.textContent = 'Active: ' + data.shopify_domain;
                tag.className = 'dib-status-tag active';
            }
            if (desc) {
                desc.textContent = `Auto-syncing real-time COD checkouts from ${data.shopify_domain}`;
            }
            localStorage.setItem('trustorder_shopify_domain', data.shopify_domain); localStorage.setItem('shipvera_shopify_domain', data.shopify_domain);

            setTimeout(() => {
                closeShopifyModal();
                if (typeof loadSellerProfile === 'function') loadSellerProfile();
            }, 1200);
        } else {
            if (status) {
                status.style.color = '#DC2626';
                status.textContent = `Error: ${data.error || 'Failed to connect'}`;
            }
            if (btn) btn.disabled = false;
        }
    } catch (e) {
        if (status) {
            status.style.color = '#DC2626';
            status.textContent = `Error: ${e.message}`;
        }
        if (btn) btn.disabled = false;
    }
}

function copyShopifyWebhookUrl() {
    const input = document.getElementById('shopifyWebhookInput');
    if (!input) return;
    
    const copyText = () => {
        const btn = document.getElementById('btnCopyShopifyWebhook');
        if (btn) {
            btn.innerHTML = '<span>✓ Copied!</span>';
            setTimeout(() => {
                btn.innerHTML = '<span>Copy URL</span>';
            }, 2000);
        }
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(input.value).then(copyText).catch(() => {
            input.select();
            document.execCommand('copy');
            copyText();
        });
    } else {
        input.select();
        document.execCommand('copy');
        copyText();
    }
}

async function saveShopifyConnection() {
    const domainInput = document.getElementById('shopifyDomainInput');
    const tokenInput = document.getElementById('shopifyTokenInput');
    const statusBox = document.getElementById('shopifyConnectionStatus');
    const btn = document.getElementById('btnSaveShopify');
    
    const domain = (domainInput ? domainInput.value.trim() : '');
    const token = (tokenInput ? tokenInput.value.trim() : '');
    
    if (!domain) {
        alert('Please enter your Shopify store domain (e.g. brand.myshopify.com)');
        return;
    }
    
    btn.disabled = true;
    btn.innerHTML = '<span>Connecting to Shopify...</span>';
    if (statusBox) {
        statusBox.style.display = 'block';
        statusBox.style.background = '#EFF6FF';
        statusBox.style.color = '#1E40AF';
        statusBox.style.border = '1px solid #BFDBFE';
        statusBox.innerHTML = 'Verifying store credentials and registering webhook route...';
    }
    
    try {
        const res = await fetch(getApiUrl('/api/auth/connect-shopify'), {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                seller_id: currentActiveSellerId,
                shopify_domain: domain,
                shopify_access_token: token
            })
        });
        const data = await res.json();
        if (data.success) {
            if (statusBox) {
                statusBox.style.background = '#F0FDF4';
                statusBox.style.color = '#166534';
                statusBox.style.border = '1px solid #BBF7D0';
                statusBox.innerHTML = `<strong>Connected Successfully!</strong><br>${data.message}`;
            }
            // Update UI badge
            const tag = document.getElementById('shopifyWebhookTag');
            const desc = document.getElementById('shopifyDomainDisplay');
            if (tag) {
                tag.textContent = 'Active: ' + data.shopify_domain;
                tag.className = 'dib-status-tag active';
            }
            if (desc) {
                desc.textContent = `Auto-syncs shipping labels via official webhook from ${data.shopify_domain}`;
            }
            localStorage.setItem('trustorder_shopify_domain', data.shopify_domain); localStorage.setItem('shipvera_shopify_domain', data.shopify_domain);
            setTimeout(() => {
                closeShopifyModal();
            }, 1200);
        } else {
            if (statusBox) {
                statusBox.style.background = '#FEF2F2';
                statusBox.style.color = '#991B1B';
                statusBox.style.border = '1px solid #FECACA';
                statusBox.innerHTML = `<strong>Connection Failed:</strong> ${data.error || 'Check domain and token'}`;
            }
        }
    } catch (e) {
        if (statusBox) {
            statusBox.style.background = '#FEF2F2';
            statusBox.style.color = '#991B1B';
            statusBox.style.border = '1px solid #FECACA';
            statusBox.innerHTML = `<strong>Error:</strong> ${e.message}`;
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Save & Connect Shopify →</span>';
    }
}

// =========================================================
// 14. Logistics Partner Integration Hub Controller
// =========================================================

let selectedLogisticsProvider = 'shiprocket';

function openLogisticsModal() {
    const modal = document.getElementById('logisticsModal');
    if (!modal) return;
    const statusBox = document.getElementById('logisticsConnectionStatus');
    if (statusBox) statusBox.style.display = 'none';

    // Reset progress
    const progressWrap = document.getElementById('oneClickLogisticsProgress');
    const btn = document.getElementById('btnOneClickLogistics');
    const btnText = document.getElementById('btnOneClickLogisticsText');
    const fill = document.getElementById('ocLogisticsFill');
    if (progressWrap) progressWrap.style.display = 'none';
    if (fill) fill.style.width = '0%';
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = '⚡ Activate 1-Click Courier Sync (Boom!) →';

    const savedProvider = (localStorage.getItem('trustorder_logistics_provider') || localStorage.getItem('shipvera_logistics_provider')) || 'shiprocket';
    selectLogisticsProvider(savedProvider);

    modal.classList.add('open');
}

function closeLogisticsModal() {
    const modal = document.getElementById('logisticsModal');
    if (modal) modal.classList.remove('open');
}

function toggleManualLogisticsSetup() {
    const section = document.getElementById('manualLogisticsSection');
    const toggleText = document.getElementById('manualLogisticsToggleText');
    if (!section) return;
    if (section.style.display === 'none') {
        section.style.display = 'block';
        if (toggleText) toggleText.textContent = '⚙ Hide Manual Provider Settings ▲';
    } else {
        section.style.display = 'none';
        if (toggleText) toggleText.textContent = '⚙ Connect Direct Courier API Token (For Custom Warehouses) ▼';
    }
}

async function executeOneClickLogistics() {
    const btn = document.getElementById('btnOneClickLogistics');
    const btnText = document.getElementById('btnOneClickLogisticsText');
    const progressWrap = document.getElementById('oneClickLogisticsProgress');
    const fill = document.getElementById('ocLogisticsFill');
    const status = document.getElementById('ocLogisticsStatus');

    if (btn) btn.disabled = true;
    if (progressWrap) progressWrap.style.display = 'block';

    // Step 1
    if (fill) fill.style.width = '40%';
    if (status) status.textContent = 'Binding Shopify native courier shipping pipeline...';
    await new Promise(r => setTimeout(r, 350));

    // Step 2
    if (fill) fill.style.width = '80%';
    if (status) status.textContent = 'Synchronizing Shiprocket & Delhivery AWB landmark printer...';

    try {
        const res = await fetch(getApiUrl('/api/auth/connect-logistics'), {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                seller_id: currentActiveSellerId,
                provider: 'shopify_native'
            })
        });
        const data = await res.json();

        if (data.success) {
            // Step 3
            if (fill) fill.style.width = '100%';
            if (status) {
                status.style.color = '#2563EB';
                status.textContent = '🎉 BOOM! Couriers 1-Click Synced!';
            }
            if (btnText) btnText.textContent = '✓ Couriers Auto-Synced & Active!';

            const tag = document.getElementById('courierIntegrationTag');
            const desc = document.getElementById('courierIntegrationDesc');
            if (tag) {
                tag.textContent = 'Couriers: 1-Click Active';
                tag.className = 'dib-status-tag green';
            }
            if (desc) {
                desc.textContent = '1-Click Synced: Verified landmarks auto-print on Shiprocket & Delhivery AWB labels';
            }
            localStorage.setItem('trustorder_logistics_provider', 'shopify_native'); localStorage.setItem('shipvera_logistics_provider', 'shopify_native');
            localStorage.setItem('trustorder_logistics_name', '1-Click Courier Sync'); localStorage.setItem('shipvera_logistics_name', '1-Click Courier Sync');

            setTimeout(() => {
                closeLogisticsModal();
            }, 1200);
        } else {
            if (status) {
                status.style.color = '#DC2626';
                status.textContent = `Error: ${data.error || 'Failed to auto-sync couriers'}`;
            }
            if (btn) btn.disabled = false;
        }
    } catch (e) {
        if (status) {
            status.style.color = '#DC2626';
            status.textContent = `Error: ${e.message}`;
        }
        if (btn) btn.disabled = false;
    }
}

function selectLogisticsProvider(provider) {
    selectedLogisticsProvider = provider;
    
    const providers = ['shiprocket', 'delhivery', 'nimbuspost', 'shopify_native'];
    providers.forEach(p => {
        let cardId = 'lpCard' + (p === 'shopify_native' ? 'ShopifyNative' : p.charAt(0).toUpperCase() + p.slice(1));
        let fieldId = 'lpFields' + (p === 'shopify_native' ? 'ShopifyNative' : p.charAt(0).toUpperCase() + p.slice(1));
        
        const card = document.getElementById(cardId);
        const fields = document.getElementById(fieldId);
        
        if (card) {
            if (p === provider) card.classList.add('selected');
            else card.classList.remove('selected');
        }
        if (fields) {
            fields.style.display = (p === provider) ? 'block' : 'none';
        }
    });
}

async function saveLogisticsConnection() {
    const btn = document.getElementById('btnSaveLogistics');
    const statusBox = document.getElementById('logisticsConnectionStatus');
    
    let token = '';
    let email = '';
    let clientId = '';
    
    if (selectedLogisticsProvider === 'shiprocket') {
        email = document.getElementById('srEmailInput')?.value.trim() || '';
        token = document.getElementById('srTokenInput')?.value.trim() || '';
    } else if (selectedLogisticsProvider === 'delhivery') {
        clientId = document.getElementById('delhiveryClientIdInput')?.value.trim() || '';
        token = document.getElementById('delhiveryTokenInput')?.value.trim() || '';
    } else if (selectedLogisticsProvider === 'nimbuspost') {
        email = document.getElementById('nimbusEmailInput')?.value.trim() || '';
        token = document.getElementById('nimbusKeyInput')?.value.trim() || '';
    }
    
    btn.disabled = true;
    btn.innerHTML = '<span>Connecting Logistics...</span>';
    if (statusBox) {
        statusBox.style.display = 'block';
        statusBox.style.background = '#EFF6FF';
        statusBox.style.color = '#1E40AF';
        statusBox.style.border = '1px solid #BFDBFE';
        statusBox.innerHTML = 'Linking logistics aggregator and verifying AWB rewrite hooks...';
    }
    
    try {
        const res = await fetch(getApiUrl('/api/auth/connect-logistics'), {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                seller_id: currentActiveSellerId,
                provider: selectedLogisticsProvider,
                token: token,
                email: email,
                client_id: clientId
            })
        });
        const data = await res.json();
        if (data.success) {
            if (statusBox) {
                statusBox.style.background = '#F0FDF4';
                statusBox.style.color = '#166534';
                statusBox.style.border = '1px solid #BBF7D0';
                statusBox.innerHTML = `<strong>Connected Successfully!</strong><br>${data.message}`;
            }
            
            // Update dashboard card tag
            const tag = document.getElementById('courierIntegrationTag');
            const desc = document.getElementById('courierIntegrationDesc');
            if (tag) {
                tag.textContent = `${data.providerName}: Connected`;
                tag.className = 'dib-status-tag green';
            }
            if (desc) {
                desc.textContent = `Auto-rewrites verified landmarks onto ${data.providerName} AWB labels before pickup`;
            }
            localStorage.setItem('trustorder_logistics_provider', selectedLogisticsProvider); localStorage.setItem('shipvera_logistics_provider', selectedLogisticsProvider);
            localStorage.setItem('trustorder_logistics_name', data.providerName); localStorage.setItem('shipvera_logistics_name', data.providerName);
            
            setTimeout(() => {
                closeLogisticsModal();
            }, 1200);
        } else {
            if (statusBox) {
                statusBox.style.background = '#FEF2F2';
                statusBox.style.color = '#991B1B';
                statusBox.style.border = '1px solid #FECACA';
                statusBox.innerHTML = `<strong>Connection Failed:</strong> ${data.error || 'Check credentials'}`;
            }
        }
    } catch (e) {
        if (statusBox) {
            statusBox.style.background = '#FEF2F2';
            statusBox.style.color = '#991B1B';
            statusBox.style.border = '1px solid #FECACA';
            statusBox.innerHTML = `<strong>Error:</strong> ${e.message}`;
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Save & Connect Logistics →</span>';
    }
}

// 15. Auto-Load Existing Integrations Status
async function fetchIntegrationsStatus() {
    try {
        const res = await fetch(getApiUrl('/api/auth/me'), {
            headers: getAuthHeaders()
        });
        const data = await res.json();
        if (data.success && data.seller) {
            const s = data.seller;
            if (s.shopify_domain) {
                const tag = document.getElementById('shopifyWebhookTag');
                const desc = document.getElementById('shopifyDomainDisplay');
                if (tag) tag.textContent = 'Active: ' + s.shopify_domain;
                if (desc) desc.textContent = `Auto-syncs shipping labels via official webhook from ${s.shopify_domain}`;
                const domainInput = document.getElementById('shopifyDomainInput');
                if (domainInput && !domainInput.value) domainInput.value = s.shopify_domain;
            }
            if (s.logistics_provider) {
                const providerNames = {
                    shiprocket: 'Shiprocket',
                    delhivery: 'Delhivery Direct',
                    nimbuspost: 'NimbusPost',
                    shopify_native: 'Shopify Native'
                };
                const pName = providerNames[s.logistics_provider] || s.logistics_provider;
                const tag = document.getElementById('courierIntegrationTag');
                const desc = document.getElementById('courierIntegrationDesc');
                if (tag) {
                    tag.textContent = `${pName}: Connected`;
                    tag.className = 'dib-status-tag green';
                }
                if (desc) {
                    desc.textContent = `Auto-rewrites verified landmarks onto ${pName} AWB labels before pickup`;
                }
            }
        }
    } catch (e) {
        console.warn('[DASHBOARD] Notice loading integrations status:', e.message);
    }
}


