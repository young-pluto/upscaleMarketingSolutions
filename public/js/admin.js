import { auth, database } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { 
    ref, 
    get, 
    set, 
    update,
    orderByChild,
    limitToLast,
    query
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

class AdminDashboard {
    constructor() {
        this.currentUser = null;
        this.orders = [];
        this.filteredOrders = [];
        this.init();
    }

    init() {
        this.setupAuthListener();
        this.setupEventListeners();
        this.checkAuthState();
    }

    setupAuthListener() {
        onAuthStateChanged(auth, (user) => {
            if (user) {
                this.currentUser = user;
                this.showDashboard();
                this.loadOrders();
            } else {
                this.currentUser = null;
                this.showLogin();
            }
        });
    }

    setupEventListeners() {
        // Login form
        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        // Logout button
        document.getElementById('logoutBtn').addEventListener('click', () => {
            this.handleLogout();
        });

        // Search and filters
        document.getElementById('searchInput').addEventListener('input', () => {
            this.filterOrders();
        });

        document.getElementById('statusFilter').addEventListener('change', () => {
            this.filterOrders();
        });

        document.getElementById('sortBy').addEventListener('change', () => {
            this.filterOrders();
        });

        // Refresh button
        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.loadOrders();
        });

        // Modal close events
        document.querySelector('.close').addEventListener('click', () => {
            this.closeModal();
        });

        document.querySelector('.close-btn').addEventListener('click', () => {
            this.closeModal();
        });

        // Close modal when clicking outside
        document.getElementById('orderModal').addEventListener('click', (e) => {
            if (e.target.id === 'orderModal') {
                this.closeModal();
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
        // Check if user is already logged in
        const user = auth.currentUser;
        if (user) {
            this.showDashboard();
        } else {
            this.showLogin();
        }
    }

    async loadOrders() {
        const loadingEl = document.getElementById('loadingIndicator');
        const tableBody = document.getElementById('ordersTableBody');
        
        loadingEl.style.display = 'flex';
        tableBody.innerHTML = '';

        try {
            console.log('Loading orders from API...');
            
            const response = await fetch('/api/get-orders');
            const result = await response.json();
            
            if (result.success) {
                this.orders = result.orders || [];
                console.log(`Loaded ${this.orders.length} orders:`, this.orders);
            } else {
                console.error('API returned error:', result);
                this.showError('Failed to load orders: ' + (result.message || 'Unknown error'));
                this.orders = [];
            }

            this.updateStats();
            this.filterOrders();
            
        } catch (error) {
            console.error('Error loading orders:', error);
            this.showError('Failed to load orders: ' + error.message);
            this.orders = [];
        } finally {
            loadingEl.style.display = 'none';
        }
    }

    updateStats() {
        const totalRevenue = this.orders.reduce((sum, order) => sum + (order.amount || 0), 0);
        const totalOrders = this.orders.length;
        const pendingOrders = this.orders.filter(order => order.serviceStatus === 'pending').length;
        const completedOrders = this.orders.filter(order => order.serviceStatus === 'completed').length;

        document.getElementById('totalRevenue').textContent = `$${totalRevenue.toFixed(2)}`;
        document.getElementById('totalOrders').textContent = totalOrders;
        document.getElementById('pendingOrders').textContent = pendingOrders;
        document.getElementById('completedOrders').textContent = completedOrders;
    }

    filterOrders() {
        const searchTerm = document.getElementById('searchInput').value.toLowerCase();
        const statusFilter = document.getElementById('statusFilter').value;
        const sortBy = document.getElementById('sortBy').value;

        // Filter orders
        this.filteredOrders = this.orders.filter(order => {
            const matchesSearch = !searchTerm || 
                order.orderID?.toLowerCase().includes(searchTerm) ||
                order.youtubeLink?.toLowerCase().includes(searchTerm) ||
                order.email?.toLowerCase().includes(searchTerm) ||
                order.fullName?.toLowerCase().includes(searchTerm);

            const matchesStatus = !statusFilter || order.serviceStatus === statusFilter;

            return matchesSearch && matchesStatus;
        });

        // Sort orders
        this.filteredOrders.sort((a, b) => {
            switch (sortBy) {
                case 'timestamp_desc':
                    return (b.createdAt || 0) - (a.createdAt || 0);
                case 'timestamp_asc':
                    return (a.createdAt || 0) - (b.createdAt || 0);
                case 'amount_desc':
                    return (b.amount || 0) - (a.amount || 0);
                case 'amount_asc':
                    return (a.amount || 0) - (b.amount || 0);
                default:
                    return 0;
            }
        });

        this.renderOrders();
        this.updateOrderCount();
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

        tableBody.innerHTML = this.filteredOrders.map(order => {
            const date = this.formatDate(order.createdAt || order.timestamp);
            const youtubeLink = this.truncateText(order.youtubeLink, 40);
            const customerName = order.fullName || 'N/A';
            const contact = order.email || order.phone || 'N/A';
            
            return `
                <tr>
                    <td><code>${order.orderID}</code></td>
                    <td>${date}</td>
                    <td><strong>$${(order.amount || 0).toFixed(2)}</strong></td>
                    <td>
                        <a href="${order.youtubeLink}" target="_blank" class="youtube-link" title="${order.youtubeLink}">
                            ${youtubeLink}
                        </a>
                    </td>
                    <td>${customerName}</td>
                    <td>${contact}</td>
                    <td>
                        <span class="status-badge status-${order.serviceStatus || 'pending'}">
                            ${(order.serviceStatus || 'pending').replace('_', ' ')}
                        </span>
                    </td>
                    <td>
                        <button class="action-btn view-btn" onclick="adminDashboard.viewOrderDetails('${order.firebaseKey}')">
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

    viewOrderDetails(firebaseKey) {
        const order = this.orders.find(o => o.firebaseKey === firebaseKey);
        if (!order) return;

        const modalBody = document.getElementById('orderModalBody');
        const date = this.formatDate(order.createdAt || order.timestamp);
        
        modalBody.innerHTML = `
            <div class="order-detail">
                <label>Order ID:</label>
                <div class="order-detail-value"><code>${order.orderID}</code></div>
            </div>
            <div class="order-detail">
                <label>Date:</label>
                <div class="order-detail-value">${date}</div>
            </div>
            <div class="order-detail">
                <label>Amount:</label>
                <div class="order-detail-value"><strong>$${(order.amount || 0).toFixed(2)} ${order.currency || 'USD'}</strong></div>
            </div>
            <div class="order-detail">
                <label>YouTube Link:</label>
                <div class="order-detail-value">
                    <a href="${order.youtubeLink}" target="_blank">${order.youtubeLink}</a>
                </div>
            </div>
            <div class="order-detail">
                <label>Customer Name:</label>
                <div class="order-detail-value">${order.fullName || 'Not provided'}</div>
            </div>
            <div class="order-detail">
                <label>Email:</label>
                <div class="order-detail-value">${order.email || 'Not provided'}</div>
            </div>
            <div class="order-detail">
                <label>Phone:</label>
                <div class="order-detail-value">${order.phone || 'Not provided'}</div>
            </div>
            <div class="order-detail">
                <label>PayPal Transaction ID:</label>
                <div class="order-detail-value"><code>${order.paypalTransactionId || 'N/A'}</code></div>
            </div>
            <div class="order-detail">
                <label>Service Status:</label>
                <div class="order-detail-value">
                    <select id="modalStatusSelect" class="form-control">
                        <option value="pending" ${order.serviceStatus === 'pending' ? 'selected' : ''}>Pending</option>
                        <option value="in_progress" ${order.serviceStatus === 'in_progress' ? 'selected' : ''}>In Progress</option>
                        <option value="completed" ${order.serviceStatus === 'completed' ? 'selected' : ''}>Completed</option>
                        <option value="cancelled" ${order.serviceStatus === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                    </select>
                </div>
            </div>
            <div class="order-detail">
                <label>Admin Notes:</label>
                <div class="order-detail-value">
                    <textarea id="modalAdminNotes" rows="3" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">${order.adminNotes || ''}</textarea>
                </div>
            </div>
        `;

        // Store current firebase key for updates
        this.currentFirebaseKey = firebaseKey;
        
        document.getElementById('orderModal').style.display = 'flex';
    }

    closeModal() {
        document.getElementById('orderModal').style.display = 'none';
        this.currentFirebaseKey = null;
    }

    async updateOrderStatus() {
        if (!this.currentFirebaseKey) return;

        const newStatus = document.getElementById('modalStatusSelect').value;
        const adminNotes = document.getElementById('modalAdminNotes').value;

        try {
            const orderRef = ref(database, `orders/${this.currentFirebaseKey}`);
            await update(orderRef, {
                serviceStatus: newStatus,
                adminNotes: adminNotes,
                updatedAt: Date.now()
            });

            // Update local data
            const orderIndex = this.orders.findIndex(o => o.firebaseKey === this.currentFirebaseKey);
            if (orderIndex !== -1) {
                this.orders[orderIndex].serviceStatus = newStatus;
                this.orders[orderIndex].adminNotes = adminNotes;
            }

            this.closeModal();
            this.updateStats();
            this.filterOrders();
            
            this.showSuccess('Order updated successfully');
        } catch (error) {
            console.error('Error updating order:', error);
            this.showError('Failed to update order');
        }
    }

    formatDate(timestamp) {
        if (!timestamp) return 'N/A';
        
        let date;
        if (typeof timestamp === 'number') {
            // Unix timestamp
            date = new Date(timestamp);
        } else if (typeof timestamp === 'string') {
            date = new Date(timestamp);
        } else {
            date = timestamp;
        }
        
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    truncateText(text, maxLength) {
        if (!text) return 'N/A';
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    showError(message) {
        // Simple error display - you can enhance this
        alert('Error: ' + message);
    }

    showSuccess(message) {
        // Simple success display - you can enhance this
        alert('Success: ' + message);
    }
}

// Initialize admin dashboard
const adminDashboard = new AdminDashboard();

// Make updateOrderStatus available globally for the modal button
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('updateStatusBtn').addEventListener('click', () => {
        adminDashboard.updateOrderStatus();
    });
});

// Export for global access
window.adminDashboard = adminDashboard;