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

// --- Update button ---
const btnUpdate = document.getElementById('btn-update');
const elUpdateStatus = document.getElementById('update-status');

btnUpdate.onclick = () => {
    btnUpdate.disabled = true;
    elUpdateStatus.textContent = 'Checking...';
    elUpdateStatus.style.color = '#0288d1';
    chrome.runtime.sendMessage({ type: 'CHECK_UPDATE' }, (res) => {
        btnUpdate.disabled = false;
        if (chrome.runtime.lastError) {
            elUpdateStatus.textContent = 'Update check failed';
            elUpdateStatus.style.color = '#f08080';
            return;
        }
        if (!res || !res.ok) {
            elUpdateStatus.textContent = `Error: ${(res && res.error) || 'unknown'}`;
            elUpdateStatus.style.color = '#f08080';
            return;
        }
        // При newer фон уже открыл вкладку с репозиторием, и попап закрывается —
        // текст успеет мелькнуть только если вкладка почему-то не открылась.
        elUpdateStatus.textContent = res.newer
            ? `v${res.latest} available — opening GitHub...`
            : `Already up to date (v${res.current})`;
        elUpdateStatus.style.color = '#0288d1';
    });
};

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
