import type { MetadataRoute } from "next";

/**
 * PRD-04: the pilot is private (eight invited learners), so nothing in the app is offered to
 * search engines. The root layout adds the same intent as `noindex, nofollow`; this file covers
 * crawlers that read /robots.txt before fetching a page. Revisit when the pilot ends.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
