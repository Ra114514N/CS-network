def ai_advisor(stats: dict) -> str:
    """
    基于规则的简易 AI 顾问
    根据统计数据提供优化建议
    """
    tips = []
    
    # 优先检查明确的错误状态
    status = stats.get("status", "UNKNOWN")
    if status == "POLLUTED":
        tips.append("⚠️ 警告：检测到 DNS 污染！返回的 IP 地址可能已被篡改，建议检查防火墙规则或使用加密 DNS。")
    elif status == "TIMEOUT":
        tips.append("❌ 错误：请求超时。网络路径上的某个节点（Root/TLD/Auth）响应过慢或中断。")
    elif status == "SERVFAIL":
        tips.append("❌ 错误：服务器故障。上游 DNS 服务器无法完成解析。")
    elif status == "NXDOMAIN":
        tips.append("ℹ️ 提示：域名不存在。请检查拼写或确认域名注册状态。")

    # 分析命中率 (使用 .get 防止 key 不存在)
    elif stats.get("hit_rate", 1.0) < 0.3:
        tips.append("⚠️ 缓存命中率过低 (<30%)，建议增加 TTL 或启用预取策略。")
    
    # 分析延迟
    if stats.get("total_time_ms", 0) > 200:
        tips.append("🐢 总延迟过高 (>200ms)，建议检查网络拥塞或开启负载均衡。")
        
    # 如果没有严重问题
    if not tips:
        tips.append("✅ 系统运行健康，各项指标处于优秀水平。")
        
    return " ".join(tips)


def build_graph_data(qname: str, is_error: bool = False) -> dict:
    """
    生成前端拓扑图所需的数据结构
    参数:
    qname: 查询域名
    is_error: 是否标记为错误路径（决定颜色）
    """
    parts = qname.split(".")
    if len(parts) < 2:
        parts = [qname, "root"]
        
    labels = ["root"]
    # 构建路径：root -> com -> example.com
    for i in range(len(parts) - 1, 0, -1):
        labels.append(".".join(parts[i:]))
    labels.append(qname)

    nodes = []
    edges = []
    
    # --- 核心修改：定义红绿颜色 ---
    COLOR_SUCCESS = "#52c41a" # 绿色
    COLOR_ERROR = "#ff4d4f"   # 红色
    path_color = COLOR_ERROR if is_error else COLOR_SUCCESS
    
    # 构建节点
    for label in labels:
        if label not in {n["data"]["id"] for n in nodes}:
            nodes.append({
                "data": {
                    "id": label, 
                    "label": label,
                    "color": path_color # 传递给前端
                },
                # 强制样式，覆盖默认
                "style": { "background-color": path_color, "color": "#fff" }
            })

    # 构建连线
    for i in range(len(labels) - 1):
        edges.append({
            "data": {
                "id": f"{labels[i]}->{labels[i+1]}", 
                "source": labels[i], 
                "target": labels[i+1],
                "color": path_color # 传递给前端
            },
            # 强制样式
            "style": { "line-color": path_color, "target-arrow-color": path_color }
        })

    return {"nodes": nodes, "edges": edges, "path": labels}