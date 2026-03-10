# Project Name

Backend для сбора и агрегации статистики по сотрудникам, проектам и спринтам.  
Локально проект запускается через **NestJS**, а база данных поднимается в **Docker**.

---

## Требования

Перед запуском убедитесь, что установлены:

- [Node.js](https://nodejs.org/) 20+
- npm
- [Docker](https://www.docker.com/)
- Docker Compose

---

## Стек

- NestJS
- MySQL 
- Docker
- TypeORM

---

## Запуск проекта локально

### 1. Клонировать репозиторий

```bash
git clone <repo_url>
cd <project_folder>

```
### 2. Создать .env
.env.example .env

### 3. Пример переменных:
PORT=3000

DB_HOST=localhost
DB_PORT=3306
DB_NAME=analytics_db
DB_USER=app_user
DB_PASSWORD=app_pass



### 4.Собрать докер контейнер для бд

### 5. Поднять базу локально

```bash
docker start mysql-local