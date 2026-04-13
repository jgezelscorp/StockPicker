import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';

import { getDb, closeDb } from './db';
import { startScheduler, stopScheduler } from './services/scheduler';
import apiRouter from './routes/api';

dotenv.config();

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
