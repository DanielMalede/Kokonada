import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

// Entry point. Owns the single HrStreamer instance for the app's lifetime and
// hands the View + InputDelegate to the UI stack.
class KokonadaApp extends Application.AppBase {

    private var _streamer as HrStreamer;

    function initialize() {
        AppBase.initialize();
        // Created here (not onStart) so it's always non-null for getInitialView.
        // The constructor only reads phone settings; it does NOT touch sensors.
        _streamer = new HrStreamer();
    }

    function onStop(state as Lang.Dictionary?) as Void {
        // Release the HR sensor + timer when the app leaves the foreground.
        _streamer.stop();
    }

    function getInitialView() {
        var view = new KokonadaView(_streamer);
        var delegate = new KokonadaDelegate(_streamer);
        return [view, delegate];
    }

    // Fired when the user edits settings in Garmin Connect Mobile / Express.
    function onSettingsChanged() as Void {
        _streamer.reloadConfig();
        WatchUi.requestUpdate();
    }
}
