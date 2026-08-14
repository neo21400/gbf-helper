// ── Хук захвата всего трафика игры (MAIN world, document_start) ──────────────
// Временный диагностический слой. В отличие от gacha-hook.js, который слушает
// только /gacha/, этот пишет вообще все запросы страницы: эндпоинт истории боёв
// заранее неизвестен, и фильтр по догадке потерял бы как раз его.
//
// Регистрируется из background.js только когда включён тумблер в Loot Tracker —
// постоянно держать его нельзя, слишком много данных.
//
// Живёт в мире страницы, поэтому chrome.* здесь недоступен — данные уходят
// через window.postMessage, а content.js их валидирует и передаёт в фон.
(function () {
  if (window.__gbfDebugHooked) return;
  window.__gbfDebugHooked = true;

  // Отсекаем статику и аналитику: картинки и шрифты в логе только съедают лимит,
  // а Datadog/MBGA к игре отношения не имеют.
  const STATIC_RE = /\.(css|js|png|jpe?g|gif|webp|woff2?|svg|mp3|m4a|ico)(\?|$)/i;
  const NOISE_RE = /datadoghq|analytics|google|doubleclick/i;
  const MATCH = (url) => !!url && !STATIC_RE.test(url) && !NOISE_RE.test(url);

  const LIMIT = 200000;
  const trim = (s) => (typeof s === 'string' && s.length > LIMIT)
    ? s.slice(0, LIMIT) + '…[обрезано]' : (typeof s === 'string' ? s : null);

  // Лог выгружается в файл и уходит в чужие руки вместе с разбором проблемы, а
  // /authentication несёт в теле подписанный токен сессии — по нему в аккаунт
  // войдут без пароля. Тела таких запросов не пишем вовсе: разбирать в них
  // нечего, адрес и код ответа для диагностики остаются.
  const SECRET_RE = /\/authentication|\/token|password/i;
  const body = (url, s) => SECRET_RE.test(url || '') ? '[redacted]' : trim(s);

  const post = (entry) => {
    try { window.postMessage({ command: 'DEBUG_CAPTURE', entry }, '*'); } catch (e) { }
  };

  const openOrig = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__gbfDbgMethod = method;
    this.__gbfDbgUrl = url;
    return openOrig.apply(this, arguments);
  };

  const sendOrig = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (sendBody) {
    const url = this.__gbfDbgUrl || '';
    if (MATCH(url)) {
      this.addEventListener('load', () => {
        let response = null;
        // responseText бросает исключение при responseType='json'/'blob'
        try { response = this.responseText; }
        catch (e) { try { response = JSON.stringify(this.response); } catch (e2) { } }
        post({
          ts: Date.now(), via: 'xhr', method: this.__gbfDbgMethod || 'GET',
          url: this.responseURL || url, status: this.status,
          request: body(url, typeof sendBody === 'string' ? sendBody : null),
          response: body(url, response),
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
          request: body(url, init && typeof init.body === 'string' ? init.body : null),
          response: body(url, text),
        })).catch(() => { });
      }).catch(() => { });
    }
    return p;
  };

  console.log('[GBF] Отладочный захват трафика активен');
})();
