import type { ReactNode } from "react";

export function DocPage({ title, lede, children }: { title: string; lede?: string; children: ReactNode }) {
  return (
    <article className="z-docs-page">
      <header className="z-docs-head">
        <p className="z-eyebrow" style={{ marginBottom: 10 }}>
          Documentation
        </p>
        <h1 className="z-h2" style={{ fontSize: "clamp(30px, 4vw, 40px)", marginBottom: lede ? 12 : 0 }}>
          {title}
        </h1>
        {lede ? <p className="z-lead z-docs-lede">{lede}</p> : null}
      </header>
      <div className="z-docs-prose">{children}</div>
    </article>
  );
}

export function CodeBlock({ title, children }: { title?: string; children: string }) {
  return (
    <div className="z-code" style={{ margin: "20px 0" }}>
      {title ? <div className="z-code-bar">{title}</div> : null}
      <pre style={{ margin: 0, fontSize: 14, lineHeight: 1.65 }}>{children}</pre>
    </div>
  );
}

export function DocTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="z-docs-table-wrap">
      <table className="z-docs-table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}