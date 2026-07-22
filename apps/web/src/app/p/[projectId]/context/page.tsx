import { ProductProfilePage } from "./_product-profile";

interface ContextPageProps {
  readonly params: Promise<{ projectId: string }>;
}

export default async function ContextPage({ params }: ContextPageProps) {
  const { projectId } = await params;
  return <ProductProfilePage key={projectId} projectId={projectId} />;
}
