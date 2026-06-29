import Toybox.Lang;
import Toybox.WatchUi;

// ---------------------------------------------------------------------------
// KokonadaDelegate — input handling.
//
// START / SELECT (short press or tap): toggle streaming on/off (instant).
// MENU (hold UP on fēnix, or dedicated MENU key):
//   cycle through TestRunner scenarios; wrapping past the last exits test mode.
// BACK: while streaming -> confirmation prompt (never an instant stop);
//       while stopped    -> propagate, exiting the app.
// ---------------------------------------------------------------------------
class KokonadaDelegate extends WatchUi.BehaviorDelegate {

    private var _streamer as HrStreamer;

    function initialize(streamer as HrStreamer) {
        BehaviorDelegate.initialize();
        _streamer = streamer;
    }

    // START / SELECT — instant toggle (deliberate primary action) ------------
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

    // BACK key: guarded ------------------------------------------------------
    //   Streaming: a single press only RAISES a confirmation — the sensor and
    //   timer keep running until the user explicitly answers "Yes". An
    //   accidental press (or a second BACK, which dismisses the dialog as "No")
    //   is harmless.
    //   Stopped: return false so the framework exits the app as before.
    function onBack() as Boolean {
        if (_streamer.isRunning()) {
            var prompt = WatchUi.loadResource(Rez.Strings.ConfirmStop) as String;
            WatchUi.pushView(
                new WatchUi.Confirmation(prompt),
                new StopConfirmationDelegate(_streamer),
                WatchUi.SLIDE_IMMEDIATE
            );
            return true;    // consumed — do NOT stop, do NOT exit
        }
        return false;       // not streaming → let BACK exit the app
    }
}

// ---------------------------------------------------------------------------
// StopConfirmationDelegate — handles the Yes/No response from the
// "Stop streaming?" prompt pushed by KokonadaDelegate.onBack(). The framework
// pops the confirmation view automatically before onResponse runs, so we only
// act on YES. By default the Confirmation highlights "No", so an accidental
// press cancels safely.
// ---------------------------------------------------------------------------
class StopConfirmationDelegate extends WatchUi.ConfirmationDelegate {

    private var _streamer as HrStreamer;

    function initialize(streamer as HrStreamer) {
        ConfirmationDelegate.initialize();
        _streamer = streamer;
    }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        if (response == WatchUi.CONFIRM_YES) {
            _streamer.stop();
        }
        // CONFIRM_NO / BACK-to-dismiss: do nothing — streaming continues.
        return true;
    }
}
