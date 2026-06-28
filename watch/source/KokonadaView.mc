import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// ---------------------------------------------------------------------------
// KokonadaView — renders HR, status, and (in test mode) the active scenario.
//
// Performance contract:
//   onUpdate() must complete in < 10 ms to avoid frame drops.
//   No object allocation inside onUpdate — all locals are primitives or
//   single method-call results. String concatenation is deferred to the
//   status text computed by HrStreamer (updated at most 1×/tick, not per frame).
// ---------------------------------------------------------------------------
class KokonadaView extends WatchUi.View {

    private var _streamer as HrStreamer;

    function initialize(streamer as HrStreamer) {
        View.initialize();
        _streamer = streamer;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        // ---- Background ----
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var w  = dc.getWidth();
        var h  = dc.getHeight();
        var cx = w / 2;
        var cy = h / 2;

        // ---- App title ----
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy - 56, Graphics.FONT_SMALL, "Kokonada HR",
            Graphics.TEXT_JUSTIFY_CENTER);

        // ---- Heart-rate number ----
        var hr = _streamer.getCurrentHr();
        var hrText = (hr == null) ? "--" : hr.toString();
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy - 18, Graphics.FONT_NUMBER_MEDIUM, hrText,
            Graphics.TEXT_JUSTIFY_CENTER);

        // ---- Status line ----
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy + 34, Graphics.FONT_TINY, _streamer.getStatusText(),
            Graphics.TEXT_JUSTIFY_CENTER);

        // ---- Control hint ----
        var hint = _streamer.isRunning() ? "START: Stop  MENU: Test" : "START: Stream";
        dc.drawText(cx, cy + 56, Graphics.FONT_XTINY, hint,
            Graphics.TEXT_JUSTIFY_CENTER);

        // ---- Test mode banner (only when TestRunner is active) ----
        if (TestRunner.isActive()) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy + 76, Graphics.FONT_XTINY, TestRunner.label(),
                Graphics.TEXT_JUSTIFY_CENTER);
        }
    }
}
