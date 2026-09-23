"""SQLite persistence and leased work queue for a single-host prototype."""
import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from app.core.errors import DomainError


def uid():
    return uuid4().hex


def dump(data):
    return json.dumps(data, ensure_ascii=False, sort_keys=True)


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


class Store:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.directory = directory
        self.path = directory / 'assistant.sqlite3'
        with self.connect() as con:
            con.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS users (
                    user_id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL, created_at TEXT NOT NULL, password_hash TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS auth_tokens (
                    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id), expires REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS auth_tokens_user ON auth_tokens(user_id);
                CREATE TABLE IF NOT EXISTS user_sessions (
                    session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id));
                CREATE INDEX IF NOT EXISTS user_sessions_user ON user_sessions(user_id);
                CREATE TABLE IF NOT EXISTS auth_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS objects (
                    id TEXT PRIMARY KEY, kind TEXT NOT NULL, session TEXT NOT NULL,
                    data TEXT NOT NULL, created REAL NOT NULL, expires REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS objects_session ON objects(session, kind, created);
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
                    available REAL NOT NULL, lease REAL NOT NULL DEFAULT 0,
                    owner TEXT, attempts INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS dedup (
                    session TEXT, scope TEXT, key TEXT, fingerprint TEXT, object_id TEXT,
                    PRIMARY KEY(session,scope,key));
                CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, data TEXT NOT NULL);
            ''')

    def connect(self):
        con = sqlite3.connect(self.path, timeout=5, factory=ClosingConnection)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys=ON")
        return con

    @contextmanager
    def transaction(self):
        con = self.connect()
        try:
            con.execute('BEGIN IMMEDIATE')
            yield con
            con.commit()
        except BaseException:
            con.rollback()
            raise
        finally:
            con.close()

    def put(self, con, id, kind, session, data, expires):
        con.execute('INSERT INTO objects VALUES(?,?,?,?,?,?)', (id, kind, session, dump(data), time.time(), expires))

    def update(self, con, id, data):
        con.execute('UPDATE objects SET data=? WHERE id=?', (dump(data), id))

    def get(self, id, kind, session=None, con=None):
        if con is None:
            with self.connect() as conn:
                return self.get(id, kind, session, conn)
        row = con.execute('SELECT * FROM objects WHERE id=? AND kind=?', (id, kind)).fetchone()
        if not row or (session is not None and row['session'] != session):
            raise DomainError(404, 'not_found', 'Resource not found in this session')
        if row['expires'] <= time.time():
            raise DomainError(410, 'expired', 'Resource has expired')
        return json.loads(row['data'])

    def list(self, session, kind, limit=100, offset=0):
        with self.connect() as con:
            rows = con.execute('SELECT data FROM objects WHERE session=? AND kind=? AND expires>? ORDER BY created DESC, id DESC LIMIT ? OFFSET ?', (session, kind, time.time(), limit, offset)).fetchall()
        return [json.loads(r['data']) for r in reversed(rows)]

    def enqueue(self, con, id, kind, capacity):
        count = con.execute("SELECT count(*) FROM jobs WHERE status IN ('queued','processing')").fetchone()[0]
        if count >= capacity:
            raise DomainError(429, 'queue_full', 'Service busy; retry later', True)
        con.execute('INSERT INTO jobs(id,kind,status,available) VALUES(?,?,?,?)', (id, kind, 'queued', time.time()))

    def claim(self):
        with self.transaction() as con:
            row = con.execute("SELECT * FROM jobs WHERE (status='queued' AND available<=?) OR (status='processing' AND lease<?) ORDER BY available LIMIT 1", (time.time(), time.time())).fetchone()
            if not row:
                return None
            owner = uid()
            con.execute("UPDATE jobs SET status='processing',lease=?,owner=?,attempts=attempts+1 WHERE id=?", (time.time()+180, owner, row['id']))
            return {**dict(row), 'owner': owner}

    def finish(self, job, data=None, retry=False):
        with self.transaction() as con:
            owned = con.execute("SELECT 1 FROM jobs WHERE id=? AND owner=? AND status='processing'", (job['id'], job['owner'])).fetchone()
            if not owned:
                return
            if data is not None:
                self.update(con, job['id'], data)
            con.execute('UPDATE jobs SET status=?,available=?,lease=0 WHERE id=?', ('queued' if retry else 'done', time.time()+0.3, job['id']))

    def cleanup(self):
        with self.transaction() as con:
            expired = con.execute('SELECT id,data,kind FROM objects WHERE expires<=?', (time.time(),)).fetchall()
            for row in expired:
                if row['kind'] == 'attachment':
                    path = json.loads(row['data']).get('_path')
                    if path:
                        Path(path).unlink(missing_ok=True)
                con.execute('DELETE FROM jobs WHERE id=?', (row['id'],))
                con.execute('DELETE FROM dedup WHERE object_id=?', (row['id'],))
            con.execute('DELETE FROM objects WHERE expires<=?', (time.time(),))
            con.execute("DELETE FROM user_sessions WHERE session_id NOT IN (SELECT id FROM objects WHERE kind='session')")
            con.execute('DELETE FROM auth_tokens WHERE expires<=?', (time.time(),))
            con.execute('DELETE FROM auth_limits WHERE expires<=?', (time.time(),))

        # Clean uploads orphaned by a crash between streaming and metadata commit.
        folder = self.directory / 'uploads'
        if folder.exists():
            for path in folder.iterdir():
                try:
                    if path.is_file() and path.stat().st_mtime < time.time()-86400:
                        path.unlink(missing_ok=True)
                except FileNotFoundError:
                    pass
