# AI DNS Simulation

This project simulates DNS resolution with recursive/iterative modes, caching, faults, pollution, and load balancing. It uses Flask for the backend and a pure HTML/JS frontend with Cytoscape.js.

## One-click run

```bash
pip install -r requirements.txt
python backend/app.py
```

Then open: http://127.0.0.1:5000

If you prefer opening the static file directly, use `frontend/index.html` but note that some browsers block fetch calls from file URLs.
