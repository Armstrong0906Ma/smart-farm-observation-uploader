# Development Notes

Application code is under `src/`:

- `src/app`: Next.js pages and API routes
- `src/components`: browser UI components
- `src/lib`: Firebase Auth, MongoDB repositories, validation, and uploader adapters

## Environment

Copy `.env.example` to `.env.local` and fill these values:

```powershell
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
MONGODB_URI=mongodb+srv://username:password@cluster.example.mongodb.net/?retryWrites=true&w=majority
MONGODB_DATABASE=smart_farm
DATAHUB_UPLOADER=mock
```

For real DataHub upload:

```powershell
DATAHUB_UPLOADER=datahub-node-sdk    mock
DATAHUB_DCCS_CREDENTIAL_KEY=your-credential-key
DATAHUB_NODE_ID=fac73565-5615-4af0-9bd9-2350ddb621cb
DATAHUB_DCCS_API_URL=https://api-dccs-ensaas.education.wise-paas.com/
```

For local API debugging without Firebase Auth only:

```powershell
AUTH_REQUIRED=false
```

## Run

```powershell
npm install
npm run dev
```

## Current MVP Behavior

- Google Login is handled by Firebase Auth.
- `GET /api/plants` seeds default plants `A-1-1` through `D-3-5` if MongoDB is empty.
- `POST /api/observations` stores the observation in MongoDB and sets `uploadStatus = pending`.
- The UI button `確認同步到 DataHub` calls `POST /api/observations/sync` and uploads all `pending` and `failed` observations.
- `pending` and `failed` observations can be modified or deleted before sync.
- `uploaded` and `uploading` observations cannot be modified or deleted from the UI/API.
- Duplicate `plantId + observedAt` is rejected.
- `DATAHUB_UPLOADER=mock` is safe for UI/API testing.
- `DATAHUB_UPLOADER=datahub-node-sdk` sends `height`, `nodes`, and `plant` to DataHub with `EdgeData.ts = observedAt`.

MongoDB is the Dashboard datasource. Each observation may include `internodeStatistics` with overall, `1-9`, `10-15`, and `16+` internode summaries. DataHub continues to receive only `height`, `nodes`, and `plant`.

Cloud Tasks is optional. Configure `TASKS_PROJECT_ID`, `TASKS_LOCATION`, `TASKS_QUEUE`, `TASK_HANDLER_URL`, and `INTERNAL_TASK_TOKEN` together to queue modeling dispatch and DataHub publication. If they are omitted, local requests continue to run inline. `TASK_SERVICE_ACCOUNT_EMAIL` additionally enables Cloud Run OIDC authentication.
