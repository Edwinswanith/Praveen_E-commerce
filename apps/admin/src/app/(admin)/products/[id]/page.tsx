import { ProductEditor } from '@/features/products/product-editor';

export const metadata = { title: 'Edit product' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductEditor productId={id} />;
}
