import { auth, database } from './firebase-config.js';
import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    ref,
    update
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

class AdminDashboard {
    constructor() {
        this.currentUser = null;
        this.activeView = 'orders';
        this.currentModalType = 'order';
        this.currentFirebaseKey = null;

        this.orders = [];
        this.filteredOrders = [];
        this.trialCampaigns = [];
        this.filteredTrialCampaigns = [];

        this.init();
    }

    init() {
        this.setupAuthListener();
        this.setupEventListeners();
        this.checkAuthState();
    }

    setupAuthListener() {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                this.currentUser = user;
                this.showDashboard();
                await this.loadDashboardData();
            } else {
                this.currentUser = null;
                this.showLogin();
            }
        });
    }

    setupEventListeners() {
        document.getElementById('loginForm').addEventListener('submit', (event) => {
            event.preventDefault();
            this.handleLogin();
        });

        document.getElementById('logoutBtn').addEventListener('click', () => {
            this.handleLogout();
        });

        document.querySelectorAll('.dashboard-tab').forEach((button) => {
            button.addEventListener('click', () => {
                this.switchView(button.dataset.view);
            });
        });

        document.getElementById('searchInput').addEventListener('input', () => this.filterOrders());
        document.getElementById('statusFilter').addEventListener('change', () => this.filterOrders());
        document.getElementById('sortBy').addEventListener('change', () => this.filterOrders());
        document.getElementById('refreshBtn').addEventListener('click', () => this.loadOrders());

        document.getElementById('trialSearchInput').addEventListener('input', () => this.filterTrialCampaigns());
        document.getElementById('trialStatusFilter').addEventListener('change', () => this.filterTrialCampaigns());
        document.getElementById('trialGenreFilter').addEventListener('change', () => this.filterTrialCampaigns());
        document.getElementById('trialSortBy').addEventListener('change', () => this.filterTrialCampaigns());
        document.getElementById('trialRefreshBtn').addEventListener('click', () => this.loadTrialCampaigns());

        document.querySelector('.close').addEventListener('click', () => this.closeModal());
        document.querySelector('.close-btn').addEventListener('click', () => this.closeModal());
        document.getElementById('updateStatusBtn').addEventListener('click', () => this.handleModalUpdate());

        document.getElementById('orderModal').addEventListener('click', (event) => {
            if (event.target.id === 'orderModal') {
                this.closeModal();
            }
        });
    }

    async loadDashboardData() {
        await Promise.all([
            this.loadOrders(),
            this.loadTrialCampaigns()
        ]);
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
        try {
            await signOut(auth);
        } catch (error) {
            console.error('Logout error:', error);
        }
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

    checkAuthState() {
        if (auth.currentUser) {
            this.showDashboard();
        } else {
            this.showLogin();
        }
    }

    switchView(view) {
        this.activeView = view;

        document.querySelectorAll('.dashboard-tab').forEach((button) => {
            button.classList.toggle('active', button.dataset.view === view);
        });

        document.getElementById('ordersView').classList.toggle('active', view === 'orders');
        document.getElementById('trialCampaignsView').classList.toggle('active', view === 'trial-campaigns');
    }

    async loadOrders() {
        const loadingEl = document.getElementById('loadingIndicator');
        const tableBody = document.getElementById('ordersTableBody');

        loadingEl.style.display = 'flex';
        tableBody.innerHTML = '';

        try {
            const response = await fetch('/api/get-orders');
            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || result.error || 'Failed to load orders');
            }

            this.orders = result.orders || [];
            this.updateOrderStats();
            this.filterOrders();
        } catch (error) {
            console.error('Error loading orders:', error);
            this.orders = [];
            this.filteredOrders = [];
            this.updateOrderStats();
            this.renderOrders();
            this.updateOrderCount();
            this.showError('Failed to load orders: ' + error.message);
        } finally {
            loadingEl.style.display = 'none';
        }
    }

    async loadTrialCampaigns() {
        const loadingEl = document.getElementById('trialLoadingIndicator');
        const tableBody = document.getElementById('trialCampaignsTableBody');

        loadingEl.style.display = 'flex';
        tableBody.innerHTML = '';

        try {
            const response = await fetch('/api/get-trial-campaigns');
            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || result.error || 'Failed to load trial campaign leads');
            }

            this.trialCampaigns = result.trialCampaigns || [];
            this.updateTrialStats();
            this.filterTrialCampaigns();
        } catch (error) {
            console.error('Error loading trial campaigns:', error);
            this.trialCampaigns = [];
            this.filteredTrialCampaigns = [];
            this.updateTrialStats();
            this.renderTrialCampaigns();
            this.updateTrialCount();
            this.showError('Failed to load trial campaign leads: ' + error.message);
        } finally {
            loadingEl.style.display = 'none';
        }
    }

    updateOrderStats() {
        const totalRevenue = this.orders.reduce((sum, order) => sum + Number(order.amount || 0), 0);
        const totalOrders = this.orders.length;
        const pendingOrders = this.orders.filter((order) => (order.serviceStatus || 'pending') === 'pending').length;
        const completedOrders = this.orders.filter((order) => order.serviceStatus === 'completed').length;

        document.getElementById('totalRevenue').textContent = `$${totalRevenue.toFixed(2)}`;
        document.getElementById('totalOrders').textContent = totalOrders;
        document.getElementById('pendingOrders').textContent = pendingOrders;
        document.getElementById('completedOrders').textContent = completedOrders;
    }

    updateTrialStats() {
        const totalLeads = this.trialCampaigns.length;
        const newLeads = this.trialCampaigns.filter((lead) => (lead.leadStatus || 'new') === 'new').length;
        const contactedLeads = this.trialCampaigns.filter((lead) => lead.leadStatus === 'contacted').length;
        const hipHopLeads = this.trialCampaigns.filter((lead) => lead.genre === 'hip-hop').length;

        document.getElementById('totalTrialLeads').textContent = totalLeads;
        document.getElementById('newTrialLeads').textContent = newLeads;
        document.getElementById('contactedTrialLeads').textContent = contactedLeads;
        document.getElementById('hipHopTrialLeads').textContent = hipHopLeads;
    }

    filterOrders() {
        const searchTerm = document.getElementById('searchInput').value.toLowerCase();
        const statusFilter = document.getElementById('statusFilter').value;
        const sortBy = document.getElementById('sortBy').value;

        this.filteredOrders = this.orders.filter((order) => {
            const matchesSearch = !searchTerm ||
                String(order.orderID || '').toLowerCase().includes(searchTerm) ||
                String(order.youtubeLink || '').toLowerCase().includes(searchTerm) ||
                String(order.email || '').toLowerCase().includes(searchTerm) ||
                String(order.fullName || '').toLowerCase().includes(searchTerm);

            const matchesStatus = !statusFilter || (order.serviceStatus || 'pending') === statusFilter;
            return matchesSearch && matchesStatus;
        });

        this.filteredOrders.sort((a, b) => {
            switch (sortBy) {
                case 'timestamp_desc':
                    return Number(b.createdAt || b.timestamp || 0) - Number(a.createdAt || a.timestamp || 0);
                case 'timestamp_asc':
                    return Number(a.createdAt || a.timestamp || 0) - Number(b.createdAt || b.timestamp || 0);
                case 'amount_desc':
                    return Number(b.amount || 0) - Number(a.amount || 0);
                case 'amount_asc':
                    return Number(a.amount || 0) - Number(b.amount || 0);
                default:
                    return 0;
            }
        });

        this.renderOrders();
        this.updateOrderCount();
    }

    filterTrialCampaigns() {
        const searchTerm = document.getElementById('trialSearchInput').value.toLowerCase();
        const statusFilter = document.getElementById('trialStatusFilter').value;
        const genreFilter = document.getElementById('trialGenreFilter').value;
        const sortBy = document.getElementById('trialSortBy').value;

        this.filteredTrialCampaigns = this.trialCampaigns.filter((lead) => {
            const regionsText = Array.isArray(lead.targetRegionsList)
                ? lead.targetRegionsList.join(', ')
                : String(lead.targetRegions || '');

            const matchesSearch = !searchTerm ||
                String(lead.submissionId || '').toLowerCase().includes(searchTerm) ||
                String(lead.fullName || '').toLowerCase().includes(searchTerm) ||
                String(lead.genre || '').toLowerCase().includes(searchTerm) ||
                String(lead.subgenre || '').toLowerCase().includes(searchTerm) ||
                String(lead.youtubeLink || '').toLowerCase().includes(searchTerm) ||
                String(lead.targetAgeGroup || '').toLowerCase().includes(searchTerm) ||
                regionsText.toLowerCase().includes(searchTerm);

            const matchesStatus = !statusFilter || (lead.leadStatus || 'new') === statusFilter;
            const matchesGenre = !genreFilter || lead.genre === genreFilter;

            return matchesSearch && matchesStatus && matchesGenre;
        });

        this.filteredTrialCampaigns.sort((a, b) => {
            switch (sortBy) {
                case 'timestamp_desc':
                    return Number(b.createdAt || 0) - Number(a.createdAt || 0);
                case 'timestamp_asc':
                    return Number(a.createdAt || 0) - Number(b.createdAt || 0);
                case 'name_asc':
                    return String(a.fullName || '').localeCompare(String(b.fullName || ''));
                case 'genre_asc':
                    return this.formatGenre(a.genre).localeCompare(this.formatGenre(b.genre));
                default:
                    return 0;
            }
        });

        this.renderTrialCampaigns();
        this.updateTrialCount();
    }

    renderOrders() {
        const tableBody = document.getElementById('ordersTableBody');
        const noOrdersEl = document.getElementById('noOrdersMessage');

        if (this.filteredOrders.length === 0) {
            tableBody.innerHTML = '';
            noOrdersEl.style.display = 'block';
            return;
        }

        noOrdersEl.style.display = 'none';

        tableBody.innerHTML = this.filteredOrders.map((order) => {
            const date = this.formatDate(order.createdAt || order.timestamp);
            const youtubeUrl = this.safeUrl(order.youtubeLink);
            const youtubeLink = this.truncateText(order.youtubeLink, 40);
            const customerName = this.escapeHtml(order.fullName || 'N/A');
            const contact = this.escapeHtml(order.email || order.phone || 'N/A');
            const status = order.serviceStatus || 'pending';

            return `
                <tr>
                    <td><code>${this.escapeHtml(order.orderID || 'N/A')}</code></td>
                    <td>${this.escapeHtml(date)}</td>
                    <td><strong>$${Number(order.amount || 0).toFixed(2)}</strong></td>
                    <td>
                        <a href="${youtubeUrl}" target="_blank" rel="noopener noreferrer" class="youtube-link" title="${this.escapeHtml(order.youtubeLink || '')}">
                            ${this.escapeHtml(youtubeLink)}
                        </a>
                    </td>
                    <td>${customerName}</td>
                    <td>${contact}</td>
                    <td>
                        <span class="status-badge status-${this.escapeStatus(status)}">
                            ${this.escapeHtml(this.formatStatus(status))}
                        </span>
                    </td>
                    <td>
                        <button class="action-btn view-btn" onclick="adminDashboard.viewOrderDetails('${this.escapeAttribute(order.firebaseKey)}')">
                            View
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    renderTrialCampaigns() {
        const tableBody = document.getElementById('trialCampaignsTableBody');
        const noLeadsEl = document.getElementById('noTrialCampaignsMessage');

        if (this.filteredTrialCampaigns.length === 0) {
            tableBody.innerHTML = '';
            noLeadsEl.style.display = 'block';
            return;
        }

        noLeadsEl.style.display = 'none';

        tableBody.innerHTML = this.filteredTrialCampaigns.map((lead) => {
            const date = this.formatDate(lead.createdAt || lead.submittedAtIso);
            const genre = this.formatGenre(lead.genre);
            const subgenre = lead.subgenre ? this.escapeHtml(lead.subgenre) : 'No subgenre';
            const regions = this.getRegionsText(lead) || 'No regions listed';
            const ageGroup = lead.targetAgeGroup || 'Not set';
            const status = lead.leadStatus || 'new';
            const videoUrl = this.safeUrl(lead.youtubeLink);
            const thumbnailUrl = this.safeUrl(lead.youtubeThumbnailUrl);
            const thumbnailMarkup = thumbnailUrl !== '#'
                ? `<img src="${thumbnailUrl}" alt="YouTube thumbnail" class="trial-thumb">`
                : `<div class="trial-thumb trial-thumb-fallback">▶</div>`;

            return `
                <tr>
                    <td>
                        <div class="lead-primary">
                            <strong>${this.escapeHtml(lead.fullName || 'Unknown')}</strong>
                            <small>${this.escapeHtml(lead.submissionId || 'No ID')}</small>
                        </div>
                    </td>
                    <td>${this.escapeHtml(date)}</td>
                    <td>
                        <div class="genre-stack">
                            <strong>${this.escapeHtml(genre)}</strong>
                            <small>${subgenre}</small>
                        </div>
                    </td>
                    <td>${this.escapeHtml(lead.yearsMakingMusic || 'N/A')}</td>
                    <td>
                        <a href="${videoUrl}" target="_blank" rel="noopener noreferrer" class="trial-video-link">
                            ${thumbnailMarkup}
                            <span class="trial-video-copy">
                                <strong>Open video</strong>
                                <small>${this.escapeHtml(this.truncateText(lead.youtubeLink, 36))}</small>
                            </span>
                        </a>
                    </td>
                    <td>
                        <div class="audience-stack">
                            <strong>${this.escapeHtml(ageGroup)}</strong>
                            <small>${this.escapeHtml(this.truncateText(regions, 42))}</small>
                        </div>
                    </td>
                    <td>
                        <span class="status-badge status-${this.escapeStatus(status)}">
                            ${this.escapeHtml(this.formatStatus(status))}
                        </span>
                    </td>
                    <td>
                        <button class="action-btn view-btn" onclick="adminDashboard.viewTrialCampaignDetails('${this.escapeAttribute(lead.firebaseKey)}')">
                            View
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    updateOrderCount() {
        document.getElementById('visibleCount').textContent = this.filteredOrders.length;
        document.getElementById('totalCount').textContent = this.orders.length;
    }

    updateTrialCount() {
        document.getElementById('trialVisibleCount').textContent = this.filteredTrialCampaigns.length;
        document.getElementById('trialTotalCount').textContent = this.trialCampaigns.length;
    }

    viewOrderDetails(firebaseKey) {
        const order = this.orders.find((item) => item.firebaseKey === firebaseKey);
        if (!order) return;

        const date = this.formatDate(order.createdAt || order.timestamp);
        const youtubeUrl = this.safeUrl(order.youtubeLink);
        const status = order.serviceStatus || 'pending';

        this.currentModalType = 'order';
        this.currentFirebaseKey = firebaseKey;
        document.getElementById('modalTitle').textContent = 'Order Details';
        document.getElementById('updateStatusBtn').textContent = 'Update Order';

        document.getElementById('orderModalBody').innerHTML = `
            <div class="order-detail">
                <label>Order ID:</label>
                <div class="order-detail-value"><code>${this.escapeHtml(order.orderID || 'N/A')}</code></div>
            </div>
            <div class="order-detail">
                <label>Date:</label>
                <div class="order-detail-value">${this.escapeHtml(date)}</div>
            </div>
            <div class="order-detail">
                <label>Amount:</label>
                <div class="order-detail-value"><strong>$${Number(order.amount || 0).toFixed(2)} ${this.escapeHtml(order.currency || 'USD')}</strong></div>
            </div>
            <div class="order-detail">
                <label>YouTube Link:</label>
                <div class="order-detail-value">
                    <a href="${youtubeUrl}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(order.youtubeLink || 'N/A')}</a>
                </div>
            </div>
            <div class="order-detail">
                <label>Customer Name:</label>
                <div class="order-detail-value">${this.escapeHtml(order.fullName || 'Not provided')}</div>
            </div>
            <div class="order-detail">
                <label>Email:</label>
                <div class="order-detail-value">${this.escapeHtml(order.email || 'Not provided')}</div>
            </div>
            <div class="order-detail">
                <label>Phone:</label>
                <div class="order-detail-value">${this.escapeHtml(order.phone || 'Not provided')}</div>
            </div>
            <div class="order-detail">
                <label>PayPal Transaction ID:</label>
                <div class="order-detail-value"><code>${this.escapeHtml(order.paypalTransactionId || 'N/A')}</code></div>
            </div>
            <div class="order-detail">
                <label>Service Status:</label>
                <div class="order-detail-value">
                    <select id="modalStatusSelect" class="form-control">
                        <option value="pending" ${status === 'pending' ? 'selected' : ''}>Pending</option>
                        <option value="in_progress" ${status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                        <option value="completed" ${status === 'completed' ? 'selected' : ''}>Completed</option>
                        <option value="cancelled" ${status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                    </select>
                </div>
            </div>
            <div class="order-detail">
                <label>Admin Notes:</label>
                <div class="order-detail-value">
                    <textarea id="modalAdminNotes" rows="4" class="form-control">${this.escapeHtml(order.adminNotes || '')}</textarea>
                </div>
            </div>
        `;

        document.getElementById('orderModal').style.display = 'flex';
    }

    viewTrialCampaignDetails(firebaseKey) {
        const lead = this.trialCampaigns.find((item) => item.firebaseKey === firebaseKey);
        if (!lead) return;

        const date = this.formatDate(lead.createdAt || lead.submittedAtIso);
        const youtubeUrl = this.safeUrl(lead.youtubeLink);
        const thumbnailUrl = this.safeUrl(lead.youtubeThumbnailUrl);
        const status = lead.leadStatus || 'new';
        const previewMarkup = thumbnailUrl !== '#'
            ? `<div class="modal-video-preview"><img src="${thumbnailUrl}" alt="YouTube thumbnail" class="modal-trial-thumb"></div>`
            : '';

        this.currentModalType = 'trial-campaign';
        this.currentFirebaseKey = firebaseKey;
        document.getElementById('modalTitle').textContent = 'Trial Campaign Lead';
        document.getElementById('updateStatusBtn').textContent = 'Update Lead';

        document.getElementById('orderModalBody').innerHTML = `
            ${previewMarkup}
            <div class="order-detail">
                <label>Reference ID:</label>
                <div class="order-detail-value"><code>${this.escapeHtml(lead.submissionId || 'N/A')}</code></div>
            </div>
            <div class="order-detail">
                <label>Submitted:</label>
                <div class="order-detail-value">${this.escapeHtml(date)}</div>
            </div>
            <div class="order-detail">
                <label>Name:</label>
                <div class="order-detail-value">${this.escapeHtml(lead.fullName || 'Not provided')}</div>
            </div>
            <div class="order-detail">
                <label>Genre:</label>
                <div class="order-detail-value">${this.escapeHtml(this.formatGenre(lead.genre))}</div>
            </div>
            <div class="order-detail">
                <label>Subgenre:</label>
                <div class="order-detail-value">${this.escapeHtml(lead.subgenre || 'Not provided')}</div>
            </div>
            <div class="order-detail">
                <label>Years Making Music:</label>
                <div class="order-detail-value">${this.escapeHtml(lead.yearsMakingMusic || 'Not provided')}</div>
            </div>
            <div class="order-detail">
                <label>YouTube Video:</label>
                <div class="order-detail-value">
                    <a href="${youtubeUrl}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(lead.youtubeLink || 'N/A')}</a>
                </div>
            </div>
            <div class="order-detail">
                <label>Target Regions:</label>
                <div class="order-detail-value">${this.escapeHtml(this.getRegionsText(lead) || 'Not provided')}</div>
            </div>
            <div class="order-detail">
                <label>Target Age Group:</label>
                <div class="order-detail-value">${this.escapeHtml(lead.targetAgeGroup || 'Not provided')}</div>
            </div>
            <div class="order-detail">
                <label>Lead Status:</label>
                <div class="order-detail-value">
                    <select id="modalStatusSelect" class="form-control">
                        <option value="new" ${status === 'new' ? 'selected' : ''}>New</option>
                        <option value="contacted" ${status === 'contacted' ? 'selected' : ''}>Contacted</option>
                        <option value="qualified" ${status === 'qualified' ? 'selected' : ''}>Qualified</option>
                        <option value="archived" ${status === 'archived' ? 'selected' : ''}>Archived</option>
                    </select>
                </div>
            </div>
            <div class="order-detail">
                <label>Admin Notes:</label>
                <div class="order-detail-value">
                    <textarea id="modalAdminNotes" rows="4" class="form-control">${this.escapeHtml(lead.adminNotes || '')}</textarea>
                </div>
            </div>
        `;

        document.getElementById('orderModal').style.display = 'flex';
    }

    closeModal() {
        document.getElementById('orderModal').style.display = 'none';
        this.currentFirebaseKey = null;
    }

    async handleModalUpdate() {
        if (!this.currentFirebaseKey) return;

        if (this.currentModalType === 'trial-campaign') {
            await this.updateTrialCampaignStatus();
            return;
        }

        await this.updateOrderStatus();
    }

    async updateOrderStatus() {
        const newStatus = document.getElementById('modalStatusSelect').value;
        const adminNotes = document.getElementById('modalAdminNotes').value;

        try {
            const orderRef = ref(database, `orders/${this.currentFirebaseKey}`);
            await update(orderRef, {
                serviceStatus: newStatus,
                adminNotes,
                updatedAt: Date.now()
            });

            const orderIndex = this.orders.findIndex((order) => order.firebaseKey === this.currentFirebaseKey);
            if (orderIndex !== -1) {
                this.orders[orderIndex].serviceStatus = newStatus;
                this.orders[orderIndex].adminNotes = adminNotes;
                this.orders[orderIndex].updatedAt = Date.now();
            }

            this.closeModal();
            this.updateOrderStats();
            this.filterOrders();
            this.showSuccess('Order updated successfully');
        } catch (error) {
            console.error('Error updating order:', error);
            this.showError('Failed to update order');
        }
    }

    async updateTrialCampaignStatus() {
        const newStatus = document.getElementById('modalStatusSelect').value;
        const adminNotes = document.getElementById('modalAdminNotes').value;

        try {
            const leadRef = ref(database, `trialCampaignSubmissions/${this.currentFirebaseKey}`);
            await update(leadRef, {
                leadStatus: newStatus,
                adminNotes,
                updatedAt: Date.now()
            });

            const leadIndex = this.trialCampaigns.findIndex((lead) => lead.firebaseKey === this.currentFirebaseKey);
            if (leadIndex !== -1) {
                this.trialCampaigns[leadIndex].leadStatus = newStatus;
                this.trialCampaigns[leadIndex].adminNotes = adminNotes;
                this.trialCampaigns[leadIndex].updatedAt = Date.now();
            }

            this.closeModal();
            this.updateTrialStats();
            this.filterTrialCampaigns();
            this.showSuccess('Trial lead updated successfully');
        } catch (error) {
            console.error('Error updating trial lead:', error);
            this.showError('Failed to update trial lead');
        }
    }

    formatDate(timestamp) {
        if (!timestamp) return 'N/A';

        const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
        if (Number.isNaN(date.getTime())) return 'N/A';

        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    formatStatus(status) {
        return String(status || '')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (character) => character.toUpperCase());
    }

    formatGenre(genre) {
        const labels = {
            'hip-hop': 'Hip-Hop',
            'rnb-soul': 'R&B / Soul',
            'afrobeats': 'Afrobeats',
            'latin': 'Latin / Urbano'
        };

        if (!genre) return 'N/A';
        return labels[genre] || this.formatStatus(genre);
    }

    getRegionsText(lead) {
        if (Array.isArray(lead.targetRegionsList) && lead.targetRegionsList.length) {
            return lead.targetRegionsList.join(', ');
        }

        return String(lead.targetRegions || '').trim();
    }

    truncateText(text, maxLength) {
        if (!text) return 'N/A';
        return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
    }

    safeUrl(url) {
        try {
            const parsedUrl = new URL(String(url || ''));
            if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
                return parsedUrl.href;
            }
        } catch (error) {
            return '#';
        }

        return '#';
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    escapeAttribute(value) {
        return this.escapeHtml(value).replace(/`/g, '&#96;');
    }

    escapeStatus(value) {
        return String(value || 'unknown').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    }

    showError(message) {
        alert('Error: ' + message);
    }

    showSuccess(message) {
        alert('Success: ' + message);
    }
}

const adminDashboard = new AdminDashboard();
window.adminDashboard = adminDashboard;
