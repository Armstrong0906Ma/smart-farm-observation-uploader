# Smart Farm Observation Uploader

Mobile-friendly web app for collecting plant observation data, storing it in Firestore, and manually syncing pending records to Advantech WISE-PaaS/DataHub.

## Current Flow

```text
Mobile Web UI
  -> Next.js API
  -> Firebase Auth
  -> Firestore
  -> Manual sync button
  -> DataHub Node.js SDK
  -> WISE-PaaS/DataHub
```

New observations are saved to Firestore first with `uploadStatus = pending`. They are not sent to DataHub until the user clicks `確認同步到 DataHub`.

## App Code

- `src/app`: Next.js pages and API routes
- `src/components`: UI components
- `src/lib`: Firebase, Firestore repositories, validation, and uploader adapters
- `scripts`: DataHub timestamp PoC
- `docs`: development notes and PoC instructions

## Run Locally

```powershell
npm install
npm run dev
```

Create `.env.local` from `.env.example` and fill Firebase/DataHub settings.

Use mock upload while testing UI:

```env
DATAHUB_UPLOADER=mock
```

Use real DataHub upload:

```env
DATAHUB_UPLOADER=datahub-node-sdk
DATAHUB_DCCS_CREDENTIAL_KEY=your-credential-key
```

Never commit `.env.local` or Firebase service account JSON files.
