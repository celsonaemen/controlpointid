import LoginForm from "@/components/LoginForm";

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const inactive = params?.inactive === "1";
  const passwordChanged = params?.password_changed === "1";

  return <LoginForm inactive={inactive} passwordChanged={passwordChanged} />;
}
