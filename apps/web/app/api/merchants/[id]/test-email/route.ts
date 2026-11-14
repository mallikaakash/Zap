import { authMerchant, sendEmail, UserError } from "@uc/core";
import { handle, tokenOf, type Ctx } from "@/lib/api";

/** Send one test email to the shop's own address and report how it went (no money, no customer). */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = (await params).id;
    const m = await authMerchant(id, tokenOf(req));
    if (!m.email) throw new UserError("Add an email address in Settings first.");
    const r = await sendEmail({
      to: m.email,
      subject: "Test email from Zap",
      lines: ["Email works.", `This is a test from the dashboard of "${m.name}". Payment and refund notices will arrive at this address.`],
    });
    if (!r) throw new UserError("Could not record the email. Try again.");
    return { to: m.email, ...r };
  });
}
