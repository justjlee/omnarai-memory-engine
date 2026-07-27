# Provider-side spend limits — the unbypassable floor

**Purpose:** the software ceiling in [`api/_budget.js`](../api/_budget.js) stops spend at **$95 (rolling 30 days)** and is the *primary* control. These provider-side limits are the **backstop** — they hold even if the software cap ever has a bug, because they live inside each provider's own billing system. Set both; together a surprise bill becomes essentially impossible.

**Last reviewed:** 2026-07-27 · **Owner:** xz (Jonathan)

## Three kinds of control

| Type | Behavior | Strength |
|---|---|---|
| **Hard cap** | Provider rejects requests once the limit is hit | ✅ Best |
| **Prepaid balance** | You can only spend what you've loaded (auto-reload OFF) | ✅ Just as good |
| **Alert only** | Provider emails you but keeps charging | ⚠️ Weak — only Google |

Suggested per-provider amounts below **sum to ~$100**, mirroring the software cap. Adjust to taste; the dominant spenders are Anthropic and OpenAI.

## The checklist

### 1. Anthropic — biggest spender (Claude deliberation + council member + Haiku classifier + synthesis)
- **Where:** console.anthropic.com → Settings → Billing / Cost management → **Limits / Spend limits**
- **Do:** monthly spend limit **≈ $40**; turn **auto-reload of credits OFF** (or keep a small prepaid balance)
- **Type:** Hard cap ✅

### 2. OpenAI — GPT-4o council member + text-embedding-3-small (search)
- **Where:** platform.openai.com → Settings → **Limits** (or Billing → Usage limits)
- **Do:** monthly **budget / hard limit ≈ $30**; notification threshold below it (~$24)
- **Type:** Hard cap — requests refused at the budget ✅

### 3. xAI (Grok)
- **Where:** console.x.ai → Billing / Credits
- **Do:** **auto top-up OFF**, keep a small balance **≈ $10**
- **Type:** Prepaid ✅

### 4. DeepSeek
- **Where:** platform.deepseek.com → Top up / Balance
- **Do:** small prepaid balance **≈ $10**, no auto-recharge
- **Type:** Prepaid ✅

### 5. Google / Gemini — ⚠️ the weak spot
- **Where:** Google Cloud Console → Billing → **Budgets & alerts**
- **Do:** budget alert **≈ $10**. **Google budgets only EMAIL you — they do NOT stop charges.** Choose one:
  - keep Gemini on a **free-tier API key** if volume allows (then it can't bill at all), **or**
  - put Gemini on its **own isolated billing project** with a small balance, so a runaway can't reach the main account
- **Type:** Alert only — the software cap ($95) does the real work here; don't rely on Google to stop it

### 6. Vercel — hosting/infra (separate from model spend)
- **Where:** vercel.com → (Team) Settings → Billing → **Spend Management**
- **Do:** spend amount **≈ $20**, action = notify (or pause for a hard stop)
- **Type:** Caps function/bandwidth cost, not AI spend — a good belt regardless

## Worst-case exposure after setup

- If **everything** failed at once: ~sum of provider limits (**~$100**).
- If only the **software cap** holds: **~$95** (rolling 30 days).
- The one genuinely uncapped path is **Gemini** — close it with a free-tier key or an isolated project and the last gap is gone.

## Related

- Software ceiling: [`api/_budget.js`](../api/_budget.js) · read status: `GET /api/info?_view=budget` (Bearer `INGEST_SECRET`) · adjust live: `POST /api/info?_view=budget {cap_usd}` · env knobs: `BUDGET_CAP_USD` / `BUDGET_SOFT_MARGIN_USD` / `BUDGET_WARN_FRACTION`
- Daily monitor routine: claude.ai/code/routines/trig_01WsX53BSCo1fUtDNBhWsbuD (every 6h)
- Council model roster (who spends): `COUNCIL` in [`api/_council.js`](../api/_council.js)
