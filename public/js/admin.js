/* ============================================================
   USM Admin — single-page operations panel
   - Central state + hash router (browser back works everywhere)
   - Firebase realtime subscriptions (writes echo locally =
     instant UI, no manual refresh needed)
   - Active / Neutral / Dormant categorization on clients,
     old clients and trial leads
   ============================================================ */

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
    onValue
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

/* ============ CONSTANTS ============ */

const TEST_ORDER_CUTOFF_MS = Date.parse('2025-09-06T00:00:00Z');
const ORDER_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
const TRIAL_STATUSES = ['new', 'completed', 'contacted', 'converted', 'archived'];
// A lead counts as "trialed" once its trial has actually run
const TRIALED_STATUSES = ['completed', 'contacted', 'converted'];
const ACTIVITIES = ['active', 'neutral', 'dormant'];
const ACTIVITY_LABEL = { active: 'Active', neutral: 'Neutral', dormant: 'Dormant' };
const PAGE_SIZE = 20;
const DAY_MS = 86_400_000;

const $ = (id) => document.getElementById(id);

/* ============ STATE ============ */

const S = {
    user: null,
    orders: [],
    clients: [],
    legacy: [],
    trials: [],
    channels: [],
    loaded: { orders: false, clients: false, legacy: false, trials: false, channels: false },
    route: { view: 'orders', id: null },
    ui: {
        orders: { tab: 'pending', search: '', sort: 'newest', stats: false, test: false, clientFilter: null, shown: PAGE_SIZE, expanded: null },
        clients: { tab: 'all', search: '', sort: 'recent' },
        leads: { tab: 'new', activity: 'all', search: '', genre: '', sort: 'newest', stats: false, shown: PAGE_SIZE },
        old: { tab: 'hot', search: '', channel: '', sort: 'oldest' },
        channels: { search: '' },
    },
    dirty: false, // unsaved edits on the open detail view
};

// Restore sticky UI prefs (tabs & sorts survive a reload)
try {
    const saved = JSON.parse(sessionStorage.getItem('usm-admin-ui') || 'null');
    if (saved) {
        for (const k of ['orders', 'clients', 'leads', 'old']) {
            if (saved[k]) Object.assign(S.ui[k], saved[k], { shown: PAGE_SIZE, clientFilter: null, expanded: null });
        }
    }
} catch (e) { /* ignore */ }

function persistUi() {
    try {
        sessionStorage.setItem('usm-admin-ui', JSON.stringify({
            orders: { tab: S.ui.orders.tab, sort: S.ui.orders.sort },
            clients: { tab: S.ui.clients.tab, sort: S.ui.clients.sort },
            leads: { tab: S.ui.leads.tab, activity: S.ui.leads.activity, sort: S.ui.leads.sort },
            old: { tab: S.ui.old.tab, sort: S.ui.old.sort },
        }));
    } catch (e) { /* ignore */ }
}

/* ============ SMALL HELPERS ============ */

function escapeHtml(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const escAttr = (v) => escapeHtml(v).replace(/`/g, '&#96;');

function icon(name, cls = '') {
    return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function safeUrl(url) {
    try {
        const u = new URL(String(url || ''));
        if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    } catch (e) { }
    return '';
}

function instagramUrl(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return safeUrl(v);
    const handle = v.replace(/^@/, '').replace(/^instagram\.com\//i, '').replace(/^\/+/, '');
    return handle ? `https://instagram.com/${handle}` : '';
}

function igHandle(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    let handle = v;
    if (/^https?:\/\//i.test(v)) {
        try { handle = new URL(v).pathname; } catch (e) { return ''; }
    }
    handle = handle
        .replace(/^@/, '')
        .replace(/^instagram\.com\//i, '')
        .replace(/^\/+|\/+$/g, '')
        .split('/')[0]
        .split('?')[0];
    return /^[a-zA-Z0-9._]{1,30}$/.test(handle) ? handle : '';
}

// IG profile picture via unavatar.io; falls back to the initial underneath
function avatarHtml(name, instagram) {
    const initial = escapeHtml((String(name || '?').trim()[0] || '?').toUpperCase());
    const handle = igHandle(instagram);
    const img = handle
        ? `<img src="https://unavatar.io/instagram/${encodeURIComponent(handle)}?fallback=false" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
        : '';
    return `<span class="avatar" aria-hidden="true">${initial}${img}</span>`;
}

function instagramDisplay(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) {
        try {
            const path = new URL(v).pathname.replace(/^\/+|\/+$/g, '');
            return path ? `@${path}` : v;
        } catch (e) { return v; }
    }
    return v.startsWith('@') ? v : `@${v}`;
}

function relTime(ms) {
    if (!ms) return '—';
    const sec = Math.round((Date.now() - ms) / 1000);
    if (sec < 60) return 'just now';
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 7) return `${day}d ago`;
    if (day < 35) return `${Math.round(day / 7)}w ago`;
    if (day < 365) return `${Math.round(day / 30)}mo ago`;
    return `${Math.round(day / 365)}y ago`;
}

function fullDate(ms) {
    if (!ms) return 'N/A';
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return 'N/A';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
        + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function daysSince(ms) {
    if (!ms) return Infinity;
    return Math.max(0, Math.floor((Date.now() - ms) / DAY_MS));
}

function contactAgo(ms) {
    const d = daysSince(ms);
    if (!ms) return 'never contacted';
    if (d === 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 7) return `${d}d ago`;
    if (d < 30) return `${Math.floor(d / 7)}w ago`;
    if (d < 365) return `${Math.floor(d / 30)}mo ago`;
    return `${Math.floor(d / 365)}y ago`;
}

function money(n) { return `$${Number(n || 0).toFixed(2)}`; }

function statusLabel(s) {
    return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function genreLabel(g) {
    const map = { 'hip-hop': 'Hip-Hop', 'rnb-soul': 'R&B / Soul', 'afrobeats': 'Afrobeats', 'latin': 'Latin / Urbano' };
    if (!g) return 'N/A';
    return map[g] || statusLabel(g);
}

function truncate(text, max) {
    const s = String(text || '');
    return s.length <= max ? s : s.slice(0, max).trim() + '…';
}

function todayDateInput() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function msFromDateInput(value) {
    if (!value) return null;
    const ts = Date.parse(`${value}T12:00:00`);
    return Number.isNaN(ts) ? null : ts;
}
function dateInputFromMs(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toSlug(s) {
    return String(s || '').toLowerCase().normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ============ DOMAIN HELPERS ============ */

function normalizeTrialStatus(s) {
    const v = String(s || 'new');
    return v === 'qualified' ? 'completed' : v; // legacy value
}

function activityOf(rec) {
    return ACTIVITIES.includes(rec?.activity) ? rec.activity : 'neutral';
}
function nextActivity(a) {
    // neutral → active → dormant → neutral
    return a === 'neutral' ? 'active' : a === 'active' ? 'dormant' : 'neutral';
}

function actPillHtml(rec, extra = '') {
    const a = activityOf(rec);
    return `<button type="button" class="act act-${a}" data-cycle ${extra}
        title="Category: ${ACTIVITY_LABEL[a]}. Tap to change.">${ACTIVITY_LABEL[a]}</button>`;
}

function orderTs(o) {
    const v = o.createdAt || o.timestamp;
    if (!v) return 0;
    if (typeof v === 'number') return v;
    const p = Date.parse(v);
    return Number.isNaN(p) ? 0 : p;
}
function trialTs(l) {
    const v = l.createdAt || l.submittedAtIso;
    if (!v) return 0;
    if (typeof v === 'number') return v;
    const p = Date.parse(v);
    return Number.isNaN(p) ? 0 : p;
}

function isTestOrder(o) {
    const ts = orderTs(o);
    return ts > 0 && ts < TEST_ORDER_CUTOFF_MS;
}
function isYoutubeOrder(o) {
    return o?.app === 'youtube-promotion' || Boolean(o?.youtubeLink) || Boolean(o?.orderID) || Boolean(o?.paypalTransactionId);
}
function visibleOrders() {
    return S.orders.filter((o) => isYoutubeOrder(o) && (S.ui.orders.test || !isTestOrder(o)));
}

function channelName(id) {
    if (!id) return '';
    const c = S.channels.find((x) => x.firebaseKey === id);
    return c ? c.name : '';
}

function clientStats(client) {
    const orders = S.orders.filter((o) => o.clientId === client.firebaseKey && !isTestOrder(o));
    const totalSpent = orders.reduce((s, o) => s + Number(o.amount || 0), 0);
    const viewsGained = orders.reduce((s, o) =>
        (o.viewsStart != null && o.viewsEnd != null) ? s + Math.max(0, Number(o.viewsEnd) - Number(o.viewsStart)) : s, 0);
    const lastOrderTs = orders.reduce((m, o) => Math.max(m, orderTs(o)), 0);
    return { orderCount: orders.length, totalSpent, viewsGained, lastOrderTs };
}

function regionsText(l) {
    if (Array.isArray(l.targetRegionsList) && l.targetRegionsList.length) return l.targetRegionsList.join(', ');
    return String(l.targetRegions || '').trim();
}

/* ============ WRITES (optimistic: local echo is instant) ============ */

function fbUpdate(path, payload, okMsg) {
    return update(ref(database, path), payload)
        .then(() => { if (okMsg) toast(okMsg, 'success'); return true; })
        .catch((err) => { console.error(err); toast('Save failed — check connection', 'error'); return false; });
}
function fbRemove(path, okMsg) {
    return remove(ref(database, path))
        .then(() => { if (okMsg) toast(okMsg, 'success'); return true; })
        .catch((err) => { console.error(err); toast('Delete failed', 'error'); return false; });
}

function cycleActivity(collection, key) {
    const list = collection === 'usmClients' ? S.clients : collection === 'legacyClients' ? S.legacy : S.trials;
    const rec = list.find((x) => x.firebaseKey === key);
    if (!rec) return;
    const next = nextActivity(activityOf(rec));
    fbUpdate(`${collection}/${key}`, { activity: next, updatedAt: Date.now() });
    toast(`Marked ${ACTIVITY_LABEL[next]}`, 'success');
}

/* ============ ROUTER ============ */

const VIEWS = {
    orders: { el: 'view-orders', title: 'Orders', render: renderOrders },
    clients: { el: 'view-clients', title: 'Clients', render: renderClients },
    leads: { el: 'view-leads', title: 'Trial Leads', render: renderLeads },
    old: { el: 'view-old', title: 'Old Clients', render: renderOld },
    channels: { el: 'view-channels', title: 'Channels', render: renderChannels },
    'client-detail': { el: 'view-client-detail', title: 'Client', render: renderClientDetail },
    'old-detail': { el: 'view-old-detail', title: 'Old Client', render: renderOldDetail },
};

function parseHash() {
    const h = (location.hash || '').replace(/^#\/?/, '');
    const [seg, id] = h.split('/');
    if (seg === 'client' && id) return { view: 'client-detail', id };
    if (seg === 'old' && id) return { view: 'old-detail', id };
    if (VIEWS[seg]) return { view: seg, id: null };
    return { view: 'orders', id: null };
}

function navigate(path) {
    const target = `#/${path}`;
    if (location.hash === target) return;
    location.hash = target; // adds a history entry → hashchange applies it
}

function applyRoute() {
    const next = parseHash();

    // Guard unsaved edits on detail views
    if (S.dirty && S.route.view.endsWith('-detail') && next.view !== S.route.view) {
        if (!window.confirm('Discard unsaved changes?')) {
            const backTo = S.route.view === 'client-detail' ? `client/${S.route.id}` : `old/${S.route.id}`;
            location.replace(`#/${backTo}`);
            return;
        }
        S.dirty = false;
    }

    const isNewView = next.view !== S.route.view || next.id !== S.route.id;
    S.route = next;
    const cfg = VIEWS[next.view];

    Object.values(VIEWS).forEach((v) => { $(v.el).hidden = v.el !== cfg.el; });

    // Tab highlight (detail views highlight their parent tab)
    const parent = next.view === 'client-detail' ? 'clients' : next.view === 'old-detail' ? 'old' : next.view;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.nav === parent));

    const isDetail = next.view.endsWith('-detail');
    $('topbarBack').hidden = !isDetail;
    $('viewTitle').textContent = cfg.title;
    document.title = `${cfg.title} · USM Admin`;

    cfg.render();
    if (isNewView) window.scrollTo(0, 0);
}

/* ============ AUTH ============ */

onAuthStateChanged(auth, (user) => {
    S.user = user;
    if (user) {
        $('loginScreen').hidden = true;
        $('app').hidden = false;
        $('adminUserInfo').textContent = user.email || '';
        subscribeAll();
        applyRoute();
    } else {
        unsubscribeAll();
        $('app').hidden = true;
        $('loginScreen').hidden = false;
    }
});

async function handleLogin(e) {
    e.preventDefault();
    const btn = $('loginBtn');
    const err = $('loginError');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    err.hidden = true;
    try {
        await signInWithEmailAndPassword(auth, $('adminEmail').value, $('adminPassword').value);
    } catch (error) {
        console.error('Login error:', error);
        err.textContent = 'Invalid email or password';
        err.hidden = false;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Sign in';
    }
}

/* ============ SUBSCRIPTIONS ============ */

let unsubscribers = [];

function sub(path, assign, view, fallback) {
    const off = onValue(ref(database, path), (snap) => {
        const val = snap.val() || {};
        assign(Object.entries(val).map(([key, data]) => ({ ...data, firebaseKey: key })));
        rerender(view);
    }, (err) => {
        console.warn(`Realtime read failed for ${path}`, err);
        if (fallback) fallback();
    });
    unsubscribers.push(off);
}

function subscribeAll() {
    unsubscribeAll();

    sub('orders', (rows) => { S.orders = rows; S.loaded.orders = true; }, 'orders', loadOrdersFromApi);
    sub('usmClients', (rows) => { S.clients = rows; S.loaded.clients = true; }, 'clients');
    sub('legacyClients', (rows) => { S.legacy = rows; S.loaded.legacy = true; }, 'old');
    sub('trialCampaignSubmissions', (rows) => { S.trials = rows; S.loaded.trials = true; }, 'leads', loadTrialsFromApi);
    sub('channels', (rows) => {
        rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        S.channels = rows;
        S.loaded.channels = true;
        refreshChannelFilter();
    }, 'channels');

    const offConn = onValue(ref(database, '.info/connected'), (snap) => {
        const on = snap.val() === true;
        const el = $('connState');
        el.className = `conn ${on ? 'conn-on' : 'conn-off'}`;
        el.querySelector('.conn-label').textContent = on ? 'Live' : 'Offline';
        el.title = on ? 'Realtime sync is live' : 'Offline — changes will sync when back online';
    });
    unsubscribers.push(offConn);
}

function unsubscribeAll() {
    unsubscribers.forEach((off) => { try { off(); } catch (e) { } });
    unsubscribers = [];
}

// Re-render whichever views the changed collection affects (only if visible)
function rerender(collection) {
    updateBadges();
    const map = {
        orders: ['orders', 'clients', 'client-detail'],           // client stats derive from orders
        clients: ['clients', 'client-detail', 'orders', 'channels'],
        old: ['old', 'old-detail', 'channels'],
        leads: ['leads'],
        channels: ['channels', 'clients', 'old', 'client-detail', 'old-detail'],
    };
    const affected = map[collection] || [];
    if (affected.includes(S.route.view)) {
        // Never clobber in-progress edits on detail forms
        if (S.route.view.endsWith('-detail') && S.dirty) return;
        VIEWS[S.route.view].render();
    }
}

async function loadOrdersFromApi() {
    try {
        const res = await fetch('/api/get-orders');
        const result = await res.json();
        if (!res.ok || !result.success) throw new Error(result.message || 'Failed');
        S.orders = result.orders || [];
        S.loaded.orders = true;
        rerender('orders');
    } catch (e) {
        console.error(e);
        toast('Failed to load orders', 'error');
    }
}

async function loadTrialsFromApi() {
    try {
        const res = await fetch('/api/get-trial-campaigns');
        const result = await res.json();
        if (!res.ok || !result.success) throw new Error(result.message || 'Failed');
        S.trials = result.trialCampaigns || [];
        S.loaded.trials = true;
        rerender('leads');
    } catch (e) {
        console.error(e);
        toast('Failed to load trial leads', 'error');
    }
}

function updateBadges() {
    const pending = visibleOrders().filter((o) => (o.serviceStatus || 'pending') === 'pending').length;
    const newLeads = S.trials.filter((l) => normalizeTrialStatus(l.leadStatus) === 'new').length;
    const bo = $('badgeOrders'), bl = $('badgeLeads');
    bo.hidden = pending === 0; bo.textContent = pending;
    bl.hidden = newLeads === 0; bl.textContent = newLeads;
}

/* ============ SHARED RENDER BITS ============ */

function chipRow(el, chips, activeKey, onPick) {
    el.innerHTML = chips.map((c) => `
        <button class="chip ${c.cls || ''} ${c.key === activeKey ? 'active' : ''}" data-chip="${escAttr(c.key)}" role="tab" aria-selected="${c.key === activeKey}">
            ${c.icon ? icon(c.icon) : ''}${escapeHtml(c.label)}
            ${c.count != null ? `<span class="chip-n">${c.count}</span>` : ''}
        </button>`).join('');
    el.querySelectorAll('[data-chip]').forEach((b) =>
        b.addEventListener('click', () => onPick(b.dataset.chip)));
}

function skeletons(n = 4) {
    return Array.from({ length: n }, () => '<div class="skel"></div>').join('');
}

function listState(listEl, emptyEl, loaded, html) {
    if (!loaded) {
        listEl.innerHTML = skeletons();
        emptyEl.hidden = true;
        return false;
    }
    if (!html) {
        listEl.innerHTML = '';
        emptyEl.hidden = false;
        return false;
    }
    emptyEl.hidden = true;
    listEl.innerHTML = html;
    return true;
}

function countText(shown, total) {
    return shown === total ? `${total} ${total === 1 ? 'item' : 'items'}` : `${shown} of ${total}`;
}

const activityChips = (counts, all) => ([
    { key: 'all', label: 'All', count: all },
    { key: 'active', label: 'Active', count: counts.active, cls: 'chip-active-cat' },
    { key: 'neutral', label: 'Neutral', count: counts.neutral },
    { key: 'dormant', label: 'Dormant', count: counts.dormant, cls: 'chip-dormant-cat' },
]);

function activityCounts(list) {
    const c = { active: 0, neutral: 0, dormant: 0 };
    list.forEach((r) => { c[activityOf(r)]++; });
    return c;
}

/* ============ ORDERS VIEW ============ */

function renderOrders() {
    const ui = S.ui.orders;
    const all = visibleOrders();

    // Stats
    $('ordersStats').hidden = !ui.stats;
    if (ui.stats) {
        $('osRevenue').textContent = money(all.reduce((s, o) => s + Number(o.amount || 0), 0));
        $('osTotal').textContent = all.length;
        $('osPending').textContent = all.filter((o) => (o.serviceStatus || 'pending') === 'pending').length;
        $('osDone').textContent = all.filter((o) => o.serviceStatus === 'completed').length;
    }

    // Status tabs
    const counts = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
    all.forEach((o) => { const s = o.serviceStatus || 'pending'; if (counts[s] != null) counts[s]++; });
    chipRow($('ordersTabs'), ORDER_STATUSES.map((s) => ({ key: s, label: statusLabel(s), count: counts[s] })), ui.tab, (k) => {
        ui.tab = k; ui.shown = PAGE_SIZE; ui.expanded = null; persistUi(); renderOrders();
    });

    // Client filter bar
    $('ordersClientBar').hidden = !ui.clientFilter;
    if (ui.clientFilter) $('ordersClientName').textContent = ui.clientFilter.name;

    // Filter + sort
    let items = all.filter((o) => (o.serviceStatus || 'pending') === ui.tab);
    if (ui.clientFilter) items = items.filter((o) => o.clientId === ui.clientFilter.id);
    const q = ui.search;
    if (q) {
        items = items.filter((o) =>
            [o.fullName, o.email, o.phone, o.youtubeLink, o.orderID, o.clientName]
                .some((f) => String(f || '').toLowerCase().includes(q)));
    }
    items.sort((a, b) => {
        switch (ui.sort) {
            case 'oldest': return orderTs(a) - orderTs(b);
            case 'amount_desc': return Number(b.amount || 0) - Number(a.amount || 0);
            case 'amount_asc': return Number(a.amount || 0) - Number(b.amount || 0);
            default: return orderTs(b) - orderTs(a);
        }
    });

    const total = items.length;
    const page = items.slice(0, ui.shown);
    $('ordersCount').textContent = countText(page.length, total);
    $('ordersMore').hidden = page.length >= total;

    listState($('ordersList'), $('ordersEmpty'), S.loaded.orders, page.map(orderCardHtml).join(''));
}

function orderCardHtml(o) {
    const key = escAttr(o.firebaseKey);
    const expanded = S.ui.orders.expanded === o.firebaseKey;
    const yt = safeUrl(o.youtubeLink);
    return `
    <article class="card tappable ${expanded ? 'expanded' : ''}" data-key="${key}" data-kind="order">
        <div class="card-row">
            <div class="card-main">
                <div class="card-title">${escapeHtml(o.fullName || 'No name')}</div>
                <div class="card-sub">
                    <span class="money">${money(o.amount)}</span>
                    <span class="sep">·</span>
                    <span>${escapeHtml(relTime(orderTs(o)))}</span>
                    ${o.clientName ? `<span class="pill pill-client">${escapeHtml(o.clientName)}</span>` : ''}
                </div>
            </div>
            <div class="card-actions">
                ${yt ? `<a class="ibtn ibtn-yt" href="${yt}" target="_blank" rel="noopener noreferrer" title="Open YouTube video" aria-label="Open YouTube video" data-stop>${icon('play')}</a>` : ''}
                <button class="ibtn" data-action="edit" data-stop title="Edit order" aria-label="Edit order">${icon('edit')}</button>
                <button class="ibtn ibtn-expand" title="${expanded ? 'Collapse' : 'Details'}" aria-label="Details" aria-expanded="${expanded}">${icon('chevron')}</button>
            </div>
        </div>
        ${expanded ? orderDetailsHtml(o) : ''}
    </article>`;
}

function orderDetailsHtml(o) {
    const yt = safeUrl(o.youtubeLink);
    const sv = o.viewsStart != null ? Number(o.viewsStart).toLocaleString() : '—';
    const ev = o.viewsEnd != null ? Number(o.viewsEnd).toLocaleString() : '—';
    const gained = (o.viewsStart != null && o.viewsEnd != null)
        ? `+${Math.max(0, Number(o.viewsEnd) - Number(o.viewsStart)).toLocaleString()}` : '';
    return `
    <div class="card-details">
        <dl class="kv">
            <dt>Status</dt><dd><span class="pill pill-${escAttr(o.serviceStatus || 'pending')}">${statusLabel(o.serviceStatus || 'pending')}</span></dd>
            <dt>Date</dt><dd>${escapeHtml(fullDate(orderTs(o)))}</dd>
            <dt>Email</dt><dd>${escapeHtml(o.email || '—')}</dd>
            <dt>Phone</dt><dd>${escapeHtml(o.phone || '—')}</dd>
            <dt>YouTube</dt><dd>${yt ? `<a href="${yt}" target="_blank" rel="noopener noreferrer">${escapeHtml(o.youtubeLink)}</a>` : '—'}</dd>
            <dt>Views</dt><dd>${sv} → ${ev} ${gained ? `<span class="muted">(${gained})</span>` : ''}</dd>
            <dt>Engagement</dt><dd>${o.commentsGiven ? '✓ comments' : '· comments'} &nbsp; ${o.likesGiven ? '✓ likes' : '· likes'}</dd>
            <dt>Order ID</dt><dd><code>${escapeHtml(o.orderID || 'N/A')}</code></dd>
            <dt>PayPal Tx</dt><dd><code>${escapeHtml(o.paypalTransactionId || '—')}</code></dd>
            <dt>Client</dt><dd>${o.clientName ? escapeHtml(o.clientName) : '<span class="muted">Unassigned</span>'}</dd>
            <dt>Notes</dt><dd>${escapeHtml(o.adminNotes || '—')}</dd>
        </dl>
    </div>`;
}

/* ============ ORDER EDIT SHEET ============ */

function openOrderSheet(firebaseKey) {
    const o = S.orders.find((x) => x.firebaseKey === firebaseKey);
    if (!o) return;
    const status = o.serviceStatus || 'pending';

    const body = `
    <div class="form">
        <div class="field"><span>Customer</span>
            <div class="readout">${escapeHtml(o.fullName || 'No name')} · ${escapeHtml(o.email || o.phone || '—')}</div>
        </div>
        <div class="field"><span>Status</span>
            <div class="segmented" id="fStatus">
                ${ORDER_STATUSES.map((s) => `<button type="button" class="seg ${s === status ? 'active' : ''}" data-status="${s}">${statusLabel(s)}</button>`).join('')}
            </div>
        </div>
        <div class="form-2col">
            <label class="field"><span>Views at start</span>
                <input type="number" id="fStart" min="0" step="1" inputmode="numeric" value="${escAttr(o.viewsStart ?? '')}">
            </label>
            <label class="field"><span>Views now / final</span>
                <input type="number" id="fEnd" min="0" step="1" inputmode="numeric" value="${escAttr(o.viewsEnd ?? '')}">
            </label>
        </div>
        <div class="check-row">
            <label class="check ${o.commentsGiven ? 'checked' : ''}"><input type="checkbox" id="fComments" ${o.commentsGiven ? 'checked' : ''}><span class="check-box">${icon('check')}</span>Comments given</label>
            <label class="check ${o.likesGiven ? 'checked' : ''}"><input type="checkbox" id="fLikes" ${o.likesGiven ? 'checked' : ''}><span class="check-box">${icon('check')}</span>Likes given</label>
        </div>
        <div class="field"><span>Assigned client</span>
            <div class="picker-current" id="fClientCurrent"></div>
            <input type="search" id="fClientSearch" placeholder="Search or create a client…" autocomplete="off"
                style="width:100%;min-height:44px;padding:10px 14px;font-size:16px;background:var(--surface);border:1px solid var(--border);border-radius:10px;color:var(--text);outline:none;">
            <div class="picker-results" id="fClientResults"></div>
        </div>
        <label class="field"><span>Admin notes</span>
            <textarea id="fNotes" rows="3">${escapeHtml(o.adminNotes || '')}</textarea>
        </label>
        <small class="muted" style="color:var(--text-3);font-size:12.5px;">Recording final views + comments + likes marks the order Completed automatically.</small>
    </div>`;

    const footer = `
        <button class="ibtn ibtn-danger" id="fDelete" title="Delete order" aria-label="Delete order">${icon('trash')}</button>
        <div class="footer-gap"></div>
        <button class="btn btn-ghost" data-sheet-close>Cancel</button>
        <button class="btn btn-primary" id="fSave">Save</button>`;

    openSheet(`Order · ${money(o.amount)}`, body, footer);

    let selStatus = status;
    document.querySelectorAll('#fStatus .seg').forEach((b) => b.addEventListener('click', () => {
        selStatus = b.dataset.status;
        document.querySelectorAll('#fStatus .seg').forEach((x) => x.classList.toggle('active', x === b));
    }));

    // ---- client picker ----
    let selClient = o.clientId ? { id: o.clientId, name: o.clientName, slug: o.clientSlug } : null;
    const drawCurrent = () => {
        $('fClientCurrent').innerHTML = selClient
            ? `<span class="pill pill-client">${escapeHtml(selClient.name)}</span><button type="button" class="link-btn" id="fUnassign">Unassign</button>`
            : '<span class="muted">Unassigned</span>';
        const un = $('fUnassign');
        if (un) un.addEventListener('click', () => { selClient = null; drawCurrent(); });
    };
    drawCurrent();

    const drawResults = (q) => {
        const term = (q || '').toLowerCase().trim();
        const matches = S.clients
            .filter((c) => !term || c.name.toLowerCase().includes(term) || (c.slug || '').includes(term))
            .slice(0, 6);
        $('fClientResults').innerHTML =
            (term ? `<button type="button" class="picker-row picker-row-new" data-new>${icon('plus')} Create “${escapeHtml(q)}”</button>` : '')
            + matches.map((c) => `<button type="button" class="picker-row" data-cid="${escAttr(c.firebaseKey)}"><strong>${escapeHtml(c.name)}</strong><small>/${escapeHtml(c.slug || '')}</small></button>`).join('');
        $('fClientResults').querySelectorAll('[data-cid]').forEach((row) => row.addEventListener('click', () => {
            const c = S.clients.find((x) => x.firebaseKey === row.dataset.cid);
            if (!c) return;
            selClient = { id: c.firebaseKey, name: c.name, slug: c.slug };
            drawCurrent();
            $('fClientSearch').value = '';
            $('fClientResults').innerHTML = '';
        }));
        const nb = $('fClientResults').querySelector('[data-new]');
        if (nb) nb.addEventListener('click', async () => {
            const created = await createClient(q.trim());
            if (created) {
                selClient = { id: created.firebaseKey, name: created.name, slug: created.slug };
                drawCurrent();
                $('fClientSearch').value = '';
                $('fClientResults').innerHTML = '';
            }
        });
    };
    $('fClientSearch').addEventListener('input', (e) => drawResults(e.target.value));
    $('fClientSearch').addEventListener('focus', (e) => drawResults(e.target.value));

    // ---- save ----
    $('fSave').addEventListener('click', () => {
        const sv = $('fStart').value, evv = $('fEnd').value;
        const viewsStart = sv === '' ? null : Number(sv);
        const viewsEnd = evv === '' ? null : Number(evv);
        const commentsGiven = $('fComments').checked;
        const likesGiven = $('fLikes').checked;

        let finalStatus = selStatus;
        const viewsRecorded = viewsEnd != null && (viewsStart == null || viewsEnd >= viewsStart) && viewsEnd > 0;
        if (viewsRecorded && commentsGiven && likesGiven) finalStatus = 'completed';

        closeSheet();
        fbUpdate(`orders/${firebaseKey}`, {
            serviceStatus: finalStatus,
            viewsStart, viewsEnd, commentsGiven, likesGiven,
            adminNotes: $('fNotes').value,
            clientId: selClient ? selClient.id : null,
            clientName: selClient ? selClient.name : null,
            clientSlug: selClient ? selClient.slug : null,
            updatedAt: Date.now(),
        }, 'Order saved');
    });

    // ---- delete ----
    $('fDelete').addEventListener('click', () => {
        openConfirm('Delete order?',
            `<p>This permanently removes <strong>${escapeHtml(o.fullName || 'this order')}</strong> (${money(o.amount)}). This can't be undone.</p>`,
            async () => {
                closeConfirm();
                closeSheet();
                await fbRemove(`orders/${firebaseKey}`, 'Order deleted');
            });
    });
}

/* ============ CLIENTS VIEW ============ */

function renderClients() {
    const ui = S.ui.clients;
    chipRow($('clientsTabs'), activityChips(activityCounts(S.clients), S.clients.length), ui.tab, (k) => {
        ui.tab = k; persistUi(); renderClients();
    });

    let items = S.clients.slice();
    if (ui.tab !== 'all') items = items.filter((c) => activityOf(c) === ui.tab);
    const q = ui.search;
    if (q) items = items.filter((c) => c.name.toLowerCase().includes(q) || (c.slug || '').includes(q));

    const enriched = items.map((c) => ({ ...c, _s: clientStats(c) }));
    enriched.sort((a, b) => {
        switch (ui.sort) {
            case 'name': return a.name.localeCompare(b.name);
            case 'orders': return b._s.orderCount - a._s.orderCount;
            case 'spent': return b._s.totalSpent - a._s.totalSpent;
            default: return b._s.lastOrderTs - a._s.lastOrderTs;
        }
    });

    $('clientsCount').textContent = countText(enriched.length, enriched.length);
    listState($('clientsList'), $('clientsEmpty'), S.loaded.clients, enriched.map(clientCardHtml).join(''));
}

function clientCardHtml(c) {
    const key = escAttr(c.firebaseKey);
    const ig = instagramUrl(c.instagram);
    const chan = channelName(c.channel);
    return `
    <article class="card tappable" data-key="${key}" data-kind="client" role="button" tabindex="0" aria-label="Open ${escAttr(c.name)}">
        <div class="card-row">
            ${avatarHtml(c.name, c.instagram)}
            <div class="card-main">
                <div class="card-title">${escapeHtml(c.name)}</div>
                <div class="card-sub">
                    ${actPillHtml(c, 'data-stop')}
                    <span>${c._s.orderCount} order${c._s.orderCount === 1 ? '' : 's'}</span>
                    <span class="sep">·</span>
                    <span class="money">${money(c._s.totalSpent)}</span>
                    <span class="sep">·</span>
                    <span class="muted">${c._s.lastOrderTs ? escapeHtml(relTime(c._s.lastOrderTs)) : 'no orders'}</span>
                    ${chan ? `<span class="pill pill-chan">${escapeHtml(chan)}</span>` : ''}
                </div>
                ${c.notes ? `<div class="card-note">${icon('note')}<span>${escapeHtml(truncate(c.notes, 90))}</span></div>` : ''}
            </div>
            <div class="card-actions">
                ${ig ? `<a class="ibtn ibtn-ig" href="${ig}" target="_blank" rel="noopener noreferrer" title="Open Instagram ${escAttr(instagramDisplay(c.instagram))}" aria-label="Open Instagram" data-stop>${icon('instagram')}</a>` : ''}
                <button class="ibtn" data-action="orders" data-stop title="See this client's orders" aria-label="See orders">${icon('folder')}</button>
            </div>
        </div>
    </article>`;
}

async function createClient(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;
    const slug = await uniqueSlug(toSlug(trimmed), null);
    try {
        const newRef = push(ref(database, 'usmClients'));
        const data = { name: trimmed, slug, notes: '', activity: 'neutral', createdAt: Date.now(), updatedAt: Date.now() };
        await set(newRef, data);
        return { firebaseKey: newRef.key, ...data };
    } catch (err) {
        console.error(err);
        toast('Failed to create client', 'error');
        return null;
    }
}

async function uniqueSlug(base, excludeId) {
    const slugs = new Set(S.clients.filter((c) => c.firebaseKey !== excludeId).map((c) => c.slug));
    if (!slugs.has(base)) return base;
    for (let i = 2; i < 1000; i++) {
        if (!slugs.has(`${base}-${i}`)) return `${base}-${i}`;
    }
    return `${base}-${Date.now()}`;
}

function openNewClientSheet() {
    const body = `
    <div class="form">
        <label class="field"><span>Name</span><input type="text" id="ncName" placeholder="e.g. Big Sumo" autocomplete="off"></label>
        <label class="field"><span>Public slug</span><input type="text" id="ncSlug" placeholder="auto-generated" autocomplete="off">
            <small>Their public page: <code>campaigns.upscalemarketingsolutions.com/c/<span id="ncSlugPrev">slug</span></code></small>
        </label>
        <label class="field"><span>Instagram</span><input type="text" id="ncIg" placeholder="@username or full URL" autocomplete="off"></label>
        <label class="field"><span>Channel</span><select id="ncChannel">${channelOptions('')}</select></label>
        <div class="field"><span>Category</span>${activitySegHtml('neutral', 'ncAct')}</div>
        <label class="field"><span>Notes</span><textarea id="ncNotes" rows="3"></textarea></label>
    </div>`;
    const footer = `
        <div class="footer-gap"></div>
        <button class="btn btn-ghost" data-sheet-close>Cancel</button>
        <button class="btn btn-primary" id="ncSave">Add client</button>`;
    openSheet('New client', body, footer);

    let slugTouched = false;
    $('ncName').addEventListener('input', () => {
        if (!slugTouched) {
            $('ncSlug').value = toSlug($('ncName').value);
            $('ncSlugPrev').textContent = $('ncSlug').value || 'slug';
        }
    });
    $('ncSlug').addEventListener('input', () => {
        slugTouched = true;
        $('ncSlug').value = toSlug($('ncSlug').value);
        $('ncSlugPrev').textContent = $('ncSlug').value || 'slug';
    });
    const getAct = bindActivitySeg('ncAct', 'neutral');

    $('ncSave').addEventListener('click', async () => {
        const name = $('ncName').value.trim();
        if (!name) return toast('Name is required', 'error');
        let slug = toSlug($('ncSlug').value || name);
        if (!slug) return toast('Slug is required', 'error');
        slug = await uniqueSlug(slug, null);
        closeSheet();
        try {
            const newRef = push(ref(database, 'usmClients'));
            await set(newRef, {
                name, slug,
                instagram: $('ncIg').value.trim() || null,
                channel: $('ncChannel').value || null,
                activity: getAct(),
                notes: $('ncNotes').value,
                createdAt: Date.now(), updatedAt: Date.now(),
            });
            toast('Client added', 'success');
        } catch (err) { console.error(err); toast('Save failed', 'error'); }
    });
}

/* ============ CLIENT DETAIL ============ */

function renderClientDetail() {
    const c = S.clients.find((x) => x.firebaseKey === S.route.id);
    if (!c) {
        if (S.loaded.clients) navigate('clients');
        return;
    }
    S.dirty = false;
    $('cdTitle').textContent = c.name || 'Client';
    const stats = clientStats(c);
    const ig = instagramUrl(c.instagram);

    const orderItems = S.orders
        .filter((o) => o.clientId === c.firebaseKey && !isTestOrder(o))
        .sort((a, b) => orderTs(b) - orderTs(a));

    $('cdBody').innerHTML = `
        <div class="profile-row">
            ${avatarHtml(c.name, c.instagram)}
            <div class="profile-row-main">
                <div class="profile-row-name">${escapeHtml(c.name || 'Client')}</div>
                <div class="profile-row-sub">${ig ? `<a href="${ig}" target="_blank" rel="noopener noreferrer">${escapeHtml(instagramDisplay(c.instagram))}</a>` : 'No Instagram linked'}</div>
            </div>
        </div>
        <div class="detail-stats">
            <div class="stat"><span class="stat-label">Orders</span><span class="stat-value">${stats.orderCount}</span></div>
            <div class="stat"><span class="stat-label">Spent</span><span class="stat-value">${money(stats.totalSpent)}</span></div>
            <div class="stat"><span class="stat-label">Views gained</span><span class="stat-value">+${stats.viewsGained.toLocaleString()}</span></div>
            <div class="stat"><span class="stat-label">Last order</span><span class="stat-value">${stats.lastOrderTs ? relTime(stats.lastOrderTs) : '—'}</span></div>
        </div>
        <div class="form">
            <div class="field"><span>Category</span>${activitySegHtml(activityOf(c), 'cdAct')}</div>
            <label class="field"><span>Name</span><input type="text" id="cdName" value="${escAttr(c.name || '')}"></label>
            <label class="field"><span>Public slug</span><input type="text" id="cdSlug" value="${escAttr(c.slug || '')}">
                <small>Public page: <code>campaigns.upscalemarketingsolutions.com/c/<span id="cdSlugPrev">${escapeHtml(c.slug || 'slug')}</span></code>
                ${c.slug ? ` · <a href="https://campaigns.upscalemarketingsolutions.com/c/${encodeURIComponent(c.slug)}" target="_blank" rel="noopener noreferrer">open</a>` : ''}</small>
            </label>
            <label class="field"><span>Instagram</span><input type="text" id="cdIg" value="${escAttr(c.instagram || '')}" placeholder="@username or full URL">
                ${ig ? `<small><a href="${ig}" target="_blank" rel="noopener noreferrer">${escapeHtml(instagramDisplay(c.instagram))}</a></small>` : ''}
            </label>
            <label class="field"><span>Channel</span><select id="cdChannel">${channelOptions(c.channel)}</select></label>
            <label class="field"><span>Notes</span><textarea id="cdNotes" rows="6">${escapeHtml(c.notes || '')}</textarea></label>
        </div>
        <div class="detail-section">
            <h3>Orders (${orderItems.length})</h3>
            <div id="cdOrders">
                ${orderItems.length === 0 ? '<div class="empty-inline">No orders assigned yet.</div>'
            : orderItems.map((o) => `
                <div class="mini-row">
                    <div class="mini-row-main">
                        <div class="mini-row-title">${money(o.amount)}</div>
                        <div class="mini-row-sub"><span class="pill pill-${escAttr(o.serviceStatus || 'pending')}">${statusLabel(o.serviceStatus || 'pending')}</span> · ${escapeHtml(relTime(orderTs(o)))}</div>
                    </div>
                    <button class="ibtn" data-edit-order="${escAttr(o.firebaseKey)}" title="Edit order" aria-label="Edit order">${icon('edit')}</button>
                </div>`).join('')}
            </div>
        </div>`;

    bindActivitySeg('cdAct', activityOf(c), () => { S.dirty = true; });
    ['cdName', 'cdSlug', 'cdIg', 'cdChannel', 'cdNotes'].forEach((id) => {
        const el = $(id);
        el.addEventListener('input', () => { S.dirty = true; });
        el.addEventListener('change', () => { S.dirty = true; });
    });
    $('cdSlug').addEventListener('input', (e) => {
        e.target.value = toSlug(e.target.value);
        $('cdSlugPrev').textContent = e.target.value || 'slug';
    });
    document.querySelectorAll('[data-edit-order]').forEach((b) =>
        b.addEventListener('click', () => openOrderSheet(b.dataset.editOrder)));
}

async function saveClientDetail() {
    const c = S.clients.find((x) => x.firebaseKey === S.route.id);
    if (!c) return;
    const name = $('cdName').value.trim();
    if (!name) return toast('Name is required', 'error');
    let slug = toSlug($('cdSlug').value || name);
    if (!slug) return toast('Slug is required', 'error');
    if (S.clients.some((x) => x.slug === slug && x.firebaseKey !== c.firebaseKey)) {
        slug = await uniqueSlug(slug, c.firebaseKey);
    }
    const act = document.querySelector('#cdAct .seg.active')?.dataset.value || activityOf(c);

    const ok = await fbUpdate(`usmClients/${c.firebaseKey}`, {
        name, slug,
        instagram: $('cdIg').value.trim() || null,
        channel: $('cdChannel').value || null,
        activity: act,
        notes: $('cdNotes').value,
        updatedAt: Date.now(),
    }, 'Client saved');
    if (!ok) return;

    // Keep the denormalized name/slug on orders in sync
    if (name !== c.name || slug !== c.slug) {
        const updates = {};
        S.orders.forEach((o) => {
            if (o.clientId === c.firebaseKey) {
                updates[`orders/${o.firebaseKey}/clientName`] = name;
                updates[`orders/${o.firebaseKey}/clientSlug`] = slug;
            }
        });
        if (Object.keys(updates).length) await update(ref(database), updates).catch(console.error);
    }
    S.dirty = false;
    renderClientDetail();
}

function deleteClientFromDetail() {
    const c = S.clients.find((x) => x.firebaseKey === S.route.id);
    if (!c) return;
    const stats = clientStats(c);
    const note = stats.orderCount
        ? `<p>Their <strong>${stats.orderCount}</strong> order${stats.orderCount === 1 ? '' : 's'} will be kept, just unassigned.</p>` : '';
    openConfirm('Delete client?', `<p>Remove <strong>${escapeHtml(c.name)}</strong>?</p>${note}`, async () => {
        closeConfirm();
        const updates = {};
        S.orders.forEach((o) => {
            if (o.clientId === c.firebaseKey) {
                updates[`orders/${o.firebaseKey}/clientId`] = null;
                updates[`orders/${o.firebaseKey}/clientName`] = null;
                updates[`orders/${o.firebaseKey}/clientSlug`] = null;
            }
        });
        updates[`usmClients/${c.firebaseKey}`] = null;
        S.dirty = false;
        try {
            await update(ref(database), updates);
            toast('Client deleted', 'success');
            navigate('clients');
        } catch (err) { console.error(err); toast('Delete failed', 'error'); }
    });
}

/* ============ TRIAL LEADS VIEW ============ */

function renderLeads() {
    const ui = S.ui.leads;

    $('leadsStats').hidden = !ui.stats;
    if (ui.stats) {
        const trialed = S.trials.filter((l) => TRIALED_STATUSES.includes(normalizeTrialStatus(l.leadStatus))).length;
        const converted = S.trials.filter((l) => normalizeTrialStatus(l.leadStatus) === 'converted').length;
        $('lsTotal').textContent = S.trials.length;
        $('lsTrialed').textContent = trialed;
        $('lsConverted').textContent = converted;
        $('lsRate').textContent = trialed ? `${Math.round((converted / trialed) * 100)}%` : '—';
    }

    const counts = { new: 0, completed: 0, contacted: 0, converted: 0, archived: 0 };
    S.trials.forEach((l) => { const s = normalizeTrialStatus(l.leadStatus); if (counts[s] != null) counts[s]++; });
    chipRow($('leadsTabs'), TRIAL_STATUSES.map((s) => ({ key: s, label: statusLabel(s), count: counts[s] })), ui.tab, (k) => {
        ui.tab = k; ui.shown = PAGE_SIZE; persistUi(); renderLeads();
    });

    const inTab = S.trials.filter((l) => normalizeTrialStatus(l.leadStatus) === ui.tab);
    chipRow($('leadsActivity'), activityChips(activityCounts(inTab), inTab.length), ui.activity, (k) => {
        ui.activity = k; ui.shown = PAGE_SIZE; persistUi(); renderLeads();
    });

    let items = inTab;
    if (ui.activity !== 'all') items = items.filter((l) => activityOf(l) === ui.activity);
    if (ui.genre) items = items.filter((l) => l.genre === ui.genre);
    const q = ui.search;
    if (q) {
        items = items.filter((l) =>
            [l.fullName, l.genre, l.subgenre, l.youtubeLink, l.targetAgeGroup, regionsText(l)]
                .some((f) => String(f || '').toLowerCase().includes(q)));
    }
    items.sort((a, b) => {
        switch (ui.sort) {
            case 'oldest': return trialTs(a) - trialTs(b);
            case 'name': return String(a.fullName || '').localeCompare(String(b.fullName || ''));
            default: return trialTs(b) - trialTs(a);
        }
    });

    const total = items.length;
    const page = items.slice(0, ui.shown);
    $('leadsCount').textContent = countText(page.length, total);
    $('leadsMore').hidden = page.length >= total;

    listState($('leadsList'), $('leadsEmpty'), S.loaded.trials, page.map(leadCardHtml).join(''));
}

function leadCardHtml(l) {
    const key = escAttr(l.firebaseKey);
    const yt = safeUrl(l.youtubeLink);
    const ig = instagramUrl(l.instagramLink);
    return `
    <article class="card tappable" data-key="${key}" data-kind="lead" role="button" tabindex="0" aria-label="Open lead ${escAttr(l.fullName || '')}">
        <div class="card-row">
            ${avatarHtml(l.fullName, l.instagramLink)}
            <div class="card-main">
                <div class="card-title">${escapeHtml(l.fullName || 'Unknown')}</div>
                <div class="card-sub">
                    ${actPillHtml(l, 'data-stop')}
                    <span>${escapeHtml(genreLabel(l.genre))}</span>
                    <span class="sep">·</span>
                    <span class="muted">${escapeHtml(relTime(trialTs(l)))}</span>
                </div>
            </div>
            <div class="card-actions">
                ${yt ? `<a class="ibtn ibtn-yt" href="${yt}" target="_blank" rel="noopener noreferrer" title="Open YouTube video" aria-label="Open YouTube video" data-stop>${icon('play')}</a>` : ''}
                ${ig ? `<a class="ibtn ibtn-ig" href="${ig}" target="_blank" rel="noopener noreferrer" title="Open Instagram" aria-label="Open Instagram" data-stop>${icon('instagram')}</a>` : ''}
                <button class="ibtn" data-action="edit" data-stop title="Open lead" aria-label="Open lead">${icon('edit')}</button>
            </div>
        </div>
    </article>`;
}

function openLeadSheet(firebaseKey) {
    const l = S.trials.find((x) => x.firebaseKey === firebaseKey);
    if (!l) return;
    const status = normalizeTrialStatus(l.leadStatus);
    const yt = safeUrl(l.youtubeLink);

    const body = `
    <div class="form">
        <div class="field"><span>Status</span>
            <div class="segmented" id="tStatus">
                ${TRIAL_STATUSES.map((s) => `<button type="button" class="seg ${s === status ? 'active' : ''}" data-status="${s}">${statusLabel(s)}</button>`).join('')}
            </div>
        </div>
        <div class="field"><span>Category</span>${activitySegHtml(activityOf(l), 'tAct')}</div>
        <div class="form-2col">
            <label class="field"><span>Views at start</span>
                <input type="number" id="tStart" min="0" step="1" inputmode="numeric" value="${escAttr(l.viewsStart ?? '')}">
            </label>
            <label class="field"><span>Views now / final</span>
                <input type="number" id="tEnd" min="0" step="1" inputmode="numeric" value="${escAttr(l.viewsEnd ?? '')}">
            </label>
        </div>
        <div class="check-row">
            <label class="check ${l.commentsGiven ? 'checked' : ''}"><input type="checkbox" id="tComments" ${l.commentsGiven ? 'checked' : ''}><span class="check-box">${icon('check')}</span>Comments given</label>
            <label class="check ${l.likesGiven ? 'checked' : ''}"><input type="checkbox" id="tLikes" ${l.likesGiven ? 'checked' : ''}><span class="check-box">${icon('check')}</span>Likes given</label>
        </div>
        <label class="field"><span>Instagram</span>
            <input type="text" id="tIg" value="${escAttr(l.instagramLink || '')}" placeholder="@username or full URL" autocomplete="off">
        </label>
        <label class="field"><span>Admin notes</span>
            <textarea id="tNotes" rows="3">${escapeHtml(l.adminNotes || '')}</textarea>
        </label>
        <div class="detail-section" style="margin-top:8px;">
            <h3>Intake details</h3>
            <dl class="kv">
                <dt>Submitted</dt><dd>${escapeHtml(fullDate(trialTs(l)))}</dd>
                <dt>Reference</dt><dd><code>${escapeHtml(l.submissionId || 'N/A')}</code></dd>
                <dt>Genre</dt><dd>${escapeHtml(genreLabel(l.genre))}${l.subgenre ? ` · ${escapeHtml(l.subgenre)}` : ''}</dd>
                <dt>Years</dt><dd>${escapeHtml(l.yearsMakingMusic || '—')}</dd>
                <dt>YouTube</dt><dd>${yt ? `<a href="${yt}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.youtubeLink)}</a>` : '—'}</dd>
                <dt>Regions</dt><dd>${escapeHtml(regionsText(l) || '—')}</dd>
                <dt>Age group</dt><dd>${escapeHtml(l.targetAgeGroup || '—')}</dd>
            </dl>
        </div>
    </div>`;

    const footer = `
        <button class="ibtn ibtn-danger" id="tDelete" title="Delete lead" aria-label="Delete lead">${icon('trash')}</button>
        <div class="footer-gap"></div>
        <button class="btn btn-ghost" data-sheet-close>Cancel</button>
        <button class="btn btn-primary" id="tSave">Save</button>`;

    openSheet(l.fullName || 'Trial lead', body, footer);

    let selStatus = status;
    document.querySelectorAll('#tStatus .seg').forEach((b) => b.addEventListener('click', () => {
        selStatus = b.dataset.status;
        document.querySelectorAll('#tStatus .seg').forEach((x) => x.classList.toggle('active', x === b));
    }));
    const getAct = bindActivitySeg('tAct', activityOf(l));

    $('tSave').addEventListener('click', () => {
        const sv = $('tStart').value, evv = $('tEnd').value;
        const viewsStart = sv === '' ? null : Number(sv);
        const viewsEnd = evv === '' ? null : Number(evv);
        const commentsGiven = $('tComments').checked;
        const likesGiven = $('tLikes').checked;

        let finalStatus = selStatus;
        const viewsRecorded = viewsEnd != null && (viewsStart == null || viewsEnd >= viewsStart) && viewsEnd > 0;
        if (viewsRecorded && commentsGiven && likesGiven && finalStatus === 'new') finalStatus = 'completed';

        closeSheet();
        fbUpdate(`trialCampaignSubmissions/${firebaseKey}`, {
            leadStatus: finalStatus,
            activity: getAct(),
            viewsStart, viewsEnd, commentsGiven, likesGiven,
            instagramLink: $('tIg').value.trim() || null,
            adminNotes: $('tNotes').value,
            updatedAt: Date.now(),
        }, 'Lead saved');
    });

    $('tDelete').addEventListener('click', () => {
        openConfirm('Delete trial lead?', `<p>Remove <strong>${escapeHtml(l.fullName || 'this lead')}</strong>? This can't be undone.</p>`, async () => {
            closeConfirm();
            closeSheet();
            await fbRemove(`trialCampaignSubmissions/${firebaseKey}`, 'Lead deleted');
        });
    });
}

/* ============ OLD CLIENTS VIEW ============ */

function renderOld() {
    const ui = S.ui.old;
    const actCounts = activityCounts(S.legacy);
    const hotCount = S.legacy.filter((l) => !!l.hot).length;

    chipRow($('oldTabs'), [
        { key: 'hot', label: 'Hot', count: hotCount, icon: 'flame', cls: 'chip-hot-cat' },
        { key: 'active', label: 'Active', count: actCounts.active, cls: 'chip-active-cat' },
        { key: 'neutral', label: 'Neutral', count: actCounts.neutral },
        { key: 'dormant', label: 'Dormant', count: actCounts.dormant, cls: 'chip-dormant-cat' },
        { key: 'all', label: 'All', count: S.legacy.length },
    ], ui.tab, (k) => { ui.tab = k; persistUi(); renderOld(); });

    let items = S.legacy.slice();
    if (ui.tab === 'hot') items = items.filter((l) => !!l.hot);
    else if (ui.tab !== 'all') items = items.filter((l) => activityOf(l) === ui.tab);
    if (ui.channel) items = items.filter((l) => l.channel === ui.channel);
    const q = ui.search;
    if (q) {
        items = items.filter((l) =>
            String(l.name || '').toLowerCase().includes(q) ||
            String(l.instagram || '').toLowerCase().includes(q) ||
            channelName(l.channel).toLowerCase().includes(q));
    }
    items.sort((a, b) => {
        switch (ui.sort) {
            case 'newest': return (b.lastContacted || 0) - (a.lastContacted || 0);
            case 'name': return String(a.name || '').localeCompare(String(b.name || ''));
            default: return (a.lastContacted || 0) - (b.lastContacted || 0);
        }
    });

    $('oldCount').textContent = countText(items.length, items.length);
    listState($('oldList'), $('oldEmpty'), S.loaded.legacy, items.map(oldCardHtml).join(''));
}

function oldCardHtml(l) {
    const key = escAttr(l.firebaseKey);
    const d = daysSince(l.lastContacted);
    const chan = channelName(l.channel);
    const ig = instagramUrl(l.instagram);
    return `
    <article class="card tappable" data-key="${key}" data-kind="old" role="button" tabindex="0" aria-label="Open ${escAttr(l.name || '')}">
        <div class="card-row">
            ${avatarHtml(l.name, l.instagram)}
            <div class="card-main">
                <div class="card-title">${l.hot ? icon('flame', 'flame') : ''}${escapeHtml(l.name || 'No name')}</div>
                <div class="card-sub">
                    ${actPillHtml(l, 'data-stop')}
                    <span class="${d > 60 && l.lastContacted ? 'overdue' : 'muted'}">contacted ${escapeHtml(contactAgo(l.lastContacted))}</span>
                    ${chan ? `<span class="pill pill-chan">${escapeHtml(chan)}</span>` : ''}
                    ${ig ? `<a href="${ig}" target="_blank" rel="noopener noreferrer" data-stop>${escapeHtml(instagramDisplay(l.instagram))}</a>` : ''}
                </div>
                ${l.notes ? `<div class="card-note">${icon('note')}<span>${escapeHtml(truncate(l.notes, 90))}</span></div>` : ''}
            </div>
            <div class="card-actions">
                <button class="ibtn ${l.hot ? 'ibtn-danger' : ''}" data-action="hot" data-stop title="${l.hot ? 'Remove hot flag' : 'Flag as hot prospect'}" aria-label="Toggle hot">${icon('flame')}</button>
                <button class="ibtn" data-action="touch" data-stop title="Mark contacted today" aria-label="Mark contacted today">${icon('cal-check')}</button>
            </div>
        </div>
    </article>`;
}

function openNewOldSheet() {
    const body = `
    <div class="form">
        <label class="field"><span>Name</span><input type="text" id="noName" placeholder="e.g. Lil Boss" autocomplete="off"></label>
        <label class="field"><span>Instagram</span><input type="text" id="noIg" placeholder="@username or full URL" autocomplete="off"></label>
        <label class="field"><span>Channel</span><select id="noChannel">${channelOptions('')}</select></label>
        <label class="field"><span>Last contacted</span>
            <div class="date-row">
                <input type="date" id="noDate" value="${todayDateInput()}">
                <button type="button" class="btn btn-ghost" id="noToday">Today</button>
            </div>
        </label>
        <div class="field"><span>Category</span>${activitySegHtml('neutral', 'noAct')}</div>
        <div class="check-row">
            <label class="check"><input type="checkbox" id="noHot"><span class="check-box">${icon('check')}</span>Hot prospect</label>
        </div>
        <label class="field"><span>Notes</span><textarea id="noNotes" rows="3"></textarea></label>
    </div>`;
    const footer = `
        <div class="footer-gap"></div>
        <button class="btn btn-ghost" data-sheet-close>Cancel</button>
        <button class="btn btn-primary" id="noSave">Add</button>`;
    openSheet('Add old client', body, footer);

    $('noToday').addEventListener('click', () => { $('noDate').value = todayDateInput(); });
    const getAct = bindActivitySeg('noAct', 'neutral');

    $('noSave').addEventListener('click', async () => {
        const name = $('noName').value.trim();
        if (!name) return toast('Name is required', 'error');
        closeSheet();
        try {
            const r = push(ref(database, 'legacyClients'));
            await set(r, {
                name,
                instagram: $('noIg').value.trim() || null,
                channel: $('noChannel').value || null,
                lastContacted: msFromDateInput($('noDate').value) || Date.now(),
                hot: $('noHot').checked,
                activity: getAct(),
                notes: $('noNotes').value,
                createdAt: Date.now(), updatedAt: Date.now(),
            });
            toast('Old client added', 'success');
        } catch (err) { console.error(err); toast('Save failed', 'error'); }
    });
}

/* ============ OLD CLIENT DETAIL ============ */

function renderOldDetail() {
    const l = S.legacy.find((x) => x.firebaseKey === S.route.id);
    if (!l) {
        if (S.loaded.legacy) navigate('old');
        return;
    }
    S.dirty = false;
    $('odTitle').textContent = l.name || 'Old client';
    const d = daysSince(l.lastContacted);
    const ig = instagramUrl(l.instagram);

    $('odBody').innerHTML = `
        <div class="profile-row">
            ${avatarHtml(l.name, l.instagram)}
            <div class="profile-row-main">
                <div class="profile-row-name">${escapeHtml(l.name || 'Old client')}</div>
                <div class="profile-row-sub">${ig ? `<a href="${ig}" target="_blank" rel="noopener noreferrer">${escapeHtml(instagramDisplay(l.instagram))}</a>` : 'No Instagram linked'}</div>
            </div>
        </div>
        <div class="detail-stats">
            <div class="stat"><span class="stat-label">Last contact</span><span class="stat-value ${d > 60 && l.lastContacted ? 'overdue' : ''}">${escapeHtml(contactAgo(l.lastContacted))}</span></div>
            <div class="stat"><span class="stat-label">Flag</span><span class="stat-value">${l.hot ? '🔥 Hot' : '—'}</span></div>
        </div>
        <div class="form">
            <div class="field"><span>Category</span>${activitySegHtml(activityOf(l), 'odAct')}</div>
            <label class="field"><span>Name</span><input type="text" id="odName" value="${escAttr(l.name || '')}"></label>
            <label class="field"><span>Instagram</span><input type="text" id="odIg" value="${escAttr(l.instagram || '')}" placeholder="@username or full URL">
                ${ig ? `<small><a href="${ig}" target="_blank" rel="noopener noreferrer">${escapeHtml(instagramDisplay(l.instagram))}</a></small>` : ''}
            </label>
            <label class="field"><span>Channel</span><select id="odChannel">${channelOptions(l.channel)}</select></label>
            <label class="field"><span>Last contacted</span>
                <div class="date-row">
                    <input type="date" id="odDate" value="${dateInputFromMs(l.lastContacted) || todayDateInput()}">
                    <button type="button" class="btn btn-ghost" id="odToday">Today</button>
                </div>
            </label>
            <div class="check-row">
                <label class="check ${l.hot ? 'checked' : ''}"><input type="checkbox" id="odHot" ${l.hot ? 'checked' : ''}><span class="check-box">${icon('check')}</span>Hot prospect</label>
            </div>
            <label class="field"><span>Notes</span><textarea id="odNotes" rows="6">${escapeHtml(l.notes || '')}</textarea></label>
        </div>`;

    $('odToday').addEventListener('click', () => { $('odDate').value = todayDateInput(); S.dirty = true; });
    bindActivitySeg('odAct', activityOf(l), () => { S.dirty = true; });
    ['odName', 'odIg', 'odChannel', 'odDate', 'odHot', 'odNotes'].forEach((id) => {
        const el = $(id);
        el.addEventListener('input', () => { S.dirty = true; });
        el.addEventListener('change', () => { S.dirty = true; });
    });
}

async function saveOldDetail() {
    const l = S.legacy.find((x) => x.firebaseKey === S.route.id);
    if (!l) return;
    const name = $('odName').value.trim();
    if (!name) return toast('Name is required', 'error');
    const act = document.querySelector('#odAct .seg.active')?.dataset.value || activityOf(l);
    const ok = await fbUpdate(`legacyClients/${l.firebaseKey}`, {
        name,
        instagram: $('odIg').value.trim() || null,
        channel: $('odChannel').value || null,
        lastContacted: msFromDateInput($('odDate').value) || Date.now(),
        hot: $('odHot').checked,
        activity: act,
        notes: $('odNotes').value,
        updatedAt: Date.now(),
    }, 'Saved');
    if (ok) { S.dirty = false; renderOldDetail(); }
}

function deleteOldFromDetail() {
    const l = S.legacy.find((x) => x.firebaseKey === S.route.id);
    if (!l) return;
    openConfirm('Delete old client?', `<p>Remove <strong>${escapeHtml(l.name || 'this entry')}</strong>? This can't be undone.</p>`, async () => {
        closeConfirm();
        S.dirty = false;
        if (await fbRemove(`legacyClients/${l.firebaseKey}`, 'Deleted')) navigate('old');
    });
}

/* ============ CHANNELS VIEW ============ */

function refreshChannelFilter() {
    const sel = $('oldChannel');
    const current = sel.value;
    sel.innerHTML = '<option value="">All</option>' + S.channels.map((c) =>
        `<option value="${escAttr(c.firebaseKey)}">${escapeHtml(c.name)}</option>`).join('');
    if (S.channels.some((c) => c.firebaseKey === current)) sel.value = current;
}

function channelOptions(selectedId) {
    return '<option value="">No channel</option>' + S.channels.map((c) =>
        `<option value="${escAttr(c.firebaseKey)}" ${c.firebaseKey === selectedId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
}

function renderChannels() {
    const q = S.ui.channels.search;
    let items = S.channels.slice();
    if (q) items = items.filter((c) => String(c.name || '').toLowerCase().includes(q));
    $('chCount').textContent = countText(items.length, items.length);

    listState($('chList'), $('chEmpty'), S.loaded.channels, items.map((c) => {
        const clients = S.clients.filter((x) => x.channel === c.firebaseKey).length;
        const legacy = S.legacy.filter((x) => x.channel === c.firebaseKey).length;
        return `
        <article class="card tappable" data-key="${escAttr(c.firebaseKey)}" data-kind="channel" role="button" tabindex="0" aria-label="Edit ${escAttr(c.name)}">
            <div class="card-row">
                <div class="card-main">
                    <div class="card-title">${escapeHtml(c.name)}</div>
                    <div class="card-sub">
                        <span>${clients} client${clients === 1 ? '' : 's'}</span>
                        <span class="sep">·</span>
                        <span>${legacy} old client${legacy === 1 ? '' : 's'}</span>
                    </div>
                </div>
                <div class="card-actions">
                    <button class="ibtn" data-action="edit" data-stop title="Edit channel" aria-label="Edit channel">${icon('edit')}</button>
                </div>
            </div>
        </article>`;
    }).join(''));
}

function openChannelSheet(channel) {
    const isEdit = !!channel;
    const body = `
    <div class="form">
        <label class="field"><span>Channel name</span>
            <input type="text" id="chName" value="${escAttr(channel ? channel.name : '')}" placeholder="e.g. rapamplified" autocomplete="off">
        </label>
    </div>`;
    const footer = `
        ${isEdit ? `<button class="ibtn ibtn-danger" id="chDelete" title="Delete channel" aria-label="Delete channel">${icon('trash')}</button>` : ''}
        <div class="footer-gap"></div>
        <button class="btn btn-ghost" data-sheet-close>Cancel</button>
        <button class="btn btn-primary" id="chSave">${isEdit ? 'Save' : 'Add'}</button>`;
    openSheet(isEdit ? 'Edit channel' : 'New channel', body, footer);

    $('chSave').addEventListener('click', async () => {
        const v = $('chName').value.trim();
        if (!v) return toast('Name is required', 'error');
        closeSheet();
        try {
            if (isEdit) {
                await update(ref(database, `channels/${channel.firebaseKey}`), { name: v, updatedAt: Date.now() });
            } else {
                await set(push(ref(database, 'channels')), { name: v, createdAt: Date.now() });
            }
            toast('Channel saved', 'success');
        } catch (err) { console.error(err); toast('Save failed', 'error'); }
    });

    if (isEdit) {
        $('chDelete').addEventListener('click', () => {
            const linked = S.legacy.filter((l) => l.channel === channel.firebaseKey).length
                + S.clients.filter((x) => x.channel === channel.firebaseKey).length;
            const note = linked ? `<p>${linked} record${linked === 1 ? '' : 's'} reference this channel — they'll be unlinked, not deleted.</p>` : '';
            openConfirm('Delete channel?', `<p>Remove <strong>${escapeHtml(channel.name)}</strong>?</p>${note}`, async () => {
                closeConfirm();
                closeSheet();
                const updates = {};
                S.legacy.forEach((l) => { if (l.channel === channel.firebaseKey) updates[`legacyClients/${l.firebaseKey}/channel`] = null; });
                S.clients.forEach((c) => { if (c.channel === channel.firebaseKey) updates[`usmClients/${c.firebaseKey}/channel`] = null; });
                updates[`channels/${channel.firebaseKey}`] = null;
                try {
                    await update(ref(database), updates);
                    toast('Channel deleted', 'success');
                } catch (err) { console.error(err); toast('Delete failed', 'error'); }
            });
        });
    }
}

/* ============ ACTIVITY SEGMENTED (forms) ============ */

function activitySegHtml(current, id) {
    return `<div class="segmented" id="${id}">
        ${ACTIVITIES.map((a) => `<button type="button" class="seg seg-${a} ${a === current ? 'active' : ''}" data-value="${a}">${ACTIVITY_LABEL[a]}</button>`).join('')}
    </div>`;
}

function bindActivitySeg(id, initial, onChange) {
    let value = initial;
    document.querySelectorAll(`#${id} .seg`).forEach((b) => b.addEventListener('click', () => {
        value = b.dataset.value;
        document.querySelectorAll(`#${id} .seg`).forEach((x) => x.classList.toggle('active', x === b));
        if (onChange) onChange(value);
    }));
    return () => value;
}

/* ============ SHEET / CONFIRM / TOAST ============ */

let sheetOpen = false;
let sheetPushedHistory = false;
let suppressPop = false;

function openSheet(title, bodyHtml, footerHtml) {
    $('sheetTitle').textContent = title;
    $('sheetBody').innerHTML = bodyHtml;
    $('sheetFooter').innerHTML = footerHtml || '';
    const sheet = $('sheet');
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    $('sheetBody').scrollTop = 0;
    sheet.querySelectorAll('[data-sheet-close]').forEach((el) =>
        el.addEventListener('click', () => closeSheet()));
    // Custom checkboxes: reflect checked state on the label
    sheet.querySelectorAll('.check input').forEach((input) =>
        input.addEventListener('change', () => input.closest('.check').classList.toggle('checked', input.checked)));
    if (!sheetOpen) {
        history.pushState({ usmSheet: true }, '', location.href); // phone back button closes the sheet
        sheetPushedHistory = true;
    }
    sheetOpen = true;
}

function closeSheet(viaHistory = false) {
    if (!sheetOpen) return;
    sheetOpen = false;
    const sheet = $('sheet');
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    if (!viaHistory && sheetPushedHistory) {
        suppressPop = true;
        history.back();
    }
    sheetPushedHistory = false;
}

let confirmOpen = false;
function openConfirm(title, bodyHtml, onOk) {
    $('confirmTitle').textContent = title;
    $('confirmBody').innerHTML = bodyHtml;
    const box = $('confirmBox');
    box.classList.add('open');
    box.setAttribute('aria-hidden', 'false');
    confirmOpen = true;
    const okBtn = $('confirmOk');
    const fresh = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(fresh, okBtn);
    fresh.addEventListener('click', () => onOk && onOk());
}
function closeConfirm() {
    confirmOpen = false;
    const box = $('confirmBox');
    box.classList.remove('open');
    box.setAttribute('aria-hidden', 'true');
}

let toastTimer;
function toast(message, kind) {
    const el = $('toast');
    el.textContent = message;
    el.className = `toast show ${kind || ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 2200);
}

/* ============ EVENT WIRING ============ */

function wire() {
    $('loginForm').addEventListener('submit', handleLogin);
    $('logoutBtn').addEventListener('click', () => signOut(auth).catch(console.error));
    $('topbarBack').addEventListener('click', () => history.back());

    // Bottom tabs / rail
    document.querySelectorAll('.tab').forEach((t) =>
        t.addEventListener('click', () => navigate(t.dataset.nav)));

    // Routing
    window.addEventListener('hashchange', applyRoute);
    window.addEventListener('popstate', () => {
        if (suppressPop) { suppressPop = false; return; }
        if (confirmOpen) closeConfirm();
        if (sheetOpen) closeSheet(true);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (confirmOpen) closeConfirm();
            else if (sheetOpen) closeSheet();
        }
    });

    // Confirm dialog static close buttons
    document.querySelectorAll('[data-confirm-close]').forEach((el) =>
        el.addEventListener('click', closeConfirm));

    // ---- Orders ----
    $('ordersSearch').addEventListener('input', debounce((e) => {
        S.ui.orders.search = e.target.value.toLowerCase().trim();
        S.ui.orders.shown = PAGE_SIZE;
        renderOrders();
    }, 120));
    $('ordersSort').addEventListener('change', (e) => { S.ui.orders.sort = e.target.value; persistUi(); renderOrders(); });
    $('ordersStatsBtn').addEventListener('click', (e) => {
        S.ui.orders.stats = !S.ui.orders.stats;
        e.currentTarget.setAttribute('aria-pressed', S.ui.orders.stats);
        renderOrders();
    });
    $('ordersTestBtn').addEventListener('click', (e) => {
        S.ui.orders.test = !S.ui.orders.test;
        e.currentTarget.setAttribute('aria-pressed', S.ui.orders.test);
        renderOrders();
    });
    $('ordersMore').addEventListener('click', () => { S.ui.orders.shown += 30; renderOrders(); });
    $('ordersClientClear').addEventListener('click', () => { S.ui.orders.clientFilter = null; renderOrders(); });

    $('ordersList').addEventListener('click', (e) => {
        const card = e.target.closest('.card');
        if (!card) return;
        if (e.target.closest('[data-action="edit"]')) return openOrderSheet(card.dataset.key);
        if (e.target.closest('[data-stop]')) return;
        // whole card (incl. chevron) toggles details
        S.ui.orders.expanded = S.ui.orders.expanded === card.dataset.key ? null : card.dataset.key;
        renderOrders();
    });

    // ---- Clients ----
    $('clientsSearch').addEventListener('input', debounce((e) => {
        S.ui.clients.search = e.target.value.toLowerCase().trim();
        renderClients();
    }, 120));
    $('clientsSort').addEventListener('change', (e) => { S.ui.clients.sort = e.target.value; persistUi(); renderClients(); });
    $('clientsAdd').addEventListener('click', openNewClientSheet);

    $('clientsList').addEventListener('click', (e) => {
        const card = e.target.closest('.card');
        if (!card) return;
        const key = card.dataset.key;
        if (e.target.closest('[data-cycle]')) return cycleActivity('usmClients', key);
        if (e.target.closest('[data-action="orders"]')) {
            const c = S.clients.find((x) => x.firebaseKey === key);
            if (!c) return;
            S.ui.orders.clientFilter = { id: c.firebaseKey, name: c.name };
            S.ui.orders.tab = 'pending';
            navigate('orders');
            return;
        }
        if (e.target.closest('[data-stop]')) return;
        navigate(`client/${key}`);
    });

    $('cdBack').addEventListener('click', () => history.back());
    $('cdSave').addEventListener('click', saveClientDetail);
    $('cdDelete').addEventListener('click', deleteClientFromDetail);

    // ---- Leads ----
    $('leadsSearch').addEventListener('input', debounce((e) => {
        S.ui.leads.search = e.target.value.toLowerCase().trim();
        S.ui.leads.shown = PAGE_SIZE;
        renderLeads();
    }, 120));
    $('leadsSort').addEventListener('change', (e) => { S.ui.leads.sort = e.target.value; persistUi(); renderLeads(); });
    $('leadsGenre').addEventListener('change', (e) => { S.ui.leads.genre = e.target.value; S.ui.leads.shown = PAGE_SIZE; renderLeads(); });
    $('leadsStatsBtn').addEventListener('click', (e) => {
        S.ui.leads.stats = !S.ui.leads.stats;
        e.currentTarget.setAttribute('aria-pressed', S.ui.leads.stats);
        renderLeads();
    });
    $('leadsMore').addEventListener('click', () => { S.ui.leads.shown += 30; renderLeads(); });

    $('leadsList').addEventListener('click', (e) => {
        const card = e.target.closest('.card');
        if (!card) return;
        if (e.target.closest('[data-cycle]')) return cycleActivity('trialCampaignSubmissions', card.dataset.key);
        if (e.target.closest('[data-action="edit"]')) return openLeadSheet(card.dataset.key);
        if (e.target.closest('[data-stop]')) return;
        openLeadSheet(card.dataset.key);
    });

    // ---- Old clients ----
    $('oldSearch').addEventListener('input', debounce((e) => {
        S.ui.old.search = e.target.value.toLowerCase().trim();
        renderOld();
    }, 120));
    $('oldSort').addEventListener('change', (e) => { S.ui.old.sort = e.target.value; persistUi(); renderOld(); });
    $('oldChannel').addEventListener('change', (e) => { S.ui.old.channel = e.target.value; renderOld(); });
    $('oldAdd').addEventListener('click', openNewOldSheet);

    $('oldList').addEventListener('click', (e) => {
        const card = e.target.closest('.card');
        if (!card) return;
        const key = card.dataset.key;
        const l = S.legacy.find((x) => x.firebaseKey === key);
        if (!l) return;
        if (e.target.closest('[data-cycle]')) return cycleActivity('legacyClients', key);
        if (e.target.closest('[data-action="hot"]')) {
            fbUpdate(`legacyClients/${key}`, { hot: !l.hot, updatedAt: Date.now() });
            toast(l.hot ? 'Hot flag removed' : 'Flagged hot 🔥', 'success');
            return;
        }
        if (e.target.closest('[data-action="touch"]')) {
            fbUpdate(`legacyClients/${key}`, { lastContacted: Date.now(), updatedAt: Date.now() }, 'Marked contacted today');
            return;
        }
        if (e.target.closest('[data-stop]')) return;
        navigate(`old/${key}`);
    });

    $('odBack').addEventListener('click', () => history.back());
    $('odSave').addEventListener('click', saveOldDetail);
    $('odDelete').addEventListener('click', deleteOldFromDetail);

    // ---- Channels ----
    $('chSearch').addEventListener('input', debounce((e) => {
        S.ui.channels.search = e.target.value.toLowerCase().trim();
        renderChannels();
    }, 120));
    $('chAdd').addEventListener('click', () => openChannelSheet(null));
    $('chList').addEventListener('click', (e) => {
        const card = e.target.closest('.card');
        if (!card) return;
        const c = S.channels.find((x) => x.firebaseKey === card.dataset.key);
        if (c) openChannelSheet(c);
    });

    // Keyboard: Enter/Space opens tappable cards (a11y)
    document.querySelectorAll('.list').forEach((list) =>
        list.addEventListener('keydown', (e) => {
            if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) {
                e.preventDefault();
                e.target.click();
            }
        }));

    // Restore select values from persisted UI prefs
    $('ordersSort').value = S.ui.orders.sort;
    $('clientsSort').value = S.ui.clients.sort;
    $('leadsSort').value = S.ui.leads.sort;
    $('oldSort').value = S.ui.old.sort;
}

wire();

// Console debugging handle
window.__usm = { S, applyRoute, rerender, toast, openSheet, closeSheet };
