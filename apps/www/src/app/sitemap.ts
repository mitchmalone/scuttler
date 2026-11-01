import type { MetadataRoute } from 'next'

import { RELEASE, SITE_URL } from '@/lib/site'

// Static export: Next writes this once at build time.
export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(RELEASE.date)
  return [
    {
      url: `${SITE_URL}/`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/docs`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
  ]
}
