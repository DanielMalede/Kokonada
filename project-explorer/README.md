# Kokonada Project Explorer

דף היכרות פנימי ומקומי שמסביר את ה-POC, הארכיטקטורה, מצב הפרויקט ותהליך העבודה.
הדף אינו מתחבר ל-production ואינו מבצע פעולות במערכת.

## הפעלה מקומית

מתיקיית השורש של המאגר:

```powershell
node project-explorer/serve.mjs
```

לאחר ההפעלה פותחים בדפדפן:

```text
http://127.0.0.1:4173/
```

לבחירת פורט אחר:

```powershell
node project-explorer/serve.mjs --port 4300
```

השרת מאזין ל-`127.0.0.1` בלבד. הוא קורא את ה-commit הנוכחי באמצעות Git ומעביר אותו לדף בזיכרון,
בלי ליצור או לעדכן קובץ.

אפשר לפתוח את `index.html` ישירות. כל תוכן הליבה יישאר קריא, אבל הדף לא יוכל לאמת את ה-commit של
ה-worktree ולכן יציג שמצב העדכניות אינו ידוע.

## בדיקות

חוזי הליבה:

```powershell
node --test project-explorer/tests/status-data.test.js project-explorer/tests/page-contract.test.js project-explorer/tests/app-core.test.js project-explorer/tests/style-contract.test.js project-explorer/tests/serve-core.test.mjs
```

הבדיקה המלאה, כולל חיבור ה-DOM ושרת HTTP אמיתי על loopback:

```powershell
node --test project-explorer/tests/status-data.test.js project-explorer/tests/page-contract.test.js project-explorer/tests/app-core.test.js project-explorer/tests/app-dom.test.js project-explorer/tests/style-contract.test.js project-explorer/tests/serve-core.test.mjs project-explorer/tests/serve-integration.test.mjs
```

## רענון תמונת המצב

הנתונים בדף הם snapshot מתוארך. הם אינם ניטור חי. כדי לרענן אותם:

1. להריץ `git fetch origin --prune` ולוודא איזה commit נבדק.
2. להריץ מחדש את בדיקות ה-backend וה-mobile ואת בדיקות lint/audit שנבחרו לסקירה.
3. לעדכן רק את העובדות וה-provenance ב-`status-data.js`.
4. לעדכן את העותק הסטטי ב-`index.html` כדי שגם מצב ללא JavaScript יישאר נכון.
5. להריץ את הבדיקה המלאה שמופיעה למעלה.
6. לקרוא מחדש את כל הטקסטים ולוודא שאין טענה שהמידע חי או אוטומטי.
7. לבצע commit ממוקד של הנתונים, הטקסטים והבדיקות ששונו.

שינוי ב-PR #217 או בגרסת ה-main דורש סקירה חדשה. אין להסיר את מצב HOLD רק בגלל שה-SHA השתנה.
