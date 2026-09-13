"""Publish only explicitly allowed static assets to GitHub Pages."""
import shutil
from pathlib import Path

root = Path(__file__).resolve().parent.parent
target = root / 'site'
target.mkdir(exist_ok=True)
# This directory is generated output only, never a deployment data directory.
for path in target.iterdir():
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()
files = ['index.html', 'assets/app.js', 'assets/api.js', 'assets/domain.js', 'assets/styles.css', 'assets/v1.css', 'assets/favicon.svg', 'catalog/v1.json']
for file in files:
    destination = target / file
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(root / file, destination)
(target / '.nojekyll').touch()
print('Lokale GitHub-Pages-App gebaut. Keine Serverdateien, Konfigurationen oder Nutzerdaten enthalten.')
