import { auth } from './firebase-config.js';
import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

const ADMIN_API_URL = '/api/lead-outreach-admin';
const SERVER_TIMESTAMP = '__SERVER_TIMESTAMP__';

const TABS = [
    { id: 'new', label: 'New Leads' },
    { id: 'pages', label: 'Pages' },
    { id: 'contacted', label: 'Contacted' }
];

class LeadOutreachBoard {
    constructor() {
        this.currentUser = null;
        this.activeTab = 'new';
        this.leads = [];
        this.pages = [];
        this.messages = [];
        this.channels = [];
        this.pendingDiscardKey = '';
        this.pendingContactKey = '';
        this.pendingContactButton = null;
        this.toastTimer = null;
        this.refreshTimer = null;

        this.cacheElements();
        this.setupEvents();
        this.setupAuthListener();
    }

    cacheElements() {
        this.authScreen = document.getElementById('authScreen');
        this.appShell = document.getElementById('appShell');
        this.busyOverlay = document.getElementById('busyOverlay');
        this.loginForm = document.getElementById('loginForm');
        this.loginError = document.getElementById('loginError');
        this.logoutBtn = document.getElementById('logoutBtn');
        this.toast = document.getElementById('toast');
        this.analyticsFilter = document.getElementById('analyticsFilter');
        this.newSort = document.getElementById('newSort');
        this.contactedSort = document.getElementById('contactedSort');
        this.pageFilter = document.getElementById('pageFilter');
        this.pageForm = document.getElementById('pageForm');
        this.pageMessage = document.getElementById('pageMessage');
        this.discardSheet = document.getElementById('discardSheet');
        this.contactChannelSheet = document.getElementById('contactChannelSheet');
        this.contactChannelOptions = document.getElementById('contactChannelOptions');
        this.clipboardDrawer = document.getElementById('clipboardDrawer');
        this.messageForm = document.getElementById('messageForm');
        this.channelsDrawer = document.getElementById('channelsDrawer');
        this.channelForm = document.getElementById('channelForm');
    }

    setupEvents() {
        this.loginForm.addEventListener('submit', (event) => this.handleLogin(event));
        this.logoutBtn.addEventListener('click', () => this.handleLogout());
        this.analyticsFilter.addEventListener('change', () => this.render());
        this.newSort.addEventListener('change', () => this.renderNewLeads());
        this.contactedSort.addEventListener('change', () => this.renderContactedLeads());
        this.pageFilter.addEventListener('change', () => this.renderPages());
        this.pageForm.addEventListener('submit', (event) => this.handleAddPage(event));
        this.messageForm.addEventListener('submit', (event) => this.handleAddMessage(event));
        this.channelForm.addEventListener('submit', (event) => this.handleAddChannel(event));

        document.querySelectorAll('[data-tab]').forEach((button) => {
            button.addEventListener('click', () => this.setActiveTab(button.dataset.tab));
        });

        document.getElementById('discardCancel').addEventListener('click', () => this.closeDiscardSheet());
        this.discardSheet.addEventListener('click', (event) => {
            if (event.target === this.discardSheet) this.closeDiscardSheet();
            const action = event.target.closest('[data-discard]');
            if (action) this.handleDiscard(action.dataset.discard);
        });

        document.getElementById('contactChannelCancel').addEventListener('click', () => this.closeContactChannelSheet());
        this.contactChannelSheet.addEventListener('click', (event) => {
            if (event.target === this.contactChannelSheet) this.closeContactChannelSheet();
            const action = event.target.closest('[data-channel-key]');
            if (action) this.confirmLeadContacted(action.dataset.channelKey);
        });

        document.getElementById('clipboardBtn').addEventListener('click', () => this.openClipboard());
        document.getElementById('clipboardClose').addEventListener('click', () => this.closeClipboard());
        document.getElementById('channelsBtn').addEventListener('click', () => this.openChannels());
        document.getElementById('channelsClose').addEventListener('click', () => this.closeChannels());
    }

    setupAuthListener() {
        onAuthStateChanged(auth, async (user) => {
            this.currentUser = user;
            if (!user) {
                this.showLogin();
                this.setBusy(false);
                this.stopAutoRefresh();
                return;
            }

            this.showApp();
            this.setBusy(true);
            await this.loadDashboardData();
            this.startAutoRefresh();
        });
    }

    showLogin() {
        this.authScreen.hidden = false;
        this.appShell.hidden = true;
    }

    showApp() {
        this.authScreen.hidden = true;
        this.appShell.hidden = false;
    }

    async handleLogin(event) {
        event.preventDefault();
        this.loginError.textContent = '';
        this.loginError.classList.remove('error');

        const button = document.getElementById('loginBtn');
        this.setButtonBusy(button, true, 'Signing in...');

        try {
            await signInWithEmailAndPassword(
                auth,
                document.getElementById('adminEmail').value.trim(),
                document.getElementById('adminPassword').value
            );
        } catch (error) {
            console.error('Lead outreach login failed:', error);
            this.loginError.textContent = 'Invalid email or password.';
            this.loginError.classList.add('error');
        } finally {
            this.setButtonBusy(button, false);
        }
    }

    async handleLogout() {
        try {
            await signOut(auth);
        } catch (error) {
            console.error('Lead outreach logout failed:', error);
            this.showToast('Logout failed. Please try again.');
        }
    }

    async loadDashboardData({ showLoader = false } = {}) {
        if (showLoader) this.setBusy(true);

        try {
            const result = await this.apiRequest('GET');
            this.leads = result.leads || [];
            this.pages = result.pages || [];
            this.messages = result.clipboardMessages || [];
            this.channels = result.channels || [];
            this.render();
        } catch (error) {
            console.error('Lead outreach load failed:', error);
            this.showToast(error.message || 'Could not load dashboard data.');
        } finally {
            this.setBusy(false);
        }
    }

    startAutoRefresh() {
        this.stopAutoRefresh();
        this.refreshTimer = window.setInterval(() => {
            if (!this.currentUser || document.hidden) return;
            this.loadDashboardData();
        }, 20000);
    }

    stopAutoRefresh() {
        if (!this.refreshTimer) return;
        window.clearInterval(this.refreshTimer);
        this.refreshTimer = null;
    }

    async apiRequest(method, payload = null) {
        if (!this.currentUser) {
            throw new Error('Please sign in again.');
        }

        const token = await this.currentUser.getIdToken();
        const response = await fetch(ADMIN_API_URL, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(payload ? { 'Content-Type': 'application/json' } : {})
            },
            body: payload ? JSON.stringify(payload) : undefined
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) {
            throw new Error(result.message || result.error || 'Request failed.');
        }

        return result;
    }

    render() {
        this.renderAnalytics();
        this.renderBadges();
        this.renderNewLeads();
        this.renderPages();
        this.renderContactedLeads();
        this.renderClipboard();
        this.renderChannels();
    }

    setActiveTab(tabId) {
        if (!TABS.some((tab) => tab.id === tabId)) return;
        this.activeTab = tabId;

        document.querySelectorAll('[data-tab]').forEach((button) => {
            button.classList.toggle('active', button.dataset.tab === tabId);
        });

        document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
        document.getElementById(`${tabId}Panel`).classList.add('active');
    }

    getNewLeads() {
        return this.leads.filter((lead) => (lead.leadStatus || 'new') === 'new');
    }

    getContactedLeads() {
        return this.leads.filter((lead) => ['contacted', 'converted'].includes(lead.leadStatus));
    }

    getAnalyticsLeads() {
        const range = this.analyticsFilter.value;
        if (range === 'all') return this.leads;

        const cutoff = Date.now() - Number(range) * 24 * 60 * 60 * 1000;
        return this.leads.filter((lead) => {
            const createdAt = Number(lead.createdAt || 0);
            return !createdAt || createdAt >= cutoff;
        });
    }

    renderAnalytics() {
        const leads = this.getAnalyticsLeads();
        const byStatus = (status) => leads.filter((lead) => (lead.leadStatus || 'new') === status).length;
        const byDiscardReason = (reason) => leads.filter((lead) => lead.leadStatus === 'discarded' && lead.discardReason === reason).length;

        document.getElementById('metricTotal').textContent = leads.length;
        document.getElementById('metricNew').textContent = byStatus('new');
        document.getElementById('metricContacted').textContent = byStatus('contacted');
        document.getElementById('metricConverted').textContent = byStatus('converted');
        document.getElementById('metricNotUseful').textContent = byDiscardReason('not_useful');
        document.getElementById('metricNotRelevant').textContent = byDiscardReason('not_relevant');
    }

    renderBadges() {
        document.getElementById('newBadge').textContent = this.getNewLeads().length;
        document.getElementById('pagesBadge').textContent = this.pages.length;
        document.getElementById('contactedBadge').textContent = this.getContactedLeads().length;
        document.getElementById('clipboardCount').textContent = this.messages.length;
    }

    renderNewLeads() {
        const list = document.getElementById('newLeadsList');
        const empty = document.getElementById('newEmpty');
        const leads = this.sortByDate(this.getNewLeads(), this.newSort.value, 'createdAt');

        list.innerHTML = leads.map((lead) => this.renderLeadCard(lead, 'new')).join('');
        empty.classList.toggle('visible', leads.length === 0);
        this.bindLeadButtons(list);
    }

    renderContactedLeads() {
        const list = document.getElementById('contactedList');
        const empty = document.getElementById('contactedEmpty');
        const leads = this.sortByDate(this.getContactedLeads(), this.contactedSort.value, 'contactedAt');

        list.innerHTML = leads.map((lead) => this.renderLeadCard(lead, 'contacted')).join('');
        empty.classList.toggle('visible', leads.length === 0);
        this.bindLeadButtons(list);
    }

    renderLeadCard(lead, context) {
        const status = lead.leadStatus || 'new';
        const instagramUrl = this.safeUrl(lead.instagramLink);
        const youtubeUrl = lead.youtubeLink ? this.safeUrl(lead.youtubeLink) : '#';
        const instagramUsername = this.extractInstagramUsername(lead.instagramLink);
        const youtubeDisplay = this.extractYouTubeDisplay(lead.youtubeLink);
        const date = this.formatDate(lead.createdAt || lead.submittedAtIso);
        const statusLabel = this.formatStatus(status);
        const channelLine = lead.outreachChannelName
            ? `<span class="lead-subitem">via ${this.escapeHtml(lead.outreachChannelName)}</span>`
            : '';
        const youtubeLine = youtubeDisplay
            ? `<span class="lead-subitem">${this.escapeHtml(youtubeDisplay)}</span>`
            : '';
        const primaryAction = context === 'new'
            ? `<button class="quick-action primary" type="button" data-action="contact" data-key="${this.escapeAttribute(lead.firebaseKey)}">Contacted</button>`
            : status === 'converted'
                ? `<span class="quick-action done">Converted</span>`
                : `<button class="quick-action primary" type="button" data-action="convert" data-key="${this.escapeAttribute(lead.firebaseKey)}">Converted</button>`;
        const youtubeButton = youtubeDisplay && youtubeUrl !== '#'
            ? `<a class="platform-btn youtube" href="${youtubeUrl}" target="_blank" rel="noopener noreferrer" aria-label="Open YouTube">YT</a>`
            : '';

        return `
            <article class="lead-card" data-key="${this.escapeAttribute(lead.firebaseKey)}">
                <div class="lead-avatar" aria-hidden="true">${this.escapeHtml(this.getAvatarInitial(instagramUsername))}</div>
                <div class="lead-main">
                    <div class="lead-title">
                        <strong>${this.escapeHtml(instagramUsername)}</strong>
                        <span class="status-dot ${this.escapeAttribute(status)}">${this.escapeHtml(statusLabel)}</span>
                    </div>
                    <div class="lead-meta">
                        <span>${this.escapeHtml(date)}</span>
                        ${channelLine}
                        ${youtubeLine}
                    </div>
                    <div class="platform-actions">
                        <a class="platform-btn instagram" href="${instagramUrl}" target="_blank" rel="noopener noreferrer" aria-label="Open Instagram">IG</a>
                        ${youtubeButton}
                    </div>
                </div>
                <div class="lead-actions">
                    ${primaryAction}
                    <button class="quick-action secondary" type="button" data-action="discard" data-key="${this.escapeAttribute(lead.firebaseKey)}">Skip</button>
                </div>
            </article>
        `;
    }

    bindLeadButtons(container) {
        container.querySelectorAll('[data-action]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const { action, key } = button.dataset;

                if (action === 'contact') this.markLeadContacted(key, button);
                if (action === 'convert') this.markLeadConverted(key, button);
                if (action === 'discard') this.openDiscardSheet(key);
            });
        });
    }

    async markLeadContacted(firebaseKey, button) {
        const activeChannels = this.getActiveChannels();
        if (activeChannels.length === 0) {
            this.showToast('Add an outreach channel first.');
            this.openChannels();
            return;
        }

        this.pendingContactKey = firebaseKey;
        this.pendingContactButton = button;
        this.renderContactChannelOptions();
        this.contactChannelSheet.hidden = false;
    }

    closeContactChannelSheet() {
        this.pendingContactKey = '';
        this.pendingContactButton = null;
        this.contactChannelSheet.hidden = true;
    }

    renderContactChannelOptions() {
        const activeChannels = this.getActiveChannels();
        this.contactChannelOptions.innerHTML = activeChannels.map((channel) => `
            <button type="button" class="sheet-action" data-channel-key="${this.escapeAttribute(channel.firebaseKey)}">
                ${this.escapeHtml(channel.name || 'Unnamed channel')}
            </button>
        `).join('');
    }

    async confirmLeadContacted(channelKey) {
        const firebaseKey = this.pendingContactKey;
        const button = this.pendingContactButton;
        const channel = this.channels.find((item) => item.firebaseKey === channelKey);

        if (!firebaseKey || !channel) return;

        this.closeContactChannelSheet();
        this.setButtonBusy(button, true, '...');
        try {
            await this.apiRequest('PATCH', {
                collection: 'leads',
                firebaseKey,
                updates: {
                    leadStatus: 'contacted',
                    contactedAt: SERVER_TIMESTAMP,
                    outreachChannelId: channel.firebaseKey,
                    outreachChannelName: channel.name || ''
                }
            });
            await this.loadDashboardData();
            this.showToast('Lead moved to Contacted.');
        } catch (error) {
            console.error('Mark contacted failed:', error);
            this.showToast('Could not mark contacted.');
        } finally {
            this.setButtonBusy(button, false);
        }
    }

    async markLeadConverted(firebaseKey, button) {
        this.setButtonBusy(button, true, '...');
        try {
            await this.apiRequest('PATCH', {
                collection: 'leads',
                firebaseKey,
                updates: {
                    leadStatus: 'converted',
                    convertedAt: SERVER_TIMESTAMP
                }
            });
            await this.loadDashboardData();
            this.showToast('Lead marked converted.');
        } catch (error) {
            console.error('Mark converted failed:', error);
            this.showToast('Could not mark converted.');
        } finally {
            this.setButtonBusy(button, false);
        }
    }

    openDiscardSheet(firebaseKey) {
        this.pendingDiscardKey = firebaseKey;
        this.discardSheet.hidden = false;
    }

    closeDiscardSheet() {
        this.pendingDiscardKey = '';
        this.discardSheet.hidden = true;
    }

    async handleDiscard(action) {
        const firebaseKey = this.pendingDiscardKey;
        if (!firebaseKey) return;

        try {
            if (action === 'delete') {
                const confirmed = window.confirm('Delete this lead without registering it in analytics?');
                if (!confirmed) return;
                await this.apiRequest('DELETE', {
                    collection: 'leads',
                    firebaseKey
                });
                this.showToast('Lead deleted.');
            } else {
                await this.apiRequest('PATCH', {
                    collection: 'leads',
                    firebaseKey,
                    updates: {
                        leadStatus: 'discarded',
                        discardReason: action,
                        discardedAt: SERVER_TIMESTAMP
                    }
                });
                this.showToast(action === 'not_useful' ? 'Marked not useful.' : 'Marked not relevant.');
            }
            await this.loadDashboardData();
        } catch (error) {
            console.error('Discard lead failed:', error);
            this.showToast('Could not remove lead.');
        } finally {
            this.closeDiscardSheet();
        }
    }

    async handleAddPage(event) {
        event.preventDefault();
        const input = document.getElementById('pageInstagramUrl');
        const button = this.pageForm.querySelector('button[type="submit"]');
        const instagramUrl = input.value.trim();

        this.setMessage(this.pageMessage, '', '');
        this.setButtonBusy(button, true, 'Adding...');

        try {
            await this.apiRequest('POST', {
                collection: 'pages',
                data: {
                    instagramUrl
                }
            });
            input.value = '';
            await this.loadDashboardData();
            this.setMessage(this.pageMessage, 'Page added.', 'success');
        } catch (error) {
            console.error('Add page failed:', error);
            this.setMessage(this.pageMessage, 'Could not add this page.', 'error');
        } finally {
            this.setButtonBusy(button, false);
        }
    }

    renderPages() {
        const list = document.getElementById('pagesList');
        const empty = document.getElementById('pagesEmpty');
        const filter = this.pageFilter.value;
        const pages = this.sortByDate(this.pages, 'newest', 'createdAt').filter((page) => {
            if (filter === 'active') return !page.isExhausted;
            if (filter === 'exhausted') return Boolean(page.isExhausted);
            return true;
        });

        list.innerHTML = pages.map((page) => {
            const exhausted = Boolean(page.isExhausted);
            const instagramUsername = this.extractInstagramUsername(page.instagramUrl);
            return `
                <article class="page-card source-card ${exhausted ? 'exhausted' : ''}" data-key="${this.escapeAttribute(page.firebaseKey)}">
                    <div class="source-main">
                        <div class="source-avatar" aria-hidden="true">#</div>
                        <div class="source-copy">
                            <div class="page-title">
                                <strong>${this.escapeHtml(instagramUsername)}</strong>
                                <span class="status-dot ${exhausted ? 'exhausted' : 'active'}">${exhausted ? 'Used' : 'Active'}</span>
                            </div>
                            <div class="page-meta">Source page · ${this.escapeHtml(this.formatDate(page.createdAt || page.submittedAtIso))}</div>
                        </div>
                    </div>
                    <div class="page-actions">
                        <label class="toggle-row">
                            <input type="checkbox" ${exhausted ? 'checked' : ''} data-page-action="toggle" data-key="${this.escapeAttribute(page.firebaseKey)}">
                            Used
                        </label>
                        <div>
                            <a class="platform-btn instagram" href="${this.safeUrl(page.instagramUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open Instagram">IG</a>
                            <button class="mini-btn danger" type="button" data-page-action="delete" data-key="${this.escapeAttribute(page.firebaseKey)}">Delete</button>
                        </div>
                    </div>
                </article>
            `;
        }).join('');

        empty.classList.toggle('visible', pages.length === 0);
        this.bindPageButtons(list);
    }

    bindPageButtons(container) {
        container.querySelectorAll('[data-page-action]').forEach((control) => {
            control.addEventListener('click', async (event) => {
                const action = control.dataset.pageAction;
                const key = control.dataset.key;
                if (action === 'toggle') {
                    await this.togglePageExhausted(key, control.checked);
                }
                if (action === 'delete') {
                    event.preventDefault();
                    await this.deletePage(key);
                }
            });
        });
    }

    async togglePageExhausted(firebaseKey, isExhausted) {
        try {
            await this.apiRequest('PATCH', {
                collection: 'pages',
                firebaseKey,
                updates: {
                    isExhausted,
                    pageStatus: isExhausted ? 'exhausted' : 'active',
                    exhaustedAt: isExhausted ? SERVER_TIMESTAMP : null
                }
            });
            await this.loadDashboardData();
        } catch (error) {
            console.error('Toggle page failed:', error);
            this.showToast('Could not update page.');
        }
    }

    async deletePage(firebaseKey) {
        if (!window.confirm('Delete this page from the outreach list?')) return;
        try {
            await this.apiRequest('DELETE', {
                collection: 'pages',
                firebaseKey
            });
            await this.loadDashboardData();
            this.showToast('Page deleted.');
        } catch (error) {
            console.error('Delete page failed:', error);
            this.showToast('Could not delete page.');
        }
    }

    openClipboard() {
        this.clipboardDrawer.classList.add('open');
        this.clipboardDrawer.setAttribute('aria-hidden', 'false');
    }

    closeClipboard() {
        this.clipboardDrawer.classList.remove('open');
        this.clipboardDrawer.setAttribute('aria-hidden', 'true');
    }

    openChannels() {
        this.channelsDrawer.classList.add('open');
        this.channelsDrawer.setAttribute('aria-hidden', 'false');
    }

    closeChannels() {
        this.channelsDrawer.classList.remove('open');
        this.channelsDrawer.setAttribute('aria-hidden', 'true');
    }

    getActiveChannels() {
        return this.channels
            .filter((channel) => channel.isActive !== false)
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    }

    async handleAddChannel(event) {
        event.preventDefault();
        const input = document.getElementById('channelName');
        const message = document.getElementById('channelMessage');
        const button = this.channelForm.querySelector('button[type="submit"]');
        const name = input.value.trim();

        this.setButtonBusy(button, true, 'Adding...');
        this.setMessage(message, '', '');

        try {
            await this.apiRequest('POST', {
                collection: 'channels',
                data: { name }
            });
            input.value = '';
            await this.loadDashboardData();
            this.setMessage(message, 'Channel added.', 'success');
        } catch (error) {
            console.error('Add channel failed:', error);
            this.setMessage(message, error.message || 'Could not add channel.', 'error');
        } finally {
            this.setButtonBusy(button, false);
        }
    }

    renderChannels() {
        const list = document.getElementById('channelList');
        const empty = document.getElementById('channelEmpty');
        const channels = this.getActiveChannels();

        list.innerHTML = channels.map((channel) => `
            <article class="message-card channel-card" data-key="${this.escapeAttribute(channel.firebaseKey)}">
                <div class="message-title">
                    <strong>${this.escapeHtml(channel.name || 'Unnamed channel')}</strong>
                    <button class="mini-btn danger" type="button" data-channel-action="delete" data-key="${this.escapeAttribute(channel.firebaseKey)}">Delete</button>
                </div>
            </article>
        `).join('');

        empty.classList.toggle('visible', channels.length === 0);
        this.bindChannelButtons(list);
    }

    bindChannelButtons(container) {
        container.querySelectorAll('[data-channel-action]').forEach((button) => {
            button.addEventListener('click', async () => {
                if (button.dataset.channelAction === 'delete') {
                    await this.deleteChannel(button.dataset.key);
                }
            });
        });
    }

    async deleteChannel(firebaseKey) {
        if (!window.confirm('Delete this outreach channel? Existing contacted leads will keep the saved channel name.')) return;

        try {
            await this.apiRequest('DELETE', {
                collection: 'channels',
                firebaseKey
            });
            await this.loadDashboardData();
            this.showToast('Channel deleted.');
        } catch (error) {
            console.error('Delete channel failed:', error);
            this.showToast('Could not delete channel.');
        }
    }

    async handleAddMessage(event) {
        event.preventDefault();
        const titleInput = document.getElementById('messageTitle');
        const bodyInput = document.getElementById('messageBody');
        const button = this.messageForm.querySelector('button[type="submit"]');

        this.setButtonBusy(button, true, 'Adding...');
        this.setMessage(document.getElementById('clipboardMessage'), '', '');

        try {
            await this.apiRequest('POST', {
                collection: 'clipboardMessages',
                data: {
                    title: titleInput.value.trim(),
                    body: bodyInput.value.trim()
                }
            });
            titleInput.value = '';
            bodyInput.value = '';
            await this.loadDashboardData();
            this.setMessage(document.getElementById('clipboardMessage'), 'Message added.', 'success');
        } catch (error) {
            console.error('Add message failed:', error);
            this.setMessage(document.getElementById('clipboardMessage'), 'Could not add message.', 'error');
        } finally {
            this.setButtonBusy(button, false);
        }
    }

    renderClipboard() {
        const list = document.getElementById('messageList');
        const empty = document.getElementById('messageEmpty');
        const messages = this.sortByDate(this.messages, 'newest', 'createdAt');

        document.getElementById('clipboardCount').textContent = messages.length;
        list.innerHTML = messages.map((message) => `
            <article class="message-card" data-key="${this.escapeAttribute(message.firebaseKey)}">
                <div class="message-title">
                    <strong>${this.escapeHtml(message.title || 'Untitled')}</strong>
                </div>
                <div class="message-body">${this.escapeHtml(message.body || '')}</div>
                <div class="message-actions">
                    <button class="mini-btn" type="button" data-message-action="copy" data-key="${this.escapeAttribute(message.firebaseKey)}">Copy</button>
                    <button class="mini-btn" type="button" data-message-action="expand">Expand</button>
                    <button class="mini-btn danger" type="button" data-message-action="delete" data-key="${this.escapeAttribute(message.firebaseKey)}">x</button>
                </div>
            </article>
        `).join('');
        empty.classList.toggle('visible', messages.length === 0);
        this.bindMessageButtons(list);
    }

    bindMessageButtons(container) {
        container.querySelectorAll('[data-message-action]').forEach((button) => {
            button.addEventListener('click', async () => {
                const action = button.dataset.messageAction;
                const card = button.closest('.message-card');
                const key = button.dataset.key;

                if (action === 'expand') {
                    card.classList.toggle('expanded');
                    button.textContent = card.classList.contains('expanded') ? 'Collapse' : 'Expand';
                }

                if (action === 'copy') {
                    const message = this.messages.find((item) => item.firebaseKey === key);
                    await this.copyText(message?.body || '');
                }

                if (action === 'delete') {
                    await this.deleteMessage(key);
                }
            });
        });
    }

    async copyText(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
            }
            this.showToast('Copied to clipboard.');
        } catch (error) {
            console.error('Copy failed:', error);
            this.showToast('Copy failed.');
        }
    }

    async deleteMessage(firebaseKey) {
        if (!window.confirm('Delete this saved message?')) return;
        try {
            await this.apiRequest('DELETE', {
                collection: 'clipboardMessages',
                firebaseKey
            });
            await this.loadDashboardData();
            this.showToast('Message deleted.');
        } catch (error) {
            console.error('Delete message failed:', error);
            this.showToast('Could not delete message.');
        }
    }

    sortByDate(items, direction, field) {
        const sorted = [...items].sort((a, b) => {
            const first = Number(a[field] || a.createdAt || 0);
            const second = Number(b[field] || b.createdAt || 0);
            return first - second;
        });
        return direction === 'oldest' ? sorted : sorted.reverse();
    }

    formatDate(value) {
        if (!value) return 'Just now';
        const date = typeof value === 'number' ? new Date(value) : new Date(value);
        if (Number.isNaN(date.getTime())) return 'Just now';
        return new Intl.DateTimeFormat('en-IN', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    }

    formatStatus(status) {
        const labels = {
            new: 'New',
            contacted: 'Contacted',
            converted: 'Converted',
            discarded: 'Discarded'
        };
        return labels[status] || status || 'New';
    }

    extractInstagramUsername(value) {
        const fallback = '@instagram';
        const rawValue = String(value || '').trim();
        if (!rawValue) return fallback;

        try {
            const url = new URL(rawValue);
            const handle = url.pathname.split('/').filter(Boolean)[0] || '';
            return handle ? `@${decodeURIComponent(handle).replace(/^@/, '')}` : fallback;
        } catch (error) {
            const cleaned = rawValue
                .replace(/^https?:\/\//, '')
                .replace(/^www\./, '')
                .replace(/^instagram\.com\//, '')
                .split(/[/?#]/)[0]
                .replace(/^@/, '');
            return cleaned ? `@${cleaned}` : fallback;
        }
    }

    extractYouTubeDisplay(value) {
        const rawValue = String(value || '').trim();
        if (!rawValue) return '';

        try {
            const url = new URL(rawValue);
            const parts = url.pathname.split('/').filter(Boolean);
            const handle = parts.find((part) => part.startsWith('@'));

            if (handle) return handle;
            if (parts[0] === 'channel' && parts[1]) return 'Channel';
            if (['c', 'user'].includes(parts[0]) && parts[1]) return parts[1];
            if (url.hostname.includes('youtu.be') || url.searchParams.get('v')) return 'YouTube video';
            return 'YouTube';
        } catch (error) {
            return 'YouTube';
        }
    }

    getAvatarInitial(label) {
        const character = String(label || '')
            .replace(/^@/, '')
            .trim()
            .charAt(0);

        return character ? character.toUpperCase() : 'L';
    }

    truncateUrl(value) {
        return String(value || 'No link')
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .slice(0, 64);
    }

    safeUrl(value) {
        try {
            const url = new URL(value);
            if (!['http:', 'https:'].includes(url.protocol)) return '#';
            return this.escapeAttribute(url.href);
        } catch (error) {
            return '#';
        }
    }

    setButtonBusy(button, isBusy, label = '') {
        if (!button) return;
        if (isBusy) {
            button.dataset.originalText = button.textContent;
            button.textContent = label || button.textContent;
            button.disabled = true;
            return;
        }
        button.textContent = button.dataset.originalText || button.textContent;
        button.disabled = false;
    }

    setBusy(isBusy) {
        this.busyOverlay.hidden = !isBusy;
    }

    setMessage(element, message, type) {
        element.textContent = message;
        element.classList.remove('error', 'success');
        if (type) element.classList.add(type);
    }

    showToast(message) {
        window.clearTimeout(this.toastTimer);
        this.toast.textContent = message;
        this.toast.classList.add('visible');
        this.toastTimer = window.setTimeout(() => {
            this.toast.classList.remove('visible');
        }, 2200);
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    escapeAttribute(value) {
        return this.escapeHtml(value).replace(/`/g, '&#096;');
    }
}

window.leadOutreachBoard = new LeadOutreachBoard();
