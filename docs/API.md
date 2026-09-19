# API Reference

Base URL: `{VITE_API_URL}` (default `http://localhost:5000/api`). All bodies/responses are JSON.

Auth: routes marked **JWT** require `Authorization: Bearer <token>`, obtained from `/auth/login`, `/auth/register`, or `/auth/google`. An expired/invalid/missing token returns `401 { message: "Not authorized" }` (or `"Not authorized, no token"`). Any request body or query string containing a key that starts with `$` is rejected up front with `400 { message: "Malformed request body" }`. Every resource endpoint additionally scopes to the requesting user — you cannot read or mutate another user's data by guessing an id (a mismatched owner returns `401`/`403`/`404` depending on the endpoint, see below).

Unhandled/unexpected server errors return `500 { message: "Server Error" }` (or a resource-specific message) and never include stack traces or internals. A malformed JSON request body returns `400 { message: "Malformed request body" }`. An unknown route returns `404 { message: "Route not found" }`.

`GET /` — public health check, returns the plain-text string `Repvyn Backend Running...`.

## Auth — `/api/auth`

| Method | Endpoint | Auth | Purpose | Body | Notes |
|---|---|---|---|---|---|
| POST | `/register` | Public (rate-limited) | Create an account | `name, email, password, username` | Seeds default exercises for the new user. Email is trimmed and lowercased before it is stored or compared, so a case variant of an existing email counts as taken. `400` on missing or non-string fields, name over 60 characters, invalid email format, password < 6 chars, or existing email. |
| POST | `/login` | Public (rate-limited) | Email/password login | `email, password` | Returns `{ token, user }`. `400 "Invalid Email or Password"` on any failure (no distinction between wrong email vs. wrong password). `400 "Email and password are required"` when either is missing or not a string. |
| POST | `/google` | Public | Google Sign-In | `token` (Google ID token) | Verifies the ID token server-side; creates the user on first sign-in (seeds default exercises). Returns `{ token, user }`. `500 "Google Login Failed"` on verification failure. |
| POST | `/forgot-password` | Public (rate-limited) | Request a reset email | `email` | Always returns `200` with a generic message regardless of whether the email exists, to avoid leaking account existence. `400` only when `email` is missing or not a string. |
| POST | `/reset-password/:token` | Public | Complete a reset | `newPassword` | `token` is the raw token from the emailed link (hashed server-side before lookup); expires 15 minutes after request. `400` if invalid/expired or password < 6 chars. |
| GET | `/me` | JWT | Current user | — | Returns `req.user` (password/reset fields excluded). |
| PUT | `/profile` | JWT | Update display name | `name` | `400` when empty, not a string, or over 60 characters. |
| PUT | `/change-password` | JWT | Change password | `oldPassword, newPassword` | `400` if `oldPassword` doesn't match. |
| DELETE | `/account` | JWT | Delete own account | — | Deletes the `User` document only — related workouts/goals/exercises/etc. are not cascade-deleted (see README known limitations). |

## Exercises — `/api/exercises`

| Method | Endpoint | Auth | Purpose | Body / Query | Notes |
|---|---|---|---|---|---|
| POST | `/` | JWT | Create a custom exercise | `name, muscleGroup` | `400` on invalid muscle group or duplicate (case/whitespace-insensitive) name for this user. |
| GET | `/` | JWT | List exercises | Query: `muscleGroup` (optional filter) | Deduplicated by normalized name; sorted by name. |
| PUT | `/:id` | JWT | Rename / recategorize | `name?, muscleGroup?` | `403` if the exercise is a seeded default or not owned by the caller. |
| DELETE | `/:id` | JWT | Delete a custom exercise | — | `403` if default/not owned. `409` if a Strength PR goal still references it — must be removed/edited first. |

## Workouts — `/api/workouts`

| Method | Endpoint | Auth | Purpose | Body / Query | Notes |
|---|---|---|---|---|---|
| POST | `/` | JWT | Log a single legacy-style workout | `exercise, workoutSets, sessionId, sessionDuration` | |
| POST | `/session` | JWT | Save a full workout session | `sessionId, sessionDuration, sessionType, customSessionType?, exercises: [...], startedAt?, endedAt?, sessionNote?, plannedWorkoutId?` | `exercises` entries can be strength or cardio (`entryType`). Triggers goal recalculation and PR/streak/completion notification detection; a goal-recalculation failure is reported in the response (`goalRecalculationFailed: true`) but does not fail the request — the session is still saved. |
| GET | `/` | JWT | List workouts | Query: `page, limit, start, end` | Paginated; `start`/`end` filter on `createdAt`. |
| PUT | `/:id` | JWT | Edit a single workout | `workoutSets?, exercise?` | Re-triggers goal recalculation if either field changes. |
| DELETE | `/session/:sessionId` | JWT | Delete an entire session | — | Recalculates affected goals once for the whole session. |
| PUT | `/session/:sessionId/timing` | JWT | Correct session start/end time | `startedAt?, endedAt?, sessionDuration?, timingMode?` | |
| DELETE | `/:id` | JWT | Delete a single legacy workout | — | |

## Dashboard — `/api/dashboard`

All `GET`, all `JWT`, no body. Every value is computed from the caller's own workouts.

| Endpoint | Purpose |
|---|---|
| `/personal-records` | Heaviest set ever logged per exercise |
| `/current-streak` | Current consecutive-day workout streak |
| `/top-muscle` | Most-trained muscle group by total sets |
| `/top-exercise` | Most-logged exercise by session count |
| `/calendar-workouts` | Every workout, populated, for calendar rendering |
| `/session-summary` | Total/7-day/30-day session counts, last session summary, recent averages |
| `/recent-sessions` | Query: `limit` (default 6) — most recent sessions, grouped |

## Goals — `/api/goals`

| Method | Endpoint | Auth | Purpose | Body | Notes |
|---|---|---|---|---|---|
| POST | `/` | JWT | Create a goal | `title, type, target, unit`, plus type-specific fields (`exercise` for Strength PR; `activityType/metric/period/dailyTarget` for an automatic Cardio Goal; `current` for manual types) | `current` is computed server-side for automatic types; `400` on invalid/incomplete cardio config or non-positive target. |
| GET | `/` | JWT | List goals | — | |
| PUT | `/:id` | JWT | Update a goal | Any of `title, type, target, unit, exercise, deadline, activityType, metric, period, dailyTarget, current` | Recomputes `status` (Completed/In Progress) and, for a configured Cardio Goal whose config changed, recomputes `current`. May emit progress-crossed notifications. |
| DELETE | `/:id` | JWT | Delete a goal | — | |

## Daily Steps — `/api/daily-steps`

| Method | Endpoint | Auth | Purpose | Body / Query |
|---|---|---|---|---|
| GET | `/` | JWT | List logged step counts | Query: `from?, to?` (`YYYY-MM-DD`, default last 120 days to today) |
| PUT | `/` | JWT | Set a day's step count | `date` (`YYYY-MM-DD`), `steps` (overwrites, does not accumulate) |

## Notifications — `/api/notifications`

| Method | Endpoint | Auth | Purpose | Body / Query |
|---|---|---|---|---|
| GET | `/` | JWT | List active notifications | Query: `limit` (default 50, max 100). Returns `{ notifications, unreadCount }`. Auto-dismisses expired ones on read. |
| POST | `/generate` | JWT | Persist client-detected reminder candidates | `candidates: [...]` — strictly whitelisted/typed fields; server dedupes via the same path as server-detected notifications. |
| PUT | `/read-all` | JWT | Mark all unread as read | — |
| PUT | `/clear-read` | JWT | Dismiss all already-read | — |
| PUT | `/:id/read` | JWT | Mark one as read | — |
| PUT | `/:id/dismiss` | JWT | Dismiss one | — |
| PUT | `/:id/snooze` | JWT | Snooze one | `until: "today" \| "tomorrow"` |

## Planned Workouts — `/api/planned-workouts`

| Method | Endpoint | Auth | Purpose | Body / Query |
|---|---|---|---|---|
| POST | `/` | JWT | Create a planned workout (optionally recurring) | Per `validatePlannedWorkoutPayload` |
| GET | `/` | JWT | List planned workouts | Flips overdue "Planned" instances to "Missed" first |
| PUT | `/:id` | JWT | Edit | Query: `editScope=only\|future\|series` (default `only`) |
| PUT | `/:id/reschedule` | JWT | Move to a new date/time | `scheduledDate, scheduledTime?` — always scoped to just this instance |
| PUT | `/:id/complete` | JWT | Manually mark complete | — (no linked real session) |
| POST | `/:id/duplicate` | JWT | Duplicate as a new standalone plan | `scheduledDate, scheduledTime?` |
| PUT | `/:id/cancel` | JWT | Cancel | Query: `editScope=only\|future\|series` |
| DELETE | `/:id` | JWT | Delete | Query: `editScope=only\|future\|series` |

## Push Notifications — `/api/push`

| Method | Endpoint | Auth | Purpose | Body |
|---|---|---|---|---|
| POST | `/subscriptions` | JWT | Register/refresh this browser's push subscription | `{ subscription: { endpoint, keys: { p256dh, auth } } }` (or the same shape at the top level). `endpoint` must be an `https` URL on a known push service (Google FCM, Mozilla, Apple, or Windows notify hosts) with no credentials or custom port, and both keys must be base64url text; anything else returns `400`. |
| DELETE | `/subscriptions` | JWT | Remove this browser's subscription | `endpoint` |
| GET | `/preferences` | JWT | Get push preferences | — (returns defaults if never set) |
| PUT | `/preferences` | JWT | Update push preferences | `pushEnabled?: boolean`, `quietHours?: { enabled?, start?, end?, mode?: "allow"\|"criticalOnly"\|"suppressAll" }` |
| PUT | `/notifications/:id/clicked` | JWT | Record a push click (called by the service worker) | — |

All `:id` params on routes above are validated as Mongo ObjectIds before reaching the controller (`400 { message: "Invalid ID" }` if malformed).
