# Доказательства запуска и проверок

> Дополняет `sessions/session-1.md` — здесь только сырой вывод команд, без
> пересказа. Дата снятия: 2026-08-16.

## Автотест: `node tests/availability.test.js`

```
--- Шаг 2: локальное время участника (getZonedDateParts) ---
UTC 2026-08-16T19:00:00Z -> Катманду: Mon 00:45 (перекрёстно: Mon 00:45)
UTC 2026-08-16T06:00:00Z -> Катманду: Sun 11:45 (перекрёстно: Sun 11:45)
UTC 2026-08-16T21:30:00Z -> Москва: Mon 00:30 (перекрёстно: Mon 00:30)

--- Шаг 3: сетка и расчёт доступности ---
Границы часа (09:00-18:00 UTC): 09:00->100%, 08:30->0%, 17:30->100%, 18:00->0%
Округление: 1/3 -> 33%, 2/3 -> 67%
Катманду, понедельник 00:45 (после перехода через полночь): reason=before-start, diffMinutes=495
Сетка Bob/Diana/Liam: 336 слотов, встреченные проценты: 0, 33, 67, 100

Все проверки пройдены (шаги 2 и 3).
```

Выход процесса — `0` (успех).

## Проверка отсутствия зависимостей и сети

```bash
$ grep -rn "^import \|require(" --include="*.js" --include="*.html" . | grep -v tests/availability.test.js
# (пусто)
$ grep -rn '<script[^>]*src="http' --include="*.html" .
# (пусто)
$ grep -rniE "cdn\.|unpkg\.|jsdelivr\.|cdnjs\." --include="*.html" --include="*.js" --include="*.css" .
# (пусто)
$ find . -maxdepth 2 -iname "package.json" -o -iname "webpack.config*" -o -iname "vite.config*"
# (пусто)
$ grep -rn "fetch(\|XMLHttpRequest\|WebSocket\|new EventSource" index.html app.js availability.js styles.css
# (пусто)
$ grep -rn "localStorage\|sessionStorage\|indexedDB\|document.cookie" index.html app.js availability.js styles.css
# (пусто)
```

## Проверка вкладки Network (браузер, реальная страница)

Открыта `http://localhost:8765`, выполнено: добавление 2 участников (Москва,
Катманду), клик по ячейке сетки, удаление одного участника. Список запросов
(`read_network_requests`) после этих действий:

```
GET http://localhost:8765/            → 200 OK
GET http://localhost:8765/styles.css  → 200 OK
GET http://localhost:8765/availability.js → 200 OK
GET http://localhost:8765/app.js      → 200 OK
GET data:image/svg+xml;base64,...     → 200 OK  (иконка нативного <input type="time">, к сети не обращается)
```

Ни одного нового запроса в ответ на действия пользователя — только начальная
загрузка четырёх локальных файлов.

## Проверка публичности репозитория (анонимный доступ, без токена/логина)

```bash
$ curl -s -o /dev/null -w "%{http_code}\n" https://github.com/lilkenzu/planner_hm
200
$ curl -s -o /dev/null -w "%{http_code}\n" https://raw.githubusercontent.com/lilkenzu/planner_hm/main/README.md
200
```

Оба запроса выполнены без какой-либо аутентификации — репозиторий публичный
и открывается со стороны.

## Проверка на секреты

```bash
$ grep -rniE "api[_-]?key|secret|password|token|AKIA[0-9A-Z]{16}|ghp_[0-9A-Za-z]{36}|sk-[0-9A-Za-z]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----" \
  --include="*.md" --include="*.js" --include="*.html" --include="*.css" --include="*.json" .
```

Совпадения нашлись только в `materials/reference.md` (учебный конспект курса,
абстрактные упоминания вроде `$ANTHROPIC_API_KEY`, `YOUR_API_KEY` как плейсхолдер
в документации, без реальных значений). В коде проекта, `SPEC.md`, `AGENTS.md`
и журнале `sessions/` совпадений нет.

## Проверка «на чистой машине»

Свежий анонимный `git clone` в отдельную временную папку (без токена, без
локальных настроек `.claude/`) + запуск строго по инструкции из `README.md`:

```bash
$ git clone https://github.com/lilkenzu/planner_hm.git /tmp/planner-clean-check
$ cd /tmp/planner-clean-check
$ node tests/availability.test.js
# ... те же проверки, тот же результат ...
Все проверки пройдены (шаги 2 и 3).

$ python3 -m http.server 8799 &
$ curl -o /dev/null -w "%{http_code}" http://localhost:8799/            # 200
$ curl -o /dev/null -w "%{http_code}" http://localhost:8799/app.js      # 200
$ curl -o /dev/null -w "%{http_code}" http://localhost:8799/availability.js  # 200
```

Временная папка удалена после проверки.

## Скриншоты (сделаны пользователем самостоятельно)

В [`../screenshots/`](../screenshots/) — 4 снимка ручной проверки: форма
и список участников (реальные имена участников теста), сетка доступности на
неделю, и две панели деталей слота по клику (0 из 3 — все недоступны с
причинами; 2 из 3 — с одним «начнётся через 30 мин»). Дополняют вывод команд
выше визуальным подтверждением того же поведения.

## Что раньше было ограничением, теперь снято

Скриншоты интерфейса, которые агент показывал по ходу разработки (шаги 1–7),
демонстрировались прямо в диалоге, но инструмент браузера, которым пользуется
агент, не может выгрузить снимок на диск в файлы проекта напрямую — поэтому
эти конкретные скриншоты в репозиторий не попали (их значения зафиксированы
текстом в `sessions/session-1.md` на каждом шаге). Пробел закрыт скриншотами
выше, сделанными пользователем вручную поверх уже готового приложения.
