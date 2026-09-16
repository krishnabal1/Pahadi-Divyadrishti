require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const CommunityReport = require('../database/CommunityReport');
const ingestionRoutes = require('./routes/ingestion');

const app = express();
const port = Number(process.env.PORT) || 8080;
const allowedOrigin = process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? null : '*');
let databaseConnectionPromise;

function connectDatabase() {
  if (!process.env.MONGODB_URI) {
    const error = new Error('MONGODB_URI is required; refusing to start without a database connection');
    error.status = 503;
    return Promise.reject(error);
  }
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (!databaseConnectionPromise) {
    databaseConnectionPromise = mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
      retryWrites: true
    }).then(() => undefined).catch((error) => {
      databaseConnectionPromise = undefined;
      throw error;
    });
  }
  return databaseConnectionPromise;
}

app.disable('x-powered-by');
app.use(cors({ origin: allowedOrigin || false }));
app.use(express.json({ limit: '2mb' }));
app.use('/api', async (req, res, next) => {
  try {
    await connectDatabase();
    next();
  } catch (error) {
    next(error);
  }
});
app.use('/api/reports', ingestionRoutes);
app.use('/api/alerts', ingestionRoutes);
app.use(express.static(path.resolve('public')));

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'pahadi-nazar' }));
app.get('/api/alerts', async (req, res, next) => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const alerts = await CommunityReport.find({
      $or: [
        { verificationStatus: 'verified' },
        { verificationStatus: { $in: ['pending_verification', 'pending'] }, createdAt: { $gte: cutoff } }
      ]
    }).sort({ createdAt: -1 }).limit(100).lean();
    res.json(alerts);
  } catch (error) { next(error); }
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  if (error.name === 'ValidationError') return res.status(400).json({ error: 'Validation failed', details: Object.values(error.errors).map((item) => item.message) });
  if (error.name === 'MulterError') return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Uploaded file exceeds the 15MB limit' : error.message });
  if (error.code === 11000) return res.status(409).json({ error: 'Duplicate report' });
  res.status(error.status || 500).json({ error: error.status ? error.message : 'Internal server error' });
});

async function start() {
  await connectDatabase();
  mongoose.connection.on('error', (error) => console.error('MongoDB connection error:', error.message));
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`Pahadi Nazar listening on port ${port}`);
      resolve(server);
    });
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Set PORT to another value or stop the existing server.`));
      } else {
        reject(error);
      }
    });
  });
}

if (require.main === module && process.env.NODE_ENV !== 'production') {
  start().catch((error) => { console.error('Startup failed:', error); process.exit(1); });
}

module.exports = app;
