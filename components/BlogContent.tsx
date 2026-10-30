import Link from "next/link";
import SitePage from "./SitePage";
import { messages } from "@/lib/messages";
import type { Locale } from "@/lib/config";
import { blogArticleUrl, pageUrl } from "@/lib/routing";
import type { Article } from "@/server/blog/service";
import { BlogCard, BlogDetailHeader, BlogIntro } from "./BlogMotion";
import "./BlogContent.css";

function publishedDate(article: Article, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "bg" ? "bg-BG" : "en-GB", { dateStyle: "long" }).format(article.publishedAt);
}

export function BlogIndex({ locale, rows, page, pages }: { locale: Locale; rows: Article[]; page: number; pages: number }) {
  const copy = messages[locale].blog;
  const featured = page === 1 ? rows[0] : undefined;
  const grid = featured ? rows.slice(1) : rows;
  const card = (article: Article, isFeatured = false) => <BlogCard key={article._id.toHexString()} href={blogArticleUrl(article.slug, locale)} imageUrl={isFeatured ? article.heroUrl : article.thumbnailUrl} title={article.locales[locale]!.title} date={publishedDate(article, locale)} dateTime={article.publishedAt.toISOString()} featured={isFeatured} />;
  const list = <main id="main" className="container standard-page blog-page" tabIndex={-1}>
    <BlogIntro locale={locale} eyebrow={messages[locale].blogLabel} headline={copy.headline} accent={copy.titleAccent} lead={copy.intro} />
    {featured && <div className="blog-page__featured">{card(featured, true)}</div>}
    {grid.length > 0 && <section className="blog-page__archive" aria-labelledby="blog-all-articles"><h2 id="blog-all-articles">{copy.allArticles}</h2><div className="blog-page__grid">{grid.map((article) => card(article))}</div></section>}
    {!rows.length && <p className="blog-page__empty">{copy.empty}</p>}
    {pages > 1 && <nav className="blog-page__pagination" aria-label={copy.pages}>
      {page > 1 && <Link href={`${pageUrl("blog", locale)}${page - 1 > 1 ? `?page=${page - 1}` : ""}`}>{copy.previous}</Link>}
      <span aria-current="page">{page} / {pages}</span>
      {page < pages && <Link href={`${pageUrl("blog", locale)}?page=${page + 1}`}>{copy.next}</Link>}
    </nav>}
  </main>;
  return <SitePage locale={locale} page="blog" content={list} />;
}

export function BlogDetail({ locale, article }: { locale: Locale; article: Article }) {
  const text = article.locales[locale]!;
  const copy = messages[locale].blog;
  const subtitle = text.subtitle?.trim() || text.seoDescription;
  const detail = <main id="main" className="container standard-page blog-detail" tabIndex={-1}>
    <article className="blog-article">
      <BlogDetailHeader locale={locale} title={text.title} subtitle={subtitle} />
      <div className="blog-article__visual"><img src={article.heroUrl} alt={text.heroAlt} loading="eager" fetchPriority="high" decoding="async" /></div>
      <div className="blog-article__body" dangerouslySetInnerHTML={{ __html: text.html }} />
      <time className="blog-article__date" dateTime={article.publishedAt.toISOString()}>{publishedDate(article, locale)}</time>
    </article>
    <div className="blog-detail__bottom"><Link className="button button--outline blog-detail__back" href={pageUrl("blog", locale)}><span aria-hidden="true">←</span><span>{copy.backToArticles}</span></Link></div>
  </main>;
  return <SitePage locale={locale} page="blog" content={detail} languageUrls={{ bg: blogArticleUrl(article.slug, "bg"), en: article.locales.en ? blogArticleUrl(article.slug, "en") : pageUrl("blog", "en") }} />;
}
