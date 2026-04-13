import express from 'express';
import cors from 'cors';
import path from 'path';
import 'dotenv/config';

import { getDb, closeDb } from './db';
import { startScheduler, stopScheduler, seedInitialUniverse } from './services/scheduler';
import apiRouter from './routes/api';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// ─── Middleware ──────────────────────────────────────────────────
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

// ─── Health check ───────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── API routes (services-backed) ───────────────────────────────
app.use('/api', apiRouter);

// ─── Static files (production) ──────────────────────────────────
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ─── Start ──────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`[APEX] Server running on http://localhost:${PORT}`);

  // Initialise DB (creates tables if needed)
  getDb();

  // Seed the stock universe on first startup
  seedInitialUniverse();

  // Log which APIs are available
  console.log('[APEX] API status:');
  console.log('  Yahoo Finance: ✅ (no key needed)');
  console.log('  Google Trends:  ✅ (no key needed)');
  console.log(`  Finnhub News:   ${process.env.FINNHUB_API_KEY ? '✅ configured' : '⚠️  FINNHUB_API_KEY not set — news data unavailable'}`);

  // Start the autonomous scheduler
  startScheduler();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[APEX] Shutting down...');
  stopScheduler();
  closeDb();
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  stopScheduler();
  closeDb();
  server.close(() => process.exit(0));
});

export default app;
