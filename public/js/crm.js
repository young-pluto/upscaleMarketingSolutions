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

const SORTS = [
    ['priority', 'Priority'],
    ['longest', 'Longest since contact'],
    ['recent', 'Recently contacted'],
    ['followup', 'Follow-up date'],
    ['alpha', 'A–Z']
];

const CHIPS = [
    ['today', 'Today'],
    ['needsReply', 'Needs reply'],
    ['overdue', 'Overdue'],
    ['due', 'Due today'],
    ...STATUSES.map((s) => [s, s])
];

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
    magnifier: '<svg width="13" height="13" viewBox="0 0 14 14"><circle cx="6" cy="6" r="4.6" stroke="currentColor" stroke-width="1.5" fill="none" class="icon-t3"/><path d="M9.6 9.6L13 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" class="icon-t3"/></svg>'
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
        niche: c.niche || '',
        status: STATUSES.includes(c.status) ? c.status : 'Lead',
        note: c.note || '',
        needsReply: !!c.needsReply,
        archived: !!c.archived,
        followUpAt: c.followUpAt || null,
        lastContactedAt: c.lastContactedAt || null,
        highlights: toArray(c.highlights).map((x) => ({ text: x.text || '', pinned: !!x.pinned })).filter((x) => x.text),
        history: toArray(c.history).map((e) => ({ at: e.at || 0, text: e.text || '' })).filter((e) => e.text),
        createdAt: c.createdAt || 0
    };
}

function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

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
function isActionable(c) { return c.needsReply || isOverdue(c) || isDueToday(c) || isCold(c); }

function statusPillStyle(status, big) {
    const v = `var(--st-${status})`;
    return `color:${v};background:color-mix(in srgb, ${v} 13%, transparent)` + (big ? '' : '');
}

function dateLabel(ms) {
    const d = new Date(ms);
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/* ================================================================ app == */
class ClientOS {
    constructor() {
        this.currentUser = null;
        this.state = {
            clients: [],
            // Today is the default action queue: overdue/due follow-ups, reply
            // flags and clients that have never been contacted or gone cold.
            filters: ['today'],
            sort: readPreference('crm-sort', 'priority'),
            sheet: null,           // detail | sort | form | remind
            detailId: null,
            statusPickerOpen: false,
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
            const { clients } = await this.apiRequest('GET');
            this.state.clients = (clients || []).map(normalizeClient);
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
        const rows = this.visibleClients();   // filter+sort once, share with count + list
        this.renderCount(rows);
        this.renderChips();
        this.renderList(rows);
    }

    visibleClients() {
        const s = this.state;
        const statusF = s.filters.filter((f) => STATUSES.includes(f));
        const metaF = s.filters.filter((f) => ['today', 'needsReply', 'overdue', 'due'].includes(f));

        let list = s.clients.filter((c) => {
            if (c.archived) return false;
            if (statusF.length && !statusF.includes(c.status)) return false;
            if (metaF.includes('today') && !isActionable(c)) return false;
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
        const total = this.state.clients.filter((c) => !c.archived).length;
        this.dom.count.textContent = this.state.filters.length ? `${rows.length} of ${total}` : `${total} clients`;
    }

    renderChips() {
        const s = this.state;
        const row = this.dom.chipRow;
        row.textContent = '';
        row.appendChild(h('button', {
            class: 'chip' + (s.filters.length === 0 ? ' active' : ''),
            onclick: () => { s.filters = []; this.render(); }
        }, 'All'));
        for (const [id, label] of CHIPS) {
            row.appendChild(h('button', {
                class: 'chip' + (s.filters.includes(id) ? ' active' : ''),
                onclick: () => {
                    s.filters = s.filters.includes(id) ? s.filters.filter((x) => x !== id) : [...s.filters, id];
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

    renderRow(c, compact) {
        const { pills, hidden } = this.rowPills(c);
        const l1 = h('div', { class: 'row-l1' }, [
            c.needsReply ? h('span', { class: 'dot' }) : null,
            h('span', { class: 'row-handle', text: '@' + c.handle }),
            h('span', { class: 'row-niche', text: c.niche }),
            h('span', { class: 'row-time', text: ago(c.lastContactedAt) }),
            h('span', { html: ICONS.chevron })
        ]);
        const l2children = [this.statusPill(c.status), ...pills];
        if (hidden > 0) l2children.push(h('span', { class: 'row-more', text: '+' + hidden }));
        const l2 = h('div', { class: 'row-l2' }, l2children);

        return h('div', {
            class: compact ? 'search-row' : 'row',
            onclick: () => this.openDetail(c.id)
        }, [h('div', { class: compact ? 'search-row-inner' : 'row-inner' }, compact ? [
            c.needsReply ? h('span', { class: 'dot' }) : null,
            h('span', { class: 'row-handle', text: '@' + c.handle }),
            h('span', { class: 'row-niche', text: c.niche }),
            this.statusPill(c.status)
        ] : [l1, l2])]);
    }

    renderList(rows = this.visibleClients()) {
        const list = this.dom.list;
        list.textContent = '';
        if (rows.length === 0) {
            list.appendChild(h('div', { class: 'empty' }, [
                h('div', { class: 'title', text: this.state.clients.some((c) => !c.archived) ? 'No clients match' : 'No clients yet' }),
                h('div', { class: 'sub', text: this.state.clients.some((c) => !c.archived)
                    ? 'Nothing fits the current filters. Clear them, or add a client with +.'
                    : 'Add your first client with the + button below.' }),
                this.state.filters.length ? h('button', { class: 'clear', onclick: () => { this.state.filters = []; this.render(); } }, 'Clear filters') : null
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

        // identity + needs-reply toggle
        body.appendChild(h('div', { class: 'd-identity' }, [
            h('span', { class: 'd-handle', text: '@' + c.handle }),
            c.needsReply
                ? h('button', { class: 'd-needsreply', style: 'border:none;cursor:pointer;font-family:inherit', onclick: () => this.patch(c.id, { needsReply: false }, { toast: 'Reply flag cleared' }) }, 'Needs reply ✕')
                : h('button', { class: 'hi-add', onclick: () => this.patch(c.id, { needsReply: true }, { toast: 'Flagged — needs reply' }) }, '+ Flag reply')
        ]));
        if (c.niche) body.appendChild(h('div', { class: 'd-niche', text: c.niche }));

        // status + meta
        const statusBtn = h('button', {
            class: 'pill status big status-pick-btn',
            style: statusPillStyle(c.status),
            onclick: () => { this.state.statusPickerOpen = !this.state.statusPickerOpen; this.refreshDetail(); }
        }, [h('span', { text: c.status }), h('span', { html: ICONS.caret })]);
        const metaText = `Last contacted ${ago(c.lastContactedAt)} · Added ${c.createdAt ? dateLabel(c.createdAt) : '—'}`;
        body.appendChild(h('div', { class: 'd-status-row' }, [statusBtn, h('span', { class: 'd-meta', text: metaText })]));

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

        // quick actions
        const qa = (icon, label, cls, onclick) => h('button', { class: 'qa' + (cls ? ' ' + cls : ''), onclick }, [
            h('span', { html: icon }), h('span', { text: label })
        ]);
        body.appendChild(h('div', { class: 'qa-grid' }, [
            qa(ICONS.dm, 'Open DM', 'primary', () => { window.open('https://ig.me/m/' + encodeURIComponent(c.handle), '_blank', 'noopener'); this.toast('Opening @' + c.handle); }),
            qa(ICONS.check, 'Contacted', null, () => this.patch(c.id, { lastContactedAt: Date.now(), needsReply: false, history: this.withHistory(c, 'Marked contacted') }, { toast: 'Marked contacted' })),
            qa(ICONS.bell, 'Remind', null, () => this.openReminder()),
            qa(ICONS.pencil, 'Edit', null, () => this.openForm(c.id)),
            qa(ICONS.archive, 'Archive', null, () => this.archive(c))
        ]));

        // follow-up row
        const n = fuDays(c.followUpAt);
        const fuColor = n != null && n < 0 ? 'var(--red)' : (n === 0 ? 'var(--orange)' : 'var(--t1)');
        body.appendChild(h('div', { class: 'followup-row', onclick: () => this.openReminder() }, [
            h('span', { class: 'label', text: 'Follow-up' }),
            h('span', { class: 'value', style: 'color:' + fuColor, text: fuLabel(c.followUpAt) })
        ]));

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
            toast: 'Archived @' + c.handle,
            undo: () => this.patch(c.id, { archived: false })
        });
    }

    /* ---- reminder ---- */
    openReminder() {
        const c = this.findClient(this.state.detailId);
        if (!c) return;
        this.openSheet('detail', (body) => {
            body.appendChild(h('div', { class: 'form-title', text: 'Follow up with @' + c.handle }));
            const opts = [
                [0, 'Today'], [1, 'Tomorrow'], [3, 'In 3 days'], [7, 'Next week']
            ];
            const container = h('div', {}, opts.map(([days, label]) => {
                const ts = startOfToday() + days * DAY;
                return h('div', {
                    class: 'remind-row', onclick: () => {
                        this.patch(c.id, { followUpAt: ts, history: this.withHistory(c, 'Follow-up set · ' + label.toLowerCase()) }, { toast: 'Follow-up · ' + label.toLowerCase() });
                        this.openDetail(c.id);
                    }
                }, [h('span', { class: 'label', text: label }), h('span', { class: 'sub', text: dateLabel(ts) })]);
            }));
            container.appendChild(h('div', {
                class: 'remind-row danger', onclick: () => {
                    this.patch(c.id, { followUpAt: null }, { toast: 'Follow-up cleared' });
                    this.openDetail(c.id);
                }
            }, [h('span', { class: 'label', text: 'Clear follow-up' })]));
            body.appendChild(container);
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
            ? { handle: '@' + c.handle, niche: c.niche, status: c.status, note: c.note, fu: fuDays(c.followUpAt) }
            : { handle: '', niche: '', status: 'Lead', note: '', fu: null };

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
                    class: 'pill status big', style: statusPillStyle(st) + (f.status === st ? `;outline:1.5px solid var(--st-${st})` : ';opacity:.6'),
                    onclick: () => { f.status = st; renderStatus(); }
                }, st)));
            };
            renderStatus();

            const fuWrap = h('div', { class: 'pill-wrap' });
            const fuOpts = [[null, 'None'], [0, 'Today'], [1, 'Tomorrow'], [3, 'In 3 days'], [7, 'Next week']];
            const renderFu = () => {
                fuWrap.textContent = '';
                fuOpts.forEach(([v, label]) => fuWrap.appendChild(h('button', {
                    class: 'fu-chip' + (f.fu === v ? ' on' : ''), onclick: () => { f.fu = v; renderFu(); }
                }, label)));
            };
            renderFu();

            body.appendChild(h('div', { class: 'form-fields' }, [
                handleInput,
                nicheInput,
                h('div', {}, [h('div', { class: 'field-label', text: 'Status' }), statusWrap]),
                h('div', {}, [h('div', { class: 'field-label', text: 'Follow-up' }), fuWrap]),
                noteInput,
                h('button', {
                    class: 'form-cta', onclick: () => this.saveForm({
                        handle: handleInput.value, niche: nicheInput.value, note: noteInput.value, status: f.status, fu: f.fu
                    })
                }, editing ? 'Save changes' : 'Add client')
            ]));
        });
    }

    async saveForm(vals) {
        const handle = (vals.handle || '').replace(/^@/, '').trim();
        if (!handle) { this.toast('Handle is required'); return; }
        const followUpAt = vals.fu == null ? null : startOfToday() + vals.fu * DAY;

        if (this.state.editingId) {
            const c = this.findClient(this.state.editingId);
            this.patch(c.id, {
                handle, handleKey: handle.toLowerCase(), niche: vals.niche, status: vals.status, note: vals.note, followUpAt
            }, { toast: 'Saved' });
            this.openDetail(c.id);
            return;
        }

        // create — await the server for the canonical key, then reload
        try {
            this.closeOverlay();
            this.dom.busy.hidden = false;
            const { firebaseKey } = await this.apiRequest('POST', { data: { handle, niche: vals.niche, status: vals.status, note: vals.note, followUpAt } });
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
        setTimeout(() => input.focus(), 30);
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
