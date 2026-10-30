/* eslint-disable @next/next/no-img-element -- Blog images are resized to WebP before upload and their bucket is configured at runtime. */
import Link from "next/link";
import SitePage from "./SitePage";
import type { Locale } from "@/lib/config";
import { blogArticleUrl, pageUrl } from "@/lib/routing";
import type { Article } from "@/server/blog/service";

export function BlogIndex({ locale, rows, page, pages }: { locale: Locale; rows: Article[]; page: number; pages: number }) {
  const bg = locale === "bg";
  const list = <main id="main" className="container standard-page" tabIndex={-1}>
    <h1>{bg ? "Блог" : "Blog"}</h1>
    {rows.length ? <div className="blog-list">{rows.map((article) => {
      const text = article.locales[locale]!;
      return <article key={article._id.toHexString()} className="blog-card">
        <Link href={blogArticleUrl(article.slug, locale)}><img src={article.thumbnailUrl} alt={text.thumbnailAlt} loading="lazy" width={800} height={450} /><h2>{text.title}</h2></Link>
        <p><time dateTime={article.publishedAt.toISOString()}>{new Intl.DateTimeFormat(bg ? "bg-BG" : "en-GB", { dateStyle: "long" }).format(article.publishedAt)}</time></p>
      </article>;
    })}</div> : <p>{bg ? "Все още няма статии на този език." : "There are no articles in this language yet."}</p>}
    {pages > 1 && <nav aria-label={bg ? "Страници" : "Pages"}>
      {page > 1 && <Link href={`${pageUrl("blog", locale)}${page - 1 > 1 ? `?page=${page - 1}` : ""}`}>{bg ? "Предишна" : "Previous"}</Link>}
      <span> {page} / {pages} </span>
      {page < pages && <Link href={`${pageUrl("blog", locale)}?page=${page + 1}`}>{bg ? "Следваща" : "Next"}</Link>}
    </nav>}
  </main>;
  return <SitePage locale={locale} page="blog" content={list} />;
}
export function BlogDetail({ locale, article }: { locale: Locale; article: Article }) {
  const text = article.locales[locale]!;
  const bg = locale === "bg";
  const detail = <main id="main" className="container standard-page" tabIndex={-1}>
    <Link href={pageUrl("blog", locale)}>{bg ? "Към всички статии" : "All articles"}</Link>
    <article><h1>{text.title}</h1><p><time dateTime={article.publishedAt.toISOString()}>{new Intl.DateTimeFormat(bg ? "bg-BG" : "en-GB", { dateStyle: "long" }).format(article.publishedAt)}</time></p>
      <img src={article.heroUrl} alt={text.heroAlt} width={1200} height={675} />
      <div className="blog-article__body" dangerouslySetInnerHTML={{ __html: text.html }} />
    </article>
    <p><Link href={article.locales.en ? blogArticleUrl(article.slug, bg ? "en" : "bg") : pageUrl("blog", "en")}>{bg ? "English" : "Български"}</Link></p>
  </main>;
  return <SitePage locale={locale} page="blog" content={detail} languageUrls={{ bg: blogArticleUrl(article.slug, "bg"), en: article.locales.en ? blogArticleUrl(article.slug, "en") : pageUrl("blog", "en") }} />;
}
