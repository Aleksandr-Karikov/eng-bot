# WordBoss на VPS: конфигурация и повторный запуск

Снимок работающей конфигурации на 2026-11-08. Источник истины для unit-файлов, Nginx и деплоя —
`scripts/server/`; текущие значения и секреты — на сервере. Документ относится к боту WordBoss,
сервер также обслуживает другие проекты: не заменяйте общие конфиги Nginx, Certbot и systemd целиком.

## Что работает

| Часть | Текущая конфигурация |
| --- | --- |
| VPS | Ubuntu 22.04, 4 ГБ RAM, диск около 120 ГБ; SSH: `ssh -i ~/.ssh/aleksandr root@144.31.167.217` |
| Бот | Node.js 24, long polling, `eng-bot.service` от пользователя `engbot`, автоперезапуск |
| Код | Git-клон `main` в `/opt/eng-bot-git`; рабочая копия должна быть чистой для `git merge --ff-only` |
| Состояние | `/opt/eng-bot/.env` и `/opt/eng-bot/data/`, вне Git; в клоне — символьные ссылки |
| База | `/opt/eng-bot/data/eng-bot.sqlite`, SQLite WAL; миграции применяет бот при старте |
| Mini App | `https://144.31.167.217/app/` → Nginx → `127.0.0.1:8788` |
| Расширение | `https://144.31.167.217/ext/*` → Mini App → локальный сервер приёма слов `127.0.0.1:8787` |
| LLM и картинки | OpenRouter; `IMAGES_ENABLED=1` и `IMAGE_API_KEY`, локальный FLUX на Linux не используется |
| Речь | Kokoro для английского, `espeak-ng` как системный голос и для остальных языков; STT отключён |
| CI/CD | GitHub Actions `checks` → `deploy` по ограниченному SSH-ключу → `eng-bot-deploy.service` |
| Бэкап | `eng-bot-backup.timer` → `scripts/server/backup.py`, последние 14 копий на том же диске |
| HTTPS | Короткоживущий сертификат Let's Encrypt для IP, отдельный Certbot и `eng-bot-cert-renew.timer` |

Домен для текущего адреса не нужен. `APP_URL` в `.env` равен
`https://144.31.167.217/app/`. При старте бот сам ставит кнопку «📚 Учить» через Telegram API;
вручную менять её у BotFather не требуется. Для `/extension` бот собирает личный ZIP с ключом и
адресом `/ext`; архив нельзя пересылать другому пользователю.

## Что хранить и переносить

```text
/opt/eng-bot-git/                 Git-клон; код, unit-файлы, сборка Mini App
  .env -> /opt/eng-bot/.env
  data -> /opt/eng-bot/data
  tools/tts/.venv -> /opt/eng-bot/tools/tts/.venv
/opt/eng-bot/                     принадлежит engbot:engbot
  .env                            BOT_TOKEN, ключи API, параметры; режим 600
  data/                           SQLite, WAL, картинки, аудио, образцы голоса, llm-provider, бэкапы
  tools/tts/.venv/                Python-окружение Kokoro; можно пересоздать
```

`data/` и `.env` не попадают в Git. **Сохраните их отдельно до переустановки.** Особенно важны
`eng-bot.sqlite`, пользовательские медиа и `data/llm-provider`: последний имеет приоритет над
`LLM_PROVIDER` в `.env`. `tools/youtube/.venv` и `tools/wordfreq/.venv` лежат в клоне; их
пересоздают по `tools/youtube/README.md` и `tools/wordfreq/README.md`.

Нельзя копировать только `eng-bot.sqlite`, пока бот пишет в WAL: последние записи могут лежать в
`-wal`. Для переноса с работающего сервера запустите `systemctl start eng-bot-backup.service` и
возьмите созданный согласованный файл из `data/backups/`; `backup.py` использует SQLite backup API
и проверяет `PRAGMA integrity_check`. При восстановлении остановите бот и положите эту копию как
`data/eng-bot.sqlite`. Старые `eng-bot.sqlite-wal` и `eng-bot.sqlite-shm` от другого снимка рядом
с восстановленной базой оставлять нельзя. Медиа и `llm-provider` переносите из `data/` отдельно.
Если источник уже остановлен, допустимо перенести весь `data/` вместе с WAL.

Бэкапы сейчас на диске того же VPS; потеря диска уничтожит и базу, и копии. Внешнее хранилище для
бэкапов пока не настроено.

## Повторная установка

На новом сервере используйте актуальный IP во всех URL и сертификате. На этом VPS не трогайте
сайты других проектов. Команды ниже выполняются от root, если не сказано иное.

1. Установить Git, Nginx, Node.js 24 с `npm`, Python с `venv`, `ffmpeg`, `espeak-ng`, `zip`.
   Для текущего сервиса Node находится в `/usr/local/bin/node`; при другом пути исправьте
   `scripts/server/eng-bot.service`. `espeak-ng` нужен для Linux-озвучки и CI-тестов.
2. Создать системного пользователя `engbot`, каталог `/opt/eng-bot` с владельцем `engbot:engbot`,
   клонировать `https://github.com/Aleksandr-Karikov/eng-bot.git` в `/opt/eng-bot-git` от `engbot`.
   Восстановить `/opt/eng-bot/.env` и `/opt/eng-bot/data/`, затем создать ссылки `data` и `.env`
   в клоне. У `.env` права `600`, весь каталог состояния доступен `engbot`.

   ```bash
   useradd --system --user-group --home-dir /opt/eng-bot --shell /usr/sbin/nologin engbot
   install -d -o engbot -g engbot -m 750 /opt/eng-bot
   install -d -o engbot -g engbot -m 755 /opt/eng-bot-git
   runuser -u engbot -- git clone https://github.com/Aleksandr-Karikov/eng-bot.git /opt/eng-bot-git
   install -d -o engbot -g engbot -m 750 /opt/eng-bot/data
   # Восстановить сюда .env и данные из защищённой копии.
   chown engbot:engbot /opt/eng-bot/.env
   chown -R engbot:engbot /opt/eng-bot/data
   chmod 600 /opt/eng-bot/.env
   ln -s /opt/eng-bot/.env /opt/eng-bot-git/.env
   ln -s /opt/eng-bot/data /opt/eng-bot-git/data
   ```

   Если пользователя, каталог или ссылки уже создали, проверьте их вместо повторного создания.
3. Проверить параметры `.env` по `.env.example`. Здесь нужны `BOT_TOKEN`, `DB_PATH=data/eng-bot.sqlite`,
   `APP_URL=https://144.31.167.217/app/`, `OPEN_ROUTER_API_KEY`, `OPENROUTER_MODEL`,
   `IMAGES_ENABLED=1`, `IMAGE_API_KEY`. Текущий выбор моделей OpenRouter:
   `google/gemini-2.5-flash-lite` для основной и мнемоник, `anthropic/claude-haiku-5.5` для проверок.
   `STT_PYTHON=/nonexistent/eng-bot-stt/python` явно отключает распознавание. `APP_PORT` и
   `CAPTURE_PORT` не заданы: код использует 8788 и 8787. Секреты берите из защищённой копии,
   не из этого документа.
4. Установить зависимости и собрать Mini App от `engbot`:

   ```bash
   cd /opt/eng-bot-git
   runuser -u engbot -- npm ci
   cd app
   runuser -u engbot -- npm ci
   runuser -u engbot -- npm run build
   ```

5. Восстановить или пересоздать Python-окружение Kokoro. На текущем сервере это
   `/opt/eng-bot/tools/tts/.venv` с `kokoro==0.9.4` и `soundfile==0.13.1`, Python 3.10;
   инструкция установки — `tools/tts/README.md`. Первый синтез может скачать модель.
   Установить окружения YouTube и wordfreq из файлов требований в репозитории:

   ```bash
   install -d -o engbot -g engbot /opt/eng-bot/tools/tts
   runuser -u engbot -- python3 -m venv /opt/eng-bot/tools/tts/.venv
   runuser -u engbot -- /opt/eng-bot/tools/tts/.venv/bin/pip install kokoro==0.9.4 soundfile==0.13.1
   ln -s /opt/eng-bot/tools/tts/.venv /opt/eng-bot-git/tools/tts/.venv
   runuser -u engbot -- python3 -m venv /opt/eng-bot-git/tools/youtube/.venv
   runuser -u engbot -- /opt/eng-bot-git/tools/youtube/.venv/bin/pip install -r /opt/eng-bot-git/tools/youtube/requirements.txt
   runuser -u engbot -- python3 -m venv /opt/eng-bot-git/tools/wordfreq/.venv
   runuser -u engbot -- /opt/eng-bot-git/tools/wordfreq/.venv/bin/pip install -r /opt/eng-bot-git/tools/wordfreq/requirements.txt
   ```

   Если окружение Kokoro восстановлено из копии, проверьте путь Python и создайте только ссылку.
   STT/Whisper на сервер не ставить, пока распознавание намеренно выключено.
6. Установить unit-файлы `scripts/server/eng-bot.service`, `eng-bot-deploy.{service,timer}` и
   `eng-bot-backup.{service,timer}` в `/etc/systemd/system/`. Файл
   `/etc/sudoers.d/engbot-deploy` должен содержать ровно:

   ```text
   engbot ALL=(root) NOPASSWD: /usr/bin/systemctl restart eng-bot.service
   ```

   Права файла `0440`; проверьте `visudo -cf /etc/sudoers.d/engbot-deploy`. Это право нужно
   `deploy.py`, запущенному от `engbot`, для перезапуска бота после сборки. Затем:

   ```bash
   cp /opt/eng-bot-git/scripts/server/eng-bot*.service /etc/systemd/system/
   cp /opt/eng-bot-git/scripts/server/eng-bot*.timer /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now eng-bot-backup.timer
   systemctl start eng-bot-backup.service
   ```

   Бот пока не запускайте: сначала остановите прежний long polling процесс.
   `eng-bot-deploy.timer` — прежний вариант с опросом GitHub; в рабочей конфигурации он выключен.

7. Выпустить сертификат для IP **до** включения HTTPS-сайта. Сейчас Certbot 5.9 установлен
   отдельно в `/opt/certbot-ip`; его состояние — в `/etc/letsencrypt-ip`, рабочие файлы — в
   `/var/lib/letsencrypt-ip`, логи — в `/var/log/letsencrypt-ip`. Порт 80 должен быть доступен
   снаружи, а `/.well-known/acme-challenge/` должен отдаваться из `/var/www/html`.
   Для отдельной установки Certbot на Ubuntu 22.04 и выпуска для текущего IP:

   ```bash
   python3 -m venv /opt/certbot-ip
   /opt/certbot-ip/bin/pip install certbot==5.9.0
   /opt/certbot-ip/bin/certbot certonly --webroot -w /var/www/html \
     --ip-address 144.31.167.217 --preferred-profile shortlived \
     --config-dir /etc/letsencrypt-ip --work-dir /var/lib/letsencrypt-ip \
     --logs-dir /var/log/letsencrypt-ip --non-interactive --agree-tos \
     -m YOUR_EMAIL
   ```

   Установить `scripts/server/nginx-ip.conf` как `/etc/nginx/sites-available/eng-bot-ip`,
   включить ссылкой в `sites-enabled`, проверить `nginx -t` и перезагрузить Nginx:

   ```bash
   cp /opt/eng-bot-git/scripts/server/nginx-ip.conf /etc/nginx/sites-available/eng-bot-ip
   ln -s /etc/nginx/sites-available/eng-bot-ip /etc/nginx/sites-enabled/eng-bot-ip
   nginx -t
   systemctl reload nginx
   systemctl daemon-reload
   systemctl enable --now eng-bot-cert-renew.timer
   ```

   На текущем VPS порт 80 обслуживает стандартный сайт Nginx с корнем `/var/www/html`; бот использует
   только HTTPS-сайт. Файлы `eng-bot-cert-renew.{service,timer}` уже скопированы на шаге 6.
   Таймер проверяет продление дважды в день и перезагружает Nginx после успешного выпуска.
   Сертификат IP короткоживущий: контролируйте таймер и срок командой
   `/opt/certbot-ip/bin/certbot certificates --config-dir /etc/letsencrypt-ip`.

8. До переключения трафика остановить **старый** экземпляр бота. Два long polling процесса с
   одним `BOT_TOKEN` дают Telegram 409. После переноса с Mac его `com.engbot.*` launchd-задания
   были удалены. Отдельный ngrok-агент `com.moneybot.ngrok` нужен другому проекту — его не трогать.
   После остановки старого экземпляра:

   ```bash
   systemctl enable --now eng-bot.service
   ```

9. Для прямого деплоя из GitHub Actions создать отдельного SSH-пользователя `engbot-deploy`
   и ключ. В `authorized_keys` разрешить ключу только принудительную команду
   `/usr/bin/sudo -n /usr/bin/systemctl start eng-bot-deploy.service` с опцией `restrict`.
   Пример на сервере после передачи **публичного** ключа в `/tmp/engbot-actions-deploy.pub`:

   ```bash
   useradd --system --create-home --home-dir /var/lib/engbot-deploy --shell /bin/sh engbot-deploy
   install -d -o engbot-deploy -g engbot-deploy -m 700 /var/lib/engbot-deploy/.ssh
   printf '%s ' 'restrict,command="/usr/bin/sudo -n /usr/bin/systemctl start eng-bot-deploy.service"' > /var/lib/engbot-deploy/.ssh/authorized_keys
   cat /tmp/engbot-actions-deploy.pub >> /var/lib/engbot-deploy/.ssh/authorized_keys
   chown engbot-deploy:engbot-deploy /var/lib/engbot-deploy/.ssh/authorized_keys
   chmod 600 /var/lib/engbot-deploy/.ssh/authorized_keys
   ```

   В `/etc/sudoers.d/engbot-actions-deploy` (права `0440`) разрешить только эту команду:

   ```text
   engbot-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl start eng-bot-deploy.service
   ```

   Приватную часть отдельного ключа сохранить в секрете репозитория GitHub
   `DEPLOY_SSH_KEY` командой `gh secret set DEPLOY_SSH_KEY --repo Aleksandr-Karikov/eng-bot
   < ПУТЬ_К_ПРИВАТНОМУ_КЛЮЧУ`; публичный ключ сервера SSH закрепить в `.github/workflows/ci.yml`.
   Не использовать для Actions root-ключ или `BOT_TOKEN`. Проверить ключ и право на запуск
   вручную до первого push. Если IP или host key сервера поменялись, обновить SSH-адрес,
   `known_hosts` в workflow и авторизацию на сервере.

## Выкладка и проверки

GitHub Actions (`.github/workflows/ci.yml`) после push в `main` запускает тесты, typecheck и
сборку Mini App на Linux с `ffmpeg` и `espeak-ng`. Успешный job `checks` запускает job `deploy`:
тот по SSH вызывает только `eng-bot-deploy.service`. На сервере `deploy.py` проверяет успешный
check-run `checks` для точного HEAD `main`, делает `git fetch`, fast-forward merge, `npm ci` в
корне и `app/`, сборку, перезапуск бота и проверку `http://127.0.0.1:8788/app/`.
Если нужно повторить деплой после CI, запустите сервис вручную:

```bash
systemctl start eng-bot-deploy.service
runuser -u engbot -- git -C /opt/eng-bot-git rev-parse --short HEAD
systemctl is-active eng-bot.service eng-bot-backup.timer eng-bot-cert-renew.timer
journalctl -u eng-bot.service -n 50 --no-pager
journalctl -u eng-bot-deploy.service -n 50 --no-pager
curl -fsS https://144.31.167.217/app/ > /dev/null
curl -sS -o /dev/null -w '%{http_code}\n' https://144.31.167.217/ext/ping
```

`/ext/ping` без личного ключа должен вернуть **401** — маршрут доступен, но авторизация работает.
В Telegram проверьте «📚 Учить» и `/audio` на одном слове. Команда `/status` показывает
провайдера, инструменты и порты. Для расширения выполните `/extension` в личке: архив содержит
личный ключ и новый `/ext` URL. Старую установленную версию надо удалить и загрузить новую
через `chrome://extensions`, потому что у прежнего manifest нет доступа к IP и в браузере
может сохраниться старый адрес. После этого проверьте добавление одного слова.

При смене IP обновите `APP_URL`, `scripts/server/nginx-ip.conf`, адрес и разрешения в
`extension/manifest.json`, `extension/background.js`, `extension/options.html`, а также ожидания
в `tests/capture.test.ts`. Выпустите новый сертификат для нового IP, соберите и выложите код,
перезапустите бот для обновления кнопки Telegram и раздайте пользователям новые архивы расширения.
`/extension` берёт адрес из `APP_URL`, отдельной ручной правки ключей пользователей не требуется.

При восстановлении SQLite: остановить `eng-bot.service`, сохранить текущий файл в отдельное
безопасное место, заменить базу проверенным бэкапом, убедиться в владельце `engbot`, запустить
сервис и проверить `PRAGMA integrity_check`/`/status`. Не запускать миграции вручную из скриптов:
их применяет сам бот на старте.

## Что уже сломалось при переезде

- `ngrok` упёрся в лимиты. Адрес `sslip.io` с сертификатом работал на сервере, но не открывался
  у пользователя в Telegram. Поэтому рабочий публичный адрес — HTTPS на IP с настоящим
  сертификатом; старый `scripts/server/nginx.conf` и сайт `eng-bot` для `sslip.io` остались
  как след первой настройки и не используются ботом.
- Linux не имеет команды `say`: тест `/audio` в CI падал с `spawn say ENOENT`. Установлен
  `espeak-ng`, синтезатор выбирается по платформе. Русский системный голос звучит грубо —
  это известное ограничение, английская озвучка Kokoro проверена пользователем.
- Apple MLX/локальный FLUX и STT с Mac не работают на этом Linux-сервере. Картинки переведены
  на API, STT выключен. Переключать LLM на `claude-code` без логина Claude на VPS нельзя;
  рабочий провайдер здесь — OpenRouter.
- Для `/extension` на VPS не было `zip`; он установлен. Старый архив расширения разрешал только
  localhost/ngrok; версия 0.8.4 разрешает IP и отправляет запросы на `/ext`.
- SSH иногда закрывал соединение во время установки ключей. Повторное подключение проходило;
  это не свидетельствовало о падении бота. При диагностике сначала проверить HTTPS и systemd.
- Пробный `certbot renew --dry-run` запускался, но был прерван из-за случайной задержки Certbot
  перед проверкой. Сама проверка HTTP-маршрута и автоматическое продление после выпуска ещё
  требуют наблюдения по журналу `eng-bot-cert-renew.service`.
- На VPS нет swap. При повторной установке на сервер с меньшей памятью проверьте потребление
  Kokoro/PyTorch и сборки Mini App до включения фоновых задач.
