# HACKATHON_ACCESS — шаблон

Настоящий файл с паролями создаёт `pnpm --filter @all/web provision:demo --out ../../HACKATHON_ACCESS.md`
(в `.gitignore`, права 600). Передавайте его жюри отдельно — **не публикуйте в репозитории**.

- Public URL: https://<project>.vercel.app
- Demo Owner Email: demo.owner@example.com
- Demo Owner Password: <передаётся отдельно>
- Demo Staff Email: demo.staff@example.com
- Demo Staff Password: <передаётся отдельно>

## Инструкция для тестирования
1. Откройте Public URL → «Войти», войдите как Demo Owner.
2. «Ассистент» → «Протестировать AI» → голосом или текстом:
   «Сколько стоит замена масла?» → «Хочу записаться на завтра» → «Меня зовут Азамат, мой номер +996 555 123 456».
3. Откройте созданную заявку в CRM, смените статус («Взять»), обновите страницу.
4. Войдите как Demo Staff и убедитесь, что разделы владельца недоступны.

Подробный сценарий — docs/DEMO_SCRIPT.md.
