// ── Auto-Clicker: фоновая логика ─────────────────────────────────────────
// Подключается через importScripts() из background.js. Если этой папки нет,
// importScripts бросит исключение и расширение просто соберётся без кликера.
// Работает в общей области видимости с background.js (createInSavedPos и др.).

// Без права "debugger" кликать невозможно. Если расширение собрано с манифестом
// без этого права, отключаемся точно так же, как при отсутствующей папке:
// исключение поймает try/catch вокруг importScripts, и кнопка не появится.
// Иначе была бы живая кнопка, которая молча ничего не делает.
if (!chrome.debugger) {
  throw new Error('нет права "debugger" в манифесте');
}

let state = {
  recording: false,
  playing: false,
  paused: false,
  currentSteps: [],
  repeatCount: 1,
  currentRep: 0,
  currentStepIndex: 0,
  lastClickTime: null,
  activeTabId: null,
  offsets: {},
  returnUrl: null,
  nextUpdateRep: 15,
  lastMouseX: null,
  lastMouseY: null,
  audioVolume: 0.5,
  audioRepeats: 3,
  jitterSettings: {
    mode: 'percent',
    percent: 15,
    cap: 500,
    min: -150,
    max: 300,
    flat: 300
  }
};

chrome.storage.local.get(['audioVolume', 'audioRepeats', 'jitterSettings'], (d) => {
  if (d.audioVolume !== undefined) state.audioVolume = d.audioVolume;
  if (d.audioRepeats !== undefined) state.audioRepeats = d.audioRepeats;
  if (d.jitterSettings) state.jitterSettings = d.jitterSettings;
});

// ── Позиция окна панели ─────────────────────────────
chrome.windows.onBoundsChanged.addListener((win) => {
  chrome.tabs.query({ windowId: win.id }, (tabs) => {
    if (tabs.length > 0 && tabs[0].url && tabs[0].url.includes('panel.html') && win.state === 'normal') {
      chrome.storage.local.set({
        win_pos_panel: { left: win.left, top: win.top, width: win.width, height: win.height }
      });
    }
  });
});

// ── Клик через Debugger API с плавным движением ─────
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Ease-in-out кривая для естественного движения
function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

async function attachDebugger(tabId) {
  return new Promise((resolve) => {
    const target = { tabId };

    // Проверяем статус подключения
    chrome.debugger.getTargets((targets) => {
      const isAttached = targets && targets.find(t => t.tabId === tabId && t.attached);

      if (isAttached) {
        console.log('[GBF bg] Debugger already attached to', tabId);
        resolve(true);
        return;
      }

      console.log('[GBF bg] Attempting attach to', tabId);
      chrome.debugger.attach(target, "1.3", () => {
        if (chrome.runtime.lastError) {
          const err = chrome.runtime.lastError.message;
          console.error('[GBF bg] Attach failed:', err);
          chrome.tabs.sendMessage(tabId, { type: 'DEBUGGER_ERROR', message: err }).catch(() => { });
          resolve(false);
        } else {
          console.log('[GBF bg] Attached successfully');
          resolve(true);
        }
      });
    });
  });
}

async function detachDebugger(tabId) {
  const target = { tabId };
  return new Promise((resolve) => {
    chrome.debugger.detach(target, () => {
      chrome.runtime.lastError;
      console.log('[GBF bg] Detached from', tabId);
      resolve();
    });
  });
}

async function executeDebuggerClick(tabId, x, y) {
  const target = { tabId };
  try {
    const attached = await attachDebugger(tabId);
    if (!attached) return { success: false, error: 'Could not attach' };

    const startX = state.lastMouseX || Math.floor(Math.random() * 800 + 100);
    const startY = state.lastMouseY || Math.floor(Math.random() * 400 + 100);

    const steps = Math.floor(Math.random() * 6) + 8;
    const cpX = (startX + x) / 2 + (Math.random() - 0.5) * 80;
    const cpY = (startY + y) / 2 + (Math.random() - 0.5) * 80;
    const moveDuration = 100 + Math.random() * 100;

    for (let s = 1; s <= steps; s++) {
      const t = easeInOut(s / steps);
      const mx = Math.floor((1 - t) * (1 - t) * startX + 2 * (1 - t) * t * cpX + t * t * x);
      const my = Math.floor((1 - t) * (1 - t) * startY + 2 * (1 - t) * t * cpY + t * t * y);
      await new Promise(r => chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x: mx, y: my }, r));
    }

    await new Promise(r => chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, r));
    await sleep(30);

    await new Promise(r => chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, r));
    await sleep(60 + Math.random() * 50);
    await new Promise(r => chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, r));

    state.lastMouseX = x;
    state.lastMouseY = y;
    return { success: true };
  } catch (e) {
    console.error('[GBF bg] click error:', e.message);
    return { success: false, error: e.message };
  }
}



// ── Найти вкладку GBF ───────────────────────────────
// Ищем ТОЛЬКО вкладки игры. Раньше был fallback на "любую вкладку",
// из-за которого debugger мог подключиться к постороннему сайту
// (почта, банк и т.п.) и кликер начал бы кликать по нему.
async function findGBFTab() {
  const tabs = await chrome.tabs.query({
    url: ['*://game.granbluefantasy.jp/*', '*://gbf.game.mbga.jp/*']
  });
  return tabs[0] || null;
}

// ── Остановить запись на всех вкладках ──────────────
function stopRecordingEverywhere() {
  chrome.tabs.query({ url: '*://game.granbluefantasy.jp/*' }, (tabs) => {
    tabs.forEach(t => chrome.tabs.sendMessage(t.id, { type: 'STOP_RECORD' }).catch(() => { }));
  });
}

// ── Обработка команд от панели ──────────────────────
function handleClickerMessage(msg) {
  if (msg.type === 'UPDATE_STATE_STEPS') {
    state.currentSteps = msg.steps || [];
    return;
  }

  if (msg.type === 'START_RECORD') {
    // Сначала останавливаем всё что было
    stopRecordingEverywhere();
    state.recording = true;
    state.playing = false;
    state.lastClickTime = Date.now();
    state.currentSteps = [];

    findGBFTab().then(targetTab => {
      if (!targetTab) { console.error('[GBF bg] Вкладка GBF не найдена!'); state.recording = false; return; }
      state.activeTabId = targetTab.id;

      // Подключаем отладчик на все время записи
      attachDebugger(targetTab.id);

      // Задержка чтобы STOP успел дойти раньше
      setTimeout(() => {
        chrome.tabs.sendMessage(targetTab.id, {
          type: 'START_RECORD',
          lastClickTime: state.lastClickTime
        }).catch(e => console.error('[GBF bg] Ошибка отправки START_RECORD:', e.message));
      }, 150);
    });
    return;
  }

  if (msg.type === 'STOP_RECORD') {
    const tId = state.activeTabId;
    state.recording = false;
    stopRecordingEverywhere();
    state.activeTabId = null;

    // Отключаем отладчик если не идет воспроизведение
    if (!state.playing && tId) detachDebugger(tId);
    return;
  }

  if (msg.type === 'START_PLAY') {
    findGBFTab().then(async (targetTab) => {
      if (!targetTab) { console.error('[GBF bg] Вкладка GBF не найдена!'); return; }
      state.activeTabId = targetTab.id;
      state.playing = true;
      state.recording = false;
      state.paused = false;
      state.currentSteps = msg.steps || state.currentSteps;
      if (msg.settings) state.jitterSettings = msg.settings;
      state.repeatCount = msg.repeatCount || 1;
      state.currentRep = 0;
      state.currentStepIndex = 0;
      state.offsets = {};

      // Подключаем отладчик ПЕРЕД стартом
      console.log('[GBF bg] Attaching debugger for play...');
      await attachDebugger(targetTab.id);

      chrome.tabs.sendMessage(state.activeTabId, {
        type: 'START_PLAY', steps: state.currentSteps, repeatCount: state.repeatCount
      }).catch(() => { });
    });
    return;
  }

  if (msg.type === 'STOP_PLAY') {
    const tId = state.activeTabId;
    state.playing = false;
    state.paused = false;
    chrome.storage.local.remove(['savedStepIndex', 'savedRep']);
    if (state.activeTabId) chrome.tabs.sendMessage(state.activeTabId, { type: 'STOP_PLAY' }).catch(() => { });

    // Отключаем отладчик если не идет запись
    if (!state.recording && tId) detachDebugger(tId);
    return;
  }

  if (msg.type === 'PAUSE_PLAY') {
    state.paused = true;
    if (state.activeTabId) chrome.tabs.sendMessage(state.activeTabId, { type: 'PAUSE_PLAY' }).catch(() => { });
    return;
  }

  if (msg.type === 'RESUME_PLAY') {
    state.paused = false;
    if (state.activeTabId) chrome.tabs.sendMessage(state.activeTabId, { type: 'RESUME_PLAY' }).catch(() => { });
    return;
  }

  if (msg.type === 'OPEN_CLICKER') {
    chrome.windows.getAll({ populate: true }, (windows) => {
      const existing = windows.find(w => w.tabs.some(t => t.url.includes('panel.html')));
      if (existing) {
        chrome.windows.update(existing.id, { focused: true });
      } else {
        createInSavedPos('clicker/panel.html', 'panel', 315, 600);
      }
    });
    return;
  }
}

// ── Постоянный порт от панели (держит worker живым) ──
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'panel') return;
  console.log('[GBF bg] Панель подключена через порт');
  port.onMessage.addListener((msg) => handleClickerMessage(msg));
  port.onDisconnect.addListener(() => {
    console.log('[GBF bg] Панель отключилась');
    handleClickerMessage({ type: 'STOP_RECORD' });
    handleClickerMessage({ type: 'STOP_PLAY' });
  });
});

// ── Сообщения кликера ────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === 'GET_STATE') {
    chrome.storage.local.get(['savedStepIndex', 'savedRep'], (res) => {
      const resp = { ...state };
      // Если в хранилище есть данные, они ГЛАВНЕЕ тех, что в памяти (т.к. воркер мог перезагрузиться)
      if (res.savedStepIndex !== undefined) {
        resp.currentStepIndex = res.savedStepIndex;
        state.currentStepIndex = res.savedStepIndex; // Синхронизируем память
      }
      if (res.savedRep !== undefined) {
        resp.currentRep = res.savedRep;
        state.currentRep = res.savedRep; // Синхронизируем память
      }
      console.log('[GBF bg] Отправка состояния в Content:', resp.currentStepIndex, '/', resp.currentRep);
      sendResponse(resp);
    });
    return true;
  }

  if (msg.type === 'GET_STAMINA') {
    findGBFTab().then(tab => {
      if (!tab) { sendResponse(null); return; }
      chrome.tabs.sendMessage(tab.id, { type: 'GET_STAMINA' }, (resp) => {
        sendResponse(resp || null);
      });
    });
    return true;
  }


  if (msg.type === 'STEP_RECORDED' && sender.tab) {
    const last = state.currentSteps[state.currentSteps.length - 1];
    if (!(last && last.selector === msg.step.selector && msg.step.delay < 300)) {
      state.currentSteps.push(msg.step);
      chrome.runtime.sendMessage({ type: 'UPDATE_PANEL_STEPS', steps: state.currentSteps }).catch(() => { });
    }
    if (msg.lastClickTime) {
      state.lastClickTime = msg.lastClickTime;
    }
    return;
  }

  if (msg.type === 'EXECUTE_REAL_CLICK') {
    const tabId = sender.tab?.id || state.activeTabId;
    if (tabId) {
      executeDebuggerClick(tabId, msg.x, msg.y).then(result => {
        sendResponse(result);
      });
      return true; // Держим канал открытым для асинхронного ответа
    }
    sendResponse({ success: false, error: 'No active tab' });
    return true;
  }

  if (msg.type === 'SET_DELAY_MULTIPLIER') {
    // Пробрасываем на вкладку GBF
    if (state.activeTabId) {
      chrome.tabs.sendMessage(state.activeTabId, msg).catch(() => { });
    } else {
      findGBFTab().then(t => { if (t) chrome.tabs.sendMessage(t.id, msg).catch(() => { }); });
    }
    return;
  }

  if (msg.type === 'SHOW_CLICK' && sender.tab) {
    chrome.runtime.sendMessage({ type: 'SHOW_CLICK', x: msg.x, y: msg.y }).catch(() => { });
    return;
  }


  if (msg.type === 'UPDATE_STATE_OFFSETS' && sender.tab) {
    state.offsets[msg.stepIndex] = msg.offset;
    return;
  }
  if (msg.from === 'panel' || msg.type === 'OPEN_CLICKER') {
    handleClickerMessage(msg);
    return;
  }

  if (sender.tab) {
    if (msg.type === 'PLAY_PROGRESS') {
      state.currentRep = msg.rep - 1;
      state.currentStepIndex = msg.stepIndex || 0;

      // Сохраняем прогресс в хранилище, чтобы не терять при перезагрузке
      chrome.storage.local.set({
        savedStepIndex: state.currentStepIndex,
        savedRep: state.currentRep
      });

      if (state.currentRep >= state.nextUpdateRep && state.currentStepIndex === 0) {
        state.offsets = {};
        state.nextUpdateRep = state.currentRep + Math.floor(Math.random() * 16) + 10;
      }
    }
    if (msg.type === 'NEED_RECOVERY') {
      state.playing = false;
      chrome.runtime.sendMessage({ type: 'NEED_RECOVERY' }).catch(() => { });
      if (state.activeTabId) {
        chrome.tabs.sendMessage(state.activeTabId, { type: 'PLAY_AUDIO', sound: 'AP', volume: state.audioVolume, repeats: state.audioRepeats });
      }
    }
    if (msg.type === 'PLAY_DONE') {
      state.playing = false;
      state.paused = false;
      const tId = state.activeTabId;
      state.activeTabId = null;
      if (tId) {
        chrome.tabs.sendMessage(tId, { type: 'PLAY_AUDIO', sound: 'done', volume: state.audioVolume, repeats: 1 }).catch(() => { });
        // Отключаем отладчик
        if (!state.recording) detachDebugger(tId);
      }
    }
    if (msg.type === 'PLAY_ERROR') {
      state.playing = false;
      state.paused = false;
      const tId = state.activeTabId;
      state.activeTabId = null;
      chrome.runtime.sendMessage({ type: 'PLAY_DONE' }).catch(() => { }); // Обновляем UI панели (останавливаем её)
      if (tId) {
        chrome.tabs.sendMessage(tId, { type: 'PLAY_AUDIO', sound: 'error', volume: state.audioVolume, repeats: state.audioRepeats }).catch(() => { });
        // Отключаем отладчик
        if (!state.recording) detachDebugger(tId);
      }
    }
    if (msg.type === 'CAPTCHA_DETECTED') {
      state.playing = false;
      if (state.activeTabId) {
        chrome.tabs.sendMessage(state.activeTabId, { type: 'PLAY_AUDIO', sound: 'error', volume: state.audioVolume, repeats: state.audioRepeats });
      }
    }
    if (msg.type === 'UPDATE_JITTER_SETTINGS') {
      if (msg.settings) state.jitterSettings = msg.settings;
      // Пробрасываем в контент
      if (state.activeTabId) {
        chrome.tabs.sendMessage(state.activeTabId, { type: 'SET_JITTER', settings: state.jitterSettings }).catch(() => { });
      }
    }
    chrome.runtime.sendMessage(msg).catch(() => { });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.activeTabId) {
    state.recording = false; state.playing = false; state.activeTabId = null;
    chrome.runtime.sendMessage({ type: 'PLAY_DONE' }).catch(() => { });
  }
});

// Возобновление после перезагрузки вкладки
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && tabId === state.activeTabId) {
    setTimeout(() => chrome.tabs.sendMessage(tabId, { type: 'RECHECK_STATE' }).catch(() => { }), 1000);
  }
});
