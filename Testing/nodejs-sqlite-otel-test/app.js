'use strict';

// Small Express + SQLite app used to test OpenTelemetry ingest into Elastic.
// The app contains NO OpenTelemetry start-up code on purpose: telemetry is switched on
// from the command line (see package.json scripts and README.md), so the same code can be
// run without OTel, with EDOT Node.js, or with the upstream auto-instrumentations.

const path = require('path');
const fs = require('fs');
const express = require('express');
const Database = require('better-sqlite3');
const pino = require('pino');
const { trace, SpanStatusCode } = require('@opentelemetry/api');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'app.db');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });
const tracer = trace.getTracer('nodejs-sqlite-otel-test');

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// No OpenTelemetry instrumentation exists for better-sqlite3, so wrap DB calls in a
// manual span. This makes the database work visible in traces (span.kind=client, db.* attrs).
function dbSpan(operation, statement, fn) {
  return tracer.startActiveSpan(`sqlite ${operation}`, { kind: 3 /* CLIENT */ }, (span) => {
    span.setAttribute('db.system', 'sqlite');
    span.setAttribute('db.operation', operation);
    span.setAttribute('db.statement', statement);
    try {
      return fn();
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/items', (req, res) => {
  const sql = 'SELECT id, name, created_at FROM items ORDER BY id DESC LIMIT 100';
  const rows = dbSpan('SELECT', sql, () => db.prepare(sql).all());
  log.info({ count: rows.length }, 'listed items');
  res.json(rows);
});

app.get('/items/:id', (req, res) => {
  const sql = 'SELECT id, name, created_at FROM items WHERE id = ?';
  const row = dbSpan('SELECT', sql, () => db.prepare(sql).get(req.params.id));
  if (!row) {
    log.warn({ id: req.params.id }, 'item not found');
    return res.status(404).json({ error: 'not found' });
  }
  res.json(row);
});

app.post('/items', (req, res) => {
  const name = req.body && req.body.name;
  if (!name) {
    log.warn('POST /items without name');
    return res.status(400).json({ error: 'name is required' });
  }
  const sql = 'INSERT INTO items (name) VALUES (?)';
  const info = dbSpan('INSERT', sql, () => db.prepare(sql).run(name));
  log.info({ id: info.lastInsertRowid, name }, 'created item');
  res.status(201).json({ id: Number(info.lastInsertRowid), name });
});

app.delete('/items/:id', (req, res) => {
  const sql = 'DELETE FROM items WHERE id = ?';
  const info = dbSpan('DELETE', sql, () => db.prepare(sql).run(req.params.id));
  res.status(info.changes ? 204 : 404).end();
});

// Insert n rows (default 10) to generate some DB spans quickly.
app.post('/seed', (req, res) => {
  const n = Math.min(parseInt(req.query.n || '10', 10), 1000);
  const sql = 'INSERT INTO items (name) VALUES (?)';
  dbSpan('INSERT', `${sql} (x${n})`, () => {
    const stmt = db.prepare(sql);
    const tx = db.transaction(() => {
      for (let i = 0; i < n; i++) stmt.run(`seed-${Date.now()}-${i}`);
    });
    tx();
  });
  log.info({ n }, 'seeded items');
  res.status(201).json({ inserted: n });
});

// Slow request, e.g. GET /slow?ms=1500
app.get('/slow', async (req, res) => {
  const ms = Math.min(parseInt(req.query.ms || '1000', 10), 10000);
  await new Promise((r) => setTimeout(r, ms));
  log.info({ ms }, 'slow request finished');
  res.json({ sleptMs: ms });
});

// Always fails, to produce an error trace/log.
app.get('/error', (req, res, next) => {
  next(new Error('intentional test error'));
});

// Outgoing HTTP call to itself, gives a client span plus a server span (distributed trace).
app.get('/self', async (req, res, next) => {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/items`);
    const body = await r.json();
    res.json({ upstreamStatus: r.status, itemCount: body.length });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  log.error({ err }, 'unhandled error');
  res.status(500).json({ error: err.message });
});

const server = app.listen(PORT, () => {
  log.info({ port: PORT, db: DB_FILE, node: process.version }, 'server listening');
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
