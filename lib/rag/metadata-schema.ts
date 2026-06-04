/**
 * Metadata Schema Registry.
 *
 * Declares every filterable metadata field, its type, allowed operators,
 * enum values (if any), and filter strength classification.
 *
 * The LLM prompt is generated from this registry — it is the single source
 * of truth for what the parser may output and what the translator may accept.
 */

export type MetadataFieldType = 'string' | 'number' | 'boolean' | 'string[]';

export type FilterOperator =
  | 'eq' | 'ne'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'between'
  | 'in'
  | 'contains';

export interface MetadataFieldSchema {
  name: string;
  type: MetadataFieldType;
  description: string;
  operators: FilterOperator[];
  enumValues?: string[];
  /** 'hard' = kept in every fallback; 'soft' = droppable */
  filterStrength: 'hard' | 'soft';
  /** Lower = kept first when no hard condition exists (1 = highest priority) */
  fallbackPriority?: number;
}

// ── Enum value pools ──

const MATERIAL_VALUES = [
  '纯棉', '棉涤混纺', '牛津纺', '府绸', '竹纤维混纺', '棉', '涤纶',
  '真皮', 'PU皮', '羊毛', '羊绒', '亚麻', '丝绸', '真丝', '莫代尔', '莱赛尔',
  '纯棉毛圈', '棉涤混纺加绒', '抓绒', '摇粒绒', '牛仔', '灯芯绒',
];

const FIT_VALUES = ['修身', '常规', '宽松', 'slim fit', 'oversize', '直筒', '阔腿'];

const COLLAR_VALUES = [
  '尖领', '温莎领', '纽扣领', '小方领', '连帽', '圆领', 'V领',
  '半拉链立领', '立领', '翻领', 'POLO领', '高领', '半高领',
];

const SLEEVE_VALUES = ['长袖', '短袖', '无袖', '七分袖', '五分袖'];

const THICKNESS_VALUES = ['加厚', '厚实', '适中', '偏薄', '薄款'];

const STRETCH_VALUES = ['无弹性', '微弹', '弹力', '高弹'];

const BREATHABILITY_VALUES = ['良好', '优秀', '一般', '适中', '透气'];

const SEASON_VALUES = ['春秋', '四季通用', '夏季', '秋冬', '冬季'];

const SCENE_VALUES = [
  '商务通勤', '日常休闲', '约会', '面试', '上班', '运动健身',
  '居家', '出行', '聚会', '通勤', '户外', '度假',
];

const SIZE_ADVICE_VALUES = [
  '建议按正常尺码购买', '建议买小一码', '建议买大一码',
  '正常尺码偏修身可选大一码', '偏大建议买小一码', '偏小建议买大一码',
];

// ── Registry ──

export const METADATA_SCHEMA: MetadataFieldSchema[] = [
  // ── Hard filters (never dropped) ──
  {
    name: 'category',
    type: 'string',
    description: '商品类目，如 衬衫、连衣裙、T恤、外套、卫衣',
    operators: ['eq', 'contains'],
    filterStrength: 'hard',
  },
  {
    name: 'brand',
    type: 'string',
    description: '品牌名称',
    operators: ['eq', 'contains'],
    filterStrength: 'hard',
  },
  // ── Soft numeric filters ──
  {
    name: 'price',
    type: 'number',
    description: '商品价格（元），metadata 中以 number 存储',
    operators: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between'],
    filterStrength: 'soft',
    fallbackPriority: 1,
  },
  {
    name: 'rating',
    type: 'number',
    description: '商品评分（0-5分），metadata 中以 number 存储',
    operators: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between'],
    filterStrength: 'soft',
    fallbackPriority: 2,
  },
  {
    name: 'stock',
    type: 'number',
    description: '库存数量',
    operators: ['gt', 'gte', 'eq'],
    filterStrength: 'soft',
    fallbackPriority: 3,
  },
  // ── Soft string filters with enum ──
  {
    name: 'material',
    type: 'string',
    description: '材质/面料',
    operators: ['eq', 'in', 'contains'],
    enumValues: MATERIAL_VALUES,
    filterStrength: 'soft',
    fallbackPriority: 4,
  },
  {
    name: 'fit',
    type: 'string',
    description: '版型/合身度',
    operators: ['eq', 'in'],
    enumValues: FIT_VALUES,
    filterStrength: 'soft',
    fallbackPriority: 5,
  },
  {
    name: 'collar',
    type: 'string',
    description: '领型',
    operators: ['eq', 'in'],
    enumValues: COLLAR_VALUES,
    filterStrength: 'soft',
    fallbackPriority: 6,
  },
  {
    name: 'sleeveLength',
    type: 'string',
    description: '袖长',
    operators: ['eq', 'in'],
    enumValues: SLEEVE_VALUES,
    filterStrength: 'soft',
    fallbackPriority: 7,
  },
  {
    name: 'thickness',
    type: 'string',
    description: '厚度',
    operators: ['eq', 'in'],
    enumValues: THICKNESS_VALUES,
    filterStrength: 'soft',
    fallbackPriority: 8,
  },
  {
    name: 'stretch',
    type: 'string',
    description: '弹性',
    operators: ['eq', 'in'],
    enumValues: STRETCH_VALUES,
    filterStrength: 'soft',
    fallbackPriority: 9,
  },
  {
    name: 'breathability',
    type: 'string',
    description: '透气性',
    operators: ['eq', 'in'],
    enumValues: BREATHABILITY_VALUES,
    filterStrength: 'soft',
    fallbackPriority: 10,
  },
  // ── Soft string[] filters (multi-value, historically may be stored as string) ──
  {
    name: 'season',
    type: 'string[]',
    description: '适用季节，可多选如 ["春","秋"]，metadata 中可能存为数组或单字符串如 "春秋"',
    operators: ['in', 'contains'],
    enumValues: SEASON_VALUES,
    filterStrength: 'soft',
    fallbackPriority: 11,
  },
  {
    name: 'scene',
    type: 'string[]',
    description: '适用场景，可多选如 ["上班","通勤"]，metadata 中可能存为数组或单字符串如 "商务通勤"',
    operators: ['in', 'contains'],
    enumValues: SCENE_VALUES,
    filterStrength: 'soft',
    fallbackPriority: 12,
  },
  {
    name: 'sizeAdvice',
    type: 'string',
    description: '尺码建议',
    operators: ['eq', 'contains'],
    enumValues: SIZE_ADVICE_VALUES,
    filterStrength: 'soft',
    fallbackPriority: 13,
  },
];

// ── Lookup helpers ──

const schemaByName = new Map<string, MetadataFieldSchema>();
for (const s of METADATA_SCHEMA) schemaByName.set(s.name, s);

export function getFieldSchema(name: string): MetadataFieldSchema | undefined {
  return schemaByName.get(name);
}

export function getAllFieldNames(): string[] {
  return METADATA_SCHEMA.map(s => s.name);
}

export function getHardFieldNames(): string[] {
  return METADATA_SCHEMA.filter(s => s.filterStrength === 'hard').map(s => s.name);
}
