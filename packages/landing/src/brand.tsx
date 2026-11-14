/** Brand lockup — served from `/brand/logo.jpg` on each app host. */

export const BRAND_LOGO = "/brand/logo.jpg";

export function LogoWordmark({ height = 56, className = "" }: { height?: number; className?: string }) {
  return (
    <img
      src={BRAND_LOGO}
      alt="Zap Payments"
      className={`z-logo-wordmark ${className}`.trim()}
      height={height}
      style={{ height, width: "auto", maxWidth: "min(500px, 94vw)", display: "block" }}
    />
  );
}

/** Square crop of the bolt tile for compact UI (checkout sheet, etc.). */
export function LogoMark({ size = 34, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={BRAND_LOGO}
      alt=""
      aria-hidden
      className={`z-logo-mark ${className}`.trim()}
      width={size}
      height={size}
      style={{ width: size, height: size }}
    />
  );
}