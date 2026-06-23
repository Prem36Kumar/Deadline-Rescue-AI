import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Deadline Rescue AI',
  description: 'Paste any message with a deadline. Get urgency score, action plan, and a ready-to-send message — instantly.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
