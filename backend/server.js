require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const CommunityReport = require('../database/CommunityReport');
const ingestionRoutes = require('./routes/ingestion');

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(path.resolve(process.env.UPLOAD_DIR || 'uploads')));
app.use('/api/reports', ingestionRoutes);
app.use(express.static(path.resolve('public')));

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'pahadi-nazar' }));
app.get('/api/alerts', async (req, res, next) => {
  try {
    const alerts = await CommunityReport.find({ verificationStatus: 'verified' }).sort({ observedAt: -1 }).limit(100).lean();
    res.json(alerts);
  } catch (error) { next(error); }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || 'Internal server error' });
});

async function start() {
  if (process.env.MONGODB_URI) await mongoose.connect(process.env.MONGODB_URI);
  return app.listen(port, () => console.log(`Pahadi Nazar listening on port ${port}`));
}

if (require.main === module) start().catch((error) => { console.error('Startup failed:', error); process.exit(1); });

module.exports = { app, start };
