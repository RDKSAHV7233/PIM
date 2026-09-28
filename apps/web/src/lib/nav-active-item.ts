export interface NavItemLike {
  href: string;
}

function matchesHref(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Picks the single most specific href among a flat list of sidebar item hrefs for the given
// pathname, so a parent section link (e.g. "/channels") doesn't stay highlighted alongside a
// more specific sibling (e.g. "/channels/mappings") on every one of that parent's sub-routes.
export function selectActiveHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (!matchesHref(pathname, href)) {
      continue;
    }
    if (!best || href.length > best.length) {
      best = href;
    }
  }
  return best;
}

export function isNavItemActive(pathname: string, item: NavItemLike, allHrefs: string[]): boolean {
  return selectActiveHref(pathname, allHrefs) === item.href;
}
