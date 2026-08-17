import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import TopNav from '@/components/TopNav';
import StatsStrip from '@/components/StatsStrip';
import Rail from '@/components/Rail';
import StatusBar from '@/components/StatusBar';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.WEB_ORIGIN || 'http://localhost:3020'),
  title: 'VOLREAD — Multi-Chain Memecoin Volume Terminal',
  description:
    'Aggregate memecoin trading volume per chain — Solana, Ethereum, BNB Chain and Robinhood Chain. Live dominance, rotation, launchpad wars and flow alerts.',
  openGraph: {
    title: 'VOLREAD — Multi-Chain Memecoin Volume Terminal',
    description: 'Read the volume: aggregate memecoin trading volume per chain, live.',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#0b0d10',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.variable}>
        <TopNav />
        <StatsStrip />
        <div className="wrap">
          <div className="colmain">{children}</div>
          <Rail />
        </div>
        <StatusBar />
      </body>
    </html>
  );
}
