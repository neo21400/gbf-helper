// ── Auto-Clicker: контент-скрипт ─────────────────────────────────────────
// Инжектится из background.js только если папка clicker/ на месте.
// Живёт в том же isolated world, что и content.js, поэтому пользуется его
// хелперами (isExtensionAlive, safeSend и т.д.) напрямую.
if (typeof isExtensionAlive !== 'function') {
  console.error('[GBF Clicker] content.js не загружен — кликер отключён.');
} else if (globalThis.__gbfClickerLoaded) {
  console.log('[GBF Clicker] уже загружен, пропускаем.');
} else {
  globalThis.__gbfClickerLoaded = true;

let recordingActive = false;
let playingActive = false;
let isPaused = false;
let lastClickTime = null;
let currentSessionOffsets = {}; // Локальная копия смещений из фона

// Ядро дёрнет это, когда контекст расширения умрёт (перезагрузка расширения)
onContextLoss(() => {
  recordingActive = false;
  playingActive = false;
  isPaused = false;
  try { document.removeEventListener('mousedown', clickHandler, true); } catch (e) { }
});


let jitterSettings = {
  mode: 'percent',
  percent: 15,
  cap: 500,
  min: -150,
  max: 300,
  flat: 300,
  speed: 1.0
};

if (isExtensionAlive()) {
  chrome.storage.local.get(['jitterSettings'], (d) => {
    if (chrome.runtime.lastError) return;
    if (d.jitterSettings) jitterSettings = d.jitterSettings;
  });
}

function calculateJitteredDelay(recordedDelay, minAllowed = 300) {
  const s = jitterSettings;
  let variation = 0;

  if (s.mode === 'percent' || s.mode === 'capped') {
    const p = s.percent / 100;
    variation = recordedDelay * (Math.random() * (p * 2) - p);
    if (s.mode === 'capped' && Math.abs(variation) > s.cap) {
      variation = Math.sign(variation) * s.cap;
    }
  } else if (s.mode === 'range') {
    variation = s.min + Math.random() * (s.max - s.min);
  }

  // Добавляем случайную составляющую от плоской задержки (flat)
  const flatJitter = Math.random() * s.flat;
  const total = Math.max(minAllowed, recordedDelay + variation + flatJitter);
  return total * (s.speed || 1.0);
}

// Время последней смены URL — используем чтобы не кликать сразу после перехода
let lastPageChangeTime = Date.now();
window.addEventListener('hashchange', () => {
  lastPageChangeTime = Date.now();
  console.log('[GBF] Смена страницы:', window.location.hash);
});

// ── Визуальный курсор ────────────────────────────────
let vizEnabled = false;

function createClickDot(x, y) {
  if (!vizEnabled) return;
  const dot = document.createElement('div');
  dot.className = 'gbf-click-dot';
  dot.style.cssText = `
        position:fixed; left:${x}px; top:${y}px;
        width:12px; height:12px; margin:-6px 0 0 -6px;
        border-radius:50%; background:rgba(2,136,209,0.8);
        border:2px solid white; pointer-events:none;
        z-index:999999; transition:transform 0.15s, opacity 0.3s;
    `;
  document.body.appendChild(dot);
  // Анимация исчезновения
  requestAnimationFrame(() => {
    dot.style.transform = 'scale(2)';
    dot.style.opacity = '0';
  });
  setTimeout(() => dot.remove(), 400);
}

// 2. Проверка капчи
function isCaptchaPresent() {
  const el = document.querySelector('#pop-c-a-i');
  if (!el) return false;

  // Элемент всегда в DOM — проверяем что он реально показан
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  if (el.offsetParent === null && el.offsetWidth === 0) return false;

  // Дополнительно проверяем что внутри есть текст капчи
  const text = el.textContent || '';
  if (text.includes('Access Verification') || text.includes('Enter verification')) return true;

  return false;
}

function checkStaminaShortage() {
  const staminaAfter = document.querySelector('.txt-stamina-after');
  if (staminaAfter) {
    const val = parseInt(staminaAfter.textContent);
    if (!isNaN(val) && val < 0) return true;
  }
  if (document.querySelector('.pop-stamina-shortage')) return true;
  return false;
}

// Читает текущий AP и считает сколько раз можно запустить квест
function getQuestCycles() {
  const staminaDiv = document.querySelector('.txt-stamina');
  const staminaAfter = document.querySelector('.txt-stamina-after');

  // Если элементов нет — мы не на странице квеста
  if (!staminaDiv || !staminaAfter) return null;

  // Вытаскиваем число из текста "AAP: 80 >> "
  const text = staminaDiv.childNodes[0]?.textContent || '';
  const match = text.match(/(\d+)/);
  if (!match) return null;

  const currentAP = parseInt(match[1]);           // текущий AP
  const afterVal = parseInt(staminaAfter.textContent); // AP после квеста

  if (isNaN(currentAP) || isNaN(afterVal)) return null;

  const cost = currentAP - afterVal;            // стоимость квеста
  if (cost <= 0) return null;                     // защита от деления на ноль

  const cycles = Math.floor(currentAP / cost);    // сколько раз хватит AP
  return { currentAP, cost, cycles };
}

// 3. Генератор селекторов
function getSelector(el) {
  if (el.id) return `#${el.id}`;
  if (el.classList && el.classList.length > 0) {
    return `.${el.classList[0]}`;
  }
  return el.tagName.toLowerCase();
}

// 4. Проверка готовности элемента
function isElementReady(el, log = false) {
  if (!el) return false;

  if (el.classList.contains('display-off')) { if (log) console.log(`[GBF] ${getSelector(el)} not ready: class display-off`); return false; }
  if (el.classList.contains('invisible')) { if (log) console.log(`[GBF] ${getSelector(el)} not ready: class invisible`); return false; }
  if (el.classList.contains('disabled')) { if (log) console.log(`[GBF] ${getSelector(el)} not ready: class disabled`); return false; }

  // Проверяем видимость через стили, а не только через offsetWidth
  const style = window.getComputedStyle(el);
  if (style.display === 'none') { if (log) console.log(`[GBF] ${getSelector(el)} not ready: display none`); return false; }
  if (style.visibility === 'hidden') { if (log) console.log(`[GBF] ${getSelector(el)} not ready: visibility hidden`); return false; }

  const op = parseFloat(style.opacity);
  if (op < 0.1) { if (log) console.log(`[GBF] ${getSelector(el)} not ready: opacity is too low (${op})`); return false; }

  // Если размер 0, это может быть анимация — не логируем как ошибку сразу
  if (el.offsetWidth === 0 || el.offsetHeight === 0) return false;

  return true;
}

// 5. Проверка стабильности
async function isElementStable(el, selector) {
  const checks = 3;
  const interval = 100;
  const getState = (e) => JSON.stringify(e.getBoundingClientRect());

  let prev = getState(el);
  for (let i = 0; i < checks; i++) {
    await new Promise(r => setTimeout(r, interval));
    if (!document.body.contains(el)) return false;
    if (!isElementReady(el)) return false;
    const curr = getState(el);
    if (curr !== prev) return false;
    prev = curr;
  }
  return true;
}

// 6. Логика записи клика
const clickHandler = (e) => {
  if (!recordingActive) return;
  // Игнорируем нажатия не левой кнопкой мыши
  if (e.button !== 0) return;

  const now = Date.now();
  const delay = lastClickTime ? (now - lastClickTime) : 1000;
  lastClickTime = now;

  const rect = e.target.getBoundingClientRect();
  const step = {
    selector: getSelector(e.target),
    x: Math.floor(rect.left + rect.width / 2),
    y: Math.floor(rect.top + rect.height / 2),
    delay: delay,
    action: 'click',
    snapshot: null
  };

  safeSend({
    type: 'STEP_RECORDED',
    step,
    lastClickTime
  });
};

// 6. Запись кнопки "Назад"
window.addEventListener('mouseup', (e) => {
  if (!recordingActive || e.button !== 3) return;
  const now = Date.now();
  const delay = lastClickTime ? (now - lastClickTime) : 1000;
  lastClickTime = now;

  safeSend({
    type: 'STEP_RECORDED',
    step: { action: 'back', delay: delay, selector: 'window' },
    lastClickTime
  });
});

function handleStamina() {
  if (checkStaminaShortage()) {
    console.log("[GBF Helper] Стамина кончилась!");
    playingActive = false;

    safeSend({ type: 'NEED_RECOVERY' });
    return true;
  }
  return false;
}




async function waitForPageTransition(clickedEl, timeout = 5000) {
  const startUrl = window.location.href;
  const startHash = window.location.hash;
  const start = Date.now();

  while ((Date.now() - start < timeout) && playingActive) {
    await new Promise(r => setTimeout(r, 100));

    // URL изменился — страница точно начала переход
    if (window.location.href !== startUrl) {
      console.log('[GBF] Переход страницы обнаружен:', startHash, '→', window.location.hash);
      // Увеличиваем задержку после перехода страницы до 1.5 сек для стабильности
      await new Promise(r => setTimeout(r, 1500));
      return 'url_changed';
    }

    // Элемент был нажат и теперь скрыт (display-off) или удален
    if (!document.body.contains(clickedEl) || !isElementReady(clickedEl)) {
      console.log('[GBF] Элемент исчез или скрылся — ждем завершения анимации');
      await new Promise(r => setTimeout(r, 800));
      return 'element_gone';
    }
  }

  return 'no_change';
}

// Ждём элемент
async function waitForElementVisible(selector, timeout = 20000) {
  const start = Date.now();
  console.log(`[GBF] Ждём появление: ${selector}...`);

  while ((Date.now() - start < timeout) && playingActive) {
    // Проверка глобального оверлея загрузки GBF
    const loading = document.getElementById('loading');
    if (loading && window.getComputedStyle(loading).display !== 'none') {
      await new Promise(r => setTimeout(r, 200));
      continue;
    }

    const el = document.querySelector(selector);

    // Периодическое логирование причины ожидания раз в 1 сек
    const timeElapsed = Date.now() - start;
    const shouldLog = (timeElapsed % 1000) < 300 && timeElapsed > 500;

    if (el) {
      if (isElementReady(el, shouldLog)) {
        const stable = await isElementStable(el, selector);

        const loadingCheck = document.getElementById('loading');
        const isLoadingNow = loadingCheck && window.getComputedStyle(loadingCheck).display !== 'none';
        if (isLoadingNow && shouldLog) console.log(`[GBF] Ждём глобальный #loading...`);

        if (stable && isElementReady(el) && !isLoadingNow) {

          // --- ЗАЩИТА ОТ ОВЕРЛЕЕВ ---
          const rect = el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const topEl = document.elementFromPoint(cx, cy);

          if (topEl && topEl !== el && !el.contains(topEl)) {
            const topRect = topEl.getBoundingClientRect();
            if (topRect.width > window.innerWidth * 0.5 && topRect.height > window.innerHeight * 0.5) {
              if (shouldLog) console.log(`[GBF] ${selector} перекрыта глобальной маской (${topEl.className || topEl.id}). Ждём...`);
              await new Promise(r => setTimeout(r, 200));
              continue;
            } else if (shouldLog) {
              console.log(`[GBF] ${selector} не полностью перекрыта, topEl = ${topEl.className || topEl.tagName}. Продолжаем.`);
            }
          }

          return el;
        }
      }
    } else {
      if (shouldLog) console.log(`[GBF] Ожидание ${selector} (не найден в DOM)`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  console.error(`[GBF] Timeout waiting for ${selector}`);
  return null;
}

// 7. Воспроизведение паттерна
// 7. Воспроизведение паттерна
async function playPattern(steps, repeatCount, startRep = 0, startStep = 0) {
  if (playingActive) return;
  playingActive = true;

  let initialRep = startRep;
  if (initialRep >= repeatCount && repeatCount > 0) initialRep = repeatCount - 1;

  console.log('%c [GBF] Активация режима безопасности (отладчик)... ', 'background: #222; color: #bada55');
  try {
    await safeSendAsync({ action: 'attach_debugger' });
    console.log('[GBF] Waiting for debugger banner...');
    await new Promise(r => setTimeout(r, 2000));
  } catch (e) {
    console.error('[GBF] Ошибка связи с фоновым скриптом:', e);
  }

  for (let rep = initialRep; rep < repeatCount && playingActive; rep++) {
    let currentStepIdx = (rep === initialRep) ? startStep : 0;

    while (currentStepIdx < steps.length && playingActive) {

      while (isPaused && playingActive) {
        await new Promise(r => setTimeout(r, 500));
      }
      if (!playingActive) break;

      if (handleStamina()) return;

      const step = steps[currentStepIdx];
      console.log(`[GBF] >>> Шаг ${currentStepIdx + 1}/${steps.length}: ${step.selector || step.action}`);

      // Проверка капчи
      while (isCaptchaPresent() && playingActive) {
        safeSend({ type: 'CAPTCHA_DETECTED' });
        await new Promise(r => setTimeout(r, 2000));
      }

      if (step.action === 'back') {
        window.history.back();
        console.log('[GBF] Команда "Назад" — пропуск анимации.');

        currentStepIdx++;
        safeStorageSet('local', { savedStepIndex: currentStepIdx });

        try {
          safeSend({
            type: 'PLAY_PROGRESS',
            rep: rep + 1,
            stepIndex: currentStepIdx
          });
        } catch (e) { }

        const nextStep = steps[currentStepIdx] || (rep + 1 < repeatCount ? steps[0] : null);
        const targetDelay = nextStep ? nextStep.delay : step.delay;

        const scaled = calculateJitteredDelay(targetDelay, 200);
        await new Promise(r => setTimeout(r, scaled));

        continue;
      }

      const el = await waitForElementVisible(step.selector);

      if (!el || !playingActive) {
        console.error(`[GBF] Остановка: Элемент ${step.selector} не найден.`);
        playingActive = false;
        safeSend({ type: 'PLAY_ERROR', message: `Timeout waiting for ${step.selector}` });
        return;
      }

      const rect = el.getBoundingClientRect();

      if (!currentSessionOffsets[currentStepIdx]) {
        const safeX = rect.width * 0.25;
        const safeY = rect.height * 0.25;
        currentSessionOffsets[currentStepIdx] = {
          x: (Math.random() - 0.5) * safeX,
          y: (Math.random() - 0.5) * safeY
        };
        safeSend({ type: 'UPDATE_STATE_OFFSETS', stepIndex: currentStepIdx, offset: currentSessionOffsets[currentStepIdx] });
      }

      const stable = currentSessionOffsets[currentStepIdx];
      const viewX = rect.left + rect.width / 2 + stable.x + (Math.random() - 0.5) * 4;
      const viewY = rect.top + rect.height / 2 + stable.y + (Math.random() - 0.5) * 4;

      const scrollX = window.scrollX || window.pageXOffset || 0;
      const scrollY = window.scrollY || window.pageYOffset || 0;

      const targetX = Math.floor(viewX + scrollX);
      const targetY = Math.floor(viewY + scrollY);

      // 3. Выполнение клика
      console.log(`[GBF] Клик (${targetX}, ${targetY}) на: ${step.selector}`);
      createClickDot(targetX, targetY);

      const clickResult = await safeSendAsync({
        type: 'EXECUTE_REAL_CLICK',
        x: targetX,
        y: targetY
      });

      if (!clickResult || !clickResult.success) {
        console.error('[GBF] Критическая ошибка клика!');
        playingActive = false;
        safeSend({ type: 'PLAY_ERROR' });
        return;
      }

      // --- ВАЖНО: Сохраняем прогресс МГНОВЕННО прямо отсюда ---
      // Инкрементируем индекс заранее, т.к. страница может начать обновляться прямо сейчас
      const nextIdx = currentStepIdx + 1;
      safeStorageSet('local', { savedStepIndex: nextIdx, savedRep: rep });

      // Сообщаем фону для UI панели
      try {
        safeSend({
          type: 'PLAY_PROGRESS',
          rep: rep + 1,
          stepIndex: nextIdx
        });
      } catch (e) {
        // Если контекст инвалидирован — ничего страшного, storage уже сохранен
      }

      const nextStep = steps[nextIdx] || (rep + 1 < repeatCount ? steps[0] : null);
      let transition = 'no_change';

      if (nextStep && nextStep.action === 'back') {
        console.log('[GBF] Следующий шаг — Назад. Пропускаем ожидание анимации.');
      } else {
        // Ждем реакции игры на клик
        transition = await waitForPageTransition(el, 5000);
      }

      currentStepIdx = nextIdx;

      if (transition === 'url_changed') {
        console.log('[GBF] Страница изменилась, ждем стабилизации...');
        // Добавляем рандом даже после смены страницы (1200-1700мс)
        await new Promise(r => setTimeout(r, 1200 + Math.random() * 500));
      } else {
        const targetDelay = nextStep ? nextStep.delay : step.delay;
        const scaled = calculateJitteredDelay(targetDelay, 300);
        await new Promise(r => setTimeout(r, scaled));
      }
    }
  }

  if (playingActive) {
    playingActive = false;
    safeSend({ type: 'PLAY_DONE' });
  }
}

// Проигрыватель аудио
let activeAudio = null;

async function playAudio(soundFile, volume, repeats) {
  if (repeats <= 0) return;

  if (activeAudio) {
    activeAudio.pause();
  }

  if (!isExtensionAlive()) { handleContextLoss(); return; }
  let url;
  try {
    url = chrome.runtime.getURL(`assets/${soundFile}.mp3`);
  } catch (e) {
    handleContextLoss();
    return;
  }
  const audio = new Audio(url);
  activeAudio = audio;
  audio.volume = volume;

  for (let i = 0; i < repeats; i++) {
    audio.currentTime = 0;
    try {
      await new Promise((resolve) => {
        audio.onended = resolve;
        audio.onerror = resolve;
        const playPromise = audio.play();
        if (playPromise) {
          playPromise.catch(resolve);
        } else {
          resolve();
        }
      });
      if (i < repeats - 1) await new Promise(r => setTimeout(r, 400));
    } catch (e) {
      console.warn('[GBF] Audio play failed:', e);
      break;
    }
  }

  if (activeAudio === audio) {
    activeAudio = null;
  }
}

// 8. Слушатель сообщений
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_RECORD') {
    if (playingActive) return;
    recordingActive = true;
    lastClickTime = msg.lastClickTime || Date.now();
    document.removeEventListener('mousedown', clickHandler, true);
    document.addEventListener('mousedown', clickHandler, true);
  }

  if (msg.type === 'STOP_RECORD') {
    recordingActive = false;
    document.removeEventListener('mousedown', clickHandler, true);
  }

  if (msg.type === 'START_PLAY') {
    if (!playingActive) {
      currentSessionOffsets = {}; // Сброс рандома
      playPattern(
        msg.steps,
        msg.repeatCount || 1,
        msg.currentRep || 0,
        msg.currentStepIndex || 0
      );
    }
  }

  if (msg.type === 'PLAY_AUDIO') {
    playAudio(msg.sound, msg.volume, msg.repeats);
  }

  if (msg.type === 'STOP_PLAY') {
    playingActive = false;
    isPaused = false;
  }

  if (msg.type === 'PAUSE_PLAY') {
    isPaused = true;
  }

  if (msg.type === 'RESUME_PLAY') {
    isPaused = false;
  }

  if (msg.type === 'DEBUGGER_ERROR') {
    console.error('%c [GBF Debugger Error] ', 'background: red; color: white; font-weight: bold;', msg.message);
    if (msg.message.includes('DevTools')) {
      console.warn('!!! Закройте консоль разработчика (F12) и попробуйте снова !!!');
    }
  }

  if (msg.type === 'SET_VIZ') {
    vizEnabled = msg.enabled;
  }
  if (msg.type === 'SET_JITTER') {
    if (msg.settings) jitterSettings = msg.settings;
  }

  if (msg.type === 'RECHECK_STATE') checkState();

  if (msg.type === 'GET_STAMINA') {
    sendResponse(getQuestCycles());
    return true;
  }
});

// 9. Инициализация
function checkState() {
  safeSendCallback({ type: 'GET_STATE' }, (state) => {
    if (!state) return;

    if (state.recording) {
      console.log('[GBF] Возобновление записи...');
      recordingActive = true;
      lastClickTime = state.lastClickTime;
      document.removeEventListener('mousedown', clickHandler, true);
      document.addEventListener('mousedown', clickHandler, true);
    }

    if (state.playing) {
      isPaused = state.paused || false;
      if (state.jitterSettings) jitterSettings = state.jitterSettings;
      if (!playingActive) {
        const step = state.currentStepIndex || 0;
        const rep = state.currentRep || 0;
        console.log(`[GBF] Возобновление: Шаг ${step + 1}, Повтор ${rep + 1}${isPaused ? ' (На паузе)' : ''}`);
        currentSessionOffsets = state.offsets || {};
        playPattern(state.currentSteps, state.repeatCount, rep, step);
      }
    } else {
      playingActive = false;
      isPaused = false;
    }
  });
}

function init() {
  if (isExtensionAlive()) {
    chrome.storage.local.get('vizEnabled', (d) => {
      if (chrome.runtime.lastError) return;
      vizEnabled = d.vizEnabled || false;
    });
  }

  // Даем игре время инициализировать свои глобальные объекты перед первой проверкой
  setTimeout(checkState, 1500);
}

// При смене хеша или URL проверяем, не нужно ли продолжить работу
window.addEventListener('hashchange', checkState);
init();

}
