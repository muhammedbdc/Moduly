"""Same-origin Moduly API. Every personal query is scoped to the authenticated user."""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from functools import wraps
from pathlib import Path
from urllib.parse import urlsplit

from flask import Flask, Response, g, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

from .model import Invalid, empty_state, text, validate

ROOT = Path(__file__).resolve().parent.parent
COOKIE = 'moduly_session'
SESSION_AGE = 7 * 86400
ITERATIONS = 600_000


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(value):
    if not isinstance(value, str) or not 12 <= len(value) <= 128:
        raise Invalid('Das Passwort muss 12 bis 128 Zeichen lang sein.')
    salt = secrets.token_bytes(16)
    hashed = hashlib.pbkdf2_hmac('sha256', value.encode(), salt, ITERATIONS)
    return f'pbkdf2_sha256${ITERATIONS}${salt.hex()}${hashed.hex()}'


def password_matches(value, stored):
    if not isinstance(value, str) or len(value) > 128:
        return False
    try:
        _, iterations, salt, expected = stored.split('$')
        actual = hashlib.pbkdf2_hmac('sha256', value.encode(), bytes.fromhex(salt), int(iterations))
        return hmac.compare_digest(actual.hex(), expected)
    except (ValueError, TypeError):
        return False


def username(value):
    value = text(value, 24, True)
    if not re.fullmatch(r'[A-Za-z0-9_]{3,24}', value):
        raise Invalid('Benutzername: 3 bis 24 Buchstaben, Ziffern oder Unterstriche.')
    return value


def connect(path):
    conn = sqlite3.connect(path, timeout=15, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    conn.execute('PRAGMA busy_timeout=15000')
    return conn


def create_app(test_config=None):
    app = Flask(__name__, static_folder=None)
    data_dir = Path(os.environ.get('MODULY_DATA_DIR', ROOT / 'data'))
    app.config.update(DATA_DIR=data_dir, DATABASE=data_dir / 'moduly.sqlite3',
        JOURNAL=Path(os.environ.get('MODULY_JOURNAL', data_dir / 'deletions.jsonl')),
        PRODUCTION=os.environ.get('MODULY_ENV') == 'production',
        ORIGIN=os.environ.get('MODULY_ORIGIN', 'http://localhost:8000').rstrip('/'),
        REGISTRATION=os.environ.get('MODULY_REGISTRATION', 'true').lower() == 'true',
        INVITE_CODE=os.environ.get('MODULY_INVITE_CODE', ''),
        MAX_CONTENT_LENGTH=2 * 1024 * 1024,
        OPERATOR={'name': os.environ.get('MODULY_OPERATOR_NAME', ''),
            'address': os.environ.get('MODULY_OPERATOR_ADDRESS', ''),
            'email': os.environ.get('MODULY_OPERATOR_EMAIL', ''),
            'host': os.environ.get('MODULY_HOST_DESCRIPTION', ''),
            'privacyExtra': os.environ.get('MODULY_PRIVACY_EXTRA', '')})
    if test_config:
        app.config.update(test_config)
    app.config['DATA_DIR'] = Path(app.config['DATA_DIR'])
    app.config['DATA_DIR'].mkdir(parents=True, exist_ok=True, mode=0o700)
    journal = Path(app.config['JOURNAL'])
    journal.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    journal.touch(mode=0o600, exist_ok=True)
    if app.config['PRODUCTION']:
        origin = urlsplit(app.config['ORIGIN'])
        if origin.scheme != 'https' or not origin.hostname or origin.path or origin.query or origin.fragment:
            raise RuntimeError('MODULY_ORIGIN muss die vollständige HTTPS-Origin ohne Pfad sein.')
        if not all(app.config['OPERATOR'][key] for key in ('name', 'address', 'email', 'host')):
            raise RuntimeError('Vor Produktionsstart Anbieter- und Hostingangaben in .env ergänzen.')
    if os.environ.get('MODULY_TRUST_PROXY') == 'true':
        # Only enable behind the included, single Caddy proxy; port 8000 is not public.
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
    key_path = app.config['DATA_DIR'] / 'throttle.key'
    try:
        fd = os.open(key_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'wb') as key_file:
            key_file.write(secrets.token_bytes(32))
    except FileExistsError:
        pass
    app.config['THROTTLE_KEY'] = key_path.read_bytes()
    app.config['DUMMY_HASH'] = password_hash(secrets.token_urlsafe(32))
    conn = connect(app.config['DATABASE'])
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA secure_delete=ON')
    # The deployment entrypoint migrates before workers are started.
    conn.execute('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
    applied = {row[0] for row in conn.execute('SELECT version FROM schema_version')}
    for migration in sorted((ROOT / 'server/migrations').glob('*.sql')):
        version = int(migration.name.split('_')[0])
        if version not in applied:
            conn.executescript('BEGIN IMMEDIATE;\n' + migration.read_text() + '\nCOMMIT;')
    conn.close()

    def db():
        if 'db' not in g:
            g.db = connect(app.config['DATABASE'])
        return g.db

    @app.teardown_appcontext
    def close_db(_exc):
        connection = g.pop('db', None)
        if connection:
            connection.close()

    def fail(message, status=400):
        return jsonify(error=message), status

    def body():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            raise Invalid('Eine JSON-Anfrage wird erwartet.')
        return data

    def throttle(label, limit, seconds, identity=None):
        ident = identity if identity is not None else request.remote_addr or 'unknown'
        key = hmac.new(app.config['THROTTLE_KEY'], (label + ':' + ident).encode(), hashlib.sha256).hexdigest()
        now = int(time.time())
        connection = db()
        connection.execute('DELETE FROM rate_limits WHERE expires_at < ?', (now,))
        row = connection.execute('''INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key)
            DO UPDATE SET count=count+1 RETURNING count''', (key, now + seconds)).fetchone()
        if row['count'] > limit:
            from werkzeug.exceptions import TooManyRequests
            raise TooManyRequests('Zu viele Versuche. Bitte später erneut versuchen.')

    @app.before_request
    def security():
        if request.path.startswith('/api/') and request.method not in ('GET', 'HEAD', 'OPTIONS'):
            if request.headers.get('Origin') != app.config['ORIGIN']:
                return fail('Anfrage von fremder Herkunft abgelehnt.', 403)
            if request.mimetype != 'application/json':
                return fail('JSON-Inhalt erforderlich.', 415)
        g.user = None
        g.session = None
        token = request.cookies.get(COOKIE, '')
        if token and len(token) <= 128:
            g.session = db().execute('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?',
                (digest(token), int(time.time()))).fetchone()
            if g.session:
                g.user = db().execute('SELECT * FROM users WHERE id=?', (g.session['user_id'],)).fetchone()

    @app.after_request
    def headers(response):
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=(), payment=()'
        if app.config['PRODUCTION']:
            response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        response.headers['Cache-Control'] = 'no-store' if request.path.startswith('/api/') else 'no-cache'
        if request.path.startswith('/api/'):
            response.headers['X-Robots-Tag'] = 'noindex, nofollow'
        return response

    @app.errorhandler(Invalid)
    def invalid(exc):
        return fail(str(exc))

    @app.errorhandler(HTTPException)
    def http_error(exc):
        messages = {404: 'Nicht gefunden.', 413: 'Datei zu groß. Maximal 2 MB.', 405: 'Methode nicht erlaubt.'}
        return fail(messages.get(exc.code, exc.description), exc.code)

    @app.errorhandler(sqlite3.OperationalError)
    def database_error(_exc):
        app.logger.error('Database operation failed. Check storage availability; no request data logged.')
        return fail('Speichern zurzeit nicht möglich. Bitte erneut versuchen.', 503)

    def auth(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            if not g.user:
                return fail('Bitte anmelden.', 401)
            if request.method not in ('GET', 'HEAD'):
                if not hmac.compare_digest(request.headers.get('X-CSRF-Token', ''), g.session['csrf']):
                    return fail('Sitzung prüfen: Bitte Seite neu laden.', 403)
                throttle('write', 180, 60, g.user['id'])
            return fn(*args, **kwargs)
        return wrapped

    def admin(fn):
        @auth
        @wraps(fn)
        def wrapped(*args, **kwargs):
            if g.user['role'] not in ('admin', 'owner'):
                return fail('Keine Berechtigung.', 403)
            return fn(*args, **kwargs)
        return wrapped

    def public_user(user):
        return {key: user[key] for key in ('id', 'username', 'role', 'created_at')}

    def login_response(user, **extra):
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        now = int(time.time())
        db().execute('DELETE FROM sessions WHERE expires_at<=?', (now,))
        db().execute('INSERT INTO sessions VALUES(?,?,?,?,?)', (digest(token), user['id'], csrf, now, now + SESSION_AGE))
        # At most ten sessions per account.
        db().execute('''DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN
            (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 10)''', (user['id'], user['id']))
        response = jsonify(user=public_user(user), csrf=csrf, **extra)
        response.set_cookie(COOKIE, token, max_age=SESSION_AGE, secure=app.config['PRODUCTION'], httponly=True, samesite='Lax')
        return response

    def password_confirm(data):
        throttle('password-check', 10, 900, g.user['id'])
        if not password_matches(data.get('password'), g.user['password_hash']):
            raise Invalid('Das aktuelle Passwort stimmt nicht.')

    def audit(action, object_id):
        db().execute('INSERT INTO audit(actor,action,object_id,created_at) VALUES(?,?,?,?)',
            (g.user['id'], action, object_id, int(time.time())))

    @app.get('/api/meta')
    def meta():
        return jsonify(version='1.0.0', mode='server', registration=app.config['REGISTRATION'],
            inviteRequired=bool(app.config['INVITE_CODE']), operator=app.config['OPERATOR'])

    @app.get('/api/me')
    @auth
    def me():
        return jsonify(user=public_user(g.user), csrf=g.session['csrf'])

    @app.post('/api/auth/register')
    def register():
        if not app.config['REGISTRATION']:
            return fail('Die Registrierung ist derzeit geschlossen.', 403)
        throttle('register', 5, 3600)
        data = body()
        if app.config['INVITE_CODE'] and not hmac.compare_digest(str(data.get('invite', '')), app.config['INVITE_CODE']):
            return fail('Der Einladungscode stimmt nicht.', 403)
        name, hashed = username(data.get('username')), password_hash(data.get('password'))
        recovery, user_id = secrets.token_urlsafe(24), secrets.token_hex(16)
        connection = db()
        try:
            connection.execute('BEGIN IMMEDIATE')
            connection.execute('INSERT INTO users VALUES(?,?,?,?,?,?)', (user_id, name, hashed, digest(recovery), 'user', int(time.time())))
            connection.execute('INSERT INTO workspaces VALUES(?,0,?)', (user_id, json.dumps(empty_state())))
            connection.commit()
        except sqlite3.IntegrityError:
            connection.rollback()
            return fail('Dieser Benutzername ist bereits vergeben.', 409)
        user = connection.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
        return login_response(user, recoveryCode=recovery)

    @app.post('/api/auth/login')
    def login():
        throttle('login-ip', 30, 900)
        data = body()
        name = text(data.get('username', ''), 24).lower()
        throttle('login-name', 15, 900, name)
        user = db().execute('SELECT * FROM users WHERE username=? COLLATE NOCASE', (name,)).fetchone()
        valid = password_matches(data.get('password'), user['password_hash'] if user else app.config['DUMMY_HASH'])
        if not user or not valid:
            return fail('Benutzername oder Passwort stimmt nicht.', 401)
        return login_response(user)

    @app.post('/api/auth/recover')
    def recover():
        throttle('recovery', 10, 3600)
        data = body()
        name = text(data.get('username', ''), 24)
        code = text(data.get('recoveryCode', ''), 100)
        new_hash = password_hash(data.get('newPassword'))
        connection = db()
        connection.execute('BEGIN IMMEDIATE')
        user = connection.execute('SELECT * FROM users WHERE username=? COLLATE NOCASE', (name,)).fetchone()
        if not user or not hmac.compare_digest(digest(code), user['recovery_hash']):
            connection.rollback()
            return fail('Benutzername oder Wiederherstellungscode stimmt nicht.', 401)
        recovery = secrets.token_urlsafe(24)
        connection.execute('UPDATE users SET password_hash=?,recovery_hash=? WHERE id=?', (new_hash, digest(recovery), user['id']))
        connection.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
        connection.commit()
        return login_response(user, recoveryCode=recovery)

    @app.post('/api/auth/logout')
    @auth
    def logout():
        db().execute('DELETE FROM sessions WHERE token_hash=?', (g.session['token_hash'],))
        response = jsonify(ok=True)
        response.delete_cookie(COOKIE)
        return response

    @app.post('/api/account/security')
    @auth
    def account_security():
        data = body()
        password_confirm(data)
        action = data.get('action')
        recovery = None
        if action == 'password':
            db().execute('UPDATE users SET password_hash=? WHERE id=?', (password_hash(data.get('newPassword')), g.user['id']))
        elif action == 'username':
            try:
                db().execute('UPDATE users SET username=? WHERE id=?', (username(data.get('username')), g.user['id']))
            except sqlite3.IntegrityError:
                return fail('Dieser Benutzername ist bereits vergeben.', 409)
        elif action == 'recovery':
            recovery = secrets.token_urlsafe(24)
            db().execute('UPDATE users SET recovery_hash=? WHERE id=?', (digest(recovery), g.user['id']))
        elif action != 'sessions':
            raise Invalid('Unbekannte Kontoaktion.')
        db().execute('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', (g.user['id'], g.session['token_hash']))
        user = db().execute('SELECT * FROM users WHERE id=?', (g.user['id'],)).fetchone()
        return jsonify(ok=True, user=public_user(user), recoveryCode=recovery)

    @app.delete('/api/account')
    @auth
    def delete_account():
        password_confirm(body())
        # Write the tombstone first. It is applied during every restore and contains no name.
        journal = Path(app.config['JOURNAL'])
        journal.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with open(journal, 'a', encoding='utf-8') as handle:
            os.chmod(journal, 0o600)
            handle.write(json.dumps({'id': g.user['id'], 'deletedAt': int(time.time())}) + '\n')
            handle.flush()
            os.fsync(handle.fileno())
        db().execute('DELETE FROM users WHERE id=?', (g.user['id'],))
        response = jsonify(ok=True)
        response.delete_cookie(COOKIE)
        return response

    def workspace():
        return db().execute('SELECT * FROM workspaces WHERE user_id=?', (g.user['id'],)).fetchone()

    def save_state(state, revision):
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
            raise Invalid('Gültige Versionsnummer erforderlich.')
        clean = validate(state)
        serialized = json.dumps(clean, ensure_ascii=False, separators=(',', ':'))
        if len(serialized.encode()) > 1_500_000:
            raise Invalid('Studienplan zu groß. Maximal 1,5 MB.')
        connection = db()
        connection.execute('BEGIN IMMEDIATE')
        old = workspace()
        if old['revision'] != revision:
            connection.rollback()
            return fail('Dein Plan wurde in einer anderen Sitzung geändert. Bitte neu laden; deine Eingabe wurde nicht überschrieben.', 409)
        now = int(time.time())
        connection.execute('INSERT INTO history(user_id,revision,data,created_at) VALUES(?,?,?,?)',
            (g.user['id'], revision, old['data'], now))
        connection.execute('UPDATE workspaces SET revision=revision+1,data=? WHERE user_id=?', (serialized, g.user['id']))
        connection.execute('''DELETE FROM history WHERE user_id=? AND (created_at<? OR revision NOT IN
            (SELECT revision FROM history WHERE user_id=? ORDER BY revision DESC LIMIT 20))''',
            (g.user['id'], now - 30 * 86400, g.user['id']))
        connection.commit()
        return jsonify(state=clean, revision=revision + 1)

    @app.get('/api/state')
    @auth
    def get_state():
        row = workspace()
        return jsonify(state=json.loads(row['data']), revision=row['revision'])

    @app.put('/api/state')
    @auth
    def put_state():
        data = body()
        return save_state(data.get('state'), data.get('revision'))

    @app.get('/api/history')
    @auth
    def history():
        db().execute('DELETE FROM history WHERE user_id=? AND created_at<?', (g.user['id'], int(time.time()) - 30 * 86400))
        rows = db().execute('SELECT revision,created_at FROM history WHERE user_id=? ORDER BY revision DESC', (g.user['id'],))
        return jsonify(history=[dict(row) for row in rows])

    @app.post('/api/history/<int:revision>/restore')
    @auth
    def restore_history(revision):
        row = db().execute('SELECT data FROM history WHERE user_id=? AND revision=? AND created_at>=?', (g.user['id'], revision, int(time.time()) - 30 * 86400)).fetchone()
        if not row:
            return fail('Version nicht vorhanden.', 404)
        return save_state(json.loads(row['data']), body().get('revision'))

    @app.get('/api/export')
    @auth
    def export_data():
        from .exports import export
        throttle('export', 20, 60, g.user['id'])
        state = json.loads(workspace()['data'])
        profile_id = request.args.get('profile', '')
        if profile_id and not any(p['id'] == profile_id for p in state['profiles']):
            return fail('Studienprofil nicht vorhanden.', 404)
        options = {key: request.args.get(key, 'true') == 'true' for key in ('grades', 'attempts', 'notes', 'events', 'open')}
        fmt = request.args.get('format', 'json')
        user = {'id': g.user['id'], 'username': g.user['username'], 'role': g.user['role'], 'created_at': g.user['created_at'],
            'reports': [dict(r) for r in db().execute('SELECT category,message,status,response,created_at FROM reports WHERE user_id=?', (g.user['id'],))]}
        content, mimetype, filename = export(state, fmt, profile_id, options, user)
        return Response(content, mimetype=mimetype, headers={'Content-Disposition': f'attachment; filename="{filename}"'})

    @app.route('/api/reports', methods=['GET', 'POST'])
    @auth
    def reports():
        if request.method == 'GET':
            rows = db().execute('SELECT id,category,message,status,response,created_at FROM reports WHERE user_id=? ORDER BY created_at DESC', (g.user['id'],))
            return jsonify(reports=[dict(row) for row in rows])
        throttle('reports', 5, 3600, g.user['id'])
        data = body()
        category = data.get('category')
        if category not in ('technical', 'study', 'privacy'):
            raise Invalid('Ungültige Meldungskategorie.')
        db().execute('INSERT INTO reports(id,user_id,category,message,created_at) VALUES(?,?,?,?,?)',
            (secrets.token_hex(16), g.user['id'], category, text(data.get('message'), 4000, True), int(time.time())))
        return jsonify(ok=True)

    @app.get('/api/templates')
    @auth
    def templates():
        return jsonify(templates=[{'id': r['id'], 'version': r['version'], 'updated_at': r['updated_at'], 'data': json.loads(r['data'])}
            for r in db().execute('SELECT * FROM templates ORDER BY updated_at DESC')])

    @app.get('/api/admin')
    @admin
    def admin_overview():
        connection = db()
        reports = [dict(r) for r in connection.execute('SELECT id,category,message,status,response,created_at FROM reports ORDER BY created_at DESC LIMIT 200')]
        backup_path = app.config['DATA_DIR'] / 'backup-status.json'
        backup = json.loads(backup_path.read_text()) if backup_path.exists() else None
        return jsonify(users=connection.execute('SELECT count(*) FROM users').fetchone()[0],
            reports=reports, database=connection.execute('PRAGMA quick_check').fetchone()[0], backup=backup,
            audit=[dict(r) for r in connection.execute('SELECT action,object_id,created_at FROM audit ORDER BY id DESC LIMIT 50')])

    @app.post('/api/admin/reports/<report_id>')
    @admin
    def review_report(report_id):
        data = body()
        if data.get('status') not in ('open', 'resolved', 'needs_information'):
            raise Invalid('Ungültiger Status.')
        response = text(data.get('response', ''), 4000)
        if data['status'] != 'open' and not response:
            raise Invalid('Bitte eine nachvollziehbare Antwort ergänzen.')
        result = db().execute('UPDATE reports SET status=?,response=? WHERE id=?', (data['status'], response, report_id))
        if result.rowcount == 0:
            return fail('Meldung nicht gefunden.', 404)
        audit('report.review', report_id)
        return jsonify(ok=True)

    @app.get('/healthz')
    def health():
        db().execute('SELECT 1')
        return jsonify(status='ok')

    @app.get('/')
    def index():
        return send_from_directory(ROOT, 'index.html')

    @app.get('/assets/<path:name>')
    def assets(name):
        # A strict allowlist prevents accidental publication of server or operator files.
        if name not in ('app.js', 'domain.js', 'api.js', 'styles.css', 'v1.css', 'favicon.svg'):
            return fail('Nicht gefunden.', 404)
        return send_from_directory(ROOT / 'assets', name)

    @app.get('/robots.txt')
    def robots():
        return Response('User-agent: *\nDisallow: /\n', mimetype='text/plain')

    return app
