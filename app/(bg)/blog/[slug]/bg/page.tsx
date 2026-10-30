import { notFound } from "next/navigation";
import { BlogDetail } from "@/components/BlogContent";
import { blogArticleUrl } from "@/lib/routing";
import { getArticle } from "@/server/blog/service";
import { siteOrigin } from "@/lib/config";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const article = await getArticle((await params).slug, "bg");
  if (!article) notFound();
  const text = article.locales.bg;
  return { metadataBase: siteOrigin(), title: text.seoTitle, description: text.seoDescription, robots: { index: false, follow: false }, alternates: { canonical: blogArticleUrl(article.slug, "bg"), languages: article.locales.en ? { bg: blogArticleUrl(article.slug, "bg"), en: blogArticleUrl(article.slug, "en") } : { bg: blogArticleUrl(article.slug, "bg") } }, openGraph: { title: text.seoTitle, description: text.seoDescription, images: [article.heroUrl] } };
}
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const article = await getArticle((await params).slug, "bg");
  if (!article) notFound();
  return <BlogDetail locale="bg" article={article} />;
}
