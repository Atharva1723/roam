// Roam - frontend controller.
// Push-to-talk mic, hands-free wake word ("Hey roam"), hike telemetry, and agent queries.

document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  const btnStart = $("btn-start-hike");
  const btnText = $("btn-text");
  const pulseDot = $("pulse-dot");
  const statusLabel = $("status-label");
  const waveform = $("waveform");
  const narratorText = $("narrator-text");
  const modelTag = $("model-tag");
  const sliderElevation = $("slider-elevation");
  const valElevation = $("val-elevation");
  const valFoliage = $("val-foliage");
  const valFoliageConf = $("val-foliage-conf");
  const valFatigue = $("val-fatigue");
  const valHydration = $("val-hydration");
  const valWildlife = $("val-wildlife");
  const terminalLog = $("terminal-log");
  const btnSync = $("btn-sync");
  const promptChips = document.querySelectorAll(".chip");
  const inputQuery = $("input-query");
  const btnSendQuery = $("btn-send-query");
  const btnMic = $("btn-mic");
  const micStatus = $("mic-status");
  const btnWake = $("btn-wake");
  const wakeStatus = $("wake-status");
  const assistantNameEls = document.querySelectorAll(".assistant-name");

  let isHikeActive = false;
  let audioPlayer = null;
  let currentElevation = 1350;
  let currentIncline = 14.2;

  // ---------- Assistant identity (from server config) ----------
  let assistantName = "Roam";
  // Overwritten by GET /api/config. Elongated spellings ("roaam", "rooom") are matched by
  // wakeRegex() below, so this only needs the recognisable forms of the name.
  let wakeWords = ["roam", "rome", "rom"];

  fetch("/api/config")
    .then((r) => r.json())
    .then((cfg) => {
      if (cfg.assistantName) assistantName = cfg.assistantName;
      if (Array.isArray(cfg.wakeWords) && cfg.wakeWords.length)
        wakeWords = cfg.wakeWords.map((w) => w.toLowerCase());
      assistantNameEls.forEach((el) => (el.textContent = assistantName));
      setWakeUI(wake.enabled, wakeStatus.textContent);
    })
    .catch(() => {});

  // ---------- Logging ----------
  function appendLog(text, colorClass = "text-dim") {
    const line = document.createElement("div");
    line.className = `log-line ${colorClass}`;
    line.textContent = `> ${new Date().toLocaleTimeString()} ${text}`;
    terminalLog.appendChild(line);
    terminalLog.scrollTop = terminalLog.scrollHeight;
  }

  // ---------- Connectivity / offline indicator ----------
  const netBadge = $("net-badge");
  const modelBadge = $("model-badge");
  const offlineBanner = $("offline-banner");

  function updateConnectivity() {
    const online = navigator.onLine;
    netBadge.classList.toggle("online", online);
    netBadge.classList.toggle("offline", !online);
    netBadge.textContent = online ? "🟢 online" : "📴 offline";
    offlineBanner.hidden = online;
    if (!online) {
      appendLog("[Network] Offline. Local model, trails, planning, memory, and journal still work.", "text-amber");
    } else {
      appendLog("[Network] Online. Live weather available.", "text-dim");
    }
  }
  window.addEventListener("online", updateConnectivity);
  window.addEventListener("offline", updateConnectivity);
  updateConnectivity();

  function setModelBadge(model, usedFallback) {
    if (!modelBadge) return;
    modelBadge.textContent = usedFallback ? `model: ${model} (offline)` : `model: ${model}`;
  }

  // ---------- Speaking state (also gates the wake-word listener) ----------
  let assistantSpeaking = false;

  let speakingWatchdog = null;

  function setSpeakingState(isSpeaking, maxSeconds = 20) {
    assistantSpeaking = isSpeaking;
    // Browsers sometimes never fire "speech ended". The watchdog guarantees listening resumes.
    clearTimeout(speakingWatchdog);
    if (isSpeaking)
      speakingWatchdog = setTimeout(
        () => setSpeakingState(false),
        maxSeconds * 1000,
      );
    if (isSpeaking) {
      waveform.classList.add("active");
      pulseDot.classList.add("live");
      statusLabel.textContent = `🎙️ ${assistantName} is speaking...`;
    } else {
      waveform.classList.remove("active");
      if (isHikeActive) {
        statusLabel.textContent =
          "🌲 Hiking in progress. Listening for trail waypoints...";
      } else {
        pulseDot.classList.remove("live");
        statusLabel.textContent = "Standby. Press Start to hit the trail.";
      }
    }
    syncWakeRecognition();
  }

  function speakText(text, audioBase64) {
    const words = text.split(/\s+/).length;
    setSpeakingState(true, Math.max(4, words / 2.2 + 3));
    if (audioBase64) {
      if (audioPlayer) audioPlayer.pause();
      audioPlayer = new Audio(audioBase64);
      audioPlayer.onended = () => setSpeakingState(false);
      audioPlayer.onerror = () => fallbackBrowserSpeech(text);
      audioPlayer.play().catch(() => fallbackBrowserSpeech(text));
    } else {
      fallbackBrowserSpeech(text);
    }
  }

  function fallbackBrowserSpeech(text) {
    if (!("speechSynthesis" in window)) {
      setSpeakingState(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    utterance.onend = () => setSpeakingState(false);
    utterance.onerror = () => setSpeakingState(false);
    window.speechSynthesis.speak(utterance);
  }

  // ---------- Settings ----------
  const inputLlmBase = $("input-llm-base");
  const inputLlmKey = $("input-llm-key");
  const inputLlmModel = $("input-llm-model");
  const inputElevenKey = $("input-eleven-key");
  const btnSaveKeys = $("btn-save-keys");
  const saveKeysStatus = $("save-keys-status");

  if (inputLlmBase)
    inputLlmBase.value = localStorage.getItem("roam_llm_base") || "";
  if (inputLlmKey)
    inputLlmKey.value = localStorage.getItem("roam_llm_key") || "";
  if (inputLlmModel)
    inputLlmModel.value = localStorage.getItem("roam_llm_model") || "";
  if (inputElevenKey)
    inputElevenKey.value =
      localStorage.getItem("roam_eleven_key") || "";

  if (btnSaveKeys) {
    btnSaveKeys.addEventListener("click", () => {
      localStorage.setItem("roam_llm_base", inputLlmBase.value.trim());
      localStorage.setItem("roam_llm_key", inputLlmKey.value.trim());
      localStorage.setItem(
        "roam_llm_model",
        inputLlmModel.value.trim(),
      );
      localStorage.setItem(
        "roam_eleven_key",
        inputElevenKey.value.trim(),
      );
      saveKeysStatus.textContent = "✅ Saved in this browser.";
      setTimeout(() => (saveKeysStatus.textContent = ""), 3000);
    });
  }

  // ---------- Agent query ----------
  async function queryAgent(query = "") {
    appendLog("[Mastra-style pipeline] Dispatching observation...", "text-dim");
    appendLog(
      `[TabPFN] Running tabular prediction at ${currentElevation} m...`,
      "text-green",
    );

    try {
      const res = await fetch("/api/trail/observe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userQuery: query,
          llmBaseUrl: localStorage.getItem("roam_llm_base") || "",
          llmApiKey: localStorage.getItem("roam_llm_key") || "",
          llmModel: localStorage.getItem("roam_llm_model") || "",
          elevenLabsApiKey:
            localStorage.getItem("roam_eleven_key") || "",
          telemetry: {
            elevation_m: currentElevation,
            incline_pct: currentIncline,
            temp_c: 16.5,
            humidity_pct: 60,
            day_of_year: 280,
          },
        }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Agent query failed");

      const data = json.data;
      narratorText.textContent = `"${data.spokenText}"`;
      modelTag.textContent = data.model;
      setModelBadge(data.model, data.usedFallback);

      valFoliage.textContent = data.tabpfnMetrics.foliage_stage;
      valFoliageConf.textContent = `${Math.round((data.tabpfnMetrics.confidence || 0) * 100)}% model confidence`;
      valFatigue.textContent = `${data.tabpfnMetrics.fatigue_risk} risk`;
      valHydration.textContent = `Hydration: ${data.tabpfnMetrics.recommended_hydration_ml_hr} mL / hr`;
      valWildlife.textContent = `${Math.round(data.tabpfnMetrics.wildlife_sighting_chance * 100)}% chance`;

      appendLog(`[TabPFN] ${data.tabpfnMetrics.source}`, "text-green");
      appendLog(
        `[Latency] ${data.latencyMs} ms | LLM: ${data.usedFallback ? "offline naturalist (no model reachable)" : data.model}`,
        "text-blue",
      );
      if (data.parkAlert?.activeAdvisory)
        appendLog(
          `[Park advisory] ${data.parkAlert.activeAdvisory}`,
          "text-amber",
        );
      appendLog(`[Voice] ${data.voiceAudio.voiceName}`, "text-amber");

      speakText(data.spokenText, data.voiceAudio.audioBase64);
    } catch (err) {
      appendLog(`[Error] ${err.message}`, "text-amber");
      setSpeakingState(false);
    }
  }

  // ---------- Hike session ----------
  function greet() {
    const line = `${assistantName} is here. Say "Hey ${assistantName}" and ask anything about the trail.`;
    narratorText.textContent = `"${line}"`;
    appendLog(
      "[Session] Trail hike started. Lock the screen when you're ready; keep it awake for hands-free listening.",
      "text-green",
    );
    speakText(line, null);
  }

  function setHikeActive(active, announce = true) {
    isHikeActive = active;
    if (active) {
      btnStart.classList.add("active");
      btnText.textContent = "PAUSE TRAIL HIKE";
      pulseDot.classList.add("live");
      if (announce) greet();
    } else {
      btnStart.classList.remove("active");
      btnText.textContent = "START TRAIL HIKE (AUDIO MODE)";
      setSpeakingState(false);
      if (audioPlayer) audioPlayer.pause();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      appendLog("[Session] Trail hike paused.", "text-dim");
    }
  }

  btnStart.addEventListener("click", () => setHikeActive(!isHikeActive));

  // ---------- Typed / spoken query submission ----------
  function submitCustomQuery() {
    const q = inputQuery.value.trim();
    if (!q) return;
    if (!isHikeActive) setHikeActive(true, false); // the query itself is the announcement
    appendLog(`[Hiker] "${q}"`, "text-dim");
    queryAgent(q);
    inputQuery.value = "";
  }

  btnSendQuery.addEventListener("click", submitCustomQuery);
  inputQuery.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitCustomQuery();
  });

  // ---------- Wake word: "Hey roam" ----------
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  const wake = {
    enabled: localStorage.getItem("roam_wake") !== "off", // on by default
    blocked: false, // browser has not yet granted mic access for speech recognition
    rec: null,
    state: "idle", // "idle" = waiting for the name; "command" = name heard, capturing the question
    buffer: "",
    silenceTimer: null,
    restartTimer: null,
  };

  // One pattern per wake word, with every letter allowed to repeat the way recognisers
  // transcribe a drawn-out name ("roaam", "rooom", "roaaammm"). Longest word first, so
  // "roam" is matched as a whole instead of falling back to a shorter alternative.
  function wakePattern(word) {
    return word
      .split("")
      .map((ch) => `${ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}{1,4}`)
      .join("");
  }

  function wakeRegex() {
    const alts = wakeWords
      .filter((w) => w && typeof w === "string")
      .sort((a, b) => b.length - a.length)
      .map(wakePattern)
      .join("|");
    if (!alts) return null;
    return new RegExp(`\\b(?:(?:hey|hi|hello|ok|okay|yo)[,\\s]+)?(${alts})\\b`, "i");
  }

  function findWakeWord(text) {
    const re = wakeRegex();
    return re ? text.match(re) : null;
  }

  function setWakeUI(on, msg) {
    btnWake.classList.toggle("on", on);
    btnWake.setAttribute("aria-pressed", String(on));
    btnWake.textContent = on
      ? `👂 Listening for "Hey ${assistantName}"`
      : `👂 Hands-free: "Hey ${assistantName}"`;
    if (msg) wakeStatus.textContent = msg;
  }

  function canRunWake() {
    return (
      wake.enabled &&
      !wake.blocked &&
      !assistantSpeaking &&
      !micRecording &&
      !!SpeechRecognition
    );
  }

  function startRecognition() {
    if (!canRunWake() || wake.rec) return;
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        handleWakeResult(
          result[0].transcript.trim().toLowerCase(),
          result.isFinal,
        );
      }
    };

    rec.onstart = () => {
      if (wake.enabled && !wake.blocked)
        setWakeUI(true, `🎧 Listening for "Hey ${assistantName}"...`);
    };

    rec.onerror = (event) => {
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed"
      ) {
        // Browser needs a user gesture or permission first. Stay armed and retry on the next tap or key press.
        wake.blocked = true;
        setWakeUI(
          true,
          "🔒 Tap anywhere on this page once to start listening for roam. If nothing happens, allow the microphone for this site.",
        );
        return;
      }
      if (event.error === "audio-capture") {
        wake.blocked = true;
        setWakeUI(
          true,
          "🎙️ No microphone available. Plug one in, then tap anywhere to retry.",
        );
        return;
      }
      if (event.error !== "no-speech" && event.error !== "aborted") {
        appendLog(
          `[Wake] speech recognition error: ${event.error}`,
          "text-amber",
        );
      }
      // "no-speech" and "aborted" are normal. onend restarts the listener.
    };

    rec.onend = () => {
      wake.rec = null;
      if (canRunWake()) {
        clearTimeout(wake.restartTimer);
        wake.restartTimer = setTimeout(startRecognition, 400);
      }
    };

    try {
      rec.start();
      wake.rec = rec;
    } catch (e) {
      // The push-to-talk recogniser (or a recogniser that is still shutting down) can hold
      // the microphone. Without this retry the listener would stay silent until the next
      // state change, which read as "the wake word stopped working".
      wake.rec = null;
      if (canRunWake()) {
        clearTimeout(wake.restartTimer);
        wake.restartTimer = setTimeout(startRecognition, 700);
      }
    }
  }

  function stopRecognition() {
    clearTimeout(wake.restartTimer);
    if (!wake.rec) return;
    const rec = wake.rec;
    wake.rec = null;
    rec.onend = null;
    try {
      rec.stop();
    } catch (e) {}
  }

  function syncWakeRecognition() {
    if (canRunWake()) {
      startRecognition();
    } else {
      stopRecognition();
    }
  }

  // How long the question window stays open after the name is heard. The name opens the
  // window once; the question that follows does not need to repeat it.
  const COMMAND_WINDOW_MS = 15000;
  // Fallback for interim text the recogniser never follows with a final result.
  const PARTIAL_SILENCE_MS = 4000;
  // Furthest into a sentence the wake word can sit and still be read as an address to roam.
  const WAKE_LEAD_CHARS = 14;

  function stripLeadingPunct(s) {
    return s.replace(/^[^\w'"(]+/, "").trim();
  }

  function isFiller(s) {
    const bare = s.replace(/[^\w\s]/g, "").trim();
    return !bare || /^(?:um+|uh+|er+|ah+|oh+|hm+|hmm+|mm+|m+|eh+|ya+|ay+)$/i.test(bare);
  }

  // Hesitation words are never stored, so they cannot be submitted as a question and
  // cannot shorten the question window.
  function keepIfWords(heard) {
    return heard && !isFiller(heard) ? heard : null;
  }

  function handleWakeResult(text, isFinal) {
    if (!text) return;
    const match = findWakeWord(text);

    if (wake.state === "idle") {
      if (!match) {
        wakeStatus.textContent = `🎧 Listening. Heard: "${text.slice(-60)}"`;
        return;
      }
      wake.state = "command";
      const after = stripLeadingPunct(text.slice(match.index + match[0].length));
      wake.buffer = keepIfWords(after) || "";
      wakeStatus.textContent = wake.buffer
        ? "🟢 Ask your question."
        : `🟢 Heard "${assistantName}". Ask your question.`;
      armSilenceTimer(isFinal, Boolean(wake.buffer));
      return;
    }

    // Command state: the name was already heard, so anything said from here on is the
    // question. It does NOT have to contain the wake word again.
    let heard = text;
    if (match && match.index <= WAKE_LEAD_CHARS) {
      // The utterance opens with the name: only what follows it is the question. An
      // utterance that just repeats the name must not wipe what we already captured.
      heard = stripLeadingPunct(text.slice(match.index + match[0].length));
    }
    const contributed = keepIfWords(heard);
    if (contributed) wake.buffer = contributed;
    wakeStatus.textContent = wake.buffer
      ? `🟢 Listening: "${wake.buffer.slice(-60)}"`
      : "🟢 Listening. Ask your question.";
    armSilenceTimer(isFinal, Boolean(contributed));
  }

  function armSilenceTimer(isFinal, gotText) {
    clearTimeout(wake.silenceTimer);

    // A final result that carried new text means the utterance is complete: submit it.
    if (isFinal && gotText && wake.buffer) return finishCommand();

    // Otherwise wait. Interim text gets a short grace period for the recogniser to
    // finish the utterance (a pause mid-question must not cut the question in half),
    // and a name-only final keeps the window open rather than dropping what we hold.
    const wait = wake.buffer ? PARTIAL_SILENCE_MS : COMMAND_WINDOW_MS;
    wake.silenceTimer = setTimeout(() => {
      if (wake.buffer) finishCommand();
      else expireCommand();
    }, wait);
  }

  function expireCommand() {
    clearTimeout(wake.silenceTimer);
    wake.buffer = "";
    wake.state = "idle";
    wakeStatus.textContent = `Listening for "Hey ${assistantName}"...`;
  }

  function finishCommand() {
    clearTimeout(wake.silenceTimer);
    const question = wake.buffer.replace(/\s+/g, " ").trim();
    wake.buffer = "";
    if (!question || isFiller(question)) {
      // Nothing usable yet: stay in the command window and wait for the real question.
      wakeStatus.textContent = "🟢 Listening. Ask your question.";
      wake.silenceTimer = setTimeout(expireCommand, COMMAND_WINDOW_MS);
      return;
    }
    wake.state = "idle";
    wakeStatus.textContent = `Heard: "${question}"`;
    inputQuery.value = question;
    submitCustomQuery();
  }

  btnWake.addEventListener("click", () => {
    if (!SpeechRecognition) {
      setWakeUI(
        false,
        "Hands-free listening needs Chrome or Edge (desktop or Android). You can still use the mic button or type.",
      );
      return;
    }
    wake.enabled = !wake.enabled;
    localStorage.setItem("roam_wake", wake.enabled ? "on" : "off");
    wake.state = "idle";
    if (wake.enabled) {
      wake.blocked = false;
      setWakeUI(true, `Listening for "Hey ${assistantName}"...`);
    } else {
      clearTimeout(wake.silenceTimer);
      wake.buffer = "";
      setWakeUI(false, "Hands-free listening is paused. Tap to resume.");
    }
    syncWakeRecognition();
  });

  // ---------- Push-to-talk microphone (works in browsers without Web Speech) ----------
  let activeAudioStream = null;
  let mediaRecorder = null;
  let recordedAudioChunks = [];
  let capturedTranscript = "";
  let audioContext = null;
  let analyser = null;
  let animFrameId = null;
  let isListeningMic = false;
  let micRecording = false;
  let micRecognition = null;

  async function sendRecordedAudioForTranscription(audioBlob) {
    micStatus.style.color = "#38bdf8";
    micStatus.textContent = "⏳ Transcribing your recording...";

    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);
    reader.onloadend = async () => {
      try {
        const res = await fetch("/api/trail/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audioBase64: reader.result,
            groqApiKey: localStorage.getItem("roam_llm_key") || "",
          }),
        });
        const json = await res.json();
        if (json.success && json.text) {
          inputQuery.value = json.text;
          micStatus.innerHTML = `Heard: "<strong></strong>" <small>(${json.source})</small>`;
          micStatus.querySelector("strong").textContent = json.text;
          submitCustomQuery();
        } else {
          micStatus.style.color = "#f59e0b";
          micStatus.textContent = `⚠️ ${json.error || "No speech detected."} Type your question below.`;
        }
      } catch (err) {
        micStatus.style.color = "#ef4444";
        micStatus.textContent =
          "⚠️ Transcription request failed. Please type your question.";
      }
    };
  }

  function stopListening() {
    if (micRecognition) {
      // Release the push-to-talk recogniser so it cannot hold the microphone away from
      // the hands-free listener (its start() would otherwise make ours throw).
      const rec = micRecognition;
      micRecognition = null;
      rec.onresult = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch (e) {}
    }
    if (!isListeningMic) return;
    isListeningMic = false;
    micRecording = false;
    btnMic.classList.remove("listening");

    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (mediaRecorder && mediaRecorder.state !== "inactive")
      mediaRecorder.stop();
    if (activeAudioStream) {
      activeAudioStream.getTracks().forEach((t) => t.stop());
      activeAudioStream = null;
    }
    if (audioContext && audioContext.state !== "closed") {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    syncWakeRecognition(); // hands-free listening can resume once the mic is released
  }

  btnMic.addEventListener("click", async () => {
    if (isListeningMic) {
      micStatus.textContent = "⏹️ Processing recording...";
      stopListening();
      return;
    }

    capturedTranscript = "";
    recordedAudioChunks = [];
    micRecording = true;
    syncWakeRecognition(); // pause hands-free listening while the mic is in use

    try {
      micStatus.style.color = "#10b981";
      micStatus.textContent = "🎙️ Opening microphone...";

      activeAudioStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      mediaRecorder = new MediaRecorder(activeAudioStream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedAudioChunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        if (capturedTranscript.trim().length > 0) {
          inputQuery.value = capturedTranscript;
          submitCustomQuery();
          return;
        }
        if (recordedAudioChunks.length > 0) {
          sendRecordedAudioForTranscription(
            new Blob(recordedAudioChunks, { type: "audio/webm" }),
          );
        }
      };
      mediaRecorder.start();

      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioCtx();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        audioContext
          .createMediaStreamSource(activeAudioStream)
          .connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const checkAudioLevel = () => {
          if (!isListeningMic) return;
          analyser.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          if (avg > 8) {
            micStatus.innerHTML = `🎙️ <span style="color:#ef4444;font-weight:700;">🔴 Recording...</span> Speak now. Tap the mic to send.`;
          }
          animFrameId = requestAnimationFrame(checkAudioLevel);
        };
        animFrameId = requestAnimationFrame(checkAudioLevel);
      } catch (e) {}

      isListeningMic = true;
      btnMic.classList.add("listening");
      micStatus.innerHTML = `🎙️ <span style="color:#10b981;font-weight:700;">Listening...</span> Speak now. Tap the mic when you're done.`;

      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition();
          recognition.continuous = false;
          recognition.interimResults = true;
          recognition.lang = "en-US";
          recognition.onresult = (event) => {
            let text = "";
            for (let i = 0; i < event.results.length; ++i)
              text += event.results[i][0].transcript;
            if (text) {
              capturedTranscript = text;
              inputQuery.value = text;
              micStatus.textContent = `Heard: "${text}"`;
            }
            if (event.results[0].isFinal) stopListening();
          };
          recognition.onerror = () => {}; // MediaRecorder + server transcription takes over
          recognition.onend = () => {
            if (micRecognition === recognition) micRecognition = null;
          };
          micRecognition = recognition;
          recognition.start();
        } catch (e) {}
      }
    } catch (err) {
      micRecording = false;
      stopListening();
      micStatus.style.color = "#ef4444";
      if (
        err.name === "NotAllowedError" ||
        err.name === "PermissionDeniedError"
      ) {
        micStatus.textContent =
          "⚠️ Microphone access denied. Click the lock icon in the address bar, allow the microphone, and reload.";
      } else {
        micStatus.textContent = `⚠️ Microphone error: ${err.message}. Please type your question.`;
      }
    }
  });

  // ---------- Telemetry sliders and chips ----------
  sliderElevation.addEventListener("input", (e) => {
    currentElevation = parseInt(e.target.value, 10);
    currentIncline = Math.round((currentElevation / 150) * 10) / 10;
    valElevation.innerHTML = `${currentElevation.toLocaleString()} m <small>(${currentIncline}% incline)</small>`;
  });

  sliderElevation.addEventListener("change", () => {
    if (isHikeActive) queryAgent();
  });

  promptChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      inputQuery.value = chip.getAttribute("data-query");
      submitCustomQuery();
    });
  });

  // ---------- Roam outdoor companion ----------
  const roamInput = $("roam-input");
  const roamSend = $("roam-send");
  const roamAnswer = $("roam-answer");
  const roamText = $("roam-text");
  const roamModel = $("roam-model");
  const roamData = $("roam-data");

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  function renderAgentData(data) {
    if (!data) return "";
    if (Array.isArray(data.trails) && data.trails.length) {
      return data.trails
        .map((t) => `
          <div class="roam-card">
            <h4>${escapeHtml(t.name)}<span class="roam-sample">sample data</span></h4>
            <div class="roam-meta">
              <span class="roam-badge ${escapeHtml(t.difficulty)}">${escapeHtml(t.difficulty)}</span>
              <span>${t.distance_km} km</span>
              <span>~${t.estimated_duration_min} min</span>
              <span>${t.elevation_gain_m} m up</span>
            </div>
            <p>${escapeHtml(t.terrain)}</p>
          </div>`)
        .join("");
    }
    if (data.plan) {
      const p = data.plan;
      const list = (arr) => `<ul>${arr.map((i) => `<li>${escapeHtml(typeof i === "string" ? i : i.text)}</li>`).join("")}</ul>`;
      const caveats = p.caveats && p.caveats.length ? `<p class="roam-caveat">${escapeHtml(p.caveats.join(" "))}</p>` : "";
      const weather = p.weather ? `<div class="roam-meta">Weather: ${escapeHtml(p.weather.summary)}</div>` : "";
      return `
        <div class="roam-card">
          <h4>${escapeHtml(p.trailName)}</h4>
          <div class="roam-meta"><span>${p.estimatedStart} → ${p.estimatedFinish}</span><span>~${p.estimatedDurationMin} min</span></div>
          ${weather}
          <p><strong>Water:</strong> ${escapeHtml(p.waterAdvice)}</p>
          <p><strong>Clothing:</strong> ${escapeHtml(p.clothingAdvice)}</p>
          <p><strong>Checklist:</strong></p>${list(p.checklist)}
          <p><strong>Safety:</strong></p>${list(p.safetyReminders)}
          ${caveats}
        </div>`;
    }
    if (data.weather) {
      const w = data.weather;
      if (!w.available) return `<div class="roam-card"><p>${escapeHtml(w.unavailableReason || "Weather unavailable.")}</p></div>`;
      return `<div class="roam-card"><h4>${escapeHtml(w.locationLabel)}</h4><p>${escapeHtml(w.summary)}</p></div>`;
    }
    if (data.saved) {
      return `<div class="roam-card"><p>Saved as <strong>${escapeHtml(data.saved.kind)}</strong> (${escapeHtml(data.backing)} storage).</p></div>`;
    }
    if (data.session) {
      return `<div class="roam-card"><p>Session <strong>${escapeHtml(data.session.sessionId)}</strong> — ${escapeHtml(data.session.state)} (${escapeHtml(data.session.type)}).</p></div>`;
    }
    return "";
  }

  async function askRoam(message) {
    const q = (message ?? roamInput.value).trim();
    if (!q) return;
    roamAnswer.hidden = false;
    roamText.textContent = "Thinking…";
    roamData.innerHTML = "";
    roamModel.textContent = "";
    appendLog(`[Roam] "${q}"`, "text-dim");
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: q,
          llmBaseUrl: localStorage.getItem("roam_llm_base") || "",
          llmApiKey: localStorage.getItem("roam_llm_key") || "",
          llmModel: localStorage.getItem("roam_llm_model") || "",
          elevenLabsApiKey: localStorage.getItem("roam_eleven_key") || "",
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Roam couldn't answer.");
      const d = json.data;
      roamText.textContent = `"${d.spokenText}"`;
      roamModel.textContent = d.usedFallback ? `${d.model} (offline fallback)` : d.model;
      setModelBadge(d.model, d.usedFallback);
      roamData.innerHTML = renderAgentData(d.data);
      speakText(d.spokenText, d.data?.voiceAudio?.audioBase64);
      loadMemory();
      loadJournal();
    } catch (err) {
      roamText.textContent = `Sorry — ${err.message}`;
      appendLog(`[Roam] ${err.message}`, "text-amber");
    }
  }

  roamSend.addEventListener("click", () => askRoam());
  roamInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") askRoam();
  });
  document.querySelectorAll(".roam-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      roamInput.value = chip.getAttribute("data-q");
      askRoam();
    });
  });

  // ---------- Durable sync (currently a local stub; see docs) ----------
  btnSync.addEventListener("click", async () => {
    appendLog("[Sync] Saving a checkpoint...", "text-blue");
    try {
      const res = await fetch("/api/trail/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkpoints: [
            {
              checkpointId: `cp-${Date.now()}`,
              timestamp: new Date().toISOString(),
              elevation_m: currentElevation,
              coordinates: { lat: 38.52, lng: -78.43 },
              observationNotes: `Waypoint at ${currentElevation} m`,
            },
          ],
        }),
      });
      const json = await res.json();
      if (json.success) {
        appendLog(
          `[Sync] ${json.data.engine} ${json.data.workflowId}: ${json.data.checkpointsSynced} checkpoint(s) recorded`,
          "text-green",
        );
      } else {
        appendLog(`[Sync] ${json.error}`, "text-amber");
      }
    } catch (err) {
      appendLog(`[Sync] Error: ${err.message}`, "text-amber");
    }
  });

  // ---------- Roam side panels: trails, memory, journal, device ----------
  async function loadTrails() {
    const list = $("trails-list");
    const src = $("trails-source");
    try {
      const res = await fetch("/api/trails/search?limit=10&quiet=true");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      src.textContent = json.data.providerAvailable
        ? `${json.data.totalMatches} sample ${json.data.totalMatches === 1 ? "trail" : "trails"} · not live data`
        : "Trail dataset unavailable.";
      list.innerHTML = json.data.trails.length
        ? json.data.trails
            .map(
              (t) => `
              <div class="roam-row">
                <div class="roam-row-body">
                  <div class="roam-row-title">
                    <strong>${escapeHtml(t.name)}</strong>
                    <span class="roam-badge ${escapeHtml(t.difficulty)}">${escapeHtml(t.difficulty)}</span>
                  </div>
                  <div class="roam-row-sub">${t.distance_km} km · ~${t.estimated_duration_min} min · ${t.elevation_gain_m} m up · ${escapeHtml(t.location.areaName)}</div>
                </div>
                <button data-save-trail="${escapeHtml(t.id)}">Save</button>
              </div>`,
            )
            .join("")
        : `<div class="roam-empty">No trails in the dataset.</div>`;
      list.querySelectorAll("[data-save-trail]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const t = json.data.trails.find((x) => x.id === btn.getAttribute("data-save-trail"));
          await fetch("/api/memory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "saved_trail", text: `Saved trail: ${t.name}`, data: { trailId: t.id } }),
          });
          appendLog(`[Roam] Saved trail ${t.name}`, "text-green");
          loadMemory();
        });
      });
    } catch (err) {
      src.textContent = "Could not load trails.";
      list.innerHTML = `<div class="roam-empty">${escapeHtml(err.message)}</div>`;
    }
  }

  async function loadMemory() {
    const list = $("memory-list");
    try {
      const res = await fetch("/api/memory");
      const json = await res.json();
      const records = json.data?.records || [];
      list.innerHTML = records.length
        ? records
            .map(
              (r) => `
              <div class="roam-row">
                <div class="roam-row-body">
                  <div class="roam-row-title">
                    <strong>${escapeHtml(r.text)}</strong>
                    <span class="roam-badge">${escapeHtml(r.kind)}</span>
                  </div>
                  <div class="roam-row-sub">${escapeHtml(new Date(r.createdAt).toLocaleString())}</div>
                </div>
                <button class="danger" data-del="${r.id}">Delete</button>
              </div>`,
            )
            .join("")
        : `<div class="roam-empty">Nothing saved yet. Tell roam to remember something.</div>`;
      list.querySelectorAll("[data-del]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await fetch(`/api/memory/${btn.getAttribute("data-del")}`, { method: "DELETE" });
          loadMemory();
        });
      });
    } catch {
      list.innerHTML = `<div class="roam-empty">Could not load memory.</div>`;
    }
  }

  async function loadJournal() {
    const list = $("journal-list");
    try {
      const res = await fetch("/api/journal");
      const json = await res.json();
      const entries = json.data?.entries || [];
      list.innerHTML = entries.length
        ? entries
            .map(
              (e) => `
              <div class="roam-row">
                <div class="roam-row-body">
                  ${escapeHtml(e.text)}
                  <div class="roam-row-sub">${escapeHtml(new Date(e.createdAt).toLocaleString())}</div>
                </div>
              </div>`,
            )
            .join("")
        : `<div class="roam-empty">No observations yet. Say "note that I saw…"</div>`;
    } catch {
      list.innerHTML = `<div class="roam-empty">Could not load journal.</div>`;
    }
  }

  async function loadDevice() {
    const box = $("device-status");
    const model = $("device-model");
    try {
      const res = await fetch("/api/device");
      const json = await res.json();
      const s = json.data.status;
      model.innerHTML = s.simulated
        ? `Simulated device (no hardware connected)<span class="roam-badge sim">simulation</span>`
        : escapeHtml(s.model);
      box.innerHTML = `
        <div class="roam-row"><div class="roam-row-body">
          <strong>${escapeHtml(s.deviceId)}</strong>
          <div class="roam-row-sub">Indicator: ${escapeHtml(s.indicator)} · Listening: ${s.listening} · Session: ${s.sessionActive}</div>
        </div></div>`;
    } catch {
      model.textContent = "Could not reach device service.";
    }
  }

  document.querySelectorAll(".roam-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".roam-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      ["trails", "memory", "journal", "device"].forEach((name) => {
        $("panel-" + name).hidden = name !== tab.getAttribute("data-tab");
      });
      if (tab.getAttribute("data-tab") === "device") loadDevice();
    });
  });

  $("trails-refresh").addEventListener("click", loadTrails);
  $("memory-clear").addEventListener("click", async () => {
    await fetch("/api/memory", { method: "DELETE" });
    loadMemory();
  });
  $("journal-clear").addEventListener("click", async () => {
    await fetch("/api/journal", { method: "DELETE" });
    loadJournal();
  });

  loadTrails();
  loadMemory();
  loadJournal();

  if (!SpeechRecognition) {
    setWakeUI(
      false,
      "Hands-free listening needs Chrome or Edge. The mic button and typing still work here.",
    );
  } else {
    // Start listening on load. If the browser needs a gesture first, the next tap or key press starts it.
    const unlockWake = () => {
      if (!wake.enabled) return;
      wake.blocked = false;
      syncWakeRecognition();
    };
    document.addEventListener("pointerdown", unlockWake, { passive: true });
    document.addEventListener("keydown", unlockWake);
    if (wake.enabled) {
      setWakeUI(true, `Listening for "Hey ${assistantName}"...`);
      syncWakeRecognition();
    } else {
      setWakeUI(false, "Hands-free listening is paused. Tap to resume.");
    }
  }
});
