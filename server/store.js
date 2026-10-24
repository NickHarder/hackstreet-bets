// Dead-simple JSON persistence. The whole database lives in memory and is
// flushed to data/db.json (atomically) shortly after every change.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
export const DB_FILE = path.join(DATA_DIR, 'db.json');

export function defaultSettings() {
  return {
    eventName: 'Hackathon 2026',
    tagline: 'Fake money. Real bragging rights.',
    prizeText: 'First place on the leaderboard when the hackathon ends wins eternal bragging rights (and a prize the organizers will announce).',
    startingBalance: 1000,
    currency: '$',
  };
}

export function emptyDb() {
  return {
    version: 1,
    seeded: false,
    settings: defaultSettings(),
    users: {},      // id -> user
    sessions: {},   // sid -> userId
    markets: {},    // id -> market
    positions: {},  // "userId:marketId" -> position
    trades: [],     // chronological
    events: [],     // chronological (new market, resolved, joined, credit...)
    suggestions: [],
  };
}

export function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) return emptyDb();
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const db = { ...emptyDb(), ...raw };
    db.settings = { ...defaultSettings(), ...(raw.settings || {}) };
    return db;
  } catch (err) {
    const backup = DB_FILE + '.corrupt-' + Date.now();
    fs.copyFileSync(DB_FILE, backup);
    console.error(`Could not parse ${DB_FILE}; moved it to ${backup} and starting fresh.`, err.message);
    return emptyDb();
  }
}

let timer = null;
let pending = null;

export function persist(db) {
  pending = db;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    persistNow(pending);
  }, 400);
}

export function persistNow(db) {
  if (!db) return;
  if (timer) { clearTimeout(timer); timer = null; }
  pending = null;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

export function flushOnExit(getDb) {
  const flush = () => { try { persistNow(getDb()); } catch (e) { console.error(e); } };
  process.on('SIGINT', () => { flush(); process.exit(0); });
  process.on('SIGTERM', () => { flush(); process.exit(0); });
  process.on('beforeExit', flush);
}
