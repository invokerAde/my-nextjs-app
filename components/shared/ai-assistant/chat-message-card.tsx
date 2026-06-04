'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Image from 'next/image';
import Link from 'next/link';
import type { ProductImageGroup } from '@/lib/rag/product-image';

// ── Helpers ──

function extractText(message: any): string {
  return message.parts
    ?.filter((p: any) => p.type === 'text')
    .map((p: any) => p.text)
    .join('') || '';
}

function extractProductImageGroups(message: any): ProductImageGroup[] {
  const dataParts = message.parts?.filter(
    (p: any) => p.type === 'data-product-images',
  ) || [];
  if (dataParts.length === 0) return [];
  return dataParts[0].productImageGroups || [];
}

// ── Safe URL check ──

function safeUrl(href: string): boolean {
  return /^https?:\/\//i.test(href) || href.startsWith('/');
}

// ── Markdown components ──

const markdownComponents: any = {
  a({ href, children }: any) {
    const url = typeof href === 'string' ? href : '';
    if (!safeUrl(url)) return <span>{children}</span>;
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-primary underline underline-offset-2"
      >
        {children}
      </a>
    );
  },
  code({ inline, className, children, ...props }: any) {
    if (inline) {
      return (
        <code className="rounded bg-muted px-1 py-0.5 text-xs" {...props}>
          {children}
        </code>
      );
    }
    return (
      <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
        <code className={className} {...props}>{children}</code>
      </pre>
    );
  },
  img({ src, alt }: any) {
    // Block raw HTML images — use ProductImageGroup instead
    return <span className="text-muted-foreground text-xs">[图片: {alt || src}]</span>;
  },
};

// ── Product image group component ──

function ProductImageCard({ group }: { group: ProductImageGroup }) {
  const content = (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        {group.name}
      </p>
      <div className="flex gap-2 overflow-x-auto">
        {group.images.map((img, i) => (
          <div
            key={i}
            className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md border"
          >
            <Image
              src={img.src}
              alt={img.alt}
              fill
              sizes="96px"
              className="object-cover"
            />
          </div>
        ))}
      </div>
    </div>
  );

  if (group.slug) {
    return (
      <Link href={`/product/${group.slug}`} target="_blank">
        {content}
      </Link>
    );
  }
  return content;
}

// ── Main component ──

export function ChatMessageCard({ message }: { message: any }) {
  const isUser = message.role === 'user';

  if (isUser) {
    const text = extractText(message);
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg bg-primary px-4 py-2 text-primary-foreground text-sm">
          {text}
        </div>
      </div>
    );
  }

  const text = extractText(message);
  const productImageGroups = extractProductImageGroups(message);

  return (
    <div className="space-y-2">
      {text && (
        <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_blockquote]:border-l-2 [&_blockquote]:border-muted [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {text}
          </ReactMarkdown>
        </div>
      )}

      {productImageGroups.map((group) => (
        <ProductImageCard key={group.productId} group={group} />
      ))}
    </div>
  );
}
