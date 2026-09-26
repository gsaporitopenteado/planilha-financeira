const STORAGE_KEY = 'planilha-financeira-v1';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {
    expenses: [],
    income: [],
    investments: [],
    benefit: { saldoRefeicao: 0, saldoLivre: 0, transactions: [] },
  };
}

const state = loadState();
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

const fmt = (value, currency) =>
  (value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency, signDisplay: 'never' });
const fmtSigned = (value, currency) =>
  (value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency, signDisplay: 'exceptZero' });

const todayStr = () => new Date().toISOString().slice(0, 10);
const sumBy = (arr, pred) => arr.filter(pred).reduce((s, x) => s + x.amount, 0);

function endOfPreviousMonth(ref = new Date()) {
  const d = new Date(ref.getFullYear(), ref.getMonth(), 1);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Each investment is a "holding" (onde + moeda) with a history of value updates.
// A holding's value at a date is its most recent update on or before that date.
function holdingValueAt(holding, asOfDate) {
  const entries = holding.entries.filter(e => e.date <= asOfDate).sort(byDateDesc);
  return entries.length ? entries[0].amount : 0;
}
function investTotals(asOfDate) {
  return state.investments.reduce((acc, h) => {
    const v = holdingValueAt(h, asOfDate);
    if (h.currency === 'BRL') acc.brl += v;
    else if (h.currency === 'EUR') acc.eur += v;
    return acc;
  }, { brl: 0, eur: 0 });
}

function computeTotals(asOfDate) {
  const inc = sumBy(state.income, e => e.date <= asOfDate);
  const exp = sumBy(state.expenses, e => e.date <= asOfDate);
  const { brl: investBRL, eur: investEUR } = investTotals(asOfDate);
  const generalBRL = inc - exp;
  return { generalBRL, investBRL, investEUR, totalBRL: generalBRL + investBRL, totalEUR: investEUR };
}

// ---- Month cursors (Gastos / Recebido share the pattern) ----
const monthCursor = {
  gastos: new Date(),
  recebido: new Date(),
};
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = d => d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const inMonth = (dateStr, d) => dateStr.slice(0, 7) === monthKey(d);

// ---- Tabs ----
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    document.getElementById(`view-${btn.dataset.tab}`).classList.add('active');
  });
});

// ---- Row rendering helpers ----
function renderRows(tbody, rows, cellsFn, onDelete) {
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = `<tr class="row-empty"><td colspan="10">Nada por aqui ainda.</td></tr>`;
    return;
  }
  rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = cellsFn(row);
    const del = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'row-delete';
    btn.textContent = '×';
    btn.title = 'Remover';
    btn.addEventListener('click', () => onDelete(row.id));
    del.appendChild(btn);
    tr.appendChild(del);
    tbody.appendChild(tr);
  });
}

const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

// ---- Resumo ----
function renderResumo() {
  const current = computeTotals(todayStr());
  const prev = computeTotals(endOfPreviousMonth());
  document.getElementById('total-brl').textContent = fmt(current.totalBRL, 'BRL');
  document.getElementById('total-eur').textContent = fmt(current.totalEUR, 'EUR');

  const deltaBRL = current.totalBRL - prev.totalBRL;
  const deltaEUR = current.totalEUR - prev.totalEUR;
  const setDelta = (el, delta, currency) => {
    el.textContent = `${fmtSigned(delta, currency)} vs. mês anterior`;
    el.classList.toggle('up', delta >= 0);
    el.classList.toggle('down', delta < 0);
  };
  setDelta(document.getElementById('delta-brl'), deltaBRL, 'BRL');
  setDelta(document.getElementById('delta-eur'), deltaEUR, 'EUR');

  document.getElementById('bd-conta').textContent = fmt(current.generalBRL, 'BRL');
  document.getElementById('bd-invest-brl').textContent = fmt(current.investBRL, 'BRL');
  document.getElementById('bd-invest-eur').textContent = fmt(current.investEUR, 'EUR');
}

// ---- Gastos ----
function renderDonut(container, received, spent) {
  const total = received + spent;
  const pct = total > 0 ? (received / total) * 100 : 0;
  container.innerHTML = `
    <div class="donut-wrap">
      <svg width="160" height="160" viewBox="0 0 42 42">
        <circle cx="21" cy="21" r="15.9" fill="transparent" stroke="rgba(255,255,255,0.1)" stroke-width="6"></circle>
        <circle cx="21" cy="21" r="15.9" fill="transparent" stroke="var(--red)" stroke-width="6"
          stroke-dasharray="100 100" stroke-dashoffset="25" transform="rotate(-90 21 21)"></circle>
        <circle cx="21" cy="21" r="15.9" fill="transparent" stroke="var(--green)" stroke-width="6"
          stroke-dasharray="${pct} ${100 - pct}" stroke-dashoffset="25" transform="rotate(-90 21 21)"></circle>
      </svg>
      <div class="donut-legend">
        <span><i class="dot" style="background:var(--green)"></i>Recebido ${fmt(received, 'BRL')}</span>
        <span><i class="dot" style="background:var(--red)"></i>Gasto ${fmt(spent, 'BRL')}</span>
      </div>
    </div>`;
}

function renderGastos() {
  const cursor = monthCursor.gastos;
  document.getElementById('gastos-month-label').textContent = monthLabel(cursor);

  const monthExpenses = state.expenses.filter(e => inMonth(e.date, cursor)).sort(byDateDesc);
  const monthIncome = state.income.filter(e => inMonth(e.date, cursor));
  const spent = sumBy(monthExpenses, () => true);
  const received = sumBy(monthIncome, () => true);

  renderDonut(document.getElementById('gastos-donut'), received, spent);

  renderRows(
    document.getElementById('gastos-table'),
    monthExpenses,
    e => `<td>${e.date.split('-').reverse().join('/')}</td><td>${e.description}</td><td class="amount negative">-${fmt(e.amount, 'BRL')}</td>`,
    id => { state.expenses = state.expenses.filter(e => e.id !== id); save(); renderAll(); }
  );
}

// ---- Recebido ----
function renderRecebido() {
  const cursor = monthCursor.recebido;
  document.getElementById('recebido-month-label').textContent = monthLabel(cursor);

  const monthIncome = state.income.filter(e => inMonth(e.date, cursor)).sort(byDateDesc);
  const total = sumBy(monthIncome, () => true);
  document.getElementById('recebido-total').textContent = fmt(total, 'BRL');

  renderRows(
    document.getElementById('recebido-table'),
    monthIncome,
    e => `<td>${e.date.split('-').reverse().join('/')}</td><td>${e.description}</td><td class="amount positive">+${fmt(e.amount, 'BRL')}</td>`,
    id => { state.income = state.income.filter(e => e.id !== id); save(); renderAll(); }
  );
}

// ---- Investimentos ----
function renderInvestimentos() {
  const totals = investTotals(todayStr());
  document.getElementById('invest-total-brl').textContent = fmt(totals.brl, 'BRL');
  document.getElementById('invest-total-eur').textContent = fmt(totals.eur, 'EUR');

  const tbody = document.getElementById('investimentos-table');
  tbody.innerHTML = '';
  if (!state.investments.length) {
    tbody.innerHTML = `<tr class="row-empty"><td colspan="6">Nada por aqui ainda.</td></tr>`;
  } else {
    state.investments.forEach(h => {
      const latest = [...h.entries].sort(byDateDesc)[0];
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${h.where}</td><td>${h.currency}</td><td class="amount positive">${fmt(latest.amount, h.currency)}</td><td>${latest.date.split('-').reverse().join('/')}</td>`;

      const updateTd = document.createElement('td');
      const updateBtn = document.createElement('button');
      updateBtn.className = 'btn-ghost btn-small';
      updateBtn.textContent = 'Atualizar';
      updateBtn.addEventListener('click', () => openUpdateInvestmentModal(h.id));
      updateTd.appendChild(updateBtn);
      tr.appendChild(updateTd);

      const delTd = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.className = 'row-delete';
      delBtn.textContent = '×';
      delBtn.title = 'Remover';
      delBtn.addEventListener('click', () => {
        state.investments = state.investments.filter(x => x.id !== h.id);
        save(); renderAll();
      });
      delTd.appendChild(delBtn);
      tr.appendChild(delTd);

      tbody.appendChild(tr);
    });
  }

  renderInvestChart();
}

function lineChartSVG(currency) {
  const holdings = state.investments.filter(h => h.currency === currency);
  const dates = [...new Set(holdings.flatMap(h => h.entries.map(e => e.date)))].sort();
  const points = dates.map(date => ({
    date,
    total: holdings.reduce((s, h) => s + holdingValueAt(h, date), 0),
  }));

  const values = points.map(p => p.total);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const w = 560, h = 150, pad = 20;
  const x = i => points.length > 1 ? pad + (i * (w - pad * 2)) / (points.length - 1) : w / 2;
  const y = v => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ');
  const color = currency === 'BRL' ? 'var(--primary)' : 'var(--green)';
  const dots = points.map((p, i) => `
    <circle cx="${x(i).toFixed(1)}" cy="${y(p.total).toFixed(1)}" r="4" fill="${color}">
      <title>${p.date.split('-').reverse().join('/')} · ${fmt(p.total, currency)}</title>
    </circle>`).join('');

  return `
    <div class="line-chart">
      <div class="line-chart-head">
        <span><i class="dot" style="background:${color}"></i>${currency === 'BRL' ? 'Real (R$)' : 'Euro (€)'}</span>
        <strong>${fmt(values[values.length - 1], currency)}</strong>
      </div>
      <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
        <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}
      </svg>
    </div>`;
}

function renderInvestChart() {
  const container = document.getElementById('invest-chart');
  const currencies = ['BRL', 'EUR'].filter(c => state.investments.some(h => h.currency === c));
  container.innerHTML = currencies.length
    ? currencies.map(lineChartSVG).join('')
    : `<p class="chart-empty">Adicione um investimento para ver a evolução.</p>`;
}

function openUpdateInvestmentModal(holdingId) {
  const h = state.investments.find(x => x.id === holdingId);
  if (!h) return;
  openModal(`Atualizar · ${h.where}`, `${dateField('date')}${amountField('amount', `Novo valor (${h.currency})`)}`, fd => {
    h.entries.push({ id: uid(), date: fd.get('date'), amount: parseFloat(fd.get('amount')) });
    save();
  });
}

// ---- Cartão Benefício ----
function wireEditableBalance(id, key, label) {
  document.getElementById(id).addEventListener('click', () => {
    openModal(`Ajustar saldo · ${label}`, `
      <div class="field"><label for="f-balance">Novo saldo (R$)</label>
        <input type="number" id="f-balance" name="balance" step="0.01" value="${state.benefit[key].toFixed(2)}" required autofocus></div>
    `, fd => { state.benefit[key] = parseFloat(fd.get('balance')); save(); });
  });
}
wireEditableBalance('saldo-refeicao', 'saldoRefeicao', 'Vale Refeição');
wireEditableBalance('saldo-livre', 'saldoLivre', 'Vale Livre');

function renderCartao() {
  document.getElementById('saldo-refeicao').textContent = fmt(state.benefit.saldoRefeicao, 'BRL');
  document.getElementById('saldo-livre').textContent = fmt(state.benefit.saldoLivre, 'BRL');

  const rows = [...state.benefit.transactions].sort(byDateDesc);
  renderRows(
    document.getElementById('cartao-table'),
    rows,
    t => `<td>${t.date.split('-').reverse().join('/')}</td><td>${t.description}</td><td>${t.wallet === 'refeicao' ? 'Vale Refeição' : 'Vale Livre'}</td><td>${t.kind === 'gasto' ? 'Gasto' : 'Compra'}</td><td class="amount negative">-${fmt(t.amount, 'BRL')}</td>`,
    id => {
      const t = state.benefit.transactions.find(x => x.id === id);
      if (!t) return;
      // reverse the effect
      if (t.wallet === 'refeicao') state.benefit.saldoRefeicao += t.amount;
      else state.benefit.saldoLivre += t.amount;
      if (t.kind === 'compra') state.income = state.income.filter(i => i.linkedBenefitId !== id);
      state.benefit.transactions = state.benefit.transactions.filter(x => x.id !== id);
      save(); renderAll();
    }
  );
}

function renderAll() {
  renderResumo();
  renderGastos();
  renderRecebido();
  renderInvestimentos();
  renderCartao();
}

// ---- Month nav wiring ----
function wireMonthNav(prefix) {
  document.getElementById(`${prefix}-prev`).addEventListener('click', () => {
    const c = monthCursor[prefix];
    monthCursor[prefix] = new Date(c.getFullYear(), c.getMonth() - 1, 1);
    renderAll();
  });
  document.getElementById(`${prefix}-next`).addEventListener('click', () => {
    const c = monthCursor[prefix];
    monthCursor[prefix] = new Date(c.getFullYear(), c.getMonth() + 1, 1);
    renderAll();
  });
}
wireMonthNav('gastos');
wireMonthNav('recebido');

// ---- Modal system ----
const overlay = document.getElementById('modal-overlay');
const form = document.getElementById('modal-form');
const fieldsEl = document.getElementById('modal-fields');
const titleEl = document.getElementById('modal-title');
let onSubmit = null;

function openModal(title, fieldsHTML, submitHandler) {
  titleEl.textContent = title;
  fieldsEl.innerHTML = fieldsHTML;
  onSubmit = submitHandler;
  overlay.classList.add('open');
  const first = fieldsEl.querySelector('input, select');
  if (first) first.focus();
}
function closeModal() {
  overlay.classList.remove('open');
  form.reset();
  onSubmit = null;
}
document.getElementById('modal-cancel').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
form.addEventListener('submit', e => {
  e.preventDefault();
  if (onSubmit) onSubmit(new FormData(form));
  closeModal();
  renderAll();
});

const dateField = (name, label = 'Data') => `
  <div class="field"><label for="f-${name}">${label}</label>
    <input type="date" id="f-${name}" name="${name}" value="${todayStr()}" required></div>`;
const amountField = (name, label = 'Valor') => `
  <div class="field"><label for="f-${name}">${label}</label>
    <input type="number" id="f-${name}" name="${name}" step="0.01" min="0.01" placeholder="0,00" required></div>`;
const textField = (name, label = 'Descrição') => `
  <div class="field"><label for="f-${name}">${label}</label>
    <input type="text" id="f-${name}" name="${name}" required></div>`;

document.getElementById('btn-add-gasto').addEventListener('click', () => {
  openModal('Novo gasto', `${dateField('date')}${amountField('amount')}${textField('description')}`, fd => {
    state.expenses.push({ id: uid(), date: fd.get('date'), amount: parseFloat(fd.get('amount')), description: fd.get('description') });
    save();
  });
});

document.getElementById('btn-add-recebido').addEventListener('click', () => {
  openModal('Novo recebimento', `${dateField('date')}${amountField('amount')}${textField('description')}`, fd => {
    state.income.push({ id: uid(), date: fd.get('date'), amount: parseFloat(fd.get('amount')), description: fd.get('description') });
    save();
  });
});

document.getElementById('btn-add-investimento').addEventListener('click', () => {
  openModal('Novo investimento', `
    ${dateField('date')}
    <div class="field-row">${amountField('amount')}
      <div class="field"><label for="f-currency">Moeda</label>
        <select id="f-currency" name="currency"><option value="BRL">R$ (Real)</option><option value="EUR">€ (Euro)</option></select></div>
    </div>
    ${textField('where', 'Onde')}
  `, fd => {
    state.investments.push({
      id: uid(),
      where: fd.get('where'),
      currency: fd.get('currency'),
      entries: [{ id: uid(), date: fd.get('date'), amount: parseFloat(fd.get('amount')) }],
    });
    save();
  });
});

document.getElementById('btn-add-cartao').addEventListener('click', () => {
  openModal('Nova movimentação do cartão', `
    ${dateField('date')}
    ${amountField('amount')}
    ${textField('description')}
    <div class="field-row">
      <div class="field"><label for="f-wallet">Carteira</label>
        <select id="f-wallet" name="wallet"><option value="refeicao">Vale Refeição</option><option value="livre">Vale Livre</option></select></div>
      <div class="field"><label for="f-kind">Tipo</label>
        <select id="f-kind" name="kind">
          <option value="gasto">Gasto (usa o saldo do cartão)</option>
          <option value="compra">Compra (converte em saldo geral)</option>
        </select></div>
    </div>
  `, fd => {
    const amount = parseFloat(fd.get('amount'));
    const wallet = fd.get('wallet');
    const kind = fd.get('kind');
    const id = uid();
    if (wallet === 'refeicao') state.benefit.saldoRefeicao -= amount;
    else state.benefit.saldoLivre -= amount;
    state.benefit.transactions.push({ id, date: fd.get('date'), amount, description: fd.get('description'), wallet, kind });
    if (kind === 'compra') {
      state.income.push({ id: uid(), date: fd.get('date'), amount, description: `Cartão benefício: ${fd.get('description')}`, linkedBenefitId: id });
    }
    save();
  });
});

renderAll();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js'));
}
