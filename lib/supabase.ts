import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

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
  evaluated_at: string
}
