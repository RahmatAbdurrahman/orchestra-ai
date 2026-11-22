import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { OG_FONTS, OG_SIZE, ogCardElement } from '@/lib/og-card-element';

/** Renders the social preview card to a PNG. Used by the /og-image route at build time. */
export async function renderOgCard() {
  const fonts = await Promise.all(
    OG_FONTS.map(async ({ name, pkg, file, weight }) => ({
      name,
      weight,
      style: 'normal' as const,
      data: await readFile(join(process.cwd(), 'node_modules/@fontsource', pkg, 'files', file)),
    })),
  );
  return new ImageResponse(ogCardElement(), { ...OG_SIZE, fonts });
}
