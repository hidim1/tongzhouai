#!/usr/bin/env python3
"""膜设备成本预算本地服务：报价持久化与原生实体 DWG 导出。"""
from __future__ import annotations

import csv
import hmac
import io
import json
import math
import mimetypes
import os
import re
import struct
import subprocess
import zipfile
import zlib
import threading

from datetime import datetime
from http.cookies import SimpleCookie
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from xml.etree import ElementTree

import ezdxf

from access_control import DeviceAccess, DeviceQuotaError
from concept_images import ImageJobs, ImageJobError

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
QUOTES_FILE = DATA_DIR / "quotes.json"
PROJECTS_FILE = DATA_DIR / "projects.json"
PROJECT_FILES_DIR = DATA_DIR / "project-files"
MATERIAL_LIST_TEMPLATE_FILE = DATA_DIR / "templates" / "material-list-template.xlsx"
DEVICE_ACCESS_FILE = DATA_DIR / "device_access.json"
HISTORY_TEMPLATES_FILE = DATA_DIR / "history_templates.json"
MATERIAL_CATALOG_FILE = DATA_DIR / "historical_material_catalog.json"
MATERIAL_MASTER_FILE = DATA_DIR / "material_master.json"
PROCUREMENT_PRICE_BOOK_FILE = DATA_DIR / "procurement_price_book.json"
HISTORICAL_PRICE_LINKS_FILE = DATA_DIR / "historical_bom_price_links.json"
MATERIAL_MASTER_SOURCE = Path("/Users/lhy19950000/Desktop/物料_20260803.xlsx")
PROCUREMENT_PRICE_SOURCE = Path("/Users/lhy19950000/Desktop/采购价目表_2026052909210940_100628.xlsx")
EXPORT_DIR = ROOT / "exports"
# AutoCAD command scripts require an ASCII-only path.  Store native scripts
# and DWGs in a short ASCII user folder; BOM/CSV exports stay in the project
# folder (which may contain Chinese characters).
NATIVE_DIR = Path("/Users/lhy19950000/exports")
AUTOCAD_BINARY = Path("/Applications/Autodesk/AutoCAD 2026/AutoCAD 2026.app/Contents/MacOS/AutoCAD")
AUTOCAD_CORE_CONSOLE = Path("/Applications/Autodesk/AutoCAD 2026/AutoCAD 2026.app/Contents/Helpers/AcCoreConsole.app/Contents/MacOS/AcCoreConsole")
# The quotation system keeps the 3D controls visible for the future component
# library workflow, but does not launch AutoCAD while only generic geometry is
# available. Set to True after validated supplier / in-house models are loaded.
NATIVE_3D_BUILD_ENABLED = False
# Keep the 2D drawing controls in the UI for the future template workflow, but
# do not expose a generation/download service while only visual PDF traces are
# available.  It must be explicitly re-enabled after editable drawing assets
# and a reviewed mapping pipeline are in place.
QUOTE_2D_BUILD_ENABLED = False
IMAGE_JOBS = ImageJobs()
QUOTE_WRITE_LOCK = threading.RLock()
QUOTE_CONCEPT_IMAGE_ENABLED = True
QUOTE_CONCEPT_IMAGE_PROVIDER = "openai-compatible"
QUOTE_CONCEPT_IMAGE_MODEL = IMAGE_JOBS.config["IMAGE_MODEL"]
MAX_BOM_BYTES = 5 * 1024 * 1024
MAX_PROJECT_FILE_BYTES = 20 * 1024 * 1024

def environment_enabled(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


DEVICE_QUOTA_ENABLED = environment_enabled("DEVICE_QUOTA_ENABLED")
TRIAL_QUOTE_LIMIT = int(os.environ.get("TRIAL_QUOTE_LIMIT", "3"))
TRUSTED_MAC_SHA256 = os.environ.get("TRUSTED_MAC_SHA256", "")
DEVICE_ACCESS = DeviceAccess(
    DEVICE_ACCESS_FILE,
    enabled=DEVICE_QUOTA_ENABLED,
    trial_limit=TRIAL_QUOTE_LIMIT,
    trusted_mac_hash=TRUSTED_MAC_SHA256,
)
DEVICE_COOKIE_NAME = "membrane_device"
SERVER_HOST = os.environ.get("SERVER_HOST", "127.0.0.1")
SERVER_PORT = int(os.environ.get("SERVER_PORT", "8765"))
REMOTE_IMAGE_WORKER_ENABLED = environment_enabled("REMOTE_IMAGE_WORKER_ENABLED")
REMOTE_IMAGE_WORKER_TOKEN = os.environ.get("REMOTE_IMAGE_WORKER_TOKEN", "")

# The deployment package includes historical files under this root, so a
# Linux server never depends on the developer's macOS Downloads folder.
HISTORY_SOURCE_ROOT = Path(os.environ.get("HISTORY_SOURCE_ROOT", str(DATA_DIR / "historical-source"))).expanduser()
HISTORY_PROJECT_SOURCES = (
    ("CF20240718GA", "长春灿盛", HISTORY_SOURCE_ROOT / "CF20240718GA 长春灿盛"),
    ("CF20250506GA", "百色正丰", HISTORY_SOURCE_ROOT / "CF20250506GA-百色正丰"),
    ("CF20251217GA", "淄博康克源", HISTORY_SOURCE_ROOT / "CF20251217GA-淄博康克源-图纸"),
    ("CF20251226GA", "通辽梅花（赖氨酸陶瓷膜）", HISTORY_SOURCE_ROOT / "CF20251226GA-通辽梅花-图纸"),
    ("CF20260101GA", "济南圣泉", HISTORY_SOURCE_ROOT / "CF20260101GA-济南圣泉-图纸"),
    ("CF20260104GA", "昆明药物", HISTORY_SOURCE_ROOT / "CF20260104GA-昆明药物-图纸"),
    ("CF20260106GA", "福建大闽", HISTORY_SOURCE_ROOT / "CF20260106GA-福建大闽-图纸"),
    ("CF20260225GA", "陕西科技大学", HISTORY_SOURCE_ROOT / "CF20260225GA-陕科大-图纸"),
    ("CF20260303GA", "通辽梅花（连续离交）", HISTORY_SOURCE_ROOT / "CF20260303GA-通辽梅花图纸"),
    ("CF20260309GA", "石家庄杰克", HISTORY_SOURCE_ROOT / "CF20260309GA-石家庄杰克图纸"),
    ("CF20260320GA", "天台新银象", HISTORY_SOURCE_ROOT / "CF20260320GA-天台新银象图纸"),
    ("CF20260326GA", "厦门朝阳", HISTORY_SOURCE_ROOT / "CF20260326GA-厦门朝阳图纸"),
    ("CF20260428GA", "嘉兴诚达", HISTORY_SOURCE_ROOT / "CF20260428GA-嘉兴诚达图纸"),
)
HISTORY_FILE_EXTENSIONS = {".pdf", ".dwg", ".dxf", ".step", ".stp", ".iges", ".igs", ".sldprt", ".sldasm", ".ipt", ".iam"}
HISTORY_BOM_OVERRIDES = {
    "CF20251226GA": HISTORY_SOURCE_ROOT / "BOM正查_2026091508424322_100628.xlsx",
}

INDUSTRIES = {
    "pharma": {"name": "制药 / 生物制药", "factor": 1.22, "requirements": ["316L 湿接触", "卫生级焊接与钝化", "CIP 与 GMP 文件支持"]},
    "food": {"name": "食品饮料", "factor": 1.04, "requirements": ["卫生连接", "CIP", "食品接触合规"]},
    "chemical": {"name": "精细化工", "factor": 1.13, "requirements": ["耐腐蚀材质", "耐溶剂膜", "防爆条件核查"]},
    "water": {"name": "工业水处理", "factor": 0.86, "requirements": ["通量与能耗", "现场安装", "远程监控可选"]},
    "battery": {"name": "新能源 / 锂电", "factor": 1.30, "requirements": ["耐酸碱/溶剂", "金属离子控制", "防爆条件核查"]},
}
ROUTES = {"uf": ("卷式超滤 UF", 10500), "nf": ("卷式纳滤 NF", 12800), "ro": ("卷式 RO", 11800), "hollow": ("中空膜", 23500), "ceramic": ("陶瓷膜", 39500), "ed": ("电渗析膜组", 31000), "ion_exchange": ("连续离交", 36000)}
TIERS = {
    "low": {"name": "低档方案", "factor": 0.78, "margin": 0.20, "description": "标准配置、单泵、基础控制"},
    "mid": {"name": "推荐中档", "factor": 1.00, "margin": 0.25, "description": "常规生产、卫生级与仪表平衡"},
    "high": {"name": "高档方案", "factor": 1.34, "margin": 0.28, "description": "冗余泵组、加强仪表与文件支持"},
}
EXPLOSION_CLASSES = {
    "pending": {"label": "防爆等级待确认", "factor": 1.00},
    "zone2_iic_t4_gc": {"label": "气体 Zone 2 · Ex ec IIC T4 Gc", "factor": 0.90},
    "zone1_iib_t4_gb": {"label": "气体 Zone 1 · Ex db IIB T4 Gb", "factor": 1.00},
    "zone1_iic_t4_gb": {"label": "气体 Zone 1 · Ex db IIC T4 Gb", "factor": 1.15},
    "zone0_1_ia_iic_t4_ga": {"label": "气体 Zone 0/1 · Ex ia IIC T4 Ga（仪表回路）", "factor": 1.20},
    "dust_iiic_t135_db": {"label": "粉尘 Zone 21/22 · Ex tb IIIC T135°C Db", "factor": 1.10},
}

MODEL_MATERIAL_CODES = {"pharma": "8", "food": "6", "chemical": "3", "water": "2", "battery": "3"}
HISTORICAL_MODEL_PATTERN = re.compile(r"(?<![A-Z0-9])(?:SW(?:\d{4,}|O\d{3,})|CR\d{4,}|HF\d{4,}|ED\d{4,}|IX\d{4,})-\d+[A-Z]+\d+|CROSSEPION-M\d+[A-Z]?(?![A-Z0-9])", re.I)


def historical_model_code(value: str) -> str:
    match = HISTORICAL_MODEL_PATTERN.search(value.upper())
    return match.group(0).upper() if match else ""


def equipment_model(record: dict) -> dict:
    """Build a preliminary equipment-model code from the published naming rule.

    The returned value is deliberately marked as a budget model: membrane-core
    size, module count, pressure and explosion rating must be frozen in the BOM
    before it becomes a production nameplate model.
    """
    routes = set(record.get("routes") or [])
    industry = record.get("industry", "water")
    material = MODEL_MATERIAL_CODES.get(industry, "2")
    explosion_proof = bool(record.get("explosion_proof"))
    explosion_note = f"防爆配置：{record.get('explosion_class_label') or '等级与区域划分待确认'}" if explosion_proof else "默认非防爆"
    spiral = bool(routes & {"uf", "nf", "ro"})
    if spiral:
        groups = min(9, max(1, len(routes)))
        shells = max(1, int(record.get("spiral_shells", 0) or 1))
        cores = max(1, int(record.get("spiral_cores", 0) or shells * 4) // shells)
        pressure = 30 if routes & {"nf", "ro"} else 10
        code = f"SW{groups}{cores:02d}{shells:02d}-{material}N{pressure:02d}(8040)"
        return {"code": code, "system": "卧式卷式膜系统", "status": f"预算型号：按 8040 四芯膜壳、{explosion_note}与设计压力推定"}
    if "ceramic" in routes:
        code = f"CR16101-{material}N06(C40-1200)"
        return {"code": code, "system": "陶瓷管式膜系统", "status": "预算型号：膜芯 61 芯、单膜壳及 C40-1200 为暂定值"}
    if "hollow" in routes:
        code = f"HF00101-{material}N03(2860)"
        return {"code": code, "system": "中空纤维膜系统", "status": f"预算型号：单膜组件、2860 规格及{explosion_note}为暂定值"}
    if "ed" in routes:
        code = f"ED002001-{int(material):02d}N03"
        return {"code": code, "system": "电渗析膜系统", "status": f"预算型号：200 对膜、单膜组件及{explosion_note}为暂定值"}
    if "ion_exchange" in routes:
        code = f"IX00330-{material}N06"
        return {"code": code, "system": "连续离交系统", "status": "预算型号：树脂柱规格、阀主机与布水器配置待工艺条件确认"}
    return {"code": "待确认", "system": "未识别膜系统", "status": "请先选择技术路线"}


def load_quotes() -> list[dict]:
    if not QUOTES_FILE.exists():
        return []
    try:
        data = json.loads(QUOTES_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def save_quotes(quotes: list[dict]) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    temp = QUOTES_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(quotes, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(QUOTES_FILE)


def load_projects() -> list[dict]:
    """Load project-workspace records without coupling them to quotations."""
    if not PROJECTS_FILE.exists():
        return []
    try:
        data = json.loads(PROJECTS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def save_projects(projects: list[dict]) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    temp = PROJECTS_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(projects, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(PROJECTS_FILE)


def project_optional_number(value: object, label: str, *, minimum: float = 0, maximum: float = 1_000_000) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (ValueError, TypeError):
        raise ValueError(f"{label}必须是数字")
    if not minimum <= number <= maximum:
        raise ValueError(f"{label}需在 {minimum:g} 至 {maximum:g} 之间")
    return number


ROUTE_CONFIG_FIELDS = {
    "uf": {"numbers": {"required_area_m2": (0, 10_000_000), "effective_area_m2": (0.01, 100_000), "element_count": (0, 1_000_000), "elements_per_housing": (1, 100), "housing_count": (0, 100_000), "pressure_bar": (0, 1_000)}, "texts": ("membrane_model", "membrane_material", "mwco")},
    "nf": {"numbers": {"required_area_m2": (0, 10_000_000), "effective_area_m2": (0.01, 100_000), "element_count": (0, 1_000_000), "elements_per_housing": (1, 100), "housing_count": (0, 100_000), "pressure_bar": (0, 1_000)}, "texts": ("membrane_model", "membrane_material", "mwco")},
    "ro": {"numbers": {"required_area_m2": (0, 10_000_000), "effective_area_m2": (0.01, 100_000), "element_count": (0, 1_000_000), "elements_per_housing": (1, 100), "housing_count": (0, 100_000), "pressure_bar": (0, 1_000)}, "texts": ("membrane_model", "membrane_material", "rejection_requirement")},
    "hollow": {"numbers": {"required_area_m2": (0, 10_000_000), "effective_area_m2": (0.01, 100_000), "module_count": (0, 1_000_000), "design_flux_lmh": (0, 100_000)}, "texts": ("module_model", "membrane_material", "operation_mode")},
    "ceramic": {"numbers": {"required_area_m2": (0, 10_000_000), "effective_area_m2": (0.01, 100_000), "element_count": (0, 1_000_000), "housing_count": (0, 100_000), "tmp_bar": (0, 1_000), "circulation_flow_m3h": (0, 100_000)}, "texts": ("element_model", "membrane_material", "pore_size_um")},
    "ed": {"numbers": {"stack_count": (0, 100_000), "membrane_pairs": (0, 1_000_000), "effective_area_m2": (0.01, 100_000), "current_density_a_m2": (0, 1_000_000)}, "texts": ("stack_model", "electrode_liquid", "conductivity_requirement")},
    "ion_exchange": {"numbers": {"resin_volume_l": (0, 10_000_000), "vessel_count": (0, 100_000), "cycle_time_min": (0, 1_000_000)}, "texts": ("resin_type", "equipment_form", "regeneration_medium")},
}

def project_route_config(payload: dict, route: str) -> dict:
    """Validate the route-specific engineering inputs without forcing a membrane schema on all routes."""
    if not isinstance(payload, dict):
        raise ValueError(f"{ROUTES[route][0]}路线参数格式无效")
    schema = ROUTE_CONFIG_FIELDS[route]
    result = {}
    for field, (minimum, maximum) in schema["numbers"].items():
        result[field] = project_optional_number(payload.get(field), f"{ROUTES[route][0]} · {field}", minimum=minimum, maximum=maximum)
    for field in schema["texts"]:
        result[field] = str(payload.get(field) or "").strip()[:160]
    return result


def project_route_configs(project: dict) -> dict:
    """Return persisted route configurations, including a read-only compatibility view of legacy projects."""
    routes = project.get("routes") or ([project.get("route")] if project.get("route") else [])
    raw = project.get("route_configs") if isinstance(project.get("route_configs"), dict) else {}
    result = {route: raw[route] for route in routes if route in raw and isinstance(raw[route], dict)}
    for route in routes:
        if route in result:
            continue
        if route in {"uf", "nf", "ro"}:
            result[route] = {"required_area_m2": project.get("required_membrane_area_m2"), "effective_area_m2": project.get("element_area_m2"), "element_count": project.get("design_membrane_count"), "elements_per_housing": project.get("elements_per_shell"), "housing_count": None, "pressure_bar": None, "membrane_model": "", "membrane_material": "", "mwco": ""}
        elif route == "ceramic":
            result[route] = {"required_area_m2": project.get("required_membrane_area_m2"), "effective_area_m2": project.get("element_area_m2"), "element_count": project.get("design_membrane_count"), "housing_count": None, "tmp_bar": None, "circulation_flow_m3h": None, "element_model": "", "membrane_material": "", "pore_size_um": ""}
        elif route == "hollow":
            result[route] = {"required_area_m2": project.get("required_membrane_area_m2"), "effective_area_m2": project.get("element_area_m2"), "module_count": project.get("design_membrane_count"), "design_flux_lmh": None, "module_model": "", "membrane_material": "", "operation_mode": ""}
        else:
            result[route] = {}
    return result


def project_payload(payload: dict) -> dict:
    """Validate the small requirement schema used to match a historical sample.

    Route-specific numbers remain accepted as optional *override* data for old
    projects.  They are deliberately not the required entry point for a new
    equipment enquiry: the first scheme comes from the history library.
    """
    name = str(payload.get("name") or "未命名项目").strip()[:80]
    supplied_routes = payload.get("routes", [])
    if not isinstance(supplied_routes, list):
        raise ValueError("技术路线格式无效")
    routes = [str(item) for item in supplied_routes if str(item) in ROUTES]
    route = str(payload.get("route") or "").strip()
    if route and route not in ROUTES:
        raise ValueError("技术路线无效")
    if route and route not in routes:
        routes.insert(0, route)
    route = routes[0] if routes else ""
    industry = str(payload.get("industry") or "").strip()
    if industry and industry not in INDUSTRIES:
        raise ValueError("客户行业无效")
    compliance = str(payload.get("compliance") or "").strip()
    if compliance and compliance not in {"standard", "sanitary", "gmp"}:
        raise ValueError("合规等级无效")
    supplied_configs = payload.get("route_configs", {})
    if supplied_configs not in ({}, None) and not isinstance(supplied_configs, dict):
        raise ValueError("路线工程参数格式无效")
    route_configs = {route_name: project_route_config(supplied_configs.get(route_name, {}), route_name) for route_name in routes if route_name in supplied_configs}
    primary = route_configs.get(route, {})
    project_type = str(payload.get("project_type") or "new").strip()
    if project_type not in {"new", "retrofit"}:
        raise ValueError("项目类型无效")
    selected_template_id = str(payload.get("selected_template_id") or "").strip()[:80]
    return {
        "name": name,
        "customer": str(payload.get("customer") or "").strip()[:80],
        "project_type": project_type,
        "process_medium": str(payload.get("process_medium") or "").strip()[:160],
        "selected_template_id": selected_template_id,
        "industry": industry,
        "route": route,
        "routes": routes,
        "capacity_m3h": project_optional_number(payload.get("capacity_m3h"), "设计处理量", minimum=0.1, maximum=10_000),
        "batch_volume_m3": project_optional_number(payload.get("batch_volume_m3"), "单批体积", minimum=0, maximum=100_000),
        "route_configs": route_configs,
        # Keep legacy fields for saved phase-one records and old clients. New calculations read route_configs.
        "required_membrane_area_m2": project_optional_number(payload.get("required_membrane_area_m2", primary.get("required_area_m2")), "URS 要求膜面积", minimum=0, maximum=10_000_000),
        "design_membrane_area_m2": project_optional_number(payload.get("design_membrane_area_m2"), "设计输入膜面积", minimum=0, maximum=10_000_000),
        "design_membrane_count": project_optional_number(payload.get("design_membrane_count", primary.get("element_count", primary.get("module_count"))), "设计输入膜元件数量", minimum=0, maximum=1_000_000),
        "element_area_m2": project_optional_number(payload.get("element_area_m2", primary.get("effective_area_m2")), "单支膜面积", minimum=0.01, maximum=100_000),
        "elements_per_shell": project_optional_number(payload.get("elements_per_shell", primary.get("elements_per_housing")), "单膜壳装膜数", minimum=1, maximum=100),
        "compliance": compliance,
        "input_confirmed": bool(payload.get("input_confirmed")),
        "notes": str(payload.get("notes") or "").strip()[:2_000],
    }


def project_conflicts(project: dict) -> list[dict]:
    """Validate a requirement and its matched historical scheme.

    A customer normally knows the duty, route and compliance boundary, not the
    exact membrane housing loading or valve manifold.  Missing detailed route
    parameters are therefore review notes, never a request to redesign the
    equipment before a history sample has even been selected.
    """
    issues: list[dict] = []
    routes = set(project.get("routes") or ([project.get("route")] if project.get("route") else []))
    if not routes:
        issues.append({"severity": "error", "field": "route", "code": "route_missing", "message": "未选择技术路线，不能生成可审核的 BOM 初稿。"})
    if not project.get("input_confirmed"):
        issues.append({"severity": "error", "field": "input_confirmed", "code": "input_not_confirmed", "message": "尚未确认项目输入已完成；预算预览、正式报价与概念图保持锁定。"})
    if not project.get("capacity_m3h"):
        issues.append({"severity": "warning", "field": "capacity_m3h", "code": "capacity_missing", "message": "未填写设计处理量；BOM 初稿不会按流量选泵。"})
    selected = history_template_for_project(project)
    if project.get("project_id") and routes and project.get("input_confirmed") and not selected:
        issues.append({"severity": "error", "field": "selected_template_id", "code": "history_template_missing", "message": "未匹配到可复用的历史样机；请调整技术路线或转入人工方案评审。"})
    elif selected:
        issues.append({"severity": "warning", "field": "selected_template_id", "code": "history_template_review", "message": f"已引用历史样机“{selected.get('project_name')}”；处理量、介质和接口差异须在报价审核时确认。"})
    # Optional membrane/route fields are useful history filters and must still
    # be internally consistent when an engineer supplies them.
    for route, config in project_route_configs(project).items():
        if route not in {"uf", "nf", "ro", "hollow", "ceramic"}:
            continue
        required, effective = config.get("required_area_m2"), config.get("effective_area_m2")
        count = config.get("element_count", config.get("module_count"))
        if required and effective and count and effective * count < required:
            issues.append({"severity": "error", "field": f"route_configs.{route}", "code": "membrane_area_below_requirement", "message": f"{ROUTES[route][0]}的可选校核参数按 {count:g} × {effective:g} ㎡仅 {count * effective:g} ㎡，低于目标有效面积 {required:g} ㎡。"})
    if project.get("batch_volume_m3") and project.get("capacity_m3h") and project["batch_volume_m3"] > project["capacity_m3h"] * 24:
        issues.append({"severity": "warning", "field": "batch_volume_m3", "code": "batch_capacity_review", "message": "单批体积大于按 24 小时计算的理论处理量，请核查批次时长、回流和浓缩倍数。"})
    return issues


def project_historical_bom_assembly(project: dict, historical: dict) -> dict:
    """Create a traceable project BOM from a historical BOM and explicit rules.

    This is deliberately conservative: a historical line is changed only where
    the user supplied an unambiguous, route-specific count.  Capacity, medium,
    compliance and free-text notes create review items instead of silently
    scaling pipes, pumps or vessels.  AI-based drawing interpretation can add
    further rules later without changing the project-BOM contract.
    """
    source_export = historical.get("bom", {}).get("source_export", {})
    raw_rows = source_export.get("rows", []) if isinstance(source_export.get("rows"), list) else []
    headers = source_export.get("headers", []) if isinstance(source_export.get("headers"), list) else []
    columns = source_export.get("columns", []) if isinstance(source_export.get("columns"), list) else []
    header_columns = {header: column for header, column in zip(headers, columns)}
    raw_indexes: dict[tuple[str, str, str], list[int]] = {}
    for index, raw in enumerate(raw_rows):
        key = (
            str(raw.get(header_columns.get("BOM层级", ""), "")).strip(),
            str(raw.get(header_columns.get("子项物料编码", header_columns.get("物料编码", "")), "")).strip(),
            str(raw.get(header_columns.get("物料名称", header_columns.get("名称", "")), "")).strip(),
        )
        raw_indexes.setdefault(key, []).append(index)
    rows, changes, reviews = [], [], []
    for source in historical["bom"]["rows"]:
        quantity = decimal_or_none(source.get("quantity"))
        if quantity is not None and quantity.is_integer():
            quantity = int(quantity)
        key = (str(source.get("level", "")).strip(), str(source.get("code", "")).strip(), str(source.get("name", "")).strip())
        indexes = raw_indexes.get(key, [])
        rows.append({
            "code": str(source.get("code") or "历史编码"), "category": str(source.get("property") or source.get("material") or "历史物料"),
            "name": str(source.get("name") or "未命名物料"), "specification": str(source.get("specification") or "按历史样机复核"),
            "unit": str(source.get("unit") or "项"), "quantity": quantity, "source": f"历史样机 {historical.get('template_id')}",
            "assembly_action": "复用历史", "assembly_reason": "未提供可安全替换的明确数量", "source_index": indexes.pop(0) if indexes else None,
        })

    def change_quantity(label: str, quantity: float | None, matcher, reason: str) -> None:
        if quantity is None:
            return
        candidates = [row for row in rows if matcher(row)]
        if len(candidates) != 1:
            reviews.append({"component": label, "message": f"已给出 {quantity:g}，但历史 BOM 中匹配到 {len(candidates)} 行，未自动修改，请工程师确认对应物料。"})
            return
        row = candidates[0]
        old = row["quantity"]
        if old == quantity:
            row["assembly_action"], row["assembly_reason"] = "已校核", reason
            return
        row["quantity"], row["assembly_action"], row["assembly_reason"] = quantity, "按规则调整", reason
        changes.append({"component": label, "code": row["code"], "name": row["name"], "from_quantity": old, "to_quantity": quantity, "reason": reason})

    route_configs = project_route_configs(project)
    for route, config in route_configs.items():
        if route in {"uf", "nf", "ro"}:
            elements = config.get("element_count")
            housings = config.get("housing_count")
            if housings is None and elements and config.get("elements_per_housing"):
                housings = math.ceil(elements / config["elements_per_housing"])
            change_quantity("卷式膜壳", housings, lambda row: "卷式膜壳" in row["name"], "按项目膜壳数量/装膜数调整")
            change_quantity("卷式膜元件", elements, lambda row: "膜元件" in row["name"] and "膜壳" not in row["name"], "按项目膜元件数量调整")
        elif route == "ceramic":
            change_quantity("陶瓷膜壳", config.get("housing_count"), lambda row: "陶瓷膜壳" in row["name"], "按项目陶瓷膜壳数量调整")
            change_quantity("陶瓷膜元件", config.get("element_count"), lambda row: "陶瓷膜元件" in row["name"] or "陶瓷膜管" in row["name"], "按项目陶瓷膜元件数量调整")
        elif route == "hollow":
            change_quantity("中空膜组件", config.get("module_count"), lambda row: "中空" in row["name"] and "膜" in row["name"], "按项目中空膜组件数量调整")
        elif route == "ed":
            change_quantity("电渗析膜堆", config.get("stack_count"), lambda row: "膜堆" in row["name"], "按项目电渗析膜堆数量调整")
        elif route == "ion_exchange":
            change_quantity("连续离交树脂柱", config.get("vessel_count"), lambda row: "树脂柱" in row["name"], "按项目树脂柱数量调整")

    if project.get("capacity_m3h"):
        reviews.append({"component": "处理量", "message": f"项目处理量 {project['capacity_m3h']:g} m³/h 已记录；未按流量等比缩放历史 BOM，泵、管径、罐容积和仪表量程须工程确认。"})
    if project.get("process_medium"):
        reviews.append({"component": "介质", "message": f"介质“{project['process_medium']}”已记录；湿接触材质、密封和清洗兼容性须工程确认。"})
    if project.get("compliance"):
        reviews.append({"component": "合规", "message": "卫生/验证/防爆要求不会自动替换历史物料，需在 BOM 审核中确认。"})

    adjusted_export = source_export
    if changes and raw_rows and header_columns:
        adjusted_export = {**source_export, "rows": [dict(row) for row in raw_rows]}
        quantity_column = next((header_columns[name] for name in ("实际数量", "标准用量", "标准子项用量(不考虑精度)") if name in header_columns), None)
        if quantity_column:
            for row in rows:
                if row["assembly_action"] != "按规则调整" or row["source_index"] is None:
                    continue
                quantity = row["quantity"]
                adjusted_export["rows"][row["source_index"]][quantity_column] = str(int(quantity)) if isinstance(quantity, float) and quantity.is_integer() else str(quantity)
    return {
        "rows": rows, "source_export": adjusted_export, "changes": changes, "review_items": reviews,
        "changed_row_count": len(changes), "reference_template_id": historical.get("template_id"),
    }


def project_bom_draft(project: dict) -> dict:
    """Create an unpriced project BOM draft. It is never a released procurement BOM."""
    historical = history_template_for_project(project)
    if historical and (project.get("selected_template_id") or project.get("project_id")) and historical.get("bom", {}).get("rows"):
        assembly = project_historical_bom_assembly(project, historical)
        changed = assembly["changed_row_count"]
        note = f"以历史样机 {historical.get('template_id')}《{historical.get('project_name')}》为基准，已形成项目装配 BOM；{changed} 行按明确项目数量调整，{len(assembly['review_items'])} 项仍待工程审核。"
        return {"version": "history-assembled-draft", "blocked": any(issue["severity"] == "error" for issue in project_conflicts(project)), "note": note, **assembly}
    routes = project.get("routes") or ([project.get("route")] if project.get("route") else [])
    route_configs = project_route_configs(project)
    rows: list[dict] = []
    for route in routes:
        config = route_configs.get(route, {})
        suffix = "" if len(routes) == 1 else f"_{route.upper()}"
        if route in {"uf", "nf", "ro"}:
            required, area = config.get("required_area_m2"), config.get("effective_area_m2")
            elements = config.get("element_count") or (math.ceil(required / area) if required and area else None)
            per_housing = config.get("elements_per_housing")
            housings = config.get("housing_count") or (math.ceil(elements / per_housing) if elements and per_housing else None)
            rows.extend([
                {"code": f"MEMBRANE_ELEMENT{suffix}", "category": "膜组件", "name": f"{ROUTES[route][0]}卷式膜元件", "specification": f"型号 {config.get('membrane_model') or '待筛膜确认'}；单支有效面积 {area:g} ㎡" if area else f"型号 {config.get('membrane_model') or '待筛膜确认'}；膜材/截留要求待确认", "unit": "支", "quantity": elements, "source": "路线面积规则" if elements else "待工艺确认"},
                {"code": f"SPIRAL_SHELL{suffix}", "category": "膜壳", "name": "卷式膜壳", "specification": f"每壳 {per_housing:g} 支；压力 {config.get('pressure_bar') or '待确认'} bar；材质、端口与品牌待确认" if per_housing else "装膜数、压力、材质、端口与品牌待确认", "unit": "支", "quantity": housings, "source": "路线装膜规则" if housings else "待工艺确认"},
            ])
        elif route == "hollow":
            rows.append({"code": f"HOLLOW_FIBER_MODULE{suffix}", "category": "膜组件", "name": "中空纤维膜组件", "specification": f"型号 {config.get('module_model') or '待确认'}；膜材 {config.get('membrane_material') or '待确认'}；有效面积 {config.get('effective_area_m2') or '待确认'} ㎡；运行方式 {config.get('operation_mode') or '待确认'}", "unit": "组", "quantity": config.get("module_count"), "source": "路线参数" if config.get("module_count") else "待工艺确认"})
        elif route == "ceramic":
            rows.extend([
                {"code": f"CERAMIC_MEMBRANE_CORE{suffix}", "category": "膜组件", "name": "陶瓷膜元件", "specification": f"型号 {config.get('element_model') or '待确认'}；孔径 {config.get('pore_size_um') or '待确认'} μm；材质 {config.get('membrane_material') or '待确认'}；单支有效面积 {config.get('effective_area_m2') or '待确认'} ㎡", "unit": "支", "quantity": config.get("element_count"), "source": "路线参数" if config.get("element_count") else "待工艺确认"},
                {"code": f"CERAMIC_HOUSING{suffix}", "category": "膜壳", "name": "陶瓷膜壳总成", "specification": f"TMP {config.get('tmp_bar') or '待确认'} bar；循环流量 {config.get('circulation_flow_m3h') or '待确认'} m³/h；端盖、密封、集流与支撑按型号确认", "unit": "套", "quantity": config.get("housing_count"), "source": "路线参数" if config.get("housing_count") else "待工艺确认"},
            ])
        elif route == "ed":
            rows.append({"code": f"ED_STACK{suffix}", "category": "膜组件", "name": "电渗析膜堆及极室", "specification": f"型号 {config.get('stack_model') or '待确认'}；膜对数 {config.get('membrane_pairs') or '待确认'}；电流密度 {config.get('current_density_a_m2') or '待确认'} A/㎡；极液 {config.get('electrode_liquid') or '待确认'}", "unit": "套", "quantity": config.get("stack_count"), "source": "路线参数" if config.get("stack_count") else "待工艺确认"})
        elif route == "ion_exchange":
            rows.extend([
                {"code": f"IX_VALVE_MANIFOLD{suffix}", "category": "离交主机", "name": "连续离交阀主机", "specification": f"设备形式 {config.get('equipment_form') or '待确认'}；切换周期 {config.get('cycle_time_min') or '待确认'} min；阀阵与控制方式待确认", "unit": "套", "quantity": 1, "source": "系统基准"},
                {"code": f"IX_RESIN_COLUMN{suffix}", "category": "离交柱", "name": "树脂柱/转盘及布水器", "specification": f"树脂 {config.get('resin_type') or '待确认'}；装填量 {config.get('resin_volume_l') or '待确认'} L；再生介质 {config.get('regeneration_medium') or '待确认'}", "unit": "套", "quantity": config.get("vessel_count"), "source": "路线参数" if config.get("vessel_count") else "待工艺确认"},
            ])
    rows.extend([
        {"code": "FEED_PUMP", "category": "泵组", "name": "进料泵", "specification": "流量、扬程、介质、材质及变频要求待选型", "unit": "台", "quantity": 1, "source": "系统基准"},
        {"code": "CIRCULATION_PUMP", "category": "泵组", "name": "循环/浓缩泵", "specification": "流量、扬程、NPSH、材质及变频要求待选型", "unit": "台", "quantity": 1, "source": "系统基准"},
        {"code": "CIP_TANK", "category": "清洗", "name": "CIP 清洗罐及清洗回路", "specification": "容积、加热、液位及清洗剂兼容性待确认", "unit": "套", "quantity": 1, "source": "系统基准"},
        {"code": "CONTROL_CABINET", "category": "电控", "name": "PLC 控制柜及 HMI", "specification": "I/O、通讯、联锁、防爆及 DCS 接口待确认", "unit": "套", "quantity": 1, "source": "系统基准"},
        {"code": "SKID_FRAME", "category": "结构", "name": "设备框架与撬内管路", "specification": "材质、卫生等级、焊接/钝化及现场接口待确认", "unit": "套", "quantity": 1, "source": "系统基准"},
    ])
    return {"version": "phase-1-draft", "blocked": any(issue["severity"] == "error" for issue in project_conflicts(project)), "note": "规则初稿，不含价格、不构成采购申请或正式 BOM；红色冲突未关闭前不得转正式报价。", "rows": rows}


def project_tender_checklist(project: dict) -> list[dict]:
    source_types = {str(item.get("source_type") or "") for item in project.get("source_files", []) if item.get("is_active", True)}
    groups = [
        ("资格与商务", [("qualification", "企业资质、财务与业绩资料", "供应商资料"), ("commercial_quote", "商务报价、供货范围与偏离说明", "规则 BOM / 商务模板")]),
        ("技术响应", [("urs_response", "用户需求说明书响应表", "URS"), ("deviation", "技术规格参数偏离表", "URS / 设计输入"), ("pid", "工艺流程图 / P&ID 审核版", "P&ID"), ("selection", "设备选型、BOM 与接口条件", "设计输入 / BOM")]),
        ("质量与交付", [("validation", "FAT/SAT、DQ/IQ/OQ/PQ 与质量计划", "URS"), ("delivery", "交付资料清单、备件与售后承诺", "投标模板")]),
    ]
    result = []
    for group, items in groups:
        for item_id, title, basis in items:
            needed = {"urs_response", "deviation", "validation"} if item_id in {"urs_response", "deviation", "validation"} else {"pid"} if item_id == "pid" else {"selection"} if item_id == "selection" else set()
            available = bool(source_types & ({"urs"} if needed == {"urs_response", "deviation", "validation"} else {"pid"} if needed == {"pid"} else {"design_input", "bom"} if needed == {"selection"} else {"tender_template", "other"}))
            result.append({"group": group, "id": item_id, "title": title, "basis": basis, "status": "可起草" if available else "待补资料", "source_ready": available})
    return result


def active_project_tender_template(project: dict) -> dict | None:
    templates = [item for item in project.get("source_files", []) if item.get("source_type") == "tender_template" and item.get("is_active", True)]
    return templates[-1] if templates else None


def project_view(project: dict) -> dict:
    issues = project_conflicts(project)
    quote_records = [{
        "quote_id": quote.get("quote_id"), "created_at": quote.get("created_at"), "selected_tier": quote.get("selected_tier"),
        "sales_quote": (quote.get("options", {}).get(quote.get("selected_tier", ""), {}) or {}).get("sales_quote"),
        "concept_image_status": quote_concept_image_status(quote).get("status"),
    } for quote in load_quotes() if quote.get("project_id") == project.get("project_id")]
    matches = history_template_matches(project)
    selected = history_template_for_project(project)
    selected_summary = history_template_summary(selected) if selected else None
    revisions = project.get("bom_revisions", [])
    tender_template = active_project_tender_template(project)
    latest_revision = revisions[-1] if revisions else None
    revision_summary = None
    if latest_revision:
        audit = latest_revision.get("audit", {})
        revision_summary = {
            "revision_id": latest_revision.get("revision_id"), "filename": latest_revision.get("filename"),
            "uploaded_at": latest_revision.get("uploaded_at"), "template_id": latest_revision.get("template_id"),
            **{key: audit.get(key) for key in ("line_count", "external_purchase_line_count", "priced_external_line_count", "external_purchase_price_coverage", "self_made_line_count", "pending_price_code_count", "pending_price_codes", "procurement_cost_with_current_prices", "formal_quote_ready")},
        }
    return {**project, "project_type": project.get("project_type", "new"), "process_medium": project.get("process_medium", ""), "route_configs": project_route_configs(project), "history_matches": matches, "selected_history_template": selected_summary, "conflicts": issues, "bom_draft": project_bom_draft(project), "tender_checklist": project_tender_checklist(project), "tender_template": tender_template, "quote_records": quote_records, "latest_bom_revision": revision_summary, "ready_for_formal_bom": not any(item["severity"] == "error" for item in issues)}


def project_summary(project: dict) -> dict:
    view = project_view(project)
    return {key: view.get(key) for key in ("project_id", "name", "customer", "project_type", "industry", "route", "routes", "capacity_m3h", "selected_template_id", "created_at", "updated_at", "source_files")} | {"conflict_count": len(view["conflicts"]), "quote_count": len(view["quote_records"]), "ready_for_formal_bom": view["ready_for_formal_bom"]}


def project_bom_csv_bytes(project: dict) -> bytes:
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    draft = project_bom_draft(project)
    source_export = draft.get("source_export") if isinstance(draft.get("source_export"), dict) else {}
    headers = source_export.get("headers") if isinstance(source_export.get("headers"), list) else []
    columns = source_export.get("columns") if isinstance(source_export.get("columns"), list) else []
    raw_rows = source_export.get("rows") if isinstance(source_export.get("rows"), list) else []
    if headers and columns and len(headers) == len(columns) and raw_rows:
        # A CSV cannot retain workbook styling, but it must retain the original
        # historical BOM's columns, order, hierarchy and every data row.
        assembly_rows = {row.get("source_index"): row for row in draft.get("rows", []) if row.get("source_index") is not None}
        include_assembly_trace = bool(draft.get("changes"))
        writer.writerow(headers + (["项目装配状态", "项目装配说明"] if include_assembly_trace else []))
        for index, row in enumerate(raw_rows):
            values = [str(row.get(column, "")) for column in columns]
            if include_assembly_trace:
                assembled = assembly_rows.get(index, {})
                values.extend([str(assembled.get("assembly_action", "复用历史")), str(assembled.get("assembly_reason", "历史层级/空行"))])
            writer.writerow(values)
        return ("\ufeff" + buffer.getvalue()).encode("utf-8")
    writer.writerow(["物料编码", "类别", "名称", "规格说明", "单位", "数量", "来源", "状态"])
    for row in draft["rows"]:
        writer.writerow([row["code"], row["category"], row["name"], row["specification"], row["unit"], "" if row["quantity"] is None else row["quantity"], row["source"], "规则初稿"])
    return ("\ufeff" + buffer.getvalue()).encode("utf-8")


def next_project_id(projects: list[dict], now: datetime) -> str:
    prefix = f"P{now:%Y%m%d}-"
    sequence = max((int(str(item.get("project_id", "")).removeprefix(prefix)) for item in projects if str(item.get("project_id", "")).startswith(prefix) and str(item.get("project_id", "")).removeprefix(prefix).isdigit()), default=0) + 1
    return f"{prefix}{sequence:04d}"


def excel_column(cell_ref: str) -> str:
    match = re.match(r"[A-Z]+", cell_ref)
    return match.group(0) if match else ""


def xlsx_cell_value(cell: ElementTree.Element, shared: list[str], namespace: dict[str, str]) -> str:
    inline = "".join(node.text or "" for node in cell.findall(".//m:is//m:t", namespace))
    if inline:
        return inline.strip()
    value_node = cell.find("m:v", namespace)
    value = value_node.text.strip() if value_node is not None and value_node.text else ""
    if cell.get("t") == "s" and value.isdigit() and int(value) < len(shared):
        return shared[int(value)].strip()
    return value


def read_xlsx_tables(path: Path) -> list[list[dict[str, str]]]:
    """Read XLSX sheet values without trusting the workbook's declared range.

    Some historical Kingdee BOM exports declare A1 as their used range even
    though the sheet XML contains the complete BOM.  Parsing the sheet XML
    directly preserves every record for template-library ingestion.
    """
    namespace = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    try:
        with zipfile.ZipFile(path) as archive:
            shared: list[str] = []
            if "xl/sharedStrings.xml" in archive.namelist():
                root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
                shared = ["".join(node.text or "" for node in item.findall(".//m:t", namespace)) for item in root.findall("m:si", namespace)]
            tables = []
            for member in sorted(name for name in archive.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name)):
                root = ElementTree.fromstring(archive.read(member))
                rows = []
                for row in root.findall(".//m:sheetData/m:row", namespace):
                    values = {}
                    for cell in row.findall("m:c", namespace):
                        column = excel_column(cell.get("r", ""))
                        if column:
                            values[column] = xlsx_cell_value(cell, shared, namespace)
                    if values:
                        rows.append(values)
                if rows:
                    tables.append(rows)
            return tables
    except (OSError, zipfile.BadZipFile, ElementTree.ParseError):
        return []


def bom_from_xlsx_tables(tables: list[list[dict[str, str]]], source_file: str) -> dict:
    """Normalize historical BOM worksheet values into stable project fields."""
    column_order = [chr(code) for code in range(ord("A"), ord("Z") + 1)] + ["AA", "AB", "AC", "AD", "AE"]
    candidates = []
    for rows in tables:
        for header_index, row in enumerate(rows[:20]):
            headers = {str(value).strip(): column for column, value in row.items() if str(value).strip()}
            score = sum(name in headers for name in ("BOM层级", "子项物料编码", "物料编码", "物料名称", "名称", "规格型号", "实际数量"))
            if score >= 3:
                candidates.append((score, len(rows), rows, header_index, headers))
                break
    if not candidates:
        return {"source_file": source_file, "rows": [], "summary": {"line_count": 0, "status": "未识别 BOM 表头"}}
    _, _, rows, header_index, headers = max(candidates, key=lambda item: (item[0], item[1]))
    header_row = rows[header_index]
    source_columns = [column for column in column_order if str(header_row.get(column, "")).strip()]
    source_headers = [str(header_row[column]).strip() for column in source_columns]
    source_rows = [row for row in rows[header_index + 1:] if any(str(row.get(column, "")).strip() for column in source_columns)]

    def value(row: dict[str, str], *names: str) -> str:
        for name in names:
            column = headers.get(name)
            if column:
                return str(row.get(column, "")).strip()
        return ""

    normalized = []
    for row in rows[header_index + 1:]:
        name = value(row, "物料名称", "名称")
        code = value(row, "子项物料编码", "物料编码")
        level = value(row, "BOM层级")
        if not any((name, code, level)):
            continue
        normalized.append({
            "level": level, "code": code, "name": name,
            "specification": value(row, "规格型号", "规格说明"), "material": value(row, "材质"),
            "property": value(row, "物料属性"), "unit": value(row, "单位"),
            "quantity": value(row, "实际数量", "标准用量", "标准子项用量(不考虑精度)"),
            "unit_price_override": value(row, "核价含税单价", "含税单价", "采购单价"),
            "version": value(row, "BOM版本"), "status": value(row, "数据状态"),
        })
    root = next((item for item in normalized if item["level"] == "0"), normalized[0] if normalized else {})
    modules = []
    for item in normalized:
        if len(item["level"]) == 3 and item["name"]:
            label = item["name"].rsplit("_", 1)[-1]
            if label not in modules:
                modules.append(label)
    return {
        "source_file": source_file,
        "rows": normalized,
        # Keep an export-grade copy alongside normalized fields.  This makes
        # the project CSV traceable to the selected historical BOM rather than
        # silently flattening it into a new system schema.
        "source_export": {"headers": source_headers, "columns": source_columns, "rows": source_rows},
        "summary": {
            "line_count": len(normalized), "root_code": root.get("code", ""), "root_name": root.get("name", ""),
            "bom_version": root.get("version", ""), "bom_status": root.get("status", ""), "modules": modules[:20],
        },
    }


def bom_from_xlsx(path: Path) -> dict:
    """Read then normalize a historical BOM workbook from disk."""
    return bom_from_xlsx_tables(read_xlsx_tables(path), str(path))


def bom_from_uploaded_csv(filename: str, raw: bytes) -> dict:
    """Parse a CSV export of the historical BOM without flattening its headers."""
    try:
        reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
        headers = [str(header).strip() for header in (reader.fieldnames or []) if str(header).strip()]
        rows = [{header: str(row.get(header, "") or "").strip() for header in headers} for row in reader]
    except (UnicodeDecodeError, csv.Error) as error:
        raise ValueError("BOM CSV 无法读取，请使用 UTF-8 编码导出的文件") from error
    header_map = {header: header for header in headers}
    required_score = sum(name in header_map for name in ("BOM层级", "子项物料编码", "物料编码", "物料名称", "名称", "规格型号", "实际数量"))
    if required_score < 3:
        return {"source_file": filename, "rows": [], "summary": {"line_count": 0, "status": "未识别 BOM 表头"}}

    def value(row: dict[str, str], *names: str) -> str:
        for name in names:
            if name in header_map:
                return str(row.get(name, "")).strip()
        return ""

    normalized = []
    for row in rows:
        name, code, level = value(row, "物料名称", "名称"), value(row, "子项物料编码", "物料编码"), value(row, "BOM层级")
        if not any((name, code, level)):
            continue
        normalized.append({
            "level": level, "code": code, "name": name,
            "specification": value(row, "规格型号", "规格说明"), "material": value(row, "材质"),
            "property": value(row, "物料属性"), "unit": value(row, "单位"),
            "quantity": value(row, "实际数量", "标准用量", "标准子项用量(不考虑精度)"),
            "unit_price_override": value(row, "核价含税单价", "含税单价", "采购单价"),
            "version": value(row, "BOM版本"), "status": value(row, "数据状态"),
        })
    root = next((item for item in normalized if item["level"] == "0"), normalized[0] if normalized else {})
    modules = []
    for item in normalized:
        if len(item["level"]) == 3 and item["name"]:
            label = item["name"].rsplit("_", 1)[-1]
            if label not in modules:
                modules.append(label)
    return {
        "source_file": filename, "rows": normalized,
        "source_export": {"headers": headers, "columns": headers, "rows": rows},
        "summary": {"line_count": len(normalized), "root_code": root.get("code", ""), "root_name": root.get("name", ""), "bom_version": root.get("version", ""), "bom_status": root.get("status", ""), "modules": modules[:20]},
    }


def read_historical_bom_revision(filename: str, raw: bytes) -> dict:
    """Read an editable historical BOM export, retaining its hierarchy fields."""
    suffix = Path(filename).suffix.lower()
    if suffix == ".csv":
        parsed = bom_from_uploaded_csv(filename, raw)
    elif suffix == ".xlsx":
        parsed = bom_from_xlsx_tables(read_xlsx_tables(io.BytesIO(raw)), filename)
    else:
        raise ValueError("历史 BOM 修订仅支持 .csv 或 .xlsx 文件")
    if not parsed.get("rows"):
        raise ValueError("未识别历史 BOM 的层级、物料编码、物料名称和数量字段")
    return parsed


def historical_equipment_rows(bom_rows: list[dict]) -> list[dict]:
    """Split one project BOM into independently reviewable equipment records.

    A project commonly contains several skids and a shared package.  The first
    BOM level below the project root is the stable boundary.  Entries carrying
    the same model code (for example process, mechanical and electrical
    modules) are merged into one equipment record for model verification.
    """
    groups: dict[str, dict] = {}
    for row in bom_rows:
        if len(row.get("level", "")) != 2:
            continue
        name = row.get("name", "")
        model = historical_model_code(name)
        common = "共用" in name
        if model:
            key = model
        elif "阀主机" in name:
            key = "阀主机"
        elif common:
            key = "项目共用配套"
        else:
            key = re.sub(r"(?:[_-](?:工艺|机械|控制柜|动力柜|电气|工艺外围|机械外围|电气外围|备品备件)).*$", "", name).strip("_-") or row.get("code", "未命名设备")
        group = groups.setdefault(key, {"equipment_key": key, "model_code": model, "name": name, "source_node_codes": [], "source_nodes": [], "route_tags": []})
        group["source_node_codes"].append(row.get("code", ""))
        group["source_nodes"].append(name)
        if model and not group["model_code"]:
            group["model_code"] = model
        for tag in route_tags(name):
            if tag not in group["route_tags"]:
                group["route_tags"].append(tag)
    records = []
    for group in groups.values():
        records.append({**group, "verification_status": "已识别型号" if group["model_code"] else "待逐台核对型号", "is_project_common": group["equipment_key"] == "项目共用配套"})
    return records


def route_tags(text: str) -> list[str]:
    rules = (("电渗析", "电渗析"), ("离交", "连续离交"), ("陶瓷", "陶瓷膜"), ("中空", "中空膜"), ("反渗透", "卷式 RO"), ("纳滤", "卷式 NF"), ("超滤", "超滤"), ("卷式", "卷式膜"))
    tags = []
    source = text.upper()
    for needle, label in rules:
        if needle.upper() in source and label not in tags:
            tags.append(label)
    if re.search(r"(?<![A-Z])RO(?:系统|膜|[0-9-]|\b)", source) and "卷式 RO" not in tags:
        tags.append("卷式 RO")
    return tags


def history_template_summary(template: dict) -> dict:
    bom = template.get("bom", {}).get("summary", {})
    documents = template.get("documents", {})
    return {
        "template_id": template.get("template_id", ""), "project_name": template.get("project_name", ""),
        "source_root": template.get("source_root", ""), "route_tags": template.get("route_tags", []),
        "model_codes": template.get("model_codes", []), "bom": bom, "documents": documents,
        "equipment_count": len(template.get("equipment", [])), "unverified_equipment_count": sum(item.get("verification_status") != "已识别型号" for item in template.get("equipment", [])),
        "ingest_status": template.get("ingest_status", "待导入"), "indexed_at": template.get("indexed_at", ""),
    }


def history_template_from_source(template_id: str, project_name: str, source_root: Path) -> dict:
    files = [path for path in source_root.rglob("*") if path.is_file()] if source_root.exists() else []
    workbook_candidates = [path for path in files if path.suffix.lower() == ".xlsx" and "工作日报" not in path.name]
    bom_candidates = [path for path in workbook_candidates if "bom" in path.name.lower() or "设备" in path.name]
    bom_file = (bom_candidates or workbook_candidates or [HISTORY_BOM_OVERRIDES.get(template_id)])[0]
    bom = bom_from_xlsx(bom_file) if bom_file else {"source_file": "", "rows": [], "summary": {"line_count": 0, "status": "未发现 BOM"}}
    relevant_files = [path for path in files if path.suffix.lower() in HISTORY_FILE_EXTENSIONS]
    relative_files = [str(path.relative_to(source_root)) for path in relevant_files]
    extension_counts = {extension: sum(path.suffix.lower() == extension for path in relevant_files) for extension in (".pdf", ".dwg", ".dxf", ".step", ".stp", ".iges", ".igs")}
    names_text = " ".join(relative_files + [item.get("name", "") + " " + item.get("specification", "") for item in bom.get("rows", [])])
    equipment = historical_equipment_rows(bom.get("rows", []))
    model_codes = []
    for code in HISTORICAL_MODEL_PATTERN.findall(names_text.upper()):
        if code not in model_codes:
            model_codes.append(code)
    document_labels = {
        "工程总装": any(any(token in name for token in ("工程图", "总装", "三视图")) for name in relative_files),
        "零件加工": any(any(token in name for token in ("零件", "加工", "配件", "框架图")) for name in relative_files),
        "工艺元件": any("工艺" in name for name in relative_files),
        "紧固件清单": any("螺栓" in name for name in relative_files),
    }
    return {
        "template_id": template_id, "project_name": project_name, "source_root": str(source_root),
        "indexed_at": datetime.now().isoformat(timespec="seconds"), "ingest_status": "已入库" if bom.get("rows") else "仅图纸，待补 BOM",
        "route_tags": route_tags(names_text), "model_codes": model_codes[:20], "equipment": equipment, "bom": bom,
        "documents": {"total_files": len(relevant_files), "pdf_count": extension_counts[".pdf"], "dwg_count": extension_counts[".dwg"], "dxf_count": extension_counts[".dxf"], "native_model_count": sum(extension_counts[key] for key in (".step", ".stp", ".iges", ".igs")), "document_types": document_labels, "files": relative_files[:120]},
    }


def refresh_history_templates() -> list[dict]:
    existing: dict[str, dict] = {}
    if HISTORY_TEMPLATES_FILE.exists():
        try:
            saved = json.loads(HISTORY_TEMPLATES_FILE.read_text(encoding="utf-8"))
            existing = {item.get("template_id", ""): item for item in saved if isinstance(item, dict)}
        except (json.JSONDecodeError, OSError):
            pass
    templates = []
    for template_id, name, root in HISTORY_PROJECT_SOURCES:
        # macOS may deny a background LaunchAgent access to Downloads even when
        # the interactive user can access it.  Never replace a successfully
        # imported template with an empty record in that case.
        if not root.exists() and template_id in existing:
            template = existing[template_id]
            template["source_accessible"] = False
        else:
            template = history_template_from_source(template_id, name, root)
            template["source_accessible"] = root.exists()
        templates.append(template)
    DATA_DIR.mkdir(exist_ok=True)
    temp = HISTORY_TEMPLATES_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(templates, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(HISTORY_TEMPLATES_FILE)
    refresh_historical_material_catalog(templates)
    return templates


def load_history_templates() -> list[dict]:
    if not HISTORY_TEMPLATES_FILE.exists():
        return refresh_history_templates()
    try:
        data = json.loads(HISTORY_TEMPLATES_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else refresh_history_templates()
    except (json.JSONDecodeError, OSError):
        return refresh_history_templates()


def material_spec_key(value: str) -> str:
    """Make BOM specifications comparable without discarding the source text."""
    return re.sub(r"\s+", "", str(value or "")).upper()


def refresh_historical_material_catalog(templates: list[dict] | None = None) -> dict:
    """Build the reference catalog used to assemble future quotation BOMs.

    A material code is the primary key.  Each historical specification remains
    an explicit variant because the same code can legitimately appear with
    different material, interface, pressure, or supplier requirements.
    """
    templates = templates if templates is not None else load_history_templates()
    entries: dict[str, dict] = {}
    for template in templates:
        template_id = template.get("template_id", "")
        for row in template.get("bom", {}).get("rows", []):
            code = str(row.get("code", "")).strip()
            name = str(row.get("name", "")).strip()
            if not code or not name:
                continue
            entry = entries.setdefault(code, {
                "material_code": code,
                "name": name,
                "variants": {},
                "historical_projects": set(),
            })
            entry["historical_projects"].add(template_id)
            variant_key = "|".join((material_spec_key(row.get("specification", "")), str(row.get("material", "")).strip(), str(row.get("unit", "")).strip()))
            variant = entry["variants"].setdefault(variant_key, {
                "specification": str(row.get("specification", "")).strip(),
                "material": str(row.get("material", "")).strip(),
                "unit": str(row.get("unit", "")).strip(),
                "property": str(row.get("property", "")).strip(),
                "versions": set(),
                "projects": set(),
                "historical_quantity_total": 0.0,
            })
            variant["projects"].add(template_id)
            if row.get("version"):
                variant["versions"].add(str(row["version"]))
            try:
                variant["historical_quantity_total"] += float(str(row.get("quantity", "0")).replace(",", "") or 0)
            except ValueError:
                pass
    materials = []
    for entry in entries.values():
        variants = []
        for variant in entry["variants"].values():
            variants.append({
                **variant,
                "versions": sorted(variant["versions"]),
                "projects": sorted(variant["projects"]),
                "historical_quantity_total": round(variant["historical_quantity_total"], 4),
            })
        materials.append({
            "material_code": entry["material_code"], "name": entry["name"],
            "historical_projects": sorted(entry["historical_projects"]),
            "variants": variants,
        })
    materials.sort(key=lambda item: item["material_code"])
    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "material_count": len(materials),
        "variant_count": sum(len(item["variants"]) for item in materials),
        "materials": materials,
    }
    DATA_DIR.mkdir(exist_ok=True)
    temp = MATERIAL_CATALOG_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(MATERIAL_CATALOG_FILE)
    return payload


def procurement_price_book_status() -> dict:
    """Report real price coverage; missing price data must never look like zero."""
    if not PROCUREMENT_PRICE_BOOK_FILE.exists():
        return {"exists": False, "price_row_count": 0, "message": "未导入采购价目表"}
    try:
        book = json.loads(PROCUREMENT_PRICE_BOOK_FILE.read_text(encoding="utf-8"))
        rows = book.get("prices", []) if isinstance(book, dict) else []
        linkage = json.loads(HISTORICAL_PRICE_LINKS_FILE.read_text(encoding="utf-8")) if HISTORICAL_PRICE_LINKS_FILE.exists() else {}
        return {
            "exists": True,
            "price_row_count": len(rows),
            "price_code_count": book.get("price_code_count", 0),
            "message": "已导入采购价目表",
            "historical_external_purchase_line_count": linkage.get("historical_external_purchase_line_count", 0),
            "historical_external_purchase_priced_line_count": linkage.get("historical_external_purchase_priced_line_count", 0),
            "historical_external_purchase_active_price_line_count": linkage.get("historical_external_purchase_active_price_line_count", 0),
            "historical_external_purchase_price_coverage": linkage.get("historical_external_purchase_price_coverage", 0),
            "historical_external_purchase_active_price_coverage": linkage.get("historical_external_purchase_active_price_coverage", 0),
        }
    except (OSError, json.JSONDecodeError):
        return {"exists": False, "price_row_count": 0, "message": "采购价目表无法读取"}


def decimal_or_none(value: object) -> float | None:
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def parse_source_date(value: object) -> datetime | None:
    text = str(value or "").strip()
    for pattern in ("%Y/%m/%d", "%Y-%m-%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(text, pattern)
        except ValueError:
            continue
    return None


def refresh_material_price_linkage() -> dict:
    """Join master material specs, active supplier prices and historical BOMs.

    The only cost join is exact material-code matching.  Name, material, brand
    and unit differences are retained as review flags, never silently coerced.
    """
    material_tables = read_xlsx_tables(MATERIAL_MASTER_SOURCE)
    price_tables = read_xlsx_tables(PROCUREMENT_PRICE_SOURCE)
    if not material_tables or not price_tables:
        raise OSError("未能读取物料清单或采购价目表")
    material_rows = material_tables[0][1:]
    price_rows = price_tables[0][1:]
    materials: dict[str, dict] = {}
    for row in material_rows:
        code = str(row.get("C", "")).strip()
        if not code:
            continue
        materials[code] = {
            "material_code": code, "property": str(row.get("B", "")).strip(), "name": str(row.get("D", "")).strip(),
            "specification": str(row.get("E", "")).strip(), "material": str(row.get("F", "")).strip(),
            "unit": str(row.get("G", "")).strip(), "brand": str(row.get("H", "")).strip(),
            "status": str(row.get("J", "")).strip(), "disabled": str(row.get("K", "")).strip(),
        }

    prices: list[dict] = []
    inherited = {"supplier": "", "effective_date": "", "expiry_date": "", "document_status": "", "currency": "", "tax_included": ""}
    for row in price_rows:
        code = str(row.get("E", "")).strip()
        unit_price = decimal_or_none(row.get("M"))
        if not code or unit_price is None:
            continue
        fields = {
            "supplier": str(row.get("C", "")).strip(), "effective_date": str(row.get("O", "")).strip(),
            "expiry_date": str(row.get("P", "")).strip(), "document_status": str(row.get("T", "")).strip(),
            "currency": str(row.get("U", "")).strip(), "tax_included": str(row.get("V", "")).strip(),
        }
        for key, value in fields.items():
            if value:
                inherited[key] = value
            else:
                fields[key] = inherited[key]
        effective, expiry = parse_source_date(fields["effective_date"]), parse_source_date(fields["expiry_date"])
        active = (not effective or effective.date() <= datetime.now().date()) and (not expiry or datetime.now().date() <= expiry.date())
        prices.append({
            "material_code": code, "supplier": fields["supplier"], "name": str(row.get("F", "")).strip(),
            "material": str(row.get("G", "")).strip(), "brand": str(row.get("H", "")).strip(), "unit": str(row.get("I", "")).strip(),
            "tax_included_unit_price": unit_price, "effective_date": fields["effective_date"], "expiry_date": fields["expiry_date"],
            "document_status": fields["document_status"], "currency": fields["currency"], "tax_included": fields["tax_included"], "active": active,
        })

    prices_by_code: dict[str, list[dict]] = {}
    for price in prices:
        prices_by_code.setdefault(price["material_code"], []).append(price)
    for candidates in prices_by_code.values():
        candidates.sort(key=lambda item: (not item["active"], item["document_status"] != "已审核", item["tax_included_unit_price"]))

    material_payload = {"source": str(MATERIAL_MASTER_SOURCE), "imported_at": datetime.now().isoformat(timespec="seconds"), "material_count": len(materials), "materials": materials}
    price_payload = {"source": str(PROCUREMENT_PRICE_SOURCE), "imported_at": datetime.now().isoformat(timespec="seconds"), "price_row_count": len(prices), "price_code_count": len(prices_by_code), "prices": prices}
    templates = load_history_templates()
    history_links = []
    historical_codes: set[str] = set()
    for template in templates:
        for row in template.get("bom", {}).get("rows", []):
            code = str(row.get("code", "")).strip()
            if not code:
                continue
            historical_codes.add(code)
            master, candidates = materials.get(code), prices_by_code.get(code, [])
            flags = []
            if not master:
                flags.append("物料主数据未匹配")
            if not candidates:
                flags.append("采购价未匹配")
            elif not any(candidate["active"] for candidate in candidates):
                flags.append("无当前有效采购价")
            if master and row.get("material") and master.get("material") and material_spec_key(row["material"]) != material_spec_key(master["material"]):
                flags.append("历史 BOM 与物料主数据材质不一致")
            if master and row.get("unit") and master.get("unit") and str(row["unit"]).strip() != master["unit"]:
                flags.append("历史 BOM 与物料主数据单位不一致")
            history_links.append({
                "template_id": template.get("template_id", ""), "material_code": code, "historical_name": str(row.get("name", "")).strip(),
                "historical_specification": str(row.get("specification", "")).strip(), "historical_property": str(row.get("property", "")).strip(), "master_matched": bool(master),
                "active_price_candidate_count": sum(candidate["active"] for candidate in candidates), "price_candidate_count": len(candidates),
                "preferred_tax_included_unit_price": candidates[0]["tax_included_unit_price"] if candidates else None, "review_flags": flags,
            })
    priced = sum(1 for item in history_links if item["price_candidate_count"])
    active_priced = sum(1 for item in history_links if item["active_price_candidate_count"])
    # ``property`` was not included in older linkage files.  Keep it on the
    # audit record so purchasing coverage is measured only against purchase
    # items, not self-made assemblies that intentionally have no supplier price.
    external_links = [item for item in history_links if item.get("historical_property") == "外购"]
    external_priced = sum(1 for item in external_links if item["price_candidate_count"])
    external_active_priced = sum(1 for item in external_links if item["active_price_candidate_count"])
    linkage_payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"), "historical_bom_code_count": len(historical_codes),
        "historical_bom_master_matched_code_count": len({item["material_code"] for item in history_links if item["master_matched"]}),
        "historical_bom_price_matched_code_count": len({item["material_code"] for item in history_links if item["price_candidate_count"]}),
        "historical_bom_active_price_matched_code_count": len({item["material_code"] for item in history_links if item["active_price_candidate_count"]}),
        "historical_bom_price_coverage": round(priced / len(history_links), 4) if history_links else 0,
        "historical_bom_active_price_coverage": round(active_priced / len(history_links), 4) if history_links else 0,
        "historical_external_purchase_line_count": len(external_links),
        "historical_external_purchase_priced_line_count": external_priced,
        "historical_external_purchase_active_price_line_count": external_active_priced,
        "historical_external_purchase_price_coverage": round(external_priced / len(external_links), 4) if external_links else 0,
        "historical_external_purchase_active_price_coverage": round(external_active_priced / len(external_links), 4) if external_links else 0,
        "links": history_links,
    }
    DATA_DIR.mkdir(exist_ok=True)
    for path, payload in ((MATERIAL_MASTER_FILE, material_payload), (PROCUREMENT_PRICE_BOOK_FILE, price_payload), (HISTORICAL_PRICE_LINKS_FILE, linkage_payload)):
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(path)
    return {"material_count": len(materials), "price_row_count": len(prices), "price_code_count": len(prices_by_code), **linkage_payload}


def load_procurement_prices_by_code() -> dict[str, list[dict]]:
    """Return supplier price candidates keyed by the exact material code.

    The price book is an imported local snapshot.  We deliberately do not
    attempt a fuzzy name/specification price match here: the historical BOM
    specification is the design baseline and an uncertain price match must be
    surfaced for review rather than silently changing the selected material.
    """
    if not PROCUREMENT_PRICE_BOOK_FILE.exists():
        return {}
    try:
        book = json.loads(PROCUREMENT_PRICE_BOOK_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    grouped: dict[str, list[dict]] = {}
    for price in book.get("prices", []):
        grouped.setdefault(str(price.get("material_code", "")).strip(), []).append(price)
    for candidates in grouped.values():
        candidates.sort(key=lambda item: (
            not bool(item.get("active")),
            item.get("document_status") != "已审核",
            float(item.get("tax_included_unit_price", 0)),
        ))
    return grouped


def approved_active_price(candidates: list[dict]) -> dict | None:
    """Choose only an approved, current price; never substitute an old quote."""
    return next((item for item in candidates if item.get("active") and item.get("document_status") == "已审核"), None)


def historical_bom_cost_audit(template_id: str) -> dict:
    """Cost one historic BOM against the imported procurement price book.

    This is the reusable costing substrate for a future quotation BOM.  It
    costs exact external-purchase lines and reports all missing/expired prices;
    self-made lines are not fabricated into a procurement cost.
    """
    template = next((item for item in load_history_templates() if item.get("template_id") == template_id), None)
    if not template:
        raise ValueError("历史样机不存在")
    prices_by_code = load_procurement_prices_by_code()
    result_rows, external_total = [], 0.0
    external_count = priced_count = active_approved_count = 0
    for row in template.get("bom", {}).get("rows", []):
        code = str(row.get("code", "")).strip()
        quantity = decimal_or_none(row.get("quantity")) or 0.0
        property_name = str(row.get("property", "")).strip()
        candidates = prices_by_code.get(code, [])
        chosen = approved_active_price(candidates)
        status = "自制待制造成本核算" if property_name == "自制" else "待匹配采购价"
        subtotal = None
        if property_name == "外购":
            external_count += 1
            if candidates:
                priced_count += 1
            if chosen:
                active_approved_count += 1
                subtotal = round(quantity * float(chosen["tax_included_unit_price"]), 2)
                external_total += subtotal
                status = "已按当前审核价计入"
            elif candidates:
                status = "仅有过期或未审核采购价"
        result_rows.append({
            "material_code": code,
            "name": str(row.get("name", "")).strip(),
            "specification": str(row.get("specification", "")).strip(),
            "property": property_name,
            "unit": str(row.get("unit", "")).strip(),
            "quantity": quantity,
            "status": status,
            "supplier": chosen.get("supplier") if chosen else None,
            "tax_included_unit_price": chosen.get("tax_included_unit_price") if chosen else None,
            "subtotal": subtotal,
        })
    return {
        "template_id": template_id,
        "project_name": template.get("project_name", ""),
        "external_purchase_line_count": external_count,
        "historically_priced_external_line_count": priced_count,
        "active_approved_external_line_count": active_approved_count,
        "active_approved_external_coverage": round(active_approved_count / external_count, 4) if external_count else 0,
        "external_purchase_cost_with_active_approved_prices": round(external_total, 2),
        "self_made_line_count": sum(1 for item in result_rows if item["property"] == "自制"),
        "rows": result_rows,
    }


def historical_bom_revision_cost_audit(revision: dict) -> dict:
    """Re-cost an uploaded historical BOM revision against the local price book.

    Exact material-code matching is deliberate.  The original hierarchy and
    quantities remain the engineering baseline, while an optional
    ``核价含税单价`` column lets a reviewer price a changed/new material without
    overwriting the shared procurement price book.  Self-made lines are never
    silently priced as zero.
    """
    prices_by_code = load_procurement_prices_by_code()
    result_rows, total = [], 0.0
    external_count = priced_count = self_made_count = 0
    pending_codes: list[str] = []
    for row in revision.get("rows", []):
        code = str(row.get("code", "")).strip()
        name = str(row.get("name", "")).strip()
        level = str(row.get("level", "")).strip()
        quantity = decimal_or_none(row.get("quantity"))
        property_name = str(row.get("property", "")).strip()
        override_text = str(row.get("unit_price_override", "")).strip()
        override = decimal_or_none(override_text) if override_text else None
        if override is not None and override < 0:
            raise ValueError(f"物料“{name or code or level}”的核价含税单价不能小于 0")
        # Package and module headers have no purchasable quantity.  They are
        # kept in the source file, but excluded from procurement pricing.
        if not code or not name or quantity is None or quantity <= 0:
            continue
        candidates = prices_by_code.get(code, [])
        chosen = approved_active_price(candidates)
        unit_price, source, status = None, "", ""
        if property_name == "外购":
            external_count += 1
        if override is not None:
            unit_price, source, status = override, "修订 BOM 手工单价", "已按修订单价计入"
        elif property_name == "外购":
            if chosen:
                unit_price, source, status = float(chosen["tax_included_unit_price"]), f"采购价簿 · {chosen.get('supplier') or '未注明供应商'}", "已按当前审核价计入"
            else:
                status = "待补采购价"
                pending_codes.append(code)
        elif property_name == "自制":
            self_made_count += 1
            status = "自制加工成本待核算"
        else:
            status = "物料属性待确认"
            pending_codes.append(code)
        subtotal = round(quantity * unit_price, 2) if unit_price is not None else None
        if subtotal is not None:
            total += subtotal
            if property_name == "外购":
                priced_count += 1
        result_rows.append({
            "level": level, "material_code": code, "name": name,
            "specification": str(row.get("specification", "")).strip(), "property": property_name,
            "unit": str(row.get("unit", "")).strip(), "quantity": quantity,
            "tax_included_unit_price": unit_price, "subtotal": subtotal,
            "price_source": source, "status": status,
        })
    unique_pending_codes = list(dict.fromkeys(code for code in pending_codes if code))
    return {
        "line_count": len(result_rows),
        "external_purchase_line_count": external_count,
        "priced_external_line_count": priced_count,
        "external_purchase_price_coverage": round(priced_count / external_count, 4) if external_count else 0,
        "self_made_line_count": self_made_count,
        "pending_price_codes": unique_pending_codes,
        "pending_price_code_count": len(unique_pending_codes),
        "procurement_cost_with_current_prices": round(total, 2),
        "formal_quote_ready": not unique_pending_codes and self_made_count == 0,
        "rows": result_rows,
    }


def quote_dxf_path(quote_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_-]", "", quote_id)
    return EXPORT_DIR / f"{safe}_equipment_3d_model_v1.dxf"


def write_quote_dxf(record: dict) -> Path:
    EXPORT_DIR.mkdir(exist_ok=True)
    target = quote_dxf_path(record["quote_id"])
    target.write_bytes(make_dxf(record))
    return target


def quote_2d_path(quote_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_-]", "", quote_id)
    return EXPORT_DIR / f"{safe}_quote_2d_general_arrangement.dxf"


def quote_2d_reference_image_path(quote_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_-]", "", quote_id)
    return EXPORT_DIR / f"{safe}_quote_2d_pdf_reference.png"


def quote_2d_bundle_path(quote_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_-]", "", quote_id)
    return EXPORT_DIR / f"{safe}_quote_2d_drawing_package.zip"


# The original DWG files provided for the historical library are protected and
# cannot be opened by AutoCAD's conversion engine.  These derived PNG assets
# were cropped from approved PDF total-assembly pages, retaining the actual
# equipment arrangement while removing client-specific title blocks.  Keeping
# them in the application avoids macOS privacy restrictions on a launch agent
# reading a user's Downloads directory after startup.
PDF_REFERENCE_SOURCES = {
    "ceramic": {
        "asset": ROOT / "assets" / "pdf-references" / "ceramic-skid-reference.png",
        "label": "陶瓷膜撬装设备",
    },
    "spiral": {
        "asset": ROOT / "assets" / "pdf-references" / "spiral-skid-reference.png",
        "label": "卷式膜浓缩系统",
    },
    "hollow": {
        "asset": ROOT / "assets" / "pdf-references" / "hollow-uf-skid-reference.png",
        "label": "超滤膜撬装设备",
    },
}

# A reviewed page crop of the historical continuous-ion-exchange engineering
# drawing.  It is a local visual layout reference only; original client title
# blocks and source PDFs are never sent to an outside service.
HISTORICAL_CONCEPT_REFERENCE_IMAGES = {
    "CF20260303GA": {
        "asset": ROOT / "assets" / "pdf-references" / "ion-exchange-historic-reference.png",
        "label": "连续离交工程总装参考图",
    },
}


def quote_pdf_reference(record: dict) -> dict | None:
    routes = set(record.get("routes", []))
    if "ceramic" in routes:
        key = "ceramic"
    elif routes & {"uf", "nf", "ro"}:
        key = "spiral"
    elif "hollow" in routes:
        key = "hollow"
    else:
        return None
    source = PDF_REFERENCE_SOURCES[key]
    return source if source["asset"].exists() else None


def quote_concept_reference_image(record: dict) -> dict | None:
    """Select a local PDF-derived *soft* layout reference for img2img.

    Exact historical engineering references win; otherwise the existing
    route-level PDF crop supplies a conservative fallback.  This keeps an
    imagery request grounded in a reviewed local drawing without claiming the
    drawing's dimensions or components are automatically reusable.
    """
    historical = match_history_template(record)
    direct = HISTORICAL_CONCEPT_REFERENCE_IMAGES.get(historical.get("template_id", ""))
    if direct and direct["asset"].exists():
        return {**direct, "template_id": historical["template_id"], "mode": "historical_pdf_soft_reference"}
    fallback = quote_pdf_reference(record)
    if fallback:
        return {**fallback, "template_id": historical.get("template_id", ""), "mode": "route_pdf_soft_reference"}
    return None


def png_rgb_rows(path: Path) -> tuple[int, int, list[bytes]]:
    """Read the simple RGB/RGBA PNGs produced from the PDF reference pages.

    This small reader keeps the launch-on-login service self-contained; no
    image library is needed at runtime just to trace the pre-rendered assets.
    """
    raw = path.read_bytes()
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("参考图不是 PNG")
    cursor, compressed, width, height, bit_depth, color_type = 8, bytearray(), 0, 0, 0, 0
    while cursor < len(raw):
        length = struct.unpack(">I", raw[cursor:cursor + 4])[0]
        kind = raw[cursor + 4:cursor + 8]
        payload = raw[cursor + 8:cursor + 8 + length]
        cursor += length + 12
        if kind == b"IHDR":
            width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload)
            if bit_depth != 8 or color_type not in (2, 6) or compression or filtering or interlace:
                raise ValueError("参考 PNG 格式不受支持")
        elif kind == b"IDAT":
            compressed.extend(payload)
        elif kind == b"IEND":
            break
    channels = 4 if color_type == 6 else 3
    stride = width * channels
    decoded = zlib.decompress(bytes(compressed))
    rows, previous, offset = [], bytearray(stride), 0
    for _ in range(height):
        filter_type = decoded[offset]; offset += 1
        current = bytearray(decoded[offset:offset + stride]); offset += stride
        for index in range(stride):
            left = current[index - channels] if index >= channels else 0
            up = previous[index]
            upper_left = previous[index - channels] if index >= channels else 0
            if filter_type == 1:
                current[index] = (current[index] + left) & 255
            elif filter_type == 2:
                current[index] = (current[index] + up) & 255
            elif filter_type == 3:
                current[index] = (current[index] + ((left + up) // 2)) & 255
            elif filter_type == 4:
                pa, pb, pc = abs(up - upper_left), abs(left - upper_left), abs(left + up - 2 * upper_left)
                predictor = left if pa <= pb and pa <= pc else up if pb <= pc else upper_left
                current[index] = (current[index] + predictor) & 255
            elif filter_type != 0:
                raise ValueError("参考 PNG 过滤器不受支持")
        rows.append(bytes(current)); previous = current
    return width, height, rows


def add_reference_line_trace(model, image_path: Path, x: float, y: float, width: float, height: float) -> None:
    """Trace the dark ink of a PDF reference image into ordinary DXF LINEs.

    AutoCAD for Mac accepts LINE entities consistently, unlike the DXF IMAGE
    entity that caused the unsupported-object prompt.  This is a visual trace,
    not an editable process model or a fabrication drawing.
    """
    source_width, source_height, rows = png_rgb_rows(image_path)
    sample_width = min(320, source_width)
    sample_height = min(360, source_height)
    step_x, step_y = source_width / sample_width, source_height / sample_height
    unit_x, unit_y = width / sample_width, height / sample_height
    for row_index in range(sample_height):
        source_y0, source_y1 = int(row_index * step_y), min(source_height, max(int((row_index + 1) * step_y), int(row_index * step_y) + 1))
        run_start = None
        for column in range(sample_width + 1):
            ink = False
            if column < sample_width:
                source_x0, source_x1 = int(column * step_x), min(source_width, max(int((column + 1) * step_x), int(column * step_x) + 1))
                for source_y in range(source_y0, source_y1):
                    row = rows[source_y]
                    for source_x in range(source_x0, source_x1):
                        offset = source_x * 3
                        luminance = (row[offset] * 30 + row[offset + 1] * 59 + row[offset + 2] * 11) // 100
                        if luminance < 135:
                            ink = True
                            break
                    if ink:
                        break
            if ink and run_start is None:
                run_start = column
            elif not ink and run_start is not None:
                trace_y = y + height - (row_index + 0.5) * unit_y
                model.add_line((x + run_start * unit_x, trace_y), (x + column * unit_x, trace_y), dxfattribs={"layer": "REFERENCE_TRACE"})
                run_start = None


def history_template_matches(record: dict, limit: int = 3) -> list[dict]:
    """Rank reusable historical samples from the project's minimal requirements."""
    tag_by_route = {"uf": {"超滤", "卷式膜"}, "nf": {"卷式 NF", "卷式膜"}, "ro": {"卷式 RO", "卷式膜"}, "hollow": {"中空膜", "超滤"}, "ceramic": {"陶瓷膜"}, "ed": {"电渗析"}, "ion_exchange": {"连续离交"}}
    required = set().union(*(tag_by_route.get(route, set()) for route in record.get("routes", [])))
    route_identity_tags = {"超滤", "卷式 NF", "卷式 RO", "中空膜", "陶瓷膜", "电渗析", "连续离交"}
    optional_terms = []
    for config in project_route_configs(record).values():
        for key in ("membrane_model", "element_model", "module_model", "stack_model", "equipment_form"):
            term = str(config.get(key) or "").strip()
            if len(term) >= 3:
                optional_terms.append(term.upper())
    candidates = []
    for template in load_history_templates():
        tags = set(template.get("route_tags", []))
        docs = template.get("documents", {}).get("document_types", {})
        bom_rows = len(template.get("bom", {}).get("rows", []))
        extra_routes = (tags & route_identity_tags) - required
        source_text = " ".join(template.get("model_codes", []) + [f"{row.get('name', '')} {row.get('specification', '')}" for row in template.get("bom", {}).get("rows", [])]).upper()
        explicit_matches = sum(term in source_text for term in optional_terms)
        score = len(required & tags) * 10 - len(extra_routes) * 4 + int(docs.get("工程总装", False)) * 3 + int(docs.get("零件加工", False)) + min(2, bom_rows // 50) + explicit_matches * 12
        if score:
            candidates.append((score, template, explicit_matches))
    candidates.sort(key=lambda item: item[0], reverse=True)
    return [{
        "template_id": template["template_id"], "project_name": template["project_name"], "score": score,
        "match_reason": "按技术路线、历史 BOM 与工程/零件图完整度自动匹配" + ("；命中补充的设备/膜组件型号" if explicit_matches else ""),
        "route_tags": template.get("route_tags", []), "model_codes": template.get("model_codes", [])[:5],
        "document_types": template.get("documents", {}).get("document_types", {}),
        "bom_line_count": len(template.get("bom", {}).get("rows", [])),
    } for score, template, explicit_matches in candidates[:limit]]


def history_template_for_project(project: dict) -> dict | None:
    template_id = str(project.get("selected_template_id") or "")
    if template_id:
        selected = next((item for item in load_history_templates() if item.get("template_id") == template_id), None)
        if selected:
            return selected
    # Compatibility for projects created before automatic matching existed.
    matches = history_template_matches(project, limit=1)
    if not matches:
        return None
    selected_id = matches[0]["template_id"]
    return next((item for item in load_history_templates() if item.get("template_id") == selected_id), None)


def apply_history_match(project: dict, prior: dict | None = None) -> None:
    """Persist an automatic match, while preserving an explicit user choice."""
    matches = history_template_matches(project)
    available = {item["template_id"] for item in matches}
    requested = str(project.get("selected_template_id") or "")
    prior_id = str((prior or {}).get("selected_template_id") or "")
    selection_mode = str((prior or {}).get("template_selection_mode") or "auto")
    if requested and requested in available:
        project["template_selection_mode"] = "manual" if requested != prior_id else selection_mode
    elif prior_id in available and selection_mode == "manual":
        project["selected_template_id"] = prior_id
        project["template_selection_mode"] = "manual"
    elif matches:
        project["selected_template_id"] = matches[0]["template_id"]
        project["template_selection_mode"] = "auto"
    else:
        project["selected_template_id"] = ""
        project["template_selection_mode"] = "none"


def match_history_template(record: dict) -> dict:
    selected = history_template_for_project(record)
    if selected:
        return {"template_id": selected["template_id"], "project_name": selected["project_name"], "match_reason": "项目已选定的历史样机", "route_tags": selected.get("route_tags", []), "document_types": selected.get("documents", {}).get("document_types", {})}
    matches = history_template_matches(record, limit=1)
    return matches[0] if matches else {"template_id": "", "project_name": "无匹配历史样机", "match_reason": "当前技术路线暂无可用历史二维图纸"}


def quote_2d_metadata(record: dict) -> dict:
    target = quote_2d_path(record["quote_id"])
    bundle = quote_2d_bundle_path(record["quote_id"])
    image = quote_2d_reference_image_path(record["quote_id"])
    if not target.exists():
        return {"exists": False, "filename": target.name, "bundle_filename": bundle.name, "reference_image_exists": image.exists()}
    stat = target.stat()
    return {
        "exists": True,
        "filename": target.name,
        "size_bytes": stat.st_size,
        "updated_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
        "bundle_exists": bundle.exists(),
        "bundle_filename": bundle.name,
        "bundle_size_bytes": bundle.stat().st_size if bundle.exists() else 0,
        "reference_image_exists": image.exists(),
        "reference_mode": "pdf_visual_reference" if image.exists() else "none",
    }


class ConceptImageError(RuntimeError):
    """An expected quote-concept-image service error safe to show to the user."""


def quote_concept_image_path(quote_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_-]", "", quote_id)
    return EXPORT_DIR / f"{safe}_quotation_concept.png"


def quote_concept_image_runtime_ready() -> bool:
    return bool(REMOTE_IMAGE_WORKER_TOKEN) if REMOTE_IMAGE_WORKER_ENABLED else IMAGE_JOBS.configured


def quote_concept_image_status(record: dict | None = None) -> dict:
    return IMAGE_JOBS.status(record["quote_id"]) if record else {"configured": quote_concept_image_runtime_ready()}


def _concept_route_description(routes: set[str]) -> str:
    items: list[str] = []
    if routes & {"uf", "nf", "ro"}:
        items.append("horizontal 8040 spiral-wound membrane pressure vessels on a stainless skid, with feed and recirculation manifolds")
    if "ceramic" in routes:
        items.append("a vertical tubular ceramic membrane housing, stainless end caps, circulation pump, and CIP manifold")
    if "hollow" in routes:
        items.append("vertical hollow-fiber membrane modules with clean-in-place piping")
    if "ed" in routes:
        items.append("a plate-and-frame electrodialysis stack with electrode rinse loop, conductivity instruments, and DC power cabinet")
    if "ion_exchange" in routes:
        items.append("a continuous ion-exchange skid: compact resin columns around a central multi-port switching valve, regeneration dosing, and transfer manifolds; do not depict a pair of simple fixed-bed tanks")
    return "; ".join(items) or "a compact industrial process skid"


def _local_concept_prompt_topology(routes: set[str]) -> str:
    """Keep the SD 1.5 prompt under CLIP's 77-token practical limit."""
    if "ion_exchange" in routes:
        return "continuous ion exchange skid, tall steel frame, multiple vertical resin columns, three regeneration tanks, front valve manifold, dense sanitary piping"
    if "ceramic" in routes:
        return "tubular ceramic membrane skid, vertical membrane housings, circulation pump, CIP manifold, sanitary piping"
    if "ed" in routes:
        return "electrodialysis skid, plate frame membrane stack, electrode rinse loop, DC cabinet, conductivity instruments"
    if routes & {"uf", "nf", "ro"}:
        return "spiral membrane filtration skid, horizontal 8040 membrane housings, feed pump, manifolds, control cabinet"
    if "hollow" in routes:
        return "hollow fiber membrane skid, vertical membrane modules, circulation pump, CIP piping, control cabinet"
    return "compact stainless industrial process skid"


def quoted_component_count(record: dict, cad_type: str, default: int = 1) -> int:
    """Return the quoted/BOM quantity for an image-critical component.

    Capacity must not be converted into extra housings where the quotation or
    an edited BOM already fixes their count.  A new ceramic quote retains the
    published single-housing provisional convention until its BOM is frozen.
    """
    rows = record.get("bom_rows")
    if isinstance(rows, list):
        quantity = 0.0
        for row in rows:
            if not isinstance(row, dict) or row.get("CAD类别") != cad_type:
                continue
            try:
                quantity += float(row.get("数量", 0) or 0)
            except (TypeError, ValueError):
                continue
        if quantity > 0:
            return max(1, round(quantity))
    return max(1, int(default))


def concept_module_plan(record: dict) -> str:
    """Describe new-project modules from quoted quantities and selected routes.

    This is intentionally a quotation-stage visual plan, not a frozen BOM or
    manufacturing design.  It prevents a historical layout image from being
    treated as the new equipment itself.
    """
    routes, capacity = set(record.get("routes") or []), float(record.get("capacity_m3h") or 1)
    route_configs = record.get("route_configs") if isinstance(record.get("route_configs"), dict) else {}
    plan: list[str] = []
    if routes & {"uf", "nf", "ro"}:
        for route in sorted(routes & {"uf", "nf", "ro"}):
            config = route_configs.get(route, {})
            elements = config.get("element_count")
            per_housing = config.get("elements_per_housing")
            shells = config.get("housing_count") or (math.ceil(elements / per_housing) if elements and per_housing else None) or max(2, min(12, int(record.get("spiral_shells") or round(capacity / 8) * 2)))
            plan.append(f"exactly {int(shells)} horizontal {ROUTES[route][0]} membrane housings")
    if "ceramic" in routes:
        ceramic = route_configs.get("ceramic", {})
        housings = ceramic.get("housing_count") or quoted_component_count(record, "CERAMIC_HOUSING")
        label = "housing" if housings == 1 else "housings"
        element = ceramic.get("element_model") or "tubular ceramic membrane"
        plan.append(f"exactly {housings} {element} {label}; do not add extra ceramic membrane housings")
    if "hollow" in routes:
        hollow = route_configs.get("hollow", {})
        modules = hollow.get("module_count") or max(1, min(8, round(capacity / 6)))
        plan.append(f"exactly {int(modules)} hollow-fiber membrane modules")
    if "ed" in routes:
        ed = route_configs.get("ed", {})
        stacks = ed.get("stack_count") or max(1, min(4, round(capacity / 12)))
        plan.append(f"exactly {int(stacks)} electrodialysis stacks")
    if "ion_exchange" in routes:
        exchange = route_configs.get("ion_exchange", {})
        columns = exchange.get("vessel_count") or max(4, min(12, round(capacity / 3)))
        form = exchange.get("equipment_form") or "vertical resin columns"
        plan.append(f"exactly {int(columns)} {form}; resin type {exchange.get('resin_type') or 'to be confirmed'}")
    plan.extend(["one integrated valve manifold", "one control cabinet"])
    return "; ".join(plan)


def quote_concept_image_prompt(record: dict) -> tuple[str, dict]:
    routes = set(record.get("routes") or [])
    matched = match_history_template(record)
    reference = quote_concept_reference_image(record)
    model = equipment_model(record)
    tier = TIERS.get(record.get("selected_tier", "mid"), TIERS["mid"])
    tier_style = {"low": "economy brand selection", "mid": "mainstream proven brand selection", "high": "premium or customer-specified brand selection"}.get(record.get("selected_tier"), "mainstream proven brand selection")
    explosion = record.get("explosion_class_label") if record.get("explosion_proof") else "non-hazardous-area configuration"
    context = {
        "industry": record.get("industry_name", "工业过程"),
        "capacity_m3h": record.get("capacity_m3h"),
        "routes": [ROUTES.get(route, (route, 0))[0] for route in record.get("routes", [])],
        "equipment_model": model["code"],
        "brand_tier": tier["name"],
        "brand_tier_basis": tier_style,
        "explosion_requirement": explosion,
        "historical_template": matched.get("template_id", ""),
        "layout_reference": reference.get("label") if reference else "无可用 PDF 布置参考图",
        "layout_reference_mode": reference.get("mode") if reference else "prompt_only",
        "new_project_module_plan": concept_module_plan(record),
    }
    explosion_phrase = "hazardous area instrument enclosures" if record.get("explosion_proof") else "standard instrument enclosures"
    # The reference image and structured context carry the detail.  The text is
    # intentionally compact because the bundled SD 1.5 text encoder truncates
    # prompts beyond 77 tokens.
    prompt = (
        f"photorealistic {_local_concept_prompt_topology(routes)}, {context['industry']} process, "
        f"new design: {context['new_project_module_plan']}, {context['capacity_m3h']} m3/h, {tier_style}, {explosion_phrase}, "
        "complete skid visible, three quarter front view, brushed stainless steel, clean factory floor, "
        "sanitary valves and gauges, coherent piping, no people, no text, no logo, no drawing paper"
    )
    return prompt, context


def enqueue_quote_concept_image(record: dict) -> None:
    """Only enqueue; no upstream requests or job writes to the quotation store."""
    # Send equipment requirements only, not customer identity or pricing.
    description = (
        _concept_route_description(set(record.get("routes", [])))
        + "; configuration: " + concept_module_plan(record)
        + f"; capacity {record.get('capacity_m3h')} m3/h"
        + f"; industry {record.get('industry_name', record.get('industry', 'industrial'))}"
        + f"; compliance {record.get('compliance', 'standard')}"
        + f"; configuration tier {record.get('selected_tier', 'mid')}"
        + ("; hazardous area instrument enclosures" if record.get("explosion_proof") else "")
    )
    if record.get("bom_rows"):
        structure = [{key: row.get(key) for key in ("名称", "规格说明", "数量", "CAD类别")}
                     for row in record["bom_rows"][:120]]
        description += "; BOM structure (takes precedence over generic module plan): " + json.dumps(structure, ensure_ascii=False)
    record["quote_concept_image"] = (IMAGE_JOBS.submit_remote(record["quote_id"], description)
                                      if REMOTE_IMAGE_WORKER_ENABLED else IMAGE_JOBS.submit(record["quote_id"], description))


def enqueue_saved_quote(record: dict) -> None:
    try:
        enqueue_quote_concept_image(record)
    except ImageJobError as error:
        record["quote_concept_image"] = {"status": "unavailable", "message": str(error), "exists": False}
    except Exception:
        record["quote_concept_image"] = {"status": "failed", "message": "报价已保存，但效果图任务提交失败，请稍后重试", "exists": False}


def _write_generic_quote_2d_dxf(record: dict) -> Path:
    """Write a native R2010 DXF with ezdxf for reliable AutoCAD compatibility."""
    EXPORT_DIR.mkdir(exist_ok=True)
    target = quote_2d_path(record["quote_id"])
    doc = ezdxf.new("R2010", setup=True)
    doc.units = ezdxf.units.MM
    doc.header["$INSBASE"] = (0, 0, 0)
    doc.header["$EXTMIN"] = (0, 0, 0)
    doc.header["$EXTMAX"] = (12200, 7600, 0)
    doc.set_modelspace_vport(8000, (6100, 3800))
    for name, color in (("FRAME", 8), ("PROCESS", 3), ("MEMBRANE", 5), ("PUMP", 6), ("VALVE", 1), ("INSTRUMENT", 2), ("ELECTRICAL", 6), ("TEXT", 7)):
        if name not in doc.layers:
            doc.layers.add(name, color=color)
    model = doc.modelspace()

    def line(a: tuple[float, float], b: tuple[float, float], layer_name: str) -> None:
        model.add_line(a, b, dxfattribs={"layer": layer_name})

    def rect(x: float, y: float, width: float, height: float, layer_name: str) -> None:
        for a, b in (((x, y), (x + width, y)), ((x + width, y), (x + width, y + height)), ((x + width, y + height), (x, y + height)), ((x, y + height), (x, y))):
            line(a, b, layer_name)

    def circle(x: float, y: float, radius: float, layer_name: str) -> None:
        model.add_circle((x, y), radius, dxfattribs={"layer": layer_name})

    def label(value: str, x: float, y: float, height: float = 78) -> None:
        entity = model.add_text(value, dxfattribs={"height": height, "layer": "TEXT"})
        entity.dxf.insert = (x, y)

    def valve(x: float, y: float) -> None:
        points = ((x - 85, y), (x, y + 85), (x + 85, y), (x, y - 85))
        for index in range(4):
            line(points[index], points[(index + 1) % 4], "VALVE")

    def vessel(x: float, y: float, length: float, diameter: float, tag: str) -> None:
        radius = diameter / 2
        rect(x, y - radius, length, diameter, "MEMBRANE")
        circle(x, y, radius, "MEMBRANE"); circle(x + length, y, radius, "MEMBRANE")
        line((x - radius, y), (x + length + radius, y), "MEMBRANE")
        label(tag, x + 120, y - radius - 180, 72)

    routes = set(record.get("routes", []))
    tier = record.get("selected_tier", "mid").upper()
    option = record["options"][record.get("selected_tier", "mid")]
    rect(220, 220, 11760, 7160, "FRAME")
    label("QUOTE 2D GENERAL ARRANGEMENT - NOT FOR FABRICATION", 520, 7000, 150)
    label(f"QUOTE: {record['quote_id']}   TIER: {tier}   SALES: CNY {option['sales_quote']:,.0f}", 520, 6760, 95)
    label("SIDE ELEVATION", 650, 6100, 100); label("TOP PLAN", 650, 3300, 100)

    rect(600, 4300, 9300, 190, "FRAME"); rect(600, 4490, 9300, 90, "FRAME")
    rect(850, 4580, 1050, 1200, "FRAME"); circle(1375, 5180, 420, "PROCESS")
    rect(2300, 4660, 1150, 190, "FRAME"); circle(2600, 4850, 220, "PUMP"); circle(3050, 4850, 300, "PUMP")
    rect(8550, 4580, 620, 1500, "ELECTRICAL")
    label("T-101 FEED / CIP", 920, 4400, 72); label("P-101 FEED PUMP", 2370, 4400, 72); label("PLC-101", 8580, 4400, 72)
    for a, b in (((1780, 5180), (2300, 5180)), ((3350, 5180), (8400, 5180)), ((8400, 5180), (8400, 5750)), ((8400, 5750), (1780, 5750)), ((1780, 5750), (1780, 5600))):
        line(a, b, "PROCESS")
    for x, y in ((3550, 5180), (6500, 5180), (8400, 5750)):
        valve(x, y)
    circle(3950, 5180, 72, "INSTRUMENT"); label("PI", 3902, 5152, 48)
    circle(6900, 5180, 72, "INSTRUMENT"); label("FI", 6852, 5152, 48)

    if routes & {"uf", "nf", "ro"}:
        shells = min(4, max(2, int(record.get("spiral_shells", 0) or 2)))
        for index in range(shells):
            row, column = divmod(index, 2)
            vessel(3900 + column * 1420, 4950 + row * 520, 880, 190, f"MH-{index + 1:02d}")
        label("SPIRAL MEMBRANE TRAIN", 3900, 4460, 78)
    if "ceramic" in routes:
        rect(5600, 4680, 620, 1350, "MEMBRANE"); circle(5910, 5355, 310, "MEMBRANE"); line((5910, 4630), (5910, 6080), "MEMBRANE"); label("CERAMIC HOUSING", 5540, 4460, 78)
    if "hollow" in routes:
        rect(6600, 4700, 460, 1250, "MEMBRANE"); circle(6830, 5325, 230, "MEMBRANE"); label("HOLLOW UF", 6600, 4460, 78)
    if "ed" in routes:
        rect(7350, 4740, 650, 1120, "MEMBRANE")
        for offset in (0, 180, 360, 540, 720): line((7420, 4820 + offset), (7930, 4820 + offset), "MEMBRANE")
        label("ED STACK", 7430, 4460, 78)
    if "ion_exchange" in routes:
        for offset, tag in ((0, "IX-101"), (720, "IX-102")):
            rect(6000 + offset, 4700, 420, 1180, "MEMBRANE"); circle(6210 + offset, 5290, 210, "MEMBRANE"); label(tag, 6050 + offset, 4460, 70)
        label("CONTINUOUS ION EXCHANGE", 5920, 6100, 78)

    rect(600, 1250, 9300, 1380, "FRAME"); circle(1450, 1940, 460, "PROCESS")
    rect(2350, 1650, 1100, 580, "FRAME"); circle(2660, 1940, 220, "PUMP"); circle(3100, 1940, 280, "PUMP"); rect(8550, 1600, 620, 720, "ELECTRICAL")
    line((1910, 1940), (2350, 1940), "PROCESS"); line((3380, 1940), (8200, 1940), "PROCESS"); valve(3650, 1940); valve(6900, 1940)
    label("PROCESS FLOW", 4400, 2070, 72); label("MAINTENANCE / MEMBRANE MODULE ZONE", 4350, 1450, 72)
    if routes & {"uf", "nf", "ro"}:
        for index in range(4): vessel(4200 + (index % 2) * 1750, 1700 + (index // 2) * 450, 1200, 190, f"MH-{index + 1:02d}")
    if "ceramic" in routes: rect(5650, 1550, 760, 720, "MEMBRANE"); circle(6030, 1910, 300, "MEMBRANE")
    if "ion_exchange" in routes: circle(6100, 1780, 260, "MEMBRANE"); circle(6900, 1780, 260, "MEMBRANE")
    label("DESIGN BASIS: QUOTATION LAYOUT ONLY. VERIFY PROCESS, INTERFACES, DIMENSIONS AND BOM BEFORE FABRICATION.", 520, 940, 65)
    # ezdxf initializes extents as sentinels. Set them after all entities are
    # added so AutoCAD opens at the drawing instead of an empty model view.
    doc.header["$EXTMIN"] = (0, 0, 0)
    doc.header["$EXTMAX"] = (12200, 7600, 0)
    doc.header["$LIMMIN"] = (0, 0)
    doc.header["$LIMMAX"] = (12200, 7600)
    doc.set_modelspace_vport(8000, (6100, 3800))
    doc.saveas(target)
    # ezdxf intentionally leaves drawing extents as sentinel values. Preserve
    # the actual quotation sheet extents in the finished DXF so AutoCAD's
    # initial view and Zoom Extents both resolve to the equipment layout.
    raw = target.read_text(encoding="utf-8")
    raw = raw.replace("  9\n$EXTMIN\n 10\n1e+20\n 20\n1e+20\n 30\n1e+20\n", "  9\n$EXTMIN\n 10\n0.0\n 20\n0.0\n 30\n0.0\n")
    raw = raw.replace("  9\n$EXTMAX\n 10\n-1e+20\n 20\n-1e+20\n 30\n-1e+20\n", "  9\n$EXTMAX\n 10\n12200.0\n 20\n7600.0\n 30\n0.0\n")
    raw = raw.replace("  9\n$LIMMAX\n 10\n420.0\n 20\n297.0\n", "  9\n$LIMMAX\n 10\n12200.0\n 20\n7600.0\n")
    target.write_text(raw, encoding="utf-8")
    return target


def write_quote_2d_dxf(record: dict) -> Path:
    """Create a DXF that carries a cropped historical PDF equipment reference.

    The raster image is intentionally kept as an external sidecar.  The ZIP
    package written below makes the DXF and its image portable together, while
    avoiding any claim that the protected historical drawing was converted into
    editable geometry.
    """
    EXPORT_DIR.mkdir(exist_ok=True)
    target = quote_2d_path(record["quote_id"])
    image_path = quote_2d_reference_image_path(record["quote_id"])
    reference = quote_pdf_reference(record)
    if not reference:
        raise OSError("当前技术路线没有可用的历史 PDF 样机参考图")

    asset = reference["asset"]
    try:
        image_path.write_bytes(asset.read_bytes())
    except Exception as exc:
        raise OSError(f"无法读取已沉淀的 PDF 样机参考图：{asset.name}") from exc

    doc = ezdxf.new("R2010", setup=True)
    doc.units = ezdxf.units.MM
    doc.header["$INSBASE"] = (0, 0, 0)
    doc.set_modelspace_vport(8000, (6100, 3800))
    for name, color in (("FRAME", 8), ("REFERENCE_TRACE", 7), ("TEXT", 7), ("QUOTE", 3)):
        if name not in doc.layers:
            doc.layers.add(name, color=color)
    model = doc.modelspace()

    def line(a: tuple[float, float], b: tuple[float, float], layer: str = "FRAME") -> None:
        model.add_line(a, b, dxfattribs={"layer": layer})

    def rect(x: float, y: float, width: float, height: float, layer: str = "FRAME") -> None:
        line((x, y), (x + width, y), layer); line((x + width, y), (x + width, y + height), layer)
        line((x + width, y + height), (x, y + height), layer); line((x, y + height), (x, y), layer)

    def label(value: str, x: float, y: float, height: float, layer: str = "TEXT") -> None:
        entity = model.add_text(value, dxfattribs={"height": height, "layer": layer})
        entity.dxf.insert = (x, y)

    option = record["options"][record.get("selected_tier", "mid")]
    equipment = equipment_model(record)
    tier = record.get("selected_tier", "mid").upper()
    reference_width, reference_height = 10600, 5850
    add_reference_line_trace(model, image_path, 800, 1040, reference_width, reference_height)
    rect(420, 420, 11400, 7000)
    rect(650, 870, 10900, 6200)
    label("QUOTE 2D VISUAL ARRANGEMENT - NOT FOR FABRICATION", 700, 7150, 140)
    label(f"QUOTE: {record['quote_id']}   TIER: {tier}   SALES: CNY {option['sales_quote']:,.0f}", 700, 6900, 92)
    label(f"EQUIPMENT MODEL: {equipment['code']}   CAPACITY: {record.get('capacity_m3h', 0)} m3/h", 700, 6720, 82, "QUOTE")
    label(f"ROUTE: {' + '.join(record.get('route_names', []))}", 700, 6550, 76, "QUOTE")
    label(f"PDF REFERENCE: {reference['label']} - VISUAL REFERENCE ONLY / NOT EDITABLE GEOMETRY", 700, 700, 66, "QUOTE")
    label("QUOTE OVERLAY: CURRENT BOM, COST TIER AND PROCESS CONDITIONS REQUIRE ENGINEERING REVIEW BEFORE FABRICATION.", 700, 560, 58, "QUOTE")

    doc.header["$EXTMIN"] = (0, 0, 0)
    doc.header["$EXTMAX"] = (12200, 7600, 0)
    doc.header["$LIMMIN"] = (0, 0)
    doc.header["$LIMMAX"] = (12200, 7600)
    doc.saveas(target)
    # ezdxf saves header extents as sentinels; make the first AutoCAD view land
    # on the complete sheet rather than an apparently empty model space.
    raw = target.read_text(encoding="utf-8")
    raw = raw.replace("  9\n$EXTMIN\n 10\n1e+20\n 20\n1e+20\n 30\n1e+20\n", "  9\n$EXTMIN\n 10\n0.0\n 20\n0.0\n 30\n0.0\n")
    raw = raw.replace("  9\n$EXTMAX\n 10\n-1e+20\n 20\n-1e+20\n 30\n-1e+20\n", "  9\n$EXTMAX\n 10\n12200.0\n 20\n7600.0\n 30\n0.0\n")
    raw = raw.replace("  9\n$LIMMAX\n 10\n420.0\n 20\n297.0\n", "  9\n$LIMMAX\n 10\n12200.0\n 20\n7600.0\n")
    target.write_text(raw, encoding="utf-8")

    bundle = quote_2d_bundle_path(record["quote_id"])
    readme = ("二维报价图纸包\n\n"
              "DXF 已内置为普通线条参考图，不依赖外部图片对象；PNG 仅供单独核对视觉来源。\n"
              "PNG 来自历史 PDF 总装图的设备主体裁图，仅作样机视觉参考，不是可编辑几何，也不得直接用于制造。\n"
              "DXF 叠加的是当前报价编号、设备型号、工艺路线与档位信息；制造前必须完成工程复核。\n")
    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(target, arcname=target.name)
        archive.write(image_path, arcname=image_path.name)
        archive.writestr("README.txt", readme)
    return target


def native_script_path(quote_id: str) -> Path:
    # A plain alphanumeric filename is intentional: the AutoCAD for Mac
    # command input strips punctuation when a script path is pasted through
    # its UI, which otherwise makes automatic/manual runs diverge.
    safe = re.sub(r"[^A-Za-z0-9]", "", quote_id)
    return NATIVE_DIR / f"{safe}native3dbuild.scr"


def native_dwg_path(quote_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9]", "", quote_id)
    return NATIVE_DIR / f"{safe}native3dmodel.dwg"


def native_console_script_path(quote_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9]", "", quote_id)
    return NATIVE_DIR / f"{safe}native3dconsole.scr"


def native_dwg_metadata(record: dict) -> dict:
    """Return browser-safe readiness data for the quote's generated DWG."""
    target = native_dwg_path(record["quote_id"])
    if not target.exists():
        return {"exists": False, "filename": target.name}
    stat = target.stat()
    return {
        "exists": True,
        "filename": target.name,
        "size_bytes": stat.st_size,
        "updated_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
    }


def archive_existing_native_dwg(record: dict) -> Path | None:
    """Move a prior generated model aside before AutoCAD writes a replacement.

    AutoCAD's SAVEAS command otherwise opens an interactive overwrite prompt,
    which prevents a browser-initiated build from completing unattended.
    """
    target = native_dwg_path(record["quote_id"])
    if not target.exists():
        return None
    stamp = datetime.now().strftime("%Y%m%d%H%M%S")
    backup = target.with_name(f"{target.stem}_{stamp}.previous.dwg")
    target.replace(backup)
    return backup


def script_point(x: float, y: float, z: float) -> str:
    return f"{x},{y},{z}\n"


def script_box(x: float, y: float, z: float, length: float, width: float, height: float, color: int) -> str:
    """Generate a 3DSOLID box; colour is deliberately deferred to the DWG template.

    Setting object properties in a command script is locale-sensitive on AutoCAD for
    Mac and previously stopped the script after its first member.  Keeping the
    geometry commands self-contained guarantees a complete editable solids model.
    """
    # BOX's portable form is first corner, opposite corner and height.  The
    # Length option varies between localized Mac builds, so avoid it here.
    # Do not append an empty command line here: in an AutoCAD .scr it repeats
    # the previous command and makes the following entity input invalid.
    return f"_.BOX\n{script_point(x, y, z)}{script_point(x + length, y + width, z)}{height}\n"


def script_cylinder_z(x: float, y: float, z: float, radius: float, height: float, color: int) -> str:
    return f"_.CYLINDER\n{script_point(x, y, z)}{radius}\n{height}\n"


def script_cylinder_x(x: float, y: float, z: float, radius: float, length: float, color: int) -> str:
    # A point relative to the base gives the cylinder-axis vector directly;
    # this avoids the localized Axis-end keyword.
    return f"_.CYLINDER\n{script_point(x, y, z)}{radius}\n@{length},0,0\n"


def script_cylinder_y(x: float, y: float, z: float, radius: float, length: float, color: int) -> str:
    """Generate a 3DSOLID cylinder whose axis follows the skid width."""
    return f"_.CYLINDER\n{script_point(x, y, z)}{radius}\n@0,{length},0\n"


def make_native_3d_script(record: dict, quit_after_save: bool = False) -> str:
    """Create a BOM-driven membrane-skid concept assembly without vendor models.

    All members are portable AutoCAD native solids. The output is a clearly
    recognisable quotation-stage assembly, not a supplier-model substitution
    or a manufacturing / interference-check drawing.
    """
    routes = record["routes"]
    spiral = any(route in {"uf", "nf", "ro"} for route in routes)
    shells = min(4, max(1, int(record.get("spiral_shells", 0)))) if spiral else 0
    body = ["_.FILEDIA\n0\n_.CMDDIA\n0\n_.UCS\n_W\n_.ERASE\n_ALL\n\n"]
    # All BOX members begin on the WCS XY plane. This avoids the observed
    # AutoCAD-for-Mac batch-script issue with elevated BOX bases.
    body.extend([
        script_box(0, 0, 0, 7000, 100, 140, 8),
        script_box(0, 1800, 0, 7000, 100, 140, 8),
        script_box(180, 0, 0, 100, 1900, 140, 8),
        script_box(2100, 0, 0, 100, 1900, 140, 8),
        script_box(4200, 0, 0, 100, 1900, 140, 8),
        script_box(6200, 0, 0, 100, 1900, 140, 8),
        # Pump foundation and rectangular electrical cabinet establish clear
        # equipment zones when no supplier 3D library has been imported.
        script_box(1380, 560, 0, 1250, 720, 160, 8),
        script_box(6300, 1320, 0, 520, 460, 1580, 8),
    ])
    if spiral:
        for index in range(shells):
            row, col = divmod(index, 2)
            x, y = 3000 + col * 1750, 520 + row * 790
            body.extend([
                script_box(x + 190, y - 170, 0, 210, 340, 770, 8),
                script_box(x + 910, y - 170, 0, 210, 340, 770, 8),
            ])
    for x in (150, 2100, 4200, 6200):
        body.extend([script_cylinder_z(x + 50, 50, 0, 65, 820, 8), script_cylinder_z(x + 50, 1850, 0, 65, 820, 8)])
    # Tank, pump and motor are separate solids so each major zone remains
    # editable and recognisable in a no-library concept model.
    body.extend([
        script_cylinder_z(720, 940, 140, 390, 1420, 4),
        script_cylinder_z(720, 940, 1560, 300, 130, 8),
        script_cylinder_z(720, 940, 1690, 65, 190, 3),
        script_cylinder_y(720, 940, 940, 55, 850, 3),
        script_cylinder_x(1510, 860, 420, 185, 690, 6),
        script_cylinder_x(2180, 860, 420, 225, 180, 8),
        script_cylinder_z(2450, 860, 160, 310, 610, 6),
        script_cylinder_z(2450, 860, 770, 250, 90, 8),
        script_cylinder_z(2450, 860, 860, 58, 270, 3),
    ])
    process_x = 3000
    if spiral:
        for index in range(shells):
            row, col = divmod(index, 2)
            x, y = process_x + col * 1750, 540 + row * 760
            body.extend([
                script_cylinder_x(x, y, 920, 145, 1300, 5),
                script_cylinder_x(x - 65, y, 920, 178, 85, 8),
                script_cylinder_x(x + 1280, y, 920, 178, 85, 8),
                script_cylinder_z(x + 650, y, 920, 170, 82, 8),
                script_cylinder_z(x + 650, y, 1002, 48, 170, 3),
            ])
        process_x += 3600
    if "ceramic" in routes:
        x = min(process_x, 6100)
        body.extend([
            script_cylinder_z(x, 1040, 140, 295, 1450, 5),
            script_cylinder_z(x, 1040, 1590, 350, 105, 8),
            script_cylinder_z(x, 1040, 1695, 62, 190, 3),
            script_cylinder_y(x, 700, 960, 48, 680, 3),
        ])
        process_x = x + 850
    if "hollow" in routes:
        x = min(process_x, 6900)
        body.extend([script_cylinder_z(x, 680, 140, 215, 1380, 5), script_cylinder_z(x, 680, 1520, 265, 80, 8)])
        process_x = x + 540
    if "ed" in routes:
        x = min(process_x, 7150)
        body.extend([script_cylinder_z(x, 1040, 140, 355, 1020, 5), script_cylinder_z(x, 1040, 1160, 405, 70, 8)])
    # Feed, permeate and CIP manifolds. Their junction cylinders represent
    # tee/valve stations, leaving a legible flow path without vendor models.
    body.extend([
        script_cylinder_x(1060, 940, 960, 38, 5140, 3),
        script_cylinder_x(2850, 1650, 1280, 32, 3200, 3),
        script_cylinder_y(2850, 940, 960, 38, 710, 3),
        script_cylinder_z(6060, 940, 960, 38, 730, 3),
        script_cylinder_y(6060, 940, 1690, 32, 710, 3),
        script_cylinder_z(2740, 940, 825, 95, 150, 1),
        script_cylinder_z(2740, 940, 975, 135, 28, 1),
        script_cylinder_z(4520, 940, 825, 95, 150, 1),
        script_cylinder_z(4520, 940, 975, 135, 28, 1),
        script_cylinder_z(5880, 940, 825, 95, 150, 1),
        script_cylinder_z(5880, 940, 975, 135, 28, 1),
        script_cylinder_z(6560, 1550, 1580, 42, 220, 1),
    ])
    # Store a useful opening presentation in model space rather than a plan
    # view in 2D wireframe. VPOINT accepts an explicit 3D direction on the
    # installed AutoCAD for Mac; -VIEW only offers the six orthographic views.
    body.extend(["_.VPOINT\n1,-1,1\n", "_.VSCURRENT\n_Conceptual\n", "_.ZOOM\n_E\n"])
    # FILEDIA=0 SAVEAS requires a DWG version before the filename.  The 2018
    # format remains broadly readable and preserves native 3DSOLID geometry.
    body.extend(["_.FILEDIA\n0\n_.SAVEAS\n2018\n", f"{native_dwg_path(record['quote_id'])}\n", "_.QSAVE\n", "_.FILEDIA\n1\n"])
    if quit_after_save:
        # AcCoreConsole remains alive at its command prompt when a script ends.
        # QUIT makes unattended builds terminate cleanly after the DWG is saved.
        body.append("_.QUIT\n")
    return "".join(body)


def write_native_3d_script(record: dict, console: bool = False) -> Path:
    NATIVE_DIR.mkdir(exist_ok=True)
    target = native_console_script_path(record["quote_id"]) if console else native_script_path(record["quote_id"])
    target.write_text(make_native_3d_script(record, quit_after_save=console), encoding="ascii")
    return target


def positive_number(value: object, name: str) -> float:
    try:
        result = float(value)
    except (ValueError, TypeError):
        raise ValueError(f"{name}必须是数字")
    if not 0.1 <= result <= 10000:
        raise ValueError(f"{name}需在0.1至10000之间")
    return result


def calculate(payload: dict) -> dict:
    industry_key = payload.get("industry")
    industry = INDUSTRIES.get(industry_key)
    if not industry:
        raise ValueError("请选择有效客户行业")
    route_keys = [key for key in payload.get("routes", []) if key in ROUTES]
    if not route_keys:
        raise ValueError("至少选择一条技术路线")
    capacity = positive_number(payload.get("capacity"), "设计处理量")
    compliance = payload.get("compliance")
    if compliance not in {"standard", "sanitary", "gmp"}:
        raise ValueError("请选择合规等级")
    explosion_proof = bool(payload.get("explosion_proof"))
    explosion_class = str(payload.get("explosion_class") or "pending") if explosion_proof else ""
    if explosion_proof and explosion_class not in EXPLOSION_CLASSES:
        raise ValueError("请选择有效防爆等级")
    explosion = EXPLOSION_CLASSES.get(explosion_class, {"label": "非防爆", "factor": 1.00})

    scale = 0.72 + capacity * 0.19
    spiral = any(key in {"uf", "nf", "ro"} for key in route_keys)
    shells = 2 if capacity <= 1 else 4 if capacity <= 3 else 8
    cores = shells * 4
    membrane_base = sum(ROUTES[key][1] for key in route_keys) * scale
    avg_shell = (4900 + 4600 + 6400) / 3
    housing = (avg_shell * shells if spiral else 0) + (8600 * scale if "hollow" in route_keys else 0) + (22000 * scale if "ceramic" in route_keys else 0) + (12000 * scale if "ed" in route_keys else 0) + (46000 * scale if "ion_exchange" in route_keys else 0)
    complexity = (1.06 if len(route_keys) > 1 else 0.82) * ({"standard": 0.90, "sanitary": 1.06, "gmp": 1.18}[compliance])
    base = {
        "膜组件": membrane_base,
        "膜壳与组件支架": housing,
        "泵阀仪表": 22500 * scale * (1.15 if "ed" in route_keys else 1.24 if "ion_exchange" in route_keys else 1) * (1.12 * explosion["factor"] if explosion_proof else 1),
        "管材管件": 17800 * scale * industry["factor"] * (1.05 * explosion["factor"] if explosion_proof else 1),
        "电控与软件": 17800 * complexity * (1.12 if "ed" in route_keys else 1) * (1.35 * explosion["factor"] if explosion_proof else 1),
        "框架制造": 72000 * scale * industry["factor"],
        "文件与验证": {"standard": 3500, "sanitary": 16000, "gmp": 42000}[compliance] + (10000 if explosion_proof else 0),
    }
    options = {}
    for code, tier in TIERS.items():
        costs = {name: round(value * tier["factor"], 2) for name, value in base.items()}
        total_cost = round(sum(costs.values()), 2)
        quote = round(total_cost / (1 - tier["margin"]), 2)
        options[code] = {**tier, "costs": costs, "total_cost": total_cost, "sales_quote": quote, "gross_profit": round(quote - total_cost, 2)}
    return {
        "industry": industry_key,
        "industry_name": industry["name"],
        "requirements": industry["requirements"],
        "routes": route_keys,
        "route_names": [ROUTES[key][0] for key in route_keys],
        "capacity_m3h": capacity,
        "compliance": compliance,
        "explosion_proof": explosion_proof,
        "explosion_class": explosion_class,
        "explosion_class_label": explosion["label"],
        "spiral_shells": shells if spiral else 0,
        "spiral_cores": cores if spiral else 0,
        "options": options,
        "cad_scope": "参数化三维概念模型：撬装框架、罐体、泵组、膜组件、管路、阀门与控制柜；不作为制造、应力或碰撞校核模型。",
    }


def dxf_pair(code: int, value: object) -> str:
    return f"{code}\n{value}\n"


def layer(name: str, color: int) -> str:
    return "".join([dxf_pair(0, "LAYER"), dxf_pair(2, name), dxf_pair(70, 0), dxf_pair(62, color), dxf_pair(6, "CONTINUOUS")])


def line3d(a: tuple[float, float, float], b: tuple[float, float, float], layer_name: str) -> str:
    return "".join([dxf_pair(0, "LINE"), dxf_pair(8, layer_name), dxf_pair(10, a[0]), dxf_pair(20, a[1]), dxf_pair(30, a[2]), dxf_pair(11, b[0]), dxf_pair(21, b[1]), dxf_pair(31, b[2])])


def text3d(value: str, x: float, y: float, z: float = 0, height: float = 120) -> str:
    # AC1009 (R12) does not accept UTF-8 text. Use AutoCAD's Unicode escape form
    # so the whole DXF remains ASCII while Chinese labels still render in AutoCAD.
    safe_value = "".join(char if ord(char) < 128 else f"\\U+{ord(char):04X}" for char in value)
    return "".join([dxf_pair(0, "TEXT"), dxf_pair(8, "TEXT"), dxf_pair(10, x), dxf_pair(20, y), dxf_pair(30, z), dxf_pair(40, height), dxf_pair(1, safe_value), dxf_pair(7, "STANDARD")])


def box(x: float, y: float, z: float, length: float, width: float, height: float, layer_name: str) -> str:
    p = [(x, y, z), (x + length, y, z), (x + length, y + width, z), (x, y + width, z), (x, y, z + height), (x + length, y, z + height), (x + length, y + width, z + height), (x, y + width, z + height)]
    edges = [(0,1),(1,2),(2,3),(3,0),(4,5),(5,6),(6,7),(7,4),(0,4),(1,5),(2,6),(3,7)]
    return "".join(line3d(p[a], p[b], layer_name) for a,b in edges)


def line2d(x1: float, y1: float, x2: float, y2: float, layer_name: str, color: int = 7) -> str:
    return "".join([dxf_pair(0, "LINE"), dxf_pair(8, layer_name), dxf_pair(62, color), dxf_pair(10, x1), dxf_pair(20, y1), dxf_pair(30, 0), dxf_pair(11, x2), dxf_pair(21, y2), dxf_pair(31, 0)])


def rect2d(x: float, y: float, length: float, width: float, layer_name: str, color: int = 7) -> str:
    return "".join([line2d(x, y, x + length, y, layer_name, color), line2d(x + length, y, x + length, y + width, layer_name, color), line2d(x + length, y + width, x, y + width, layer_name, color), line2d(x, y + width, x, y, layer_name, color)])


def circle2d(x: float, y: float, radius: float, layer_name: str, color: int = 7) -> str:
    return "".join([dxf_pair(0, "CIRCLE"), dxf_pair(8, layer_name), dxf_pair(62, color), dxf_pair(10, x), dxf_pair(20, y), dxf_pair(30, 0), dxf_pair(40, radius)])


def valve2d(x: float, y: float, vertical: bool = False) -> str:
    r = 85
    if vertical:
        points = [(x, y-r), (x+r, y), (x, y+r), (x-r, y)]
    else:
        points = [(x-r, y), (x, y+r), (x+r, y), (x, y-r)]
    return "".join(line2d(*points[i], *points[(i + 1) % 4], "VALVE", 1) for i in range(4))


def instrument2d(x: float, y: float, tag: str) -> str:
    return circle2d(x, y, 72, "INSTRUMENT", 2) + text3d(tag, x - 48, y - 28, height=48)


def vessel2d(x: float, y: float, body_length: float, diameter: float, label: str) -> str:
    radius = diameter / 2
    return "".join([
        rect2d(x, y - radius, body_length, diameter, "MEMBRANE", 5),
        circle2d(x, y, radius, "MEMBRANE", 5), circle2d(x + body_length, y, radius, "MEMBRANE", 5),
        line2d(x - radius, y, x + body_length + radius, y, "MEMBRANE", 5),
        text3d(label, x + 120, y - radius - 180, height=72),
    ])


def face3d(points: list[tuple[float, float, float]], layer_name: str, color: int) -> str:
    """Write one R12 3DFACE; three points are accepted as a degenerate quad."""
    p = points + [points[-1]] * (4 - len(points))
    codes = ((10, 20, 30), (11, 21, 31), (12, 22, 32), (13, 23, 33))
    data = [dxf_pair(0, "3DFACE"), dxf_pair(8, layer_name), dxf_pair(62, color)]
    for point, code_set in zip(p[:4], codes):
        data.extend([dxf_pair(code_set[0], point[0]), dxf_pair(code_set[1], point[1]), dxf_pair(code_set[2], point[2])])
    return "".join(data)


def box3d(x: float, y: float, z: float, length: float, width: float, height: float, layer_name: str, color: int) -> str:
    p = [(x, y, z), (x + length, y, z), (x + length, y + width, z), (x, y + width, z), (x, y, z + height), (x + length, y, z + height), (x + length, y + width, z + height), (x, y + width, z + height)]
    faces = ((0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0))
    return "".join(face3d([p[index] for index in face], layer_name, color) for face in faces)


def cylinder3d(center: tuple[float, float, float], radius: float, length: float, axis: str, layer_name: str, color: int, segments: int = 12) -> str:
    """Faceted closed cylinder used for tanks, pumps, membrane housings and pipes."""
    import math
    cx, cy, cz = center
    a: list[tuple[float, float, float]] = []
    b: list[tuple[float, float, float]] = []
    for index in range(segments):
        angle = 2 * math.pi * index / segments
        u, v = radius * math.cos(angle), radius * math.sin(angle)
        if axis == "x":
            a.append((cx, cy + u, cz + v)); b.append((cx + length, cy + u, cz + v))
        elif axis == "y":
            a.append((cx + u, cy, cz + v)); b.append((cx + u, cy + length, cz + v))
        else:
            a.append((cx + u, cy + v, cz)); b.append((cx + u, cy + v, cz + length))
    output: list[str] = []
    center_b = (cx + length, cy, cz) if axis == "x" else (cx, cy + length, cz) if axis == "y" else (cx, cy, cz + length)
    for index in range(segments):
        nxt = (index + 1) % segments
        output.append(face3d([a[index], a[nxt], b[nxt], b[index]], layer_name, color))
        output.append(face3d([(cx, cy, cz), a[nxt], a[index]], layer_name, color))
        output.append(face3d([center_b, b[index], b[nxt]], layer_name, color))
    return "".join(output)


def pipe3d(a: tuple[float, float, float], b: tuple[float, float, float], radius: float = 38) -> str:
    """Axis-aligned pipe segment for the skid's visible process and CIP routing."""
    if a[0] != b[0]:
        return cylinder3d(a, radius, b[0] - a[0], "x", "PIPE", 3, 8)
    if a[1] != b[1]:
        return cylinder3d(a, radius, b[1] - a[1], "y", "PIPE", 3, 8)
    return cylinder3d(a, radius, b[2] - a[2], "z", "PIPE", 3, 8)


def valve3d(x: float, y: float, z: float) -> str:
    return "".join([box3d(x - 75, y - 75, z - 75, 150, 150, 150, "VALVE", 1), cylinder3d((x - 135, y, z), 42, 270, "x", "VALVE", 1, 8)])


def cad_industry_name(industry: str) -> str:
    return {"pharma": "PHARMA / BIOPHARMA", "food": "FOOD & BEVERAGE", "chemical": "FINE CHEMICAL", "water": "INDUSTRIAL WATER", "battery": "NEW ENERGY / LI"}.get(industry, "MEMBRANE SYSTEM")


def cad_route_names(routes: list[str]) -> str:
    labels = {"uf": "UF", "nf": "NF", "ro": "RO", "hollow": "HOLLOW FIBER", "ceramic": "CERAMIC", "ed": "ED", "ion_exchange": "CONTINUOUS IX"}
    return " + ".join(labels.get(route, route.upper()) for route in routes)


def dxf_header() -> str:
    """Set an isometric 3D start view around the whole membrane skid."""
    return "".join([
        dxf_pair(0, "SECTION"), dxf_pair(2, "HEADER"),
        dxf_pair(9, "$ACADVER"), dxf_pair(1, "AC1009"),
        dxf_pair(9, "$INSBASE"), dxf_pair(10, 0), dxf_pair(20, 0), dxf_pair(30, 0),
        dxf_pair(9, "$EXTMIN"), dxf_pair(10, -500), dxf_pair(20, -500), dxf_pair(30, 0),
        dxf_pair(9, "$EXTMAX"), dxf_pair(10, 8800), dxf_pair(20, 2300), dxf_pair(30, 2900),
        dxf_pair(9, "$LIMMIN"), dxf_pair(10, -500), dxf_pair(20, -500),
        dxf_pair(9, "$LIMMAX"), dxf_pair(10, 8800), dxf_pair(20, 2300),
        dxf_pair(9, "$VIEWCTR"), dxf_pair(10, 4300), dxf_pair(20, 950),
        dxf_pair(9, "$VIEWSIZE"), dxf_pair(40, 3600),
        dxf_pair(9, "$VIEWDIR"), dxf_pair(10, 1), dxf_pair(20, -1), dxf_pair(30, 1),
        dxf_pair(0, "ENDSEC"),
    ])


def dxf_quote_2d_header() -> str:
    return "".join([
        dxf_pair(0, "SECTION"), dxf_pair(2, "HEADER"), dxf_pair(9, "$ACADVER"), dxf_pair(1, "AC1009"),
        dxf_pair(9, "$INSBASE"), dxf_pair(10, 0), dxf_pair(20, 0), dxf_pair(30, 0),
        dxf_pair(9, "$EXTMIN"), dxf_pair(10, 0), dxf_pair(20, 0), dxf_pair(30, 0),
        dxf_pair(9, "$EXTMAX"), dxf_pair(10, 12200), dxf_pair(20, 7600), dxf_pair(30, 0),
        dxf_pair(9, "$VIEWCTR"), dxf_pair(10, 6100), dxf_pair(20, 3800),
        dxf_pair(9, "$VIEWSIZE"), dxf_pair(40, 8000), dxf_pair(9, "$VIEWDIR"), dxf_pair(10, 0), dxf_pair(20, 0), dxf_pair(30, 1),
        dxf_pair(9, "$TILEMODE"), dxf_pair(70, 1), dxf_pair(9, "$LIMCHECK"), dxf_pair(70, 0),
        dxf_pair(0, "ENDSEC"),
    ])


def make_quote_2d_dxf(record: dict) -> bytes:
    """Create a silent, editable 2D quotation general-arrangement DXF.

    It deliberately communicates module placement and primary piping rather
    than claiming to be a fabrication drawing.  The selected historical
    template is recorded in the title block for engineering traceability.
    """
    routes = set(record.get("routes", []))
    reference = match_history_template(record)
    tier = record.get("selected_tier", "mid").upper()
    option = record["options"][record.get("selected_tier", "mid")]
    entities: list[str] = []
    # Define an explicit active viewport and base tables. AutoCAD otherwise may
    # retain the last blank view when opening an R12 exchange file, even though
    # the entities and extents are valid.
    tables = "".join([
        dxf_pair(0, "SECTION"), dxf_pair(2, "TABLES"),
        dxf_pair(0, "TABLE"), dxf_pair(2, "VPORT"), dxf_pair(70, 1),
        dxf_pair(0, "VPORT"), dxf_pair(2, "*ACTIVE"), dxf_pair(70, 0),
        dxf_pair(10, 0), dxf_pair(20, 0), dxf_pair(11, 1), dxf_pair(21, 1),
        dxf_pair(12, 6100), dxf_pair(22, 3800), dxf_pair(13, 0), dxf_pair(23, 0),
        dxf_pair(14, 10), dxf_pair(24, 10), dxf_pair(15, 10), dxf_pair(25, 10),
        dxf_pair(16, 0), dxf_pair(26, 0), dxf_pair(36, 1), dxf_pair(37, 0),
        dxf_pair(40, 8000), dxf_pair(41, 1.60), dxf_pair(42, 50), dxf_pair(43, 0),
        dxf_pair(44, 0), dxf_pair(50, 0), dxf_pair(51, 0), dxf_pair(71, 0),
        dxf_pair(72, 1000), dxf_pair(73, 1), dxf_pair(74, 3), dxf_pair(75, 0),
        dxf_pair(76, 0), dxf_pair(77, 0), dxf_pair(78, 0), dxf_pair(0, "ENDTAB"),
        dxf_pair(0, "TABLE"), dxf_pair(2, "LTYPE"), dxf_pair(70, 1),
        dxf_pair(0, "LTYPE"), dxf_pair(2, "CONTINUOUS"), dxf_pair(70, 0),
        dxf_pair(3, "Solid line"), dxf_pair(72, 65), dxf_pair(73, 0), dxf_pair(40, 0.0),
        dxf_pair(0, "ENDTAB"),
        dxf_pair(0, "TABLE"), dxf_pair(2, "STYLE"), dxf_pair(70, 1),
        dxf_pair(0, "STYLE"), dxf_pair(2, "STANDARD"), dxf_pair(70, 0),
        dxf_pair(40, 0), dxf_pair(41, 1), dxf_pair(50, 0), dxf_pair(71, 0),
        dxf_pair(42, 2.5), dxf_pair(3, "txt.shx"), dxf_pair(4, ""), dxf_pair(0, "ENDTAB"),
        dxf_pair(0, "TABLE"), dxf_pair(2, "LAYER"), dxf_pair(70, 8),
        layer("FRAME", 8), layer("PROCESS", 3), layer("MEMBRANE", 5), layer("PUMP", 6),
        layer("VALVE", 1), layer("INSTRUMENT", 2), layer("ELECTRICAL", 6), layer("TEXT", 7),
        dxf_pair(0, "ENDTAB"), dxf_pair(0, "ENDSEC"),
    ])

    # Sheet border, title, and a clear two-view arrangement.
    entities.extend([rect2d(220, 220, 11760, 7160, "FRAME", 8), text3d("QUOTE 2D GENERAL ARRANGEMENT - NOT FOR FABRICATION", 520, 7000, height=150), text3d(f"QUOTE: {record['quote_id']}   TIER: {tier}   SALES: CNY {option['sales_quote']:,.0f}", 520, 6760, height=95), text3d(f"REFERENCE TEMPLATE: {reference['template_id'] or 'NONE'}", 520, 6580, height=78), text3d("SIDE ELEVATION", 650, 6100, height=100), text3d("TOP PLAN", 650, 3300, height=100)])

    # Side elevation: frame, feed vessel, pump, membrane train, control panel.
    entities.extend([rect2d(600, 4300, 9300, 190, "FRAME", 8), rect2d(600, 4490, 9300, 90, "FRAME", 8), rect2d(850, 4580, 1050, 1200, "FRAME", 8), circle2d(1375, 5180, 420, "PROCESS", 3), rect2d(2300, 4660, 1150, 190, "FRAME", 8), circle2d(2600, 4850, 220, "PUMP", 6), circle2d(3050, 4850, 300, "PUMP", 6), rect2d(8550, 4580, 620, 1500, "ELECTRICAL", 6), text3d("T-101 FEED / CIP", 920, 4400, height=72), text3d("P-101 FEED PUMP", 2370, 4400, height=72), text3d("PLC-101", 8580, 4400, height=72)])
    entities.extend([line2d(1780, 5180, 2300, 5180, "PROCESS", 3), line2d(3350, 5180, 8400, 5180, "PROCESS", 3), line2d(8400, 5180, 8400, 5750, "PROCESS", 3), line2d(8400, 5750, 1780, 5750, "PROCESS", 3), line2d(1780, 5750, 1780, 5600, "PROCESS", 3), valve2d(3550, 5180), valve2d(6500, 5180), valve2d(8400, 5750), instrument2d(3950, 5180, "PI"), instrument2d(6900, 5180, "FI")])

    # Technology-specific membrane / ion-exchange modules at the centre of the skid.
    module_x = 3900
    if routes & {"uf", "nf", "ro"}:
        shells = min(4, max(2, int(record.get("spiral_shells", 0) or 2)))
        for index in range(shells):
            row, column = divmod(index, 2)
            vessel2d(module_x + column * 1420, 4950 + row * 520, 880, 190, f"MH-{index + 1:02d}")
        entities.append(text3d("SPIRAL MEMBRANE TRAIN", module_x, 4460, height=78))
    if "ceramic" in routes:
        x = 5600
        entities.extend([rect2d(x, 4680, 620, 1350, "MEMBRANE", 5), circle2d(x + 310, 5355, 310, "MEMBRANE", 5), line2d(x + 310, 4630, x + 310, 6080, "MEMBRANE", 5), text3d("CERAMIC HOUSING", x - 60, 4460, height=78)])
    if "hollow" in routes:
        x = 6600
        entities.extend([rect2d(x, 4700, 460, 1250, "MEMBRANE", 5), circle2d(x + 230, 5325, 230, "MEMBRANE", 5), text3d("HOLLOW UF", x, 4460, height=78)])
    if "ed" in routes:
        x = 7350
        entities.extend([rect2d(x, 4740, 650, 1120, "MEMBRANE", 5), *(line2d(x + 70, 4820 + offset, x + 580, 4820 + offset, "MEMBRANE", 5) for offset in (0, 180, 360, 540, 720)), text3d("ED STACK", x + 80, 4460, height=78)])
    if "ion_exchange" in routes:
        x = 6000
        for offset, tag in ((0, "IX-101"), (720, "IX-102")):
            entities.extend([rect2d(x + offset, 4700, 420, 1180, "MEMBRANE", 5), circle2d(x + offset + 210, 5290, 210, "MEMBRANE", 5), text3d(tag, x + offset + 50, 4460, height=70)])
        entities.append(text3d("CONTINUOUS ION EXCHANGE", x - 80, 6100, height=78))

    # Top plan has the same tagged modules with primary piping and maintenance access zone.
    entities.extend([rect2d(600, 1250, 9300, 1380, "FRAME", 8), circle2d(1450, 1940, 460, "PROCESS", 3), rect2d(2350, 1650, 1100, 580, "FRAME", 8), circle2d(2660, 1940, 220, "PUMP", 6), circle2d(3100, 1940, 280, "PUMP", 6), rect2d(8550, 1600, 620, 720, "ELECTRICAL", 6), line2d(1910, 1940, 2350, 1940, "PROCESS", 3), line2d(3380, 1940, 8200, 1940, "PROCESS", 3), valve2d(3650, 1940), valve2d(6900, 1940), text3d("PROCESS FLOW", 4400, 2070, height=72), text3d("MAINTENANCE / MEMBRANE MODULE ZONE", 4350, 1450, height=72)])
    if routes & {"uf", "nf", "ro"}:
        for index in range(4):
            vessel2d(4200 + (index % 2) * 1750, 1700 + (index // 2) * 450, 1200, 190, f"MH-{index + 1:02d}")
    if "ceramic" in routes:
        entities.extend([rect2d(5650, 1550, 760, 720, "MEMBRANE", 5), circle2d(6030, 1910, 300, "MEMBRANE", 5)])
    if "ion_exchange" in routes:
        entities.extend([circle2d(6100, 1780, 260, "MEMBRANE", 5), circle2d(6900, 1780, 260, "MEMBRANE", 5)])
    entities.extend([text3d("DESIGN BASIS: QUOTATION LAYOUT ONLY. VERIFY PROCESS, INTERFACES, DIMENSIONS AND BOM BEFORE FABRICATION.", 520, 940, height=65), text3d(f"HISTORICAL REFERENCE: {reference['template_id'] or 'NONE'} - MATCHED BY ROUTE AND DRAWING COMPLETENESS", 520, 760, height=65)])
    entities_section = "".join([dxf_pair(0, "SECTION"), dxf_pair(2, "ENTITIES"), "".join(entities), dxf_pair(0, "ENDSEC"), dxf_pair(0, "EOF")])
    return (dxf_quote_2d_header() + tables + entities_section).encode("ascii")


def make_dxf(record: dict) -> bytes:
    routes = record["routes"]
    options = record["options"]
    tier = record.get("selected_tier", "mid")
    spiral = any(key in {"uf", "nf", "ro"} for key in routes)
    shells = min(4, max(1, int(record.get("spiral_shells", 0)))) if spiral else 0
    ent: list[str] = []

    # Structural skid: base rails, cross beams, legs, and upper bracing.
    ent.extend([box3d(0, 40, 0, 8500, 90, 130, "FRAME", 8), box3d(0, 1770, 0, 8500, 90, 130, "FRAME", 8)])
    for x in (150, 2100, 4200, 6300, 8300):
        ent.extend([box3d(x, 40, 0, 90, 1820, 130, "FRAME", 8), box3d(x, 40, 130, 90, 90, 720, "FRAME", 8), box3d(x, 1770, 130, 90, 90, 720, "FRAME", 8)])
    ent.extend([box3d(150, 40, 850, 8250, 90, 90, "FRAME", 8), box3d(150, 1770, 850, 8250, 90, 90, "FRAME", 8)])

    # T-101 pretreatment tank and P-101 pump / motor group.
    ent.extend([cylinder3d((850, 930, 250), 380, 1350, "z", "TANK", 4), cylinder3d((850, 930, 1600), 380, 180, "z", "TANK", 4), box3d(1450, 610, 230, 1250, 620, 120, "BASE", 8), cylinder3d((1570, 920, 600), 210, 510, "x", "PUMP", 6), cylinder3d((2090, 920, 600), 300, 300, "y", "PUMP", 6), cylinder3d((2390, 1070, 600), 75, 230, "y", "PUMP", 6)])

    # Membrane train: all configured technologies populate their own 3D module.
    process_x = 3000
    if spiral:
        for index in range(shells):
            row, col = divmod(index, 2)
            ent.append(cylinder3d((process_x + col * 1750, 540 + row * 760, 1320), 145, 1300, "x", "SPIRAL_HOUSING", 5))
            ent.append(box3d(process_x - 50 + col * 1750, 420 + row * 760, 820, 1500, 240, 110, "SUPPORT", 8))
        process_x += 3600
    if "ceramic" in routes:
        x = min(process_x, 6100)
        ent.extend([cylinder3d((x, 1050, 280), 300, 1650, "z", "CERAMIC", 5), cylinder3d((x, 1050, 650), 340, 75, "z", "CERAMIC", 5), cylinder3d((x, 1050, 1300), 340, 75, "z", "CERAMIC", 5), cylinder3d((x, 1050, 1900), 340, 75, "z", "CERAMIC", 5), box3d(x - 430, 610, 200, 860, 880, 90, "SUPPORT", 8)])
        process_x = x + 850
    if "hollow" in routes:
        x = min(process_x, 6900)
        ent.extend([cylinder3d((x, 700, 350), 210, 1450, "z", "HOLLOW", 5), cylinder3d((x, 700, 450), 250, 55, "z", "HOLLOW", 5), cylinder3d((x, 700, 1700), 250, 55, "z", "HOLLOW", 5)])
        process_x = x + 540
    if "ed" in routes:
        x = min(process_x, 7150)
        ent.extend([box3d(x, 620, 420, 560, 840, 1050, "ED_STACK", 5), *(box3d(x + 45, 660 + offset, 460, 470, 38, 970, "ED_STACK", 5) for offset in (0, 165, 330, 495, 660))])

    # PLC cabinet and physical process / CIP pipework with inline valves.
    ent.extend([box3d(7700, 1320, 250, 570, 380, 1550, "ELECTRICAL", 6), box3d(7770, 1390, 1680, 430, 25, 35, "ELECTRICAL", 2), box3d(7770, 1390, 1450, 430, 25, 35, "ELECTRICAL", 2), pipe3d((1230, 930, 780), (1450, 930, 780)), pipe3d((2390, 930, 780), (7000, 930, 780)), pipe3d((7000, 930, 780), (7000, 930, 2000)), pipe3d((7000, 930, 2000), (1230, 930, 2000)), pipe3d((1230, 930, 2000), (1230, 930, 1600)), valve3d(2700, 930, 780), valve3d(5200, 930, 780), valve3d(7000, 930, 2000), cylinder3d((3200, 930, 800), 95, 75, "z", "INSTRUMENT", 2), cylinder3d((5800, 930, 800), 95, 75, "z", "INSTRUMENT", 2)])

    # ASCII-only labels remain readable in R12 DXF files.
    ent.extend([text3d("MEMBRANE SKID - 3D CONCEPT MODEL", 100, -300, 0, 150), text3d(f"{record['quote_id']} | {cad_industry_name(record['industry'])} | {cad_route_names(routes)}", 100, -530, 0, 105), text3d("T-101", 620, 420, 110, 90), text3d("P-101", 1700, 420, 110, 90), text3d("MEMBRANE TRAIN", 3900, 250, 110, 95), text3d("PLC-101", 7700, 1200, 110, 90), text3d(f"{tier.upper()} | SALES QUOTE CNY {options[tier]['sales_quote']:,.0f}", 100, -740, 0, 105)])
    tables = ""
    entities = "".join([dxf_pair(0, "SECTION"), dxf_pair(2, "ENTITIES"), "".join(ent), dxf_pair(0, "ENDSEC"), dxf_pair(0, "EOF")])
    return (dxf_header() + tables + entities).encode("ascii")


def parse_multipart(content_type: str, raw: bytes) -> tuple[dict[str, str], dict[str, tuple[str, bytes]]]:
    boundary_match = re.search(r"boundary=([^;]+)", content_type, re.I)
    if not boundary_match:
        raise ValueError("未识别到 BOM 上传边界")
    boundary = boundary_match.group(1).strip().strip('"').encode("utf-8")
    fields: dict[str, str] = {}
    files: dict[str, tuple[str, bytes]] = {}
    for part in raw.split(b"--" + boundary):
        if not part or part in {b"--\r\n", b"--"}:
            continue
        part = part.lstrip(b"\r\n")
        try:
            headers, body = part.split(b"\r\n\r\n", 1)
        except ValueError:
            continue
        if body.endswith(b"\r\n"):
            body = body[:-2]
        header_text = headers.decode("utf-8", errors="replace")
        name_match = re.search(r'name="([^"]+)"', header_text)
        if not name_match:
            continue
        field_name = name_match.group(1)
        filename_match = re.search(r'filename="([^"]*)"', header_text)
        if filename_match:
            files[field_name] = (Path(filename_match.group(1)).name, body)
        else:
            fields[field_name] = body.decode("utf-8", errors="replace")
    return fields, files


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        self._device_context_cache = None
        self._issued_device_id = None
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # Local app assets and job statuses must not outlive a server update.
        self.send_header("Cache-Control", "no-store")
        if self._issued_device_id:
            cookie = f"{DEVICE_COOKIE_NAME}={self._issued_device_id}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax"
            # Nginx adds this header when a domain with HTTPS terminates in
            # front of the loopback-only Python service.
            if self.headers.get("X-Forwarded-Proto", "").lower() == "https":
                cookie += "; Secure"
            self.send_header("Set-Cookie", cookie)
        super().end_headers()

    def device_context(self) -> dict:
        if self._device_context_cache is not None:
            return self._device_context_cache
        device_id = None
        try:
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            morsel = cookie.get(DEVICE_COOKIE_NAME)
            device_id = morsel.value if morsel else None
        except (KeyError, TypeError):
            device_id = None
        context = DEVICE_ACCESS.ensure_device(device_id)
        if context.get("new"):
            self._issued_device_id = context["device_id"]
        self._device_context_cache = context
        return context

    def reserve_quote_pair(self, quote_id: str) -> dict:
        context = self.device_context()
        return DEVICE_ACCESS.reserve_quote_pair(context["device_id"], quote_id)

    def allow_concept_image(self, quote_id: str) -> None:
        context = self.device_context()
        DEVICE_ACCESS.allow_concept_image(context["device_id"], quote_id)

    def send_json(self, status: int, payload: dict | list) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status); self.send_header("Content-Type", "application/json; charset=utf-8"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 100_000:
            raise ValueError("请求过大")
        raw = self.rfile.read(length)
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("请求格式无效")
        return data

    def read_binary(self, maximum_bytes: int) -> bytes:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("请求长度无效")
        if not 0 < length <= maximum_bytes:
            raise ValueError(f"图片需大于 0 且不超过 {maximum_bytes // (1024 * 1024)} MB")
        return self.rfile.read(length)

    def image_worker_authorized(self) -> bool:
        expected = REMOTE_IMAGE_WORKER_TOKEN
        supplied = self.headers.get("X-Image-Worker-Token", "")
        return bool(REMOTE_IMAGE_WORKER_ENABLED and expected and hmac.compare_digest(supplied, expected))

    def read_multipart(self, maximum_bytes: int = MAX_BOM_BYTES, label: str = "BOM 文件") -> tuple[dict[str, str], dict[str, tuple[str, bytes]]]:
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= maximum_bytes:
            raise ValueError(f"{label}需大于 0 且不超过 {maximum_bytes // (1024 * 1024)} MB")
        return parse_multipart(self.headers.get("Content-Type", ""), self.rfile.read(length))

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/activate":
            token = (parse_qs(parsed.query).get("token") or [""])[0]
            device_id = DEVICE_ACCESS.consume_trusted_activation(token)
            if not device_id:
                return self.send_json(403, {"error": "激活链接无效或已过期，请在本机重新执行激活脚本"})
            self._issued_device_id = device_id
            self.send_response(302); self.send_header("Location", "/"); self.end_headers(); return
        if path in {"/", "/index.html"} or path.startswith("/api/"):
            self.device_context()
        if path == "/api/image-settings":
            return self.send_json(200, IMAGE_JOBS.settings_status())
        if path == "/api/status":
            return self.send_json(200, {"service": "膜设备成本预算本地服务", "storage": str(QUOTES_FILE.name), "history_template_storage": str(HISTORY_TEMPLATES_FILE.name), "cad_export": "native 3DSOLID DWG", "native_3d_build_enabled": NATIVE_3D_BUILD_ENABLED, "quote_2d_build_enabled": QUOTE_2D_BUILD_ENABLED, "quote_concept_image": {"enabled": QUOTE_CONCEPT_IMAGE_ENABLED, "provider": QUOTE_CONCEPT_IMAGE_PROVIDER, "configured": quote_concept_image_runtime_ready(), "model": QUOTE_CONCEPT_IMAGE_MODEL}, "trial_access": {key: value for key, value in self.device_context().items() if key != "device_id"}, "material_price_linkage": procurement_price_book_status()})
        if path == "/api/access-status":
            context = self.device_context()
            return self.send_json(200, {key: value for key, value in context.items() if key != "device_id"})
        if path == "/api/material-price-status":
            return self.send_json(200, procurement_price_book_status())
        if path == "/api/material-list-template.xlsx":
            if not MATERIAL_LIST_TEMPLATE_FILE.exists():
                return self.send_json(404, {"error": "固定材料清单模板未安装"})
            data = MATERIAL_LIST_TEMPLATE_FILE.read_bytes()
            self.send_response(200); self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); self.send_header("Content-Disposition", 'attachment; filename="material-list-template.xlsx"'); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data); return
        if path == "/api/history-templates":
            return self.send_json(200, [history_template_summary(template) for template in load_history_templates()])
        if path == "/api/projects":
            return self.send_json(200, [project_summary(project) for project in load_projects()])
        project_match = re.fullmatch(r"/api/projects/(P\d{8}-\d{4})", path)
        if project_match:
            project = next((item for item in load_projects() if item.get("project_id") == project_match.group(1)), None)
            return self.send_json(200, project_view(project)) if project else self.send_json(404, {"error": "项目不存在"})
        project_bom_match = re.fullmatch(r"/api/projects/(P\d{8}-\d{4})/bom-draft\.csv", path)
        if project_bom_match:
            project = next((item for item in load_projects() if item.get("project_id") == project_bom_match.group(1)), None)
            if not project:
                return self.send_json(404, {"error": "项目不存在"})
            data = project_bom_csv_bytes(project)
            self.send_response(200); self.send_header("Content-Type", "text/csv; charset=utf-8"); self.send_header("Content-Disposition", f'attachment; filename="{project["project_id"]}_BOM_draft.csv"'); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data); return
        template_match = re.fullmatch(r"/api/history-templates/(CF\d{8}GA)", path)
        if template_match:
            template = next((item for item in load_history_templates() if item.get("template_id") == template_match.group(1)), None)
            return self.send_json(200, template) if template else self.send_json(404, {"error": "历史样机不存在"})
        template_cost_match = re.fullmatch(r"/api/history-templates/(CF\d{8}GA)/cost-audit", path)
        if template_cost_match:
            try:
                return self.send_json(200, historical_bom_cost_audit(template_cost_match.group(1)))
            except ValueError as err:
                return self.send_json(404, {"error": str(err)})
        if path == "/api/quotes":
            quotes = [{**record, "quote_2d": quote_2d_metadata(record), "quote_concept_image": quote_concept_image_status(record), "historical_reference": match_history_template(record), "equipment_model": equipment_model(record), "native_3d_build_enabled": NATIVE_3D_BUILD_ENABLED, "quote_2d_build_enabled": QUOTE_2D_BUILD_ENABLED, "quote_concept_image_enabled": QUOTE_CONCEPT_IMAGE_ENABLED} for record in load_quotes()]
            return self.send_json(200, quotes)
        concept_match = re.fullmatch(r"/api/quotes/(Q\d{8}-\d{4})/(concept-image-status|concept-images\.zip|concept-images/(front|left|right|back)\.jpg|concept-image\.(?:png|jpg))", path)
        if concept_match:
            quote_id, resource, view = concept_match.groups()
            if not any(q.get("quote_id") == quote_id for q in load_quotes()):
                return self.send_json(404, {"error": "报价不存在"})
            if resource == "concept-image-status":
                return self.send_json(200, IMAGE_JOBS.status(quote_id))
            if resource == "concept-image.jpg":
                view = "perspective"
            if resource == "concept-image.png":
                view = "front"  # Legacy link now serves the validated Front JPEG.
            target = IMAGE_JOBS.artifact(quote_id, view)
            if not target or (resource == "concept-images.zip" and target.suffix != ".zip"):
                return self.send_json(404, {"error": "该效果图或旧版图包尚未生成"})
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg" if view else "application/zip")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            if not view:
                self.send_header("Content-Disposition", f'attachment; filename="{quote_id}_four_views.zip"')
            self.end_headers(); self.wfile.write(data); return
        quote_2d_match = re.fullmatch(r"/api/quotes/(Q\d{8}-\d{4})/quote-2d\.dxf", path)
        if quote_2d_match:
            if not QUOTE_2D_BUILD_ENABLED:
                return self.send_json(503, {"error": "二维报价图服务当前已关闭，待历史可编辑图纸模板和映射规则完成验证后再启用"})
            record = next((q for q in load_quotes() if q.get("quote_id") == quote_2d_match.group(1)), None)
            if not record:
                return self.send_json(404, {"error": "报价不存在"})
            target = quote_2d_path(record["quote_id"])
            if not target.exists():
                return self.send_json(404, {"error": "尚未生成二维报价图，请先点击“生成二维报价图”"})
            data = target.read_bytes()
            version = datetime.fromtimestamp(target.stat().st_mtime).strftime("%Y%m%d-%H%M%S")
            filename = f"{target.stem}_v{version}{target.suffix}"
            self.send_response(200); self.send_header("Content-Type", "application/dxf"); self.send_header("Content-Disposition", f'attachment; filename="{filename}"'); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data); return
        quote_2d_bundle_match = re.fullmatch(r"/api/quotes/(Q\d{8}-\d{4})/quote-2d\.zip", path)
        if quote_2d_bundle_match:
            if not QUOTE_2D_BUILD_ENABLED:
                return self.send_json(503, {"error": "二维报价图服务当前已关闭，待历史可编辑图纸模板和映射规则完成验证后再启用"})
            record = next((q for q in load_quotes() if q.get("quote_id") == quote_2d_bundle_match.group(1)), None)
            if not record:
                return self.send_json(404, {"error": "报价不存在"})
            target = quote_2d_bundle_path(record["quote_id"])
            if not target.exists():
                return self.send_json(404, {"error": "尚未生成二维报价图包，请先点击“生成二维报价图包”"})
            data = target.read_bytes()
            version = datetime.fromtimestamp(target.stat().st_mtime).strftime("%Y%m%d-%H%M%S")
            filename = f"{target.stem}_v{version}{target.suffix}"
            self.send_response(200); self.send_header("Content-Type", "application/zip"); self.send_header("Content-Disposition", f'attachment; filename="{filename}"'); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data); return
        native_match = re.fullmatch(r"/api/quotes/(Q\d{8}-\d{4})/native-3d\.scr", path)
        if native_match:
            record = next((q for q in load_quotes() if q.get("quote_id") == native_match.group(1)), None)
            if not record:
                return self.send_json(404, {"error": "报价不存在"})
            target = write_native_3d_script(record)
            data = target.read_bytes()
            self.send_response(200); self.send_header("Content-Type", "text/plain; charset=us-ascii"); self.send_header("Content-Disposition", f'attachment; filename="{target.name}"'); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data); return
        native_dwg_match = re.fullmatch(r"/api/quotes/(Q\d{8}-\d{4})/native-3d\.dwg", path)
        if native_dwg_match:
            record = next((q for q in load_quotes() if q.get("quote_id") == native_dwg_match.group(1)), None)
            if not record:
                return self.send_json(404, {"error": "报价不存在"})
            target = native_dwg_path(record["quote_id"])
            if not target.exists():
                return self.send_json(404, {"error": "尚未生成实体 DWG，请先点击“生成实体 DWG”"})
            data = target.read_bytes()
            self.send_response(200); self.send_header("Content-Type", "application/acad"); self.send_header("Content-Disposition", f'attachment; filename="{target.name}"'); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data); return
        if path not in {"/", "/index.html", "/four_views.js"}:
            return self.send_json(404, {"error": "资源不存在"})
        return super().do_GET()

    def do_HEAD(self):
        if urlparse(self.path).path not in {"/", "/index.html", "/four_views.js"}:
            return self.send_error(404)
        return super().do_HEAD()

    def do_POST(self):
        # Serialize read/modify/write transactions, not background network work.
        with QUOTE_WRITE_LOCK:
            return self._do_POST()

    def _do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/internal/image-worker/claim":
            if not self.image_worker_authorized():
                return self.send_json(403, {"error": "本机生图代理认证失败"})
            job = IMAGE_JOBS.claim_remote()
            if not job:
                self.send_response(204); self.end_headers(); return
            return self.send_json(200, job)
        worker_match = re.fullmatch(r"/api/internal/image-worker/(Q\d{8}-\d{4})/([a-f0-9]{32})/(complete|fail)", path)
        if worker_match:
            if not self.image_worker_authorized():
                return self.send_json(403, {"error": "本机生图代理认证失败"})
            quote_id, job_id, action = worker_match.groups()
            try:
                if action == "complete":
                    if not self.headers.get("Content-Type", "").lower().startswith("image/jpeg"):
                        raise ValueError("本机代理必须回传 JPEG 图片")
                    state = IMAGE_JOBS.complete_remote(quote_id, job_id, self.read_binary(20 * 1024 * 1024))
                else:
                    payload = self.read_json()
                    message = str(payload.get("message") or "本机生图代理执行失败")[:300]
                    state = IMAGE_JOBS.fail_remote(quote_id, job_id, message)
                return self.send_json(200, state)
            except ValueError as error:
                return self.send_json(400, {"error": str(error)})
            except ImageJobError as error:
                return self.send_json(409, {"error": str(error)})
        self.device_context()
        if path == "/api/trusted-device-activation":
            try:
                payload = self.read_json()
                token = DEVICE_ACCESS.create_trusted_activation(payload.get("mac_hash", ""))
                return self.send_json(201, {"activation_path": f"/activate?token={token}", "expires_in_seconds": DEVICE_ACCESS.activation_ttl_seconds})
            except PermissionError as error:
                return self.send_json(403, {"error": str(error)})
            except ValueError as error:
                return self.send_json(400, {"error": str(error)})
        if path == "/api/image-settings":
            # This endpoint is local-only and must not accept cross-origin key changes.
            port = self.server.server_port
            hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
            host = self.headers.get("Host", "")
            origin = self.headers.get("Origin")
            if host not in hosts or (origin and origin != f"http://{host}"):
                return self.send_json(403, {"error": "只允许从本地系统页面保存 Key1"})
            if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
                return self.send_json(415, {"error": "请使用 JSON 提交 Key1"})
            try:
                data = self.read_json()
                state = IMAGE_JOBS.save_key1(data.get("api_key"))
                return self.send_json(200, {**state, "message": "Key1 已保存到本地并生效；密钥不会回传或提交 Git（尚未验证上游权限）"})
            except ValueError as error:
                return self.send_json(400, {"error": str(error)})
            except ImageJobError as error:
                return self.send_json(409, {"error": str(error)})
            except OSError:
                return self.send_json(500, {"error": "本地密钥保存失败，请检查文件权限"})
        if path == "/api/history-templates/refresh":
            try:
                templates = refresh_history_templates()
                return self.send_json(200, {"count": len(templates), "templates": [history_template_summary(template) for template in templates]})
            except Exception:
                return self.send_json(500, {"error": "历史样机资料索引失败，请确认来源文件夹仍可访问"})
        if path == "/api/projects":
            try:
                payload = project_payload(self.read_json())
                projects = load_projects(); now = datetime.now()
                record = {**payload, "project_id": next_project_id(projects, now), "created_at": now.isoformat(timespec="seconds"), "updated_at": now.isoformat(timespec="seconds"), "source_files": []}
                apply_history_match(record)
                projects.append(record); save_projects(projects)
                return self.send_json(201, project_view(record))
            except (ValueError, json.JSONDecodeError) as error:
                return self.send_json(400, {"error": str(error)})
        project_update_match = re.fullmatch(r"/api/projects/(P\d{8}-\d{4})/update", path)
        if project_update_match:
            try:
                payload = project_payload(self.read_json())
                projects = load_projects(); project = next((item for item in projects if item.get("project_id") == project_update_match.group(1)), None)
                if not project:
                    return self.send_json(404, {"error": "项目不存在"})
                apply_history_match(payload, project)
                project.update(payload)
                project["updated_at"] = datetime.now().isoformat(timespec="seconds")
                save_projects(projects)
                return self.send_json(200, project_view(project))
            except (ValueError, json.JSONDecodeError) as error:
                return self.send_json(400, {"error": str(error)})
        project_validate_match = re.fullmatch(r"/api/projects/(P\d{8}-\d{4})/validate", path)
        if project_validate_match:
            projects = load_projects(); project = next((item for item in projects if item.get("project_id") == project_validate_match.group(1)), None)
            if not project:
                return self.send_json(404, {"error": "项目不存在"})
            project["updated_at"] = datetime.now().isoformat(timespec="seconds")
            save_projects(projects)
            return self.send_json(200, project_view(project))
        project_tender_template_upload_match = re.fullmatch(r"/api/projects/(P\d{8}-\d{4})/tender-template-upload", path)
        if project_tender_template_upload_match:
            try:
                if not self.headers.get("Content-Type", "").lower().startswith("multipart/form-data"):
                    raise ValueError("请使用表单方式上传投标文件格式")
                _, files = self.read_multipart(MAX_PROJECT_FILE_BYTES, "投标文件格式")
                if "tender_template" not in files:
                    raise ValueError("请选择客户提供的投标文件格式")
                projects = load_projects(); project = next((item for item in projects if item.get("project_id") == project_tender_template_upload_match.group(1)), None)
                if not project:
                    return self.send_json(404, {"error": "项目不存在"})
                filename, raw = files["tender_template"]
                original_name = Path(filename).name
                extension = Path(original_name).suffix.lower()
                if extension not in {".doc", ".docx"}:
                    raise ValueError("投标文件格式仅支持 DOC 或 DOCX")
                now = datetime.now()
                for item in project.get("source_files", []):
                    if item.get("source_type") == "tender_template" and item.get("is_active", True):
                        item["is_active"] = False
                        item["superseded_at"] = now.isoformat(timespec="seconds")
                safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(original_name).stem).strip("._") or "tender-template"
                target_dir = PROJECT_FILES_DIR / project["project_id"]; target_dir.mkdir(parents=True, exist_ok=True)
                stored_name = f"{now:%Y%m%d%H%M%S%f}_{safe_stem[:80]}{extension}"
                (target_dir / stored_name).write_bytes(raw)
                project.setdefault("source_files", []).append({"source_type": "tender_template", "document_role": "customer_tender_format", "filename": original_name[:160], "stored_name": stored_name, "size_bytes": len(raw), "uploaded_at": now.isoformat(timespec="seconds"), "is_active": True})
                project["updated_at"] = now.isoformat(timespec="seconds")
                save_projects(projects)
                return self.send_json(201, project_view(project))
            except ValueError as error:
                return self.send_json(400, {"error": str(error)})
            except OSError:
                return self.send_json(500, {"error": "投标文件格式归档失败，请检查本地存储权限"})
        project_upload_match = re.fullmatch(r"/api/projects/(P\d{8}-\d{4})/source-upload", path)
        if project_upload_match:
            try:
                if not self.headers.get("Content-Type", "").lower().startswith("multipart/form-data"):
                    raise ValueError("请使用表单方式上传项目资料")
                fields, files = self.read_multipart(MAX_PROJECT_FILE_BYTES, "项目资料")
                if "project_file" not in files:
                    raise ValueError("请选择需要归档的项目资料")
                source_type = str(fields.get("source_type") or "other")
                if source_type not in {"urs", "design_input", "pid", "bom", "requirements", "process_conditions", "existing_layout", "existing_pid", "existing_bom", "site_photo", "other"}:
                    raise ValueError("资料类型无效")
                projects = load_projects(); project = next((item for item in projects if item.get("project_id") == project_upload_match.group(1)), None)
                if not project:
                    return self.send_json(404, {"error": "项目不存在"})
                filename, raw = files["project_file"]
                original_name = Path(filename).name
                extension = Path(original_name).suffix.lower()
                if extension not in {".doc", ".docx", ".xls", ".xlsx", ".pdf", ".dwg", ".dxf", ".png", ".jpg", ".jpeg"}:
                    raise ValueError("仅支持 DOC/DOCX、XLS/XLSX、PDF、DWG/DXF 和常见图片")
                safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(original_name).stem).strip("._") or "source"
                target_dir = PROJECT_FILES_DIR / project["project_id"]; target_dir.mkdir(parents=True, exist_ok=True)
                stored_name = f"{datetime.now():%Y%m%d%H%M%S%f}_{safe_stem[:80]}{extension}"
                target = target_dir / stored_name
                target.write_bytes(raw)
                project.setdefault("source_files", []).append({"source_type": source_type, "filename": original_name[:160], "stored_name": stored_name, "size_bytes": len(raw), "uploaded_at": datetime.now().isoformat(timespec="seconds")})
                project["updated_at"] = datetime.now().isoformat(timespec="seconds")
                save_projects(projects)
                return self.send_json(201, project_view(project))
            except ValueError as error:
                return self.send_json(400, {"error": str(error)})
            except OSError:
                return self.send_json(500, {"error": "项目资料归档失败，请检查本地存储权限"})
        historical_bom_upload_match = re.fullmatch(r"/api/projects/(P\d{8}-\d{4})/historical-bom-upload", path)
        if historical_bom_upload_match:
            try:
                if not self.headers.get("Content-Type", "").lower().startswith("multipart/form-data"):
                    raise ValueError("请使用表单方式上传历史 BOM 修订文件")
                _, files = self.read_multipart(MAX_BOM_BYTES, "历史 BOM 修订文件")
                if "bom_file" not in files:
                    raise ValueError("请选择修改后的历史 BOM 文件")
                projects = load_projects(); project = next((item for item in projects if item.get("project_id") == historical_bom_upload_match.group(1)), None)
                if not project:
                    return self.send_json(404, {"error": "项目不存在"})
                if any(item["severity"] == "error" for item in project_conflicts(project)):
                    raise ValueError("请先保存项目并关闭阻断冲突，再核价修订 BOM")
                filename, raw = files["bom_file"]
                original_name = Path(filename).name
                parsed = read_historical_bom_revision(original_name, raw)
                audit = historical_bom_revision_cost_audit(parsed)
                target_dir = PROJECT_FILES_DIR / project["project_id"] / "bom-revisions"; target_dir.mkdir(parents=True, exist_ok=True)
                safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(original_name).stem).strip("._") or "historical-bom"
                suffix = Path(original_name).suffix.lower()
                stored_name = f"{datetime.now():%Y%m%d%H%M%S%f}_{safe_stem[:80]}{suffix}"
                (target_dir / stored_name).write_bytes(raw)
                revisions = project.setdefault("bom_revisions", [])
                revision = {
                    "revision_id": f"RB{datetime.now():%Y%m%d%H%M%S}-{len(revisions) + 1:02d}",
                    "filename": original_name[:160], "stored_name": stored_name,
                    "uploaded_at": datetime.now().isoformat(timespec="seconds"),
                    "template_id": str(project.get("selected_template_id") or ""),
                    "source_summary": parsed.get("summary", {}), "audit": audit,
                }
                revisions.append(revision)
                project["updated_at"] = datetime.now().isoformat(timespec="seconds")
                save_projects(projects)
                return self.send_json(201, project_view(project))
            except ValueError as error:
                return self.send_json(400, {"error": str(error)})
            except OSError:
                return self.send_json(500, {"error": "历史 BOM 修订归档或核价失败，请检查本地存储权限"})
        concept_build_match = re.fullmatch(r"/api/quotes/(Q\d{8}-\d{4})/concept-image-build", path)
        if concept_build_match:
            history = load_quotes()
            record = next((q for q in history if q.get("quote_id") == concept_build_match.group(1)), None)
            if not record:
                return self.send_json(404, {"error": "报价不存在"})
            try:
                self.allow_concept_image(record["quote_id"])
                enqueue_quote_concept_image(record)
            except DeviceQuotaError as error:
                return self.send_json(429, {"error": str(error)})
            except ImageJobError as error:
                return self.send_json(503, {"error": str(error)})
            image = quote_concept_image_status(record)
            return self.send_json(202, {"quote_id": record["quote_id"], "concept_image": image, "message": image["message"]})
        quote_2d_build_match = re.fullmatch(r"/api/quotes/(Q\d{8}-\d{4})/quote-2d-build", path)
        if quote_2d_build_match:
            if not QUOTE_2D_BUILD_ENABLED:
                return self.send_json(503, {"error": "二维报价图服务当前已关闭，待历史可编辑图纸模板和映射规则完成验证后再启用"})
            record = next((q for q in load_quotes() if q.get("quote_id") == quote_2d_build_match.group(1)), None)
            if not record:
                return self.send_json(404, {"error": "报价不存在"})
            try:
                target = write_quote_2d_dxf(record)
                return self.send_json(201, {"quote_id": record["quote_id"], "message": "二维报价图包已生成", "drawing": quote_2d_metadata(record), "path": str(target)})
            except OSError as exc:
                return self.send_json(500, {"error": f"无法生成二维报价图包：{exc}"})
        native_build_match = re.fullmatch(r"/api/quotes/(Q\d{8}-\d{4})/native-3d-build", path)
        if native_build_match:
            if not NATIVE_3D_BUILD_ENABLED:
                return self.send_json(503, {"error": "三维概念建模服务当前已关闭；待导入并验证历史组件模型后再启用"})
            record = next((q for q in load_quotes() if q.get("quote_id") == native_build_match.group(1)), None)
            if not record:
                return self.send_json(404, {"error": "报价不存在"})
            if not AUTOCAD_CORE_CONSOLE.exists():
                return self.send_json(500, {"error": "未找到 AutoCAD 2026 无界面建模引擎"})
            try:
                script = write_native_3d_script(record, console=True)
                backup = archive_existing_native_dwg(record)
                log_path = ROOT / "logs" / f"{re.sub(r'[^A-Za-z0-9]', '', record['quote_id'])}coreconsole.log"
                log_path.parent.mkdir(exist_ok=True)
                with log_path.open("w", encoding="utf-8") as log:
                    subprocess.Popen([str(AUTOCAD_CORE_CONSOLE), "-s", str(script)], stdout=log, stderr=subprocess.STDOUT)
                return self.send_json(202, {"message": "已在后台生成 AutoCAD 原生实体 DWG", "quote_id": record["quote_id"], "dwg": str(native_dwg_path(record["quote_id"])), "previous_dwg": backup.name if backup else None})
            except OSError:
                return self.send_json(500, {"error": "无法启动 AutoCAD 无界面建模任务"})
        if path != "/api/quotes":
            return self.send_error(HTTPStatus.NOT_FOUND, "接口不存在")
        try:
            payload = self.read_json(); record = calculate(payload)
            project_id = str(payload.get("project_id") or "").strip()
            project = next((item for item in load_projects() if item.get("project_id") == project_id), None) if project_id else None
            if project_id and not project:
                raise ValueError("关联项目不存在，请先保存项目后再生成报价")
            if project and any(item["severity"] == "error" for item in project_conflicts(project)):
                raise ValueError("项目输入尚未完成或存在阻断冲突，不能生成正式报价")
            if project:
                record["route_configs"] = project_route_configs(project)
                record["selected_template_id"] = project.get("selected_template_id", "")
                record["project_type"] = project.get("project_type", "new")
                record["process_medium"] = project.get("process_medium", "")
                assembled = project_bom_draft(project)
                record["bom_assembly"] = {
                    "version": assembled.get("version"), "reference_template_id": assembled.get("reference_template_id", project.get("selected_template_id", "")),
                    "changed_row_count": assembled.get("changed_row_count", 0), "review_item_count": len(assembled.get("review_items", [])),
                }
                record["quote_basis"] = "规则预算；已关联项目装配 BOM。外购件逐项采购核价和自制件制造成本补齐后，方可作为正式报价成本依据。"
            selected = payload.get("selected_tier", "mid")
            if selected not in TIERS:
                raise ValueError("报价档位无效")
            if payload.get("dry_run") is True:
                record.update({"selected_tier": selected, "customer": str(payload.get("customer", "未命名项目"))[:80], "project_id": project_id or None})
                return self.send_json(200, record)
            history = load_quotes(); now = datetime.now()
            record.update({"quote_id": f"Q{now:%Y%m%d}-{len(history)+1:04d}", "created_at": now.isoformat(timespec="seconds"), "selected_tier": selected, "customer": str(payload.get("customer", "未命名项目"))[:80], "project_id": project_id or None})
            self.reserve_quote_pair(record["quote_id"])
            history.append(record); save_quotes(history)
            return self.send_json(201, record)
        except DeviceQuotaError as err:
            return self.send_json(429, {"error": str(err)})
        except (ValueError, json.JSONDecodeError) as err:
            return self.send_json(400, {"error": str(err)})
        except Exception:
            return self.send_json(500, {"error": "本地服务处理失败"})

    def log_message(self, fmt: str, *args):
        print(f"[{datetime.now():%H:%M:%S}] {self.address_string()} {fmt % args}")


if __name__ == "__main__":
    server = ThreadingHTTPServer((SERVER_HOST, SERVER_PORT), Handler)
    print(f"服务已启动：http://{SERVER_HOST}:{SERVER_PORT}")
    print("按 Ctrl+C 停止服务")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n本地服务已停止")
