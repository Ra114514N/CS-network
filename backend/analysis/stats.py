def ai_advisor(stats: dict) -> str:
    """
    基于规则的简单 AI 顾问
    根据统计数据提供优化建议
    """
    tips = []

    status = stats.get("status", "UNKNOWN")
    if status == "POLLUTED":
        tips.append("⚠️ 警告：检测到 DNS 污染！返回的 IP 地址可能已被篡改，建议检查防火墙规则或使用加密 DNS。")
    elif status == "TIMEOUT":
        tips.append("❌ 错误：请求超时。网络路径上的某个节点（Root/TLD/Auth）响应过慢或中断。")
    elif status == "SERVFAIL":
        tips.append("❌ 错误：服务器故障。上游 DNS 服务器无法完成解析。")
    elif status == "NXDOMAIN":
        tips.append("ℹ️ 提示：域名不存在。请检查拼写或确认域名注册状态。")
    elif stats.get("hit_rate", 1.0) < 0.3:
        tips.append("⚠️ 缓存命中率过低(<30%)，建议增加 TTL 或启用预取策略。")

    if stats.get("total_time_ms", 0) > 200:
        tips.append("🐢 总延迟过高(>200ms)，建议检查网络拥塞或开启负载均衡。")

    if not tips:
        tips.append("✅ 系统运行健康，各项指标处于优秀水平。")

    return " ".join(tips)
