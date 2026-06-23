import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

export interface EnrichedDomain {
  email_domain: string
  company: string | null
  company_description: string | null
  product_description: string | null
  website: string | null
  company_linkedin_url: string | null
  company_revenue: string | null
  company_industries: string | null
  company_founding_date: string | null
  company_employees: string | null
  company_phone: string | null
  startup_information: string | null
  enriched_at: string
}

export interface GoodFitCache {
  email_domain: string
  country: string
  good_fit: string | null
  good_fit_notes: string | null
  rejection_reason: string | null
  evaluated_at: string
}

export async function getDomain(domain: string): Promise<EnrichedDomain | null> {
  const rows = await sql`SELECT * FROM enriched_domains WHERE email_domain = ${domain} LIMIT 1`
  return (rows[0] as EnrichedDomain) || null
}

export async function upsertDomain(row: Record<string, string | null>): Promise<void> {
  await sql`
    INSERT INTO enriched_domains (
      email_domain, company, company_description, product_description,
      website, company_linkedin_url, company_revenue, company_industries,
      company_founding_date, company_employees, company_phone, startup_information
    ) VALUES (
      ${row.email_domain}, ${row.company}, ${row.company_description}, ${row.product_description},
      ${row.website}, ${row.company_linkedin_url}, ${row.company_revenue}, ${row.company_industries},
      ${row.company_founding_date}, ${row.company_employees}, ${row.company_phone}, ${row.startup_information}
    )
    ON CONFLICT (email_domain) DO UPDATE SET
      company = EXCLUDED.company,
      company_description = EXCLUDED.company_description,
      product_description = EXCLUDED.product_description,
      website = EXCLUDED.website,
      company_linkedin_url = EXCLUDED.company_linkedin_url,
      company_revenue = EXCLUDED.company_revenue,
      company_industries = EXCLUDED.company_industries,
      company_founding_date = EXCLUDED.company_founding_date,
      company_employees = EXCLUDED.company_employees,
      company_phone = EXCLUDED.company_phone,
      startup_information = EXCLUDED.startup_information,
      enriched_at = now()
  `
}

export async function updateDomain(domain: string, fields: Record<string, string | null>): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined)
  if (!entries.length) return
  await sql(
    `UPDATE enriched_domains SET ${entries.map((_, i) => `${entries[i][0]} = $${i + 2}`).join(', ')} WHERE email_domain = $1`,
    [domain, ...entries.map(([, v]) => v)]
  )
}

export async function searchDomains(q: string): Promise<EnrichedDomain[]> {
  const pattern = `%${q}%`
  const rows = await sql`
    SELECT * FROM enriched_domains
    WHERE email_domain ILIKE ${pattern} OR company ILIKE ${pattern}
    ORDER BY enriched_at DESC LIMIT 20
  `
  return rows as EnrichedDomain[]
}

export async function getStats(): Promise<{ total: number; byYear: { year: string; count: number }[] }> {
  const rows = await sql`
    SELECT EXTRACT(YEAR FROM enriched_at)::text AS year, COUNT(*)::int AS count
    FROM enriched_domains GROUP BY year ORDER BY year DESC
  `
  const total = rows.reduce((sum, r) => sum + (r.count as number), 0)
  return { total, byYear: rows.map((r) => ({ year: r.year as string, count: r.count as number })) }
}

export async function getGoodFit(domain: string, country: string): Promise<GoodFitCache | null> {
  const rows = await sql`
    SELECT * FROM good_fit_cache WHERE email_domain = ${domain} AND country = ${country} LIMIT 1
  `
  return (rows[0] as GoodFitCache) || null
}

export async function upsertGoodFit(
  domain: string, country: string,
  goodFit: string, goodFitNotes: string, rejectionReason: string
): Promise<void> {
  await sql`
    INSERT INTO good_fit_cache (email_domain, country, good_fit, good_fit_notes, rejection_reason)
    VALUES (${domain}, ${country}, ${goodFit}, ${goodFitNotes}, ${rejectionReason})
    ON CONFLICT (email_domain, country) DO UPDATE SET
      good_fit = EXCLUDED.good_fit,
      good_fit_notes = EXCLUDED.good_fit_notes,
      rejection_reason = EXCLUDED.rejection_reason,
      evaluated_at = now()
  `
}

export async function getGoodFitForDomains(domains: string[]): Promise<GoodFitCache[]> {
  if (!domains.length) return []
  const rows = await sql`SELECT * FROM good_fit_cache WHERE email_domain = ANY(${domains})`
  return rows as GoodFitCache[]
}
