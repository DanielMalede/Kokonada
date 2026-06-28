import Toybox.Lang;
import Toybox.WatchUi;

// ---------------------------------------------------------------------------
// TestRunner — in-app scenario injector for pre-sideload validation.
//
// How to use (simulator only):
//   Press MENU (hold UP on fēnix) while the app is running to cycle scenarios.
//   Each press advances to the next scenario. Press past the last to exit test
//   mode and return to normal operation.
//
//   In test mode, HrStreamer skips the real makeWebRequest and calls onResponse
//   directly with the mocked status code — the full state machine runs but no
//   network traffic is generated.
//
// Remove from production: add `excludeAnnotations = [ "test" ]` to monkey.jungle
// or simply leave in — the code is inert when _active = false.
// ---------------------------------------------------------------------------
class TestRunner {

    // ---- Scenarios ---------------------------------------------------------
    enum {
        SCENARIO_NORMAL       = 0,   // real network path (exits test mode)
        SCENARIO_OK           = 1,   // mock 202 — happy path
        SCENARIO_NO_SESSION   = 2,   // mock 409 — browser tab closed
        SCENARIO_BAD_TOKEN    = 3,   // mock 401 — revoked/wrong token
        SCENARIO_RATE_LIMITED = 4,   // mock 429 — hit the 5/min limit
        SCENARIO_NET_ERROR    = 5,   // mock -104 — phone not connected
        SCENARIO_HR_SPIKE     = 6,   // force HR=155 — triggers ≥25bpm delta
        SCENARIO_HR_FLAT      = 7,   // force HR=121 — <8bpm, tests liveness window
        SCENARIO_COUNT        = 8,
    }

    private static var _active   as Boolean = false;
    private static var _scenario as Number  = SCENARIO_NORMAL;

    // ---- State accessors ---------------------------------------------------
    static function isActive() as Boolean { return _active; }
    static function scenario() as Number  { return _scenario; }

    // ---- Control -----------------------------------------------------------
    static function advance() as Void {
        _scenario = (_scenario + 1) % SCENARIO_COUNT;
        if (_scenario == SCENARIO_NORMAL) {
            _active = false;  // wrapped around — exit test mode
        } else {
            _active = true;
        }
        WatchUi.requestUpdate();
    }

    // ---- Label for the View ------------------------------------------------
    static function label() as String {
        if (!_active) { return ""; }
        switch (_scenario) {
            case SCENARIO_OK:           return "[T] 202 OK";
            case SCENARIO_NO_SESSION:   return "[T] 409 No session";
            case SCENARIO_BAD_TOKEN:    return "[T] 401 Bad token";
            case SCENARIO_RATE_LIMITED: return "[T] 429 Rate limit";
            case SCENARIO_NET_ERROR:    return "[T] Net error";
            case SCENARIO_HR_SPIKE:     return "[T] HR spike 155";
            case SCENARIO_HR_FLAT:      return "[T] HR flat 121";
            default:                    return "[T]";
        }
    }

    // ---- Mock HTTP response code ------------------------------------------
    // HrStreamer calls this instead of makeWebRequest in test mode.
    static function mockCode() as Number {
        switch (_scenario) {
            case SCENARIO_OK:           return 202;
            case SCENARIO_NO_SESSION:   return 409;
            case SCENARIO_BAD_TOKEN:    return 401;
            case SCENARIO_RATE_LIMITED: return 429;
            case SCENARIO_NET_ERROR:    return -104;
            default:                    return 202;
        }
    }

    // ---- HR override -------------------------------------------------------
    // Returns a forced HR value for spike/flat scenarios, null otherwise.
    static function hrOverride() as Number? {
        if (!_active) { return null; }
        switch (_scenario) {
            case SCENARIO_HR_SPIKE: return 155;
            case SCENARIO_HR_FLAT:  return 121;
            default:                return null;
        }
    }
}
