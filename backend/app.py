import os
from flask import Flask, jsonify, request, send_from_directory

# 导入拆分后的模块
from core.engine import DNSEngine
from analysis.stats import ai_advisor, build_graph_data

# 设置路径
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))

app = Flask(__name__)

# 初始化全局单例仿真引擎
dns_engine = DNSEngine()

@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(FRONTEND_DIR, filename)

@app.route("/resolve", methods=["POST"])
def resolve():
    """
    核心 API: 接收前端查询请求，运行仿真，返回结果
    """
    payload = request.get_json(force=True)
    
    qname = payload.get("domain", "www.example.com").strip().lower()
    qtype = payload.get("qtype", "A").upper()
    mode = payload.get("mode", "recursive").lower()
    scenarios = payload.get("scenarios", {})

    # 构建配置对象 (这里已经实现了读取开关的逻辑)
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
    cache_hits = sum(1 for step in trace if step["cache_hit"])
    cache_misses = max(1, len([step for step in trace if step["level"] == "client"])) - cache_hits
    hit_rate = cache_hits / max(1, cache_hits + cache_misses) if (cache_hits + cache_misses) > 0 else 0
    
    # --- 核心修改：判断是否为“错误”状态 ---
    status = response.get("status", "UNKNOWN")
    
    # 定义哪些状态属于“错误/异常”，需要标红
    # 包含：超时、服务失败、被污染、域名不存在
    error_statuses = {"TIMEOUT", "SERVFAIL", "POLLUTED", "NXDOMAIN"}
    is_error = status in error_statuses

    failure_rate = 1 if is_error else 0

    stats = {
        "hit_rate": round(hit_rate, 2),
        "total_time_ms": total_time,
        "failure_rate": failure_rate,
        "status": status,      # 新增：告诉前端具体状态
        "is_error": is_error   # 新增：告诉前端是否标红
    }

    # 3. 生成可视化数据和 AI 建议
    # 将 is_error 传给 build_graph_data
    graph = build_graph_data(qname, is_error)
    advice = ai_advisor(stats)

    # 4. 返回综合结果
    return jsonify({
        "result": response,
        "trace": trace,
        "stats": stats,
        "graph": graph,
        "ai_advice": advice,
        "mode": mode 
    })

if __name__ == "__main__":
    print(f"🚀 Simulation Server running at http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=True)