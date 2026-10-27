// ============================================
// TRUSTORDER — Core Interactive Engine
// Voice AI Waveform, RTO Calculator, Waitlist
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initScrollAnimations();
    initNavbarScroll();
    initNumberCounters();
    initWaveform();
    initCardSpotlight();
    updateCalculator();
});

// ---------- 1. Scroll-Driven Fade In ----------
function initScrollAnimations() {
    const elements = document.querySelectorAll('.animate-on-scroll');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -40px 0px'
    });

    elements.forEach(el => observer.observe(el));
}

// ---------- 2. Navbar Blur on Scroll ----------
function initNavbarScroll() {
    const navbar = document.getElementById('navbar');
    if (!navbar) return;

    window.addEventListener('scroll', () => {
        if (window.scrollY > 30) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    }, { passive: true });
}

// Mobile Navigation Toggle
function toggleMobileNav() {
    const navLinks = document.getElementById('navLinks');
    if (navLinks) {
        navLinks.classList.toggle('nav-mobile-open');
    }
}

// ---------- 3. Metric Counter Animations ----------
function initNumberCounters() {
    const counters = document.querySelectorAll('.counter');
    let hasAnimated = false;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !hasAnimated) {
                hasAnimated = true;
                counters.forEach(counter => {
                    const target = parseInt(counter.getAttribute('data-target'), 10);
                    animateCounter(counter, target, 1400);
                });
            }
        });
    }, { threshold: 0.3 });

    const targetSection = document.querySelector('.hero-metrics-grid');
    if (targetSection) {
        observer.observe(targetSection);
    }
}

function animateCounter(el, target, duration) {
    let start = 0;
    const stepTime = 16;
    const steps = duration / stepTime;
    const increment = target / steps;

    const timer = setInterval(() => {
        start += increment;
        if (start >= target) {
            el.textContent = target.toLocaleString('en-IN');
            clearInterval(timer);
        } else {
            el.textContent = Math.floor(start).toLocaleString('en-IN');
        }
    }, stepTime);
}

// ---------- 4. Voice Call Waveform Visualizer ----------
function initWaveform() {
    const container = document.getElementById('waveformBars');
    if (!container) return;

    container.innerHTML = '';
    const barCount = 28;
    const defaultHeights = [10, 16, 8, 22, 14, 28, 12, 18, 30, 16, 24, 10, 20, 32, 14, 26, 12, 18, 28, 14, 22, 8, 16, 24, 12, 18, 10, 14];

    for (let i = 0; i < barCount; i++) {
        const bar = document.createElement('div');
        bar.className = 'waveform-bar';
        bar.style.height = `${defaultHeights[i % defaultHeights.length]}px`;
        container.appendChild(bar);
    }
}

// ====================================================
// 4. Voice AI Simulator & 3-Decision Agent Engine
// ====================================================

let activeDecisionKey = 'decisionA';
let isAudioPlaying = false;
let audioSeconds = 0;
let audioTimerInterval = null;
let waveformInterval = null;

const DECISION_CONFIG = {
    decisionA: {
        totalDuration: 20,
        orderHtml: '<span class="pill-badge">COD #9284</span><span class="pill-val">₹1,299 • Sneakers</span>',
        initialStatus: 'Ready • Click Play to Listen',
        runningStatus: '🔴 Live Call with Rahul (Rohtak)...',
        completedStatus: '✅ Verified: Plot 42, Behind Sharma Dairy',
        outcomeIcon: '✅',
        outcomeText: 'Auto-Enriched Landmark: <strong>Plot 42, Behind Sharma Dairy</strong>',
        outcomeClass: 'outcome-success',
        riskText: 'Risk Score: <strong>5/100 (Safe COD)</strong>',
        streamId: 'dialogueStreamA',
        actionPaneId: 'actionPaneA',
        tabBtnId: 'tabBtnA'
    },
    decisionB: {
        totalDuration: 14,
        orderHtml: '<span class="pill-badge">COD #9288</span><span class="pill-val">₹2,499 • Leather Jacket</span>',
        initialStatus: 'Ready • Click Play to Listen',
        runningStatus: '🔴 Interrogating Vikas (Village Rampur)...',
        completedStatus: '🛑 Cancelled on Shopify • Zero Freight Burned',
        outcomeIcon: '🛡️',
        outcomeText: 'Fake / Impulse Buyer Blocked • <strong>Saved ₹180 Courier Freight</strong>',
        outcomeClass: 'outcome-danger',
        riskText: 'Risk Score: <strong>92/100 (Impulse Fake)</strong>',
        streamId: 'dialogueStreamB',
        actionPaneId: 'actionPaneB',
        tabBtnId: 'tabBtnB'
    },
    decisionC: {
        totalDuration: 13,
        orderHtml: '<span class="pill-badge">COD #9291</span><span class="pill-val">₹1,799 • Smart Watch</span>',
        initialStatus: 'Ready • Click Play to Listen',
        runningStatus: '⚡ Unanswered • Firing WhatsApp Voice Note & UPI Lock...',
        completedStatus: '⚡ WhatsApp Audio Sent • ₹19 UPI Intent Locked',
        outcomeIcon: '⚡',
        outcomeText: 'Instant Fallback • <strong>Buyer Paid ₹19 Token via PhonePe</strong>',
        outcomeClass: 'outcome-amber',
        riskText: 'Status: <strong>Locked with GPS Location</strong>',
        streamId: 'dialogueStreamC',
        actionPaneId: 'actionPaneC',
        tabBtnId: 'tabBtnC'
    }
};

window.switchDecision = function(decisionKey) {
    if (!DECISION_CONFIG[decisionKey]) return;
    
    // Stop any ongoing playback
    if (isAudioPlaying) {
        stopAudioPlayback();
    }

    activeDecisionKey = decisionKey;
    const conf = DECISION_CONFIG[decisionKey];

    // 1. Switch active tab buttons
    ['tabBtnA', 'tabBtnB', 'tabBtnC'].forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            const isActive = (btnId === conf.tabBtnId);
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        }
    });

    // 2. Switch dialogue streams
    ['dialogueStreamA', 'dialogueStreamB', 'dialogueStreamC'].forEach(streamId => {
        const stream = document.getElementById(streamId);
        if (stream) {
            stream.classList.toggle('active', streamId === conf.streamId);
            // Clear any highlighted speech
            stream.querySelectorAll('.dialogue-line').forEach(line => line.classList.remove('active-speech'));
        }
    });

    // 3. Switch right-side action preview panes
    ['actionPaneA', 'actionPaneB', 'actionPaneC'].forEach(paneId => {
        const pane = document.getElementById(paneId);
        if (pane) {
            pane.classList.toggle('active', paneId === conf.actionPaneId);
        }
    });

    // 4. Update caller and outcome metadata
    const orderPill = document.getElementById('callOrderPill');
    if (orderPill) orderPill.innerHTML = conf.orderHtml;

    const statusText = document.getElementById('callStatusText');
    if (statusText) statusText.textContent = conf.initialStatus;

    const timerEl = document.getElementById('audioTimer');
    if (timerEl) {
        const durFormatted = conf.totalDuration < 10 ? `0${conf.totalDuration}` : conf.totalDuration;
        timerEl.textContent = `00:00 / 00:${durFormatted}`;
    }

    const outcomePill = document.getElementById('outcomePill');
    const outcomeIcon = document.getElementById('outcomeIcon');
    const outcomeLabel = document.getElementById('outcomeLabel');
    const outcomeRiskTag = document.getElementById('outcomeRiskTag');

    if (outcomeIcon) outcomeIcon.textContent = conf.outcomeIcon;
    if (outcomeLabel) outcomeLabel.innerHTML = conf.outcomeText;
    if (outcomeRiskTag) outcomeRiskTag.innerHTML = conf.riskText;
    if (outcomePill) {
        outcomePill.className = `outcome-pill ${conf.outcomeClass}`;
    }

    // Reset visualizer bars
    const bars = document.querySelectorAll('.waveform-bar');
    bars.forEach(bar => {
        bar.classList.remove('active');
        bar.style.height = '12px';
    });
};

function stopAudioPlayback() {
    isAudioPlaying = false;
    clearInterval(audioTimerInterval);
    clearInterval(waveformInterval);
    audioSeconds = 0;

    const playBtn = document.getElementById('playAudioBtn');
    const playIcon = document.getElementById('playIcon');
    if (playBtn) playBtn.classList.remove('playing');
    if (playIcon) playIcon.textContent = '▶';

    const bars = document.querySelectorAll('.waveform-bar');
    bars.forEach(bar => bar.classList.remove('active'));

    const currentConf = DECISION_CONFIG[activeDecisionKey];
    const stream = document.getElementById(currentConf.streamId);
    if (stream) {
        stream.querySelectorAll('.dialogue-line').forEach(line => line.classList.remove('active-speech'));
    }
}

window.toggleAudioDemo = function() {
    const playBtn = document.getElementById('playAudioBtn');
    const playIcon = document.getElementById('playIcon');
    const timerEl = document.getElementById('audioTimer');
    const statusText = document.getElementById('callStatusText');
    const bars = document.querySelectorAll('.waveform-bar');
    const currentConf = DECISION_CONFIG[activeDecisionKey];
    const activeStream = document.getElementById(currentConf.streamId);
    const dialogueLines = activeStream ? activeStream.querySelectorAll('.dialogue-line') : [];

    if (!playBtn) return;

    if (isAudioPlaying) {
        // Pause playback
        isAudioPlaying = false;
        clearInterval(audioTimerInterval);
        clearInterval(waveformInterval);
        playBtn.classList.remove('playing');
        playIcon.textContent = '▶';
        if (statusText) statusText.textContent = 'Call Paused';
        bars.forEach(bar => bar.classList.remove('active'));
    } else {
        // Start playback
        isAudioPlaying = true;
        playBtn.classList.add('playing');
        playIcon.textContent = '⏸';
        if (statusText) statusText.textContent = currentConf.runningStatus;

        playSyntheticVoiceChime();

        // Waveform dynamic animation
        waveformInterval = setInterval(() => {
            bars.forEach(bar => {
                const randomScale = Math.random() * 32 + 6;
                bar.style.height = `${randomScale}px`;
                bar.classList.add('active');
            });
        }, 120);

        // Progress timer & dialogue sync
        audioTimerInterval = setInterval(() => {
            audioSeconds++;

            const currentFormatted = audioSeconds < 10 ? `00:0${audioSeconds}` : `00:${audioSeconds}`;
            const totalFormatted = currentConf.totalDuration < 10 ? `00:0${currentConf.totalDuration}` : `00:${currentConf.totalDuration}`;
            if (timerEl) timerEl.textContent = `${currentFormatted} / ${totalFormatted}`;

            // Highlight synchronized dialogue line in active stream
            dialogueLines.forEach(line => {
                const start = parseInt(line.getAttribute('data-start'), 10);
                const end = parseInt(line.getAttribute('data-end'), 10);

                if (audioSeconds >= start && audioSeconds < end) {
                    line.classList.add('active-speech');
                    line.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                } else if (audioSeconds >= end) {
                    line.classList.remove('active-speech');
                }
            });

            // Live Decision-specific action highlights
            if (activeDecisionKey === 'decisionA') {
                if (audioSeconds === 13) {
                    const landmarkTag = document.querySelector('.clc-landmark-tag');
                    if (landmarkTag) {
                        landmarkTag.classList.remove('highlight-pulse');
                        void landmarkTag.offsetWidth;
                        landmarkTag.classList.add('highlight-pulse');
                    }
                }
            } else if (activeDecisionKey === 'decisionB') {
                if (audioSeconds === 9) {
                    const netBlock = document.querySelector('.crc-metric-block.highlight');
                    if (netBlock) {
                        netBlock.classList.remove('highlight-pulse');
                        void netBlock.offsetWidth;
                        netBlock.classList.add('highlight-pulse');
                    }
                }
            } else if (activeDecisionKey === 'decisionC') {
                if (audioSeconds === 10) {
                    const waStatus = document.querySelector('.wa-status-pill');
                    if (waStatus) {
                        waStatus.classList.remove('highlight-pulse');
                        void waStatus.offsetWidth;
                        waStatus.classList.add('highlight-pulse');
                    }
                }
            }

            // Call Completed
            if (audioSeconds >= currentConf.totalDuration) {
                clearInterval(audioTimerInterval);
                clearInterval(waveformInterval);
                isAudioPlaying = false;
                audioSeconds = 0;
                playBtn.classList.remove('playing');
                playIcon.textContent = '🔄';
                if (statusText) statusText.textContent = currentConf.completedStatus;
                bars.forEach(bar => {
                    bar.classList.remove('active');
                    bar.style.height = '12px';
                });
                dialogueLines.forEach(line => line.classList.remove('active-speech'));

                // Final celebration pulse on verified element
                if (activeDecisionKey === 'decisionA') {
                    const verifiedTag = document.querySelector('.clc-tag-verified');
                    if (verifiedTag) {
                        verifiedTag.classList.remove('highlight-pulse');
                        void verifiedTag.offsetWidth;
                        verifiedTag.classList.add('highlight-pulse');
                    }
                } else if (activeDecisionKey === 'decisionB') {
                    const cancelBadge = document.querySelector('.crc-badge');
                    if (cancelBadge) {
                        cancelBadge.classList.remove('highlight-pulse');
                        void cancelBadge.offsetWidth;
                        cancelBadge.classList.add('highlight-pulse');
                    }
                }
            }
        }, 1000);
    }
};

function playSyntheticVoiceChime() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);

        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
    } catch (e) {
        // Graceful fallback
    }
}

// ---------- 5. Institutional RTO Simulator Engine ----------
window.updateCalculator = function() {
    const ordersSlider = document.getElementById('ordersSlider');
    const rtoSlider = document.getElementById('rtoSlider');

    const ordersVal = document.getElementById('ordersVal');
    const rtoVal = document.getElementById('rtoVal');
    const burningAmount = document.getElementById('burningAmount');
    const burningOrders = document.getElementById('burningOrders');
    const savedAmount = document.getElementById('savedAmount');
    const netRoiText = document.getElementById('netRoiText');
    const calcCtaBtn = document.getElementById('calcCtaBtn');

    if (!ordersSlider || !rtoSlider) return;

    const orders = parseInt(ordersSlider.value, 10);
    const rtoRate = parseInt(rtoSlider.value, 10);

    const lossPerReturn = 180; // Avg ₹ lost per forward + reverse RTO penalty
    const returnedOrders = Math.round(orders * (rtoRate / 100));
    const monthlyBurn = returnedOrders * lossPerReturn;

    // TrustOrder cuts RTO by 70%
    const monthlySavings = Math.round(monthlyBurn * 0.70);
    const toolCost = orders * 6; // ₹6 per verified order
    const netProfit = monthlySavings - toolCost;
    const roiMultiplier = (monthlySavings / (toolCost || 1)).toFixed(1);

    const fmtBurn = '₹' + monthlyBurn.toLocaleString('en-IN');
    const fmtSaved = '₹' + monthlySavings.toLocaleString('en-IN');

    if (ordersVal) ordersVal.textContent = `${orders.toLocaleString('en-IN')} orders/mo`;
    if (rtoVal) rtoVal.textContent = `${rtoRate}%`;
    if (burningAmount) burningAmount.textContent = fmtBurn;
    if (burningOrders) burningOrders.textContent = `${returnedOrders.toLocaleString('en-IN')} failed deliveries/mo`;
    if (savedAmount) savedAmount.textContent = fmtSaved;
    if (netRoiText) netRoiText.textContent = `${roiMultiplier}x ROI • ₹${netProfit.toLocaleString('en-IN')} net margin recovered`;
    if (calcCtaBtn) {
        calcCtaBtn.innerHTML = `<span>Claim Your ${fmtSaved} Monthly Savings →</span>`;
    }
};

// ---------- 6. Waitlist Submission Handlers ----------
window.handleInlineWaitlist = function(event) {
    event.preventDefault();
    const phoneInput = document.getElementById('inlinePhone');
    if (!phoneInput || !phoneInput.value.trim()) return;

    const phone = phoneInput.value.trim();
    saveWaitlistEntry({ phone, source: 'hero_inline', date: new Date().toISOString() });

    // Send to live TrustOrder backend
    const waitlistUrl = (typeof window !== 'undefined' && window.getApiUrl) ? window.getApiUrl('/api/waitlist') : '/api/waitlist';
    fetch(waitlistUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, source: 'hero_inline' })
    }).catch(() => {});

    const cleanPhone = phone.replace(/[^\d]/g, '').slice(-10);
    window.location.href = `/signup?phone=${encodeURIComponent(cleanPhone)}`;
};

window.handleWaitlist = function(event) {
    event.preventDefault();
    const name = document.getElementById('name')?.value || '';
    const phone = document.getElementById('phone')?.value || '';
    const email = document.getElementById('email')?.value || '';
    const volume = document.getElementById('volume')?.value || '';

    saveWaitlistEntry({ name, phone, email, volume, source: 'main_form', date: new Date().toISOString() });

    // Send to live TrustOrder backend
    const waitlistUrl = (typeof window !== 'undefined' && window.getApiUrl) ? window.getApiUrl('/api/waitlist') : '/api/waitlist';
    fetch(waitlistUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, email, volume, source: 'main_form' })
    }).catch(() => {});

    const form = document.getElementById('waitlistForm');
    const successMsg = document.getElementById('waitlistSuccess');
    const actionRow = document.getElementById('waitlistActionRow');

    if (form && successMsg) {
        form.style.display = 'none';
        successMsg.style.display = 'block';

        if (actionRow) {
            const cleanPhone = phone.replace(/[^\d]/g, '').slice(-10);
            actionRow.innerHTML = `
                <a href="/signup?name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}&phone=${encodeURIComponent(cleanPhone)}" class="btn-primary btn-glow" style="display: inline-flex; align-items: center; gap: 8px; text-decoration: none; padding: 13px 26px; border-radius: 9px; font-weight: 700; font-size: 0.92rem;">
                    <span>Set Workspace Password & Enter Console →</span>
                </a>
            `;
        }
    }
};

function saveWaitlistEntry(entry) {
    try {
        const existing = JSON.parse(localStorage.getItem('trustorder_waitlist') || localStorage.getItem('shipvera_waitlist') || '[]');
        existing.push(entry);
        localStorage.setItem('trustorder_waitlist', JSON.stringify(existing));
        localStorage.setItem('shipvera_waitlist', JSON.stringify(existing));
    } catch (e) {
        // Storage fallback
    }
}

// ---------- 7. Interactive Linear-Style Card Spotlight ----------
function initCardSpotlight() {
    const cards = document.querySelectorAll('.metric-card, .integration-item, .calculator-card, .pricing-card, .awb-transform-card, .audio-demo-card');
    cards.forEach(card => {
        card.addEventListener('mousemove', e => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            card.style.setProperty('--mouse-x', `${x}px`);
            card.style.setProperty('--mouse-y', `${y}px`);
        });
    });
}

