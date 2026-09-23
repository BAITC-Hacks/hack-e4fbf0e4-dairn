"""Local accounts with salted scrypt passwords and revocable opaque tokens."""
import hashlib
import hmac
import secrets
import sqlite3
import time
import threading

_PASSWORD_WORKERS = threading.BoundedSemaphore(2)

from app.core.errors import DomainError
from app.domain.cart.service import digest, iso
from app.storage.store import uid


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    with _PASSWORD_WORKERS:
        hashed = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**17,
                                r=8, p=1, maxmem=256*1024*1024, dklen=32).hex()
    return f'scrypt${salt}${hashed}'


def verify_password(password, encoded):
    _, salt, _ = encoded.split('$')
    return hmac.compare_digest(password_hash(password, salt), encoded)


class AuthService:
    def __init__(self, settings, store):
        self.settings, self.store = settings, store

    def throttle(self, address, username):
        # Persisted counters apply across API processes. Never trust forwarded IP headers.
        now = time.time()
        blocked = False
        with self.store.transaction() as con:
            con.execute('DELETE FROM auth_limits WHERE expires<=?', (now,))
            for key, limit in [('ip:'+address, 100), ('name:'+username, 20)]:
                key = digest(key)
                con.execute('INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1', (key, now+900))
                count = con.execute('SELECT attempts FROM auth_limits WHERE key=?', (key,)).fetchone()[0]
                blocked |= count > limit
        if blocked:
            raise DomainError(429, 'auth_rate_limited', 'Too many authentication attempts; retry after 15 minutes')

    @staticmethod
    def public_user(row):
        return {key: row[key] for key in ('user_id', 'username', 'display_name', 'created_at')}

    def issue(self, con, user_id):
        token = 'usr_'+secrets.token_urlsafe(32)
        expires = time.time()+self.settings.auth_token_ttl_seconds
        con.execute('DELETE FROM auth_tokens WHERE expires<=?', (time.time(),))
        con.execute('INSERT INTO auth_tokens VALUES(?,?,?)', (digest(token), user_id, expires))
        return {'access_token': token, 'token_type': 'bearer', 'expires_at': iso(expires)}

    def register(self, body):
        user = dict(user_id=uid(), username=body.username, display_name=body.display_name, created_at=iso(time.time()))
        encoded = password_hash(body.password.get_secret_value())
        try:
            with self.store.transaction() as con:
                con.execute('INSERT INTO users VALUES(?,?,?,?,?)', (*user.values(), encoded))
                token = self.issue(con, user['user_id'])
        except sqlite3.IntegrityError as exc:
            raise DomainError(409, 'username_taken', 'Username is already registered') from exc
        return {**token, 'user': user}

    def login(self, body):
        with self.store.connect() as con:
            row = con.execute('SELECT * FROM users WHERE username=?', (body.username,)).fetchone()
        # Run the same costly operation for unknown accounts to avoid a fast timing oracle.
        encoded = row['password_hash'] if row else 'scrypt$'+('00'*16)+'$'+('00'*32)
        valid = verify_password(body.password.get_secret_value(), encoded)
        if not row or not valid:
            raise DomainError(401, 'invalid_credentials', 'Invalid username or password')
        with self.store.transaction() as con:
            token = self.issue(con, row['user_id'])
        return {**token, 'user': self.public_user(row)}

    def authenticate(self, token):
        with self.store.connect() as con:
            row = con.execute('SELECT u.* FROM users u JOIN auth_tokens t ON u.user_id=t.user_id WHERE t.token_hash=? AND t.expires>?', (digest(token), time.time())).fetchone()
        if not row:
            raise DomainError(401, 'unauthorized', 'Account token is invalid or expired')
        return self.public_user(row)

    def logout(self, token):
        with self.store.transaction() as con:
            con.execute('DELETE FROM auth_tokens WHERE token_hash=?', (digest(token),))
