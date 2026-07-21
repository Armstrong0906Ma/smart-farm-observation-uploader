const IMAGE_FIELDS = ['bgimage', 'newbgimage'];
const LOCALES = ['en-US', 'zh-TW'];
const REPRESENTATIVE_PLANT_ID = 'C-1-1';
const PANEL_IDS = { front: 29, right: 33, gif: 11 };

class DashboardError extends Error {
  constructor(message, { retryable = false, status = 500 } = {}) {
    super(message);
    this.name = 'DashboardError';
    this.retryable = retryable;
    this.status = status;
  }
}

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new DashboardError(`${name} must be a positive integer`);
  }
  return value;
}

function settings() {
  const mode = (process.env.DASHBOARD_PUBLISH_MODE || 'disabled').trim().toLowerCase();
  if (!['disabled', 'dry-run', 'live'].includes(mode)) {
    throw new DashboardError('DASHBOARD_PUBLISH_MODE must be disabled, dry-run, or live');
  }
  if (mode === 'disabled') return { mode };

  const baseUrl = process.env.DASHBOARD_BASE_URL;
  const uid = process.env.DASHBOARD_UID;
  const email = process.env.DASHBOARD_LOGIN_EMAIL || process.env.DASHBOARD_LOGIN_USER;
  const user = process.env.DASHBOARD_LOGIN_USER || process.env.DASHBOARD_LOGIN_EMAIL;
  const password = process.env.DASHBOARD_LOGIN_PASSWORD;
  if (!baseUrl || !uid || !email || !user || !password) {
    throw new DashboardError('Dashboard URL, UID, login identity, and password are required');
  }

  let origin;
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'https:') throw new Error('HTTPS is required');
    origin = parsed.origin;
  } catch {
    throw new DashboardError('DASHBOARD_BASE_URL must be a valid HTTPS origin');
  }

  const timeoutMs = positiveInteger('DASHBOARD_REQUEST_TIMEOUT_MS', 30000);
  const leaseMs = positiveInteger('DASHBOARD_LEASE_MS', 5 * 60 * 1000);
  const claimTimeoutMs = positiveInteger('DASHBOARD_CLAIM_TIMEOUT_MS', 10 * 60 * 1000);
  if (leaseMs <= timeoutMs * 4 + 30000 || claimTimeoutMs <= leaseMs) {
    throw new DashboardError('Dashboard lease and claim timeouts are too short for the request timeout');
  }

  return {
    mode,
    origin,
    uid,
    email,
    user,
    password,
    loginType: process.env.DASHBOARD_LOGIN_TYPE || 'standard',
    orgId: process.env.DASHBOARD_ORG_ID || '1',
    redirectTo: process.env.DASHBOARD_REDIRECT_TO || `/d/${uid}`,
    timeoutMs,
    panelIds: PANEL_IDS
  };
}

function retryableStatus(status) {
  return status === 401 || status === 403 || status === 409 || status === 412
    || status === 429 || status >= 500;
}

function remoteError(action, response) {
  const retryable = retryableStatus(response.status);
  return new DashboardError(
    `Dashboard ${action} failed with HTTP ${response.status}`,
    { retryable, status: retryable ? 503 : 502 }
  );
}

function cookieValues(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const value = headers.get('set-cookie');
  return value ? [value] : [];
}

function storeCookies(jar, response) {
  for (const header of cookieValues(response.headers)) {
    const pair = header.split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
}

async function request(session, path, options = {}) {
  const url = new URL(path, session.settings.origin);
  if (url.origin !== session.settings.origin) {
    throw new DashboardError('Dashboard request attempted to leave the configured origin');
  }
  const headers = new Headers(options.headers);
  if (session.cookies.size) {
    headers.set('Cookie', [...session.cookies].map(([name, value]) => `${name}=${value}`).join('; '));
  }
  try {
    const response = await fetch(url, {
      ...options,
      headers,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(session.settings.timeoutMs)
    });
    storeCookies(session.cookies, response);
    return response;
  } catch (error) {
    if (error instanceof DashboardError) throw error;
    throw new DashboardError('Dashboard request failed before receiving a response', {
      retryable: true,
      status: 503
    });
  }
}

function commonHeaders(config) {
  return {
    Accept: 'application/json, text/plain, */*',
    Origin: config.origin,
    Referer: `${config.origin}${config.redirectTo}`,
    RedirectTo: config.redirectTo,
    'X-Grafana-Org-Id': config.orgId,
    'X-Requested-With': 'XMLHTTPRequestByGrafana'
  };
}

async function parseJson(response, action) {
  try {
    return await response.json();
  } catch {
    throw new DashboardError(`Dashboard ${action} returned invalid JSON`, {
      retryable: response.status >= 500,
      status: response.status >= 500 ? 503 : 502
    });
  }
}

async function login(session) {
  const config = session.settings;
  const response = await request(session, '/login', {
    method: 'POST',
    headers: {
      ...commonHeaders(config),
      'Content-Type': 'application/json;charset=UTF-8'
    },
    body: JSON.stringify({
      email: config.email,
      password: config.password,
      type: config.loginType,
      user: config.user
    })
  });
  if (!response.ok) throw remoteError('login', response);
}

async function readDashboard(session) {
  const response = await request(session, `/api/dashboards/uid/${encodeURIComponent(session.settings.uid)}`, {
    headers: commonHeaders(session.settings)
  });
  if (!response.ok) throw remoteError('read', response);
  const body = await parseJson(response, 'read');
  if (!body?.dashboard || !Array.isArray(body.dashboard.panels) || !body.meta) {
    throw new DashboardError('Dashboard read response is missing its model or metadata');
  }
  if (body.dashboard.uid !== session.settings.uid) {
    throw new DashboardError('Dashboard read returned an unexpected UID');
  }
  return body;
}

function setPanelImage(dashboard, panelId, imageUrl) {
  const panel = dashboard.panels.find(candidate => candidate.id === panelId);
  if (!panel) throw new DashboardError(`Dashboard picture panel ${panelId} was not found`);
  if (panel.type !== 'bessler-pictureit-panel') {
    throw new DashboardError(`Dashboard panel ${panelId} has an unexpected type`);
  }
  for (const field of IMAGE_FIELDS) panel[field] = imageUrl;
  for (const locale of LOCALES) {
    if (!panel.i18n?.[locale]) {
      throw new DashboardError(`Dashboard panel ${panelId} is missing locale ${locale}`);
    }
    panel.i18n[locale].bgimage = imageUrl;
  }
}

function verifyPanelImage(dashboard, panelId, imageUrl) {
  const panel = dashboard.panels.find(candidate => candidate.id === panelId);
  return panel?.bgimage === imageUrl
    && panel.newbgimage === imageUrl
    && LOCALES.every(locale => panel.i18n?.[locale]?.bgimage === imageUrl);
}

export function dashboardPublishingEnabled() {
  return (process.env.DASHBOARD_PUBLISH_MODE || 'disabled').trim().toLowerCase() !== 'disabled';
}

export function dashboardRepresentativePlantId() {
  return REPRESENTATIVE_PLANT_ID;
}

export function isDashboardObservationCandidate(observation) {
  return observation?.plantId === dashboardRepresentativePlantId()
    && Boolean(observation.frontImageUrl)
    && Boolean(observation.rightImageUrl)
    && Boolean(observation.analysisGifUrl);
}

export async function publishObservationToDashboard(observation, { beforeSave = null } = {}) {
  const config = settings();
  if (config.mode === 'disabled') {
    throw new DashboardError('Dashboard publishing is disabled');
  }
  if (!isDashboardObservationCandidate(observation)) {
    throw new DashboardError('Observation is not eligible for Dashboard publishing');
  }

  const session = { settings: config, cookies: new Map() };
  await login(session);
  const current = await readDashboard(session);
  const dashboard = current.dashboard;
  setPanelImage(dashboard, config.panelIds.front, observation.frontImageUrl);
  setPanelImage(dashboard, config.panelIds.right, observation.rightImageUrl);
  setPanelImage(dashboard, config.panelIds.gif, observation.analysisGifUrl);

  if (config.mode === 'dry-run') {
    return { status: 'dry_run', version: dashboard.version };
  }

  if (beforeSave) await beforeSave();

  const saveResponse = await request(session, '/api/dashboards/db/', {
    method: 'POST',
    headers: {
      ...commonHeaders(config),
      'Content-Type': 'application/json;charset=UTF-8'
    },
    body: JSON.stringify({
      dashboard,
      folderId: current.meta.folderId,
      overwrite: false,
      message: `Update ${observation.plantId} media`
    })
  });
  if (!saveResponse.ok) throw remoteError('save', saveResponse);
  const saved = await parseJson(saveResponse, 'save');
  if (saved.status !== 'success' || !Number.isInteger(saved.version)) {
    throw new DashboardError('Dashboard save response did not confirm success');
  }

  const readback = await readDashboard(session);
  const verified = saved.version === readback.dashboard.version
    && verifyPanelImage(readback.dashboard, config.panelIds.front, observation.frontImageUrl)
    && verifyPanelImage(readback.dashboard, config.panelIds.right, observation.rightImageUrl)
    && verifyPanelImage(readback.dashboard, config.panelIds.gif, observation.analysisGifUrl);
  if (!verified) {
    throw new DashboardError('Dashboard readback did not match the saved media', {
      retryable: true,
      status: 503
    });
  }
  return { status: 'published', version: saved.version };
}
