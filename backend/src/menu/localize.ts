import { Prisma } from '@prisma/client';

type Translatable = { name: string; description?: string | null; translations?: Prisma.JsonValue | null };

/** Áp bản dịch theo ngôn ngữ (FR-ADM-10); thiếu bản dịch thì giữ tiếng Việt */
export function localize<T extends Translatable>(entity: T, lang?: string): Omit<T, 'translations'> {
  const { translations, ...rest } = entity;
  let t: { name?: string; description?: string } | undefined;
  if (lang && translations && typeof translations === 'object' && !Array.isArray(translations)) {
    t = (translations as Record<string, { name?: string; description?: string }>)[lang];
  }
  return {
    ...rest,
    name: t?.name ?? entity.name,
    description: t?.description ?? entity.description ?? null,
  } as Omit<T, 'translations'>;
}
