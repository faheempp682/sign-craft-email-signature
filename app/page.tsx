import { redirect } from "next/navigation";
import { publicSiteEnabled } from "@/lib/public-routes";
import { getUser } from "@/lib/supabase/server";
import { pageMetadata } from "@/lib/site/seo";
import { HOME_DESCRIPTION, HOME_TITLE, MarketingHome } from "./(marketing)/home-view";
import { MarketingShell } from "./(marketing)/shell";

export function generateMetadata() {
  return pageMetadata({ path: "/", title: HOME_TITLE, description: HOME_DESCRIPTION });
}

/**
 * The marketing home is shown only when PUBLIC_SITE_ENABLED=true and nobody is signed in.
 * In every other case (site off, or a signed-in person) this is the same redirect to /create as before.
 * The home lives at the app root, outside the (marketing) route group, so it wraps itself in the marketing shell.
 */
export default async function Home() {
  if (!publicSiteEnabled() || (await getUser())) redirect("/create");
  return (
    <MarketingShell>
      <MarketingHome />
    </MarketingShell>
  );
}
