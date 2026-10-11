"""
Roam - persistent TabPFN prediction service.

Loads the model once and serves predictions over HTTP, which avoids the per-request
startup cost of the CLI path. Point the Node server at it with TABPFN_SERVICE_URL.

Run locally:   uvicorn tabpfn_api:app --app-dir services --port 8001
Then set:      TABPFN_SERVICE_URL=http://localhost:8001
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from tabpfn_service import predictor  # noqa: E402

app = FastAPI(title="Roam TabPFN service", version="1.1.0")


class Telemetry(BaseModel):
    elevation_m: float = Field(ge=0, le=9000)
    incline_pct: float = Field(ge=0, le=60)
    temp_c: float = Field(ge=-40, le=50)
    humidity_pct: float = Field(default=60.0, ge=0, le=100)
    day_of_year: int = Field(default=279, ge=1, le=366)
    pace_min_km: float = Field(default=12.0, ge=1, le=60)


@app.get("/health")
def health():
    return {"status": "ok", "engine": predictor.engine}


@app.post("/predict")
def predict(t: Telemetry):
    return predictor.predict(
        t.elevation_m, t.incline_pct, t.temp_c, t.humidity_pct, t.day_of_year, t.pace_min_km
    )
