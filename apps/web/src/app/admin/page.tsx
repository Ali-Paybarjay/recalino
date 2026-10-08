import { requireAdmin } from "../../server/auth/admin";
import { AdminPanel } from "../../ui/admin/AdminPanel";

export default async function AdminPage() {
  await requireAdmin("/admin");
  return <AdminPanel />;
}
