/**
 * Shipvera Dashboard Interactive Engine
 * Professional Enterprise Operations Console
 * Connected to /api/orders, /api/analytics, /api/wallet, /api/calls/trigger
 */

let allOrders = [];
let activeFilter = 'all';
let selectedPack = 'growth';
let selectedPackAmount = 2999;
let currentModalOrderId = null;
let currentActiveBrand = 'Snitch Apparel & Streetwear';

document.addEventListener('DOMContentLoaded', () => {
    fetchDashboardData();
    checkTraiCallingWindow();
    
    // Auto-refresh orders every 10 seconds
    setInterval(fetchOrders, 10000);
    // Refresh TRAI window status every minute
    setInterval(checkTraiCallingWindow, 60000);

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
        fetchOrders()
    ]);
}

// ---------- 1. Analytics & Metrics ----------
async function fetchAnalytics() {
    try {
        const res = await fetch('/api/analytics');
        const data = await res.json();
        if (data.success && data.analytics) {
            const a = data.analytics;
            document.getElementById('metricTotalOrders').textContent = a.total_orders_protected.toLocaleString('en-IN');
            document.getElementById('metricMoneySaved').textContent = `₹${a.rto_money_saved_inr.toLocaleString('en-IN')}`;
            document.getElementById('metricRtoCut').textContent = `${a.rto_reduction_rate_pct}%`;
            
            if (!currentActiveBrand) {
                document.getElementById('storeName').textContent = a.seller_brand || 'Snitch Apparel & Streetwear';
            }

            if (data.telemetry) {
                renderRtoChart(data.telemetry);
                renderResolutionBreakdown(data.telemetry);
            }
        }
    } catch (e) {
        console.error('Error fetching analytics:', e);
    }
}

// Render Professional Stripe-Style SVG RTO Reduction Curve
function renderRtoChart(telemetry) {
    const wrap = document.getElementById('rtoChartWrap');
    if (!wrap) return;

    const points = telemetry.rto_drop_timeline || [
        { label: 'Baseline', rto: 38.2, saved: 0 },
        { label: 'Sanitizer', rto: 28.5, saved: 14400 },
        { label: 'Voice AI', rto: 19.8, saved: 32600 },
        { label: 'Trust Lock', rto: 14.1, saved: 58200 },
        { label: 'Autopilot', rto: 11.2, saved: 78400 }
    ];

    const width = 560;
    const height = 180;
    const padding = { top: 20, right: 30, bottom: 30, left: 45 };

    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const maxRto = 40;
    const minRto = 0;

    const getX = (idx) => padding.left + (idx * (chartW / (points.length - 1)));
    const getY = (val) => padding.top + ((maxRto - val) / (maxRto - minRto)) * chartH;

    // Build SVG path
    let pathD = `M ${getX(0)} ${getY(points[0].rto)}`;
    for (let i = 1; i < points.length; i++) {
        const prevX = getX(i - 1);
        const prevY = getY(points[i - 1].rto);
        const currX = getX(i);
        const currY = getY(points[i].rto);
        const cpX1 = prevX + (currX - prevX) / 2;
        const cpY1 = prevY;
        const cpX2 = prevX + (currX - prevX) / 2;
        const cpY2 = currY;
        pathD += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${currX} ${currY}`;
    }

    const areaD = `${pathD} L ${getX(points.length - 1)} ${padding.top + chartH} L ${getX(0)} ${padding.top + chartH} Z`;

    const svgHtml = `
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
            <defs>
                <linearGradient id="rtoGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#058A5E" stop-opacity="0.22" />
                    <stop offset="100%" stop-color="#058A5E" stop-opacity="0.0" />
                </linearGradient>
            </defs>

            <!-- Horizontal Gridlines -->
            <line x1="${padding.left}" y1="${getY(40)}" x2="${width - padding.right}" y2="${getY(40)}" stroke="#F1EFEA" stroke-width="1" />
            <line x1="${padding.left}" y1="${getY(30)}" x2="${width - padding.right}" y2="${getY(30)}" stroke="#F1EFEA" stroke-width="1" />
            <line x1="${padding.left}" y1="${getY(20)}" x2="${width - padding.right}" y2="${getY(20)}" stroke="#F1EFEA" stroke-width="1" />
            <line x1="${padding.left}" y1="${getY(10)}" x2="${width - padding.right}" y2="${getY(10)}" stroke="#F1EFEA" stroke-width="1" />

            <!-- Y Axis Labels -->
            <text x="${padding.left - 8}" y="${getY(40) + 4}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#A1A1AA" text-anchor="end">40%</text>
            <text x="${padding.left - 8}" y="${getY(30) + 4}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#A1A1AA" text-anchor="end">30%</text>
            <text x="${padding.left - 8}" y="${getY(20) + 4}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#A1A1AA" text-anchor="end">20%</text>
            <text x="${padding.left - 8}" y="${getY(10) + 4}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#A1A1AA" text-anchor="end">10%</text>

            <!-- Area Fill -->
            <path d="${areaD}" fill="url(#rtoGrad)" />

            <!-- Curve -->
            <path d="${pathD}" fill="none" stroke="#058A5E" stroke-width="2.5" stroke-linecap="round" />

            <!-- Baseline Reference Line (38.2%) -->
            <line x1="${padding.left}" y1="${getY(38.2)}" x2="${width - padding.right}" y2="${getY(38.2)}" stroke="#EF4444" stroke-width="1" stroke-dasharray="3 3" opacity="0.6" />

            <!-- Data Points -->
            ${points.map((p, i) => `
                <g class="chart-point-group">
                    <circle cx="${getX(i)}" cy="${getY(p.rto)}" r="4.5" fill="#FFFFFF" stroke="#058A5E" stroke-width="2" />
                    <text x="${getX(i)}" y="${getY(p.rto) - 8}" font-size="10" font-weight="600" font-family="'JetBrains Mono', monospace" fill="#18181B" text-anchor="middle">${p.rto}%</text>
                    <text x="${getX(i)}" y="${height - 8}" font-size="9" font-family="'Inter', sans-serif" fill="#71717A" text-anchor="middle">${p.label.split(' ')[0]}</text>
                </g>
            `).join('')}
        </svg>
    `;

    wrap.innerHTML = svgHtml;
}

// Render Address Resolution Breakdown
function renderResolutionBreakdown(telemetry) {
    const list = document.getElementById('resolutionList');
    if (!list) return;

    const data = telemetry.address_resolution_distribution || [
        { category: 'Landmark Appended via Voice AI', percentage: 64, count: 320, color: '#058A5E' },
        { category: 'House / Plot Number Corrected', percentage: 22, count: 110, color: '#0D9488' },
        { category: 'Buyer Cancellation (Blocked RTO)', percentage: 14, count: 70, color: '#DC2626' }
    ];

    list.innerHTML = data.map(d => `
        <div class="rbl-row">
            <div class="rbl-top">
                <span>${d.category}</span>
                <span style="color: ${d.color}; font-weight: 600; font-family: var(--font-mono);">${d.percentage}% (${d.count})</span>
            </div>
            <div class="rbl-track">
                <div class="rbl-bar" style="width: ${d.percentage}%; background: ${d.color};"></div>
            </div>
        </div>
    `).join('');
}

// ---------- 2. Wallet & Balance ----------
async function fetchWallet() {
    try {
        const res = await fetch('/api/wallet');
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
        const res = await fetch('/api/orders');
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
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 48px 20px; color: #71717A;">
                    <div style="margin-bottom: 6px; font-weight: 600; color: #374151;">No orders in this view</div>
                    <p style="margin: 0; font-size: 0.8rem;">Filter "${activeFilter}" returned zero matching records.</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(o => {
        const isShopify = o.source === 'shopify';
        const sourceIcon = isShopify ? 'assets/logos/shopify.svg' : 'assets/logos/whatsapp.svg';
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

function switchStore(brandName, domain) {
    currentActiveBrand = brandName;
    document.getElementById('storeName').textContent = brandName;
    
    document.querySelectorAll('.sdm-item').forEach(item => {
        item.classList.remove('active');
        if (item.querySelector('strong') && item.querySelector('strong').textContent === brandName) {
            item.classList.add('active');
        }
    });

    const menu = document.getElementById('storeDropdownMenu');
    if (menu) menu.classList.remove('show');

    document.getElementById('liveCallDesc').textContent = `Standby for ${brandName}`;
}

function openAddStoreAlert() {
    const menu = document.getElementById('storeDropdownMenu');
    if (menu) menu.classList.remove('show');
    alert('Connect Store: Enter your Shopify myshopify.com domain in the onboarding settings to link additional stores.');
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
        const res = await fetch('/api/orders/quick-paste', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw_text: input.value.trim() })
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
        const res = await fetch('/api/webhooks/shopify/orders-create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
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
        const res = await fetch('/api/orders/trigger', {
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
        const res = await fetch(`/api/orders/${orderId}`);
        const data = await res.json();
        if (data.success && data.order) {
            const o = data.order;
            const logs = data.callLogs || [];
            const latestLog = logs[0] || {};

            modalTitle.textContent = `Call Record // ${o.buyer_name} (${o.external_order_id})`;
            modalSub.textContent = `${o.city || 'India'} • Recorded via Sarvam Bulbul Engine`;

            const transcript = latestLog.transcript || [
                { role: 'ai', speaker: 'Shipvera AI', text: `Namaste ${o.buyer_name} ji! Main ${currentActiveBrand} ke dispatch desk se Shipvera AI bol raha hoon. Aapka ₹${o.cod_amount} ka order pack ho gaya hai.` },
                { role: 'ai', speaker: 'Shipvera AI', text: `Bhaiya aapne address me '${o.raw_address}' likha hai par landmark missing hai. Aas-paas konsi dukaan ya mandir hai bata dijiye?` },
                { role: 'user', speaker: `Buyer (${o.buyer_name})`, text: 'Haan bhaiya, Bikaner sweets ke samne safed gate hai 2nd floor, wahi deliver kar dena.' },
                { role: 'ai', speaker: 'Shipvera AI', text: 'Acha note kar liya! 3-4 din me parcel mil jayega. Dhanyawad!' }
            ];

            stream.innerHTML = transcript.map(t => `
                <div class="t-bubble ${t.role === 'ai' ? 'ai' : 'user'}">
                    <span class="t-bubble-speaker">${t.speaker || (t.role === 'ai' ? 'Shipvera AI' : 'Customer')}</span>
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
    } catch (e) {}
}

// ---------- 10. Feature 4: ₹19 Trust Lock Modal ----------
function openTrustLockModal(orderId) {
    currentModalOrderId = orderId;
    const order = allOrders.find(o => o.id === orderId);
    if (!order) return;

    const remaining = Math.max(0, Number(order.cod_amount) - 19);
    const msg = `Hi ${order.buyer_name}, humne aapka ₹${order.cod_amount} ka parcel dispatch karne ke liye call kiya tha par connect nahi hua. Parcel hold na ho isliye bas ₹19 ka chota token UPI karke apna address lock kar dein. Baaki ₹${remaining} delivery pe hi dena hai!`;

    document.getElementById('tlWaMessage').textContent = msg;
    document.getElementById('tlRazorpayLink').textContent = `https://rzp.io/l/shipvera_tl_${order.id.slice(0, 6)}`;
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
        const res = await fetch('/api/webhooks/razorpay/payment-captured', {
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
        const res = await fetch('/api/wallet/recharge', {
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
