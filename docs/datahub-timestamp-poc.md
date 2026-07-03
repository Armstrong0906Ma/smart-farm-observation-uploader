# DataHub Timestamp PoC

This PoC verifies whether `wisepaas-datahub-edge-nodejs-sdk` preserves a manually supplied observation time when calling `sendData`.

The SDK source shows `EdgeData.ts` is copied to the outgoing data message. This PoC sets `EdgeData.ts` from `POC_OBSERVED_AT` and sends these tags:

- `height`
- `nodes`
- `plant`

## Run

Set the credential in your shell first. Do not commit it to files.

Install dependencies first:

```powershell
npm install
```

The project uses an npm `overrides` entry to install a newer `sqlite3` under the DataHub SDK. The official SDK depends on `sqlite3@4.1.1`, which does not install cleanly on the current Node 24 environment.

PowerShell example:

```powershell
$env:DATAHUB_DCCS_CREDENTIAL_KEY="your-credential-key"
$env:POC_PLANT_ID="A-1-1"
$env:POC_OBSERVED_AT="2024-07-30T00:00:00+08:00"
$env:POC_HEIGHT="158"
$env:POC_NODES="33"
npm run poc:datahub-timestamp
```

Optional environment variables:

- `DATAHUB_NODE_ID`, default `fac73565-5615-4af0-9bd9-2350ddb621cb`
- `DATAHUB_DCCS_API_URL`, default `https://api-dccs-ensaas.education.wise-paas.com/`
- `POC_CONNECT_TIMEOUT_MS`, default `30000`
- `POC_PUBLISH_WAIT_MS`, default `3000`

## Verify

After running the script, check DataHub Portal/Dashboard history for:

- Device: value of `POC_PLANT_ID`
- Tags: `height`, `nodes`, `plant`
- Timestamp: value of `POC_OBSERVED_AT`

The PoC passes only if DataHub history stores the point at the supplied observation time, not at upload time.

## REST Fallback Note

The local OpenAPI file documents `POST /api/v1/Command/writeValue` and says `ts` is optional. However, its summary says it sends a write value command to the device, so it should be treated as a fallback only after Advantech confirms it writes historical DataHub values for this use case.
