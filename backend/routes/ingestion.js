const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const CommunityReport = require('../../database/CommunityReport');
const { extractInsights } = require('../../ai-engine/insightService');

const router = express.Router();
const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || 'uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });
const upload = multer({
  dest: uploadDirectory,
  limits: { fileSize: 15 * 1024 * 1024, files: 1 }
});

function locationFromBody(body) {
  const landmark = body.landmark || body.locationLabel;
  const hasCoordinates = body.latitude !== undefined || body.longitude !== undefined;
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (hasCoordinates && (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90)) {
    const error = new Error('latitude and longitude must both be valid coordinates');
    error.status = 400;
    throw error;
  }
  if (!hasCoordinates && !landmark) {
    const error = new Error('location requires latitude and longitude or a landmark');
    error.status = 400;
    throw error;
  }
  return hasCoordinates
    ? { type: 'Point', coordinates: [longitude, latitude], label: landmark }
    : { label: landmark };
}

// The public submission contract uses snake_case. Keep the older camelCase
// names as fallbacks so existing clients continue to work.
router.post('/', upload.fields([{ name: 'media_file', maxCount: 1 }, { name: 'media', maxCount: 1 }]), async (req, res, next) => {
  try {
    const file = req.files?.media_file?.[0] || req.files?.media?.[0];
    const mediaType = req.body.media_type || req.body.mediaType || (file?.mimetype.startsWith('audio/') ? 'voice' : file ? 'photo' : 'text');
    const textObservation = req.body.text_observation || req.body.textObservation;
    const userRole = req.body.user_role || req.body.userRole;
    if (!userRole) return res.status(400).json({ error: 'user_role is required' });
    if (!['photo', 'voice', 'text'].includes(mediaType)) return res.status(400).json({ error: 'media_type must be photo, voice, or text' });
    if (mediaType === 'text' && !textObservation) return res.status(400).json({ error: 'text_observation is required for text reports' });

    const report = await CommunityReport.create({
      userRole,
      mediaType,
      mediaUrl: file ? `/uploads/${file.filename}` : req.body.media_url || req.body.mediaUrl,
      textObservation,
      location: locationFromBody(req.body),
      verificationStatus: 'pending_verification'
    });
    try {
      report.extractedInsights = await extractInsights(report.toObject());
      await report.save();
    } catch (error) {
      console.error('Insight extraction failed:', error.message);
    }
    res.status(201).json({ reportId: report._id, report_id: report._id });
  } catch (error) { next(error); }
});

module.exports = router;
