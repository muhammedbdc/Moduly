"""Create a private deployment configuration, never overwrite existing secrets."""
import base64
import os
import secrets
from pathlib import Path

root = Path(__file__).resolve().parent.parent
target = root / '.env'
content = (root / '.env.example').read_text()
content = content.replace('MODULY_INVITE_CODE=\n', 'MODULY_INVITE_CODE=' + secrets.token_urlsafe(18) + '\n')
content = content.replace('MODULY_BACKUP_KEY=\n', 'MODULY_BACKUP_KEY=' + base64.urlsafe_b64encode(secrets.token_bytes(32)).decode() + '\n')
try:
    fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
except FileExistsError:
    raise SystemExit('.env existiert bereits. Unverändert gelassen.')
with os.fdopen(fd, 'w') as file:
    file.write(content)
print('.env erstellt. Domain und Betreiberangaben ergänzen; Schlüssel separat sicher aufbewahren.')
