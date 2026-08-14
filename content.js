// ── Блокировка аналитики и очистка консоли ────────────
(function () {
  const blockedDomains = ['datadoghq.com', 'analytics.mbga.jp', 'session-replay.browser-intake-datadoghq.com'];

  // 1. Блокируем XHR (XMLHttpRequest)
  const oxhr = window.XMLHttpRequest.prototype.open;
  window.XMLHttpRequest.prototype.open = function (method, url) {
    if (typeof url === 'string' && blockedDomains.some(d => url.includes(d))) {
      this.isBlocked = true;
      return;
    }
    return oxhr.apply(this, arguments);
  };
  const sxhr = window.XMLHttpRequest.prototype.send;
  window.XMLHttpRequest.prototype.send = function () {
    if (this.isBlocked) return;
    return sxhr.apply(this, arguments);
  };

  // 2. Блокируем Fetch API
  const ofetch = window.fetch;
  window.fetch = function (url, options) {
    if (typeof url === 'string' && blockedDomains.some(d => url.includes(d))) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return ofetch.apply(this, arguments);
  };

  // 3. Фильтруем консоль от ошибок этих запросов
  const oerror = console.error;
  console.error = function () {
    const msg = arguments[0];
    if (typeof msg === 'string' && blockedDomains.some(d => msg.includes(d))) return;
    return oerror.apply(this, arguments);
  };

  console.log('[GBF] Аналитика Datadog/MBGA заблокирована. Консоль будет чище.');
})();

// ── Защита от «Extension context invalidated» ────────────
// После обновления или перезагрузки расширения старый content-скрипт остаётся
// жить на уже открытой странице, но его chrome.runtime уже мёртв — любой вызов
// бросает исключение. Проверяем доступность контекста перед каждым обращением
// и корректно останавливаемся, если его больше нет.
let contextLost = false;

function isExtensionAlive() {
  if (contextLost) return false;
  try {
    return !!(chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

// Опциональные модули (автокликер) регистрируют сюда свою остановку — ядро не
// знает про их переменные, поэтому глушим их через хуки, а не напрямую.
const contextLossHandlers = [];
function onContextLoss(fn) { contextLossHandlers.push(fn); }

function handleContextLoss() {
  if (contextLost) return;
  contextLost = true;
  for (const fn of contextLossHandlers) {
    try { fn(); } catch (e) { /* один сломанный модуль не должен мешать остальным */ }
  }
  console.warn('[GBF] Расширение было перезагружено — этот скрипт остановлен. Обновите страницу (F5), чтобы продолжить.');
}

// Отправка без ожидания ответа
function safeSend(msg) {
  if (!isExtensionAlive()) { handleContextLoss(); return false; }
  try {
    const p = chrome.runtime.sendMessage(msg);
    if (p && typeof p.catch === 'function') p.catch(() => { });
    return true;
  } catch (e) {
    handleContextLoss();
    return false;
  }
}

// Отправка с ответом — возвращает null, если контекст мёртв
async function safeSendAsync(msg) {
  if (!isExtensionAlive()) { handleContextLoss(); return null; }
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch (e) {
    handleContextLoss();
    return null;
  }
}

// Отправка с колбэком (для GET_STATE и подобных)
function safeSendCallback(msg, cb) {
  if (!isExtensionAlive()) { handleContextLoss(); return; }
  try {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) return; // канал закрылся — просто выходим
      cb(resp);
    });
  } catch (e) {
    handleContextLoss();
  }
}

function safeStorageSet(area, obj) {
  if (!isExtensionAlive()) { handleContextLoss(); return; }
  try {
    const p = chrome.storage[area].set(obj);
    if (p && typeof p.catch === 'function') p.catch(() => { });
  } catch (e) {
    handleContextLoss();
  }
}

// ── GBF Loot Extension Logic ────────────
// Строгая проверка ID: сообщения приходят из мира страницы (window.postMessage),
// поэтому любой скрипт на странице может их подделать. Без валидации ключей
// вредоносный код мог бы перезаписать произвольные ключи chrome.storage
// (например syncToken или patterns).
const GBF_ID_RE = /^\d{1,16}$/;

const itemMap = item => {
    return {
        count: Number(item.count) || 0,
        id: String(item.id ?? '').slice(0, 32),
        name: String(item.name ?? '').slice(0, 120),
        type: String(item.type ?? '').slice(0, 32)
    };
};

window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    // Страница шлёт сообщения постоянно — без этой проверки после перезагрузки
    // расширения каждое из них сыпало бы «Extension context invalidated»
    if (!isExtensionAlive()) { handleContextLoss(); return; }

    if (data.command) {
        switch (data.command) {
            case "MESSAGE":
                console.log(data.message);
                break;
            case "GACHA_CAPTURE": {
                // Сообщение пришло из мира страницы, доверять ему нельзя:
                // пропускаем только ожидаемые поля и ограничиваем размер.
                const e = data.entry;
                if (!e || typeof e !== 'object') return;
                const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : null;
                safeSend({
                    type: 'GACHA_CAPTURED',
                    entry: {
                        ts: Number(e.ts) || Date.now(),
                        via: str(e.via, 8),
                        method: str(e.method, 8),
                        url: str(e.url, 500),
                        status: Number(e.status) || 0,
                        request: str(e.request, 100100),
                        response: str(e.response, 100100),
                    },
                });
                break;
            }
            case "DEBUG_CAPTURE": {
                // Тот же разбор, что и у GACHA_CAPTURE: сообщение пришло из мира
                // страницы, поэтому пропускаем только ожидаемые поля.
                const e = data.entry;
                if (!e || typeof e !== 'object') return;
                const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : null;
                safeSend({
                    type: 'DEBUG_CAPTURED',
                    entry: {
                        ts: Number(e.ts) || Date.now(),
                        via: str(e.via, 8),
                        method: str(e.method, 8),
                        url: str(e.url, 500),
                        status: Number(e.status) || 0,
                        request: str(e.request, 200100),
                        response: str(e.response, 200100),
                    },
                });
                break;
            }
            case "ADD_PENDING": {
                const raidId = String(data.raid_id ?? '');
                const questId = String(data.quest_id ?? '');
                if (!GBF_ID_RE.test(raidId) || !GBF_ID_RE.test(questId)) return;
                chrome.storage.session.set({ [raidId]: questId });
                break;
            }
            case "RESOLVE_PENDING":
                console.log("[GBF Loot] RESOLVE_PENDING", data);
                if (!GBF_ID_RE.test(String(data.raid_id ?? ''))) return;
                chrome.storage.session.get(data.raid_id).then(r => {
                    if (Object.keys(r).length === 0) {
                        console.log("[GBF Loot] Raid ID could not be found! Either it was already processed or the results page URL format changed.");
                        return;
                    }
                    r = r[data.raid_id];
                    chrome.storage.session.remove(data.raid_id);
                    if (!GBF_ID_RE.test(String(r ?? ''))) return;
                    chrome.storage.local.get({ [r]: {} }).then(t => {
                        t = t[r];
                        const loot = {};
                        for (let key in data.loot) {
                            if (!/^\d{1,3}$/.test(key)) continue;
                            if (data.loot[key] && typeof data.loot[key] === 'object' && Object.keys(data.loot[key]).length > 0) {
                                loot[key] = Object.values(data.loot[key]).map(itemMap);
                            }
                        }
                        if (Array.isArray(data.artifacts)) {
                            data.artifacts.forEach((a) => {
                                if (!a || typeof a !== 'object') return;
                                if (!loot[90]) loot[90] = [];
                                loot[90].push({
                                    name: String(a.name ?? '').slice(0, 120),
                                    details: String(a.artifact_param ?? '').slice(0, 200)
                                });
                            });
                        }
                        t[data.raid_id] = loot;
                        chrome.storage.local.set({ [r]: t });
                    });
                });
                break;
            case "UPDATE_ICON":
                // Not updating icon for now as requested
                break;
        }
    }
});

// ── Подгрузка модуля автокликера ──────────────────────────────────────────
// Фон сам решает, есть ли папка clicker/. Если нет — сообщение просто
// останется без ответа и страница продолжит работать без кликера.
if (isExtensionAlive()) {
  try {
    chrome.runtime.sendMessage({ type: 'INIT_CLICKER_CONTENT' }).catch(() => { });
  } catch (e) { /* контекст мёртв — не мешаем странице */ }
}
