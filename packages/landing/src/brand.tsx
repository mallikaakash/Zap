/** Brand assets — transparent PNGs under `/brand/` on each app host. */

export const BRAND_LOGO = "/brand/logo-lockup.png";
export const BRAND_MARK = "/brand/mark.png";

export function LogoWordmark({ height = 56, className = "" }: { height?: number; className?: string }) {
  return (
    <img
      src={BRAND_LOGO}
      alt="Zap Payments"
      draggable={false}
      className={`z-logo-wordmark ${className}`.trim()}
      height={height}
      style={{ height, width: "auto", maxWidth: "min(500px, 94vw)", display: "block" }}
    />
  );
}

/** Pink lightning isometric tile. */
export function LogoMark({ size = 34, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={BRAND_MARK}
      alt=""
      aria-hidden
      draggable={false}
      className={`z-logo-mark ${className}`.trim()}
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: "contain", display: "block" }}
    />
  );
}