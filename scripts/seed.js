require('dotenv').config();
const mongoose = require('mongoose');
const CommunityReport = require('../database/CommunityReport');

const reports = [
  {
    userRole: 'driver', mediaType: 'photo', textObservation: 'Fresh rockfall and loose boulders are blocking one lane after the morning rain.',
    location: { type: 'Point', coordinates: [78.0322, 30.3165], label: 'Old bridge road, Dehradun' },
    extractedInsights: { hazard_type: 'rockfall', hazardType: 'rockfall', severity: 'Critical', summary: 'Fresh rockfall is blocking a lane near the old bridge road.', recommended_action: 'Avoid the route and notify road authorities immediately.', recommendedAction: 'Avoid the route and notify road authorities immediately.' }
  },
  {
    userRole: 'elder', mediaType: 'text', textObservation: 'The village spring is flowing much faster and the water is cloudy today.',
    location: { type: 'Point', coordinates: [78.0428, 30.3251], label: 'Upper village spring' },
    extractedInsights: { hazard_type: 'unusual spring flow', hazardType: 'unusual spring flow', severity: 'Medium', summary: 'An elder reports unusual spring flow and cloudy water.', recommended_action: 'Ask residents to avoid drinking the water until it is checked.', recommendedAction: 'Ask residents to avoid drinking the water until it is checked.' }
  },
  {
    userRole: 'student', mediaType: 'text', textObservation: 'Water is collecting beside the school entrance after heavy rain.',
    location: { type: 'Point', coordinates: [78.0381, 30.3217], label: 'Community school entrance' },
    extractedInsights: { hazard_type: 'water accumulation', hazardType: 'water accumulation', severity: 'Low', summary: 'Minor water accumulation reported near the school entrance.', recommended_action: 'Monitor drainage and keep the walkway clear.', recommendedAction: 'Monitor drainage and keep the walkway clear.' }
  }
];

async function seed() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, maxPoolSize: 5, retryWrites: true });
  await CommunityReport.deleteMany({ 'textObservation': { $regex: '^\[DEMO\]' } });
  const demoReports = reports.map((report) => ({ ...report, textObservation: `[DEMO] ${report.textObservation}`, verificationStatus: 'verified' }));
  const inserted = await CommunityReport.insertMany(demoReports);
  console.log(`Seeded ${inserted.length} demo reports.`);
}

seed().catch((error) => { console.error('Seed failed:', error.message); process.exitCode = 1; }).finally(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); });
