import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import { LABEL_INFO, rgbCss, type Label } from "@/lib/constants";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function Card({
  title,
  subtitle,
  icon,
  actions,
  className,
  bodyClassName,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}) {
  return (
    <section className={cn("card relative overflow-hidden", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line/70 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {icon && (
              <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-beef-100/80 text-beef-700 ring-1 ring-beef-300/60 dark:bg-beef-900/60 dark:text-beef-300 dark:ring-beef-700/40">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-fat-50">{title}</h3>
              {subtitle && <p className="mt-0.5 text-xs text-fat-300/65">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

type Variant = "primary" | "ghost" | "outline" | "danger" | "soft";

export function Button({
  variant = "outline",
  size = "md",
  loading,
  icon,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean; icon?: ReactNode }) {
  const sizes = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" };
  const variants: Record<Variant, string> = {
    primary:
      "bg-linear-to-b from-beef-500 to-beef-700 text-white shadow-[0_8px_24px_-8px_rgba(229,56,59,0.75)] ring-1 ring-inset ring-white/10 hover:from-beef-400 hover:to-beef-600",
    ghost: "text-fat-200 hover:bg-black/5 dark:hover:bg-white/5",
    outline:
      "border border-line bg-panel-2/70 text-fat-100 hover:border-beef-400 hover:bg-beef-50 dark:bg-panel-2/60 dark:hover:border-beef-700 dark:hover:bg-beef-950/60",
    danger:
      "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/40",
    soft:
      "bg-beef-100/80 text-beef-800 ring-1 ring-inset ring-beef-300/60 hover:bg-beef-200/70 dark:bg-beef-900/50 dark:text-beef-100 dark:ring-beef-700/40 dark:hover:bg-beef-800/60",
  };
  return (
    <button
      type="button"
      {...props}
      disabled={loading || props.disabled}
      className={cn(
        "inline-flex whitespace-nowrap items-center justify-center gap-2 rounded-xl font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-beef-400/60 disabled:cursor-not-allowed disabled:opacity-50",
        sizes[size],
        variants[variant],
        className,
      )}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "beef" | "ok" | "warn" | "info";
  className?: string;
}) {
  const tones = {
    neutral: "bg-black/5 text-fat-200 ring-line dark:bg-white/5 dark:text-fat-200 dark:ring-white/10",
    beef: "bg-beef-100/80 text-beef-800 ring-beef-300/70 dark:bg-beef-900/60 dark:text-beef-200 dark:ring-beef-700/50",
    ok: "bg-emerald-50 text-emerald-700 ring-emerald-300/70 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-700/40",
    warn: "bg-amber-50 text-amber-800 ring-amber-300/70 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-700/40",
    info: "bg-sky-50 text-sky-700 ring-sky-300/70 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-700/40",
  };
  return (
    <span className={cn("inline-flex whitespace-nowrap items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", tones[tone], className)}>
      {children}
    </span>
  );
}

export function LabelBadge({ label, size = "sm" }: { label: string; size?: "sm" | "lg" }) {
  const info = LABEL_INFO[label as Label];
  if (!info) return <Badge>{label}</Badge>;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full font-semibold", size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]")}
      style={{ color: info.textColor, backgroundColor: `${info.color}1f`, boxShadow: `inset 0 0 0 1px ${info.color}55` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: info.color }} />
      {info.name}
    </span>
  );
}

export function Swatch({ r, g, b, className }: { r: number; g: number; b: number; className?: string }) {
  return (
    <span
      className={cn("inline-block h-4 w-4 shrink-0 rounded-md ring-1 ring-white/20", className)}
      style={{ background: rgbCss(r, g, b) }}
      title={`RGB(${r.toFixed(1)}, ${g.toFixed(1)}, ${b.toFixed(1)})`}
    />
  );
}

export function Stat({
  label,
  value,
  sub,
  icon,
  accent = "#e5383b",
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  accent?: string;
}) {
  return (
    <div className="card relative overflow-hidden p-4">
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-20 blur-2xl" style={{ background: accent }} />
      <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-fat-300/60">
        <span>{label}</span>
        {icon && <span style={{ color: accent }}>{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-fat-50">{value}</div>
      {sub && <div className="mt-1 text-xs text-fat-300/65">{sub}</div>}
    </div>
  );
}

export function ProgressBar({ value, max, color = "#e5383b", className }: { value: number; max: number; color?: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-white/5", className)}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}aa, ${color})` }} />
    </div>
  );
}

export function EmptyState({ icon, title, desc, action }: { icon?: ReactNode; title: ReactNode; desc?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line/80 bg-black/10 px-6 py-10 text-center">
      {icon && <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-beef-100/80 text-beef-700 ring-1 ring-beef-300/60 dark:bg-beef-950/80 dark:text-beef-300 dark:ring-beef-800/50">{icon}</div>}
      <div className="text-sm font-semibold text-fat-50">{title}</div>
      {desc && <div className="mt-1 max-w-md text-xs text-fat-300/65">{desc}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = "sm",
}: {
  options: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex flex-wrap rounded-xl border border-line bg-black/25 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-[10px] px-2.5 font-medium transition",
            size === "sm" ? "h-7 text-xs" : "h-9 text-sm",
            o.value === value ? "bg-beef-600 text-white shadow" : "text-fat-200/70 hover:text-fat-50",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-xs text-fat-200 disabled:opacity-50"
    >
      <span className={cn("relative h-5 w-9 rounded-full transition", checked ? "bg-sky-500" : "bg-white/15")}>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </span>
      {label}
    </button>
  );
}

/** Indikator titik status berbasis komponen CSS (pengganti simbol ● / ○) */
export function StatusDot({
  tone = "neutral",
  pulse = false,
}: {
  tone?: "ok" | "warn" | "info" | "beef" | "neutral";
  pulse?: boolean;
}) {
  const colors = {
    ok: "bg-emerald-400",
    warn: "bg-amber-400",
    info: "bg-sky-400",
    beef: "bg-beef-400",
    neutral: "bg-fat-300/40",
  };
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse && <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", colors[tone])} />}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", colors[tone])} />
    </span>
  );
}

/** Pemisah metadata berbasis garis vertikal tipis (pengganti tanda ·) */
export function MetaItems({ items, className }: { items: Array<ReactNode | false | null | undefined>; className?: string }) {
  const clean = items.filter((x) => x !== false && x !== null && x !== undefined && x !== "");
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      {clean.map((item, idx) => (
        <span key={idx} className="inline-flex items-center gap-2">
          {idx > 0 && <span aria-hidden className="h-3 w-px bg-fat-300/20" />}
          <span>{item}</span>
        </span>
      ))}
    </span>
  );
}

/** Ikon status terdeteksi / tidak ada (pengganti simbol ✓ / ✗) */
export function StatusCheck({ ok, okLabel = "Terdeteksi", failLabel = "Tidak ada" }: { ok: boolean | null | undefined; okLabel?: string; failLabel?: string }) {
  if (ok == null) return <span className="text-fat-300/50">Belum terukur</span>;
  return ok ? (
    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
      <Check className="h-3.5 w-3.5" />
      {okLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
      <X className="h-3.5 w-3.5" />
      {failLabel}
    </span>
  );
}
