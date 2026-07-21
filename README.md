# Smart Farm Observation Uploader

智慧農場植株觀測資料上傳工具。系統提供網頁介面讓使用者手動新增植株高度與節點數，也支援 Excel / CSV 批次匯入，最後可同步到 Advantech WISE-PaaS/DataHub。

本專案適合兩種使用情境：

- 現場人員透過瀏覽器手動輸入或匯入檔案。
- 自動化檢測程式透過 API 寫入觀測資料，再由系統同步到 DataHub。

## 系統流程

```text
Web UI / External Automation
  -> Next.js API
  -> Firebase Auth
  -> MongoDB
  -> Manual / Batch Sync
  -> DataHub Node.js SDK
  -> WISE-PaaS/DataHub
```

手動新增的觀測資料會先存到 MongoDB，預設 `uploadStatus = pending`。使用者按下同步按鈕後，系統才會送到 DataHub。

批次匯入 Excel / CSV 時，前端會先解析檔案並檢查格式；確認同步後，後端會建立匯入批次並在背景逐筆上傳到 DataHub。

## 功能

- Google Firebase Auth 登入驗證。
- 手動新增植株觀測資料。
- Excel / CSV 批次匯入植株高度與節點數。
- 匯入批次進度查詢。
- MongoDB 儲存觀測資料、節間統計、匯入批次與上傳紀錄。
- 支援 mock 上傳模式，方便本機開發與 UI 測試。
- 支援 DataHub Node.js SDK 上傳模式。
- 提供 API 給自動化檢測流程串接。
- 上傳正面與右側照片，追蹤 Hunyuan 3D 建模、株高結點分析與 DataHub 自動同步。
- 每分鐘監測機械手臂照片來源，將 `pos2` 當正面、`pos1` 當右側並自動排入相同建模流程。
- 所有登入使用者都能看到進行中的手動與機械手臂建模任務，重新整理後仍可恢復進度。

## 技術架構

- Next.js 15 App Router
- React 19
- Firebase Auth
- MongoDB
- Advantech WISE-PaaS/DataHub Edge Node.js SDK
- `xlsx` 檔案解析
- `zod` API payload 驗證

## 專案結構

```text
src/app                     Next.js 頁面與 API routes
src/components              前端 UI 元件
src/lib/importParser.js     Excel / CSV 解析邏輯
src/lib/validation.js       API 輸入資料驗證 schema
src/lib/repositories.js     MongoDB 資料存取
src/lib/uploaders           DataHub / mock 上傳器
scripts                     DataHub timestamp PoC
docs                        開發筆記與 PoC 文件
```

## 安裝與啟動

### 1. 安裝套件

```powershell
npm install
```

### 2. 建立環境變數

複製 `.env.example` 為 `.env.local`，並填入 Firebase 與 DataHub 設定。

```powershell
Copy-Item .env.example .env.local
```

### 3. 本機開發

```powershell
npm run dev
```

預設開發網址通常為：

```text
http://localhost:3000
```

### 4. 建置與啟動正式模式

```powershell
npm run build
npm run start
```

## 環境變數

| 變數 | 必填 | 說明 |
| --- | --- | --- |
| `MONGODB_URI` | 是 | MongoDB 連線字串。應使用平台提供或 MongoDB Atlas 的 TLS 連線字串。 |
| `MONGODB_DATABASE` | 否 | MongoDB database 名稱，預設 `smart_farm`。 |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | 是 | Firebase Web App API key。 |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | 是 | Firebase Auth domain。 |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | 是 | Firebase project ID。 |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | 是 | Firebase Web App ID。 |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | 視環境 | Firebase Admin service account JSON 字串。雲端環境若已有預設憑證可不填。 |
| `AUTH_REQUIRED` | 否 | 是否啟用 Firebase ID token 驗證。預設需驗證。設為 `false` 僅建議本機 API 除錯使用。 |
| `DATAHUB_UPLOADER` | 是 | `mock` 或 `datahub-node-sdk`。 |
| `DATAHUB_NODE_ID` | DataHub 模式建議 | DataHub Edge node ID。未填時使用程式內預設值。 |
| `DATAHUB_DCCS_API_URL` | DataHub 模式建議 | DCCS API URL。 |
| `DATAHUB_DCCS_CREDENTIAL_KEY` | DataHub 模式必填 | DataHub DCCS credential key。 |
| `DATAHUB_USE_SECURE` | 否 | 保留設定，目前主要由 SDK 連線設定處理。 |
| `DATAHUB_CONNECT_TIMEOUT_MS` | 否 | 等待 SDK connected 事件逾時毫秒數，預設 `30000`。 |
| `DATAHUB_PUBLISH_WAIT_MS` | 否 | 送出資料後等待 SDK publish 的時間，預設 `1500`。 |
| `TASKS_PROJECT_ID` | 非同步模式必填 | Cloud Tasks GCP project。Tasks 設定需整組提供。 |
| `TASKS_LOCATION` | 非同步模式必填 | Cloud Tasks location。 |
| `TASKS_QUEUE` | 非同步模式必填 | 未設定個別 queue 時的相容性 fallback。 |
| `TASKS_MODELING_QUEUE` | 否 | 建模派送專用 queue。 |
| `TASKS_DATAHUB_QUEUE` | 否 | DataHub 發布專用 queue。 |
| `TASKS_DASHBOARD_QUEUE` | 否 | Dashboard 發布專用 queue，建議限制單一並行。 |
| `TASK_HANDLER_URL` | 非同步模式必填 | 此 Next.js 服務的公開 base URL。 |
| `TASK_SERVICE_ACCOUNT_EMAIL` | 否 | 設定後 Cloud Tasks 會附 Cloud Run OIDC token。 |
| `INTERNAL_TASK_TOKEN` | callback/非同步模式必填 | Worker callback 與內部 task route 共用的隨機密鑰。 |
| `AUTO_CAPTURE_ENABLED` | 否 | 設為 `true` 才允許 Scheduler 監測照片來源；首次完整 pair 只建立 baseline。 |
| `AUTO_CAPTURE_SOURCE_URL` | 自動拍照模式必填 | 機械手臂網站的 `images.json` 完整 URL。 |
| `AUTO_CAPTURE_PLANT_ID` | 否 | 自動照片所屬植株，預設 `A-1-1`。 |
| `AUTO_CAPTURE_TIMEZONE` | 否 | 檔名拍攝時間的時區，目前固定支援 `Asia/Taipei`。 |
| `DATAHUB_CLAIM_TIMEOUT_MS` | 否 | DataHub 上傳 claim 失效時間，預設 `600000`；失效後 task 可重新 claim。 |
| `HUNYUAN_SERVICE_URL` | 自動建模必填 | 本機或 GCE Hunyuan worker URL。 |
| `HUNYUAN_SERVICE_TOKEN` | 自動建模建議 | Cloud Run 呼叫 worker 的共用 token。 |
| `DASHBOARD_PUBLISH_MODE` | 否 | `disabled`、`dry-run` 或 `live`，預設停用。 |
| `DASHBOARD_BASE_URL` | Dashboard 模式必填 | 研華 Dashboard HTTPS origin。 |
| `DASHBOARD_UID` | Dashboard 模式必填 | 固定 Dashboard UID。 |
| `DASHBOARD_LOGIN_EMAIL` | Dashboard 模式必填 | `/login` 使用的 email 欄位。 |
| `DASHBOARD_LOGIN_USER` | Dashboard 模式必填 | `/login` 使用的 user 欄位；可與 email 相同。 |
| `DASHBOARD_LOGIN_PASSWORD` | Dashboard 模式必填 | Dashboard 密碼，只能存於 Secret Manager 或 `.env.local`。 |
| `DASHBOARD_ORG_ID` | 否 | Grafana organization ID，預設 `1`。 |

### 本機 UI 測試建議設定

```env
DATAHUB_UPLOADER=mock
AUTH_REQUIRED=false
```

### 實際上傳 DataHub 設定

```env
DATAHUB_UPLOADER=datahub-node-sdk
DATAHUB_NODE_ID=your-node-id
DATAHUB_DCCS_API_URL=https://api-dccs-ensaas.education.wise-paas.com/
DATAHUB_DCCS_CREDENTIAL_KEY=your-credential-key
```

請勿提交 `.env.local`、service account JSON 或任何 credential 到 GitHub。

## 植株編號規則

系統預設建立並啟用以下植株：

- 區域：`A`、`B`、`C`、`D`
- 列：`1` 到 `3`
- 位置：`1` 到 `6`

植株編號格式為：

```text
{區域}-{列}-{位置}
```

範例：

```text
A-1-1
B-3-6
D-2-4
```

匯入檔案時，植株編號會自動去除空白並轉成大寫。若輸入 `a 1-1` 這類包含空白的值，會先壓縮空白後再轉換；建議仍使用標準格式 `A-1-1`。

## 觀測資料欄位

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `plantId` | string | 是 | 植株編號，例如 `A-1-1`。必須存在且啟用。 |
| `observedAt` | ISO datetime string | 是 | 觀測時間，例如 `2026-07-05T08:30:00.000Z`。 |
| `height` | number | 是 | 植株高度。需為有限數字。 |
| `nodes` | integer | 是 | 節點數。需為非負整數。匯入檔案時會四捨五入。 |
| `source` | string | 否 | `manual`、`csv_import`、`robot_vision`、`api`。手動新增預設 `manual`。 |
| `note` | string | 否 | 備註。 |

同一個 `plantId` 加上同一個 `observedAt` 會形成唯一觀測 ID，因此不可重複新增。

## 支援的 Excel / CSV 格式

目前支援三種副檔名：

- `.csv`
- `.xlsx`
- `.xls`

其他格式會回傳錯誤：`只支援 .csv、.xlsx、.xls`。

### CSV：標準長表格式

CSV 可有標題列，也可沒有標題列。

有標題列時，必須能找到以下四類欄位：

| 資料 | 支援欄位名稱 |
| --- | --- |
| 植株編號 | `id`、`no.`、`no`、`plant`、`plantid`、`plant id`、`plant_id` |
| 日期時間 | `date`、`time`、`observedat`、`observed at`、`observed_at` |
| 高度 | `height`、`hight`、`t(cm)`、`t` |
| 節點數 | `node`、`nodes` |

欄位名稱不分大小寫，前後空白會被忽略。

CSV 範例：

```csv
plant,date,height,nodes
A-1-1,2026-07-05,12.5,4
A-1-2,2026-07-05 08:30,13.2,5
B-2-3,2026/07/06,15,6
```

無標題列時，欄位順序固定如下：

```text
植株編號,日期時間,高度,節點數
```

無標題列範例：

```csv
A-1-1,2026-07-05,12.5,4
A-1-2,2026-07-05 08:30,13.2,5
```

CSV 日期支援：

- `YYYY-MM-DD`
- `YYYY/MM/DD`
- `YYYY.MM.DD`
- `YYYY-MM-DD HH:mm`
- `YYYY/MM/DD HH:mm`
- JavaScript `Date` 可解析的日期字串

CSV 解析規則：

- 支援 UTF-8 BOM。
- 支援雙引號包住含逗號的欄位。
- 空白列會被忽略。
- 若找不到必要欄位，會顯示 `找不到必要欄位：ID/Date/height/node`。
- 若植株、日期、高度或節點格式錯誤，該列會被列為錯誤。

### Excel：Plant_Hight & Node 格式

Excel 會優先讀取工作表名稱為 `Plant_Hight & Node` 的 sheet；若找不到，會讀取第一個 sheet。

此格式適合原始試驗紀錄表，結構分成 `Height` 與 `Node` 兩個區塊。系統會用同一個 Day 欄位，將高度與節點組成一筆觀測資料。

必要結構：

- 第 1 列需要有 `Height` 與 `Node` 區塊標題。
- 第 2 列需要填入 day number，例如 `0`、`7`、`14`。
- 第 3 列起為植株資料。
- `Height` 區塊前一欄為植株編號。
- `Node` 區塊前一欄為植株編號。
- 同一列的 Height 植株編號與 Node 植株編號必須一致。

概念範例：

```text
        Height              Node
Plant   0    7    14 Plant   0    7    14
A-1-1   5.2  8.1  12 A-1-1   2    4    6
A-1-2   4.9  7.8  11 A-1-2   2    4    5
```

Excel 日期換算：

- 使用者匯入 Excel 時需要在畫面上選擇 `Day 0 對應日期`。
- 系統會用 `Day 0 對應日期 + day number` 產生每筆 `observedAt`。
- 例如 Day 0 是 `2026-07-01`，Day `7` 會轉成 `2026-07-08`。

Excel 解析規則：

- `Height` 或 `Node` 區塊不存在時，會顯示 `找不到 Height 與 Node 區塊`。
- Day 欄位不存在時，會顯示 `找不到 Day 欄位`。
- 同一天同一植株必須同時有高度與節點，缺任一值會被列為錯誤。
- 若 Height 與 Node 區塊的植株編號不一致，該列會被列為錯誤。
- 高度與節點都空白時，該 day 會被略過，不會產生觀測資料。

## 網頁使用方法

### 手動新增觀測資料

1. 開啟網站並登入 Google 帳號。
2. 在 `新增觀測資料` 區塊選擇植株編號。
3. 輸入觀測日期時間、高度、節點數與備註。
4. 按下 `儲存到資料庫`。
5. 資料會先以 `pending` 狀態存入 MongoDB。
6. 確認資料後，按下同步按鈕將待同步資料送到 DataHub。

### Excel / CSV 批次匯入

1. 在 `Excel / CSV 批量同步` 區塊選擇 `.csv`、`.xlsx` 或 `.xls` 檔案。
2. 若選擇 Excel，請設定 `Day 0 對應日期`。
3. 系統會先解析檔案並顯示可同步筆數與錯誤筆數。
4. 若有錯誤，請修正檔案後重新選擇。
5. 沒有錯誤時，按下 `確認同步這批資料`。
6. 後端會建立匯入批次，並在背景逐筆上傳。
7. 畫面會顯示背景同步進度、成功筆數與失敗筆數。

## DataHub 上傳內容

DataHub 上傳器會將每筆觀測資料轉成 EdgeData。

使用的 timestamp：

```text
new Date(observedAt).getTime()
```

每筆觀測資料會送出三個必要 tag；自動建模有 GIF 時另送 `gif_url` 文字 tag：

| deviceId | tagName | value |
| --- | --- | --- |
| `plantId` | `height` | 植株高度 |
| `plantId` | `nodes` | 節點數 |
| `plantId` | `plant` | 植株編號 |
| `plantId` | `gif_url` | GIF HTTPS URL（選填） |

範例：

```json
{
  "deviceId": "A-1-1",
  "tags": {
    "height": 12.5,
    "nodes": 4,
    "plant": "A-1-1"
  },
  "timestampMs": 1783238400000
}
```

## API 使用方法

所有 `/api` 端點皆回傳 JSON。

除 `/api/health` 與 `/api/firebase-config` 外，API 預設需要 Firebase ID token：

```http
Authorization: Bearer <Firebase ID Token>
```

本機除錯可在 `.env.local` 設定：

```env
AUTH_REQUIRED=false
```

此時 API 會使用虛擬使用者：

```json
{
  "uid": "local-dev",
  "email": "local-dev@example.com"
}
```

### 錯誤格式

API 錯誤統一格式：

```json
{
  "error": "錯誤訊息"
}
```

常見 HTTP status：

| Status | 說明 |
| --- | --- |
| `400` | 輸入格式錯誤、植株不存在或未啟用。 |
| `401` | 未登入或 Firebase token 驗證失敗。 |
| `404` | 找不到指定資料。 |
| `409` | 資料衝突，例如同一植株同一時間已存在，或已同步資料不可修改。 |
| `500` | 伺服器或第三方服務錯誤。 |

### GET /api/health

健康檢查，不需登入。

Request：

```http
GET /api/health
```

Response `200`：

```json
{
  "ok": true
}
```

### GET /api/firebase-config

取得前端 Firebase client config，不需登入。

Request：

```http
GET /api/firebase-config
```

Response `200`：

```json
{
  "apiKey": "...",
  "authDomain": "...",
  "projectId": "...",
  "appId": "..."
}
```

若環境變數缺漏，Response `500`：

```json
{
  "error": "Firebase client config is missing."
}
```

### GET /api/plants

取得目前啟用的植株清單。

Request：

```http
GET /api/plants
Authorization: Bearer <Firebase ID Token>
```

Response `200`：

```json
{
  "plants": [
    {
      "id": "A-1-1",
      "plantId": "A-1-1",
      "dataHubDeviceId": "A-1-1",
      "zone": "A",
      "row": "1",
      "position": "1",
      "enabled": true,
      "createdAt": "2026-07-05T00:00:00.000Z",
      "updatedAt": "2026-07-05T00:00:00.000Z"
    }
  ]
}
```

### GET /api/observations

分頁取得觀測資料，依 `createdAt` 由新到舊排序。

Query：

| 參數 | 預設 | 限制 | 說明 |
| --- | --- | --- | --- |
| `page` | `1` | 最小 `1` | 頁碼。 |
| `limit` | `10` | `1` 到 `50` | 每頁筆數。 |

Request：

```http
GET /api/observations?page=1&limit=10
Authorization: Bearer <Firebase ID Token>
```

Response `200`：

```json
{
  "observations": [
    {
      "id": "A-1-1_1783238400000",
      "plantId": "A-1-1",
      "observedAt": "2026-07-05T08:00:00.000Z",
      "height": 12.5,
      "nodes": 4,
      "source": "manual",
      "note": "",
      "uploadStatus": "pending",
      "retryCount": 0,
      "lastError": null,
      "uploadedAt": null,
      "createdBy": "firebase-uid",
      "createdAt": "2026-07-05T08:10:00.000Z",
      "updatedAt": "2026-07-05T08:10:00.000Z"
    }
  ],
  "page": 1,
  "pageSize": 10,
  "hasNext": false,
  "hasPrev": false
}
```

### POST /api/observations

新增單筆觀測資料。此 API 適合自動化檢測系統逐筆寫入資料。

Request body：

```json
{
  "plantId": "A-1-1",
  "observedAt": "2026-07-05T08:00:00.000Z",
  "height": 12.5,
  "nodes": 4,
  "source": "api",
  "note": "robot vision result"
}
```

欄位限制：

- `plantId` 必須存在於啟用植株清單。
- `observedAt` 必須是 ISO datetime 字串。
- `height` 必須是 number。
- `nodes` 必須是非負整數。
- `source` 可為 `manual`、`csv_import`、`robot_vision`、`api`，未填預設 `manual`。
- `plantId + observedAt` 不可重複。

Request：

```http
POST /api/observations
Authorization: Bearer <Firebase ID Token>
Content-Type: application/json
```

Response `201`：

```json
{
  "observation": {
    "id": "A-1-1_1783238400000",
    "plantId": "A-1-1",
    "observedAt": "2026-07-05T08:00:00.000Z",
    "height": 12.5,
    "nodes": 4,
    "source": "api",
    "note": "robot vision result",
    "uploadStatus": "pending",
    "retryCount": 0,
    "lastError": null,
    "uploadedAt": null,
    "createdBy": "firebase-uid",
    "createdAt": "2026-07-05T08:10:00.000Z",
    "updatedAt": "2026-07-05T08:10:00.000Z"
  }
}
```

常見錯誤：

- `400`：`輸入資料格式錯誤`
- `400`：`植株編號不存在或未啟用`
- `409`：`同一植株與觀測時間已存在，請改用修改或重新上傳`

curl 範例：

```bash
curl -X POST "http://localhost:3000/api/observations" \
  -H "Authorization: Bearer $FIREBASE_ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "plantId": "A-1-1",
    "observedAt": "2026-07-05T08:00:00.000Z",
    "height": 12.5,
    "nodes": 4,
    "source": "api",
    "note": "robot vision result"
  }'
```

### GET /api/observations/{id}

取得單筆觀測資料。

Request：

```http
GET /api/observations/A-1-1_1783238400000
Authorization: Bearer <Firebase ID Token>
```

Response `200`：

```json
{
  "observation": {
    "id": "A-1-1_1783238400000",
    "plantId": "A-1-1",
    "observedAt": "2026-07-05T08:00:00.000Z",
    "height": 12.5,
    "nodes": 4,
    "uploadStatus": "pending"
  }
}
```

若找不到資料，Response `404`：

```json
{
  "error": "找不到觀測資料"
}
```

### PATCH /api/observations/{id}

修改尚未成功同步的觀測資料。

只有 `uploadStatus = pending` 或 `uploadStatus = failed` 的資料可以修改。已同步或同步中的資料不可修改。

Request body：

```json
{
  "plantId": "A-1-1",
  "observedAt": "2026-07-05T08:30:00.000Z",
  "height": 13.1,
  "nodes": 5,
  "note": "corrected value"
}
```

Request：

```http
PATCH /api/observations/A-1-1_1783238400000
Authorization: Bearer <Firebase ID Token>
Content-Type: application/json
```

Response `200`：

```json
{
  "observation": {
    "id": "A-1-1_1783240200000",
    "plantId": "A-1-1",
    "observedAt": "2026-07-05T08:30:00.000Z",
    "height": 13.1,
    "nodes": 5,
    "note": "corrected value",
    "uploadStatus": "pending",
    "lastError": null,
    "uploadedAt": null
  }
}
```

注意：如果修改了 `plantId` 或 `observedAt`，觀測資料 ID 也會跟著改變。

### DELETE /api/observations/{id}

刪除尚未成功同步的觀測資料。

只有 `uploadStatus = pending` 或 `uploadStatus = failed` 的資料可以刪除。已同步或同步中的資料不可刪除。

Request：

```http
DELETE /api/observations/A-1-1_1783238400000
Authorization: Bearer <Firebase ID Token>
```

Response `200`：

```json
{
  "ok": true
}
```

### POST /api/observations/sync

同步所有待同步資料到 DataHub。

系統會抓取 `uploadStatus = pending` 與 `uploadStatus = failed` 的資料，最多 500 筆，依 `observedAt` 由舊到新同步。

Request：

```http
POST /api/observations/sync
Authorization: Bearer <Firebase ID Token>
```

Response `200`：

```json
{
  "total": 2,
  "uploaded": 1,
  "failed": 1,
  "observations": [
    {
      "id": "A-1-1_1783238400000",
      "plantId": "A-1-1",
      "observedAt": "2026-07-05T08:00:00.000Z",
      "uploadStatus": "uploaded",
      "uploadedAt": "2026-07-05T08:20:00.000Z",
      "lastError": null
    },
    {
      "id": "A-1-2_1783238400000",
      "plantId": "A-1-2",
      "observedAt": "2026-07-05T08:00:00.000Z",
      "uploadStatus": "failed",
      "retryCount": 1,
      "lastError": "Missing DATAHUB_DCCS_CREDENTIAL_KEY"
    }
  ]
}
```

### POST /api/observations/{id}/reupload

重新上傳指定觀測資料到 DataHub。

Request：

```http
POST /api/observations/A-1-1_1783238400000/reupload
Authorization: Bearer <Firebase ID Token>
```

Response `200`：

```json
{
  "observation": {
    "id": "A-1-1_1783238400000",
    "plantId": "A-1-1",
    "observedAt": "2026-07-05T08:00:00.000Z",
    "uploadStatus": "uploaded",
    "uploadedAt": "2026-07-05T08:25:00.000Z",
    "lastError": null
  }
}
```

### POST /api/imports/observations/sync

建立批次匯入並背景同步。此 API 適合自動化系統一次送多筆觀測資料。

注意：這個 API 不負責解析 Excel / CSV；前端目前是在瀏覽器內用 `src/lib/importParser.js` 先解析檔案，再把解析後的 observations 傳給此 API。若自動化檢測流程要直接串接，建議直接組 JSON payload 呼叫此 API。

Request body：

```json
{
  "fileName": "robot-batch-2026-07-05.json",
  "format": "automation-json",
  "observations": [
    {
      "plantId": "A-1-1",
      "observedAt": "2026-07-05T08:00:00.000Z",
      "height": 12.5,
      "nodes": 4,
      "note": "robot batch",
      "source": "csv_import"
    }
  ]
}
```

限制：

- `observations` 最少 1 筆，最多 1000 筆。
- 每筆 `source` 目前 schema 固定為 `csv_import`，未填時預設 `csv_import`。
- 每筆都會檢查植株是否存在且啟用。
- 建立批次後 API 會立即回傳 `202`，實際上傳在背景處理。
- 批次結果會寫入 `importBatches/{batchId}/items`。

Request：

```http
POST /api/imports/observations/sync
Authorization: Bearer <Firebase ID Token>
Content-Type: application/json
```

Response `202`：

```json
{
  "accepted": true,
  "batchId": "abc123",
  "batch": {
    "id": "abc123",
    "fileName": "robot-batch-2026-07-05.json",
    "format": "automation-json",
    "total": 1,
    "uploaded": 0,
    "failed": 0,
    "status": "syncing",
    "createdBy": "firebase-uid",
    "createdAt": "2026-07-05T08:10:00.000Z",
    "updatedAt": "2026-07-05T08:10:00.000Z"
  },
  "total": 1,
  "uploaded": 0,
  "failed": 0,
  "results": []
}
```

curl 範例：

```bash
curl -X POST "http://localhost:3000/api/imports/observations/sync" \
  -H "Authorization: Bearer $FIREBASE_ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fileName": "robot-batch-2026-07-05.json",
    "format": "automation-json",
    "observations": [
      {
        "plantId": "A-1-1",
        "observedAt": "2026-07-05T08:00:00.000Z",
        "height": 12.5,
        "nodes": 4,
        "note": "robot batch",
        "source": "csv_import"
      }
    ]
  }'
```

### GET /api/imports/observations/batches

查詢最近的匯入批次。前端用此 API 顯示背景同步進度。

Query：

| 參數 | 預設 | 限制 | 說明 |
| --- | --- | --- | --- |
| `limit` | `20` | `1` 到 `50` | 回傳最近幾筆批次。 |

Request：

```http
GET /api/imports/observations/batches?limit=20
Authorization: Bearer <Firebase ID Token>
```

Response `200`：

```json
{
  "batches": [
    {
      "id": "abc123",
      "fileName": "robot-batch-2026-07-05.json",
      "format": "automation-json",
      "total": 100,
      "uploaded": 95,
      "failed": 5,
      "status": "partial_failed",
      "createdBy": "firebase-uid",
      "createdAt": "2026-07-05T08:10:00.000Z",
      "updatedAt": "2026-07-05T08:12:00.000Z",
      "completedAt": "2026-07-05T08:12:00.000Z"
    }
  ]
}
```

批次狀態：

| status | 說明 |
| --- | --- |
| `syncing` | 背景同步中。 |
| `uploaded` | 全部成功。 |
| `partial_failed` | 部分成功、部分失敗。 |
| `failed` | 全部失敗。 |

## 自動化檢測串接建議

若之後由自動化檢測或機器視覺系統串接，建議依使用情境選擇 API。

### 單筆即時寫入

使用：

```text
POST /api/observations
```

適合每次拍攝或量測完成就立刻寫入一筆資料。資料會先進 MongoDB，狀態為 `pending`，再由使用者或排程呼叫同步 API。

建議流程：

1. 自動化系統取得 Firebase ID token，或在安全的內網測試環境設定 `AUTH_REQUIRED=false`。
2. 呼叫 `POST /api/observations` 寫入資料，`source` 建議使用 `api` 或 `robot_vision`。
3. 定期呼叫 `POST /api/observations/sync` 同步待上傳資料。
4. 呼叫 `GET /api/observations` 或 `GET /api/observations/{id}` 檢查 `uploadStatus` 與 `lastError`。

### 批次寫入並立即背景同步

使用：

```text
POST /api/imports/observations/sync
```

適合自動化系統一次產生多筆量測結果，並希望後端立刻排入背景上傳。

建議流程：

1. 自動化系統整理最多 1000 筆 observations。
2. 呼叫 `POST /api/imports/observations/sync`。
3. 取得 `batchId`。
4. 每 2 到 5 秒呼叫 `GET /api/imports/observations/batches?limit=20` 查詢進度。
5. 當批次 `status` 不再是 `syncing`，代表背景同步已完成。

### 時間格式注意事項

API 的 `observedAt` 必須使用 ISO datetime，例如：

```text
2026-07-05T08:00:00.000Z
```

若自動化系統使用台灣時間，請先明確轉成 ISO UTC，避免 DataHub timestamp 偏移。例如台灣時間 `2026-07-05 16:00:00 +08:00` 對應：

```text
2026-07-05T08:00:00.000Z
```

### 重複資料處理

觀測資料由 MongoDB 產生 UUID，並以以下欄位建立唯一索引：

```text
{ plantId: 1, observedAt: 1 }
```

因此同一植株同一時間只允許一筆資料。自動化系統若重送相同資料，會收到 `409`。建議串接端自行決定：

- 忽略 `409`，視為已寫入。
- 改用 `PATCH /api/observations/{id}` 更新尚未同步的資料。
- 調整 `observedAt` 精度，確保每次量測時間唯一。

### 上傳狀態說明

| uploadStatus | 說明 |
| --- | --- |
| `pending` | 已存入 MongoDB，尚未送 DataHub。 |
| `uploading` | 正在上傳 DataHub。 |
| `uploaded` | 已成功上傳 DataHub。 |
| `failed` | 上傳失敗，可修正設定後重新同步。 |

## MongoDB Collections

| Collection | 說明 |
| --- | --- |
| `plants` | 植株基本資料與啟用狀態。 |
| `observations` | 手動或 API 建立的觀測資料。 |
| `uploadAttempts` | 單筆觀測資料上傳嘗試紀錄。 |
| `importBatches` | 批次匯入主檔。 |
| `importBatchItems` | 批次匯入逐筆結果，以 `batchId` 關聯主檔。 |
| `modelingJobs` | 兩張照片建模任務；`status` 與 `dataHubStatus` 分別追蹤建模及發布。 |
| `modelingSourceImages.files/chunks` | Cloud Tasks 模式暫存的來源照片，派送後刪除。 |

## 開發指令

```powershell
npm run dev
npm run build
npm run start
npm run typecheck
npm run poc:datahub-timestamp
```

注意：`npm run lint` 目前 package script 使用 `next lint`，Next.js 15 專案若未支援此指令，可能需要後續調整 lint 設定。

## 安全注意事項

- 不要把 `.env.local` 提交到 GitHub。
- 不要把 Firebase service account JSON 提交到 GitHub。
- 不要把 MongoDB connection string 提交到 GitHub。
- 不要把 DataHub credential key 寫死在程式碼或文件範例中。
- `AUTH_REQUIRED=false` 僅可用於本機或受控測試環境。
- 對外部署時必須使用 HTTPS，並保護 Firebase、MongoDB、DataHub credential。

## 常見問題

### 為什麼新增資料後沒有立刻出現在 DataHub？

手動新增資料只會先存到 MongoDB，狀態為 `pending`。需要按下同步按鈕或呼叫 `POST /api/observations/sync` 才會送到 DataHub。

### 為什麼 Excel 匯入需要 Day 0？

Excel 的 `Plant_Hight & Node` 格式使用 Day number 記錄量測日，例如 Day 0、Day 7、Day 14。系統需要知道 Day 0 對應的實際日期，才能轉成每筆 API 與 DataHub 使用的 `observedAt`。

### 為什麼批次匯入 API 回傳 202 但 uploaded 還是 0？

`POST /api/imports/observations/sync` 會先建立批次並立即回傳，實際上傳在背景執行。請用 `GET /api/imports/observations/batches` 查詢進度。

### 為什麼自動化批次 API 的 source 必須是 csv_import？

目前 `POST /api/imports/observations/sync` 的後端 schema 固定接受 `source = csv_import`，這是因為該端點原本服務 Excel / CSV 匯入流程。若未來要正式支援自動化批次來源，建議調整 schema 讓 `source` 可接受 `api` 或 `robot_vision`。
