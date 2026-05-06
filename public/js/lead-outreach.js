import { auth, database } from './firebase-config.js';
import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    ref,
    onValue,
    push,
    update,
    remove,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

const MODULE_ROOT = 'leadOutreach';

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
        this.listenersReady = {
            leads: false,
            pages: false,
            messages: false
        };
        this.pendingDiscardKey = '';
        this.toastTimer = null;

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
        this.clipboardDrawer = document.getElementById('clipboardDrawer');
        this.messageForm = document.getElementById('messageForm');
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

        document.querySelectorAll('[data-tab]').forEach((button) => {
            button.addEventListener('click', () => this.setActiveTab(button.dataset.tab));
        });

        document.getElementById('discardCancel').addEventListener('click', () => this.closeDiscardSheet());
        this.discardSheet.addEventListener('click', (event) => {
            if (event.target === this.discardSheet) this.closeDiscardSheet();
            const action = event.target.closest('[data-discard]');
            if (action) this.handleDiscard(action.dataset.discard);
        });

        document.getElementById('clipboardBtn').addEventListener('click', () => this.openClipboard());
        document.getElementById('clipboardClose').addEventListener('click', () => this.closeClipboard());
    }

    setupAuthListener() {
        this.setBusy(true);
        onAuthStateChanged(auth, (user) => {
            this.currentUser = user;
            if (!user) {
                this.showLogin();
                this.setBusy(false);
                return;
            }

            this.showApp();
            this.attachRealtimeListeners();
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

    attachRealtimeListeners() {
        onValue(ref(database, `${MODULE_ROOT}/leads`), (snapshot) => {
            this.leads = this.snapshotToArray(snapshot);
            this.listenersReady.leads = true;
            this.render();
            this.stopInitialBusyWhenReady();
        }, (error) => this.handleRealtimeError(error));

        onValue(ref(database, `${MODULE_ROOT}/pages`), (snapshot) => {
            this.pages = this.snapshotToArray(snapshot);
            this.listenersReady.pages = true;
            this.render();
            this.stopInitialBusyWhenReady();
        }, (error) => this.handleRealtimeError(error));

        onValue(ref(database, `${MODULE_ROOT}/clipboardMessages`), (snapshot) => {
            this.messages = this.snapshotToArray(snapshot);
            this.listenersReady.messages = true;
            this.renderClipboard();
            this.stopInitialBusyWhenReady();
        }, (error) => this.handleRealtimeError(error));
    }

    stopInitialBusyWhenReady() {
        if (Object.values(this.listenersReady).every(Boolean)) {
            this.setBusy(false);
        }
    }

    handleRealtimeError(error) {
        console.error('Lead outreach realtime error:', error);
        this.setBusy(false);
        this.showToast('Could not load live data. Check Firebase access.');
    }

    snapshotToArray(snapshot) {
        const items = [];
        if (!snapshot.exists()) return items;

        snapshot.forEach((child) => {
            items.push({
                firebaseKey: child.key,
                ...child.val()
            });
        });

        return items;
    }

    render() {
        this.renderAnalytics();
        this.renderBadges();
        this.renderNewLeads();
        this.renderPages();
        this.renderContactedLeads();
        this.renderClipboard();
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
        const primaryUrl = this.safeUrl(lead.instagramLink);
        const date = this.formatDate(lead.createdAt || lead.submittedAtIso);
        const youtube = lead.youtubeLink
            ? `<div class="lead-meta">YouTube: ${this.escapeHtml(this.truncateUrl(lead.youtubeLink))}</div>`
            : '';
        const convertedAction = context === 'contacted' && status !== 'converted'
            ? `<button class="chip-btn convert" type="button" title="Mark converted" data-action="convert" data-key="${this.escapeAttribute(lead.firebaseKey)}">$</button>`
            : '';

        return `
            <article class="lead-card" data-key="${this.escapeAttribute(lead.firebaseKey)}">
                <a class="lead-open" href="${primaryUrl}" target="_blank" rel="noopener noreferrer">
                    <div class="lead-title">
                        <strong>${this.escapeHtml(this.truncateUrl(lead.instagramLink))}</strong>
                        <span class="status-pill ${this.escapeAttribute(status)}">${this.escapeHtml(this.formatStatus(status))}</span>
                    </div>
                    <div class="lead-meta">${this.escapeHtml(lead.leadId || 'Lead')} · ${this.escapeHtml(date)}</div>
                    ${youtube}
                </a>
                <div class="lead-actions">
                    ${context === 'new' ? `<button class="chip-btn contact" type="button" title="Mark contacted" data-action="contact" data-key="${this.escapeAttribute(lead.firebaseKey)}">✓</button>` : ''}
                    ${convertedAction}
                    <button class="chip-btn delete" type="button" title="Remove lead" data-action="discard" data-key="${this.escapeAttribute(lead.firebaseKey)}">x</button>
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
        this.setButtonBusy(button, true, '...');
        try {
            await update(ref(database, `${MODULE_ROOT}/leads/${firebaseKey}`), {
                leadStatus: 'contacted',
                contactedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                contactedBy: this.currentUser?.email || ''
            });
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
            await update(ref(database, `${MODULE_ROOT}/leads/${firebaseKey}`), {
                leadStatus: 'converted',
                convertedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                convertedBy: this.currentUser?.email || ''
            });
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
                await remove(ref(database, `${MODULE_ROOT}/leads/${firebaseKey}`));
                this.showToast('Lead deleted.');
            } else {
                await update(ref(database, `${MODULE_ROOT}/leads/${firebaseKey}`), {
                    leadStatus: 'discarded',
                    discardReason: action,
                    discardedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    discardedBy: this.currentUser?.email || ''
                });
                this.showToast(action === 'not_useful' ? 'Marked not useful.' : 'Marked not relevant.');
            }
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
            await push(ref(database, `${MODULE_ROOT}/pages`), {
                instagramUrl,
                source: 'lead-outreach-board',
                pageStatus: 'active',
                isExhausted: false,
                notes: '',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdBy: this.currentUser?.email || ''
            });
            input.value = '';
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
            return `
                <article class="page-card ${exhausted ? 'exhausted' : ''}" data-key="${this.escapeAttribute(page.firebaseKey)}">
                    <div class="page-title">
                        <strong>${this.escapeHtml(this.truncateUrl(page.instagramUrl))}</strong>
                        <span class="status-pill ${exhausted ? 'exhausted' : 'active'}">${exhausted ? 'Used' : 'Active'}</span>
                    </div>
                    <div class="page-meta">${this.escapeHtml(page.pageId || 'Page')} · ${this.escapeHtml(this.formatDate(page.createdAt || page.submittedAtIso))}</div>
                    <div class="page-actions">
                        <label class="toggle-row">
                            <input type="checkbox" ${exhausted ? 'checked' : ''} data-page-action="toggle" data-key="${this.escapeAttribute(page.firebaseKey)}">
                            Used/exhausted
                        </label>
                        <div>
                            <a class="mini-btn" href="${this.safeUrl(page.instagramUrl)}" target="_blank" rel="noopener noreferrer">Open</a>
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
            await update(ref(database, `${MODULE_ROOT}/pages/${firebaseKey}`), {
                isExhausted,
                pageStatus: isExhausted ? 'exhausted' : 'active',
                exhaustedAt: isExhausted ? serverTimestamp() : null,
                updatedAt: serverTimestamp(),
                updatedBy: this.currentUser?.email || ''
            });
        } catch (error) {
            console.error('Toggle page failed:', error);
            this.showToast('Could not update page.');
        }
    }

    async deletePage(firebaseKey) {
        if (!window.confirm('Delete this page from the outreach list?')) return;
        try {
            await remove(ref(database, `${MODULE_ROOT}/pages/${firebaseKey}`));
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

    async handleAddMessage(event) {
        event.preventDefault();
        const titleInput = document.getElementById('messageTitle');
        const bodyInput = document.getElementById('messageBody');
        const button = this.messageForm.querySelector('button[type="submit"]');

        this.setButtonBusy(button, true, 'Adding...');
        this.setMessage(document.getElementById('clipboardMessage'), '', '');

        try {
            await push(ref(database, `${MODULE_ROOT}/clipboardMessages`), {
                title: titleInput.value.trim(),
                body: bodyInput.value.trim(),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdBy: this.currentUser?.email || ''
            });
            titleInput.value = '';
            bodyInput.value = '';
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
            await remove(ref(database, `${MODULE_ROOT}/clipboardMessages/${firebaseKey}`));
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
