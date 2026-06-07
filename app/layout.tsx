import type { Metadata } from "next";
import localFont from "next/font/local";
import "@/assets/styles/globals.css";
import { APP_DESCRIPTION, APP_NAME, SERVER_URL } from "@/lib/constants";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { SpeedInsights } from "@vercel/speed-insights/next";

const inter = localFont({
  src: [
    { path: "../assets/fonts/inter-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../assets/fonts/inter-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../assets/fonts/inter-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../assets/fonts/inter-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    template: `%s | Prostore`,
    default: APP_NAME,
  },
  description: APP_DESCRIPTION,
  metadataBase: new URL(SERVER_URL),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster   position="bottom-right"/>
          <SpeedInsights />
        </ThemeProvider>
      </body>
    </html>
  );
}
