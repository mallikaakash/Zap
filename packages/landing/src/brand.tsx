"use client";

/** Hand-tuned bolt for inline UI icons (not the brand lockup). viewBox 0 0 20 24 */
export const ZAP_BOLT_PATH =
  "M9.75.6 1.75 11.9H7.2l-2.55 11.25L16.1 9.35H10.65L13.2.6H9.75z";

/** Full chrome lockup — icon, Zap, PAYMENTS pill (source 1024×341). */
export const BRAND_LOGO = "/brand/logo-lockup.png";

/** Chrome isometric tile (favicon + compact mark). */
export const BRAND_MARK = "/brand/mark.png";

export function ZapGlyph({
  size = 24,
  className = "",
  title,
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  const h = Math.round(size * (24 / 20));
  return (
    <svg
      width={size}
      height={h}
      viewBox="0 0 20 24"
      className={className}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path fill="currentColor" d={ZAP_BOLT_PATH} />
    </svg>
  );
}

/** Chrome isometric tile mark. */
export function LogoMark({ size = 34, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={BRAND_MARK}
      alt=""
      draggable={false}
      width={size}
      height={size}
      className={`z-logo-mark-img ${className}`.trim()}
      style={{ width: size, height: size, display: "block" }}
      aria-hidden
    />
  );
}

export function LogoWordmark({ height = 56, className = "" }: { height?: number; className?: string }) {
  return (
    <img
      src={BRAND_LOGO}
      alt="Zap Payments"
      draggable={false}
      className={`z-logo-img ${className}`.trim()}
      height={height}
      style={{ height, width: "auto", display: "block" }}
    />
  );
}