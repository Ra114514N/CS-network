import time
import random
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

# 引入数据配置
from data.mock_db import ZONE_DATA, POLLUTION_MAP, FAILURE_PROBS

@dataclass
class CacheEntry:
    value: dict
    expire_time: float
    ttl: int

class DNSEngine:
    def __init__(self):
        # 分离缓存：防止递归查询的结果污染迭代查询的演示
        self.client_cache: Dict[str, CacheEntry] = {}    # 迭代模式：模拟客户端本地缓存
        self.resolver_cache: Dict[str, CacheEntry] = {}  # 递归模式：模拟递归服务器缓存
        
        # 负载均衡状态记录
        self.lb_state: Dict[str, int] = {}

    def _now_ts(self) -> float:
        return time.time()

    def _cache_key(self, qname: str, qtype: str) -> str:
        return f"{qname}|{qtype}"

    def get_cache(self, cache_type: str, qname: str, qtype: str) -> Optional[CacheEntry]:
        """获取缓存，支持指定 cache_type ('client' or 'resolver')"""
        target_cache = self.client_cache if cache_type == 'client' else self.resolver_cache
        key = self._cache_key(qname, qtype)
        entry = target_cache.get(key)
        
        if not entry:
            return None
        if entry.expire_time <= self._now_ts():
            target_cache.pop(key, None)
            return None
        return entry

    def set_cache(self, cache_type: str, qname: str, qtype: str, value: dict, ttl: int) -> None:
        """设置缓存"""
        target_cache = self.client_cache if cache_type == 'client' else self.resolver_cache
        target_cache[self._cache_key(qname, qtype)] = CacheEntry(
            value=value,
            expire_time=self._now_ts() + ttl,
            ttl=ttl,
        )

    def _remaining_ttl(self, entry: CacheEntry) -> int:
        return max(0, int(entry.expire_time - self._now_ts()))

    def _simulated_latency_ms(self, unstable: bool = False) -> int:
        if unstable:
            return random.randint(10, 60)
        return 30

    def _maybe_fail(self, server: str, enabled: bool) -> bool:
        if not enabled:
            return False
        prob = FAILURE_PROBS.get(server, 0.0)
        return random.random() < prob

    def _apply_pollution(self, qname: str, qtype: str, enabled: bool, response: dict) -> dict:
        if not enabled:
            return response
        rule = POLLUTION_MAP.get(qname)
        if not rule:
            return response
        if rule["type"] == "NXDOMAIN":
            return {"status": "POLLUTED", "records": [], "ttl": 0, "original_status": "NXDOMAIN"}
        if rule["type"] == qtype:
            return {"status": "POLLUTED", "records": [rule["value"]], "ttl": 30}
        return response

    def _lb_pick(self, qname: str, records: List[str]) -> str:
        idx = self.lb_state.get(qname, 0) % len(records)
        self.lb_state[qname] = idx + 1
        return records[idx]

    def _build_trace_step(self, server: str, level: str, qname: str, qtype: str, 
                         response: dict, cache_hit: bool, latency_ms: int, ttl_remaining: int) -> dict:
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

    def _resolve_authoritative(self, qname: str, qtype: str, use_lb: bool) -> dict:
        zone = ZONE_DATA.get("example.com", {})
        qtype_data = zone.get(qtype, {})
        record = qtype_data.get(qname)
        
        if not record:
            return {"status": "NXDOMAIN", "records": [], "ttl": 0}

        records = record["records"]
        ttl = record["ttl"]

        if use_lb and len(records) > 1:
            picked = self._lb_pick(qname, records)
            return {"status": "OK", "records": [picked], "ttl": ttl}
            
        return {"status": "OK", "records": records, "ttl": ttl}

    def _core_resolve(self, qname: str, qtype: str, config: dict) -> Tuple[dict, List[dict]]:
        """
        核心解析逻辑（不包含缓存检查）
        负责 Root -> TLD -> Auth 的遍历过程
        """
        trace: List[dict] = []
        unstable_net = config["failure"]

        # 1. 查询根服务器
        latency = self._simulated_latency_ms(unstable_net)
        if self._maybe_fail("root", config["failure"]):
            response = {"status": "TIMEOUT", "records": [], "ttl": 0}
            trace.append(self._build_trace_step("root-server", "root", qname, qtype, response, False, latency, 0))
            return response, trace

        root_response = {"status": "OK", "records": ["a.gtld-servers.net"], "ttl": 300}
        trace.append(self._build_trace_step("root-server", "root", qname, qtype, root_response, False, latency, 300))

        # 2. 查询 TLD
        latency = self._simulated_latency_ms(unstable_net)
        if self._maybe_fail("tld", config["failure"]):
            response = {"status": "SERVFAIL", "records": [], "ttl": 0}
            trace.append(self._build_trace_step("a.gtld-servers.net", "tld", qname, qtype, response, False, latency, 0))
            return response, trace

        tld_response = {"status": "OK", "records": ["ns1.example.com"], "ttl": 300}
        trace.append(self._build_trace_step("a.gtld-servers.net", "tld", qname, qtype, tld_response, False, latency, 300))

        # 3. 查询权威服务器
        latency = self._simulated_latency_ms(unstable_net)
        if self._maybe_fail("auth", config["failure"]):
            response = {"status": "SERVFAIL", "records": [], "ttl": 0}
            trace.append(self._build_trace_step("ns1.example.com", "auth", qname, qtype, response, False, latency, 0))
            return response, trace

        response = self._resolve_authoritative(qname, qtype, config["lb"])
        response = self._apply_pollution(qname, qtype, config["pollution"], response)
        
        trace.append(self._build_trace_step("ns1.example.com", "auth", qname, qtype, response, False, latency, response.get("ttl", 0)))
        return response, trace

    def iterative_resolve(self, qname: str, qtype: str, config: dict) -> Tuple[dict, List[dict]]:
        """迭代查询逻辑 (模拟客户端 -> 本地服务器 -> 互联网)"""
        trace: List[dict] = []
        unstable_net = config["failure"]
        latency = self._simulated_latency_ms(unstable_net)
        
        # 1. 客户端 -> 本地服务器
        local_server_response = {"status": "OK", "records": [], "ttl": 0, "cache_hit": False}
        trace.append(self._build_trace_step("local-server", "client", qname, qtype, local_server_response, 
                                          False, latency, 0))

        # 2. 检查本地服务器 Cache
        should_skip_cache = config["pollution"] or config["failure"] or config["lb"]
        cache_hit = False
        if not should_skip_cache:
            entry = self.get_cache('client', qname, qtype)
            if entry:
                cache_hit = True
                # 缓存命中，添加cache相关的trace步骤
                step = self._build_trace_step("local-cache", "local", qname, qtype, entry.value, 
                                            True, 1, self._remaining_ttl(entry))
                trace.append(step)
                response = entry.value
            
        if not cache_hit:
            # 3. 本地服务器执行核心解析 (Root -> TLD -> Auth)
            response, steps = self._core_resolve(qname, qtype, config)
            # 修改步骤的level为local，表明这些步骤是本地服务器执行的
            for step in steps:
                step["level"] = "local"
                step["server"] = f"local->{step['server']}"
            # 添加这些步骤到trace中，以便前端根据cache_hit状态决定是否显示
            trace.extend(steps)

            # 4. 写入本地服务器 Cache
            if response["status"] == "OK" and response.get("ttl", 0) > 0:
                self.set_cache('client', qname, qtype, response, response["ttl"])

        # 5. 本地服务器 -> 客户端
        local_response = response.copy()
        local_response["cache_hit"] = cache_hit
        trace.append(self._build_trace_step("local-server", "client", qname, qtype, local_response, 
                                          False, latency, response.get("ttl", 0)))

        return response, trace

    def recursive_resolve(self, qname: str, qtype: str, config: dict) -> Tuple[dict, List[dict]]:
        """递归查询逻辑 (模拟客户端 -> 递归服务器 -> 互联网)"""
        trace: List[dict] = []
        unstable_net = config["failure"]
        latency = self._simulated_latency_ms(unstable_net)

        # 1. 模拟连接递归服务器可能失败
        if self._maybe_fail("recursive-resolver", config["failure"]):
            response = {"status": "SERVFAIL", "records": [], "ttl": 0}
            trace.append(self._build_trace_step("recursive-resolver", "client", qname, qtype, response, False, latency, 0))
            return response, trace

        # 2. 检查 Resolver Cache
        should_skip_cache = config["pollution"] or config["failure"] or config["lb"]
        if not should_skip_cache:
            entry = self.get_cache('resolver', qname, qtype)
            if entry:
                response = entry.value
                trace.append(self._build_trace_step("recursive-resolver", "client", qname, qtype, response, 
                                                  True, latency, self._remaining_ttl(entry)))
                return response, trace

        trace.append(self._build_trace_step("recursive-resolver", "client", qname, qtype, 
                                          {"status": "CACHE_MISS", "records": [], "ttl": 0}, False, latency, 0))

        # 3. 递归服务器执行核心解析 (Root -> TLD -> Auth)
        response, steps = self._core_resolve(qname, qtype, config)
        trace.extend(steps)

        # 4. 写入 Resolver Cache
        if response["status"] == "OK" and response.get("ttl", 0) > 0:
            self.set_cache('resolver', qname, qtype, response, response["ttl"])

        return response, trace