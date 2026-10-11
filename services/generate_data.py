import csv
import random
import math

def generate_trail_dataset(filename="data/trail_telemetry.csv", num_rows=400):
    headers = [
        "elevation_m",
        "incline_pct",
        "temp_c",
        "humidity_pct",
        "day_of_year",
        "pace_min_km",
        "foliage_stage",
        "fatigue_risk",
        "wildlife_prob",
        "hydration_ml_hr"
    ]

    stages = ["Early Green", "Turning", "Peak Color", "Past Peak"]
    fatigue_levels = ["Low", "Moderate", "High", "Severe"]

    random.seed(42)
    rows = []

    for _ in range(num_rows):
        elevation = round(random.uniform(400, 3200), 1)
        incline = round(random.uniform(1.0, 28.0), 1)
        temp = round(random.uniform(3.0, 32.0), 1)
        humidity = round(random.uniform(20.0, 95.0), 1)
        day_of_year = random.randint(1, 365) # Fall peak is typically days 260 - 300 (mid-Sept to late-Oct)
        pace = round(random.uniform(8.0, 22.0), 1)

        # Fall Foliage physics simulation: Peak is late Sept/Oct (day 265-295), higher elevations turn earlier
        foliage_peak_day = 280 - (elevation / 1000.0) * 12
        day_diff = abs(day_of_year - foliage_peak_day)
        if day_diff < 10:
            foliage = "Peak Color"
        elif day_diff < 22:
            foliage = "Turning"
        elif day_of_year > foliage_peak_day:
            foliage = "Past Peak"
        else:
            foliage = "Early Green"

        # Fatigue & Hydration physics: Higher temp + high incline + elevation -> higher fatigue
        fatigue_score = (incline * 1.8) + (temp * 1.2) + (elevation / 400.0) + (pace * 0.5)
        if fatigue_score < 40:
            fatigue = "Low"
            hydration = round(350 + temp * 10, 0)
        elif fatigue_score < 65:
            fatigue = "Moderate"
            hydration = round(500 + temp * 15, 0)
        elif fatigue_score < 90:
            fatigue = "High"
            hydration = round(750 + temp * 20, 0)
        else:
            fatigue = "Severe"
            hydration = round(1000 + temp * 25, 0)

        # Wildlife probability: Higher at dawn/dusk, higher elevations, moderate weather
        wildlife = round(min(0.95, max(0.05, 0.25 + (elevation / 5000.0) + (0.3 if humidity > 70 else 0.0) - (temp / 100.0))), 2)

        rows.append([
            elevation,
            incline,
            temp,
            humidity,
            day_of_year,
            pace,
            foliage,
            fatigue,
            wildlife,
            int(hydration)
        ])

    with open(filename, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)

    print(f"Generated {num_rows} trail telemetry samples into {filename}")

if __name__ == "__main__":
    generate_trail_dataset()
