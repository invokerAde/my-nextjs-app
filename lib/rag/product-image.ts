/** Product image data extracted from retrieval metadata for UI rendering */

export interface ProductImage {
  src: string;
  alt: string;
}

export interface ProductImageGroup {
  productId: string;
  slug: string;
  name: string;
  images: ProductImage[];
  source?: string;
  score?: number;
}

/**
 * Extract deduplicated product image groups from retrieval hits.
 * Max `maxGroups` groups, each with at most `maxImagesPerGroup` images.
 */
export function extractProductImages(
  hits: { metadata?: Record<string, unknown>; source?: string; score?: number }[],
  maxGroups = 3,
  maxImagesPerGroup = 4,
): ProductImageGroup[] {
  const seen = new Set<string>();
  const groups: ProductImageGroup[] = [];

  for (const hit of hits) {
    if (groups.length >= maxGroups) break;

    const meta = hit.metadata || {};
    const productId = meta.productId as string | undefined;
    const slug = meta.slug as string | undefined;
    const name = meta.name as string | undefined;
    const images = meta.images as string[] | undefined;

    if (!productId || !slug || !name || !images || images.length === 0) continue;
    if (seen.has(productId)) continue;
    seen.add(productId);

    const safeImages = images
      .filter(src => typeof src === 'string' && (
        src.startsWith('/images/') ||
        src.startsWith('https://utfs.io/') ||
        src.startsWith('https://')
      ))
      .slice(0, maxImagesPerGroup)
      .map(src => ({ src, alt: name }));

    if (safeImages.length === 0) continue;

    groups.push({
      productId,
      slug,
      name,
      images: safeImages,
      source: hit.source,
      score: hit.score,
    });
  }

  return groups;
}
