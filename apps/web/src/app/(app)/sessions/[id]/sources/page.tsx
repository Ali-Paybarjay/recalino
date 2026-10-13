import { SessionMaterialPage } from "./material-page";
export const dynamic = "force-dynamic";
export default async function SourcesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SessionMaterialPage id={id} path={`/sessions/${id}/sources`} />;
}
