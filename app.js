const $ = s => document.querySelector(s);
const TITLES = { orders: 'Заказы', raw: 'Сырьё', products: 'Ассортимент', points: 'Точки', finance: 'Финансы', settings: 'Настройки' };

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

function show(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $('#title').textContent = TITLES[name];
  localStorage.setItem('last_view', name);
}

function setStatus(text, kind) {
  const el = $('#status');
  el.textContent = text;
  el.className = kind || '';
}

function init() {
  $('#today').textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
  $('#btn-settings').addEventListener('click', () => show('settings'));

  const c = cfg();
  $('#api-url').value = c.url;
  $('#api-key').value = c.key;

  $('#btn-save').addEventListener('click', () => {
    localStorage.setItem('api_url', $('#api-url').value.trim());
    localStorage.setItem('api_key', $('#api-key').value.trim());
    setStatus('Сохранено.', 'ok');
  });

  $('#btn-check').addEventListener('click', async () => {
    localStorage.setItem('api_url', $('#api-url').value.trim());
    localStorage.setItem('api_key', $('#api-key').value.trim());
    setStatus('Проверяю связь…');
    try {
      await api('ping');
      setStatus('Связь с таблицей есть.', 'ok');
    } catch (e) {
      setStatus(e.message, 'bad');
    }
  });

  show(c.url && c.key ? (localStorage.getItem('last_view') || 'orders') : 'settings');

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
}
init();
