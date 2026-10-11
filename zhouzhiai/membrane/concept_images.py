"""Persistent, non-blocking single-perspective jobs for an OpenAI-compatible image API."""
from __future__ import annotations

import base64
import io
import json
import os
import queue
import re
import threading
import tempfile
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from PIL import Image

ROOT = Path(__file__).resolve().parent
OUTPUT_MODE = "single_three_quarter_v1"
VIEWS = {"perspective": "三分之四视角 · 立体效果图"}
SIZE = (3840, 2160)
def accepted_image_size(size):
    width, height = size
    # The upstream service returns either 4:3 or 16:9 landscape images for a
    # three-quarter equipment render. Keep native pixels and reject only
    # thumbnails, square images and portrait/unrelated aspect ratios.
    ratio = width / height
    return 1400 <= width <= 3840 and 900 <= height <= 2160 and 1.25 <= ratio <= 1.85

MAX_IMAGE_BYTES = 20 * 1024 * 1024


def strict_component_count_instruction(description: str) -> str:
    """Make quoted component counts prominent in every image request.

    This is intentionally a generation instruction only.  It improves the
    model's composition discipline but does not pretend to be a post-image
    visual verification system.
    """
    patterns = (
        (r"\b(\d{1,2}) horizontal 8040 membrane housings\b", "horizontal 8040 membrane pressure vessel", "horizontal 8040 membrane pressure vessels"),
        (r"\bexactly (\d{1,2}) tubular ceramic membrane housings?\b", "tubular ceramic membrane housing", "tubular ceramic membrane housings"),
        (r"\b(\d{1,2}) hollow-fiber module banks\b", "hollow-fiber module bank", "hollow-fiber module banks"),
        (r"\b(\d{1,2}) electrodialysis stacks\b", "electrodialysis stack", "electrodialysis stacks"),
        (r"\b(\d{1,2}) vertical resin columns\b", "vertical resin column", "vertical resin columns"),
        (r"\b(\d{1,2}) regeneration tanks\b", "regeneration tank", "regeneration tanks"),
    )
    counted_components = []
    for pattern, singular, plural in patterns:
        match = re.search(pattern, description, flags=re.I)
        if match:
            count = int(match.group(1))
            counted_components.append((count, singular if count == 1 else plural))
    if not counted_components:
        return ""
    exact_counts = "; ".join(f"exactly {count} {label}" for count, label in counted_components)
    return (
        "NON-NEGOTIABLE BOM COMPONENT-COUNT CONSTRAINT: depict " + exact_counts + ". "
        "Every quoted component must be physically separate, individually countable, and visible in the final "
        "frame; preserve the required process connections, manifolds and support structure. Do not add, omit, "
        "merge, duplicate, crop, hide, or replace individually counted components with a generic equipment bank. "
        "If the composition is crowded, reduce the scale of the whole skid rather than changing any count. "
    )


def build_prompt(description: str) -> str:
    """Return the one shared production prompt used by local and remote workers."""
    return (
        "Industrial membrane equipment quotation concept rendering. " + strict_component_count_instruction(description) + description +
        "\nDeliver exactly ONE image of ONE complete equipment assembly, in a three-quarter perspective view. "
        "Place the camera at 35-45 degrees horizontally from the main operator/front side and slightly "
        "above the equipment (10-20 degrees elevation). Show the front control panel AND one side together, "
        "with some top surfaces visible, strong convincing three-dimensional depth and natural perspective. "
        "Full equipment including skid feet visible with 8% margins, centered in a landscape frame. "
        "Premium industrial factory setting: a spacious modern process-equipment workshop with deep navy-blue "
        "steel walls and columns, a clean factory background with only natural distant falloff, overhead linear LED high-bay lights, "
        "and a clean polished concrete floor with subtle realistic reflections. Soft contact shadows under the skid, "
        "realistic ambient occlusion, brushed stainless steel, realistic valves and connected piping, clean "
        "photorealistic industrial product visualization. Deep depth of field and crisp sharp focus across the entire "
        "equipment: sharp valves, gauges, pipe joints, cable connections and frame edges; no shallow depth of field, "
        "no bokeh, no motion blur, no soft-focus equipment. The equipment remains the only hero subject; no other "
        "machines, workers, vehicles, text, logos or safety signs in the scene. "
        "Use the supplied equipment specifications to determine components, quantities and proportions. "
        "Not an orthographic elevation, not a flat front view. No collage, no multiple panels, "
        "no separate front/left/right/back views, no inset, no duplicated equipment. "
        "No text, labels, dimensions, logos, humans or watermark."
    )


def load_config():
    # Local-only configuration; never returned by API or written into job metadata.
    values = {}
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text().splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip("\"'")
    return {key: os.environ.get(key, values.get(key, default)) for key, default in {
        "IMAGE_API_KEY": "", "IMAGE_API_BASE_URL": "https://api.mikoto.vip/v1",
        "IMAGE_MODEL": "gpt-image-2.5-sunburst",
    }.items()}


class ImageJobError(RuntimeError):
    pass


class ImageJobs:
    def __init__(self, root=None, config=None):
        self.root = Path(root or ROOT / "exports" / "concept-images")
        self.config = config if config is not None else load_config()
        self.lock = threading.RLock()
        self.active = set()
        self.pending = queue.Queue(maxsize=16)
        self.worker = None

    @property
    def configured(self):
        return bool(self.config["IMAGE_API_KEY"])

    def settings_status(self):
        with self.lock:
            return {"key1_configured": self.configured, "model": self.config["IMAGE_MODEL"],
                    "editable": not bool(os.environ.get("IMAGE_API_KEY")), "busy": bool(self.active)}

    def save_key1(self, value, env_path=None):
        if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9._-]{8,512}", value.strip()):
            raise ValueError("Key1 格式无效，请填写完整密钥（不可包含空格或换行）")
        value = value.strip()
        with self.lock:
            if os.environ.get("IMAGE_API_KEY"):
                raise ImageJobError("当前密钥由启动环境变量管理，请修改启动环境后重启")
            if self.active:
                raise ImageJobError("有图片任务正在执行或排队，请完成后再更换 Key1")
            target = Path(env_path or ROOT / ".env")
            lines = target.read_text().splitlines() if target.exists() else [
                "IMAGE_API_BASE_URL=" + self.config["IMAGE_API_BASE_URL"],
                "IMAGE_MODEL=" + self.config["IMAGE_MODEL"],
            ]
            lines = [line for line in lines if line.partition("=")[0].strip() != "IMAGE_API_KEY"]
            lines.append("IMAGE_API_KEY=" + value)
            fd, name = tempfile.mkstemp(prefix=".env.", suffix=".tmp", dir=target.parent)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as file:
                    file.write("\n".join(lines) + "\n")
                os.chmod(name, 0o600)
                os.replace(name, target)
            finally:
                Path(name).unlink(missing_ok=True)
            self.config["IMAGE_API_KEY"] = value
            return self.settings_status()

    def _directory(self, quote_id):
        if not re.fullmatch(r"Q\d{8}-\d{4}", quote_id):
            raise ImageJobError("报价编号无效")
        return self.root / quote_id

    def _read(self, quote_id):
        path = self._directory(quote_id) / "job.json"
        try:
            return json.loads(path.read_text())
        except (OSError, ValueError):
            return None

    def _write(self, job):
        folder = self._directory(job["quote_id"])
        folder.mkdir(parents=True, exist_ok=True)
        job["updated_at"] = datetime.now().isoformat(timespec="seconds")
        temp = folder / "job.tmp"
        temp.write_text(json.dumps(job, ensure_ascii=False, indent=2))
        temp.replace(folder / "job.json")

    def status(self, quote_id):
        with self.lock:
            job = self._read(quote_id)
            if not job or job.get("output_mode") != OUTPUT_MODE:
                message = "旧版四视图已保留，请生成单张立体效果图" if job else "保存报价后异步生成单张立体效果图"
                return {"status": "pending" if self.configured else "unavailable", "exists": False,
                        "message": message if self.configured else "请在生图设置中配置 Key1",
                        "model": self.config["IMAGE_MODEL"], "views": {}, "completed": 0, "total": 1}
            if job["status"] in {"queued", "running"} and job.get("execution_mode") != "mac_worker" and quote_id not in self.active:
                job.update(status="failed", message="上次生成被服务重启中断；请点击重试生成效果图")
                self._write(job)
            # Do not expose upstream URLs, input prompts or credentials to browsers.
            public = {key: job[key] for key in ("status", "message", "job_id", "model", "updated_at")}
            public["exists"] = job["status"] == "ready"
            public["views"] = {view: {"label": label, **job["views"].get(view, {"status": "pending"})}
                               for view, label in VIEWS.items()}
            public["completed"] = sum(v.get("status") == "ready" for v in job["views"].values())
            public["size_bytes"] = sum(v.get("size_bytes", 0) for v in job["views"].values())
            public["total"] = 1
            public["output_mode"] = OUTPUT_MODE
            return public

    def submit(self, quote_id, description):
        with self.lock:
            if quote_id in self.active:
                return self.status(quote_id)
            if not self.configured:
                raise ImageJobError("请在生图设置中配置 Key1")
            if self.pending.full():
                raise ImageJobError("生成队列已满，请稍后重试")
            job = self._read(quote_id)
            # Failed/interrupted jobs resume; complete jobs explicitly regenerate in a new folder.
            if not job or job.get("output_mode") != OUTPUT_MODE or job["status"] == "ready" or job.get("model") != self.config["IMAGE_MODEL"]:
                if job:
                    previous = self._directory(quote_id) / job["job_id"]
                    previous.mkdir(parents=True, exist_ok=True)
                    (previous / "job.json").write_text(json.dumps(job, ensure_ascii=False, indent=2))
                job = {"quote_id": quote_id, "job_id": uuid.uuid4().hex, "views": {},
                       "model": self.config["IMAGE_MODEL"], "description": description, "output_mode": OUTPUT_MODE}
            job.update(status="queued", message="已排队，后台生成单张立体效果图")
            self._write(job)
            self.active.add(quote_id)
            self.pending.put_nowait(quote_id)
            if self.worker is None or not self.worker.is_alive():
                self.worker = threading.Thread(target=self._consume, daemon=True, name="perspective-image")
                self.worker.start()
            return self.status(quote_id)

    def submit_remote(self, quote_id, description):
        """Queue one job for the authenticated macOS worker without a cloud API key."""
        with self.lock:
            job = self._read(quote_id)
            if job and job.get("execution_mode") == "mac_worker" and job.get("status") in {"queued", "running"}:
                return self.status(quote_id)
            if not job or job.get("output_mode") != OUTPUT_MODE or job.get("status") == "ready" or job.get("execution_mode") != "mac_worker" or job.get("model") != self.config["IMAGE_MODEL"]:
                if job:
                    previous = self._directory(quote_id) / job["job_id"]
                    previous.mkdir(parents=True, exist_ok=True)
                    (previous / "job.json").write_text(json.dumps(job, ensure_ascii=False, indent=2))
                job = {"quote_id": quote_id, "job_id": uuid.uuid4().hex, "views": {},
                       "model": self.config["IMAGE_MODEL"], "description": description,
                       "output_mode": OUTPUT_MODE, "execution_mode": "mac_worker"}
            job.update(status="queued", message="已排队，等待本机生图代理")
            job["views"]["perspective"] = {"status": "queued"}
            self._write(job)
            return self.status(quote_id)

    def claim_remote(self):
        """Atomically claim the oldest queued job for the single trusted Mac worker."""
        with self.lock:
            now = datetime.now()
            candidates = []
            for path in self.root.glob("Q????????-????/job.json"):
                try:
                    job = json.loads(path.read_text())
                except (OSError, ValueError):
                    continue
                if job.get("output_mode") != OUTPUT_MODE or job.get("execution_mode") != "mac_worker":
                    continue
                if job.get("status") == "running":
                    try:
                        claimed = datetime.fromisoformat(job.get("claimed_at", ""))
                    except ValueError:
                        claimed = now - timedelta(hours=1)
                    if now - claimed > timedelta(minutes=15):
                        job.update(status="queued", message="本机生图代理连接中断，已重新排队")
                        job["views"]["perspective"] = {"status": "queued"}
                        self._write(job)
                if job.get("status") == "queued":
                    candidates.append(job)
            if not candidates:
                return None
            job = min(candidates, key=lambda item: item.get("updated_at", ""))
            job.update(status="running", message="本机生图代理正在生成", claimed_at=now.isoformat(timespec="seconds"))
            job["views"]["perspective"] = {"status": "running"}
            self._write(job)
            return {key: job[key] for key in ("quote_id", "job_id", "model", "description")}

    def complete_remote(self, quote_id, job_id, raw):
        with self.lock:
            job = self._read(quote_id)
            if not job or job.get("execution_mode") != "mac_worker" or job.get("job_id") != job_id or job.get("status") != "running":
                raise ImageJobError("云端任务已过期或不属于当前本机代理")
            target = self._directory(quote_id) / job_id / "perspective.jpg"
            target.parent.mkdir(parents=True, exist_ok=True)
            width, height = self._save_image(raw, target)
            job["views"]["perspective"] = {"status": "ready", "width": width, "height": height,
                "size_bytes": target.stat().st_size, "url": f"/api/quotes/{quote_id}/concept-image.jpg?v={job_id}"}
            job.update(status="ready", message="单张立体效果图已完成 · 由本机生图代理生成")
            self._write(job)
            return self.status(quote_id)

    def fail_remote(self, quote_id, job_id, message):
        with self.lock:
            job = self._read(quote_id)
            if not job or job.get("execution_mode") != "mac_worker" or job.get("job_id") != job_id:
                raise ImageJobError("云端任务已过期或不属于当前本机代理")
            job["views"]["perspective"] = {"status": "failed"}
            job.update(status="failed", message=message[:300])
            self._write(job)
            return self.status(quote_id)

    def _consume(self):
        while True:
            quote_id = self.pending.get()
            try:
                self._run(quote_id)
            except Exception as error:
                with self.lock:
                    job = self._read(quote_id)
                    job.update(status="failed", message=str(error) if isinstance(error, ImageJobError) else "图片生成失败，请手动重试")
                    for view in job["views"].values():
                        if view.get("status") == "running":
                            view["status"] = "failed"
                    self._write(job)
            finally:
                with self.lock:
                    self.active.discard(quote_id)
                self.pending.task_done()

    def _request_image(self, prompt, reference=None, model=None):
        payload = {"model": model or self.config["IMAGE_MODEL"], "prompt": prompt, "size": "3840x2160",
                   "aspect_ratio": "16:9", "quality": "high", "response_format": "url", "n": 1}
        if reference:
            payload["images"] = [{"image_url": reference}]
        endpoint = "/images/edits" if reference else "/images/generations"
        request = Request(self.config["IMAGE_API_BASE_URL"].rstrip("/") + endpoint,
                          data=json.dumps(payload).encode(), headers={"Authorization": "Bearer " + self.config["IMAGE_API_KEY"], "Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=600) as response:
                result = json.loads(response.read(64 * 1024 * 1024))
            item = result["data"][0]
            url = item.get("url")
            if url:
                if urlparse(url).scheme != "https":
                    raise ImageJobError("生图服务返回了非 HTTPS 图片地址")
                # No Authorization header is forwarded to the image host.
                with urlopen(url, timeout=120) as response:
                    raw = response.read(40 * 1024 * 1024 + 1)
                if len(raw) > 40 * 1024 * 1024:
                    raise ImageJobError("上游图片过大")
            else:
                raw = base64.b64decode(item["b64_json"], validate=True)
            return raw, url
        except HTTPError as error:
            raise ImageJobError(f"生图服务返回 HTTP {error.code}，请检查模型权限、额度或稍后重试") from None
        except (URLError, TimeoutError):
            raise ImageJobError("生图连接失败或超时；可手动重试，不会自动重复计费请求") from None
        except (ValueError, KeyError, IndexError, TypeError):
            raise ImageJobError("生图服务返回格式无效") from None

    def _save_image(self, raw, target):
        try:
            with Image.open(io.BytesIO(raw)) as image:
                if not accepted_image_size(image.size):
                    # Retain the exact upstream artifact for diagnosis, never mark it ready.
                    suffix = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp"}.get(image.format, ".bin")
                    target.with_name(target.stem + "_rejected_original" + suffix).write_bytes(raw)
                    raise ImageJobError(f"上游返回 {image.width}×{image.height}，不是已接受的横向原始分辨率（至少 1400×900，4:3 或 16:9）；未进行放大")
                image.load()
                if image.mode == "RGBA":
                    background = Image.new("RGB", image.size, "white")
                    background.paste(image, mask=image.getchannel("A"))
                    image = background
                else:
                    image = image.convert("RGB")
                # Preserve fine pipe, valve and instrument detail.  4:2:0
                # chroma subsampling visibly softens stainless/blue edge detail.
                for quality in (98, 95, 90, 85):
                    buffer = io.BytesIO()
                    image.save(buffer, "JPEG", quality=quality, subsampling=0, optimize=True)
                    if buffer.tell() <= MAX_IMAGE_BYTES:
                        target.write_bytes(buffer.getvalue())
                        return image.size
                raise ImageJobError("图片超出单张 20 MB 限制")
        except (OSError, Image.DecompressionBombError):
            raise ImageJobError("生图服务未返回有效图片") from None

    def _run(self, quote_id):
        with self.lock:
            job = self._read(quote_id)
            job.update(status="running", message="正在生成单张三分之四视角立体效果图")
            job["views"]["perspective"] = {"status": "running"}
            self._write(job)
        folder = self._directory(quote_id) / job["job_id"]
        folder.mkdir(parents=True, exist_ok=True)
        prompt = build_prompt(job["description"])
        # Exactly one billable generation request. No side-view edits or automatic retries.
        raw, url = self._request_image(prompt, model=job["model"])
        (folder / "perspective_source.json").write_text(json.dumps({"url": url, "bytes": len(raw)}, ensure_ascii=False))
        target = folder / "perspective.jpg"
        width, height = self._save_image(raw, target)
        with self.lock:
            job["views"]["perspective"] = {"status": "ready", "width": width, "height": height,
                "size_bytes": target.stat().st_size,
                "url": f"/api/quotes/{quote_id}/concept-image.jpg?v={job['job_id']}"}
            job.update(status="ready", message="单张立体效果图已完成 · 三分之四视角")
            self._write(job)

    def artifact(self, quote_id, view=None):
        with self.lock:
            job = self._read(quote_id)
            if not job:
                return None
            if job.get("output_mode") == OUTPUT_MODE:
                view = view or "perspective"
                if view != "perspective" or job["status"] != "ready":
                    return None
                filename = "perspective.jpg"
            else:
                # Preserve old four-view downloads until an explicit new generation.
                if view not in {None, "front", "left", "right", "back"}:
                    return None
                if view is None and job["status"] != "ready":
                    return None
                if view and job["views"].get(view, {}).get("status") != "ready":
                    return None
                filename = f"{view}.jpg" if view else "four-views.zip"
            target = self._directory(quote_id) / job["job_id"] / filename
            return target if target.is_file() else None
