import { BlogIndex } from "@/components/BlogContent";
import { pageMetadata } from "@/lib/metadata";
import { pageUrl } from "@/lib/routing";
import { listArticles, BlogError } from "@/server/blog/service";
import { notFound } from "next/navigation";

export async function generateMetadata({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ page?: string }> }) {
  const metadata = await pageMetadata("blog", "en");
  const raw = (await searchParams).page;
  const page = raw === undefined ? 1 : /^[1-9][0-9]*$/.test(raw) ? Number(raw) : NaN;
  if (page > 1 && Number.isSafeInteger(page)) {
    const suffix = `?page=${page}`;
    metadata.alternates = { canonical: `${pageUrl("blog", "en")}${suffix}`, languages: { bg: `${pageUrl("blog", "bg")}${suffix}`, en: `${pageUrl("blog", "en")}${suffix}` } };
  }
  return metadata;
}
export const dynamic = "force-dynamic";
export default async function Page({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ page?: string }> }) {
  const raw = (await searchParams).page;
  const page = raw === undefined ? 1 : /^[1-9][0-9]*$/.test(raw) ? Number(raw) : NaN;
  try { const result = await listArticles("en", page); return <BlogIndex locale="en" {...result} page={page} />; }
  catch (error) { if (error instanceof BlogError && error.status === 404) notFound(); throw error; }
}
