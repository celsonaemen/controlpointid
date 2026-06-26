import { requireAdmin } from "@/lib/auth";
import AdminClient from "@/components/AdminClient";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { profile } = await requireAdmin();

  return <AdminClient adminProfile={profile} />;
}
