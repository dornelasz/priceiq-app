import Link from "next/link";
import { CATEGORIES } from "@/lib/categories";

/** Server component: category filter chips that update the URL query. */
export function CategoryChips({
  basePath,
  active,
  extraParams = {},
}: {
  basePath: string;
  active?: string;
  extraParams?: Record<string, string | undefined>;
}) {
  function href(category?: string): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extraParams)) if (v) params.set(k, v);
    if (category) params.set("category", category);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const chip = (label: string, value?: string) => {
    const isActive = value ? active === value : !active;
    return (
      <Link
        key={label}
        href={href(value)}
        className={`pill whitespace-nowrap ${
          isActive
            ? "border-brand/40 bg-brand/15 text-white"
            : "border-border bg-bg-soft text-zinc-400 hover:text-zinc-200"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="flex flex-wrap gap-2">
      {chip("Todas")}
      {CATEGORIES.map((c) => chip(c, c))}
    </div>
  );
}
