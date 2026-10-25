const $ = s => document.querySelector(s);
const TITLES = { orders: 'Заказы', raw: 'Сырьё', products: 'Ассортимент', points: 'Точки', finance: 'Финансы', settings: 'Настройки' };
const state = { raw: [], products: [], recipes: [], points: [], orders: [] };

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
  if (!$('#o-date').value) $('#o-date').value = today();
  updatePreview();
  renderDay();
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
  $('#h-profit').textContent = fmt(sum('Прибыль'));
  $('#rc-date').textContent = date ? new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '';
  $('#o-list').replaceChildren(...(day.length ? day.map(o => h('div', { class: 'item' },
    h('div', {}, h('b', {}, o['Точка']), h('span', { class: 'sub' }, `${o['Товар']} × ${fmt(Number(o['Кол-во']) || 0)}`)),
    h('div', { class: 'qty' }, fmt(Number(o['Выручка']) || 0), h('span', { class: 'sub' }, `прибыль ${fmt(Number(o['Прибыль']) || 0)}`)))
  ) : [h('p', { class: 'stub' }, 'В этот день заказов нет.')]));
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
  $('#o-date').addEventListener('change', renderDay);
  $('#btn-order').addEventListener('click', placeOrder);
  $('#btn-savept').addEventListener('click', savePoint);
  $('#btn-cancelpt').addEventListener('click', () => { resetPointForm(); $('#pt-panel').open = false; });

  show(c.url && c.key ? (localStorage.getItem('last_view') || 'orders') : 'settings');

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
}
init();
