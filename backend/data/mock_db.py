# 模拟的区域文件 (Zone Files)
# 这里模拟了从 Root -> TLD -> Authoritative 的层级结构
ZONE_DATA = {
    "root": {
        "NS": {
            "com": {"records": ["a.gtld-servers.net"], "ttl": 300},
            "cn": {"records": ["a.dns.cn"], "ttl": 300}
        },
    },
    "cn": {
        "NS": {
            "edu.cn": {"records": ["ns1.edu.cn"], "ttl": 300}
        },
    },
    "edu.cn": {
        "NS": {
            "guet.edu.cn": {"records": ["ns1.guet.edu.cn"], "ttl": 300}
        },
    },
    "com": {
        "NS": {"example.com": {"records": ["ns1.example.com"], "ttl": 300}},
    },
    "example.com": {
        "NS": {"example.com": {"records": ["ns1.example.com"], "ttl": 300}},
        "A": {
            "www.example.com": {"records": ["93.184.216.34"], "ttl": 120},
            "api.example.com": {"records": ["93.184.216.35"], "ttl": 120},
            # 模拟负载均衡记录
            "www-lb.example.com": {"records": ["203.0.113.10", "203.0.113.11", "203.0.113.12"], "ttl": 30},
        },
        "AAAA": {
            "www.example.com": {"records": ["2606:2800:220:1:248:1893:25c8:1946"], "ttl": 120},
            "api.example.com": {"records": ["2606:2800:220:1:248:1893:25c8:1947"], "ttl": 120},
        },
        "CNAME": {
            "alias.example.com": {"records": ["www.example.com"], "ttl": 120},
            "mail.example.com": {"records": ["www.example.com"], "ttl": 180},
        },
    },
    "guet.edu.cn": {
        "NS": {
            "guet.edu.cn": {"records": ["ns1.guet.edu.cn"], "ttl": 300}
        },
        "A": {
            "www.guet.edu.cn": {"records": ["202.193.64.75"], "ttl": 120}
        },
        "AAAA": {
            "www.guet.edu.cn": {"records": ["2001:da8:20c:1000:824c:91ff:fe9c:795c"], "ttl": 120}
        },
        "CNAME": {
            "mail.guet.edu.cn": {"records": ["www.guet.edu.cn"], "ttl": 180},
            "ftp.guet.edu.cn": {"records": ["www.guet.edu.cn"], "ttl": 120}
        }
    },
}

# 污染规则配置：用于模拟 DNS 污染攻击
POLLUTION_MAP = {
    "www.example.com": {"type": "A", "value": "1.2.3.4"},  # 将正常域名指向恶意IP
    "www.guet.edu.cn": {"type": "A", "value": "1.2.3.5"},  # 将正常域名指向恶意IP
    "bad.example.com": {"type": "NXDOMAIN"},               # 强制返回域名不存在
}

# 故障概率配置：用于模拟服务器宕机或网络不稳定
FAILURE_PROBS = {
    "root": 0.5,
    "tld": 0.5,
    "auth": 0.5,
    "recursive-resolver": 0.05,
}
