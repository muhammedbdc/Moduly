FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MODULY_DATA_DIR=/data MODULY_JOURNAL=/journal/deletions.jsonl MODULY_BACKUP_DIR=/backups
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 moduly && useradd --uid 10001 --gid moduly --no-create-home moduly \
    && install -d -o moduly -g moduly -m 700 /data /journal /backups
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
COPY --chown=moduly:moduly server ./server
COPY --chown=moduly:moduly assets ./assets
COPY --chown=moduly:moduly catalog ./catalog
COPY --chown=moduly:moduly index.html ./
COPY --chown=moduly:moduly deploy/entrypoint.sh ./deploy/entrypoint.sh
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3)"
ENTRYPOINT ["sh", "/app/deploy/entrypoint.sh"]
CMD ["gunicorn", "--bind=0.0.0.0:8000", "--workers=2", "--threads=4", "--preload", "--timeout=30", "--worker-tmp-dir=/tmp", "--error-logfile=-", "server.app:create_app()"]
