import { dashboardPublishingEnabled, publishObservationToDashboard } from '@/lib/dashboardPublisher';
import {
  acquireDashboardPublicationLease,
  claimObservationDashboardPublication,
  finishObservationDashboardPublication,
  getLatestDashboardObservation,
  getObservation,
  releaseDashboardPublicationLease,
  renewDashboardPublicationLease
} from '@/lib/repositories';

function safeErrorMessage(error) {
  return error?.message || 'Dashboard publication failed';
}

export async function publishObservationDashboardAndRecord(observation, { throwOnFailure = false } = {}) {
  const claimed = await claimObservationDashboardPublication(observation.id);
  if (!claimed) return getObservation(observation.id);
  const { observation: current, claimId } = claimed;

  if (!dashboardPublishingEnabled()) {
    return finishObservationDashboardPublication(current.id, claimId, {
      dashboardStatus: 'disabled',
      dashboardLastError: null
    });
  }

  const leased = await acquireDashboardPublicationLease(claimId);
  if (!leased) {
    const updated = await finishObservationDashboardPublication(current.id, claimId, {
      dashboardStatus: 'failed',
      dashboardLastError: 'Another Dashboard publication is in progress'
    });
    if (throwOnFailure) {
      const error = new Error('Another Dashboard publication is in progress');
      error.retryable = true;
      error.status = 503;
      throw error;
    }
    return updated;
  }

  try {
    const latest = await getLatestDashboardObservation(current.plantId);
    if (!latest || latest.id !== current.id) {
      return finishObservationDashboardPublication(current.id, claimId, {
        dashboardStatus: 'skipped',
        dashboardLastError: null
      });
    }
    const result = await publishObservationToDashboard(current, {
      beforeSave: async () => {
        const [renewed, newest] = await Promise.all([
          renewDashboardPublicationLease(claimId),
          getLatestDashboardObservation(current.plantId)
        ]);
        if (!renewed || newest?.id !== current.id) {
          const error = new Error('Dashboard publication lost its lease or is no longer current');
          error.retryable = true;
          error.status = 503;
          throw error;
        }
      }
    });
    return finishObservationDashboardPublication(current.id, claimId, {
      dashboardStatus: result.status,
      dashboardVersion: result.version,
      dashboardLastError: null,
      ...(result.status === 'published'
        ? { dashboardPublishedAt: new Date().toISOString() }
        : { dashboardCheckedAt: new Date().toISOString() })
    });
  } catch (error) {
    const updated = await finishObservationDashboardPublication(current.id, claimId, {
      dashboardStatus: 'failed',
      dashboardLastError: safeErrorMessage(error)
    });
    if (throwOnFailure && error.retryable !== false) {
      error.status = 503;
      throw error;
    }
    return updated;
  } finally {
    await releaseDashboardPublicationLease(claimId);
  }
}
