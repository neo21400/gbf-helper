const btnClicker = document.getElementById('btn-clicker');

btnClicker.onclick = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_CLICKER' });
    window.close();
};

// Кнопка кликера скрыта по умолчанию: показываем только когда фон подтвердил,
// что модуль clicker/ подключился. Без папки сборка работает как Loot + Calc.
chrome.runtime.sendMessage({ type: 'CLICKER_AVAILABLE' }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res && res.available) btnClicker.hidden = false;
});

document.getElementById('btn-loot').onclick = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_LOOT' });
    window.close();
};

document.getElementById('btn-calc').onclick = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_CALC' });
    window.close();
};

document.getElementById('btn-gacha').onclick = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_GACHA' });
    window.close();
};

// --- Version & update check ---
const btnUpdate = document.getElementById('btn-update');
const btnUpdateIcon = btnUpdate.querySelector('i');
const elUpdateStatus = document.getElementById('update-status');
const currentVersion = chrome.runtime.getManifest().version;

document.getElementById('version-label').textContent = `Version ${currentVersion}`;

let hideStatusTimer;
function showStatus(text, kind) {
    clearTimeout(hideStatusTimer);
    elUpdateStatus.textContent = text;
    elUpdateStatus.className = kind || '';
    elUpdateStatus.hidden = false;
}
function hideStatus(delay = 0) {
    clearTimeout(hideStatusTimer);
    hideStatusTimer = setTimeout(() => { elUpdateStatus.hidden = true; }, delay);
}

// manual=false — тихая проверка при открытии попапа: спиннера нет, отчёт только
// если обновление действительно есть, и ответ может прийти из кеша фона
function checkUpdate(manual) {
    if (manual) {
        btnUpdate.disabled = true;
        btnUpdateIcon.classList.add('fa-spin');
        showStatus('Checking...', '');
    }
    chrome.runtime.sendMessage({ type: 'CHECK_UPDATE', force: !!manual }, (res) => {
        btnUpdate.disabled = false;
        btnUpdateIcon.classList.remove('fa-spin');

        if (chrome.runtime.lastError || !res || !res.ok) {
            if (!manual) return hideStatus();
            const why = chrome.runtime.lastError ? 'no response' : (res && res.error) || 'unknown';
            showStatus(`Check failed: ${why}`, 'failed');
            return;
        }
        if (res.newer) {
            showStatus(`New version ${res.latest} available`, 'available');
            elUpdateStatus.onclick = () => {
                chrome.tabs.create({ url: res.url });
                window.close();
            };
            return;
        }
        elUpdateStatus.onclick = null;
        if (!manual) return hideStatus();
        // Сама по себе актуальная версия — не новость, но на явный клик надо
        // ответить хоть чем-то, иначе кнопка выглядит сломанной
        showStatus('Up to date', '');
        hideStatus(2500);
    });
}

btnUpdate.onclick = () => checkUpdate(true);
checkUpdate(false);

// --- Sync UI Logic ---
const elUser = document.getElementById('sync-user');
const elPass = document.getElementById('sync-pass');
const elStatus = document.getElementById('sync-status');
const btnLogin = document.getElementById('btn-login');
const btnRegister = document.getElementById('btn-register');

function setStatus(msg, isError = false) {
    elStatus.textContent = msg;
    elStatus.style.color = isError ? '#f08080' : '#0288d1';
}

chrome.runtime.sendMessage({ type: 'SYNC_GET_STATE' }, (state) => {
    if (state.username) elUser.value = state.username;
    // Пароль намеренно не сохраняется и не автозаполняется
    if (state.token) {
        setStatus(`Signed in as ${state.username}`);
    } else {
        setStatus('Not signed in');
    }
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SYNC_STATUS') {
        setStatus(msg.message, msg.isError);
    }
});

btnLogin.onclick = () => {
    const user = elUser.value.trim();
    const pass = elPass.value;
    if (!user || !pass) return setStatus('Enter username and password', true);
    setStatus('Signing in...');
    chrome.runtime.sendMessage({ type: 'SYNC_LOGIN', username: user, password: pass });
};

btnRegister.onclick = () => {
    const user = elUser.value.trim();
    const pass = elPass.value;
    if (!user || !pass) return setStatus('Enter username and password', true);
    setStatus('Registering...');
    chrome.runtime.sendMessage({ type: 'SYNC_REGISTER', username: user, password: pass });
};

document.getElementById('btn-sync-now').onclick = () => {
    chrome.runtime.sendMessage({ type: 'SYNC_DOWNLOAD' });
};
