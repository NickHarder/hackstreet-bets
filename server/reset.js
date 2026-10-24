// Wipes the database file. Run with: npm run reset
import fs from 'node:fs';
import { DB_FILE } from './store.js';
if (fs.existsSync(DB_FILE)) { fs.unlinkSync(DB_FILE); console.log('Deleted', DB_FILE); }
else console.log('Nothing to delete at', DB_FILE);
