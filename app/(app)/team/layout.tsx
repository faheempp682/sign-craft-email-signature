export const dynamic = "force-dynamic";

/**
 * Team navigation lives in the sidebar (see lib/nav/menu.ts), so these pages no longer draw a second section bar.
 * Every page and API still checks the role and the feature itself.
 */
export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
