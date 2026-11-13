import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";

// The guide pages: public, static, one search intent each (lib/seo.ts lists them).
// Same header and footer as the landing page, with links home and between guides.
export default function GuidesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header subpage />
      <main>{children}</main>
      <Footer guides />
    </>
  );
}
