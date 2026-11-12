const crypto = require("node:crypto");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://othynttlaxymqjudntdq.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_B9C5HIxMHlZ8ItrV7neBHw_LTF-H_ir";
const BINANCE_API_KEY = process.env.QURBIT_BINANCE_API_KEY;
const BINANCE_API_SECRET = process.env.QURBIT_BINANCE_API_SECRET;
const ALLOWED_ORIGINS = new Set(
  (process.env.QURBIT_ALLOWED_ORIGINS ||
    "https://qurbit-steel.vercel.app,https://qurbit-lucky-win-india.vercel.app,https://qurbit-944gfe4es-lucky-win-india.vercel.app")
    .split(",").map((x) => x.trim()).filter(Boolean)
);

function reply(res, status, body) {
  res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  }
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return reply(res, 405, { error: "Method not allowed" });
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply(res, 403, { error: "Origin not allowed" });

  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return reply(res, 401, { error: "Sign in with the authorised QURBIT admin account." });

  try {
    const userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(8000)
    });
    if (!userResponse.ok) return reply(res, 401, { error: "Your QURBIT session is invalid or expired. Sign in again." });
    const user = await userResponse.json();
    if (!user || user.app_metadata?.role !== "admin") {
      return reply(res, 403, { error: "Admin access is required." });
    }

    if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
      return reply(res, 503, { error: "Binance read-only API credentials are not configured in Vercel yet." });
    }

    const timeResponse = await fetch("https://api.binance.com/api/v3/time", {
      cache: "no-store", signal: AbortSignal.timeout(8000)
    });
    if (!timeResponse.ok) throw new Error("Binance time service unavailable");
    const serverTime = (await timeResponse.json()).serverTime;
    const params = new URLSearchParams({ timestamp: String(serverTime), recvWindow: "5000" });
    const signature = crypto.createHmac("sha256", BINANCE_API_SECRET).update(params.toString()).digest("hex");
    const accountResponse = await fetch(
      "https://api.binance.com/api/v3/account?" + params.toString() + "&signature=" + signature,
      { headers: { "X-MBX-APIKEY": BINANCE_API_KEY }, cache: "no-store", signal: AbortSignal.timeout(10000) }
    );
    const account = await accountResponse.json();
    if (!accountResponse.ok) {
      const code = Number(account?.code);
      if (code === -2015 || code === -2014) return reply(res, 502, { error: "Binance rejected the API key. Check that it is active and has read-only account access." });
      if (code === -1021) return reply(res, 502, { error: "Binance timestamp check failed. Please retry." });
      return reply(res, 502, { error: "Binance account data could not be retrieved. Check API permissions and account availability." });
    }

    const balances = (account.balances || [])
      .filter((item) => Number(item.free) > 0 || Number(item.locked) > 0)
      .map((item) => ({ asset: item.asset, free: item.free, locked: item.locked }));
    return reply(res, 200, {
      connected: true,
      mode: "read-only",
      canTrade: false,
      canWithdraw: false,
      accountType: account.accountType || "SPOT",
      balances,
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    return reply(res, 502, { error: "Secure Binance connection failed. Please retry later." });
  }
};
