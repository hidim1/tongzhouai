export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const res = await fetch("/api" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: body
      ? { "Content-Type": "application/json", "X-Tongzhou-Client": "workspace" }
      : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (await res.json()).error || message;
    } catch {}
    if (res.status === 401 && message === "请先登录同舟 AI 工作区")
      window.location.assign("/login");
    throw new Error(message);
  }
  return res.json();
}
export function bytes(n: number) {
  return n > 1048576
    ? (n / 1048576).toFixed(1) + " MB"
    : Math.max(1, Math.round(n / 1024)) + " KB";
}
export function date(s: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(new Date(s));
}
export function active(status: string) {
  return ["queued", "running", "approval"].includes(status);
}
