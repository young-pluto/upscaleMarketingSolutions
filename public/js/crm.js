import { auth } from './firebase-config.js';
import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

/* ==========================================================================
   Client OS — mobile-first Instagram client manager.
   Architecture mirrors the lead-outreach board: Firebase-Auth login gate,
   Bearer-token serverless API (/api/crm-admin), load-all-in-memory,
   filter/sort/search client-side, optimistic writes. Design per handoff.
   ========================================================================== */

const API_URL = '/api/crm-admin';
const STATUSES = ['Lead', 'Warm', 'Active', 'Client', 'VIP', 'Stale', 'Dead'];
const COLD_DAYS = 14;          // "haven't contacted in a while" threshold for Today
const DAY = 86400000;

// The Instagram pages you run — the shared `channels/` node, loaded from the API
// and used by both the CRM and the admin. A client's `channel` field stores the
// channel's key; we resolve it to { key, name, short, color } for display.
let CHANNELS = [];
let CHANNEL_MAP = {};
const CHAN_PALETTE = ['#E5963C', '#31A8A0', '#A78BFA', '#5AB0F0', '#E56C8C', '#D0A94E'];
const CHAN_KNOWN = { rapgoatsofficial: { short: 'Goats', color: '#E5963C' }, rapamplified: { short: 'Amplified', color: '#31A8A0' }, raplegends2k25: { short: 'Legends', color: '#A78BFA' } };
function channelShort(name) {
    const k = CHAN_KNOWN[String(name || '').toLowerCase()];
    return k ? k.short : String(name || '');
}
function setChannels(list) {
    CHANNELS = (list || []).map((c, i) => {
        const known = CHAN_KNOWN[String(c.name || '').toLowerCase()];
        return { key: c.firebaseKey, name: c.name || '', short: channelShort(c.name), color: known ? known.color : CHAN_PALETTE[i % CHAN_PALETTE.length] };
    });
    CHANNEL_MAP = Object.fromEntries(CHANNELS.map((c) => [c.key, c]));
}
function channelOf(key) { return (key && CHANNEL_MAP[key]) || null; }

const SORTS = [
    ['priority', 'Priority'],
    ['longest', 'Longest since contact'],
    ['recent', 'Recently contacted'],
    ['followup', 'Follow-up date'],
    ['alpha', 'A–Z']
];

// Trial leads live in their own node (trialCampaignSubmissions) and stay separate
// from clients — the CRM surfaces them read-mostly under the "Leads" chip so the
// admin's lead labels are visible here too.
const LEAD_STATUSES = ['new', 'completed', 'contacted', 'converted', 'archived'];
const LEAD_LABEL = { new: 'New', completed: 'Completed', contacted: 'Contacted', converted: 'Converted', archived: 'Archived' };
const LEAD_COLOR = { new: 'var(--red)', completed: 'var(--st-Active)', contacted: 'var(--orange)', converted: 'var(--st-Client)', archived: 'var(--st-Dead)' };
function normalizeLeadStatus(s) {
    const v = String(s || 'new');
    return LEAD_STATUSES.includes(v) ? v : (v === 'qualified' ? 'completed' : 'new');
}

const CHIPS = [
    ['today', 'Today'],
    ['leads', 'Leads'],
    ['blip', 'Blip'],
    ['inprogress', 'In progress'],
    ['needsReply', 'Needs reply'],
    ['overdue', 'Overdue'],
    ['due', 'Due today'],
    ['cold', 'Cold'],
    ...STATUSES.map((s) => [s, s]),
    ['archived', 'Archived']
];
const META_FILTERS = ['today', 'blip', 'inprogress', 'needsReply', 'overdue', 'due', 'cold', 'archived'];
// Action queues answer "who do I need to deal with", and leads are most of that
// work — so they're included here. Leads are only held back from the plain
// browse list (All / status / channel), which is your book of actual clients.
const ACTION_FILTERS = ['today', 'blip', 'inprogress', 'needsReply', 'overdue', 'due', 'cold', 'archived'];

function readPreference(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (error) { return fallback; }
}

const ICONS = {
    dm: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M14.5 1.5L7 9M14.5 1.5L10 14.5 7 9 1.5 6.5 14.5 1.5z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M2.5 8.5l3.5 3.5 7.5-8" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bell: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 1.5a4.5 4.5 0 014.5 4.5c0 3.5 1.5 4.5 1.5 4.5H2s1.5-1 1.5-4.5A4.5 4.5 0 018 1.5zM6.5 13a1.6 1.6 0 003 0" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pencil: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M11.5 2l2.5 2.5L5.5 13H3v-2.5L11.5 2z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/></svg>',
    archive: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1.5 2h13v3h-13zM3 5v8.5h10V5M6.5 8h3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevron: '<svg width="6" height="10" viewBox="0 0 6 10" class="chev"><path d="M1 1l4 4-4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    caret: '<svg width="7" height="5" viewBox="0 0 8 5"><path d="M1 1l3 3 3-3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>',
    tick: '<svg width="13" height="11" viewBox="0 0 14 12"><path d="M1.5 6.5l4 4 7-9" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    magnifier: '<svg width="13" height="13" viewBox="0 0 14 14"><circle cx="6" cy="6" r="4.6" stroke="currentColor" stroke-width="1.5" fill="none" class="icon-t3"/><path d="M9.6 9.6L13 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" class="icon-t3"/></svg>',
    ig: '<svg width="17" height="17" viewBox="0 0 18 18"><rect x="1.6" y="1.6" width="14.8" height="14.8" rx="4.4" stroke="currentColor" stroke-width="1.4" fill="none"/><circle cx="9" cy="9" r="3.5" stroke="currentColor" stroke-width="1.4" fill="none"/><circle cx="13.1" cy="4.9" r="1" fill="currentColor"/></svg>'
};

/* -------------------------------------------------------------- helpers -- */
function h(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v == null) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style') node.setAttribute('style', v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
    }
    const kids = Array.isArray(children) ? children : [children];
    for (const c of kids) {
        if (c == null || c === false) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
}

function toArray(v) {
    if (Array.isArray(v)) return v.filter(Boolean);
    if (v && typeof v === 'object') return Object.values(v).filter(Boolean);
    return [];
}

function normalizeClient(c) {
    return {
        id: c.firebaseKey,
        handle: c.handle || '',
        handleKey: c.handleKey || (c.handle || '').toLowerCase(),
        name: c.name || '',
        email: c.email || '',
        phone: c.phone || '',
        source: c.source || 'manual',
        // Same record, same operations — `kind` is what keeps leads and clients
        // visually apart. Derived for records written before the field existed.
        kind: c.kind === 'lead' || c.kind === 'client'
            ? c.kind
            : ((c.source === 'trial' || c.status === 'Lead') ? 'lead' : 'client'),
        // Trial-campaign facts, mirrored onto the client (server-projected).
        trial: c.trial || null,
        trialKey: c.trialKey || '',
        youtubeLink: c.youtubeLink || '',
        youtubeThumbnailUrl: c.youtubeThumbnailUrl || '',
        // Orders + rollups ride along on the client record (server-projected).
        orders: c.orders || {},
        orderCount: Number(c.orderCount || 0),
        revenue: Number(c.revenue || 0),
        lastOrderAt: Number(c.lastOrderAt || 0),
        hasActiveOrder: !!c.hasActiveOrder,
        urgent: !!c.urgent,
        orderSummary: c.orderSummary || { count: Number(c.orderCount || 0), revenue: Number(c.revenue || 0), lastOrderAt: Number(c.lastOrderAt || 0) },
        niche: c.niche || '',
        channel: c.channel || '',
        status: STATUSES.includes(c.status) ? c.status : 'Lead',
        note: c.note || '',
        needsReply: !!c.needsReply,
        archived: !!c.archived,
        followUpAt: c.followUpAt || null,
        followUpHasTime: !!c.followUpHasTime,
        lastContactedAt: c.lastContactedAt || null,
        highlights: toArray(c.highlights).map((x) => ({ text: x.text || '', pinned: !!x.pinned })).filter((x) => x.text),
        history: toArray(c.history).map((e) => ({ at: e.at || 0, text: e.text || '' })).filter((e) => e.text),
        createdAt: c.createdAt || 0
    };
}

function startOfDay(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function startOfToday() {
    return startOfDay(Date.now());
}

// <input type="date"> speaks local YYYY-MM-DD; <input type="time"> local HH:MM.
// Convert both ways in LOCAL time so a date the user picks on the calendar means
// that calendar day for them — never a UTC-shifted neighbour.
function toDateInputValue(ms) {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function toTimeInputValue(ms) {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Build a local ms timestamp from a date string (+ optional time). No time → midnight,
// which keeps fuDays/isDueToday/isOverdue (they floor to the day) working unchanged.
function fromDateTimeInputs(dateStr, timeStr) {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    let hh = 0;
    let mm = 0;
    if (timeStr) {
        const [a, b] = timeStr.split(':').map(Number);
        hh = a || 0;
        mm = b || 0;
    }
    return new Date(y, (m || 1) - 1, d || 1, hh, mm, 0, 0).getTime();
}

function timeLabel(ms) {
    return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Order-customers may have no IG handle — fall back to name/email for display.
function clientTitle(c) {
    if (c.handle) return '@' + c.handle;
    return c.name || c.email || 'Client';
}

function moneyShort(n) {
    const v = Number(n || 0);
    if (v >= 1000) return '$' + (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'k';
    return '$' + Math.round(v);
}

// The red blip is ONE manual flag (`urgent`) and nothing else, so tapping it off
// always turns it off. An in-progress order switches it on for you in the admin,
// but from then on it's yours to clear.
function hasBlip(c) { return !!(c && c.urgent); }

function ago(ms) {
    if (!ms) return '—';
    const diff = Date.now() - ms;
    if (diff < 0) return 'now';
    const h_ = diff / 3600000;
    if (h_ < 1) return 'now';
    if (h_ < 24) return Math.round(h_) + 'h';
    const d = h_ / 24;
    if (d < 7) return Math.round(d) + 'd';
    if (d < 30) return Math.round(d / 7) + 'w';
    return Math.round(d / 30) + 'mo';
}

function fuDays(followUpAt) {
    if (!followUpAt) return null;
    const t0 = startOfToday();
    const target = new Date(followUpAt);
    target.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - t0) / DAY);
}

function fuLabel(followUpAt) {
    const n = fuDays(followUpAt);
    if (n == null) return 'None';
    if (n < 0) return 'Overdue ' + (-n) + 'd';
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n < 7) return 'In ' + n + ' days';
    return 'In ' + Math.round(n / 7) + 'w';
}

function isOverdue(c) { const n = fuDays(c.followUpAt); return n != null && n < 0; }
function isDueToday(c) { return fuDays(c.followUpAt) === 0; }
function isCold(c) {
    if (c.status === 'Dead') return false;
    if (!c.lastContactedAt) return true;
    return (Date.now() - c.lastContactedAt) > COLD_DAYS * DAY;
}
// Today = what genuinely needs doing now. Deliberately NOT "cold" — every
// imported client has an old or empty last-contacted date, so including cold
// put 38 of 46 clients in here and made the queue meaningless. Cold lives on
// its own chip for when you want to browse reconnect candidates.
// A *freshly arrived* lead you haven't contacted belongs in Today. Gated on
// arrival date on purpose: "never contacted" alone would park every historical
// import in Today permanently, which is the same flood as the old cold rule.
// New submissions surface for a few days, then fall back to the Leads chip.
const NEW_LEAD_DAYS = 7;
function isUncontactedLead(c) {
    if (c.kind !== 'lead' || c.lastContactedAt) return false;
    if (!c.createdAt) return false;
    return (Date.now() - c.createdAt) <= NEW_LEAD_DAYS * DAY;
}
function isActionable(c) { return c.needsReply || hasBlip(c) || isOverdue(c) || isDueToday(c) || isUncontactedLead(c); }

function statusPillStyle(status, big) {
    const v = `var(--st-${status})`;
    return `color:${v};background:color-mix(in srgb, ${v} 13%, transparent)` + (big ? '' : '');
}

function dateLabel(ms) {
    const d = new Date(ms);
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

// Coloured "which of my pages did this client come from" badge. null when unassigned.
function channelBadge(channelId) {
    const ch = channelOf(channelId);
    if (!ch) return null;
    return h('span', {
        class: 'chan-badge',
        style: `color:${ch.color};background:color-mix(in srgb, ${ch.color} 15%, transparent)`
    }, [h('span', { class: 'chan-dot', style: `background:${ch.color}` }), h('span', { text: ch.short })]);
}

/* Follow-up picker — shared by the Remind sheet and the add/edit form.
   Quick presets for speed + a native calendar date input for any specific day,
   plus an optional time (stored for a future push-notification reminder).
   Returns { node, get } where get() → { at: ms|null, hasTime: bool }. */
function fuPicker(initialAt, initialHasTime) {
    const sel = { at: initialAt || null, hasTime: !!(initialAt && initialHasTime) };

    const dateInput = h('input', { type: 'date', class: 'fu-input' });
    const timeInput = h('input', { type: 'time', class: 'fu-input' });
    const preview = h('div', { class: 'fu-preview' });

    const presets = [[0, 'Today'], [1, 'Tomorrow'], [3, 'In 3 days'], [7, 'Next week'], [14, 'In 2 weeks']];
    const chipEls = presets.map(([days, label]) => {
        const ts = startOfToday() + days * DAY;
        const el = h('button', { type: 'button', class: 'fu-chip' }, label);
        el._ts = ts;
        el.addEventListener('click', () => {
            sel.at = ts;
            sel.hasTime = false;
            sync();
        });
        return el;
    });

    const markChips = () => chipEls.forEach((el) => {
        const on = sel.at != null && !sel.hasTime && startOfDay(sel.at) === el._ts;
        el.classList.toggle('on', on);
    });

    const renderPreview = () => {
        preview.textContent = '';
        if (!sel.at) {
            preview.classList.add('none');
            preview.appendChild(h('span', { text: 'No follow-up set' }));
            return;
        }
        preview.classList.remove('none');
        preview.appendChild(h('span', { class: 'fu-preview-rel', text: fuLabel(sel.at) }));
        preview.appendChild(h('span', { class: 'fu-preview-abs', text: dateLabel(sel.at) + (sel.hasTime ? ' · ' + timeLabel(sel.at) : '') }));
    };

    const sync = () => {
        dateInput.value = sel.at ? toDateInputValue(sel.at) : '';
        timeInput.value = sel.at && sel.hasTime ? toTimeInputValue(sel.at) : '';
        markChips();
        renderPreview();
    };

    dateInput.addEventListener('change', () => {
        if (!dateInput.value) { sel.at = null; sel.hasTime = false; sync(); return; }
        sel.at = fromDateTimeInputs(dateInput.value, sel.hasTime ? timeInput.value : '');
        renderPreview();
        markChips();
    });
    timeInput.addEventListener('change', () => {
        if (!timeInput.value) {
            sel.hasTime = false;
            if (sel.at) sel.at = startOfDay(sel.at);
            sync();
            return;
        }
        if (!dateInput.value) dateInput.value = toDateInputValue(startOfToday());
        sel.at = fromDateTimeInputs(dateInput.value, timeInput.value);
        sel.hasTime = true;
        renderPreview();
        markChips();
    });

    sync();

    const node = h('div', { class: 'fu-picker' }, [
        h('div', { class: 'pill-wrap' }, chipEls),
        h('div', { class: 'fu-inputs' }, [
            h('label', { class: 'fu-field' }, [h('span', { class: 'fu-field-label', text: 'Date' }), dateInput]),
            h('label', { class: 'fu-field' }, [h('span', { class: 'fu-field-label', text: 'Time · optional' }), timeInput])
        ]),
        preview
    ]);

    return { node, get: () => ({ at: sel.at, hasTime: sel.hasTime }) };
}

/* ================================================================ app == */
class ClientOS {
    constructor() {
        this.currentUser = null;
        this.state = {
            clients: [],
            leads: [],
            // Today is the default action queue: overdue/due follow-ups, reply
            // flags and clients that have never been contacted or gone cold.
            filters: ['today'],
            sort: readPreference('crm-sort', 'priority'),
            sheet: null,           // detail | sort | form | remind
            detailId: null,
            statusPickerOpen: false,
            channelPickerOpen: false,
            searchOpen: false,
            query: '',
            editingId: null,
            form: null,
            addingHighlight: false,
            toast: null
        };
        this._toastTimer = null;
        this._refreshTimer = null;

        this.dom = {
            auth: document.getElementById('authScreen'),
            shell: document.getElementById('appShell'),
            busy: document.getElementById('busyOverlay'),
            loginForm: document.getElementById('loginForm'),
            loginError: document.getElementById('loginError'),
            loginBtn: document.getElementById('loginBtn'),
            logoutBtn: document.getElementById('logoutBtn'),
            count: document.getElementById('countLabel'),
            chipRow: document.getElementById('chipRow'),
            list: document.getElementById('clientList'),
            overlay: document.getElementById('overlayRoot'),
            searchBtn: document.getElementById('searchBtn'),
            sortBtn: document.getElementById('sortBtn'),
            addBtn: document.getElementById('addBtn')
        };

        this.bindEvents();
        this.watchAuth();
    }

    bindEvents() {
        this.dom.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        this.dom.logoutBtn.addEventListener('click', () => signOut(auth).catch(() => {}));
        this.dom.searchBtn.addEventListener('click', () => this.openSearch());
        this.dom.sortBtn.addEventListener('click', () => this.openSheet('sort'));
        this.dom.addBtn.addEventListener('click', () => this.openForm(null));
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.currentUser) this.load({ silent: true });
        });
    }

    watchAuth() {
        onAuthStateChanged(auth, async (user) => {
            this.currentUser = user;
            if (!user) {
                this.dom.auth.hidden = false;
                this.dom.shell.hidden = true;
                this.dom.busy.hidden = true;
                this.stopRefresh();
                return;
            }
            this.dom.auth.hidden = true;
            this.dom.shell.hidden = false;
            this.dom.busy.hidden = false;
            await this.load();
            this.dom.busy.hidden = true;
            this.startRefresh();
        });
    }

    async handleLogin(e) {
        e.preventDefault();
        this.dom.loginError.textContent = '';
        this.dom.loginBtn.disabled = true;
        this.dom.loginBtn.textContent = 'Signing in…';
        try {
            await signInWithEmailAndPassword(
                auth,
                document.getElementById('adminEmail').value.trim(),
                document.getElementById('adminPassword').value
            );
        } catch (err) {
            this.dom.loginError.textContent = 'Invalid email or password.';
        } finally {
            this.dom.loginBtn.disabled = false;
            this.dom.loginBtn.textContent = 'Sign in';
        }
    }

    startRefresh() {
        this.stopRefresh();
        this._refreshTimer = window.setInterval(() => {
            if (this.currentUser && !document.hidden && !this.state.sheet && !this.state.searchOpen) {
                this.load({ silent: true });
            }
        }, 30000);
    }
    stopRefresh() { if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; } }

    /* ------------------------------------------------------------ data -- */
    async apiRequest(method, body) {
        const token = await this.currentUser.getIdToken();
        const res = await fetch(API_URL, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || data.error || 'Request failed');
        return data;
    }

    async load({ silent } = {}) {
        try {
            const { clients, channels, leads } = await this.apiRequest('GET');
            setChannels(channels);
            this.state.clients = (clients || []).map(normalizeClient);
            this.state.leads = (leads || []).map((l) => ({
                id: l.firebaseKey,
                name: l.fullName || '',
                status: normalizeLeadStatus(l.leadStatus),
                genre: l.genre || '',
                youtubeLink: l.youtubeLink || '',
                instagram: (l.instagramLink || '').replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, ''),
                note: l.adminNotes || '',
                at: Number(l.createdAt) || (l.submittedAtIso ? Date.parse(l.submittedAtIso) : 0) || 0
            }));
            this.render();
        } catch (err) {
            if (!silent) this.toast('Could not load clients');
        }
    }

    findClient(id) { return this.state.clients.find((c) => c.id === id); }

    withHistory(client, text) {
        return [{ at: Date.now(), text }, ...(client.history || [])].slice(0, 200);
    }

    // Optimistic update: apply locally, fire PATCH, roll back on failure.
    patch(id, updates, { toast, undo } = {}) {
        const c = this.findClient(id);
        if (!c) return;
        const prev = JSON.parse(JSON.stringify(c));
        Object.assign(c, updates);
        this.render();
        this.refreshDetail();
        this.apiRequest('PATCH', { firebaseKey: id, updates }).catch(() => {
            Object.assign(c, prev);
            this.render();
            this.refreshDetail();
            this.toast('Save failed — try again');
        });
        if (toast) this.toast(toast, undo);
    }

    /* ----------------------------------------------------------- render -- */
    render() {
        this.renderChips();
        if (this.state.filters.includes('leads')) { this.renderLeadList(); return; }
        const rows = this.visibleClients();   // filter+sort once, share with count + list
        this.renderCount(rows);
        this.renderList(rows);
    }

    /* ---- trial leads (separate node, shown read-mostly) ---- */
    visibleLeads() {
        const q = this.state.query.trim().toLowerCase();
        // Anything already mirrored into a client shows as that client instead, so
        // it never appears twice.
        const mirrored = new Set(this.state.clients.map((c) => c.trialKey).filter(Boolean));
        return (this.state.leads || [])
            .filter((l) => !mirrored.has(l.id))
            .filter((l) => !q || l.name.toLowerCase().includes(q) || l.genre.toLowerCase().includes(q) || l.instagram.toLowerCase().includes(q))
            .sort((a, b) => b.at - a.at);
    }

    // "Leads" covers both kinds: clients you added here whose status is Lead, and
    // trial-campaign submissions (a separate node). They used to be conflated, so
    // a CRM lead like @mxlo4nn never appeared in this list.
    leadClients() {
        const q = this.state.query.trim().toLowerCase();
        return this.state.clients
            .filter((c) => !c.archived && c.kind === 'lead')
            .filter((c) => !q || clientTitle(c).toLowerCase().includes(q) || c.niche.toLowerCase().includes(q) || c.note.toLowerCase().includes(q))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    renderLeadList() {
        const clientLeads = this.leadClients();
        const rows = this.visibleLeads();
        const total = clientLeads.length + (this.state.leads || []).length;
        this.dom.count.textContent = `${clientLeads.length + rows.length} of ${total} leads`;
        const list = this.dom.list;
        list.textContent = '';
        if (!clientLeads.length && !rows.length) {
            list.appendChild(h('div', { class: 'empty' }, [
                h('div', { class: 'title', text: 'No leads' }),
                h('div', { class: 'sub', text: 'Clients with the Lead status and trial-campaign submissions both show up here.' })
            ]));
            return;
        }
        // CRM leads first — these are real client records, fully tappable.
        if (clientLeads.length) {
            list.appendChild(h('div', { class: 'lead-section', text: 'In CRM' }));
            const cf = document.createDocumentFragment();
            for (const c of clientLeads) cf.appendChild(this.renderRow(c));
            list.appendChild(cf);
        }
        if (rows.length) list.appendChild(h('div', { class: 'lead-section', text: 'Trial campaign submissions' }));
        const frag = document.createDocumentFragment();
        for (const l of rows) {
            const color = LEAD_COLOR[l.status] || 'var(--t3)';
            frag.appendChild(h('div', { class: 'row' }, [h('div', { class: 'row-inner' }, [
                h('div', { class: 'row-l1' }, [
                    h('span', { class: 'row-handle', text: l.name || (l.instagram ? '@' + l.instagram : 'Lead') }),
                    h('span', { class: 'row-niche', text: l.genre }),
                    h('span', { class: 'row-time', text: l.at ? ago(l.at) : '—' }),
                    l.instagram
                        ? h('button', {
                            class: 'row-ig', 'aria-label': 'Open Instagram',
                            onclick: (e) => { e.stopPropagation(); window.open('https://instagram.com/' + encodeURIComponent(l.instagram), '_blank', 'noopener'); }
                        }, h('span', { html: ICONS.ig }))
                        : null
                ]),
                h('div', { class: 'row-l2' }, [
                    h('span', { class: 'pill', style: `color:${color};background:color-mix(in srgb, ${color} 15%, transparent);font-weight:590`, text: LEAD_LABEL[l.status] }),
                    l.youtubeLink ? h('a', { class: 'pill', style: 'color:var(--t2);background:var(--elev2);text-decoration:none', href: l.youtubeLink, target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation(), text: 'video ↗' }) : null,
                    l.note ? h('span', { class: 'row-more', text: l.note.slice(0, 40) }) : null
                ])
            ])]));
        }
        list.appendChild(frag);
        list.appendChild(h('div', { style: 'height:8px' }));
    }

    visibleClients() {
        const s = this.state;
        const statusF = s.filters.filter((f) => STATUSES.includes(f));
        const metaF = s.filters.filter((f) => META_FILTERS.includes(f));
        const channelF = s.filters.filter((f) => f.startsWith('ch:')).map((f) => f.slice(3));

        const showArchived = metaF.includes('archived');
        const includeLeads = s.filters.some((f) => ACTION_FILTERS.includes(f));
        let list = s.clients.filter((c) => {
            // Archived clients are hidden everywhere except the Archived chip.
            if (!!c.archived !== showArchived) return false;
            // Leads join any action queue (Today, Blip, Overdue…) because chasing
            // them is the work; they're only held out of the plain browse list.
            if (c.kind === 'lead' && !includeLeads) return false;
            if (statusF.length && !statusF.includes(c.status)) return false;
            if (channelF.length && !channelF.includes(c.channel)) return false;
            if (metaF.includes('today') && !isActionable(c)) return false;
            if (metaF.includes('blip') && !hasBlip(c)) return false;
            if (metaF.includes('inprogress') && !c.hasActiveOrder) return false;
            if (metaF.includes('cold') && !isCold(c)) return false;
            if (metaF.includes('needsReply') && !c.needsReply) return false;
            if (metaF.includes('overdue') && !isOverdue(c)) return false;
            if (metaF.includes('due') && !isDueToday(c)) return false;
            return true;
        });

        const rank = (c) => {
            const n = fuDays(c.followUpAt);
            return (n != null && n <= 0) ? n : 99;   // overdue/today first
        };
        const lc = (c) => c.lastContactedAt || 0;
        const cmp = ({
            priority: (a, b) => (Number(b.needsReply) - Number(a.needsReply)) || (rank(a) - rank(b)) || (lc(a) - lc(b)),
            longest: (a, b) => lc(a) - lc(b),
            recent: (a, b) => lc(b) - lc(a),
            followup: (a, b) => (fuDays(a.followUpAt) ?? 9999) - (fuDays(b.followUpAt) ?? 9999),
            alpha: (a, b) => a.handleKey.localeCompare(b.handleKey)
        }[s.sort] || ((a, b) => (Number(b.needsReply) - Number(a.needsReply)) || (rank(a) - rank(b)) || (lc(a) - lc(b))));

        return [...list].sort(cmp);
    }

    renderCount(rows = this.visibleClients()) {
        // The denominator has to match what the current view can show, otherwise
        // an action queue that includes leads reads as "12 of 41" against a pool
        // that was never 41.
        const includeLeads = this.state.filters.some((f) => ACTION_FILTERS.includes(f));
        const total = this.state.clients
            .filter((c) => !c.archived && (includeLeads || c.kind !== 'lead')).length;
        if (!this.state.filters.length) { this.dom.count.textContent = `${total} clients`; return; }
        const leadsShown = rows.filter((c) => c.kind === 'lead').length;
        this.dom.count.textContent = `${rows.length} of ${total}`
            + (leadsShown ? ` · ${leadsShown} lead${leadsShown === 1 ? '' : 's'}` : '');
    }

    renderChips() {
        const s = this.state;
        const row = this.dom.chipRow;
        row.textContent = '';
        row.appendChild(h('button', {
            class: 'chip' + (s.filters.length === 0 ? ' active' : ''),
            onclick: () => { s.filters = []; this.render(); }
        }, 'All'));
        const chips = [...CHIPS, ...CHANNELS.map((ch) => ['ch:' + ch.key, ch.short])];
        for (const [id, label] of chips) {
            row.appendChild(h('button', {
                class: 'chip' + (s.filters.includes(id) ? ' active' : ''),
                onclick: () => {
                    const on = s.filters.includes(id);
                    // "Leads" is a mode, not a filter — it swaps the list wholesale.
                    if (id === 'leads') s.filters = on ? [] : ['leads'];
                    else s.filters = (on ? s.filters.filter((x) => x !== id) : [...s.filters, id]).filter((x) => x !== 'leads');
                    this.render();
                }
            }, label));
        }
    }

    statusPill(status, big) {
        return h('span', { class: 'pill status' + (big ? ' big' : ''), style: statusPillStyle(status), text: status });
    }

    rowPills(c) {
        const pills = [];
        if (isOverdue(c)) pills.push(h('span', { class: 'pill due-overdue', text: 'Overdue ' + (-fuDays(c.followUpAt)) + 'd' }));
        else if (isDueToday(c)) pills.push(h('span', { class: 'pill due-today', text: 'Due today' }));

        const pinned = c.highlights.filter((x) => x.pinned);
        let shown = 0;
        for (const hl of pinned) {
            if (pills.length >= 3) break;
            pills.push(h('span', { class: 'pill', text: hl.text }));
            shown++;
        }
        const hidden = (pinned.length - shown) + c.highlights.filter((x) => !x.pinned).length;
        return { pills, hidden };
    }

    // Direct "open their Instagram" button — lives on every row so it's one tap
    // from the list, not just inside the detail sheet. Stops the row's tap-to-open.
    igButton(c) {
        if (!c.handle) return null;   // order-customers may have no Instagram
        return h('button', {
            class: 'row-ig', 'aria-label': 'Open @' + c.handle + ' on Instagram',
            onclick: (e) => { e.stopPropagation(); this.openIG(c); }
        }, h('span', { html: ICONS.ig }));
    }

    openIG(c) {
        if (!c.handle) { this.toast('No Instagram handle on file'); return; }
        window.open('https://instagram.com/' + encodeURIComponent(c.handle), '_blank', 'noopener');
        const ch = channelOf(c.channel);
        this.toast(ch ? 'Opening @' + c.handle + ' · reply from @' + ch.name : 'Opening @' + c.handle);
    }

    // Tappable red blip — one manual flag, so tapping always clears it.
    blipEl(c) {
        if (!hasBlip(c)) return null;
        return h('button', {
            class: 'blip blip-manual',
            title: 'Flagged — tap to clear',
            onclick: (e) => {
                e.stopPropagation();
                this.patch(c.id, { urgent: false }, { toast: 'Blip cleared' });
            }
        });
    }

    renderRow(c, compact) {
        const { pills, hidden } = this.rowPills(c);
        const l1 = h('div', { class: 'row-l1' }, [
            this.blipEl(c),
            c.needsReply ? h('span', { class: 'dot' }) : null,
            h('span', { class: 'row-handle', text: clientTitle(c) }),
            h('span', { class: 'row-niche', text: c.niche }),
            h('span', { class: 'row-time', text: ago(c.lastContactedAt) }),
            this.igButton(c)
        ]);
        // In a mixed queue (Today etc.) a lead has to be identifiable at a glance.
        const l2children = [
            c.kind === 'lead'
                ? h('span', {
                    class: 'pill lead-pill' + (isUncontactedLead(c) ? ' lead-new' : ''),
                    text: isUncontactedLead(c) ? 'New lead' : 'Lead'
                })
                : null,
            this.statusPill(c.status), channelBadge(c.channel), ...pills
        ];
        if (c.hasActiveOrder) l2children.push(h('span', { class: 'pill in-progress-pill', text: 'In progress' }));
        if (c.orderCount) l2children.push(h('span', { class: 'pill order-pill', text: c.orderCount + '× · ' + moneyShort(c.revenue) }));
        if (hidden > 0) l2children.push(h('span', { class: 'row-more', text: '+' + hidden }));
        const l2 = h('div', { class: 'row-l2' }, l2children);

        return h('div', {
            class: compact ? 'search-row' : 'row',
            onclick: () => this.openDetail(c.id)
        }, [h('div', { class: compact ? 'search-row-inner' : 'row-inner' }, compact ? [
            this.blipEl(c),
            c.needsReply ? h('span', { class: 'dot' }) : null,
            h('span', { class: 'row-handle', text: clientTitle(c) }),
            h('span', { class: 'row-niche', text: c.niche }),
            channelBadge(c.channel),
            this.statusPill(c.status),
            this.igButton(c)
        ] : [l1, l2])]);
    }

    renderList(rows = this.visibleClients()) {
        const list = this.dom.list;
        list.textContent = '';
        if (rows.length === 0) {
            const hasAny = this.state.clients.some((c) => !c.archived);
            // An empty Today is the good outcome, not a dead end — say so, and
            // offer the two lists you'd actually want next.
            const onlyToday = hasAny && this.state.filters.length === 1 && this.state.filters[0] === 'today';
            list.appendChild(h('div', { class: 'empty' }, [
                h('div', { class: 'title', text: !hasAny ? 'No clients yet' : (onlyToday ? 'Nothing due today' : 'No clients match') }),
                h('div', { class: 'sub', text: !hasAny
                    ? 'Add your first client with the + button below.'
                    : (onlyToday
                        ? 'Every lead has been reached out to, no follow-ups due, no reply flags, no blips. Browse Cold to find someone worth reconnecting with.'
                        : 'Nothing fits the current filters. Clear them, or add a client with +.') }),
                onlyToday
                    ? h('button', { class: 'clear', onclick: () => { this.state.filters = ['cold']; this.render(); } }, 'Show cold clients')
                    : (this.state.filters.length ? h('button', { class: 'clear', onclick: () => { this.state.filters = []; this.render(); } }, 'Clear filters') : null)
            ]));
            return;
        }
        const frag = document.createDocumentFragment();
        for (const c of rows) frag.appendChild(this.renderRow(c));
        frag.appendChild(h('div', { style: 'height:8px' }));
        list.appendChild(frag);
    }

    /* --------------------------------------------------------- overlays -- */
    closeOverlay() {
        this.state.sheet = null;
        this.state.statusPickerOpen = false;
        this.state.channelPickerOpen = false;
        this.state.addingHighlight = false;
        this.dom.overlay.textContent = '';
    }

    openSheet(kind, buildBody) {
        this.state.sheet = kind;
        this.dom.overlay.textContent = '';
        const scrim = h('div', { class: 'scrim', onclick: () => this.closeOverlay() });
        const body = h('div', { class: 'sheet-body' });
        const sheet = h('div', { class: 'sheet ' + kind }, [
            h('div', { class: 'grabber-wrap', onclick: () => this.closeOverlay() }, h('div', { class: 'grabber' })),
            body
        ]);
        this.dom.overlay.appendChild(scrim);
        this.dom.overlay.appendChild(sheet);
        this._sheetBody = body;
        buildBody && buildBody(body);
        return body;
    }

    /* ---- detail ---- */
    openDetail(id) {
        this.state.detailId = id;
        this.state.statusPickerOpen = false;
        this.state.channelPickerOpen = false;
        this.state.addingHighlight = false;
        if (this.state.searchOpen) this.closeSearch();
        this.openSheet('detail', (body) => this.buildDetail(body));
    }

    refreshDetail() {
        if (this.state.sheet === 'detail' && this._sheetBody) this.buildDetail(this._sheetBody);
    }

    buildDetail(body) {
        const c = this.findClient(this.state.detailId);
        body.textContent = '';
        if (!c) return;

        // identity + blip + needs-reply toggle
        body.appendChild(h('div', { class: 'd-identity' }, [
            this.blipEl(c),
            h('span', { class: 'd-handle', text: clientTitle(c) }),
            c.urgent
                ? null
                : h('button', { class: 'hi-add', onclick: () => this.patch(c.id, { urgent: true }, { toast: 'Blip on' }) }, '+ Blip'),
            c.needsReply
                ? h('button', { class: 'd-needsreply', style: 'border:none;cursor:pointer;font-family:inherit', onclick: () => this.patch(c.id, { needsReply: false }, { toast: 'Reply flag cleared' }) }, 'Needs reply ✕')
                : h('button', { class: 'hi-add', onclick: () => this.patch(c.id, { needsReply: true }, { toast: 'Flagged — needs reply' }) }, '+ Flag reply')
        ]));
        const subBits = [c.niche, c.name && c.handle ? c.name : '', c.email].filter(Boolean).join(' · ');
        if (subBits) body.appendChild(h('div', { class: 'd-niche', text: subBits }));

        // Lead ⇄ Client. Same record and same operations either way; this only
        // decides which list they live in. Always a deliberate choice.
        body.appendChild(h('div', { class: 'kind-row' }, [
            h('span', { class: 'label', text: c.kind === 'lead' ? 'Lead' : 'Client' }),
            h('button', {
                class: 'kind-switch',
                onclick: () => {
                    const next = c.kind === 'lead' ? 'client' : 'lead';
                    this.patch(c.id, {
                        kind: next,
                        history: this.withHistory(c, next === 'client' ? 'Converted to client' : 'Moved back to leads')
                    }, { toast: next === 'client' ? 'Now a client' : 'Now a lead' });
                }
            }, c.kind === 'lead' ? 'Convert to client' : 'Move to leads')
        ]));

        // status + channel + meta
        const statusBtn = h('button', {
            class: 'pill status big status-pick-btn',
            style: statusPillStyle(c.status),
            onclick: () => { this.state.statusPickerOpen = !this.state.statusPickerOpen; this.state.channelPickerOpen = false; this.refreshDetail(); }
        }, [h('span', { text: c.status }), h('span', { html: ICONS.caret })]);

        const ch = channelOf(c.channel);
        const channelBtn = h('button', {
            class: 'pill status big status-pick-btn',
            style: ch ? `color:${ch.color};background:color-mix(in srgb, ${ch.color} 15%, transparent)` : 'color:var(--t3);background:var(--elev)',
            onclick: () => { this.state.channelPickerOpen = !this.state.channelPickerOpen; this.state.statusPickerOpen = false; this.refreshDetail(); }
        }, [h('span', { html: ICONS.ig }), h('span', { text: ch ? ch.short : 'No page' }), h('span', { html: ICONS.caret })]);

        const metaText = `Last contacted ${ago(c.lastContactedAt)} · Added ${c.createdAt ? dateLabel(c.createdAt) : '—'}`;
        body.appendChild(h('div', { class: 'd-status-row' }, [statusBtn, channelBtn, h('span', { class: 'd-meta', text: metaText })]));

        if (this.state.statusPickerOpen) {
            body.appendChild(h('div', { class: 'status-picker' }, STATUSES.map((st) => h('button', {
                class: 'pill status big status-opt' + (c.status === st ? ' selected' : ''),
                style: statusPillStyle(st) + (c.status === st ? `;outline:1.5px solid var(--st-${st})` : ''),
                onclick: () => {
                    this.state.statusPickerOpen = false;
                    this.patch(c.id, { status: st, history: this.withHistory(c, 'Status → ' + st) }, { toast: 'Status → ' + st });
                }
            }, st))));
        }

        if (this.state.channelPickerOpen) {
            const opts = [{ key: '', short: 'No page', color: '' }, ...CHANNELS];
            body.appendChild(h('div', { class: 'status-picker' }, opts.map((opt) => h('button', {
                class: 'pill status big status-opt' + (c.channel === opt.key ? ' selected' : ''),
                style: (opt.key
                    ? `color:${opt.color};background:color-mix(in srgb, ${opt.color} 15%, transparent)` + (c.channel === opt.key ? `;outline:1.5px solid ${opt.color}` : '')
                    : 'color:var(--t2);background:var(--elev)' + (c.channel === opt.key ? ';outline:1.5px solid var(--line2)' : '')),
                onclick: () => {
                    this.state.channelPickerOpen = false;
                    this.patch(c.id, { channel: opt.key, history: this.withHistory(c, opt.key ? 'Page → ' + opt.short : 'Page cleared') }, { toast: opt.key ? 'Page → ' + opt.short : 'Page cleared' });
                }
            }, opt.short))));
        }

        // quick actions
        const qa = (icon, label, cls, onclick) => h('button', { class: 'qa' + (cls ? ' ' + cls : ''), onclick }, [
            h('span', { html: icon }), h('span', { text: label })
        ]);
        body.appendChild(h('div', { class: 'qa-grid' }, [
            qa(ICONS.dm, 'Open IG', 'primary', () => this.openIG(c)),
            qa(ICONS.check, 'Contacted', null, () => this.patch(c.id, { lastContactedAt: Date.now(), needsReply: false, history: this.withHistory(c, 'Marked contacted') }, { toast: 'Marked contacted' })),
            qa(ICONS.bell, 'Remind', null, () => this.openReminder()),
            qa(ICONS.pencil, 'Edit', null, () => this.openForm(c.id)),
            c.archived
                ? qa(ICONS.archive, 'Restore', null, () => this.unarchive(c))
                : qa(ICONS.archive, 'Archive', null, () => this.archive(c))
        ]));

        // follow-up row
        const n = fuDays(c.followUpAt);
        const fuColor = n != null && n < 0 ? 'var(--red)' : (n === 0 ? 'var(--orange)' : 'var(--t1)');
        const fuValue = [h('span', { class: 'value', style: 'color:' + fuColor, text: fuLabel(c.followUpAt) })];
        if (c.followUpAt) {
            fuValue.push(h('span', { class: 'sub', text: dateLabel(c.followUpAt) + (c.followUpHasTime ? ' · ' + timeLabel(c.followUpAt) : '') }));
        }
        body.appendChild(h('div', { class: 'followup-row', onclick: () => this.openReminder() }, [
            h('span', { class: 'label', text: 'Follow-up' }),
            h('div', { class: 'fu-value-wrap' }, fuValue)
        ]));

        // trial campaign — the video they submitted, plus its current trial label
        if (c.trial) {
            const t = c.trial;
            const gained = (t.viewsStart != null && t.viewsEnd != null)
                ? '+' + Math.max(0, t.viewsEnd - t.viewsStart).toLocaleString() + ' views'
                : '';
            body.appendChild(h('div', { class: 'followup-row', style: 'cursor:default' }, [
                h('span', { class: 'label', text: 'Trial' }),
                h('div', { class: 'fu-value-wrap' }, [
                    h('span', { class: 'value', text: LEAD_LABEL[t.leadStatus] || 'New' }),
                    h('span', { class: 'sub', text: [t.genre, t.subgenre, gained].filter(Boolean).join(' · ') })
                ])
            ]));
            if (c.youtubeLink) {
                body.appendChild(h('a', {
                    class: 'order-live-row', href: c.youtubeLink, target: '_blank', rel: 'noopener noreferrer',
                    style: 'text-decoration:none'
                }, [
                    h('span', { class: 'label', text: 'Their video' }),
                    h('span', { class: 'sub', text: 'open ↗' })
                ]));
            }
        }

        // orders — the client record carries them; keep it a quick glance here
        // (full editing lives in the admin).
        if (c.orderCount) {
            body.appendChild(h('div', { class: 'followup-row', style: 'cursor:default' }, [
                h('span', { class: 'label', text: 'Orders' }),
                h('div', { class: 'fu-value-wrap' }, [
                    h('span', { class: 'value', text: c.orderCount + ' · ' + moneyShort(c.revenue) }),
                    c.lastOrderAt ? h('span', { class: 'sub', text: 'last ' + ago(c.lastOrderAt) }) : null
                ])
            ]));
            const live = Object.values(c.orders || {})
                .filter((o) => !o.isTest && ['pending', 'in_progress'].includes(o.serviceStatus))
                .sort((a, b) => (b.at || 0) - (a.at || 0));
            for (const o of live) {
                body.appendChild(h('div', { class: 'order-live-row' }, [
                    h('span', { class: 'label', text: moneyShort(o.amount) + ' · ' + (o.serviceStatus === 'in_progress' ? 'In progress' : 'Pending') }),
                    o.youtubeLink
                        ? h('a', { class: 'sub link', href: o.youtubeLink, target: '_blank', rel: 'noopener noreferrer', text: 'video ↗' })
                        : null
                ]));
            }
        }

        // highlights
        const hiWrap = h('div', { class: 'hi-wrap' });
        c.highlights.forEach((hl, i) => {
            hiWrap.appendChild(h('span', { class: 'pill hi-pill' + (hl.pinned ? ' pinned' : ''), style: 'display:inline-flex;gap:5px;align-items:center' }, [
                h('span', { text: hl.text, style: 'cursor:pointer', onclick: () => this.toggleHighlight(c, i) }),
                h('span', { text: '✕', style: 'cursor:pointer;opacity:.5', onclick: () => this.removeHighlight(c, i) })
            ]));
        });
        if (this.state.addingHighlight) {
            let committed = false;
            const commitHighlight = (value) => {
                if (committed) return;
                committed = true;
                this.addHighlight(c, value);
            };
            const input = h('input', {
                class: 'form-fields', style: 'background:var(--elev);border:none;outline:none;border-radius:6px;padding:2px 8px;font-size:10.5px;color:var(--t1);font-family:inherit;width:110px',
                placeholder: 'New highlight', onkeydown: (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitHighlight(e.target.value); }
                    if (e.key === 'Escape') { this.state.addingHighlight = false; this.refreshDetail(); }
                }, onblur: (e) => { if (e.target.value.trim()) commitHighlight(e.target.value); else { this.state.addingHighlight = false; this.refreshDetail(); } }
            });
            hiWrap.appendChild(input);
            setTimeout(() => input.focus(), 0);
        } else {
            hiWrap.appendChild(h('button', { class: 'hi-add', onclick: () => { this.state.addingHighlight = true; this.refreshDetail(); } }, '+ Add'));
        }
        body.appendChild(h('div', { class: 'block' }, [
            h('div', { class: 'hi-head' }, [
                h('span', { class: 'section-label', text: 'Highlights' }),
                h('span', { class: 'hi-hint', text: 'tap to pin · 3 show in list' })
            ]),
            hiWrap
        ]));

        // notes
        if (c.note) {
            body.appendChild(h('div', { class: 'block' }, [
                h('div', { class: 'section-label', text: 'Notes' }),
                h('div', { class: 'note-body', text: c.note })
            ]));
        }

        // history
        if (c.history.length) {
            body.appendChild(h('div', { class: 'block' }, [
                h('div', { class: 'section-label', text: 'History' }),
                h('div', { style: 'margin-top:4px' }, c.history.map((e) => h('div', { class: 'tl-row' }, [
                    h('span', { class: 'tl-when', text: e.at ? ago(e.at) : '' }),
                    h('span', { class: 'tl-text', text: e.text })
                ])))
            ]));
        }
    }

    toggleHighlight(c, i) {
        const hl = c.highlights[i];
        if (!hl.pinned && c.highlights.filter((x) => x.pinned).length >= 3) {
            this.toast('3 highlights show in the list — unpin one first');
            return;
        }
        const highlights = c.highlights.map((x, j) => j === i ? { ...x, pinned: !x.pinned } : x);
        this.patch(c.id, { highlights });
    }
    removeHighlight(c, i) {
        const highlights = c.highlights.filter((_, j) => j !== i);
        this.patch(c.id, { highlights });
    }
    addHighlight(c, text) {
        const t = (text || '').trim().slice(0, 60);
        this.state.addingHighlight = false;
        if (!t) { this.refreshDetail(); return; }
        const highlights = [...c.highlights, { text: t, pinned: c.highlights.filter((x) => x.pinned).length < 3 }];
        this.patch(c.id, { highlights });
    }

    archive(c) {
        this.closeOverlay();
        this.patch(c.id, { archived: true }, {
            toast: 'Archived ' + clientTitle(c) + ' — find them under Archived',
            undo: () => this.patch(c.id, { archived: false })
        });
    }

    unarchive(c) {
        this.closeOverlay();
        this.patch(c.id, { archived: false }, { toast: 'Restored ' + clientTitle(c) });
    }

    /* ---- reminder ---- */
    openReminder() {
        const c = this.findClient(this.state.detailId);
        if (!c) return;
        const picker = fuPicker(c.followUpAt, c.followUpHasTime);
        this.openSheet('detail', (body) => {
            body.appendChild(h('div', { class: 'form-title', text: 'Follow up with @' + c.handle }));
            body.appendChild(picker.node);
            body.appendChild(h('button', {
                class: 'form-cta', style: 'margin-top:18px', onclick: () => {
                    const { at, hasTime } = picker.get();
                    const historyText = at
                        ? 'Follow-up set · ' + dateLabel(at) + (hasTime ? ' ' + timeLabel(at) : '')
                        : 'Follow-up cleared';
                    this.patch(c.id, {
                        followUpAt: at,
                        followUpHasTime: !!at && hasTime,
                        history: this.withHistory(c, historyText)
                    }, { toast: at ? 'Follow-up · ' + fuLabel(at).toLowerCase() : 'Follow-up cleared' });
                    this.openDetail(c.id);
                }
            }, 'Save follow-up'));
            if (c.followUpAt) {
                body.appendChild(h('button', {
                    class: 'remind-clear', onclick: () => {
                        this.patch(c.id, { followUpAt: null, followUpHasTime: false, history: this.withHistory(c, 'Follow-up cleared') }, { toast: 'Follow-up cleared' });
                        this.openDetail(c.id);
                    }
                }, 'Clear follow-up'));
            }
        });
        this.state.sheet = 'detail';
    }

    /* ---- sort / display ---- */
    openSheet2Sort() {}
    buildSort(body) {
        const s = this.state;
        body.textContent = '';   // rebuilt in place on theme/density toggle — clear first
        body.appendChild(h('div', { class: 'field-label', style: 'padding:6px 0 4px', text: 'Sort by' }));
        for (const [id, label] of SORTS) {
            body.appendChild(h('div', {
                class: 'sort-row' + (s.sort === id ? ' on' : ''),
                onclick: () => {
                    s.sort = id;
                    try { localStorage.setItem('crm-sort', id); } catch (error) {}
                    this.render();
                    this.closeOverlay();
                }
            }, [h('span', { text: label }), s.sort === id ? h('span', { html: ICONS.tick }) : null]));
        }
        body.appendChild(h('div', { class: 'field-label', style: 'padding:18px 0 8px', text: 'Display' }));
        const theme = document.documentElement.getAttribute('data-theme');
        const density = document.documentElement.getAttribute('data-density');
        const seg = (label, opts, current, onpick) => h('div', { class: 'display-row' }, [
            h('span', { class: 'label', text: label }),
            h('div', { class: 'seg' }, opts.map(([id, l]) => h('button', {
                class: 'seg-opt' + (current === id ? ' on' : ''), onclick: () => onpick(id)
            }, l)))
        ]);
        body.appendChild(seg('Appearance', [['dark', 'Dark'], ['light', 'Light']], theme, (id) => {
            document.documentElement.setAttribute('data-theme', id);
            try { localStorage.setItem('crm-theme', id); } catch (e) {}
            this.buildSort(body);
        }));
        body.appendChild(seg('Density', [['compact', 'Compact'], ['default', 'Default'], ['comfortable', 'Cozy']], density, (id) => {
            document.documentElement.setAttribute('data-density', id);
            try { localStorage.setItem('crm-density', id); } catch (e) {}
            this.buildSort(body);
        }));
    }

    /* ---- add / edit form ---- */
    openForm(id) {
        const editing = !!id;
        const c = editing ? this.findClient(id) : null;
        this.state.editingId = id;
        this.state.form = c
            ? { handle: '@' + c.handle, niche: c.niche, status: c.status, channel: c.channel, note: c.note, fuAt: c.followUpAt, fuHasTime: c.followUpHasTime }
            : { handle: '', niche: '', status: 'Lead', channel: '', note: '', fuAt: null, fuHasTime: false };

        this.openSheet('form', (body) => {
            const f = this.state.form;
            body.appendChild(h('div', { class: 'form-title', text: editing ? 'Edit client' : 'New client' }));

            const handleInput = h('input', { placeholder: '@instagram_handle', value: f.handle });
            const nicheInput = h('input', { placeholder: 'Niche · subs  (e.g. Tech reviews · 480K)', value: f.niche });
            const noteInput = h('textarea', { placeholder: 'Notes — budget, upload schedule, quirks…', rows: '3' });
            noteInput.value = f.note;

            const statusWrap = h('div', { class: 'pill-wrap' });
            const renderStatus = () => {
                statusWrap.textContent = '';
                STATUSES.forEach((st) => statusWrap.appendChild(h('button', {
                    type: 'button',
                    class: 'pill status big', style: statusPillStyle(st) + (f.status === st ? `;outline:1.5px solid var(--st-${st})` : ';opacity:.6'),
                    onclick: () => { f.status = st; renderStatus(); }
                }, st)));
            };
            renderStatus();

            const channelWrap = h('div', { class: 'pill-wrap' });
            const renderChannel = () => {
                channelWrap.textContent = '';
                const opts = [{ key: '', short: 'No page', color: '' }, ...CHANNELS];
                opts.forEach((opt) => channelWrap.appendChild(h('button', {
                    type: 'button',
                    class: 'pill status big',
                    style: (opt.key
                        ? `color:${opt.color};background:color-mix(in srgb, ${opt.color} 15%, transparent)` + (f.channel === opt.key ? `;outline:1.5px solid ${opt.color}` : ';opacity:.6')
                        : 'color:var(--t2);background:var(--elev)' + (f.channel === opt.key ? ';outline:1.5px solid var(--line2)' : ';opacity:.6')),
                    onclick: () => { f.channel = opt.key; renderChannel(); }
                }, opt.short)));
            };
            renderChannel();

            const picker = fuPicker(f.fuAt, f.fuHasTime);

            body.appendChild(h('div', { class: 'form-fields' }, [
                handleInput,
                nicheInput,
                h('div', {}, [h('div', { class: 'field-label', text: 'Status' }), statusWrap]),
                h('div', {}, [h('div', { class: 'field-label', text: 'Page · which of your accounts they came from' }), channelWrap]),
                h('div', {}, [h('div', { class: 'field-label', text: 'Follow-up' }), picker.node]),
                noteInput,
                h('button', {
                    class: 'form-cta', onclick: () => this.saveForm({
                        handle: handleInput.value, niche: nicheInput.value, note: noteInput.value, status: f.status, channel: f.channel, fu: picker.get()
                    })
                }, editing ? 'Save changes' : 'Add client')
            ]));
        });
    }

    async saveForm(vals) {
        const handle = (vals.handle || '').replace(/^@/, '').trim();
        if (!handle) { this.toast('Handle is required'); return; }
        const fu = vals.fu || { at: null, hasTime: false };
        const followUpAt = fu.at || null;
        const followUpHasTime = !!followUpAt && !!fu.hasTime;
        const channel = channelOf(vals.channel) ? vals.channel : '';

        if (this.state.editingId) {
            const c = this.findClient(this.state.editingId);
            this.patch(c.id, {
                handle, handleKey: handle.toLowerCase(), niche: vals.niche, status: vals.status, channel, note: vals.note, followUpAt, followUpHasTime
            }, { toast: 'Saved' });
            this.openDetail(c.id);
            return;
        }

        // create — await the server for the canonical key, then reload
        try {
            this.closeOverlay();
            this.dom.busy.hidden = false;
            const { firebaseKey } = await this.apiRequest('POST', { data: { handle, niche: vals.niche, status: vals.status, channel, note: vals.note, followUpAt, followUpHasTime } });
            // A brand-new client isn't "actionable" yet, so the default Today filter
            // would hide it. Drop to All and open it so it's never lost after adding.
            this.state.filters = [];
            await this.load();
            this.toast('@' + handle + ' added');
            if (firebaseKey) this.openDetail(firebaseKey);
        } catch (err) {
            this.toast(err.message || 'Could not add client');
        } finally {
            this.dom.busy.hidden = true;
        }
    }

    /* ---- search ---- */
    openSearch() {
        this.state.searchOpen = true;
        this.state.query = '';
        this.dom.overlay.textContent = '';
        const input = h('input', { placeholder: 'Handle, niche or highlight', autofocus: 'true' });
        const results = h('div', { class: 'search-results' });
        const overlay = h('div', { class: 'search-overlay' }, [
            h('div', { class: 'search-top' }, [
                h('div', { class: 'search-field' }, [h('span', { html: ICONS.magnifier }), input]),
                h('button', { class: 'search-cancel', onclick: () => this.closeSearch() }, 'Cancel')
            ]),
            results
        ]);
        input.addEventListener('input', () => { this.state.query = input.value; this.renderSearchResults(results); });
        this.dom.overlay.appendChild(overlay);
        this.renderSearchResults(results);
        // Focus synchronously, still inside the tap handler — iOS only raises the
        // keyboard when focus() happens in the user-gesture call stack. A timeout
        // (even 0ms) breaks that chain and forces a second tap.
        input.focus({ preventScroll: true });
    }

    closeSearch() {
        this.state.searchOpen = false;
        this.state.query = '';
        this.dom.overlay.textContent = '';
    }

    renderSearchResults(container) {
        const q = this.state.query.trim().toLowerCase();
        container.textContent = '';
        if (!q) {
            container.appendChild(h('div', { class: 'search-hint', text: 'Search across handles, niches and highlights.' }));
            return;
        }
        const matches = this.state.clients.filter((c) => !c.archived && (
            c.handleKey.includes(q) ||
            c.niche.toLowerCase().includes(q) ||
            c.note.toLowerCase().includes(q) ||
            c.highlights.some((x) => x.text.toLowerCase().includes(q)) ||
            c.status.toLowerCase() === q
        )).slice(0, 30);

        if (!matches.length) {
            container.appendChild(h('div', { class: 'search-empty' }, [
                h('div', { class: 'title', text: 'No matches' }),
                h('div', { class: 'sub', text: `Nothing found for “${this.state.query}”.` })
            ]));
            return;
        }
        const frag = document.createDocumentFragment();
        for (const c of matches) frag.appendChild(this.renderRow(c, true));
        container.appendChild(frag);
    }

    /* ---- toast ---- */
    toast(text, undo) {
        clearTimeout(this._toastTimer);
        const existing = document.getElementById('crmToast');
        if (existing) existing.remove();
        const wrap = h('div', { class: 'toast-wrap', id: 'crmToast' }, [
            h('div', { class: 'toast' }, [
                h('span', { text }),
                undo ? h('span', { class: 'undo', onclick: () => { wrap.remove(); undo(); } }, 'Undo') : null
            ])
        ]);
        document.body.appendChild(wrap);
        this._toastTimer = setTimeout(() => wrap.remove(), 2800);
    }
}

// wire sort sheet body builder (kept out of openSheet call site for clarity)
const _open = ClientOS.prototype.openSheet;
ClientOS.prototype.openSheet = function (kind, buildBody) {
    if (kind === 'sort' && !buildBody) buildBody = (body) => this.buildSort(body);
    return _open.call(this, kind, buildBody);
};

new ClientOS();
