// ── State ────────────────────────────────────────────────────────────────────
const state = {
    members:      [],
    expenses:     [],
    currentMonth: '',
    editingId:    null,
    pendingImage: null,
    barChart:     null,
    lineChart:    null,
};

const COLORS = [
    '#4361ee','#e63946','#06d6a0','#ffd166',
    '#a8dadc','#f4a261','#9b5de5','#ff9f1c',
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) {
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(n ?? 0);
}

function fmtMonth(ym) {
    const [y, m] = ym.split('-');
    return `Tháng ${parseInt(m)}/${y}`;
}

function color(name) {
    const i = state.members.indexOf(name);
    return COLORS[(i >= 0 ? i : 0) % COLORS.length];
}

function initial(name) {
    return (name || '?')[0].toUpperCase();
}

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function currentYM() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function availableMonths() {
    const set = new Set();
    state.expenses.forEach(e => { if (e.date) set.add(e.date.slice(0, 7)); });
    const now = new Date();
    for (let i = 0; i < 4; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return [...set].sort().reverse();
}

function monthExpenses() {
    return state.expenses.filter(e => e.date?.startsWith(state.currentMonth));
}

// ── API ───────────────────────────────────────────────────────────────────────
async function api(method, url, body) {
    const r = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
}

async function loadData() {
    const d = await api('GET', '/api/data');
    state.members  = d.members  || [];
    state.expenses = d.expenses || [];
}

async function uploadImage(file) {
    const fd = new FormData();
    fd.append('image', file);
    const r = await fetch('/api/upload', { method: 'POST', body: fd });
    return r.json();
}

// ── Render: month select ──────────────────────────────────────────────────────
function renderMonthSelect() {
    const sel = document.getElementById('monthSelect');
    const months = availableMonths();
    if (!months.includes(state.currentMonth)) state.currentMonth = months[0];
    sel.innerHTML = months.map(m =>
        `<option value="${m}" ${m === state.currentMonth ? 'selected' : ''}>${fmtMonth(m)}</option>`
    ).join('');
    document.querySelectorAll('[id$="MonthLabel"]').forEach(el => el.textContent = fmtMonth(state.currentMonth));
}

// ── Render: expense list ──────────────────────────────────────────────────────
function renderExpenses() {
    renderMonthSelect();

    // Rebuild filter dropdown, preserve selection
    const filterSel = document.getElementById('filterPerson');
    const savedFilter = filterSel.value;
    filterSel.innerHTML = '<option value="">Tất cả thành viên</option>' +
        state.members.map(m => `<option value="${m}" ${m === savedFilter ? 'selected' : ''}>${m}</option>`).join('');

    const base = monthExpenses();
    const list = savedFilter ? base.filter(e => e.person === savedFilter) : base;
    const total = list.reduce((s, e) => s + (e.amount || 0), 0);
    const avg   = state.members.length ? total / state.members.length : 0;

    // Summary bar
    document.getElementById('summaryBar').innerHTML = `
        <div class="sum-item"><span class="sum-label">Tổng chi tiêu</span><span class="sum-value">${fmt(total)}</span></div>
        <div class="sum-item"><span class="sum-label">Số hóa đơn</span><span class="sum-value">${list.length}</span></div>
        <div class="sum-item"><span class="sum-label">Bình quân / người</span><span class="sum-value">${state.members.length ? fmt(avg) : '—'}</span></div>
    `;

    const el = document.getElementById('expenseList');
    if (list.length === 0) {
        el.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>Chưa có hóa đơn nào trong tháng này</p></div>`;
        return;
    }

    const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date));
    el.innerHTML = sorted.map(e => `
        <div class="expense-item">
            <div class="avatar" style="background:${color(e.person)}">${initial(e.person)}</div>
            <div class="expense-body">
                <div class="expense-desc">${escape(e.description)}</div>
                <div class="expense-meta">
                    <span style="color:${color(e.person)};font-weight:700">${escape(e.person)}</span>
                    <span>📅 ${e.date}</span>
                </div>
                ${e.memo ? `<div class="expense-memo">📝 ${escape(e.memo)}</div>` : ''}
            </div>
            <div class="expense-right">
                ${e.image ? `<img class="receipt-thumb" src="${e.image}" data-src="${e.image}" alt="receipt">` : ''}
                <span class="expense-amount">${fmt(e.amount)}</span>
                <div class="expense-actions">
                    <button class="btn-icon btn-edit" data-edit="${e.id}" title="Sửa">✏️</button>
                    <button class="btn-icon btn-delete" data-del="${e.id}" title="Xóa">🗑️</button>
                </div>
            </div>
        </div>`).join('');

    el.onclick = async ev => {
        const editId = ev.target.closest('[data-edit]')?.dataset.edit;
        const delId  = ev.target.closest('[data-del]')?.dataset.del;
        const imgSrc = ev.target.closest('[data-src]')?.dataset.src;

        if (editId) { openModal(editId); return; }
        if (imgSrc) { showLightbox(imgSrc); return; }
        if (delId && confirm('Xóa hóa đơn này?')) {
            await api('DELETE', `/api/expenses/${delId}`);
            await loadData();
            renderAll();
        }
    };
}

// ── Render: settlement ────────────────────────────────────────────────────────
function renderSettlement() {
    const el = document.getElementById('settlementContent');

    if (state.members.length === 0) {
        el.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>Chưa có thành viên nào</p></div>`;
        return;
    }

    const list  = monthExpenses();
    const total = list.reduce((s, e) => s + (e.amount || 0), 0);
    const avg   = total / state.members.length;

    const balances = state.members.map(m => {
        const paid = list.filter(e => e.person === m).reduce((s, e) => s + (e.amount || 0), 0);
        return { name: m, paid, diff: paid - avg };
    });

    const maxPaid = Math.max(...balances.map(b => b.paid), 1);

    const overviewHtml = `
        <div class="settlement-section">
            <div class="section-title">Chi tiết từng người</div>
            <p style="font-size:.85rem;color:var(--muted);margin-bottom:14px">
                Tổng: <strong style="color:var(--text)">${fmt(total)}</strong> &nbsp;·&nbsp;
                Bình quân: <strong style="color:var(--primary)">${fmt(avg)}</strong>
            </p>
            ${balances.map(b => {
                const w = Math.round((b.paid / maxPaid) * 100);
                const fc = b.diff >= 0 ? 'var(--success)' : 'var(--danger)';
                const dc = b.diff > 0 ? 'pos' : b.diff < 0 ? 'neg' : 'zero';
                const dt = b.diff > 0 ? `+${fmt(b.diff)}` : fmt(b.diff);
                return `
                <div class="balance-row">
                    <div class="avatar-sm" style="background:${color(b.name)}">${initial(b.name)}</div>
                    <span class="balance-name" title="${escape(b.name)}">${escape(b.name)}</span>
                    <div class="balance-bar-wrap">
                        <div class="balance-bar-bg"><div class="balance-bar-fill" style="width:${w}%;background:${fc}"></div></div>
                    </div>
                    <span class="balance-paid">${fmt(b.paid)}</span>
                    <span class="balance-diff ${dc}">${dt}</span>
                </div>`;
            }).join('')}
        </div>`;

    // Greedy settlement algorithm
    const debtors   = balances.filter(b => b.diff < -0.5).map(b => ({ name: b.name, amount: -b.diff })).sort((a, b) => b.amount - a.amount);
    const creditors = balances.filter(b => b.diff >  0.5).map(b => ({ name: b.name, amount:  b.diff })).sort((a, b) => b.amount - a.amount);

    const d = debtors.map(x => ({ ...x }));
    const c = creditors.map(x => ({ ...x }));
    const txns = [];
    let di = 0, ci = 0;

    while (di < d.length && ci < c.length) {
        const pay = Math.min(d[di].amount, c[ci].amount);
        if (pay >= 1) txns.push({ from: d[di].name, to: c[ci].name, amount: Math.round(pay) });
        d[di].amount -= pay;
        c[ci].amount -= pay;
        if (d[di].amount < 0.5) di++;
        if (c[ci].amount < 0.5) ci++;
    }

    const txnHtml = txns.length === 0
        ? `<div class="all-even">✅ Mọi người đã chi đều nhau!</div>`
        : txns.map(t => `
            <div class="txn-item">
                <div class="avatar-sm" style="background:${color(t.from)}">${initial(t.from)}</div>
                <span class="txn-from">${escape(t.from)}</span>
                <span class="txn-arrow">→</span>
                <div class="avatar-sm" style="background:${color(t.to)}">${initial(t.to)}</div>
                <span class="txn-to">${escape(t.to)}</span>
                <span class="txn-amount">${fmt(t.amount)}</span>
            </div>`).join('');

    el.innerHTML = `
        ${overviewHtml}
        <div class="settlement-section">
            <div class="section-title">Giao dịch thanh toán</div>
            ${txnHtml}
        </div>`;
}

// ── Render: charts ────────────────────────────────────────────────────────────
function renderCharts() {
    const list = monthExpenses();

    // Bar chart: per person
    const personData = state.members.map(m => ({
        name: m,
        total: list.filter(e => e.person === m).reduce((s, e) => s + (e.amount || 0), 0),
        col: color(m),
    }));

    if (state.barChart) state.barChart.destroy();
    state.barChart = new Chart(document.getElementById('barChart'), {
        type: 'bar',
        data: {
            labels: personData.map(p => p.name),
            datasets: [{
                label: 'Chi tiêu',
                data: personData.map(p => p.total),
                backgroundColor: personData.map(p => p.col + 'bb'),
                borderColor:     personData.map(p => p.col),
                borderWidth: 2, borderRadius: 8,
            }],
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                title: { display: true, text: `Chi tiêu theo người — ${fmtMonth(state.currentMonth)}`, font: { size: 13, weight: '700' } },
                tooltip: { callbacks: { label: ctx => fmt(ctx.raw) } },
            },
            scales: { y: { ticks: { callback: v => (v / 1e4).toFixed(0) + '万' } } },
        },
    });

    // Line chart: daily totals
    const daily = {};
    list.forEach(e => { daily[e.date] = (daily[e.date] || 0) + e.amount; });
    const days = Object.keys(daily).sort();

    if (state.lineChart) { state.lineChart.destroy(); state.lineChart = null; }
    if (days.length > 0) {
        state.lineChart = new Chart(document.getElementById('lineChart'), {
            type: 'line',
            data: {
                labels: days.map(d => d.slice(5)),
                datasets: [{
                    label: 'Chi tiêu theo ngày',
                    data: days.map(d => daily[d]),
                    fill: true,
                    borderColor: '#4361ee',
                    backgroundColor: 'rgba(67,97,238,.1)',
                    tension: 0.4,
                    pointBackgroundColor: '#4361ee',
                    pointRadius: 4,
                }],
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: 'Chi tiêu theo ngày', font: { size: 13, weight: '700' } },
                    tooltip: { callbacks: { label: ctx => fmt(ctx.raw) } },
                },
                scales: { y: { ticks: { callback: v => (v / 1e3).toFixed(0) + 'k円' } } },
            },
        });
    } else {
        const ctx = document.getElementById('lineChart').getContext('2d');
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
}

// ── Render: members ───────────────────────────────────────────────────────────
function renderMembers() {
    const el = document.getElementById('memberList');
    if (state.members.length === 0) {
        el.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>Thêm thành viên để bắt đầu!</p></div>`;
        return;
    }
    el.innerHTML = state.members.map(m => {
        const total = state.expenses.filter(e => e.person === m).reduce((s, e) => s + (e.amount || 0), 0);
        const count = state.expenses.filter(e => e.person === m).length;
        return `
        <div class="member-item">
            <div class="avatar-sm" style="background:${color(m)}">${initial(m)}</div>
            <span class="member-name">${escape(m)}</span>
            <span class="member-stat">${count} hóa đơn · ${fmt(total)}</span>
            <button class="btn-icon btn-delete" data-member="${encodeURIComponent(m)}" title="Xóa">🗑️</button>
        </div>`;
    }).join('');

    el.onclick = async ev => {
        const enc = ev.target.closest('[data-member]')?.dataset.member;
        if (!enc) return;
        const name = decodeURIComponent(enc);
        if (confirm(`Xóa thành viên "${name}"?\nHóa đơn của họ vẫn được giữ lại.`)) {
            await api('DELETE', `/api/members/${enc}`);
            await loadData();
            renderAll();
        }
    };
}

// ── Render: history ───────────────────────────────────────────────────────────
async function renderHistory() {
    const el = document.getElementById('historyContent');
    el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px">Đang tải...</p>';

    const [deleted, logs] = await Promise.all([
        fetch('/api/deleted-expenses').then(r => r.json()),
        fetch('/api/audit-log').then(r => r.json()),
    ]);

    const ICON  = { add: '✅', edit: '✏️', delete: '🗑️', restore: '↩️' };
    const LABEL = { add: 'Thêm', edit: 'Sửa', delete: 'Xóa', restore: 'Khôi phục' };

    const deletedHtml = deleted.length === 0
        ? '<p class="history-empty">Không có hóa đơn nào trong thùng rác</p>'
        : deleted.map(e => `
            <div class="history-item deleted-item">
                <div class="history-body">
                    <div class="history-desc">${escape(e.description)}</div>
                    <div class="history-meta">
                        <span style="color:${color(e.person)};font-weight:700">${escape(e.person)}</span>
                        <span>${fmt(e.amount)}</span>
                        <span>📅 ${e.date}</span>
                        <span style="color:var(--danger)">Xóa lúc ${fmtDateTime(e.deletedAt)}</span>
                    </div>
                </div>
                <button class="btn-restore" data-restore="${e.id}">↩ Khôi phục</button>
            </div>`).join('');

    const logsHtml = logs.length === 0
        ? '<p class="history-empty">Chưa có lịch sử</p>'
        : logs.map(log => {
            const snap = log.expenseSnapshot || {};
            const isEdit = log.action === 'edit';
            const desc   = escape(isEdit ? (snap.before?.description || '') : (snap.description || ''));
            const person = isEdit ? snap.before?.person : snap.person;
            const amount = isEdit ? snap.before?.amount : snap.amount;
            return `
                <div class="history-item">
                    <span class="history-icon">${ICON[log.action] || '•'}</span>
                    <div class="history-body">
                        <div class="history-desc"><strong>${LABEL[log.action]}:</strong> ${desc}</div>
                        <div class="history-meta">
                            ${person ? `<span style="color:${color(person)};font-weight:700">${escape(person)}</span>` : ''}
                            ${amount ? `<span>${fmt(amount)}</span>` : ''}
                            <span>${fmtDateTime(log.timestamp)}</span>
                        </div>
                    </div>
                </div>`;
        }).join('');

    el.innerHTML = `
        <div class="settlement-section">
            <div class="section-title">🗑️ Thùng rác (có thể khôi phục)</div>
            ${deletedHtml}
        </div>
        <div class="settlement-section">
            <div class="section-title">📋 Nhật ký thay đổi</div>
            ${logsHtml}
        </div>`;

    el.querySelectorAll('[data-restore]').forEach(btn => {
        btn.addEventListener('click', async () => {
            await fetch(`/api/expenses/${btn.dataset.restore}/restore`, { method: 'PUT' });
            await loadData();
            renderAll();
            renderHistory();
        });
    });
}

// ── renderAll ─────────────────────────────────────────────────────────────────
function renderAll() {
    renderMonthSelect();
    renderExpenses();
    renderSettlement();
    renderMembers();

    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'chart') renderCharts();
}

// ── Modal ──────────────────────────────────────────────────────────────────────
function openModal(id = null) {
    state.editingId  = id;
    state.pendingImage = null;

    // Populate person select
    const fPerson = document.getElementById('fPerson');
    fPerson.innerHTML = state.members.map(m => `<option value="${m}">${m}</option>`).join('');

    if (id) {
        const e = state.expenses.find(x => x.id === id);
        if (!e) return;
        document.getElementById('modalTitle').textContent = 'Sửa hóa đơn';
        if (e.person && !state.members.includes(e.person)) {
            const opt = document.createElement('option');
            opt.value = e.person;
            opt.textContent = `${e.person} (đã xóa)`;
            fPerson.insertBefore(opt, fPerson.firstChild);
        }
        fPerson.value = e.person;
        document.getElementById('fAmount').value = e.amount;
        document.getElementById('fDesc').value   = e.description;
        document.getElementById('fDate').value   = e.date;
        document.getElementById('fMemo').value   = e.memo || '';
        state.pendingImage = e.image || null;
        setUploadPreview(e.image);
    } else {
        document.getElementById('modalTitle').textContent = 'Thêm hóa đơn';
        document.getElementById('expenseForm').reset();
        document.getElementById('fDate').value = todayISO();
        setUploadPreview(null);
    }

    document.getElementById('modal').style.display = 'flex';
    setTimeout(() => document.getElementById('fAmount').focus(), 50);
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
    state.editingId = null;
    state.pendingImage = null;
}

function setUploadPreview(url) {
    const p = document.getElementById('uploadPreview');
    p.innerHTML = url
        ? `<img src="${url}" alt="receipt"><p>Nhấn để đổi ảnh</p>`
        : `<span>📷 Nhấn để tải ảnh hóa đơn</span>`;
}

// ── Lightbox ───────────────────────────────────────────────────────────────────
function showLightbox(src) {
    document.getElementById('lbImg').src = src;
    document.getElementById('lightbox').style.display = 'block';
}

// ── Escape helper ─────────────────────────────────────────────────────────────
function escape(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Events ────────────────────────────────────────────────────────────────────
function setupEvents() {
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
            if (btn.dataset.tab === 'chart') renderCharts();
            if (btn.dataset.tab === 'history') renderHistory();
        });
    });

    // Month select
    document.getElementById('monthSelect').addEventListener('change', e => {
        state.currentMonth = e.target.value;
        renderAll();
    });

    // Filter
    document.getElementById('filterPerson').addEventListener('change', () => renderExpenses());

    // Add expense button
    document.getElementById('addExpenseBtn').addEventListener('click', () => {
        if (state.members.length === 0) {
            alert('Vui lòng thêm thành viên trước!\n\n(Chuyển sang tab 👥 Thành viên để thêm)');
            return;
        }
        openModal();
    });

    // Modal close
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('cancelBtn').addEventListener('click', closeModal);
    document.getElementById('modal').addEventListener('click', e => {
        if (e.target === document.getElementById('modal')) closeModal();
    });

    // Image upload
    document.getElementById('uploadArea').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const r = await uploadImage(file);
            state.pendingImage = r.url;
            setUploadPreview(r.url);
        } catch {
            alert('Tải ảnh thất bại');
        }
    });

    // Form submit
    document.getElementById('expenseForm').addEventListener('submit', async e => {
        e.preventDefault();
        const body = {
            person:      document.getElementById('fPerson').value,
            amount:      parseInt(document.getElementById('fAmount').value, 10),
            description: document.getElementById('fDesc').value.trim(),
            date:        document.getElementById('fDate').value,
            memo:        document.getElementById('fMemo').value.trim(),
            image:       state.pendingImage || null,
        };
        if (state.editingId) {
            await api('PUT', `/api/expenses/${state.editingId}`, body);
        } else {
            await api('POST', '/api/expenses', body);
        }
        closeModal();
        await loadData();
        renderAll();
    });

    // Add member
    document.getElementById('addMemberBtn').addEventListener('click', addMember);
    document.getElementById('newMemberInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') addMember();
    });

    async function addMember() {
        const name = document.getElementById('newMemberInput').value.trim();
        if (!name) return;
        const r = await api('POST', '/api/members', { name });
        if (r.error) { alert('Tên đã tồn tại hoặc không hợp lệ'); return; }
        document.getElementById('newMemberInput').value = '';
        await loadData();
        renderAll();
    }

    // Lightbox close
    document.getElementById('lbOverlay').addEventListener('click', () => {
        document.getElementById('lightbox').style.display = 'none';
    });
    document.getElementById('lbImg').addEventListener('click', () => {
        document.getElementById('lightbox').style.display = 'none';
    });
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
    await loadData();
    state.currentMonth = currentYM();
    setupEvents();
    renderAll();
})();
