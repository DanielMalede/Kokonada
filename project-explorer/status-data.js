(function initKokonadaStatus(root, factory) {
  'use strict';

  const status = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = status;
  }

  if (root) {
    root.KokonadaStatus = status;
  }
})(typeof window !== 'undefined' ? window : null, function createKokonadaStatus() {
  'use strict';

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
      return value;
    }

    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  return deepFreeze({
    schemaVersion: 1,
    snapshot: {
      capturedOn: '2026-10-05',
      timezone: 'Asia/Jerusalem',
      commit: '55d68cc',
      provenance: 'verified-locally',
    },
    product: {
      statement: 'קלט מהתודעה ומאותות הגוף מתורגם למצב, ליעדי מוזיקה ולנגינה דרך Spotify.',
      boundary: 'Kokonada היא חוויית wellness ואינה כלי לאבחון או לטיפול רפואי.',
      playbackProvider: 'Spotify',
      youtubeActive: false,
    },
    verification: {
      backend: {
        suitesPassed: 285,
        testsPassed: 4658,
        suitesSkipped: 3,
        testsSkipped: 38,
        todos: 1,
        provenance: 'verified-locally',
      },
      mobile: {
        suitesPassed: 200,
        testsPassed: 2689,
        testsSkipped: 1,
        openHandleWarning: true,
        provenance: 'verified-locally',
      },
      lint: {
        backend: { errors: 0, warnings: 21 },
        mobile: { errors: 72, warnings: 75 },
      },
      audit: {
        backend: { total: 6, high: 4, moderate: 2, critical: 0 },
        mobile: { total: 53, high: 40, moderate: 13, critical: 0 },
      },
    },
    deployment: {
      recommendedBaseline: '55d68cc',
      reviewedPullRequest: 217,
      decision: 'hold',
      deployWithPr: false,
      requiresFreshReviewAfterChange: true,
    },
    glossary: {
      POC: 'הוכחת היתכנות שמראה שהרעיון המרכזי יכול לעבוד לפני שבונים מוצר מלא.',
      Frontend: 'האפליקציה או הממשק שהמשתמש רואה ומפעיל בטלפון או בדפדפן.',
      Backend: 'השירות שמקבל בקשות, מפעיל את הלוגיקה העסקית ומנהל גישה לנתונים.',
      'Runtime agent': 'רכיב תוכנה בתוך Kokonada שמבצע תפקיד מוגדר בצינור עיבוד המצב והמוזיקה.',
      MongoDB: 'מסד הנתונים הראשי שבו נשמרים מסמכי המערכת בהתאם לכללי הרשאה ופרטיות.',
      Redis: 'מאגר זמני ומהיר שמשמש לתורים, נעילות ומידע קצר חיים של המערכת.',
      BullMQ: 'ספריית תורים שמריצה עבודות רקע בצורה מסודרת מעל Redis.',
      PR: 'בקשת Pull Request שמציעה שינוי בקוד ומאפשרת סקירה לפני מיזוג.',
      CI: 'בדיקות אוטומטיות שרצות על שינוי ומוודאות שהוא עומד בשערי הפרויקט.',
      Worktree: 'עותק עבודה מבודד של אותו מאגר Git שמאפשר לעבוד בלי להפריע לענפים אחרים.',
      Deploy: 'העברת גרסה שנבדקה אל סביבת הרצה כמו staging או production.',
      'Production verification': 'בדיקה לאחר פריסה שמוכיחה שהגרסה הנכונה פועלת באמת בסביבה החיה.',
    },
  });
});
