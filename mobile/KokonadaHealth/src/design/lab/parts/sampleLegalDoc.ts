// The lab's sample legal document (P1 spec §B.1 item 2 and §8; P1-D10): what the LegalReader scene draws in place of the
// bundled policy, which the lab never reads. It is not the policy and says so: the SAMPLE marker sits above it, and its
// strings live here and never enter a catalog. Its address is a reserved example domain (RFC 2606), never the hosted one.
// Its text is the lab's own and makes no claim of any kind: it only gives the reader every block it draws (headings, long
// paragraphs, a bulleted and a numbered list, an address and an email inside the text), long enough to scroll.

import type { LegalDocument, ReaderLines } from '../../v2/components/LegalReader/LegalReader';
import type { ReaderScript } from '../../v2/components/LegalReader/LegalReader';

/** The tag above the sample (P1 spec §B.1 item 2), in both scripts: the sample is never mistaken for the policy. */
export const SAMPLE_MARKER: Readonly<Record<ReaderScript, string>> = {
  latin: 'SAMPLE · not the policy',
  hebrew: 'דוגמה · לא המדיניות',
};

/** The reserved example address the sample's current-text line names (RFC 2606), never the hosted policy's. */
export const SAMPLE_ADDRESS = 'https://example.org/privacy';

/** The sample's meta lines, the lab's own words for legal.reader.online and legal.reader.version. */
export const SAMPLE_LINES: Readonly<Record<ReaderScript, ReaderLines>> = {
  latin: {
    current: (address) => `The current text is always online at ${address}. This copy is the one in this build.`,
    version: (version, date) => `Version ${version} · ${date}`,
  },
  hebrew: {
    current: (address) => `הנוסח העדכני נמצא תמיד ברשת, בכתובת ${address}. העותק הזה הוא זה שבגרסה הזו.`,
    version: (version, date) => `גרסה ${version} · ${date}`,
  },
};

const LONG_LATIN =
  'This paragraph is long on purpose, so the reader has a block that wraps over many lines at every font scale, and so the column scrolls far enough for the hairline under the top bar to show. It carries no meaning of its own and asks nothing of the person reading it.';
const LONG_HEBREW =
  'הפסקה הזו ארוכה בכוונה, כדי שלקורא תהיה פסקה שנשברת על פני שורות רבות בכל גודל גופן, וכדי שהעמודה תגלול מספיק רחוק כדי שהקו הדק שמתחת לסרגל העליון יופיע. אין לה משמעות משלה, והיא אינה מבקשת דבר מהקורא.';

export const SAMPLE_LEGAL_DOC: Readonly<Record<ReaderScript, LegalDocument>> = {
  latin: {
    title: 'Sample document for the reader',
    version: '0',
    dateLabel: '1 January 2026',
    blocks: [
      { kind: 'heading', text: 'About this sample' },
      { kind: 'paragraph', text: 'This is a sample, drawn only in the Design Lab. It shows how the reader sets a document, and it is not any document of the app.' },
      { kind: 'paragraph', text: 'An address inside the text stays plain: https://example.org/sample, or sample@example.org. Neither can be tapped.' },
      { kind: 'heading', text: 'A bulleted list' },
      { kind: 'list', items: ['A short item.', 'An item long enough to wrap onto a second line beside its marker, so the hanging column shows.', 'A last item.'] },
      { kind: 'heading', text: 'A numbered list' },
      { kind: 'list', ordered: true, items: ['The first step.', 'The second step, with an address: https://example.org/steps.', 'The third step.'] },
      { kind: 'heading', text: 'A longer section' },
      { kind: 'paragraph', text: LONG_LATIN },
      { kind: 'paragraph', text: LONG_LATIN },
      { kind: 'paragraph', text: LONG_LATIN },
      { kind: 'heading', text: 'The end of the sample' },
      { kind: 'paragraph', text: 'This is the last block, so the end of the column can be seen above the inset.' },
    ],
  },
  hebrew: {
    title: 'מסמך לדוגמה עבור הקורא',
    version: '0',
    dateLabel: '1 בינואר 2026',
    blocks: [
      { kind: 'heading', text: 'על הדוגמה' },
      { kind: 'paragraph', text: 'זו דוגמה, שמוצגת רק במעבדת העיצוב. היא מראה איך הקורא מציג מסמך, והיא אינה אף מסמך של האפליקציה.' },
      { kind: 'paragraph', text: 'כתובת בתוך הטקסט נשארת טקסט רגיל: https://example.org/sample, או sample@example.org. אי אפשר להקיש על אף אחת מהן.' },
      { kind: 'heading', text: 'רשימה עם תבליטים' },
      { kind: 'list', items: ['פריט קצר.', 'פריט ארוך מספיק כדי להישבר לשורה שנייה ליד הסימן שלו, כך שהעמודה התלויה נראית.', 'פריט אחרון.'] },
      { kind: 'heading', text: 'רשימה ממוספרת' },
      { kind: 'list', ordered: true, items: ['הצעד הראשון.', 'הצעד השני, עם כתובת: https://example.org/steps.', 'הצעד השלישי.'] },
      { kind: 'heading', text: 'פרק ארוך יותר' },
      { kind: 'paragraph', text: LONG_HEBREW },
      { kind: 'paragraph', text: LONG_HEBREW },
      { kind: 'paragraph', text: LONG_HEBREW },
      { kind: 'heading', text: 'סוף הדוגמה' },
      { kind: 'paragraph', text: 'זו הפסקה האחרונה, כדי שאפשר יהיה לראות את סוף העמודה מעל השוליים.' },
    ],
  },
};
