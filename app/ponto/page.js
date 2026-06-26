import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import PontoClient from "@/components/PontoClient";

export const dynamic = "force-dynamic";

export default async function PontoPage() {
  const { user, profile } = await requireUser();

  if (profile?.role === "admin") {
    redirect("/admin");
  }

  return <PontoClient userId={user.id} initialProfile={profile} />;
}
