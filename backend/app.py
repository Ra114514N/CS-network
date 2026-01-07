import os
from collections import deque
from flask import Flask, jsonify, request, send_from_directory
from core.engine import DNSEngine
from analysis.ai_client import generate_ai_feedback
from analysis.risk_predictor import predict_future_risk

# 设置路径
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path='')

# 初始化全局单例仿真引擎
dns_engine = DNSEngine()

# 记录最近的统计步驟，用于预测
STATS_HISTORY = deque(maxlen=200)


@app.route("/")
def index():
    """返回主页"""
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path):
    """处理所有静态文件，包括 JS、CSS 等"""
    try:
        return send_from_directory(FRONTEND_DIR, path)
    except Exception as e:
        print(f"Error serving file {path}: {e}")
        return f"File not found: {path}", 404


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
    cache_hits = sum(1 for step in trace if step["cache_hit"])
    cache_misses = max(1, len([step for step in trace if step["level"] == "client"])) - cache_hits
    hit_rate = cache_hits / max(1, cache_hits + cache_misses) if (cache_hits + cache_misses) > 0 else 0

    # 判断是否为"错误"状态
    status = response.get("status", "UNKNOWN")
    error_statuses = {"TIMEOUT", "SERVFAIL", "POLLUTED", "NXDOMAIN"}
    is_error = status in error_statuses
    failure_rate = 1 if is_error else 0

    stats = {
        "hit_rate": round(hit_rate, 2),
        "total_time_ms": total_time,
        "failure_rate": failure_rate,
        "status": status,
        "is_error": is_error
    }

    # 记录历史，供 AI 风险预测使用
    STATS_HISTORY.append({
        "stats": stats,
        "domain": qname,
        "qtype": qtype,
        "mode": mode,
        "scenarios": scenarios,
    })

    # 3. 返回综合结果，AI 仅在单独接口触发
    return jsonify({
        "result": response,
        "trace": trace,
        "stats": stats,
        "mode": mode
    })


@app.route("/ai/analyze", methods=["POST"])
def ai_analyze():
    """
    接收前端提问，结合最近一次查询的上下文调 AI。
    """
    payload = request.get_json(force=True) or {}
    qname = payload.get("domain", "").strip().lower()
    qtype = payload.get("qtype", "A").upper()
    mode = payload.get("mode", "recursive")
    scenarios = payload.get("scenarios", {}) or {}
    stats = payload.get("stats", {}) or {}
    result = payload.get("result", {}) or {}
    trace = payload.get("trace", []) or []
    question = payload.get("question") or "请结合当前查询信息给出简要建议。"

    advice = generate_ai_feedback(
        domain=qname,
        qtype=qtype,
        mode=mode,
        scenarios=scenarios,
        stats=stats,
        result=result,
        trace=trace,
        question=question,
    )

    return jsonify(advice)


@app.route("/ai/predict", methods=["GET"])
def ai_predict():
    """
    基于最近 N 次统计数据预测未来失败率/污染概率。
    如无历史数据，则返回基线预测。
    """
    try:
        n = int(request.args.get("n", 12))
    except Exception:
        n = 12
    recent = list(STATS_HISTORY)[-n:]
    stats_list = [item["stats"] for item in recent]
    prediction = predict_future_risk(stats_list)

    return jsonify({
        "prediction": prediction,
        "recent": recent
    })


@app.after_request
def add_header(response):
    """添加响应头，确保正确的 MIME 类型"""
    if request.path.endswith('.js'):
        response.headers['Content-Type'] = 'application/javascript'
    elif request.path.endswith('.css'):
        response.headers['Content-Type'] = 'text/css'
    return response


if __name__ == "__main__":
    print(f"Frontend directory: {FRONTEND_DIR}")
    print(f"Simulation Server running at http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=True)
