const $ = s => document.querySelector(s);
const TITLES = { orders: 'Заказы', raw: 'Сырьё', products: 'Ассортимент', points: 'Точки', finance: 'Финансы', settings: 'Настройки' };
const state = { raw: [], products: [], recipes: [], points: [], orders: [], purchases: [], expenses: [] };

function cfg() {
  return { url: localStorage.getItem('api_url') || '', key: localStorage.getItem('api_key') || '' };
}

// Все запросы к таблице идут через эту функцию
async function api(action, payload = {}) {
  const { url, key } = cfg();
  if (!url || !key) throw new Error('Введите адрес и ключ в настройках.');
  // text/plain, чтобы браузер не делал предварительный запрос (Apps Script его не поддерживает)
  const res = await fetch(url, { method: 'POST', body: JSON.stringify({ key, action, ...payload }) });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error === 'unauthorized' ? 'Неверный ключ доступа.' : (data.error || 'Ошибка запроса.'));
  return data;
}

const num = v => parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
const fmt = n => (Math.round(n * 1000) / 1000).toLocaleString('ru-RU');
const today = () => new Date().toLocaleDateString('sv-SE');

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => (k === 'class' ? (el.className = v) : el.setAttribute(k, v)));
  kids.forEach(k => el.append(k));
  return el;
}

function setStatus(sel, text, kind) {
  const el = $(sel);
  el.textContent = text;
  el.className = kind || '';
}

function show(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $('#title').textContent = TITLES[name];
  localStorage.setItem('last_view', name);
  if (name === 'raw') loadRaw();
  if (name === 'products') loadProducts();
  if (name === 'points') loadPoints();
  if (name === 'orders') loadOrders();
  if (name === 'finance') loadFinance();
}

// ---------- Сырьё ----------

async function loadRaw() {
  try {
    state.raw = (await api('list', { sheet: 'Сырьё' })).rows;
  } catch (e) {
    $('#raw-list').replaceChildren(h('p', { class: 'bad' }, e.message));
    return;
  }
  renderRaw();
}

function renderRaw() {
  const box = $('#raw-list');
  if (!state.raw.length) {
    box.replaceChildren(h('p', { class: 'stub' }, 'Сырья пока нет. Добавьте первое ниже.'));
  } else {
    box.replaceChildren(...state.raw.map(r => {
      const bal = Number(r['Остаток']) || 0;
      const min = Number(r['Мин. остаток']) || 0;
      const low = min > 0 && bal <= min;
      return h('div', { class: 'item' + (low ? ' low' : '') },
        h('div', {}, h('b', {}, r['Название']), h('span', { class: 'sub' }, `Цена: ${fmt(Number(r['Цена за ед.']) || 0)} за ${r['Ед.']}`)),
        h('div', { class: 'qty' }, `${fmt(bal)} ${r['Ед.']}`, low ? h('span', { class: 'sub' }, 'Пора докупать') : ''));
    }));
  }
  document.querySelectorAll('#p-lines .pl-raw').forEach(sel => {
    const v = sel.value;
    sel.replaceChildren(...rawOptions());
    if (v) sel.value = v;
  });
  if (!document.querySelector('#p-lines .pline') && state.raw.length) addPLine();
}

async function addRaw() {
  const name = $('#n-name').value.trim();
  if (!name) return setStatus('#raw-status', 'Введите название.', 'bad');
  const min = num($('#n-min').value) || 0;
  try {
    await api('add', { sheet: 'Сырьё', row: { 'Название': name, 'Ед.': $('#n-unit').value, 'Остаток': 0, 'Мин. остаток': min, 'Цена за ед.': 0 } });
    $('#n-name').value = ''; $('#n-min').value = '';
    setStatus('#raw-status', `Добавлено: ${name}.`, 'ok');
    loadRaw();
  } catch (e) { setStatus('#raw-status', e.message, 'bad'); }
}

const rawOptions = () => state.raw.map(r => h('option', { value: r['ID'] }, `${r['Название']} (${r['Ед.']})`));

function addPLine() {
  const sel = h('select', { class: 'pl-raw' }, ...rawOptions());
  const q = h('input', { class: 'pl-qty', type: 'text', inputmode: 'decimal', placeholder: 'Количество', autocomplete: 'off' });
  const pr = h('input', { class: 'pl-price', type: 'text', inputmode: 'decimal', placeholder: 'Цена за ед.', autocomplete: 'off' });
  const del = h('button', { type: 'button', class: 'ghost', 'aria-label': 'Убрать' }, '×');
  const sum = h('span', { class: 'pl-sum sub' });
  const row = h('div', { class: 'pline' }, sel, q, pr, del, sum);
  del.addEventListener('click', () => { row.remove(); updateTotal(); });
  [q, pr].forEach(i => i.addEventListener('input', updateTotal));
  $('#p-lines').append(row);
}

function updateTotal() {
  let total = 0;
  document.querySelectorAll('#p-lines .pline').forEach(r => {
    const s = num(r.querySelector('.pl-qty').value) * num(r.querySelector('.pl-price').value);
    r.querySelector('.pl-sum').textContent = s > 0 ? `Сумма: ${fmt(s)}` : '';
    if (s > 0) total += s;
  });
  $('#p-total').textContent = fmt(total);
}

async function addPurchase() {
  const lines = [...document.querySelectorAll('#p-lines .pline')].map(r => ({
    rawId: r.querySelector('.pl-raw').value,
    qty: num(r.querySelector('.pl-qty').value),
    price: num(r.querySelector('.pl-price').value)
  }));
  if (!lines.length) return setStatus('#raw-status', 'Сначала добавьте сырьё, затем товары в закупку.', 'bad');
  if (lines.some(l => !l.rawId || !(l.qty > 0) || !(l.price >= 0))) return setStatus('#raw-status', 'Заполните количество и цену в каждой строке.', 'bad');
  const btn = $('#btn-purchase');
  btn.disabled = true;
  setStatus('#raw-status', 'Записываю…');
  try {
    const { row } = await api('purchaseMany', { date: $('#p-date').value || today(), supplier: $('#p-supplier').value.trim(), lines });
    $('#p-lines').replaceChildren();
    $('#p-supplier').value = '';
    updateTotal();
    setStatus('#raw-status', `Закупка записана: позиций ${row.count}, на сумму ${fmt(row.total)}.`, 'ok');
    loadRaw();
  } catch (e) {
    setStatus('#raw-status', e.message, 'bad');
  } finally {
    btn.disabled = false;
  }
}

// ---------- Ассортимент ----------

async function loadProducts() {
  try {
    const [raw, prod, rec] = await Promise.all(['Сырьё', 'Ассортимент', 'Рецепты'].map(sheet => api('list', { sheet })));
    state.raw = raw.rows; state.products = prod.rows; state.recipes = rec.rows;
  } catch (e) {
    $('#prod-list').replaceChildren(h('p', { class: 'bad' }, e.message));
    return;
  }
  renderProducts();
}

const linesOf = id => state.recipes.filter(r => String(r['ID товара']) === String(id));
const rawById = id => state.raw.find(r => String(r['ID']) === String(id));
const rawPrice = id => Number(rawById(id)?.['Цена за ед.']) || 0;

function costPerLoaf(p) {
  const mix = Number(p['Булок в замесе']) || 0;
  if (!mix) return 0;
  const total = linesOf(p['ID']).reduce((s, l) => s + (Number(l['Кол-во на замес']) || 0) * rawPrice(l['ID сырья']), 0);
  return total / mix;
}

function renderProducts() {
  const box = $('#prod-list');
  if (!state.products.length) {
    box.replaceChildren(h('p', { class: 'stub' }, 'Хлеба пока нет. Сначала добавьте сырьё, затем хлеб ниже.'));
  } else {
    box.replaceChildren(...state.products.map(p => {
      const cost = costPerLoaf(p), price = Number(p['Цена']) || 0;
      const noPrice = linesOf(p['ID']).some(l => !(rawPrice(l['ID сырья']) > 0));
      const el = h('div', { class: 'item tap' },
        h('div', {},
          h('b', {}, p['Название']),
          h('span', { class: 'sub' }, `Себестоимость ${fmt(cost)} · цена ${fmt(price)}`),
          noPrice ? h('span', { class: 'sub bad' }, 'У части сырья нет цены: запишите закупку.') : ''),
        h('div', { class: 'qty' }, `${price - cost >= 0 ? '+' : ''}${fmt(price - cost)}`, h('span', { class: 'sub' }, 'за булку')));
      el.addEventListener('click', () => editProduct(p));
      return el;
    }));
  }
  $('#c-prod').replaceChildren(...state.products.map(p => h('option', { value: p['ID'] }, p['Название'])));
  renderCalc();
}

function addLine(rawId = '', qty = '') {
  const sel = h('select', { class: 'l-raw' }, ...state.raw.map(r => h('option', { value: r['ID'] }, `${r['Название']} (${r['Ед.']})`)));
  if (rawId !== '') sel.value = rawId;
  const q = h('input', { class: 'l-qty', type: 'text', inputmode: 'decimal', placeholder: 'Кол-во', autocomplete: 'off' });
  q.value = qty;
  const del = h('button', { type: 'button', class: 'ghost', 'aria-label': 'Убрать' }, '×');
  const row = h('div', { class: 'line' }, sel, q, del);
  del.addEventListener('click', () => row.remove());
  $('#pr-lines').append(row);
}

function resetProductForm() {
  ['#pr-id', '#pr-name', '#pr-weight', '#pr-price', '#pr-mix'].forEach(s => { $(s).value = ''; });
  $('#pr-lines').replaceChildren();
  $('#prod-summary').textContent = 'Добавить хлеб';
}

function editProduct(p) {
  resetProductForm();
  $('#pr-id').value = p['ID']; $('#pr-name').value = p['Название'];
  $('#pr-weight').value = p['Вес булки, г']; $('#pr-price').value = p['Цена']; $('#pr-mix').value = p['Булок в замесе'];
  linesOf(p['ID']).forEach(l => addLine(l['ID сырья'], l['Кол-во на замес']));
  $('#prod-summary').textContent = 'Изменить: ' + p['Название'];
  const d = $('#prod-panel');
  d.open = true;
  d.scrollIntoView({ behavior: 'smooth' });
}

async function saveProduct() {
  const lines = [...document.querySelectorAll('#pr-lines .line')]
    .map(r => ({ rawId: r.querySelector('.l-raw').value, qty: num(r.querySelector('.l-qty').value) }))
    .filter(l => l.rawId !== '' && l.qty > 0);
  const name = $('#pr-name').value.trim(), price = num($('#pr-price').value), mix = num($('#pr-mix').value), weight = num($('#pr-weight').value) || 0;
  if (!name) return setStatus('#prod-status', 'Введите название.', 'bad');
  if (!(price >= 0)) return setStatus('#prod-status', 'Введите цену продажи.', 'bad');
  if (!(mix > 0)) return setStatus('#prod-status', 'Укажите, сколько булок получается из замеса.', 'bad');
  if (!lines.length) return setStatus('#prod-status', 'Добавьте хотя бы один ингредиент.', 'bad');
  setStatus('#prod-status', 'Сохраняю…');
  try {
    await api('saveProduct', { id: $('#pr-id').value, name, weight, price, mix, lines });
    resetProductForm();
    $('#prod-panel').open = false;
    setStatus('#prod-status', `Сохранено: ${name}.`, 'ok');
    loadProducts();
  } catch (e) { setStatus('#prod-status', e.message, 'bad'); }
}

function renderCalc() {
  const p = state.products.find(x => String(x['ID']) === $('#c-prod').value);
  const n = num($('#c-n').value);
  const out = $('#c-out');
  if (!p || !(n > 0)) return out.replaceChildren();
  const mix = Number(p['Булок в замесе']) || 1;
  out.replaceChildren(...linesOf(p['ID']).map(l => {
    const r = rawById(l['ID сырья']);
    const perMix = Number(l['Кол-во на замес']) || 0;
    const unit = r ? r['Ед.'] : '';
    const small = unit === 'кг' || unit === 'л';
    const perLoaf = small ? `${fmt(perMix / mix * 1000)} ${unit === 'кг' ? 'г' : 'мл'}` : `${fmt(perMix / mix)} ${unit}`;
    return h('div', { class: 'calc-row' },
      h('span', {}, r ? r['Название'] : '?'),
      h('span', { class: 'qty' }, `${fmt(perMix * n / mix)} ${unit}`, h('span', { class: 'sub' }, `на булку ${perLoaf}`)));
  }));
}

// ---------- Точки ----------

async function loadPoints() {
  try {
    state.points = (await api('list', { sheet: 'Точки' })).rows;
  } catch (e) {
    $('#pt-list').replaceChildren(h('p', { class: 'bad' }, e.message));
    return;
  }
  const box = $('#pt-list');
  if (!state.points.length) {
    box.replaceChildren(h('p', { class: 'stub' }, 'Точек пока нет. Добавьте первую ниже.'));
    return;
  }
  box.replaceChildren(...state.points.map(pt => {
    const el = h('div', { class: 'item tap' },
      h('div', {}, h('b', {}, pt['Название']), h('span', { class: 'sub' }, [pt['Село'], pt['Телефон'], pt['Заметка']].filter(Boolean).join(' · '))));
    el.addEventListener('click', () => editPoint(pt));
    return el;
  }));
}

function resetPointForm() {
  ['#pt-id', '#pt-name', '#pt-village', '#pt-phone', '#pt-note'].forEach(s => { $(s).value = ''; });
  $('#pt-summary').textContent = 'Добавить точку';
}

function editPoint(pt) {
  $('#pt-id').value = pt['ID']; $('#pt-name').value = pt['Название']; $('#pt-village').value = pt['Село'];
  $('#pt-phone').value = pt['Телефон']; $('#pt-note').value = pt['Заметка'];
  $('#pt-summary').textContent = 'Изменить: ' + pt['Название'];
  const d = $('#pt-panel');
  d.open = true;
  d.scrollIntoView({ behavior: 'smooth' });
}

async function savePoint() {
  const name = $('#pt-name').value.trim();
  if (!name) return setStatus('#pt-status', 'Введите название.', 'bad');
  const fields = { 'Название': name, 'Село': $('#pt-village').value.trim(), 'Телефон': $('#pt-phone').value.trim(), 'Заметка': $('#pt-note').value.trim() };
  const id = $('#pt-id').value;
  try {
    if (id) await api('update', { sheet: 'Точки', id, fields });
    else await api('add', { sheet: 'Точки', row: fields });
    resetPointForm();
    $('#pt-panel').open = false;
    setStatus('#pt-status', `Сохранено: ${name}.`, 'ok');
    loadPoints();
  } catch (e) { setStatus('#pt-status', e.message, 'bad'); }
}

// ---------- Заказы ----------

const calcRow = (label, value) => h('div', { class: 'calc-row' }, h('span', {}, label), h('span', { class: 'qty' }, value));

async function loadOrders() {
  try {
    const [pt, pr, rc, rw, od] = await Promise.all(['Точки', 'Ассортимент', 'Рецепты', 'Сырьё', 'Заказы'].map(sheet => api('list', { sheet })));
    state.points = pt.rows; state.products = pr.rows; state.recipes = rc.rows; state.raw = rw.rows; state.orders = od.rows;
  } catch (e) {
    $('#o-list').replaceChildren(h('p', { class: 'bad' }, e.message));
    return;
  }
  const fill = (sel, items) => {
    const old = $(sel).value;
    $(sel).replaceChildren(...items);
    if (old) $(sel).value = old;
  };
  fill('#o-point', state.points.map(pt => h('option', { value: pt['ID'] }, pt['Название'])));
  fill('#o-prod', state.products.map(p => h('option', { value: p['ID'] }, p['Название'])));
  fill('#r-point', state.points.map(pt => h('option', { value: pt['ID'] }, pt['Название'])));
  fill('#r-prod', state.products.map(p => h('option', { value: p['ID'] }, p['Название'])));
  if (!$('#o-date').value) $('#o-date').value = today();
  if (!$('#r-date').value) $('#r-date').value = $('#o-date').value;
  updatePreview();
  renderDay();
  updateReturnPreview();
}

function updatePreview() {
  const p = state.products.find(x => String(x['ID']) === $('#o-prod').value);
  const qty = num($('#o-qty').value);
  const out = $('#o-preview');
  if (!p || !(qty > 0)) return out.replaceChildren();
  const revenue = (Number(p['Цена']) || 0) * qty, cost = costPerLoaf(p) * qty;
  const mix = Number(p['Булок в замесе']) || 1;
  const short = linesOf(p['ID']).map(l => {
    const r = rawById(l['ID сырья']);
    const need = (Number(l['Кол-во на замес']) || 0) * qty / mix;
    const have = Number(r?.['Остаток']) || 0;
    return r && have < need ? `${r['Название']}: нужно ${fmt(need)}, есть ${fmt(have)} ${r['Ед.']}` : null;
  }).filter(Boolean);
  out.replaceChildren(calcRow('Выручка', fmt(revenue)), calcRow('Себестоимость', fmt(cost)), calcRow('Прибыль', fmt(revenue - cost)),
    ...short.map(t => h('p', { class: 'bad' }, 'Не хватает сырья. ' + t)));
}

function renderDay() {
  const date = $('#o-date').value;
  const day = state.orders.filter(o => o['Дата'] === date);
  const sum = k => day.reduce((s, o) => s + (Number(o[k]) || 0), 0);
  $('#h-rev').textContent = fmt(sum('Выручка'));
  $('#h-cost').textContent = fmt(sum('Себестоимость'));
  $('#h-qty').textContent = fmt(sum('Кол-во'));
  $('#h-ret').textContent = fmt(sum('Возвраты'));
  $('#h-profit').textContent = fmt(sum('Прибыль'));
  $('#rc-date').textContent = date ? new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '';
  $('#o-list').replaceChildren(...(day.length ? day.map(o => {
    const ret = Number(o['Возвраты']) || 0;
    const el = h('div', { class: 'item tap' },
      h('div', {}, h('b', {}, o['Точка']), h('span', { class: 'sub' }, `${o['Товар']} × ${fmt(Number(o['Кол-во']) || 0)}${ret ? ` · возврат ${fmt(ret)}` : ''}`)),
      h('div', { class: 'qty' }, fmt(Number(o['Выручка']) || 0), h('span', { class: 'sub' }, `прибыль ${fmt(Number(o['Прибыль']) || 0)}`)));
    el.addEventListener('click', () => openOrder(o));
    return el;
  }) : [h('p', { class: 'stub' }, 'В этот день заказов нет.')]));
}

async function placeOrder() {
  const qty = num($('#o-qty').value);
  if (!$('#o-point').value) return setStatus('#order-status', 'Сначала добавьте точку.', 'bad');
  if (!$('#o-prod').value) return setStatus('#order-status', 'Сначала добавьте хлеб.', 'bad');
  if (!(qty > 0)) return setStatus('#order-status', 'Введите количество.', 'bad');
  const btn = $('#btn-order');
  btn.disabled = true;
  setStatus('#order-status', 'Сохраняю…');
  try {
    const { row } = await api('createOrder', { date: $('#o-date').value, pointId: $('#o-point').value, productId: $('#o-prod').value, qty });
    $('#o-qty').value = '';
    const warn = row.negative && row.negative.length ? ` Остаток ушёл в минус: ${row.negative.join(', ')}.` : '';
    setStatus('#order-status', `Заказ сохранён: выручка ${fmt(row['Выручка'])}, прибыль ${fmt(row['Прибыль'])}.${warn}`, warn ? 'bad' : 'ok');
    loadOrders();
  } catch (e) {
    setStatus('#order-status', e.message, 'bad');
  } finally {
    btn.disabled = false;
  }
}

// ---------- Заказ: возвраты, исправление, удаление ----------

let editingOrder = null;

function openOrder(o) {
  editingOrder = o;
  $('#od-title').textContent = o['Точка'];
  $('#od-sub').textContent = `${o['Товар']} · ${o['Дата']} · цена ${fmt(Number(o['Цена']) || 0)}`;
  $('#od-qty').value = o['Кол-во'];
  $('#od-ret').value = Number(o['Возвраты']) || 0;
  setStatus('#od-status', '');
  updateOrderPreview();
  $('#order-dialog').showModal();
}

function updateOrderPreview() {
  const o = editingOrder;
  if (!o) return;
  const qty = num($('#od-qty').value), ret = num($('#od-ret').value) || 0;
  const out = $('#od-preview');
  if (!(qty > 0) || ret < 0 || ret > qty) {
    out.replaceChildren(h('p', { class: 'bad' }, 'Проверьте числа: возвратов не может быть больше, чем сдано.'));
    return;
  }
  const rev = (qty - ret) * (Number(o['Цена']) || 0), cost = qty * (Number(o['Себестоимость ед.']) || 0);
  out.replaceChildren(calcRow('Выручка', fmt(rev)), calcRow('Себестоимость', fmt(cost)), calcRow('Прибыль', fmt(rev - cost)));
}

async function saveOrderEdit() {
  const qty = num($('#od-qty').value), ret = num($('#od-ret').value) || 0;
  if (!(qty > 0) || ret < 0 || ret > qty) return setStatus('#od-status', 'Проверьте количество и возвраты.', 'bad');
  const btn = $('#btn-od-save');
  btn.disabled = true;
  try {
    const { row } = await api('updateOrder', { id: editingOrder['ID'], qty, returns: ret });
    $('#order-dialog').close();
    const warn = row.negative && row.negative.length ? ` Остаток ушёл в минус: ${row.negative.join(', ')}.` : '';
    setStatus('#order-status', 'Заказ обновлён.' + warn, warn ? 'bad' : 'ok');
    loadOrders();
  } catch (e) {
    setStatus('#od-status', e.message, 'bad');
  } finally { btn.disabled = false; }
}

async function deleteOrderEdit() {
  if (!confirm('Удалить заказ? Сырьё вернётся на склад.')) return;
  try {
    await api('deleteOrder', { id: editingOrder['ID'] });
    $('#order-dialog').close();
    setStatus('#order-status', 'Заказ удалён, сырьё возвращено.', 'ok');
    loadOrders();
  } catch (e) { setStatus('#od-status', e.message, 'bad'); }
}

// ---------- Финансы ----------

const ymd = d => d.toLocaleDateString('sv-SE');
const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString('ru-RU');

async function loadFinance() {
  try {
    const [od, pu, ex] = await Promise.all(['Заказы', 'Закупки', 'Расходы'].map(sheet => api('list', { sheet })));
    state.orders = od.rows; state.purchases = pu.rows; state.expenses = ex.rows;
  } catch (e) {
    $('#f-kpi').replaceChildren(h('p', { class: 'bad' }, e.message));
    return;
  }
  if (!$('#f-from').value) setRange('7');
  renderFinance();
}

function setRange(r) {
  const to = new Date(), from = new Date();
  if (r === 'month') from.setDate(1);
  else if (r !== 'today') from.setDate(from.getDate() - (Number(r) - 1));
  $('#f-from').value = ymd(from);
  $('#f-to').value = ymd(to);
  document.querySelectorAll('#f-chips button').forEach(b => b.classList.toggle('active', b.dataset.range === r));
}

function groupRows(ords, key) {
  const m = {};
  ords.forEach(o => {
    const g = m[o[key]] || (m[o[key]] = { qty: 0, rev: 0, profit: 0 });
    g.qty += Number(o['Кол-во']) || 0; g.rev += Number(o['Выручка']) || 0; g.profit += Number(o['Прибыль']) || 0;
  });
  const rows = Object.entries(m).sort((a, b) => b[1].profit - a[1].profit).map(([name, g]) =>
    h('div', { class: 'item' },
      h('div', {}, h('b', {}, name), h('span', { class: 'sub' }, `${fmt(g.qty)} булок`)),
      h('div', { class: 'qty' }, fmt(g.profit), h('span', { class: 'sub' }, `выручка ${fmt(g.rev)}`))));
  return rows.length ? rows : [h('p', { class: 'stub' }, 'За этот период данных нет.')];
}

function renderFinance() {
  const from = $('#f-from').value, to = $('#f-to').value;
  const inR = d => d >= from && d <= to;
  const ords = state.orders.filter(o => inR(o['Дата']));
  const buys = state.purchases.filter(x => inR(x['Дата']));
  const exps = state.expenses.filter(x => inR(x['Дата']));
  const sum = (arr, k) => arr.reduce((s, x) => s + (Number(x[k]) || 0), 0);
  const rev = sum(ords, 'Выручка'), cost = sum(ords, 'Себестоимость'), gross = sum(ords, 'Прибыль');
  const qty = sum(ords, 'Кол-во'), ret = sum(ords, 'Возвраты'), bought = sum(buys, 'Сумма'), spent = sum(exps, 'Сумма');
  const net = gross - spent;
  const tile = (label, value, cls) => h('div', { class: 'tile ' + (cls || '') }, h('span', { class: 'sub' }, label), h('strong', {}, value));
  $('#f-kpi').replaceChildren(
    tile('Чистая прибыль', fmt(net), 'hot'), tile('Валовая прибыль', fmt(gross)), tile('Выручка', fmt(rev)),
    tile('Себестоимость', fmt(cost)), tile('Расходы', fmt(spent)), tile('Рентабельность', `${fmt1(rev > 0 ? net / rev * 100 : 0)}%`),
    tile('Булок сдано', fmt(qty)), tile('Возвраты', `${fmt(ret)}${qty ? ` (${fmt1(ret / qty * 100)}%)` : ''}`),
    tile('Закуплено сырья', fmt(bought)));

  const days = [];
  const start = new Date(from + 'T12:00:00');
  for (let d = new Date(to + 'T12:00:00'); d >= start && days.length < 31; d.setDate(d.getDate() - 1)) days.unshift(ymd(d));
  const byDay = {};
  ords.forEach(o => { byDay[o['Дата']] = (byDay[o['Дата']] || 0) + (Number(o['Прибыль']) || 0); });
  exps.forEach(x => { byDay[x['Дата']] = (byDay[x['Дата']] || 0) - (Number(x['Сумма']) || 0); });
  const max = Math.max(1, ...days.map(d => Math.abs(byDay[d] || 0)));
  $('#f-chart').replaceChildren(...(ords.length || exps.length ? days.map(d => {
    const v = byDay[d] || 0;
    return h('div', { class: 'bar' },
      h('div', { class: 'fill' + (v < 0 ? ' neg' : ''), style: `height:${Math.max(2, Math.abs(v) / max * 100)}%`, title: `${d}: ${fmt(v)}` }),
      h('span', {}, d.slice(8)));
  }) : [h('p', { class: 'stub' }, 'За этот период данных нет.')]));

  $('#f-points').replaceChildren(...groupRows(ords, 'Точка'));
  $('#f-products').replaceChildren(...groupRows(ords, 'Товар'));
  renderExpenses(exps);
}

// ---------- Расходы и поломки ----------

function renderExpenses(exps) {
  const sorted = [...exps].sort((a, b) => String(b['Дата']).localeCompare(String(a['Дата'])) || Number(b['ID']) - Number(a['ID']));
  const row = x => {
    const el = h('div', { class: 'item tap' },
      h('div', {}, h('b', {}, x['Категория'] + (x['Оборудование'] ? ' · ' + x['Оборудование'] : '')),
        h('span', { class: 'sub' }, [x['Дата'], x['Описание']].filter(Boolean).join(' · '))),
      h('div', { class: 'qty' }, fmt(Number(x['Сумма']) || 0)));
    el.addEventListener('click', () => deleteExpense(x));
    return el;
  };
  $('#f-expenses').replaceChildren(...(sorted.length ? sorted.map(row) : [h('p', { class: 'stub' }, 'За этот период расходов нет.')]));

  const rep = sorted.filter(x => x['Категория'] === 'Ремонт');
  const tally = {};
  rep.forEach(x => { const k = x['Оборудование'] || 'Другое'; tally[k] = (tally[k] || 0) + 1; });
  const total = rep.reduce((s, x) => s + (Number(x['Сумма']) || 0), 0);
  const head = rep.length
    ? h('p', { class: 'sub' }, `Поломок: ${rep.length}, на сумму ${fmt(total)}. ` + Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join(', ') + '.')
    : '';
  $('#f-repairs').replaceChildren(head, ...(rep.length ? rep.map(row) : [h('p', { class: 'stub' }, 'За этот период поломок не было.')]));
}

async function addExpense() {
  const sum = num($('#e-sum').value), cat = $('#e-cat').value, date = $('#e-date').value || today();
  if (!(sum > 0)) return setStatus('#exp-status', 'Введите сумму.', 'bad');
  const btn = $('#btn-expense');
  btn.disabled = true;
  try {
    await api('add', { sheet: 'Расходы', row: {
      'Дата': date, 'Категория': cat, 'Описание': $('#e-desc').value.trim(),
      'Оборудование': cat === 'Ремонт' ? $('#e-eq').value : '', 'Сумма': sum } });
    $('#e-sum').value = ''; $('#e-desc').value = '';
    const outside = date < $('#f-from').value || date > $('#f-to').value;
    setStatus('#exp-status', 'Расход записан.' + (outside ? ' Он вне выбранного периода, поэтому в списках его не видно.' : ''), 'ok');
    loadFinance();
  } catch (e) {
    setStatus('#exp-status', e.message, 'bad');
  } finally { btn.disabled = false; }
}

async function deleteExpense(x) {
  if (!confirm(`Удалить расход «${x['Категория']}» на сумму ${fmt(Number(x['Сумма']) || 0)}?`)) return;
  try {
    await api('deleteRow', { sheet: 'Расходы', id: x['ID'] });
    setStatus('#exp-status', 'Расход удалён.', 'ok');
    loadFinance();
  } catch (e) { setStatus('#exp-status', e.message, 'bad'); }
}

// ---------- Возврат хлеба с точки ----------

// Возврат распределяется по заказам выбранного дня на эту точку и хлеб, сначала по новым
function allocReturn(qty) {
  const date = $('#r-date').value, pid = $('#r-point').value, prid = $('#r-prod').value;
  const match = state.orders
    .filter(o => o['Дата'] === date && String(o['ID точки']) === pid && String(o['ID товара']) === prid)
    .sort((a, b) => Number(b['ID']) - Number(a['ID']));
  const room = o => (Number(o['Кол-во']) || 0) - (Number(o['Возвраты']) || 0);
  const capacity = match.reduce((s, o) => s + room(o), 0);
  let left = qty;
  const parts = [];
  match.forEach(o => {
    const take = Math.min(room(o), left);
    if (take > 0) { parts.push({ o, take }); left -= take; }
  });
  return { match, capacity, parts };
}

function updateReturnPreview() {
  const out = $('#r-preview');
  if (!$('#r-point').value || !$('#r-prod').value) return out.replaceChildren();
  const qty = num($('#r-qty').value);
  const { match, capacity, parts } = allocReturn(qty > 0 ? qty : 0);
  if (!match.length) return out.replaceChildren(h('p', { class: 'bad' }, 'За эту дату нет заказов на эту точку и хлеб.'));
  const sent = match.reduce((s, o) => s + (Number(o['Кол-во']) || 0), 0);
  const info = h('p', { class: 'sub' }, `Заказов: ${match.length}, сдано ${fmt(sent)} шт., можно вернуть до ${fmt(capacity)} шт.`);
  if (!(qty > 0)) return out.replaceChildren(info);
  if (qty > capacity) return out.replaceChildren(info, h('p', { class: 'bad' }, `Можно вернуть не больше ${fmt(capacity)} шт.`));
  const lost = parts.reduce((s, x) => s + x.take * (Number(x.o['Цена']) || 0), 0);
  out.replaceChildren(info,
    calcRow('Выручка уменьшится на', fmt(lost)),
    h('p', { class: 'sub' }, 'Возврат пойдёт в заказы: ' + parts.map(x => `${fmt(x.take)} из ${fmt(Number(x.o['Кол-во']) || 0)}`).join(', ') + '.'));
}

async function placeReturn() {
  const qty = num($('#r-qty').value);
  if (!(qty > 0)) return setStatus('#ret-status', 'Введите, сколько вернули.', 'bad');
  const { capacity } = allocReturn(qty);
  if (qty > capacity) return setStatus('#ret-status', `Можно вернуть не больше ${fmt(capacity)} шт.`, 'bad');
  const btn = $('#btn-return');
  btn.disabled = true;
  setStatus('#ret-status', 'Записываю…');
  try {
    const { row } = await api('returnBread', { date: $('#r-date').value, pointId: $('#r-point').value, productId: $('#r-prod').value, qty });
    $('#r-qty').value = '';
    setStatus('#ret-status', `Возврат записан: ${fmt(row.returned)} шт.`, 'ok');
    loadOrders();
  } catch (e) {
    setStatus('#ret-status', e.message, 'bad');
  } finally { btn.disabled = false; }
}

// ---------- Запуск ----------

function init() {
  $('#today').textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
  $('#btn-settings').addEventListener('click', () => show('settings'));

  const c = cfg();
  $('#api-url').value = c.url;
  $('#api-key').value = c.key;

  const saveCfg = () => {
    localStorage.setItem('api_url', $('#api-url').value.trim());
    localStorage.setItem('api_key', $('#api-key').value.trim());
  };
  $('#btn-save').addEventListener('click', () => { saveCfg(); setStatus('#status', 'Сохранено.', 'ok'); });
  $('#btn-check').addEventListener('click', async () => {
    saveCfg();
    setStatus('#status', 'Проверяю связь…');
    try { await api('ping'); setStatus('#status', 'Связь с таблицей есть.', 'ok'); }
    catch (e) { setStatus('#status', e.message, 'bad'); }
  });

  $('#btn-pline').addEventListener('click', addPLine);
  $('#p-date').value = today();
  $('#btn-newraw').addEventListener('click', addRaw);
  $('#btn-purchase').addEventListener('click', addPurchase);

  $('#btn-addline').addEventListener('click', () => addLine());
  $('#btn-saveprod').addEventListener('click', saveProduct);
  $('#btn-cancelprod').addEventListener('click', () => { resetProductForm(); $('#prod-panel').open = false; });
  $('#c-prod').addEventListener('change', renderCalc);
  $('#c-n').addEventListener('input', renderCalc);

  ['input', 'change'].forEach(ev => { $('#o-prod').addEventListener(ev, updatePreview); $('#o-qty').addEventListener(ev, updatePreview); });
  $('#o-date').addEventListener('change', () => { $('#r-date').value = $('#o-date').value; renderDay(); updateReturnPreview(); });
  ['input', 'change'].forEach(ev => ['#r-date', '#r-point', '#r-prod', '#r-qty'].forEach(sel => $(sel).addEventListener(ev, updateReturnPreview)));
  $('#btn-return').addEventListener('click', placeReturn);
  $('#btn-order').addEventListener('click', placeOrder);
  $('#btn-savept').addEventListener('click', savePoint);
  $('#btn-cancelpt').addEventListener('click', () => { resetPointForm(); $('#pt-panel').open = false; });

  ['#od-qty', '#od-ret'].forEach(sel => $(sel).addEventListener('input', updateOrderPreview));
  $('#btn-od-save').addEventListener('click', saveOrderEdit);
  $('#btn-od-del').addEventListener('click', deleteOrderEdit);
  $('#btn-od-close').addEventListener('click', () => $('#order-dialog').close());
  document.querySelectorAll('#f-chips button').forEach(b => b.addEventListener('click', () => { setRange(b.dataset.range); renderFinance(); }));
  ['#f-from', '#f-to'].forEach(sel => $(sel).addEventListener('change', () => {
    document.querySelectorAll('#f-chips button').forEach(b => b.classList.remove('active'));
    renderFinance();
  }));

  $('#e-date').value = today();
  $('#e-cat').addEventListener('change', () => { $('#e-eq-wrap').hidden = $('#e-cat').value !== 'Ремонт'; });
  $('#btn-expense').addEventListener('click', addExpense);

  show(c.url && c.key ? (localStorage.getItem('last_view') || 'orders') : 'settings');

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
}
init();
