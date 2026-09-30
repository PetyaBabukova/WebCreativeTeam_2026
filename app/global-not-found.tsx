import SiteDocument from "@/components/SiteDocument";
import NotFoundPage from "@/components/NotFoundPage";
export const metadata = { title: "404 | WebCreativeTeam", robots: { index: false, follow: false } };
export default function GlobalNotFound() {
  return <SiteDocument locale="bg"><NotFoundPage /></SiteDocument>;
}
