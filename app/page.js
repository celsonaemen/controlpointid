import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { envMissing, user, profile } = await getSessionProfile();

  if (envMissing || !user) {
    redirect("/login");
  }

  if (profile?.role === "admin") {
    redirect("/admin");
  }

  redirect("/ponto");
}
