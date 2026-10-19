// тема
if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-theme');
}
document.getElementById('themeToggle').addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark-theme');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
});

// запросы к серверу
async function api(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
    return data;
}

// переход в заметки после входа
fetch('/api/me').then(res => {
    if (res.ok) window.location.href = 'main.html';
});

// вкладки
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
});

tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
});

// проверка сложности пароля (сервер проверяет так же)
function passwordProblem(password) {
    const missing = [];
    if (!/\p{Lu}/u.test(password)) missing.push('заглавную букву');
    if (!/\p{Ll}/u.test(password)) missing.push('строчную букву');
    if (!/\d/.test(password)) missing.push('цифру');
    if (!/[^\p{L}\p{N}\s]/u.test(password)) missing.push('спецсимвол (например, ! @ # $ % _ -)');
    return missing.length ? 'Пароль должен содержать: ' + missing.join(', ') + '.' : '';
}

// регистрация
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('registerName').value.trim();
    const email = document.getElementById('registerEmail').value.trim().toLowerCase();
    const password = document.getElementById('registerPassword').value;

    if (!name) {
        alert('Введите имя.');
        return;
    }

    if (password.length < 8) {
        alert('Ваш пароль должен содержать минимум 8 символов!');
        return;
    }

    const problem = passwordProblem(password);
    if (problem) {
        alert(problem);
        return;
    }

    try {
        await api('/api/register', { name, email, password });
    } catch (err) {
        alert(err.message);
        return;
    }

    // Сразу переходим на главную, так как сервер уже авторизовал нас
    window.location.href = 'main.html';
});

// авторизация
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value;

    try {
        await api('/api/login', { email, password });
        window.location.href = 'main.html';
    } catch (err) {
        alert(err.message);
    }
});
