# GCP two-view modeling pipeline

## Services

- Deploy `smart-farm-observation-uploader` to Cloud Run. It hosts the authenticated upload UI, job API, MongoDB access, and DataHub uploader.
- Run `hunyuanAutomation` on a GCE VM with Chrome remote debugging enabled and a persistent disk for its Chrome profile and `data/` directory.
- Put original GLBs and measurement JSON/CSV in a private Cloud Storage bucket. Put submitted front/right photos, the two audience GIFs, and full annotated GLB in a separate public presentation bucket.
- Use MongoDB Atlas in a GCP region for observations and `modelingJobs`.

Cloud Run forwards only the two source images to the worker. The worker uploads generated artifacts directly to Cloud Storage so large GLB files never pass through Cloud Run.

## Required configuration

Cloud Run:

```env
HUNYUAN_SERVICE_URL=https://hunyuan-worker.example.internal
HUNYUAN_SERVICE_TOKEN=<shared-worker-token>
HUNYUAN_GCE_PROJECT=<gcp-project>
HUNYUAN_GCE_ZONE=<worker-zone>
HUNYUAN_GCE_INSTANCE=<worker-instance-name>
INTERNAL_TASK_TOKEN=<shared-callback-token>
DATAHUB_UPLOADER=datahub-node-sdk
TASKS_PROJECT_ID=<gcp-project>
TASKS_LOCATION=<queue-region>
TASKS_MODELING_QUEUE=<modeling-queue>
TASKS_DATAHUB_QUEUE=<datahub-queue>
TASKS_DASHBOARD_QUEUE=<dashboard-queue>
TASK_HANDLER_URL=https://<cloud-run-service>
TASK_SERVICE_ACCOUNT_EMAIL=<cloud-tasks-invoker-service-account>
DASHBOARD_PUBLISH_MODE=live
DASHBOARD_BASE_URL=https://<advantech-dashboard-host>
DASHBOARD_UID=<dashboard-uid>
DASHBOARD_LOGIN_EMAIL=<dashboard-login>
DASHBOARD_LOGIN_USER=<dashboard-login>
DASHBOARD_LOGIN_PASSWORD=<dashboard-password>
DASHBOARD_LOGIN_TYPE=standard
DASHBOARD_ORG_ID=1
AUTO_CAPTURE_ENABLED=false
AUTO_CAPTURE_SOURCE_URL=https://melodious-entremet-cdd8de.netlify.app/images.json
AUTO_CAPTURE_PLANT_ID=A-1-1
AUTO_CAPTURE_TIMEZONE=Asia/Taipei
```

GCE worker:

```env
SERVICE_TOKEN=<shared-worker-token>
OBSERVATION_CALLBACK_URL=https://<cloud-run-service>/api/modeling-jobs
INTERNAL_TASK_TOKEN=<shared-callback-token>
GCS_BUCKET=<artifact-bucket>
GCS_GIF_BUCKET=<public-presentation-bucket>
GCS_PREFIX=plant-models
ANALYZER_DIR=../節點株高test
GLTFPACK_PATH=C:\SmartFarm\tools\gltfpack.exe
ANALYSIS_RENDER_TARGET_FACES=100000
ANALYSIS_GIF_FRAMES=12
ANALYSIS_GIF_SIZE=384
ROBOT_CAMERA_MODEL_TO_CM_SCALE=174.1084
AUTO_SUSPEND_ENABLED=true
AUTO_SUSPEND_IDLE_SECONDS=1800
```

Store all tokens, Dashboard credentials, MongoDB credentials, DataHub credentials, and Firebase service credentials in Secret Manager. Give the GCE service account the minimum object permissions on both buckets plus `compute.instances.suspend` on its own VM. Grant the Cloud Run runtime service account `compute.instances.get` and `compute.instances.resume` on the worker VM. The presentation bucket must grant its intended audience read access because the source photos, `annotatedGlbUrl`, and both GIF URLs are permanent GCS URLs.

When all Cloud Tasks settings are present, source photos are temporarily stored in MongoDB GridFS and an idempotently named modeling-dispatch task forwards them to the existing worker. If the worker VM is suspended, the handler resumes it and waits for Chrome and the analyzer to be ready before loading and forwarding the images. Before returning `202`, the worker verifies and uploads both photos and persists their URLs with the SQLite job. A source-photo GCS failure returns non-2xx, so Cloud Tasks retains GridFS and safely retries the same deterministic object names. GridFS files are deleted only after accepted dispatch or terminal rejection. DataHub and Dashboard publication use independent tasks and MongoDB claims. Configure the Dashboard queue with `maxConcurrentDispatches=1`; a global MongoDB lease also serializes its full-document saves. Without Tasks settings, downstream publication remains synchronous for local development.

`TASK_SERVICE_ACCOUNT_EMAIL` is optional. When set, Cloud Tasks adds a Cloud Run OIDC token; the internal routes also require `INTERNAL_TASK_TOKEN`. Grant that service account `roles/run.invoker` on this service and permission for the enqueuing runtime to act as it.

The generated URLs use `https://storage.googleapis.com/<bucket>/<object>`. `frontImageUrl`, `rightImageUrl`, `annotatedGlbUrl`, `gifUrl`, and `analysisGifUrl` are audience-readable. Original GLB and measurement URLs remain in the private bucket. The Dashboard displays source-photo thumbnails that open the public originals. If private artifacts need browser access later, put a stable authenticated media endpoint or CDN in front of the bucket instead of storing expiring signed URLs.

Height and node calculations always use the full Hunyuan GLB. The full annotated GLB is also preserved. Only the temporary model used for `analysisGifUrl` is simplified to about 100k faces with texture-preserving gltfpack, then rendered as 12 transparent 384x384 frames and deleted. This keeps Dashboard media generation off the million-face 36-frame software-render path without changing measurement calibration.

## Advantech Dashboard media

Only a successful `C-1-1` observation with all three presentation URLs is eligible. The publisher logs in with an in-memory session, reads the latest Dashboard version, updates panel 29 from `frontImageUrl`, panel 33 from `rightImageUrl`, and panel 11 from `analysisGifUrl`, then saves the complete Dashboard and reads it back. It updates `bgimage`, `newbgimage`, and both `en-US` and `zh-TW` localized image fields. Older observations are skipped so a delayed retry cannot roll the representative images back.

Start with `DASHBOARD_PUBLISH_MODE=dry-run`; it logs in and validates the Dashboard and panel structure without saving. Use `live` only after the dry run succeeds. Dashboard failures are tracked separately from DataHub and modeling status and never submit another Hunyuan generation.

## Existing annotated GLB migration

Deploy the callback/schema changes before the worker. To copy existing successful annotated GLBs to the public presentation bucket, first run the idempotent migration in dry-run mode:

```powershell
$env:PRIVATE_GCS_BUCKET='<private-artifact-bucket>'
$env:PUBLIC_GCS_BUCKET='<public-presentation-bucket>'
npm run migrate:public-annotated-glbs
```

Confirm the worker health reports an empty callback outbox before migration. After reviewing the plan, rerun it with `-- --execute`. The command verifies each destination object before updating both the observation URL and its modeling-job completion payload. It deliberately retains private source objects.

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

Worker readiness, resume, network, timeout, and worker 5xx failures keep the modeling job in `dispatching` so Cloud Tasks can retry with the same job ID. The worker's durable idempotent queue prevents a second paid submission if its acceptance response was lost. Terminal worker 4xx validation failures are recorded and acknowledged. DataHub failures are safe to retry and are reclaimed after `DATAHUB_CLAIM_TIMEOUT_MS` (default 10 minutes) if a previous handler stopped mid-upload.

## Robot camera poller

Cloud Scheduler calls `POST /api/internal/auto-capture/poll` once per minute. The handler reads the public `images.json` directly; it does not run a browser. It waits for exactly one valid `pos1` and one valid `pos2`, requires their filename timestamps to be within five minutes, maps `pos2` to Front View and `pos1` to Right View, and uses the later filename timestamp as `observedAt` after converting Asia/Taipei to UTC.

Robot-camera jobs dispatch the trusted `robot_camera` calibration profile. The worker resolves `ROBOT_CAMERA_MODEL_TO_CM_SCALE` from its own protected configuration and snapshots the value in SQLite before paid generation. Manual uploads continue to use the analyzer default. The current robot-camera coefficient is `174.1084` (`155.1768 * 1.1220`) and applies consistently to all physical-distance outputs and exported analysis artifacts.

MongoDB stores the first complete pair as a baseline without creating a modeling job. Later pairs are keyed by a SHA-256 fingerprint of their two unique paths. A MongoDB lease and the user-scoped deterministic submission key make overlapping Scheduler calls and retries idempotent. The handler downloads and validates both images before staging them in GridFS, and the existing deterministic modeling Cloud Task performs the worker handoff.

Create the Scheduler while auto capture is disabled, pause it, then enable auto capture and run it once to establish the baseline. Do not resume the schedule until the first invocation reports `baseline` and MongoDB has no modeling job for that pair.

```powershell
gcloud scheduler jobs create http robot-camera-poll `
  --location=<scheduler-region> `
  --schedule="* * * * *" `
  --time-zone="Etc/UTC" `
  --uri="https://<cloud-run-service>/api/internal/auto-capture/poll" `
  --http-method=POST `
  --oidc-service-account-email=<scheduler-service-account> `
  --oidc-token-audience="https://<cloud-run-service>" `
  --headers="X-Internal-Task-Token=<INTERNAL_TASK_TOKEN>" `
  --attempt-deadline=60s

gcloud scheduler jobs pause robot-camera-poll --location=<scheduler-region>
gcloud scheduler jobs run robot-camera-poll --location=<scheduler-region>
# Verify the baseline response/logs before enabling paid automation.
gcloud scheduler jobs resume robot-camera-poll --location=<scheduler-region>
```

Grant the Scheduler service account `roles/run.invoker` on the Cloud Run service. Treat the Scheduler custom header as a secret and restrict access to Scheduler job configuration. Keep `AUTO_CAPTURE_ENABLED=false` during initial deployment; resuming the enabled schedule allows future photo pairs to create paid Hunyuan generations.
