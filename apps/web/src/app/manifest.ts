import type { MetadataRoute } from 'next';
import { BRAND } from '@/lib/brand-art';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.shortName,
    description: BRAND.description,
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#F4F7FC',
    theme_color: BRAND.colors.navy,
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
