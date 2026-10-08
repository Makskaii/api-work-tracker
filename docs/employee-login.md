# Employee login outside Bitrix24

Work Tracker can open directly at `https://crm.evolution-soft.ru/devapps/work-tracker/`. Employees use the installed Bitrix24 application's OAuth login; there is no separate employee password database. Customer cabinet login remains separate.

The OAuth return address is the installed application's existing handler, `https://crm.evolution-soft.ru/devapps/work-tracker`, without a trailing slash. Nginx must serve that exact path without dropping the query. Both forms of the application URL must load the same frontend. Disable query-bearing access logging at the return handler and set `Referrer-Policy: no-referrer` before loading the frontend. The frontend removes the callback query and exchanges its one-time code immediately.

## Server settings

Set the `BITRIX_OAUTH_*` variables listed in `.env.example` in a server-only, mode-600 environment file. The client ID, secret and portal member ID belong to the existing installed application. The session encryption key is a random 32-byte value encoded as 64 hexadecimal characters. Retain it across restarts; replacing it invalidates all employee sessions. None of these values may use a `VITE_` prefix or be committed to Git.

The configured integration `API_URL` determines the single trusted portal. OAuth token exchange uses only the configured trusted Bitrix OAuth host; callback hosts and REST URLs never override it. `FRONTEND_URL` is a comma-separated CORS allowlist. Production cookie writes additionally require the trusted portal Origin and a session CSRF header.

Use `EMPLOYEE_AUTH_ENFORCE=true` in the final deployment. The temporary `false` setting permits rollout of the backend before replacing the previous frontend. It does not make the new authenticated REST proxy public. If the setting is absent, staff API authentication is enforced.

## HTTP contract

- `GET /auth/employee/login?returnTo=/development-kanban` creates a five-minute login state cookie and redirects to the portal's OAuth page.
- `POST /auth/employee/complete` accepts `{code,state,domain?}`. It verifies the cookie, consumes the state atomically, exchanges the code, pins the portal/member identity, and returns user display data, ability rules, CSRF token, expiry and return path.
- `GET /auth/employee/me` returns the same display/permission data for an existing session. OAuth credentials are never returned.
- `POST /auth/employee/frame` accepts the already initialized iframe SDK access token, verifies the employee and establishes a short cookie session. It preserves a valid standalone session for the same user. Normal iframe API requests continue to use a refreshed SDK token.
- `POST /auth/employee/logout` requires `X-Work-Tracker-CSRF`, revokes the server session and clears its cookies. It does not sign the employee out of Bitrix24.
- `POST /auth/employee/rest` accepts `{method,params}` and returns native Bitrix pagination data. It accepts only the Work Tracker method/entity allowlist. Report reads retain the existing integration's report scope behind employee permission checks. Mutations execute with the employee's OAuth token and Bitrix permissions.

The API is exposed under `/devapps/work-tracker/api/`. Cookies use `/devapps/work-tracker/`, Secure, HttpOnly and SameSite=Lax. Employee access/refresh tokens are encrypted with AES-256-GCM in Redis, under hashed session identifiers. OAuth state is single-use. Refresh rotation uses a lock and compare-and-set so concurrent requests or logout cannot resurrect an old session. Profile and department permissions are checked again within five minutes. Transient upstream failures do not convert to successful authentication.

## Permissions and compatibility

Server permission categories mirror the existing menu rules: administrators, department heads, individual exceptions and development/business analytics departments can access staff reports; sales can access sales reports and client management. Department descendants are included. Personal employee-statistics access stays limited to that employee. Inactive and extranet users cannot log in.

Customer `/auth/client` and `/clients/me/*` keep their existing customer JWT flow. Support report webhooks retain their independent secret validation. Staff data and management routes require a verified employee session or iframe token; they cannot use the customer's JWT as staff authentication.

The production frontend's `VITE_API_URL` must contain only the public portal REST origin, e.g. `https://crm.evolution-soft.ru/rest/`. The privileged webhook exists solely in the backend environment. Editing cards open in Bitrix24; return/close refreshes the relevant view without resetting the entire list.

No database schema changes or migration are required for this feature.
