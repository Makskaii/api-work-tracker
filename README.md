# Work Tracker API

Backend на NestJS для сбора и агрегации рабочей статистики.

## Требования

- Node.js 20+
- npm
- Docker Desktop с включённым Docker Engine

## Локальный запуск

### 1. Клонировать репозиторий

```bash
git clone <repo_url>
cd work-tracker-api
```

### 2. Установить зависимости

```bash
npm install
```

### 3. Настроить переменные окружения

Создайте файл `.env` на основе `.env.example`:

```bash
cp .env.example .env
```

Проверьте основные параметры подключения:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=analytics_db
DB_USER=app_user
DB_PASSWORD=app_pass
```

### 4. Запустить Docker Desktop

Откройте Docker Desktop и дождитесь состояния **Docker Engine running**. Без запущенного Docker Desktop контейнеры MySQL и Redis не поднимутся.

### 5. Запустить MySQL и Redis

Из корня проекта выполните:

```bash
npm run docker:dev
```

Команда запускает контейнеры `mysql-local-2` (порт `3306`) и `redis-local` (порт `6379`). Проверить их состояние можно так:

```bash
docker compose -f docker/dev/docker-compose.yml ps
```

### 6. Запустить миграции

```bash
npm run migration:run
```

### 7. Запустить приложение в режиме разработки

```bash
npm run start:dev
```

После запуска API доступен по адресу `http://localhost:3000` (или по порту из `.env`).

## Остановка Docker-контейнеров

```bash
npm run docker:dev:down
```

Команда останавливает контейнеры, но сохраняет данные в Docker volumes.

### Импорт проектов для отчётов

```bash
npm run import:report-projects

## Полезные команды

```bash
npm run build       # собрать приложение
npm run lint        # проверить код
npm run test        # запустить тесты
```
