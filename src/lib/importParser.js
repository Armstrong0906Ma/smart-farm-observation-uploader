import * as XLSX from 'xlsx';

const PLANT_ID_ALIASES = ['id', 'no.', 'no', 'plant', 'plantid', 'plant id', 'plant_id'];
const DATE_ALIASES = ['date', 'time', 'observedat', 'observed at', 'observed_at'];
const HEIGHT_ALIASES = ['height', 'hight', 't(cm)', 't'];
const NODE_ALIASES = ['node', 'nodes'];

function cleanHeader(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePlantId(value) {
  const raw = String(value || '').trim();
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  const noDashMatch = compact.match(/^([A-Z])(\d+)-(\d+)$/);
  if (noDashMatch) return `${noDashMatch[1]}-${noDashMatch[2]}-${noDashMatch[3]}`;
  return compact;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).trim());
  return Number.isFinite(number) ? number : null;
}

function parseDateValue(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, Math.floor(parsed.S || 0));
  }

  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/\./g, '/').replace(/-/g, '/');
  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
  if (match) {
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0)
    );
  }

  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dateOnly(value) {
  const date = parseDateValue(value);
  if (!date) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + Number(days));
  return next;
}

function findColumn(headers, aliases) {
  return headers.findIndex(header => aliases.includes(cleanHeader(header)));
}

function looksLikeHeader(row) {
  const headers = row.map(cleanHeader);
  return [PLANT_ID_ALIASES, DATE_ALIASES, HEIGHT_ALIASES, NODE_ALIASES]
    .every(aliases => headers.some(header => aliases.includes(header)));
}

function makeObservation({ plantId, observedAt, height, nodes, note }) {
  return {
    plantId: normalizePlantId(plantId),
    observedAt: observedAt.toISOString(),
    height,
    nodes,
    note: note || 'file import',
    source: 'csv_import'
  };
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field.trim());
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some(cell => cell !== '')) rows.push(row);
  return rows;
}

function parseCsv(text) {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ''));
  const errors = [];
  const observations = [];
  if (rows.length === 0) return { format: '標準 CSV 長表', observations, errors: [{ row: 1, message: 'CSV 需要至少一筆資料' }] };

  const hasHeader = looksLikeHeader(rows[0]);
  if (hasHeader && rows.length < 2) {
    return { format: '標準 CSV 長表', observations, errors: [{ row: 1, message: 'CSV 標題列後需要至少一筆資料' }] };
  }
  const headers = hasHeader ? rows[0] : ['plant', 'time', 'height', 'nodes'];
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const firstDataRowNumber = hasHeader ? 2 : 1;
  const plantColumn = hasHeader ? findColumn(headers, PLANT_ID_ALIASES) : 0;
  const dateColumn = hasHeader ? findColumn(headers, DATE_ALIASES) : 1;
  const heightColumn = hasHeader ? findColumn(headers, HEIGHT_ALIASES) : 2;
  const nodeColumn = hasHeader ? findColumn(headers, NODE_ALIASES) : 3;

  if ([plantColumn, dateColumn, heightColumn, nodeColumn].some(index => index < 0)) {
    return {
      format: '標準 CSV 長表',
      observations,
      errors: [{ row: 1, message: '找不到必要欄位：ID/Date/height/node' }]
    };
  }

  dataRows.forEach((row, index) => {
    const rowNumber = index + firstDataRowNumber;
    const observedAt = parseDateValue(row[dateColumn]);
    const height = toNumber(row[heightColumn]);
    const nodes = toNumber(row[nodeColumn]);
    const plantId = normalizePlantId(row[plantColumn]);

    if (!plantId || !observedAt || height === null || nodes === null) {
      errors.push({ row: rowNumber, message: '植株、日期、高度或節點格式錯誤' });
      return;
    }

    observations.push(makeObservation({ plantId, observedAt, height, nodes: Math.round(nodes) }));
  });

  return { format: '標準 CSV 長表', observations, errors };
}

function parsePlantHeightNodeSheet(rows, day0Value) {
  const day0 = dateOnly(day0Value);
  if (!day0) {
    return { format: 'Excel Plant_Hight & Node', observations: [], errors: [{ row: 1, message: '請先設定 Day 0 對應日期' }] };
  }

  const errors = [];
  const observations = [];
  const titleRow = rows[0] || [];
  const dayRow = rows[1] || [];
  const heightStart = titleRow.findIndex(cell => cleanHeader(cell) === 'height');
  const nodeStart = titleRow.findIndex(cell => cleanHeader(cell) === 'node');

  if (heightStart < 0 || nodeStart < 0) {
    return { format: 'Excel Plant_Hight & Node', observations, errors: [{ row: 1, message: '找不到 Height 與 Node 區塊' }] };
  }

  const heightPlantColumn = Math.max(heightStart - 1, 0);
  const nodePlantColumn = Math.max(nodeStart - 1, 0);
  const heightDays = [];
  const nodeDays = new Map();

  for (let col = heightStart; col < nodePlantColumn; col += 1) {
    const day = toNumber(dayRow[col]);
    if (day !== null) heightDays.push({ col, day });
  }

  for (let col = nodeStart; col < dayRow.length; col += 1) {
    const day = toNumber(dayRow[col]);
    if (day !== null) nodeDays.set(day, col);
  }

  if (heightDays.length === 0 || nodeDays.size === 0) {
    return { format: 'Excel Plant_Hight & Node', observations, errors: [{ row: 2, message: '找不到 Day 欄位' }] };
  }

  rows.slice(2).forEach((row, index) => {
    const rowNumber = index + 3;
    const plantId = normalizePlantId(row[heightPlantColumn]);
    const nodePlantId = normalizePlantId(row[nodePlantColumn]);
    if (!plantId) return;
    if (nodePlantId && nodePlantId !== plantId) {
      errors.push({ row: rowNumber, message: `Height/Node 植株編號不一致：${plantId} / ${nodePlantId}` });
      return;
    }

    heightDays.forEach(({ col, day }) => {
      const nodeColumn = nodeDays.get(day);
      if (nodeColumn === undefined) return;
      const height = toNumber(row[col]);
      const nodes = toNumber(row[nodeColumn]);
      if (height === null && nodes === null) return;
      if (height === null || nodes === null) {
        errors.push({ row: rowNumber, message: `Day ${day} 高度或節點缺漏` });
        return;
      }
      observations.push(makeObservation({ plantId, observedAt: addDays(day0, day), height, nodes: Math.round(nodes) }));
    });
  });

  return { format: 'Excel Plant_Hight & Node', observations, errors };
}

function findPlantHeightNodeSheet(workbook) {
  const preferred = workbook.SheetNames.find(name => cleanHeader(name) === 'plant_hight & node');
  return preferred || workbook.SheetNames[0];
}

export async function parseImportFile(file, { day0Date } = {}) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'csv') {
    return parseCsv(await file.text());
  }

  if (extension === 'xlsx' || extension === 'xls') {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheetName = findPlantHeightNodeSheet(workbook);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    return parsePlantHeightNodeSheet(rows, day0Date);
  }

  return { format: '不支援的格式', observations: [], errors: [{ row: 1, message: '只支援 .csv、.xlsx、.xls' }] };
}
