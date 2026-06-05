import Header from "@/components/shared/header";
import Footer from "@/components/footer";
import { AiAssistantTrigger } from '@/components/shared/ai-assistant/ai-assistant-trigger';
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex h-screen flex-col">
        <Header />
        <main className="flex-1 wrapper">{children}</main>
        <Footer />
        <AiAssistantTrigger />
    </div>
  );
}
