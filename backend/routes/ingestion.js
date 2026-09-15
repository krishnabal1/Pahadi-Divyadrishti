const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const CommunityReport = require('../../database/CommunityReport');
const { analyzeReport } = require('../../ai-engine/insightService');

const router = express.Router();
const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || 'uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });
const upload = multer({
  dest: uploadDirectory,
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/')) return callback(null, true);
    const error = new Error('Only image and audio files are accepted');
    error.status = 400;
    callback(error);
  }
});

function isValidReportId(id) {
  return mongoose.isValidObjectId(id);
}

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
    if (mediaType === 'photo' && file && !file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'photo reports require an image upload' });
    if (mediaType === 'voice' && file && !file.mimetype.startsWith('audio/')) return res.status(400).json({ error: 'voice reports require an audio upload' });
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
      const locationFilters = [{ 'location.label': report.location.label }];
      if (report.location.coordinates?.length === 2) {
        const [longitude, latitude] = report.location.coordinates;
        locationFilters.push({ location: { $geoWithin: { $centerSphere: [[longitude, latitude], 2000 / 6378100] } } });
      }
      const recentReports = await CommunityReport.find({
        _id: { $ne: report._id },
        $or: locationFilters,
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      }).sort({ createdAt: -1 }).limit(20).lean();
      const analysis = await analyzeReport(report.toObject(), recentReports);
      report.extractedInsights = {
        hazard_type: analysis.hazard_type,
        hazardType: analysis.hazard_type,
        severity: analysis.severity,
        summary: analysis.summary,
        recommended_action: analysis.recommended_action,
        recommendedAction: analysis.recommended_action
      };
      await report.save();
    } catch (error) {
      console.error('AI analysis failed:', error.message);
    }
    res.status(201).json({ reportId: report._id, report_id: report._id, report: report.toJSON() });
  } catch (error) { next(error); }
});

async function confirmReport(req, res, next) {
  try {
    const { id } = req.params;
    if (!isValidReportId(id)) return res.status(400).json({ error: 'Invalid report ID' });
    const reportId = new mongoose.Types.ObjectId(id);
    const confirmerId = req.ip;
    const report = await CommunityReport.findOneAndUpdate(
      { _id: reportId, confirmedBy: { $ne: confirmerId } },
      { $addToSet: { confirmedBy: confirmerId }, $inc: { confirmationsCount: 1 } },
      { new: true, runValidators: true }
    );
    if (!report) {
      const existingReport = await CommunityReport.exists({ _id: reportId });
      if (!existingReport) return res.status(404).json({ error: 'Report not found' });
      return res.status(409).json({ success: false, message: 'Already confirmed' });
    }

    if (report.confirmationsCount >= 3) {
      await CommunityReport.updateOne(
        { _id: reportId, confirmationsCount: { $gte: 3 }, verificationStatus: { $ne: 'verified' } },
        { $set: { verificationStatus: 'verified', verifiedAt: new Date() } }
      );
    }

    const updatedReport = await CommunityReport.findById(reportId);
    res.json({
      success: true,
      count: updatedReport.confirmationsCount,
      status: updatedReport.verificationStatus,
      reportId: updatedReport._id,
      report_id: updatedReport._id,
      report: updatedReport.toJSON()
    });
  } catch (error) { next(error); }
}

router.post('/:id/confirm', confirmReport);
router.post('/:id/upvote', confirmReport);

module.exports = router;
