import textwrap
from typing import Dict, List, Optional, Tuple

from openai import OpenAI

from analysis.stats import ai_advisor as rule_based_advice

# SiliconFlow 配置：请在此直接填写 API Key。
AI_API_KEY = ""
AI_BASE_URL = "https://api.siliconflow.cn/v1"
# 模型按照示例使用 deepseek-ai/DeepSeek-V3
AI_MODEL = "deepseek-ai/DeepSeek-V3.2"


def _render_trace(trace: List[Dict], limit: int = 6) -> str:
    """Summarize the trace list into compact lines for the prompt."""
    if not trace:
        return "无可用的追踪步骤。"

    lines = []
    for idx, step in enumerate(trace[:limit]):
        resp = step.get("response", {})
        status = resp if isinstance(resp, str) else resp.get("status", "UNKNOWN")
        line = (
            f"{idx + 1}. {step.get('level')}@{step.get('server')}: "
            f"{step.get('qname')} {step.get('qtype')} -> {status}, "
            f"latency={step.get('latency_ms')}ms, cache={step.get('cache_hit')}"
        )
        lines.append(line)

    if len(trace) > limit:
        lines.append(f"... 还有 {len(trace) - limit} 条追踪记录未展开。")

    return "\n".join(lines)


def _build_prompt(
    domain: str,
    qtype: str,
    mode: str,
    scenarios: Dict,
    stats: Dict,
    result: Dict,
    trace: List[Dict],
    question: str,
) -> str:
    """Create a concise prompt describing the DNS query."""
    scenario_flags = ", ".join([key for key, val in scenarios.items() if val]) or "无"
    records = result.get("records") or []
    record_text = ", ".join(records) if records else "无返回记录"

    base_prompt = f"""
你是一名 DNS 分析助手，请结合查询上下文给出简要诊断和优化建议。
- 域名: {domain}
- 记录类型: {qtype}
- 模式: {mode}
- 启用的特殊场景: {scenario_flags}
- 结果状态: {result.get("status", "UNKNOWN")}
- 返回记录: {record_text}
- 统计: 命中率={stats.get("hit_rate")}, 总耗时={stats.get("total_time_ms")}ms, 失败率={stats.get("failure_rate")}
- Trace 路径:
{_render_trace(trace)}

请用中文简洁回答，重点指出可能的原因和建议。用户的问题是: {question}
"""
    return textwrap.dedent(base_prompt).strip()


def _get_client() -> OpenAI:
    """
    Create OpenAI SDK client pointing to SiliconFlow OpenAI-compatible endpoint.
    """
    return OpenAI(
        base_url=AI_BASE_URL,
        api_key=AI_API_KEY,
    )


def _call_ai(prompt: str) -> Tuple[Optional[str], Optional[str]]:
    """Call the SiliconFlow chat model via OpenAI SDK; return (text, error)."""
    if not AI_API_KEY:
        return None, "AI_API_KEY 未配置，请填写真实密钥。"
    if not AI_BASE_URL:
        return None, "AI_BASE_URL 未配置，请填写 SiliconFlow 的 base_url（如 https://api.siliconflow.cn/v1）。"

    try:
        client = _get_client()

        # 非流式：保持你原有的同步返回逻辑
        resp = client.chat.completions.create(
            model=AI_MODEL,
            messages=[
                {"role": "system", "content": "You are a concise DNS and networking troubleshooting assistant."},
                {"role": "user", "content": prompt},
            ],
            stream=False,
            max_tokens=1024,
            temperature=0.3,
            top_p=0.7,
            # 注意：OpenAI 标准参数里没有 top_k，这个字段是否被 SiliconFlow 接受取决于其兼容实现；
            # 若 SiliconFlow 支持额外字段，通常需要走 extra_body（见下方注释）。
            frequency_penalty=0.1,
            # response_format 在新 SDK/不同后端兼容性不一；若报错可移除
            response_format={"type": "text"},
            # 如果 SiliconFlow 需要 top_k 等扩展参数，可用 extra_body 透传：
            # extra_body={"top_k": 50},
        )

        message = (resp.choices[0].message.content or "").strip()
        if not message:
            return None, "AI 响应为空。"
        return message, None

    except Exception as exc:  # noqa: BLE001
        return None, str(exc)


# （可选）如果你以后想支持流式输出，可加一个函数：
def _call_ai_stream(prompt: str):
    """
    Yield incremental text chunks (content + reasoning_content if provided by backend).
    用法：for piece in _call_ai_stream(prompt): print(piece, end="")
    """
    client = _get_client()
    stream = client.chat.completions.create(
        model=AI_MODEL,
        messages=[
            {"role": "system", "content": "You are a concise DNS and networking troubleshooting assistant."},
            {"role": "user", "content": prompt},
        ],
        stream=True,
        max_tokens=1024,
        temperature=0.3,
        top_p=0.7,
        frequency_penalty=0.1,
        # extra_body={"top_k": 50},
    )

    for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        # content
        if getattr(delta, "content", None):
            yield delta.content
        # 一些后端（如你示例）会给 reasoning_content
        if getattr(delta, "reasoning_content", None):
            yield delta.reasoning_content


def generate_ai_feedback(
    domain: str,
    qtype: str,
    mode: str,
    scenarios: Dict,
    stats: Dict,
    result: Dict,
    trace: List[Dict],
    question: Optional[str] = None,
) -> Dict[str, str]:
    """
    Generate AI feedback using an external LLM when available.
    Falls back to the built-in rule-based advisor if AI is unavailable.
    """
    prompt = _build_prompt(domain, qtype, mode, scenarios, stats, result, trace, question or "请给出简要建议。")
    ai_text, error = _call_ai(prompt)

    if ai_text:
        return {"text": ai_text, "source": "ai"}

    fallback = rule_based_advice(stats)
    suffix = f"（已使用内置建议，因为 AI 服务不可用：{error}）" if error else ""
    return {"text": f"{fallback} {suffix}".strip(), "source": "fallback"}
