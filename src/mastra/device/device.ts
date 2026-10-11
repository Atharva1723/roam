/**
 * Roam - IoT device abstraction.
 *
 * A device interface with a simulated implementation so development needs no hardware.
 * The simulation exposes the same shape as a real ESP32/Arduino adapter would. Every
 * incoming command is validated against an allowlist; unknown commands are rejected and
 * no arbitrary shell/URL/device instruction is ever executed. The UI labels simulated
 * results so a physical device is never claimed when none is connected.
 */

export type IndicatorState = "idle" | "listening" | "processing" | "speaking" | "error";

export interface DeviceStatus {
  deviceId: string;
  connected: boolean;
  simulated: boolean;
  indicator: IndicatorState;
  listening: boolean;
  sessionActive: boolean;
  /** Firmware/model label, or "simulator" for the simulated device. */
  model: string;
  lastHeardAt: string | null;
}

/** Commands the device will accept. Anything outside this list is rejected. */
export const ALLOWED_COMMANDS = [
  "start_listening",
  "stop_listening",
  "speak",
  "set_indicator",
  "start_session",
  "end_session",
] as const;
export type DeviceCommand = (typeof ALLOWED_COMMANDS)[number];

export interface DeviceCommandResult {
  ok: boolean;
  acknowledged: boolean;
  message: string;
  status: DeviceStatus;
}

export interface IoTDevice {
  readonly status: DeviceStatus;
  getStatus(): DeviceStatus;
  startListening(): DeviceCommandResult;
  stopListening(): DeviceCommandResult;
  speak(text: string): DeviceCommandResult;
  setIndicator(state: IndicatorState): DeviceCommandResult;
  startSession(): DeviceCommandResult;
  endSession(): DeviceCommandResult;
  command(cmd: string, args?: Record<string, unknown>): DeviceCommandResult;
}

function isCommand(cmd: string): cmd is DeviceCommand {
  return (ALLOWED_COMMANDS as readonly string[]).includes(cmd);
}

export class SimulatedDevice implements IoTDevice {
  private _status: DeviceStatus;

  constructor(deviceId = "sim-device-01") {
    this._status = {
      deviceId,
      connected: true,
      simulated: true,
      indicator: "idle",
      listening: false,
      sessionActive: false,
      model: "simulator (no physical hardware)",
      lastHeardAt: null,
    };
  }

  get status(): DeviceStatus {
    return { ...this._status };
  }

  getStatus(): DeviceStatus {
    return this.status;
  }

  private ok(message: string): DeviceCommandResult {
    return { ok: true, acknowledged: true, message, status: this.status };
  }

  private reject(message: string): DeviceCommandResult {
    this._status.indicator = "error";
    return { ok: false, acknowledged: false, message, status: this.status };
  }

  startListening(): DeviceCommandResult {
    this._status.listening = true;
    this._status.indicator = "listening";
    return this.ok("Simulated device is now listening.");
  }

  stopListening(): DeviceCommandResult {
    this._status.listening = false;
    this._status.indicator = "idle";
    return this.ok("Simulated device stopped listening.");
  }

  speak(text: string): DeviceCommandResult {
    const clean = String(text ?? "").slice(0, 500);
    if (!clean.trim()) return this.reject("Nothing to speak.");
    this._status.indicator = "speaking";
    // A real device would play audio here; the simulator just records the state change.
    return this.ok(`Simulated device would say: "${clean}"`);
  }

  setIndicator(state: IndicatorState): DeviceCommandResult {
    const valid: IndicatorState[] = ["idle", "listening", "processing", "speaking", "error"];
    if (!valid.includes(state)) return this.reject(`Unknown indicator state "${state}".`);
    this._status.indicator = state;
    return this.ok(`Simulated indicator set to ${state}.`);
  }

  startSession(): DeviceCommandResult {
    this._status.sessionActive = true;
    return this.ok("Simulated session started.");
  }

  endSession(): DeviceCommandResult {
    this._status.sessionActive = false;
    this._status.listening = false;
    this._status.indicator = "idle";
    return this.ok("Simulated session ended.");
  }

  command(cmd: string, args: Record<string, unknown> = {}): DeviceCommandResult {
    if (!isCommand(cmd)) {
      return this.reject(`Command "${cmd}" is not on the allowlist.`);
    }
    switch (cmd) {
      case "start_listening":
        return this.startListening();
      case "stop_listening":
        return this.stopListening();
      case "speak":
        return this.speak(typeof args.text === "string" ? args.text : "");
      case "set_indicator":
        return this.setIndicator((args.state as IndicatorState) ?? "idle");
      case "start_session":
        return this.startSession();
      case "end_session":
        return this.endSession();
    }
  }
}

export const device = new SimulatedDevice();
