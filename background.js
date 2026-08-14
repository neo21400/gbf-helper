// ── GBF Helper: фоновый service worker ───────────────────────────────────
// Автокликер вынесен в папку clicker/ и подключается в самом низу файла.
// Если папки нет — расширение работает как Loot Tracker + Evoker Calc.

// Таблица «имя квеста → quest_id» для бэкафилла из истории боёв (см. файл)
importScripts('quest-names.js');

// Разрешаем контент-скриптам доступ к chrome.storage.session
// Без этого ADD_PENDING не будет записываться и RESOLVE_PENDING не найдет рейд
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });

// Chrome не открывает окно, у которого меньше половины площади попадает на
// экран: «Bounds must be at least 50% within visible screen space». Раньше тут
// проверялся только центр окна — этого мало, окно с центром у самой кромки
// экрана проверку не проходит, и открытие молча срывалось. Считаем ту же долю,
// что и Chrome, а не подобие.
//
// Сохранённый размер тоже участвует: после переезда на монитор поменьше окно
// перестаёт помещаться целиком. И отрицательные координаты законны — так лежит
// экран, стоящий слева от основного, поэтому прижимать left к нулю нельзя.
function fitToDisplays(rect, displays) {
  if (!Array.isArray(displays) || !displays.length) return rect;
  const overlap = (r, wa) =>
    Math.max(0, Math.min(r.left + r.width, wa.left + wa.width) - Math.max(r.left, wa.left)) *
    Math.max(0, Math.min(r.top + r.height, wa.top + wa.height) - Math.max(r.top, wa.top));

  let best = null, bestSeen = 0;
  for (const d of displays) {
    const seen = overlap(rect, d.workArea);
    if (seen > bestSeen) { bestSeen = seen; best = d; }
  }
  if (best && bestSeen >= rect.width * rect.height / 2) return rect; // видно больше половины

  // Иначе вдвигаем окно целиком в тот экран, где его видно больше всего, а если
  // не видно нигде (монитор отключили) — в первый, он же обычно основной
  const wa = (best || displays[0]).workArea;
  const width = Math.min(rect.width, wa.width);
  const height = Math.min(rect.height, wa.height);
  return {
    width, height,
    left: Math.min(Math.max(rect.left, wa.left), wa.left + wa.width - width),
    top: Math.min(Math.max(rect.top, wa.top), wa.top + wa.height - height),
  };
}

// Функция для безопасного открытия окна с проверкой границ экрана
async function createInSavedPos(url, type, defaultWidth, defaultHeight) {
  const storageKey = `win_pos_${type}`;
  const saved = (await chrome.storage.local.get(storageKey))[storageKey];
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const base = { url: chrome.runtime.getURL(url), type: 'popup', focused: true };

  let opts = { ...base, width: defaultWidth, height: defaultHeight };
  if (saved && num(saved.left) !== null && num(saved.top) !== null) {
    let rect = {
      left: saved.left, top: saved.top,
      width: num(saved.width) || defaultWidth,
      height: num(saved.height) || defaultHeight,
    };
    try {
      rect = fitToDisplays(rect, await chrome.system.display.getInfo());
    } catch (e) { /* нет прав system.display — пусть решает сам Chrome */ }
    opts = { ...opts, ...rect };
  }

  try {
    return await chrome.windows.create(opts);
  } catch (e) {
    // Экран мог измениться между проверкой и открытием, да и «видимую площадь»
    // Chrome считает по-своему. Окно важнее позиции: открываем размером по
    // умолчанию, где придётся, а негодную позицию забываем — иначе она срывала
    // бы открытие и дальше.
    console.warn('[GBF] Не удалось открыть окно по сохранённой позиции:', e && e.message);
    await chrome.storage.local.remove(storageKey);
    return chrome.windows.create({ ...base, width: defaultWidth, height: defaultHeight });
  }
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

  if (msg.type === 'DEBUG_CAPTURED' && sender.tab) {
    appendDebugCapture(msg.entry);
    return;
  }

  if (msg.type === 'DEBUG_SET_CAPTURE') {
    const enabled = !!msg.enabled;
    chrome.storage.local.set({ debugCaptureEnabled: enabled }, async () => {
      await setDebugHookRegistered(enabled);
      // Уже открытая вкладка иначе ждала бы F5 — а тумблер дёргают именно
      // затем, чтобы сразу пойти щёлкать по игре.
      if (enabled) injectDebugHookIntoOpenTabs();
      sendResponse({ ok: true });
    });
    return true;
  }

  // Импорт истории круток из файла. Слияние идёт тем же кодом, что и загрузка с
  // сервера: у периодов есть счётчик игры и спарк со своими метками времени, и
  // разбирать, что из этого свежее, файл не должен уметь. Заливкой на сервер
  // займётся слушатель onChanged — он сам увидит изменившиеся периоды.
  if (msg.type === 'GACHA_IMPORT') {
    gachaDataQueue = gachaDataQueue.then(() => new Promise((resolve) => {
      chrome.storage.local.get([GACHA_DATA_KEY], (res) => {
        const before = Object.keys((res[GACHA_DATA_KEY] || {}).periods || {}).length;
        const { data } = mergeGachaData(res[GACHA_DATA_KEY], msg.data);
        const total = Object.keys(data.periods).length;
        if (!total) {
          sendResponse({ ok: false, error: 'no periods in file' });
          return resolve();
        }
        chrome.storage.local.set({ [GACHA_DATA_KEY]: data }, () => {
          sendResponse({ ok: true, total, added: total - before });
          resolve();
        });
      });
    }));
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

// ── Захват всего трафика (отладка) ───────────────────────────────────────────
// Временный слой под разбор истории боёв: надо увидеть, каким запросом игра
// отдаёт «バトル履歴» и что в нём лежит. Пишет всё подряд, поэтому включается
// тумблером в Loot Tracker и по умолчанию выключен.
const DEBUG_LOG_KEY = 'debugCaptureLog';
const DEBUG_MAX_ENTRIES = 400;
const DEBUG_MAX_BYTES = 8 * 1024 * 1024;

let debugWriteQueue = Promise.resolve();

function appendDebugCapture(entry) {
  if (!entry || typeof entry !== 'object') return;
  debugWriteQueue = debugWriteQueue.then(() => new Promise((resolve) => {
    chrome.storage.local.get([DEBUG_LOG_KEY, 'debugCaptureEnabled'], (res) => {
      // Флаг проверяем и здесь: хук снимается только со следующей загрузки
      // страницы, так что после выключения записи ещё какое-то время идут.
      if (!res.debugCaptureEnabled) return resolve();
      let log = Array.isArray(res[DEBUG_LOG_KEY]) ? res[DEBUG_LOG_KEY] : [];
      log.push(entry);
      if (log.length > DEBUG_MAX_ENTRIES) log = log.slice(-DEBUG_MAX_ENTRIES);
      while (log.length > 1 && JSON.stringify(log).length > DEBUG_MAX_BYTES) log.shift();
      chrome.storage.local.set({ [DEBUG_LOG_KEY]: log }, resolve);
    });
  }));
}

const DEBUG_SCRIPT_ID = 'gbf-debug-capture';

async function setDebugHookRegistered(enabled) {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [DEBUG_SCRIPT_ID] });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [DEBUG_SCRIPT_ID] });
  } catch (e) { /* не был зарегистрирован */ }

  if (!enabled) return;

  try {
    await chrome.scripting.registerContentScripts([{
      id: DEBUG_SCRIPT_ID,
      matches: ['*://game.granbluefantasy.jp/*'],
      js: ['debug-hook.js'],
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: true,
      persistAcrossSessions: false,
    }]);
  } catch (e) {
    console.warn('[GBF] Не удалось зарегистрировать отладочный хук:', e.message);
  }
}

function injectDebugHookIntoOpenTabs() {
  chrome.tabs.query({ url: '*://game.granbluefantasy.jp/*' }, (tabs) => {
    for (const t of tabs) {
      chrome.scripting.executeScript({
        target: { tabId: t.id, allFrames: true },
        world: 'MAIN',
        files: ['debug-hook.js'],
      }).catch(() => { });
    }
  });
}

// persistAcrossSessions: false — регистрация не переживает перезапуск браузера,
// поэтому поднимаем её из флага при каждом старте фона.
chrome.storage.local.get('debugCaptureEnabled', (res) => {
  if (res.debugCaptureEnabled) setDebugHookRegistered(true);
});

// Панель отладки в трекере спрятана (см. loot.html), поэтому включённую запись
// стало бы нечем выключить: она молча писала бы весь трафик игры дальше. Гасим
// её при установке и обновлении — сам лог не трогаем, это данные.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('debugCaptureEnabled', (res) => {
    if (!res.debugCaptureEnabled) return;
    chrome.storage.local.set({ debugCaptureEnabled: false });
    setDebugHookRegistered(false);
  });
});

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

// ── Бэкафилл лута из истории боёв (バトル履歴) ───────────────────────────────
// Ручной запуск кнопкой из Loot Tracker. quest/battle_history отдаёт бои без
// quest_id — только chapter_name/boss_image, поэтому сопоставление с реальным
// рейдом курируется через UI (historyRaidMap), а не угадывается автоматически.
const HISTORY_MAP_KEY = 'historyRaidMap';
// Версия разбора, которой записан бой. Лежит в самой записи под нечисловым
// ключом — сундуки везде читаются по явным числовым ключам, так что рендеру,
// экспорту и синхронизации она не мешает. Нужна, чтобы отличить записи старого
// разбора (он ставил всем предметам item/article, и у слитков вроде 20004,
// которые лежат под item/evolution, картинка получалась битой) и перечитать их.
// v3: у предметов появился kind (вид) — без него имя по одному id ищется
// неоднозначно, и вместо кольца показывался материал с тем же номером.
const BACKFILL_VERSION = 3;
const HISTORY_CURSOR_KEY = 'historyScanCursor'; // { [uid]: страница }, с которой продолжить полный скан
const HISTORY_CHEST_KEYS = [1, 2, 3, 4, 11, 13, 16, 90]; // держим в синхроне с CHEST_META в loot.js (90 — артефакты)
const HISTORY_RECENT_PAGES = 10; // режим «до первого уже известного» — верхняя граница на всякий случай
// Паузы фиксированные и без разброса. Задержка нужна, чтобы не долбить сервер
// пачкой запросов; рандомизировать её смысла нет — сервер она не бережёт, а
// служила бы только тому, чтобы трафик не выглядел машинным.
const HISTORY_PAGE_DELAY = 700;
const HISTORY_DETAIL_DELAY = 900;

// Имя backfillSleep, а не sleep: clicker/background-clicker.js подключается
// через importScripts() в ту же область видимости и объявляет свой sleep().
async function backfillSleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Ход работы и итог кладём в storage.session, а не отвечаем на исходное
// сообщение: скан идёт минутами, а канал sendResponse столько не живёт — при
// засыпании воркера окно получало бы только lastError без всяких подробностей.
// Заодно прогресс переживает закрытие и повторное открытие окна трекера.
const BACKFILL_STATE_KEY = 'backfillState';

function setBackfillState(patch) {
  return chrome.storage.session.get(BACKFILL_STATE_KEY).then((r) => {
    const prev = r[BACKFILL_STATE_KEY] || {};
    return chrome.storage.session.set({ [BACKFILL_STATE_KEY]: { ...prev, ...patch } });
  }).catch(() => { });
}

function reportBackfillProgress(phase, label, done, total) {
  setBackfillState({ running: phase !== 'done', phase, label, done, total });
}

async function findGameTabId() {
  const tabs = await chrome.tabs.query({ url: '*://game.granbluefantasy.jp/*' });
  return tabs.length ? tabs[0].id : null;
}

// Нужен, чтобы позиция обхода истории хранилась отдельно для каждого аккаунта:
// общий курсор после смены аккаунта просил бы страницу из чужой истории
async function getGameUid(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const g = window.Game || {};
        return String(g.userId ?? g.user_id ?? g.uid ?? '');
      },
    });
    return (results && results[0] && results[0].result) || '';
  } catch (e) { return ''; }
}

// Запрос выполняется в контексте страницы игры: uid лежит в window.Game,
// которого service worker не видит, и там же уже есть нужная сессия.
// Внутри идём через jQuery самой игры — у неё своя настройка ajax, которая
// проставляет служебные заголовки (в частности версию клиента; без неё сервер
// отвечает 409). Восстанавливать этот набор вручную бессмысленно: он меняется
// вместе с игрой, а так запрос собирает тот же код, что и при обычном клике.
async function gameFetch(tabId, path, body) {
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [path, body ?? null],
      func: async (p, payload) => {
        const g = window.Game || {};
        const uid = g.userId ?? g.user_id ?? g.uid ?? '';

        // Путь передаём голым: обвязка игры сама дописывает _, t и uid. Если
        // добавлять их вручную, они уходят дважды.
        // dataType 'json' здесь обязателен: по Accept сервер выбирает формат и
        // на text/plain отдаёт PHP-дамп (var_export) вместо JSON.
        if (window.$ && typeof window.$.ajax === 'function') {
          const opts = { url: p, type: payload ? 'POST' : 'GET', dataType: 'json' };
          if (payload) {
            opts.data = JSON.stringify(payload);
            opts.contentType = 'application/json';
          }
          return new Promise((resolve) => {
            window.$.ajax(opts)
              .done((data) => resolve({ data }))
              // Тело ответа возвращаем и при ошибке: у игры в нём объяснение,
              // без которого HTTP-код ни о чём не говорит
              .fail((xhr, textStatus) => resolve({
                error: `HTTP ${xhr.status} ${textStatus}`,
                body: String(xhr.responseText || '').slice(0, 300),
                uid: uid === '' ? '(empty)' : String(uid),
              }));
          });
        }

        // Запасной путь, если jQuery игры почему-то недоступен
        try {
          const now = Date.now();
          const url = `${p}${p.includes('?') ? '&' : '?'}_=${now}&t=${now}&uid=${uid}`;
          const res = await fetch(url, {
            method: payload ? 'POST' : 'GET',
            credentials: 'same-origin',
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
              'Accept': 'application/json, text/javascript, */*; q=0.01',
              ...(payload ? { 'Content-Type': 'application/json' } : {}),
              ...(g.version ? { 'X-VERSION': String(g.version) } : {}),
            },
            ...(payload ? { body: JSON.stringify(payload) } : {}),
          });
          const text = await res.text();
          if (!res.ok) {
            return {
              error: `HTTP ${res.status}`,
              body: text.slice(0, 300),
              uid: uid === '' ? '(empty)' : String(uid),
            };
          }
          try { return { data: JSON.parse(text) }; }
          catch (e) { return { error: 'response was not JSON', body: text.slice(0, 300) }; }
        } catch (e) { return { error: String(e && e.message || e) }; }
      },
    });
  } catch (e) {
    return { error: 'Could not reach the game tab — reload it and try again.' };
  }
  const out = results && results[0] ? results[0].result : null;
  if (!out) return { error: 'No response from the game tab.' };
  // К ошибке добавляем путь и uid — иначе непонятно, какой из запросов цепочки
  // упал и был ли вообще прочитан uid со страницы
  if (out.error) {
    const parts = [`${out.error} on ${path}`];
    if (out.uid) parts.push(`uid=${out.uid}`);
    if (out.body) parts.push(out.body);
    return { ...out, error: parts.join(' · ') };
  }
  return out;
}

// ── Имена предметов ─────────────────────────────────────────────────────────
// В ответе с деталями боя имён нет вообще — только числовой id, вид (kind) и
// путь к картинке, поэтому лут из истории попадал в трекер как «#534». Имена
// берём с экрана предметов игры: держать их статической таблицей в репозитории
// смысла нет — она устаревала бы с каждым новым рейдом.
//
// Раскладываем сразу по трём ключам, потому что id сам по себе предмет не
// определяет: 1 — это и Blue Sky Crystal (материал, вид 10), и Coronation Ring
// (кольцо мастерства, картинка в item/npcaugment). Поиск по одному id и давал
// кольцу имя материала.
//   byKind — «вид → id → имя», точный ключ, тот же, что у игры в data-key
//   byType — «папка картинки → id → имя», для видов, которых экран не называет
//   byId   — общий запасной, для мест, где сохранён только id (пины)
const ITEM_NAMES_KEY = 'itemNames';
const MATERIAL_KIND = '10';
const MATERIAL_TYPE = 'item/article';

// Вид у предмета лежит под разными именами в зависимости от группы списка
function itemListKind(it) {
  const kind = it.item_kind_id ?? it.item_kind ?? it.kind;
  return /^\d+$/.test(String(kind ?? '')) ? String(kind) : '';
}

// Списки приходят вложенными: recovery_and_evolution отдаёт группы, а внутри
// некоторых лежат ещё массивы (слитки разложены на оружейные и саммонские).
// Обходим рекурсивно и берём всё, у чего есть числовой id и имя.
function collectItemNames(node, out, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 5) return;
  if (Array.isArray(node)) {
    for (const v of node) collectItemNames(v, out, depth + 1);
    return;
  }
  const id = String(node.item_id ?? '');
  const name = String(node.name ?? '');
  if (/^\d+$/.test(id) && name) {
    out.push({ id, name, kind: itemListKind(node), folder: String(node.folder ?? '') });
    return;
  }
  for (const v of Object.values(node)) collectItemNames(v, out, depth + 1);
}

async function refreshItemNames(tabId) {
  // Экран предметов открываем так же, как экран истории — иначе списки пустые
  const idx = await gameFetch(tabId, '/item/content/index');
  if (idx.error) return null;
  await backfillSleep(HISTORY_PAGE_DELAY);

  // Собранное раньше не выбрасываем: списки приходят по частям, и один упавший
  // запрос не должен стирать имена, добытые прошлым сканом
  const stored = (await chrome.storage.local.get(ITEM_NAMES_KEY))[ITEM_NAMES_KEY] || {};
  const byKind = (stored.byKind && typeof stored.byKind === 'object') ? stored.byKind : {};
  const byType = (stored.byType && typeof stored.byType === 'object') ? stored.byType : {};
  const byId = (stored.byId && typeof stored.byId === 'object') ? stored.byId : {};

  const put = (kind, folder, id, name) => {
    if (kind) (byKind[kind] || (byKind[kind] = {}))[id] = name;
    if (folder) (byType[folder] || (byType[folder] = {}))[id] = name;
    // Материалы в общем справочнике главнее: рейдовый лут — почти всегда они
    if (kind === MATERIAL_KIND || !byId[id]) byId[id] = name;
  };

  const article = await gameFetch(tabId, '/item/article_list_by_filter_mode');
  if (!article.error) {
    const found = [];
    collectItemNames(article.data, found);
    for (const it of found) put(MATERIAL_KIND, 'item/article', it.id, it.name);
  }
  await backfillSleep(HISTORY_PAGE_DELAY);

  const eva = await gameFetch(tabId, '/item/recovery_and_evolution_list_by_filter_mode');
  if (!eva.error) {
    const found = [];
    collectItemNames(eva.data, found);
    for (const it of found) put(it.kind, it.folder, it.id, it.name);
  }

  const total = Object.keys(byId).length;
  if (!total) return null;
  await chrome.storage.local.set({ [ITEM_NAMES_KEY]: { byKind, byType, byId, updatedAt: Date.now() } });
  return total;
}

// Экран предметов знает не всё: плюс-марки, кольца мастерства, оружие из синих
// сундуков в его списках либо без вида, либо их там нет вовсе. Такие имена
// спрашиваем у самой игры — тем же запросом, который она шлёт по клику на
// предмет в экране результата:
//   POST /resultmulti/detail {"item_id":1,"item_kind":73,…}
//     → {"data":{"name":"Coronation Ring","type":"item/npcaugment",…}}
// Спросить нужно один раз за предмет, дальше имя живёт в общей таблице.
async function loadItemNames() {
  const stored = (await chrome.storage.local.get(ITEM_NAMES_KEY))[ITEM_NAMES_KEY] || {};
  return {
    byKind: stored.byKind || {},
    byType: stored.byType || {},
    byId: stored.byId || {},
    // Предметы, про которые игра ответила «имени нет»: чтобы автозапуск не
    // спрашивал одно и то же при каждом старте браузера
    failed: stored.failed || {},
    asked: new Set(), // включая неудачные попытки: второй раз за прогон не спрашиваем
  };
}

function saveItemNames(names) {
  return chrome.storage.local.set({
    [ITEM_NAMES_KEY]: {
      byKind: names.byKind, byType: names.byType, byId: names.byId,
      failed: names.failed, updatedAt: Date.now(),
    },
  });
}

// Держим в синхроне с itemName() в loot.js: здесь решается, надо ли спрашивать
// имя у игры, а спрашивать надо ровно то, что трекер иначе подпишет как «#534».
function lookupItemName(names, item) {
  const id = String(item.id);
  const byKind = item.kind && names.byKind[item.kind];
  if (byKind && byKind[id]) return byKind[id];
  const byType = item.type && names.byType[item.type];
  if (byType && byType[id]) return byType[id];
  // Общий справочник по одному id собран под материалы: для всего остального он
  // соврал бы — кольцо с id 1 получило бы имя материала с id 1
  const isMaterial = item.kind ? item.kind === MATERIAL_KIND
    : (!item.type || item.type === MATERIAL_TYPE);
  return (isMaterial && names.byId[id]) || '';
}

// Один вопрос игре про один предмет — тот же запрос, который она шлёт по клику
// на предмет в экране результата. Кладёт имя в справочник; сохранение — на
// вызывающем.
//
// Отказ игры и оборванный запрос — разные вещи, и различать их обязательно:
// первое значит «этот предмет она не называет» и запоминается, чтобы автозапуск
// не спрашивал про него при каждом старте браузера; второе — что сессия ещё не
// готова, и записать это в отказ значило бы навсегда потерять имя из-за одной
// неудачной минуты.
async function askItemName(tabId, item, names) {
  const key = `${item.kind}_${item.id}`;
  if (names.asked.has(key)) return { name: '' };
  names.asked.add(key);

  const res = await gameFetch(tabId, '/resultmulti/detail', {
    special_token: null,
    item_id: Number(item.id),
    item_kind: Number(item.kind),
    augment_id_list: '',
    skill_level: '',
  });
  if (!res || res.error) return { name: '', error: res && res.error };

  const detail = res.data && res.data.data;
  const name = detail && String(detail.name || '');
  if (!name) {
    names.failed[key] = Date.now();
    return { name: '' };
  }

  const id = String(item.id);
  (names.byKind[item.kind] || (names.byKind[item.kind] = {}))[id] = name;
  // Папка из ответа надёжнее нашей: её игра берёт из своего же каталога
  const type = String((detail && detail.type) || item.type || '');
  if (type) (names.byType[type] || (names.byType[type] = {}))[id] = name;
  if (!names.byId[id]) names.byId[id] = name;
  delete names.failed[key];
  return { name };
}

async function resolveMissingItemNames(tabId, loot, names) {
  let learned = 0;
  for (const box of HISTORY_CHEST_KEYS) {
    if (!Array.isArray(loot[box])) continue;
    for (const item of loot[box]) {
      // Без вида спрашивать нечем: он и есть половина ключа
      if (item.name || !item.kind || lookupItemName(names, item)) continue;
      if (names.asked.has(`${item.kind}_${item.id}`)) continue; // уже спрашивали за этот прогон
      if ((await askItemName(tabId, item, names)).name) learned++;
      await backfillSleep(HISTORY_DETAIL_DELAY);
    }
  }
  if (learned) await saveItemNames(names);
  return learned;
}

// Имя предмета не пишется в запись боя, а подставляется при отрисовке, поэтому
// бой, импортированный до того, как справочник узнал предмет, так и остаётся с
// подписью «#534»: повторно за ним никто не идёт — он уже записан, и скан его
// пропускает. Отсюда и берётся вторая половина проблемы «вместо названий id».
//
// Чинится это не перекачиванием боёв, а одним вопросом на каждую неизвестную
// пару «вид/id» во всём, что уже записано: предметов в разы меньше, чем боёв.
//
// Сбор отделён от вопросов: он идёт по локальным данным и не стоит ни одного
// запроса к игре, поэтому автозапуск начинает с него и в обычный день на нём же
// и заканчивается — спрашивать нечего.
function collectUnknownItems(all, names, opts) {
  const { skipFailed = false } = opts || {};
  // Сперва собираем имена из живого перехвата: трекер подписывает ими записи
  // бэкафилла (itemCatalogByKey в loot.js), так что спрашивать про них игру
  // незачем — на экране они и так с именем.
  const byKey = {};
  const eachItem = (fn) => {
    for (const qId in all) {
      if (!/^\d+$/.test(qId)) continue;
      const battles = all[qId];
      if (!battles || typeof battles !== 'object') continue;
      for (const bId in battles) {
        // Id боя уходит в путь запроса к игре, поэтому только цифры — тот же
        // разбор, что и в knownBattleOwners
        if (!/^\d+$/.test(bId)) continue;
        const session = battles[bId];
        if (!session || typeof session !== 'object') continue;
        for (const box of HISTORY_CHEST_KEYS) {
          if (!Array.isArray(session[box])) continue;
          for (const item of session[box]) {
            if (item && typeof item === 'object') fn(item, bId);
          }
        }
      }
    }
  };
  eachItem((item) => {
    if (item.name && item.type) byKey[`${item.type}/${item.id}`] = item.name;
  });

  const unknown = new Map(); // `${kind}_${id}` → предмет, про который надо спросить
  const noKind = new Set(); // вид не записан (разбор до v3) — спрашивать нечем
  eachItem((item, raidId) => {
    if (item.name || (item.type && byKey[`${item.type}/${item.id}`])) return;
    if (lookupItemName(names, item)) return;
    if (!item.kind) { noKind.add(`${item.type || ''}/${item.id}`); return; }
    const key = `${item.kind}_${item.id}`;
    // Спрошенное за этот же прогон (импорт новых боёв идёт перед этим проходом)
    // второй раз не спрашиваем — игра ответила бы то же самое
    if (unknown.has(key) || names.asked.has(key)) return;
    // Про что игра уже отвечала «имени нет», автозапуск молчит: иначе он
    // спрашивал бы одно и то же при каждом старте браузера. Кнопка в трекере
    // спрашивает заново — её нажали именно затем.
    if (skipFailed && names.failed[key]) return;
    // Запоминаем бой, в котором предмет выпал: спрашивать про него игра даёт с
    // открытого экрана результата, и открывать надо именно тот, где он есть
    unknown.set(key, { id: item.id, kind: item.kind, type: item.type || '', raidId });
  });

  return { unknown, noKind };
}

// Собственно вопросы. Оборванная связь означает, что спрашивать сейчас не у
// кого — после нескольких подряд выходим, а не долбим сервер впустую.
async function askUnknownItemNames(tabId, names, unknown) {
  let learned = 0, n = 0, errors = 0, openScreen = '';
  for (const item of unknown.values()) {
    if (backfillStopRequested) break;
    reportBackfillProgress('names', `Looking up item names ${n + 1} of ${unknown.size}…`, n, unknown.size);
    // Тем же порядком, каким по предмету кликает сама игра: сперва экран
    // результата того боя, потом вопрос про предмет. Во время скана он уже
    // открыт (см. fetchAndStoreHistoryDetail), а отдельным прогоном — нет.
    // Из одного боя обычно неизвестно сразу несколько предметов — тогда экран
    // открываем один раз на всех, как и при обычной игре.
    if (item.raidId && item.raidId !== openScreen) {
      openScreen = item.raidId;
      await gameFetch(tabId, `/resultmulti/content/detail/${item.raidId}`);
      await backfillSleep(HISTORY_PAGE_DELAY);
    }
    // Сохраняем сразу за каждым узнанным именем: трекер слушает справочник и
    // переподписывает предметы по ходу, а прерванный прогон не пропадает зря
    const res = await askItemName(tabId, item, names);
    if (res.error) { if (++errors >= 3) break; }
    else {
      errors = 0;
      if (res.name) { learned++; await saveItemNames(names); }
    }
    n++;
    await backfillSleep(HISTORY_DETAIL_DELAY);
  }
  // Отказы игры тоже надо сохранить — ради них список и ведётся
  if (n) await saveItemNames(names);
  return { asked: n, learned, aborted: errors >= 3 };
}

async function resolveStoredItemNames(tabId, names, opts) {
  const all = await chrome.storage.local.get(null);
  const { unknown, noKind } = collectUnknownItems(all, names, opts);
  const res = await askUnknownItemNames(tabId, names, unknown);
  return { unknown: unknown.size, noKind: noKind.size, ...res };
}

// Отдельная кнопка в трекере: подписи чинятся без обхода истории — он тут ни
// при чём, а идёт десятки минут. Отказы игры кнопка перепроверяет: её нажали
// именно затем, а игра могла и обновиться.
async function repairItemNames() {
  const tabId = await findGameTabId();
  if (!tabId) return { error: 'Open the game in a tab first.' };

  reportBackfillProgress('items', 'Loading item names…', 0, 1);
  const total = await refreshItemNames(tabId);
  await backfillSleep(HISTORY_PAGE_DELAY);

  const names = await loadItemNames();
  const res = await resolveStoredItemNames(tabId, names);
  return { names: res, screenNames: total, stopped: backfillStopRequested };
}

// ── Автоматическая починка подписей ─────────────────────────────────────────
// Раз в запуск браузера, по первой готовой вкладке игры. Не на onStartup:
// спрашивать имена не у кого, пока нет живой сессии игры, — запросы идут в
// контексте её страницы.
//
// Метка живёт в storage.session, а она обнуляется вместе с браузером — это и
// есть «раз за запуск», без отдельного хранения дат.
const ITEM_NAMES_AUTO_KEY = 'itemNamesAutoDone';

async function autoRepairItemNames(tabId) {
  const names = await loadItemNames();
  const all = await chrome.storage.local.get(null);
  // Дешёвая часть: пока всё подписано, автозапуск не делает ни одного запроса
  const { unknown } = collectUnknownItems(all, names, { skipFailed: true });
  if (!unknown.size) return { auto: true }; // молча: трекеру нечего показывать

  // Раз безымянные есть — сперва экран предметов: он мог узнать их бесплатно,
  // одним списком вместо десятков вопросов
  reportBackfillProgress('items', 'Loading item names…', 0, 1);
  await refreshItemNames(tabId);
  await backfillSleep(HISTORY_PAGE_DELAY);

  const fresh = await loadItemNames();
  const rest = collectUnknownItems(all, fresh, { skipFailed: true }).unknown;
  const res = await askUnknownItemNames(tabId, fresh, rest);
  return { names: { unknown: rest.size, ...res }, auto: true, stopped: backfillStopRequested };
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url || !/^https?:\/\/game\.granbluefantasy\.jp\//.test(tab.url)) return;
  chrome.storage.session.get(ITEM_NAMES_AUTO_KEY).then(async (r) => {
    if (r[ITEM_NAMES_AUTO_KEY]) return;
    // Страница «загрузилась» задолго до того, как игра подняла свою сессию:
    // без uid запрос всё равно не уйдёт, поэтому не отмечаемся сделанными и
    // ждём следующего перехода — их за игру хватает.
    if (!(await getGameUid(tabId))) return;
    await chrome.storage.session.set({ [ITEM_NAMES_AUTO_KEY]: true });
    startBackfillJob(() => autoRepairItemNames(tabId));
  }).catch(() => { });
});

// Список боёв не отдаётся, пока сессия не побывала на экране истории: в захвате
// трафика игра всегда идёт /quest/content/battle_history → /user/status →
// /quest/battle_history/1, и без первого шага список приходит пустым.
async function openBattleHistoryScreen(tabId) {
  const res = await gameFetch(tabId, '/quest/content/battle_history');
  if (res.error) return res;
  await backfillSleep(HISTORY_PAGE_DELAY);
  await gameFetch(tabId, '/user/status');
  await backfillSleep(HISTORY_PAGE_DELAY);
  return {};
}

// raid_id → quest_id по всему уже записанному. Нужен вдвойне: чтобы не тянуть
// повторно то, что уже есть, и чтобы узнать quest_id для боссов из истории.
// В истории quest_id нет, но у боёв, записанных живьём, он известен — по ним
// и учимся, вместо того чтобы сверять имена (chapter_name в истории это имя
// квеста, а в таблице расширения лежат имена боссов: «Omen of the Broken
// Skies» и «Akasha» — один и тот же рейд).
async function knownBattleOwners() {
  const all = await chrome.storage.local.get(null);
  const owners = new Map();
  const damaged = new Set();
  for (const qId in all) {
    if (!/^\d+$/.test(qId)) continue;
    const battles = all[qId];
    if (!battles || typeof battles !== 'object') continue;
    for (const bId in battles) {
      if (!/^\d+$/.test(bId)) continue;
      owners.set(bId, qId);
      const session = battles[bId];
      if (!session || typeof session !== 'object') continue;
      if (Number(session.v) >= BACKFILL_VERSION) continue; // уже перечитан новым разбором

      // Имена есть только у живого перехвата, у бэкафилла их нет никогда.
      // Перечитываем лишь безымянные записи: иначе бэкафилл затёр бы живую
      // запись своей, потеряв и имена, и артефакты (сундук 90 он не пишет).
      let hasAnyName = false;
      for (const key of HISTORY_CHEST_KEYS) {
        if (!Array.isArray(session[key])) continue;
        if (session[key].some((it) => it && it.name)) { hasAnyName = true; break; }
      }
      if (!hasAnyName) damaged.add(bId);
    }
  }
  return { owners, damaged };
}

// Уже записанный лут как справочник (тот же обход, что indexItems() в loot.js):
// подставляем имя предметам из истории, у которых в ответе игры есть только
// числовой id, — если этот предмет уже когда-то падал живьём.
// byKey ключуется парой «папка картинки/id»: по одному id материал и кольцо
// неразличимы, и запись получала бы чужое имя.
async function knownItemCatalog() {
  const all = await chrome.storage.local.get(null);
  const byKey = {};
  const byId = {};
  for (const qId in all) {
    if (!/^\d+$/.test(qId)) continue;
    const battles = all[qId];
    if (!battles || typeof battles !== 'object') continue;
    for (const bId in battles) {
      const session = battles[bId];
      if (!session || typeof session !== 'object') continue;
      for (const key of HISTORY_CHEST_KEYS) {
        if (!Array.isArray(session[key])) continue;
        for (const item of session[key]) {
          const id = String(item.id ?? '');
          if (!id || !item.name) continue;
          const entry = { name: item.name, type: item.type || '' };
          if (entry.type && !byKey[`${entry.type}/${id}`]) byKey[`${entry.type}/${id}`] = entry;
          if (!byId[id]) byId[id] = entry;
        }
      }
    }
  }
  return { byKey, byId };
}

// Запасной вариант, если из src картинки тип вытащить не удалось.
// 10 = материалы/предметы; остальные kind сюда добавлять не нужно — тип
// надёжнее берётся из самого src, см. IMG_TYPE_RE.
const ITEM_KIND_TYPE = { '10': 'item/article' };

// Экран результата приходит как {"data": "<HTML в url-кодировке>"}
function decodeHistoryDetail(payload) {
  try {
    return payload && typeof payload.data === 'string' ? decodeURIComponent(payload.data) : '';
  } catch (e) { return ''; }
}

// Экран результата — готовый HTML, поэтому разбираем regex-ом: DOMParser в
// service worker недоступен. Открывающий тег матчим целиком, а data-* достаём
// по отдельности — порядок и набор атрибутов у игры менялись и ещё поменяются.
// Артефакты сюда не входят: в захваченных примерах не было ни одного боя с
// артефактом, формат их блока не подтверждён, так что box 90 бэкафилл не трогает.
const ITEM_BLOCK_RE = /<div class="lis-treasure btn-treasure-item"([^>]*)>([\s\S]*?)<\/div><\/div>/g;
const BOX_RE = /data-box="(\d+)"/;
const ITEM_ID_RE = /data-item-id="(\d+)"/;
const ITEM_KIND_RE = /data-item-kind="(\d+)"/;
// Запасной источник вида: игра пишет ту же пару и в data-key="10_534"
const ITEM_DATA_KEY_RE = /data-key="(\d+)_\d+"/;
// Количество показывается только когда его больше одного: <div class="prt-article-count"><span>x</span>2</div>
const COUNT_RE = /prt-article-count[^>]*>(?:<span[^>]*>[^<]*<\/span>)?(\d+)/;
// Тип предмета берём из пути картинки: .../sp/assets/item/article/m/534.jpg.
// Угадывать его по data-item-kind нельзя — у оружия и саммонов путь другой,
// и иконка получалась битой.
const IMG_TYPE_RE = /\/sp\/assets\/(.+?)\/[a-z]{1,3}\/\d+\.(?:jpg|png)/;

function parseHistoryLoot(html, itemCatalog) {
  const loot = {};
  let m;
  ITEM_BLOCK_RE.lastIndex = 0;
  while ((m = ITEM_BLOCK_RE.exec(html))) {
    const [, attrs, inner] = m;
    const idMatch = ITEM_ID_RE.exec(attrs);
    const boxMatch = BOX_RE.exec(attrs);
    if (!idMatch || !boxMatch) continue;
    const kindMatch = ITEM_KIND_RE.exec(attrs) || ITEM_DATA_KEY_RE.exec(attrs);
    const countMatch = COUNT_RE.exec(inner);
    const imgMatch = IMG_TYPE_RE.exec(inner);
    const id = idMatch[1];
    const kind = kindMatch ? kindMatch[1] : '';
    const type = imgMatch ? imgMatch[1] : (kind ? (ITEM_KIND_TYPE[kind] || '') : '');
    const known = (type && itemCatalog.byKey[`${type}/${id}`]) || (type ? null : itemCatalog.byId[id]);
    const boxNum = Number(boxMatch[1]);
    if (!loot[boxNum]) loot[boxNum] = [];
    loot[boxNum].push({
      count: countMatch ? Number(countMatch[1]) || 1 : 1,
      id,
      // Имени в ответе игры нет ни в каком виде — подставится при отрисовке из
      // уже виденного живьём или из справочника имён
      name: known ? known.name : '',
      // Вид предмета: без него имя по id ищется неоднозначно, id уникальны
      // только внутри вида
      kind,
      type: type || (known ? known.type : ''),
    });
  }
  return loot;
}

async function fetchAndStoreHistoryDetail(tabId, raidId, questId, itemCatalog, names) {
  const res = await gameFetch(tabId, `/resultmulti/content/detail/${raidId}`);
  if (res.error) return null;
  const html = decodeHistoryDetail(res.data);
  if (!html) return null;

  // Бой без дропа всё равно записываем: это по-прежнему кил, и так же ведёт себя
  // живой перехват (content.js пишет loot даже пустым). Заодно бой попадает в
  // «уже известные» и не перекачивается при каждом следующем сканировании.
  const loot = parseHistoryLoot(html, itemCatalog);
  // Имена спрашиваем, пока открыт экран результата этого боя, — тем же порядком,
  // каким по предмету кликает сама игра
  if (names) await resolveMissingItemNames(tabId, loot, names);
  loot.v = BACKFILL_VERSION;
  const store = await chrome.storage.local.get({ [questId]: {} });
  const bucket = store[questId];
  bucket[raidId] = loot;
  await chrome.storage.local.set({ [questId]: bucket });
  return loot;
}

// mode: 'recent' — с первой страницы до первого уже записанного боя (обычный
// добор после игры с телефона). 'full' — обход всей истории целиком, до её
// конца или до нажатия Stop.
//
// Страница читается и тут же импортируется, и только после этого сдвигается
// курсор. Прогон идёт десятками минут, и прервать его есть чему — Stop,
// закрытый браузер, уснувший воркер, — поэтому позиция всё время указывает на
// последнюю по-настоящему разобранную страницу, и следующий запуск продолжает
// ровно с неё, ничего не перекачивая заново.
async function scanBattleHistory(mode) {
  const full = mode === 'full';
  const tabId = await findGameTabId();
  if (!tabId) return { error: 'Open the game in a tab first.' };

  // Имена обновляем на каждом скане: инвентарь меняется, а стоит это пары
  // лишних запросов на весь прогон
  reportBackfillProgress('items', 'Loading item names…', 0, 1);
  await refreshItemNames(tabId);
  await backfillSleep(HISTORY_PAGE_DELAY);

  reportBackfillProgress('open', 'Opening battle history…', 0, 1);
  const opened = await openBattleHistoryScreen(tabId);
  if (opened.error) return { error: opened.error };

  const { owners: known, damaged } = await knownBattleOwners();
  const itemCatalog = await knownItemCatalog();
  const names = await loadItemNames();
  const historyMap = (await chrome.storage.local.get(HISTORY_MAP_KEY))[HISTORY_MAP_KEY] || {};
  const learned = new Map(); // boss_image -> quest_id (null, если арт встретился у разных квестов)
  const pending = new Map(); // boss_image -> { chapterName, raidIds } — ждут ручного сопоставления

  // Курсор хранится по аккаунтам: { [uid]: страница }
  const uid = (await getGameUid(tabId)) || 'unknown';
  // В ранней версии тут лежало одно число на все аккаунты — если попалось оно,
  // начинаем с чистого объекта, иначе запись курсора молча потерялась бы
  const rawCursors = (await chrome.storage.local.get(HISTORY_CURSOR_KEY))[HISTORY_CURSOR_KEY];
  const cursors = (rawCursors && typeof rawCursors === 'object') ? rawCursors : {};
  const fromPage = full ? (Number(cursors[uid]) || 1) : 1;

  let page = fromPage, lastPage = fromPage, pagesScanned = 0, totalPages = 0;
  let wrapped = false, hitKnown = false, stopped = false;
  let imported = 0, autoMapped = 0;

  const saveCursor = async (value) => {
    if (!full) return;
    cursors[uid] = value;
    await chrome.storage.local.set({ [HISTORY_CURSOR_KEY]: cursors });
  };

  // Шкала считается по страницам: их общее число известно с первого же ответа,
  // а сколько боёв предстоит забрать — нет, оно выясняется по ходу.
  const pageProgress = (label) => reportBackfillProgress('pages', label,
    pagesScanned, full ? (totalPages || pagesScanned + 1) : HISTORY_RECENT_PAGES);

  const pageTitle = () => `Page ${lastPage}${totalPages ? ` of ${totalPages}` : ''}`;

  // Бои сопоставленного босса забираем сразу; про остальных спросим в конце
  const importGroup = async (bossImage, group) => {
    const mapping = historyMap[bossImage];
    if (!mapping) {
      const held = pending.get(bossImage) || { chapterName: group.chapterName, raidIds: [] };
      held.raidIds.push(...group.raidIds);
      pending.set(bossImage, held);
      return;
    }
    if (mapping.skip) return;
    for (let n = 0; n < group.raidIds.length; n++) {
      if (backfillStopRequested) { stopped = true; return; }
      pageProgress(`${pageTitle()}: importing ${group.chapterName || 'battles'} ${n + 1} of ${group.raidIds.length}…`);
      const loot = await fetchAndStoreHistoryDetail(tabId, group.raidIds[n], mapping.questId, itemCatalog, names);
      if (loot) imported++;
      await backfillSleep(HISTORY_DETAIL_DELAY);
    }
  };

  // Сопоставления, выведенные из уже записанных боёв и из таблицы имён квестов,
  // — данные самой игры, подтверждения они не требуют и сохраняются сразу.
  const applyAutoMappings = async (pageGroups) => {
    let added = 0;
    for (const [bossImage, questId] of learned) {
      if (!questId || historyMap[bossImage]) continue;
      historyMap[bossImage] = { questId: String(questId), auto: true };
      added++;
    }
    // chapter_name в истории и в списке мультибоёв — одно и то же поле игры,
    // поэтому совпадение точное. На пустом профиле учиться не на чем, и эта
    // таблица остаётся единственным источником.
    for (const [bossImage, group] of pageGroups) {
      if (historyMap[bossImage]) continue;
      const questId = QUEST_NAME_TO_ID[group.chapterName];
      if (!questId) continue;
      historyMap[bossImage] = { questId: String(questId), auto: true };
      added++;
    }
    if (!added) return;
    autoMapped += added;
    await chrome.storage.local.set({ [HISTORY_MAP_KEY]: historyMap });
  };

  while (!stopped) {
    if (backfillStopRequested) { stopped = true; break; }
    pageProgress(`Reading history page ${page}${totalPages ? ` of ${totalPages}` : ''}…`);
    const res = await gameFetch(tabId, `/quest/battle_history/${page}`);
    if (res.error) {
      // Первая же страница не открылась — сказать об этом, а не молча показать ноль
      if (!pagesScanned) return { error: res.error };
      break;
    }
    const body = res.data;
    if (!body || typeof body !== 'object') {
      if (!pagesScanned) return { error: `/quest/battle_history/${page} returned an unexpected response` };
      break;
    }
    pagesScanned++;
    lastPage = page;
    totalPages = Number(body.last) || totalPages;

    // Курсор мог остаться от аккаунта с более длинной историей — начинаем заново
    if (Number(body.current) > Number(body.last)) { wrapped = true; break; }
    const list = Array.isArray(body.list) ? body.list : [];
    if (!list.length) { wrapped = true; break; }

    const pageGroups = new Map(); // boss_image -> { chapterName, raidIds }
    let newOnPage = 0;
    for (const entry of list) {
      const raidId = String(entry.raid_id ?? '');
      if (!/^\d+$/.test(raidId)) continue;
      const bossImage = String(entry.boss_image ?? 'unknown');

      // Бой уже записан — значит его quest_id известен, и мы попутно узнаём,
      // какому рейду принадлежит этот boss_image. За деталями к нему не идём,
      // кроме случая, когда запись повреждена и её надо перечитать.
      const ownerQuestId = known.get(raidId);
      if (ownerQuestId) {
        const seen = learned.get(bossImage);
        if (!seen) learned.set(bossImage, ownerQuestId);
        else if (seen !== ownerQuestId) learned.set(bossImage, null); // один арт у разных квестов — не угадываем
        if (!damaged.has(raidId)) continue;
      }

      newOnPage++;
      if (!pageGroups.has(bossImage)) pageGroups.set(bossImage, { chapterName: String(entry.chapter_name ?? ''), raidIds: [] });
      pageGroups.get(bossImage).raidIds.push(raidId);
    }
    // История отсортирована от новых к старым: страница без единого нового боя
    // означает, что дальше идёт уже записанное
    if (!full && !newOnPage) { hitKnown = true; break; }

    await applyAutoMappings(pageGroups);
    for (const [bossImage, group] of pageGroups) {
      await importGroup(bossImage, group);
      if (stopped) break;
    }
    if (stopped) break;

    const next = Number(body.next);
    if (!next || next <= page) { // дошли до конца истории
      wrapped = true;
      await saveCursor(1);
      break;
    }
    page = next;
    await saveCursor(page);
    if (!full && pagesScanned >= HISTORY_RECENT_PAGES) break;
    await backfillSleep(HISTORY_PAGE_DELAY);
  }

  // Босс мог остаться без сопоставления на своей странице, а потом найтись по
  // уже записанному бою — тогда его бои забираем здесь, не спрашивая заново
  if (!stopped) {
    for (const [bossImage, group] of [...pending]) {
      if (!historyMap[bossImage]) continue;
      pending.delete(bossImage);
      await importGroup(bossImage, group);
      if (stopped) break;
    }
  }

  // Добираем имена по всему записанному, а не только по боям этого прогона:
  // предмет мог впервые встретиться давно, когда справочник его ещё не знал
  const nameStats = stopped ? null : await resolveStoredItemNames(tabId, names);

  const unresolved = [];
  const pendingUpdate = {};
  for (const [bossImage, group] of pending) {
    unresolved.push({ bossImage, chapterName: group.chapterName, count: group.raidIds.length, sampleRaidId: group.raidIds[0] });
    pendingUpdate[bossImage] = { chapterName: group.chapterName, raidIds: group.raidIds };
  }
  if (unresolved.length) {
    const existing = (await chrome.storage.session.get('backfillPending')).backfillPending || {};
    await chrome.storage.session.set({ backfillPending: { ...existing, ...pendingUpdate } });
  }

  // Завершение проставит startBackfillJob вместе с результатом
  return { imported, autoMapped, pagesScanned, fromPage, toPage: lastPage, totalPages, wrapped, hitKnown, stopped, full, unresolved, names: nameStats };
}

async function mapHistoryBoss(bossImage, questId, skip) {
  const store = await chrome.storage.local.get(HISTORY_MAP_KEY);
  const historyMap = store[HISTORY_MAP_KEY] || {};
  historyMap[bossImage] = skip ? { skip: true } : { questId: String(questId) };
  await chrome.storage.local.set({ [HISTORY_MAP_KEY]: historyMap });

  let imported = 0;
  if (!skip) {
    const pending = (await chrome.storage.session.get('backfillPending')).backfillPending || {};
    const group = pending[bossImage];
    if (group) {
      const tabId = await findGameTabId();
      if (!tabId) return { error: 'Open the game in a tab first.' };
      // OK жмут уже после скана, возможно сильно позже — сессия к этому моменту
      // давно ушла с экрана истории, поэтому открываем его заново
      const opened = await openBattleHistoryScreen(tabId);
      if (opened.error) return { error: opened.error };
      const itemCatalog = await knownItemCatalog();
      const names = await loadItemNames();
      let n = 0;
      for (const raidId of group.raidIds) {
        // Остаток списка остаётся в pending — сопоставление уже сохранено,
        // так что следующий скан заберёт эти бои сам, ничего не спрашивая
        if (backfillStopRequested) break;
        reportBackfillProgress('import',
          `Importing ${group.chapterName || 'battles'} ${n + 1} of ${group.raidIds.length}…`,
          n, group.raidIds.length);
        const loot = await fetchAndStoreHistoryDetail(tabId, raidId, questId, itemCatalog, names);
        if (loot) imported++;
        n++;
        await backfillSleep(HISTORY_DETAIL_DELAY);
      }
      const left = group.raidIds.slice(n);
      if (left.length) pending[bossImage] = { ...group, raidIds: left };
      else delete pending[bossImage];
      await chrome.storage.session.set({ backfillPending: pending });
    }
  }
  return { imported, stopped: backfillStopRequested };
}

// Работа запускается и живёт сама по себе, ответ уходит сразу. Итог окно
// заберёт из storage.session — так результат не теряется, даже если окно
// закрыли или канал сообщения закрылся раньше, чем скан дошёл до конца.
let backfillRunning = false;
// Полный скан идёт до конца истории, то есть десятки минут; флаг читается между
// запросами, поэтому Stop срабатывает не мгновенно, а на ближайшей паузе.
let backfillStopRequested = false;

function startBackfillJob(run) {
  if (backfillRunning) return { busy: true };
  backfillRunning = true;
  backfillStopRequested = false;
  setBackfillState({ running: true, phase: 'start', label: 'Starting…', done: 0, total: 1, result: null });
  run()
    .then((result) => setBackfillState({ running: false, phase: 'done', label: '', result }))
    .catch((e) => setBackfillState({ running: false, phase: 'done', label: '', result: { error: String(e && e.message || e) } }))
    .then(() => { backfillRunning = false; });
  return { started: true };
}

// Полный скан идёт долго, и воркер могли усыпить прямо посреди него — тогда в
// session осталось бы «running», а кнопки в трекере навсегда погашенными. Раз
// этот файл выполняется заново, ничего уже не идёт.
chrome.storage.session.get(BACKFILL_STATE_KEY).then((r) => {
  const state = r[BACKFILL_STATE_KEY];
  if (!state || !state.running) return;
  setBackfillState({
    running: false, phase: 'done', label: '',
    result: { error: 'The scan was interrupted — start it again to continue from where it stopped.' },
  });
}).catch(() => { });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'BACKFILL_SCAN') {
    sendResponse(startBackfillJob(() => scanBattleHistory(msg.mode)));
    return;
  }
  if (msg.type === 'BACKFILL_NAMES') {
    sendResponse(startBackfillJob(() => repairItemNames()));
    return;
  }
  if (msg.type === 'BACKFILL_MAP') {
    sendResponse(startBackfillJob(() => mapHistoryBoss(msg.bossImage, msg.questId, !!msg.skip)));
    return;
  }
  if (msg.type === 'BACKFILL_STOP') {
    backfillStopRequested = true;
    // Кнопка должна погаснуть сразу, а не через запрос-другой
    if (backfillRunning) setBackfillState({ label: 'Stopping after the current battle…' });
    sendResponse({ ok: true, running: backfillRunning });
    return;
  }
  if (msg.type === 'BACKFILL_GET_STATE') {
    chrome.storage.session.get(BACKFILL_STATE_KEY)
      .then((r) => sendResponse(r[BACKFILL_STATE_KEY] || {}))
      .catch(() => sendResponse({}));
    return true;
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
      // с сервера не могли перезаписать служебные ключи (patterns, syncToken и т.д.).
      // Id боёв проверяем так же: они попадают в путь запроса к игре
      // (/resultmulti/content/detail/<id>), и ключ вида «../…» с сервера означал
      // бы запрос по чужому адресу от лица пользователя.
      if (r.data.lootData && typeof r.data.lootData === 'object') {
        for (let k in r.data.lootData) {
          if (!/^\d+$/.test(k)) continue;
          const battles = r.data.lootData[k];
          if (!battles || typeof battles !== 'object') continue;
          const clean = {};
          for (const bId in battles) {
            if (/^\d+$/.test(bId)) clean[bId] = battles[bId];
          }
          updates[k] = clean;
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
const RELEASES_API    = 'https://api.github.com/repos/neo21400/gbf-helper/releases/latest';

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

// Версию спрашиваем у API релизов, а не у манифеста в main. Причин две.
//
// raw.githubusercontent раздаётся через CDN с max-age=300, и query-строка в ключ
// кеша не входит: метка времени в адресе кеш не сбивала, хотя код рассчитывал на
// обратное. Первые минуты после релиза проверка честно отвечала "обновлений нет",
// а через пять минут та же кнопка находила версию — отсюда и жалоба, что помогает
// перезапуск браузера (на деле помогало прошедшее время).
//
// И версия в main поднимается коммитом, то есть раньше публикации релиза: по
// манифесту можно объявить версию, которой на странице релизов ещё нет.
//
// У API лимит 60 запросов в час на IP, так что при любой его ошибке откатываемся
// на манифест: пусть с задержкой до пяти минут, но проверка продолжает работать.
async function fetchLatestVersion() {
  try {
    const r = await fetch(RELEASES_API, {
      cache: 'no-store',
      headers: { 'Accept': 'application/vnd.github+json' }
    });
    if (r.ok) {
      const j = await r.json();
      const tag = String((j && j.tag_name) || '').replace(/^v/, '');
      if (/^\d+(\.\d+)*$/.test(tag)) return tag;
    }
  } catch (e) {
    // сеть или лимит — молча уходим в запасной вариант
  }

  const r = await fetch(REMOTE_MANIFEST, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const remote = await r.json();
  const latest = remote && remote.version;
  if (!latest) throw new Error('в манифесте на гитхабе нет version');
  return String(latest);
}

// Попап проверяет версию при каждом открытии, а открывают его часто — поэтому
// результат кешируется. Явная проверка по кнопке идёт с force и кеш игнорирует.
const UPDATE_CACHE_KEY = 'updateCheck';
const UPDATE_CACHE_TTL = 6 * 60 * 60 * 1000;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'CHECK_UPDATE') return;

  const current = chrome.runtime.getManifest().version;
  const result = (latest, cached) => ({
    ok: true, current, latest, url: REPO_URL, cached: !!cached,
    newer: compareVersions(latest, current) > 0
  });

  const check = async () => {
    if (!msg.force) {
      const stored = (await chrome.storage.local.get(UPDATE_CACHE_KEY))[UPDATE_CACHE_KEY];
      if (stored && stored.latest && Date.now() - stored.ts < UPDATE_CACHE_TTL) {
        return result(stored.latest, true);
      }
    }
    const latest = await fetchLatestVersion();
    await chrome.storage.local.set({ [UPDATE_CACHE_KEY]: { ts: Date.now(), latest } });
    return result(latest, false);
  };

  // Вкладку с релизом фон больше не открывает сам: проверка теперь идёт и молча,
  // при открытии попапа, а утаскивать пользователя на гитхаб без спроса незачем —
  // на страницу ведёт клик по строке с новой версией
  check()
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, current, error: String((e && e.message) || e) }));

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
