import Toybox.Lang;
import Toybox.WatchUi;

// ---------------------------------------------------------------------------
// KokonadaDelegate — input handling.
//
// START / SELECT (short press or tap): toggle streaming on/off.
// MENU (hold UP on fēnix, or dedicated MENU key):
//   cycle through TestRunner scenarios; wrapping past the last exits test mode.
// ---------------------------------------------------------------------------
class KokonadaDelegate extends WatchUi.BehaviorDelegate {

    private var _streamer as HrStreamer;

    function initialize(streamer as HrStreamer) {
        BehaviorDelegate.initialize();
        _streamer = streamer;
    }

    // START / SELECT ---------------------------------------------------------
    function onSelect() as Boolean {
        _streamer.toggle();
        return true;
    }

    // Touch devices: tap = toggle ------------------------------------------------
    function onTap(evt as WatchUi.ClickEvent) as Boolean {
        _streamer.toggle();
        return true;
    }

    // MENU key: advance test scenario ----------------------------------------
    // On fēnix, MENU is a long-press of the UP button and fires onMenu().
    function onMenu() as Boolean {
        TestRunner.advance();
        return true;
    }

    // BACK key: stop streaming (safe exit) -----------------------------------
    function onBack() as Boolean {
        if (_streamer.isRunning()) {
            _streamer.stop();
            return true;    // consumed — don't exit the app
        }
        return false;       // propagate to default (exit app)
    }
}
