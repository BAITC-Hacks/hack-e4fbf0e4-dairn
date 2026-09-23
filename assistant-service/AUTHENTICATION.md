# User accounts, authorization and history

The Assistant stores users, account tokens and conversation ownership in its existing SQLite database (`ASSISTANT_DATA_DIR/assistant.sqlite3`; `/data/assistant.sqlite3` in Docker's named volume). Startup creates missing tables without deleting guest sessions. Passwords use salted scrypt hashes (N=131072, r=8, p=1); opaque random bearer tokens are stored only as SHA-256 hashes. Password hashing runs in synchronous FastAPI endpoints off the event loop, with two concurrent hash operations per process.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/v1/auth/register` | Create user and issue token (201) |
| POST | `/v1/auth/login` | Issue a new token (200) |
| GET | `/v1/auth/me` | Return the authenticated user |
| POST | `/v1/auth/logout` | Revoke the presented token (204) |
| POST | `/v1/sessions` | Create a conversation owned by the authenticated user |
| GET | `/v1/sessions?limit=50&offset=0` | List this user's conversations, newest first |
| GET | `/v1/sessions/{session_id}/messages?limit=50&offset=0` | Read an owned conversation's messages |
| DELETE | `/v1/sessions/{session_id}` | Delete an owned conversation and associated data (204) |

Register without an Authorization header:

```json
{"username":"alice","password":"choose-a-long-password","display_name":"Alice"}
```

Login uses the same username/password without `display_name`. Usernames are case-insensitive, trimmed, 3–64 characters (`a-z`, digits, `_`, `.`, `-`). Passwords must be 12–128 characters and are not trimmed. Display names are 1–100 nonblank characters. Responses never return password hashes.

Registration/login response:

```json
{
  "access_token": "usr_<opaque-secret>",
  "token_type": "bearer",
  "expires_at": "2026-09-24T12:00:00+00:00",
  "user": {
    "user_id": "generated-id",
    "username": "alice",
    "display_name": "Alice",
    "created_at": "2026-09-23T12:00:00+00:00"
  }
}
```

Send `Authorization: Bearer <access_token>` for all account/owned-session requests. Create a conversation with `{"locale":"ru"}`. The response includes `user_id`, `created_at` and `session_token: null`; the account token is the only credential for this conversation. Every existing session endpoint enforces ownership, including attachments, messages, SSE and cart. Another account receives 404; missing/expired/revoked account credentials receive 401. SSE revalidates authorization during streaming.

Guest sessions remain available only when demo sessions are enabled; they keep their individual session tokens. Backend bootstrap sessions are also separate. Neither can list account history or acquire ownership of account conversations. Existing guest chats are not migrated to an account automatically.

Message pages select newest first and return each selected page in chronological order. Offset defaults to zero; limit is 1–200. Use a larger offset for older messages. Each conversation is capped at 200 messages; create another when full.

## Persistence and retention

- `users`: ID, unique normalized username, display name, creation timestamp and password hash.
- `auth_tokens`: hashed token, user ID, expiry. Default lifetime: 24 hours (`ASSISTANT_AUTH_TOKEN_TTL_SECONDS`). Logout revokes only the current token; other device logins remain valid.
- `user_sessions`: indexed mapping from conversation ID to owner.
- `objects`, `jobs`, `dedup`: existing chat and attachment persistence. Signed-in conversation expiry defaults to 30 days after creation (`ASSISTANT_USER_HISTORY_TTL_DAYS`, range 1–365). Guest expiry remains at most 24 hours.
- Attachment data expires after at most 24 hours, even within a longer-lived chat. Raw uploads are removed after parsing; references may remain in historical messages, and accessing expired attachment content fails. Text quoted in a chat answer follows chat retention.
- `auth_limits`: hashed account/IP keys and 15-minute counters; registration/login are limited to 20 attempts per normalized username and 100 per source IP per window. Forwarded headers are not trusted. Worker housekeeping removes expired rows. Accounts persist until explicitly administered; self-service account deletion is not implemented.

Conversation deletion removes messages, attachments, jobs, dedup keys and session cart records. It does not undo previously committed demo inventory changes or partner orders. Logout keeps conversation history, so a later login—even after an API/worker restart—can access it.

## Run and integration boundaries

```sh
docker compose --env-file assistant-service/.env -f assistant-service/compose.yaml up -d --build
```

Use HTTPS outside local development. In production, disable demo sessions; bootstrap configuration is optional for account-only deployments. There is no email verification, password reset, refresh-token flow, administrator role or real EKT identity mapping in this local account implementation. Login again when a token expires. Keep tokens out of URLs and logs; frontend browser tokens should stay in memory. Existing Postman guest requests remain available, with a new account/history folder.

Password hashing implementation reference: [Python hashlib.scrypt](https://docs.python.org/3/library/hashlib.html#hashlib.scrypt).
