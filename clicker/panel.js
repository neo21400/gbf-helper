let steps = [];
let patterns = {};
let isRecording = false;
let isPlaying = false;
let isPaused = false;
// Элементы UI
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const stepsList = document.getElementById('steps-list');
const btnRecord = document.getElementById('btn-record');
const btnPlay = document.getElementById('btn-play');
const patternSel = document.getElementById('pattern-select');
const repeatInput = document.getElementById('repeat-count');
const currentRepText = document.getElementById('current-rep');
const totalRepsText = document.getElementById('total-reps-display');
const currentStepText = document.getElementById('current-step-name');
const btnPause = document.getElementById('btn-pause');


// Встроенное подтверждение — вместо системного confirm()

function inlineInput(anchorEl, label, onSubmit) {
    document.querySelectorAll('.inline-confirm, .inline-input').forEach(el => el.remove());

    const box = document.createElement('div');
    box.className = 'inline-input';
    box.innerHTML = `
        <span>${label}</span>
        <input type="text" class="ii-field" placeholder="Название..." maxlength="40">
        <button class="ii-ok">OK</button>
        <button class="ii-cancel">✕</button>
    `;

    anchorEl.parentNode.insertBefore(box, anchorEl.nextSibling);
    const field = box.querySelector('.ii-field');
    field.focus();

    const submit = () => {
        const val = field.value.trim();
        box.remove();
        if (val) onSubmit(val);
    };

    box.querySelector('.ii-ok').addEventListener('click', submit);
    box.querySelector('.ii-cancel').addEventListener('click', () => box.remove());
    field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') box.remove();
    });
}

function inlineConfirm(anchorEl, message, onConfirm) {
    // Убираем предыдущий если есть
    document.querySelectorAll('.inline-confirm').forEach(el => el.remove());

    const box = document.createElement('div');
    box.className = 'inline-confirm';
    box.innerHTML = `
        <span></span>
        <button class="ic-yes">Да</button>
        <button class="ic-no">Нет</button>
    `;
    box.querySelector('span').textContent = message;

    // Вставляем после якорного элемента
    anchorEl.parentNode.insertBefore(box, anchorEl.nextSibling);

    box.querySelector('.ic-yes').addEventListener('click', () => {
        box.remove();
        onConfirm();
    });
    box.querySelector('.ic-no').addEventListener('click', () => box.remove());

    // Закрыть по клику вне
    setTimeout(() => {
        document.addEventListener('click', function handler(e) {
            if (!box.contains(e.target)) { box.remove(); document.removeEventListener('click', handler); }
        });
    }, 50);
}





// ── Визуализация кликов ──────────────────────────────
let vizEnabled = false;
chrome.storage.local.get('vizEnabled', (d) => {
    vizEnabled = d.vizEnabled || false;
    updateVizBtn();
});

document.getElementById('btn-viz')?.addEventListener('click', () => {
    vizEnabled = !vizEnabled;
    chrome.storage.local.set({ vizEnabled });
    // Сообщаем content.js
    sendToBackground({ type: 'SET_VIZ', enabled: vizEnabled });
    updateVizBtn();
});



function updateVizBtn() {
    const el = document.getElementById('viz-state');
    const btn = document.getElementById('btn-viz');
    if (!el || !btn) return;
    el.textContent = vizEnabled ? 'ВКЛ' : 'ВЫКЛ';
    btn.style.background = vizEnabled ? '#1a3a1a' : '#1a2a1a';
    btn.style.borderColor = vizEnabled ? '#4caf50' : '#2d4a2d';
}

// Получаем координаты клика от background и отображаем в панели
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SHOW_CLICK' && vizEnabled) {
        showClickDot(msg.x, msg.y);
    }
});

function showClickDot(x, y) {
    // Показываем координаты в статус-баре если идёт воспроизведение
    const el = document.getElementById('current-step-name');
    if (el) el.textContent = `Клик: ${x}, ${y}`;
}

function initPanel() {
    chrome.storage.local.get(['patterns', 'recoverySteps', 'panelMiniMode'], (data) => {
        patterns = data.patterns || {};
        document.body.classList.remove('mini'); // Mini mode is removed
        refreshPatternList();
    });

    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
        if (!state) return;
        steps = state.currentSteps || [];
        isRecording = state.recording;
        isPlaying = state.playing;
        isPaused = state.paused || false;

        if (state.playing) {
            currentRepText.textContent = (state.currentRep || 0) + 1;
            totalRepsText.textContent = state.repeatCount || 1;
            if (btnPause) {
                btnPause.style.display = 'block';
                btnPause.textContent = isPaused ? '▶' : '⏸';
                btnPause.style.background = isPaused ? '#4caf50' : '#f57c00';
            }
        } else {
            if (btnPause) btnPause.style.display = 'none';
        }
        renderSteps();
        updateUIStates();
    });

    repeatInput.addEventListener('input', () => {
        totalRepsText.textContent = repeatInput.value;
    });
}

document.getElementById('btn-clear-steps')?.addEventListener('click', function () {
    inlineConfirm(this, 'Очистить шаги?', () => {
        steps = [];
        renderSteps();
        chrome.runtime.sendMessage({ from: 'panel', type: 'UPDATE_STATE_STEPS', steps: [] });
    });
});

// ЕДИНАЯ функция отрисовки (исправленная)
function renderSteps() {
    stepsList.innerHTML = '';
    const isMini = document.body.classList.contains('mini');

    if (steps.length === 0) {
        stepsList.innerHTML = '<div style="padding: 20px; text-align: center; color: #555; font-size: 12px;">Список пуст</div>';
        return;
    }

    steps.forEach((step, index) => {
        const div = document.createElement('div');
        div.className = 'step-item';
        div.setAttribute('data-index', index);

        if (isMini) {
            const num = document.createElement('span');
            num.textContent = index + 1;
            div.appendChild(num);
        } else {
            // Селектор берётся со страницы игры (id/class элемента), поэтому
            // собираем строку узлами, а не через innerHTML: атрибут вида
            // id="<img ...>" иначе попал бы в панель настоящей разметкой.
            const label = document.createElement('div');
            label.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; margin-right: 5px;';

            const num = document.createElement('span');
            num.style.color = '#888';
            num.textContent = `${index + 1}.`;

            const actionName = step.action === 'back' ? '⏮ НАЗАД' : (step.selector ?? '');
            label.append(num, ' ', actionName);

            const del = document.createElement('button');
            del.className = 'btn-delete-step';
            del.dataset.index = index;
            del.textContent = '✕';

            div.append(label, del);
        }
        stepsList.appendChild(div);
    });

    if (isRecording) {
        stepsList.scrollTop = stepsList.scrollHeight;
    }
}

// Слушатель сообщений (исправленная логика подсветки)
chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.type) {
        case 'UPDATE_PANEL_STEPS':
            steps = msg.steps;
            renderSteps();
            break;

        case 'PLAY_PROGRESS':
            currentRepText.textContent = msg.rep;
            // Подсветка
            document.querySelectorAll('.step-item').forEach(el => el.classList.remove('active-step-highlight'));
            const currentEl = document.querySelector(`.step-item[data-index="${msg.stepIndex}"]`);
            if (currentEl) {
                currentEl.classList.add('active-step-highlight');
                currentEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            const step = steps[msg.stepIndex];
            if (step) currentStepText.textContent = step.action === 'back' ? 'НАЗАД' : step.selector;
            if (!isPaused) setStatus('Играю...', 'playing');
            break;

        case 'PLAY_DONE':
            isPlaying = false;
            isRecording = false;
            isPaused = false;
            if (btnPause) btnPause.style.display = 'none';
            updateUIStates();
            setStatus('Готово!', 'idle');
            currentStepText.textContent = '-';
            document.querySelectorAll('.step-item').forEach(el => el.classList.remove('active-step-highlight'));
            break;

        case 'CAPTCHA_DETECTED':
            setStatus('⚠ КАПЧА!', 'captcha');
            break;

        case 'NEED_RECOVERY':
            setStatus('⚠ Нет AP!', 'captcha');
            break;
    }
});

// Кнопки управления
btnRecord.addEventListener('click', function () {
    if (!isRecording) {
        isRecording = true;
        steps = [];
        renderSteps();
        sendToBackground({ type: 'START_RECORD', isRecovery: false });
    } else {
        isRecording = false;
        sendToBackground({ type: 'STOP_RECORD' });
    }
    updateUIStates();
});

btnPlay.addEventListener('click', () => {
    if (!isPlaying) {
        if (!steps.length) return setStatus('Сначала запиши шаги!', 'idle');
        isPlaying = true;
        isPaused = false;
        if (btnPause) {
            btnPause.style.display = 'block';
            btnPause.textContent = '⏸';
            btnPause.style.background = '#f57c00';
        }
        const count = parseInt(repeatInput.value) || 1;
        totalRepsText.textContent = count;
        sendToBackground({ type: 'START_PLAY', steps, repeatCount: count, settings: getCurrentJitterSettings() });
    } else {
        isPlaying = false;
        isPaused = false;
        if (btnPause) btnPause.style.display = 'none';
        sendToBackground({ type: 'STOP_PLAY' });
    }
    updateUIStates();
});

if (btnPause) {
    btnPause.addEventListener('click', () => {
        isPaused = !isPaused;
        btnPause.textContent = isPaused ? '▶' : '⏸';
        btnPause.style.background = isPaused ? '#4caf50' : '#f57c00';
        sendToBackground({ type: isPaused ? 'PAUSE_PLAY' : 'RESUME_PLAY' });
        setStatus(isPaused ? 'Пауза' : 'Играю...', isPaused ? 'idle' : 'playing');
    });
}

// Удаление шагов
stepsList.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-delete-step')) {
        const index = parseInt(e.target.dataset.index);
        steps.splice(index, 1);
        renderSteps();
        chrome.runtime.sendMessage({ from: 'panel', type: 'UPDATE_STATE_STEPS', steps, settings: getCurrentJitterSettings() });
    }
});

// Паттерны
patternSel.addEventListener('change', () => {
    const name = patternSel.value;
    if (name && patterns[name]) {
        const data = patterns[name];
        if (data.steps) {
            steps = data.steps;
            if (data.settings) {
                // Restore settings from pattern
                applyJitterSettings(data.settings);
            }
        } else {
            steps = data; // Legacy
        }
        renderSteps();
        chrome.runtime.sendMessage({ from: 'panel', type: 'UPDATE_STATE_STEPS', steps, settings: data.settings });
    }
});

document.getElementById('btn-save')?.addEventListener('click', function () {
    if (steps.length === 0) return;
    inlineInput(this, 'Название:', (name) => {
        if (!name.trim()) return;

        const settings = {
            mode: document.getElementById('delay-mode').value,
            percent: parseInt(document.getElementById('jitter-percent-num').value),
            cap: parseInt(document.getElementById('jitter-cap-num').value),
            min: parseInt(document.getElementById('jitter-min').value),
            max: parseInt(document.getElementById('jitter-max').value),
            flat: parseInt(document.getElementById('jitter-flat-num').value),
            speed: parseFloat(document.getElementById('speed-num').value)
        };

        patterns[name.trim()] = {
            steps: [...steps],
            settings: settings
        };
        chrome.storage.local.set({ patterns }, refreshPatternList);
    });
});

document.getElementById('btn-delete-pattern')?.addEventListener('click', function () {
    const name = patternSel.value;
    if (!name) return;
    inlineConfirm(this, `Удалить «${name}»?`, () => {
        delete patterns[name];
        chrome.storage.local.set({ patterns }, () => {
            refreshPatternList();
            steps = [];
            renderSteps();
        });
    });
});



function updateUIStates() {
    // Основная кнопка
    btnRecord.textContent = isRecording ? '⏹ Стоп' : '⏺ Запись';
    btnRecord.classList.toggle('active-record', isRecording);

    // Кнопка запуска
    btnPlay.textContent = isPlaying ? '⏹ Стоп' : '▶ Запустить';
    btnPlay.classList.toggle('active-play', isPlaying);

    if (isRecording) {
        setStatus('Запись...', 'recording');
    } else if (isPlaying) {
        setStatus('Играю...', 'playing');
    } else {
        setStatus('Готов', 'idle');
    }
}

function setStatus(text, mode = 'idle') {
    statusText.textContent = text;
    statusDot.className = 'status-dot ' + mode;
}

// Постоянный порт — не даёт service worker засыпать
let _port = null;

function getPort() {
    if (_port) return _port;
    _port = chrome.runtime.connect({ name: 'panel' });
    _port.onDisconnect.addListener(() => {
        console.log('[panel] Порт отключён, пересоздаём...');
        _port = null;
    });
    return _port;
}

function sendToBackground(msg) {
    console.log('[panel] sendToBackground:', msg.type, JSON.stringify(msg));
    try {
        getPort().postMessage({ ...msg, from: 'panel' });
    } catch (e) {
        console.error('[panel] Ошибка порта:', e.message, '— пересоздаём');
        _port = null;
        try { getPort().postMessage({ ...msg, from: 'panel' }); } catch (e2) {
            console.error('[panel] Повторная ошибка:', e2.message);
        }
    }
}

function refreshPatternList() {
    patternSel.innerHTML = '<option value="">— выбрать —</option>';
    Object.keys(patterns).forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        const count = patterns[name].steps ? patterns[name].steps.length : patterns[name].length;
        opt.textContent = `${name} (${count})`;
        patternSel.appendChild(opt);
    });
}

// Settings Modal
const settingsModal = document.getElementById('settings-modal');
document.getElementById('btn-settings-open')?.addEventListener('click', () => {
    settingsModal.classList.add('active');
});
document.getElementById('btn-settings-close')?.addEventListener('click', () => {
    settingsModal.classList.remove('active');
});

// Audio Settings
const audioVolumeSlider = document.getElementById('audio-volume');
const audioVolumeLabel = document.getElementById('volume-label');
const audioRepeatsInput = document.getElementById('audio-repeats');

chrome.storage.local.get(['audioVolume', 'audioRepeats'], (d) => {
    const vol = d.audioVolume !== undefined ? d.audioVolume : 0.5;
    const reps = d.audioRepeats !== undefined ? d.audioRepeats : 3;
    if (audioVolumeSlider) audioVolumeSlider.value = vol;
    if (audioVolumeLabel) audioVolumeLabel.textContent = Math.round(vol * 100) + '%';
    if (audioRepeatsInput) audioRepeatsInput.value = reps;
});

audioVolumeSlider?.addEventListener('input', () => {
    const val = parseFloat(audioVolumeSlider.value);
    audioVolumeLabel.textContent = Math.round(val * 100) + '%';
    chrome.storage.local.set({ audioVolume: val });
    sendToBackground({ type: 'UPDATE_AUDIO_SETTINGS', volume: val });
});

audioRepeatsInput?.addEventListener('input', () => {
    const val = parseInt(audioRepeatsInput.value) || 0;
    chrome.storage.local.set({ audioRepeats: val });
    sendToBackground({ type: 'UPDATE_AUDIO_SETTINGS', repeats: val });
});

// Jitter Settings
const delayModeSel = document.getElementById('delay-mode');
const jitterPercentSlider = document.getElementById('jitter-percent');
const jitterPercentNum = document.getElementById('jitter-percent-num');
const jitterCapSlider = document.getElementById('jitter-cap');
const jitterCapNum = document.getElementById('jitter-cap-num');
const jitterMinNum = document.getElementById('jitter-min');
const jitterMaxNum = document.getElementById('jitter-max');
const jitterFlatSlider = document.getElementById('jitter-flat');
const jitterFlatNum = document.getElementById('jitter-flat-num');
const speedSlider = document.getElementById('speed-slider');
const speedNum = document.getElementById('speed-num');

const modeBlocks = {
    percent: document.getElementById('mode-params-percent'),
    capped: document.getElementById('mode-params-capped'),
    range: document.getElementById('mode-params-range')
};
const formulaHint = document.getElementById('delay-formula-hint');

function getCurrentJitterSettings() {
    return {
        mode: delayModeSel.value,
        percent: parseInt(jitterPercentNum.value) || 0,
        cap: parseInt(jitterCapNum.value) || 0,
        min: parseInt(jitterMinNum.value) || 0,
        max: parseInt(jitterMaxNum.value) || 0,
        flat: parseInt(jitterFlatNum.value) || 0,
        speed: parseFloat(speedNum.value) || 1.0
    };
}

function updateModeVisibility() {
    const mode = delayModeSel.value;
    modeBlocks.percent.style.display = (mode === 'percent' || mode === 'capped') ? 'flex' : 'none';
    modeBlocks.capped.style.display = (mode === 'capped') ? 'flex' : 'none';
    modeBlocks.range.style.display = (mode === 'range') ? 'flex' : 'none';

    if (mode === 'percent') formulaHint.textContent = 'Delay = ((Rec * Jitter%) + Extra) * Speed';
    else if (mode === 'capped') formulaHint.textContent = 'Delay = ((Rec * Jitter% [cap X]) + Extra) * Speed';
    else if (mode === 'range') formulaHint.textContent = 'Delay = (Rec + Random(Min, Max) + Extra) * Speed';
}

function applyJitterSettings(s) {
    if (!s) return;
    if (s.mode) delayModeSel.value = s.mode;
    if (s.percent !== undefined) { jitterPercentSlider.value = s.percent; jitterPercentNum.value = s.percent; }
    if (s.cap !== undefined) { jitterCapSlider.value = s.cap; jitterCapNum.value = s.cap; }
    if (s.min !== undefined) jitterMinNum.value = s.min;
    if (s.max !== undefined) jitterMaxNum.value = s.max;
    if (s.flat !== undefined) { jitterFlatSlider.value = s.flat; jitterFlatNum.value = s.flat; }
    if (s.speed !== undefined) { speedSlider.value = s.speed; speedNum.value = s.speed; }
    updateModeVisibility();
    saveAllSettings();
}

function saveAllSettings() {
    const settings = getCurrentJitterSettings();
    chrome.storage.local.set({ jitterSettings: settings });
    sendToBackground({ type: 'UPDATE_JITTER_SETTINGS', settings });
}

chrome.storage.local.get(['jitterSettings'], (d) => {
    if (d.jitterSettings) applyJitterSettings(d.jitterSettings);
});

delayModeSel?.addEventListener('change', () => {
    updateModeVisibility();
    saveAllSettings();
});

const sync = (slider, num, min, max, key) => {
    const update = (val) => {
        val = parseInt(val) || 0;
        if (min !== null && val < min) val = min;
        if (max !== null && val > max) val = max;
        if (slider) slider.value = val;
        if (num) num.value = val;
        saveAllSettings();
    };
    slider?.addEventListener('input', (e) => update(e.target.value));
    num?.addEventListener('change', (e) => update(e.target.value));
};

sync(jitterPercentSlider, jitterPercentNum, 0, 100);
sync(jitterCapSlider, jitterCapNum, 50, 5000);
sync(jitterFlatSlider, jitterFlatNum, 0, 5000);

const syncFloat = (slider, num, min, max) => {
    const update = (val) => {
        val = parseFloat(val) || 1.0;
        if (min !== null && val < min) val = min;
        if (max !== null && val > max) val = max;
        if (slider) slider.value = val;
        if (num) num.value = val.toFixed(1);
        saveAllSettings();
    };
    slider?.addEventListener('input', (e) => update(e.target.value));
    num?.addEventListener('change', (e) => update(e.target.value));
};

syncFloat(speedSlider, speedNum, 0.1, 10.0);

jitterMinNum?.addEventListener('change', () => saveAllSettings());
jitterMaxNum?.addEventListener('change', () => saveAllSettings());

document.getElementById('btn-auto-reps')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'GET_STAMINA' }, (data) => {
        if (!data) {
            setStatus('Открой экран квеста!', 'idle');
            return;
        }
        repeatInput.value = data.cycles;
        totalRepsText.textContent = data.cycles;
        setStatus(`AP: ${data.currentAP} / цена: ${data.cost}`, 'idle');
    });
});

initPanel();