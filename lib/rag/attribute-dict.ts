export const CATEGORY_MAP: Record<string, string[]> = {
  '衬衫': ['衬衣', 'shirt', '正装衬衫', '休闲衬衫'],
  'T恤': ['t恤', 't-shirt', '短袖', 'tee', '文化衫'],
  '裤子': ['裤', '长裤', 'pants', 'trousers', '休闲裤', '西裤', '牛仔裤'],
  '外套': ['夹克', 'jacket', '大衣', '风衣', '羽绒服'],
  '裙子': ['裙', '连衣裙', '半身裙', 'skirt', 'dress'],
  '鞋子': ['鞋', '运动鞋', '皮鞋', '靴子', 'shoes'],
};

export const ATTRIBUTE_MAP: Record<string, { field: string; values: string[] }> = {
  '材质': {
    field: 'material',
    values: ['棉', '涤纶', '丝绸', '羊毛', '羊绒', '真皮', 'PU', '麻', '莫代尔', '氨纶', '锦纶', '牛仔'],
  },
  '颜色': {
    field: 'color',
    values: ['黑', '白', '红', '蓝', '灰', '绿', '黄', '粉', '紫', '棕', '卡其', '藏青', '米白'],
  },
  '版型': {
    field: 'fit',
    values: ['修身', '宽松', '直筒', '锥形', '阔腿', '紧身', 'oversize', '常规'],
  },
  '袖长': {
    field: 'sleeveLength',
    values: ['长袖', '短袖', '无袖', '七分袖', '五分袖'],
  },
  '领型': {
    field: 'collar',
    values: ['圆领', 'V领', '翻领', '立领', '方领', 'POLO领', '一字领'],
  },
  '场景': {
    field: 'scene',
    values: ['上班', '约会', '运动', '日常', '出行', '聚会', '面试', '居家', '户外'],
  },
  '季节': {
    field: 'season',
    values: ['春', '夏', '秋', '冬', '春秋', '四季通用'],
  },
};

export function extractAttributes(query: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [, { field, values }] of Object.entries(ATTRIBUTE_MAP)) {
    const matched: string[] = [];
    for (const v of values) {
      if (query.includes(v)) matched.push(v);
    }
    if (matched.length > 0) result[field] = matched;
  }
  return result;
}

export function extractCategory(query: string): string | null {
  for (const [, aliases] of Object.entries(CATEGORY_MAP)) {
    for (const alias of aliases) {
      if (query.includes(alias)) return alias;
    }
  }
  return null;
}
