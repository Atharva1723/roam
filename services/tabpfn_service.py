"""
Roam - TabPFN tabular predictor for trail telemetry.

Engine selection (reported in the `engine` and `source` fields of the output):
  1. "tabpfn"    Prior Labs TabPFN, if the `tabpfn` package is installed and its weights load.
                 TabPFN is an in-context tabular foundation model. "Fitting" stores the training
                 rows and prediction is a forward pass, so no per-dataset hyperparameter tuning.
  2. "sklearn"   scikit-learn ensemble, if TabPFN is not installed.
  3. "heuristic" no training data available.

Training data: data/trail_telemetry.csv is SYNTHETIC. services/generate_data.py produces it from
hand-written rules, so predictions reproduce those rules. Replace the CSV with real observations
(elevation, slope, temperature, and labels recorded by hikers) before trusting the outputs.
"""

import argparse
import json
import os
import sys

import numpy as np
import pandas as pd
from sklearn.preprocessing import LabelEncoder

CSV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "trail_telemetry.csv")
FEATURES = ["elevation_m", "incline_pct", "temp_c", "humidity_pct", "day_of_year", "pace_min_km"]
TRAINING_DATA_NOTE = "synthetic (services/generate_data.py)"


def _load_tabpfn_class():
    try:
        from tabpfn import TabPFNClassifier  # noqa: WPS433 (optional heavy dependency)
        return TabPFNClassifier
    except Exception:
        return None


class _FittedClassifier:
    """Wraps any sklearn-style classifier with label encoding for string classes."""

    def __init__(self, estimator, label_encoder):
        self.estimator = estimator
        self.le = label_encoder

    def predict(self, X):
        return self.le.inverse_transform(self.estimator.predict(X))

    def top_probability(self, X):
        return float(np.max(self.estimator.predict_proba(X)))


def _fit(factory, X, y):
    le = LabelEncoder().fit(y)
    estimator = factory()
    estimator.fit(X, le.transform(y))
    return _FittedClassifier(estimator, le)


class TrailPredictor:
    def __init__(self, csv_path=CSV_PATH):
        self.csv_path = csv_path
        self.engine = "heuristic"
        self.foliage_model = None
        self.fatigue_model = None
        self._fit_models()

    def _fit_models(self):
        if not os.path.exists(self.csv_path):
            return

        df = pd.read_csv(self.csv_path)
        X = df[FEATURES]

        TabPFN = _load_tabpfn_class()
        if TabPFN is not None:
            try:
                factory = lambda: TabPFN(device="cpu")  # noqa: E731
                self.foliage_model = _fit(factory, X, df["foliage_stage"])
                self.fatigue_model = _fit(factory, X, df["fatigue_risk"])
                self.engine = "tabpfn"
                return
            except Exception as exc:  # weights missing, no network, unsupported platform, etc.
                print(f"[tabpfn] TabPFN unavailable ({exc}); using scikit-learn.", file=sys.stderr)

        try:
            from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier

            self.foliage_model = _fit(lambda: RandomForestClassifier(n_estimators=60, random_state=42), X, df["foliage_stage"])
            self.fatigue_model = _fit(lambda: GradientBoostingClassifier(n_estimators=50, random_state=42), X, df["fatigue_risk"])
            self.engine = "sklearn"
        except Exception as exc:
            print(f"[sklearn] fit failed ({exc}); using heuristic.", file=sys.stderr)
            self.foliage_model = None
            self.fatigue_model = None

    def predict(self, elevation_m, incline_pct, temp_c, humidity_pct, day_of_year, pace_min_km):
        hydration = int(350 + temp_c * 15 + incline_pct * 14)  # heuristic, not learned
        wildlife = round(
            min(0.9, max(0.08, 0.22 + (elevation_m / 4500.0) + (0.2 if humidity_pct > 65 else 0.0) - (temp_c / 120.0))),
            2,
        )

        if self.foliage_model is not None and self.fatigue_model is not None:
            sample = pd.DataFrame([[elevation_m, incline_pct, temp_c, humidity_pct, day_of_year, pace_min_km]], columns=FEATURES)
            source = {
                "tabpfn": "Prior Labs TabPFN (in-context, CPU)",
                "sklearn": "scikit-learn ensemble (TabPFN not installed)",
            }[self.engine]
            return {
                "source": source,
                "engine": self.engine,
                "training_data": TRAINING_DATA_NOTE,
                "foliage_stage": str(self.foliage_model.predict(sample)[0]),
                "confidence": round(self.foliage_model.top_probability(sample), 2),
                "fatigue_risk": str(self.fatigue_model.predict(sample)[0]),
                "recommended_hydration_ml_hr": hydration,
                "wildlife_sighting_chance": wildlife,
                "elevation_m": elevation_m,
                "incline_pct": incline_pct,
                "temp_c": temp_c,
            }

        peak_day = 280 - (elevation_m / 1000.0) * 12
        near_peak = abs(day_of_year - peak_day) < 12
        return {
            "source": "Heuristic (no training data loaded)",
            "engine": "heuristic",
            "training_data": "none",
            "foliage_stage": "Peak Color" if near_peak else "Turning",
            "confidence": 0.5,
            "fatigue_risk": "High" if incline_pct > 15 else "Moderate",
            "recommended_hydration_ml_hr": hydration,
            "wildlife_sighting_chance": wildlife,
            "elevation_m": elevation_m,
            "incline_pct": incline_pct,
            "temp_c": temp_c,
        }


# Module-level instance: loaded once per process. The CLI below fits again on each call.
predictor = TrailPredictor()


def main():
    parser = argparse.ArgumentParser(description="Roam TabPFN prediction (CLI)")
    parser.add_argument("--elevation", type=float, default=1350.0)
    parser.add_argument("--incline", type=float, default=14.0)
    parser.add_argument("--temp", type=float, default=17.0)
    parser.add_argument("--humidity", type=float, default=60.0)
    parser.add_argument("--day", type=int, default=279)
    parser.add_argument("--pace", type=float, default=12.0)
    args = parser.parse_args()
    result = predictor.predict(args.elevation, args.incline, args.temp, args.humidity, args.day, args.pace)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
