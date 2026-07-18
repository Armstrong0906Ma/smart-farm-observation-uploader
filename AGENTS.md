# Smart Farm Observation Uploader

## Commands

- Install dependencies with `npm install`.
- Run local development with `npm run dev`.
- Verify changes with `npm run lint`, `npm run typecheck`, and `npm run build`; the repository has no automated test script.
- Run the DataHub timestamp proof of concept with `npm run poc:datahub-timestamp`.

## Architecture

- This is one Next.js App Router application: UI and route handlers are under `src/app`; shared browser components are under `src/components`.
- Keep persistent-data access in `src/lib/repositories.js`; it uses `src/lib/mongodb.js`, which creates the required MongoDB indexes on first connection.
- Firebase is only the authentication provider. MongoDB stores plants, observations, upload attempts, import batches, and modeling jobs.
- `observations` must remain unique by `plantId` and `observedAt`; the MongoDB index enforces this.
- `internodeStatistics` is optional observation data for Dashboard and uses the existing Python output names: `overall`, `internodes_1_to_9`, `internodes_10_to_15`, and `internodes_16_and_above`.
- DataHub uploads send `height`, `nodes`, `plant`, and optional text tag `gif_url` in `src/lib/uploaders/nodeSdkUploader.js`; GLB and analysis artifacts remain GCS URLs in MongoDB, not DataHub binaries.

## Environment And Deployment

- API routes that access data require `MONGODB_URI`; `MONGODB_DATABASE` defaults to `smart_farm`. Keep both in `.env.local` or deployment secrets, never in source.
- Use `DATAHUB_UPLOADER=mock` and `AUTH_REQUIRED=false` only for local UI/API debugging. Real DataHub sync requires `DATAHUB_UPLOADER=datahub-node-sdk` and `DATAHUB_DCCS_CREDENTIAL_KEY`.
- `next.config.ts` uses `output: "standalone"`; the Docker image builds with Node 22 and runs the standalone server on port `8080`.
- Modeling submissions proxy two images to `HUNYUAN_SERVICE_URL`; `HUNYUAN_SERVICE_TOKEN` must match worker `SERVICE_TOKEN`, and `INTERNAL_TASK_TOKEN` must match the worker callback token.
