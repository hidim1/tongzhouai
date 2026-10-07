import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { once } from "node:events";
import { createAccessGuard, hashPassword } from "../server/access.mjs";

// Native fetch can normalize/ignore Host. Use raw HTTP to exercise rebinding.
const requestRaw = (url, options = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolve(
          new Response(Buffer.concat(chunks), {
            status: res.statusCode,
            headers: Object.fromEntries(
              Object.entries(res.headers).map(([k, v]) => [k, String(v)]),
            ),
          }),
        ),
      );
    });
    req.on("error", reject);
    req.end(options.body?.toString());
  });

test("public workspace requires HTTPS, signed login, same origin, and expires sessions", async () => {
  const password = "test-workspace-passphrase";
  const passwordHash = await hashPassword(password);
  const sessionSecret = "a".repeat(64);
  let time = Date.now();
  const options = {
    origin: "https://workspace.example",
    passwordHash,
    sessionSecret,
    now: () => time,
  };
  assert.throws(() =>
    createAccessGuard({ ...options, origin: "http://workspace.example" }),
  );
  assert.throws(() =>
    createAccessGuard({ ...options, sessionSecret: "short" }),
  );
  const app = express();
  app.use(createAccessGuard(options));
  app.use((_req, res) => res.json({ protected: true }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, o = {}) =>
    requestRaw(base + url, {
      ...o,
      redirect: "manual",
      headers: { Host: "workspace.example", ...o.headers },
    });
  const login = (value = password) =>
    request("/login", {
      method: "POST",
      headers: {
        Origin: options.origin,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ password: value }),
    });
  try {
    assert.equal((await request("/")).status, 303);
    assert.equal((await request("/api/bootstrap")).status, 401);
    assert.equal(
      (await request("/", { headers: { Host: "attacker.example" } })).status,
      403,
    );
    assert.equal((await request("/login", { method: "POST" })).status, 403);
    assert.match(await (await request("/login")).text(), /工作区访问密码/);
    assert.equal((await login("wrong-test-password")).status, 401);
    const authenticated = await login();
    assert.equal(authenticated.status, 303);
    const header = authenticated.headers.get("set-cookie");
    assert.match(header, /HttpOnly; Secure; SameSite=Strict/);
    const cookie = header.split(";")[0];
    assert.equal(
      (await request("/api/bootstrap", { headers: { Cookie: cookie } })).status,
      200,
    );
    assert.equal(
      (await request("/api/bootstrap", { headers: { Cookie: cookie + "a" } }))
        .status,
      401,
    );
    assert.equal(
      (
        await request("/api/bootstrap", {
          headers: { Cookie: cookie, Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    const logout = await request("/logout", {
      method: "POST",
      headers: { Cookie: cookie, Origin: options.origin },
    });
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
    time += 13 * 60 * 60 * 1000;
    assert.equal(
      (await request("/api/bootstrap", { headers: { Cookie: cookie } })).status,
      401,
    );
    for (let i = 0; i < 6; i++)
      assert.equal((await login("wrong-test-password")).status, 401);
    assert.equal((await login()).status, 429);
    time += 16 * 60 * 1000;
    assert.equal((await login()).status, 303);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("local-only access remains the default", async () => {
  const app = express();
  app.use(createAccessGuard({ origin: "" }));
  app.use((_req, res) => res.send("local"));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await requestRaw(base)).status, 200);
    assert.equal(
      (await requestRaw(base, { headers: { Host: "public.example" } })).status,
      403,
    );
    assert.equal(
      (await requestRaw(base, { headers: { Origin: "https://evil.example" } }))
        .status,
      403,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("HTTP internal testing requires explicit opt-in, high port, source IP and signed login", async () => {
  const password = "internal-test-passphrase";
  const options = {
    origin: "http://workspace.example:18082",
    passwordHash: await hashPassword(password),
    sessionSecret: "b".repeat(64),
    allowHttpTest: true,
    httpTestAllowedIPs: "127.0.0.1,192.0.2.10",
  };
  assert.throws(() => createAccessGuard({ ...options, allowHttpTest: false }));
  assert.throws(() =>
    createAccessGuard({ ...options, origin: "http://workspace.example" }),
  );
  assert.throws(() =>
    createAccessGuard({ ...options, httpTestAllowedIPs: "" }),
  );
  assert.throws(() =>
    createAccessGuard({ ...options, httpTestAllowedIPs: "0.0.0.0/0" }),
  );
  assert.throws(() => createAccessGuard({ ...options, passwordHash: "bad" }));
  const app = express();
  // The production proxy overwrites X-Forwarded-For and the backend binds loopback.
  app.set("trust proxy", "loopback");
  app.use(createAccessGuard(options));
  app.use((_req, res) => res.json({ protected: true }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, o = {}) =>
    requestRaw(base + url, {
      ...o,
      headers: { Host: "workspace.example:18082", ...o.headers },
    });
  try {
    assert.equal((await request("/api/bootstrap")).status, 401);
    assert.equal(
      (
        await request("/login", {
          headers: { "X-Forwarded-For": "192.0.2.11" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/login", {
          headers: { "X-Forwarded-For": "192.0.2.10" },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/login", {
          headers: { Host: "workspace.example:18083" },
        })
      ).status,
      403,
    );
    assert.match(
      await (await request("/login")).text(),
      /HTTP 内测（未加密，限定来源 IP）/,
    );
    const authenticated = await request("/login", {
      method: "POST",
      headers: {
        Origin: options.origin,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ password }),
    });
    assert.equal(authenticated.status, 303);
    const cookieHeader = authenticated.headers.get("set-cookie");
    assert.match(cookieHeader, /^tongzhou_internal_18082=/);
    assert.match(cookieHeader, /HttpOnly; SameSite=Strict/);
    assert.doesNotMatch(cookieHeader, /Secure|__Host-/);
    const cookie = cookieHeader.split(";")[0];
    assert.equal(
      (await request("/api/bootstrap", { headers: { Cookie: cookie } })).status,
      200,
    );
    assert.equal(
      (
        await request("/api/bootstrap", {
          headers: { Cookie: cookie, "X-Forwarded-For": "192.0.2.11" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/api/bootstrap", {
          headers: { Cookie: cookie, Origin: "http://evil.example:18082" },
        })
      ).status,
      403,
    );
    const logout = await request("/logout", {
      method: "POST",
      headers: { Cookie: cookie, Origin: options.origin },
    });
    assert.match(
      logout.headers.get("set-cookie"),
      /^tongzhou_internal_18082=.*Max-Age=0/,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("explicit unrestricted HTTP mode requires both account and password for every source IP", async () => {
  const password = "unrestricted-test-passphrase";
  const options = {
    origin: "http://workspace.example:18082",
    passwordHash: await hashPassword(password),
    sessionSecret: "c".repeat(64),
    username: "tongzhou",
    allowHttpTest: true,
    httpTestAllowAnyIP: true,
    httpTestAllowedIPs: "",
  };
  assert.throws(() => createAccessGuard({ ...options, username: "" }));
  assert.throws(() => createAccessGuard({ ...options, username: "<invalid>" }));
  assert.throws(() =>
    createAccessGuard({ ...options, httpTestAllowAnyIP: false }),
  );
  assert.throws(() => createAccessGuard({ ...options, sessionSecret: "" }));
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(createAccessGuard(options));
  app.use((_req, res) => res.json({ protected: true }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, o = {}) =>
    requestRaw(base + url, {
      ...o,
      headers: {
        Host: "workspace.example:18082",
        "X-Forwarded-For": "192.0.2.10",
        ...o.headers,
      },
    });
  const login = (username, value = password) =>
    request("/login", {
      method: "POST",
      headers: {
        Origin: options.origin,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ username, password: value }),
    });
  try {
    const page = await (await request("/login")).text();
    assert.match(page, /name="username"/);
    assert.match(page, /HTTP 内测（未加密，账号密码登录）/);
    assert.doesNotMatch(page, /限定来源 IP/);
    for (const ip of ["192.0.2.10", "203.0.113.24", "2001:db8::1"]) {
      assert.equal(
        (await request("/login", { headers: { "X-Forwarded-For": ip } }))
          .status,
        200,
      );
      assert.equal(
        (
          await request("/api/bootstrap", {
            headers: { "X-Forwarded-For": ip },
          })
        ).status,
        401,
      );
    }
    assert.equal((await login("")).status, 401);
    const wrongAccount = await login("wrong-account");
    assert.equal(wrongAccount.status, 401);
    assert.match(await wrongAccount.text(), /账号或密码不正确/);
    assert.equal(
      (await login(options.username, "wrong-test-password")).status,
      401,
    );
    const authenticated = await login(options.username);
    assert.equal(authenticated.status, 303);
    const cookie = authenticated.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (
        await request("/api/bootstrap", {
          headers: { Cookie: cookie, "X-Forwarded-For": "203.0.113.24" },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/api/bootstrap", {
          headers: { Cookie: cookie, Origin: "http://evil.example:18082" },
        })
      ).status,
      403,
    );
    for (let i = 0; i < 6; i++)
      assert.equal((await login("wrong-account")).status, 401);
    assert.equal((await login(options.username)).status, 429);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
