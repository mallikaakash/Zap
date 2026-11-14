"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Field, Notice, Spinner } from "@/components/ui";
import { SiteHeader } from "@/components/site-header";

export default function Login() {
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [signedIn, setSignedIn] = useState<string | null>(null);

  useEffect(() => {
    api<{ merchant: { id: string } | null }>("/api/auth/me")
      .then((r) => setSignedIn(r.merchant?.id ?? null))
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "login") {
        await api("/api/auth/login", { body: { merchant: id.trim(), password: pw } });
        window.location.href = "/dashboard";
        return;
      }
      await api("/api/auth/forgot", { body: { merchant: id.trim() } });
      setMsg({ tone: "good", text: "If that shop exists and has an email address, a sign-in link is on its way. Check your inbox and spam." });
    } catch (err) {
      setMsg({ tone: "bad", text: err instanceof Error ? err.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-md px-4 py-12">
        {signedIn ? (
          <div className="mb-4">
            <Notice tone="good">
              You are signed in as <span className="mono">{signedIn}</span>. <a className="font-semibold underline" href="/dashboard">Go to your dashboard</a>
            </Notice>
          </div>
        ) : null}
        <form className="card space-y-4 p-6" onSubmit={submit}>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{mode === "login" ? "Log in to your shop" : "Get a sign-in link"}</h1>
            <p className="mt-1 text-sm text-muted">
              {mode === "login" ? "Use the NEAR account your shop is paid to, and your password." : "We email a one-time sign-in link to the address saved for your shop. Then set a new password in Settings."}
            </p>
          </div>
          <Field label="NEAR account">
            <input className="input mono" value={id} onChange={(e) => setId(e.target.value)} placeholder="yourname.near" autoComplete="username" spellCheck={false} autoCapitalize="none" required />
          </Field>
          {mode === "login" ? (
            <Field label="Password">
              <span className="flex gap-2">
                <input className="input" type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
                <button type="button" className="btn-ghost shrink-0" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
              </span>
            </Field>
          ) : null}
          {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? <Spinner /> : null} {mode === "login" ? "Log in" : "Email me a sign-in link"}
          </button>
          <p className="text-center text-sm">
            <button type="button" className="link" onClick={() => { setMode(mode === "login" ? "forgot" : "login"); setMsg(null); }}>
              {mode === "login" ? "Forgot password?" : "Back to log in"}
            </button>
          </p>
        </form>
        <p className="mt-4 text-center text-sm text-muted">New to Zap? <a className="link" href="/dashboard">Create a shop</a></p>
      </main>
    </>
  );
}
