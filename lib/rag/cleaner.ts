/**
 * Review text cleaner for AI Shopping Assistant RAG system.
 *
 * Processes raw review text into clean, signal-rich sentences suitable for
 * embedding and retrieval. Discards noise (logistics, emotions, short filler)
 * and keeps substantive feedback about the product itself.
 */

// Characters/patterns that indicate a sentence is pure symbols or noise
const PURE_SYMBOLS_RE = /^[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~，。！？；：、…「」『』【】《》〈〉〔〕〝〟]+$/u;

// Emoji ranges (broad coverage including skin tones, flags, etc.)
const PURE_EMOJI_RE = /^(?:\p{Emoji_Presentation}|\p{Emoji}️|\p{Extended_Pictographic}|\s)+$/u;

// ── Noise patterns ──────────────────────────────────────────────────────────

const NOISE_PATTERNS: RegExp[] = [
  // Logistics / delivery
  /快递|物流|发货|配送|送货|运输|包装|拆开|签收|快递员|收到|到货|送达/i,
  /delivery|shipping|arrived|packaging|package|box|unbox/i,

  // Pure emotion with no product signal
  /^(好|很好|非常好|太好了|太棒了|不错|还行|一般|差|很差|极差|垃圾|赞|大赞|好评|差评)$/,
  /^(喜欢|不喜欢|满意|不满意|开心|失望|生气|愤怒|无语|无奈)$/,
  /^(great|good|bad|terrible|awesome|amazing|love it|hate it|nice|wow)[!！]*$/i,

  // Customer service related
  /客服|售后|服务态度|退换货|退货|换货|退款|投诉|商家|店铺|店主/i,
  /customer service|support|refund|return|exchange|seller/i,

  // Price-only comments
  /^(便宜|贵|实惠|太贵了|性价比|价格|价钱)[!！。.]*$/i,
  /^(cheap|expensive|price|pricing|cost|worth it)[!！。.]*$/i,

  // Generic short praise (no specific product detail)
  /^(推荐|值得|还行吧|还可以|凑合|能用|挺好的|还行|一般般)[!！。.]*$/i,
];

// ── Signal patterns ──────────────────────────────────────────────────────────

const SIGNAL_PATTERNS: RegExp[] = [
  // Fit / sizing
  /合身|尺码|大小|尺寸|宽松|紧身|修身|偏大|偏小|正好|合适|fit|size|sizing|tight|loose|snug/i,

  // Fabric / material
  /面料|材质|布料|棉|麻|丝|羊毛|羊绒|皮革|牛仔|透气|柔软|舒适|手感|fabric|material|cotton|wool|leather|denim|silk|linen|soft/i,

  // Workmanship / quality
  /做工|工艺|品质|质量|细节|走线|缝线|线头|瑕疵|结实|耐用|耐磨|workmanship|quality|stitching|durable|craftsmanship/i,

  // Color / appearance
  /颜色|色彩|款式|设计|外观|好看|漂亮|时尚|百搭|显瘦|显白|color|design|style|look|appearance|beautiful|stylish/i,

  // Comfort / feel
  /舒适|舒服|透气|保暖|轻薄|厚重|轻便|穿着|体验|肤感/iu,
  /comfortable|breathable|warm|lightweight|heavy|feel|wear/i,

  // Scene / occasion
  /日常|上班|通勤|运动|户外|旅行|聚会|约会|面试|正式|休闲/iu,
  /daily|causal|office|work|sport|outdoor|travel|party|formal|occasion/i,

  // Cut / silhouette
  /版型|剪裁|线条|轮廓|领口|袖口|下摆|腰身|显高|版型|cuts|silhouette|neckline|cuff|hem|waist/i,

  // Durability / longevity
  /耐用|耐穿|不变形|不褪色|不起球|不缩水|不掉色|经穿/iu,
  /durable|lasting|fade|shrink|pill|stretch out|hold up|wash/i,
];

/**
 * Returns true if the sentence contains at least one signal keyword.
 */
function hasSignal(text: string): boolean {
  return SIGNAL_PATTERNS.some((re) => re.test(text));
}

/**
 * Returns true if the sentence is dominated by noise keywords.
 * A sentence is "noise-dominated" if it matches any noise pattern.
 */
function isNoise(text: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(text));
}

/**
 * Trims whitespace, zero-width characters, and punctuation bookends.
 */
function trimSentence(s: string): string {
  return s.replace(/^[\s​﻿.,;:!?]+|[\s​﻿.,;:!?]+$/g, '').trim();
}

/**
 * Clean a single review text and return an array of valid, signal-rich sentences.
 *
 * @param text - Raw review text
 * @returns Array of cleaned sentences, or null if no valid sentences remain
 */
export function cleanReviewText(text: string): string[] | null {
  // Guard: non-string
  if (typeof text !== 'string') return null;

  const trimmed = text.trim();

  // Discard empty / too short
  if (trimmed.length < 5) return null;

  // Discard pure symbols
  if (PURE_SYMBOLS_RE.test(trimmed)) return null;

  // Discard pure emoji
  if (PURE_EMOJI_RE.test(trimmed)) return null;

  // Split by sentence separators
  const rawSentences = trimmed.split(/[。！？.!?;；\n]+/);

  const cleaned = rawSentences
    .map(trimSentence)
    .filter((s) => {
      // Drop empty after trimming
      if (s.length === 0) return false;
      // Drop too short
      if (s.length < 5) return false;
      // Drop pure symbols / emoji
      if (PURE_SYMBOLS_RE.test(s)) return false;
      if (PURE_EMOJI_RE.test(s)) return false;
      // Drop noise-dominated sentences (unless they also have signal)
      if (isNoise(s) && !hasSignal(s)) return false;
      return true;
    });

  if (cleaned.length === 0) return null;

  return cleaned;
}
