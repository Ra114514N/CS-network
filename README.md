# AI DNS 解析仿真

前后端一体的 DNS 解析可视化模拟器，支持递归/迭代查询、TTL 缓存、故障/污染/负载均衡场景、RPZ（安全 DNS 策略区）拦截，以及基于最近统计的 AI 风险预测。

## 快速开始
```bash
pip install -r requirements.txt
python backend/app.py
# 浏览器访问 http://127.0.0.1:5000
```
也可直接打开 `frontend/index.html`（部分浏览器可能拦截 file:// 请求）。

## 主要功能
- 解析模式：递归 / 迭代，两套缓存（resolver / client）与 TTL 展示
- 场景模拟：故障概率、污染、负载均衡（轮询 A/AAAA 列表）
- 可视化：Cytoscape 绘制查询路径，动画展示报文往返，解析日志与统计面板
- AI 诊断：/ai/analyze 调用 LLM（或规则回退）给出优化/排障建议
- AI 风险预测：/ai/predict 基于最近统计估算未来失败率、污染概率，并在前端展示趋势
- RPZ 策略区：先查黑名单，命中即阻断或重写到拦截页，并在日志/图上突出“命中 RPZ 规则…原因：xxx”

## 示例域名
- 正常：`www.example.com` (A/AAAA), `api.example.com` (A/AAAA), `alias.example.com` (CNAME -> www), `mail.example.com` (CNAME -> www), `dev.example.com` (NS), `legacy.example.com` (DNAME -> example.com)
- GUET 示例：`www.guet.edu.cn` (A/AAAA)，默认输入
- RPZ 拦截示例（虚拟域名）：
  - `malware.guet.edu.cn` → NXDOMAIN，原因：校园恶意阻断
  - `track.guet.edu.cn` → CNAME 重写到告警页，原因：可疑跟踪
  - `bad.com` → NXDOMAIN
  - `ads.com` → CNAME 重写到 blockpage

## 触发 RPZ
在前端输入上述 RPZ 示例域名（记录类型随意 A/AAAA/CNAME/NS），点击“开始解析”。日志会显示“命中 RPZ 规则…动作…原因…”，图中会出现“RPZ 策略”节点并高亮。

## 前后端结构
- 后端 Flask：`backend/app.py`
  - `/resolve`：调用 `core/engine.py` 执行递归/迭代解析，返回 result/trace/stats
  - `/ai/analyze`：结合最近查询上下文调用 LLM（或规则回退）
  - `/ai/predict`：基于最近 N 条 stats 进行风险预测
- 核心引擎：`backend/core/engine.py`
  - TTL 双缓存、故障/污染/负载均衡、RPZ 策略检查（`backend/data/policy_rules.json`）
  - trace 记录延迟/命中/剩余 TTL 供前端展示
- 数据配置：`backend/data/mock_db.py`（zone 数据、污染、故障概率），`backend/data/policy_rules.json`（RPZ 黑名单）
- 前端：`frontend/index.html` + `frontend/app.js` + `frontend/style.css`
  - 控制面板、解析路径动画、日志/统计面板、AI 建议与风险预测卡片

## 常见操作
- 修改默认域名：`frontend/index.html` 中 `#domain` 默认值
- 添加/调整 RPZ 规则：编辑 `backend/data/policy_rules.json`（action=NXDOMAIN 或 CNAME, target, reason, ttl）
- 调整故障/污染概率：`backend/data/mock_db.py` 中 `POLLUTION_MAP`、`FAILURE_PROBS`
- 更换 AI Key：`backend/analysis/ai_client.py` 的 `AI_API_KEY`

## 依赖
- Flask 3.x
- openai 2.x

