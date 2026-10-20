import os
import re
import sqlite3
import time
from datetime import timedelta
from functools import wraps

import nh3
from flask import Flask, g, jsonify, redirect, request, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
DB_PATH = os.path.join(DATA_DIR, 'notes.db')
os.makedirs(DATA_DIR, exist_ok=True)

app = Flask(__name__, static_folder='static', static_url_path='')


def get_secret_key():
    if os.environ.get('SECRET_KEY'):
        return os.environ['SECRET_KEY']
    path = os.path.join(DATA_DIR, 'secret.key')
    if not os.path.exists(path):
        with open(path, 'w') as f:
            f.write(os.urandom(32).hex())
    with open(path) as f:
        return f.read()


app.config.update(
    SECRET_KEY=get_secret_key(),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=os.environ.get('HTTPS') == '1',
    PERMANENT_SESSION_LIFETIME=timedelta(days=7),
    MAX_CONTENT_LENGTH=300 * 1024,
)

MAX_TITLE = 200
MAX_CONTENT = 100000
ALLOWED_TAGS = {'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'br', 'div', 'p', 'span'}


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute('PRAGMA foreign_keys = ON')
    return g.db


@app.teardown_appcontext
def close_db(error):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL,
            email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            created_at    INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notes (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title      TEXT NOT NULL,
            content    TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            deleted_at INTEGER          
        );
    ''')
    db.commit()
    db.close()


init_db()


def now_ms():
    return int(time.time() * 1000)


def error(message, status=400):
    return jsonify({'error': message}), status


def get_json():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def note_to_dict(row):
    return {
        'id': row['id'],
        'title': row['title'],
        'content': row['content'],
        'createdAt': row['created_at'],
        'updatedAt': row['updated_at'],
        'deletedAt': row['deleted_at'],
    }


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if 'user_id' not in session:
            return error('Требуется авторизация', 401)
        return view(*args, **kwargs)
    return wrapper


@app.before_request
def only_json():
    if request.path.startswith('/api/') and request.method in ('POST', 'PUT', 'DELETE'):
        if request.mimetype != 'application/json':
            return error('Нужен JSON-запрос', 415)


def check_password_rules(password):
    if len(password) < 8:
        return 'Ваш пароль должен содержать минимум 8 символов!'
    if len(password) > 128:
        return 'Пароль не должен быть длиннее 128 символов.'

    missing = []
    if not any(c.isupper() for c in password):
        missing.append('заглавную букву')
    if not any(c.islower() for c in password):
        missing.append('строчную букву')
    if not any(c.isdigit() for c in password):
        missing.append('цифру')
    if not any(not c.isalnum() and not c.isspace() for c in password):
        missing.append('спецсимвол (например, ! @ # $ % _ -)')
    if missing:
        return 'Пароль должен содержать: ' + ', '.join(missing) + '.'
    return None


def clean_html(html):
    return nh3.clean(str(html or ''), tags=ALLOWED_TAGS, attributes={}).strip()


def is_empty_html(html):
    text = nh3.clean(html, tags=set()).strip()
    return text == '' and '<ul' not in html and '<ol' not in html


def validate_note(data):
    title = str(data.get('title') or '').strip()
    content = clean_html(data.get('content'))
    if not title:
        return None, None, 'Введите заголовок.'
    if len(title) > MAX_TITLE:
        return None, None, 'Заголовок не длиннее %d символов.' % MAX_TITLE
    if is_empty_html(content):
        return None, None, 'Введите текст заметки.'
    if len(content) > MAX_CONTENT:
        return None, None, 'Заметка слишком длинная.'
    return title, content, None


@app.get('/')
def index():
    if 'user_id' in session:
        return redirect('/main.html')
    return redirect('/index.html')


@app.post('/api/register')
def register():
    data = get_json()
    name = str(data.get('name') or '').strip()
    email = str(data.get('email') or '').strip().lower()
    password = str(data.get('password') or '')

    if not name or len(name) > 100:
        return error('Введите имя.')
    if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', email) or len(email) > 254:
        return error('Введите корректный email.')

    problem = check_password_rules(password)
    if problem:
        return error(problem)

    db = get_db()
    try:
        cur = db.execute(
            'INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
            (name, email, generate_password_hash(password), now_ms()),
        )
        db.commit()
    except sqlite3.IntegrityError:
        return error('Пользователь с таким email уже существует.', 409)

    session.clear()
    session['user_id'] = cur.lastrowid
    session.permanent = True

    return jsonify({'ok': True}), 201


@app.post('/api/login')
def login():
    data = get_json()
    email = str(data.get('email') or '').strip().lower()
    password = str(data.get('password') or '')

    user = get_db().execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    if user is None or not check_password_hash(user['password_hash'], password):
        return error('Введён неверный email или пароль.', 401)

    session.clear()
    session['user_id'] = user['id']
    session.permanent = True
    return jsonify({'ok': True})


@app.post('/api/logout')
def logout():
    session.clear()
    return jsonify({'ok': True})


@app.get('/api/me')
@login_required
def me():
    user = get_db().execute('SELECT name, email FROM users WHERE id = ?', (session['user_id'],)).fetchone()
    if user is None:
        session.clear()
        return error('Требуется авторизация', 401)
    return jsonify({'user': {'name': user['name'], 'email': user['email']}})


@app.get('/api/notes')
@login_required
def get_notes():
    rows = get_db().execute(
        'SELECT * FROM notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC',
        (session['user_id'],),
    ).fetchall()
    return jsonify({'notes': [note_to_dict(r) for r in rows]})


@app.post('/api/notes')
@login_required
def create_note():
    title, content, problem = validate_note(get_json())
    if problem:
        return error(problem)

    db = get_db()
    now = now_ms()
    cur = db.execute(
        'INSERT INTO notes (user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        (session['user_id'], title, content, now, now),
    )
    db.commit()
    row = db.execute('SELECT * FROM notes WHERE id = ?', (cur.lastrowid,)).fetchone()
    return jsonify({'note': note_to_dict(row)}), 201


@app.put('/api/notes/<int:note_id>')
@login_required
def update_note(note_id):
    title, content, problem = validate_note(get_json())
    if problem:
        return error(problem)

    db = get_db()
    cur = db.execute(
        'UPDATE notes SET title = ?, content = ?, updated_at = ? '
        'WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
        (title, content, now_ms(), note_id, session['user_id']),
    )
    db.commit()
    if cur.rowcount == 0:
        return error('Заметка не найдена.', 404)

    row = db.execute('SELECT * FROM notes WHERE id = ?', (note_id,)).fetchone()
    return jsonify({'note': note_to_dict(row)})


@app.delete('/api/notes/<int:note_id>')
@login_required
def delete_note(note_id):
    db = get_db()
    cur = db.execute(
        'UPDATE notes SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
        (now_ms(), note_id, session['user_id']),
    )
    db.commit()
    if cur.rowcount == 0:
        return error('Заметка не найдена.', 404)
    return jsonify({'ok': True})


@app.get('/api/trash')
@login_required
def get_trash():
    rows = get_db().execute(
        'SELECT * FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC',
        (session['user_id'],),
    ).fetchall()
    return jsonify({'notes': [note_to_dict(r) for r in rows]})


@app.post('/api/trash/<int:note_id>/restore')
@login_required
def restore_note(note_id):
    db = get_db()
    cur = db.execute(
        'UPDATE notes SET deleted_at = NULL WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL',
        (note_id, session['user_id']),
    )
    db.commit()
    if cur.rowcount == 0:
        return error('Заметка не найдена.', 404)
    return jsonify({'ok': True})


@app.delete('/api/trash/<int:note_id>')
@login_required
def delete_forever(note_id):
    db = get_db()
    cur = db.execute(
        'DELETE FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL',
        (note_id, session['user_id']),
    )
    db.commit()
    if cur.rowcount == 0:
        return error('Заметка не найдена.', 404)
    return jsonify({'ok': True})


@app.delete('/api/trash')
@login_required
def clear_trash():
    db = get_db()
    db.execute('DELETE FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL', (session['user_id'],))
    db.commit()
    return jsonify({'ok': True})


@app.errorhandler(413)
def too_large(e):
    return error('Слишком большой запрос', 413)


if __name__ == '__main__':
    app.run(debug=True)
