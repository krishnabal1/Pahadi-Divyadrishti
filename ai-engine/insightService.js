const { URL } = require('url');

const SEVERITIES = new Set(['Low', 'Medium', 'High', 'Critical']);
const HAZARD_PATTERNS = [
  { type: 'rockfall', terms: ['rockfall', 'rock fall', 'boulder', 'landslide'] },
  { type: 'water accumulation', terms: ['water accumulation', 'flood', 'flooding', 'waterlogging'] },
  { type: 'road blockage', terms: ['road blockage', 'blocked road', 'road closed', 'debris'] },
  { type: 'unusual spring flow', terms: ['spring flow', 'spring water', 'unusual flow'] }
];

function fallbackAnalysis(input, recentReports = []) {
  const text = String(input.textObservation || '').toLowerCase();
  const match = HAZARD_PATTERNS.find((hazard) => hazard.terms.some((term) => text.includes(term)));
  const corroboration = recentReports.length;
  let severity = match ? 'Medium' : 'Low';
  if (corroboration >= 2) severity = 'High';
  if (corroboration >= 4) severity = 'Critical';

  return {
    hazard_type: match?.type || 'resource change or hazard',
    severity,
    summary: input.textObservation || `A ${input.mediaType || 'media'} report was submitted by a ${input.userRole || 'community'} user.`,
    recommended_action: severity === 'Low' ? 'Continue monitoring and request local verification.' : 'Notify local authorities and keep people away until the area is verified.'
  };
}

function normalizeAnalysis(value, fallback) {
  const analysis = value && typeof value === 'object' ? value : {};
  const severity = String(analysis.severity || fallback.severity);
  return {
    hazard_type: String(analysis.hazard_type || analysis.hazardType || fallback.hazard_type),
    severity: SEVERITIES.has(severity) ? severity : fallback.severity,
    summary: String(analysis.summary || fallback.summary),
    recommended_action: String(analysis.recommended_action || analysis.recommendedAction || fallback.recommended_action)
  };
}

/** Analyze a report and correlate it with recent observations at the same place. */
async function analyzeReport(input, recentReports = []) {
  const fallback = fallbackAnalysis(input, recentReports);
  const modelUrl = process.env.AI_MODEL_URL;
  if (!modelUrl) return fallback;

  let parsedUrl;
  try { parsedUrl = new URL(modelUrl); } catch { throw new Error('AI_MODEL_URL must be a valid URL'); }
  const response = await fetch(parsedUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(process.env.AI_MODEL_API_KEY ? { authorization: `Bearer ${process.env.AI_MODEL_API_KEY}` } : {}) },
    body: JSON.stringify({
      task: 'Extract the hazard or resource change, verify and correlate recent reports, score severity, and return only JSON with hazard_type, severity, summary, recommended_action.',
      report: { text_observation: input.textObservation, user_role: input.userRole, media_type: input.mediaType, media_url: input.mediaUrl, location: input.location },
      recent_reports: recentReports.map((report) => ({ text_observation: report.textObservation, user_role: report.userRole, media_type: report.mediaType, location: report.location, insights: report.extractedInsights }))
    })
  });
  if (!response.ok) throw new Error(`AI model returned HTTP ${response.status}`);
  return normalizeAnalysis(await response.json(), fallback);
}

// Backwards-compatible export for existing callers.
async function extractInsights(input, recentReports) {
  const analysis = await analyzeReport(input, recentReports);
  return { summary: analysis.summary, hazardType: analysis.hazard_type, severity: analysis.severity.toLowerCase(), recommendedAction: analysis.recommended_action };
}

module.exports = { analyzeReport, extractInsights };
