# AI DNS 解析仿真

本项目模拟 DNS 解析过程，支持递归/迭代模式、缓存 TTL、故障与污染模拟、负载均衡，并在前端以图形化方式展示解析路径与统计信息。后端为 Flask，前端为原生 HTML/JS + Cytoscape.js。

## 一键运行

```bash
pip install -r requirements.txt
python backend/app.py
```

浏览器打开：http://127.0.0.1:5000

如需直接打开静态文件，可使用 `frontend/index.html`，但部分浏览器会阻止 `file://` 请求。

## 功能要点

- 递归/迭代两种解析模式
- 内置 Root/TLD/Auth 简化 zone 数据（A/AAAA/CNAME/NS/DNAME）
- TTL 缓存与命中统计
- 故障/污染/负载均衡场景开关
- Trace 步骤列表、统计面板与 AI 建议
- 解析结果按记录类型展示（A/AAAA/CNAME/NS/DNAME）

## 示例域名

- `www.example.com`：A/AAAA
- `api.example.com`：A/AAAA
- `alias.example.com`：CNAME -> `www.example.com`
- `mail.example.com`：CNAME -> `www.example.com`
- `dev.example.com`：NS
- `legacy.example.com`：DNAME -> `example.com`
