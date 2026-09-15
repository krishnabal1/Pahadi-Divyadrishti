const alertsElement = document.querySelector('#alerts');
const statusElement = document.querySelector('#status');
const roleFilter = document.querySelector('#role-filter');
const alertSearch = document.querySelector('#alert-search');
const modal = document.querySelector('#modal');
const form = document.querySelector('#report-form');
const urgentBanner = document.querySelector('#urgent-banner');
let observations = [];
let alerts = observations;
let lastRetrievedAt = null;
let alertsRequestInFlight = false;
let observationMap = null;
let mapMarkers = null;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const insight = (alert, key, fallback = '') => alert.extractedInsights?.[key] || alert.extractedInsights?.[key === 'hazard_type' ? 'hazardType' : key] || fallback;
const getAlertId = (alert) => {
  const id = alert?._id || alert?.id || alert?.reportId;
  return id && typeof id === 'object' && id.$oid ? id.$oid : id;
};
const confirmedIdsStorageKey = 'pahadi_confirmed_ids';
const getConfirmedIds = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(confirmedIdsStorageKey) || '[]');
    return new Set(Array.isArray(stored) ? stored.map(String) : []);
  } catch (error) {
    console.error('Unable to read confirmation history:', error);
    return new Set();
  }
};
const saveConfirmedId = (reportId) => {
  try {
    const confirmedIds = getConfirmedIds();
    confirmedIds.add(String(reportId));
    localStorage.setItem(confirmedIdsStorageKey, JSON.stringify([...confirmedIds]));
  } catch (error) {
    console.error('Unable to persist confirmation history:', error);
  }
};
const dismissedUrgentStorageKey = 'pahadi_dismissed_urgent_ids';
const getDismissedUrgentIds = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(dismissedUrgentStorageKey) || '[]');
    return new Set(Array.isArray(stored) ? stored.map(String) : []);
  } catch (error) {
    console.error('Unable to read dismissed urgent alerts:', error);
    return new Set();
  }
};
const saveDismissedUrgentId = (alertId) => {
  try {
    const dismissedIds = getDismissedUrgentIds();
    dismissedIds.add(String(alertId));
    localStorage.setItem(dismissedUrgentStorageKey, JSON.stringify([...dismissedIds]));
  } catch (error) {
    console.error('Unable to persist dismissed urgent alert:', error);
  }
};
const alertSeverity = (alert) => String(alert.severity || insight(alert, 'severity', 'Low')).toLowerCase();

function renderUrgentBanner() {
  const urgentAlert = alerts.find((alert) => {
    const id = getAlertId(alert);
    return id && ['high', 'critical'].includes(alertSeverity(alert))
      && alert.verificationStatus === 'verified'
      && !getDismissedUrgentIds().has(String(id));
  });
  if (!urgentAlert) {
    urgentBanner.hidden = true;
    urgentBanner.innerHTML = '';
    return;
  }
  const alertId = getAlertId(urgentAlert);
  const title = urgentAlert.title || insight(urgentAlert, 'hazard_type', 'Urgent community alert');
  urgentBanner.innerHTML = `<strong>Urgent ${alertSeverity(urgentAlert).toUpperCase()} alert:</strong> ${escapeHtml(title)} <button class="urgent-link" data-alert-id="${escapeHtml(alertId)}">View alert</button><button class="urgent-dismiss" aria-label="Dismiss urgent alert">×</button>`;
  urgentBanner.hidden = false;
  urgentBanner.querySelector('.urgent-link').addEventListener('click', () => {
    roleFilter.value = 'all';
    alertSearch.value = '';
    renderAlerts();
    highlightAlert(alertId);
  });
  urgentBanner.querySelector('.urgent-dismiss').addEventListener('click', () => {
    saveDismissedUrgentId(alertId);
    renderUrgentBanner();
  });
}

function getCoordinates(alert) {
  if (alert.lat !== undefined && alert.lng !== undefined) {
    const latitude = Number(alert.lat);
    const longitude = Number(alert.lng);
    return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
      ? [latitude, longitude]
      : null;
  }
  const coordinates = alert.location?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return null;
  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
    ? [latitude, longitude]
    : null;
}

function highlightAlert(alertId) {
  if (!alertId) return;
  const card = document.getElementById(`alert-${String(alertId)}`);
  if (!card) return;
  document.querySelectorAll('.alert-card.is-highlighted').forEach((item) => item.classList.remove('is-highlighted'));
  card.classList.add('is-highlighted');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => card.classList.remove('is-highlighted'), 2200);
}

function updateObservationMap(visibleAlerts) {
  if (!observationMap || !mapMarkers) return;
  mapMarkers.clearLayers();
  const markers = [];
  visibleAlerts.forEach((alert) => {
    if (alert.lat === undefined && alert.lng === undefined && !alert.location?.coordinates) return;
    const coordinates = getCoordinates(alert);
    if (!coordinates) return;
    const alertId = getAlertId(alert);
    const title = alert.title || insight(alert, 'hazard_type', 'Community observation');
    const severity = alertSeverity(alert);
    const place = alert.location?.label || 'Location shared by community';
    const marker = L.marker(coordinates).bindPopup(`<strong>${escapeHtml(title)}</strong><br><span>${escapeHtml(severity.toUpperCase())} · ${escapeHtml(place)}</span>`);
    if (alertId) marker.on('click', () => highlightAlert(alertId));
    marker.addTo(mapMarkers);
    markers.push(marker);
  });
  if (markers.length === 1) {
    observationMap.setView(markers[0].getLatLng(), 13);
  } else if (markers.length > 1) {
    observationMap.fitBounds(L.featureGroup(markers).getBounds().pad(0.15));
  }
  window.setTimeout(() => observationMap.invalidateSize(), 0);
}

function initMap() {
  try {
    if (!window.L) throw new Error('Leaflet is not available');
    const mapElement = document.getElementById('map');
    if (!mapElement) throw new Error('Map container #map was not found');
    observationMap = L.map('map').setView([30.3165, 78.0322], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(observationMap);
    mapMarkers = L.layerGroup().addTo(observationMap);
    window.setTimeout(() => observationMap.invalidateSize(), 0);
  } catch (error) {
    console.error('Map initialization failed:', error);
  }
}

function renderAlerts() {
  renderUrgentBanner();
  const selectedRole = roleFilter.value;
  const searchTerm = alertSearch.value.trim().toLowerCase();
  const visible = alerts.filter((alert) => {
    const matchesRole = selectedRole === 'all' || (alert.role || alert.userRole) === selectedRole;
    if (!matchesRole) return false;
    if (!searchTerm) return true;

    const searchableText = [
      alert.title,
      alert.location?.label,
      typeof alert.location === 'string' ? alert.location : '',
      alert.description,
      alert.textObservation,
      insight(alert, 'hazard_type'),
      insight(alert, 'summary')
    ].filter(Boolean).join(' ').toLowerCase();
    return searchableText.includes(searchTerm);
  });
  if (!alerts.length) {
    updateObservationMap([]);
    alertsElement.innerHTML = '<div class="empty-state"><span>◌</span><h3>No alerts yet</h3><p>Verified reports and new community observations will appear here.</p></div>';
    return;
  }
  if (!visible.length) {
    updateObservationMap([]);
    alertsElement.innerHTML = '<div class="empty-state"><span>◌</span><h3>No matching alerts</h3><p>There are no reports for this community role.</p></div>';
    return;
  }
  alertsElement.innerHTML = visible.map((alert) => {
    const alertId = getAlertId(alert);
    const alreadyConfirmed = alertId && getConfirmedIds().has(String(alertId));
    const severity = alertSeverity(alert);
    const place = alert.location?.label || (typeof alert.location === 'string' ? alert.location : null) || (alert.location?.coordinates ? `${alert.location.coordinates[1].toFixed(4)}, ${alert.location.coordinates[0].toFixed(4)}` : 'Location shared by community');
    const title = alert.title || insight(alert, 'hazard_type', 'Community observation');
    const description = alert.description || insight(alert, 'summary', alert.textObservation || 'No summary available.');
    const role = alert.role || alert.userRole || 'resident';
    const timestamp = alert.timestamp || alert.observedAt || alert.createdAt;
    const dateStr = timestamp ? new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
    const confirmations = Number.isFinite(Number(alert.confirmationsCount)) ? Number(alert.confirmationsCount) : 0;
    const isVerified = alert.verificationStatus === 'verified' || confirmations >= 3;
    const imageThumbnail = alert.mediaUrl && alert.mediaType === 'photo'
      ? `<img class="alert-thumbnail" src="${escapeHtml(alert.mediaUrl)}" alt="Image uploaded with this observation" loading="lazy">`
      : '';

    const confirmationButton = alertId
      ? `<button class="primary-button confirm-btn" data-id="${escapeHtml(alertId)}" aria-label="Confirm signal: ${escapeHtml(title)}"${alreadyConfirmed ? ' disabled' : ''}>${alreadyConfirmed ? 'Confirmed ✓' : 'Confirm Signal'}</button>`
      : '<button class="primary-button confirm-btn" disabled title="This alert has no report ID">Confirm Signal</button>';
    const cardId = alertId ? ` id="alert-${escapeHtml(alertId)}"` : '';
    return `<article class="alert-card ${escapeHtml(severity)}"${cardId}><div class="card-top"><span class="severity-badge"><span class="severity-dot"></span>${escapeHtml(severity)} · ${isVerified ? 'VERIFIED' : 'PENDING'}</span><time>${escapeHtml(dateStr)}</time></div>${imageThumbnail}<h3>${escapeHtml(title)}</h3><p class="summary">${escapeHtml(description)}</p><div class="card-meta"><span>⌖ ${escapeHtml(place)}</span><span class="role-tag">${escapeHtml(role)}</span></div><div class="card-actions"><span class="confirmation-count">${confirmations} confirmation${confirmations === 1 ? '' : 's'}</span>${confirmationButton}</div></article>`;
  }).join('');
  alertsElement.querySelectorAll('.confirm-btn:not([disabled])').forEach((button) => {
    button.addEventListener('click', confirmSignal);
  });
  updateObservationMap(visible);
}

function formatElapsedTime(timestamp) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 5) return 'just now';
  if (elapsedSeconds < 60) return `${elapsedSeconds} seconds ago`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'} ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `${elapsedHours} hour${elapsedHours === 1 ? '' : 's'} ago`;
}

function updateStatus() {
  if (!lastRetrievedAt) return;
  statusElement.textContent = `${alerts.length} community signal${alerts.length === 1 ? '' : 's'} · Updated ${formatElapsedTime(lastRetrievedAt)}`;
}

async function loadAlerts({ showLoading = true } = {}) {
  if (alertsRequestInFlight) return;
  alertsRequestInFlight = true;
  if (showLoading) statusElement.textContent = 'Loading verified alerts…';
  try {
    const response = await fetch('/api/alerts');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    observations = data;
    alerts = observations;
    lastRetrievedAt = Date.now();
    updateStatus();
    renderAlerts();
  }
  catch (error) {
    console.error('Failed to load alerts:', error);
    if (!lastRetrievedAt) {
      statusElement.textContent = 'Unable to load alerts right now.';
      alertsElement.innerHTML = '<div class="empty-state"><span>!</span><h3>Connection issue</h3><p>Please try refreshing in a moment.</p></div>';
    }
  } finally {
    alertsRequestInFlight = false;
  }
}

function setModal(open) { modal.hidden = !open; document.body.classList.toggle('modal-open', open); if (open) modal.querySelector('select').focus(); }
roleFilter.addEventListener('change', renderAlerts);
alertSearch.addEventListener('input', renderAlerts);
document.querySelector('#refresh').addEventListener('click', () => loadAlerts());
document.querySelector('#open-modal').addEventListener('click', () => setModal(true));
document.querySelector('#close-modal').addEventListener('click', () => setModal(false));
modal.addEventListener('click', (event) => { if (event.target === modal) setModal(false); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.hidden) setModal(false); });

async function confirmSignal(event) {
  const button = event.currentTarget;
  const reportId = button.dataset.id;
  if (!reportId) {
  console.error('Cannot confirm signal: button is missing data-id', button);
  return;
  }
  button.disabled = true;
  button.textContent = 'Confirming...';
  const url = `/api/reports/${encodeURIComponent(reportId)}/confirm`;
  try {
  const response = await fetch(url, { method: 'POST' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('Confirmation request failed', { url, status: response.status });
    if (response.status === 409 && result.message === 'Already confirmed') {
      saveConfirmedId(reportId);
      alerts = observations;
      renderAlerts();
      return;
    }
    throw new Error(result.error || `Confirmation failed (${response.status})`);
  }
  const updated = result.report;
  if (updated) {
    observations = observations.map((item) => (getAlertId(item) === reportId ? updated : item));
  } else if (typeof result.count === 'number') {
    observations = observations.map((item) => (getAlertId(item) === reportId
      ? { ...item, confirmationsCount: result.count, verificationStatus: result.status }
      : item));
  }
  saveConfirmedId(reportId);
  button.textContent = 'Confirmed ✓';
  button.disabled = true;
  alerts = observations;
  renderAlerts();
  } catch (error) {
  console.error('Confirmation failed:', { url, status: error?.status, error });
  alert('Failed to confirm signal: ' + error.message);
  button.disabled = false;
  button.textContent = 'Confirm Signal';
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formStatus = document.querySelector('#form-status');
  const button = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  const imageFile = form.elements.media_file.files[0];
  data.append('media_type', imageFile ? 'photo' : 'text');
  button.disabled = true;
  formStatus.textContent = 'Submitting…';
  try {
    const response = await fetch('/api/reports', { method: 'POST', body: data });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Submission failed (HTTP ${response.status})`);
    form.reset();
    formStatus.textContent = `Report submitted (${result.reportId || result.report_id || 'success'}). Pending verification — visible below until reviewed.`;
    const newObservation = result.report || result.observation || result;
    if (newObservation) {
      observations = [newObservation, ...observations.filter((item) => (item._id || item.id) !== (newObservation._id || newObservation.id))];
      alerts = observations;
      roleFilter.value = 'all';
      renderAlerts();
    }
    loadAlerts();
  } catch (error) {
    console.error('Report submission failed:', error);
    formStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  loadAlerts();
});
setInterval(() => loadAlerts({ showLoading: false }), 20000);
setInterval(updateStatus, 1000);
