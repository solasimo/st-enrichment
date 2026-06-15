import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('enriched_domains')
    .select('enriched_at')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const total = data.length

  // Group by year of enriched_at
  const byYear: Record<string, number> = {}
  data.forEach((row) => {
    const year = new Date(row.enriched_at).getFullYear().toString()
    byYear[year] = (byYear[year] || 0) + 1
  })

  // Sort years descending
  const byYearSorted = Object.entries(byYear)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([year, count]) => ({ year, count }))

  return NextResponse.json({ total, byYear: byYearSorted })
}
