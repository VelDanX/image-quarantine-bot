<div align="center">

# 🖼️ Image Quarantine Bot

Discord-бот для автоматического обнаружения и «карантина» за запрещённые изображения в сообщениях.

Discord bot that automatically detects banned images in messages and puts offenders into quarantine.

**by [@VelDanX](https://github.com/VelDanXx) · [Codeberg](https://codeberg.org/VelDanX)** · [Проект на Codeberg](https://codeberg.org/VelDanX/image-quarantine-bot) · [Проект на GitHub](https://github.com/VelDanXx/image-quarantine-bot)

![Discord.js](https://img.shields.io/badge/Discord.js-v14-5865F2?logo=discord)
![MongoDB](https://img.shields.io/badge/MongoDB-6+-success?logo=mongodb)
![Node.js](https://img.shields.io/badge/Node.js-22+-success?logo=nodedotjs)
![Codeberg](https://img.shields.io/badge/Mirror-Codeberg-2185d0?logo=codeberg&logoColor=white)

</div>

---

## 📖 О боте / About

**RU:** Бот мониторит сообщения на серверах Discord, находит в них изображения и сравнивает их с базой «запрещённых» референсов. При совпадении выше заданного порога сообщение удаляется, а автору выдаётся роль карантина. Поддерживает полную настройку из панели `/settings`, кастомные уведомления в ЛС и лог-канал, авто-снятие и восстановление ролей.

**EN:** The bot watches Discord servers for messages, extracts images and compares them against a database of banned reference images. When similarity exceeds the configured threshold the message is deleted and the author is given a quarantine role. Everything is configured via the `/settings` panel: custom DMs, log channel, auto role remove/restore and more.

---

## ✨ Возможности / Features

| RU | EN |
|----|----|
| 🚫 Удаление сообщений с запрещёнными изображениями | Deletes messages containing banned images |
| 🦠 Авто-карантин: выдача роли, снятие/восстановление ролей | Auto-quarantine: role assign, role strip & restore |
| 🔍 Детекция по нескольким хешам (dHash + pHash + форматы) | Detection via multiple hashes (dHash + pHash + formats) |
| 🎚️ Гибкий порог схожести | Configurable similarity threshold |
| 🐘 Хранение референсов в MongoDB | References stored in MongoDB |
| 📨 Уведомления в ЛС (текст или JSON-шаблон) | DM notifications (text or JSON template) |
| 📝 Лог-канал (текст или JSON-шаблон) | Log channel (text or JSON template) |
| ⏭️ Игнор пользователей и ролей | Ignore users and roles |
| 🖼️ Ловит картинки из вложений, эмбедов, текста и сниппетов | Catches images from attachments, embeds, text and message snapshots |
| 🎨 Настройка через панель `/settings` (только админ) | `/settings` panel (admin only) |
| 🚀 Работа в Docker | Runs in Docker |

---

## ⚙️ Принцип работы / How it works

**RU:**

1. Бот слушает сообщения на серверах. Из каждого сообщения извлекаются ссылки на изображения: вложения, image/thumbnail эмбедов, ссылки в тексте и ссылки внутри форум-спиппетов (`messageSnapshots`).
2. Картинка скачивается (таймаут 30 сек, лимит 10 МБ) и обрабатывается библиотекой `sharp`.
3. Вычисляются перцептивные хеши:
   - **dHash** (33×32) — разностный хеш, устойчив к перезаписи формата;
   - **pHash** (DCT 8×8) — хеш по дискретному косинусному преобразованию;
   - **хеши форматов** (png / jpg / webp / gif) — защита от «перекодирования» картинки;
4. Хеши ищутся в **BK-дереве** референсов конкретного сервера — поиск по расстоянию Хэмминга с учётом порога схожести.
5. Если совпадение найдено: сообщение удаляется, автору выдаётся роль карантина (опционально с предварительным снятием остальных ролей), отправляется уведомление в ЛС и запись в лог-канал.
6. Роли запоминаются в БД. При ручном снятии карантина или перезапуске бота роли автоматически восстанавливаются.

**EN:**

1. The bot watches every guild message and extracts image URLs from attachments, embed images/thumbnails, links in the text and forum message snapshots.
2. Each image is downloaded (30 s timeout, 10 MB cap) and processed with `sharp`.
3. Perceptual hashes are computed:
   - **dHash** (33×32) — difference hash, robust against format re-encoding;
   - **pHash** (DCT 8×8) — based on a discrete cosine transform;
   - **format hashes** (png / jpg / webp / gif) — protection against image re-encoding;
4. The hashes are looked up in the guild's **BK-tree** of references — Hamming-distance search with the configured similarity threshold.
5. On a match: the message is deleted, the author receives the quarantine role (optionally stripping other roles first), a DM notification and a log entry are sent.
6. Roles are stored in the DB. When the quarantine role is removed manually or after a bot restart, old roles are restored automatically.

---

## 🧰 Стек / Tech stack

- **Node.js 22+** (ESM)
- **discord.js 14** — Discord API (Components v2)
- **sharp** — обработка изображений и хеширование
- **MongoDB** (официальный драйвер) — референсы, роли карантина, настройки
- **Docker / docker-compose** — удобный запуск

---

## 📦 Требования / Requirements

- Node.js **22+** или Docker
- MongoDB (в Docker-репозитории уже есть `docker-compose.yml`)
- Discord-приложение с **bot token** и включёнными privileged intents:
  - `Message Content Intent`
  - `Server Members Intent`
- Права бота в Discord: управление ролями, удаление сообщений, отправка сообщений

---

## 🚀 Установка и запуск / Installation & run

### Вариант 1: Docker / Option 1: Docker

Скопируйте `.env.example` в `.env` и укажите свои значения, затем:

```bash
cp .env.example .env
docker compose up -d --build
```

**EN:** Copy `.env.example` to `.env`, fill in your values, then run the commands above.

### Вариант 2: Вручную / Option 2: Manual

```bash
npm install
cp .env.example .env   # заполните токен и данные
npm start
```

**EN:** install dependencies, create `.env` from the example, then `npm start`.

---

## 🔧 Конфигурация / Configuration

`.env`:

```dotenv
DISCORD_TOKEN=ваш_токен_бота            # your Discord bot token
CLIENT_ID=ваш_client_id                 # your application (client) ID
MONGO_URI=mongodb://local:local@localhost:27017/image-quarantine-bot?authSource=admin
```

**RU:** `DISCORD_TOKEN` и `CLIENT_ID` обязательны — без них бот не запустится. `MONGO_URI` по умолчанию совпадает с той, что поднимает `docker-compose.yml`.

**EN:** `DISCORD_TOKEN` and `CLIENT_ID` are required — the bot refuses to start without them. Default `MONGO_URI` matches the MongoDB from `docker-compose.yml`.

---

## 🎛️ Команды и настройка / Commands & settings

| Команда / Command | Описание / Description |
|-------------------|------------------------|
| `/settings` | Открывает панель настроек (только для пользователей с флагом Administrator). / Opens the settings panel (Administrator permission required). |

Из панели доступно / Within the panel you can configure:

- **Вкл/выкл фильтрации** — toggle the filter on/off
- **Игнор пользователей и ролей** — ignored users & roles
- **Роль карантина** — the quarantine role
- **Авто-снятие ролей** и роли, которые нужно сохранить (используется только для добавления) — auto-remove roles & keep roles list
- **Лог-канал** и сообщение лога (текст или JSON-шаблон) — log channel & message (text or JSON template)
- **Уведомление в ЛС** и его шаблон — DM notification & template
- **Порог схожести (%)** — similarity threshold
- **Управление референсами**: загрузка запрещённых изображений, просмотр, удаление — manage references: upload, view, delete
- **Цвет акцента** уведомлений (hex) — accent color for notifications (hex)
- **Разрешить/запретить упоминания в логе** — allow/disallow mentions in logs
- **JSON-шаблоны сообщений** через загрузку `.json` / JSON message templates via `.json` upload

### Переменные в текстах сообщений / Message template variables

| Переменная | Описание / Description |
|------------|------------------------|
| `{user.mention}` | Упоминание пользователя / user mention |
| `{user.tag}` | Тег пользователя / user tag |
| `{user.id}` | ID пользователя / user ID |
| `{user.name}` | Имя пользователя / username |
| `{server.name}` | Название сервера / guild name |
| `{server.id}` | ID сервера / guild ID |
| `{channel}` | Канал / channel |
| `{imageUrl}` | URL найденной картинки / matched image URL |
| `{matchedFile}` | Файл референса, с которым найдено совпадение / matched reference file |
| `{similarity}` | Сходство в % / similarity % |
| `{autoRemove}` | Были ли сняты роли (`Да`/`Нет`) / whether roles were removed |
| `{file}` | Файл-совпадение (лог) / matched file (log) |
| `{match}` | Процент совпадения (лог) / match % (log) |
| `{dm.sent.successfull}` | Статус отправки ЛС (лог) / DM send status (log) |
| `{image}` | URL картинки (лог) / image URL (log) |

---

## 📁 Структура проекта / Project structure

```
image-quarantine-bot/
├── docker-compose.yml       # MongoDB + бот (Docker)
├── Dockerfile               # multi-stage сборка
├── package.json
└── src/
    ├── main.js              # точка входа, события клиента
    ├── config.js            # чтение CLIENT_ID из .env
    ├── mongo.js             # подключение, индексы
    ├── logger.js            # простой логгер
    ├── messageHandler.js    # обработка сообщений, карантин, роли, шаблоны
    ├── imageQuarantine.js   # хеши, BK-деревья, проверка совпадений, JSON->Components
    ├── lib/
    │   ├── commandRegister.js   # регистрация слэш-команд
    │   └── boundedMap.js        # LRU-кэш с TTL
    └── settings/
        ├── core.js          # панель настроек, меню, defaultSettings
        └── imageQuarantine.js  # UI настройки фильтрации и референсов
```

---

## 🗄️ Данные в MongoDB / Data in MongoDB

- `botSettings` — настройки по серверам;
- `quarantine_references` — запрещённые изображения (хеши + оригинальные данные);
- `quarantine_roles` — кого у кого из пользователей нужно восстановить роли.

**EN:** `botSettings` — per-guild settings; `quarantine_references` — banned images (hashes + original data); `quarantine_roles` — role snapshots to restore after quarantine.

---

## 📝 Автор / Author

**@VelDanXx** · [GitHub](https://github.com/VelDanXx) · [Codeberg](https://codeberg.org/VelDanX)
