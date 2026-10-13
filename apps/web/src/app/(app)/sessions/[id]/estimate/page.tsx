import { SessionMaterialPage } from "../sources/material-page";
export const dynamic = "force-dynamic";
/** Kept route: session progress now shares one page with the session material. */
export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SessionMaterialPage id={id} path={`/sessions/${id}/estimate`} />;
}
