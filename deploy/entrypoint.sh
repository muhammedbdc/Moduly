#!/bin/sh
set -eu
umask 077
python -m server.manage init
exec "$@"
