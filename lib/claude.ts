import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ST local presence by country code
const ST_PRESENCE: Record<string, string> = {
  IT: 'Italy: manufacturing and R&D in Agrate Brianza and Catania (SiC)',
  FR: 'France: HQ area Geneva/Crolles, R&D and manufacturing in Grenoble and Crolles',
  DE: 'Germany: sales and application engineering in Munich',
  US: 'United States: offices in Dallas and San Jose',
  CN: 'China: presence in Shenzhen, Shanghai, Beijing',
  JP: 'Japan: offices in Tokyo and Osaka',
  IN: 'India: R&D in Noida and Bangalore',
  GB: 'United Kingdom: offices in Bristol',
  SG: 'Singapore: Asia-Pacific hub',
  MY: 'Malaysia: manufacturing in Muar',
  MO: 'Morocco: manufacturing in Bouskoura',
  MT: 'Malta: manufacturing site',
  PH: 'Philippines: manufacturing in Calamba',
}

// ST portfolio knowledge base for good fit evaluation
const ST_PORTFOLIO = `
STMicroelectronics (ST) is a global semiconductor IDM. Its customers are companies that DESIGN or MANUFACTURE electronic products embedding ST chips. ST does NOT sell to end consumers, pure software companies, retailers, or service companies.

PRODUCT FAMILIES:
1. MCU/MPU — STM32 (32-bit ARM Cortex-M, 1000+ variants: mainstream/ultra-low-power/high-performance/wireless/MPU), STM8 (8-bit entry), SPC5/Stellar (automotive ASIL-ready), STM32MP (Linux-capable MPU)
2. Power & Discrete — SiC MOSFET/diodes (STPOWER, top-3 global market share; target: EV inverters, OBC, solar, industrial drives, EV charging stations), GaN ICs (VIPerGaN, MASTERGAN; target: fast chargers, SMPS, data centers), MOSFET (MDmesh super-junction; target: UPS, server PSU, telecom), IGBT (traction, industrial), Gate drivers (STGAP), Thyristors/Triacs (appliances, HVAC, dimming)
3. Motor Drivers — STSPIN (stepper, brushed DC, BLDC from IoT to industrial), L6xxx (classic automation), IPM (pumps, compressors, HVAC)
4. Power Management ICs — AC-DC (Viper), DC-DC converters, Battery management (wearables, IoT), PMIC (automotive, mobile), LED drivers (automotive, lighting)
5. MEMS & Sensors — IMU/accelerometer/gyroscope (LSM6DS, world #1 by volume), magnetometer, pressure (LPS22), MEMS microphones, temperature/humidity, Time-of-Flight (VL53L, FlightSense for robotics/phones/domotics), ISPU (edge AI in sensor)
6. Analog & Mixed Signal — Op-amps, ADC/DAC, audio amplifiers Class D/AB, RS-485/CAN/LIN transceivers, current sensing, ESD/TVS protection
7. Connectivity & RF — BLE/Zigbee/Thread/LoRa (integrated in STM32WB/WL), NFC/RFID (ST25 tags/readers/secure elements for payments, logistics, luxury, pharma, automotive), Secure MCU (ST33 for SIM, banking, TPM, IoT security)
8. Automotive-specific — ECU/body control ICs, AEC-Q100 qualified portfolio, SiC for EV traction and OBC, ADAS vision/radar, LIN/CAN transceivers, automotive LED drivers

TARGET END MARKETS (good fit customers):
- Automotive Tier-1 and OEM: ECU, ADAS, EV powertrain, body electronics, lighting
- Industrial automation: PLC, servo drives, CNC, robots, inverters, factory automation
- Energy & Power: solar inverters, EV chargers, UPS, smart meters, power supplies
- IoT & Smart building: connected devices, building automation, HVAC, smart home
- Consumer electronics & Wearables: fitness trackers, smartwatches, smart appliances
- Medical devices: embedded diagnostics, wearable medical, patient monitoring
- Telecom / 5G infrastructure: base stations, RF power
- Data center / AI computing: GaN-based power delivery, server PSU

NOT A CUSTOMER (rejection triggers):
- Semiconductor companies (competitors): Infineon, NXP, Renesas, TI, Microchip, onsemi, etc.
- Pure EMS/CM (contract manufacturers with no design activity): Foxconn, Jabil, Flextronics
- Distributors of electronic components: Avnet, Arrow, DigiKey, Mouser, Farnell, TTI, etc.
- ST itself or ST subsidiaries
- Pure software / SaaS / cloud companies with no embedded hardware
- Consulting, legal, finance, HR, marketing agencies
- Retailers, e-commerce, media, publishing, food, fashion, real estate
- Universities, research institutes, schools, student organizations, IEEE chapters
`

const SEARCH_FIELDS = [
  'company', 'company description', 'product description', 'website',
  'company linkedin URL', 'company revenue', 'company industries',
  'company founding date', 'company employees', 'company phone', 'startup information',
]

// ── Step 1: Web search ────────────────────────────────────────────────────────

async function collectRawData(domain: string, company: string, country: string): Promise<string> {
  const countryCtx = country && ST_PRESENCE[country.toUpperCase()]
    ? ` The lead is from ${country} (ST presence: ${ST_PRESENCE[country.toUpperCase()]}).`
    : ''

  const prompt = `Research the company at domain "${domain}"${company ? ` (company: ${company})` : ''}.${countryCtx}

Find: official name, what the company does, products/services they sell, website URL, LinkedIn company URL, annual revenue, main industries, founding year, total employee count, main office phone, startup/funding info if applicable.

If the company has local presence in the lead's country, note it specifically.

Also note: is this domain a university/school/research institute? Does the website exist and appear active and professional?

Return a concise factual summary with all data found.`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (client.messages.create as any)({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }],
  })

  const content = response.content as Array<{ type: string; text?: string }>
  return content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
}

// ── Step 2: Structure into CRM fields ─────────────────────────────────────────

async function structureData(
  rawData: string,
  fieldsToFill: string[],
  country: string
): Promise<Record<string, string>> {
  const countryCtx = country ? ` Lead country: ${country}.` : ''

  const fieldSpecs = fieldsToFill.map((f) => {
    switch (f) {
      case 'company':               return '- company: official name, max 255 chars'
      case 'company description':   return `- company description: 1-2 sentences on what company does${country ? `, mention local presence in ${country} if any` : ''}, max 255 chars`
      case 'product description':   return '- product description: products/services sold, focus on electronics/tech relevance, max 500 chars'
      case 'website':               return '- website: full URL with https://'
      case 'company linkedin URL':  return '- company linkedin URL: full LinkedIn company page URL'
      case 'company revenue':       return '- company revenue: annual revenue as plain integer in USD, no symbols or text (e.g. 49000000)'
      case 'company industries':    return '- company industries: 2-3 core industry types comma-separated; industry the company BELONGS TO, not markets it serves (e.g. "Semiconductor Manufacturing" not "Automotive"); max 255 chars'
      case 'company founding date': return '- company founding date: 4-digit year only (e.g. 2003)'
      case 'company employees':     return '- company employees: total headcount as plain integer, no symbols or text (e.g. 5000)'
      case 'company phone':         return '- company phone: main office number in international format, no spaces (e.g. +41229292929)'
      case 'startup information':   return '- startup information: funding stage, total raised, key investors if startup; empty string if not a startup'
      default: return `- ${f}`
    }
  }).join('\n')

  const prompt = `You are a CRM data formatter for STMicroelectronics.${countryCtx}

Source data:
${rawData}

Extract and format ONLY the following fields. Return a JSON object with these exact keys. Omit fields not found. No markdown, no explanation.

${fieldSpecs}`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')

  return parseJSON(text, fieldsToFill)
}

// ── Step 3: Good fit evaluation ───────────────────────────────────────────────

async function evaluateFit(
  companyData: Record<string, string>,
  rawData: string,
  country: string
): Promise<{ 'good fit': string; 'good fit notes': string; 'rejection reason': string }> {
  const ctx = Object.entries(companyData)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')

  const stCtx = country && ST_PRESENCE[country.toUpperCase()]
    ? `\nLead country: ${country}. ST presence: ${ST_PRESENCE[country.toUpperCase()]}.`
    : ''

  const prompt = `You are a senior sales analyst at STMicroelectronics evaluating whether a company is a good potential customer.${stCtx}

${ST_PORTFOLIO}

COMPANY DATA:
${ctx}

ADDITIONAL RESEARCH NOTES:
${rawData}

EVALUATION RULES — check in this exact order and stop at the first match:

1. UNIVERSITY OR STUDENT CHECK
   Is the domain a university, college, polytechnic, high school, research institute, student association, or professional association (e.g. IEEE)?
   → If YES: good fit = NO, rejection reason = "University or Student"

2. INACCURATE DATA CHECK
   Based on research notes: was the corporate website not found, inactive, under maintenance, missing https, visually outdated/broken, or extremely slow? Is critical company info (name, what they do) missing or contradictory?
   → If YES: good fit = NO, rejection reason = "Inaccurate data"

3. NOT RIGHT COMPANY FIT CHECK
   Is this company a semiconductor competitor (Infineon, NXP, TI, Microchip, onsemi, Renesas, etc.), a pure distributor of electronic components (Avnet, Arrow, DigiKey, etc.), ST itself, a pure EMS/contract manufacturer with no design, a pure software/SaaS company, a consulting/legal/finance/HR/marketing agency, a retailer, media company, food/fashion/real estate brand, or any company that clearly does not design or manufacture electronic products?
   → If YES: good fit = NO, rejection reason = "Not right company fit"

4. ST PRODUCTS DON'T FIT CHECK
   The company appears to be an OEM or manufacturer of some product, but looking at their actual products/applications, ST's portfolio (MCUs, SiC, GaN, MOSFET, motor drivers, MEMS sensors, power management ICs, NFC/RFID, secure MCUs) would not realistically be used in what they design or make. Examples: a company making purely mechanical products, pure chemical products, pure textile machinery with no embedded electronics, pure content/media production equipment at software level only.
   → If YES: good fit = NO, rejection reason = "ST products don't fit"

5. If none of the above apply:
   → good fit = YES, rejection reason = "" (empty string)

Return a JSON object with exactly these three keys:
- "good fit": "YES" or "NO"
- "good fit notes": if YES — 2 sentences max on which ST product families are relevant and why (be specific: name product families like STM32, SiC MOSFET, STSPIN, MEMS IMU, etc.); if NO — 1 sentence confirming the rejection reason
- "rejection reason": one of "University or Student" | "Inaccurate data" | "Not right company fit" | "ST products don't fit" | "" (empty if YES)

No markdown, no explanation outside the JSON.`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')

  const parsed = parseJSON(text, ['good fit', 'good fit notes', 'rejection reason'])
  return {
    'good fit': parsed['good fit'] || '',
    'good fit notes': parsed['good fit notes'] || '',
    'rejection reason': parsed['rejection reason'] || '',
  }
}

// ── Public: full enrichment ───────────────────────────────────────────────────

export async function enrichDomain(
  domain: string,
  existingData: Record<string, string>
): Promise<Record<string, string>> {
  const company = existingData['company'] || ''
  const country = (existingData['country'] || '').toUpperCase()
  const fieldsToFill = SEARCH_FIELDS.filter((f) => !existingData[f])

  const rawData = await collectRawData(domain, company, country)
  const structured = fieldsToFill.length > 0 ? await structureData(rawData, fieldsToFill, country) : {}
  const companyContext = { ...existingData, ...structured }
  const fit = await evaluateFit(companyContext, rawData, country)

  return { ...structured, ...fit }
}

// ── Public: good fit only (domain in cache) ───────────────────────────────────

export async function evaluateGoodFit(
  cachedData: Record<string, string>,
  country: string
): Promise<Record<string, string>> {
  return evaluateFit(cachedData, '', country.toUpperCase())
}

// ── Helper ────────────────────────────────────────────────────────────────────

function parseJSON(text: string, expectedKeys: string[]): Record<string, string> {
  const clean = text.replace(/```json|```/g, '').trim()
  let parsed: Record<string, string> = {}
  try {
    parsed = JSON.parse(clean)
  } catch {
    const match = clean.match(/\{[\s\S]*\}/)
    if (match) {
      try { parsed = JSON.parse(match[0]) } catch { return {} }
    } else return {}
  }

  const result: Record<string, string> = {}
  expectedKeys.forEach((k) => {
    if (parsed[k] !== undefined && parsed[k] !== null) {
      result[k] = String(parsed[k]).trim()
    }
  })
  return result
}
