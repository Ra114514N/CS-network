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
        # 内存缓存
        self.cache: Dict[str, CacheEntry] = {}
        # 负载均衡状态记录：用于轮询算法 (Round Robin)
        self.lb_state: Dict[str, int] = {}

    def _now_ts(self) -> float:
        return time.time()

    def _cache_key(self, qname: str, qtype: str) -> str:
        return f"{qname}|{qtype}"

    def get_cache(self, qname: str, qtype: str) -> Optional[CacheEntry]:
        """获取缓存"""
        key = self._cache_key(qname, qtype)
        entry = self.cache.get(key)
        if not entry:
            return None
        if entry.expire_time <= self._now_ts():
            self.cache.pop(key, None)
            return None
        return entry

    def set_cache(self, qname: str, qtype: str, value: dict, ttl: int) -> None:
        """设置缓存"""
        self.cache[self._cache_key(qname, qtype)] = CacheEntry(
            value=value,
            expire_time=self._now_ts() + ttl,
            ttl=ttl,
        )

    def _remaining_ttl(self, entry: CacheEntry) -> int:
        return max(0, int(entry.expire_time - self._now_ts()))

    def _simulated_latency_ms(self, unstable: bool = False) -> int:
        """
        模拟网络延迟
        - 如果 unstable 为 True (开启故障开关): 返回 10-60ms 的随机波动
        - 如果 unstable 为 False (默认): 返回固定的 30ms
        """
        if unstable:
            return random.randint(10, 60)
        return 30

    def _maybe_fail(self, server: str, enabled: bool) -> bool:
        """模拟服务器故障"""
        if not enabled:
            return False
        
        # 读取 mock_db 中的概率配置
        prob = FAILURE_PROBS.get(server, 0.0)
        return random.random() < prob

    def _apply_pollution(self, qname: str, qtype: str, enabled: bool, response: dict) -> dict:
        """应用 DNS 污染规则"""
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
        """
        简单的轮询负载均衡算法 (Round Robin)
        每次请求时，索引 +1，从而返回列表中的下一个 IP
        """
        idx = self.lb_state.get(qname, 0) % len(records)
        self.lb_state[qname] = idx + 1
        return records[idx]

    def _build_trace_step(self, server: str, level: str, qname: str, qtype: str, 
                         response: dict, cache_hit: bool, latency_ms: int, ttl_remaining: int) -> dict:
        """构建单步追踪日志"""
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
        """模拟权威服务器查询"""
        zone = ZONE_DATA.get("example.com", {})
        qtype_data = zone.get(qtype, {})
        record = qtype_data.get(qname)
        
        if not record:
            return {"status": "NXDOMAIN", "records": [], "ttl": 0}

        records = record["records"]
        ttl = record["ttl"]

        # [逻辑] 仅当开启了 LB 开关 且 记录数大于1 时才进行负载均衡
        if use_lb and len(records) > 1:
            picked = self._lb_pick(qname, records)
            return {"status": "OK", "records": [picked], "ttl": ttl}
            
        # 否则返回所有记录
        return {"status": "OK", "records": records, "ttl": ttl}

    def iterative_resolve(self, qname: str, qtype: str, config: dict) -> Tuple[dict, List[dict]]:
        """迭代查询逻辑"""
        trace: List[dict] = []
        unstable_net = config["failure"]

        # 1. 检查本地缓存
        # 【修改点】如果开启了污染、故障或负载均衡，强制跳过缓存读取，确保演示效果
        # 加入 config["lb"] 是为了让你多次点击解析时能立刻看到 IP 在变
        should_skip_cache = config["pollution"] or config["failure"] or config["lb"]
        
        if not should_skip_cache:
            entry = self.get_cache(qname, qtype)
            if entry:
                step = self._build_trace_step("cache", "client", qname, qtype, entry.value, 
                                            True, 1, self._remaining_ttl(entry))
                trace.append(step)
                return entry.value, trace

        # 2. 查询根服务器
        latency = self._simulated_latency_ms(unstable_net)
        if self._maybe_fail("root", config["failure"]):
            response = {"status": "TIMEOUT", "records": [], "ttl": 0}
            trace.append(self._build_trace_step("root-server", "root", qname, qtype, response, False, latency, 0))
            return response, trace

        root_response = {"status": "OK", "records": ["a.gtld-servers.net"], "ttl": 300}
        trace.append(self._build_trace_step("root-server", "root", qname, qtype, root_response, False, latency, 300))

        # 3. 查询 TLD
        latency = self._simulated_latency_ms(unstable_net)
        if self._maybe_fail("tld", config["failure"]):
            response = {"status": "SERVFAIL", "records": [], "ttl": 0}
            trace.append(self._build_trace_step("a.gtld-servers.net", "tld", qname, qtype, response, False, latency, 0))
            return response, trace

        tld_response = {"status": "OK", "records": ["ns1.example.com"], "ttl": 300}
        trace.append(self._build_trace_step("a.gtld-servers.net", "tld", qname, qtype, tld_response, False, latency, 300))

        # 4. 查询权威服务器
        latency = self._simulated_latency_ms(unstable_net)
        if self._maybe_fail("auth", config["failure"]):
            response = {"status": "SERVFAIL", "records": [], "ttl": 0}
            trace.append(self._build_trace_step("ns1.example.com", "auth", qname, qtype, response, False, latency, 0))
            return response, trace

        # 传入 config["lb"] 开关
        response = self._resolve_authoritative(qname, qtype, config["lb"])
        
        # 应用污染
        response = self._apply_pollution(qname, qtype, config["pollution"], response)
        
        trace.append(self._build_trace_step("ns1.example.com", "auth", qname, qtype, response, False, latency, response.get("ttl", 0)))

        # 写入缓存
        if response["status"] in ["OK", "POLLUTED"] and response.get("ttl", 0) > 0:
            self.set_cache(qname, qtype, response, response["ttl"])

        return response, trace

    def recursive_resolve(self, qname: str, qtype: str, config: dict) -> Tuple[dict, List[dict]]:
        """递归查询逻辑"""
        trace: List[dict] = []
        unstable_net = config["failure"]
        latency = self._simulated_latency_ms(unstable_net)

        # 模拟递归服务器故障
        if self._maybe_fail("recursive-resolver", config["failure"]):
            response = {"status": "SERVFAIL", "records": [], "ttl": 0}
            trace.append(self._build_trace_step("recursive-resolver", "client", qname, qtype, response, False, latency, 0))
            return response, trace

        # 检查递归服务器缓存
        # 【修改点】同样应用跳过逻辑
        should_skip_cache = config["pollution"] or config["failure"] or config["lb"]
        
        if not should_skip_cache:
            entry = self.get_cache(qname, qtype)
            if entry:
                response = entry.value
                trace.append(self._build_trace_step("recursive-resolver", "client", qname, qtype, response, 
                                                  True, latency, self._remaining_ttl(entry)))
                return response, trace

        trace.append(self._build_trace_step("recursive-resolver", "client", qname, qtype, 
                                          {"status": "CACHE_MISS", "records": [], "ttl": 0}, False, latency, 0))

        # 调用迭代逻辑
        response, steps = self.iterative_resolve(qname, qtype, config)
        trace.extend(steps)

        # 递归服务器写入缓存
        if response["status"] in ["OK", "POLLUTED"] and response.get("ttl", 0) > 0:
            self.set_cache(qname, qtype, response, response["ttl"])

        return response, trace