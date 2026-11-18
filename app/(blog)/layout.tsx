import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";

// The blog, its authors' pages and the editorial policy: public and static, refreshed by tag
// when /write publishes (lib/blog/registry.ts). The guides' header and footer, plus "Blog"
// beside the wordmark.
export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header subpage blog />
      <main>{children}</main>
      <Footer guides />
    </>
  );
}
