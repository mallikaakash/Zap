# Going live on NEAR mainnet

**Production host (HTTPS):** `https://zap-2lcs3sivbq-uc.a.run.app` — set `PUBLIC_URL` and embed `pay.js` from this origin. The older VM/`sslip.io` setup is deprecated.

This takes Zap from the local demo to real payments: real NEAR Intents swaps, real USDC in the receipt contract, real refunds. **You** run every step that touches money or keys; nothing here sends a transaction without you typing `--yes`.

Budget: about **5.5 NEAR** (~3.8 NEAR of it is code storage, locked rather than spent; the deploy script prints the exact figure first) plus about **$5–10 of USDT on Polygon** and **~0.1 POL** for gas in MetaMask for test purchases. Refunds come back to MetaMask, and releases go to the seller account you choose.

---

## 1. Fund the operator account

Send about **5.5 NEAR** to `aakash7777.near`, for example from an exchange or another wallet.

## 2. Give the deploy script your operator key (on your laptop)

Install near-cli-rs (`npm i -g near-cli-rs`), then authorise a new key through your wallet in the browser. You never type a seed phrase:

```bash
near account import-account using-web-wallet network-config mainnet
```

When asked where to store the key, choose **"Save to the legacy keychain"**. It ends up in `~/.near-credentials/mainnet/aakash7777.near.json`. Never paste it into chat or commit it.

## 3. Deploy (on your laptop, from the repo)

```bash
pnpm install
pnpm deploy:mainnet --operator aakash7777.near --public-url https://zap-2lcs3sivbq-uc.a.run.app          # shows the plan and cost
pnpm deploy:mainnet --operator aakash7777.near --public-url https://zap-2lcs3sivbq-uc.a.run.app --yes    # does it
```

The script does the following:
- creates `checkout.aakash7777.near` (the contract), `executor.aakash7777.near` (the settlement worker) and `relayer.aakash7777.near` (the web app), each with a new key saved under `~/.near-credentials/mainnet/`;
- deploys and initialises the contract with real USDC, and registers the contract with USDC;
- sets the per-payment cap (default $50; change it with `--max-usd`);
- writes `.env` (mode 600) with the addresses and the executor and relayer keys.

## 4. HTTPS on the VM (required)

Browsers only create receipt keys and talk to MetaMask on HTTPS pages. With no domain, use the free `sslip.io` name that points at your IP.

1. **Open the firewall.** In GCP, go to VPC network → Firewall and allow TCP **80** and **443** to the VM.
2. **Install Caddy** (Debian or Ubuntu):
   ```bash
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update && sudo apt install -y caddy
   ```
3. **Configure Caddy.** Put this in `/etc/caddy/Caddyfile`:
   ```
   34-69-143-151.sslip.io {
       reverse_proxy localhost:3000
   }
   ```
4. **Reload and check.** Run `sudo systemctl reload caddy`. Caddy fetches a certificate automatically; open `https://34-69-143-151.sslip.io`.

## 5. Run it on the VM

Stop the old `pnpm demo` first, because it runs a throwaway local chain. Then:

```bash
git pull && pnpm install
scp <laptop>:path/to/repo/.env .env        # copy the .env from step 3; keep it mode 600
chmod 600 .env
pnpm start                                 # builds, then runs the web app + settlement worker
```

Keep it running with `tmux`, `pm2` or a systemd unit. The database is `.uc/live.db`; back it up with `cp .uc/live.db .uc/live-$(date +%F).db`.

Optional settings in `.env`:
- `RESEND_API_KEY=` for real emails. Without a verified domain, Resend only delivers to your own address.
- `NEARAI_API_KEY=` for the real NEAR AI refund assistant.

## 6. Set up the seller and products

1. **Create the shop.** Open `https://34-69-143-151.sslip.io/dashboard`, enter a shop name, your email and the **seller's payout account**. Use a second NEAR account, or the 64-character address from any NEAR wallet, so payouts visibly go somewhere other than the operator.
2. **Save the private dashboard link.** It is shown on screen and emailed to you.
3. **Add products** in the Products tab:
   - "Pour-over set": one-time, **$1**, refund window **300** seconds.
   - "Coffee club pass": prepaid pass, **$1** per period, **3** periods, every **180** seconds.
4. **Shorten the timers for filming.** In Settings, set "Your objection window" to **60** seconds and "Your time to answer" to **300** seconds. The defaults (12 h and 72 h) suit real sellers but are too slow for a video.
5. **Copy the snippet** from the Products tab ("Embed" next to a product) or the Button tab into any website. For example, open `examples/seller-site/index.html` and set the host and merchant at the top.

## 7. Pay with MetaMask

Get **Polygon USDT** (5–10 USDT) and about **0.1 POL** for gas into MetaMask. On the seller's page:

1. Click the button and choose **USDT · Polygon**.
2. Press **Use MetaMask** to fill the refund address.
3. Press **Continue**, then **Pay with MetaMask**.
4. About 30–60 s later the receipt is minted and the seller gets an email and a webhook.
5. On the receipt page, ask for a refund ("arrived broken" plus a photo). The assistant approves; after the shop's objection window the USDT comes back to MetaMask on Polygon.
6. Buy the pass, let one period release, then cancel. The periods that have not started come back to you.

## What it costs per payment (live 1Click dry quotes, Nov 2026)

| | Pay $1 | Refund $1 |
|---|---|---|
| Polygon USDT | 1.0156 USDT quoted (includes a 1% slippage buffer that is returned if unused) | 0.9904 USDT back |
| Base USDC | 1.0147 USDC quoted | 0.9974 USDC back |

NEAR gas per action is about 0.001–0.01 NEAR. Each seller gets 0.1 NEAR of prepaid receipt storage from the executor.

## Safety notes

- **The contract is unaudited.** Keep the per-payment cap low.
- **Emergency pause:** the owner (`aakash7777.near`) can stop new payments and releases with `pause()`; refunds keep working.
- **Recovering stray USDC:** if 1Click delivers more than ordered, or a refund swap bounces back, the extra USDC sits unassigned in the contract. The owner can send it out with `withdraw_unassigned`.
- **Never commit `.env`.** It holds the executor and relayer keys.
