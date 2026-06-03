export const SYNONYM_MAP: Record<string, string[]> = {
  '透气': ['透气性', '通风', '透汗', '散热'],
  '保暖': ['保温', '保暖性', '御寒', '厚实'],
  '舒适': ['柔软', '亲肤', '贴身穿', '舒服'],
  '耐磨': ['耐穿', '耐洗', '不起球', '不缩水', '不变形'],
  '显瘦': ['遮肉', '修身', '苗条', '显身材'],
  '便宜': ['实惠', '划算', '高性价比', '不贵'],
  '高档': ['高级', '有质感', '上档次', '精致', '奢华'],
};

export function expandQuery(query: string): string {
  let expanded = query;
  for (const [term, synonyms] of Object.entries(SYNONYM_MAP)) {
    if (query.includes(term)) {
      expanded += ' ' + synonyms.join(' ');
    }
  }
  return expanded;
}
