import { redirect } from "next/navigation";

/**
 * Legacy route. The funnel is now the board view of «Лиды», so old
 * links and bookmarks land on the board instead of breaking.
 */
export default function FunnelRedirectPage() {
  redirect("/leads?view=board");
}
