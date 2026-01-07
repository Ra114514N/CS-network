import math
from typing import Dict, List

ERROR_STATUSES = {"TIMEOUT", "SERVFAIL", "POLLUTED", "NXDOMAIN"}


def _sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x))


def _safe_avg(values: List[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def predict_future_risk(stats_list: List[Dict]) -> Dict:
    """
    使用轻量逻辑回归风格的打分来估计未来失败率/污染概率。
    传入值：最近 N 次 resolve 的 stats（含 hit_rate/total_time_ms/failure_rate/status）。
    返回：预测概率 + 轨迹数据，便于前端可视化。
    """
    if not stats_list:
        # 基线假设：无历史数据时给一个保守的低概率基线
        return {
            "predicted_failure_rate": 0.05,
            "predicted_pollution_rate": 0.02,
            "basis": "暂无历史数据，使用基线假设",
            "trend": {"failure_rates": [], "pollution_flags": [], "hit_rates": [], "statuses": []},
        }

    statuses = [s.get("status", "UNKNOWN") for s in stats_list]
    failure_rates = [s.get("failure_rate", 0.0) for s in stats_list]
    hit_rates = [s.get("hit_rate", 0.0) for s in stats_list]
    latencies = [s.get("total_time_ms", 0.0) for s in stats_list]

    error_ratio = sum(1 for st in statuses if st in ERROR_STATUSES) / len(statuses)
    pollution_ratio = sum(1 for st in statuses if st == "POLLUTED") / len(statuses)
    timeout_ratio = sum(1 for st in statuses if st in {"TIMEOUT", "SERVFAIL"}) / len(statuses)
    avg_hit_rate = _safe_avg(hit_rates)
    avg_latency_norm = min(_safe_avg(latencies) / 300.0, 3)  # 归一化，防止极端值过大

    # 简易逻辑回归式打分
    failure_score = (
        -2.0
        + 3.2 * error_ratio
        + 2.2 * (1 - avg_hit_rate)
        + 1.4 * avg_latency_norm
        + 1.6 * timeout_ratio
        + 1.0 * pollution_ratio
    )
    pollution_score = -3.0 + 4.2 * pollution_ratio + 1.8 * error_ratio + 0.8 * (1 - avg_hit_rate)

    predicted_failure = round(_sigmoid(failure_score), 3)
    predicted_pollution = round(_sigmoid(pollution_score), 3)

    # 提供趋势数据，前端可做折线/条带
    trend = {
        "failure_rates": failure_rates,
        "pollution_flags": [1 if st == "POLLUTED" else 0 for st in statuses],
        "hit_rates": hit_rates,
        "statuses": statuses,
    }

    basis = (
        f"error_ratio={error_ratio:.2f}, pollution_ratio={pollution_ratio:.2f}, "
        f"avg_hit_rate={avg_hit_rate:.2f}, avg_latency_norm={avg_latency_norm:.2f}"
    )

    return {
        "predicted_failure_rate": predicted_failure,
        "predicted_pollution_rate": predicted_pollution,
        "basis": basis,
        "trend": trend,
    }
