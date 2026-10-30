import { BlogIndex } from "@/components/BlogContent";
import { pageMetadata } from "@/lib/metadata";
import { pageUrl } from "@/lib/routing";
import { listArticles, BlogError } from "@/server/blog/service";
import { notFound } from "next/navigation";

export async function generateMetadata({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ page?: string }> }) {
  const metadata = await pageMetadata("blog", "bg");
  const raw = (await searchParams).page;
  const page = raw === undefined ? 1 : /^[1-9][0-9]*$/.test(raw) ? Number(raw) : NaN;
  if (page > 1 && Number.isSafeInteger(page)) {
    let hasEnglishPage = true;
    try { await listArticles("en", page); }
    catch (error) { if (error instanceof BlogError && error.status === 404) hasEnglishPage = false; else throw error; }
    const suffix = `?page=${page}`;
    metadata.alternates = { canonical: `${pageUrl("blog", "bg")}${suffix}`, languages: { bg: `${pageUrl("blog", "bg")}${suffix}`, ...(hasEnglishPage ? { en: `${pageUrl("blog", "en")}${suffix}` } : {}) } };
  }
  return metadata;
}
export const dynamic = "force-dynamic";
export default async function Page({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ page?: string }> }) {
  const raw = (await searchParams).page;
  const page = raw === undefined ? 1 : /^[1-9][0-9]*$/.test(raw) ? Number(raw) : NaN;
  try { const result = await listArticles("bg", page); return <BlogIndex locale="bg" {...result} page={page} />; }
  catch (error) { if (error instanceof BlogError && error.status === 404) notFound(); throw error; }
}
