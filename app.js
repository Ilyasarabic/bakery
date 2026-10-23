const $ = s => document.querySelector(s);
const TITLES = { orders: 'Заказы', raw: 'Сырьё', products: 'Ассортимент', points: 'Точки', finance: 'Финансы', settings: 'Настройки' };
const state = { raw: [] };

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
  $('#p-raw').replaceChildren(...state.raw.map(r => h('option', { value: r['ID'] }, `${r['Название']} (${r['Ед.']})`)));
  updateHint();
}

function updateHint() {
  const qty = num($('#p-qty').value), sum = num($('#p-sum').value);
  const raw = state.raw.find(r => String(r['ID']) === $('#p-raw').value);
  $('#p-hint').textContent = qty > 0 && sum >= 0 && raw ? `Цена за ${raw['Ед.']}: ${fmt(sum / qty)}` : '';
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

async function addPurchase() {
  const qty = num($('#p-qty').value), sum = num($('#p-sum').value);
  if (!$('#p-raw').value) return setStatus('#raw-status', 'Сначала добавьте сырьё.', 'bad');
  if (!(qty > 0)) return setStatus('#raw-status', 'Введите количество больше нуля.', 'bad');
  if (!(sum >= 0)) return setStatus('#raw-status', 'Введите сумму.', 'bad');
  setStatus('#raw-status', 'Записываю…');
  try {
    const { row } = await api('purchase', { rawId: $('#p-raw').value, qty, sum, supplier: $('#p-supplier').value.trim(), date: today() });
    $('#p-qty').value = ''; $('#p-sum').value = ''; $('#p-supplier').value = '';
    setStatus('#raw-status', `Закупка записана. Остаток: ${fmt(row['Остаток'])}.`, 'ok');
    loadRaw();
  } catch (e) { setStatus('#raw-status', e.message, 'bad'); }
}

// ---------- Запуск ----------

function init() {
  $('#today').textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

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

  ['#p-qty', '#p-sum', '#p-raw'].forEach(s => $(s).addEventListener('input', updateHint));
  $('#btn-newraw').addEventListener('click', addRaw);
  $('#btn-purchase').addEventListener('click', addPurchase);

  show(c.url && c.key ? (localStorage.getItem('last_view') || 'orders') : 'settings');

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
}
init();
