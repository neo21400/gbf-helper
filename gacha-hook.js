// ── Хук захвата gacha-трафика (MAIN world, document_start) ───────────────────
// Регистрируется из background.js через chrome.scripting.registerContentScripts,
// когда включён захват. Именно document_start, а не executeScript по событию
// загрузки: после крутки за кристаллы страница перезагружается, и запрос
// результата уходит раньше, чем успел бы встать хук, поставленный асинхронно.
//
// Живёт в мире страницы, поэтому chrome.* здесь недоступен — данные уходят
// через window.postMessage, а content.js их валидирует и передаёт в фон.
(function () {
  if (window.__gbfGachaHooked) return;
  window.__gbfGachaHooked = true;

  // Нужны только JSON-эндпоинты гачи. Без этих исключений в лог налипают
  // CSS из /assets_en/.../css/gacha/ и EJS-шаблоны /gacha/content/*, в которых
  // вместо данных заглушки вида <%= reward_name %>.
  const STATIC_RE = /\.(css|js|png|jpe?g|gif|webp|woff2?|svg)(\?|$)/i;
  const MATCH = (url) => /\/gacha\//i.test(url)
    && !STATIC_RE.test(url)
    && !/\/gacha\/content\//i.test(url);

  const LIMIT = 100000;
  const trim = (s) => (typeof s === 'string' && s.length > LIMIT)
    ? s.slice(0, LIMIT) + '…[обрезано]' : (typeof s === 'string' ? s : null);

  const post = (entry) => {
    try { window.postMessage({ command: 'GACHA_CAPTURE', entry }, '*'); } catch (e) { }
  };

  const openOrig = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__gbfMethod = method;
    this.__gbfUrl = url;
    return openOrig.apply(this, arguments);
  };

  const sendOrig = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    const url = this.__gbfUrl || '';
    if (MATCH(url)) {
      this.addEventListener('load', () => {
        let response = null;
        // responseText бросает исключение при responseType='json'/'blob'
        try { response = this.responseText; }
        catch (e) { try { response = JSON.stringify(this.response); } catch (e2) { } }
        post({
          ts: Date.now(), via: 'xhr', method: this.__gbfMethod || 'GET',
          url: this.responseURL || url, status: this.status,
          request: trim(typeof body === 'string' ? body : null),
          response: trim(response),
        });
      });
    }
    return sendOrig.apply(this, arguments);
  };

  const fetchOrig = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const p = fetchOrig.apply(this, arguments);
    if (MATCH(url)) {
      p.then((res) => {
        res.clone().text().then((text) => post({
          ts: Date.now(), via: 'fetch', method: (init && init.method) || 'GET',
          url, status: res.status,
          request: trim(init && typeof init.body === 'string' ? init.body : null),
          response: trim(text),
        })).catch(() => { });
      }).catch(() => { });
    }
    return p;
  };

  console.log('[GBF] Захват gacha-трафика активен (document_start)');
})();
