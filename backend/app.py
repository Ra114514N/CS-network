import os
from flask import Flask, jsonify, request, send_from_directory

# 导入拆分后的模块
from core.engine import DNSEngine
from analysis.stats import ai_advisor, build_graph_data

# 设置路径：当前文件的上一级目录的 frontend 文件夹
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))

app = Flask(__name__)

# 初始化全局单例仿真引擎
# 这样保证了多次请求之间 Cache 和 LoadBalancer 状态是共享的
dns_engine = DNSEngine()

@app.route("/")
def index():
    """服务主页"""
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.route("/<path:filename>")
def static_files(filename):
    """服务静态资源 (js, css, images)"""
    return send_from_directory(FRONTEND_DIR, filename)

@app.route("/resolve", methods=["POST"])
def resolve():
    """
    核心 API: 接收前端查询请求，运行仿真，返回结果
    """
    # 强制解析 JSON，即使 Content-Type 没设置对
    payload = request.get_json(force=True)
    
    # 提取参数，设置默认值
    qname = payload.get("domain", "www.example.com").strip().lower()
    qtype = payload.get("qtype", "A").upper()
    mode = payload.get("mode", "recursive").lower()
    scenarios = payload.get("scenarios", {})

    # 构建配置对象
    config = {
        "pollution": bool(scenarios.get("pollution")),
        "failure": bool(scenarios.get("failure")),
        "lb": bool(scenarios.get("lb")),
    }

    # 1. 调用仿真引擎
    if mode == "iterative":
        response, trace = dns_engine.iterative_resolve(qname, qtype, config)
    else:
        response, trace = dns_engine.recursive_resolve(qname, qtype, config)

    # 2. 计算统计指标
    total_time = sum(step["latency_ms"] for step in trace)
    # 计算缓存命中次数
    cache_hits = sum(1 for step in trace if step["cache_hit"])
    # 简单估算 Miss 次数 (这里逻辑可根据需求细化)
    # 如果是 Client 发起的且没命中缓存，就算一次 Miss
    cache_misses = max(1, len([step for step in trace if step["level"] == "client"])) - cache_hits
    hit_rate = cache_hits / max(1, cache_hits + cache_misses)
    
    failure_rate = 1 if response.get("status") in {"TIMEOUT", "SERVFAIL"} else 0

    stats = {
        "hit_rate": round(hit_rate, 2),
        "total_time_ms": total_time,
        "failure_rate": failure_rate,
    }

    # 3. 生成可视化数据和 AI 建议
    graph = build_graph_data(qname)
    advice = ai_advisor(stats)

    # 4. 返回综合结果
    return jsonify({
        "result": response,
        "trace": trace,
        "stats": stats,
        "graph": graph,
        "ai_advice": advice,
    })

if __name__ == "__main__":
    print(f"🚀 Simulation Server running at http://127.0.0.1:5000")
    print(f"📂 Serving Frontend from: {FRONTEND_DIR}")
    app.run(host="127.0.0.1", port=5000, debug=True)