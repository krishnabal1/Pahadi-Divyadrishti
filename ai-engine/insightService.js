const { URL } = require('url');

/**
 * Sends report metadata to the configured model service. If no model URL is
 * configured, a safe neutral result is returned and the report remains pending.
 */
async function extractInsights(input) {
  const modelUrl = process.env.AI_MODEL_URL;
  if (!modelUrl) {
    return { summary: input.textObservation || 'Unprocessed community observation', hazardType: 'unknown', severity: 'unknown', confidence: 0 };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(modelUrl);
  } catch {
    throw new Error('AI_MODEL_URL must be a valid URL');
  }

  const response = await fetch(parsedUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(process.env.AI_MODEL_API_KEY ? { authorization: `Bearer ${process.env.AI_MODEL_API_KEY}` } : {}) },
    body: JSON.stringify({ mediaType: input.mediaType, mediaUrl: input.mediaUrl, textObservation: input.textObservation, location: input.location })
  });
  if (!response.ok) throw new Error(`AI model returned HTTP ${response.status}`);
  return response.json();
}

module.exports = { extractInsights };
