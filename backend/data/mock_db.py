# 模拟的区域文件 (Zone Files)
# 这里模拟了从 Root -> TLD -> Authoritative 的层级结构
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
            # 模拟负载均衡记录
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

# 污染规则配置：用于模拟 DNS 污染攻击
POLLUTION_MAP = {
    "www.example.com": {"type": "A", "value": "1.2.3.4"},  # 将正常域名指向恶意IP
    "bad.example.com": {"type": "NXDOMAIN"},               # 强制返回域名不存在
}

# 故障概率配置：用于模拟服务器宕机或网络不稳定
FAILURE_PROBS = {
    "root": 0.15,
    "tld": 0.10,
    "auth": 0.20,
    "recursive-resolver": 0.05,
}