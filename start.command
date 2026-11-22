#!/bin/bash
# Запуск приложения локально: двойной клик по файлу. Закрой окно терминала, чтобы остановить.
cd "$(dirname "$0")" || exit 1
PORT=8000
echo "Приложение: http://localhost:$PORT   (Ctrl+C — остановить)"
( sleep 1; open "http://localhost:$PORT" ) &
python3 -m http.server $PORT
