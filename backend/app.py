from __future__ import annotations

import json
import os
import random
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))

app = Flask(__name__)


@dataclass
class CacheEntry:
    value: dict
    expire_time: float
    ttl: int


# In-memory cache and LB state
CACHE: Dict[str, CacheEntry] = {}
LB_STATE: Dict[str, int] = {}


ZONE_DATA = {
    "root": {
        "NS": {"com": {"records": ["a.gtld-servers.net"], "ttl": 300}},
    },
    "com": {
        "NS": {"example.com": {"records": ["ns1.example.com"], "ttl": 300}},
    },
    "example.com": {
        "NS": {"example.com": {"records": ["ns1.example.com"], "ttl": 300}},
        "A": {
            "www.example.com": {"records": ["93.184.216.34"], "ttl": 120},
            "www-lb.example.com": {"records": ["203.0.113.10", "203.0.113.11", "203.0.113.12"], "ttl": 30},
        },
        "AAAA": {
            "www.example.com": {"records": ["2606:2800:220:1:248:1893:25c8:1946"], "ttl": 120},
        },
        "CNAME": {
            "alias.example.com": {"records": ["www.example.com"], "ttl": 120},
        },
    },
}


POLLUTION_MAP = {
    "www.example.com": {"type": "A", "value": "1.2.3.4"},
    "bad.example.com": {"type": "NXDOMAIN"},
}


FAILURE_PROBS = {
    "root": 0.15,
    "tld": 0.10,
    "auth": 0.20,
    "recursive-resolver": 0.05,
}


def now_ts() -> float:
    return time.time()


def cache_key(qname: str, qtype: str) -> str:
    return f"{qname}|{qtype}"


def get_cache(qname: str, qtype: str) -> Optional[CacheEntry]:
    key = cache_key(qname, qtype)
    entry = CACHE.get(key)
    if not entry:
        return None
    if entry.expire_time <= now_ts():
        CACHE.pop(key, None)
        return None
    return entry


def set_cache(qname: str, qtype: str, value: dict, ttl: int) -> None:
    CACHE[cache_key(qname, qtype)] = CacheEntry(
        value=value,
        expire_time=now_ts() + ttl,
        ttl=ttl,
    )


def remaining_ttl(entry: CacheEntry) -> int:
    return max(0, int(entry.expire_time - now_ts()))


def simulated_latency_ms() -> int:
    return random.randint(10, 60)


def maybe_fail(server: str, enabled: bool) -> bool:
    if not enabled:
        return False
    prob = FAILURE_PROBS.get(server, 0.0)
    return random.random() < prob


def apply_pollution(qname: str, qtype: str, enabled: bool, response: dict) -> dict:
    if not enabled:
        return response
    rule = POLLUTION_MAP.get(qname)
    if not rule:
        return response
    if rule["type"] == "NXDOMAIN":
        return {"status": "NXDOMAIN", "records": [], "ttl": 0}
    if rule["type"] == qtype:
        return {"status": "OK", "records": [rule["value"]], "ttl": 30}
    return response


def lb_pick(qname: str, records: List[str]) -> str:
    idx = LB_STATE.get(qname, 0) % len(records)
    LB_STATE[qname] = idx + 1
    return records[idx]


def build_trace_step(
    server: str,
    level: str,
    qname: str,
    qtype: str,
    response: dict,
    cache_hit: bool,
    latency_ms: int,
    ttl_remaining: int,
) -> dict:
    return {
        "server": server,
        "level": level,
        "qname": qname,
        "qtype": qtype,
        "response": response,
        "latency_ms": latency_ms,
        "cache_hit": cache_hit,
        "remaining_ttl": ttl_remaining,
    }


def resolve_authoritative(qname: str, qtype: str, use_lb: bool) -> dict:
    zone = ZONE_DATA.get("example.com", {})
    qtype_data = zone.get(qtype, {})
    record = qtype_data.get(qname)
    if not record:
        return {"status": "NXDOMAIN", "records": [], "ttl": 0}

    records = record["records"]
    ttl = record["ttl"]

    if use_lb and qname == "www-lb.example.com" and len(records) > 1:
        picked = lb_pick(qname, records)
        return {"status": "OK", "records": [picked], "ttl": ttl}
    return {"status": "OK", "records": records, "ttl": ttl}


def iterative_resolve(qname: str, qtype: str, config: dict) -> Tuple[dict, List[dict]]:
    trace: List[dict] = []

    # Cache at client or resolver level
    entry = get_cache(qname, qtype)
    if entry:
        step = build_trace_step(
            server="cache",
            level="client",
            qname=qname,
            qtype=qtype,
            response=entry.value,
            cache_hit=True,
            latency_ms=1,
            ttl_remaining=remaining_ttl(entry),
        )
        trace.append(step)
        return entry.value, trace

    # Root referral
    latency = simulated_latency_ms()
    if maybe_fail("root", config["failure"]):
        response = {"status": "TIMEOUT", "records": [], "ttl": 0}
        trace.append(build_trace_step("root-server", "root", qname, qtype, response, False, latency, 0))
        return response, trace

    root_response = {"status": "OK", "records": ["a.gtld-servers.net"], "ttl": 300}
    trace.append(build_trace_step("root-server", "root", qname, qtype, root_response, False, latency, 300))

    # TLD referral
    latency = simulated_latency_ms()
    if maybe_fail("tld", config["failure"]):
        response = {"status": "SERVFAIL", "records": [], "ttl": 0}
        trace.append(build_trace_step("a.gtld-servers.net", "tld", qname, qtype, response, False, latency, 0))
        return response, trace

    tld_response = {"status": "OK", "records": ["ns1.example.com"], "ttl": 300}
    trace.append(build_trace_step("a.gtld-servers.net", "tld", qname, qtype, tld_response, False, latency, 300))

    # Authoritative answer
    latency = simulated_latency_ms()
    if maybe_fail("auth", config["failure"]):
        response = {"status": "SERVFAIL", "records": [], "ttl": 0}
        trace.append(build_trace_step("ns1.example.com", "auth", qname, qtype, response, False, latency, 0))
        return response, trace

    response = resolve_authoritative(qname, qtype, config["lb"])
    response = apply_pollution(qname, qtype, config["pollution"], response)
    trace.append(build_trace_step("ns1.example.com", "auth", qname, qtype, response, False, latency, response.get("ttl", 0)))

    if response["status"] == "OK" and response.get("ttl", 0) > 0:
        set_cache(qname, qtype, response, response["ttl"])

    return response, trace


def recursive_resolve(qname: str, qtype: str, config: dict) -> Tuple[dict, List[dict]]:
    trace: List[dict] = []

    latency = simulated_latency_ms()
    if maybe_fail("recursive-resolver", config["failure"]):
        response = {"status": "SERVFAIL", "records": [], "ttl": 0}
        trace.append(build_trace_step("recursive-resolver", "client", qname, qtype, response, False, latency, 0))
        return response, trace

    entry = get_cache(qname, qtype)
    if entry:
        response = entry.value
        trace.append(
            build_trace_step(
                "recursive-resolver",
                "client",
                qname,
                qtype,
                response,
                True,
                latency,
                remaining_ttl(entry),
            )
        )
        return response, trace

    # Miss: resolver performs iterative resolution
    trace.append(
        build_trace_step(
            "recursive-resolver",
            "client",
            qname,
            qtype,
            {"status": "CACHE_MISS", "records": [], "ttl": 0},
            False,
            latency,
            0,
        )
    )

    response, steps = iterative_resolve(qname, qtype, config)
    trace.extend(steps)

    if response["status"] == "OK" and response.get("ttl", 0) > 0:
        set_cache(qname, qtype, response, response["ttl"])

    return response, trace


def build_graph(qname: str) -> dict:
    parts = qname.split(".")
    if len(parts) < 2:
        parts = [qname, "root"]
    labels = ["root"]
    for i in range(len(parts) - 1, 0, -1):
        labels.append(".".join(parts[i:]))
    labels.append(qname)

    nodes = []
    edges = []
    for label in labels:
        if label not in {n["data"]["id"] for n in nodes}:
            nodes.append({"data": {"id": label, "label": label}})

    for i in range(len(labels) - 1):
        edges.append({"data": {"id": f"{labels[i]}->{labels[i+1]}", "source": labels[i], "target": labels[i+1]}})

    return {"nodes": nodes, "edges": edges, "path": labels}


def ai_advisor(stats: dict) -> str:
    tips = []
    if stats["hit_rate"] < 0.3:
        tips.append("Cache hit rate is low; consider increasing TTLs or prewarming popular names.")
    if stats["failure_rate"] > 0:
        tips.append("Failures detected; check upstream health or reduce failure probability.")
    if stats["total_time_ms"] > 200:
        tips.append("High total latency; enable caching or reduce simulated delays.")
    if not tips:
        tips.append("System looks healthy; current settings are balanced.")
    return " ".join(tips)


@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/app.js")
def app_js():
    return send_from_directory(FRONTEND_DIR, "app.js")


@app.route("/style.css")
def style_css():
    return send_from_directory(FRONTEND_DIR, "style.css")


@app.route("/resolve", methods=["POST"])
def resolve():
    payload = request.get_json(force=True)
    qname = payload.get("domain", "www.example.com").strip().lower()
    qtype = payload.get("qtype", "A").upper()
    mode = payload.get("mode", "recursive").lower()
    scenarios = payload.get("scenarios", {})

    config = {
        "pollution": bool(scenarios.get("pollution")),
        "failure": bool(scenarios.get("failure")),
        "lb": bool(scenarios.get("lb")),
    }

    if mode == "iterative":
        response, trace = iterative_resolve(qname, qtype, config)
    else:
        response, trace = recursive_resolve(qname, qtype, config)

    total_time = sum(step["latency_ms"] for step in trace)
    cache_hits = sum(1 for step in trace if step["cache_hit"])
    cache_misses = max(1, len([step for step in trace if step["level"] == "client"])) - cache_hits
    hit_rate = cache_hits / max(1, cache_hits + cache_misses)

    failure_rate = 1 if response.get("status") in {"TIMEOUT", "SERVFAIL"} else 0

    stats = {
        "hit_rate": round(hit_rate, 2),
        "total_time_ms": total_time,
        "failure_rate": failure_rate,
    }

    graph = build_graph(qname)

    return jsonify({
        "result": response,
        "trace": trace,
        "stats": stats,
        "graph": graph,
        "ai_advice": ai_advisor(stats),
    })


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
