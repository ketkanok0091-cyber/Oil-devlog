// Vercel Serverless Function — เก็บข้อมูลใน Upstash Redis (ผ่าน REST ไม่ต้องติดตั้งแพ็กเกจ)
// ต้องตั้ง env: KV_REST_API_URL, KV_REST_API_TOKEN (หรือ UPSTASH_REDIS_REST_URL/TOKEN) และ APP_PASSWORD
const KEY = "devlog:topics";
const ID_RE = /^[A-Za-z0-9_.~:@+-]{1,200}$/;

function conf() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token };
}
async function redis(cmd) {
  const { url, token } = conf();
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || "redis " + r.status);
  return j.result;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const pw = process.env.APP_PASSWORD;
  if (!pw) return res.status(500).json({ error: "APP_PASSWORD not set" });
  if (req.headers["x-pass"] !== pw) return res.status(401).json({ error: "unauthorized" });
  if (!conf().url) return res.status(500).json({ error: "redis env not set" });
  try {
    if (req.method === "GET") {
      const flat = (await redis(["HGETALL", KEY])) || [];
      const docs = [];
      for (let i = 0; i < flat.length; i += 2) {
        try { docs.push({ id: flat[i], data: JSON.parse(flat[i + 1]) }); } catch (e) {}
      }
      return res.status(200).json({ docs });
    }
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const id = body.id;
    if (!ID_RE.test(id || "")) return res.status(400).json({ error: "bad id" });
    if (req.method === "POST") {
      let data = body.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) return res.status(400).json({ error: "bad data" });
      if (body.merge) {
        const cur = await redis(["HGET", KEY, id]);
        if (!cur) return res.status(404).json({ error: "not found" });
        data = Object.assign(JSON.parse(cur), data);
      }
      const s = JSON.stringify(data);
      if (s.length > 250000) return res.status(413).json({ error: "too large" });
      await redis(["HSET", KEY, id, s]);
      return res.status(200).json({ ok: true });
    }
    if (req.method === "DELETE") {
      await redis(["HDEL", KEY, id]);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "method" });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
