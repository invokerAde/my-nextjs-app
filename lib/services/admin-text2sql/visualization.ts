/**
 * Visualization Inference — rule-based engine that decides whether a SQL
 * result set is suitable for chart rendering, and produces a small chart spec
 * for the frontend Recharts layer.
 *
 * No AI involvement — pure heuristics on columns + rows + question text.
 */

export interface VisualizationSpec {
  schemaVersion: 1;
  type: 'bar' | 'line' | 'pie';
  title: string;
  xField?: string;
  yFields?: string[];
  categoryField?: string;
  valueField?: string;
}

const MAX_CATEGORIES = 20;
const MAX_PIE_CATEGORIES = 10;
const MAX_TEXT_LENGTH = 80;
const MAX_TITLE_LENGTH = 80;
const MAX_YFIELDS = 3;

// ── Helpers ──

function truncateTitle(question: string): string {
  if (question.length <= MAX_TITLE_LENGTH) return question;
  return question.slice(0, MAX_TITLE_LENGTH - 3) + '...';
}

// ── Column classification ──

interface ColumnInfo {
  numerical: string[];
  dateTime: string[];
  categorical: string[];
  idLike: string[];
  textLike: string[];
}

function isTemporalName(col: string): boolean {
  return /^(date|time|month|year|day|quarter|created|updated|timestamp|period|week)$/i.test(col)
    || /[_.]?(date|time|month|year|day|quarter|timestamp)$/i.test(col);
}

function classifyColumns(columns: string[], rows: Record<string, unknown>[]): ColumnInfo {
  const numerical: string[] = [];
  const dateTime: string[] = [];
  const categorical: string[] = [];
  const idLike: string[] = [];
  const textLike: string[] = [];

  for (const col of columns) {
    const values = rows.map(r => r[col]).filter(v => v !== null && v !== undefined);
    if (values.length === 0) { textLike.push(col); continue; }

    const colLower = col.toLowerCase();

    // ID detection by name pattern — all values unique → likely a key
    if (/[_.]?id$|[_.]?uuid$|[_.]?pk$|^id$/i.test(colLower)) {
      const distinctCount = new Set(values.map(String)).size;
      if (distinctCount === values.length) { idLike.push(col); continue; }
    }

    // Temporal column names checked before numeric so year/month/day
    // columns containing numbers go to dateTime, not numerical.
    if (isTemporalName(col)) { dateTime.push(col); continue; }

    // Numeric detection
    if (values.every(v => {
      if (typeof v === 'number' || typeof v === 'bigint') return true;
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return true;
      return false;
    })) { numerical.push(col); continue; }

    // Date/time by value pattern (ISO dates, timestamps)
    const dateRx = /^\d{4}-\d{2}-\d{2}|^\d{2}\/\d{2}\/\d{4}|T\d{2}:\d{2}/;
    const dateLikeCount = values.filter(v => {
      const s = String(v);
      return dateRx.test(s) && !isNaN(Date.parse(s));
    }).length;
    if (dateLikeCount >= values.length * 0.8) { dateTime.push(col); continue; }

    // Text-like: long strings or too many distinct values
    const strings = values.filter(v => typeof v === 'string');
    if (strings.length > 0) {
      const maxLen = Math.max(...strings.map(s => s.length));
      if (maxLen > MAX_TEXT_LENGTH) { textLike.push(col); continue; }

      const distinctCount = new Set(strings.map(s => s.toLowerCase())).size;
      if (distinctCount > MAX_CATEGORIES && distinctCount / values.length > 0.8) {
        textLike.push(col); continue;
      }
    }

    categorical.push(col);
  }

  return { numerical, dateTime, categorical, idLike, textLike };
}

// ── Pie keyword detection ──

function isPieQuestion(question: string, columns: string[]): boolean {
  const lower = question.toLowerCase();
  const keywords = ['distribution', 'ratio', 'proportion', 'percentage', 'breakdown',
    'share', 'split', 'composition', 'classified', 'category stat', 'categories'];
  const colKeywords = ['status', 'rating', 'type', 'level', 'tier', 'group', 'segment',
    'region', 'country', 'gender', 'role', 'channel', 'source'];

  return keywords.some(k => lower.includes(k))
    || columns.some(c => colKeywords.some(ck => c.toLowerCase().includes(ck)));
}

// ── Chart type dispatch ──

type ChartSpec = Extract<VisualizationSpec, { type: 'bar' | 'line' | 'pie' }>;

function makeSpec(type: ChartSpec['type'], question: string, fields: Partial<ChartSpec>): ChartSpec {
  return { schemaVersion: 1, type, title: truncateTitle(question), ...fields } as ChartSpec;
}

// ── Main inference ──

export function inferVisualization(
  columns: string[],
  rows: Record<string, unknown>[],
  question: string,
): VisualizationSpec | null {
  if (!columns.length || !rows.length) return null;

  const info = classifyColumns(columns, rows);
  if (info.numerical.length === 0) return null;

  const meaningfulX = [...info.dateTime, ...info.categorical, ...info.numerical];
  const hasXAxis = meaningfulX.length > info.numerical.length;

  if (!hasXAxis) {
    // All columns are numeric: first as X axis, remaining as Y
    if (info.numerical.length >= 2 && rows.length > 1) {
      return makeSpec('bar', question, {
        xField: info.numerical[0],
        yFields: info.numerical.slice(1, MAX_YFIELDS + 1),
      });
    }

    // Single numeric + possible text category → only if pie-question
    if (info.numerical.length === 1 && rows.length <= MAX_PIE_CATEGORIES && isPieQuestion(question, columns)) {
      const nonNumCol = columns.find(c => !info.numerical.includes(c));
      if (nonNumCol && !info.textLike.includes(nonNumCol)) {
        return makeSpec('pie', question, {
          categoryField: nonNumCol,
          valueField: info.numerical[0],
        });
      }
    }
    return null;
  }

  // Pick the best X field: prefer dateTime, then categorical
  const xField = info.dateTime.length > 0 ? info.dateTime[0]
    : info.categorical.length > 0 ? info.categorical[0]
    : null;
  if (!xField || info.textLike.includes(xField)) return null;

  // Line chart: date/time X axis
  if (info.dateTime.includes(xField)) {
    return makeSpec('line', question, {
      xField,
      yFields: info.numerical.slice(0, MAX_YFIELDS),
    });
  }

  // Pie chart: single numeric, few categories, distribution question
  const distinctX = new Set(rows.map(r => String(r[xField]))).size;
  if (info.numerical.length === 1 && distinctX <= MAX_PIE_CATEGORIES && isPieQuestion(question, columns)) {
    const numVal = info.numerical[0];
    if (rows.every(r => { const v = Number(r[numVal]); return !isNaN(v) && v >= 0; })) {
      return makeSpec('pie', question, { categoryField: xField, valueField: numVal });
    }
  }

  // Default: bar chart
  return makeSpec('bar', question, {
    xField,
    yFields: info.numerical.slice(0, MAX_YFIELDS),
  });
}
