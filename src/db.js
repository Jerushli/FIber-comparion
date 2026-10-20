import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "../data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "scrape-logs.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS scrape_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  scraped_at TEXT,
  duration_ms INTEGER,
  http_status INTEGER,
  status TEXT NOT NULL,
  page_title TEXT,
  markdown_chars INTEGER,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_request_id ON scrape_runs(request_id);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_requested_at ON scrape_runs(requested_at);
`);

const insertRun = db.prepare(`
INSERT INTO scrape_runs (
 request_id, provider_id, provider_name, source_url, requested_at, scraped_at,
 duration_ms, http_status, status, page_title, markdown_chars, error_message
) VALUES (
 @request_id, @provider_id, @provider_name, @source_url, @requested_at, @scraped_at,
 @duration_ms, @http_status, @status, @page_title, @markdown_chars, @error_message
)`);

export function logScrapeRun(r) {
  insertRun.run({
    request_id: r.request_id, provider_id: r.provider_id, provider_name: r.provider_name,
    source_url: r.source_url, requested_at: r.requested_at, scraped_at: r.scraped_at ?? null,
    duration_ms: r.duration_ms ?? null, http_status: r.http_status ?? null, status: r.status,
    page_title: r.page_title ?? null, markdown_chars: r.markdown_chars ?? null,
    error_message: r.error_message ?? null
  });
}

export function getRecentLogs(limit = 50) {
  return db.prepare(`SELECT id, request_id, provider_id, provider_name, source_url,
    requested_at, scraped_at, duration_ms, http_status, status, page_title,
    markdown_chars, error_message FROM scrape_runs ORDER BY id DESC LIMIT ?`).all(limit);
}
