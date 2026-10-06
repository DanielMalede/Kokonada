'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(pagePath, 'utf8');

test('declares Hebrew RTL and semantic landmarks', () => {
  assert.match(html, /<html[^>]+lang="he"[^>]+dir="rtl"/i);
  assert.match(html, /class="skip-link"[^>]*>דלג(?:י)? לתוכן/);
  assert.match(html, /<header[\s>]/i);
  assert.match(html, /<nav[\s>]/i);
  assert.match(html, /<main[\s>]/i);
  assert.match(html, /<footer[\s>]/i);
});

test('keeps every core section in static HTML', () => {
  const sectionIds = [
    'overview',
    'journey',
    'architecture',
    'data-flow',
    'status',
    'deployment',
    'workflow',
    'glossary',
  ];

  for (const id of sectionIds) {
    assert.match(html, new RegExp(`<section[^>]+id="${id}"`, 'i'));
  }

  for (let step = 1; step <= 5; step += 1) {
    assert.match(html, new RegExp(`data-learning-step="${step}"`));
  }
});

test('states the product boundary honestly', () => {
  assert.match(html, /Mind\s*\+\s*Body\s*→\s*State\s*→\s*Music\s*→\s*Spotify/i);
  assert.match(html, /wellness/i);
  assert.match(html, /אינ[הו] כלי (?:רפואי|לאבחון)/);
  assert.match(html, /שליטה.+פרטיות.+למידה/s);
  assert.match(html, /YouTube אינו נתיב פעיל/);
  assert.match(html, /Spotify.+בטא.+מורשים מראש.+5 משתמשים/s);
  assert.match(html, /ללא ספק מוזיקה.+עדיין עובד/s);
});

test('keeps the guided learning path continuous', () => {
  const guidedTargets = ['journey', 'architecture', 'data-flow', 'status', 'deployment', 'workflow', 'glossary'];

  for (const target of guidedTargets) {
    assert.match(html, new RegExp(`class="next-step"[^>]+href="#${target}"`));
  }
});

test('shows dated evidence and the PR 217 hold without JavaScript', () => {
  assert.match(html, /05\.10\.2026/);
  assert.match(html, /55d68cc/);
  assert.match(html, /4,658/);
  assert.match(html, /2,689/);
  assert.match(html, /72 שגיאות/);
  assert.match(html, /PR #217/);
  assert.match(html, /אין למזג או לפרוס/);
});

test('uses local assets only', () => {
  assert.doesNotMatch(html, /(?:src|href)=["'](?:https?:)?\/\//i);
  assert.doesNotMatch(html, /<form[\s>]/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /<script[^>]+src=["'](?![./])/i);
  assert.doesNotMatch(html, /<link[^>]+href=["'](?![./])/i);
  assert.doesNotMatch(html, /[—–]/);
});

test('provides a no-script explanation', () => {
  assert.match(html, /<noscript>[\s\S]*כל תוכן הליבה זמין[\s\S]*<\/noscript>/i);
});
