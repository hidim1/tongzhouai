import express from "express";
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { isIP } from "node:net";
const derive = promisify(scrypt);
const same = (a, b) => a.length === b.length && timingSafeEqual(a, b);
const lifetime = 12 * 60 * 60;

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}

// HTTPS is the default. HTTP requires explicit high-port, IP-restricted test mode.
// No public origin means the original local-only/desktop boundary stays intact.
export function createAccessGuard({
  origin = process.env.TONGZHOU_PUBLIC_ORIGIN,
  passwordHash = process.env.TONGZHOU_PASSWORD_HASH,
  sessionSecret = process.env.TONGZHOU_AUTH_SECRET,
  allowHttpTest = process.env.TONGZHOU_ALLOW_HTTP_INTERNAL_TEST === "1",
  httpTestAllowedIPs = process.env.TONGZHOU_HTTP_TEST_ALLOWED_IPS || "",
  now = Date.now,
} = {}) {
  let publicUrl;
  let httpTest = false;
  const allowedIPs = new Set(
    httpTestAllowedIPs
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean),
  );
  if (origin) {
    publicUrl = new URL(origin);
    httpTest = publicUrl.protocol === "http:" && allowHttpTest;
    if (
      (publicUrl.protocol !== "https:" && !httpTest) ||
      (httpTest &&
        (Number(publicUrl.port) < 1024 ||
          !allowedIPs.size ||
          [...allowedIPs].some((ip) => !isIP(ip)))) ||
      publicUrl.origin !== origin ||
      !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash || "") ||
      !/^[a-f0-9]{64}$/.test(sessionSecret || "")
    )
      throw new Error(
        "部署需要 HTTPS origin、密码哈希和独立会话密钥；HTTP 内测须显式启用高位端口及来源 IP 白名单",
      );
  }
  const cookieName = httpTest
    ? `tongzhou_internal_${publicUrl.port}`
    : "__Host-tongzhou";
  const cookieFlags = `HttpOnly; ${httpTest ? "" : "Secure; "}SameSite=Strict; Path=/`;
  const sign = (value) =>
    createHmac("sha256", sessionSecret)
      .update(`${origin}\n${value}`)
      .digest("hex");
  const sessions = (cookie) => {
    const value = String(cookie || "")
      .split(/;\s*/)
      .find((x) => x.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    if (!value || !/^\d+\.[a-f0-9]{64}$/.test(value)) return false;
    const [expiry, signature] = value.split(".");
    const remaining = Number(expiry) - Math.floor(now() / 1000);
    return (
      remaining > 0 &&
      remaining <= lifetime &&
      same(Buffer.from(signature), Buffer.from(sign(expiry)))
    );
  };
  const form = express.urlencoded({ extended: false, limit: "1kb" });
  const attempts = new Map();
  const page = (message = "") =>
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录 · 同舟 AI</title><style>*{box-sizing:border-box}body{margin:0;background:#f2f6fa;color:#20304b;font-family:system-ui,sans-serif;min-height:100vh;display:grid;place-items:center}.card{background:white;border:1px solid #e0e8ee;border-radius:20px;padding:40px;width:min(420px,92vw);box-shadow:0 20px 70px #20304b12}.brand{color:#0094c8;font-size:13px;letter-spacing:3px}h1{font-size:28px;margin-bottom:10px}p{font-size:14px;color:#718096;line-height:1.7}label{display:block;margin-top:28px;font-size:14px}input,button{width:100%;padding:14px;border-radius:9px;font:inherit;margin-top:10px}input{border:1px solid #cdd9e1}button{border:0;background:#2083a2;color:white;cursor:pointer}.error{color:#b43e46;min-height:20px}.foot{font-size:12px;margin-top:24px}</style><main class="card"><div class="brand">CROSSFLOW · 同舟纵横</div><h1>同舟 AI</h1><p>工程智能工作台<br>输入工作区访问密码，开始协作。</p><form method="post" action="/login"><label for="password">工作区访问密码</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="256" required autofocus><button type="submit">进入工作台</button></form><p class="error" role="alert">${message}</p><p class="foot">独立工作区 · ${httpTest ? "HTTP 内测（未加密，限定来源 IP）" : "HTTPS 加密连接"}<br>项目与会话保存在服务器，共用此密码的成员可访问同一工作区。</p></main></html>`;
  return function access(req, res, next) {
    if (
      httpTest &&
      !allowedIPs.has(String(req.ip || "").replace(/^::ffff:/, ""))
    )
      return res.status(403).send("来源 IP 不在内测白名单中");
    const host = req.get("host") || "";
    const expectedOrigin = publicUrl ? origin : `http://${host}`;
    if (
      publicUrl
        ? host !== publicUrl.host
        : !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)
    )
      return res.status(403).send("Invalid host");
    if (req.get("origin") && req.get("origin") !== expectedOrigin)
      return res.status(403).send("Invalid origin");
    if (!publicUrl) return next();
    res.set("Cache-Control", "no-store");
    res.set("Referrer-Policy", "same-origin");
    res.set("X-Content-Type-Options", "nosniff");
    res.set(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    const valid = sessions(req.get("cookie"));
    if (req.path === "/login" && req.method === "GET")
      return valid ? res.redirect(303, "/") : res.type("html").send(page());
    if (req.path === "/login" && req.method === "POST") {
      if (req.get("origin") !== origin)
        return res.status(403).send("Invalid origin");
      return form(req, res, async (error) => {
        if (error)
          return res.status(400).type("html").send(page("请求格式不正确"));
        const time = now(),
          address = req.ip;
        for (const [key, value] of attempts)
          if (value.until <= time) attempts.delete(key);
        if (attempts.size > 1000 || (attempts.get(address)?.count || 0) >= 6)
          return res
            .status(429)
            .set("Retry-After", "900")
            .type("html")
            .send(page("尝试次数过多，请 15 分钟后再试"));
        const previous = attempts.get(address);
        attempts.set(address, {
          count: (previous?.count || 0) + 1,
          until: previous?.until || time + 900000,
        });
        const password = req.body?.password;
        if (
          typeof password !== "string" ||
          password.length < 12 ||
          password.length > 256
        )
          return res.status(401).type("html").send(page("访问密码不正确"));
        try {
          const [salt, expected] = passwordHash.split(":");
          if (
            !same(
              await derive(password, salt, 64),
              Buffer.from(expected, "hex"),
            )
          )
            return res.status(401).type("html").send(page("访问密码不正确"));
          attempts.delete(address);
          const expiry = String(Math.floor(now() / 1000) + lifetime);
          res.set(
            "Set-Cookie",
            `${cookieName}=${expiry}.${sign(expiry)}; ${cookieFlags}; Max-Age=${lifetime}`,
          );
          return res.redirect(303, "/");
        } catch (e) {
          next(e);
        }
      });
    }
    if (req.path === "/logout" && req.method === "POST") {
      if (req.get("origin") !== origin)
        return res.status(403).send("Invalid origin");
      res.set("Set-Cookie", `${cookieName}=; ${cookieFlags}; Max-Age=0`);
      return res.redirect(303, "/login");
    }
    if (valid) return next();
    if (req.path.startsWith("/api/") || !["GET", "HEAD"].includes(req.method))
      return res.status(401).json({ error: "请先登录同舟 AI 工作区" });
    return res.redirect(303, "/login");
  };
}
