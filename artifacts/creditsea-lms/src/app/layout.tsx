import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../index.css';
import Providers from './providers';

export const metadata: Metadata = {
  title: 'CreditSea — Borrow with clarity',
  description: 'A clear, secure place to manage your CreditSea loan.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}
