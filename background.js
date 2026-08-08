// ── GBF Helper: фоновый service worker ───────────────────────────────────
// Автокликер вынесен в папку clicker/ и подключается в самом низу файла.
// Если папки нет — расширение работает как Loot Tracker + Evoker Calc.

// Разрешаем контент-скриптам доступ к chrome.storage.session
// Без этого ADD_PENDING не будет записываться и RESOLVE_PENDING не найдет рейд
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });

// Функция для безопасного открытия окна с проверкой границ экрана
async function createInSavedPos(url, type, defaultWidth, defaultHeight) {
  return new Promise((resolve) => {
    const storageKey = `win_pos_${type}`;
    chrome.storage.local.get([storageKey], async (res) => {
      let left = undefined;
      let top = undefined;
      let width = defaultWidth;
      let height = defaultHeight;

      if (res[storageKey]) {
        left = Math.max(0, res[storageKey].left);
        top = Math.max(0, res[storageKey].top);
        width = res[storageKey].width || defaultWidth;
        height = res[storageKey].height || defaultHeight;

        let isVisible = false;
        try {
          const displays = await chrome.system.display.getInfo();
          for (const display of displays) {
            const wa = display.workArea;
            const centerX = left + (width / 2);
            const centerY = top + (height / 2);
            if (centerX >= wa.left && centerX <= wa.left + wa.width &&
              centerY >= wa.top && centerY <= wa.top + wa.height) {
              isVisible = true; break;
            }
          }
        } catch (e) { isVisible = true; } // Если нет прав system.display

        if (!isVisible) {
          left = undefined;
          top = undefined;
        }
      }

      chrome.windows.create({
        url: chrome.runtime.getURL(url),
        type: "popup",
        width: width,
        height: height,
        left: left,
        top: top,
        focused: true
      }, resolve);
    });
  });
}

// Слушатель для сохранения позиции и РАЗМЕРА при перемещении/ресайзе
chrome.windows.onBoundsChanged.addListener((win) => {
  chrome.tabs.query({ windowId: win.id }, (tabs) => {
    if (tabs.length > 0 && tabs[0].url) {
      const url = tabs[0].url;
      let type = null;
      if (url.includes('calcevoker')) type = 'calcevoker';
      if (url.includes('loot.html')) type = 'loot';
      if (url.includes('gacha.html')) type = 'gacha';

      if (type && win.state === 'normal') {
        chrome.storage.local.set({
          [`win_pos_${type}`]: {
            left: win.left,
            top: win.top,
            width: win.width,
            height: win.height
          }
        });
      }
    }
  });
});

// ── Открытие окон инструментов ──────────────────────
function handleWindowMessage(msg) {
  if (msg.type === 'OPEN_CALC') {
    chrome.windows.getAll({ populate: true }, (windows) => {
      const existing = windows.find(w => w.tabs.some(t => t.url.includes('calcevoker.html')));
      if (existing) {
        chrome.windows.update(existing.id, { focused: true });
      } else {
        createInSavedPos('calcevoker.html', 'calcevoker', 400, 600);
      }
    });
    return;
  }
  if (msg.type === 'OPEN_LOOT') {
    chrome.windows.getAll({ populate: true }, (windows) => {
      const existing = windows.find(w => w.tabs.some(t => t.url.includes('loot.html')));
      if (existing) {
        chrome.windows.update(existing.id, { focused: true });
      } else {
        createInSavedPos('loot.html', 'loot', 450, 600);
      }
    });
    return;
  }

  if (msg.type === 'OPEN_GACHA') {
    chrome.windows.getAll({ populate: true }, (windows) => {
      const existing = windows.find(w => w.tabs.some(t => t.url.includes('gacha.html')));
      if (existing) {
        chrome.windows.update(existing.id, { focused: true });
      } else {
        createInSavedPos('gacha.html', 'gacha', 620, 700);
      }
    });
    return;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OPEN_CALC' || msg.type === 'OPEN_LOOT' || msg.type === 'OPEN_GACHA') {
    handleWindowMessage(msg);
    return;
  }

  if (msg.type === 'GACHA_CAPTURED' && sender.tab) {
    // Разбор идёт всегда, сырой лог — только когда включена отладка
    ingestGachaResponse(msg.entry?.url, msg.entry?.response, msg.entry?.ts);
    appendGachaCapture(msg.entry);
    return;
  }

  if (msg.type === 'GACHA_SET_CAPTURE') {
    chrome.storage.local.set({ gachaCaptureEnabled: !!msg.enabled }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  // Панель popup спрашивает, показывать ли кнопку Auto-Clicker
  if (msg.type === 'CLICKER_AVAILABLE') {
    sendResponse({ available: CLICKER_AVAILABLE });
    return true;
  }

  // content.js просит доинжектить кликер в свой фрейм
  if (msg.type === 'INIT_CLICKER_CONTENT') {
    if (!CLICKER_AVAILABLE || !sender.tab) return;
    const target = { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] };
    chrome.scripting.insertCSS({ target, files: ['clicker/clicker.css'] }).catch(() => { });
    chrome.scripting.executeScript({ target, files: ['clicker/content-clicker.js'] })
      .catch((e) => console.warn('[GBF] Не удалось внедрить кликер:', e.message));
    return;
  }
});

// ── Захват gacha-трафика ─────────────────────────────────────────────────────
// Временный диагностический слой: пишем сырые запросы под /gacha/ вместе с
// телами ответов, чтобы построить автотрекер по реальным данным, а не по
// угаданным именам полей. Включается вручную и по умолчанию выключен.
const GACHA_LOG_KEY = 'gachaCaptureLog';
const GACHA_MAX_ENTRIES = 120;
const GACHA_MAX_BYTES = 3 * 1024 * 1024;

// Записи прилетают пачками (10-крутка = несколько запросов подряд), а
// storage.get/set асинхронный — без очереди части лога затирали бы друг друга.
let gachaWriteQueue = Promise.resolve();

function appendGachaCapture(entry) {
  if (!entry || typeof entry !== 'object') return;
  gachaWriteQueue = gachaWriteQueue.then(() => new Promise((resolve) => {
    chrome.storage.local.get([GACHA_LOG_KEY, 'gachaCaptureEnabled'], (res) => {
      if (!res.gachaCaptureEnabled) return resolve();
      let log = Array.isArray(res[GACHA_LOG_KEY]) ? res[GACHA_LOG_KEY] : [];
      log.push(entry);
      if (log.length > GACHA_MAX_ENTRIES) log = log.slice(-GACHA_MAX_ENTRIES);
      // Отбрасываем самые старые записи, пока лог не влезет в лимит
      while (log.length > 1 && JSON.stringify(log).length > GACHA_MAX_BYTES) log.shift();
      chrome.storage.local.set({ [GACHA_LOG_KEY]: log }, resolve);
    });
  })).catch(() => { });
}

// Хук живёт в отдельном файле и регистрируется как постоянный контент-скрипт
// на document_start. Через executeScript по событию загрузки было нельзя:
// после крутки за кристаллы страница перезагружается, и запрос результата
// уходит раньше, чем встанет хук, поставленный асинхронно после чтения флага.
const GACHA_SCRIPT_ID = 'gbf-gacha-capture';

async function setGachaHookRegistered(enabled) {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [GACHA_SCRIPT_ID] });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [GACHA_SCRIPT_ID] });
  } catch (e) { /* не был зарегистрирован */ }

  if (!enabled) return;

  try {
    await chrome.scripting.registerContentScripts([{
      id: GACHA_SCRIPT_ID,
      matches: ['*://game.granbluefantasy.jp/*'],
      js: ['gacha-hook.js'],
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: true,
      persistAcrossSessions: true,
    }]);
  } catch (e) {
    console.warn('[GBF] Не удалось зарегистрировать хук гачи:', e.message);
  }
}

// Уже открытые вкладки хук из registerContentScripts не догонит — досылаем.
// Ранние запросы там всё равно пропущены, но для ручной крутки этого хватает.
function injectGachaHookIntoOpenTabs() {
  chrome.tabs.query({ url: '*://game.granbluefantasy.jp/*' }, (tabs) => {
    for (const t of tabs) {
      chrome.scripting.executeScript({
        target: { tabId: t.id, allFrames: true },
        world: 'MAIN',
        files: ['gacha-hook.js'],
      }).catch(() => { });
    }
  });
}

// Хук нужен всегда: на нём держится автозапись круток. Флаг gachaCaptureEnabled
// управляет только сырым логом для отладки, а не самим перехватом.
// Регистрация действует со следующей загрузки страницы, поэтому уже открытые
// вкладки досылаем вручную — иначе после установки расширения кликер увидит
// крутки только после F5.
setGachaHookRegistered(true).then(injectGachaHookIntoOpenTabs);

// ── Разбор круток гачи ───────────────────────────────────────────────────────
const GACHA_DATA_KEY = 'gachaTracker';
const GACHA_DEFAULT_CEILING = 300;

// "2026/8/4 19:00" -> epoch ms. JST это всегда UTC+9: Япония не переходит на
// летнее время, поэтому смещение фиксированное и обратное преобразование точно.
function parseJstDateTime(s) {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) - 9, Number(m[5]));
}

// /gacha/result//legend/{gacha_id}          -> кристаллы
// /gacha/result//legend/{gacha_id}/{ticket} -> тикет
function classifyDrawSource(url) {
  const path = String(url || '').split('?')[0];
  const parts = path.split('/').filter(Boolean);
  const i = parts.indexOf('result');
  if (i < 0) return { source: 'unknown', ticketId: null };
  // после 'result' идут [type, gacha_id] и опционально [ticket_id]
  const tail = parts.slice(i + 1);
  if (tail.length >= 3) return { source: 'ticket', ticketId: tail[2] };
  return { source: 'crystal', ticketId: null };
}

function sanitizeItems(result) {
  if (!Array.isArray(result)) return [];
  return result.slice(0, 50).map((r) => ({
    name: String(r?.reward_name ?? '').slice(0, 120),
    rarity: String(r?.reward_rare ?? '').slice(0, 16),
    type: String(r?.reward_type ?? '').slice(0, 16),
    id: String(r?.reward_id ?? '').slice(0, 32),
    isNew: !!r?.is_new,
  }));
}

let gachaDataQueue = Promise.resolve();

// Любой ответ гачи несёт ceiling — по нему заводим период. Ответы с result[]
// дополнительно дают саму крутку.
function ingestGachaResponse(url, bodyText, ts) {
  let j;
  try { j = JSON.parse(bodyText); } catch (e) { return; }
  if (!j || typeof j !== 'object' || !j.ceiling) return;

  const startUtc = parseJstDateTime(j.ceiling.start);
  const endUtc = parseJstDateTime(j.ceiling.end);
  if (startUtc == null || endUtc == null) return;

  const key = `${j.ceiling.start}|${j.ceiling.end}`;
  const useCount = Number(j.ceiling.use_count);
  const isDraw = /\/gacha\/result\//.test(String(url)) && Array.isArray(j.result) && j.result.length > 0;

  gachaDataQueue = gachaDataQueue.then(() => new Promise((resolve) => {
    chrome.storage.local.get([GACHA_DATA_KEY], (res) => {
      const data = (res[GACHA_DATA_KEY] && typeof res[GACHA_DATA_KEY] === 'object')
        ? res[GACHA_DATA_KEY] : { periods: {} };
      if (!data.periods) data.periods = {};

      const p = data.periods[key] || {
        key, startUtc, endUtc,
        name: String(j.ceiling.name || '').slice(0, 80),
        ceilingTarget: GACHA_DEFAULT_CEILING,
        useCount: 0, useCountTs: 0, draws: [], spark: null,
      };
      p.startUtc = startUtc;
      p.endUtc = endUtc;
      if (j.ceiling.name) p.name = String(j.ceiling.name).slice(0, 80);

      // use_count — счётчик самой игры, он главнее нашей суммы: учитывает
      // крутки с телефона и до установки расширения. Ответы могут прийти не
      // по порядку (импорт лога, гонка воркера), поэтому запоминаем время
      // наблюдения и не даём старому ответу затереть свежий.
      const seenAt = Number(ts) || Date.now();
      if (Number.isFinite(useCount) && seenAt >= (p.useCountTs || 0)) {
        p.useCount = useCount;
        p.useCountTs = seenAt;
      }

      if (isDraw) {
        const { source, ticketId } = classifyDrawSource(url);
        const g = Array.isArray(j.gacha) ? j.gacha[0] : null;
        const draw = {
          ts: Number(ts) || Date.now(),
          gachaId: String(g?.id ?? '').slice(0, 24),
          gachaName: String(g?.name ?? '').slice(0, 80),
          source, ticketId,
          count: Number(j.count) || j.result.length,
          unitPrice: Number(g?.unit_price) || null,
          stoneAfter: Number(j.stone_num) || null,
          items: sanitizeItems(j.result),
        };
        // Один и тот же ответ может прийти дважды (перезагрузка экрана
        // результата) — отсекаем по времени и составу
        const dup = p.draws.some((d) => Math.abs(d.ts - draw.ts) < 4000
          && d.count === draw.count && d.gachaId === draw.gachaId);
        if (!dup) p.draws.push(draw);
        if (p.draws.length > 2000) p.draws = p.draws.slice(-2000);
      }

      data.periods[key] = p;
      chrome.storage.local.set({ [GACHA_DATA_KEY]: data }, resolve);
    });
  })).catch(() => { });
}

// ── Перехват результатов боя для Loot Tracker ───────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab && tab.url && tab.url.includes("granbluefantasy.jp")) {
    if (changeInfo.status === 'loading') {
      chrome.scripting.executeScript({
        target: {tabId: tabId},
        world: "MAIN",
        func: () => {
          if (window.XMLHttpRequest.mutatedGbfLoot) return;
          window.XMLHttpRequest.mutatedGbfLoot = true;
          const oldXHRSend = window.XMLHttpRequest.prototype.send;
          window.XMLHttpRequest.prototype.send = function() {  
            this.addEventListener("load", function() {
              if (this.responseURL && this.responseURL.includes("start.json") && this.response) {
                try {
                  const responseBody = JSON.parse(this.response);
                  window.postMessage({command: "ADD_PENDING", quest_id: responseBody.quest_id, raid_id: responseBody.raid_id}, '*');
                } catch(e) {}
              }
            });
            return oldXHRSend.apply(this, arguments);
          };
        }
      }).catch(() => {});
    }

    if (changeInfo.status === 'complete' && tab.url.includes('/#result')) {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: 'MAIN',
        func: () => {
          const checkGameLoaded = () => {
            if (window.Game && window.Game.view && window.Game.view.resultJsonData !== undefined) {
              const message = {
                command: "RESOLVE_PENDING",
                raid_id: window.location.hash.replace("#result_multi/","").replace("#result/",""),
                loot: window.Game.view.resultJsonData.rewards.reward_list,
                artifacts: window.Game.view.resultJsonData.rewards.artifact_list || []
              }
              if (message.raid_id.includes("detail")) {
                message.raid_id = message.raid_id.replace("detail/", "").replace("/1","");
              }
              window.postMessage(message, '*');
              return true;
            }
            return false;
          };

          const maxChecks = 200;
          let currentChecks = 0;
          if (!checkGameLoaded()) {
            const intervalId = setInterval(() => {
              currentChecks++;
              if (currentChecks >= maxChecks) {
                clearInterval(intervalId);
              }
              if (checkGameLoaded()) {
                clearInterval(intervalId);
              }
            }, 100);
          }
        }
      }).catch(() => {});
    }
  }
});

// ─── Sync Manager ─────────────────────────────────────────────────────────────
const API_URL = 'https://gbf.keka312.com';
let syncState = { token: null, username: null };
let autoUploadTimer = null;
let suppressAutoUpload = false;

// Initialize sync state from storage
chrome.storage.local.get(['syncToken', 'syncUser'], (res) => {
  if (res.syncToken) syncState.token = res.syncToken;
  if (res.syncUser) syncState.username = res.syncUser;
  if (syncState.token) {
    // Only download once per browser session to prevent overwriting local data on worker wake-up.
    // Флаг выставляется только при успехе — если попытка упадёт (сеть, сервер),
    // следующее пробуждение service worker'а попробует снова, а не молчит до
    // перезапуска браузера.
    chrome.storage.session.get(['hasDownloadedOnce'], (sessionRes) => {
      if (!sessionRes.hasDownloadedOnce) {
        autoDownloadOnce().then((ok) => {
          if (ok) chrome.storage.session.set({ hasDownloadedOnce: true });
        });
      }
    });
  }
});

function broadcastSyncStatus(msg, isError = false) {
  chrome.runtime.sendMessage({ type: 'SYNC_STATUS', message: msg, isError }).catch(() => {});
}

// Ошибка API с сохранением HTTP-статуса — по нему, а не по тексту сообщения,
// решаем, протух ли токен
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function callApi(path, payload, token = null) {
  const url = API_URL.replace(/\/+$/, '') + path;
  const options = {
    method: payload ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' }
  };
  if (token) options.headers['Authorization'] = token;
  if (payload) options.body = JSON.stringify(payload);

  let res;
  try {
    res = await fetch(url, options);
  } catch (e) {
    // Сеть недоступна / DNS / TLS
    throw new ApiError('Server unreachable — check your connection', 0);
  }

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { }

  if (!res.ok) {
    // Не тащим в лог HTML-страницы ошибок от nginx — только осмысленный текст
    let msg = json?.error || json?.message;
    if (!msg) {
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        msg = `Sync server is down (HTTP ${res.status})`;
      } else {
        msg = `HTTP ${res.status}`;
      }
    }
    throw new ApiError(String(msg).slice(0, 200), res.status);
  }
  return json;
}

// Токен считаем недействительным только при явном 401 от сервера
function handleApiError(e, context) {
  if (e instanceof ApiError && e.status === 401) {
    syncState.token = null;
    chrome.storage.local.remove('syncToken');
    broadcastSyncStatus('Session expired — sign in again', true);
  }
  console.warn(`[GBF Sync] ${context}:`, e.message);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SYNC_GET_STATE') {
    sendResponse(syncState);
    return true;
  }
  
  if (msg.type === 'SYNC_LOGIN') {
    callApi('/api/login', { username: msg.username, password: msg.password })
      .then(res => {
        syncState.token = res.token;
        syncState.username = msg.username;
        chrome.storage.local.set({ syncToken: res.token, syncUser: msg.username });
        broadcastSyncStatus(`Signed in as ${msg.username}`);
        autoDownloadOnce();
      })
      .catch(e => broadcastSyncStatus(e.message, true));
  }

  if (msg.type === 'SYNC_REGISTER') {
    callApi('/api/register', { username: msg.username, password: msg.password })
      .then(() => {
        broadcastSyncStatus('Account created — signing in...');
        return callApi('/api/login', { username: msg.username, password: msg.password });
      })
      .then(res => {
        syncState.token = res.token;
        syncState.username = msg.username;
        chrome.storage.local.set({ syncToken: res.token, syncUser: msg.username });
        broadcastSyncStatus(`Signed in as ${msg.username}`);
        autoDownloadOnce();
      })
      .catch(e => broadcastSyncStatus(e.message, true));
  }

  if (msg.type === 'SYNC_DOWNLOAD') {
    if (!syncState.token) {
      broadcastSyncStatus('Not signed in', true);
      return;
    }
    broadcastSyncStatus('Syncing...');
    autoDownloadOnce().then((ok) => {
      if (ok) {
        chrome.storage.session.set({ hasDownloadedOnce: true });
        broadcastSyncStatus('Synced from cloud');
      } else {
        broadcastSyncStatus('Sync failed — see console', true);
      }
    });
  }
});

// Auto download state from server once. Returns true on success so callers
// know whether it's safe to mark the download as done.
async function autoDownloadOnce() {
  if (!syncState.token) return false;
  try {
    suppressAutoUpload = true;
    const r = await callApi('/api/sync', null, syncState.token);
    if (r && r.data) {
      const updates = {};

      // Load CalcData
      if (r.data.calcData) {
        updates['calcEvokerState2'] = r.data.calcData;
      }

      // Load LootData — принимаем только числовые ключи рейдов, чтобы данные
      // с сервера не могли перезаписать служебные ключи (patterns, syncToken и т.д.)
      if (r.data.lootData && typeof r.data.lootData === 'object') {
        for (let k in r.data.lootData) {
          if (/^\d+$/.test(k)) updates[k] = r.data.lootData[k];
        }
      }

      // Gacha — сливаем с локальным, а не перезаписываем. Ветка работает и при
      // пустом ответе сервера: тогда все локальные периоды опознаются как
      // отсутствующие на сервере и уезжают туда — это же путь миграции при
      // первом запуске после обновления.
      let gachaPush = [];
      {
        const cur = await new Promise(res => chrome.storage.local.get([GACHA_DATA_KEY], res));
        const { data: merged, changed } = mergeGachaData(cur[GACHA_DATA_KEY], r.data.gachaData);
        if (Object.keys(merged.periods).length > 0) {
          updates[GACHA_DATA_KEY] = merged;
          gachaPush = changed.map((k) => [k, merged.periods[k]]);
        }
      }

      if (Object.keys(updates).length > 0) {
        await new Promise(res => chrome.storage.local.set(updates, res));
      }

      // Локальные крутки, которых на сервере не было, отправляем сразу:
      // suppressAutoUpload глушит только слушатель onChanged, явный вызов — нет
      for (const [key, period] of gachaPush) {
        await uploadGachaPeriod(key, period);
      }
    }
    return true;
  } catch (e) {
    handleApiError(e, 'Download failed');
    return false;
  } finally {
    suppressAutoUpload = false;
  }
}

// Upload only calc data (small, send full)
async function uploadCalcData() {
  if (!syncState.token) return;
  try {
    const res = await new Promise(r => chrome.storage.local.get(['calcEvokerState2'], r));
    if (!res.calcEvokerState2) return;
    await callApi('/api/sync', { data: { calcData: res.calcEvokerState2 } }, syncState.token);
  } catch (e) {
    handleApiError(e, 'Calc upload failed');
  }
}

// Upload a single gacha period incrementally
async function uploadGachaPeriod(periodKey, data) {
  if (!syncState.token) return;
  try {
    await callApi('/api/sync/gacha', { periodKey, data }, syncState.token);
    console.log('[GBF Sync] Gacha period uploaded:', periodKey);
  } catch (e) {
    handleApiError(e, `Gacha period ${periodKey} upload failed`);
  }
}

// Крутки — история, которая только дополняется, поэтому периоды с сервера
// сливаются с локальными, а не затирают их (как это делает лут). Иначе крутки,
// записанные локально, но не доехавшие до сервера (офлайн, вторая машина),
// пропали бы при первой же загрузке.
function mergeDraws(localDraws, remoteDraws) {
  const all = []
    .concat(Array.isArray(localDraws) ? localDraws : [])
    .concat(Array.isArray(remoteDraws) ? remoteDraws : [])
    .filter((d) => d && typeof d === 'object')
    .sort((x, y) => (Number(x.ts) || 0) - (Number(y.ts) || 0));

  // Правило дубля то же, что при записи в ingestGachaResponse: один и тот же
  // ответ игры может прийти дважды с чуть разным временем.
  const out = [];
  for (const d of all) {
    const ts = Number(d.ts) || 0;
    let dup = false;
    for (let i = out.length - 1; i >= 0; i--) {
      if (ts - (Number(out[i].ts) || 0) >= 4000) break; // список отсортирован
      if (out[i].count === d.count && out[i].gachaId === d.gachaId) { dup = true; break; }
    }
    if (!dup) out.push(d);
  }
  return out.length > 2000 ? out.slice(-2000) : out;
}

// Приводит период к каноническому виду: одинаковый порядок и набор полей,
// крутки отсортированы и без дублей. Нужно, чтобы сравнение через JSON.stringify
// отвечало на вопрос «данные различаются», а не «объекты собраны по-разному».
function normalizeGachaPeriod(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    key: p.key || '',
    startUtc: p.startUtc ?? null,
    endUtc: p.endUtc ?? null,
    name: p.name || '',
    ceilingTarget: Number(p.ceilingTarget) || GACHA_DEFAULT_CEILING,
    useCount: Number(p.useCount) || 0,
    useCountTs: Number(p.useCountTs) || 0,
    spark: p.spark || null,
    draws: mergeDraws(p.draws, []),
  };
}

function mergeGachaPeriod(local, remote) {
  if (!local || typeof local !== 'object') return normalizeGachaPeriod(remote);
  if (!remote || typeof remote !== 'object') return normalizeGachaPeriod(local);

  // use_count — счётчик игры; побеждает более свежее наблюдение, ровно как
  // при записи ответа
  const newer = (Number(remote.useCountTs) || 0) > (Number(local.useCountTs) || 0) ? remote : local;
  const sparkNewer = (Number(remote.spark?.ts) || 0) > (Number(local.spark?.ts) || 0)
    ? remote.spark : local.spark;

  return {
    key: local.key || remote.key,
    startUtc: newer.startUtc ?? local.startUtc ?? remote.startUtc,
    endUtc: newer.endUtc ?? local.endUtc ?? remote.endUtc,
    name: newer.name || local.name || remote.name || '',
    ceilingTarget: Number(local.ceilingTarget) || Number(remote.ceilingTarget) || GACHA_DEFAULT_CEILING,
    useCount: Number(newer.useCount) || 0,
    useCountTs: Number(newer.useCountTs) || 0,
    spark: sparkNewer || null,
    draws: mergeDraws(local.draws, remote.draws),
  };
}


// Возвращает слитый трекер и список периодов, которые после слияния отличаются
// от серверных — их нужно отправить обратно, иначе локальные крутки останутся
// только на этой машине.
function mergeGachaData(localData, remoteData) {
  const localPeriods = (localData && typeof localData === 'object' && localData.periods) || {};
  const remotePeriods = (remoteData && typeof remoteData === 'object' && remoteData.periods) || {};

  const periods = {};
  const changed = [];
  for (const key of new Set(Object.keys(localPeriods).concat(Object.keys(remotePeriods)))) {
    const merged = mergeGachaPeriod(localPeriods[key], remotePeriods[key]);
    if (!merged) continue;
    periods[key] = merged;
    // Сравниваем с серверным периодом в том же каноническом виде, иначе разный
    // порядок полей выглядел бы как изменение и мы бы заливали всё подряд
    if (JSON.stringify(merged) !== JSON.stringify(normalizeGachaPeriod(remotePeriods[key]))) {
      changed.push(key);
    }
  }
  return { data: { periods }, changed };
}

// Upload a single raid's data incrementally
async function uploadRaid(raidId, data) {
  if (!syncState.token) return;
  try {
    await callApi('/api/sync/raid', { raidId, data }, syncState.token);
    console.log('[GBF Sync] Raid uploaded:', raidId);
  } catch (e) {
    handleApiError(e, `Raid ${raidId} upload failed`);
  }
}

// Full loot upload — only used on first login to push all existing local data
async function doAutoUpload() {
  if (!syncState.token) return;
  try {
    const res = await new Promise(r => chrome.storage.local.get(null, r));
    const lootData = {};
    for (let k in res) {
      if (/^\d+$/.test(k)) lootData[k] = res[k];
    }
    const calcData = res.calcEvokerState2 || null;
    const gachaData = res[GACHA_DATA_KEY] || null;
    await callApi('/api/sync', { data: { calcData, lootData, gachaData } }, syncState.token);
    console.log('[GBF Sync] Full upload done');
  } catch (e) {
    handleApiError(e, 'Full upload failed');
  }
}

let calcUploadTimer = null;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || suppressAutoUpload || !syncState.token) return;

  // Calc data changed — debounce and upload full calc state
  if (changes.calcEvokerState2) {
    clearTimeout(calcUploadTimer);
    calcUploadTimer = setTimeout(uploadCalcData, 3000);
  }

  // Raid data changed — upload only that specific raid immediately
  for (let k in changes) {
    if (/^\d+$/.test(k)) {
      const newVal = changes[k].newValue ?? null;
      uploadRaid(k, newVal);
    }
  }

  // Gacha data changed — заливаем только изменившиеся периоды. Весь трекер
  // гонять нельзя: в нём накапливаются все периоды со всеми крутками.
  if (changes[GACHA_DATA_KEY]) {
    const before = changes[GACHA_DATA_KEY].oldValue?.periods || {};
    const after = changes[GACHA_DATA_KEY].newValue?.periods || {};
    for (const key in after) {
      if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) {
        uploadGachaPeriod(key, after[key]);
      }
    }
    for (const key in before) {
      if (!(key in after)) uploadGachaPeriod(key, null);
    }
  }
});


// ── Обновление по кнопке (режим "Load unpacked") ─────────────────────────
// Chrome не проверяет update_url для расширений, загруженных не из Web Store,
// а само расширение не имеет доступа к файловой системе своей папки и обновить
// себя не может. Поэтому просто сравниваем свою версию с manifest.json в ветке
// main на гитхабе и, если там новее, открываем страницу последнего релиза —
// качает и перезагружает расширение пользователь.
const REPO_URL        = 'https://github.com/neo21400/gbf-helper/releases/latest';
const REMOTE_MANIFEST = 'https://raw.githubusercontent.com/neo21400/gbf-helper/main/manifest.json';

// Сравнение по числам, а не по строкам: "1.10" новее "1.9".
function compareVersions(a, b) {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number(pa[i]) || 0;
    const y = Number(pb[i]) || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'CHECK_UPDATE') return;

  const currentVersion = chrome.runtime.getManifest().version;
  // raw.githubusercontent отдаёт закешированный ответ несколько минут — сбиваем
  // кеш меткой времени, иначе сразу после релиза кнопка врёт "up to date".
  fetch(`${REMOTE_MANIFEST}?t=${Date.now()}`, { cache: 'no-store' })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((remote) => {
      const latest = remote && remote.version;
      if (!latest) throw new Error('в манифесте на гитхабе нет version');
      const newer = compareVersions(latest, currentVersion) > 0;
      sendResponse({ ok: true, current: currentVersion, latest, newer, url: REPO_URL });
      if (newer) chrome.tabs.create({ url: REPO_URL });
    })
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));

  return true; // держим канал открытым для асинхронного sendResponse
});

// ── Опциональный модуль: автокликер ──────────────────────────────────────
// importScripts бросает исключение, если файла нет — это и есть переключатель
// сборки. Вызов в самом низу, чтобы кликеру были доступны функции ядра.
let CLICKER_AVAILABLE = false;
try {
  importScripts('clicker/background-clicker.js');
  CLICKER_AVAILABLE = true;
  console.log('[GBF] Модуль автокликера подключён.');
} catch (e) {
  console.log('[GBF] Сборка без автокликера:', e.message);
}
