# WAVE4_KICKOFF — איך מתניעים את ריצת 4 הימים

## הדרך המומלצת (חצי שעה לפני שאתה יוצא)

שלב ראשון — סשן ראשון אינטראקטיבי (מומלץ, לא חובה): פתח `Claude Code` בתיקיית הפרויקט והדבק את הפרומפט שבסוף הקובץ. הסשן הראשון מריץ סבב סקירה (`review pass`) על הריפו המלא, מעדכן את התוכנית לפי מה שנמצא בפועל, וכותב הכול ל-`WAVE4_STATE.md`. אם אתה נשאר מול המסך — תוכל לראות את הסקירה בעצמך.

שלב שני — התנעת הלולאה: פתח `PowerShell` בתיקיית הפרויקט והרץ:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\run-mission.ps1
```

זהו. הלולאה מריצה סשן אחרי סשן: כל סשן קורא את `WAVE4_INTELLIGENCE_MISSION.md` ואת `WAVE4_STATE.md`, מבצע משימה אחת מהתור לפי הפרוטוקול, מעדכן את המצב, עושה `commit`, ויוצא. הלולאה ממשיכה עד גמר התור, עד תקרת האיטרציות, או עד שתעצור אותה.

## דרך מהירה (בלי סשן ראשון ידני)

אפשר גם פשוט להריץ את הסקריפט — הסשן הראשון בלולאה יבצע את סבב הסקירה לבד וימשיך משם.

## עצירה

עצירת חירום: צור קובץ ריק בשם `docs\plans\WAVE4_HALT` (או `Ctrl+C` בחלון של הסקריפט). הלולאה נעצרת בתחילת האיטרציה הבאה.

## מה מחכה לך כשתחזור

תיעוד מלא ב-`docs/plans/WAVE4_REPORT.md` (מה נבנה, מה התגלה, ראיות בדיקות, diffs של שינויי התנהגות), תור PRs שמחכה רק לקליק שלך, מטריצת החלטות (`HITL`) עם הוראות מסודרות לכל פעולת פורטל, ו-checklist לאימות on-device. שום דבר לא עושה merge בלעדיך.

## צ'קליסט לפני יציאה (2 דקות, חוסך תקלות של ימים)

הדרך המהירה — סקריפט הבדיקה המרוכז, שבודק את הכול ומדפיס פקודת תיקון לכל מה שחסר:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-setup.ps1
```

תקן כל שורת `FIX` שהוא מציג, הרץ שוב עד שהכול ירוק, ובצע את שתי ההשלמות הידניות שבסוף (סשן `claude` אחד + `npm test`). ואם אתה מעדיף ידנית — אלה הבדיקות:

1. חשמל: כבה מצב שינה ב-`Windows` (המסך יכול לכבות — המחשב לא נרדם).
2. הרץ `claude --version` — עובד ומחובר לחשבון.
3. הרץ `gh auth status` — מחובר (בלי זה לא ייחתכו `PRs`; העבודה תמשיך, אבל חבל).
4. הרץ `git config user.name` — מוגדר (בלי זה קומיטים ייכשלו).
5. ודא אינטרנט יציב — הסשן הראשון מוריד חבילות (`zod`, `fast-check`, בינארי של `mongodb-memory-server`).

הסשן הראשון גם מריץ בדיקת `preflight` אוטומטית על כל אלה — אבל עדיף לתפוס בעיה כשאתה עוד ליד המחשב.

## ניהול טוקנים ומודלים (מובנה בסקריפט)

הלולאה מודדת לפני כל סשן את הצריכה המשוערת ובוחרת מודל לפי המדיניות שקבעת:

| מצב | מודל |
|------|------|
| סבב הסקירה (`phase: review`) | `fable` בחשיבה מקסימלית |
| ביצוע רגיל | `opus` בחשיבה מקסימלית |
| חלון הסשן עבר `70%` (או שבועי מעל הסף הרך) | `sonnet` — וחוזר ל-`opus` אוטומטית כשהחלון מתאפס |
| חלון הסשן עבר `95%` (או שבועי מעל הסף הקשיח) | הלולאה ממתינה לאיפוס במקום לשרוף סשן |

דברים שחשוב להבין על המנגנון:

- חלון הצריכה של Claude הוא כ־`5` שעות (לא `4`) — הזיהוי אוטומטי, ואין צורך לכוון כלום.
- המדידה מקומית, דרך הכלי `ccusage`, שקורא את הלוגים של `Claude Code` עצמו — כי אין API רשמי שחושף את הלימיט המדויק. זו הערכה טובה אבל הערכה; תוכל להשוות מול `/usage` באפליקציה ולכייל.
- תקציב החלון מכויל אוטומטית מההיסטוריה שלך. אפשר לקבוע ידנית, למשל: `-SessionTokenBudget 80000000`.
- מעקב שבועי פועל תמיד (נרשם לוג); כדי שגם יחסום, קבע תקציב: `-WeeklyTokenBudget 400000000` (אחרי שתראה ב-`/usage` כמה שבוע מלא שלך צורך).
- כשסשן נופל על שגיאת לימיט, זה לא נספר ככישלון — הלולאה מחכה `20` דקות ומנסה שוב.
- מעקב חי: הקובץ `logs\wave4\usage.log` מרכז שורה לכל החלטה — אחוז חלון, שבועי, ומודל שנבחר; וסשן שרץ על `sonnet` יודע לבחור משימות מכניות וקצרות ולהשאיר עיצוב כבד ל-`opus`.

## דברים שכדאי לדעת

- הרשאות: הסקריפט מריץ את `claude` במצב אוטונומי. אם ההתקנה שלך דורשת אישורי הרשאות אינטראקטיביים, ערוך את המשתנה `$ClaudeFlags` בראש הסקריפט (יש שם הערה) או הרץ פעם אחת אינטראקטיבית ואשר "always allow" לפעולות בריפו.
- מודל: לפי הפרוטוקול של הפרויקט, ריצת הביצוע רצה על מודל `Opus`-class. קבע ברירת מחדל בהגדרות של `Claude Code`, או הוסף `--model opus` ל-`$ClaudeFlags`.
- לוגים: כל סשן נשמר ל-`logs\wave4\session-<n>.log`.
- הריצה בטוחה מולך: כל העבודה על ענף `feat/intelligence-wave`; ה-`main` לא נגוע; מיזוגים רק בקליק שלך.

---

## הפרומפט (מודבק אוטומטית ע"י הסקריפט; זהה לשימוש ידני)

```
ultrathink. This is a Wave-4 Runtime Intelligence session for the Kokonada repo.
Read docs/plans/WAVE4_INTELLIGENCE_MISSION.md fully, then docs/plans/WAVE4_STATE.md.
Follow the per-session protocol in the mission (section 2) exactly:
- If STATE phase is "review", run the W4-000 plan-mode review pass (read-only validation of the mission
  against the full repo), update the mission + STATE with deltas, set phase to "execute", commit, and exit.
- Otherwise execute exactly ONE next unblocked task from the queue under strict TDD, update STATE,
  commit with short single-line messages (no attribution of any kind), cut a PR if the cluster is complete, and exit.
- Model economy: env var WAVE4_MODEL_TIER tells you how you were launched (plan|exec|saver). On "saver",
  prefer an S/M task or continuing an in_progress task over STARTING a new L design task, if one is unblocked.
- Never merge PRs. Never touch cloud portals - write HITL tutorials into STATE instead and continue.
- If docs/plans/WAVE4_HALT exists, stop immediately.
End your final message with: WAVE4_SESSION_RESULT: <taskId> <done|in_progress|failed> <one-line summary>
(If the whole queue including W4-015 is done, end instead with: WAVE4_SESSION_RESULT: DONE-ALL complete)
```
