import { auth, database } from './firebase-config.js';
import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    ref,
    update,
    remove,
    push,
    set,
    onValue,
    get
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

const TEST_ORDER_CUTOFF_MS = Date.parse('2025-09-06T00:00:00Z');
const ORDER_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
const TRIAL_STATUSES = ['new', 'completed', 'contacted', 'archived'];

function normalizeTrialStatus(s) {
    // Back-compat: legacy 'qualified' is treated as 'completed'.
    const v = String(s || 'new');
    if (v === 'qualified') return 'completed';
    return v;
}

function instagramUrl(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    const handle = v.replace(/^@/, '').replace(/^instagram\.com\//i, '').replace(/^\/+/, '');
    if (!handle) return '';
    return `https://instagram.com/${handle}`;
}

function instagramDisplay(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) {
        try {
            const u = new URL(v);
            const path = u.pathname.replace(/^\/+|\/+$/g, '');
            return path ? `@${path}` : v;
        } catch (e) { return v; }
    }
    return v.startsWith('@') ? v : `@${v}`;
}

class AdminDashboard {
    constructor() {
        this.currentUser = null;
        this.activeView = 'orders';

        this.orders = [];
        this.clients = [];
        this.trialCampaigns = [];

        this.unsubscribers = [];

        // Orders UI state
        this.orderStatusTab = 'pending';
        this.orderLimit = 10;
        this.showStats = false;
        this.showTestOrders = false;
        this.orderClientFilter = null; // { id, name }

        // Trials UI state
        this.trialStatusTab = 'new';
        this.trialLimit = 10;
        this.showTrialStats = false;

        // Client UI state
        this.expandedOrderKey = null;

        this.init();
    }

    init() {
        this.setupAuthListener();
        this.setupEventListeners();
    }

    /* ============== AUTH ============== */

    setupAuthListener() {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                this.currentUser = user;
                this.showDashboard();
                this.subscribeAll();
            } else {
                this.currentUser = null;
                this.unsubscribeAll();
                this.showLogin();
            }
        });
    }

    async handleLogin() {
        const email = document.getElementById('adminEmail').value;
        const password = document.getElementById('adminPassword').value;
        const errorEl = document.getElementById('loginError');
        try {
            await signInWithEmailAndPassword(auth, email, password);
            errorEl.style.display = 'none';
        } catch (error) {
            console.error('Login error:', error);
            errorEl.textContent = 'Invalid email or password';
            errorEl.style.display = 'block';
        }
    }

    async handleLogout() {
        try { await signOut(auth); } catch (e) { console.error(e); }
    }

    showLogin() {
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('dashboardScreen').style.display = 'none';
    }

    showDashboard() {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('dashboardScreen').style.display = 'block';
        if (this.currentUser) {
            document.getElementById('adminUserInfo').textContent = this.currentUser.email;
        }
    }

    /* ============== EVENT WIRING ============== */

    setupEventListeners() {
        document.getElementById('loginForm').addEventListener('submit', (e) => { e.preventDefault(); this.handleLogin(); });
        document.getElementById('logoutBtn').addEventListener('click', () => this.handleLogout());

        document.querySelectorAll('.app-tab').forEach((btn) => {
            btn.addEventListener('click', () => this.switchView(btn.dataset.view));
        });

        // Orders
        document.getElementById('searchInput').addEventListener('input', () => this.renderOrders());
        document.getElementById('sortBy').addEventListener('change', () => this.renderOrders());
        document.getElementById('ordersLimitSelect').addEventListener('change', (e) => {
            this.orderLimit = e.target.value === 'all' ? Infinity : Number(e.target.value);
            this.renderOrders();
        });
        document.getElementById('refreshBtn').addEventListener('click', () => this.refreshOrders());
        document.getElementById('toggleStatsBtn').addEventListener('click', () => {
            this.showStats = !this.showStats;
            document.getElementById('ordersStats').hidden = !this.showStats;
        });
        document.getElementById('toggleTestOrdersBtn').addEventListener('click', () => {
            this.showTestOrders = !this.showTestOrders;
            document.getElementById('toggleTestOrdersBtn').classList.toggle('active', this.showTestOrders);
            this.renderOrders();
            this.updateOrderCounts();
        });
        document.querySelectorAll('#orderSubTabs .sub-tab').forEach((tab) => {
            tab.addEventListener('click', () => {
                this.orderStatusTab = tab.dataset.status;
                document.querySelectorAll('#orderSubTabs .sub-tab').forEach((t) => t.classList.toggle('active', t === tab));
                this.renderOrders();
            });
        });
        document.getElementById('clearOrderClientFilter').addEventListener('click', () => {
            this.orderClientFilter = null;
            this.updateOrderClientFilterBar();
            this.renderOrders();
        });

        // Clients
        document.getElementById('clientSearchInput').addEventListener('input', () => this.renderClients());
        document.getElementById('clientSortBy').addEventListener('change', () => this.renderClients());
        document.getElementById('addClientBtn').addEventListener('click', () => this.openClientSheet(null));
        document.getElementById('refreshClientsBtn').addEventListener('click', () => this.renderClients());

        // Trial leads
        document.getElementById('trialSearchInput').addEventListener('input', () => this.renderTrials());
        document.getElementById('trialSortBy').addEventListener('change', () => this.renderTrials());
        document.getElementById('trialGenreFilter').addEventListener('change', () => this.renderTrials());
        document.getElementById('trialLimitSelect').addEventListener('change', (e) => {
            this.trialLimit = e.target.value === 'all' ? Infinity : Number(e.target.value);
            this.renderTrials();
        });
        document.getElementById('trialRefreshBtn').addEventListener('click', () => this.renderTrials());
        document.getElementById('toggleTrialStatsBtn').addEventListener('click', () => {
            this.showTrialStats = !this.showTrialStats;
            document.getElementById('trialStats').hidden = !this.showTrialStats;
        });
        document.querySelectorAll('#trialSubTabs .sub-tab').forEach((tab) => {
            tab.addEventListener('click', () => {
                this.trialStatusTab = tab.dataset.status;
                document.querySelectorAll('#trialSubTabs .sub-tab').forEach((t) => t.classList.toggle('active', t === tab));
                this.renderTrials();
            });
        });

        // Sheets
        document.querySelectorAll('[data-sheet-close]').forEach((el) => el.addEventListener('click', () => this.closeSheet()));
        document.querySelectorAll('[data-confirm-close]').forEach((el) => el.addEventListener('click', () => this.closeConfirm()));

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeSheet();
                this.closeConfirm();
            }
        });
    }

    switchView(view) {
        this.activeView = view;
        document.querySelectorAll('.app-tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
        document.getElementById('ordersView').classList.toggle('active', view === 'orders');
        document.getElementById('clientsView').classList.toggle('active', view === 'clients');
        document.getElementById('trialCampaignsView').classList.toggle('active', view === 'trial-campaigns');
    }

    /* ============== DATA SUBSCRIPTIONS ============== */

    subscribeAll() {
        this.unsubscribeAll();

        // Orders: prefer realtime via Firebase SDK; fallback to API.
        const ordersRef = ref(database, 'orders');
        const offOrders = onValue(ordersRef, (snap) => {
            const val = snap.val() || {};
            this.orders = Object.entries(val).map(([key, data]) => ({ ...data, firebaseKey: key }));
            this.updateOrderStats();
            this.updateOrderCounts();
            this.renderOrders();
            document.getElementById('loadingIndicator').style.display = 'none';
        }, (err) => {
            console.warn('Realtime orders read failed, falling back to API', err);
            this.loadOrdersFromApi();
        });
        this.unsubscribers.push(offOrders);

        const clientsRef = ref(database, 'usmClients');
        const offClients = onValue(clientsRef, (snap) => {
            const val = snap.val() || {};
            this.clients = Object.entries(val).map(([key, data]) => ({ ...data, firebaseKey: key }));
            this.renderClients();
            this.renderOrders(); // re-render so client labels populate
        }, (err) => {
            console.warn('Realtime clients read failed', err);
        });
        this.unsubscribers.push(offClients);

        const trialRef = ref(database, 'trialCampaignSubmissions');
        const offTrial = onValue(trialRef, (snap) => {
            const val = snap.val() || {};
            this.trialCampaigns = Object.entries(val).map(([key, data]) => ({ ...data, firebaseKey: key }));
            this.updateTrialStats();
            this.updateTrialCounts();
            this.renderTrials();
            document.getElementById('trialLoadingIndicator').style.display = 'none';
        }, (err) => {
            console.warn('Realtime trial reads failed, falling back to API', err);
            this.loadTrialsFromApi();
        });
        this.unsubscribers.push(offTrial);
    }

    unsubscribeAll() {
        this.unsubscribers.forEach((off) => { try { off(); } catch (e) {} });
        this.unsubscribers = [];
    }

    async refreshOrders() {
        // Realtime listener already keeps things fresh, but provide a manual refresh hook.
        await this.loadOrdersFromApi();
    }

    async loadOrdersFromApi() {
        try {
            const res = await fetch('/api/get-orders');
            const result = await res.json();
            if (!res.ok || !result.success) throw new Error(result.message || 'Failed');
            this.orders = result.orders || [];
            this.updateOrderStats();
            this.updateOrderCounts();
            this.renderOrders();
        } catch (e) {
            console.error(e);
            this.toast('Failed to load orders', 'error');
        } finally {
            document.getElementById('loadingIndicator').style.display = 'none';
        }
    }

    async loadTrialsFromApi() {
        try {
            const res = await fetch('/api/get-trial-campaigns');
            const result = await res.json();
            if (!res.ok || !result.success) throw new Error(result.message || 'Failed');
            this.trialCampaigns = result.trialCampaigns || [];
            this.updateTrialStats();
            this.updateTrialCounts();
            this.renderTrials();
        } catch (e) {
            console.error(e);
            this.toast('Failed to load trial leads', 'error');
        } finally {
            document.getElementById('trialLoadingIndicator').style.display = 'none';
        }
    }

    /* ============== ORDERS ============== */

    isTestOrder(order) {
        const ts = this.orderTimestampMs(order);
        return ts > 0 && ts < TEST_ORDER_CUTOFF_MS;
    }

    orderTimestampMs(order) {
        const v = order.createdAt || order.timestamp;
        if (!v) return 0;
        if (typeof v === 'number') return v;
        const parsed = Date.parse(v);
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    visibleOrders() {
        return this.orders.filter((o) => this.showTestOrders || !this.isTestOrder(o));
    }

    updateOrderStats() {
        const visible = this.visibleOrders();
        const total = visible.reduce((s, o) => s + Number(o.amount || 0), 0);
        document.getElementById('totalRevenue').textContent = `$${total.toFixed(2)}`;
        document.getElementById('totalOrders').textContent = visible.length;
        document.getElementById('pendingOrders').textContent = visible.filter((o) => (o.serviceStatus || 'pending') === 'pending').length;
        document.getElementById('completedOrders').textContent = visible.filter((o) => o.serviceStatus === 'completed').length;
    }

    updateOrderCounts() {
        const visible = this.visibleOrders();
        const counts = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
        visible.forEach((o) => {
            const s = o.serviceStatus || 'pending';
            if (counts[s] !== undefined) counts[s]++;
        });
        document.getElementById('countPending').textContent = counts.pending;
        document.getElementById('countInProgress').textContent = counts.in_progress;
        document.getElementById('countCompleted').textContent = counts.completed;
        document.getElementById('countCancelled').textContent = counts.cancelled;
    }

    updateOrderClientFilterBar() {
        const bar = document.getElementById('orderClientFilterBar');
        const name = document.getElementById('orderClientFilterName');
        if (this.orderClientFilter) {
            bar.style.display = 'flex';
            name.textContent = this.orderClientFilter.name;
        } else {
            bar.style.display = 'none';
        }
    }

    renderOrders() {
        const list = document.getElementById('ordersList');
        const empty = document.getElementById('noOrdersMessage');
        const counter = document.getElementById('orderCounter');

        const search = document.getElementById('searchInput').value.toLowerCase().trim();
        const sortBy = document.getElementById('sortBy').value;

        let items = this.visibleOrders().filter((o) => (o.serviceStatus || 'pending') === this.orderStatusTab);

        if (this.orderClientFilter) {
            items = items.filter((o) => o.clientId === this.orderClientFilter.id);
        }

        if (search) {
            items = items.filter((o) =>
                String(o.fullName || '').toLowerCase().includes(search) ||
                String(o.email || '').toLowerCase().includes(search) ||
                String(o.phone || '').toLowerCase().includes(search) ||
                String(o.youtubeLink || '').toLowerCase().includes(search) ||
                String(o.orderID || '').toLowerCase().includes(search) ||
                String(o.clientName || '').toLowerCase().includes(search)
            );
        }

        items.sort((a, b) => {
            switch (sortBy) {
                case 'timestamp_asc': return this.orderTimestampMs(a) - this.orderTimestampMs(b);
                case 'amount_desc': return Number(b.amount || 0) - Number(a.amount || 0);
                case 'amount_asc': return Number(a.amount || 0) - Number(b.amount || 0);
                case 'timestamp_desc':
                default: return this.orderTimestampMs(b) - this.orderTimestampMs(a);
            }
        });

        const total = items.length;
        const limited = Number.isFinite(this.orderLimit) ? items.slice(0, this.orderLimit) : items;
        counter.textContent = limited.length === total ? `${total}` : `${limited.length} / ${total}`;

        if (limited.length === 0) {
            list.innerHTML = '';
            empty.style.display = 'block';
        } else {
            empty.style.display = 'none';
            list.innerHTML = limited.map((o) => this.orderCardHtml(o)).join('');
            this.bindOrderCardActions(list);
        }

        this.updateOrderClientFilterBar();
    }

    orderCardHtml(o) {
        const key = this.escapeAttribute(o.firebaseKey);
        const expanded = this.expandedOrderKey === o.firebaseKey;
        const time = this.formatRelative(this.orderTimestampMs(o));
        const ytUrl = this.safeUrl(o.youtubeLink);
        const amt = Number(o.amount || 0).toFixed(2);
        const name = this.escapeHtml(o.fullName || 'No name');
        const clientChip = o.clientName
            ? `<span class="chip chip-client" title="Client">👤 ${this.escapeHtml(o.clientName)}</span>`
            : '';

        return `
        <article class="order-card" data-key="${key}">
            <div class="order-row">
                <div class="order-primary">
                    <div class="order-name">${name}</div>
                    <div class="order-meta">
                        <span class="order-amount">$${amt}</span>
                        <span class="dot">·</span>
                        <span class="order-time">${this.escapeHtml(time)}</span>
                        ${clientChip}
                    </div>
                </div>
                <div class="order-actions">
                    <a class="icon-btn yt" href="${ytUrl}" target="_blank" rel="noopener noreferrer" title="Open YouTube" aria-label="Open YouTube">▶</a>
                    <button class="icon-btn ghost" data-action="view" title="View" aria-label="View" aria-expanded="${expanded}">👁</button>
                    <button class="icon-btn ghost" data-action="edit" title="Edit" aria-label="Edit">✏️</button>
                </div>
            </div>
            ${expanded ? this.orderDetailsHtml(o) : ''}
        </article>`;
    }

    orderDetailsHtml(o) {
        const date = this.formatDateFull(this.orderTimestampMs(o));
        const ytFull = this.escapeHtml(o.youtubeLink || 'N/A');
        const ytUrl = this.safeUrl(o.youtubeLink);
        const status = this.formatStatus(o.serviceStatus || 'pending');
        const startV = o.viewsStart != null ? Number(o.viewsStart).toLocaleString() : '—';
        const endV = o.viewsEnd != null ? Number(o.viewsEnd).toLocaleString() : '—';
        const gained = (o.viewsStart != null && o.viewsEnd != null)
            ? Math.max(0, Number(o.viewsEnd) - Number(o.viewsStart)).toLocaleString() : '—';
        return `
        <div class="order-details">
            <dl>
                <div><dt>Order ID</dt><dd><code>${this.escapeHtml(o.orderID || 'N/A')}</code></dd></div>
                <div><dt>Date</dt><dd>${this.escapeHtml(date)}</dd></div>
                <div><dt>YouTube</dt><dd><a href="${ytUrl}" target="_blank" rel="noopener noreferrer">${ytFull}</a></dd></div>
                <div><dt>Email</dt><dd>${this.escapeHtml(o.email || '—')}</dd></div>
                <div><dt>Phone</dt><dd>${this.escapeHtml(o.phone || '—')}</dd></div>
                <div><dt>PayPal Tx</dt><dd><code>${this.escapeHtml(o.paypalTransactionId || '—')}</code></dd></div>
                <div><dt>Status</dt><dd>${this.escapeHtml(status)}</dd></div>
                <div><dt>Views</dt><dd>start ${startV} → end ${endV} <span class="muted">(+${gained})</span></dd></div>
                <div><dt>Comments</dt><dd>${o.commentsGiven ? '✓ given' : '—'}</dd></div>
                <div><dt>Likes</dt><dd>${o.likesGiven ? '✓ given' : '—'}</dd></div>
                <div><dt>Client</dt><dd>${o.clientName ? this.escapeHtml(o.clientName) : '<span class="muted">Unassigned</span>'}</dd></div>
                <div><dt>Notes</dt><dd>${this.escapeHtml(o.adminNotes || '—')}</dd></div>
            </dl>
        </div>`;
    }

    bindOrderCardActions(root) {
        root.querySelectorAll('.order-card').forEach((card) => {
            const key = card.dataset.key;
            card.querySelector('[data-action="view"]').addEventListener('click', () => {
                this.expandedOrderKey = this.expandedOrderKey === key ? null : key;
                this.renderOrders();
            });
            card.querySelector('[data-action="edit"]').addEventListener('click', () => this.openOrderEditSheet(key));
        });
    }

    /* ============== ORDER EDIT SHEET ============== */

    openOrderEditSheet(firebaseKey) {
        const o = this.orders.find((x) => x.firebaseKey === firebaseKey);
        if (!o) return;

        const status = o.serviceStatus || 'pending';
        const viewsStart = o.viewsStart != null ? o.viewsStart : '';
        const viewsEnd = o.viewsEnd != null ? o.viewsEnd : '';

        const body = `
            <div class="form-grid">
                <div class="form-row">
                    <label>Customer</label>
                    <div class="readout">${this.escapeHtml(o.fullName || 'No name')} · ${this.escapeHtml(o.email || o.phone || '—')}</div>
                </div>
                <div class="form-row">
                    <label>Status</label>
                    <div class="segmented" id="statusSegmented">
                        ${ORDER_STATUSES.map((s) => `
                            <button type="button" class="seg ${s === status ? 'active' : ''}" data-status="${s}">${this.formatStatus(s)}</button>
                        `).join('')}
                    </div>
                </div>
                <div class="form-row two-col">
                    <div>
                        <label for="fStart">Views (start)</label>
                        <input type="number" id="fStart" min="0" step="1" value="${this.escapeAttribute(viewsStart)}">
                    </div>
                    <div>
                        <label for="fEnd">Views (current/final)</label>
                        <input type="number" id="fEnd" min="0" step="1" value="${this.escapeAttribute(viewsEnd)}">
                    </div>
                </div>
                <div class="form-row checkbox-row">
                    <label class="checkbox"><input type="checkbox" id="fComments" ${o.commentsGiven ? 'checked' : ''}> Comments given</label>
                    <label class="checkbox"><input type="checkbox" id="fLikes" ${o.likesGiven ? 'checked' : ''}> Likes given</label>
                </div>
                <div class="form-row">
                    <label>Assigned client</label>
                    <div id="clientPicker" class="client-picker">
                        <div class="client-picker-current">
                            ${o.clientName
                                ? `<span class="chip chip-client">👤 ${this.escapeHtml(o.clientName)}</span>
                                   <button type="button" class="link-btn" id="unassignClient">Unassign</button>`
                                : '<span class="muted">Unassigned</span>'}
                        </div>
                        <input type="search" id="clientPickerSearch" placeholder="Search or add client…" autocomplete="off">
                        <div id="clientPickerResults" class="client-picker-results"></div>
                    </div>
                </div>
                <div class="form-row">
                    <label for="fNotes">Admin notes</label>
                    <textarea id="fNotes" rows="3">${this.escapeHtml(o.adminNotes || '')}</textarea>
                </div>
            </div>
        `;

        const footer = `
            <button class="danger-btn" id="deleteOrderBtn">🗑 Delete</button>
            <div class="footer-spacer"></div>
            <button class="ghost-btn" data-sheet-close>Cancel</button>
            <button class="primary-btn" id="saveOrderBtn">Save</button>
        `;

        this.openSheet(`Order · $${Number(o.amount || 0).toFixed(2)}`, body, footer);

        // Bind status segmented
        let selectedStatus = status;
        document.querySelectorAll('#statusSegmented .seg').forEach((b) => {
            b.addEventListener('click', () => {
                selectedStatus = b.dataset.status;
                document.querySelectorAll('#statusSegmented .seg').forEach((x) => x.classList.toggle('active', x === b));
            });
        });

        // Client picker
        let selectedClient = o.clientId
            ? { id: o.clientId, name: o.clientName, slug: o.clientSlug }
            : null;
        const renderClientResults = (q) => {
            const resultsEl = document.getElementById('clientPickerResults');
            const term = (q || '').toLowerCase().trim();
            const matches = this.clients
                .filter((c) => !term || c.name.toLowerCase().includes(term) || (c.slug || '').includes(term))
                .slice(0, 8);
            const newRow = term ? `<button type="button" class="picker-row picker-row-new" data-new>+ Create “${this.escapeHtml(q)}”</button>` : '';
            resultsEl.innerHTML = newRow + matches.map((c) => `
                <button type="button" class="picker-row" data-cid="${this.escapeAttribute(c.firebaseKey)}">
                    <strong>${this.escapeHtml(c.name)}</strong>
                    <small>${this.escapeHtml(c.slug || '')}</small>
                </button>
            `).join('');
            resultsEl.querySelectorAll('[data-cid]').forEach((row) => row.addEventListener('click', () => {
                const c = this.clients.find((x) => x.firebaseKey === row.dataset.cid);
                if (!c) return;
                selectedClient = { id: c.firebaseKey, name: c.name, slug: c.slug };
                this.renderSelectedClientChip(selectedClient);
                document.getElementById('clientPickerSearch').value = '';
                resultsEl.innerHTML = '';
            }));
            const newBtn = resultsEl.querySelector('[data-new]');
            if (newBtn) {
                newBtn.addEventListener('click', async () => {
                    const created = await this.createClient(q.trim());
                    if (created) {
                        selectedClient = { id: created.firebaseKey, name: created.name, slug: created.slug };
                        this.renderSelectedClientChip(selectedClient);
                        document.getElementById('clientPickerSearch').value = '';
                        resultsEl.innerHTML = '';
                    }
                });
            }
        };
        document.getElementById('clientPickerSearch').addEventListener('input', (e) => renderClientResults(e.target.value));
        document.getElementById('clientPickerSearch').addEventListener('focus', (e) => renderClientResults(e.target.value));
        const unassignBtn = document.getElementById('unassignClient');
        if (unassignBtn) unassignBtn.addEventListener('click', () => {
            selectedClient = null;
            this.renderSelectedClientChip(null);
        });

        // Save
        document.getElementById('saveOrderBtn').addEventListener('click', async () => {
            const startVal = document.getElementById('fStart').value;
            const endVal = document.getElementById('fEnd').value;
            const commentsGiven = document.getElementById('fComments').checked;
            const likesGiven = document.getElementById('fLikes').checked;
            const adminNotes = document.getElementById('fNotes').value;
            const viewsStartNum = startVal === '' ? null : Number(startVal);
            const viewsEndNum = endVal === '' ? null : Number(endVal);

            // Auto-complete: views recorded AND comments AND likes -> completed
            let finalStatus = selectedStatus;
            const viewsRecorded = viewsEndNum != null && (viewsStartNum == null || viewsEndNum >= viewsStartNum) && viewsEndNum > 0;
            if (viewsRecorded && commentsGiven && likesGiven) {
                finalStatus = 'completed';
            }

            const payload = {
                serviceStatus: finalStatus,
                viewsStart: viewsStartNum,
                viewsEnd: viewsEndNum,
                commentsGiven,
                likesGiven,
                adminNotes,
                clientId: selectedClient ? selectedClient.id : null,
                clientName: selectedClient ? selectedClient.name : null,
                clientSlug: selectedClient ? selectedClient.slug : null,
                updatedAt: Date.now()
            };

            try {
                await update(ref(database, `orders/${firebaseKey}`), payload);
                this.toast('Order saved', 'success');
                this.closeSheet();
            } catch (err) {
                console.error(err);
                this.toast('Failed to save order', 'error');
            }
        });

        // Delete
        document.getElementById('deleteOrderBtn').addEventListener('click', () => {
            this.openConfirm('Delete order?', `<p>This permanently removes <strong>${this.escapeHtml(o.fullName || 'this order')}</strong> from the database. This can’t be undone.</p>`, async () => {
                try {
                    await remove(ref(database, `orders/${firebaseKey}`));
                    this.toast('Order deleted', 'success');
                    this.closeConfirm();
                    this.closeSheet();
                } catch (err) {
                    console.error(err);
                    this.toast('Failed to delete', 'error');
                }
            });
        });
    }

    renderSelectedClientChip(client) {
        const root = document.querySelector('#clientPicker .client-picker-current');
        if (!root) return;
        if (client) {
            root.innerHTML = `<span class="chip chip-client">👤 ${this.escapeHtml(client.name)}</span>
                              <button type="button" class="link-btn" id="unassignClient">Unassign</button>`;
            root.querySelector('#unassignClient').addEventListener('click', () => {
                this.renderSelectedClientChip(null);
                // signal upward via custom event
                root.dispatchEvent(new CustomEvent('client-cleared', { bubbles: true }));
            });
        } else {
            root.innerHTML = '<span class="muted">Unassigned</span>';
        }
    }

    /* ============== CLIENTS ============== */

    clientStats(client) {
        const orders = this.orders.filter((o) => o.clientId === client.firebaseKey && !this.isTestOrder(o));
        const totalSpent = orders.reduce((s, o) => s + Number(o.amount || 0), 0);
        const viewsGained = orders.reduce((s, o) => {
            if (o.viewsStart != null && o.viewsEnd != null) {
                return s + Math.max(0, Number(o.viewsEnd) - Number(o.viewsStart));
            }
            return s;
        }, 0);
        const lastOrderTs = orders.reduce((max, o) => Math.max(max, this.orderTimestampMs(o)), 0);
        return { orderCount: orders.length, totalSpent, viewsGained, lastOrderTs };
    }

    renderClients() {
        const list = document.getElementById('clientsList');
        const empty = document.getElementById('noClientsMessage');
        const counter = document.getElementById('clientCounter');
        const search = document.getElementById('clientSearchInput').value.toLowerCase().trim();
        const sortBy = document.getElementById('clientSortBy').value;

        let items = this.clients.slice();
        if (search) {
            items = items.filter((c) => c.name.toLowerCase().includes(search) || (c.slug || '').includes(search));
        }

        const enriched = items.map((c) => ({ ...c, _stats: this.clientStats(c) }));

        enriched.sort((a, b) => {
            switch (sortBy) {
                case 'orders_desc': return b._stats.orderCount - a._stats.orderCount;
                case 'spent_desc': return b._stats.totalSpent - a._stats.totalSpent;
                case 'recent_desc': return b._stats.lastOrderTs - a._stats.lastOrderTs;
                case 'name_asc':
                default: return a.name.localeCompare(b.name);
            }
        });

        counter.textContent = `${enriched.length}`;

        if (enriched.length === 0) {
            list.innerHTML = '';
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';

        list.innerHTML = enriched.map((c) => {
            const key = this.escapeAttribute(c.firebaseKey);
            const recent = c._stats.lastOrderTs ? this.formatRelative(c._stats.lastOrderTs) : 'no orders';
            const igUrl = instagramUrl(c.instagram);
            const igBtn = igUrl
                ? `<a class="icon-btn ig" href="${this.safeUrl(igUrl)}" target="_blank" rel="noopener noreferrer" title="${this.escapeAttribute(instagramDisplay(c.instagram))}" aria-label="Open Instagram">◎</a>`
                : '';
            return `
            <article class="client-card" data-key="${key}">
                <div class="client-row">
                    <div class="client-primary">
                        <div class="client-name">${this.escapeHtml(c.name)}</div>
                        <div class="client-meta">
                            <span>${c._stats.orderCount} orders</span>
                            <span class="dot">·</span>
                            <span>$${c._stats.totalSpent.toFixed(2)}</span>
                            <span class="dot">·</span>
                            <span>+${c._stats.viewsGained.toLocaleString()} views</span>
                            <span class="dot">·</span>
                            <span class="muted">${this.escapeHtml(recent)}</span>
                        </div>
                        <div class="client-slug muted">/${this.escapeHtml(c.slug || '')}${c.instagram ? ` · <a href="${this.safeUrl(igUrl)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(instagramDisplay(c.instagram))}</a>` : ''}</div>
                    </div>
                    <div class="client-actions">
                        ${igBtn}
                        <button class="icon-btn ghost" data-action="orders" title="View orders" aria-label="View orders">📂</button>
                        <button class="icon-btn ghost" data-action="edit" title="Edit" aria-label="Edit">✏️</button>
                    </div>
                </div>
            </article>`;
        }).join('');

        list.querySelectorAll('.client-card').forEach((card) => {
            const key = card.dataset.key;
            const c = this.clients.find((x) => x.firebaseKey === key);
            if (!c) return;
            card.querySelector('[data-action="orders"]').addEventListener('click', () => {
                this.orderClientFilter = { id: c.firebaseKey, name: c.name };
                this.orderStatusTab = 'pending';
                this.switchView('orders');
                document.querySelectorAll('#orderSubTabs .sub-tab').forEach((t) => t.classList.toggle('active', t.dataset.status === 'pending'));
                this.renderOrders();
            });
            card.querySelector('[data-action="edit"]').addEventListener('click', () => this.openClientSheet(c));
        });
    }

    openClientSheet(client) {
        const isEdit = !!client;
        const name = client ? client.name : '';
        const slug = client ? (client.slug || '') : '';
        const notes = client ? (client.notes || '') : '';
        const instagram = client ? (client.instagram || '') : '';

        const body = `
            <div class="form-grid">
                <div class="form-row">
                    <label for="cName">Name</label>
                    <input type="text" id="cName" value="${this.escapeAttribute(name)}" placeholder="e.g. Big Sumo">
                </div>
                <div class="form-row">
                    <label for="cSlug">Public slug</label>
                    <input type="text" id="cSlug" value="${this.escapeAttribute(slug)}" placeholder="auto-generated">
                    <small class="muted">Used in their public URL: <code>campaigns.upscalemarketingsolutions.com/<span id="slugPreview">${this.escapeHtml(slug || 'slug')}</span></code></small>
                </div>
                <div class="form-row">
                    <label for="cInstagram">Instagram link or @handle</label>
                    <input type="text" id="cInstagram" value="${this.escapeAttribute(instagram)}" placeholder="@username or full URL" autocomplete="off">
                </div>
                <div class="form-row">
                    <label for="cNotes">Notes</label>
                    <textarea id="cNotes" rows="3">${this.escapeHtml(notes)}</textarea>
                </div>
            </div>
        `;
        const footer = isEdit
            ? `<button class="danger-btn" id="deleteClientBtn">🗑 Delete</button>
               <div class="footer-spacer"></div>
               <button class="ghost-btn" data-sheet-close>Cancel</button>
               <button class="primary-btn" id="saveClientBtn">Save</button>`
            : `<div class="footer-spacer"></div>
               <button class="ghost-btn" data-sheet-close>Cancel</button>
               <button class="primary-btn" id="saveClientBtn">Add</button>`;

        this.openSheet(isEdit ? 'Edit client' : 'New client', body, footer);

        const nameEl = document.getElementById('cName');
        const slugEl = document.getElementById('cSlug');
        const slugPreview = document.getElementById('slugPreview');
        let slugDirty = isEdit;
        nameEl.addEventListener('input', () => {
            if (!slugDirty) {
                slugEl.value = this.toSlug(nameEl.value);
                slugPreview.textContent = slugEl.value || 'slug';
            }
        });
        slugEl.addEventListener('input', () => {
            slugDirty = true;
            slugEl.value = this.toSlug(slugEl.value);
            slugPreview.textContent = slugEl.value || 'slug';
        });

        document.getElementById('saveClientBtn').addEventListener('click', async () => {
            const newName = nameEl.value.trim();
            if (!newName) return this.toast('Name is required', 'error');
            let newSlug = this.toSlug(slugEl.value || newName);
            if (!newSlug) return this.toast('Slug is required', 'error');

            // Uniqueness check (exclude current id on edit)
            const collision = this.clients.find((c) => c.slug === newSlug && (!isEdit || c.firebaseKey !== client.firebaseKey));
            if (collision) {
                newSlug = await this.uniqueSlug(newSlug, isEdit ? client.firebaseKey : null);
            }

            try {
                if (isEdit) {
                    await update(ref(database, `usmClients/${client.firebaseKey}`), {
                        name: newName,
                        slug: newSlug,
                        instagram: document.getElementById('cInstagram').value.trim() || null,
                        notes: document.getElementById('cNotes').value,
                        updatedAt: Date.now()
                    });
                    // Sync denormalized clientName/Slug on orders that point to this client
                    if (newName !== client.name || newSlug !== client.slug) {
                        const updates = {};
                        this.orders.forEach((o) => {
                            if (o.clientId === client.firebaseKey) {
                                updates[`orders/${o.firebaseKey}/clientName`] = newName;
                                updates[`orders/${o.firebaseKey}/clientSlug`] = newSlug;
                            }
                        });
                        if (Object.keys(updates).length) {
                            await update(ref(database), updates);
                        }
                    }
                    this.toast('Client saved', 'success');
                } else {
                    const newRef = push(ref(database, 'usmClients'));
                    await set(newRef, {
                        name: newName,
                        slug: newSlug,
                        instagram: document.getElementById('cInstagram').value.trim() || null,
                        notes: document.getElementById('cNotes').value,
                        createdAt: Date.now(),
                        updatedAt: Date.now()
                    });
                    this.toast('Client added', 'success');
                }
                this.closeSheet();
            } catch (err) {
                console.error(err);
                this.toast('Save failed', 'error');
            }
        });

        if (isEdit) {
            document.getElementById('deleteClientBtn').addEventListener('click', () => {
                const stats = this.clientStats(client);
                const note = stats.orderCount
                    ? `<p>This client has <strong>${stats.orderCount}</strong> assigned order${stats.orderCount === 1 ? '' : 's'}. They will be unassigned (not deleted).</p>`
                    : '';
                this.openConfirm('Delete client?',
                    `<p>Remove <strong>${this.escapeHtml(client.name)}</strong>?</p>${note}`,
                    async () => {
                        try {
                            // Unassign orders first
                            const updates = {};
                            this.orders.forEach((o) => {
                                if (o.clientId === client.firebaseKey) {
                                    updates[`orders/${o.firebaseKey}/clientId`] = null;
                                    updates[`orders/${o.firebaseKey}/clientName`] = null;
                                    updates[`orders/${o.firebaseKey}/clientSlug`] = null;
                                }
                            });
                            updates[`usmClients/${client.firebaseKey}`] = null;
                            await update(ref(database), updates);
                            this.toast('Client deleted', 'success');
                            this.closeConfirm();
                            this.closeSheet();
                        } catch (err) {
                            console.error(err);
                            this.toast('Delete failed', 'error');
                        }
                    });
            });
        }
    }

    async createClient(name) {
        const trimmed = name.trim();
        if (!trimmed) return null;
        let slug = this.toSlug(trimmed);
        slug = await this.uniqueSlug(slug, null);
        try {
            const newRef = push(ref(database, 'usmClients'));
            const data = { name: trimmed, slug, notes: '', createdAt: Date.now(), updatedAt: Date.now() };
            await set(newRef, data);
            return { firebaseKey: newRef.key, ...data };
        } catch (err) {
            console.error(err);
            this.toast('Failed to create client', 'error');
            return null;
        }
    }

    async uniqueSlug(base, excludeId) {
        const slugs = new Set(this.clients.filter((c) => c.firebaseKey !== excludeId).map((c) => c.slug));
        if (!slugs.has(base)) return base;
        for (let i = 2; i < 1000; i++) {
            const candidate = `${base}-${i}`;
            if (!slugs.has(candidate)) return candidate;
        }
        return `${base}-${Date.now()}`;
    }

    toSlug(s) {
        return String(s || '')
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60);
    }

    /* ============== TRIAL LEADS ============== */

    updateTrialStats() {
        document.getElementById('totalTrialLeads').textContent = this.trialCampaigns.length;
        document.getElementById('newTrialLeads').textContent = this.trialCampaigns.filter((l) => normalizeTrialStatus(l.leadStatus) === 'new').length;
        document.getElementById('contactedTrialLeads').textContent = this.trialCampaigns.filter((l) => normalizeTrialStatus(l.leadStatus) === 'contacted').length;
        document.getElementById('hipHopTrialLeads').textContent = this.trialCampaigns.filter((l) => l.genre === 'hip-hop').length;
    }

    updateTrialCounts() {
        const counts = { new: 0, completed: 0, contacted: 0, archived: 0 };
        this.trialCampaigns.forEach((l) => {
            const s = normalizeTrialStatus(l.leadStatus);
            if (counts[s] !== undefined) counts[s]++;
        });
        document.getElementById('countTrialNew').textContent = counts.new;
        document.getElementById('countTrialCompleted').textContent = counts.completed;
        document.getElementById('countTrialContacted').textContent = counts.contacted;
        document.getElementById('countTrialArchived').textContent = counts.archived;
    }

    trialTimestampMs(l) {
        const v = l.createdAt || l.submittedAtIso;
        if (!v) return 0;
        if (typeof v === 'number') return v;
        const parsed = Date.parse(v);
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    renderTrials() {
        const list = document.getElementById('trialList');
        const empty = document.getElementById('noTrialCampaignsMessage');
        const counter = document.getElementById('trialCounter');

        const search = document.getElementById('trialSearchInput').value.toLowerCase().trim();
        const genre = document.getElementById('trialGenreFilter').value;
        const sortBy = document.getElementById('trialSortBy').value;

        let items = this.trialCampaigns.filter((l) => normalizeTrialStatus(l.leadStatus) === this.trialStatusTab);
        if (genre) items = items.filter((l) => l.genre === genre);
        if (search) {
            items = items.filter((l) =>
                String(l.fullName || '').toLowerCase().includes(search) ||
                String(l.genre || '').toLowerCase().includes(search) ||
                String(l.subgenre || '').toLowerCase().includes(search) ||
                String(l.youtubeLink || '').toLowerCase().includes(search) ||
                String(l.targetAgeGroup || '').toLowerCase().includes(search) ||
                this.getRegionsText(l).toLowerCase().includes(search)
            );
        }

        items.sort((a, b) => {
            switch (sortBy) {
                case 'timestamp_asc': return this.trialTimestampMs(a) - this.trialTimestampMs(b);
                case 'name_asc': return String(a.fullName || '').localeCompare(String(b.fullName || ''));
                case 'genre_asc': return this.formatGenre(a.genre).localeCompare(this.formatGenre(b.genre));
                case 'timestamp_desc':
                default: return this.trialTimestampMs(b) - this.trialTimestampMs(a);
            }
        });

        const total = items.length;
        const limited = Number.isFinite(this.trialLimit) ? items.slice(0, this.trialLimit) : items;
        counter.textContent = limited.length === total ? `${total}` : `${limited.length} / ${total}`;

        if (limited.length === 0) {
            list.innerHTML = '';
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';

        list.innerHTML = limited.map((l) => this.trialCardHtml(l)).join('');
        list.querySelectorAll('.trial-card').forEach((card) => {
            const key = card.dataset.key;
            card.querySelector('[data-action="view"]').addEventListener('click', () => this.openTrialView(key));
            card.querySelector('[data-action="edit"]').addEventListener('click', () => this.openTrialEditSheet(key));
        });
    }

    trialCardHtml(l) {
        const key = this.escapeAttribute(l.firebaseKey);
        const time = this.formatRelative(this.trialTimestampMs(l));
        const ytUrl = this.safeUrl(l.youtubeLink);
        const igUrl = instagramUrl(l.instagramLink);
        const genre = this.formatGenre(l.genre);
        const igBtn = igUrl
            ? `<a class="icon-btn ig" href="${this.safeUrl(igUrl)}" target="_blank" rel="noopener noreferrer" title="Open Instagram" aria-label="Open Instagram">◎</a>`
            : '';
        return `
        <article class="trial-card" data-key="${key}">
            <div class="order-row">
                <div class="order-primary">
                    <div class="order-name">${this.escapeHtml(l.fullName || 'Unknown')}</div>
                    <div class="order-meta">
                        <span>${this.escapeHtml(genre)}</span>
                        <span class="dot">·</span>
                        <span class="order-time">${this.escapeHtml(time)}</span>
                    </div>
                </div>
                <div class="order-actions">
                    <a class="icon-btn yt" href="${ytUrl}" target="_blank" rel="noopener noreferrer" title="Open YouTube" aria-label="Open YouTube">▶</a>
                    ${igBtn}
                    <button class="icon-btn ghost" data-action="view" title="View" aria-label="View">👁</button>
                    <button class="icon-btn ghost" data-action="edit" title="Edit" aria-label="Edit">✏️</button>
                </div>
            </div>
        </article>`;
    }

    openTrialView(firebaseKey) {
        const l = this.trialCampaigns.find((x) => x.firebaseKey === firebaseKey);
        if (!l) return;
        const ytUrl = this.safeUrl(l.youtubeLink);
        const igUrl = instagramUrl(l.instagramLink);
        const date = this.formatDateFull(this.trialTimestampMs(l));
        const startV = l.viewsStart != null ? Number(l.viewsStart).toLocaleString() : '—';
        const endV = l.viewsEnd != null ? Number(l.viewsEnd).toLocaleString() : '—';
        const gained = (l.viewsStart != null && l.viewsEnd != null)
            ? Math.max(0, Number(l.viewsEnd) - Number(l.viewsStart)).toLocaleString() : '—';
        const igRow = l.instagramLink
            ? `<div><dt>Instagram</dt><dd><a href="${this.safeUrl(igUrl)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(instagramDisplay(l.instagramLink))}</a></dd></div>`
            : '';
        const body = `
            <dl class="readonly-grid">
                <div><dt>Reference</dt><dd><code>${this.escapeHtml(l.submissionId || 'N/A')}</code></dd></div>
                <div><dt>Submitted</dt><dd>${this.escapeHtml(date)}</dd></div>
                <div><dt>Name</dt><dd>${this.escapeHtml(l.fullName || '—')}</dd></div>
                <div><dt>Genre</dt><dd>${this.escapeHtml(this.formatGenre(l.genre))}</dd></div>
                <div><dt>Subgenre</dt><dd>${this.escapeHtml(l.subgenre || '—')}</dd></div>
                <div><dt>Years</dt><dd>${this.escapeHtml(l.yearsMakingMusic || '—')}</dd></div>
                <div><dt>YouTube</dt><dd><a href="${ytUrl}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(l.youtubeLink || '—')}</a></dd></div>
                ${igRow}
                <div><dt>Regions</dt><dd>${this.escapeHtml(this.getRegionsText(l) || '—')}</dd></div>
                <div><dt>Age group</dt><dd>${this.escapeHtml(l.targetAgeGroup || '—')}</dd></div>
                <div><dt>Status</dt><dd>${this.escapeHtml(this.formatStatus(normalizeTrialStatus(l.leadStatus)))}</dd></div>
                <div><dt>Views</dt><dd>start ${startV} → end ${endV} <span class="muted">(+${gained})</span></dd></div>
                <div><dt>Comments</dt><dd>${l.commentsGiven ? '✓ given' : '—'}</dd></div>
                <div><dt>Likes</dt><dd>${l.likesGiven ? '✓ given' : '—'}</dd></div>
                <div><dt>Notes</dt><dd>${this.escapeHtml(l.adminNotes || '—')}</dd></div>
            </dl>
        `;
        const footer = `<div class="footer-spacer"></div><button class="ghost-btn" data-sheet-close>Close</button>`;
        this.openSheet('Trial lead', body, footer);
    }

    openTrialEditSheet(firebaseKey) {
        const l = this.trialCampaigns.find((x) => x.firebaseKey === firebaseKey);
        if (!l) return;
        const status = normalizeTrialStatus(l.leadStatus);
        const viewsStart = l.viewsStart != null ? l.viewsStart : '';
        const viewsEnd = l.viewsEnd != null ? l.viewsEnd : '';
        const body = `
            <div class="form-grid">
                <div class="form-row">
                    <label>Lead</label>
                    <div class="readout">${this.escapeHtml(l.fullName || '—')} · ${this.escapeHtml(this.formatGenre(l.genre))}</div>
                </div>
                <div class="form-row">
                    <label>Status</label>
                    <div class="segmented" id="trialStatusSeg">
                        ${TRIAL_STATUSES.map((s) => `<button type="button" class="seg ${s === status ? 'active' : ''}" data-status="${s}">${this.formatStatus(s)}</button>`).join('')}
                    </div>
                </div>
                <div class="form-row two-col">
                    <div>
                        <label for="trialStart">Views (start)</label>
                        <input type="number" id="trialStart" min="0" step="1" value="${this.escapeAttribute(viewsStart)}">
                    </div>
                    <div>
                        <label for="trialEnd">Views (current/final)</label>
                        <input type="number" id="trialEnd" min="0" step="1" value="${this.escapeAttribute(viewsEnd)}">
                    </div>
                </div>
                <div class="form-row checkbox-row">
                    <label class="checkbox"><input type="checkbox" id="trialComments" ${l.commentsGiven ? 'checked' : ''}> Comments given</label>
                    <label class="checkbox"><input type="checkbox" id="trialLikes" ${l.likesGiven ? 'checked' : ''}> Likes given</label>
                </div>
                <div class="form-row">
                    <label for="trialInstagram">Instagram link or @handle</label>
                    <input type="text" id="trialInstagram" value="${this.escapeAttribute(l.instagramLink || '')}" placeholder="@username or full URL" autocomplete="off">
                </div>
                <div class="form-row">
                    <label for="trialNotes">Admin notes</label>
                    <textarea id="trialNotes" rows="3">${this.escapeHtml(l.adminNotes || '')}</textarea>
                </div>
            </div>
        `;
        const footer = `
            <button class="danger-btn" id="deleteTrialBtn">🗑 Delete</button>
            <div class="footer-spacer"></div>
            <button class="ghost-btn" data-sheet-close>Cancel</button>
            <button class="primary-btn" id="saveTrialBtn">Save</button>
        `;
        this.openSheet('Edit lead', body, footer);

        let selectedStatus = status;
        document.querySelectorAll('#trialStatusSeg .seg').forEach((b) => {
            b.addEventListener('click', () => {
                selectedStatus = b.dataset.status;
                document.querySelectorAll('#trialStatusSeg .seg').forEach((x) => x.classList.toggle('active', x === b));
            });
        });

        document.getElementById('saveTrialBtn').addEventListener('click', async () => {
            const startVal = document.getElementById('trialStart').value;
            const endVal = document.getElementById('trialEnd').value;
            const commentsGiven = document.getElementById('trialComments').checked;
            const likesGiven = document.getElementById('trialLikes').checked;
            const viewsStartNum = startVal === '' ? null : Number(startVal);
            const viewsEndNum = endVal === '' ? null : Number(endVal);

            // Auto-complete: views recorded AND comments AND likes -> completed
            let finalStatus = selectedStatus;
            const viewsRecorded = viewsEndNum != null && (viewsStartNum == null || viewsEndNum >= viewsStartNum) && viewsEndNum > 0;
            if (viewsRecorded && commentsGiven && likesGiven && finalStatus === 'new') {
                finalStatus = 'completed';
            }

            try {
                await update(ref(database, `trialCampaignSubmissions/${firebaseKey}`), {
                    leadStatus: finalStatus,
                    viewsStart: viewsStartNum,
                    viewsEnd: viewsEndNum,
                    commentsGiven,
                    likesGiven,
                    instagramLink: document.getElementById('trialInstagram').value.trim() || null,
                    adminNotes: document.getElementById('trialNotes').value,
                    updatedAt: Date.now()
                });
                this.toast('Lead saved', 'success');
                this.closeSheet();
            } catch (err) {
                console.error(err);
                this.toast('Save failed', 'error');
            }
        });

        document.getElementById('deleteTrialBtn').addEventListener('click', () => {
            this.openConfirm('Delete trial lead?', `<p>Remove <strong>${this.escapeHtml(l.fullName || 'this lead')}</strong>? This can’t be undone.</p>`, async () => {
                try {
                    await remove(ref(database, `trialCampaignSubmissions/${firebaseKey}`));
                    this.toast('Lead deleted', 'success');
                    this.closeConfirm();
                    this.closeSheet();
                } catch (err) {
                    console.error(err);
                    this.toast('Delete failed', 'error');
                }
            });
        });
    }

    /* ============== SHEETS / CONFIRM / TOAST ============== */

    openSheet(title, bodyHtml, footerHtml) {
        document.getElementById('sheetTitle').textContent = title;
        document.getElementById('sheetBody').innerHTML = bodyHtml;
        document.getElementById('sheetFooter').innerHTML = footerHtml || '';
        const sheet = document.getElementById('sheet');
        sheet.classList.add('open');
        sheet.setAttribute('aria-hidden', 'false');
        // Re-bind close buttons inside footer
        sheet.querySelectorAll('[data-sheet-close]').forEach((el) => el.addEventListener('click', () => this.closeSheet()));
    }

    closeSheet() {
        const sheet = document.getElementById('sheet');
        sheet.classList.remove('open');
        sheet.setAttribute('aria-hidden', 'true');
    }

    openConfirm(title, bodyHtml, onOk) {
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmBody').innerHTML = bodyHtml;
        const dlg = document.getElementById('confirmDialog');
        dlg.classList.add('open');
        dlg.setAttribute('aria-hidden', 'false');
        const okBtn = document.getElementById('confirmOkBtn');
        const fresh = okBtn.cloneNode(true);
        okBtn.parentNode.replaceChild(fresh, okBtn);
        fresh.addEventListener('click', () => onOk && onOk());
        dlg.querySelectorAll('[data-confirm-close]').forEach((el) => el.addEventListener('click', () => this.closeConfirm()));
    }

    closeConfirm() {
        const dlg = document.getElementById('confirmDialog');
        dlg.classList.remove('open');
        dlg.setAttribute('aria-hidden', 'true');
    }

    toast(message, kind) {
        const el = document.getElementById('toast');
        el.textContent = message;
        el.className = `toast show ${kind || ''}`;
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => { el.className = 'toast'; }, 2400);
    }

    /* ============== HELPERS ============== */

    formatStatus(s) {
        return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }

    formatGenre(g) {
        const labels = {
            'hip-hop': 'Hip-Hop',
            'rnb-soul': 'R&B / Soul',
            'afrobeats': 'Afrobeats',
            'latin': 'Latin / Urbano'
        };
        if (!g) return 'N/A';
        return labels[g] || this.formatStatus(g);
    }

    formatRelative(ms) {
        if (!ms) return '—';
        const diff = Date.now() - ms;
        const sec = Math.round(diff / 1000);
        if (sec < 60) return 'just now';
        const min = Math.round(sec / 60);
        if (min < 60) return `${min}m ago`;
        const hr = Math.round(min / 60);
        if (hr < 24) return `${hr}h ago`;
        const day = Math.round(hr / 24);
        if (day < 7) return `${day}d ago`;
        const wk = Math.round(day / 7);
        if (wk < 5) return `${wk}w ago`;
        const mo = Math.round(day / 30);
        if (mo < 12) return `${mo}mo ago`;
        const yr = Math.round(day / 365);
        return `${yr}y ago`;
    }

    formatDateFull(ms) {
        if (!ms) return 'N/A';
        const d = new Date(ms);
        if (Number.isNaN(d.getTime())) return 'N/A';
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
    }

    getRegionsText(l) {
        if (Array.isArray(l.targetRegionsList) && l.targetRegionsList.length) return l.targetRegionsList.join(', ');
        return String(l.targetRegions || '').trim();
    }

    safeUrl(url) {
        try {
            const u = new URL(String(url || ''));
            if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
        } catch (e) {}
        return '#';
    }

    escapeHtml(v) {
        return String(v ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    escapeAttribute(v) {
        return this.escapeHtml(v).replace(/`/g, '&#96;');
    }
}

const adminDashboard = new AdminDashboard();
window.adminDashboard = adminDashboard;
