"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/admin/control", label: "Control" },
  { href: "/admin/review", label: "Review" },
  { href: "/admin/listings", label: "Listings" },
  { href: "/admin/orders", label: "Orders" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminTopBar() {
  const pathname = usePathname();

  return (
    <div className="admin-topbar-wrap">
      <div className="admin-topbar">
        <Link href="/dashboard" className="admin-brand">
          <span className="brand-mark">
            <span className="brand-mark-inner">
              <span className="brand-mark-letter">Q</span>
              <span className="brand-mark-dot" />
            </span>
          </span>
          <span>
            <span className="admin-brand-title">QuickAIBuy</span>
            <span className="admin-brand-subtitle">Operator console</span>
          </span>
        </Link>

        <nav className="admin-nav" aria-label="Admin navigation">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "admin-nav-link admin-nav-link-active" : "admin-nav-link"}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

export function AdminFooter() {
  return (
    <footer className="admin-footer">
      <div>QuickAIBuy admin surfaces follow canonical DB and worker truth.</div>
      <div>Automation handles routine flow; use one daily exception review before live publish.</div>
    </footer>
  );
}
