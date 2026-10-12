# tools/

Вспомогательные скрипты (для приложения не обязательны).

- `fetch_wojaks.py` — скачивает полную библиотеку вояков (~1400) в `userdata/library/wojaks/`.
  Приложение подхватит их автоматически как дополнительные наборы в выборе картинок.
  `pip install "yt-dlp[curl-cffi]" pillow playwright` затем `python tools/fetch_wojaks.py`.
- `scrape_tiktok.py` — скачивает посты TikTok-аккаунтов (видео, слайды, подписи) для изучения
  форматов и будущего сбора трендов. `python tools/scrape_tiktok.py OUT_DIR user1 user2 ...`.
