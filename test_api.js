async function testApi() {
  try {
    const res = await fetch("http://localhost:3000/api/trail/observe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userQuery: "What bird is that singing in the oaks?",
        telemetry: {
          elevation_m: 1450,
          incline_pct: 15.0,
          temp_c: 17.0,
          humidity_pct: 62,
          day_of_year: 279
        }
      })
    });
    const json = await res.json();
    console.log("=== API RESPONSE ===");
    console.log(JSON.stringify(json, null, 2));

    const syncRes = await fetch("http://localhost:3000/api/trail/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checkpoints: [
          {
            checkpointId: "cp-test-1",
            timestamp: new Date().toISOString(),
            elevation_m: 1450,
            coordinates: { lat: 38.5, lng: -78.4 },
            observationNotes: "Test checkpoint sync"
          }
        ]
      })
    });
    const syncJson = await syncRes.json();
    console.log("=== DURABLE SYNC RESPONSE ===");
    console.log(JSON.stringify(syncJson, null, 2));
  } catch (err) {
    console.error("Test failed:", err);
  }
}

testApi();
