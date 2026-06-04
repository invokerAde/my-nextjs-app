/**
 * Extracts hard (precisely filterable) product attributes from spec JSON
 * or product detail text. These attributes are used in metadata filtering.
 *
 * Soft/descriptive attributes (highlights, limitations, care instructions, etc.)
 * remain in the vectorized text only and are NOT extracted here.
 */

export interface HardAttributes {
  material?: string;
  fit?: string;
  collar?: string;
  sleeveLength?: string;
  thickness?: string;
  stretch?: string;
  breathability?: string;
  season?: string;
  scene?: string;
  sizeAdvice?: string;
}

const MATERIAL_VALUES = [
  '纯棉', '棉涤混纺', '牛津纺', '府绸', '竹纤维混纺', '棉', '涤纶',
  '真皮', 'PU皮', '羊毛', '羊绒', '亚麻', '丝绸', '莫代尔', '莱赛尔',
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

function findInText(text: string, candidates: string[]): string | undefined {
  for (const c of candidates) {
    if (text.includes(c)) return c;
  }
  return undefined;
}

/**
 * Extract hard attributes from spec JSON (e.g., ProductSpec.specs or metadata.specs).
 */
export function extractFromSpec(specs: Record<string, unknown>): HardAttributes {
  const attrs: HardAttributes = {};
  const s = (v: unknown) => (typeof v === 'string' ? v : '');

  const material = s(specs.material);
  if (material) attrs.material = findInText(material, MATERIAL_VALUES) || material;

  const fit = s(specs.fit);
  if (fit) attrs.fit = findInText(fit, FIT_VALUES) || fit;

  const collar = s(specs.collar);
  if (collar) attrs.collar = findInText(collar, COLLAR_VALUES) || collar;

  const sleeve = s(specs.sleeve_length);
  if (sleeve) attrs.sleeveLength = findInText(sleeve, SLEEVE_VALUES) || sleeve;

  const thickness = s(specs.thickness);
  if (thickness) attrs.thickness = findInText(thickness, THICKNESS_VALUES) || thickness;

  const stretch = s(specs.stretch);
  if (stretch) attrs.stretch = findInText(stretch, STRETCH_VALUES) || stretch;

  const breath = s(specs.breathability);
  if (breath) attrs.breathability = findInText(breath, BREATHABILITY_VALUES) || breath;

  const season = s(specs.season);
  if (season) attrs.season = findInText(season, SEASON_VALUES) || season;

  const scene = s(specs.occasion) || s(specs.scene);
  if (scene) attrs.scene = findInText(scene, SCENE_VALUES) || scene;

  const sizeAdvice = s(specs.size_advice) || s(specs.sizeAdvice);
  if (sizeAdvice) attrs.sizeAdvice = findInText(sizeAdvice, SIZE_ADVICE_VALUES) || sizeAdvice;

  return attrs;
}

/**
 * Extract hard attributes from free-text product detail content.
 * Uses keyword matching against known attribute values.
 */
export function extractFromText(text: string): HardAttributes {
  const attrs: HardAttributes = {};

  const material = findInText(text, MATERIAL_VALUES);
  if (material) attrs.material = material;

  const fit = findInText(text, FIT_VALUES);
  if (fit) attrs.fit = fit;

  const collar = findInText(text, COLLAR_VALUES);
  if (collar) attrs.collar = collar;

  const sleeve = findInText(text, SLEEVE_VALUES);
  if (sleeve) attrs.sleeveLength = sleeve;

  const thickness = findInText(text, THICKNESS_VALUES);
  if (thickness) attrs.thickness = thickness;

  const stretch = findInText(text, STRETCH_VALUES);
  if (stretch) attrs.stretch = stretch;

  const breath = findInText(text, BREATHABILITY_VALUES);
  if (breath) attrs.breathability = breath;

  const season = findInText(text, SEASON_VALUES);
  if (season) attrs.season = season;

  const scene = findInText(text, SCENE_VALUES);
  if (scene) attrs.scene = scene;

  const sizeAdvice = findInText(text, SIZE_ADVICE_VALUES);
  if (sizeAdvice) attrs.sizeAdvice = sizeAdvice;

  return attrs;
}

/**
 * Extract hard attributes from either spec JSON or text content.
 * Spec takes priority for fields it provides; text fills in the rest.
 */
export function extractAttributes(
  text: string,
  specs?: Record<string, unknown>,
): HardAttributes {
  const textAttrs = extractFromText(text);
  if (!specs) return textAttrs;

  const specAttrs = extractFromSpec(specs);

  // Spec wins where defined, text fills gaps
  return { ...textAttrs, ...specAttrs };
}
