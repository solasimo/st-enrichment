import Anthropic from '@anthropic-ai/sdk'
import { CSV_TO_DB, LeadRow } from './csv'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function enrichDomain(
  domain: string,
  existingData: Partial<LeadRow>
): Promise<Record<string, string>> {
  const fieldsToFill = Object.keys(CSV_TO_DB).filter((f) => !existingData[f])

  if (fieldsToFill.length === 0) return {}

  const knownFields = Object.keys(CSV_TO_DB)
    .filter((f) => existingData[f])
    .map((f) => `  - ${f}: ${existingData[f]}`)
    .join('\n') || '  (none)'

  const prompt = `You are a B2B company research specialist helping STMicroelectronics enrich Salesforce lead data for digital marketing campaigns.

Research the company associated with the email domain "${domain}" and return structured data for the fields listed below.

Already known (do NOT override these):
${knownFields}

Fields to research and fill (only return these, omit if genuinely unknown):
${fieldsToFill.map((f) => `  - ${f}`).join('\n')}

Field definitions:
- company: Official company name
- company description: 2-3 sentence professional description of what the company does
- product description: What products or services they sell (focus on electronics/technology relevance if applicable)
- website: Full URL including https://
- company linkedin URL: Full LinkedIn company page URL
- company revenue: Annual revenue in USD (e.g. "$50M", "$1.2B", "< $10M")
- company industries: Comma-separated industry categories (e.g. "Industrial Automation, IoT, Consumer Electronics")
- company founding date: Year founded (e.g. "2003") or full date "YYYY-MM-DD"
- company employees: Headcount range or number (e.g. "500-1000", "~5000")
- company phone: Main office phone number with country code
- startup information: If a startup — funding stage, total funding raised, key investors. Leave blank if not a startup or unknown.

Respond ONLY with a valid JSON object. Keys must be exactly the field names listed above. Values must be strings. Omit fields that cannot be found. No explanation, no markdown, no preamble.

Example: {"company": "Acme Corp", "company revenue": "$120M", "company employees": "800-1200"}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (client.messages.create as any)({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }],
  })

  // Extract text blocks only (skip tool_use)
  const textBlocks = response.content.filter((b) => b.type === 'text')
  if (!textBlocks.length) throw new Error('No text response from Claude')

  const raw = textBlocks.map((b) => (b as { type: 'text'; text: string }).text).join('')
  const clean = raw.replace(/```json|```/g, '').trim()

  let parsed: Record<string, string>
  try {
    parsed = JSON.parse(clean)
  } catch {
    const match = clean.match(/\{[\s\S]*\}/)
    if (match) parsed = JSON.parse(match[0])
    else throw new Error('Could not parse Claude response as JSON')
  }

  // Only return fields that were requested and have values
  const result: Record<string, string> = {}
  fieldsToFill.forEach((f) => {
    if (parsed[f] && String(parsed[f]).trim()) {
      result[f] = String(parsed[f]).trim()
    }
  })

  return result
}
