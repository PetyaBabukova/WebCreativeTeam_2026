import { notFound } from "next/navigation";
import { BlogDetail } from "@/components/BlogContent";
import { blogArticleUrl } from "@/lib/routing";
import { getArticle } from "@/server/blog/service";
import { siteOrigin } from "@/lib/config";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const article = await getArticle((await params).slug, "en");
  if (!article?.locales.en) notFound();
  const text = article.locales.en;
  return { metadataBase: siteOrigin(), title: text.seoTitle, description: text.seoDescription, robots: { index: false, follow: false }, alternates: { canonical: blogArticleUrl(article.slug, "en"), languages: { bg: blogArticleUrl(article.slug, "bg"), en: blogArticleUrl(article.slug, "en") } }, openGraph: { title: text.seoTitle, description: text.seoDescription, images: [article.heroUrl] } };
}
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const article = await getArticle((await params).slug, "en");
  if (!article) notFound();
  return <BlogDetail locale="en" article={article} />;
}
