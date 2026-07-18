# GCP two-view modeling pipeline

## Services

- Deploy `smart-farm-observation-uploader` to Cloud Run. It hosts the authenticated upload UI, job API, MongoDB access, and DataHub uploader.
- Run `hunyuanAutomation` on a GCE VM with Chrome remote debugging enabled and a persistent disk for its Chrome profile and `data/` directory.
- Put the GLB, annotated GLB, GIF, and measurement JSON in one Cloud Storage bucket.
- Use MongoDB Atlas in a GCP region for observations and `modelingJobs`.

Cloud Run forwards only the two source images to the worker. The worker uploads generated artifacts directly to Cloud Storage so large GLB files never pass through Cloud Run.

## Required configuration

Cloud Run:

```env
HUNYUAN_SERVICE_URL=https://hunyuan-worker.example.internal
HUNYUAN_SERVICE_TOKEN=<shared-worker-token>
INTERNAL_TASK_TOKEN=<shared-callback-token>
DATAHUB_UPLOADER=datahub-node-sdk
TASKS_PROJECT_ID=<gcp-project>
TASKS_LOCATION=<queue-region>
TASKS_QUEUE=<queue-name>
TASK_HANDLER_URL=https://<cloud-run-service>
TASK_SERVICE_ACCOUNT_EMAIL=<cloud-tasks-invoker-service-account>
```

GCE worker:

```env
SERVICE_TOKEN=<shared-worker-token>
OBSERVATION_CALLBACK_URL=https://<cloud-run-service>/api/modeling-jobs
INTERNAL_TASK_TOKEN=<shared-callback-token>
GCS_BUCKET=<artifact-bucket>
GCS_PREFIX=plant-models
ANALYZER_DIR=../節點株高test
```

Store all tokens, MongoDB credentials, DataHub credentials, and Firebase service credentials in Secret Manager. Give the GCE service account `roles/storage.objectCreator` on the artifact bucket.

When all Cloud Tasks settings are present, source photos are temporarily stored in MongoDB GridFS and an idempotently named modeling-dispatch task forwards them to the existing worker. The files are deleted after the dispatch attempt. DataHub publication uses a separate task with an atomic MongoDB claim; failed uploads return non-2xx so Cloud Tasks retries them. Without Tasks settings, both dispatch and DataHub publication remain synchronous for local development.

`TASK_SERVICE_ACCOUNT_EMAIL` is optional. When set, Cloud Tasks adds a Cloud Run OIDC token; the internal routes also require `INTERNAL_TASK_TOKEN`. Grant that service account `roles/run.invoker` on this service and permission for the enqueuing runtime to act as it.

The generated URLs use `https://storage.googleapis.com/<bucket>/<object>`. The bucket or objects must be readable by the DataHub/dashboard audience. If artifacts must remain private, put a stable authenticated media endpoint or CDN in front of the bucket instead of expiring signed URLs.

## DataHub tags

Each successful automated observation sends the observation timestamp plus these tags:

| Tag | Value |
| --- | --- |
| `height` | Calculated plant height |
| `nodes` | Calculated node count |
| `plant` | Plant ID |
| `gif_url` | Cloud Storage HTTPS URL |

Create `gif_url` as a text tag in DataHub before the first production upload.

## Local smoke test

1. Start Chrome and log in using the existing `hunyuanAutomation/WINDOWS_OPERATIONS.md` procedure.
2. Set both projects to the same `INTERNAL_TASK_TOKEN` and set `HUNYUAN_SERVICE_TOKEN` to the worker's `SERVICE_TOKEN`.
3. Start Hunyuan on port `8080` and Next.js on port `3000`.
4. Leave `GCS_BUCKET` empty to keep artifacts locally. Local `file://` results are useful for pipeline debugging but will not pass the callback URL validation, so use a test bucket for an end-to-end callback test.
5. Upload front and right images from the new UI. A real submission consumes Hunyuan quota.

Do not run multiple worker replicas with the same Chrome profile. The service intentionally accepts only one active modeling job at a time.

Modeling task handler failures are recorded as terminal job failures and acknowledged rather than retried, because retrying an uncertain worker dispatch can consume Hunyuan quota twice. DataHub failures are safe to retry and are reclaimed after `DATAHUB_CLAIM_TIMEOUT_MS` (default 10 minutes) if a previous handler stopped mid-upload.
