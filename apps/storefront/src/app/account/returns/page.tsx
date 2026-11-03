import type { Metadata } from 'next';
import { ReturnsPage } from '@/components/account/returns';

export const metadata: Metadata = { title: 'Returns' };

export default function Page() {
  return <ReturnsPage />;
}
