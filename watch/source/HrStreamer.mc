import Toybox.Application;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Sensor;
import Toybox.System;
import Toybox.Time;
import Toybox.Time.Gregorian;
import Toybox.Timer;
import Toybox.WatchUi;

// ---------------------------------------------------------------------------
// HrStreamer — heart-rate acquisition, send-gating, and network POST loop.
//
// Backend contract (already shipped):
//   POST {backendUrl}/api/integrations/watch/hr
//   Authorization: Bearer whr_<token>
//   body: { heartRate: 30..230, activityType: int, ts: ISO8601 }
//   Responses: 202 ok · 400 bad HR · 401 token · 409 no session · 429 limited
//   Rate limit: 5 req / 60s → min ~12s interval.
//   Backend only regenerates playlist on first reading or ≥ 25 bpm change.
// ---------------------------------------------------------------------------
class HrStreamer {

    // ---- Tuning ------------------------------------------------------------
    private const SEND_INTERVAL_MS as Number = 13 * 1000;   // > 12s floor
    private const HR_DELTA_BPM     as Number = 8;           // local gate
    private const LIVENESS_MS      as Number = 45 * 1000;   // force ping
    private const BACKOFF_MS       as Number = 65 * 1000;   // post-429 quiet

    // ---- Config (phone settings) -------------------------------------------
    private var _backendUrl as String = "";
    private var _token      as String = "";

    // ---- Runtime state (read by View) --------------------------------------
    private var _timer       as Timer.Timer?;
    private var _running     as Boolean = false;
    private var _currentHr   as Number?;
    private var _peakHr      as Number?;  // highest HR seen since last send
    private var _lastSentHr  as Number?;
    private var _lastSentAt  as Number = 0;     // System.getTimer() ms
    private var _backoffUntil as Number = 0;    // back off after 429
    private var _inFlight    as Boolean = false;
    private var _statusText  as String = "Idle";

    // ---- Init --------------------------------------------------------------
    function initialize() {
        reloadConfig();
    }

    function reloadConfig() as Void {
        var url = Application.Properties.getValue("backendUrl");
        var tok = Application.Properties.getValue("watchToken");
        _backendUrl = (url instanceof String) ? url as String : "";
        _token      = (tok instanceof String) ? tok as String : "";
    }

    // ---- View accessors ----------------------------------------------------
    function isRunning()     as Boolean { return _running; }
    function getCurrentHr()  as Number? { return _currentHr; }
    function getStatusText() as String  { return _statusText; }

    // ---- Control -----------------------------------------------------------
    function toggle() as Void {
        if (_running) { stop(); } else { start(); }
    }

    function start() as Void {
        if (_running) { return; }
        if (_token.equals("") || _backendUrl.equals("")) {
            _statusText = "Set token in phone app";
            WatchUi.requestUpdate();
            return;
        }

        Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE]);
        Sensor.enableSensorEvents(method(:onSensor));

        _currentHr = 120;   // seed so first tick fires; real sensor overwrites
        _backoffUntil = 0;
        _running = true;
        _statusText = "Streaming…";

        _timer = new Timer.Timer();
        _timer.start(method(:onTick), SEND_INTERVAL_MS, true);

        WatchUi.requestUpdate();
    }

    function stop() as Void {
        if (_timer != null) {
            (_timer as Timer.Timer).stop();
            _timer = null;
        }
        Sensor.enableSensorEvents(null);
        Sensor.setEnabledSensors([]);
        _running    = false;
        _inFlight   = false;
        _currentHr  = null;
        _statusText = "Stopped";
        WatchUi.requestUpdate();
    }

    // ---- Sensor callback ---------------------------------------------------
    // Fires on every sensor event from the optical HR module.
    // Keep this function allocation-free — it runs frequently.
    function onSensor(info as Sensor.Info) as Void {
        if (info.heartRate != null) {
            _currentHr = info.heartRate;
            // Track peak so a short exercise burst between ticks isn't missed.
            if (_peakHr == null || (info.heartRate as Number) > (_peakHr as Number)) {
                _peakHr = info.heartRate;
            }
            WatchUi.requestUpdate();
        }
    }

    // ---- Timer callback (every 13 s) ---------------------------------------
    function onTick() as Void {
        if (!_running || _inFlight) { return; }

        // 429 backoff: stay quiet until the window expires
        if (System.getTimer() < _backoffUntil) {
            var remaining = (_backoffUntil - System.getTimer()) / 1000;
            _statusText = "Backoff " + remaining + "s";
            WatchUi.requestUpdate();
            return;
        }

        // Apply TestRunner HR override if a test scenario is active
        var hrOverride = TestRunner.hrOverride();
        if (hrOverride != null) {
            _currentHr = hrOverride as Number;
        }

        // Use peak HR seen since last send so exercise bursts between ticks
        // are captured even if the user's HR has already come back down.
        var hr = (_peakHr != null) ? _peakHr : _currentHr;
        if (hr == null) { return; }
        if ((hr as Number) < 30 || (hr as Number) > 230) { return; }

        var now = System.getTimer();
        var due = false;

        if (_lastSentHr == null) {
            due = true;                             // first reading ever
        } else {
            var delta = ((hr as Number) - (_lastSentHr as Number)).abs();
            if (delta >= HR_DELTA_BPM) {
                due = true;                         // meaningful change
            } else if (now - _lastSentAt >= LIVENESS_MS) {
                due = true;                         // liveness ping
            }
        }

        if (due) { post(hr as Number); }
    }

    // ---- HTTP POST ---------------------------------------------------------
    private function post(hr as Number) as Void {
        _inFlight = true;
        _statusText = "Sending " + hr + "…";
        WatchUi.requestUpdate();

        _lastSentHr = hr;
        _lastSentAt = System.getTimer();
        _peakHr     = null;  // reset peak window after each send

        // Test mode: skip real network call, mock the response directly.
        if (TestRunner.isActive()) {
            onResponse(TestRunner.mockCode(), null);
            return;
        }

        var url  = _backendUrl + "/api/integrations/watch/hr";
        var body = {
            "heartRate"    => hr,
            "activityType" => 0,    // default: resting; ActivityMonitor TBD
            "ts"           => isoNow()
        };
        var opts = {
            :method       => Communications.HTTP_REQUEST_METHOD_POST,
            :headers      => {
                "Content-Type"  => Communications.REQUEST_CONTENT_TYPE_JSON,
                "Authorization" => "Bearer " + _token
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        Communications.makeWebRequest(url, body, opts, method(:onResponse));
    }

    // ---- Response handler --------------------------------------------------
    // Maps every backend status code to a watch status string.
    function onResponse(
        code as Number,
        data as Lang.Dictionary or Lang.String or Null
    ) as Void {
        _inFlight = false;

        if (code == 202 || code == 200) {
            var suffix = TestRunner.isActive() ? " " + TestRunner.label() : "";
            _statusText = "OK (" + _lastSentHr + " bpm)" + suffix;

        } else if (code == 401) {
            _statusText = "Bad token — re-set in app";

        } else if (code == 409) {
            _statusText = "Open Kokonada in browser";

        } else if (code == 429) {
            // Back off for one full rate-limit window + buffer.
            _backoffUntil = System.getTimer() + BACKOFF_MS;
            _statusText   = "Rate limited — backing off";

        } else if (code == 400) {
            _statusText = "HR out of range (" + _lastSentHr + ")";

        } else if (code == -104 || code == -101) {
            // -104: phone not connected / BT off; -101: connection refused
            _statusText = "Phone disconnected";

        } else if (code < 0) {
            _statusText = "Net error " + code;

        } else {
            _statusText = "HTTP " + code;
        }

        WatchUi.requestUpdate();
    }

    // ---- Helpers -----------------------------------------------------------
    // UTC ISO-8601 timestamp with zero allocations beyond the format call.
    private function isoNow() as String {
        var info = Gregorian.utcInfo(Time.now(), Time.FORMAT_SHORT);
        return Lang.format("$1$-$2$-$3$T$4$:$5$:$6$Z", [
            info.year.format("%04d"),
            info.month.format("%02d"),
            info.day.format("%02d"),
            info.hour.format("%02d"),
            info.min.format("%02d"),
            info.sec.format("%02d")
        ]);
    }
}
