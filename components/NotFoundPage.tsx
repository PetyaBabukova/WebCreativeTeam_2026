import Link from "next/link";
import { messages } from "@/lib/messages";
import { pageUrl, type Locale } from "@/lib/routing";

export default function NotFoundPage({ locale = "bg" }: { locale?: Locale }) {
  return <main id="main" className="container standard-page" tabIndex={-1}>
    <p>404</p><h1>{messages[locale].notFound}</h1>
    <Link href={pageUrl("home", locale)}>{messages[locale].backHome}</Link>
  </main>;
}
