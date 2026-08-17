import { notFound } from 'next/navigation';
import { isChainCode } from '@voldeck/shared';
import DetailScreen from '@/components/DetailScreen';

export default function ChainPage({ params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  if (!isChainCode(code)) notFound();
  return <DetailScreen code={code} />;
}
