const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'] },
    coordinates: {
      type: [Number],
      validate: {
        validator: (value) => !value || (value.length === 2 && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90),
        message: 'coordinates must be [longitude, latitude]'
      }
    },
    label: { type: String, trim: true }
  },
  { _id: false }
);

const communityReportSchema = new mongoose.Schema(
  {
    userRole: { type: String, enum: ['resident', 'driver', 'elder', 'shopkeeper', 'student', 'authority', 'volunteer'], required: true },
    observedAt: { type: Date, default: Date.now },
    mediaType: { type: String, enum: ['photo', 'voice', 'text'], required: true },
    mediaUrl: { type: String, trim: true },
    textObservation: { type: String, trim: true },
    location: { type: locationSchema, required: true, validate: {
      validator: (value) => Boolean(value?.coordinates?.length === 2 || value?.label),
      message: 'location requires coordinates or a landmark label'
    } },
    extractedInsights: {
      summary: String,
      hazardType: String,
      hazard_type: String,
      severity: { type: String, enum: ['Low', 'Medium', 'High', 'Critical', 'low', 'medium', 'high', 'critical', 'unknown'], default: 'unknown' },
      recommendedAction: String,
      recommended_action: String,
      confidence: { type: Number, min: 0, max: 1 }
    },
    verificationStatus: {
      type: String,
      enum: ['pending_verification', 'pending', 'verified', 'rejected'],
      default: 'pending_verification',
      index: true
    },
    confirmationsCount: { type: Number, default: 0 },
    confirmedBy: { type: [String], default: [] },
    verifiedBy: String,
    verifiedAt: Date
  },
  { timestamps: true }
);

communityReportSchema.index({ location: '2dsphere' });
communityReportSchema.index({ verificationStatus: 1, observedAt: -1 });

module.exports = mongoose.model('CommunityReport', communityReportSchema);
