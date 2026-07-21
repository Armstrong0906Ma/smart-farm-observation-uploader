import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isDashboardObservationCandidate,
  publishObservationToDashboard
} from '../src/lib/dashboardPublisher.js';

const URLS = {
  front: 'https://storage.googleapis.com/public/job/source/front.jpg',
  right: 'https://storage.googleapis.com/public/job/source/right.jpg',
  gif: 'https://storage.googleapis.com/public/job/analysis.gif'
};

function picturePanel(id) {
  return {
    id,
    type: 'bessler-pictureit-panel',
    bgimage: 'old',
    newbgimage: 'old',
    i18n: {
      'en-US': { bgimage: 'old' },
      'zh-TW': { bgimage: 'old' }
    }
  };
}

function dashboard(version = 10) {
  return {
    meta: { folderId: 1 },
    dashboard: {
      id: 47,
      uid: 'dashboard-uid',
      version,
      panels: [picturePanel(29), picturePanel(33), picturePanel(11)]
    }
  };
}

function assertPanel(panel, url) {
  assert.equal(panel.bgimage, url);
  assert.equal(panel.newbgimage, url);
  assert.equal(panel.i18n['en-US'].bgimage, url);
  assert.equal(panel.i18n['zh-TW'].bgimage, url);
}

test('publishes C-1-1 media to the fixed Dashboard panels with one session', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = { ...process.env };
  const calls = [];
  let savedDashboard;
  let beforeSaveCalls = 0;
  Object.assign(process.env, {
    DASHBOARD_PUBLISH_MODE: 'live',
    DASHBOARD_BASE_URL: 'https://dashboard.example.com',
    DASHBOARD_UID: 'dashboard-uid',
    DASHBOARD_LOGIN_EMAIL: 'account@example.com',
    DASHBOARD_LOGIN_USER: 'account@example.com',
    DASHBOARD_LOGIN_PASSWORD: 'test-password',
    DASHBOARD_REQUEST_TIMEOUT_MS: '1000',
    DASHBOARD_LEASE_MS: '35000',
    DASHBOARD_CLAIM_TIMEOUT_MS: '40000'
  });

  globalThis.fetch = async (url, options) => {
    const requestUrl = new URL(url);
    calls.push({ path: requestUrl.pathname, options });
    if (requestUrl.pathname === '/login') {
      return new Response('{}', {
        status: 200,
        headers: { 'Set-Cookie': 'dashboard_session=session-value; Path=/; HttpOnly' }
      });
    }
    assert.match(options.headers.get('cookie') || '', /dashboard_session=session-value/);
    if (requestUrl.pathname === '/api/dashboards/db/') {
      savedDashboard = JSON.parse(options.body).dashboard;
      return Response.json({ status: 'success', version: 11 });
    }
    if (savedDashboard) {
      savedDashboard.version = 11;
      return Response.json({ meta: { folderId: 1 }, dashboard: savedDashboard });
    }
    return Response.json(dashboard());
  };

  try {
    const result = await publishObservationToDashboard(
      {
        plantId: 'C-1-1',
        frontImageUrl: URLS.front,
        rightImageUrl: URLS.right,
        analysisGifUrl: URLS.gif
      },
      { beforeSave: async () => { beforeSaveCalls += 1; } }
    );

    assert.deepEqual(result, { status: 'published', version: 11 });
    assert.equal(beforeSaveCalls, 1);
    assert.deepEqual(calls.map(call => call.path), [
      '/login',
      '/api/dashboards/uid/dashboard-uid',
      '/api/dashboards/db/',
      '/api/dashboards/uid/dashboard-uid'
    ]);
    assertPanel(savedDashboard.panels.find(panel => panel.id === 29), URLS.front);
    assertPanel(savedDashboard.panels.find(panel => panel.id === 33), URLS.right);
    assertPanel(savedDashboard.panels.find(panel => panel.id === 11), URLS.gif);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnvironment;
  }
});

test('accepts only complete C-1-1 presentation media', () => {
  assert.equal(isDashboardObservationCandidate({
    plantId: 'C-1-1',
    frontImageUrl: URLS.front,
    rightImageUrl: URLS.right,
    analysisGifUrl: URLS.gif
  }), true);
  assert.equal(isDashboardObservationCandidate({
    plantId: 'C-1-2',
    frontImageUrl: URLS.front,
    rightImageUrl: URLS.right,
    analysisGifUrl: URLS.gif
  }), false);
  assert.equal(isDashboardObservationCandidate({
    plantId: 'C-1-1',
    frontImageUrl: URLS.front,
    rightImageUrl: URLS.right
  }), false);
});
