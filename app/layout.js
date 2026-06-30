import { SpeedInsights } from "@vercel/speed-insights/next";
import AccessTracker from "@/components/AccessTracker";
import ThemeToggle from "@/components/ThemeToggle";
import "./globals.css";

export const metadata = {
  title: "Sistema de Ponto",
  description: "Controle de ponto com acesso de funcionarios e administradores",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>
        <AccessTracker />
        <ThemeToggle />
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
