# Генератор пародийных каруселей

Карусели в стиле looksmaxxing-«гайдов» (сетка, красный заголовок КАПСОМ, вояки),
но с абсурдными и безопасными «протоколами».

## Установка

```bash
pip install "yt-dlp[default,curl-cffi]" anthropic pillow playwright pydantic
python parody/fetch_wojaks.py        # ~1400 вояков с wojakland.com + Pinterest -> parody/assets/wojaks/
```

## Использование

```bash
# отрендерить готовые сценарии
python parody/render.py parody/scripts/*.json        # -> parody/out/<slug>/slide_XX.png + caption.txt

# сгенерировать новые через Claude (нужен ANTHROPIC_API_KEY)
python parody/generate.py "mogging your reflection in a car window" "aura farming at the dentist"
python parody/generate.py --ideas 5 --trends trends.md --handle @yourhandle
```

## Формат сценария (`scripts/*.json`)

- `kicker` / `title` / `subtitle`: мелкая подпись, красный заголовок, подзаголовок
- `bullets`, `steps` (нумерация) или `body`
- цвет внутри текста: `{r:красный}`, `{g:зелёный}`, `{b:синий}`
- `wojaks`: 1–2 настроения из `moods.json` (chad, crying, cope, doomer, npc, brainlet, bigbrain,
  smug, gym, pointing, …), либо `категория[:слово]`, либо путь к файлу

`moods.json` — список отобранных вручную классических вояков. При случайном выборе из категорий
блок-лист в `render.py` отсекает этнические, религиозные, политические, военные и NSFW картинки.

`trends.md` — любой текст с текущими звуками, сленгом и мемами; генератор вплетает их в сценарии.
