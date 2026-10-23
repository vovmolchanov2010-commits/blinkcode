/**
 * Страница трансляции SOS по ссылке из SMS: открывается в любом браузере без входа.
 * HTML статичный — данные страница берёт сама из `<ссылка>/data` раз в 5 секунд.
 * Без аналитики и трекеров; карта — OpenStreetMap через Leaflet.
 */
export const SOS_PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Blink SOS</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="">
<style>
  :root { --bg: #F6F7FB; --surface: #fff; --text: #11131A; --muted: #6B7080; --danger: #E5484D; --primary: #5B4BFF; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.4 -apple-system, system-ui, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--text); }
  header { padding: 16px; background: var(--danger); color: #fff; }
  header.ended { background: var(--muted); }
  header.test { background: var(--primary); }
  h1 { margin: 0; font-size: 20px; }
  #map { height: 55vh; min-height: 280px; }
  main { padding: 16px; display: grid; gap: 12px; max-width: 640px; margin: 0 auto; }
  .card { background: var(--surface); border-radius: 12px; padding: 16px; }
  .muted { color: var(--muted); font-size: 14px; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; }
  a.button { flex: 1; min-width: 140px; text-align: center; padding: 14px; border-radius: 12px; text-decoration: none; font-weight: 600; }
  a.call { background: var(--danger); color: #fff; }
  a.maps { background: var(--surface); color: var(--primary); border: 1px solid var(--primary); }
  .gone { padding: 48px 16px; text-align: center; }
</style>
</head>
<body>
<header id="header"><h1 id="title">Загружаем…</h1><div id="subtitle"></div></header>
<div id="map"></div>
<main>
  <div class="card">
    <div id="updated"></div>
    <div class="muted" id="details"></div>
  </div>
  <div class="row">
    <a class="button call" href="tel:112">Позвонить 112</a>
    <a class="button maps" id="maps" href="#" target="_blank" rel="noopener noreferrer">Открыть в картах</a>
  </div>
  <p class="muted">Blink — не экстренная служба. Если человеку угрожает опасность, звоните 112.</p>
</main>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
<script>
(function () {
  var dataUrl = location.pathname.replace(/\\/$/, '') + '/data';
  var map = null, marker = null, track = null, circle = null, fitted = false;

  function el(id) { return document.getElementById(id); }
  function ago(ts) {
    var min = Math.floor((Date.now() - ts) / 60000);
    if (min < 1) return 'только что';
    if (min < 60) return min + ' мин назад';
    return Math.floor(min / 60) + ' ч назад';
  }
  function time(iso) { return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }

  function render(data) {
    var header = el('header');
    header.className = data.status === 'ended' ? 'ended' : data.isTest ? 'test' : '';
    el('title').textContent = (data.isTest ? 'ТЕСТ · ' : '') + data.name + (data.status === 'active' ? ' — SOS' : '');
    el('subtitle').textContent = data.status === 'active'
      ? 'Трансляция до ' + time(data.expiresAt)
      : data.cancelled ? 'SOS отменён в ' + time(data.endedAt) : 'Трансляция закончилась в ' + time(data.endedAt);

    var last = data.points[data.points.length - 1];
    if (!last) {
      el('updated').textContent = 'Геолокация пока не получена';
      return;
    }
    var stale = Date.now() - last.ts > 2 * 60000;
    el('updated').textContent = 'Обновлено ' + ago(last.ts) + (stale && data.status === 'active' ? ' — нет связи с телефоном' : '');
    var details = [];
    if (last.speed != null && last.speed > 0.5) details.push('скорость ' + Math.round(last.speed * 3.6) + ' км/ч');
    if (last.battery != null) details.push('батарея ' + last.battery + '%');
    if (last.accuracy != null) details.push('точность ±' + Math.round(last.accuracy) + ' м');
    el('details').textContent = details.join(' · ');
    el('maps').href = 'https://yandex.ru/maps/?pt=' + last.lng + ',' + last.lat + '&z=17&l=map';

    // Карта не загрузилась (нет доступа к CDN) — не оставляем пустое место.
    if (!window.L) { el('map').style.display = 'none'; return; }
    var latlngs = data.points.map(function (p) { return [p.lat, p.lng]; });
    var here = [last.lat, last.lng];
    if (!map) {
      map = L.map('map').setView(here, 16);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap'
      }).addTo(map);
      track = L.polyline(latlngs, { color: '#E5484D', weight: 4 }).addTo(map);
      circle = L.circle(here, { radius: last.accuracy || 0, weight: 1 }).addTo(map);
      marker = L.circleMarker(here, { radius: 9, color: '#fff', weight: 3, fillColor: '#E5484D', fillOpacity: 1 }).addTo(map);
      if (latlngs.length > 1) map.fitBounds(track.getBounds(), { padding: [40, 40], maxZoom: 17 });
    } else {
      track.setLatLngs(latlngs);
      circle.setLatLng(here).setRadius(last.accuracy || 0);
      marker.setLatLng(here);
      if (!fitted) map.panTo(here);
    }
  }

  function gone() {
    document.body.innerHTML = '<div class="gone"><h1>Трансляция завершена</h1><p class="muted">Данные по этой ссылке больше недоступны.</p></div>';
  }

  function poll() {
    fetch(dataUrl, { cache: 'no-store' })
      .then(function (res) {
        if (res.status === 404) { gone(); return null; }
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (!data) return;
        render(data);
        if (data.status === 'active') setTimeout(poll, 5000);
      })
      .catch(function () { setTimeout(poll, 10000); });
  }
  // Пользователь подвинул карту — больше не центрируем её сами.
  document.addEventListener('pointerdown', function () { fitted = true; }, { once: true });
  poll();
})();
</script>
</body>
</html>
`;
