import SitePage from "@/components/SitePage";
import { pageMetadata } from "@/lib/metadata";
export function generateMetadata() { return pageMetadata("about", "en"); }
export default function Page() { return <SitePage locale="en" page="about" />; }
