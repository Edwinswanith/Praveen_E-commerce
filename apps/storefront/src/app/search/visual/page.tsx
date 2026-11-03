import type { Metadata } from 'next';
import { Container } from '@/components/ui/page-header';
import { VisualSearch } from '@/components/listing/visual-search';

export const metadata: Metadata = {
  title: 'Visual search',
  description: 'Upload or snap a photo to find similar styles at VYRA.',
  robots: { index: false },
};

export default function VisualSearchPage() {
  return (
    <Container className="py-6">
      <VisualSearch />
    </Container>
  );
}
