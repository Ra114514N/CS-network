def ai_advisor(stats: dict) -> str:
    """
    基于规则的简易 AI 顾问
    根据统计数据提供优化建议
    """
    tips = []
    
    # 分析命中率
    if stats["hit_rate"] < 0.3:
        tips.append("⚠️ 缓存命中率过低 (Cache Hit Rate < 30%)，建议增加 TTL 或启用预取策略。")
    
    # 分析故障率
    if stats["failure_rate"] > 0:
        tips.append("❌ 检测到网络故障，请检查上游服务器健康状态。")
    
    # 分析延迟
    if stats["total_time_ms"] > 200:
        tips.append("🐢 总延迟过高 (>200ms)，建议检查网络拥塞或开启负载均衡。")
        
    # 如果一切正常
    if not tips:
        tips.append("✅ 系统运行健康，各项指标处于优秀水平。")
        
    return " ".join(tips)


def build_graph_data(qname: str) -> dict:
    """
    生成前端拓扑图所需的数据结构
    根据查询域名构建层级关系，例如：root -> com -> example.com
    """
    parts = qname.split(".")
    # 简单的容错处理
    if len(parts) < 2:
        parts = [qname, "root"]
        
    labels = ["root"]
    # 从后往前构建完整域名路径
    # 例如 www.example.com -> [root, com, example.com, www.example.com]
    for i in range(len(parts) - 1, 0, -1):
        labels.append(".".join(parts[i:]))
    labels.append(qname)

    nodes = []
    edges = []
    
    # 构建节点列表
    for label in labels:
        # 避免重复添加节点
        if label not in {n["data"]["id"] for n in nodes}:
            nodes.append({"data": {"id": label, "label": label}})

    # 构建连线列表 (Source -> Target)
    for i in range(len(labels) - 1):
        edges.append({
            "data": {
                "id": f"{labels[i]}->{labels[i+1]}", 
                "source": labels[i], 
                "target": labels[i+1]
            }
        })

    return {"nodes": nodes, "edges": edges, "path": labels}