"""Small server-side trial quota and trusted-device activation helpers.

Browsers cannot disclose a network card MAC address to an internet server.  A
trusted Mac therefore proves the configured MAC hash once with the companion
local script, then receives the same HttpOnly device cookie used for trial
visitors.  This is a usage-control convenience, not a substitute for accounts
or a VPN: users can clear cookies and a MAC address can be spoofed.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path


DEVICE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{20,128}$")
MAC_HASH_PATTERN = re.compile(r"^[a-f0-9]{64}$")


class DeviceQuotaError(ValueError):
    """Raised when a trial device has no remaining quotation slots."""


class DeviceAccess:
    """Persisted device identities, three-quote trial slots and one-time activation links."""

    def __init__(self, path: Path, *, enabled: bool = False, trial_limit: int = 3, trusted_mac_hash: str = "", activation_ttl_seconds: int = 600):
        self.path = Path(path)
        self.enabled = bool(enabled)
        self.trial_limit = max(1, int(trial_limit))
        self.trusted_mac_hash = str(trusted_mac_hash or "").strip().lower()
        self.activation_ttl_seconds = max(60, int(activation_ttl_seconds))
        self.lock = threading.RLock()

    @staticmethod
    def normalized_mac_hash(mac_address: str) -> str:
        normalized = re.sub(r"[^0-9A-Fa-f]", "", str(mac_address)).lower()
        if not re.fullmatch(r"[0-9a-f]{12}", normalized):
            raise ValueError("MAC 地址格式无效")
        return hashlib.sha256(normalized.encode("ascii")).hexdigest()

    def _empty(self) -> dict:
        return {"version": 1, "devices": {}, "activations": {}}

    def _read(self) -> dict:
        if not self.path.exists():
            return self._empty()
        try:
            loaded = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return self._empty()
        if not isinstance(loaded, dict):
            return self._empty()
        loaded.setdefault("version", 1)
        loaded.setdefault("devices", {})
        loaded.setdefault("activations", {})
        return loaded

    def _write(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self.path)
        try:
            self.path.chmod(0o600)
        except OSError:
            pass

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="seconds")

    def _new_device(self, data: dict, device_id: str | None = None, *, trusted: bool = False) -> tuple[str, dict]:
        device_id = device_id if device_id and DEVICE_ID_PATTERN.fullmatch(device_id) else secrets.token_urlsafe(32)
        devices = data["devices"]
        device = devices.get(device_id)
        if not isinstance(device, dict):
            device = {"created_at": self._now(), "trusted": bool(trusted), "quote_ids": [], "image_quote_ids": []}
            devices[device_id] = device
        if trusted:
            device["trusted"] = True
        device.setdefault("quote_ids", [])
        device.setdefault("image_quote_ids", [])
        return device_id, device

    def ensure_device(self, device_id: str | None) -> dict:
        """Return a sanitized device context; write only when a new ID is issued."""
        if not self.enabled:
            return {"device_id": "local-unlimited", "trusted": True, "trial_limit": None, "remaining": None, "new": False}
        with self.lock:
            data = self._read()
            valid = str(device_id or "") if device_id else ""
            if not DEVICE_ID_PATTERN.fullmatch(valid):
                valid = None
            device_id, device = self._new_device(data, valid)
            self._write(data)
            used = len(set(str(value) for value in device["quote_ids"]))
            return {"device_id": device_id, "trusted": bool(device.get("trusted")), "trial_limit": self.trial_limit, "remaining": None if device.get("trusted") else max(0, self.trial_limit - used), "new": valid is None}

    def reserve_quote_pair(self, device_id: str, quote_id: str) -> dict:
        """Reserve one quotation and its first concept image atomically."""
        if not self.enabled:
            return self.ensure_device(device_id)
        with self.lock:
            data = self._read()
            device_id, device = self._new_device(data, device_id)
            quote_ids = device["quote_ids"]
            image_ids = device["image_quote_ids"]
            if quote_id not in quote_ids:
                if not device.get("trusted") and len(set(quote_ids)) >= self.trial_limit:
                    raise DeviceQuotaError(f"试用设备最多生成 {self.trial_limit} 份报价及概念图；请联系管理员开通权限")
                quote_ids.append(quote_id)
            if quote_id not in image_ids:
                image_ids.append(quote_id)
            self._write(data)
            used = len(set(quote_ids))
            return {"device_id": device_id, "trusted": bool(device.get("trusted")), "trial_limit": self.trial_limit, "remaining": None if device.get("trusted") else max(0, self.trial_limit - used), "new": False}

    def allow_concept_image(self, device_id: str, quote_id: str) -> None:
        """Allow retries for the image slot that was reserved with this quote only."""
        if not self.enabled:
            return
        with self.lock:
            data = self._read()
            _device_id, device = self._new_device(data, device_id)
            if device.get("trusted") or quote_id in device["image_quote_ids"]:
                return
            raise DeviceQuotaError("该报价不属于当前试用设备，无法生成概念图；请新建报价或联系管理员")

    def create_trusted_activation(self, mac_hash: str) -> str:
        """Create a short-lived one-time activation token after MAC-hash proof."""
        if not self.enabled:
            raise ValueError("当前服务未启用设备配额")
        supplied = str(mac_hash or "").strip().lower()
        if not self.trusted_mac_hash or not MAC_HASH_PATTERN.fullmatch(supplied) or not hmac.compare_digest(supplied, self.trusted_mac_hash):
            raise PermissionError("本机硬件校验未通过")
        with self.lock:
            data = self._read()
            device_id, _device = self._new_device(data, trusted=True)
            token = secrets.token_urlsafe(32)
            data["activations"][token] = {"device_id": device_id, "expires_at": int(time.time()) + self.activation_ttl_seconds}
            self._write(data)
            return token

    def consume_trusted_activation(self, token: str) -> str | None:
        with self.lock:
            data = self._read()
            entry = data["activations"].pop(str(token or ""), None)
            now = int(time.time())
            data["activations"] = {key: value for key, value in data["activations"].items() if isinstance(value, dict) and int(value.get("expires_at", 0)) >= now}
            if not isinstance(entry, dict) or int(entry.get("expires_at", 0)) < now:
                self._write(data)
                return None
            device_id = str(entry.get("device_id") or "")
            if not DEVICE_ID_PATTERN.fullmatch(device_id):
                self._write(data)
                return None
            self._new_device(data, device_id, trusted=True)
            self._write(data)
            return device_id
