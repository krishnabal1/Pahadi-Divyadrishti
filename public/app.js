const alertsElement = document.querySelector('#alerts');
const statusElement = document.querySelector('#status');
const roleFilter = document.querySelector('#role-filter');
const modal = document.querySelector('#modal');
const form = document.querySelector('#report-form');
let alerts = [];

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const insight = (alert, key, fallback = '') => alert.extractedInsights?.[key] || alert.extractedInsights?.[key === 'hazard_type' ? 'hazardType' : key] || fallback;

function renderAlerts() {
  const selectedRole = roleFilter.value;
  const visible = selectedRole === 'all' ? alerts : alerts.filter((alert) => alert.userRole === selectedRole);
  if (!visible.length) {
    alertsElement.innerHTML = '<div class="empty-state"><span>◌</span><h3>No matching alerts</h3><p>There are no verified reports for this community role.</p></div>';
    return;
  }
  alertsElement.innerHTML = visible.map((alert) => {
    const severity = String(insight(alert, 'severity', 'Low')).toLowerCase();
    const place = alert.location?.label || (alert.location?.coordinates ? `${alert.location.coordinates[1].toFixed(4)}, ${alert.location.coordinates[0].toFixed(4)}` : 'Location shared by community');
    return `<article class="alert-card ${escapeHtml(severity)}"><div class="card-top"><span class="severity-badge"><span class="severity-dot"></span>${escapeHtml(severity)}</span><time>${new Date(alert.observedAt || alert.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</time></div><h3>${escapeHtml(insight(alert, 'hazard_type', 'Community observation'))}</h3><p class="summary">${escapeHtml(insight(alert, 'summary', alert.textObservation || 'No summary available.'))}</p><div class="card-meta"><span>⌖ ${escapeHtml(place)}</span><span class="role-tag">${escapeHtml(alert.userRole || 'resident')}</span></div></article>`;
  }).join('');
}

async function loadAlerts() {
  statusElement.textContent = 'Loading verified alerts…';
  try { const response = await fetch('/api/alerts'); if (!response.ok) throw new Error(); alerts = await response.json(); statusElement.textContent = `${alerts.length} verified signal${alerts.length === 1 ? '' : 's'} · Updated just now`; renderAlerts(); }
  catch { statusElement.textContent = 'Unable to load alerts right now.'; alertsElement.innerHTML = '<div class="empty-state"><span>!</span><h3>Connection issue</h3><p>Please try refreshing in a moment.</p></div>'; }
}
function setModal(open) { modal.hidden = !open; document.body.classList.toggle('modal-open', open); if (open) modal.querySelector('select').focus(); }
roleFilter.addEventListener('change', renderAlerts);
document.querySelector('#refresh').addEventListener('click', loadAlerts);
document.querySelector('#open-modal').addEventListener('click', () => setModal(true));
document.querySelector('#close-modal').addEventListener('click', () => setModal(false));
modal.addEventListener('click', (event) => { if (event.target === modal) setModal(false); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.hidden) setModal(false); });
form.addEventListener('submit', async (event) => { event.preventDefault(); const formStatus = document.querySelector('#form-status'); const button = form.querySelector('button[type="submit"]'); const data = new FormData(form); data.append('media_type', 'text'); button.disabled = true; formStatus.textContent = 'Submitting…'; try { const response = await fetch('/api/reports', { method: 'POST', body: data }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Submission failed'); form.reset(); formStatus.textContent = `Report submitted (${result.reportId}). It is pending verification.`; } catch (error) { formStatus.textContent = error.message; } finally { button.disabled = false; } });
loadAlerts();
