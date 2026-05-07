# Project instructions for Codex

## Project context

This is a NestJS backend for collecting, aggregating, and exporting work statistics for employees, projects, clients, reports, and sprints.

The project integrates with Bitrix24, stores local application data in MySQL via TypeORM, uses Redis for caching, and generates PDF reports with Puppeteer/HTML templates.

Primary stack:
- NestJS
- TypeScript
- TypeORM
- MySQL
- Redis
- Bitrix24 REST API
- Puppeteer for PDF generation
- Biome for linting
- Jest for tests
- Docker for local/prod environments

## Main modules

- `auth` — client login/auth flow.
- `database` — TypeORM data source and migrations.
- `doc-records` — two-week PDF report generation.
- `shared` — Bitrix integration, HTML/PDF builders, Redis module, filters, interceptors.
- `user-sprints` — cached endpoints for activity/time statistics by sprint/reporting data.
- `clients` — client entities and CRUD/auth-related client logic.
- `sprints` — sprint statistics and risk/capacity calculations.

## Commands

Use the scripts already defined in package.json:

```bash
npm run build
npm run lint
npm run test
npm run start:dev
npm run docker:dev
npm run migration:run
npm run migration:generate
npm run migration:show


```

Before finishing a code task, prefer running at least:

npm run build
npm run lint

If tests were affected, also run:

npm run test

### Code style
Use TypeScript strictly and avoid any unless there is a clear reason.
Prefer explicit DTOs and response types.
Keep NestJS layers separated:
Controller handles HTTP contract.
Service handles business logic.
Repository/TypeORM handles persistence.
Shared integrations should stay in shared.
Use dependency injection, not manual service construction.
Use ConfigService for env values.
Throw NestJS exceptions such as BadRequestException, NotFoundException, ConflictException, UnauthorizedException.
Keep external API calls isolated in integration services.


### Bitrix24 conventions
Use existing constants from src/constants/const for endpoints, entity type IDs, custom field codes, select fields, and status codes.
Do not hardcode Bitrix field names if a constant already exists.
Prefer current Bitrix call wrappers from the project integration service.
For future Bitrix24 examples, prefer:
b24.actions.v3.call.make(options)
or b24.actions.v2.call.make(options)
Avoid deprecated b24.callMethod.
Be careful with Bitrix response parsing. Do not assume the user object/result is the whole response; inspect the actual response shape.


### Date and sprint logic
Use dayjs.
Sprint logic is domain-specific and may use Tue–Mon windows.
Weekly capacity:
40h total capacity.
30h development capacity.
10h reserve.
Reserve can be used for development if no other work consumes it.
Risk calculation should not flag a single task overrun as critical if the total sprint reserve still covers it.
Only one task should normally be In Work for a developer.
Blocked is not counted as currently in work.

### Database rules
Use TypeORM migrations for schema changes.
Do not rely on synchronize: true in production.
When changing entities, create or update a migration.
Prefer explicit column names matching existing DB naming style.
Use transactions when multiple related writes must be atomic.


### PDF report rules
PDF generation uses HTML builder + Puppeteer.
Keep HTML generation isolated in builder services.
Avoid mixing heavy business logic directly inside HTML string templates.
When possible, prepare report data first, then pass normalized data into the HTML builder.
Be careful with inline CSS in template strings because formatter support is limited.
### Redis/cache rules
Use Redis for cached read-heavy endpoints.
Cache keys must include all relevant query/filter parameters.
Invalidate or refresh cache after mutations that affect cached data.
Do not cache sensitive auth data unless explicitly designed.
### Security
Never log raw passwords, tokens, webhooks, cookies, or authorization headers.
Passwords must be hashed with bcrypt/bcryptjs before saving.
Use DTO validation with class-validator.
Be cautious with Bitrix webhook URLs and CRM tokens.


#### Response style for this repository

When explaining changes:

Be direct.
Show the final code or patch-style snippets.
Mention what files should be changed.
Mention what commands to run.
If there is a risk or tradeoff, explain it shortly.