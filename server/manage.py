"""Operator CLI: python -m server.manage --help. Never exposed through HTTP."""
import argparse
import io
import json
import os
import sqlite3
import tempfile
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from cryptography.fernet import Fernet

from .app import connect, create_app
from .model import validate, Invalid


def cipher():
    key = os.environ.get('MODULY_BACKUP_KEY', '')
    if not key:
        raise RuntimeError('MODULY_BACKUP_KEY fehlt. Mit generate-key erzeugen und getrennt sichern.')
    return Fernet(key.encode())


def deletion_ids(path):
    if not Path(path).exists():
        return set()
    return {json.loads(line)['id'] for line in Path(path).read_text().splitlines() if line.strip()}


def check_database(path):
    connection = connect(path)
    try:
        if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or connection.execute('PRAGMA foreign_key_check').fetchone():
            raise RuntimeError('Datenbankprüfung fehlgeschlagen.')
        if connection.execute('SELECT max(version) FROM schema_version').fetchone()[0] != 1:
            raise RuntimeError('Unbekannte Datenbankversion.')
        for row in connection.execute('SELECT data FROM workspaces'):
            validate(json.loads(row['data']))
    finally:
        connection.close()


def backup(config, destination=None):
    target = Path(destination or os.environ.get('MODULY_BACKUP_DIR', Path(config['DATA_DIR']) / 'backups'))
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory() as temporary:
        snapshot = Path(temporary) / 'moduly.sqlite3'
        source = connect(config['DATABASE'])
        now = int(time.time())
        source.execute('DELETE FROM history WHERE created_at<?', (now - 30 * 86400,))
        source.execute('DELETE FROM sessions WHERE expires_at<?', (now,))
        source.execute('DELETE FROM rate_limits WHERE expires_at<?', (now,))
        dest = sqlite3.connect(snapshot)
        try:
            source.backup(dest)
        finally:
            source.close()
            dest.close()
        check_database(snapshot)
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('moduly.sqlite3', snapshot.read_bytes())
            journal = Path(config['JOURNAL'])
            archive.writestr('deletions.jsonl', journal.read_bytes() if journal.exists() else b'')
        encrypted = cipher().encrypt(payload.getvalue())
        name = 'moduly-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.mbackup'
        temporary_target = target / (name + '.tmp')
        temporary_target.write_bytes(encrypted)
        temporary_target.chmod(0o600)
        temporary_target.replace(target / name)
    # Test the actual stored ciphertext and restore path, not just the snapshot.
    verify(target / name)
    now = int(time.time())
    status = {'ok': True, 'createdAt': now, 'verifiedAt': now, 'file': name}
    (Path(config['DATA_DIR']) / 'backup-status.json').write_text(json.dumps(status))
    for file in target.glob('moduly-*.mbackup'):
        if file.stat().st_mtime < now - 30 * 86400:
            file.unlink()
    return target / name


def unpack(backup_path, destination):
    raw = cipher().decrypt(Path(backup_path).read_bytes())
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        # No extractall or untrusted archive paths.
        destination.write_bytes(archive.read('moduly.sqlite3'))
        destination.chmod(0o600)
        journal = archive.read('deletions.jsonl').decode()
    return {json.loads(line)['id'] for line in journal.splitlines() if line.strip()}


def verify(backup_path):
    with tempfile.TemporaryDirectory() as temporary:
        snapshot = Path(temporary) / 'verify.sqlite3'
        unpack(backup_path, snapshot)
        check_database(snapshot)


def restore(backup_path, destination, journal):
    destination = Path(destination)
    if destination.exists():
        raise RuntimeError('Wiederherstellung nur in eine neue Datei. Laufende Datenbank wird nie überschrieben.')
    if not Path(journal).exists():
        raise RuntimeError('Aktuelles Löschjournal erforderlich. Kein altes Backup ohne aktuelles Journal aktivieren.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        snapshot = Path(temporary) / 'restore.sqlite3'
        deleted = unpack(backup_path, snapshot) | deletion_ids(journal)
        check_database(snapshot)
        connection = connect(snapshot)
        connection.execute('BEGIN IMMEDIATE')
        for user_id in deleted:
            connection.execute('DELETE FROM users WHERE id=?', (user_id,))
        connection.execute('DELETE FROM sessions')
        connection.execute('DELETE FROM rate_limits')
        connection.commit()
        connection.close()
        check_database(snapshot)
        snapshot.replace(destination)


def main():
    parser = argparse.ArgumentParser(description='Moduly Administration (nur Serverkonsole)')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('generate-key')
    sub.add_parser('init')
    role = sub.add_parser('role')
    role.add_argument('username')
    role.add_argument('role', choices=['user', 'admin', 'owner'])
    sub.add_parser('backup')
    sub.add_parser('backup-loop')
    ver = sub.add_parser('verify-backup')
    ver.add_argument('file')
    res = sub.add_parser('restore')
    res.add_argument('file')
    res.add_argument('destination')
    res.add_argument('--journal', required=True)
    template = sub.add_parser('template-import')
    template.add_argument('id')
    template.add_argument('file')
    args = parser.parse_args()
    if args.command == 'generate-key':
        print(Fernet.generate_key().decode())
        return
    if args.command == 'verify-backup':
        verify(args.file)
        print('Backup erfolgreich entschlüsselt und geprüft.')
        return
    if args.command == 'restore':
        restore(args.file, args.destination, args.journal)
        print('Wiederhergestellte Datei geprüft. Sitzungen widerrufen; Löschjournal angewandt.')
        return
    app = create_app()
    if args.command == 'init':
        # Ensure an empty journal is present even before the first deletion.
        Path(app.config['JOURNAL']).touch(mode=0o600, exist_ok=True)
        print('Datenbank bereit.')
    elif args.command in ('backup', 'backup-loop'):
        while True:
            try:
                print('Backup geprüft:', backup(app.config), flush=True)
            except Exception:
                (Path(app.config['DATA_DIR']) / 'backup-status.json').write_text(json.dumps({'ok': False, 'failedAt': int(time.time())}))
                if args.command == 'backup':
                    raise
                print('Backup fehlgeschlagen. Betreiber muss Speicher und Schlüssel prüfen.', flush=True)
            if args.command == 'backup':
                break
            time.sleep(86400)
    elif args.command == 'role':
        connection = connect(app.config['DATABASE'])
        row = connection.execute('SELECT id FROM users WHERE username=? COLLATE NOCASE', (args.username,)).fetchone()
        if not row:
            raise RuntimeError('Konto nicht gefunden.')
        connection.execute('BEGIN IMMEDIATE')
        connection.execute('UPDATE users SET role=? WHERE id=?', (args.role, row['id']))
        connection.execute('DELETE FROM sessions WHERE user_id=?', (row['id'],))
        connection.execute('INSERT INTO audit(actor,action,object_id,created_at) VALUES(?,?,?,?)', ('operator-cli', 'role.assign:' + args.role, row['id'], int(time.time())))
        connection.commit()
        connection.close()
        print('Rolle gesetzt, bestehende Sitzungen widerrufen.')
    elif args.command == 'template-import':
        from .model import uid
        template_id = uid(args.id)
        data = validate(json.loads(Path(args.file).read_text()))
        if len(data['profiles']) != 1 or not data['profiles'][0]['source'] or any(not m['source'] for m in data['modules']):
            raise Invalid('Genau ein Studienprofil und offizielle Quellenlinks an Profil und Modulen erforderlich.')
        if data['events'] or data['tasks'] or data['settings']['note'] or any(m['notes'] or m['grade'] is not None or m['attempts'] or m['status'] != 'open' for m in data['modules']):
            raise Invalid('Vorlage darf keine persönlichen Leistungen, Notizen oder Termine enthalten.')
        connection = connect(app.config['DATABASE'])
        connection.execute('BEGIN IMMEDIATE')
        old = connection.execute('SELECT version FROM templates WHERE id=?', (template_id,)).fetchone()
        version = old['version'] + 1 if old else 1
        serialized = json.dumps(data)
        connection.execute('INSERT INTO template_versions VALUES(?,?,?)', (template_id, version, serialized))
        connection.execute('INSERT INTO templates VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data,updated_at=excluded.updated_at', (template_id, version, serialized, int(time.time())))
        connection.execute('INSERT INTO audit(actor,action,object_id,created_at) VALUES(?,?,?,?)', ('operator-cli', 'template.publish', template_id + ':' + str(version), int(time.time())))
        connection.commit()
        connection.close()
        print('Vorlage versioniert veröffentlicht. Persönliche Kopien bleiben unverändert.')


if __name__ == '__main__':
    main()
