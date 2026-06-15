import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'ST Lead Enrichment',
  description: 'Internal lead enrichment tool for STMicroelectronics digital marketing teams',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  )
}
