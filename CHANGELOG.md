# Changelog

## [0.0.2] - 2026-09-13

### Исправлено / Fixed
- Логика `disableLogMentions` работала наоборот: упоминания блокировались, когда опция была выключена, и наоборот.
  / The `disableLogMentions` logic was inverted: mentions were blocked when the option was off, and vice versa.
- Чекбокс «упоминания в логе» в настройках лог-канала показывал всегда включённое состояние — теперь отражает текущую настройку.
  / The "mentions in log" checkbox in the log-channel settings always showed as enabled — it now reflects the current setting.

### Добавлено / Added
- Превью ЛС-уведомления и превью лог-сообщения: вместо заглушки «Сначала задайте текст или загрузите JSON» показывается живой пример с подстановкой переменных и цветом акцента.
  / DM notification and log message previews: instead of the "Set a text or upload JSON first" placeholder, a live example with variable substitution and accent color is shown.

### Прочее / Other
- Версия поднята до 0.0.2. / Version bumped to 0.0.2.
- `package-lock.json` добавлен в `.gitignore`. / `package-lock.json` added to `.gitignore`.
- Авторство в README и package.json приведено к `@VelDanX`. / Author credited as `@VelDanX` in README and package.json.